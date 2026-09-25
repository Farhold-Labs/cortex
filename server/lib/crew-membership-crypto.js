/**
 * Crew Membership Encryption Module (v2.24.0)
 *
 * Encrypts crew membership data at rest so database dumps cannot reveal group associations.
 * Uses AES-256-GCM encryption with server-side key management.
 *
 * Architecture:
 * - Database stores encrypted member blobs per crew
 * - Server maintains in-memory cache for runtime operations
 * - All routing, access control, and notifications use the memory cache
 * - Plaintext crew_members table kept for metadata (role, joined_at)
 *
 * Key management:
 * - CREW_MEMBERSHIP_KEY environment variable (32-byte hex)
 * - If not set, falls back to plaintext storage (with warning)
 */

import crypto from 'crypto';
import { reportDecryptHealth } from './field-crypto-health.js';

// Encryption key from environment
const MEMBERSHIP_KEY = process.env.CREW_MEMBERSHIP_KEY || null;

// Warn if encryption is not configured
if (!MEMBERSHIP_KEY) {
  if (process.env.NODE_ENV === 'production') {
    console.error('WARNING: CREW_MEMBERSHIP_KEY not set - crew membership data will be stored in plaintext');
  } else {
    console.log('Crew membership encryption disabled (set CREW_MEMBERSHIP_KEY to enable)');
  }
}

// In-memory caches for fast lookups
// crewId -> Set<userId>
const crewToMembers = new Map();
// userId -> Set<crewId>
const userToCrews = new Map();

// Reference to database instance (set during initialization)
let db = null;

/**
 * Encrypt member list for a crew
 * @param {string[]} userIds - Array of user IDs
 * @returns {{blob: string, iv: string}|null} Encrypted data or null if encryption disabled
 */
export function encryptMembers(userIds) {
  if (!MEMBERSHIP_KEY) return null;

  try {
    const key = Buffer.from(MEMBERSHIP_KEY, 'hex');
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
    console.error('Crew membership encryption error:', err.message);
    return null;
  }
}

/**
 * Decrypt member list for a crew
 * @param {string} blob - Base64 encrypted data (ciphertext + auth tag)
 * @param {string} iv - Base64 initialization vector
 * @returns {string[]|null} Array of user IDs or null on error
 */
export function decryptMembers(blob, iv) {
  if (!MEMBERSHIP_KEY || !blob || !iv) return null;

  try {
    const key = Buffer.from(MEMBERSHIP_KEY, 'hex');
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
    console.error('Crew membership decryption error:', err.message);
    return null;
  }
}

/**
 * Initialize the membership cache from database
 * Called on server startup after database initialization
 * @param {Object} database - Database instance with access to encrypted membership data
 * @returns {Promise<{crewCount: number, memberCount: number}>} Stats about loaded data
 */
export async function initializeCache(database) {
  db = database;
  crewToMembers.clear();
  userToCrews.clear();

  let crewCount = 0;
  let memberCount = 0;

  // Check if encrypted table exists AND has data
  const encryptedTableExists = db.db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='crew_members_encrypted'
  `).get();

  const encryptedCount = encryptedTableExists
    ? db.db.prepare('SELECT COUNT(*) as count FROM crew_members_encrypted').get()?.count || 0
    : 0;

  if (encryptedTableExists && MEMBERSHIP_KEY && encryptedCount > 0) {
    // Load from encrypted table (migration has been run)
    console.log('Loading encrypted crew membership data...');
    const rows = db.db.prepare('SELECT crew_id, member_blob, iv FROM crew_members_encrypted').all();

    for (const row of rows) {
      const userIds = decryptMembers(row.member_blob, row.iv);
      if (userIds && Array.isArray(userIds)) {
        crewToMembers.set(row.crew_id, new Set(userIds));
        crewCount++;

        for (const userId of userIds) {
          if (!userToCrews.has(userId)) {
            userToCrews.set(userId, new Set());
          }
          userToCrews.get(userId).add(row.crew_id);
          memberCount++;
        }
      }
    }

    console.log(`Loaded ${crewCount} encrypted crews with ${memberCount} member mappings`);

    // Say so when the key does not fit (v2.105.5). The backfill below already
    // repairs this from plaintext, which is why a rotated key never broke crews
    // the way it broke wave participation — but it repaired it *silently*, so an
    // operator with the wrong key had no way to know. A self-healing failure is
    // still a failure worth reporting.
    reportDecryptHealth({
      label: 'crew membership',
      keyEnvVar: 'CREW_MEMBERSHIP_KEY',
      total: rows.length,
      decrypted: crewCount,
      failedKeys: rows.filter(r => !crewToMembers.has(r.crew_id)).map(r => r.crew_id),
    });

    // Backfill: check plaintext table for members missing from encrypted table
    // This handles crews created by db.createGroup() before the cache sync fix
    const plaintextRows = db.db.prepare('SELECT crew_id, user_id FROM crew_members').all();
    let backfilled = 0;
    for (const row of plaintextRows) {
      const members = crewToMembers.get(row.crew_id);
      if (!members || !members.has(row.user_id)) {
        if (!crewToMembers.has(row.crew_id)) {
          crewToMembers.set(row.crew_id, new Set());
        }
        crewToMembers.get(row.crew_id).add(row.user_id);
        if (!userToCrews.has(row.user_id)) {
          userToCrews.set(row.user_id, new Set());
        }
        userToCrews.get(row.user_id).add(row.crew_id);
        backfilled++;
      }
    }
    if (backfilled > 0) {
      console.log(`Backfilled ${backfilled} members from plaintext table into cache`);
      // Persist backfilled data to encrypted table
      for (const [crewId, members] of crewToMembers) {
        updateEncryptedBlob(crewId);
      }
    }
  } else {
    // Encryption not enabled, table doesn't exist, or no migration yet - load from plaintext table
    if (MEMBERSHIP_KEY && encryptedCount === 0) {
      console.log('Loading from plaintext table (run migration to encrypt existing data)...');
    } else {
      console.log('Loading crew membership data from plaintext table...');
    }
    const rows = db.db.prepare('SELECT crew_id, user_id FROM crew_members').all();

    for (const row of rows) {
      // Build crewToMembers
      if (!crewToMembers.has(row.crew_id)) {
        crewToMembers.set(row.crew_id, new Set());
        crewCount++;
      }
      crewToMembers.get(row.crew_id).add(row.user_id);

      // Build userToCrews
      if (!userToCrews.has(row.user_id)) {
        userToCrews.set(row.user_id, new Set());
      }
      userToCrews.get(row.user_id).add(row.crew_id);
      memberCount++;
    }

    console.log(`Loaded ${crewCount} crews with ${memberCount} member mappings into cache`);
  }

  return { crewCount, memberCount };
}

/**
 * Update the encrypted blob in the database for a crew
 * @param {string} crewId - Crew ID
 * @private
 */
function updateEncryptedBlob(crewId) {
  if (!MEMBERSHIP_KEY || !db) return;

  const members = crewToMembers.get(crewId);
  if (!members || members.size === 0) {
    // No members - delete the encrypted record
    db.db.prepare('DELETE FROM crew_members_encrypted WHERE crew_id = ?').run(crewId);
    return;
  }

  const userIds = Array.from(members);
  const encrypted = encryptMembers(userIds);

  if (encrypted) {
    const now = Math.floor(Date.now() / 1000);
    db.db.prepare(`
      INSERT INTO crew_members_encrypted (crew_id, member_blob, iv, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(crew_id) DO UPDATE SET
        member_blob = excluded.member_blob,
        iv = excluded.iv,
        updated_at = excluded.updated_at
    `).run(crewId, encrypted.blob, encrypted.iv, now);
  }
}

/**
 * Add a member to a crew (updates both cache and DB)
 * @param {string} crewId - Crew ID
 * @param {string} userId - User ID
 * @param {string} role - Member role (default: 'member')
 * @returns {boolean} Success (false if already a member)
 */
export function addMember(crewId, userId, role = 'member') {
  // Check if already a member
  if (crewToMembers.has(crewId) && crewToMembers.get(crewId).has(userId)) {
    console.log(`User ${userId} is already a member of crew ${crewId}`);
    return false;
  }

  // Update in-memory cache
  if (!crewToMembers.has(crewId)) {
    crewToMembers.set(crewId, new Set());
  }
  crewToMembers.get(crewId).add(userId);

  if (!userToCrews.has(userId)) {
    userToCrews.set(userId, new Set());
  }
  userToCrews.get(userId).add(crewId);

  // Update plaintext table (still needed for metadata like role, joined_at)
  if (db) {
    const now = new Date().toISOString();
    try {
      db.db.prepare(`
        INSERT OR IGNORE INTO crew_members (crew_id, user_id, role, joined_at)
        VALUES (?, ?, ?, ?)
      `).run(crewId, userId, role, now);
      console.log(`Added user ${userId} to crew ${crewId} as ${role}`);
    } catch (err) {
      console.error('Failed to insert into crew_members:', err.message);
      return false;
    }

    // Update encrypted blob
    updateEncryptedBlob(crewId);
  }

  return true;
}

/**
 * Remove a member from a crew (updates both cache and DB)
 * @param {string} crewId - Crew ID
 * @param {string} userId - User ID
 * @returns {boolean} Success
 */
export function removeMember(crewId, userId) {
  // Update in-memory cache
  const crewMembers = crewToMembers.get(crewId);
  if (crewMembers) {
    crewMembers.delete(userId);
    if (crewMembers.size === 0) {
      crewToMembers.delete(crewId);
    }
  }

  const userCrews = userToCrews.get(userId);
  if (userCrews) {
    userCrews.delete(crewId);
    if (userCrews.size === 0) {
      userToCrews.delete(userId);
    }
  }

  // Update plaintext table
  if (db) {
    const result = db.db.prepare('DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?').run(crewId, userId);
    if (result.changes === 0) return false;

    // Also remove from group wave participants (existing behavior)
    db.db.prepare(`
      DELETE FROM wave_participants
      WHERE user_id = ? AND wave_id IN (
        SELECT id FROM waves WHERE (privacy = 'crew' OR privacy = 'group') AND crew_id = ?
      )
    `).run(userId, crewId);

    // Update encrypted blob
    updateEncryptedBlob(crewId);
  }

  return true;
}

/**
 * Get all members in a crew (from cache)
 * @param {string} crewId - Crew ID
 * @returns {Set<string>} Set of user IDs
 */
export function getCrewMembers(crewId) {
  return crewToMembers.get(crewId) || new Set();
}

/**
 * Get all crews a user belongs to (from cache)
 * @param {string} userId - User ID
 * @returns {Set<string>} Set of crew IDs
 */
export function getCrewsForUser(userId) {
  return userToCrews.get(userId) || new Set();
}

/**
 * Check if a user is a member of a crew (from cache)
 * @param {string} crewId - Crew ID
 * @param {string} userId - User ID
 * @returns {boolean} True if member
 */
export function isMember(crewId, userId) {
  const members = crewToMembers.get(crewId);
  return members ? members.has(userId) : false;
}

/**
 * Delete all membership data for a crew (when crew is deleted)
 * @param {string} crewId - Crew ID
 */
export function deleteCrewMembership(crewId) {
  const members = crewToMembers.get(crewId);
  if (members) {
    // Remove crew from each member's userToCrews
    for (const userId of members) {
      const userCrews = userToCrews.get(userId);
      if (userCrews) {
        userCrews.delete(crewId);
        if (userCrews.size === 0) {
          userToCrews.delete(userId);
        }
      }
    }
    crewToMembers.delete(crewId);
  }

  // Clean up database
  if (db) {
    db.db.prepare('DELETE FROM crew_members WHERE crew_id = ?').run(crewId);
    db.db.prepare('DELETE FROM crew_members_encrypted WHERE crew_id = ?').run(crewId);
  }
}

/**
 * Delete all membership data for a user (when user is deleted)
 * @param {string} userId - User ID
 */
export function deleteUserMembership(userId) {
  const crews = userToCrews.get(userId);
  if (crews) {
    // Remove user from each crew's crewToMembers
    for (const crewId of crews) {
      const crewMembers = crewToMembers.get(crewId);
      if (crewMembers) {
        crewMembers.delete(userId);
        if (crewMembers.size === 0) {
          crewToMembers.delete(crewId);
        }
        // Update encrypted blob for this crew
        updateEncryptedBlob(crewId);
      }
    }
    userToCrews.delete(userId);
  }

  // Clean up database
  if (db) {
    db.db.prepare('DELETE FROM crew_members WHERE user_id = ?').run(userId);
  }
}

/**
 * Migrate existing plaintext membership data to encrypted storage
 * Called from admin endpoint
 * @returns {{success: boolean, migratedCrews: number, error?: string}}
 */
export function migrateToEncrypted() {
  if (!MEMBERSHIP_KEY) {
    return { success: false, error: 'CREW_MEMBERSHIP_KEY not configured' };
  }

  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    // Get all crews with members from plaintext table
    const crews = db.db.prepare(`
      SELECT DISTINCT crew_id FROM crew_members
    `).all();

    let migratedCrews = 0;

    for (const { crew_id } of crews) {
      // Get members for this crew
      const members = db.db.prepare(`
        SELECT user_id FROM crew_members WHERE crew_id = ?
      `).all(crew_id);

      const userIds = members.map(m => m.user_id);

      // Encrypt and store
      const encrypted = encryptMembers(userIds);
      if (encrypted) {
        const now = Math.floor(Date.now() / 1000);
        db.db.prepare(`
          INSERT INTO crew_members_encrypted (crew_id, member_blob, iv, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(crew_id) DO UPDATE SET
            member_blob = excluded.member_blob,
            iv = excluded.iv,
            updated_at = excluded.updated_at
        `).run(crew_id, encrypted.blob, encrypted.iv, now);
        migratedCrews++;
      }
    }

    console.log(`Migrated ${migratedCrews} crews to encrypted membership storage`);
    return { success: true, migratedCrews };
  } catch (err) {
    console.error('Migration error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get statistics about the membership cache
 * @returns {{crewCount: number, userCount: number, totalMappings: number, encryptionEnabled: boolean}}
 */
export function getCacheStats() {
  let totalMappings = 0;
  for (const members of crewToMembers.values()) {
    totalMappings += members.size;
  }

  return {
    crewCount: crewToMembers.size,
    userCount: userToCrews.size,
    totalMappings,
    encryptionEnabled: !!MEMBERSHIP_KEY
  };
}

/**
 * Check if encryption is enabled
 * @returns {boolean}
 */
export function isEncryptionEnabled() {
  return !!MEMBERSHIP_KEY;
}

export default {
  encryptMembers,
  decryptMembers,
  initializeCache,
  addMember,
  removeMember,
  getCrewMembers,
  getCrewsForUser,
  isMember,
  deleteCrewMembership,
  deleteUserMembership,
  migrateToEncrypted,
  getCacheStats,
  isEncryptionEnabled
};
