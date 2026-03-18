#!/usr/bin/env node
/**
 * Cortex JSON to SQLite Migration Script
 * Version: 1.10.0 (Droplets Architecture)
 *
 * This script migrates data from JSON files to SQLite database.
 * Supports both legacy messages.json and v1.10.0 droplets.json files.
 *
 * Usage: node migrate-json-to-sqlite.js [--dry-run] [--no-backup]
 *
 * Options:
 *   --dry-run    Show what would be migrated without making changes
 *   --no-backup  Skip backing up JSON files
 *
 * v1.10.0 Changes:
 *   - Migrates messages.json OR droplets.json to droplets table
 *   - Includes burst fields: broken_out_to, original_wave_id
 *   - Includes wave burst fields: root_droplet_id, broken_out_from, breakout_chain
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'cortex.db');
const BACKUP_DIR = path.join(DATA_DIR, 'json-backup');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const DATA_FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  waves: path.join(DATA_DIR, 'waves.json'),
  droplets: path.join(DATA_DIR, 'droplets.json'),
  messages: path.join(DATA_DIR, 'messages.json'), // Legacy fallback
  groups: path.join(DATA_DIR, 'groups.json'),
  handleRequests: path.join(DATA_DIR, 'handle-requests.json'),
  reports: path.join(DATA_DIR, 'reports.json'),
  moderation: path.join(DATA_DIR, 'moderation.json'),
  contactRequests: path.join(DATA_DIR, 'contact-requests.json'),
  groupInvitations: path.join(DATA_DIR, 'group-invitations.json'),
};

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_BACKUP = args.includes('--no-backup');

console.log('='.repeat(60));
console.log('Cortex JSON to SQLite Migration');
console.log('='.repeat(60));
if (DRY_RUN) console.log('MODE: Dry run (no changes will be made)\n');

// Helper to load JSON file
function loadJson(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (err) {
    console.error(`Failed to load ${filepath}:`, err.message);
  }
  return null;
}

// Helper to count records
function countRecords(data, ...keys) {
  let count = 0;
  for (const key of keys) {
    if (data && Array.isArray(data[key])) {
      count += data[key].length;
    }
  }
  return count;
}

// Main migration function
async function migrate() {
  // Step 1: Check if JSON files exist
  console.log('Step 1: Checking JSON files...');
  const existingFiles = [];
  for (const [name, filepath] of Object.entries(DATA_FILES)) {
    if (fs.existsSync(filepath)) {
      existingFiles.push(name);
      console.log(`  [OK] ${name}.json`);
    } else {
      console.log(`  [SKIP] ${name}.json (not found)`);
    }
  }

  if (existingFiles.length === 0) {
    console.log('\nNo JSON files found to migrate.');
    return;
  }

  // Step 2: Load all JSON data
  console.log('\nStep 2: Loading JSON data...');

  // Load droplets (v1.10.0) or fall back to messages (legacy)
  let dropletsData = loadJson(DATA_FILES.droplets);
  if (!dropletsData && fs.existsSync(DATA_FILES.messages)) {
    console.log('  Note: Using legacy messages.json (will migrate to droplets table)');
    const messagesData = loadJson(DATA_FILES.messages) || { messages: [], history: [] };
    dropletsData = { droplets: messagesData.messages || [], history: messagesData.history || [] };
  }
  dropletsData = dropletsData || { droplets: [], history: [] };

  const data = {
    users: loadJson(DATA_FILES.users) || { users: [], contacts: [] },
    waves: loadJson(DATA_FILES.waves) || { waves: [], participants: [] },
    droplets: dropletsData,
    groups: loadJson(DATA_FILES.groups) || { groups: [], members: [] },
    handleRequests: loadJson(DATA_FILES.handleRequests) || { requests: [] },
    reports: loadJson(DATA_FILES.reports) || { reports: [] },
    moderation: loadJson(DATA_FILES.moderation) || { blocks: [], mutes: [] },
    contactRequests: loadJson(DATA_FILES.contactRequests) || { requests: [] },
    groupInvitations: loadJson(DATA_FILES.groupInvitations) || { invitations: [] },
  };

  // Show statistics
  console.log('\n  Records to migrate:');
  console.log(`    Users: ${data.users.users?.length || 0}`);
  console.log(`    Contacts: ${data.users.contacts?.length || 0}`);
  console.log(`    Waves: ${data.waves.waves?.length || 0}`);
  console.log(`    Wave Participants: ${data.waves.participants?.length || 0}`);
  console.log(`    Droplets: ${data.droplets.droplets?.length || 0}`);
  console.log(`    Droplet History: ${data.droplets.history?.length || 0}`);
  console.log(`    Groups: ${data.groups.groups?.length || 0}`);
  console.log(`    Group Members: ${data.groups.members?.length || 0}`);
  console.log(`    Handle Requests: ${data.handleRequests.requests?.length || 0}`);
  console.log(`    Contact Requests: ${data.contactRequests.requests?.length || 0}`);
  console.log(`    Group Invitations: ${data.groupInvitations.invitations?.length || 0}`);
  console.log(`    Blocks: ${data.moderation.blocks?.length || 0}`);
  console.log(`    Mutes: ${data.moderation.mutes?.length || 0}`);
  console.log(`    Reports: ${data.reports.reports?.length || 0}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would migrate the above records.');
    console.log('[DRY RUN] Exiting without making changes.');
    return;
  }

  // Step 3: Backup JSON files
  if (!NO_BACKUP) {
    console.log('\nStep 3: Backing up JSON files...');
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    for (const [name, filepath] of Object.entries(DATA_FILES)) {
      if (fs.existsSync(filepath)) {
        const backupPath = path.join(BACKUP_DIR, `${name}.json`);
        fs.copyFileSync(filepath, backupPath);
        console.log(`  Backed up ${name}.json`);
      }
    }
    console.log(`  Backups saved to: ${BACKUP_DIR}`);
  }

  // Step 4: Create SQLite database
  console.log('\nStep 4: Creating SQLite database...');

  // Remove existing database if present
  if (fs.existsSync(DB_PATH)) {
    console.log('  Removing existing database...');
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load and execute schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  console.log('  Schema created successfully');

  // Step 5: Migrate data
  console.log('\nStep 5: Migrating data...');

  // Use transactions for performance
  const migrateTx = db.transaction(() => {
    // 5.1 Migrate users
    console.log('  Migrating users...');
    const insertUser = db.prepare(`
      INSERT INTO users (id, handle, email, password_hash, display_name, avatar, avatar_url, bio, node_name, status, is_admin, created_at, last_seen, last_handle_change, preferences)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertHandleHistory = db.prepare(`
      INSERT INTO handle_history (user_id, old_handle, changed_at) VALUES (?, ?, ?)
    `);

    for (const user of (data.users.users || [])) {
      insertUser.run(
        user.id,
        user.handle,
        user.email,
        user.passwordHash,
        user.displayName,
        user.avatar || '?',
        user.avatarUrl || null,
        user.bio || null,
        user.nodeName || 'Local',
        user.status || 'offline',
        user.isAdmin ? 1 : 0,
        user.createdAt,
        user.lastSeen || null,
        user.lastHandleChange || null,
        JSON.stringify(user.preferences || { theme: 'firefly', fontSize: 'medium' })
      );

      // Migrate handle history
      if (user.handleHistory && Array.isArray(user.handleHistory)) {
        for (const h of user.handleHistory) {
          // Skip entries without changedAt
          if (h.handle && h.changedAt) {
            insertHandleHistory.run(user.id, h.handle, h.changedAt);
          }
        }
      }
    }
    console.log(`    Migrated ${data.users.users?.length || 0} users`);

    // 5.2 Migrate contacts
    console.log('  Migrating contacts...');
    const insertContact = db.prepare(`
      INSERT OR IGNORE INTO contacts (user_id, contact_id, added_at) VALUES (?, ?, ?)
    `);
    for (const c of (data.users.contacts || [])) {
      insertContact.run(c.userId, c.contactId, c.addedAt);
    }
    console.log(`    Migrated ${data.users.contacts?.length || 0} contacts`);

    // 5.3 Migrate groups (before waves due to foreign key)
    console.log('  Migrating groups...');
    const insertGroup = db.prepare(`
      INSERT INTO groups (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)
    `);
    for (const g of (data.groups.groups || [])) {
      insertGroup.run(g.id, g.name, g.description || '', g.createdBy, g.createdAt);
    }
    console.log(`    Migrated ${data.groups.groups?.length || 0} groups`);

    // 5.4 Migrate group members
    console.log('  Migrating group members...');
    const insertGroupMember = db.prepare(`
      INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
    `);
    for (const m of (data.groups.members || [])) {
      insertGroupMember.run(m.groupId, m.userId, m.role, m.joinedAt);
    }
    console.log(`    Migrated ${data.groups.members?.length || 0} group members`);

    // 5.5 Migrate waves (v1.10.0: includes burst/breakout fields)
    // Note: Insert waves without root_droplet_id first due to circular FK dependency
    // We'll update root_droplet_id after droplets are inserted
    console.log('  Migrating waves...');
    const insertWave = db.prepare(`
      INSERT INTO waves (id, title, privacy, group_id, created_by, created_at, updated_at, broken_out_from, breakout_chain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const wavesWithRootDroplet = [];
    for (const w of (data.waves.waves || [])) {
      insertWave.run(
        w.id,
        w.title,
        w.privacy,
        w.groupId || null,
        w.createdBy,
        w.createdAt,
        w.updatedAt,
        w.brokenOutFrom || null,
        w.breakoutChain ? JSON.stringify(w.breakoutChain) : null
      );
      // Track waves that need root_droplet_id updated after droplets are inserted
      if (w.rootDropletId) {
        wavesWithRootDroplet.push({ waveId: w.id, rootDropletId: w.rootDropletId });
      }
    }
    console.log(`    Migrated ${data.waves.waves?.length || 0} waves`);

    // 5.6 Migrate wave participants
    console.log('  Migrating wave participants...');
    const insertParticipant = db.prepare(`
      INSERT OR IGNORE INTO wave_participants (wave_id, user_id, joined_at, archived, last_read) VALUES (?, ?, ?, ?, ?)
    `);
    for (const p of (data.waves.participants || [])) {
      insertParticipant.run(p.waveId, p.userId, p.joinedAt, p.archived ? 1 : 0, p.lastRead || null);
    }
    console.log(`    Migrated ${data.waves.participants?.length || 0} wave participants`);

    // 5.7 Migrate droplets (v1.10.0: renamed from messages, includes burst fields)
    console.log('  Migrating droplets...');
    const insertDroplet = db.prepare(`
      INSERT INTO droplets (id, wave_id, parent_id, author_id, content, privacy, version, created_at, edited_at, deleted, deleted_at, reactions, broken_out_to, original_wave_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertReadBy = db.prepare(`
      INSERT OR IGNORE INTO droplet_read_by (droplet_id, user_id, read_at) VALUES (?, ?, ?)
    `);

    for (const d of (data.droplets.droplets || [])) {
      insertDroplet.run(
        d.id,
        d.waveId,
        d.parentId || null,
        d.authorId,
        d.content,
        d.privacy || 'private',
        d.version || 1,
        d.createdAt,
        d.editedAt || null,
        d.deleted ? 1 : 0,
        d.deletedAt || null,
        JSON.stringify(d.reactions || {}),
        d.brokenOutTo || null,
        d.originalWaveId || null
      );

      // Migrate readBy array to droplet_read_by table
      const readBy = d.readBy || [d.authorId];
      for (const userId of readBy) {
        if (userId) {
          insertReadBy.run(d.id, userId, d.createdAt); // Use droplet creation time as read time
        }
      }
    }
    console.log(`    Migrated ${data.droplets.droplets?.length || 0} droplets`);

    // 5.7b Update waves with root_droplet_id (now that droplets exist)
    if (wavesWithRootDroplet.length > 0) {
      console.log('  Updating wave root_droplet_id references...');
      const updateWaveRootDroplet = db.prepare(`
        UPDATE waves SET root_droplet_id = ? WHERE id = ?
      `);
      for (const { waveId, rootDropletId } of wavesWithRootDroplet) {
        updateWaveRootDroplet.run(rootDropletId, waveId);
      }
      console.log(`    Updated ${wavesWithRootDroplet.length} waves with root_droplet_id`);
    }

    // 5.8 Migrate droplet history
    console.log('  Migrating droplet history...');
    const insertHistory = db.prepare(`
      INSERT INTO droplet_history (id, droplet_id, content, version, edited_at) VALUES (?, ?, ?, ?, ?)
    `);
    for (const h of (data.droplets.history || [])) {
      // Handle both old (messageId) and new (dropletId) field names
      const dropletId = h.dropletId || h.messageId;
      insertHistory.run(h.id, dropletId, h.content, h.version, h.editedAt);
    }
    console.log(`    Migrated ${data.droplets.history?.length || 0} history entries`);

    // 5.9 Migrate handle requests
    console.log('  Migrating handle requests...');
    const insertHandleRequest = db.prepare(`
      INSERT INTO handle_requests (id, user_id, current_handle, new_handle, status, reason, created_at, processed_at, processed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of (data.handleRequests.requests || [])) {
      insertHandleRequest.run(
        r.id, r.userId, r.currentHandle, r.newHandle, r.status,
        r.reason || null, r.createdAt, r.processedAt || null, r.processedBy || null
      );
    }
    console.log(`    Migrated ${data.handleRequests.requests?.length || 0} handle requests`);

    // 5.10 Migrate contact requests
    console.log('  Migrating contact requests...');
    const insertContactRequest = db.prepare(`
      INSERT INTO contact_requests (id, from_user_id, to_user_id, message, status, created_at, responded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of (data.contactRequests.requests || [])) {
      insertContactRequest.run(
        r.id, r.from_user_id, r.to_user_id, r.message || null,
        r.status, r.created_at, r.responded_at || null
      );
    }
    console.log(`    Migrated ${data.contactRequests.requests?.length || 0} contact requests`);

    // 5.11 Migrate group invitations
    console.log('  Migrating group invitations...');
    const insertGroupInvitation = db.prepare(`
      INSERT INTO group_invitations (id, group_id, invited_by, invited_user_id, message, status, created_at, responded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const i of (data.groupInvitations.invitations || [])) {
      insertGroupInvitation.run(
        i.id, i.group_id, i.invited_by, i.invited_user_id, i.message || null,
        i.status, i.created_at, i.responded_at || null
      );
    }
    console.log(`    Migrated ${data.groupInvitations.invitations?.length || 0} group invitations`);

    // 5.12 Migrate blocks
    console.log('  Migrating blocks...');
    const insertBlock = db.prepare(`
      INSERT OR IGNORE INTO blocks (id, user_id, blocked_user_id, blocked_at) VALUES (?, ?, ?, ?)
    `);
    for (const b of (data.moderation.blocks || [])) {
      insertBlock.run(b.id, b.userId, b.blockedUserId, b.blockedAt);
    }
    console.log(`    Migrated ${data.moderation.blocks?.length || 0} blocks`);

    // 5.13 Migrate mutes
    console.log('  Migrating mutes...');
    const insertMute = db.prepare(`
      INSERT OR IGNORE INTO mutes (id, user_id, muted_user_id, muted_at) VALUES (?, ?, ?, ?)
    `);
    for (const m of (data.moderation.mutes || [])) {
      insertMute.run(m.id, m.userId, m.mutedUserId, m.mutedAt);
    }
    console.log(`    Migrated ${data.moderation.mutes?.length || 0} mutes`);

    // 5.14 Migrate reports
    console.log('  Migrating reports...');
    const insertReport = db.prepare(`
      INSERT INTO reports (id, reporter_id, type, target_id, reason, details, status, resolution, created_at, resolved_at, resolved_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of (data.reports.reports || [])) {
      insertReport.run(
        r.id, r.reporterId, r.type, r.targetId, r.reason, r.details || '',
        r.status, r.resolution || null, r.createdAt, r.resolvedAt || null, r.resolvedBy || null
      );
    }
    console.log(`    Migrated ${data.reports.reports?.length || 0} reports`);
  });

  // Execute the transaction
  migrateTx();

  // Step 6: Verify migration
  console.log('\nStep 6: Verifying migration...');
  const counts = {
    users: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
    contacts: db.prepare('SELECT COUNT(*) as count FROM contacts').get().count,
    waves: db.prepare('SELECT COUNT(*) as count FROM waves').get().count,
    waveParticipants: db.prepare('SELECT COUNT(*) as count FROM wave_participants').get().count,
    droplets: db.prepare('SELECT COUNT(*) as count FROM droplets').get().count,
    dropletReadBy: db.prepare('SELECT COUNT(*) as count FROM droplet_read_by').get().count,
    dropletHistory: db.prepare('SELECT COUNT(*) as count FROM droplet_history').get().count,
    groups: db.prepare('SELECT COUNT(*) as count FROM groups').get().count,
    groupMembers: db.prepare('SELECT COUNT(*) as count FROM group_members').get().count,
    handleRequests: db.prepare('SELECT COUNT(*) as count FROM handle_requests').get().count,
    contactRequests: db.prepare('SELECT COUNT(*) as count FROM contact_requests').get().count,
    groupInvitations: db.prepare('SELECT COUNT(*) as count FROM group_invitations').get().count,
    blocks: db.prepare('SELECT COUNT(*) as count FROM blocks').get().count,
    mutes: db.prepare('SELECT COUNT(*) as count FROM mutes').get().count,
    reports: db.prepare('SELECT COUNT(*) as count FROM reports').get().count,
  };

  console.log('  SQLite record counts:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`    ${table}: ${count}`);
  }

  // Compare counts
  let verified = true;
  const expected = {
    users: data.users.users?.length || 0,
    contacts: data.users.contacts?.length || 0,
    waves: data.waves.waves?.length || 0,
    waveParticipants: data.waves.participants?.length || 0,
    droplets: data.droplets.droplets?.length || 0,
    dropletHistory: data.droplets.history?.length || 0,
    groups: data.groups.groups?.length || 0,
    groupMembers: data.groups.members?.length || 0,
    handleRequests: data.handleRequests.requests?.length || 0,
    contactRequests: data.contactRequests.requests?.length || 0,
    groupInvitations: data.groupInvitations.invitations?.length || 0,
    blocks: data.moderation.blocks?.length || 0,
    mutes: data.moderation.mutes?.length || 0,
    reports: data.reports.reports?.length || 0,
  };

  for (const [table, expectedCount] of Object.entries(expected)) {
    if (counts[table] !== expectedCount) {
      console.log(`  WARNING: ${table} mismatch - expected ${expectedCount}, got ${counts[table]}`);
      verified = false;
    }
  }

  if (verified) {
    console.log('\n  All record counts match!');
  }

  // Close database
  db.close();

  console.log('\n' + '='.repeat(60));
  console.log('Migration complete!');
  console.log(`Database created at: ${DB_PATH}`);
  if (!NO_BACKUP) {
    console.log(`JSON backups at: ${BACKUP_DIR}`);
  }
  console.log('='.repeat(60));

  // Print instructions
  console.log('\nNext steps:');
  console.log('1. Set USE_SQLITE=true in server/.env');
  console.log('2. Restart the server');
  console.log('3. Test all functionality (waves, pings, burst, focus view)');
  console.log('4. Once verified, you can delete the JSON files');
}

// Run migration
migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
