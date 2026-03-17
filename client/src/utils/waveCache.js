// Low-Bandwidth Mode: IndexedDB Wave Caching (v2.10.0)
// Provides persistent caching for wave list and wave data for instant load

const DB_NAME = 'cortex-cache';
const DB_VERSION = 1;
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// Object store names
const STORES = {
  WAVES: 'waves',
  WAVE_LIST: 'waveList',
  PINGS: 'pings',
  METADATA: 'metadata',
};

let dbInstance = null;

// Initialize the database
async function openDatabase() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.warn('[WaveCache] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Wave list store - keyed by 'list' for single entry
      if (!db.objectStoreNames.contains(STORES.WAVE_LIST)) {
        db.createObjectStore(STORES.WAVE_LIST, { keyPath: 'key' });
      }

      // Individual waves store - keyed by wave ID
      if (!db.objectStoreNames.contains(STORES.WAVES)) {
        const waveStore = db.createObjectStore(STORES.WAVES, { keyPath: 'id' });
        waveStore.createIndex('timestamp', 'timestamp');
      }

      // Pings store - keyed by ping ID
      if (!db.objectStoreNames.contains(STORES.PINGS)) {
        const pingStore = db.createObjectStore(STORES.PINGS, { keyPath: 'id' });
        pingStore.createIndex('waveId', 'waveId');
        pingStore.createIndex('timestamp', 'timestamp');
      }

      // Metadata store - for cache version, last sync time, etc.
      if (!db.objectStoreNames.contains(STORES.METADATA)) {
        db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
      }
    };
  });
}

// Helper to perform a transaction
async function withTransaction(storeName, mode, callback) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();

      callback(store, resolve, reject);
    });
  } catch (error) {
    console.warn(`[WaveCache] Transaction failed for ${storeName}:`, error);
    return null;
  }
}

// ============ Wave List Cache ============

// Cache the wave list
export async function cacheWaveList(waves, showArchived = false) {
  const key = showArchived ? 'list-archived' : 'list';
  try {
    await withTransaction(STORES.WAVE_LIST, 'readwrite', (store, resolve) => {
      store.put({
        key,
        waves,
        timestamp: Date.now(),
      });
      resolve();
    });
    console.log(`[WaveCache] Cached ${waves.length} waves (archived=${showArchived})`);
  } catch (error) {
    console.warn('[WaveCache] Failed to cache wave list:', error);
  }
}

// Get cached wave list
export async function getCachedWaveList(showArchived = false) {
  const key = showArchived ? 'list-archived' : 'list';
  try {
    return await withTransaction(STORES.WAVE_LIST, 'readonly', (store, resolve) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        if (result && Date.now() - result.timestamp < CACHE_MAX_AGE) {
          console.log(`[WaveCache] Cache hit: ${result.waves.length} waves`);
          resolve(result.waves);
        } else {
          console.log('[WaveCache] Cache miss or expired');
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    console.warn('[WaveCache] Failed to get cached wave list:', error);
    return null;
  }
}

// ============ Individual Wave Cache ============

// Cache a wave with its pings
export async function cacheWave(waveId, waveData) {
  try {
    await withTransaction(STORES.WAVES, 'readwrite', (store, resolve) => {
      store.put({
        id: waveId,
        data: waveData,
        timestamp: Date.now(),
      });
      resolve();
    });
    console.log(`[WaveCache] Cached wave ${waveId}`);
  } catch (error) {
    console.warn('[WaveCache] Failed to cache wave:', error);
  }
}

// Get cached wave
export async function getCachedWave(waveId) {
  try {
    return await withTransaction(STORES.WAVES, 'readonly', (store, resolve) => {
      const request = store.get(waveId);
      request.onsuccess = () => {
        const result = request.result;
        if (result && Date.now() - result.timestamp < CACHE_MAX_AGE) {
          console.log(`[WaveCache] Cache hit for wave ${waveId}`);
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    console.warn('[WaveCache] Failed to get cached wave:', error);
    return null;
  }
}

// Invalidate (remove) cached wave
export async function invalidateWave(waveId) {
  try {
    await withTransaction(STORES.WAVES, 'readwrite', (store, resolve) => {
      store.delete(waveId);
      resolve();
    });
    console.log(`[WaveCache] Invalidated wave ${waveId}`);
  } catch (error) {
    console.warn('[WaveCache] Failed to invalidate wave:', error);
  }
}

// ============ Pings Cache ============

// Cache pings for a wave
export async function cachePings(waveId, pings) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.PINGS, 'readwrite');
    const store = transaction.objectStore(STORES.PINGS);
    const timestamp = Date.now();

    for (const ping of pings) {
      store.put({
        id: ping.id,
        waveId,
        data: ping,
        timestamp,
      });
    }

    return new Promise((resolve) => {
      transaction.oncomplete = () => {
        console.log(`[WaveCache] Cached ${pings.length} pings for wave ${waveId}`);
        resolve();
      };
      transaction.onerror = () => resolve();
    });
  } catch (error) {
    console.warn('[WaveCache] Failed to cache pings:', error);
  }
}

// Get cached pings for a wave
export async function getCachedPings(waveId) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORES.PINGS, 'readonly');
      const store = transaction.objectStore(STORES.PINGS);
      const index = store.index('waveId');
      const request = index.getAll(waveId);

      request.onsuccess = () => {
        const results = request.result || [];
        const validResults = results.filter(r => Date.now() - r.timestamp < CACHE_MAX_AGE);
        if (validResults.length > 0) {
          console.log(`[WaveCache] Cache hit: ${validResults.length} pings for wave ${waveId}`);
          resolve(validResults.map(r => r.data));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    console.warn('[WaveCache] Failed to get cached pings:', error);
    return null;
  }
}

// ============ Cache Management ============

// Clear old cache entries
export async function clearOldCache() {
  const cutoffTime = Date.now() - CACHE_MAX_AGE;

  try {
    // Clear old waves
    const db = await openDatabase();

    // Clear waves
    await new Promise((resolve) => {
      const transaction = db.transaction(STORES.WAVES, 'readwrite');
      const store = transaction.objectStore(STORES.WAVES);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });

    // Clear pings
    await new Promise((resolve) => {
      const transaction = db.transaction(STORES.PINGS, 'readwrite');
      const store = transaction.objectStore(STORES.PINGS);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });

    console.log('[WaveCache] Cleared old cache entries');
  } catch (error) {
    console.warn('[WaveCache] Failed to clear old cache:', error);
  }
}

// Clear all cache
export async function clearAllCache() {
  try {
    const db = await openDatabase();

    for (const storeName of Object.values(STORES)) {
      await new Promise((resolve) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        store.clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      });
    }

    console.log('[WaveCache] Cleared all cache');
  } catch (error) {
    console.warn('[WaveCache] Failed to clear all cache:', error);
  }
}

// Get cache status
export async function getCacheStatus() {
  try {
    const db = await openDatabase();

    const counts = {};
    for (const storeName of Object.values(STORES)) {
      counts[storeName] = await new Promise((resolve) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      });
    }

    return {
      waveListCached: counts[STORES.WAVE_LIST] > 0,
      wavesCached: counts[STORES.WAVES],
      pingsCached: counts[STORES.PINGS],
    };
  } catch (error) {
    console.warn('[WaveCache] Failed to get cache status:', error);
    return { waveListCached: false, wavesCached: 0, pingsCached: 0 };
  }
}

// Initialize cache cleanup on module load
if (typeof window !== 'undefined') {
  // Run cleanup once per session, delayed to not block startup
  setTimeout(clearOldCache, 10000);
}

export default {
  cacheWaveList,
  getCachedWaveList,
  cacheWave,
  getCachedWave,
  invalidateWave,
  cachePings,
  getCachedPings,
  clearOldCache,
  clearAllCache,
  getCacheStatus,
};
