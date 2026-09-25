/**
 * Wave Participation Encryption Module (v2.21.0)
 *
 * Encrypts wave participation data at rest so database dumps cannot reveal social graphs.
 * Uses AES-256-GCM encryption with server-side key management.
 *
 * Architecture:
 * - Database stores encrypted participant blobs
 * - Server maintains in-memory cache for runtime operations
 * - All routing, access control, and notifications use the memory cache
 *
 * Key management:
 * - WAVE_PARTICIPATION_KEY environment variable (32-byte hex)
 * - If not set, falls back to plaintext storage (with warning)
 */

import crypto from 'crypto';
import { reportDecryptHealth } from './field-crypto-health.js';

// Encryption key from environment
const PARTICIPATION_KEY = process.env.WAVE_PARTICIPATION_KEY || null;

// Warn if encryption is not configured
if (!PARTICIPATION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    console.error('⚠️  WARNING: WAVE_PARTICIPATION_KEY not set - participation data will be stored in plaintext');
  } else {
    console.log('ℹ️  Wave participation encryption disabled (set WAVE_PARTICIPATION_KEY to enable)');
  }
}

// In-memory caches for fast lookups
// waveId → Set<userId>
const waveToParticipants = new Map();
// userId → Set<waveId>
const userToWaves = new Map();
// waveId:userId → {archived, lastRead, pinned, hidden, joinedAt, categoryId}
const waveUserMetadata = new Map();

// Reference to database instance (set during initialization)
let db = null;

/**
 * Compute HMAC-SHA256 lookup key for wave_user_metadata table
 * @param {string} waveId
 * @param {string} userId
 * @returns {string} Hex HMAC digest
 */
function computeMetadataKey(waveId, userId) {
  if (!PARTICIPATION_KEY) return `${waveId}|${userId}`;
  return crypto.createHmac('sha256', Buffer.from(PARTICIPATION_KEY, 'hex'))
    .update(`${waveId}|${userId}`).digest('hex');
}

/**
 * Compute HMAC-SHA256 of userId for blinding in wave_encryption_keys
 * @param {string} userId
 * @returns {string} Hex HMAC digest
 */
function computeUserKeyId(userId) {
  if (!PARTICIPATION_KEY) return userId;
  return crypto.createHmac('sha256', Buffer.from(PARTICIPATION_KEY, 'hex'))
    .update(userId).digest('hex');
}

/**
 * Encrypt metadata JSON blob
 * @param {Object} metadata
 * @returns {{encrypted_data: string, iv: string}|null}
 */
function encryptMetadata(metadata) {
  if (!PARTICIPATION_KEY) return null;
  try {
    const key = Buffer.from(PARTICIPATION_KEY, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = JSON.stringify(metadata);
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    const combined = Buffer.concat([Buffer.from(encrypted, 'base64'), authTag]).toString('base64');
    return { encrypted_data: combined, iv: iv.toString('base64') };
  } catch (err) {
    console.error('Metadata encryption error:', err.message);
    return null;
  }
}

/**
 * Decrypt metadata JSON blob
 * @param {string} encryptedData - Base64 encrypted data
 * @param {string} iv - Base64 IV
 * @returns {Object|null}
 */
function decryptMetadata(encryptedData, iv) {
  if (!PARTICIPATION_KEY || !encryptedData || !iv) return null;
  try {
    const key = Buffer.from(PARTICIPATION_KEY, 'hex');
    const ivBuffer = Buffer.from(iv, 'base64');
    const combined = Buffer.from(encryptedData, 'base64');
    const authTag = combined.slice(-16);
    const ciphertext = combined.slice(0, -16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    console.error('Metadata decryption error:', err.message);
    return null;
  }
}

/**
 * Encrypt participant list for a wave
 * @param {string[]} userIds - Array of user IDs
 * @returns {{blob: string, iv: string}|null} Encrypted data or null if encryption disabled
 */
export function encryptParticipants(userIds) {
  if (!PARTICIPATION_KEY) return null;

  try {
    const key = Buffer.from(PARTICIPATION_KEY, 'hex');
    const iv = crypto.randomBytes(12); // AES-GCM uses 12-byte IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const data = JSON.stringify(userIds);
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Combine ciphertext + auth tag
    const combined = Buffer.concat([Buffer.from(encrypted, 'base64'), authTag]).toString('base64');

    return {
      blob: combined,
      iv: iv.toString('base64')
    };
  } catch (err) {
    console.error('Wave participation encryption error:', err.message);
    return null;
  }
}

/**
 * Decrypt participant list for a wave
 * @param {string} blob - Base64 encrypted data (ciphertext + auth tag)
 * @param {string} iv - Base64 initialization vector
 * @returns {string[]|null} Array of user IDs or null on error
 */
export function decryptParticipants(blob, iv) {
  if (!PARTICIPATION_KEY || !blob || !iv) return null;

  try {
    const key = Buffer.from(PARTICIPATION_KEY, 'hex');
    const ivBuffer = Buffer.from(iv, 'base64');
    const combined = Buffer.from(blob, 'base64');

    // Split ciphertext and auth tag (auth tag is last 16 bytes)
    const authTag = combined.slice(-16);
    const ciphertext = combined.slice(0, -16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (err) {
    console.error('Wave participation decryption error:', err.message);
    return null;
  }
}

/**
 * Initialize the participation cache from database
 * Called on server startup after database initialization
 * @param {Object} database - Database instance with access to encrypted participation data
 * @returns {Promise<{waveCount: number, participantCount: number}>} Stats about loaded data
 */
export async function initializeCache(database) {
  db = database;
  waveToParticipants.clear();
  userToWaves.clear();
  waveUserMetadata.clear();

  let waveCount = 0;
  let participantCount = 0;

  // Check if encrypted table exists AND has data
  const encryptedTableExists = db.db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='wave_participants_encrypted'
  `).get();

  const encryptedCount = encryptedTableExists
    ? db.db.prepare('SELECT COUNT(*) as count FROM wave_participants_encrypted').get()?.count || 0
    : 0;

  // `encryptedCount > 0` means rows EXIST. It does not mean they can be READ
  // (v2.105.5) — see lib/field-crypto-health.js for what went wrong on a real
  // node. So the decrypt pass is counted, and a wholesale failure falls through
  // to the plaintext table rather than reporting an empty cache as success.
  let decryptHealth = { healthy: true, totalFailure: false, partial: false };
  const unreadableWaves = [];

  if (encryptedTableExists && PARTICIPATION_KEY && encryptedCount > 0) {
    // Load from encrypted table (migration has been run)
    console.log('🔐 Loading encrypted wave participation data...');
    const rows = db.db.prepare('SELECT wave_id, participant_blob, iv FROM wave_participants_encrypted').all();

    for (const row of rows) {
      const userIds = decryptParticipants(row.participant_blob, row.iv);
      if (userIds && Array.isArray(userIds)) {
        waveToParticipants.set(row.wave_id, new Set(userIds));
        waveCount++;

        for (const userId of userIds) {
          if (!userToWaves.has(userId)) {
            userToWaves.set(userId, new Set());
          }
          userToWaves.get(userId).add(row.wave_id);
          participantCount++;
        }
      } else {
        unreadableWaves.push(row.wave_id);
      }
    }

    decryptHealth = reportDecryptHealth({
      label: 'wave participation',
      keyEnvVar: 'WAVE_PARTICIPATION_KEY',
      total: rows.length,
      decrypted: waveCount,
      failedKeys: unreadableWaves,
    });

    if (decryptHealth.partial) {
      // Only the waves whose blob would not open. The rest keep the encrypted
      // store's answer, which is authoritative where it is readable.
      const missing = new Set(unreadableWaves);
      const plaintextForMissing = db.db.prepare(`
        SELECT wave_id, user_id FROM wave_participants
        WHERE wave_id IN (${unreadableWaves.map(() => '?').join(',') || "''"})
      `).all(...unreadableWaves);
      for (const row of plaintextForMissing) {
        if (!missing.has(row.wave_id)) continue;
        if (!waveToParticipants.has(row.wave_id)) {
          waveToParticipants.set(row.wave_id, new Set());
          waveCount++;
        }
        waveToParticipants.get(row.wave_id).add(row.user_id);
        if (!userToWaves.has(row.user_id)) userToWaves.set(row.user_id, new Set());
        userToWaves.get(row.user_id).add(row.wave_id);
        participantCount++;
      }
      console.log(`📂 Recovered ${plaintextForMissing.length} participant mapping(s) from plaintext for unreadable waves`);
    }

    if (!decryptHealth.totalFailure) {
      console.log(`✅ Loaded ${waveCount} encrypted waves with ${participantCount} participant mappings`);
    }
  }

  if (decryptHealth.totalFailure) {
    // Every blob was locked. Start over from plaintext — the banner above has
    // already said why, loudly.
    waveToParticipants.clear();
    userToWaves.clear();
    waveCount = 0;
    participantCount = 0;
  }

  if (!(encryptedTableExists && PARTICIPATION_KEY && encryptedCount > 0) || decryptHealth.totalFailure) {
    // Encryption not enabled, table doesn't exist, or no migration yet - load from plaintext table
    if (PARTICIPATION_KEY && encryptedCount === 0) {
      console.log('📂 Loading from plaintext table (run migration to encrypt existing data)...');
    } else {
      console.log('📂 Loading wave participation data from plaintext table...');
    }
    const rows = db.db.prepare('SELECT wave_id, user_id FROM wave_participants').all();

    for (const row of rows) {
      // Build waveToParticipants
      if (!waveToParticipants.has(row.wave_id)) {
        waveToParticipants.set(row.wave_id, new Set());
        waveCount++;
      }
      waveToParticipants.get(row.wave_id).add(row.user_id);

      // Build userToWaves
      if (!userToWaves.has(row.user_id)) {
        userToWaves.set(row.user_id, new Set());
      }
      userToWaves.get(row.user_id).add(row.wave_id);
      participantCount++;
    }

    console.log(`✅ Loaded ${waveCount} waves with ${participantCount} participant mappings into cache`);
  }

  // Load wave user metadata (v2.27.0)
  // Always load plaintext first, then overlay encrypted records on top.
  // This ensures category_id from wave_category_assignments is always available
  // even before the admin migration is run.
  const plaintextRows = db.db.prepare(`
    SELECT wp.wave_id, wp.user_id, wp.archived, wp.last_read, wp.pinned, wp.joined_at,
      wca.category_id
    FROM wave_participants wp
    LEFT JOIN wave_category_assignments wca ON wp.wave_id = wca.wave_id AND wp.user_id = wca.user_id
  `).all();

  for (const row of plaintextRows) {
    waveUserMetadata.set(`${row.wave_id}:${row.user_id}`, {
      archived: row.archived || 0,
      lastRead: row.last_read || null,
      pinned: row.pinned || 0,
      hidden: 0,
      joinedAt: row.joined_at || null,
      categoryId: row.category_id || null,
    });
  }

  if (plaintextRows.length > 0) {
    console.log(`📂 Loaded ${plaintextRows.length} wave user metadata records from plaintext`);
  }

  // Overlay encrypted metadata on top (takes precedence — contains hidden flag, etc.)
  const metadataTableExists = db.db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='wave_user_metadata'
  `).get();

  if (metadataTableExists && PARTICIPATION_KEY) {
    const metadataRows = db.db.prepare('SELECT lookup_key, encrypted_data, iv FROM wave_user_metadata').all();
    let encryptedCount = 0;

    for (const [waveId, participants] of waveToParticipants.entries()) {
      for (const userId of participants) {
        const lookupKey = computeMetadataKey(waveId, userId);
        const row = metadataRows.find(r => r.lookup_key === lookupKey);
        if (row) {
          const metadata = decryptMetadata(row.encrypted_data, row.iv);
          if (metadata) {
            waveUserMetadata.set(`${waveId}:${userId}`, metadata);
            encryptedCount++;
          }
        }
      }
    }

    if (encryptedCount > 0) {
      console.log(`🔐 Overlaid ${encryptedCount} encrypted wave user metadata records`);
    }
  }

  return { waveCount, participantCount };
}

/**
 * Update the encrypted blob in the database for a wave
 * @param {string} waveId - Wave ID
 * @private
 */
function updateEncryptedBlob(waveId) {
  if (!PARTICIPATION_KEY || !db) return;

  const participants = waveToParticipants.get(waveId);
  if (!participants || participants.size === 0) {
    // No participants - delete the encrypted record
    db.db.prepare('DELETE FROM wave_participants_encrypted WHERE wave_id = ?').run(waveId);
    return;
  }

  const userIds = Array.from(participants);
  const encrypted = encryptParticipants(userIds);

  if (encrypted) {
    const now = Math.floor(Date.now() / 1000);
    db.db.prepare(`
      INSERT INTO wave_participants_encrypted (wave_id, participant_blob, iv, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(wave_id) DO UPDATE SET
        participant_blob = excluded.participant_blob,
        iv = excluded.iv,
        updated_at = excluded.updated_at
    `).run(waveId, encrypted.blob, encrypted.iv, now);
  }
}

/**
 * Add a participant to a wave (updates both cache and DB)
 * @param {string} waveId - Wave ID
 * @param {string} userId - User ID
 * @param {Object} options - Additional options (joinedAt, archived)
 * @returns {boolean} Success
 */
export function addParticipant(waveId, userId, options = {}) {
  // Update in-memory cache
  if (!waveToParticipants.has(waveId)) {
    waveToParticipants.set(waveId, new Set());
  }
  waveToParticipants.get(waveId).add(userId);

  if (!userToWaves.has(userId)) {
    userToWaves.set(userId, new Set());
  }
  userToWaves.get(userId).add(waveId);

  // Initialize metadata for new participant (v2.27.0)
  const metaKey = `${waveId}:${userId}`;
  if (!waveUserMetadata.has(metaKey)) {
    const metadata = {
      archived: options.archived || 0,
      lastRead: null,
      pinned: 0,
      hidden: 0,
      joinedAt: options.joinedAt || new Date().toISOString(),
      categoryId: null,
    };
    waveUserMetadata.set(metaKey, metadata);
  }

  // Update plaintext table (still needed for metadata like joined_at, archived, last_read)
  // The wave_participants table stores metadata, encrypted table stores the user<->wave mapping
  if (db) {
    const now = options.joinedAt || new Date().toISOString();
    const archived = options.archived || 0;
    try {
      db.db.prepare(`
        INSERT OR IGNORE INTO wave_participants (wave_id, user_id, joined_at, archived)
        VALUES (?, ?, ?, ?)
      `).run(waveId, userId, now, archived);
    } catch (err) {
      console.error('Failed to insert into wave_participants:', err.message);
    }

    // Update encrypted blob
    updateEncryptedBlob(waveId);
  }

  return true;
}

/**
 * Remove a participant from a wave (updates both cache and DB)
 * @param {string} waveId - Wave ID
 * @param {string} userId - User ID
 * @returns {boolean} Success
 */
export function removeParticipant(waveId, userId) {
  // Update in-memory cache
  const waveParticipants = waveToParticipants.get(waveId);
  if (waveParticipants) {
    waveParticipants.delete(userId);
    if (waveParticipants.size === 0) {
      waveToParticipants.delete(waveId);
    }
  }

  const userWaves = userToWaves.get(userId);
  if (userWaves) {
    userWaves.delete(waveId);
    if (userWaves.size === 0) {
      userToWaves.delete(userId);
    }
  }

  // Clean up metadata (v2.27.0)
  deleteMetadata(waveId, userId);

  // Update plaintext table
  if (db) {
    db.db.prepare('DELETE FROM wave_participants WHERE wave_id = ? AND user_id = ?').run(waveId, userId);
    // Update encrypted blob
    updateEncryptedBlob(waveId);
  }

  return true;
}

/**
 * Get all participants in a wave (from cache)
 * @param {string} waveId - Wave ID
 * @returns {string[]} Array of user IDs
 */
export function getWaveParticipants(waveId) {
  const participants = waveToParticipants.get(waveId);
  return participants ? Array.from(participants) : [];
}

/**
 * Get all waves a user participates in (from cache)
 * @param {string} userId - User ID
 * @returns {string[]} Array of wave IDs
 */
export function getUserWaves(userId) {
  const waves = userToWaves.get(userId);
  return waves ? Array.from(waves) : [];
}

/**
 * Check if a user is a participant in a wave (from cache)
 * @param {string} waveId - Wave ID
 * @param {string} userId - User ID
 * @returns {boolean} True if participant
 */
export function isParticipant(waveId, userId) {
  const participants = waveToParticipants.get(waveId);
  return participants ? participants.has(userId) : false;
}

/**
 * Sync cache from database for a specific wave
 * Call this after database operations that create/modify participants directly
 * @param {string} waveId - Wave ID
 */
export function syncWaveFromDb(waveId) {
  if (!db) return;

  // Get current participants from database
  const rows = db.db.prepare('SELECT user_id FROM wave_participants WHERE wave_id = ?').all(waveId);
  const dbUserIds = new Set(rows.map(r => r.user_id));

  // Get current cache state
  const cachedUserIds = waveToParticipants.get(waveId) || new Set();

  // Find users to add to cache
  for (const userId of dbUserIds) {
    if (!cachedUserIds.has(userId)) {
      // Add to cache
      if (!waveToParticipants.has(waveId)) {
        waveToParticipants.set(waveId, new Set());
      }
      waveToParticipants.get(waveId).add(userId);

      if (!userToWaves.has(userId)) {
        userToWaves.set(userId, new Set());
      }
      userToWaves.get(userId).add(waveId);
    }
  }

  // Find users to remove from cache
  for (const userId of cachedUserIds) {
    if (!dbUserIds.has(userId)) {
      // Remove from cache
      waveToParticipants.get(waveId)?.delete(userId);
      userToWaves.get(userId)?.delete(waveId);

      if (userToWaves.get(userId)?.size === 0) {
        userToWaves.delete(userId);
      }
    }
  }

  if (waveToParticipants.get(waveId)?.size === 0) {
    waveToParticipants.delete(waveId);
  }

  // Update encrypted blob
  updateEncryptedBlob(waveId);
}

/**
 * Delete all participation data for a wave (when wave is deleted)
 * @param {string} waveId - Wave ID
 */
export function deleteWaveParticipation(waveId) {
  const participants = waveToParticipants.get(waveId);
  if (participants) {
    // Remove wave from each participant's userToWaves
    for (const userId of participants) {
      const userWaves = userToWaves.get(userId);
      if (userWaves) {
        userWaves.delete(waveId);
        if (userWaves.size === 0) {
          userToWaves.delete(userId);
        }
      }
    }
    // Clean up metadata for all participants (v2.27.0)
    for (const userId of participants) {
      waveUserMetadata.delete(`${waveId}:${userId}`);
    }

    waveToParticipants.delete(waveId);
  }

  // Clean up database
  if (db) {
    db.db.prepare('DELETE FROM wave_participants WHERE wave_id = ?').run(waveId);
    db.db.prepare('DELETE FROM wave_participants_encrypted WHERE wave_id = ?').run(waveId);

    // Clean up encrypted metadata
    if (PARTICIPATION_KEY) {
      // We can't easily look up HMAC keys without knowing user IDs, but we already
      // iterated participants above. Delete by computing each key.
      for (const userId of (participants || [])) {
        const lookupKey = computeMetadataKey(waveId, userId);
        db.db.prepare('DELETE FROM wave_user_metadata WHERE lookup_key = ?').run(lookupKey);
      }
    }
  }
}

/**
 * Delete all participation data for a user (when user is deleted)
 * @param {string} userId - User ID
 */
export function deleteUserParticipation(userId) {
  const waves = userToWaves.get(userId);
  if (waves) {
    // Remove user from each wave's waveToParticipants
    for (const waveId of waves) {
      const waveParticipants = waveToParticipants.get(waveId);
      if (waveParticipants) {
        waveParticipants.delete(userId);
        if (waveParticipants.size === 0) {
          waveToParticipants.delete(waveId);
        }
        // Update encrypted blob for this wave
        updateEncryptedBlob(waveId);
      }
        // Clean up metadata (v2.27.0)
        waveUserMetadata.delete(`${waveId}:${userId}`);
        if (PARTICIPATION_KEY && db) {
          const lookupKey = computeMetadataKey(waveId, userId);
          db.db.prepare('DELETE FROM wave_user_metadata WHERE lookup_key = ?').run(lookupKey);
        }
    }
    userToWaves.delete(userId);
  }

  // Clean up database
  if (db) {
    db.db.prepare('DELETE FROM wave_participants WHERE user_id = ?').run(userId);
  }
}

/**
 * Migrate existing plaintext participation data to encrypted storage
 * Called from admin endpoint
 * @returns {{success: boolean, migratedWaves: number, error?: string}}
 */
export function migrateToEncrypted() {
  if (!PARTICIPATION_KEY) {
    return { success: false, error: 'WAVE_PARTICIPATION_KEY not configured' };
  }

  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    // Get all waves with participants from plaintext table
    const waves = db.db.prepare(`
      SELECT DISTINCT wave_id FROM wave_participants
    `).all();

    let migratedWaves = 0;

    for (const { wave_id } of waves) {
      // Get participants for this wave
      const participants = db.db.prepare(`
        SELECT user_id FROM wave_participants WHERE wave_id = ?
      `).all(wave_id);

      const userIds = participants.map(p => p.user_id);

      // Encrypt and store
      const encrypted = encryptParticipants(userIds);
      if (encrypted) {
        const now = Math.floor(Date.now() / 1000);
        db.db.prepare(`
          INSERT INTO wave_participants_encrypted (wave_id, participant_blob, iv, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(wave_id) DO UPDATE SET
            participant_blob = excluded.participant_blob,
            iv = excluded.iv,
            updated_at = excluded.updated_at
        `).run(wave_id, encrypted.blob, encrypted.iv, now);
        migratedWaves++;
      }
    }

    console.log(`✅ Migrated ${migratedWaves} waves to encrypted participation storage`);
    return { success: true, migratedWaves };
  } catch (err) {
    console.error('Migration error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get statistics about the participation cache
 * @returns {{waveCount: number, userCount: number, totalMappings: number, encryptionEnabled: boolean}}
 */
export function getCacheStats() {
  let totalMappings = 0;
  for (const participants of waveToParticipants.values()) {
    totalMappings += participants.size;
  }
  const metadataCount = waveUserMetadata.size;

  return {
    waveCount: waveToParticipants.size,
    userCount: userToWaves.size,
    totalMappings,
    metadataCount,
    encryptionEnabled: !!PARTICIPATION_KEY
  };
}

/**
 * Check if encryption is enabled
 * @returns {boolean}
 */
export function isEncryptionEnabled() {
  return !!PARTICIPATION_KEY;
}

/**
 * Get metadata for a user's wave participation
 * @param {string} waveId
 * @param {string} userId
 * @returns {Object} Metadata with defaults
 */
export function getMetadata(waveId, userId) {
  const key = `${waveId}:${userId}`;
  return waveUserMetadata.get(key) || {
    archived: 0, lastRead: null, pinned: 0, hidden: 0,
    joinedAt: null, categoryId: null
  };
}

/**
 * Set metadata for a user's wave participation (updates cache + encrypted DB)
 * @param {string} waveId
 * @param {string} userId
 * @param {Object} updates - Fields to update
 */
export function setMetadata(waveId, userId, updates) {
  const key = `${waveId}:${userId}`;
  const existing = waveUserMetadata.get(key) || {
    archived: 0, lastRead: null, pinned: 0, hidden: 0,
    joinedAt: null, categoryId: null
  };
  const merged = { ...existing, ...updates };
  waveUserMetadata.set(key, merged);

  // Persist to encrypted table
  if (db) {
    const lookupKey = computeMetadataKey(waveId, userId);
    const encrypted = encryptMetadata(merged);
    if (encrypted) {
      const now = Math.floor(Date.now() / 1000);
      db.db.prepare(`
        INSERT INTO wave_user_metadata (lookup_key, encrypted_data, iv, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(lookup_key) DO UPDATE SET
          encrypted_data = excluded.encrypted_data,
          iv = excluded.iv,
          updated_at = excluded.updated_at
      `).run(lookupKey, encrypted.encrypted_data, encrypted.iv, now);
    }
  }
}

/**
 * Delete metadata for a user's wave participation
 * @param {string} waveId
 * @param {string} userId
 */
export function deleteMetadata(waveId, userId) {
  const key = `${waveId}:${userId}`;
  waveUserMetadata.delete(key);

  if (db) {
    const lookupKey = computeMetadataKey(waveId, userId);
    db.db.prepare('DELETE FROM wave_user_metadata WHERE lookup_key = ?').run(lookupKey);
  }
}

/**
 * Get all waves where user has specific metadata flags
 * @param {string} userId
 * @param {Object} filter - e.g. { hidden: 1 } or { archived: 1 }
 * @returns {string[]} Array of wave IDs matching the filter
 */
export function getWavesByMetadata(userId, filter) {
  const userWaveIds = getUserWaves(userId);
  return userWaveIds.filter(waveId => {
    const meta = getMetadata(waveId, userId);
    return Object.entries(filter).every(([k, v]) => meta[k] === v);
  });
}

/**
 * Migrate wave_participants metadata to encrypted wave_user_metadata table
 * @returns {{success: boolean, migratedCount: number, error?: string}}
 */
export function migrateMetadata() {
  if (!PARTICIPATION_KEY) {
    return { success: false, error: 'WAVE_PARTICIPATION_KEY not configured' };
  }
  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    const rows = db.db.prepare(`
      SELECT wp.wave_id, wp.user_id, wp.archived, wp.last_read, wp.pinned, wp.joined_at,
        wca.category_id
      FROM wave_participants wp
      LEFT JOIN wave_category_assignments wca ON wp.wave_id = wca.wave_id AND wp.user_id = wca.user_id
    `).all();

    let migratedCount = 0;
    for (const row of rows) {
      const metadata = {
        archived: row.archived || 0,
        lastRead: row.last_read || null,
        pinned: row.pinned || 0,
        hidden: 0,
        joinedAt: row.joined_at || null,
        categoryId: row.category_id || null,
      };

      const key = `${row.wave_id}:${row.user_id}`;
      waveUserMetadata.set(key, metadata);

      const lookupKey = computeMetadataKey(row.wave_id, row.user_id);
      const encrypted = encryptMetadata(metadata);
      if (encrypted) {
        const now = Math.floor(Date.now() / 1000);
        db.db.prepare(`
          INSERT INTO wave_user_metadata (lookup_key, encrypted_data, iv, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(lookup_key) DO UPDATE SET
            encrypted_data = excluded.encrypted_data,
            iv = excluded.iv,
            updated_at = excluded.updated_at
        `).run(lookupKey, encrypted.encrypted_data, encrypted.iv, now);
        migratedCount++;
      }
    }

    console.log(`✅ Migrated ${migratedCount} wave user metadata records to encrypted storage`);
    return { success: true, migratedCount };
  } catch (err) {
    console.error('Metadata migration error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Migrate wave_encryption_keys user_id to blinded user_key_id
 * @returns {{success: boolean, migratedCount: number, error?: string}}
 */
export function migrateWaveKeyIds() {
  if (!PARTICIPATION_KEY) {
    return { success: false, error: 'WAVE_PARTICIPATION_KEY not configured' };
  }
  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    // Check if user_key_id column exists
    const cols = db.db.prepare("PRAGMA table_info(wave_encryption_keys)").all();
    const hasUserKeyId = cols.some(c => c.name === 'user_key_id');
    if (!hasUserKeyId) {
      return { success: false, error: 'user_key_id column not found - run initializeDatabase first' };
    }

    const rows = db.db.prepare('SELECT id, user_id FROM wave_encryption_keys WHERE user_key_id IS NULL').all();
    let migratedCount = 0;

    for (const row of rows) {
      const userKeyId = computeUserKeyId(row.user_id);
      db.db.prepare('UPDATE wave_encryption_keys SET user_key_id = ? WHERE id = ?').run(userKeyId, row.id);
      migratedCount++;
    }

    console.log(`✅ Migrated ${migratedCount} wave encryption key IDs to blinded storage`);
    return { success: true, migratedCount };
  } catch (err) {
    console.error('Wave key ID migration error:', err.message);
    return { success: false, error: err.message };
  }
}

export default {
  encryptParticipants,
  decryptParticipants,
  initializeCache,
  addParticipant,
  removeParticipant,
  getWaveParticipants,
  getUserWaves,
  isParticipant,
  syncWaveFromDb,
  deleteWaveParticipation,
  deleteUserParticipation,
  migrateToEncrypted,
  getCacheStats,
  isEncryptionEnabled,
  getMetadata,
  setMetadata,
  deleteMetadata,
  getWavesByMetadata,
  migrateMetadata,
  migrateWaveKeyIds,
  computeUserKeyId,
  computeMetadataKey,
};
