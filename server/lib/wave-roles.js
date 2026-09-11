/**
 * Per-wave roles (v2.88.0)
 *
 * Answers "is this user staff of THIS wave", as distinct from the instance-wide
 * ROLES ladder in server.js. Before this, an announcement wave could only be
 * posted to by its creator or an instance moderator — so delegating one wave
 * meant handing someone moderator powers over the entire node.
 *
 * Ladder: owner (waves.created_by) > admin > moderator. The owner is implicit
 * and never stored here; it is already a column on the wave.
 *
 *   admin      manages the wave — settings, appointments, invites, pin,
 *              delete any ping
 *   moderator  polices it — post in an announcement wave, pin, delete pings
 *
 * Only the owner deletes the wave or transfers ownership.
 *
 * WHY A SEPARATE TABLE, NOT A COLUMN ON wave_participants
 * Public and Verse-Wide waves have no participant rows at all — everyone on the
 * node can see them without one. That is exactly the trap `wave_mutes` hit in
 * v2.84.0. Announcement waves are very often public, so a column on
 * wave_participants would fail in the main case this feature exists for.
 *
 * WHY THE BLOB IS ENCRYPTED
 * wave_participants_encrypted exists so that "a database dump cannot reveal
 * social graphs". A plaintext (wave_id, user_id, role) table would hand back a
 * slice of precisely that graph — arguably the most interesting slice, since it
 * names the people who matter in each wave. So roles live in an encrypted blob
 * per wave under the same WAVE_PARTICIPATION_KEY, and fall back to plaintext
 * with a warning when that key is unset, matching participation exactly.
 *
 * NOT FEDERATED, DELIBERATELY
 * User IDs are node-local: a moderator here is nobody on an allied port. Unlike
 * the announcement flags in v2.83.1 — which travel and treat the origin as
 * authoritative — roles cannot follow a wave across nodes. Each port keeps its
 * own staff for its own copy.
 */
import crypto from 'crypto';

const PARTICIPATION_KEY = process.env.WAVE_PARTICIPATION_KEY || null;

export const WAVE_ROLES = { ADMIN: 'admin', MODERATOR: 'moderator' };
export const WAVE_ROLE_VALUES = Object.values(WAVE_ROLES);

// Rank for comparisons. Owner outranks everything stored here.
const RANK = { owner: 3, admin: 2, moderator: 1 };

let db = null;

// waveId → { userId: role }. Populated lazily and dropped on write. Role checks
// sit on write paths (post, pin, delete, settings), which are far rarer than
// the routing lookups participation caches for, so lazy is enough.
const cache = new Map();

export function initialize(database) {
  db = database;
  cache.clear();
}

export function encryptRoles(roleMap) {
  if (!PARTICIPATION_KEY) return null;
  try {
    const key = Buffer.from(PARTICIPATION_KEY, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(JSON.stringify(roleMap), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const combined = Buffer.concat([Buffer.from(encrypted, 'base64'), cipher.getAuthTag()]).toString('base64');
    return { blob: combined, iv: iv.toString('base64') };
  } catch (err) {
    console.error('Wave role encryption error:', err.message);
    return null;
  }
}

export function decryptRoles(blob, iv) {
  if (!PARTICIPATION_KEY || !blob || !iv) return null;
  try {
    const key = Buffer.from(PARTICIPATION_KEY, 'hex');
    const combined = Buffer.from(blob, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(combined.slice(-16));
    let decrypted = decipher.update(combined.slice(0, -16).toString('base64'), 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error('Wave role decryption error:', err.message);
    return null;
  }
}

/** { userId: role } for one wave. Never includes the owner. */
export function getWaveRoles(waveId) {
  if (!waveId || !db) return {};
  if (cache.has(waveId)) return cache.get(waveId);

  let roles = {};
  try {
    const row = db.getWaveRolesRow?.(waveId);
    if (row) {
      // A row written while the key was unset stores plaintext JSON in `blob`
      // with an empty `iv`; decryptRoles returns null for that, so fall through
      // rather than silently reporting "no staff" and quietly dropping powers.
      const decrypted = row.iv ? decryptRoles(row.blob, row.iv) : null;
      if (decrypted) roles = decrypted;
      else if (!row.iv) { try { roles = JSON.parse(row.blob) || {}; } catch { roles = {}; } }
    }
  } catch (err) {
    console.error('getWaveRoles error:', err.message);
    return {};
  }
  cache.set(waveId, roles);
  return roles;
}

function persist(waveId, roles) {
  const encrypted = encryptRoles(roles);
  if (encrypted) db.setWaveRolesRow(waveId, encrypted.blob, encrypted.iv);
  else db.setWaveRolesRow(waveId, JSON.stringify(roles), '');
  cache.set(waveId, roles);
}

/** Returns 'admin' | 'moderator' | null. Owner is resolved by the caller. */
export function getStoredRole(waveId, userId) {
  if (!waveId || !userId) return null;
  const role = getWaveRoles(waveId)[userId];
  return WAVE_ROLE_VALUES.includes(role) ? role : null;
}

export function setWaveRole(waveId, userId, role) {
  if (!WAVE_ROLE_VALUES.includes(role)) throw new Error(`Invalid wave role: ${role}`);
  const roles = { ...getWaveRoles(waveId) };
  roles[userId] = role;
  persist(waveId, roles);
  return roles;
}

export function removeWaveRole(waveId, userId) {
  const roles = { ...getWaveRoles(waveId) };
  if (!(userId in roles)) return roles;
  delete roles[userId];
  persist(waveId, roles);
  return roles;
}

export function deleteWaveRoles(waveId) {
  cache.delete(waveId);
  try { db?.deleteWaveRolesRow?.(waveId); } catch (err) { console.error('deleteWaveRoles error:', err.message); }
}

export function invalidate(waveId) {
  if (waveId) cache.delete(waveId); else cache.clear();
}

export function rankOf(role) {
  return RANK[role] || 0;
}

/** True when `role` is at least `required` on the owner > admin > moderator ladder. */
export function atLeast(role, required) {
  return rankOf(role) >= rankOf(required);
}
