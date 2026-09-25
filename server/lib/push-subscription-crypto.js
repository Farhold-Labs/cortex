/**
 * Push Subscription Encryption Module (v2.22.0)
 *
 * Encrypts push subscription data at rest so database dumps cannot correlate users to devices.
 * Uses AES-256-GCM encryption with server-side key management.
 *
 * Architecture:
 * - Database stores encrypted subscription blobs per user (keyed by user_hash)
 * - Server maintains in-memory cache for runtime operations
 * - All lookups use memory cache, writes update both cache and encrypted DB
 *
 * Key management:
 * - PUSH_SUBSCRIPTION_KEY environment variable (32-byte hex)
 * - If not set, falls back to plaintext storage (with warning)
 */

import crypto from 'crypto';
import { reportDecryptHealth } from './field-crypto-health.js';
import { v4 as uuidv4 } from 'uuid';

// Encryption key from environment
const SUBSCRIPTION_KEY = process.env.PUSH_SUBSCRIPTION_KEY || null;

// Warn if encryption is not configured
if (!SUBSCRIPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    console.error('⚠️  WARNING: PUSH_SUBSCRIPTION_KEY not set - push subscriptions will be stored in plaintext');
  } else {
    console.log('ℹ️  Push subscription encryption disabled (set PUSH_SUBSCRIPTION_KEY to enable)');
  }
}

// In-memory caches for fast lookups
// userId → subscription[] (array of {id, endpoint, keys, createdAt})
const userToSubscriptions = new Map();
// endpoint → userId (for reverse lookup during cleanup)
const endpointToUser = new Map();

// Reference to database instance (set during initialization)
let db = null;

/**
 * Hash a user ID for storage (deterministic for deduplication)
 * @param {string} userId - User ID
 * @returns {string} SHA-256 hash (hex)
 */
export function hashUserId(userId) {
  return crypto.createHash('sha256').update(userId).digest('hex');
}

/**
 * Encrypt subscription list for a user
 * @param {Object[]} subscriptions - Array of subscription objects
 * @returns {{blob: string, iv: string}|null} Encrypted data or null if encryption disabled
 */
export function encryptSubscriptions(subscriptions) {
  if (!SUBSCRIPTION_KEY) return null;

  try {
    const key = Buffer.from(SUBSCRIPTION_KEY, 'hex');
    const iv = crypto.randomBytes(12); // AES-GCM uses 12-byte IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const data = JSON.stringify(subscriptions);
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
    console.error('Push subscription encryption error:', err.message);
    return null;
  }
}

/**
 * Decrypt subscription list for a user
 * @param {string} blob - Base64 encrypted data (ciphertext + auth tag)
 * @param {string} iv - Base64 initialization vector
 * @returns {Object[]|null} Array of subscription objects or null on error
 */
export function decryptSubscriptions(blob, iv) {
  if (!SUBSCRIPTION_KEY || !blob || !iv) return null;

  try {
    const key = Buffer.from(SUBSCRIPTION_KEY, 'hex');
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
    console.error('Push subscription decryption error:', err.message);
    return null;
  }
}

/**
 * Initialize the subscription cache from database
 * Called on server startup after database initialization
 * @param {Object} database - Database instance
 * @returns {Promise<{userCount: number, subscriptionCount: number}>} Stats about loaded data
 */
export async function initializeCache(database) {
  db = database;
  userToSubscriptions.clear();
  endpointToUser.clear();

  let userCount = 0;
  let subscriptionCount = 0;

  // Check if encrypted table exists AND has data
  const encryptedTableExists = db.db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions_encrypted'
  `).get();

  const encryptedCount = encryptedTableExists
    ? db.db.prepare('SELECT COUNT(*) as count FROM push_subscriptions_encrypted').get()?.count || 0
    : 0;

  // Shared by the ordinary plaintext path and by the recovery path when the
  // encrypted rows will not open (v2.105.5). One implementation, so the two
  // cannot drift.
  function loadFromPlaintext() {
    const rows = db.db.prepare('SELECT * FROM push_subscriptions').all();
    for (const row of rows) {
      const userId = row.user_id;
      const subscription = {
        id: row.id,
        endpoint: row.endpoint,
        keys: JSON.parse(row.keys),
        createdAt: row.created_at
      };
      if (!userToSubscriptions.has(userId)) {
        userToSubscriptions.set(userId, []);
        userCount++;
      }
      userToSubscriptions.get(userId).push(subscription);
      endpointToUser.set(row.endpoint, userId);
      subscriptionCount++;
    }
  }

  if (encryptedTableExists && SUBSCRIPTION_KEY && encryptedCount > 0) {
    // Load from encrypted table (migration has been run)
    console.log('🔐 Loading encrypted push subscription data...');
    const rows = db.db.prepare('SELECT user_hash, subscriptions_blob, iv FROM push_subscriptions_encrypted').all();

    // We need to load the userId mapping from plaintext table (or we can't reverse the hash)
    // Since we store user_hash, we need to get userId from plaintext table for cache mapping
    // Strategy: Load plaintext first to get userId -> userHash mapping, then use encrypted data
    const plaintextRows = db.db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all();
    const userIdToHash = new Map();
    for (const row of plaintextRows) {
      userIdToHash.set(hashUserId(row.user_id), row.user_id);
    }

    // Rows that were matched to a user but would not open. Orphans (no plaintext
    // row) are a different thing and are not counted as decrypt failures.
    let attempted = 0;
    const unreadable = [];

    for (const row of rows) {
      const userId = userIdToHash.get(row.user_hash);
      if (!userId) {
        // Encrypted record without corresponding plaintext - skip (orphaned data)
        continue;
      }
      attempted++;

      const subscriptions = decryptSubscriptions(row.subscriptions_blob, row.iv);
      if (subscriptions && Array.isArray(subscriptions)) {
        userToSubscriptions.set(userId, subscriptions);
        userCount++;

        for (const sub of subscriptions) {
          endpointToUser.set(sub.endpoint, userId);
          subscriptionCount++;
        }
      } else {
        unreadable.push(userId);
      }
    }

    // v2.105.5 — a wrong key here means nobody gets a push notification, which
    // is the most silent failure of the three: there is nothing for a user to
    // notice except an absence.
    const health = reportDecryptHealth({
      label: 'push subscriptions',
      keyEnvVar: 'PUSH_SUBSCRIPTION_KEY',
      total: attempted,
      decrypted: userCount,
      failedKeys: unreadable,
    });

    if (health.totalFailure) {
      // Plaintext is maintained alongside the encrypted store, so recover from it
      // rather than leaving every device unreachable.
      userToSubscriptions.clear();
      endpointToUser.clear();
      userCount = 0;
      subscriptionCount = 0;
      loadFromPlaintext();
      console.log(`📂 Recovered ${userCount} user(s) with ${subscriptionCount} subscription(s) from plaintext`);
    } else {
      console.log(`✅ Loaded ${userCount} users with ${subscriptionCount} encrypted push subscriptions`);
    }
  } else {
    // Encryption not enabled, table doesn't exist, or no migration yet - load from plaintext table
    if (SUBSCRIPTION_KEY && encryptedCount === 0) {
      console.log('📂 Loading from plaintext push_subscriptions table (run migration to encrypt existing data)...');
    } else {
      console.log('📂 Loading push subscription data from plaintext table...');
    }
    loadFromPlaintext();
    console.log(`✅ Loaded ${userCount} users with ${subscriptionCount} push subscriptions into cache`);
  }

  return { userCount, subscriptionCount };
}

/**
 * Update the encrypted blob in the database for a user
 * @param {string} userId - User ID
 * @private
 */
function updateEncryptedBlob(userId) {
  if (!SUBSCRIPTION_KEY || !db) return;

  const subscriptions = userToSubscriptions.get(userId);
  const userHash = hashUserId(userId);

  if (!subscriptions || subscriptions.length === 0) {
    // No subscriptions - delete the encrypted record
    db.db.prepare('DELETE FROM push_subscriptions_encrypted WHERE user_hash = ?').run(userHash);
    return;
  }

  const encrypted = encryptSubscriptions(subscriptions);

  if (encrypted) {
    const now = Math.floor(Date.now() / 1000);
    db.db.prepare(`
      INSERT INTO push_subscriptions_encrypted (user_hash, subscriptions_blob, iv, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_hash) DO UPDATE SET
        subscriptions_blob = excluded.subscriptions_blob,
        iv = excluded.iv,
        updated_at = excluded.updated_at
    `).run(userHash, encrypted.blob, encrypted.iv, now);
  }
}

/**
 * Get all subscriptions for a user (from cache)
 * @param {string} userId - User ID
 * @returns {Object[]} Array of subscription objects
 */
export function getSubscriptions(userId) {
  const subscriptions = userToSubscriptions.get(userId);
  return subscriptions ? [...subscriptions] : [];
}

/**
 * Add a subscription for a user (updates both cache and DB)
 * @param {string} userId - User ID
 * @param {Object} subscription - Subscription object {endpoint, keys}
 * @returns {boolean} Success
 */
export function addSubscription(userId, subscription) {
  if (!db) return false;

  const id = uuidv4();
  const now = new Date().toISOString();

  const subRecord = {
    id,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    createdAt: now
  };

  // Check for existing subscription with same endpoint
  let subscriptions = userToSubscriptions.get(userId);
  if (!subscriptions) {
    subscriptions = [];
    userToSubscriptions.set(userId, subscriptions);
  }

  // Remove existing subscription with same endpoint (update case)
  const existingIndex = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
  if (existingIndex !== -1) {
    subscriptions.splice(existingIndex, 1);
  }

  // Add new subscription
  subscriptions.push(subRecord);
  endpointToUser.set(subscription.endpoint, userId);

  // Update plaintext table (still needed for metadata)
  try {
    db.db.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, keys, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, endpoint) DO UPDATE SET
        keys = excluded.keys,
        created_at = excluded.created_at
    `).run(id, userId, subscription.endpoint, JSON.stringify(subscription.keys), now);
  } catch (err) {
    console.error('Failed to insert into push_subscriptions:', err.message);
  }

  // Update encrypted blob
  updateEncryptedBlob(userId);

  return true;
}

/**
 * Remove a specific subscription for a user (updates both cache and DB)
 * @param {string} userId - User ID
 * @param {string} endpoint - Subscription endpoint
 * @returns {boolean} Success
 */
export function removeSubscription(userId, endpoint) {
  // Update in-memory cache
  const subscriptions = userToSubscriptions.get(userId);
  if (subscriptions) {
    const index = subscriptions.findIndex(s => s.endpoint === endpoint);
    if (index !== -1) {
      subscriptions.splice(index, 1);
      if (subscriptions.length === 0) {
        userToSubscriptions.delete(userId);
      }
    }
  }

  endpointToUser.delete(endpoint);

  // Update plaintext table
  if (db) {
    db.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
    // Update encrypted blob
    updateEncryptedBlob(userId);
  }

  return true;
}

/**
 * Remove all subscriptions for a user (updates both cache and DB)
 * @param {string} userId - User ID
 * @returns {boolean} Success
 */
export function removeAllSubscriptions(userId) {
  // Remove endpoints from reverse lookup
  const subscriptions = userToSubscriptions.get(userId);
  if (subscriptions) {
    for (const sub of subscriptions) {
      endpointToUser.delete(sub.endpoint);
    }
  }

  // Remove from cache
  userToSubscriptions.delete(userId);

  // Update plaintext table
  if (db) {
    db.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    // Delete encrypted blob
    const userHash = hashUserId(userId);
    db.db.prepare('DELETE FROM push_subscriptions_encrypted WHERE user_hash = ?').run(userHash);
  }

  return true;
}

/**
 * Remove a subscription by endpoint (for expired subscription cleanup)
 * Uses reverse lookup to find the user
 * @param {string} endpoint - Subscription endpoint
 * @returns {boolean} Success
 */
export function removeByEndpoint(endpoint) {
  const userId = endpointToUser.get(endpoint);
  if (!userId) {
    // Not in cache - try direct DB removal
    if (db) {
      db.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    }
    return true;
  }

  return removeSubscription(userId, endpoint);
}

/**
 * Migrate existing plaintext push subscriptions to encrypted storage
 * Called from admin endpoint
 * @returns {{success: boolean, migratedUsers: number, migratedSubscriptions: number, error?: string}}
 */
export function migrateToEncrypted() {
  if (!SUBSCRIPTION_KEY) {
    return { success: false, error: 'PUSH_SUBSCRIPTION_KEY not configured' };
  }

  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    // Get all users with push subscriptions from plaintext table
    const users = db.db.prepare(`
      SELECT DISTINCT user_id FROM push_subscriptions
    `).all();

    let migratedUsers = 0;
    let migratedSubscriptions = 0;

    for (const { user_id } of users) {
      // Get subscriptions for this user
      const subscriptions = db.db.prepare(`
        SELECT * FROM push_subscriptions WHERE user_id = ?
      `).all(user_id);

      const subRecords = subscriptions.map(s => ({
        id: s.id,
        endpoint: s.endpoint,
        keys: JSON.parse(s.keys),
        createdAt: s.created_at
      }));

      // Encrypt and store
      const encrypted = encryptSubscriptions(subRecords);
      if (encrypted) {
        const userHash = hashUserId(user_id);
        const now = Math.floor(Date.now() / 1000);
        db.db.prepare(`
          INSERT INTO push_subscriptions_encrypted (user_hash, subscriptions_blob, iv, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_hash) DO UPDATE SET
            subscriptions_blob = excluded.subscriptions_blob,
            iv = excluded.iv,
            updated_at = excluded.updated_at
        `).run(userHash, encrypted.blob, encrypted.iv, now);
        migratedUsers++;
        migratedSubscriptions += subRecords.length;
      }
    }

    console.log(`✅ Migrated ${migratedUsers} users with ${migratedSubscriptions} push subscriptions to encrypted storage`);
    return { success: true, migratedUsers, migratedSubscriptions };
  } catch (err) {
    console.error('Migration error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get statistics about the subscription cache
 * @returns {{userCount: number, subscriptionCount: number, encryptionEnabled: boolean}}
 */
export function getStats() {
  let subscriptionCount = 0;
  for (const subscriptions of userToSubscriptions.values()) {
    subscriptionCount += subscriptions.length;
  }

  return {
    userCount: userToSubscriptions.size,
    subscriptionCount,
    encryptionEnabled: !!SUBSCRIPTION_KEY
  };
}

/**
 * Check if encryption is enabled
 * @returns {boolean}
 */
export function isEncryptionEnabled() {
  return !!SUBSCRIPTION_KEY;
}

export default {
  hashUserId,
  encryptSubscriptions,
  decryptSubscriptions,
  initializeCache,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  removeAllSubscriptions,
  removeByEndpoint,
  migrateToEncrypted,
  getStats,
  isEncryptionEnabled
};
