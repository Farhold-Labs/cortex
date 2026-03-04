/**
 * Cortex SQLite Database Module
 *
 * This module provides the Database class that uses SQLite for persistence.
 * It's a drop-in replacement for the JSON file-based database.
 *
 * Terminology (v2.0.0):
 *   pings (formerly droplets) - individual messages
 *   crews (formerly groups) - user groups
 *   burst (formerly ripple) - break-out threads
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import sanitizeHtml from 'sanitize-html';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ Privacy Hardening: Email Encryption (v2.16.0) ============
// These functions mirror those in server.js but are needed here for database operations

const EMAIL_ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || null;

/**
 * Hash email for lookup (deterministic)
 * @param {string} email - Email address
 * @returns {string|null} SHA-256 hash (hex)
 */
function hashEmail(email) {
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Encrypt email for storage (for password reset)
 * @param {string} email - Email address to encrypt
 * @returns {{encrypted: string, iv: string}|null} Encrypted data or null if no key
 */
function encryptEmail(email) {
  if (!EMAIL_ENCRYPTION_KEY || !email) return null;

  try {
    const key = Buffer.from(EMAIL_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(12); // AES-GCM uses 12-byte IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(email.toLowerCase().trim(), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Combine ciphertext + auth tag
    const combined = Buffer.concat([Buffer.from(encrypted, 'base64'), authTag]).toString('base64');

    return {
      encrypted: combined,
      iv: iv.toString('base64')
    };
  } catch (err) {
    console.error('Email encryption error:', err.message);
    return null;
  }
}

/**
 * Decrypt email for password reset
 * @param {string} encrypted - Base64 encrypted email (ciphertext + auth tag)
 * @param {string} iv - Base64 initialization vector
 * @returns {string|null} Decrypted email or null on error
 */
function decryptEmail(encrypted, iv) {
  if (!EMAIL_ENCRYPTION_KEY || !encrypted || !iv) return null;

  try {
    const key = Buffer.from(EMAIL_ENCRYPTION_KEY, 'hex');
    const ivBuffer = Buffer.from(iv, 'base64');
    const combined = Buffer.from(encrypted, 'base64');

    // Split ciphertext and auth tag (auth tag is last 16 bytes)
    const authTag = combined.slice(-16);
    const ciphertext = combined.slice(0, -16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Email decryption error:', err.message);
    return null;
  }
}

/**
 * Round timestamp to interval for privacy (reduces timing analysis)
 * @param {Date|string} date - Date to round
 * @param {number} minutes - Interval in minutes (default: 15)
 * @returns {string} ISO string rounded to interval
 */
function roundTimestamp(date, minutes = 15) {
  const d = date instanceof Date ? date : new Date(date);
  const ms = minutes * 60 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms).toISOString();
}

// ============ Security: Input Sanitization ============
const sanitizeMessageOptions = {
  allowedTags: ['img', 'a', 'br', 'p', 'strong', 'em', 'code', 'pre'],
  allowedAttributes: {
    'img': ['src', 'alt', 'width', 'height', 'class', 'style'],
    'a': ['href', 'target', 'rel', 'class', 'data-filename', 'data-size', 'download'],
  },
  allowedSchemes: ['http', 'https', 'data'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data']
  },
  transformTags: {
    'a': (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
    }),
    'img': (tagName, attribs) => {
      const src = attribs.src || '';
      const isGif = src.match(/\.gif(\?|$)/i) ||
                    src.match(/(giphy\.com|tenor\.com)/i);
      return {
        tagName: 'img',
        attribs: {
          ...attribs,
          style: attribs.style || 'max-width: 100%; height: auto;',
          loading: isGif ? 'eager' : 'lazy',
          class: 'message-media'
        }
      };
    }
  }
};

function sanitizeMessage(content) {
  if (typeof content !== 'string') return '';
  return sanitizeHtml(content, sanitizeMessageOptions).trim().slice(0, 10000);
}

function detectAndEmbedMedia(content) {
  const urlRegex = /(?<!["'>])(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/)/gi;
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i;
  const imageHosts = /(media\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)/i;
  const imgStyle = 'max-width:200px;max-height:150px;border-radius:4px;cursor:pointer;object-fit:cover;display:block;border:1px solid #3a4a3a;';

  content = content.replace(urlRegex, (match) => {
    if (imageExtensions.test(match) || imageHosts.test(match)) {
      return `<img src="${match}" alt="Embedded media" style="${imgStyle}" class="zoomable-image" />`;
    }
    return `<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>`;
  });

  // Detect file attachment markers and convert to styled download links
  const fileMarkerRegex = /\[file:([^\]:]+):(\d+)\](\/uploads\/files\/[^\s<]+)/g;
  content = content.replace(fileMarkerRegex, (match, filename, sizeStr, url) => {
    const size = parseInt(sizeStr, 10);
    let formatted;
    if (size >= 1024 * 1024) formatted = (size / (1024 * 1024)).toFixed(1) + ' MB';
    else if (size >= 1024) formatted = (size / 1024).toFixed(1) + ' KB';
    else formatted = size + ' B';
    const safeName = filename.replace(/[<>"'&]/g, '');
    const safeUrl = url.replace(/[<>"'&]/g, '');
    return `<a href="${safeUrl}" class="file-attachment" data-filename="${safeName}" data-size="${formatted}" download="${safeName}">${safeName} (${formatted})</a>`;
  });

  const uploadPathRegex = /(?<!["'>])(\/uploads\/(?:messages|avatars)\/[^\s<]+)(?![^<]*>|[^<>]*<\/)/gi;
  content = content.replace(uploadPathRegex, (match) => {
    if (imageExtensions.test(match)) {
      return `<img src="${match}" alt="Uploaded image" style="${imgStyle}" class="zoomable-image" />`;
    }
    return match;
  });

  return content;
}

// Configuration
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'farhold.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * SQLite-backed Database class
 * Provides the same interface as the original JSON-based Database class
 */
export class DatabaseSQLite {
  constructor(options = {}) {
    this.dbPath = options.dbPath || DB_PATH;
    this.db = null;
    this.init();
  }

  init() {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Check if this is a fresh database
    const isNewDb = !fs.existsSync(this.dbPath);

    // Open database
    this.db = new Database(this.dbPath);

    // Database encryption support (requires SQLCipher build of better-sqlite3)
    // To enable: npm install @journeyapps/sqlcipher (instead of better-sqlite3)
    // Then set DB_ENCRYPTION_KEY environment variable
    const encryptionKey = process.env.DB_ENCRYPTION_KEY;
    if (encryptionKey) {
      try {
        // Apply encryption key - this only works with SQLCipher
        this.db.pragma(`key = '${encryptionKey}'`);
        console.log('🔐 Database encryption enabled');
      } catch (err) {
        if (process.env.NODE_ENV === 'production') {
          console.error('FATAL: DB_ENCRYPTION_KEY set but encryption failed. Install @journeyapps/sqlcipher for encryption support.');
          process.exit(1);
        } else {
          console.warn('⚠️  DB_ENCRYPTION_KEY set but encryption not available. Install @journeyapps/sqlcipher for encryption.');
        }
      }
    } else if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_DB_ENCRYPTION === 'true') {
      console.error('FATAL: REQUIRE_DB_ENCRYPTION is true but DB_ENCRYPTION_KEY is not set');
      process.exit(1);
    }

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Create schema if new database
    if (isNewDb) {
      console.log('📦 Creating new SQLite database...');
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
      this.db.exec(schema);
      console.log('✅ SQLite database created');

      // Seed demo data if configured
      if (process.env.SEED_DEMO_DATA === 'true') {
        this.seedDemoData();
      }
    } else {
      console.log('📂 Connected to SQLite database');
      // Apply any schema updates for existing databases
      this.applySchemaUpdates();
    }

    // Prepare commonly used statements
    this.prepareStatements();
  }

  applySchemaUpdates() {
    // v2.0.0 (Farhold) - First check if database is already on v2.0.0 schema
    // If pings table exists, we're on v2.0.0 and should skip all legacy migrations
    const pingsExistsEarly = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='pings'
    `).get();
    const isV2Schema = !!pingsExistsEarly;

    // Check if we need to migrate messages to droplets (v1.10.0)
    // Skip this if already on v2.0.0 schema
    if (!isV2Schema) {
      const messagesExists = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='messages'
      `).get();
      const dropletsExists = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='droplets'
      `).get();

      if (messagesExists && !dropletsExists) {
      console.log('📝 Migrating messages table to droplets (v1.10.0)...');

      // Rename messages table to droplets
      this.db.exec('ALTER TABLE messages RENAME TO droplets');

      // Rename message_read_by to ping_read_by
      const readByExists = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='message_read_by'
      `).get();
      if (readByExists) {
        this.db.exec('ALTER TABLE message_read_by RENAME TO ping_read_by');
        this.db.exec('ALTER TABLE ping_read_by RENAME COLUMN message_id TO droplet_id');
      }

      // Rename message_history to ping_history
      const historyExists = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='message_history'
      `).get();
      if (historyExists) {
        this.db.exec('ALTER TABLE message_history RENAME TO ping_history');
        this.db.exec('ALTER TABLE ping_history RENAME COLUMN message_id TO droplet_id');
      }

      // Drop old FTS table and triggers
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_insert');
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_delete');
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_update');
      this.db.exec('DROP TABLE IF EXISTS messages_fts');

      // Create new pings_fts table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS pings_fts USING fts5(
          id UNINDEXED,
          content,
          content='droplets',
          content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS pings_fts_insert AFTER INSERT ON droplets BEGIN
          INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
        END;

        CREATE TRIGGER IF NOT EXISTS pings_fts_delete AFTER DELETE ON droplets BEGIN
          INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
        END;

        CREATE TRIGGER IF NOT EXISTS pings_fts_update AFTER UPDATE ON droplets BEGIN
          INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
          INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
        END;
      `);

      // Populate FTS with existing droplets
      const dropletCount = this.db.prepare('SELECT COUNT(*) as count FROM droplets').get().count;
      if (dropletCount > 0) {
        console.log(`📚 Indexing ${dropletCount} existing droplets...`);
        this.db.exec(`
          INSERT INTO pings_fts(rowid, id, content)
          SELECT rowid, id, content FROM droplets;
        `);
      }

      console.log('✅ Migration to droplets complete');
      }
    } // end if (!isV2Schema) for messages→droplets migration

    // Check if FTS table exists (for fresh installs or post-migration)
    // Use correct table name based on schema version
    const tableName = isV2Schema ? 'pings' : 'droplets';
    const ftsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='pings_fts'
    `).get();

    if (!ftsExists) {
      console.log('📝 Creating FTS5 search index...');

      // Create FTS5 virtual table (uses correct table name for schema version)
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS pings_fts USING fts5(
          id UNINDEXED,
          content,
          content='${tableName}',
          content_rowid='rowid'
        );
      `);

      // Create triggers to keep FTS in sync (use correct table name)
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS pings_fts_insert AFTER INSERT ON ${tableName} BEGIN
          INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
        END;

        CREATE TRIGGER IF NOT EXISTS pings_fts_delete AFTER DELETE ON ${tableName} BEGIN
          INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
        END;

        CREATE TRIGGER IF NOT EXISTS pings_fts_update AFTER UPDATE ON ${tableName} BEGIN
          INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
          INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
        END;
      `);

      // Populate FTS with existing droplets
      const dropletCount = this.db.prepare('SELECT COUNT(*) as count FROM pings').get().count;
      if (dropletCount > 0) {
        console.log(`📚 Indexing ${dropletCount} existing droplets...`);
        this.db.exec(`
          INSERT INTO pings_fts(rowid, id, content)
          SELECT rowid, id, content FROM pings;
        `);
      }

      console.log('✅ FTS5 search index created');
    }

    // Check if reports table exists (v1.9.0)
    const reportsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='reports'
    `).get();

    if (!reportsExists) {
      console.log('📝 Creating reports table...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          details TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          resolution TEXT,
          resolution_notes TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
        CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
        CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
      `);
      console.log('✅ Reports table created');
    }

    // Check if warnings table exists (v1.9.0)
    const warningsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='warnings'
    `).get();

    if (!warningsExists) {
      console.log('📝 Creating warnings table...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS warnings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          issued_by TEXT NOT NULL REFERENCES users(id),
          reason TEXT NOT NULL,
          report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);
        CREATE INDEX IF NOT EXISTS idx_warnings_issued_by ON warnings(issued_by);
        CREATE INDEX IF NOT EXISTS idx_warnings_report ON warnings(report_id);
      `);
      console.log('✅ Warnings table created');
    }

    // Check if moderation_log table exists (v1.9.0)
    const modLogExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='moderation_log'
    `).get();

    if (!modLogExists) {
      console.log('📝 Creating moderation_log table...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS moderation_log (
          id TEXT PRIMARY KEY,
          admin_id TEXT NOT NULL REFERENCES users(id),
          action_type TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          reason TEXT,
          details TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_moderation_log_admin ON moderation_log(admin_id);
        CREATE INDEX IF NOT EXISTS idx_moderation_log_target ON moderation_log(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_moderation_log_created ON moderation_log(created_at DESC);
      `);
      console.log('✅ Moderation log table created');
    }

    // Check if breakout columns exist on pings table (v1.10.0 Phase 5)
    // Use correct table name based on schema version
    const pingColumns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasBrokenOutTo = pingColumns.some(c => c.name === 'broken_out_to');

    if (!hasBrokenOutTo) {
      console.log(`📝 Adding breakout columns to ${tableName} table (v1.10.0)...`);
      this.db.exec(`
        ALTER TABLE ${tableName} ADD COLUMN broken_out_to TEXT REFERENCES waves(id) ON DELETE SET NULL;
        ALTER TABLE ${tableName} ADD COLUMN original_wave_id TEXT REFERENCES waves(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_pings_broken_out ON ${tableName}(broken_out_to);
        CREATE INDEX IF NOT EXISTS idx_pings_original_wave ON ${tableName}(original_wave_id);
      `);
      console.log(`✅ Breakout columns added to ${tableName}`);
    }

    // Check if breakout columns exist on waves table (v1.10.0 Phase 5)
    // Check for both old name (root_droplet_id) and new name (root_ping_id) for v2.0.0 compatibility
    const waveColumns = this.db.prepare(`PRAGMA table_info(waves)`).all();
    const hasRootDroplet = waveColumns.some(c => c.name === 'root_droplet_id' || c.name === 'root_ping_id');

    if (!hasRootDroplet) {
      // Use v2.0.0 column names if on v2 schema, otherwise use v1.x names
      const rootColName = isV2Schema ? 'root_ping_id' : 'root_droplet_id';
      const idxName = isV2Schema ? 'idx_waves_root_ping' : 'idx_waves_root_droplet';
      console.log(`📝 Adding breakout columns to waves table (v1.10.0)...`);
      this.db.exec(`
        ALTER TABLE waves ADD COLUMN ${rootColName} TEXT REFERENCES ${tableName}(id) ON DELETE SET NULL;
        ALTER TABLE waves ADD COLUMN broken_out_from TEXT REFERENCES waves(id) ON DELETE SET NULL;
        ALTER TABLE waves ADD COLUMN breakout_chain TEXT;
        CREATE INDEX IF NOT EXISTS ${idxName} ON waves(${rootColName});
        CREATE INDEX IF NOT EXISTS idx_waves_broken_out_from ON waves(broken_out_from);
      `);
      console.log('✅ Breakout columns added to waves');
    }

    // Check if notifications table exists (v1.11.0)
    const notificationsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'
    `).get();

    if (!notificationsExists) {
      console.log('📝 Creating notifications tables (v1.11.0)...');
      // Use v2.0.0 column name (ping_id) for new installs
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          wave_id TEXT REFERENCES waves(id) ON DELETE SET NULL,
          ping_id TEXT REFERENCES ${tableName}(id) ON DELETE SET NULL,
          actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          body TEXT,
          preview TEXT,
          read INTEGER DEFAULT 0,
          dismissed INTEGER DEFAULT 0,
          push_sent INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          read_at TEXT,
          group_key TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = 0;
        CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_wave ON notifications(wave_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_ping ON notifications(ping_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_group_key ON notifications(group_key);

        CREATE TABLE IF NOT EXISTS wave_notification_settings (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          enabled INTEGER DEFAULT 1,
          level TEXT DEFAULT 'all',
          sound INTEGER DEFAULT 1,
          push INTEGER DEFAULT 1,
          PRIMARY KEY (user_id, wave_id)
        );
        CREATE INDEX IF NOT EXISTS idx_wave_notification_settings_user ON wave_notification_settings(user_id);
        CREATE INDEX IF NOT EXISTS idx_wave_notification_settings_wave ON wave_notification_settings(wave_id);
      `);
      console.log('✅ Notifications tables created');
    }

    // Check if push_subscriptions table exists and has correct schema (v1.12.0 fix)
    const pushSubsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'
    `).get();

    if (!pushSubsExists) {
      console.log('📝 Creating push_subscriptions table...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL,
          keys TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (user_id, endpoint)
        );
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
      `);
      console.log('✅ Push subscriptions table created');
    } else {
      // Check if UNIQUE constraint exists - if table was created without it, recreate
      const tableInfo = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='push_subscriptions'`).get();
      if (tableInfo && !tableInfo.sql.includes('UNIQUE')) {
        console.log('📝 Recreating push_subscriptions table with UNIQUE constraint (v1.12.0 fix)...');

        // Backup existing data
        const existingData = this.db.prepare('SELECT * FROM push_subscriptions').all();

        // Drop old table and indexes
        this.db.exec('DROP INDEX IF EXISTS idx_push_subscriptions_user');
        this.db.exec('DROP INDEX IF EXISTS idx_push_subscriptions_endpoint');
        this.db.exec('DROP TABLE push_subscriptions');

        // Create new table with constraint
        this.db.exec(`
          CREATE TABLE push_subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL,
            keys TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, endpoint)
          );
          CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
          CREATE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
        `);

        // Restore data (skip duplicates)
        if (existingData.length > 0) {
          const seenPairs = new Set();
          const insertStmt = this.db.prepare(`
            INSERT INTO push_subscriptions (id, user_id, endpoint, keys, created_at)
            VALUES (?, ?, ?, ?, ?)
          `);

          for (const row of existingData) {
            const key = `${row.user_id}:${row.endpoint}`;
            if (!seenPairs.has(key)) {
              seenPairs.add(key);
              insertStmt.run(row.id, row.user_id, row.endpoint, row.keys, row.created_at);
            }
          }
          console.log(`✅ Restored ${seenPairs.size} unique push subscriptions`);
        }

        console.log('✅ Push subscriptions table recreated with UNIQUE constraint');
      }
    }

    // Check if federation tables exist (v1.13.0)
    const serverIdentityExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='server_identity'
    `).get();

    if (!serverIdentityExists) {
      console.log('📝 Creating federation tables (v1.13.0)...');
      this.db.exec(`
        -- Server's own identity and keypair (singleton table)
        CREATE TABLE IF NOT EXISTS server_identity (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            node_name TEXT NOT NULL,
            public_key TEXT NOT NULL,
            private_key TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Trusted federation partners (allowlist)
        CREATE TABLE IF NOT EXISTS federation_nodes (
            id TEXT PRIMARY KEY,
            node_name TEXT NOT NULL UNIQUE,
            base_url TEXT NOT NULL,
            public_key TEXT,
            status TEXT DEFAULT 'pending',
            added_by TEXT REFERENCES users(id),
            last_contact_at TEXT,
            failure_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Incoming federation requests from other servers
        CREATE TABLE IF NOT EXISTS federation_requests (
            id TEXT PRIMARY KEY,
            from_node_name TEXT NOT NULL,
            from_base_url TEXT NOT NULL,
            from_public_key TEXT NOT NULL,
            to_node_name TEXT NOT NULL,
            message TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            responded_at TEXT
        );

        -- Cached profiles from federated servers
        CREATE TABLE IF NOT EXISTS remote_users (
            id TEXT PRIMARY KEY,
            node_name TEXT NOT NULL,
            handle TEXT NOT NULL,
            display_name TEXT,
            avatar TEXT,
            avatar_url TEXT,
            bio TEXT,
            cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(node_name, handle)
        );

        -- Track which nodes are participating in our waves
        CREATE TABLE IF NOT EXISTS wave_federation (
            wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
            node_name TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            added_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (wave_id, node_name)
        );

        -- Cached droplets from federated servers
        CREATE TABLE IF NOT EXISTS remote_pings (
            id TEXT PRIMARY KEY,
            wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
            origin_wave_id TEXT NOT NULL,
            origin_node TEXT NOT NULL,
            author_id TEXT NOT NULL,
            author_node TEXT NOT NULL,
            parent_id TEXT,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            edited_at TEXT,
            deleted INTEGER DEFAULT 0,
            reactions TEXT DEFAULT '{}',
            cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Outbound federation message queue
        CREATE TABLE IF NOT EXISTS federation_queue (
            id TEXT PRIMARY KEY,
            target_node TEXT NOT NULL,
            message_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 5,
            next_retry_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            delivered_at TEXT,
            last_error TEXT
        );

        -- Inbound message log (for idempotency)
        CREATE TABLE IF NOT EXISTS federation_inbox_log (
            id TEXT PRIMARY KEY,
            source_node TEXT NOT NULL,
            message_type TEXT NOT NULL,
            received_at TEXT DEFAULT CURRENT_TIMESTAMP,
            processed_at TEXT,
            status TEXT DEFAULT 'received'
        );

        -- Federation indexes
        CREATE INDEX IF NOT EXISTS idx_federation_nodes_status ON federation_nodes(status);
        CREATE INDEX IF NOT EXISTS idx_federation_nodes_name ON federation_nodes(node_name);
        CREATE INDEX IF NOT EXISTS idx_federation_requests_status ON federation_requests(status);
        CREATE INDEX IF NOT EXISTS idx_federation_requests_from_node ON federation_requests(from_node_name);
        CREATE INDEX IF NOT EXISTS idx_remote_users_node ON remote_users(node_name);
        CREATE INDEX IF NOT EXISTS idx_remote_users_handle ON remote_users(node_name, handle);
        CREATE INDEX IF NOT EXISTS idx_wave_federation_wave ON wave_federation(wave_id);
        CREATE INDEX IF NOT EXISTS idx_wave_federation_node ON wave_federation(node_name);
        CREATE INDEX IF NOT EXISTS idx_remote_pings_wave ON remote_pings(wave_id);
        CREATE INDEX IF NOT EXISTS idx_remote_pings_origin ON remote_pings(origin_node, origin_wave_id);
        CREATE INDEX IF NOT EXISTS idx_remote_pings_author ON remote_pings(author_node, author_id);
        CREATE INDEX IF NOT EXISTS idx_federation_queue_status ON federation_queue(status, next_retry_at);
        CREATE INDEX IF NOT EXISTS idx_federation_queue_node ON federation_queue(target_node);
        CREATE INDEX IF NOT EXISTS idx_federation_inbox_source ON federation_inbox_log(source_node);
        CREATE INDEX IF NOT EXISTS idx_federation_inbox_status ON federation_inbox_log(status);
      `);
      console.log('✅ Federation tables created');
    }

    // Check if federation_requests table exists (added after initial federation release)
    const fedRequestsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='federation_requests'
    `).get();

    if (!fedRequestsExists) {
      console.log('📝 Creating federation_requests table...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS federation_requests (
            id TEXT PRIMARY KEY,
            from_node_name TEXT NOT NULL,
            from_base_url TEXT NOT NULL,
            from_public_key TEXT NOT NULL,
            to_node_name TEXT NOT NULL,
            message TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            responded_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_federation_requests_status ON federation_requests(status);
        CREATE INDEX IF NOT EXISTS idx_federation_requests_from_node ON federation_requests(from_node_name);
      `);
      console.log('✅ Federation requests table created');
    }

    // Check if wave federation columns exist (v1.13.0)
    const waveColumnsForFed = this.db.prepare(`PRAGMA table_info(waves)`).all();
    const hasFederationState = waveColumnsForFed.some(c => c.name === 'federation_state');

    if (!hasFederationState) {
      console.log('📝 Adding federation columns to waves table (v1.13.0)...');
      this.db.exec(`
        ALTER TABLE waves ADD COLUMN federation_state TEXT DEFAULT 'local';
        ALTER TABLE waves ADD COLUMN origin_node TEXT;
        ALTER TABLE waves ADD COLUMN origin_wave_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_waves_federation_state ON waves(federation_state);
        CREATE INDEX IF NOT EXISTS idx_waves_origin_node ON waves(origin_node);
      `);
      console.log('✅ Wave federation columns added');
    }

    // Migrate contacts table to remove FK constraint on contact_id (v1.13.0)
    // This allows storing remote user IDs for federated follows
    const contactsInfo = this.db.prepare(`PRAGMA table_info(contacts)`).all();
    const contactsFKs = this.db.prepare(`PRAGMA foreign_key_list(contacts)`).all();
    const hasContactIdFK = contactsFKs.some(fk => fk.from === 'contact_id' && fk.table === 'users');

    if (hasContactIdFK) {
      console.log('📝 Migrating contacts table to support federated follows (v1.13.0)...');
      this.db.exec(`
        -- Temporarily disable foreign keys for migration
        PRAGMA foreign_keys = OFF;

        -- Create new contacts table without FK on contact_id
        CREATE TABLE contacts_new (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL,
          added_at TEXT NOT NULL,
          PRIMARY KEY (user_id, contact_id)
        );

        -- Copy existing data
        INSERT INTO contacts_new SELECT * FROM contacts;

        -- Drop old table and rename new one
        DROP TABLE contacts;
        ALTER TABLE contacts_new RENAME TO contacts;

        -- Re-enable foreign keys
        PRAGMA foreign_keys = ON;
      `);
      console.log('✅ Contacts table migrated for federation support');
    }

    // Check if v1.14.0 security tables exist
    const accountLockoutsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='account_lockouts'
    `).get();

    if (!accountLockoutsExists) {
      console.log('📝 Creating security tables (v1.14.0)...');
      this.db.exec(`
        -- Account lockout tracking (persistent rate limiting)
        CREATE TABLE IF NOT EXISTS account_lockouts (
          handle TEXT PRIMARY KEY,
          failed_attempts INTEGER DEFAULT 0,
          locked_until TEXT,
          last_attempt TEXT
        );

        -- Password reset tokens
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires ON password_reset_tokens(expires_at);

        -- Multi-Factor Authentication settings
        CREATE TABLE IF NOT EXISTS user_mfa (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          totp_secret TEXT,
          totp_enabled INTEGER DEFAULT 0,
          email_mfa_enabled INTEGER DEFAULT 0,
          recovery_codes TEXT,
          recovery_codes_generated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );

        -- MFA challenge tracking for login flow
        CREATE TABLE IF NOT EXISTS mfa_challenges (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          challenge_type TEXT NOT NULL,
          code_hash TEXT,
          expires_at TEXT NOT NULL,
          verified_at TEXT,
          created_at TEXT NOT NULL,
          session_duration TEXT DEFAULT '24h'
        );
        CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges(user_id);
        CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires ON mfa_challenges(expires_at);

        -- Activity log for security auditing
        CREATE TABLE IF NOT EXISTS activity_log (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          action_type TEXT NOT NULL,
          resource_type TEXT,
          resource_id TEXT,
          ip_address TEXT,
          user_agent TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action_type);
        CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_activity_resource ON activity_log(resource_type, resource_id);
      `);
      console.log('✅ Security tables created (v1.14.0)');
    }

    // Fix user_mfa column name if incorrect (backup_codes_generated_at -> recovery_codes_generated_at)
    const userMfaExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='user_mfa'
    `).get();

    if (userMfaExists) {
      const mfaColumns = this.db.prepare(`PRAGMA table_info(user_mfa)`).all();
      const hasBackupColumn = mfaColumns.some(c => c.name === 'backup_codes_generated_at');
      const hasRecoveryColumn = mfaColumns.some(c => c.name === 'recovery_codes_generated_at');

      if (hasBackupColumn && !hasRecoveryColumn) {
        console.log('📝 Renaming backup_codes_generated_at to recovery_codes_generated_at...');
        this.db.exec(`ALTER TABLE user_mfa RENAME COLUMN backup_codes_generated_at TO recovery_codes_generated_at`);
        console.log('✅ Column renamed');
      } else if (!hasBackupColumn && !hasRecoveryColumn) {
        console.log('📝 Adding recovery_codes_generated_at column to user_mfa...');
        this.db.exec(`ALTER TABLE user_mfa ADD COLUMN recovery_codes_generated_at TEXT`);
        console.log('✅ Column added');
      }
    }

    // Check if require_password_change column exists on users table (v1.14.0)
    const userColumnsForPw = this.db.prepare(`PRAGMA table_info(users)`).all();
    const hasRequirePasswordChange = userColumnsForPw.some(c => c.name === 'require_password_change');

    if (!hasRequirePasswordChange) {
      console.log('📝 Adding require_password_change column to users table (v1.14.0)...');
      this.db.exec(`
        ALTER TABLE users ADD COLUMN require_password_change INTEGER DEFAULT 0;
      `);
      console.log('✅ require_password_change column added');
    }

    // Check if session_duration column exists on mfa_challenges table (v2.0.5)
    const mfaChallengeColumnsForSession = this.db.prepare(`PRAGMA table_info(mfa_challenges)`).all();
    const hasSessionDuration = mfaChallengeColumnsForSession.some(c => c.name === 'session_duration');

    if (!hasSessionDuration) {
      console.log('📝 Adding session_duration column to mfa_challenges table (v2.0.5)...');
      this.db.exec(`
        ALTER TABLE mfa_challenges ADD COLUMN session_duration TEXT DEFAULT '24h';
      `);
      console.log('✅ session_duration column added to mfa_challenges');
    }

    // Auto-create crawl bar tables if they don't exist (v1.15.0)
    const crawlConfigExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='crawl_config'
    `).get();

    if (!crawlConfigExists) {
      console.log('📝 Creating crawl bar tables (v1.15.0)...');
      this.db.exec(`
        -- Server-wide crawl bar configuration (singleton)
        CREATE TABLE IF NOT EXISTS crawl_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          stock_symbols TEXT DEFAULT '["AAPL","GOOGL","MSFT","AMZN","TSLA"]',
          news_sources TEXT DEFAULT '[]',
          default_location TEXT DEFAULT '{"lat":40.7128,"lon":-74.0060,"name":"New York, NY"}',
          stock_refresh_interval INTEGER DEFAULT 60,
          weather_refresh_interval INTEGER DEFAULT 300,
          news_refresh_interval INTEGER DEFAULT 180,
          stocks_enabled INTEGER DEFAULT 1,
          weather_enabled INTEGER DEFAULT 1,
          news_enabled INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Cache for external API responses
        CREATE TABLE IF NOT EXISTS crawl_cache (
          id TEXT PRIMARY KEY,
          cache_type TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          data TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (cache_type, cache_key)
        );
        CREATE INDEX IF NOT EXISTS idx_crawl_cache_type_key ON crawl_cache(cache_type, cache_key);
        CREATE INDEX IF NOT EXISTS idx_crawl_cache_expires ON crawl_cache(expires_at);
      `);
      console.log('✅ Crawl bar tables created (v1.15.0)');
    }

    // Auto-create alerts tables if they don't exist (v1.16.0)
    const alertsTableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'
    `).get();

    if (!alertsTableExists) {
      console.log('📝 Creating alerts tables (v1.16.0)...');
      this.db.exec(`
        -- Admin-created alerts that display in crawl bar
        CREATE TABLE IF NOT EXISTS alerts (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'info',
          category TEXT NOT NULL DEFAULT 'system',
          scope TEXT NOT NULL DEFAULT 'local',
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT,
          origin_node TEXT,
          origin_alert_id TEXT,
          UNIQUE (origin_node, origin_alert_id)
        );

        -- Subscriptions: what alert categories we subscribe to from other servers
        CREATE TABLE IF NOT EXISTS alert_subscriptions (
          id TEXT PRIMARY KEY,
          source_node TEXT NOT NULL UNIQUE,
          categories TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'active',
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT
        );

        -- Subscribers: who subscribes to our alerts (populated by federation inbox)
        CREATE TABLE IF NOT EXISTS alert_subscribers (
          id TEXT PRIMARY KEY,
          subscriber_node TEXT NOT NULL UNIQUE,
          categories TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT
        );

        -- Per-user alert dismissals
        CREATE TABLE IF NOT EXISTS alert_dismissals (
          alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          dismissed_at TEXT NOT NULL,
          PRIMARY KEY (alert_id, user_id)
        );

        -- Alert indexes
        CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(start_time, end_time);
        CREATE INDEX IF NOT EXISTS idx_alerts_priority ON alerts(priority);
        CREATE INDEX IF NOT EXISTS idx_alerts_category ON alerts(category);
        CREATE INDEX IF NOT EXISTS idx_alerts_scope ON alerts(scope);
        CREATE INDEX IF NOT EXISTS idx_alerts_origin ON alerts(origin_node);
        CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_source ON alert_subscriptions(source_node);
        CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_status ON alert_subscriptions(status);
        CREATE INDEX IF NOT EXISTS idx_alert_subscribers_node ON alert_subscribers(subscriber_node);
        CREATE INDEX IF NOT EXISTS idx_alert_dismissals_user ON alert_dismissals(user_id);
      `);
      console.log('✅ Alerts tables created (v1.16.0)');
    }

    // Auto-create session management tables if they don't exist (v1.18.0)
    const sessionsTableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='user_sessions'
    `).get();

    if (!sessionsTableExists) {
      console.log('📝 Creating session management tables (v1.18.0)...');
      this.db.exec(`
        -- Server-side session tracking for token revocation
        CREATE TABLE IF NOT EXISTS user_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          device_info TEXT,
          ip_address TEXT,
          created_at TEXT NOT NULL,
          last_active TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked INTEGER DEFAULT 0,
          revoked_at TEXT,
          UNIQUE(token_hash)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON user_sessions(revoked);
      `);
      console.log('✅ Session management tables created (v1.18.0)');
    }

    // Auto-create E2EE tables if they don't exist (v1.19.0)
    const userEncryptionKeysExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='user_encryption_keys'
    `).get();

    if (!userEncryptionKeysExists) {
      console.log('📝 Creating E2EE tables (v1.19.0)...');
      this.db.exec(`
        -- User encryption keypairs (ECDH P-384)
        CREATE TABLE IF NOT EXISTS user_encryption_keys (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          public_key TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          key_derivation_salt TEXT NOT NULL,
          key_version INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );

        -- Wave encryption keys (per-participant)
        CREATE TABLE IF NOT EXISTS wave_encryption_keys (
          id TEXT PRIMARY KEY,
          wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          encrypted_wave_key TEXT NOT NULL,
          sender_public_key TEXT NOT NULL,
          key_version INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          UNIQUE(wave_id, user_id, key_version)
        );

        -- Wave key metadata
        CREATE TABLE IF NOT EXISTS wave_key_metadata (
          wave_id TEXT PRIMARY KEY REFERENCES waves(id) ON DELETE CASCADE,
          current_key_version INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          last_rotated_at TEXT
        );

        -- E2EE Recovery
        CREATE TABLE IF NOT EXISTS user_recovery_keys (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          encrypted_private_key TEXT NOT NULL,
          recovery_salt TEXT NOT NULL,
          hint TEXT,
          created_at TEXT NOT NULL
        );

        -- E2EE indexes
        CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_wave ON wave_encryption_keys(wave_id);
        CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_user ON wave_encryption_keys(user_id);
        CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_version ON wave_encryption_keys(wave_id, key_version);
      `);
      console.log('✅ E2EE tables created (v1.19.0)');
    }

    // Add E2EE columns to waves table if they don't exist (v1.19.0)
    const waveColumnsE2EE = this.db.prepare(`PRAGMA table_info(waves)`).all();
    const hasWaveEncrypted = waveColumnsE2EE.some(c => c.name === 'encrypted');

    if (!hasWaveEncrypted) {
      console.log('📝 Adding encrypted column to waves table (v1.19.0)...');
      this.db.exec(`
        ALTER TABLE waves ADD COLUMN encrypted INTEGER DEFAULT 0;
      `);
      console.log('✅ Waves encrypted column added');
    }

    // Add E2EE columns to pings table if they don't exist (v1.19.0)
    // Use correct table name based on schema version (tableName is pings or droplets)
    const pingColumnsE2EE = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasPingEncrypted = pingColumnsE2EE.some(c => c.name === 'encrypted');

    if (!hasPingEncrypted) {
      console.log(`📝 Adding E2EE columns to ${tableName} table (v1.19.0)...`);
      this.db.exec(`
        ALTER TABLE ${tableName} ADD COLUMN encrypted INTEGER DEFAULT 0;
        ALTER TABLE ${tableName} ADD COLUMN nonce TEXT;
      `);
      console.log(`✅ ${tableName} E2EE columns added`);
    }

    // Add key_version column to pings table if it doesn't exist (v1.19.0)
    // Re-fetch column info in case previous migration just ran
    const pingColumnsForKeyVersion = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasKeyVersion = pingColumnsForKeyVersion.some(c => c.name === 'key_version');
    if (!hasKeyVersion) {
      console.log(`📝 Adding key_version column to ${tableName} table (v1.19.0)...`);
      this.db.exec(`
        ALTER TABLE ${tableName} ADD COLUMN key_version INTEGER DEFAULT 1;
      `);
      console.log(`✅ ${tableName} key_version column added`);
    }

    // Add role column to users table if it doesn't exist (v1.20.0)
    const userColumnsForRole = this.db.prepare(`PRAGMA table_info(users)`).all();
    const hasRoleColumn = userColumnsForRole.some(c => c.name === 'role');
    if (!hasRoleColumn) {
      console.log('📝 Adding role column to users table (v1.20.0)...');
      this.db.exec(`
        ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      `);
      // Migrate existing admins to have 'admin' role
      const migratedCount = this.db.prepare(`
        UPDATE users SET role = CASE WHEN is_admin = 1 THEN 'admin' ELSE 'user' END
      `).run().changes;
      console.log(`✅ Role column added, migrated ${migratedCount} users`);
    }

    // v2.0.0 (Farhold) - Check if migration from droplets to pings is needed
    const dropletsExistsV2 = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='droplets'
    `).get();
    const pingsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='pings'
    `).get();

    if (dropletsExistsV2 && !pingsExists) {
      console.log('');
      console.log('⚠️  Database migration required for Farhold v2.0.0');
      console.log('   Run: node migrate-v1.20-to-v2.0.js');
      console.log('');
      throw new Error('Database migration required. Run: node migrate-v1.20-to-v2.0.js');
    }

    // v2.0.0 - Check if groups → crews migration is needed
    const groupsExistsV2 = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='groups'
    `).get();
    const crewsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='crews'
    `).get();

    if (groupsExistsV2 && !crewsExists) {
      console.log('');
      console.log('⚠️  Database migration required for Farhold v2.0.0');
      console.log('   Run: node migrate-v1.20-to-v2.0.js');
      console.log('');
      throw new Error('Database migration required. Run: node migrate-v1.20-to-v2.0.js');
    }

    // v2.1.0 - Bot/Webhook System
    const botsTableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='bots'
    `).get();

    if (!botsTableExists) {
      console.log('📝 Creating bot/webhook system tables (v2.1.0)...');
      this.db.exec(`
        -- Bots: Automated systems that can post to waves via API
        CREATE TABLE IF NOT EXISTS bots (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          api_key_hash TEXT UNIQUE NOT NULL,
          status TEXT DEFAULT 'active',
          created_at TEXT NOT NULL,
          last_used_at TEXT,
          public_key TEXT,
          encrypted_private_key TEXT,
          key_version INTEGER DEFAULT 1,
          total_pings INTEGER DEFAULT 0,
          total_api_calls INTEGER DEFAULT 0,
          can_create_waves INTEGER DEFAULT 0,
          webhook_secret TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
        CREATE INDEX IF NOT EXISTS idx_bots_api_key_hash ON bots(api_key_hash);

        -- Bot Permissions: Wave-level access control for bots
        CREATE TABLE IF NOT EXISTS bot_permissions (
          id TEXT PRIMARY KEY,
          bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
          wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          can_post INTEGER DEFAULT 1,
          can_read INTEGER DEFAULT 1,
          granted_at TEXT NOT NULL,
          granted_by TEXT NOT NULL REFERENCES users(id),
          UNIQUE(bot_id, wave_id)
        );

        CREATE INDEX IF NOT EXISTS idx_bot_permissions_bot ON bot_permissions(bot_id);
        CREATE INDEX IF NOT EXISTS idx_bot_permissions_wave ON bot_permissions(wave_id);

        -- Bot Wave Keys: Encrypted wave keys for bots (E2EE support)
        CREATE TABLE IF NOT EXISTS bot_wave_keys (
          id TEXT PRIMARY KEY,
          bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
          wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          encrypted_wave_key TEXT NOT NULL,
          sender_public_key TEXT NOT NULL,
          key_version INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          UNIQUE(bot_id, wave_id, key_version)
        );

        CREATE INDEX IF NOT EXISTS idx_bot_wave_keys_bot ON bot_wave_keys(bot_id);
        CREATE INDEX IF NOT EXISTS idx_bot_wave_keys_wave ON bot_wave_keys(wave_id);
      `);
      console.log('✅ Bot/webhook system tables created (v2.1.0)');
    }

    // v2.1.0 - Add bot_id column to pings table for bot authorship
    const pingsColumns = this.db.prepare(`PRAGMA table_info(pings)`).all();
    const hasBotId = pingsColumns.some(c => c.name === 'bot_id');

    if (!hasBotId) {
      console.log('📝 Adding bot_id column to pings table (v2.1.0)...');
      this.db.exec(`
        ALTER TABLE pings ADD COLUMN bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_pings_bot_id ON pings(bot_id);
      `);
      console.log('✅ Bot_id column added to pings table');
    }

    // v2.2.0 - Wave Categories and Organization
    const waveCategoriesExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='wave_categories'
    `).get();

    if (!waveCategoriesExists) {
      console.log('📝 Adding wave organization features (v2.2.0)...');

      // Check if pinned column already exists before adding it
      const waveParticipantColumns = this.db.prepare(`PRAGMA table_info(wave_participants)`).all();
      const hasPinnedColumn = waveParticipantColumns.some(c => c.name === 'pinned');

      if (!hasPinnedColumn) {
        console.log('  → Adding pinned column to wave_participants...');
        this.db.exec(`
          ALTER TABLE wave_participants ADD COLUMN pinned INTEGER DEFAULT 0;
        `);
        console.log('    ✓ Added pinned column');
      }

      // Create wave_categories table
      console.log('  → Creating wave_categories table...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS wave_categories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT DEFAULT 'var(--accent-green)',
          sort_order INTEGER DEFAULT 0,
          collapsed INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(user_id, name)
        );
      `);
      console.log('    ✓ Created wave_categories table');

      // Create wave_category_assignments table
      console.log('  → Creating wave_category_assignments table...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS wave_category_assignments (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          category_id TEXT REFERENCES wave_categories(id) ON DELETE SET NULL,
          assigned_at TEXT NOT NULL,
          PRIMARY KEY (user_id, wave_id)
        );
      `);
      console.log('    ✓ Created wave_category_assignments table');

      // Create indexes
      console.log('  → Creating indexes...');
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_wave_participants_pinned
        ON wave_participants(user_id, pinned) WHERE pinned = 1;

        CREATE INDEX IF NOT EXISTS idx_wave_categories_user
        ON wave_categories(user_id);

        CREATE INDEX IF NOT EXISTS idx_wave_categories_sort
        ON wave_categories(user_id, sort_order);

        CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_user
        ON wave_category_assignments(user_id);

        CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_category
        ON wave_category_assignments(category_id);

        CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_wave
        ON wave_category_assignments(wave_id);
      `);
      console.log('    ✓ Created indexes');

      // Create default "General" category for all existing users
      console.log('  → Creating default "General" category for existing users...');
      const users = this.db.prepare('SELECT id FROM users').all();
      const now = new Date().toISOString();

      const insertCategory = this.db.prepare(`
        INSERT INTO wave_categories (id, user_id, name, color, sort_order, collapsed, created_at, updated_at)
        VALUES (?, ?, 'General', 'var(--accent-green)', 0, 0, ?, ?)
      `);

      let categoryCount = 0;
      for (const user of users) {
        const categoryId = `cat-${uuidv4()}`;
        insertCategory.run(categoryId, user.id, now, now);
        categoryCount++;
      }

      console.log(`    ✓ Created ${categoryCount} default categories`);
      console.log('✅ Wave organization features added (v2.2.0)');
    }

    // v2.3.0 - Voice Calls: Add audio encryption toggle to waves
    const waveColumnsV230 = this.db.prepare(`PRAGMA table_info(waves)`).all();
    const hasAudioEncryptionColumn = waveColumnsV230.some(c => c.name === 'audio_encryption_enabled');

    if (!hasAudioEncryptionColumn) {
      console.log('📝 Adding audio_encryption_enabled column to waves table (v2.3.0)...');
      this.db.exec(`
        ALTER TABLE waves ADD COLUMN audio_encryption_enabled INTEGER DEFAULT 0;
      `);
      console.log('✅ Audio encryption toggle added to waves table');
    }

    // v2.7.0 - Media Pings: Add media fields to pings table
    const pingsColumnsV270 = this.db.prepare(`PRAGMA table_info(pings)`).all();
    const hasMediaTypeColumn = pingsColumnsV270.some(c => c.name === 'media_type');

    if (!hasMediaTypeColumn) {
      console.log('📝 Adding media fields to pings table (v2.7.0)...');
      this.db.exec(`
        ALTER TABLE pings ADD COLUMN media_type TEXT;
        ALTER TABLE pings ADD COLUMN media_url TEXT;
        ALTER TABLE pings ADD COLUMN media_duration INTEGER;
        ALTER TABLE pings ADD COLUMN media_encrypted INTEGER DEFAULT 0;
      `);
      console.log('✅ Media fields added to pings table');
    }

    // v2.8.0 - Video Feed: Add index for efficient video feed queries
    const existingIndexes = this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_pings_video_feed'`).get();
    if (!existingIndexes) {
      console.log('📝 Adding video feed index (v2.8.0)...');
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pings_video_feed
        ON pings(media_type, created_at DESC)
        WHERE media_type = 'video' AND deleted = 0;
      `);
      console.log('✅ Video feed index created');
    }

    // v2.9.0 - Profile Waves: Add columns for profile wave identification
    const wavesColumnsV290 = this.db.prepare(`PRAGMA table_info(waves)`).all();
    const hasProfileWaveColumn = wavesColumnsV290.some(c => c.name === 'is_profile_wave');

    if (!hasProfileWaveColumn) {
      console.log('📝 Adding profile wave columns to waves table (v2.9.0)...');
      this.db.exec(`
        ALTER TABLE waves ADD COLUMN is_profile_wave INTEGER DEFAULT 0;
        ALTER TABLE waves ADD COLUMN profile_owner_id TEXT REFERENCES users(id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_waves_profile_owner
        ON waves(profile_owner_id) WHERE is_profile_wave = 1;
      `);
      console.log('✅ Profile wave columns added to waves table');
    }

    // v2.11.0 - Custom Themes: Add tables for user-created themes
    const customThemesExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='custom_themes'
    `).get();

    if (!customThemesExists) {
      console.log('📝 Adding custom themes tables (v2.11.0)...');

      // Create custom_themes table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS custom_themes (
          id TEXT PRIMARY KEY,
          creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          variables TEXT NOT NULL,
          is_public INTEGER DEFAULT 0,
          install_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS custom_theme_installs (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          theme_id TEXT NOT NULL REFERENCES custom_themes(id) ON DELETE CASCADE,
          installed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, theme_id)
        );

        CREATE INDEX IF NOT EXISTS idx_custom_themes_creator
        ON custom_themes(creator_id);

        CREATE INDEX IF NOT EXISTS idx_custom_themes_public
        ON custom_themes(is_public) WHERE is_public = 1;

        CREATE INDEX IF NOT EXISTS idx_custom_theme_installs_user
        ON custom_theme_installs(user_id);

        CREATE INDEX IF NOT EXISTS idx_custom_theme_installs_theme
        ON custom_theme_installs(theme_id);
      `);

      console.log('✅ Custom themes tables created');
    }

    // v2.14.0 - Jellyfin Integration: Connection management, watch parties, and feed imports
    const jellyfinConnectionsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='jellyfin_connections'
    `).get();

    if (!jellyfinConnectionsExists) {
      console.log('📝 Adding Jellyfin integration tables (v2.14.0)...');

      this.db.exec(`
        -- Jellyfin user connections (encrypted tokens)
        CREATE TABLE IF NOT EXISTS jellyfin_connections (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          server_url TEXT NOT NULL,
          access_token TEXT,
          jellyfin_user_id TEXT,
          server_name TEXT,
          status TEXT DEFAULT 'active',
          last_connected TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(user_id, server_url)
        );

        CREATE INDEX IF NOT EXISTS idx_jellyfin_connections_user
        ON jellyfin_connections(user_id);

        CREATE INDEX IF NOT EXISTS idx_jellyfin_connections_status
        ON jellyfin_connections(status);

        -- Watch party sessions for synchronized playback
        CREATE TABLE IF NOT EXISTS watch_parties (
          id TEXT PRIMARY KEY,
          wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          host_user_id TEXT NOT NULL REFERENCES users(id),
          jellyfin_connection_id TEXT NOT NULL REFERENCES jellyfin_connections(id),
          jellyfin_item_id TEXT NOT NULL,
          media_title TEXT,
          media_type TEXT,
          status TEXT DEFAULT 'active',
          playback_position INTEGER DEFAULT 0,
          is_playing INTEGER DEFAULT 0,
          last_sync_at TEXT,
          created_at TEXT NOT NULL,
          ended_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_watch_parties_wave
        ON watch_parties(wave_id);

        CREATE INDEX IF NOT EXISTS idx_watch_parties_status
        ON watch_parties(status);

        CREATE INDEX IF NOT EXISTS idx_watch_parties_host
        ON watch_parties(host_user_id);

        -- Video feed imports from Jellyfin
        CREATE TABLE IF NOT EXISTS jellyfin_feed_imports (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          connection_id TEXT NOT NULL REFERENCES jellyfin_connections(id) ON DELETE CASCADE,
          jellyfin_item_id TEXT NOT NULL,
          title TEXT NOT NULL,
          thumbnail_url TEXT,
          duration_ticks INTEGER,
          media_type TEXT DEFAULT 'Video',
          imported_at TEXT NOT NULL,
          UNIQUE(user_id, jellyfin_item_id)
        );

        CREATE INDEX IF NOT EXISTS idx_jellyfin_feed_imports_user
        ON jellyfin_feed_imports(user_id);

        CREATE INDEX IF NOT EXISTS idx_jellyfin_feed_imports_connection
        ON jellyfin_feed_imports(connection_id);
      `);

      console.log('✅ Jellyfin integration tables created');
    }

    // v2.15.0 - Plex Integration: Connection management with OAuth support
    const plexConnectionsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='plex_connections'
    `).get();

    if (!plexConnectionsExists) {
      console.log('📝 Adding Plex integration tables (v2.15.0)...');

      this.db.exec(`
        -- Plex user connections (encrypted tokens)
        CREATE TABLE IF NOT EXISTS plex_connections (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          server_url TEXT NOT NULL,
          access_token TEXT,
          plex_user_id TEXT,
          server_name TEXT,
          machine_identifier TEXT,
          status TEXT DEFAULT 'active',
          last_connected TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(user_id, server_url)
        );

        CREATE INDEX IF NOT EXISTS idx_plex_connections_user
        ON plex_connections(user_id);

        CREATE INDEX IF NOT EXISTS idx_plex_connections_status
        ON plex_connections(status);
      `);

      console.log('✅ Plex integration tables created');
    }

    // v2.15.5 - Outgoing Webhooks: Auto-forward messages to Discord, Slack, etc.
    const webhooksTableExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='wave_webhooks'
    `).get();

    if (!webhooksTableExists) {
      console.log('📝 Adding outgoing webhooks table (v2.15.5)...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS wave_webhooks (
          id TEXT PRIMARY KEY,
          wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          platform TEXT DEFAULT 'generic',
          enabled INTEGER DEFAULT 1,
          include_bot_messages INTEGER DEFAULT 1,
          include_encrypted INTEGER DEFAULT 0,
          cooldown_seconds INTEGER DEFAULT 0,
          last_triggered_at TEXT,
          total_sent INTEGER DEFAULT 0,
          total_errors INTEGER DEFAULT 0,
          last_error TEXT,
          last_error_at TEXT,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_wave_webhooks_wave ON wave_webhooks(wave_id);
        CREATE INDEX IF NOT EXISTS idx_wave_webhooks_enabled ON wave_webhooks(enabled);
      `);
      console.log('✅ Outgoing webhooks table created');
    }

    // v2.16.0 - Privacy Hardening: Email hash/encryption columns
    const emailHashColumn = this.db.prepare(`
      SELECT name FROM pragma_table_info('users') WHERE name = 'email_hash'
    `).get();

    if (!emailHashColumn) {
      console.log('📝 Adding email privacy columns (v2.16.0)...');
      this.db.exec(`
        ALTER TABLE users ADD COLUMN email_hash TEXT;
        ALTER TABLE users ADD COLUMN email_encrypted TEXT;
        ALTER TABLE users ADD COLUMN email_iv TEXT;
      `);

      // Create unique index on email_hash (allowing nulls for migration)
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash)
        WHERE email_hash IS NOT NULL;
      `);

      console.log('✅ Email privacy columns added');
      console.log('   Run email migration to populate email_hash/email_encrypted from existing emails');
    }

    // v2.30.0 - Drop legacy NOT NULL + UNIQUE constraints from email column
    // When email encryption is active, email column stores the hash (not plaintext).
    // Old schemas had: email TEXT UNIQUE NOT NULL — new schemas have: email TEXT
    const emailColInfo = this.db.prepare(`PRAGMA table_info(users)`).all();
    const emailCol = emailColInfo.find(c => c.name === 'email');
    if (emailCol && emailCol.notnull === 1) {
      console.log('📝 Migrating users table to remove email NOT NULL/UNIQUE constraints (v2.30.0)...');
      this.db.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN TRANSACTION;
        CREATE TABLE users_migrate (
          id TEXT PRIMARY KEY,
          handle TEXT UNIQUE NOT NULL COLLATE NOCASE,
          email TEXT COLLATE NOCASE,
          email_hash TEXT,
          email_encrypted TEXT,
          email_iv TEXT,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          avatar TEXT NOT NULL DEFAULT '?',
          avatar_url TEXT,
          bio TEXT,
          node_name TEXT DEFAULT 'Local',
          status TEXT DEFAULT 'offline',
          is_admin INTEGER DEFAULT 0,
          role TEXT DEFAULT 'user',
          created_at TEXT NOT NULL,
          last_seen TEXT,
          last_handle_change TEXT,
          require_password_change INTEGER DEFAULT 0,
          preferences TEXT DEFAULT '{"theme":"firefly","fontSize":"medium"}'
        );
        INSERT INTO users_migrate SELECT
          id, handle, email, email_hash, email_encrypted, email_iv,
          password_hash, COALESCE(display_name, handle), COALESCE(avatar, '?'),
          avatar_url, bio, COALESCE(node_name, 'Local'), COALESCE(status, 'offline'),
          COALESCE(is_admin, 0), COALESCE(role, 'user'), created_at, last_seen,
          last_handle_change, COALESCE(require_password_change, 0),
          COALESCE(preferences, '{"theme":"firefly","fontSize":"medium"}')
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrate RENAME TO users;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash) WHERE email_hash IS NOT NULL;
        COMMIT;
        PRAGMA foreign_keys=ON;
      `);
      // Clear plaintext emails for users that have encryption — set to NULL now that constraint is gone
      this.db.prepare(`
        UPDATE users SET email = NULL WHERE email_encrypted IS NOT NULL
      `).run();
      console.log('✅ Email constraints migrated — plaintext emails cleared for encrypted users');
    }

    // v2.18.0 - Privacy Hardening Phase 2: Encrypted contacts table
    const encryptedContactsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='encrypted_contacts'
    `).get();

    if (!encryptedContactsExists) {
      console.log('📝 Creating encrypted_contacts table (v2.18.0)...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS encrypted_contacts (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          encrypted_data TEXT NOT NULL,
          nonce TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      console.log('✅ Encrypted contacts table created');
    }

    // v2.21.0 - Privacy Hardening: Encrypted wave participation table
    const encryptedParticipantsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='wave_participants_encrypted'
    `).get();

    if (!encryptedParticipantsExists) {
      console.log('📝 Creating wave_participants_encrypted table (v2.21.0)...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS wave_participants_encrypted (
          wave_id TEXT PRIMARY KEY,
          participant_blob TEXT NOT NULL,
          iv TEXT NOT NULL,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
      `);
      console.log('✅ Encrypted wave participants table created');
      console.log('   Run migration endpoint to encrypt existing participation data');
    }

    // v2.22.0 - Privacy Hardening: Encrypted push subscriptions table
    const encryptedPushSubsExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions_encrypted'
    `).get();

    if (!encryptedPushSubsExists) {
      console.log('📝 Creating push_subscriptions_encrypted table (v2.22.0)...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS push_subscriptions_encrypted (
          user_hash TEXT PRIMARY KEY,
          subscriptions_blob TEXT NOT NULL,
          iv TEXT NOT NULL,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
      `);
      console.log('✅ Encrypted push subscriptions table created');
      console.log('   Run migration endpoint to encrypt existing push subscription data');
    }

    // Create crew_members_encrypted table if it doesn't exist (v2.24.0)
    const encryptedCrewMembersExists = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='crew_members_encrypted'
    `).get();

    if (!encryptedCrewMembersExists) {
      console.log('📝 Creating crew_members_encrypted table (v2.24.0)...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS crew_members_encrypted (
          crew_id TEXT PRIMARY KEY,
          member_blob TEXT NOT NULL,
          iv TEXT NOT NULL,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
      `);
      console.log('✅ Encrypted crew members table created');
      console.log('   Run migration endpoint to encrypt existing crew membership data');
    }

    // Wave user metadata - encrypted per-user wave settings (v2.27.0)
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS wave_user_metadata (
        lookup_key TEXT PRIMARY KEY,
        encrypted_data TEXT NOT NULL,
        iv TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `).run();

    // v2.27.0: Add blinded user_key_id column to wave_encryption_keys
    try {
      const cols = this.db.prepare("PRAGMA table_info(wave_encryption_keys)").all();
      if (!cols.some(c => c.name === 'user_key_id')) {
        this.db.prepare('ALTER TABLE wave_encryption_keys ADD COLUMN user_key_id TEXT').run();
        console.log('✅ Added user_key_id column to wave_encryption_keys');
      }
    } catch (err) {
      // Column may already exist
    }

    // v2.28.0: Add protocol_version column to federation_nodes
    try {
      const fedCols = this.db.prepare("PRAGMA table_info(federation_nodes)").all();
      if (!fedCols.some(c => c.name === 'protocol_version')) {
        this.db.prepare('ALTER TABLE federation_nodes ADD COLUMN protocol_version INTEGER DEFAULT 1').run();
        console.log('✅ Added protocol_version column to federation_nodes');
      }
    } catch (err) {
      // Column may already exist
    }

    // v2.31.3: Add notification_preferences column to users table
    try {
      const userCols = this.db.prepare("PRAGMA table_info(users)").all();
      if (!userCols.some(c => c.name === 'notification_preferences')) {
        this.db.prepare('ALTER TABLE users ADD COLUMN notification_preferences TEXT DEFAULT NULL').run();
        console.log('✅ Added notification_preferences column to users');
      }
    } catch (err) {
      // Column may already exist
    }
  }

  prepareStatements() {
    // User statements
    this.stmts = {
      // Handle lookup - supports both handle and email (via hash or legacy plaintext)
      findUserByHandle: this.db.prepare(`
        SELECT * FROM users WHERE handle = ? COLLATE NOCASE OR email = ? COLLATE NOCASE OR email_hash = ?
      `),
      findUserById: this.db.prepare('SELECT * FROM users WHERE id = ?'),
      // New users get email_hash, email_encrypted, email_iv instead of plaintext email
      insertUser: this.db.prepare(`
        INSERT INTO users (id, handle, email, email_hash, email_encrypted, email_iv, password_hash, display_name, avatar, avatar_url, bio, node_name, status, is_admin, role, created_at, last_seen, last_handle_change, preferences)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateUser: this.db.prepare(`
        UPDATE users SET handle = ?, email = ?, display_name = ?, avatar = ?, avatar_url = ?, bio = ?, node_name = ?, status = ?, is_admin = ?, role = ?, last_seen = ?, last_handle_change = ?, preferences = ?
        WHERE id = ?
      `),
      updateUserStatus: this.db.prepare('UPDATE users SET status = ?, last_seen = ? WHERE id = ?'),
      updateUserPassword: this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
      countUsers: this.db.prepare('SELECT COUNT(*) as count FROM users'),
      searchUsers: this.db.prepare(`
        SELECT id, handle, display_name, avatar, status, node_name
        FROM users
        WHERE id != ? AND (handle LIKE ? OR display_name LIKE ?)
        LIMIT 10
      `),
      // Find user by email hash (for login/lookup)
      findUserByEmailHash: this.db.prepare('SELECT * FROM users WHERE email_hash = ?'),
    };
  }

  seedDemoData() {
    console.log('🌱 Seeding demo data...');
    const passwordHash = bcrypt.hashSync('Demo123!', 12);
    const now = new Date().toISOString();

    const demoUsers = [
      { id: 'user-mal', handle: 'mal', email: 'mal@serenity.ship', displayName: 'Malcolm Reynolds', avatar: 'M', isAdmin: true },
      { id: 'user-zoe', handle: 'zoe', email: 'zoe@serenity.ship', displayName: 'Zoe Washburne', avatar: 'Z', isAdmin: false },
      { id: 'user-wash', handle: 'wash', email: 'wash@serenity.ship', displayName: 'Hoban Washburne', avatar: 'W', isAdmin: false },
      { id: 'user-kaylee', handle: 'kaylee', email: 'kaylee@serenity.ship', displayName: 'Kaylee Frye', avatar: 'K', isAdmin: false },
      { id: 'user-jayne', handle: 'jayne', email: 'jayne@serenity.ship', displayName: 'Jayne Cobb', avatar: 'J', isAdmin: false },
    ];

    const insertUser = this.db.prepare(`
      INSERT INTO users (id, handle, email, password_hash, display_name, avatar, node_name, status, is_admin, created_at, last_seen, preferences)
      VALUES (?, ?, ?, ?, ?, ?, 'Serenity', 'offline', ?, ?, ?, '{"theme":"firefly","fontSize":"medium"}')
    `);

    for (const u of demoUsers) {
      insertUser.run(u.id, u.handle, u.email, passwordHash, u.displayName, u.avatar, u.isAdmin ? 1 : 0, now, now);
    }

    // Create demo crew
    this.db.prepare(`
      INSERT INTO crews (id, name, description, created_by, created_at)
      VALUES ('crew-serenity', 'Serenity Crew', 'The crew of Serenity', 'user-mal', ?)
    `).run(now);

    const insertMember = this.db.prepare(`
      INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ('crew-serenity', ?, ?, ?)
    `);
    for (const u of demoUsers) {
      insertMember.run(u.id, u.id === 'user-mal' ? 'admin' : 'member', now);
    }

    // Demo waves
    const waves = [
      { id: 'wave-1', title: 'Welcome to Cortex', privacy: 'public', createdBy: 'user-mal' },
      { id: 'wave-2', title: 'Private Chat Test', privacy: 'private', createdBy: 'user-mal' },
      { id: 'wave-3', title: 'Crew Discussion', privacy: 'group', groupId: 'group-crew', createdBy: 'user-mal' },
      { id: 'wave-4', title: 'Zoe Private Wave', privacy: 'private', createdBy: 'user-zoe' },
      { id: 'wave-5', title: 'Wash Public Wave', privacy: 'public', createdBy: 'user-wash' },
    ];

    const insertWave = this.db.prepare(`
      INSERT INTO waves (id, title, privacy, crew_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const w of waves) {
      insertWave.run(w.id, w.title, w.privacy, w.groupId || null, w.createdBy, now, now);
    }

    // Wave participants
    const participants = [
      { waveId: 'wave-1', userId: 'user-mal' },
      { waveId: 'wave-2', userId: 'user-mal' },
      { waveId: 'wave-2', userId: 'user-zoe' },
      { waveId: 'wave-3', userId: 'user-mal' },
      { waveId: 'wave-3', userId: 'user-zoe' },
      { waveId: 'wave-3', userId: 'user-wash' },
      { waveId: 'wave-4', userId: 'user-zoe' },
      { waveId: 'wave-4', userId: 'user-mal' },
      { waveId: 'wave-5', userId: 'user-wash' },
    ];

    const insertParticipant = this.db.prepare(`
      INSERT INTO wave_participants (wave_id, user_id, joined_at, archived) VALUES (?, ?, ?, 0)
    `);
    for (const p of participants) {
      insertParticipant.run(p.waveId, p.userId, now);
    }

    // Demo droplets
    const pings = [
      { id: 'ping-1', waveId: 'wave-1', authorId: 'user-mal', content: 'Welcome to Farhold! This is a public wave visible to everyone.', privacy: 'public' },
      { id: 'ping-2', waveId: 'wave-2', authorId: 'user-mal', content: 'This is a private wave for testing.', privacy: 'private' },
      { id: 'ping-3', waveId: 'wave-3', authorId: 'user-mal', content: 'This is a crew wave for the Serenity crew.', privacy: 'crew' },
      { id: 'ping-4', waveId: 'wave-4', authorId: 'user-zoe', content: "Zoe's private wave.", privacy: 'private' },
      { id: 'ping-5', waveId: 'wave-5', authorId: 'user-wash', content: "Wash's public wave.", privacy: 'public' },
    ];

    const insertPing = this.db.prepare(`
      INSERT INTO pings (id, wave_id, author_id, content, privacy, version, created_at, reactions)
      VALUES (?, ?, ?, ?, ?, 1, ?, '{}')
    `);
    const insertReadBy = this.db.prepare(`
      INSERT INTO ping_read_by (ping_id, user_id, read_at) VALUES (?, ?, ?)
    `);

    for (const p of pings) {
      insertPing.run(p.id, p.waveId, p.authorId, p.content, p.privacy, now);
      insertReadBy.run(p.id, p.authorId, now);
    }

    console.log('✅ Demo data seeded (password: Demo123!)');
  }

  // Helper to convert SQLite row to user object
  rowToUser(row) {
    if (!row) return null;
    // Determine role: use role column if present, otherwise derive from is_admin for backward compat
    const role = row.role || (row.is_admin === 1 ? 'admin' : 'user');

    // For email, prefer decrypted email if encrypted, else legacy plaintext, else masked hash
    let email = row.email; // Legacy plaintext
    if (!email && row.email_encrypted && row.email_iv) {
      email = decryptEmail(row.email_encrypted, row.email_iv);
    }
    // If still no email (decryption failed or no encryption key), use a masked placeholder
    if (!email && row.email_hash) {
      email = `[protected:${row.email_hash.substring(0, 8)}...]`;
    }

    return {
      id: row.id,
      handle: row.handle,
      email: email,
      emailHash: row.email_hash,  // For lookup purposes (not exposed to client)
      passwordHash: row.password_hash,
      displayName: row.display_name,
      avatar: row.avatar,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      nodeName: row.node_name,
      status: row.status,
      isAdmin: role === 'admin',  // Backward compat: computed from role
      role: role,  // New: explicit role field
      createdAt: row.created_at,
      lastSeen: row.last_seen,
      lastHandleChange: row.last_handle_change,
      preferences: row.preferences ? JSON.parse(row.preferences) : { theme: 'firefly', fontSize: 'medium' },
      notificationPreferences: row.notification_preferences ? JSON.parse(row.notification_preferences) : null,
      handleHistory: this.getHandleHistory(row.id),
    };
  }

  getHandleHistory(userId) {
    const rows = this.db.prepare('SELECT old_handle, changed_at FROM handle_history WHERE user_id = ? ORDER BY changed_at DESC').all(userId);
    return rows.map(r => ({ handle: r.old_handle, changedAt: r.changed_at }));
  }

  // === User Methods ===
  findUserByHandle(handle) {
    if (!handle) return null;
    const sanitized = handle.toLowerCase().trim();

    // Check if input looks like an email (contains @)
    // If so, also compute email hash for lookup
    const emailHash = sanitized.includes('@') ? hashEmail(sanitized) : null;

    const row = this.stmts.findUserByHandle.get(sanitized, sanitized, emailHash);
    return this.rowToUser(row);
  }

  findUserById(id) {
    if (!id) return null;
    const row = this.stmts.findUserById.get(id);
    return this.rowToUser(row);
  }

  getAllUsers() {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
    return rows.map(r => this.rowToUser(r));
  }

  getPublicStats() {
    const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const waveCount = this.db.prepare('SELECT COUNT(*) as count FROM waves').get().count;
    return { userCount, waveCount };
  }

  getAdminUsers() {
    const rows = this.db.prepare('SELECT * FROM users WHERE is_admin = 1').all();
    return rows.map(r => this.rowToUser(r));
  }

  createUser(userData) {
    const now = new Date().toISOString();
    const isFirstUser = this.stmts.countUsers.get().count === 0;
    const role = isFirstUser ? 'admin' : 'user';

    // Privacy hardening (v2.16.0): Hash and encrypt email
    const emailHash = hashEmail(userData.email);
    const emailEncryption = encryptEmail(userData.email);

    const user = {
      id: userData.id,
      handle: userData.handle,
      email: emailEncryption ? null : userData.email, // No plaintext email when encryption is active
      emailHash: emailHash,
      emailEncrypted: emailEncryption?.encrypted || null,
      emailIv: emailEncryption?.iv || null,
      passwordHash: userData.passwordHash,
      displayName: userData.displayName,
      avatar: userData.avatar || '?',
      avatarUrl: userData.avatarUrl || null,
      bio: userData.bio || null,
      nodeName: userData.nodeName || 'Local',
      status: userData.status || 'online',
      isAdmin: role === 'admin',  // Backward compat
      role: role,
      createdAt: now,
      lastSeen: now,
      lastHandleChange: null,
      preferences: userData.preferences || { theme: 'firefly', fontSize: 'medium' },
      handleHistory: [],
    };

    this.stmts.insertUser.run(
      user.id, user.handle, user.email, user.emailHash, user.emailEncrypted, user.emailIv,
      user.passwordHash, user.displayName,
      user.avatar, user.avatarUrl, user.bio, user.nodeName, user.status,
      user.isAdmin ? 1 : 0, user.role, user.createdAt, user.lastSeen, user.lastHandleChange,
      JSON.stringify(user.preferences)
    );

    return user;
  }

  updateUser(userId, updates) {
    const user = this.findUserById(userId);
    if (!user) return null;

    const updated = { ...user, ...updates };
    // Ensure role is synced with isAdmin for backward compat
    if (updates.isAdmin !== undefined && updates.role === undefined) {
      updated.role = updates.isAdmin ? 'admin' : 'user';
    }

    // If email changed, update encryption fields too
    if (updates.email && updates.email !== user.email) {
      const newHash = hashEmail(updates.email);
      const newEncryption = encryptEmail(updates.email);
      updated.email = newEncryption ? newHash : updates.email;
      updated.emailHash = newHash;
      updated.emailEncrypted = newEncryption?.encrypted || null;
      updated.emailIv = newEncryption?.iv || null;
      // Update encrypted email fields
      this.db.prepare(`
        UPDATE users SET email_hash = ?, email_encrypted = ?, email_iv = ?
        WHERE id = ?
      `).run(updated.emailHash, updated.emailEncrypted, updated.emailIv, userId);
    }

    this.db.prepare(`
      UPDATE users SET
        handle = ?, email = ?, display_name = ?, avatar = ?, avatar_url = ?,
        bio = ?, node_name = ?, status = ?, is_admin = ?, role = ?, last_seen = ?,
        last_handle_change = ?, preferences = ?
      WHERE id = ?
    `).run(
      updated.handle, updated.email, updated.displayName, updated.avatar, updated.avatarUrl,
      updated.bio, updated.nodeName, updated.status, updated.isAdmin ? 1 : 0, updated.role || 'user', updated.lastSeen,
      updated.lastHandleChange, JSON.stringify(updated.preferences), userId
    );

    return this.findUserById(userId);
  }

  updateUserStatus(userId, status) {
    const now = new Date().toISOString();
    this.stmts.updateUserStatus.run(status, now, userId);
  }

  /**
   * Update user's role (admin only operation)
   * @param {string} userId - User ID to update
   * @param {string} role - New role ('admin', 'moderator', 'user')
   * @returns {{ success: boolean, user?: object, error?: string }}
   */
  updateUserRole(userId, role) {
    const validRoles = ['admin', 'moderator', 'user'];
    if (!validRoles.includes(role)) {
      return { success: false, error: 'Invalid role' };
    }

    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Prevent demoting the last admin
    if (user.role === 'admin' && role !== 'admin') {
      const adminCount = this.db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin').count;
      if (adminCount <= 1) {
        return { success: false, error: 'Cannot demote the last admin' };
      }
    }

    const isAdmin = role === 'admin' ? 1 : 0;
    this.db.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?').run(role, isAdmin, userId);

    return { success: true, user: this.findUserById(userId) };
  }

  updateUserPreferences(userId, preferences) {
    const user = this.findUserById(userId);
    if (!user) return null;

    const updatedPrefs = { ...user.preferences, ...preferences };
    this.db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify(updatedPrefs),
      userId
    );
    return updatedPrefs;
  }

  updateNotificationPreferences(userId, updates) {
    const user = this.findUserById(userId);
    if (!user) return null;

    const DEFAULT_NOTIFICATION_PREFS = {
      enabled: true,
      directMentions: 'always',
      replies: 'always',
      waveActivity: 'app_closed',
      burstEvents: 'app_closed',
      soundEnabled: false,
      suppressWhileFocused: true,
      pushDebounceMinutes: 5,
    };

    const currentPrefs = user.notificationPreferences || DEFAULT_NOTIFICATION_PREFS;
    const updatedPrefs = { ...currentPrefs, ...updates };
    this.db.prepare('UPDATE users SET notification_preferences = ? WHERE id = ?').run(
      JSON.stringify(updatedPrefs),
      userId
    );
    return updatedPrefs;
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = this.findUserById(userId);
    if (!user) return { success: false, error: 'User not found' };

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return { success: false, error: 'Current password is incorrect' };

    // Simple password validation (detailed validation done in route)
    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    this.stmts.updateUserPassword.run(newHash, userId);
    return { success: true };
  }

  // ============ Account Lockout Methods ============

  /**
   * Record a failed login attempt for rate limiting
   * @param {string} handle - User handle or email
   * @returns {{locked: boolean, attemptsRemaining: number, lockedUntil?: string}}
   */
  recordFailedLogin(handle) {
    const now = new Date();
    const normalizedHandle = handle.toLowerCase();

    // Get current lockout status
    let lockout = this.db.prepare('SELECT * FROM account_lockouts WHERE handle = ?').get(normalizedHandle);

    // Check if currently locked
    if (lockout?.locked_until && new Date(lockout.locked_until) > now) {
      return {
        locked: true,
        attemptsRemaining: 0,
        lockedUntil: lockout.locked_until
      };
    }

    // If lock expired, reset
    if (lockout?.locked_until && new Date(lockout.locked_until) <= now) {
      this.db.prepare('DELETE FROM account_lockouts WHERE handle = ?').run(normalizedHandle);
      lockout = null;
    }

    const failedAttempts = (lockout?.failed_attempts || 0) + 1;
    const maxAttempts = 5;
    const lockoutMinutes = 15;

    if (failedAttempts >= maxAttempts) {
      // Lock the account
      const lockedUntil = new Date(now.getTime() + lockoutMinutes * 60 * 1000).toISOString();
      this.db.prepare(`
        INSERT OR REPLACE INTO account_lockouts (handle, failed_attempts, locked_until, last_attempt)
        VALUES (?, ?, ?, ?)
      `).run(normalizedHandle, failedAttempts, lockedUntil, now.toISOString());

      return {
        locked: true,
        attemptsRemaining: 0,
        lockedUntil
      };
    }

    // Update failed attempts
    this.db.prepare(`
      INSERT OR REPLACE INTO account_lockouts (handle, failed_attempts, locked_until, last_attempt)
      VALUES (?, ?, NULL, ?)
    `).run(normalizedHandle, failedAttempts, now.toISOString());

    return {
      locked: false,
      attemptsRemaining: maxAttempts - failedAttempts
    };
  }

  /**
   * Clear failed login attempts (on successful login)
   * @param {string} handle - User handle or email
   */
  clearFailedLogins(handle) {
    const normalizedHandle = handle.toLowerCase();
    this.db.prepare('DELETE FROM account_lockouts WHERE handle = ?').run(normalizedHandle);
  }

  /**
   * Check if an account is currently locked
   * @param {string} handle - User handle or email
   * @returns {{locked: boolean, lockedUntil?: string, attemptsRemaining: number}}
   */
  isAccountLocked(handle) {
    const normalizedHandle = handle.toLowerCase();
    const lockout = this.db.prepare('SELECT * FROM account_lockouts WHERE handle = ?').get(normalizedHandle);

    if (!lockout) {
      return { locked: false, attemptsRemaining: 5 };
    }

    const now = new Date();
    if (lockout.locked_until && new Date(lockout.locked_until) > now) {
      return {
        locked: true,
        lockedUntil: lockout.locked_until,
        attemptsRemaining: 0
      };
    }

    // Lock expired
    if (lockout.locked_until && new Date(lockout.locked_until) <= now) {
      this.db.prepare('DELETE FROM account_lockouts WHERE handle = ?').run(normalizedHandle);
      return { locked: false, attemptsRemaining: 5 };
    }

    return {
      locked: false,
      attemptsRemaining: 5 - (lockout.failed_attempts || 0)
    };
  }

  // ============ Password Reset Methods ============

  /**
   * Find user by email address (supports both hashed and legacy plaintext)
   * @param {string} email - Email address
   * @returns {Object|null} User object or null
   */
  findUserByEmail(email) {
    if (!email) return null;

    // First try email hash lookup (v2.16.0+)
    const emailHash = hashEmail(email);
    let row = this.db.prepare('SELECT * FROM users WHERE email_hash = ?').get(emailHash);

    // Fall back to legacy plaintext lookup (for unmigrated users)
    if (!row) {
      row = this.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    }

    if (!row) return null;
    return this.rowToUser(row);
  }

  /**
   * Get decrypted email for a user (for password reset emails)
   * @param {string} userId - User ID
   * @returns {string|null} Decrypted email or null if not available
   */
  getDecryptedEmail(userId) {
    const row = this.db.prepare(`
      SELECT email, email_encrypted, email_iv FROM users WHERE id = ?
    `).get(userId);

    if (!row) return null;

    // Try decrypting from encrypted storage first
    if (row.email_encrypted && row.email_iv) {
      const decrypted = decryptEmail(row.email_encrypted, row.email_iv);
      if (decrypted) return decrypted;
    }

    // Fall back to legacy plaintext email
    return row.email || null;
  }

  /**
   * Migrate existing user's plaintext email to hashed/encrypted format
   * @param {string} userId - User ID to migrate
   * @returns {boolean} Success
   */
  migrateUserEmail(userId) {
    const row = this.db.prepare('SELECT id, email FROM users WHERE id = ? AND email IS NOT NULL AND email_hash IS NULL').get(userId);
    if (!row || !row.email) return false;

    const emailHash = hashEmail(row.email);
    const emailEncryption = encryptEmail(row.email);

    if (emailEncryption) {
      // Full migration: hash + encrypt
      // Note: We keep plaintext email for backwards compatibility with existing NOT NULL constraints
      // A future schema migration can clear it after ALTER TABLE removes the constraint
      this.db.prepare(`
        UPDATE users SET email_hash = ?, email_encrypted = ?, email_iv = ?
        WHERE id = ?
      `).run(emailHash, emailEncryption.encrypted, emailEncryption.iv, userId);
    } else {
      // Partial migration: hash only (no encryption key configured)
      this.db.prepare(`
        UPDATE users SET email_hash = ? WHERE id = ?
      `).run(emailHash, userId);
    }

    return true;
  }

  /**
   * Migrate all users' emails to hashed/encrypted format (batch operation)
   * @returns {{migrated: number, errors: number}}
   */
  migrateAllUserEmails() {
    const users = this.db.prepare(`
      SELECT id, email FROM users WHERE email IS NOT NULL AND email_hash IS NULL
    `).all();

    let migrated = 0;
    let errors = 0;

    for (const user of users) {
      try {
        if (this.migrateUserEmail(user.id)) {
          migrated++;
        }
      } catch (err) {
        console.error(`Failed to migrate email for user ${user.id}:`, err.message);
        errors++;
      }
    }

    return { migrated, errors };
  }

  /**
   * Create a password reset token
   * @param {string} userId - User ID
   * @param {string} tokenHash - Hashed token (store hash, not plaintext)
   * @param {number} expiresInMinutes - Token validity in minutes (default: 60)
   * @returns {{id: string, expiresAt: string}}
   */
  createPasswordResetToken(userId, tokenHash, expiresInMinutes = 60) {
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000).toISOString();

    // Invalidate any existing tokens for this user
    this.db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);

    // Create new token
    this.db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, tokenHash, expiresAt, now.toISOString());

    return { id, expiresAt };
  }

  /**
   * Verify a password reset token
   * @param {string} tokenHash - Hashed token to verify
   * @returns {{valid: boolean, userId?: string, error?: string}}
   */
  verifyPasswordResetToken(tokenHash) {
    const token = this.db.prepare(`
      SELECT * FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL
    `).get(tokenHash);

    if (!token) {
      return { valid: false, error: 'Invalid or expired reset token' };
    }

    if (new Date(token.expires_at) < new Date()) {
      return { valid: false, error: 'Reset token has expired' };
    }

    return { valid: true, userId: token.user_id };
  }

  /**
   * Mark a password reset token as used
   * @param {string} tokenHash - Hashed token
   */
  markPasswordResetTokenUsed(tokenHash) {
    this.db.prepare(`
      UPDATE password_reset_tokens
      SET used_at = ?
      WHERE token_hash = ?
    `).run(new Date().toISOString(), tokenHash);
  }

  /**
   * Set password directly (used for password reset, admin reset)
   * @param {string} userId - User ID
   * @param {string} newPassword - New password (will be hashed)
   * @param {boolean} requireChange - Force password change on next login
   * @returns {{success: boolean, error?: string}}
   */
  async setPassword(userId, newPassword, requireChange = false) {
    const user = this.findUserById(userId);
    if (!user) return { success: false, error: 'User not found' };

    const newHash = await bcrypt.hash(newPassword, 12);
    this.db.prepare(`
      UPDATE users SET password_hash = ?, require_password_change = ?
      WHERE id = ?
    `).run(newHash, requireChange ? 1 : 0, userId);

    // Invalidate all reset tokens for this user
    this.db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);

    return { success: true };
  }

  /**
   * Check if user needs to change password
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  requiresPasswordChange(userId) {
    const row = this.db.prepare('SELECT require_password_change FROM users WHERE id = ?').get(userId);
    return row?.require_password_change === 1;
  }

  /**
   * Clear the password change requirement flag
   * @param {string} userId - User ID
   */
  clearPasswordChangeRequirement(userId) {
    this.db.prepare('UPDATE users SET require_password_change = 0 WHERE id = ?').run(userId);
  }

  /**
   * Clean up expired password reset tokens
   * @returns {number} Number of tokens deleted
   */
  cleanupExpiredResetTokens() {
    const result = this.db.prepare(`
      DELETE FROM password_reset_tokens
      WHERE expires_at < datetime('now')
    `).run();
    return result.changes;
  }

  // ============ Multi-Factor Authentication Methods ============

  /**
   * Get MFA settings for a user
   * @param {string} userId - User ID
   * @returns {Object|null} MFA settings or null
   */
  getMfaSettings(userId) {
    const row = this.db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId);
    if (!row) return null;
    return {
      userId: row.user_id,
      totpEnabled: row.totp_enabled === 1,
      emailMfaEnabled: row.email_mfa_enabled === 1,
      hasRecoveryCodes: !!row.recovery_codes,
      recoveryCodesGeneratedAt: row.recovery_codes_generated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Check if user has any MFA method enabled
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  hasMfaEnabled(userId) {
    const settings = this.getMfaSettings(userId);
    if (!settings) return false;
    return settings.totpEnabled || settings.emailMfaEnabled;
  }

  /**
   * Get enabled MFA methods for a user
   * @param {string} userId - User ID
   * @returns {string[]} Array of enabled methods
   */
  getEnabledMfaMethods(userId) {
    const settings = this.getMfaSettings(userId);
    if (!settings) return [];
    const methods = [];
    if (settings.totpEnabled) methods.push('totp');
    if (settings.emailMfaEnabled) methods.push('email');
    if (settings.hasRecoveryCodes) methods.push('recovery');
    return methods;
  }

  /**
   * Store pending TOTP secret (before verification)
   * @param {string} userId - User ID
   * @param {string} encryptedSecret - Encrypted TOTP secret
   */
  storePendingTotpSecret(userId, encryptedSecret) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT user_id FROM user_mfa WHERE user_id = ?').get(userId);

    if (existing) {
      this.db.prepare(`
        UPDATE user_mfa SET totp_secret = ?, updated_at = ?
        WHERE user_id = ?
      `).run(encryptedSecret, now, userId);
    } else {
      this.db.prepare(`
        INSERT INTO user_mfa (user_id, totp_secret, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, encryptedSecret, now, now);
    }
  }

  /**
   * Get stored TOTP secret for verification
   * @param {string} userId - User ID
   * @returns {string|null} Encrypted TOTP secret
   */
  getTotpSecret(userId) {
    const row = this.db.prepare('SELECT totp_secret FROM user_mfa WHERE user_id = ?').get(userId);
    return row?.totp_secret || null;
  }

  /**
   * Enable TOTP after successful verification
   * @param {string} userId - User ID
   */
  enableTotp(userId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE user_mfa SET totp_enabled = 1, updated_at = ?
      WHERE user_id = ?
    `).run(now, userId);
  }

  /**
   * Disable TOTP
   * @param {string} userId - User ID
   */
  disableTotp(userId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE user_mfa SET totp_enabled = 0, totp_secret = NULL, updated_at = ?
      WHERE user_id = ?
    `).run(now, userId);
  }

  /**
   * Enable email MFA
   * @param {string} userId - User ID
   */
  enableEmailMfa(userId) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT user_id FROM user_mfa WHERE user_id = ?').get(userId);

    if (existing) {
      this.db.prepare(`
        UPDATE user_mfa SET email_mfa_enabled = 1, updated_at = ?
        WHERE user_id = ?
      `).run(now, userId);
    } else {
      this.db.prepare(`
        INSERT INTO user_mfa (user_id, email_mfa_enabled, created_at, updated_at)
        VALUES (?, 1, ?, ?)
      `).run(userId, now, now);
    }
  }

  /**
   * Disable email MFA
   * @param {string} userId - User ID
   */
  disableEmailMfa(userId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE user_mfa SET email_mfa_enabled = 0, updated_at = ?
      WHERE user_id = ?
    `).run(now, userId);
  }

  /**
   * Store recovery codes (hashed)
   * @param {string} userId - User ID
   * @param {string[]} hashedCodes - Array of hashed recovery codes
   */
  storeRecoveryCodes(userId, hashedCodes) {
    const now = new Date().toISOString();
    const codesJson = JSON.stringify(hashedCodes);
    const existing = this.db.prepare('SELECT user_id FROM user_mfa WHERE user_id = ?').get(userId);

    if (existing) {
      this.db.prepare(`
        UPDATE user_mfa SET recovery_codes = ?, recovery_codes_generated_at = ?, updated_at = ?
        WHERE user_id = ?
      `).run(codesJson, now, now, userId);
    } else {
      this.db.prepare(`
        INSERT INTO user_mfa (user_id, recovery_codes, recovery_codes_generated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, codesJson, now, now, now);
    }
  }

  /**
   * Get recovery codes (hashed)
   * @param {string} userId - User ID
   * @returns {string[]} Array of hashed recovery codes
   */
  getRecoveryCodes(userId) {
    const row = this.db.prepare('SELECT recovery_codes FROM user_mfa WHERE user_id = ?').get(userId);
    if (!row?.recovery_codes) return [];
    try {
      return JSON.parse(row.recovery_codes);
    } catch {
      return [];
    }
  }

  /**
   * Remove a used recovery code
   * @param {string} userId - User ID
   * @param {number} codeIndex - Index of the used code
   */
  markRecoveryCodeUsed(userId, codeIndex) {
    const codes = this.getRecoveryCodes(userId);
    if (codeIndex >= 0 && codeIndex < codes.length) {
      codes.splice(codeIndex, 1);
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE user_mfa SET recovery_codes = ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(codes), now, userId);
    }
  }

  /**
   * Create an MFA challenge for login
   * @param {string} userId - User ID
   * @param {string} challengeType - Type of challenge (totp, email, recovery)
   * @param {string} codeHash - Hashed code for email challenges
   * @param {number} expiresInMinutes - Expiry time in minutes
   * @param {string} sessionDuration - Session duration for post-MFA token (24h, 7d, 30d)
   * @returns {{id: string, expiresAt: string}}
   */
  createMfaChallenge(userId, challengeType, codeHash = null, expiresInMinutes = 10, sessionDuration = '24h') {
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000).toISOString();

    // Clean up any existing challenges for this user
    this.db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(userId);

    this.db.prepare(`
      INSERT INTO mfa_challenges (id, user_id, challenge_type, code_hash, expires_at, created_at, session_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, challengeType, codeHash, expiresAt, now.toISOString(), sessionDuration);

    return { id, expiresAt };
  }

  /**
   * Get MFA challenge by ID
   * @param {string} challengeId - Challenge ID
   * @returns {Object|null} Challenge details or null
   */
  getMfaChallenge(challengeId) {
    // Defensive check for valid challengeId
    if (!challengeId || typeof challengeId !== 'string') {
      console.error('getMfaChallenge called with invalid challengeId:', challengeId);
      return null;
    }

    const row = this.db.prepare(`
      SELECT * FROM mfa_challenges
      WHERE id = ? AND verified_at IS NULL
    `).get(challengeId);

    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      // Expired, clean up
      this.db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(challengeId);
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      challengeType: row.challenge_type,
      codeHash: row.code_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      sessionDuration: row.session_duration || '24h'
    };
  }

  /**
   * Mark MFA challenge as verified
   * @param {string} challengeId - Challenge ID
   */
  markMfaChallengeVerified(challengeId) {
    this.db.prepare(`
      UPDATE mfa_challenges SET verified_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), challengeId);
  }

  /**
   * Delete MFA challenge
   * @param {string} challengeId - Challenge ID
   */
  deleteMfaChallenge(challengeId) {
    this.db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(challengeId);
  }

  /**
   * Clean up expired MFA challenges
   * @returns {number} Number of challenges deleted
   */
  cleanupExpiredMfaChallenges() {
    const result = this.db.prepare(`
      DELETE FROM mfa_challenges
      WHERE expires_at < datetime('now')
    `).run();
    return result.changes;
  }

  // ============ Activity Log Methods (updated v2.16.0 for privacy) ============

  /**
   * Log an activity event
   * IP and userAgent in metadata should be pre-anonymized by caller (v2.16.0)
   * Timestamps are rounded to 15-minute intervals for privacy
   * @param {string|null} userId - User ID (null for anonymous actions)
   * @param {string} actionType - Type of action (login, logout, password_change, etc.)
   * @param {string|null} resourceType - Type of resource (user, wave, droplet, etc.)
   * @param {string|null} resourceId - ID of the affected resource
   * @param {Object} metadata - Additional context (ip, userAgent, etc.) - should be anonymized
   * @returns {string} Activity log entry ID
   */
  logActivity(userId, actionType, resourceType = null, resourceId = null, metadata = {}) {
    const id = `act-${uuidv4()}`;
    // Round timestamp to 15-minute intervals for privacy
    const timestamp = roundTimestamp(new Date(), 15);

    this.db.prepare(`
      INSERT INTO activity_log (id, user_id, action_type, resource_type, resource_id, ip_address, user_agent, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      actionType,
      resourceType,
      resourceId,
      metadata.ip || null,
      metadata.userAgent || null,
      JSON.stringify(metadata),
      timestamp
    );

    return id;
  }

  /**
   * Get activity log entries with filters
   * @param {Object} filters - Filter options
   * @param {string} filters.userId - Filter by user ID
   * @param {string} filters.actionType - Filter by action type
   * @param {string} filters.resourceType - Filter by resource type
   * @param {string} filters.resourceId - Filter by resource ID
   * @param {string} filters.startDate - Filter by start date (ISO string)
   * @param {string} filters.endDate - Filter by end date (ISO string)
   * @param {number} filters.limit - Max entries to return (default 100)
   * @param {number} filters.offset - Offset for pagination (default 0)
   * @returns {Object} { entries, total }
   */
  getActivityLog(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.userId) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.actionType) {
      conditions.push('action_type = ?');
      params.push(filters.actionType);
    }
    if (filters.resourceType) {
      conditions.push('resource_type = ?');
      params.push(filters.resourceType);
    }
    if (filters.resourceId) {
      conditions.push('resource_id = ?');
      params.push(filters.resourceId);
    }
    if (filters.startDate) {
      conditions.push('created_at >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('created_at <= ?');
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    // Get total count
    const countRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM activity_log ${whereClause}
    `).get(...params);

    // Get entries with user info
    const entries = this.db.prepare(`
      SELECT
        a.*,
        u.handle as user_handle,
        u.display_name as user_display_name
      FROM activity_log a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // Parse metadata JSON
    return {
      activities: entries.map(e => ({
        ...e,
        metadata: e.metadata ? JSON.parse(e.metadata) : {}
      })),
      total: countRow.count
    };
  }

  /**
   * Get activity log for a specific user
   * @param {string} userId - User ID
   * @param {number} limit - Max entries (default 50)
   * @returns {Array} Activity entries
   */
  getUserActivityLog(userId, limit = 50) {
    const entries = this.db.prepare(`
      SELECT * FROM activity_log
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit);

    return entries.map(e => ({
      ...e,
      metadata: e.metadata ? JSON.parse(e.metadata) : {}
    }));
  }

  /**
   * Clean up old activity log entries
   * @param {number} daysOld - Delete entries older than this many days (default 90)
   * @returns {number} Number of entries deleted
   */
  cleanupOldActivityLogs(daysOld = 90) {
    const result = this.db.prepare(`
      DELETE FROM activity_log
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).run(daysOld);
    return result.changes;
  }

  /**
   * Get activity summary/statistics
   * @param {number} days - Number of days to summarize (default 7)
   * @returns {Object} Activity statistics
   */
  getActivityStats(days = 7) {
    const stats = this.db.prepare(`
      SELECT
        action_type,
        COUNT(*) as count
      FROM activity_log
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY action_type
      ORDER BY count DESC
    `).all(days);

    const totalLogins = this.db.prepare(`
      SELECT COUNT(*) as count FROM activity_log
      WHERE action_type = 'login' AND created_at >= datetime('now', '-' || ? || ' days')
    `).get(days);

    const failedLogins = this.db.prepare(`
      SELECT COUNT(*) as count FROM activity_log
      WHERE action_type = 'login_failed' AND created_at >= datetime('now', '-' || ? || ' days')
    `).get(days);

    const uniqueUsers = this.db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM activity_log
      WHERE user_id IS NOT NULL AND created_at >= datetime('now', '-' || ? || ' days')
    `).get(days);

    return {
      byActionType: stats,
      totalLogins: totalLogins.count,
      failedLogins: failedLogins.count,
      uniqueActiveUsers: uniqueUsers.count,
      periodDays: days
    };
  }

  requestHandleChange(userId, newHandle) {
    const user = this.findUserById(userId);
    if (!user) return { success: false, error: 'User not found' };

    // Check if handle is taken
    const existing = this.db.prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE AND id != ?').get(newHandle, userId);
    if (existing) return { success: false, error: 'Handle is already taken' };

    // Check cooldown (30 days)
    if (user.lastHandleChange) {
      const daysSince = (Date.now() - new Date(user.lastHandleChange).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) {
        return { success: false, error: `You can change your handle again in ${Math.ceil(30 - daysSince)} days` };
      }
    }

    // Check if handle was recently used by someone else (90 day reservation)
    const recentlyUsed = this.db.prepare(`
      SELECT 1 FROM handle_history
      WHERE old_handle = ? COLLATE NOCASE
      AND changed_at > datetime('now', '-90 days')
    `).get(newHandle);
    if (recentlyUsed) return { success: false, error: 'This handle was recently used and is reserved for 90 days' };

    // Create request
    const request = {
      id: `req-${uuidv4()}`,
      userId,
      currentHandle: user.handle,
      newHandle: newHandle,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO handle_requests (id, user_id, current_handle, new_handle, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(request.id, request.userId, request.currentHandle, request.newHandle, request.status, request.createdAt);

    return { success: true, request };
  }

  approveHandleChange(requestId, adminId) {
    const admin = this.findUserById(adminId);
    if (!admin?.isAdmin) return { success: false, error: 'Not authorized' };

    const request = this.db.prepare('SELECT * FROM handle_requests WHERE id = ?').get(requestId);
    if (!request || request.status !== 'pending') {
      return { success: false, error: 'Request not found or already processed' };
    }

    const user = this.findUserById(request.user_id);
    if (!user) return { success: false, error: 'User not found' };

    const now = new Date().toISOString();

    // Store old handle in history
    this.db.prepare('INSERT INTO handle_history (user_id, old_handle, changed_at) VALUES (?, ?, ?)').run(user.id, user.handle, now);

    // Update handle
    this.db.prepare('UPDATE users SET handle = ?, last_handle_change = ? WHERE id = ?').run(request.new_handle, now, user.id);

    // Update request
    this.db.prepare(`
      UPDATE handle_requests SET status = 'approved', processed_at = ?, processed_by = ? WHERE id = ?
    `).run(now, adminId, requestId);

    return { success: true };
  }

  rejectHandleChange(requestId, adminId, reason) {
    const admin = this.findUserById(adminId);
    if (!admin?.isAdmin) return { success: false, error: 'Not authorized' };

    const request = this.db.prepare('SELECT * FROM handle_requests WHERE id = ?').get(requestId);
    if (!request || request.status !== 'pending') {
      return { success: false, error: 'Request not found or already processed' };
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE handle_requests SET status = 'rejected', reason = ?, processed_at = ?, processed_by = ? WHERE id = ?
    `).run(reason, now, adminId, requestId);

    return { success: true };
  }

  getPendingHandleRequests() {
    return this.db.prepare(`
      SELECT * FROM handle_requests WHERE status = 'pending' ORDER BY created_at DESC
    `).all().map(r => ({
      id: r.id,
      userId: r.user_id,
      currentHandle: r.current_handle,
      newHandle: r.new_handle,
      status: r.status,
      reason: r.reason,
      createdAt: r.created_at,
      processedAt: r.processed_at,
      processedBy: r.processed_by,
    }));
  }

  searchUsers(query, excludeUserId) {
    if (!query || query.length < 2) return [];
    const pattern = `%${query}%`;
    const rows = this.stmts.searchUsers.all(excludeUserId, pattern, pattern);
    return rows.map(r => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name,
      avatar: r.avatar,
      status: r.status,
      nodeName: r.node_name,
    }));
  }

  // Admin user search - returns more details including email and MFA status
  adminSearchUsers(query) {
    if (!query || query.length < 1) return [];
    const pattern = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT u.id, u.handle, u.display_name, u.email, u.avatar, u.avatar_url, u.is_admin, u.role, u.created_at,
             CASE WHEN m.totp_enabled = 1 OR m.email_mfa_enabled = 1 THEN 1 ELSE 0 END as mfa_enabled,
             m.totp_enabled, m.email_mfa_enabled
      FROM users u
      LEFT JOIN user_mfa m ON u.id = m.user_id
      WHERE u.handle LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?
      ORDER BY u.handle
      LIMIT 20
    `).all(pattern, pattern, pattern);

    return rows.map(r => {
      // Determine role: use role column if present, otherwise derive from is_admin for backward compat
      const role = r.role || (r.is_admin === 1 ? 'admin' : 'user');
      return {
        id: r.id,
        handle: r.handle,
        displayName: r.display_name,
        email: r.email,
        avatar: r.avatar,
        avatarUrl: r.avatar_url,
        isAdmin: role === 'admin',
        role: role,
        createdAt: r.created_at,
        mfaEnabled: r.mfa_enabled === 1,
        totpEnabled: r.totp_enabled === 1,
        emailMfaEnabled: r.email_mfa_enabled === 1,
      };
    });
  }

  // === Contact Methods ===
  getContactsForUser(userId) {
    // Get local user contacts
    const localRows = this.db.prepare(`
      SELECT u.id, u.handle, u.display_name, u.avatar, u.avatar_url, u.status, NULL as node_name
      FROM contacts c
      JOIN users u ON c.contact_id = u.id
      WHERE c.user_id = ?
    `).all(userId);

    // Get remote user contacts (federated follows)
    const remoteRows = this.db.prepare(`
      SELECT ru.id, ru.handle, ru.display_name, ru.avatar, ru.avatar_url, 'online' as status, ru.node_name
      FROM contacts c
      JOIN remote_users ru ON c.contact_id = ru.id
      WHERE c.user_id = ?
    `).all(userId);

    const allRows = [...localRows, ...remoteRows];

    return allRows.map(r => ({
      id: r.id,
      handle: r.handle,
      name: r.display_name,
      avatar: r.avatar,
      avatarUrl: r.avatar_url,
      status: r.status,
      nodeName: r.node_name || null,
      isRemote: !!r.node_name,
    }));
  }

  addContact(userId, contactId) {
    try {
      this.db.prepare('INSERT INTO contacts (user_id, contact_id, added_at) VALUES (?, ?, ?)').run(userId, contactId, new Date().toISOString());
      return true;
    } catch (err) {
      // Unique constraint violation means already exists
      return false;
    }
  }

  removeContact(userId, contactId) {
    const result = this.db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(userId, contactId);
    return result.changes > 0;
  }

  isContact(userId, contactId) {
    const row = this.db.prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?').get(userId, contactId);
    return !!row;
  }

  // === Contact Request Methods ===
  createContactRequest(fromUserId, toUserId, message = null) {
    const fromUser = this.findUserById(fromUserId);
    const toUser = this.findUserById(toUserId);
    if (!fromUser || !toUser) return { error: 'User not found' };
    if (fromUserId === toUserId) return { error: 'Cannot add yourself as a contact' };
    if (this.isContact(fromUserId, toUserId)) return { error: 'Already a contact' };
    if (this.isBlocked(toUserId, fromUserId)) return { error: 'Cannot send request to this user' };

    // Check for existing pending request
    const existing = this.db.prepare(`
      SELECT id, from_user_id FROM contact_requests
      WHERE status = 'pending' AND (
        (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
      )
    `).get(fromUserId, toUserId, toUserId, fromUserId);

    if (existing) {
      return { error: existing.from_user_id === fromUserId ? 'Request already pending' : 'This user has already sent you a request' };
    }

    const request = {
      id: uuidv4(),
      from_user_id: fromUserId,
      to_user_id: toUserId,
      message: message,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO contact_requests (id, from_user_id, to_user_id, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(request.id, request.from_user_id, request.to_user_id, request.message, request.status, request.created_at);

    return {
      ...request,
      from_user: { id: fromUser.id, handle: fromUser.handle, displayName: fromUser.displayName, avatar: fromUser.avatar },
      to_user: { id: toUser.id, handle: toUser.handle, displayName: toUser.displayName, avatar: toUser.avatar },
    };
  }

  getContactRequestsForUser(userId) {
    const rows = this.db.prepare(`
      SELECT cr.*, u.id as fu_id, u.handle as fu_handle, u.display_name as fu_display_name, u.avatar as fu_avatar
      FROM contact_requests cr
      JOIN users u ON cr.from_user_id = u.id
      WHERE cr.to_user_id = ? AND cr.status = 'pending'
    `).all(userId);

    return rows.map(r => ({
      id: r.id,
      from_user_id: r.from_user_id,
      to_user_id: r.to_user_id,
      message: r.message,
      status: r.status,
      created_at: r.created_at,
      responded_at: r.responded_at,
      from_user: { id: r.fu_id, handle: r.fu_handle, displayName: r.fu_display_name, avatar: r.fu_avatar },
    }));
  }

  getSentContactRequests(userId) {
    const rows = this.db.prepare(`
      SELECT cr.*, u.id as tu_id, u.handle as tu_handle, u.display_name as tu_display_name, u.avatar as tu_avatar
      FROM contact_requests cr
      JOIN users u ON cr.to_user_id = u.id
      WHERE cr.from_user_id = ? AND cr.status = 'pending'
    `).all(userId);

    return rows.map(r => ({
      id: r.id,
      from_user_id: r.from_user_id,
      to_user_id: r.to_user_id,
      message: r.message,
      status: r.status,
      created_at: r.created_at,
      responded_at: r.responded_at,
      to_user: { id: r.tu_id, handle: r.tu_handle, displayName: r.tu_display_name, avatar: r.tu_avatar },
    }));
  }

  getContactRequest(requestId) {
    return this.db.prepare('SELECT * FROM contact_requests WHERE id = ?').get(requestId);
  }

  acceptContactRequest(requestId, userId) {
    const request = this.getContactRequest(requestId);
    if (!request) return { error: 'Request not found' };
    if (request.to_user_id !== userId) return { error: 'Not authorized' };
    if (request.status !== 'pending') return { error: 'Request already processed' };

    const now = new Date().toISOString();

    // Update request
    this.db.prepare('UPDATE contact_requests SET status = ?, responded_at = ? WHERE id = ?').run('accepted', now, requestId);

    // Create mutual contacts
    this.addContact(request.from_user_id, request.to_user_id);
    this.addContact(request.to_user_id, request.from_user_id);

    return { success: true, request: { ...request, status: 'accepted', responded_at: now } };
  }

  declineContactRequest(requestId, userId) {
    const request = this.getContactRequest(requestId);
    if (!request) return { error: 'Request not found' };
    if (request.to_user_id !== userId) return { error: 'Not authorized' };
    if (request.status !== 'pending') return { error: 'Request already processed' };

    const now = new Date().toISOString();
    this.db.prepare('UPDATE contact_requests SET status = ?, responded_at = ? WHERE id = ?').run('declined', now, requestId);

    return { success: true, request: { ...request, status: 'declined', responded_at: now } };
  }

  cancelContactRequest(requestId, userId) {
    const request = this.getContactRequest(requestId);
    if (!request) return { error: 'Request not found' };
    if (request.from_user_id !== userId) return { error: 'Not authorized' };
    if (request.status !== 'pending') return { error: 'Request already processed' };

    this.db.prepare('DELETE FROM contact_requests WHERE id = ?').run(requestId);
    return { success: true };
  }

  getPendingRequestBetween(userId1, userId2) {
    return this.db.prepare(`
      SELECT * FROM contact_requests
      WHERE status = 'pending' AND (
        (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
      )
    `).get(userId1, userId2, userId2, userId1);
  }

  // === Group Methods ===
  getGroupsForUser(userId) {
    const rows = this.db.prepare(`
      SELECT g.*, gm.role,
        (SELECT COUNT(*) FROM crew_members WHERE crew_id = g.id) as member_count
      FROM crews g
      JOIN crew_members gm ON g.id = gm.crew_id
      WHERE gm.user_id = ?
    `).all(userId);

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdBy: r.created_by,
      createdAt: r.created_at,
      memberCount: r.member_count,
      role: r.role,
    }));
  }

  getGroup(groupId) {
    const row = this.db.prepare('SELECT * FROM crews WHERE id = ?').get(groupId);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  getGroupMembers(groupId) {
    const rows = this.db.prepare(`
      SELECT u.id, u.handle, u.display_name, u.avatar, u.status, gm.role, gm.joined_at
      FROM crew_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.crew_id = ?
    `).all(groupId);

    return rows.map(r => ({
      id: r.id,
      handle: r.handle,
      name: r.display_name,
      avatar: r.avatar,
      status: r.status,
      role: r.role,
      joinedAt: r.joined_at,
    }));
  }

  isGroupMember(groupId, userId) {
    const row = this.db.prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?').get(groupId, userId);
    return !!row;
  }

  isGroupAdmin(groupId, userId) {
    const row = this.db.prepare("SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ? AND role = 'admin'").get(groupId, userId);
    return !!row;
  }

  createGroup(data) {
    const now = new Date().toISOString();
    const group = {
      id: `group-${uuidv4()}`,
      name: data.name.slice(0, 100),
      description: (data.description || '').slice(0, 500),
      createdBy: data.createdBy,
      createdAt: now,
    };

    this.db.prepare('INSERT INTO crews (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(group.id, group.name, group.description, group.createdBy, group.createdAt);

    // Add creator as admin
    this.db.prepare("INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(group.id, data.createdBy, now);

    return group;
  }

  updateGroup(groupId, data) {
    const group = this.getGroup(groupId);
    if (!group) return null;

    const name = data.name ? data.name.slice(0, 100) : group.name;
    const description = data.description !== undefined ? data.description.slice(0, 500) : group.description;

    this.db.prepare('UPDATE crews SET name = ?, description = ? WHERE id = ?').run(name, description, groupId);

    return this.getGroup(groupId);
  }

  deleteGroup(groupId) {
    const result = this.db.prepare('DELETE FROM crews WHERE id = ?').run(groupId);
    return result.changes > 0;
  }

  addGroupMember(groupId, userId, role = 'member') {
    if (this.isGroupMember(groupId, userId)) {
      console.log(`👥 User ${userId} is already a member of group ${groupId}`);
      return false;
    }
    try {
      this.db.prepare('INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(groupId, userId, role, new Date().toISOString());
      console.log(`👥 Added user ${userId} to group ${groupId} as ${role}`);
      return true;
    } catch (err) {
      console.error(`❌ Failed to add user ${userId} to group ${groupId}:`, err.message);
      return false;
    }
  }

  removeGroupMember(groupId, userId) {
    const result = this.db.prepare('DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?').run(groupId, userId);
    if (result.changes === 0) return false;

    // Remove from group wave participants
    this.db.prepare(`
      DELETE FROM wave_participants
      WHERE user_id = ? AND wave_id IN (
        SELECT id FROM waves WHERE (privacy = 'crew' OR privacy = 'group') AND crew_id = ?
      )
    `).run(userId, groupId);

    return true;
  }

  updateGroupMemberRole(groupId, userId, role) {
    const result = this.db.prepare('UPDATE crew_members SET role = ? WHERE crew_id = ? AND user_id = ?').run(role, groupId, userId);
    return result.changes > 0;
  }

  // === Group Invitation Methods ===
  createGroupInvitation(groupId, invitedBy, invitedUserId, message = null) {
    const group = this.getGroup(groupId);
    if (!group) return { error: 'Group not found' };

    const inviter = this.findUserById(invitedBy);
    const invitee = this.findUserById(invitedUserId);
    if (!inviter || !invitee) return { error: 'User not found' };
    if (invitedBy === invitedUserId) return { error: 'Cannot invite yourself' };
    if (!this.isGroupMember(groupId, invitedBy)) return { error: 'Only group members can invite others' };
    if (this.isGroupMember(groupId, invitedUserId)) return { error: 'User is already a group member' };
    if (this.isBlocked(invitedUserId, invitedBy)) return { error: 'Cannot invite this user' };

    // Check for existing pending invitation
    const existing = this.db.prepare(`
      SELECT 1 FROM crew_invitations WHERE crew_id = ? AND invited_user_id = ? AND status = 'pending'
    `).get(groupId, invitedUserId);
    if (existing) return { error: 'Invitation already pending for this user' };

    const invitation = {
      id: uuidv4(),
      group_id: groupId,
      invited_by: invitedBy,
      invited_user_id: invitedUserId,
      message,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO crew_invitations (id, crew_id, invited_by, invited_user_id, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(invitation.id, invitation.group_id, invitation.invited_by, invitation.invited_user_id, invitation.message, invitation.status, invitation.created_at);

    return {
      ...invitation,
      group: { id: group.id, name: group.name },
      invited_by_user: { id: inviter.id, handle: inviter.handle, displayName: inviter.displayName, avatar: inviter.avatar },
      invited_user: { id: invitee.id, handle: invitee.handle, displayName: invitee.displayName, avatar: invitee.avatar },
    };
  }

  getGroupInvitationsForUser(userId) {
    const rows = this.db.prepare(`
      SELECT gi.*,
        g.id as g_id, g.name as g_name, g.description as g_desc,
        u.id as u_id, u.handle as u_handle, u.display_name as u_display_name, u.avatar as u_avatar
      FROM crew_invitations gi
      JOIN crews g ON gi.crew_id = g.id
      JOIN users u ON gi.invited_by = u.id
      WHERE gi.invited_user_id = ? AND gi.status = 'pending'
    `).all(userId);

    return rows.map(r => ({
      id: r.id,
      group_id: r.crew_id, // Map from crew_id column
      invited_by: r.invited_by,
      invited_user_id: r.invited_user_id,
      message: r.message,
      status: r.status,
      created_at: r.created_at,
      responded_at: r.responded_at,
      group: { id: r.g_id, name: r.g_name, description: r.g_desc },
      invited_by_user: { id: r.u_id, handle: r.u_handle, displayName: r.u_display_name, avatar: r.u_avatar },
    }));
  }

  getGroupInvitationsSent(groupId, userId) {
    const rows = this.db.prepare(`
      SELECT gi.*, u.id as u_id, u.handle as u_handle, u.display_name as u_display_name, u.avatar as u_avatar
      FROM crew_invitations gi
      JOIN users u ON gi.invited_user_id = u.id
      WHERE gi.crew_id = ? AND gi.invited_by = ? AND gi.status = 'pending'
    `).all(groupId, userId);

    return rows.map(r => ({
      id: r.id,
      group_id: r.crew_id, // Map from crew_id column
      invited_by: r.invited_by,
      invited_user_id: r.invited_user_id,
      message: r.message,
      status: r.status,
      created_at: r.created_at,
      invited_user: { id: r.u_id, handle: r.u_handle, displayName: r.u_display_name, avatar: r.u_avatar },
    }));
  }

  getGroupInvitation(invitationId) {
    const row = this.db.prepare('SELECT * FROM crew_invitations WHERE id = ?').get(invitationId);
    if (!row) return null;
    // Map crew_id to group_id for consistency with JavaScript code
    return {
      ...row,
      group_id: row.crew_id
    };
  }

  acceptGroupInvitation(invitationId, userId) {
    console.log(`👥 Accepting group invitation ${invitationId} for user ${userId}`);
    const invitation = this.getGroupInvitation(invitationId);
    if (!invitation) {
      console.log(`❌ Invitation ${invitationId} not found`);
      return { error: 'Invitation not found' };
    }
    if (invitation.invited_user_id !== userId) {
      console.log(`❌ User ${userId} not authorized for invitation ${invitationId}`);
      return { error: 'Not authorized' };
    }
    if (invitation.status !== 'pending') {
      console.log(`❌ Invitation ${invitationId} already processed: ${invitation.status}`);
      return { error: 'Invitation already processed' };
    }

    if (this.isGroupMember(invitation.group_id, userId)) {
      this.db.prepare('UPDATE crew_invitations SET status = ?, responded_at = ? WHERE id = ?').run('accepted', new Date().toISOString(), invitationId);
      console.log(`⚠️ User ${userId} already a member of group ${invitation.group_id}`);
      return { error: 'Already a group member' };
    }

    const now = new Date().toISOString();
    this.db.prepare('UPDATE crew_invitations SET status = ?, responded_at = ? WHERE id = ?').run('accepted', now, invitationId);
    const added = this.addGroupMember(invitation.group_id, userId, 'member');

    if (!added) {
      console.error(`❌ Failed to add user ${userId} to group ${invitation.group_id} after accepting invitation`);
    }

    const group = this.getGroup(invitation.group_id);
    console.log(`✅ Group invitation ${invitationId} accepted successfully`);
    return { success: true, invitation: { ...invitation, status: 'accepted', responded_at: now }, group: group ? { id: group.id, name: group.name } : null };
  }

  declineGroupInvitation(invitationId, userId) {
    const invitation = this.getGroupInvitation(invitationId);
    if (!invitation) return { error: 'Invitation not found' };
    if (invitation.invited_user_id !== userId) return { error: 'Not authorized' };
    if (invitation.status !== 'pending') return { error: 'Invitation already processed' };

    const now = new Date().toISOString();
    this.db.prepare('UPDATE crew_invitations SET status = ?, responded_at = ? WHERE id = ?').run('declined', now, invitationId);

    return { success: true, invitation: { ...invitation, status: 'declined', responded_at: now } };
  }

  cancelGroupInvitation(invitationId, userId) {
    const invitation = this.getGroupInvitation(invitationId);
    if (!invitation) return { error: 'Invitation not found' };
    if (invitation.invited_by !== userId) return { error: 'Not authorized' };
    if (invitation.status !== 'pending') return { error: 'Invitation already processed' };

    this.db.prepare('DELETE FROM crew_invitations WHERE id = ?').run(invitationId);
    return { success: true };
  }

  // === Moderation Methods ===
  blockUser(userId, blockedUserId) {
    const user = this.findUserById(userId);
    if (!user) return false;

    // Check if target is local user or remote user
    const blockedUser = this.findUserById(blockedUserId) || this.getRemoteUser(blockedUserId);
    if (!blockedUser) return false;

    try {
      this.db.prepare('INSERT INTO blocks (id, user_id, blocked_user_id, blocked_at) VALUES (?, ?, ?, ?)').run(uuidv4(), userId, blockedUserId, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }

  unblockUser(userId, blockedUserId) {
    const result = this.db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_user_id = ?').run(userId, blockedUserId);
    return result.changes > 0;
  }

  getBlockedUsers(userId) {
    // Get locally blocked users
    const localRows = this.db.prepare(`
      SELECT b.*, u.handle, u.display_name, NULL as node_name FROM blocks b
      JOIN users u ON b.blocked_user_id = u.id
      WHERE b.user_id = ?
    `).all(userId);

    // Get blocked remote users
    const remoteRows = this.db.prepare(`
      SELECT b.*, ru.handle, ru.display_name, ru.node_name FROM blocks b
      JOIN remote_users ru ON b.blocked_user_id = ru.id
      WHERE b.user_id = ?
    `).all(userId);

    const allRows = [...localRows, ...remoteRows];

    return allRows.map(r => ({
      id: r.id,
      userId: r.user_id,
      blockedUserId: r.blocked_user_id,
      blockedAt: r.blocked_at,
      handle: r.handle,
      displayName: r.display_name,
      nodeName: r.node_name || null,
      isRemote: !!r.node_name,
    }));
  }

  isBlocked(userId, otherUserId) {
    const row = this.db.prepare(`
      SELECT 1 FROM blocks WHERE
        (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)
    `).get(userId, otherUserId, otherUserId, userId);
    return !!row;
  }

  muteUser(userId, mutedUserId) {
    const user = this.findUserById(userId);
    if (!user) return false;

    // Check if target is local user or remote user
    const mutedUser = this.findUserById(mutedUserId) || this.getRemoteUser(mutedUserId);
    if (!mutedUser) return false;

    try {
      this.db.prepare('INSERT INTO mutes (id, user_id, muted_user_id, muted_at) VALUES (?, ?, ?, ?)').run(uuidv4(), userId, mutedUserId, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }

  unmuteUser(userId, mutedUserId) {
    const result = this.db.prepare('DELETE FROM mutes WHERE user_id = ? AND muted_user_id = ?').run(userId, mutedUserId);
    return result.changes > 0;
  }

  getMutedUsers(userId) {
    // Get locally muted users
    const localRows = this.db.prepare(`
      SELECT m.*, u.handle, u.display_name, NULL as node_name FROM mutes m
      JOIN users u ON m.muted_user_id = u.id
      WHERE m.user_id = ?
    `).all(userId);

    // Get muted remote users
    const remoteRows = this.db.prepare(`
      SELECT m.*, ru.handle, ru.display_name, ru.node_name FROM mutes m
      JOIN remote_users ru ON m.muted_user_id = ru.id
      WHERE m.user_id = ?
    `).all(userId);

    const allRows = [...localRows, ...remoteRows];

    return allRows.map(r => ({
      id: r.id,
      userId: r.user_id,
      mutedUserId: r.muted_user_id,
      mutedAt: r.muted_at,
      handle: r.handle,
      displayName: r.display_name,
      nodeName: r.node_name || null,
      isRemote: !!r.node_name,
    }));
  }

  isMuted(userId, otherUserId) {
    const row = this.db.prepare('SELECT 1 FROM mutes WHERE user_id = ? AND muted_user_id = ?').get(userId, otherUserId);
    return !!row;
  }

  // === Report Methods ===
  createReport(reporterId, type, targetId, reason, details = '') {
    const report = {
      id: uuidv4(),
      reporterId: reporterId,
      type: type,
      targetId: targetId,
      reason: reason,
      details: details || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO reports (id, reporter_id, type, target_id, reason, details, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(report.id, report.reporterId, report.type, report.targetId, report.reason, report.details, report.status, report.createdAt);

    return report;
  }

  getReportsByUser(userId) {
    const rows = this.db.prepare(`
      SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at DESC
    `).all(userId);

    return rows.map(r => this._enrichReport(r));
  }

  getPendingReports(limit = 50, offset = 0) {
    const rows = this.db.prepare(`
      SELECT * FROM reports WHERE status = 'pending' ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);

    return rows.map(r => this._enrichReport(r));
  }

  getReportsByStatus(status, limit = 50, offset = 0) {
    const rows = this.db.prepare(`
      SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);

    return rows.map(r => this._enrichReport(r));
  }

  getReportById(reportId) {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!row) return null;
    return this._enrichReport(row);
  }

  getReports(filters = {}) {
    let sql = 'SELECT * FROM reports WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        sql += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this._enrichReport(r));
  }

  resolveReport(reportId, resolution, resolvedBy, notes = null) {
    const report = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) return null;
    if (report.status !== 'pending') return null;

    const now = new Date().toISOString();
    const resolutionText = notes ? `${resolution}: ${notes}` : resolution;

    this.db.prepare(`
      UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ? WHERE id = ?
    `).run(resolutionText, now, resolvedBy, reportId);

    return this.getReportById(reportId);
  }

  dismissReport(reportId, resolvedBy, reason = null) {
    const report = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) return null;
    if (report.status !== 'pending') return null;

    const now = new Date().toISOString();
    const resolutionText = reason ? `Dismissed: ${reason}` : 'Dismissed';

    this.db.prepare(`
      UPDATE reports SET status = 'dismissed', resolution = ?, resolved_at = ?, resolved_by = ? WHERE id = ?
    `).run(resolutionText, now, resolvedBy, reportId);

    return this.getReportById(reportId);
  }

  // Helper method to enrich report data with context
  _enrichReport(r) {
    const reporter = this.findUserById(r.reporter_id);
    let context = {};

    if (r.type === 'droplet' || r.type === 'message') {
      // Support both 'droplet' (new) and 'message' (legacy) report types
      const droplet = this.db.prepare('SELECT * FROM pings WHERE id = ?').get(r.target_id);
      if (droplet) {
        const author = this.findUserById(droplet.author_id);
        const wave = this.getWave(droplet.wave_id);
        context = {
          content: droplet.content,
          authorHandle: author?.handle,
          authorName: author?.displayName,
          createdAt: droplet.created_at,
          waveId: droplet.wave_id,
          waveName: wave?.title
        };
      }
    } else if (r.type === 'wave') {
      const wave = this.getWave(r.target_id);
      if (wave) {
        const creator = this.findUserById(wave.createdBy);
        context = {
          title: wave.title,
          privacy: wave.privacy,
          creatorHandle: creator?.handle,
          creatorName: creator?.displayName
        };
      }
    } else if (r.type === 'user') {
      const user = this.findUserById(r.target_id);
      if (user) context = { handle: user.handle, displayName: user.displayName };
    }

    return {
      id: r.id,
      reporterId: r.reporter_id,
      type: r.type,
      targetId: r.target_id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      reporterHandle: reporter?.handle,
      reporterName: reporter?.displayName,
      context,
    };
  }

  // === Warning Methods ===
  createWarning(userId, issuedBy, reason, reportId = null) {
    const id = `warn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO warnings (id, user_id, issued_by, reason, report_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, issuedBy, reason, reportId, now);

    // Log the moderation action
    this.logModerationAction(issuedBy, 'warning_issued', 'user', userId, reason);

    return { id, userId, issuedBy, reason, reportId, createdAt: now };
  }

  getWarningsByUser(userId) {
    const warnings = this.db.prepare(`
      SELECT w.*, u.handle as issued_by_handle, u.display_name as issued_by_name
      FROM warnings w
      LEFT JOIN users u ON w.issued_by = u.id
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `).all(userId);

    return warnings.map(w => ({
      id: w.id,
      userId: w.user_id,
      issuedBy: w.issued_by,
      issuedByHandle: w.issued_by_handle,
      issuedByName: w.issued_by_name,
      reason: w.reason,
      reportId: w.report_id,
      createdAt: w.created_at,
    }));
  }

  getUserWarningCount(userId) {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM warnings WHERE user_id = ?').get(userId);
    return result?.count || 0;
  }

  // === Moderation Log Methods ===
  logModerationAction(adminId, actionType, targetType, targetId, reason = null, details = null) {
    const id = `modlog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO moderation_log (id, admin_id, action_type, target_type, target_id, reason, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, adminId, actionType, targetType, targetId, reason, details, now);

    return { id, adminId, actionType, targetType, targetId, reason, details, createdAt: now };
  }

  getModerationLog(limit = 50, offset = 0) {
    const logs = this.db.prepare(`
      SELECT ml.*, u.handle as admin_handle, u.display_name as admin_name
      FROM moderation_log ml
      LEFT JOIN users u ON ml.admin_id = u.id
      ORDER BY ml.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    return logs.map(l => ({
      id: l.id,
      adminId: l.admin_id,
      adminHandle: l.admin_handle,
      adminName: l.admin_name,
      actionType: l.action_type,
      targetType: l.target_type,
      targetId: l.target_id,
      reason: l.reason,
      details: l.details,
      createdAt: l.created_at,
    }));
  }

  getModerationLogForTarget(targetType, targetId) {
    const logs = this.db.prepare(`
      SELECT ml.*, u.handle as admin_handle, u.display_name as admin_name
      FROM moderation_log ml
      LEFT JOIN users u ON ml.admin_id = u.id
      WHERE ml.target_type = ? AND ml.target_id = ?
      ORDER BY ml.created_at DESC
    `).all(targetType, targetId);

    return logs.map(l => ({
      id: l.id,
      adminId: l.admin_id,
      adminHandle: l.admin_handle,
      adminName: l.admin_name,
      actionType: l.action_type,
      targetType: l.target_type,
      targetId: l.target_id,
      reason: l.reason,
      details: l.details,
      createdAt: l.created_at,
    }));
  }

  // === Wave Methods ===
  getWavesForUser(userId, showArchived = false, showHidden = false, participation = null) {
    // Get user's crew IDs
    const userCrewIds = this.db.prepare('SELECT crew_id FROM crew_members WHERE user_id = ?').all(userId).map(r => r.crew_id);

    // Get blocked/muted user IDs for unread count calculation
    const blockedIds = this.db.prepare('SELECT blocked_user_id FROM blocks WHERE user_id = ?').all(userId).map(r => r.blocked_user_id);
    const mutedIds = this.db.prepare('SELECT muted_user_id FROM mutes WHERE user_id = ?').all(userId).map(r => r.muted_user_id);

    // v2.27.0: Build wave ID list from cache if participation module available
    let waveIds;
    if (participation) {
      const userWaveIds = participation.getUserWaves(userId);
      // Also include public waves and crew waves
      const publicWaves = this.db.prepare("SELECT id FROM waves WHERE privacy = 'public' AND (is_profile_wave IS NULL OR is_profile_wave = 0)").all().map(r => r.id);
      const crewWaves = userCrewIds.length > 0
        ? this.db.prepare(`SELECT id FROM waves WHERE (privacy = 'crew' OR privacy = 'group') AND crew_id IN (${userCrewIds.map(() => '?').join(',')}) AND (is_profile_wave IS NULL OR is_profile_wave = 0)`).all(...userCrewIds).map(r => r.id)
        : [];
      // Federated participant waves
      const fedWaves = this.db.prepare("SELECT id FROM waves WHERE (privacy = 'crossServer' OR privacy = 'cross-server') AND federation_state = 'participant' AND (is_profile_wave IS NULL OR is_profile_wave = 0)").all().map(r => r.id);
      waveIds = [...new Set([...userWaveIds, ...publicWaves, ...crewWaves, ...fedWaves])];
    } else {
      // Fallback: get from DB
      waveIds = this.db.prepare(`
        SELECT DISTINCT w.id FROM waves w
        LEFT JOIN wave_participants wp ON w.id = wp.wave_id AND wp.user_id = ?
        WHERE (
          w.privacy = 'public'
          OR (w.privacy = 'private' AND wp.user_id IS NOT NULL)
          OR (w.privacy = 'crossServer' AND wp.user_id IS NOT NULL)
          OR (w.privacy = 'cross-server' AND wp.user_id IS NOT NULL)
          OR (w.privacy = 'crossServer' AND w.federation_state = 'participant')
          OR (w.privacy = 'cross-server' AND w.federation_state = 'participant')
          OR ((w.privacy = 'crew' OR w.privacy = 'group') AND w.crew_id IN (${userCrewIds.map(() => '?').join(',') || 'NULL'}))
        )
        AND (w.is_profile_wave IS NULL OR w.is_profile_wave = 0)
      `).all(userId, ...userCrewIds).map(r => r.id);
    }

    if (waveIds.length === 0) return [];

    // Fetch wave details for all IDs
    const placeholders = waveIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT w.*,
        u.display_name as creator_name, u.avatar as creator_avatar, u.handle as creator_handle,
        cr.name as crew_name,
        (SELECT COUNT(*) FROM pings WHERE wave_id = w.id AND deleted = 0) as ping_count
      FROM waves w
      LEFT JOIN users u ON w.created_by = u.id
      LEFT JOIN crews cr ON w.crew_id = cr.id
      WHERE w.id IN (${placeholders})
      ORDER BY w.updated_at DESC
    `).all(...waveIds);

    return rows.map(r => {
      // Get metadata from cache or DB
      let archived = 0, pinned = 0, hidden = 0, categoryId = null, categoryName = null, lastRead = null;
      if (participation) {
        const meta = participation.getMetadata(r.id, userId);
        archived = meta.archived || 0;
        pinned = meta.pinned || 0;
        hidden = meta.hidden || 0;
        categoryId = meta.categoryId || null;
        lastRead = meta.lastRead || null;
      } else {
        // Fallback to plaintext tables
        const wp = this.db.prepare('SELECT archived, last_read, pinned FROM wave_participants WHERE wave_id = ? AND user_id = ?').get(r.id, userId);
        if (wp) {
          archived = wp.archived || 0;
          pinned = wp.pinned || 0;
          lastRead = wp.last_read;
        }
        const wca = this.db.prepare('SELECT category_id FROM wave_category_assignments WHERE wave_id = ? AND user_id = ?').get(r.id, userId);
        if (wca) categoryId = wca.category_id;
      }

      // Look up category name if we have a categoryId
      if (categoryId) {
        const cat = this.db.prepare('SELECT name FROM wave_categories WHERE id = ?').get(categoryId);
        categoryName = cat ? cat.name : null;
      }

      // Filter based on mode
      if (showHidden) {
        if (hidden !== 1) return null; // Only show hidden waves in ghost mode
      } else if (showArchived) {
        if (archived !== 1) return null; // Only show archived
      } else {
        if (archived === 1 || hidden === 1) return null; // Exclude both
      }

      // Get participants for this wave
      const participants = this.getWaveParticipants(r.id);

      // Calculate unread count
      const blockedClause = blockedIds.length > 0
        ? `AND p.author_id NOT IN (${blockedIds.map(() => '?').join(',')})`
        : '';
      const mutedClause = mutedIds.length > 0
        ? `AND p.author_id NOT IN (${mutedIds.map(() => '?').join(',')})`
        : '';
      const unreadCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM pings p
        WHERE p.wave_id = ?
          AND p.deleted = 0
          AND p.author_id != ?
          ${blockedClause}
          ${mutedClause}
          AND NOT EXISTS (SELECT 1 FROM ping_read_by prb WHERE prb.ping_id = p.id AND prb.user_id = ?)
      `).get(r.id, userId, ...blockedIds, ...mutedIds, userId).count;

      return {
        id: r.id,
        title: r.title,
        privacy: r.privacy,
        crewId: r.crew_id,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        creator_name: r.creator_name || 'Unknown',
        creator_avatar: r.creator_avatar || '?',
        creator_handle: r.creator_handle || 'unknown',
        participants,
        ping_count: r.ping_count,
        unread_count: unreadCount,
        is_participant: participation ? participation.isParticipant(r.id, userId) : (archived !== null),
        is_archived: archived === 1,
        is_hidden: hidden === 1,
        crew_name: r.crew_name,
        federationState: r.federation_state || 'local',
        originNode: r.origin_node || null,
        originWaveId: r.origin_wave_id || null,
        category_id: categoryId,
        category_name: categoryName,
        pinned: pinned === 1,
      };
    }).filter(Boolean); // Remove nulls from filtering
  }

  // Low-Bandwidth Mode: Minimal wave list (v2.10.0)
  // Skips participants array and returns only essential fields
  // Saves 60-80% bandwidth for wave list requests
  getWavesForUserMinimal(userId, showArchived = false, showHidden = false, participation = null) {
    // Get user's crew IDs
    const userCrewIds = this.db.prepare('SELECT crew_id FROM crew_members WHERE user_id = ?').all(userId).map(r => r.crew_id);

    // Get blocked/muted user IDs for unread count calculation
    const blockedIds = this.db.prepare('SELECT blocked_user_id FROM blocks WHERE user_id = ?').all(userId).map(r => r.blocked_user_id);
    const mutedIds = this.db.prepare('SELECT muted_user_id FROM mutes WHERE user_id = ?').all(userId).map(r => r.muted_user_id);

    // v2.27.0: Build wave ID list from cache if available
    let waveIds;
    if (participation) {
      const userWaveIds = participation.getUserWaves(userId);
      const publicWaves = this.db.prepare("SELECT id FROM waves WHERE privacy = 'public' AND (is_profile_wave IS NULL OR is_profile_wave = 0)").all().map(r => r.id);
      const crewWaves = userCrewIds.length > 0
        ? this.db.prepare(`SELECT id FROM waves WHERE (privacy = 'crew' OR privacy = 'group') AND crew_id IN (${userCrewIds.map(() => '?').join(',')}) AND (is_profile_wave IS NULL OR is_profile_wave = 0)`).all(...userCrewIds).map(r => r.id)
        : [];
      const fedWaves = this.db.prepare("SELECT id FROM waves WHERE (privacy = 'crossServer' OR privacy = 'cross-server') AND federation_state = 'participant' AND (is_profile_wave IS NULL OR is_profile_wave = 0)").all().map(r => r.id);
      waveIds = [...new Set([...userWaveIds, ...publicWaves, ...crewWaves, ...fedWaves])];
    } else {
      waveIds = this.db.prepare(`
        SELECT DISTINCT w.id FROM waves w
        LEFT JOIN wave_participants wp ON w.id = wp.wave_id AND wp.user_id = ?
        WHERE (
          w.privacy = 'public'
          OR (w.privacy = 'private' AND wp.user_id IS NOT NULL)
          OR (w.privacy = 'crossServer' AND wp.user_id IS NOT NULL)
          OR (w.privacy = 'cross-server' AND wp.user_id IS NOT NULL)
          OR (w.privacy = 'crossServer' AND w.federation_state = 'participant')
          OR (w.privacy = 'cross-server' AND w.federation_state = 'participant')
          OR ((w.privacy = 'crew' OR w.privacy = 'group') AND w.crew_id IN (${userCrewIds.map(() => '?').join(',') || 'NULL'}))
        )
        AND (w.is_profile_wave IS NULL OR w.is_profile_wave = 0)
      `).all(userId, ...userCrewIds).map(r => r.id);
    }

    if (waveIds.length === 0) return [];

    const placeholders = waveIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT w.id, w.title, w.privacy, w.updated_at, w.created_by, w.encrypted,
        (SELECT COUNT(*) FROM pings WHERE wave_id = w.id AND deleted = 0) as ping_count,
        (SELECT COUNT(*) FROM wave_participants WHERE wave_id = w.id) as participant_count
      FROM waves w
      WHERE w.id IN (${placeholders})
      ORDER BY w.updated_at DESC
    `).all(...waveIds);

    return rows.map(r => {
      let archived = 0, pinned = 0, hidden = 0, categoryId = null;
      if (participation) {
        const meta = participation.getMetadata(r.id, userId);
        archived = meta.archived || 0;
        pinned = meta.pinned || 0;
        hidden = meta.hidden || 0;
        categoryId = meta.categoryId || null;
      } else {
        const wp = this.db.prepare('SELECT archived, pinned FROM wave_participants WHERE wave_id = ? AND user_id = ?').get(r.id, userId);
        if (wp) { archived = wp.archived || 0; pinned = wp.pinned || 0; }
        const wca = this.db.prepare('SELECT category_id FROM wave_category_assignments WHERE wave_id = ? AND user_id = ?').get(r.id, userId);
        if (wca) categoryId = wca.category_id;
      }

      // Filter based on mode
      if (showHidden) {
        if (hidden !== 1) return null;
      } else if (showArchived) {
        if (archived !== 1) return null;
      } else {
        if (archived === 1 || hidden === 1) return null;
      }

      // Calculate unread count
      const blockedClause = blockedIds.length > 0
        ? `AND p.author_id NOT IN (${blockedIds.map(() => '?').join(',')})`
        : '';
      const mutedClause = mutedIds.length > 0
        ? `AND p.author_id NOT IN (${mutedIds.map(() => '?').join(',')})`
        : '';
      const unreadCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM pings p
        WHERE p.wave_id = ?
          AND p.deleted = 0
          AND p.author_id != ?
          ${blockedClause}
          ${mutedClause}
          AND NOT EXISTS (SELECT 1 FROM ping_read_by prb WHERE prb.ping_id = p.id AND prb.user_id = ?)
      `).get(r.id, userId, ...blockedIds, ...mutedIds, userId).count;

      return {
        id: r.id,
        title: r.title,
        privacy: r.privacy,
        updatedAt: r.updated_at,
        encrypted: r.encrypted === 1,
        ping_count: r.ping_count,
        unread_count: unreadCount,
        pinned: pinned === 1,
        is_archived: archived === 1,
        is_hidden: hidden === 1,
        category_id: categoryId,
        participant_count: r.participant_count,
      };
    }).filter(Boolean);
  }

  // Helper to convert wave row to object
  rowToWave(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      privacy: row.privacy,
      crewId: row.crew_id,
      groupId: row.crew_id, // Alias for backward compatibility
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Burst (breakout) fields
      rootPingId: row.root_ping_id,
      brokenOutFrom: row.broken_out_from,
      breakoutChain: row.breakout_chain ? JSON.parse(row.breakout_chain) : null,
      // Federation fields
      federationState: row.federation_state || 'local',
      originNode: row.origin_node || null,
      originWaveId: row.origin_wave_id || null,
      // E2EE fields
      encrypted: row.encrypted === 1,
      // Profile wave fields (v2.9.0)
      isProfileWave: row.is_profile_wave === 1,
      profileOwnerId: row.profile_owner_id || null,
    };
  }

  getWave(waveId) {
    const row = this.db.prepare('SELECT * FROM waves WHERE id = ?').get(waveId);
    return this.rowToWave(row);
  }

  getWaveParticipants(waveId) {
    const rows = this.db.prepare(`
      SELECT u.id, u.display_name, u.avatar, u.status, u.handle
      FROM wave_participants wp
      JOIN users u ON wp.user_id = u.id
      WHERE wp.wave_id = ?
    `).all(waveId);

    return rows.map(r => ({
      id: r.id,
      name: r.display_name,
      avatar: r.avatar,
      status: r.status,
      handle: r.handle,
    }));
  }

  isWaveParticipant(waveId, userId) {
    const row = this.db.prepare(`
      SELECT 1 FROM wave_participants WHERE wave_id = ? AND user_id = ?
    `).get(waveId, userId);
    return !!row;
  }

  isWaveArchivedForUser(waveId, userId) {
    const row = this.db.prepare(`
      SELECT archived FROM wave_participants WHERE wave_id = ? AND user_id = ?
    `).get(waveId, userId);
    return row?.archived === 1;
  }

  canAccessWave(waveId, userId) {
    const wave = this.getWave(waveId);
    if (!wave) return false;

    if (wave.privacy === 'public') return true;

    // Federated participant waves are accessible to all local users
    if ((wave.privacy === 'crossServer' || wave.privacy === 'cross-server') && wave.federationState === 'participant') {
      return true;
    }

    // Support both 'group' (legacy) and 'crew' (v2.0.0) privacy values
    if ((wave.privacy === 'group' || wave.privacy === 'crew') && wave.groupId) {
      return this.isGroupMember(wave.groupId, userId);
    }

    // Check if participant
    const participant = this.db.prepare('SELECT 1 FROM wave_participants WHERE wave_id = ? AND user_id = ?').get(waveId, userId);
    return !!participant;
  }

  createWave(data) {
    const now = new Date().toISOString();
    const wave = {
      id: `wave-${uuidv4()}`,
      title: data.title.slice(0, 200),
      privacy: data.privacy || 'private',
      groupId: data.groupId || null,
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
      encrypted: data.encrypted || false,
    };

    this.db.prepare('INSERT INTO waves (id, title, privacy, crew_id, created_by, created_at, updated_at, encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(wave.id, wave.title, wave.privacy, wave.groupId, wave.createdBy, wave.createdAt, wave.updatedAt, wave.encrypted ? 1 : 0);

    // Add creator as participant
    this.db.prepare('INSERT INTO wave_participants (wave_id, user_id, joined_at, archived) VALUES (?, ?, ?, 0)').run(wave.id, data.createdBy, now);

    // Add other participants
    if (data.participants) {
      for (const userId of data.participants) {
        if (userId !== data.createdBy) {
          this.db.prepare('INSERT OR IGNORE INTO wave_participants (wave_id, user_id, joined_at, archived) VALUES (?, ?, ?, 0)').run(wave.id, userId, now);
        }
      }
    }

    return wave;
  }

  updateWavePrivacy(waveId, privacy, groupId = null) {
    const wave = this.getWave(waveId);
    if (!wave) return null;

    const now = new Date().toISOString();
    this.db.prepare('UPDATE waves SET privacy = ?, crew_id = ?, updated_at = ? WHERE id = ?').run(privacy, privacy === 'group' ? groupId : null, now, waveId);

    return this.getWave(waveId);
  }

  updateWaveTitle(waveId, title) {
    const wave = this.getWave(waveId);
    if (!wave) return null;

    const now = new Date().toISOString();
    this.db.prepare('UPDATE waves SET title = ?, updated_at = ? WHERE id = ?').run(title, now, waveId);

    return this.getWave(waveId);
  }

  updateWaveTimestamp(waveId) {
    this.db.prepare('UPDATE waves SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), waveId);
  }

  addWaveParticipant(waveId, userId) {
    try {
      this.db.prepare('INSERT INTO wave_participants (wave_id, user_id, joined_at, archived) VALUES (?, ?, ?, 0)').run(waveId, userId, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }

  removeWaveParticipant(waveId, userId) {
    const result = this.db.prepare('DELETE FROM wave_participants WHERE wave_id = ? AND user_id = ?').run(waveId, userId);
    return result.changes > 0;
  }

  archiveWaveForUser(waveId, userId, archived = true) {
    const result = this.db.prepare('UPDATE wave_participants SET archived = ? WHERE wave_id = ? AND user_id = ?').run(archived ? 1 : 0, waveId, userId);
    return result.changes > 0;
  }

  markWaveAsRead(waveId, userId) {
    // Check if participant
    let participant = this.db.prepare('SELECT 1 FROM wave_participants WHERE wave_id = ? AND user_id = ?').get(waveId, userId);

    if (!participant && this.canAccessWave(waveId, userId)) {
      this.addWaveParticipant(waveId, userId);
      participant = true;
    }

    if (!participant) return false;

    const now = new Date().toISOString();

    // Update last_read timestamp
    this.db.prepare('UPDATE wave_participants SET last_read = ? WHERE wave_id = ? AND user_id = ?').run(now, waveId, userId);

    // Also mark all unread pings in this wave as read in ping_read_by table
    // This ensures unread_count calculation (which uses ping_read_by) is accurate
    const unreadPings = this.db.prepare(`
      SELECT p.id FROM pings p
      WHERE p.wave_id = ?
        AND p.deleted = 0
        AND p.author_id != ?
        AND NOT EXISTS (SELECT 1 FROM ping_read_by prb WHERE prb.ping_id = p.id AND prb.user_id = ?)
    `).all(waveId, userId, userId);

    if (unreadPings.length > 0) {
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO ping_read_by (ping_id, user_id, read_at) VALUES (?, ?, ?)');
      for (const ping of unreadPings) {
        insertStmt.run(ping.id, userId, now);
      }
      console.log(`📖 Marked ${unreadPings.length} pings as read for user ${userId} in wave ${waveId}`);
    }

    return true;
  }

  // Mark all waves as read for a user (bulk operation for "mark all read")
  markAllWavesAsRead(userId) {
    const now = new Date().toISOString();

    // Get all wave IDs the user participates in
    const waveIds = this.db.prepare(
      'SELECT wave_id FROM wave_participants WHERE user_id = ?'
    ).all(userId).map(r => r.wave_id);

    if (waveIds.length === 0) return 0;

    // Update last_read on all participations
    this.db.prepare(
      'UPDATE wave_participants SET last_read = ? WHERE user_id = ?'
    ).run(now, userId);

    // Mark all unread pings across all waves as read
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO ping_read_by (ping_id, user_id, read_at)
      SELECT p.id, ?, ?
      FROM pings p
      INNER JOIN wave_participants wp ON wp.wave_id = p.wave_id AND wp.user_id = ?
      WHERE p.deleted = 0
        AND p.author_id != ?
        AND NOT EXISTS (SELECT 1 FROM ping_read_by prb WHERE prb.ping_id = p.id AND prb.user_id = ?)
    `).run(userId, now, userId, userId, userId);

    console.log(`📖 Marked all waves as read for user ${userId}: ${waveIds.length} waves, ${result.changes} messages`);
    return result.changes;
  }

  deleteWave(waveId, userId) {
    const wave = this.getWave(waveId);
    if (!wave) return { success: false, error: 'Wave not found' };
    if (wave.createdBy !== userId) return { success: false, error: 'Only wave creator can delete' };

    const participants = this.getWaveParticipants(waveId);

    // Delete wave (cascade will handle participants, messages, etc.)
    this.db.prepare('DELETE FROM waves WHERE id = ?').run(waveId);

    return { success: true, wave, participants };
  }

  // ============ Profile Wave Methods (v2.9.0) ============

  /**
   * Get or create a user's profile wave
   * Each user has exactly one profile wave for standalone video posts
   * @param {string} userId - The user ID
   * @returns {Object} The profile wave
   */
  getOrCreateProfileWave(userId) {
    // Check if user already has a profile wave
    const existingWave = this.db.prepare(`
      SELECT * FROM waves WHERE is_profile_wave = 1 AND profile_owner_id = ?
    `).get(userId);

    if (existingWave) {
      return this.rowToWave(existingWave);
    }

    // Get user info for wave title
    const user = this.findUserById(userId);
    if (!user) {
      return null;
    }

    // Create the profile wave
    const now = new Date().toISOString();
    const waveId = `wave-profile-${uuidv4()}`;
    const title = `@${user.handle}'s Videos`;

    this.db.prepare(`
      INSERT INTO waves (id, title, privacy, created_by, created_at, updated_at, is_profile_wave, profile_owner_id, encrypted)
      VALUES (?, ?, 'public', ?, ?, ?, 1, ?, 0)
    `).run(waveId, title, userId, now, now, userId);

    // Add creator as participant
    this.db.prepare(`
      INSERT INTO wave_participants (wave_id, user_id, joined_at, archived)
      VALUES (?, ?, ?, 0)
    `).run(waveId, userId, now);

    console.log(`📹 Created profile wave ${waveId} for user @${user.handle}`);

    return this.getWave(waveId);
  }

  /**
   * Get the profile wave for a user by handle
   * @param {string} handle - The user handle
   * @returns {Object|null} The profile wave or null
   */
  getProfileWaveByHandle(handle) {
    const user = this.findUserByHandle(handle);
    if (!user) return null;

    const wave = this.db.prepare(`
      SELECT * FROM waves WHERE is_profile_wave = 1 AND profile_owner_id = ?
    `).get(user.id);

    return wave ? this.rowToWave(wave) : null;
  }

  /**
   * Get videos from a user's profile wave
   * @param {string} profileOwnerId - The profile owner's user ID
   * @param {number} limit - Max videos to return
   * @param {string} cursor - Cursor for pagination (ping ID)
   * @returns {Object} { videos: [], hasMore: boolean, nextCursor: string }
   */
  getUserProfileVideos(profileOwnerId, limit = 20, cursor = null) {
    limit = Math.min(Math.max(1, limit), 50);

    // Get the profile wave
    const profileWave = this.db.prepare(`
      SELECT id FROM waves WHERE is_profile_wave = 1 AND profile_owner_id = ?
    `).get(profileOwnerId);

    if (!profileWave) {
      return { videos: [], hasMore: false, nextCursor: null };
    }

    // Build query for video pings in profile wave
    let query = `
      SELECT
        p.id,
        p.wave_id,
        p.author_id,
        p.content,
        p.media_url,
        p.media_duration,
        p.media_type,
        p.created_at,
        p.reactions,
        p.broken_out_to,
        u.display_name as author_name,
        u.handle as author_handle,
        u.avatar as author_avatar,
        u.avatar_url as author_avatar_url,
        w.title as wave_title,
        bw.id as conversation_wave_id,
        (SELECT COUNT(*) FROM pings WHERE wave_id = bw.id AND deleted = 0) as conversation_count
      FROM pings p
      JOIN users u ON p.author_id = u.id
      JOIN waves w ON p.wave_id = w.id
      LEFT JOIN waves bw ON p.broken_out_to = bw.id
      WHERE p.wave_id = ?
        AND p.media_type = 'video'
        AND p.deleted = 0
    `;

    const params = [profileWave.id];

    // Cursor pagination
    if (cursor) {
      const cursorPing = this.db.prepare('SELECT created_at FROM pings WHERE id = ?').get(cursor);
      if (cursorPing) {
        query += ` AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))`;
        params.push(cursorPing.created_at, cursorPing.created_at, cursor);
      }
    }

    query += ` ORDER BY p.created_at DESC LIMIT ?`;
    params.push(limit + 1);

    const rows = this.db.prepare(query).all(...params);

    const hasMore = rows.length > limit;
    const videos = rows.slice(0, limit).map(row => ({
      id: row.id,
      wave_id: row.wave_id,
      wave_title: row.wave_title,
      author_id: row.author_id,
      author_name: row.author_name,
      author_handle: row.author_handle,
      author_avatar: row.author_avatar,
      author_avatar_url: row.author_avatar_url,
      media_url: row.media_url,
      media_duration: row.media_duration,
      content: row.content,
      created_at: row.created_at,
      reactions: row.reactions ? JSON.parse(row.reactions) : {},
      conversation_wave_id: row.conversation_wave_id || null,
      conversation_count: row.conversation_count || 0,
    }));

    return {
      videos,
      hasMore,
      nextCursor: hasMore && videos.length > 0 ? videos[videos.length - 1].id : null,
    };
  }

  /**
   * Create a burst wave from a profile video reply
   * Auto-creates a conversation wave when someone replies to a profile video
   * @param {string} originalPingId - The video ping being replied to
   * @param {string} replyUserId - The user creating the reply
   * @param {string} replyContent - The reply content
   * @returns {Object} Result with new wave and ping info
   */
  createProfileVideoBurst(originalPingId, replyUserId, replyContent) {
    const now = new Date().toISOString();

    // Get the original video ping and wave
    const originalPing = this.db.prepare(`
      SELECT p.*, w.is_profile_wave, w.profile_owner_id,
             u.handle as author_handle, u.display_name as author_name
      FROM pings p
      JOIN waves w ON p.wave_id = w.id
      JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `).get(originalPingId);

    if (!originalPing) {
      return { success: false, error: 'Original ping not found' };
    }

    if (!originalPing.is_profile_wave) {
      return { success: false, error: 'Not a profile wave video' };
    }

    // Check if there's already a burst wave for this video
    if (originalPing.broken_out_to) {
      // Return existing wave - user should reply there
      const existingWave = this.getWave(originalPing.broken_out_to);
      return {
        success: true,
        existingWave: true,
        wave: existingWave,
        originalPingId,
      };
    }

    // Create the burst conversation wave
    const newWaveId = `wave-${uuidv4()}`;
    const caption = originalPing.content
      ? originalPing.content.replace(/<[^>]*>/g, '').slice(0, 50)
      : `@${originalPing.author_handle}'s video`;
    const title = `Re: ${caption}`;

    this.db.prepare(`
      INSERT INTO waves (id, title, privacy, created_by, created_at, updated_at, root_ping_id, broken_out_from, encrypted)
      VALUES (?, ?, 'public', ?, ?, ?, ?, ?, 0)
    `).run(newWaveId, title, replyUserId, now, now, originalPingId, originalPing.wave_id);

    // Add video author and replier as participants
    const participants = new Set([originalPing.author_id, replyUserId]);
    for (const participantId of participants) {
      this.db.prepare(`
        INSERT OR IGNORE INTO wave_participants (wave_id, user_id, joined_at, archived)
        VALUES (?, ?, ?, 0)
      `).run(newWaveId, participantId, now);
    }

    // Mark original ping as broken out
    this.db.prepare(`
      UPDATE pings SET broken_out_to = ? WHERE id = ?
    `).run(newWaveId, originalPingId);

    // Create the reply ping in the new wave (parent_id links to root ping for tree traversal)
    const replyPingId = `ping-${uuidv4()}`;
    this.db.prepare(`
      INSERT INTO pings (id, wave_id, author_id, content, parent_id, created_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(replyPingId, newWaveId, replyUserId, replyContent, originalPingId, now);

    // Update wave timestamp
    this.updateWaveTimestamp(newWaveId);

    console.log(`📹 Created profile video burst wave ${newWaveId} from ping ${originalPingId}`);

    return {
      success: true,
      existingWave: false,
      wave: this.getWave(newWaveId),
      ping: {
        id: replyPingId,
        wave_id: newWaveId,
        author_id: replyUserId,
        content: replyContent,
        created_at: now,
      },
      originalPingId,
      videoAuthorId: originalPing.author_id,
    };
  }

  // Break out a droplet and its replies into a new wave
  breakoutDroplet(dropletId, newWaveTitle, participants, userId) {
    const now = new Date().toISOString();

    // Get the original droplet
    const droplet = this.db.prepare(`
      SELECT d.*, w.title as wave_title, w.id as wave_id
      FROM pings d
      JOIN waves w ON d.wave_id = w.id
      WHERE d.id = ?
    `).get(dropletId);

    if (!droplet) {
      return { success: false, error: 'Droplet not found' };
    }

    // Check if already broken out
    if (droplet.broken_out_to) {
      return { success: false, error: 'Droplet already broken out' };
    }

    const originalWaveId = droplet.wave_id;
    const originalWave = this.getWave(originalWaveId);

    // Get all child droplets recursively
    const getAllChildren = (parentId) => {
      const children = this.db.prepare('SELECT id FROM pings WHERE parent_id = ?').all(parentId);
      let allIds = children.map(c => c.id);
      for (const child of children) {
        allIds = allIds.concat(getAllChildren(child.id));
      }
      return allIds;
    };

    const childIds = getAllChildren(dropletId);
    const allDropletIds = [dropletId, ...childIds];

    // Build breakout chain - append to existing chain if this wave was itself broken out
    let breakoutChain = [];
    if (originalWave.breakout_chain) {
      try {
        breakoutChain = JSON.parse(originalWave.breakout_chain);
      } catch (e) {
        breakoutChain = [];
      }
    }
    // Add the current wave to the chain
    breakoutChain.push({
      wave_id: originalWaveId,
      ping_id: dropletId,
      title: originalWave.title
    });

    // Create the new wave with breakout metadata
    const newWaveId = `wave-${uuidv4()}`;

    // Burst waves inherit privacy and crew from parent wave
    this.db.prepare(`
      INSERT INTO waves (id, title, privacy, crew_id, created_by, created_at, updated_at, root_ping_id, broken_out_from, breakout_chain, encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newWaveId,
      newWaveTitle.slice(0, 200),
      originalWave.privacy || 'private',
      originalWave.crew_id || null,
      userId,
      now,
      now,
      dropletId,
      originalWaveId,
      JSON.stringify(breakoutChain),
      originalWave.encrypted ? 1 : 0
    );

    // Add participants to new wave
    const participantSet = new Set(participants);
    participantSet.add(userId); // Ensure creator is included
    for (const participantId of participantSet) {
      this.db.prepare('INSERT OR IGNORE INTO wave_participants (wave_id, user_id, joined_at, archived) VALUES (?, ?, ?, 0)').run(newWaveId, participantId, now);
    }

    // If parent wave is encrypted, copy encryption keys for burst wave participants
    if (originalWave.encrypted) {
      const parentWaveKeys = this.db.prepare(`
        SELECT user_id, encrypted_wave_key, sender_public_key, key_version
        FROM wave_encryption_keys
        WHERE wave_id = ?
      `).all(originalWaveId);

      for (const key of parentWaveKeys) {
        if (participantSet.has(key.user_id)) {
          this.db.prepare(`
            INSERT OR IGNORE INTO wave_encryption_keys (id, wave_id, user_id, encrypted_wave_key, sender_public_key, key_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(`wavekey-${uuidv4()}`, newWaveId, key.user_id, key.encrypted_wave_key, key.sender_public_key, key.key_version, now);
        }
      }
    }

    // Move all droplets to the new wave (update wave_id, set original_wave_id)
    // The root droplet becomes the root of the new wave (parent_id stays null or its existing value)
    for (const id of allDropletIds) {
      this.db.prepare(`
        UPDATE pings SET wave_id = ?, original_wave_id = ? WHERE id = ?
      `).run(newWaveId, originalWaveId, id);
    }

    // Mark the original droplet as broken out in the original wave
    // We need to create a "link card" - this is done by setting broken_out_to
    // But since the droplet has moved, we need to create a placeholder
    // Actually, per the design doc, the root droplet itself gets broken_out_to set
    // Let me re-read... the design says the original droplet displays as link card
    // So we should NOT move the root droplet, just mark it and move only children
    // Wait, re-reading design: "droplets move, not copy" and "Original droplet gets broken_out_to field set on its record in the original wave"

    // Let me reconsider: The root droplet stays in original wave as a link card
    // Only the REPLIES move to the new wave
    // The new wave's root_droplet_id points to the droplet in original wave
    // Actually no - looking at the diagram, Droplet B moves to new wave AND shows as link card

    // I think the correct approach:
    // 1. Root droplet stays in original wave with broken_out_to set (becomes link card)
    // 2. Root droplet is ALSO the root of new wave (referenced, not copied)
    // 3. Child droplets move to new wave

    // But that's complex with SQLite constraints. Simpler approach per design:
    // - The droplet ID stays the same
    // - broken_out_to points to the new wave
    // - When rendering original wave, droplets with broken_out_to show as link cards
    // - The new wave loads the same droplet by ID

    // Let's undo the move and do it correctly:
    // Restore original wave_id for all droplets
    for (const id of allDropletIds) {
      this.db.prepare('UPDATE pings SET wave_id = ?, original_wave_id = NULL WHERE id = ?').run(originalWaveId, id);
    }

    // Set broken_out_to on the root droplet only
    this.db.prepare('UPDATE pings SET broken_out_to = ? WHERE id = ?').run(newWaveId, dropletId);

    // The new wave references the droplet via root_droplet_id
    // When fetching droplets for the new wave, we'll check if it's a breakout wave
    // and include the root droplet + children

    const newWave = this.getWave(newWaveId);

    return {
      success: true,
      newWave,
      originalWaveId,
      dropletId,
      childCount: childIds.length
    };
  }

  // Alias for rippleDroplet (new terminology)
  rippleDroplet(dropletId, newWaveTitle, participants, userId) {
    return this.breakoutDroplet(dropletId, newWaveTitle, participants, userId);
  }

  // Get droplets for a rippled wave (includes root droplet from original wave)
  getDropletsForBreakoutWave(waveId, userId = null) {
    const wave = this.getWave(waveId);
    if (!wave || !wave.rootPingId) {
      return this.getDropletsForWave(waveId, userId);
    }

    // Get blocked/muted users
    let blockedIds = [];
    let mutedIds = [];
    if (userId) {
      blockedIds = this.db.prepare('SELECT blocked_user_id FROM blocks WHERE user_id = ?').all(userId).map(r => r.blocked_user_id);
      mutedIds = this.db.prepare('SELECT muted_user_id FROM mutes WHERE user_id = ?').all(userId).map(r => r.muted_user_id);
    }

    // Get root droplet and all its descendants
    const getAllDescendants = (parentId, results = []) => {
      const droplet = this.db.prepare(`
        SELECT d.*,
               u.display_name as user_display_name, u.avatar as user_avatar, u.avatar_url as user_avatar_url, u.handle as user_handle,
               b.name as bot_name, b.id as bot_id,
               bow.title as broken_out_to_title
        FROM pings d
        JOIN users u ON d.author_id = u.id
        LEFT JOIN bots b ON d.bot_id = b.id
        LEFT JOIN waves bow ON d.broken_out_to = bow.id
        WHERE d.id = ?
      `).get(parentId);

      if (!droplet) return results;

      // Skip blocked/muted users
      if (blockedIds.includes(droplet.author_id) || mutedIds.includes(droplet.author_id)) {
        return results;
      }

      // Transform bot pings to use bot info
      if (droplet.bot_id) {
        droplet.sender_name = `[Bot] ${droplet.bot_name}`;
        droplet.sender_avatar = '🤖';
        droplet.sender_avatar_url = null;
        droplet.sender_handle = droplet.bot_name.toLowerCase().replace(/\s+/g, '-');
        droplet.isBot = true;
        droplet.botId = droplet.bot_id;
      } else {
        droplet.sender_name = droplet.user_display_name;
        droplet.sender_avatar = droplet.user_avatar;
        droplet.sender_avatar_url = droplet.user_avatar_url;
        droplet.sender_handle = droplet.user_handle;
      }

      results.push(droplet);

      // Get children
      const children = this.db.prepare('SELECT id FROM pings WHERE parent_id = ?').all(parentId);
      for (const child of children) {
        getAllDescendants(child.id, results);
      }

      return results;
    };

    const rows = getAllDescendants(wave.rootPingId);

    return rows.map(d => {
      const hasRead = userId ? !!this.db.prepare('SELECT 1 FROM ping_read_by WHERE ping_id = ? AND user_id = ?').get(d.id, userId) : false;
      const isUnread = d.deleted ? false : (userId ? !hasRead && d.author_id !== userId : false);
      const readBy = this.db.prepare('SELECT user_id FROM ping_read_by WHERE ping_id = ?').all(d.id).map(r => r.user_id);

      return {
        id: d.id,
        waveId: waveId, // Report as belonging to this wave for UI purposes
        parentId: d.parent_id,
        authorId: d.author_id,
        content: d.content,
        privacy: d.privacy,
        version: d.version,
        createdAt: d.created_at,
        editedAt: d.edited_at,
        deleted: d.deleted === 1,
        deletedAt: d.deleted_at,
        reactions: d.reactions ? JSON.parse(d.reactions) : {},
        readBy,
        sender_name: d.sender_name,
        sender_avatar: d.sender_avatar,
        sender_avatar_url: d.sender_avatar_url,
        sender_handle: d.sender_handle,
        author_id: d.author_id,
        parent_id: d.parent_id,
        wave_id: waveId,
        created_at: d.created_at,
        edited_at: d.edited_at,
        deleted_at: d.deleted_at,
        is_unread: isUnread,
        brokenOutTo: d.broken_out_to,
        brokenOutToTitle: d.broken_out_to_title,
        isBot: d.isBot || false,
        botId: d.botId || undefined,
        encrypted: d.encrypted === 1,
        nonce: d.nonce,
        keyVersion: d.key_version,
        // Media fields (v2.7.0)
        media_type: d.media_type,
        media_url: d.media_url,
        media_duration: d.media_duration,
        media_encrypted: d.media_encrypted === 1,
      };
    });
  }

  // ============ Wave Category Methods (v2.2.0) ============

  // Get all categories for a user with wave counts and unread counts
  getCategoriesForUser(userId) {
    const categories = this.db.prepare(`
      SELECT wc.*,
        (SELECT COUNT(*) FROM wave_category_assignments wca WHERE wca.category_id = wc.id) as wave_count,
        (SELECT COUNT(DISTINCT wca.wave_id)
         FROM wave_category_assignments wca
         JOIN waves w ON wca.wave_id = w.id
         JOIN wave_participants wp ON w.id = wp.wave_id AND wp.user_id = ?
         WHERE wca.category_id = wc.id
           AND EXISTS (
             SELECT 1 FROM pings p
             WHERE p.wave_id = w.id
               AND p.deleted = 0
               AND p.author_id != ?
               AND NOT EXISTS (SELECT 1 FROM ping_read_by prb WHERE prb.ping_id = p.id AND prb.user_id = ?)
           )
        ) as unread_count
      FROM wave_categories wc
      WHERE wc.user_id = ?
      ORDER BY wc.sort_order ASC, wc.created_at ASC
    `).all(userId, userId, userId, userId);

    return categories.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color,
      sortOrder: c.sort_order,
      collapsed: c.collapsed === 1,
      waveCount: c.wave_count,
      unreadCount: c.unread_count,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  // Create a new category
  createCategory(userId, data) {
    const now = new Date().toISOString();
    const id = `cat-${uuidv4()}`;

    // Check for duplicate name
    const existing = this.db.prepare(`
      SELECT id FROM wave_categories WHERE user_id = ? AND name = ?
    `).get(userId, data.name);

    if (existing) {
      return { success: false, error: 'Category with this name already exists' };
    }

    // Get max sort_order
    const maxSort = this.db.prepare(`
      SELECT MAX(sort_order) as max FROM wave_categories WHERE user_id = ?
    `).get(userId);

    const sortOrder = (maxSort?.max ?? -1) + 1;

    this.db.prepare(`
      INSERT INTO wave_categories (id, user_id, name, color, sort_order, collapsed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, userId, data.name, data.color || 'var(--accent-green)', sortOrder, now, now);

    return {
      success: true,
      category: {
        id,
        name: data.name,
        color: data.color || 'var(--accent-green)',
        sortOrder,
        collapsed: false,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  // Update a category
  updateCategory(categoryId, userId, data) {
    const now = new Date().toISOString();

    // Verify ownership
    const category = this.db.prepare(`
      SELECT * FROM wave_categories WHERE id = ? AND user_id = ?
    `).get(categoryId, userId);

    if (!category) {
      return { success: false, error: 'Category not found or access denied' };
    }

    // Check for duplicate name if name is being changed
    if (data.name && data.name !== category.name) {
      const existing = this.db.prepare(`
        SELECT id FROM wave_categories WHERE user_id = ? AND name = ? AND id != ?
      `).get(userId, data.name, categoryId);

      if (existing) {
        return { success: false, error: 'Category with this name already exists' };
      }
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.color !== undefined) {
      updates.push('color = ?');
      params.push(data.color);
    }
    if (data.collapsed !== undefined) {
      updates.push('collapsed = ?');
      params.push(data.collapsed ? 1 : 0);
    }

    updates.push('updated_at = ?');
    params.push(now);

    params.push(categoryId, userId);

    this.db.prepare(`
      UPDATE wave_categories
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `).run(...params);

    return { success: true };
  }

  // Delete a category
  deleteCategory(categoryId, userId) {
    // Verify ownership
    const category = this.db.prepare(`
      SELECT * FROM wave_categories WHERE id = ? AND user_id = ?
    `).get(categoryId, userId);

    if (!category) {
      return { success: false, error: 'Category not found or access denied' };
    }

    // Check if it's the only category
    const categoryCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM wave_categories WHERE user_id = ?
    `).get(userId).count;

    if (categoryCount <= 1) {
      return { success: false, error: 'Cannot delete the last category' };
    }

    // Delete category (CASCADE will set category_id to NULL in assignments)
    this.db.prepare('DELETE FROM wave_categories WHERE id = ?').run(categoryId);

    return { success: true };
  }

  // Reorder categories
  reorderCategories(userId, categoryOrders) {
    const now = new Date().toISOString();

    // Verify all categories belong to the user
    for (const { id } of categoryOrders) {
      const category = this.db.prepare(`
        SELECT id FROM wave_categories WHERE id = ? AND user_id = ?
      `).get(id, userId);

      if (!category) {
        return { success: false, error: 'Category not found or access denied' };
      }
    }

    // Update sort_order for all categories
    const stmt = this.db.prepare(`
      UPDATE wave_categories
      SET sort_order = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    for (const { id, sortOrder } of categoryOrders) {
      stmt.run(sortOrder, now, id, userId);
    }

    return { success: true };
  }

  // Assign wave to category
  assignWaveToCategory(waveId, userId, categoryId) {
    const now = new Date().toISOString();

    // Verify category ownership if category_id is not null
    if (categoryId !== null) {
      const category = this.db.prepare(`
        SELECT id FROM wave_categories WHERE id = ? AND user_id = ?
      `).get(categoryId, userId);

      if (!category) {
        return { success: false, error: 'Category not found or access denied' };
      }
    }

    // Insert or update assignment
    this.db.prepare(`
      INSERT INTO wave_category_assignments (user_id, wave_id, category_id, assigned_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, wave_id) DO UPDATE SET
        category_id = excluded.category_id,
        assigned_at = excluded.assigned_at
    `).run(userId, waveId, categoryId, now);

    return { success: true };
  }

  // Get category assignment for a wave
  getWaveCategoryAssignment(waveId, userId) {
    const assignment = this.db.prepare(`
      SELECT wca.*, wc.name as category_name
      FROM wave_category_assignments wca
      LEFT JOIN wave_categories wc ON wca.category_id = wc.id
      WHERE wca.wave_id = ? AND wca.user_id = ?
    `).get(waveId, userId);

    if (!assignment) return null;

    return {
      waveId: assignment.wave_id,
      categoryId: assignment.category_id,
      categoryName: assignment.category_name,
      assignedAt: assignment.assigned_at,
    };
  }

  // Pin/unpin wave for user
  pinWaveForUser(waveId, userId, pinned) {
    this.db.prepare(`
      UPDATE wave_participants
      SET pinned = ?
      WHERE wave_id = ? AND user_id = ?
    `).run(pinned ? 1 : 0, waveId, userId);

    return { success: true };
  }

  // ============ Custom Theme Methods (v2.11.0) ============

  // Allowed CSS variable names for custom themes (security allowlist)
  static ALLOWED_THEME_VARIABLES = [
    '--bg-base', '--bg-elevated', '--bg-surface', '--bg-hover', '--bg-active', '--bg-recessed',
    '--text-primary', '--text-secondary', '--text-dim', '--text-muted', '--text-inverted',
    '--border-primary', '--border-secondary', '--border-subtle', '--border-strong',
    '--accent-amber', '--accent-teal', '--accent-green', '--accent-orange', '--accent-purple',
    '--status-success', '--status-warning', '--status-error', '--status-info',
    '--glow-amber', '--glow-teal', '--glow-green', '--glow-orange', '--glow-purple',
    '--overlay-amber', '--overlay-teal', '--overlay-green', '--overlay-orange', '--overlay-purple',
  ];

  // Validate color value (hex, rgb, rgba, hsl, hsla, CSS variable)
  static isValidColorValue(value) {
    if (!value || typeof value !== 'string') return false;
    // Allow hex colors (#fff, #ffffff, #ffffffff for alpha)
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return true;
    // Allow rgb/rgba
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+)?\s*\)$/.test(value)) return true;
    // Allow hsl/hsla
    if (/^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*[\d.]+)?\s*\)$/.test(value)) return true;
    // Allow CSS variables (for referencing other theme variables)
    if (/^var\(--[a-zA-Z0-9-]+\)$/.test(value)) return true;
    return false;
  }

  // Validate theme variables object
  validateThemeVariables(variables) {
    if (!variables || typeof variables !== 'object') {
      return { valid: false, error: 'Variables must be an object' };
    }

    for (const [key, value] of Object.entries(variables)) {
      if (!DatabaseSQLite.ALLOWED_THEME_VARIABLES.includes(key)) {
        return { valid: false, error: `Invalid CSS variable: ${key}` };
      }
      if (!DatabaseSQLite.isValidColorValue(value)) {
        return { valid: false, error: `Invalid color value for ${key}: ${value}` };
      }
    }

    return { valid: true };
  }

  // Get all themes for a user (their own + installed)
  getThemesForUser(userId) {
    // Get user's own themes
    const ownThemes = this.db.prepare(`
      SELECT ct.*, u.handle as creator_handle, u.display_name as creator_display_name
      FROM custom_themes ct
      JOIN users u ON ct.creator_id = u.id
      WHERE ct.creator_id = ?
      ORDER BY ct.updated_at DESC
    `).all(userId);

    // Get installed themes
    const installedThemes = this.db.prepare(`
      SELECT ct.*, u.handle as creator_handle, u.display_name as creator_display_name,
             cti.installed_at
      FROM custom_theme_installs cti
      JOIN custom_themes ct ON cti.theme_id = ct.id
      JOIN users u ON ct.creator_id = u.id
      WHERE cti.user_id = ? AND ct.creator_id != ?
      ORDER BY cti.installed_at DESC
    `).all(userId, userId);

    const formatTheme = (t, isOwn = false, isInstalled = false) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      variables: JSON.parse(t.variables),
      isPublic: t.is_public === 1,
      installCount: t.install_count,
      creatorId: t.creator_id,
      creatorHandle: t.creator_handle,
      creatorDisplayName: t.creator_display_name,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      isOwn,
      isInstalled,
      installedAt: t.installed_at || null,
    });

    return {
      ownThemes: ownThemes.map(t => formatTheme(t, true, false)),
      installedThemes: installedThemes.map(t => formatTheme(t, false, true)),
    };
  }

  // Get a single theme by ID
  getThemeById(themeId, userId = null) {
    const theme = this.db.prepare(`
      SELECT ct.*, u.handle as creator_handle, u.display_name as creator_display_name
      FROM custom_themes ct
      JOIN users u ON ct.creator_id = u.id
      WHERE ct.id = ?
    `).get(themeId);

    if (!theme) return null;

    // Check if user has installed this theme
    let isInstalled = false;
    if (userId) {
      const install = this.db.prepare(`
        SELECT 1 FROM custom_theme_installs WHERE user_id = ? AND theme_id = ?
      `).get(userId, themeId);
      isInstalled = !!install;
    }

    return {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      variables: JSON.parse(theme.variables),
      isPublic: theme.is_public === 1,
      installCount: theme.install_count,
      creatorId: theme.creator_id,
      creatorHandle: theme.creator_handle,
      creatorDisplayName: theme.creator_display_name,
      createdAt: theme.created_at,
      updatedAt: theme.updated_at,
      isOwn: userId && theme.creator_id === userId,
      isInstalled,
    };
  }

  // Create a new custom theme
  createCustomTheme(userId, data) {
    const now = new Date().toISOString();
    const id = `theme-${uuidv4()}`;

    // Validate variables
    const validation = this.validateThemeVariables(data.variables);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Check user's theme count (max 20)
    const themeCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM custom_themes WHERE creator_id = ?
    `).get(userId).count;

    if (themeCount >= 20) {
      return { success: false, error: 'Maximum of 20 custom themes reached' };
    }

    // Check for duplicate name for this user
    const existing = this.db.prepare(`
      SELECT id FROM custom_themes WHERE creator_id = ? AND name = ?
    `).get(userId, data.name);

    if (existing) {
      return { success: false, error: 'A theme with this name already exists' };
    }

    this.db.prepare(`
      INSERT INTO custom_themes (id, creator_id, name, description, variables, is_public, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, data.name, data.description || '', JSON.stringify(data.variables), data.isPublic ? 1 : 0, now, now);

    return {
      success: true,
      theme: {
        id,
        name: data.name,
        description: data.description || '',
        variables: data.variables,
        isPublic: data.isPublic || false,
        installCount: 0,
        creatorId: userId,
        createdAt: now,
        updatedAt: now,
        isOwn: true,
        isInstalled: false,
      },
    };
  }

  // Update a custom theme
  updateCustomTheme(themeId, userId, data) {
    const now = new Date().toISOString();

    // Verify ownership
    const theme = this.db.prepare(`
      SELECT * FROM custom_themes WHERE id = ? AND creator_id = ?
    `).get(themeId, userId);

    if (!theme) {
      return { success: false, error: 'Theme not found or access denied' };
    }

    // Validate variables if provided
    if (data.variables) {
      const validation = this.validateThemeVariables(data.variables);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
    }

    // Check for duplicate name if name is being changed
    if (data.name && data.name !== theme.name) {
      const existing = this.db.prepare(`
        SELECT id FROM custom_themes WHERE creator_id = ? AND name = ? AND id != ?
      `).get(userId, data.name, themeId);

      if (existing) {
        return { success: false, error: 'A theme with this name already exists' };
      }
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (data.variables !== undefined) {
      updates.push('variables = ?');
      params.push(JSON.stringify(data.variables));
    }
    if (data.isPublic !== undefined) {
      updates.push('is_public = ?');
      params.push(data.isPublic ? 1 : 0);
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(themeId, userId);

    this.db.prepare(`
      UPDATE custom_themes
      SET ${updates.join(', ')}
      WHERE id = ? AND creator_id = ?
    `).run(...params);

    return { success: true };
  }

  // Delete a custom theme
  deleteCustomTheme(themeId, userId) {
    // Verify ownership
    const theme = this.db.prepare(`
      SELECT * FROM custom_themes WHERE id = ? AND creator_id = ?
    `).get(themeId, userId);

    if (!theme) {
      return { success: false, error: 'Theme not found or access denied' };
    }

    // Delete theme (CASCADE will delete installs)
    this.db.prepare('DELETE FROM custom_themes WHERE id = ?').run(themeId);

    return { success: true };
  }

  // Install a public theme
  installTheme(themeId, userId) {
    const now = new Date().toISOString();

    // Verify theme exists and is public (or user is creator)
    const theme = this.db.prepare(`
      SELECT * FROM custom_themes WHERE id = ?
    `).get(themeId);

    if (!theme) {
      return { success: false, error: 'Theme not found' };
    }

    if (!theme.is_public && theme.creator_id !== userId) {
      return { success: false, error: 'Theme is not public' };
    }

    // Check if already installed
    const existing = this.db.prepare(`
      SELECT 1 FROM custom_theme_installs WHERE user_id = ? AND theme_id = ?
    `).get(userId, themeId);

    if (existing) {
      return { success: false, error: 'Theme already installed' };
    }

    // Install theme
    this.db.prepare(`
      INSERT INTO custom_theme_installs (user_id, theme_id, installed_at)
      VALUES (?, ?, ?)
    `).run(userId, themeId, now);

    // Increment install count (don't count creator's own install)
    if (theme.creator_id !== userId) {
      this.db.prepare(`
        UPDATE custom_themes SET install_count = install_count + 1 WHERE id = ?
      `).run(themeId);
    }

    return { success: true };
  }

  // Uninstall a theme
  uninstallTheme(themeId, userId) {
    // Verify theme exists
    const theme = this.db.prepare(`
      SELECT * FROM custom_themes WHERE id = ?
    `).get(themeId);

    if (!theme) {
      return { success: false, error: 'Theme not found' };
    }

    // Can't uninstall your own theme
    if (theme.creator_id === userId) {
      return { success: false, error: 'Cannot uninstall your own theme' };
    }

    // Check if installed
    const existing = this.db.prepare(`
      SELECT 1 FROM custom_theme_installs WHERE user_id = ? AND theme_id = ?
    `).get(userId, themeId);

    if (!existing) {
      return { success: false, error: 'Theme not installed' };
    }

    // Uninstall theme
    this.db.prepare(`
      DELETE FROM custom_theme_installs WHERE user_id = ? AND theme_id = ?
    `).run(userId, themeId);

    // Decrement install count
    this.db.prepare(`
      UPDATE custom_themes SET install_count = install_count - 1 WHERE id = ? AND install_count > 0
    `).run(themeId);

    return { success: true };
  }

  // Get public themes for gallery (paginated)
  getPublicThemes(options = {}) {
    const { limit = 20, offset = 0, sortBy = 'newest', search = null } = options;

    let orderBy;
    switch (sortBy) {
      case 'popular':
        orderBy = 'ct.install_count DESC, ct.created_at DESC';
        break;
      case 'newest':
      default:
        orderBy = 'ct.created_at DESC';
        break;
    }

    let whereClause = 'WHERE ct.is_public = 1';
    const params = [];

    if (search) {
      whereClause += ' AND (ct.name LIKE ? OR ct.description LIKE ? OR u.handle LIKE ? OR u.display_name LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    const themes = this.db.prepare(`
      SELECT ct.*, u.handle as creator_handle, u.display_name as creator_display_name
      FROM custom_themes ct
      JOIN users u ON ct.creator_id = u.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params, limit + 1, offset);

    const hasMore = themes.length > limit;
    const results = themes.slice(0, limit);

    return {
      themes: results.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        variables: JSON.parse(t.variables),
        isPublic: true,
        installCount: t.install_count,
        creatorId: t.creator_id,
        creatorHandle: t.creator_handle,
        creatorDisplayName: t.creator_display_name,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
      hasMore,
      total: this.db.prepare(`SELECT COUNT(*) as count FROM custom_themes ct JOIN users u ON ct.creator_id = u.id ${whereClause}`).get(...params).count,
    };
  }

  // === Droplet Methods (formerly Message Methods) ===
  getDropletsForWave(waveId, userId = null) {
    // Get blocked/muted users
    let blockedIds = [];
    let mutedIds = [];
    if (userId) {
      blockedIds = this.db.prepare('SELECT blocked_user_id FROM blocks WHERE user_id = ?').all(userId).map(r => r.blocked_user_id);
      mutedIds = this.db.prepare('SELECT muted_user_id FROM mutes WHERE user_id = ?').all(userId).map(r => r.muted_user_id);
    }

    let sql = `
      SELECT d.*,
             u.display_name as user_display_name, u.avatar as user_avatar, u.avatar_url as user_avatar_url, u.handle as user_handle,
             b.name as bot_name, b.id as bot_id,
             bow.title as broken_out_to_title
      FROM pings d
      JOIN users u ON d.author_id = u.id
      LEFT JOIN bots b ON d.bot_id = b.id
      LEFT JOIN waves bow ON d.broken_out_to = bow.id
      WHERE d.wave_id = ?
    `;
    const params = [waveId];

    if (blockedIds.length > 0) {
      sql += ` AND d.author_id NOT IN (${blockedIds.map(() => '?').join(',')})`;
      params.push(...blockedIds);
    }
    if (mutedIds.length > 0) {
      sql += ` AND d.author_id NOT IN (${mutedIds.map(() => '?').join(',')})`;
      params.push(...mutedIds);
    }

    sql += ' ORDER BY d.created_at ASC';

    const rows = this.db.prepare(sql).all(...params);

    const localDroplets = rows.map(d => {
      // Check if user has read this ping
      const hasRead = userId ? !!this.db.prepare('SELECT 1 FROM ping_read_by WHERE ping_id = ? AND user_id = ?').get(d.id, userId) : false;
      const isUnread = d.deleted ? false : (userId ? !hasRead && d.author_id !== userId : false);

      // Get read by users
      const readBy = this.db.prepare('SELECT user_id FROM ping_read_by WHERE ping_id = ?').all(d.id).map(r => r.user_id);

      // Use bot information if this is a bot ping
      const isBot = !!d.bot_id;
      const senderName = isBot ? `[Bot] ${d.bot_name}` : d.user_display_name;
      const senderAvatar = isBot ? '🤖' : d.user_avatar;
      const senderAvatarUrl = isBot ? null : d.user_avatar_url;
      const senderHandle = isBot ? d.bot_name.toLowerCase().replace(/\s+/g, '-') : d.user_handle;

      return {
        id: d.id,
        waveId: d.wave_id,
        parentId: d.parent_id,
        authorId: d.author_id,
        content: d.content,
        privacy: d.privacy,
        version: d.version,
        createdAt: d.created_at,
        editedAt: d.edited_at,
        deleted: d.deleted === 1,
        deletedAt: d.deleted_at,
        reactions: d.reactions ? JSON.parse(d.reactions) : {},
        readBy,
        sender_name: senderName,
        sender_avatar: senderAvatar,
        sender_avatar_url: senderAvatarUrl,
        sender_handle: senderHandle,
        author_id: d.author_id,
        parent_id: d.parent_id,
        wave_id: d.wave_id,
        created_at: d.created_at,
        edited_at: d.edited_at,
        deleted_at: d.deleted_at,
        is_unread: isUnread,
        brokenOutTo: d.broken_out_to,
        brokenOutToTitle: d.broken_out_to_title,
        isRemote: false,
        encrypted: d.encrypted === 1,
        nonce: d.nonce,
        keyVersion: d.key_version,
        isBot: isBot,
        botId: d.bot_id || undefined,
        // Media fields (v2.7.0)
        media_type: d.media_type,
        media_url: d.media_url,
        media_duration: d.media_duration,
        media_encrypted: d.media_encrypted === 1,
      };
    });

    // Also get remote droplets for federated waves
    const remoteDroplets = this.getRemoteDropletsForWave(waveId).map(rd => ({
      id: rd.id,
      waveId: rd.waveId,
      parentId: rd.parentId,
      authorId: rd.authorId,
      content: rd.content,
      privacy: null,
      version: 1,
      createdAt: rd.createdAt,
      editedAt: rd.editedAt,
      deleted: rd.deleted,
      deletedAt: null,
      reactions: rd.reactions || {},
      readBy: [],
      sender_name: rd.authorDisplayName || 'Unknown',
      sender_avatar: rd.authorAvatar || '?',
      sender_avatar_url: rd.authorAvatarUrl,
      sender_handle: `${rd.authorId}@${rd.authorNode}`,
      author_id: rd.authorId,
      parent_id: rd.parentId,
      wave_id: rd.waveId,
      created_at: rd.createdAt,
      edited_at: rd.editedAt,
      deleted_at: null,
      is_unread: false, // Remote droplets don't track read status locally
      brokenOutTo: null,
      brokenOutToTitle: null,
      isRemote: true,
      originNode: rd.originNode,
      authorNode: rd.authorNode,
    }));

    // Merge and deduplicate by ID (prefer local over remote)
    const seenIds = new Set(localDroplets.map(d => d.id));
    const uniqueRemoteDroplets = remoteDroplets.filter(rd => !seenIds.has(rd.id));

    const allDroplets = [...localDroplets, ...uniqueRemoteDroplets];
    allDroplets.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return allDroplets;
  }

  // Backward compatibility alias
  getMessagesForWave(waveId, userId = null) {
    return this.getDropletsForWave(waveId, userId);
  }

  // Low-Bandwidth Mode: Minimal droplet fetching (v2.10.0)
  // Omits reactions, readBy, and is_unread to reduce payload by 30-50%
  getDropletsForWaveMinimal(waveId, userId = null) {
    // Get blocked/muted users
    let blockedIds = [];
    let mutedIds = [];
    if (userId) {
      blockedIds = this.db.prepare('SELECT blocked_user_id FROM blocks WHERE user_id = ?').all(userId).map(r => r.blocked_user_id);
      mutedIds = this.db.prepare('SELECT muted_user_id FROM mutes WHERE user_id = ?').all(userId).map(r => r.muted_user_id);
    }

    let sql = `
      SELECT d.id, d.wave_id, d.parent_id, d.author_id, d.content,
             d.created_at, d.edited_at, d.deleted, d.deleted_at, d.encrypted, d.nonce, d.key_version,
             d.broken_out_to, d.media_type, d.media_url, d.media_duration, d.media_encrypted,
             u.display_name as user_display_name, u.avatar as user_avatar, u.avatar_url as user_avatar_url, u.handle as user_handle,
             b.name as bot_name, b.id as bot_id,
             bow.title as broken_out_to_title
      FROM pings d
      JOIN users u ON d.author_id = u.id
      LEFT JOIN bots b ON d.bot_id = b.id
      LEFT JOIN waves bow ON d.broken_out_to = bow.id
      WHERE d.wave_id = ?
    `;
    const params = [waveId];

    if (blockedIds.length > 0) {
      sql += ` AND d.author_id NOT IN (${blockedIds.map(() => '?').join(',')})`;
      params.push(...blockedIds);
    }
    if (mutedIds.length > 0) {
      sql += ` AND d.author_id NOT IN (${mutedIds.map(() => '?').join(',')})`;
      params.push(...mutedIds);
    }

    sql += ' ORDER BY d.created_at ASC';

    const rows = this.db.prepare(sql).all(...params);

    const localDroplets = rows.map(d => {
      // Use bot information if this is a bot ping
      const isBot = !!d.bot_id;
      const senderName = isBot ? `[Bot] ${d.bot_name}` : d.user_display_name;
      const senderAvatar = isBot ? '🤖' : d.user_avatar;
      const senderAvatarUrl = isBot ? null : d.user_avatar_url;
      const senderHandle = isBot ? d.bot_name.toLowerCase().replace(/\s+/g, '-') : d.user_handle;

      return {
        id: d.id,
        waveId: d.wave_id,
        parentId: d.parent_id,
        authorId: d.author_id,
        content: d.content,
        createdAt: d.created_at,
        editedAt: d.edited_at,
        deleted: d.deleted === 1,
        sender_name: senderName,
        sender_avatar: senderAvatar,
        sender_avatar_url: senderAvatarUrl,
        sender_handle: senderHandle,
        author_id: d.author_id,
        parent_id: d.parent_id,
        wave_id: d.wave_id,
        created_at: d.created_at,
        edited_at: d.edited_at,
        brokenOutTo: d.broken_out_to,
        brokenOutToTitle: d.broken_out_to_title,
        isRemote: false,
        encrypted: d.encrypted === 1,
        nonce: d.nonce,
        keyVersion: d.key_version,
        isBot: isBot,
        botId: d.bot_id || undefined,
        // Media fields (v2.7.0)
        media_type: d.media_type,
        media_url: d.media_url,
        media_duration: d.media_duration,
        media_encrypted: d.media_encrypted === 1,
        // Omitted for minimal mode: reactions, readBy, is_unread
        minimal: true,
      };
    });

    // Also get remote droplets for federated waves (minimal)
    const remoteDroplets = this.getRemoteDropletsForWave(waveId).map(rd => ({
      id: rd.id,
      waveId: rd.waveId,
      parentId: rd.parentId,
      authorId: rd.authorId,
      content: rd.content,
      createdAt: rd.createdAt,
      editedAt: rd.editedAt,
      deleted: rd.deleted,
      sender_name: rd.authorDisplayName || 'Unknown',
      sender_avatar: rd.authorAvatar || '?',
      sender_avatar_url: rd.authorAvatarUrl,
      sender_handle: `${rd.authorId}@${rd.authorNode}`,
      author_id: rd.authorId,
      parent_id: rd.parentId,
      wave_id: rd.waveId,
      created_at: rd.createdAt,
      edited_at: rd.editedAt,
      brokenOutTo: null,
      brokenOutToTitle: null,
      isRemote: true,
      originNode: rd.originNode,
      authorNode: rd.authorNode,
      minimal: true,
    }));

    // Merge and deduplicate by ID (prefer local over remote)
    const seenIds = new Set(localDroplets.map(d => d.id));
    const uniqueRemoteDroplets = remoteDroplets.filter(rd => !seenIds.has(rd.id));

    const allDroplets = [...localDroplets, ...uniqueRemoteDroplets];
    allDroplets.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return allDroplets;
  }

  createDroplet(data) {
    const now = new Date().toISOString();

    // For encrypted content, skip sanitization (it's base64 ciphertext)
    // For unencrypted content, sanitize and auto-embed media URLs
    let content;
    if (data.encrypted) {
      content = data.content;  // Raw ciphertext, no processing
    } else {
      content = sanitizeMessage(data.content);
      content = detectAndEmbedMedia(content);
    }

    const droplet = {
      id: `droplet-${uuidv4()}`,
      waveId: data.waveId,
      parentId: data.parentId || null,
      authorId: data.authorId,
      content: content,
      privacy: data.privacy || 'private',
      version: 1,
      createdAt: now,
      editedAt: null,
      reactions: {},
      encrypted: data.encrypted ? 1 : 0,
      nonce: data.nonce || null,
      keyVersion: data.keyVersion || null,
      // Media fields (v2.7.0)
      mediaType: data.mediaType || null,       // 'audio', 'video', or null
      mediaUrl: data.mediaUrl || null,
      mediaDuration: data.mediaDuration || null,
      mediaEncrypted: data.mediaEncrypted ? 1 : 0,
    };

    // Check if parent is a remote droplet (exists in remote_pings but not in droplets)
    // If so, we need to temporarily disable FK checks since remote droplets aren't in the droplets table
    let isRemoteParent = false;
    if (droplet.parentId) {
      const localParent = this.db.prepare('SELECT id FROM pings WHERE id = ?').get(droplet.parentId);
      if (!localParent) {
        const remoteParent = this.db.prepare('SELECT id FROM remote_pings WHERE id = ?').get(droplet.parentId);
        isRemoteParent = !!remoteParent;
      }
    }

    if (isRemoteParent) {
      // Temporarily disable FK checks for inserting a reply to a remote droplet
      this.db.exec('PRAGMA foreign_keys = OFF');
      try {
        this.db.prepare(`
          INSERT INTO pings (id, wave_id, parent_id, author_id, content, privacy, version, created_at, reactions, encrypted, nonce, key_version, bot_id, media_type, media_url, media_duration, media_encrypted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(droplet.id, droplet.waveId, droplet.parentId, droplet.authorId, droplet.content, droplet.privacy, droplet.version, droplet.createdAt, droplet.encrypted, droplet.nonce, droplet.keyVersion, data.botId || null, droplet.mediaType, droplet.mediaUrl, droplet.mediaDuration, droplet.mediaEncrypted);
      } finally {
        this.db.exec('PRAGMA foreign_keys = ON');
      }
    } else {
      this.db.prepare(`
        INSERT INTO pings (id, wave_id, parent_id, author_id, content, privacy, version, created_at, reactions, encrypted, nonce, key_version, bot_id, media_type, media_url, media_duration, media_encrypted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(droplet.id, droplet.waveId, droplet.parentId, droplet.authorId, droplet.content, droplet.privacy, droplet.version, droplet.createdAt, droplet.encrypted, droplet.nonce, droplet.keyVersion, data.botId || null, droplet.mediaType, droplet.mediaUrl, droplet.mediaDuration, droplet.mediaEncrypted);
    }

    // Author has read their own ping (skip for bot pings)
    if (!data.botId) {
      this.db.prepare('INSERT INTO ping_read_by (ping_id, user_id, read_at) VALUES (?, ?, ?)').run(droplet.id, data.authorId, now);
    }

    // Update wave timestamp
    this.updateWaveTimestamp(data.waveId);

    // If it's a bot ping, return bot information
    if (data.botId) {
      const bot = this.getBot(data.botId);
      return {
        ...droplet,
        bot_id: data.botId,
        sender_name: bot ? `[Bot] ${bot.name}` : '[Bot] Unknown',
        sender_avatar: '🤖',
        sender_avatar_url: null,
        sender_handle: bot ? bot.name.toLowerCase().replace(/\s+/g, '-') : 'unknown-bot',
        author_id: droplet.authorId,
        parent_id: droplet.parentId,
        wave_id: droplet.waveId,
        created_at: droplet.createdAt,
        edited_at: droplet.editedAt,
        isBot: true,
        botId: data.botId,
        // Media fields (v2.7.0)
        media_type: droplet.mediaType,
        media_url: droplet.mediaUrl,
        media_duration: droplet.mediaDuration,
        media_encrypted: droplet.mediaEncrypted,
      };
    }

    const author = this.findUserById(data.authorId);
    return {
      ...droplet,
      sender_name: author?.displayName || 'Unknown',
      sender_avatar: author?.avatar || '?',
      sender_avatar_url: author?.avatarUrl || null,
      sender_handle: author?.handle || 'unknown',
      author_id: droplet.authorId,
      parent_id: droplet.parentId,
      wave_id: droplet.waveId,
      created_at: droplet.createdAt,
      edited_at: droplet.editedAt,
      // Media fields (v2.7.0)
      media_type: droplet.mediaType,
      media_url: droplet.mediaUrl,
      media_duration: droplet.mediaDuration,
      media_encrypted: droplet.mediaEncrypted,
    };
  }

  // Backward compatibility alias
  createMessage(data) {
    return this.createDroplet(data);
  }

  getDroplet(dropletId) {
    const d = this.db.prepare(`
      SELECT d.*, u.display_name as sender_name, u.avatar as sender_avatar, u.avatar_url as sender_avatar_url, u.handle as sender_handle
      FROM pings d
      JOIN users u ON d.author_id = u.id
      WHERE d.id = ?
    `).get(dropletId);

    if (!d) return null;

    return {
      id: d.id,
      waveId: d.wave_id,
      parentId: d.parent_id,
      authorId: d.author_id,
      content: d.content,
      privacy: d.privacy,
      version: d.version,
      createdAt: d.created_at,
      editedAt: d.edited_at,
      deleted: d.deleted === 1,
      deletedAt: d.deleted_at,
      reactions: d.reactions ? JSON.parse(d.reactions) : {},
      sender_name: d.sender_name,
      sender_avatar: d.sender_avatar,
      sender_avatar_url: d.sender_avatar_url,
      sender_handle: d.sender_handle,
      author_id: d.author_id,
      parent_id: d.parent_id,
      wave_id: d.wave_id,
      created_at: d.created_at,
      edited_at: d.edited_at,
      deleted_at: d.deleted_at,
      brokenOutTo: d.broken_out_to,
      encrypted: d.encrypted === 1,
      nonce: d.nonce,
      keyVersion: d.key_version,
      // Media fields (v2.7.0)
      media_type: d.media_type,
      media_url: d.media_url,
      media_duration: d.media_duration,
      media_encrypted: d.media_encrypted === 1,
    };
  }

  // Backward compatibility alias
  getMessage(dropletId) {
    return this.getDroplet(dropletId);
  }

  updateDroplet(dropletId, content) {
    const droplet = this.db.prepare('SELECT * FROM pings WHERE id = ?').get(dropletId);
    if (!droplet || droplet.deleted) return null;

    // Save history
    this.db.prepare(`
      INSERT INTO ping_history (id, ping_id, content, version, edited_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(`hist-${uuidv4()}`, dropletId, droplet.content, droplet.version, new Date().toISOString());

    // Sanitize and auto-embed media URLs (same as createDroplet)
    let processedContent = sanitizeMessage(content);
    processedContent = detectAndEmbedMedia(processedContent);

    // Update droplet
    const now = new Date().toISOString();
    this.db.prepare('UPDATE pings SET content = ?, version = ?, edited_at = ? WHERE id = ?').run(processedContent, droplet.version + 1, now, dropletId);

    // Return updated droplet
    const updated = this.db.prepare(`
      SELECT d.*, u.display_name as sender_name, u.avatar as sender_avatar, u.avatar_url as sender_avatar_url, u.handle as sender_handle
      FROM pings d
      JOIN users u ON d.author_id = u.id
      WHERE d.id = ?
    `).get(dropletId);

    return {
      id: updated.id,
      waveId: updated.wave_id,
      parentId: updated.parent_id,
      authorId: updated.author_id,
      content: updated.content,
      privacy: updated.privacy,
      version: updated.version,
      createdAt: updated.created_at,
      editedAt: updated.edited_at,
      sender_name: updated.sender_name,
      sender_avatar: updated.sender_avatar,
      sender_avatar_url: updated.sender_avatar_url,
      sender_handle: updated.sender_handle,
      author_id: updated.author_id,
      parent_id: updated.parent_id,
      wave_id: updated.wave_id,
      created_at: updated.created_at,
      edited_at: updated.edited_at,
    };
  }

  // Backward compatibility alias
  updateMessage(dropletId, content) {
    return this.updateDroplet(dropletId, content);
  }

  deleteDroplet(dropletId, userId) {
    const droplet = this.db.prepare('SELECT * FROM pings WHERE id = ?').get(dropletId);
    if (!droplet) return { success: false, error: 'Droplet not found' };
    if (droplet.deleted) return { success: false, error: 'Droplet already deleted' };
    if (droplet.author_id !== userId) return { success: false, error: 'Only droplet author can delete' };

    const now = new Date().toISOString();

    // Soft delete
    this.db.prepare(`
      UPDATE pings SET content = '[Droplet deleted]', deleted = 1, deleted_at = ?, reactions = '{}'
      WHERE id = ?
    `).run(now, dropletId);

    // Clear read status
    this.db.prepare('DELETE FROM ping_read_by WHERE ping_id = ?').run(dropletId);

    // Clear history
    this.db.prepare('DELETE FROM ping_history WHERE ping_id = ?').run(dropletId);

    return { success: true, dropletId, waveId: droplet.wave_id, deleted: true };
  }

  // Backward compatibility alias
  deleteMessage(dropletId, userId) {
    return this.deleteDroplet(dropletId, userId);
  }

  toggleDropletReaction(dropletId, userId, emoji) {
    const droplet = this.db.prepare('SELECT * FROM pings WHERE id = ?').get(dropletId);
    if (!droplet) return { success: false, error: 'Droplet not found' };
    if (droplet.deleted) return { success: false, error: 'Cannot react to deleted droplet' };

    let reactions = droplet.reactions ? JSON.parse(droplet.reactions) : {};
    if (!reactions[emoji]) reactions[emoji] = [];

    const userIndex = reactions[emoji].indexOf(userId);
    if (userIndex > -1) {
      reactions[emoji].splice(userIndex, 1);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji].push(userId);
    }

    this.db.prepare('UPDATE pings SET reactions = ? WHERE id = ?').run(JSON.stringify(reactions), dropletId);

    return { success: true, dropletId, reactions, waveId: droplet.wave_id };
  }

  // Backward compatibility alias
  toggleMessageReaction(dropletId, userId, emoji) {
    return this.toggleDropletReaction(dropletId, userId, emoji);
  }

  markDropletAsRead(dropletId, userId) {
    const droplet = this.db.prepare('SELECT * FROM pings WHERE id = ?').get(dropletId);
    if (!droplet) return false;
    if (droplet.deleted) return true;

    try {
      this.db.prepare('INSERT INTO ping_read_by (ping_id, user_id, read_at) VALUES (?, ?, ?)').run(dropletId, userId, new Date().toISOString());
      return true;
    } catch {
      // Already read
      return true;
    }
  }

  // Backward compatibility alias
  markMessageAsRead(dropletId, userId) {
    return this.markDropletAsRead(dropletId, userId);
  }

  searchDroplets(query, filters = {}) {
    const { waveId, authorId, fromDate, toDate } = filters;
    const searchTerm = query.trim();
    if (!searchTerm) return [];

    // Escape FTS5 special characters and prepare search terms
    // FTS5 uses AND by default for multiple terms
    const ftsQuery = searchTerm
      .replace(/["\-*()]/g, ' ')  // Remove FTS special chars
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `"${term}"*`)  // Prefix match for each term
      .join(' ');

    if (!ftsQuery) return [];

    // Use FTS5 for full-text search with snippet highlighting
    // snippet() returns text with highlighted matches using <mark> tags
    let sql = `
      SELECT
        d.id,
        d.content,
        snippet(pings_fts, 1, '<mark>', '</mark>', '...', 64) as snippet,
        d.wave_id,
        d.author_id,
        d.created_at,
        d.parent_id,
        w.title as wave_name,
        u.display_name as author_name,
        u.handle as author_handle,
        bm25(pings_fts) as rank
      FROM pings_fts
      JOIN pings d ON pings_fts.id = d.id
      JOIN waves w ON d.wave_id = w.id
      JOIN users u ON d.author_id = u.id
      WHERE pings_fts MATCH ? AND d.deleted = 0
    `;
    const params = [ftsQuery];

    if (waveId) {
      sql += ' AND d.wave_id = ?';
      params.push(waveId);
    }
    if (authorId) {
      sql += ' AND d.author_id = ?';
      params.push(authorId);
    }
    if (fromDate) {
      sql += ' AND d.created_at >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      sql += ' AND d.created_at <= ?';
      params.push(toDate);
    }

    // Order by relevance (bm25), then by date
    sql += ' ORDER BY rank, d.created_at DESC LIMIT 100';

    try {
      const rows = this.db.prepare(sql).all(...params);

      return rows.map(r => ({
        id: r.id,
        content: r.content,
        snippet: r.snippet,  // Highlighted snippet with <mark> tags
        waveId: r.wave_id,
        waveName: r.wave_name,
        authorId: r.author_id,
        authorName: r.author_name,
        authorHandle: r.author_handle,
        createdAt: r.created_at,
        parentId: r.parent_id,
      }));
    } catch (err) {
      // Fallback to LIKE search if FTS fails (e.g., invalid query)
      console.warn('FTS search failed, falling back to LIKE:', err.message);
      return this.searchDropletsLike(query, filters);
    }
  }

  // Backward compatibility alias
  searchMessages(query, filters = {}) {
    return this.searchDroplets(query, filters);
  }

  // Fallback LIKE-based search for when FTS fails
  searchDropletsLike(query, filters = {}) {
    const { waveId, authorId, fromDate, toDate } = filters;
    const searchTerm = query.toLowerCase().trim();
    if (!searchTerm) return [];

    let sql = `
      SELECT d.id, d.content, d.wave_id, d.author_id, d.created_at, d.parent_id,
        w.title as wave_name, u.display_name as author_name, u.handle as author_handle
      FROM pings d
      JOIN waves w ON d.wave_id = w.id
      JOIN users u ON d.author_id = u.id
      WHERE d.content LIKE ? AND d.deleted = 0
    `;
    const params = [`%${searchTerm}%`];

    if (waveId) {
      sql += ' AND d.wave_id = ?';
      params.push(waveId);
    }
    if (authorId) {
      sql += ' AND d.author_id = ?';
      params.push(authorId);
    }
    if (fromDate) {
      sql += ' AND d.created_at >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      sql += ' AND d.created_at <= ?';
      params.push(toDate);
    }

    sql += ' ORDER BY d.created_at DESC LIMIT 100';

    const rows = this.db.prepare(sql).all(...params);

    return rows.map(r => ({
      id: r.id,
      content: r.content,
      snippet: null,  // No highlighting for LIKE search
      waveId: r.wave_id,
      waveName: r.wave_name,
      authorId: r.author_id,
      authorName: r.author_name,
      authorHandle: r.author_handle,
      createdAt: r.created_at,
      parentId: r.parent_id,
    }));
  }

  // Backward compatibility alias
  searchMessagesLike(query, filters = {}) {
    return this.searchDropletsLike(query, filters);
  }

  // ============ Push Subscription Methods ============

  getPushSubscriptions(userId) {
    const rows = this.db.prepare(`
      SELECT * FROM push_subscriptions WHERE user_id = ?
    `).all(userId);

    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      endpoint: r.endpoint,
      keys: JSON.parse(r.keys),
      createdAt: r.created_at
    }));
  }

  addPushSubscription(userId, subscription) {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Use ON CONFLICT to properly handle duplicate user_id + endpoint combinations
    this.db.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, keys, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, endpoint) DO UPDATE SET
        keys = excluded.keys,
        created_at = excluded.created_at
    `).run(id, userId, subscription.endpoint, JSON.stringify(subscription.keys), now);

    return true;
  }

  removePushSubscription(userId, endpoint) {
    const result = this.db.prepare(`
      DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?
    `).run(userId, endpoint);

    return result.changes > 0;
  }

  removeAllPushSubscriptions(userId) {
    const result = this.db.prepare(`
      DELETE FROM push_subscriptions WHERE user_id = ?
    `).run(userId);

    return result.changes > 0;
  }

  removeExpiredPushSubscription(endpoint) {
    // Called when a push notification fails (subscription expired/invalid)
    this.db.prepare(`
      DELETE FROM push_subscriptions WHERE endpoint = ?
    `).run(endpoint);
  }

  // ============ Notification Methods ============

  createNotification({ userId, type, waveId, dropletId, actorId, title, body, preview, groupKey }) {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO notifications (id, user_id, type, wave_id, ping_id, actor_id, title, body, preview, read, dismissed, push_sent, created_at, group_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
    `).run(id, userId, type, waveId || null, dropletId || null, actorId || null, title, body || null, preview || null, now, groupKey || null);

    return {
      id,
      userId,
      type,
      waveId,
      dropletId,
      actorId,
      title,
      body,
      preview,
      read: false,
      dismissed: false,
      pushSent: false,
      createdAt: now,
      groupKey
    };
  }

  getNotifications(userId, { unread = false, type = null, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT n.*,
             u.handle as actor_handle,
             u.display_name as actor_display_name,
             u.avatar as actor_avatar,
             u.avatar_url as actor_avatar_url,
             w.title as wave_title
      FROM notifications n
      LEFT JOIN users u ON n.actor_id = u.id
      LEFT JOIN waves w ON n.wave_id = w.id
      WHERE n.user_id = ? AND n.dismissed = 0
    `;
    const params = [userId];

    if (unread) {
      query += ' AND n.read = 0';
    }
    if (type) {
      query += ' AND n.type = ?';
      params.push(type);
    }

    query += ' ORDER BY n.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params);

    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      waveId: r.wave_id,
      dropletId: r.ping_id,
      actorId: r.actor_id,
      title: r.title,
      body: r.body,
      preview: r.preview,
      read: !!r.read,
      dismissed: !!r.dismissed,
      pushSent: !!r.push_sent,
      createdAt: r.created_at,
      readAt: r.read_at,
      groupKey: r.group_key,
      // Actor info
      actorHandle: r.actor_handle,
      actorDisplayName: r.actor_display_name,
      actorAvatar: r.actor_avatar,
      actorAvatarUrl: r.actor_avatar_url,
      waveTitle: r.wave_title
    }));
  }

  getNotificationCounts(userId) {
    const rows = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM notifications
      WHERE user_id = ? AND read = 0 AND dismissed = 0
      GROUP BY type
    `).all(userId);

    const byType = {};
    let total = 0;
    for (const r of rows) {
      byType[r.type] = r.count;
      total += r.count;
    }

    return { total, byType };
  }

  // Get unread notification counts grouped by wave with priority types
  getUnreadCountsByWave(userId) {
    const rows = this.db.prepare(`
      SELECT wave_id, type, COUNT(*) as count
      FROM notifications
      WHERE user_id = ? AND read = 0 AND dismissed = 0 AND wave_id IS NOT NULL
      GROUP BY wave_id, type
    `).all(userId);

    const byWave = {};
    // Priority: direct_mention > reply > ripple > wave_activity
    const typePriority = { direct_mention: 4, reply: 3, ripple: 2, wave_activity: 1 };

    for (const r of rows) {
      if (!byWave[r.wave_id]) {
        byWave[r.wave_id] = { count: 0, highestType: null, highestPriority: 0 };
      }
      byWave[r.wave_id].count += r.count;
      const priority = typePriority[r.type] || 0;
      if (priority > byWave[r.wave_id].highestPriority) {
        byWave[r.wave_id].highestPriority = priority;
        byWave[r.wave_id].highestType = r.type;
      }
    }

    return byWave;
  }

  markNotificationRead(notificationId) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE notifications SET read = 1, read_at = ? WHERE id = ?
    `).run(now, notificationId);
    return result.changes > 0;
  }

  // Mark all notifications for a specific ping as read for a user
  markNotificationsReadByDroplet(dropletId, userId) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE notifications SET read = 1, read_at = ?
      WHERE ping_id = ? AND user_id = ? AND read = 0
    `).run(now, dropletId, userId);
    return result.changes;
  }

  // Mark all notifications for a specific wave as read for a user
  markNotificationsReadByWave(waveId, userId) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE notifications SET read = 1, read_at = ?
      WHERE wave_id = ? AND user_id = ? AND read = 0
    `).run(now, waveId, userId);
    return result.changes;
  }

  markAllNotificationsRead(userId) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE notifications SET read = 1, read_at = ? WHERE user_id = ? AND read = 0
    `).run(now, userId);
    return result.changes;
  }

  dismissNotification(notificationId) {
    const result = this.db.prepare(`
      UPDATE notifications SET dismissed = 1 WHERE id = ?
    `).run(notificationId);
    return result.changes > 0;
  }

  dismissAllNotifications(userId) {
    const result = this.db.prepare(`
      UPDATE notifications SET dismissed = 1 WHERE user_id = ? AND dismissed = 0
    `).run(userId);
    return result.changes;
  }

  markNotificationPushSent(notificationId) {
    this.db.prepare(`
      UPDATE notifications SET push_sent = 1 WHERE id = ?
    `).run(notificationId);
  }

  getPendingNotifications(userId) {
    // Clean up: mark notifications as read if user already read the underlying message
    const stale = this.db.prepare(`
      SELECT n.id FROM notifications n
      INNER JOIN ping_read_by prb ON prb.ping_id = n.ping_id AND prb.user_id = n.user_id
      WHERE n.user_id = ? AND n.push_sent = 0 AND n.read = 0 AND n.dismissed = 0
        AND n.ping_id IS NOT NULL
    `).all(userId);
    if (stale.length > 0) {
      const now = new Date().toISOString();
      const stmt = this.db.prepare('UPDATE notifications SET push_sent = 1, read = 1, read_at = ? WHERE id = ?');
      const tx = this.db.transaction(() => { for (const r of stale) stmt.run(now, r.id); });
      tx();
    }

    // Fetch genuinely pending notifications
    const rows = this.db.prepare(`
      SELECT n.*, u.handle as actor_handle, u.display_name as actor_display_name,
             u.avatar_url as actor_avatar_url, w.title as wave_title
      FROM notifications n
      LEFT JOIN users u ON n.actor_id = u.id
      LEFT JOIN waves w ON n.wave_id = w.id
      WHERE n.user_id = ? AND n.push_sent = 0 AND n.read = 0 AND n.dismissed = 0
      ORDER BY n.created_at ASC LIMIT 50
    `).all(userId);

    return rows.map(r => ({
      id: r.id, type: r.type, waveId: r.wave_id, dropletId: r.ping_id,
      actorId: r.actor_id, title: r.title, body: r.body, preview: r.preview,
      createdAt: r.created_at, groupKey: r.group_key,
      actorHandle: r.actor_handle, actorDisplayName: r.actor_display_name,
      actorAvatarUrl: r.actor_avatar_url, waveTitle: r.wave_title,
    }));
  }

  markNotificationsPushSent(notificationIds) {
    if (!notificationIds?.length) return 0;
    const stmt = this.db.prepare('UPDATE notifications SET push_sent = 1 WHERE id = ?');
    const tx = this.db.transaction((ids) => {
      let c = 0; for (const id of ids) c += stmt.run(id).changes; return c;
    });
    return tx(notificationIds);
  }

  deleteOldNotifications(daysOld = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const cutoffStr = cutoff.toISOString();

    const result = this.db.prepare(`
      DELETE FROM notifications WHERE created_at < ? AND (read = 1 OR dismissed = 1)
    `).run(cutoffStr);
    return result.changes;
  }

  // Wave notification settings
  getWaveNotificationSettings(userId, waveId) {
    const row = this.db.prepare(`
      SELECT * FROM wave_notification_settings WHERE user_id = ? AND wave_id = ?
    `).get(userId, waveId);

    if (!row) {
      return { enabled: true, level: 'all', sound: true, push: true };
    }

    return {
      enabled: !!row.enabled,
      level: row.level,
      sound: !!row.sound,
      push: !!row.push
    };
  }

  setWaveNotificationSettings(userId, waveId, settings) {
    this.db.prepare(`
      INSERT OR REPLACE INTO wave_notification_settings (user_id, wave_id, enabled, level, sound, push)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      waveId,
      settings.enabled !== false ? 1 : 0,
      settings.level || 'all',
      settings.sound !== false ? 1 : 0,
      settings.push !== false ? 1 : 0
    );
  }

  // Check if user should receive notification for a wave
  shouldNotifyForWave(userId, waveId, notificationType) {
    const settings = this.getWaveNotificationSettings(userId, waveId);

    if (!settings.enabled) return false;

    switch (settings.level) {
      case 'none':
        return false;
      case 'mentions':
        return notificationType === 'direct_mention';
      case 'all':
      default:
        return true;
    }
  }

  // ============ Federation - Server Identity Methods ============

  getServerIdentity() {
    const row = this.db.prepare('SELECT * FROM server_identity WHERE id = 1').get();
    if (!row) return null;
    return {
      nodeName: row.node_name,
      publicKey: row.public_key,
      privateKey: row.private_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  setServerIdentity({ nodeName, publicKey, privateKey }) {
    const now = new Date().toISOString();
    const existing = this.getServerIdentity();

    if (existing) {
      this.db.prepare(`
        UPDATE server_identity
        SET node_name = ?, public_key = ?, private_key = ?, updated_at = ?
        WHERE id = 1
      `).run(nodeName, publicKey, privateKey, now);
    } else {
      this.db.prepare(`
        INSERT INTO server_identity (id, node_name, public_key, private_key, created_at, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)
      `).run(nodeName, publicKey, privateKey, now, now);
    }

    return this.getServerIdentity();
  }

  hasServerIdentity() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM server_identity').get();
    return row.count > 0;
  }

  // ============ Federation - Trusted Nodes Methods ============

  getFederationNodes({ status = null } = {}) {
    let query = 'SELECT * FROM federation_nodes';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      id: r.id,
      nodeName: r.node_name,
      baseUrl: r.base_url,
      publicKey: r.public_key,
      status: r.status,
      addedBy: r.added_by,
      lastContactAt: r.last_contact_at,
      failureCount: r.failure_count,
      protocolVersion: r.protocol_version || 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  getFederationNode(nodeId) {
    const row = this.db.prepare('SELECT * FROM federation_nodes WHERE id = ?').get(nodeId);
    if (!row) return null;
    return {
      id: row.id,
      nodeName: row.node_name,
      baseUrl: row.base_url,
      publicKey: row.public_key,
      status: row.status,
      addedBy: row.added_by,
      lastContactAt: row.last_contact_at,
      failureCount: row.failure_count,
      protocolVersion: row.protocol_version || 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  getFederationNodeByName(nodeName) {
    const row = this.db.prepare('SELECT * FROM federation_nodes WHERE node_name = ?').get(nodeName);
    if (!row) return null;
    return {
      id: row.id,
      nodeName: row.node_name,
      baseUrl: row.base_url,
      publicKey: row.public_key,
      status: row.status,
      addedBy: row.added_by,
      lastContactAt: row.last_contact_at,
      failureCount: row.failure_count,
      protocolVersion: row.protocol_version || 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  addFederationNode({ nodeName, baseUrl, publicKey = null, status = 'pending', addedBy }) {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, added_by, failure_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, nodeName, baseUrl, publicKey, status, addedBy, now, now);

    return this.getFederationNode(id);
  }

  updateFederationNode(nodeId, updates) {
    const now = new Date().toISOString();
    const node = this.getFederationNode(nodeId);
    if (!node) return null;

    const allowedFields = ['nodeName', 'baseUrl', 'publicKey', 'status', 'lastContactAt', 'failureCount', 'protocolVersion'];
    const dbFields = {
      nodeName: 'node_name',
      baseUrl: 'base_url',
      publicKey: 'public_key',
      status: 'status',
      lastContactAt: 'last_contact_at',
      failureCount: 'failure_count',
      protocolVersion: 'protocol_version'
    };

    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && dbFields[key]) {
        setClauses.push(`${dbFields[key]} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) return node;

    setClauses.push('updated_at = ?');
    params.push(now);
    params.push(nodeId);

    this.db.prepare(`
      UPDATE federation_nodes SET ${setClauses.join(', ')} WHERE id = ?
    `).run(...params);

    return this.getFederationNode(nodeId);
  }

  deleteFederationNode(nodeId) {
    const result = this.db.prepare('DELETE FROM federation_nodes WHERE id = ?').run(nodeId);
    return result.changes > 0;
  }

  recordFederationContact(nodeId, success = true) {
    const now = new Date().toISOString();

    if (success) {
      this.db.prepare(`
        UPDATE federation_nodes
        SET last_contact_at = ?, failure_count = 0, updated_at = ?
        WHERE id = ?
      `).run(now, now, nodeId);
    } else {
      this.db.prepare(`
        UPDATE federation_nodes
        SET failure_count = failure_count + 1, updated_at = ?
        WHERE id = ?
      `).run(now, nodeId);
    }
  }

  // ============ Federation - Request Methods ============

  createFederationRequest(fromNodeName, fromBaseUrl, fromPublicKey, toNodeName, message = null) {
    const id = `fedreq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO federation_requests (id, from_node_name, from_base_url, from_public_key, to_node_name, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, fromNodeName, fromBaseUrl, fromPublicKey, toNodeName, message, now);

    return this.getFederationRequest(id);
  }

  getFederationRequest(requestId) {
    const row = this.db.prepare('SELECT * FROM federation_requests WHERE id = ?').get(requestId);
    if (!row) return null;
    return {
      id: row.id,
      fromNodeName: row.from_node_name,
      fromBaseUrl: row.from_base_url,
      fromPublicKey: row.from_public_key,
      toNodeName: row.to_node_name,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at
    };
  }

  getPendingFederationRequests() {
    const rows = this.db.prepare(`
      SELECT * FROM federation_requests WHERE status = 'pending' ORDER BY created_at DESC
    `).all();

    return rows.map(row => ({
      id: row.id,
      fromNodeName: row.from_node_name,
      fromBaseUrl: row.from_base_url,
      fromPublicKey: row.from_public_key,
      toNodeName: row.to_node_name,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at
    }));
  }

  getPendingRequestFromNode(fromNodeName) {
    const row = this.db.prepare(`
      SELECT * FROM federation_requests WHERE from_node_name = ? AND status = 'pending'
    `).get(fromNodeName);
    if (!row) return null;
    return {
      id: row.id,
      fromNodeName: row.from_node_name,
      fromBaseUrl: row.from_base_url,
      fromPublicKey: row.from_public_key,
      toNodeName: row.to_node_name,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at
    };
  }

  acceptFederationRequest(requestId) {
    const request = this.getFederationRequest(requestId);
    if (!request) return null;
    if (request.status !== 'pending') return null;

    const now = new Date().toISOString();

    // Update request status
    this.db.prepare(`
      UPDATE federation_requests SET status = 'accepted', responded_at = ? WHERE id = ?
    `).run(now, requestId);

    // Create federation node entry (or update if exists)
    const existingNode = this.getFederationNodeByName(request.fromNodeName);
    if (existingNode) {
      this.updateFederationNode(existingNode.id, {
        publicKey: request.fromPublicKey,
        status: 'active',
        baseUrl: request.fromBaseUrl
      });
    } else {
      const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.db.prepare(`
        INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(nodeId, request.fromNodeName, request.fromBaseUrl, request.fromPublicKey, now, now);
    }

    return this.getFederationRequest(requestId);
  }

  declineFederationRequest(requestId) {
    const request = this.getFederationRequest(requestId);
    if (!request) return null;
    if (request.status !== 'pending') return null;

    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE federation_requests SET status = 'declined', responded_at = ? WHERE id = ?
    `).run(now, requestId);

    return this.getFederationRequest(requestId);
  }

  // ============ Federation - Remote Users Methods ============

  getRemoteUser(id) {
    const row = this.db.prepare('SELECT * FROM remote_users WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      nodeName: row.node_name,
      handle: row.handle,
      displayName: row.display_name,
      avatar: row.avatar,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      cachedAt: row.cached_at,
      updatedAt: row.updated_at,
      isRemote: true
    };
  }

  getRemoteUserByHandle(nodeName, handle) {
    const row = this.db.prepare('SELECT * FROM remote_users WHERE node_name = ? AND handle = ?').get(nodeName, handle);
    if (!row) return null;
    return {
      id: row.id,
      nodeName: row.node_name,
      handle: row.handle,
      displayName: row.display_name,
      avatar: row.avatar,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      cachedAt: row.cached_at,
      updatedAt: row.updated_at,
      isRemote: true
    };
  }

  cacheRemoteUser({ id, nodeName, handle, displayName, avatar, avatarUrl, bio }) {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO remote_users (id, node_name, handle, display_name, avatar, avatar_url, bio, cached_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (node_name, handle) DO UPDATE SET
        id = excluded.id,
        display_name = excluded.display_name,
        avatar = excluded.avatar,
        avatar_url = excluded.avatar_url,
        bio = excluded.bio,
        updated_at = excluded.updated_at
    `).run(id, nodeName, handle, displayName || null, avatar || null, avatarUrl || null, bio || null, now, now);

    return this.getRemoteUser(id);
  }

  // ============ Federation - Wave Federation Methods ============

  getWaveFederationNodes(waveId) {
    const rows = this.db.prepare(`
      SELECT wf.*, fn.base_url, fn.public_key, fn.status as node_status
      FROM wave_federation wf
      JOIN federation_nodes fn ON wf.node_name = fn.node_name
      WHERE wf.wave_id = ?
    `).all(waveId);

    return rows.map(r => ({
      waveId: r.wave_id,
      nodeName: r.node_name,
      status: r.status,
      addedAt: r.added_at,
      baseUrl: r.base_url,
      publicKey: r.public_key,
      nodeStatus: r.node_status
    }));
  }

  addWaveFederationNode(waveId, nodeName) {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR IGNORE INTO wave_federation (wave_id, node_name, status, added_at)
      VALUES (?, ?, 'active', ?)
    `).run(waveId, nodeName, now);

    return true;
  }

  removeWaveFederationNode(waveId, nodeName) {
    const result = this.db.prepare(`
      DELETE FROM wave_federation WHERE wave_id = ? AND node_name = ?
    `).run(waveId, nodeName);
    return result.changes > 0;
  }

  // Update wave to be a federated origin wave
  setWaveAsOrigin(waveId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE waves SET federation_state = 'origin', updated_at = ? WHERE id = ?
    `).run(now, waveId);
    return this.getWave(waveId);
  }

  // Create a participant wave (copy of origin wave from another server)
  createParticipantWave({ id, title, privacy, createdBy, originNode, originWaveId }) {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO waves (id, title, privacy, created_by, created_at, updated_at, federation_state, origin_node, origin_wave_id)
      VALUES (?, ?, ?, ?, ?, ?, 'participant', ?, ?)
    `).run(id, title, privacy, createdBy, now, now, originNode, originWaveId);

    return this.getWave(id);
  }

  // Get federated waves where this server is origin
  getOriginWaves() {
    const rows = this.db.prepare(`
      SELECT * FROM waves WHERE federation_state = 'origin'
      ORDER BY updated_at DESC
    `).all();

    return rows.map(r => this.rowToWave(r));
  }

  // Get federated waves where this server is participant
  getParticipantWaves() {
    const rows = this.db.prepare(`
      SELECT * FROM waves WHERE federation_state = 'participant'
      ORDER BY updated_at DESC
    `).all();

    return rows.map(r => this.rowToWave(r));
  }

  // Get wave by origin identifiers (for incoming federated messages)
  getWaveByOrigin(originNode, originWaveId) {
    const row = this.db.prepare(`
      SELECT * FROM waves WHERE origin_node = ? AND origin_wave_id = ?
    `).get(originNode, originWaveId);

    return row ? this.rowToWave(row) : null;
  }

  // ============ Federation - Remote Droplets Methods ============

  getRemoteDroplet(id) {
    const row = this.db.prepare('SELECT * FROM remote_pings WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      waveId: row.wave_id,
      originWaveId: row.origin_wave_id,
      originNode: row.origin_node,
      authorId: row.author_id,
      authorNode: row.author_node,
      parentId: row.parent_id,
      content: row.content,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deleted: !!row.deleted,
      reactions: JSON.parse(row.reactions || '{}'),
      cachedAt: row.cached_at,
      updatedAt: row.updated_at,
      isRemote: true
    };
  }

  getRemoteDropletsForWave(waveId) {
    const rows = this.db.prepare(`
      SELECT rd.*, ru.display_name as author_display_name, ru.avatar as author_avatar, ru.avatar_url as author_avatar_url
      FROM remote_pings rd
      LEFT JOIN remote_users ru ON rd.author_id = ru.id
      WHERE rd.wave_id = ? AND rd.deleted = 0
      ORDER BY rd.created_at ASC
    `).all(waveId);

    return rows.map(r => ({
      id: r.id,
      waveId: r.wave_id,
      originWaveId: r.origin_wave_id,
      originNode: r.origin_node,
      authorId: r.author_id,
      authorNode: r.author_node,
      authorDisplayName: r.author_display_name,
      authorAvatar: r.author_avatar,
      authorAvatarUrl: r.author_avatar_url,
      parentId: r.parent_id,
      content: r.content,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      deleted: !!r.deleted,
      reactions: JSON.parse(r.reactions || '{}'),
      cachedAt: r.cached_at,
      updatedAt: r.updated_at,
      isRemote: true
    }));
  }

  cacheRemoteDroplet({ id, waveId, originWaveId, originNode, authorId, authorNode, parentId, content, createdAt, editedAt, reactions }) {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO remote_pings (id, wave_id, origin_wave_id, origin_node, author_id, author_node, parent_id, content, created_at, edited_at, reactions, cached_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        content = excluded.content,
        edited_at = excluded.edited_at,
        reactions = excluded.reactions,
        updated_at = excluded.updated_at
    `).run(id, waveId, originWaveId, originNode, authorId, authorNode, parentId || null, content, createdAt, editedAt || null, JSON.stringify(reactions || {}), now, now);

    return this.getRemoteDroplet(id);
  }

  markRemoteDropletDeleted(id) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE remote_pings SET deleted = 1, updated_at = ? WHERE id = ?
    `).run(now, id);
    return result.changes > 0;
  }

  // ============ Federation - Message Queue Methods ============

  queueFederationMessage({ targetNode, messageType, payload }) {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO federation_queue (id, target_node, message_type, payload, status, attempts, created_at, next_retry_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
    `).run(id, targetNode, messageType, JSON.stringify(payload), now, now);

    return id;
  }

  getPendingFederationMessages(limit = 10) {
    const now = new Date().toISOString();

    const rows = this.db.prepare(`
      SELECT * FROM federation_queue
      WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?
    `).all(now, limit);

    return rows.map(r => ({
      id: r.id,
      targetNode: r.target_node,
      messageType: r.message_type,
      payload: JSON.parse(r.payload),
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      nextRetryAt: r.next_retry_at,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
      lastError: r.last_error
    }));
  }

  markFederationMessageDelivered(messageId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE federation_queue SET status = 'delivered', delivered_at = ? WHERE id = ?
    `).run(now, messageId);
  }

  markFederationMessageFailed(messageId, error) {
    const now = new Date().toISOString();

    // Get current attempt count
    const msg = this.db.prepare('SELECT attempts, max_attempts FROM federation_queue WHERE id = ?').get(messageId);
    if (!msg) return;

    const newAttempts = msg.attempts + 1;

    if (newAttempts >= msg.max_attempts) {
      // Max retries exceeded, mark as permanently failed
      this.db.prepare(`
        UPDATE federation_queue SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?
      `).run(newAttempts, error, messageId);
    } else {
      // Calculate exponential backoff: 1min, 5min, 25min, 2hr, 10hr
      const backoffMinutes = Math.pow(5, newAttempts);
      const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

      this.db.prepare(`
        UPDATE federation_queue SET attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?
      `).run(newAttempts, nextRetry, error, messageId);
    }
  }

  cleanupOldFederationMessages(daysOld = 7) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

    const result = this.db.prepare(`
      DELETE FROM federation_queue WHERE (status = 'delivered' OR status = 'failed') AND created_at < ?
    `).run(cutoff);

    return result.changes;
  }

  // ============ Federation - Inbox Log Methods (for idempotency) ============

  hasReceivedFederationMessage(messageId) {
    const row = this.db.prepare('SELECT id FROM federation_inbox_log WHERE id = ?').get(messageId);
    return !!row;
  }

  logFederationInbox({ id, sourceNode, messageType }) {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR IGNORE INTO federation_inbox_log (id, source_node, message_type, received_at, status)
      VALUES (?, ?, ?, ?, 'received')
    `).run(id, sourceNode, messageType, now);
  }

  markFederationInboxProcessed(messageId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE federation_inbox_log SET processed_at = ?, status = 'processed' WHERE id = ?
    `).run(now, messageId);
  }

  cleanupOldInboxLog(daysOld = 30) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

    const result = this.db.prepare(`
      DELETE FROM federation_inbox_log WHERE received_at < ?
    `).run(cutoff);

    return result.changes;
  }

  // ============ Crawl Bar Config Methods ============

  getCrawlConfig() {
    // Ensure config exists (singleton pattern)
    let config = this.db.prepare('SELECT * FROM crawl_config WHERE id = 1').get();

    if (!config) {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO crawl_config (id, created_at, updated_at)
        VALUES (1, ?, ?)
      `).run(now, now);
      config = this.db.prepare('SELECT * FROM crawl_config WHERE id = 1').get();
    }

    return {
      stockSymbols: JSON.parse(config.stock_symbols || '[]'),
      newsSources: JSON.parse(config.news_sources || '[]'),
      defaultLocation: JSON.parse(config.default_location || '{}'),
      stockRefreshInterval: config.stock_refresh_interval,
      weatherRefreshInterval: config.weather_refresh_interval,
      newsRefreshInterval: config.news_refresh_interval,
      stocksEnabled: !!config.stocks_enabled,
      weatherEnabled: !!config.weather_enabled,
      newsEnabled: !!config.news_enabled,
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    };
  }

  updateCrawlConfig(updates) {
    const now = new Date().toISOString();
    const config = this.getCrawlConfig();

    const newConfig = {
      stockSymbols: updates.stockSymbols !== undefined ? updates.stockSymbols : config.stockSymbols,
      newsSources: updates.newsSources !== undefined ? updates.newsSources : config.newsSources,
      defaultLocation: updates.defaultLocation !== undefined ? updates.defaultLocation : config.defaultLocation,
      stockRefreshInterval: updates.stockRefreshInterval !== undefined ? updates.stockRefreshInterval : config.stockRefreshInterval,
      weatherRefreshInterval: updates.weatherRefreshInterval !== undefined ? updates.weatherRefreshInterval : config.weatherRefreshInterval,
      newsRefreshInterval: updates.newsRefreshInterval !== undefined ? updates.newsRefreshInterval : config.newsRefreshInterval,
      stocksEnabled: updates.stocksEnabled !== undefined ? updates.stocksEnabled : config.stocksEnabled,
      weatherEnabled: updates.weatherEnabled !== undefined ? updates.weatherEnabled : config.weatherEnabled,
      newsEnabled: updates.newsEnabled !== undefined ? updates.newsEnabled : config.newsEnabled,
    };

    this.db.prepare(`
      UPDATE crawl_config SET
        stock_symbols = ?,
        news_sources = ?,
        default_location = ?,
        stock_refresh_interval = ?,
        weather_refresh_interval = ?,
        news_refresh_interval = ?,
        stocks_enabled = ?,
        weather_enabled = ?,
        news_enabled = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      JSON.stringify(newConfig.stockSymbols),
      JSON.stringify(newConfig.newsSources),
      JSON.stringify(newConfig.defaultLocation),
      newConfig.stockRefreshInterval,
      newConfig.weatherRefreshInterval,
      newConfig.newsRefreshInterval,
      newConfig.stocksEnabled ? 1 : 0,
      newConfig.weatherEnabled ? 1 : 0,
      newConfig.newsEnabled ? 1 : 0,
      now
    );

    return this.getCrawlConfig();
  }

  // ============ Alert Methods (v1.16.0) ============

  createAlert({ title, content, priority = 'info', category = 'system', scope = 'local', startTime, endTime, createdBy, originNode = null, originAlertId = null }) {
    const id = `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO alerts (id, title, content, priority, category, scope, start_time, end_time, created_by, created_at, origin_node, origin_alert_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, content, priority, category, scope, startTime, endTime, createdBy, now, originNode, originAlertId);

    return this.getAlert(id);
  }

  getAlert(alertId) {
    const alert = this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
    if (!alert) return null;

    return {
      id: alert.id,
      title: alert.title,
      content: alert.content,
      priority: alert.priority,
      category: alert.category,
      scope: alert.scope,
      startTime: alert.start_time,
      endTime: alert.end_time,
      createdBy: alert.created_by,
      createdAt: alert.created_at,
      updatedAt: alert.updated_at,
      originNode: alert.origin_node,
      originAlertId: alert.origin_alert_id,
    };
  }

  getAlertByOrigin(originNode, originAlertId) {
    if (!originNode || !originAlertId) return null;
    const alert = this.db.prepare('SELECT * FROM alerts WHERE origin_node = ? AND origin_alert_id = ?').get(originNode, originAlertId);
    return alert ? this.getAlert(alert.id) : null;
  }

  updateAlert(alertId, updates) {
    const now = new Date().toISOString();
    const alert = this.getAlert(alertId);
    if (!alert) return null;

    const newValues = {
      title: updates.title !== undefined ? updates.title : alert.title,
      content: updates.content !== undefined ? updates.content : alert.content,
      priority: updates.priority !== undefined ? updates.priority : alert.priority,
      category: updates.category !== undefined ? updates.category : alert.category,
      scope: updates.scope !== undefined ? updates.scope : alert.scope,
      startTime: updates.startTime !== undefined ? updates.startTime : alert.startTime,
      endTime: updates.endTime !== undefined ? updates.endTime : alert.endTime,
    };

    this.db.prepare(`
      UPDATE alerts SET title = ?, content = ?, priority = ?, category = ?, scope = ?, start_time = ?, end_time = ?, updated_at = ?
      WHERE id = ?
    `).run(newValues.title, newValues.content, newValues.priority, newValues.category, newValues.scope, newValues.startTime, newValues.endTime, now, alertId);

    return this.getAlert(alertId);
  }

  deleteAlert(alertId) {
    const alert = this.getAlert(alertId);
    if (!alert) return false;

    this.db.prepare('DELETE FROM alerts WHERE id = ?').run(alertId);
    return true;
  }

  getActiveAlerts(userId) {
    const now = new Date().toISOString();

    // Get alerts that are currently active (now between start_time and end_time)
    // and not dismissed by this user
    const alerts = this.db.prepare(`
      SELECT a.* FROM alerts a
      WHERE a.start_time <= ? AND a.end_time >= ?
        AND NOT EXISTS (
          SELECT 1 FROM alert_dismissals ad
          WHERE ad.alert_id = a.id AND ad.user_id = ?
        )
      ORDER BY
        CASE a.priority WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        a.start_time DESC
    `).all(now, now, userId);

    return alerts.map(a => ({
      id: a.id,
      title: a.title,
      content: a.content,
      priority: a.priority,
      category: a.category,
      scope: a.scope,
      startTime: a.start_time,
      endTime: a.end_time,
      createdBy: a.created_by,
      createdAt: a.created_at,
      originNode: a.origin_node,
      originAlertId: a.origin_alert_id,
    }));
  }

  getAllAlerts({ limit = 50, offset = 0, status = 'all' } = {}) {
    const now = new Date().toISOString();

    let query = 'SELECT * FROM alerts';
    const params = [];

    if (status === 'active') {
      query += ' WHERE start_time <= ? AND end_time >= ?';
      params.push(now, now);
    } else if (status === 'scheduled') {
      query += ' WHERE start_time > ?';
      params.push(now);
    } else if (status === 'expired') {
      query += ' WHERE end_time < ?';
      params.push(now);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const alerts = this.db.prepare(query).all(...params);

    return alerts.map(a => ({
      id: a.id,
      title: a.title,
      content: a.content,
      priority: a.priority,
      category: a.category,
      scope: a.scope,
      startTime: a.start_time,
      endTime: a.end_time,
      createdBy: a.created_by,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      originNode: a.origin_node,
      originAlertId: a.origin_alert_id,
    }));
  }

  dismissAlert(alertId, userId) {
    const now = new Date().toISOString();

    // Check if already dismissed
    const existing = this.db.prepare('SELECT 1 FROM alert_dismissals WHERE alert_id = ? AND user_id = ?').get(alertId, userId);
    if (existing) return true;

    this.db.prepare(`
      INSERT INTO alert_dismissals (alert_id, user_id, dismissed_at) VALUES (?, ?, ?)
    `).run(alertId, userId, now);

    return true;
  }

  hasUserDismissedAlert(alertId, userId) {
    const row = this.db.prepare('SELECT 1 FROM alert_dismissals WHERE alert_id = ? AND user_id = ?').get(alertId, userId);
    return !!row;
  }

  cleanupExpiredAlerts(daysOld = 30) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

    const result = this.db.prepare(`
      DELETE FROM alerts WHERE end_time < ?
    `).run(cutoff);

    return result.changes;
  }

  // ============ Alert Subscription Methods (v1.16.0) ============

  createAlertSubscription({ sourceNode, categories, createdBy }) {
    const id = `alert-sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO alert_subscriptions (id, source_node, categories, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sourceNode, JSON.stringify(categories), createdBy, now);

    return this.getAlertSubscription(id);
  }

  getAlertSubscription(subscriptionId) {
    const sub = this.db.prepare('SELECT * FROM alert_subscriptions WHERE id = ?').get(subscriptionId);
    if (!sub) return null;

    return {
      id: sub.id,
      sourceNode: sub.source_node,
      categories: JSON.parse(sub.categories || '[]'),
      status: sub.status,
      createdBy: sub.created_by,
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
    };
  }

  getAlertSubscriptionByNode(sourceNode) {
    const sub = this.db.prepare('SELECT * FROM alert_subscriptions WHERE source_node = ?').get(sourceNode);
    return sub ? this.getAlertSubscription(sub.id) : null;
  }

  updateAlertSubscription(subscriptionId, updates) {
    const now = new Date().toISOString();
    const sub = this.getAlertSubscription(subscriptionId);
    if (!sub) return null;

    const newValues = {
      categories: updates.categories !== undefined ? updates.categories : sub.categories,
      status: updates.status !== undefined ? updates.status : sub.status,
    };

    this.db.prepare(`
      UPDATE alert_subscriptions SET categories = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(newValues.categories), newValues.status, now, subscriptionId);

    return this.getAlertSubscription(subscriptionId);
  }

  deleteAlertSubscription(subscriptionId) {
    const sub = this.getAlertSubscription(subscriptionId);
    if (!sub) return false;

    this.db.prepare('DELETE FROM alert_subscriptions WHERE id = ?').run(subscriptionId);
    return true;
  }

  getAllAlertSubscriptions() {
    const subs = this.db.prepare('SELECT * FROM alert_subscriptions ORDER BY created_at DESC').all();

    return subs.map(sub => ({
      id: sub.id,
      sourceNode: sub.source_node,
      categories: JSON.parse(sub.categories || '[]'),
      status: sub.status,
      createdBy: sub.created_by,
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
    }));
  }

  // ============ Alert Subscriber Methods (inbound federation) ============

  addAlertSubscriber(subscriberNode, categories) {
    const id = `alert-subscriber-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    // Use INSERT OR REPLACE to handle duplicates
    this.db.prepare(`
      INSERT OR REPLACE INTO alert_subscribers (id, subscriber_node, categories, created_at, updated_at)
      VALUES (
        COALESCE((SELECT id FROM alert_subscribers WHERE subscriber_node = ?), ?),
        ?,
        ?,
        COALESCE((SELECT created_at FROM alert_subscribers WHERE subscriber_node = ?), ?),
        ?
      )
    `).run(subscriberNode, id, subscriberNode, JSON.stringify(categories), subscriberNode, now, now);

    return this.getAlertSubscriberByNode(subscriberNode);
  }

  getAlertSubscriberByNode(subscriberNode) {
    const sub = this.db.prepare('SELECT * FROM alert_subscribers WHERE subscriber_node = ?').get(subscriberNode);
    if (!sub) return null;

    return {
      id: sub.id,
      subscriberNode: sub.subscriber_node,
      categories: JSON.parse(sub.categories || '[]'),
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
    };
  }

  removeAlertSubscriber(subscriberNode) {
    const result = this.db.prepare('DELETE FROM alert_subscribers WHERE subscriber_node = ?').run(subscriberNode);
    return result.changes > 0;
  }

  getAlertSubscribers() {
    const subs = this.db.prepare('SELECT * FROM alert_subscribers ORDER BY created_at DESC').all();

    return subs.map(sub => ({
      id: sub.id,
      subscriberNode: sub.subscriber_node,
      categories: JSON.parse(sub.categories || '[]'),
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
    }));
  }

  getSubscribersForCategory(category) {
    // Get all subscribers whose categories array includes this category
    const allSubscribers = this.getAlertSubscribers();
    return allSubscribers.filter(sub => sub.categories.includes(category));
  }

  // ============ Session Management (v1.18.0, updated v2.16.0 for privacy) ============

  // Create a new session
  // deviceInfo and ipAddress should be pre-anonymized by caller (v2.16.0)
  createSession({ userId, tokenHash, deviceInfo, ipAddress, expiresAt, createdAt }) {
    const id = `sess-${uuidv4()}`;
    const timestamp = createdAt || new Date().toISOString();

    this.db.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, device_info, ip_address, created_at, last_active, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, tokenHash, deviceInfo || 'Unknown', ipAddress || 'Unknown', timestamp, timestamp, expiresAt);

    return { id, userId, tokenHash, deviceInfo, ipAddress, createdAt: timestamp, lastActive: timestamp, expiresAt, revoked: false };
  }

  // Get session by token hash
  getSessionByTokenHash(tokenHash) {
    const row = this.db.prepare(`
      SELECT * FROM user_sessions WHERE token_hash = ?
    `).get(tokenHash);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      deviceInfo: row.device_info,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      lastActive: row.last_active,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      revokedAt: row.revoked_at
    };
  }

  // Get all sessions for a user
  getSessionsByUser(userId) {
    const rows = this.db.prepare(`
      SELECT * FROM user_sessions
      WHERE user_id = ? AND revoked = 0 AND expires_at > datetime('now')
      ORDER BY last_active DESC
    `).all(userId);

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      deviceInfo: row.device_info,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      lastActive: row.last_active,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      revokedAt: row.revoked_at
    }));
  }

  // Update last_active timestamp
  updateSessionActivity(tokenHash) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE user_sessions SET last_active = ? WHERE token_hash = ?
    `).run(now, tokenHash);
  }

  // Revoke a specific session
  revokeSession(sessionId) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE user_sessions SET revoked = 1, revoked_at = ? WHERE id = ?
    `).run(now, sessionId);
    return result.changes > 0;
  }

  // Revoke session by token hash
  revokeSessionByTokenHash(tokenHash) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE user_sessions SET revoked = 1, revoked_at = ? WHERE token_hash = ?
    `).run(now, tokenHash);
    return result.changes > 0;
  }

  // Revoke all sessions for a user except one
  revokeAllUserSessions(userId, exceptSessionId = null) {
    const now = new Date().toISOString();
    if (exceptSessionId) {
      const result = this.db.prepare(`
        UPDATE user_sessions SET revoked = 1, revoked_at = ?
        WHERE user_id = ? AND id != ? AND revoked = 0
      `).run(now, userId, exceptSessionId);
      return result.changes;
    } else {
      const result = this.db.prepare(`
        UPDATE user_sessions SET revoked = 1, revoked_at = ?
        WHERE user_id = ? AND revoked = 0
      `).run(now, userId);
      return result.changes;
    }
  }

  // Cleanup expired and old revoked sessions
  cleanupExpiredSessions() {
    // Delete sessions that are either:
    // 1. Expired (past expires_at)
    // 2. Revoked more than 7 days ago
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(`
      DELETE FROM user_sessions
      WHERE expires_at < datetime('now')
         OR (revoked = 1 AND revoked_at < ?)
    `).run(sevenDaysAgo);
    return result.changes;
  }

  /**
   * Cleanup sessions older than maxAgeDays (v2.16.0 privacy hardening)
   * Enforces maximum session age regardless of expiry time
   * @param {number} maxAgeDays - Maximum age in days (default: 30)
   * @returns {number} Number of sessions deleted
   */
  cleanupOldSessions(maxAgeDays = 30) {
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(`
      DELETE FROM user_sessions
      WHERE created_at < ?
    `).run(cutoffDate);
    return result.changes;
  }

  // Check if session table exists (for graceful degradation)
  hasSessionTable() {
    try {
      const row = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='user_sessions'
      `).get();
      return !!row;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup activity log entries older than retentionDays (v2.16.0 privacy hardening)
   * @param {number} retentionDays - Maximum age in days (default: 30)
   * @returns {number} Number of entries deleted
   */
  cleanupOldActivityLogs(retentionDays = 30) {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(`
      DELETE FROM activity_log
      WHERE created_at < ?
    `).run(cutoffDate);
    return result.changes;
  }

  // ============ User Data Export (v1.18.0 GDPR Compliance) ============

  exportUserData(userId) {
    const user = this.findUserById(userId);
    if (!user) return null;

    // Compile all user data
    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        handle: user.handle,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        status: user.status,
        isAdmin: user.isAdmin,
        preferences: user.preferences,
        createdAt: user.createdAt,
        lastHandleChange: user.lastHandleChange,
        handleHistory: user.handleHistory || [],
      },
      contacts: this.db.prepare(`
        SELECT c.*, u.handle, u.display_name
        FROM contacts c
        LEFT JOIN users u ON c.contact_id = u.id
        WHERE c.user_id = ?
      `).all(userId),
      droplets: this.db.prepare(`
        SELECT d.*, w.title as wave_name
        FROM pings d
        LEFT JOIN waves w ON d.wave_id = w.id
        WHERE d.author_id = ?
        ORDER BY d.created_at DESC
      `).all(userId),
      waveParticipation: this.db.prepare(`
        SELECT w.id, w.title, w.privacy, w.created_at, wp.archived
        FROM wave_participants wp
        JOIN waves w ON wp.wave_id = w.id
        WHERE wp.user_id = ?
        ORDER BY w.created_at DESC
      `).all(userId),
      groupMemberships: this.db.prepare(`
        SELECT g.id, g.name, g.description, gm.role, gm.joined_at
        FROM crew_members gm
        JOIN crews g ON gm.crew_id = g.id
        WHERE gm.user_id = ?
      `).all(userId),
      sentContactRequests: this.db.prepare(`
        SELECT cr.*, u.handle as to_handle
        FROM contact_requests cr
        LEFT JOIN users u ON cr.to_user_id = u.id
        WHERE cr.from_user_id = ?
      `).all(userId),
      receivedContactRequests: this.db.prepare(`
        SELECT cr.*, u.handle as from_handle
        FROM contact_requests cr
        LEFT JOIN users u ON cr.from_user_id = u.id
        WHERE cr.to_user_id = ?
      `).all(userId),
      handleRequests: this.db.prepare(`
        SELECT * FROM handle_requests WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId),
      blockedUsers: this.db.prepare(`
        SELECT b.*, u.handle
        FROM blocks b
        LEFT JOIN users u ON b.blocked_user_id = u.id
        WHERE b.user_id = ?
      `).all(userId),
      mutedUsers: this.db.prepare(`
        SELECT m.*, u.handle
        FROM mutes m
        LEFT JOIN users u ON m.muted_user_id = u.id
        WHERE m.user_id = ?
      `).all(userId),
    };

    // Try to get sessions if table exists
    try {
      if (this.hasSessionTable()) {
        exportData.sessions = this.db.prepare(`
          SELECT id, device_info, ip_address, created_at, last_active, expires_at, revoked, revoked_at
          FROM user_sessions WHERE user_id = ?
          ORDER BY created_at DESC
        `).all(userId);
      }
    } catch { /* Session table may not exist */ }

    // Try to get notifications if table exists
    try {
      exportData.notifications = this.db.prepare(`
        SELECT * FROM notifications WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 100
      `).all(userId);
    } catch { /* Table may not exist */ }

    // Try to get push subscriptions if table exists
    try {
      exportData.pushSubscriptions = this.db.prepare(`
        SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ?
      `).all(userId);
    } catch { /* Table may not exist */ }

    // Try to get activity log if table exists
    try {
      exportData.activityLog = this.db.prepare(`
        SELECT action, target_type, target_id, metadata, created_at
        FROM activity_log WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 500
      `).all(userId);
    } catch { /* Table may not exist */ }

    return exportData;
  }

  // ============ Account Deletion (v1.18.0 GDPR Compliance) ============

  // Get or create system user for orphaned content
  getOrCreateDeletedUser() {
    const DELETED_USER_ID = 'system-deleted-user';

    // Check if already exists
    const existing = this.db.prepare('SELECT id FROM users WHERE id = ?').get(DELETED_USER_ID);
    if (existing) return DELETED_USER_ID;

    // Create the system user (cannot login - invalid password hash)
    try {
      this.db.prepare(`
        INSERT INTO users (id, handle, email, password_hash, display_name, status, is_admin, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        DELETED_USER_ID,
        'deleted',
        'deleted@system.local',
        'INVALID_CANNOT_LOGIN',
        '[Deleted User]',
        'offline',
        0,
        new Date().toISOString()
      );
      return DELETED_USER_ID;
    } catch (err) {
      // Handle might already exist, try with unique handle
      this.db.prepare(`
        INSERT INTO users (id, handle, email, password_hash, display_name, status, is_admin, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        DELETED_USER_ID,
        'deleted_user',
        'deleted@system.local',
        'INVALID_CANNOT_LOGIN',
        '[Deleted User]',
        'offline',
        0,
        new Date().toISOString()
      );
      return DELETED_USER_ID;
    }
  }

  deleteUserAccount(userId) {
    const user = this.findUserById(userId);
    if (!user) return { success: false, error: 'User not found' };

    // Get or create deleted user for orphaned content
    const deletedUserId = this.getOrCreateDeletedUser();

    // Use transaction for atomic deletion
    const deleteTransaction = this.db.transaction(() => {
      // 1. Revoke all sessions
      try {
        if (this.hasSessionTable()) {
          this.db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
        }
      } catch { /* Session table may not exist */ }

      // 2. Delete push subscriptions
      try {
        this.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
      } catch { /* Table may not exist */ }

      // 3. Delete MFA settings
      try {
        this.db.prepare('DELETE FROM mfa_totp WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM mfa_email WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(userId);
      } catch { /* MFA tables may not exist */ }

      // 4. Delete password reset tokens
      try {
        this.db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
      } catch { /* Table may not exist */ }

      // 5. Delete notifications
      try {
        this.db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM notification_preferences WHERE user_id = ?').run(userId);
      } catch { /* Tables may not exist */ }

      // 6. Delete alert subscriptions/dismissals
      try {
        this.db.prepare('DELETE FROM alert_subscriptions WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM alert_dismissals WHERE user_id = ?').run(userId);
      } catch { /* Tables may not exist */ }

      // 7. Handle waves - delete empty ones, transfer ownership for others
      const wavesCreated = this.db.prepare(`
        SELECT w.id FROM waves w WHERE w.created_by = ?
      `).all(userId);

      for (const wave of wavesCreated) {
        // Get other participants (excluding the user being deleted)
        const otherParticipant = this.db.prepare(`
          SELECT user_id FROM wave_participants
          WHERE wave_id = ? AND user_id != ?
          LIMIT 1
        `).get(wave.id, userId);

        if (!otherParticipant) {
          // Delete wave and all its droplets (sole participant)
          this.db.prepare('DELETE FROM pings WHERE wave_id = ?').run(wave.id);
          this.db.prepare('DELETE FROM wave_participants WHERE wave_id = ?').run(wave.id);
          this.db.prepare('DELETE FROM waves WHERE id = ?').run(wave.id);
        } else {
          // Transfer ownership to another participant
          this.db.prepare('UPDATE waves SET created_by = ? WHERE id = ?').run(otherParticipant.user_id, wave.id);
        }
      }

      // 8. Remove user from wave participants
      this.db.prepare('DELETE FROM wave_participants WHERE user_id = ?').run(userId);

      // 9. Orphan droplets (transfer to deleted user, keep content)
      this.db.prepare('UPDATE pings SET author_id = ? WHERE author_id = ?').run(deletedUserId, userId);

      // 10. Handle groups - delete empty ones, orphan others
      const groupsCreated = this.db.prepare(`
        SELECT g.id FROM crews g WHERE g.created_by = ?
      `).all(userId);

      for (const group of groupsCreated) {
        const memberCount = this.db.prepare(`
          SELECT COUNT(*) as count FROM crew_members WHERE crew_id = ?
        `).get(group.id)?.count || 0;

        if (memberCount <= 1) {
          // Delete group (sole member)
          this.db.prepare('DELETE FROM crew_members WHERE crew_id = ?').run(group.id);
          this.db.prepare('DELETE FROM crew_invitations WHERE crew_id = ?').run(group.id);
          this.db.prepare('DELETE FROM crews WHERE id = ?').run(group.id);
        } else {
          // Transfer to next admin or first member
          const nextAdmin = this.db.prepare(`
            SELECT user_id FROM crew_members
            WHERE crew_id = ? AND user_id != ? AND role = 'admin'
            LIMIT 1
          `).get(group.id, userId);

          const newOwner = nextAdmin?.user_id || this.db.prepare(`
            SELECT user_id FROM crew_members
            WHERE crew_id = ? AND user_id != ?
            LIMIT 1
          `).get(group.id, userId)?.user_id;

          if (newOwner) {
            this.db.prepare('UPDATE crews SET created_by = ? WHERE id = ?').run(newOwner, group.id);
            // Make sure new owner is admin
            this.db.prepare(`
              UPDATE crew_members SET role = 'admin'
              WHERE crew_id = ? AND user_id = ?
            `).run(group.id, newOwner);
          }
        }
      }

      // 11. Remove user from group members
      this.db.prepare('DELETE FROM crew_members WHERE user_id = ?').run(userId);

      // 12. Delete contacts
      this.db.prepare('DELETE FROM contacts WHERE user_id = ? OR contact_id = ?').run(userId, userId);

      // 13. Delete contact requests
      this.db.prepare('DELETE FROM contact_requests WHERE from_user_id = ? OR to_user_id = ?').run(userId, userId);

      // 14. Delete group invitations
      this.db.prepare('DELETE FROM crew_invitations WHERE invited_by = ? OR invited_user_id = ?').run(userId, userId);

      // 15. Delete blocks and mutes
      this.db.prepare('DELETE FROM blocks WHERE user_id = ? OR blocked_user_id = ?').run(userId, userId);
      this.db.prepare('DELETE FROM mutes WHERE user_id = ? OR muted_user_id = ?').run(userId, userId);

      // 16. Delete handle requests
      this.db.prepare('DELETE FROM handle_requests WHERE user_id = ?').run(userId);

      // 17. Update activity log (set user_id to null, keep records)
      try {
        this.db.prepare('UPDATE activity_log SET user_id = NULL WHERE user_id = ?').run(userId);
      } catch { /* Table may not exist */ }

      // 18. Delete reports by user (but keep reports about user for admin review)
      try {
        this.db.prepare('UPDATE reports SET reporter_id = NULL WHERE reporter_id = ?').run(userId);
      } catch { /* Table may not exist */ }

      // 19. Delete user avatar file (if exists)
      // Note: This should be handled separately by the server if avatarUrl exists

      // 20. Finally, delete the user
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);

      return { success: true, deletedUserId: userId, handle: user.handle };
    });

    try {
      return deleteTransaction();
    } catch (err) {
      console.error('Account deletion error:', err);
      return { success: false, error: err.message };
    }
  }

  // ============ E2EE Methods (v1.19.0) ============

  // Create or update user encryption keys
  createUserEncryptionKeys(userId, publicKey, encryptedPrivateKey, salt) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT user_id FROM user_encryption_keys WHERE user_id = ?').get(userId);

    if (existing) {
      // Update existing keys (key rotation)
      const currentVersion = this.db.prepare('SELECT key_version FROM user_encryption_keys WHERE user_id = ?').get(userId);
      this.db.prepare(`
        UPDATE user_encryption_keys
        SET public_key = ?, encrypted_private_key = ?, key_derivation_salt = ?,
            key_version = key_version + 1, updated_at = ?
        WHERE user_id = ?
      `).run(publicKey, encryptedPrivateKey, salt, now, userId);
      return { userId, keyVersion: (currentVersion?.key_version || 0) + 1 };
    } else {
      this.db.prepare(`
        INSERT INTO user_encryption_keys (user_id, public_key, encrypted_private_key, key_derivation_salt, key_version, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(userId, publicKey, encryptedPrivateKey, salt, now);
      return { userId, keyVersion: 1 };
    }
  }

  // Get user's encryption keys (for themselves to decrypt)
  getUserEncryptionKeys(userId) {
    const row = this.db.prepare(`
      SELECT user_id, public_key, encrypted_private_key, key_derivation_salt, key_version, created_at, updated_at
      FROM user_encryption_keys WHERE user_id = ?
    `).get(userId);

    if (!row) return null;

    return {
      userId: row.user_id,
      publicKey: row.public_key,
      encryptedPrivateKey: row.encrypted_private_key,
      keyDerivationSalt: row.key_derivation_salt,
      keyVersion: row.key_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Get just the public key (for encrypting wave keys for other users)
  getUserPublicKey(userId) {
    const row = this.db.prepare('SELECT public_key FROM user_encryption_keys WHERE user_id = ?').get(userId);
    return row?.public_key || null;
  }

  // Check if user has E2EE set up
  hasUserEncryptionKeys(userId) {
    const row = this.db.prepare('SELECT 1 FROM user_encryption_keys WHERE user_id = ?').get(userId);
    return !!row;
  }

  // Update encrypted private key (for password changes)
  // Keeps the same public key but updates the encrypted private key and salt
  updateEncryptedPrivateKey(userId, encryptedPrivateKey, salt) {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE user_encryption_keys
      SET encrypted_private_key = ?, key_derivation_salt = ?, updated_at = ?
      WHERE user_id = ?
    `).run(encryptedPrivateKey, salt, now, userId);

    if (result.changes === 0) {
      throw new Error('No encryption keys found for user');
    }

    return { success: true };
  }

  // Create wave encryption key for a participant
  createWaveEncryptionKey(waveId, userId, encryptedWaveKey, senderPublicKey, keyVersion = 1, userKeyId = null) {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Check if key already exists for this version
    const existing = this.db.prepare(`
      SELECT id FROM wave_encryption_keys
      WHERE wave_id = ? AND user_id = ? AND key_version = ?
    `).get(waveId, userId, keyVersion);

    if (existing) {
      // Update existing
      this.db.prepare(`
        UPDATE wave_encryption_keys
        SET encrypted_wave_key = ?, sender_public_key = ?, user_key_id = COALESCE(?, user_key_id)
        WHERE wave_id = ? AND user_id = ? AND key_version = ?
      `).run(encryptedWaveKey, senderPublicKey, userKeyId, waveId, userId, keyVersion);
      return existing.id;
    }

    this.db.prepare(`
      INSERT INTO wave_encryption_keys (id, wave_id, user_id, encrypted_wave_key, sender_public_key, key_version, created_at, user_key_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, waveId, userId, encryptedWaveKey, senderPublicKey, keyVersion, now, userKeyId);

    return id;
  }

  // Get wave key for a specific user
  getWaveKeyForUser(waveId, userId, keyVersion = null) {
    let query = `
      SELECT wek.*, wkm.current_key_version
      FROM wave_encryption_keys wek
      LEFT JOIN wave_key_metadata wkm ON wek.wave_id = wkm.wave_id
      WHERE wek.wave_id = ? AND wek.user_id = ?
    `;

    if (keyVersion !== null) {
      query += ' AND wek.key_version = ?';
      const row = this.db.prepare(query).get(waveId, userId, keyVersion);
      if (!row) return null;
      return {
        encryptedWaveKey: row.encrypted_wave_key,
        senderPublicKey: row.sender_public_key,
        keyVersion: row.key_version,
        currentKeyVersion: row.current_key_version || 1
      };
    }

    // Get the current version
    query += ' ORDER BY wek.key_version DESC LIMIT 1';
    const row = this.db.prepare(query).get(waveId, userId);
    if (!row) return null;

    return {
      encryptedWaveKey: row.encrypted_wave_key,
      senderPublicKey: row.sender_public_key,
      keyVersion: row.key_version,
      currentKeyVersion: row.current_key_version || 1
    };
  }

  // Get all wave keys for a user (for key rotation/history)
  getAllWaveKeysForUser(waveId, userId) {
    const rows = this.db.prepare(`
      SELECT encrypted_wave_key, sender_public_key, key_version, created_at
      FROM wave_encryption_keys
      WHERE wave_id = ? AND user_id = ?
      ORDER BY key_version ASC
    `).all(waveId, userId);

    return rows.map(row => ({
      encryptedWaveKey: row.encrypted_wave_key,
      senderPublicKey: row.sender_public_key,
      keyVersion: row.key_version,
      createdAt: row.created_at
    }));
  }

  // Initialize wave key metadata
  createWaveKeyMetadata(waveId) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT wave_id FROM wave_key_metadata WHERE wave_id = ?').get(waveId);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO wave_key_metadata (wave_id, current_key_version, created_at)
        VALUES (?, 1, ?)
      `).run(waveId, now);
    }
    return { waveId, currentKeyVersion: 1 };
  }

  // Get current wave key version
  getWaveKeyVersion(waveId) {
    const row = this.db.prepare('SELECT current_key_version FROM wave_key_metadata WHERE wave_id = ?').get(waveId);
    return row?.current_key_version || 1;
  }

  // Rotate wave key (when participant is removed)
  rotateWaveKey(waveId, newKeyDistribution) {
    const now = new Date().toISOString();

    return this.db.transaction(() => {
      // Increment the key version
      const existing = this.db.prepare('SELECT current_key_version FROM wave_key_metadata WHERE wave_id = ?').get(waveId);
      const newVersion = (existing?.current_key_version || 1) + 1;

      if (existing) {
        this.db.prepare(`
          UPDATE wave_key_metadata
          SET current_key_version = ?, last_rotated_at = ?
          WHERE wave_id = ?
        `).run(newVersion, now, waveId);
      } else {
        this.db.prepare(`
          INSERT INTO wave_key_metadata (wave_id, current_key_version, created_at, last_rotated_at)
          VALUES (?, ?, ?, ?)
        `).run(waveId, newVersion, now, now);
      }

      // Insert new encrypted keys for each remaining participant
      for (const { userId, encryptedWaveKey, senderPublicKey } of newKeyDistribution) {
        this.createWaveEncryptionKey(waveId, userId, encryptedWaveKey, senderPublicKey, newVersion);
      }

      return { waveId, newKeyVersion: newVersion };
    })();
  }

  // Store recovery key
  createRecoveryKey(userId, encryptedPrivateKey, recoverySalt, hint = null) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT user_id FROM user_recovery_keys WHERE user_id = ?').get(userId);

    if (existing) {
      this.db.prepare(`
        UPDATE user_recovery_keys
        SET encrypted_private_key = ?, recovery_salt = ?, hint = ?, created_at = ?
        WHERE user_id = ?
      `).run(encryptedPrivateKey, recoverySalt, hint, now, userId);
    } else {
      this.db.prepare(`
        INSERT INTO user_recovery_keys (user_id, encrypted_private_key, recovery_salt, hint, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, encryptedPrivateKey, recoverySalt, hint, now);
    }

    return { userId, hasHint: !!hint };
  }

  // Get recovery key info
  getRecoveryKeyInfo(userId) {
    const row = this.db.prepare(`
      SELECT encrypted_private_key, recovery_salt, hint, created_at
      FROM user_recovery_keys WHERE user_id = ?
    `).get(userId);

    if (!row) return null;

    return {
      encryptedPrivateKey: row.encrypted_private_key,
      recoverySalt: row.recovery_salt,
      hint: row.hint,
      createdAt: row.created_at
    };
  }

  // Get recovery hint only (for display without revealing key)
  getRecoveryHint(userId) {
    const row = this.db.prepare('SELECT hint FROM user_recovery_keys WHERE user_id = ?').get(userId);
    return row?.hint || null;
  }

  // Update/regenerate recovery key (requires existing record)
  updateRecoveryKey(userId, encryptedPrivateKey, recoverySalt) {
    const existing = this.db.prepare('SELECT user_id FROM user_recovery_keys WHERE user_id = ?').get(userId);

    if (!existing) {
      return null; // No existing recovery key to update
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE user_recovery_keys
      SET encrypted_private_key = ?, recovery_salt = ?, created_at = ?
      WHERE user_id = ?
    `).run(encryptedPrivateKey, recoverySalt, now, userId);

    return { userId, regeneratedAt: now };
  }

  // Get all participants' public keys for a wave (for key distribution)
  getWaveParticipantPublicKeys(waveId) {
    const rows = this.db.prepare(`
      SELECT wp.user_id, uek.public_key
      FROM wave_participants wp
      LEFT JOIN user_encryption_keys uek ON wp.user_id = uek.user_id
      WHERE wp.wave_id = ?
    `).all(waveId);

    return rows.map(row => ({
      userId: row.user_id,
      publicKey: row.public_key  // May be null if user hasn't set up E2EE
    }));
  }

  // Check if a wave is encrypted
  isWaveEncrypted(waveId) {
    const row = this.db.prepare('SELECT encrypted FROM waves WHERE id = ?').get(waveId);
    return row?.encrypted === 1;
  }

  // Set wave as encrypted
  setWaveEncrypted(waveId, encrypted = true) {
    this.db.prepare('UPDATE waves SET encrypted = ? WHERE id = ?').run(encrypted ? 1 : 0, waveId);
  }

  // Set wave encryption state (0=legacy, 1=encrypted, 2=partial)
  setWaveEncryptionState(waveId, state) {
    this.db.prepare('UPDATE waves SET encrypted = ? WHERE id = ?').run(state, waveId);
  }

  // Get wave encryption status with progress info
  getWaveEncryptionStatus(waveId) {
    const wave = this.db.prepare('SELECT encrypted FROM waves WHERE id = ?').get(waveId);
    if (!wave) return null;

    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN encrypted = 1 THEN 1 ELSE 0 END) as encrypted_count
      FROM pings WHERE wave_id = ?
    `).get(waveId);

    return {
      state: wave.encrypted, // 0=legacy, 1=encrypted, 2=partial
      totalDroplets: stats.total || 0,
      encryptedDroplets: stats.encrypted_count || 0,
      progress: stats.total > 0 ? Math.round((stats.encrypted_count / stats.total) * 100) : 100
    };
  }

  // Get E2EE status for all participants of a wave
  getParticipantsE2EEStatus(waveId) {
    const participants = this.db.prepare(`
      SELECT
        wp.user_id,
        u.handle,
        u.display_name,
        CASE WHEN uek.user_id IS NOT NULL THEN 1 ELSE 0 END as has_e2ee
      FROM wave_participants wp
      JOIN users u ON wp.user_id = u.id
      LEFT JOIN user_encryption_keys uek ON wp.user_id = uek.user_id
      WHERE wp.wave_id = ?
    `).all(waveId);

    return participants.map(p => ({
      userId: p.user_id,
      handle: p.handle,
      displayName: p.display_name,
      hasE2EE: p.has_e2ee === 1
    }));
  }

  // Get unencrypted droplets for a wave (for batch encryption)
  getUnencryptedDroplets(waveId, limit = 50) {
    return this.db.prepare(`
      SELECT id, content, author_id, created_at
      FROM pings
      WHERE wave_id = ? AND encrypted = 0
      ORDER BY created_at ASC
      LIMIT ?
    `).all(waveId, limit).map(d => ({
      id: d.id,
      content: d.content,
      authorId: d.author_id,
      createdAt: d.created_at
    }));
  }

  // Update a droplet with encrypted content
  encryptDropletContent(dropletId, encryptedContent, nonce, keyVersion) {
    this.db.prepare(`
      UPDATE pings
      SET content = ?, nonce = ?, key_version = ?, encrypted = 1
      WHERE id = ?
    `).run(encryptedContent, nonce, keyVersion, dropletId);
  }

  // ============ Bot Management (v2.1.0) ============

  /**
   * Create a new bot
   * @returns {object} Bot object with id, name, apiKeyHash, etc.
   */
  createBot({ name, description, ownerUserId, apiKeyHash, publicKey, encryptedPrivateKey, webhookSecret }) {
    const id = `bot-${uuidv4()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO bots (
        id, name, description, owner_user_id, api_key_hash,
        public_key, encrypted_private_key, webhook_secret,
        status, created_at, total_pings, total_api_calls
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, 0)
    `).run(id, name, description, ownerUserId, apiKeyHash, publicKey, encryptedPrivateKey, webhookSecret, now);

    return this.getBot(id);
  }

  /**
   * Get bot by ID
   */
  getBot(botId) {
    return this.db.prepare(`
      SELECT b.*, u.display_name as owner_name, u.handle as owner_handle
      FROM bots b
      LEFT JOIN users u ON b.owner_user_id = u.id
      WHERE b.id = ?
    `).get(botId);
  }

  /**
   * Find bot by API key hash (for authentication)
   */
  findBotByApiKeyHash(apiKeyHash) {
    return this.db.prepare(`
      SELECT * FROM bots WHERE api_key_hash = ? AND status = 'active'
    `).get(apiKeyHash);
  }

  /**
   * Get all bots (admin view)
   */
  getAllBots({ status = null, ownerId = null, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT b.*, u.display_name as owner_name, u.handle as owner_handle,
             COUNT(DISTINCT bp.wave_id) as wave_count
      FROM bots b
      LEFT JOIN users u ON b.owner_user_id = u.id
      LEFT JOIN bot_permissions bp ON b.id = bp.bot_id
    `;
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('b.status = ?');
      params.push(status);
    }
    if (ownerId) {
      conditions.push('b.owner_user_id = ?');
      params.push(ownerId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' GROUP BY b.id ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(query).all(...params);
  }

  /**
   * Update bot
   */
  updateBot(botId, updates) {
    const allowedFields = ['name', 'description', 'status', 'webhook_secret'];
    const sets = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (sets.length === 0) return false;

    values.push(botId);
    this.db.prepare(`UPDATE bots SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  /**
   * Update bot API key hash (for key regeneration)
   */
  regenerateBotApiKey(botId, newApiKeyHash) {
    this.db.prepare('UPDATE bots SET api_key_hash = ? WHERE id = ?').run(newApiKeyHash, botId);
    return true;
  }

  /**
   * Delete bot (cascades to permissions and keys)
   */
  deleteBot(botId) {
    const result = this.db.prepare('DELETE FROM bots WHERE id = ?').run(botId);
    return result.changes > 0;
  }

  /**
   * Update bot usage stats
   */
  updateBotStats(botId, type = 'api_call') {
    const now = new Date().toISOString();
    if (type === 'ping') {
      this.db.prepare('UPDATE bots SET total_pings = total_pings + 1, total_api_calls = total_api_calls + 1, last_used_at = ? WHERE id = ?').run(now, botId);
    } else {
      this.db.prepare('UPDATE bots SET total_api_calls = total_api_calls + 1, last_used_at = ? WHERE id = ?').run(now, botId);
    }
  }

  // ---- Bot Permissions ----

  /**
   * Grant bot access to a wave
   */
  grantBotPermission(botId, waveId, grantedBy, { canPost = true, canRead = true } = {}) {
    const id = `perm-${uuidv4()}`;
    const now = new Date().toISOString();

    // Check if permission already exists
    const existing = this.db.prepare('SELECT id FROM bot_permissions WHERE bot_id = ? AND wave_id = ?').get(botId, waveId);
    if (existing) {
      // Update existing
      this.db.prepare(`
        UPDATE bot_permissions SET can_post = ?, can_read = ?
        WHERE bot_id = ? AND wave_id = ?
      `).run(canPost ? 1 : 0, canRead ? 1 : 0, botId, waveId);
      return existing.id;
    }

    this.db.prepare(`
      INSERT INTO bot_permissions (id, bot_id, wave_id, can_post, can_read, granted_at, granted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, botId, waveId, canPost ? 1 : 0, canRead ? 1 : 0, now, grantedBy);

    return id;
  }

  /**
   * Revoke bot access to a wave
   */
  revokeBotPermission(botId, waveId) {
    const result = this.db.prepare('DELETE FROM bot_permissions WHERE bot_id = ? AND wave_id = ?').run(botId, waveId);
    return result.changes > 0;
  }

  /**
   * Check if bot has permission to access wave
   */
  botCanAccessWave(botId, waveId, requirePost = false) {
    const perm = this.db.prepare(`
      SELECT can_post, can_read FROM bot_permissions WHERE bot_id = ? AND wave_id = ?
    `).get(botId, waveId);

    if (!perm) return false;
    if (requirePost) return perm.can_post === 1;
    return perm.can_read === 1;
  }

  /**
   * Get bot's wave permissions
   */
  getBotPermissions(botId) {
    return this.db.prepare(`
      SELECT bp.*, w.title as wave_title, w.privacy as wave_privacy
      FROM bot_permissions bp
      LEFT JOIN waves w ON bp.wave_id = w.id
      WHERE bp.bot_id = ?
      ORDER BY bp.granted_at DESC
    `).all(botId);
  }

  /**
   * Get waves accessible to bot
   */
  getBotWaves(botId) {
    return this.db.prepare(`
      SELECT w.*, bp.can_post, bp.can_read,
             COUNT(DISTINCT p.id) as message_count
      FROM waves w
      INNER JOIN bot_permissions bp ON w.id = bp.wave_id
      LEFT JOIN pings p ON w.id = p.wave_id AND p.deleted = 0
      WHERE bp.bot_id = ? AND bp.can_read = 1
      GROUP BY w.id
      ORDER BY w.updated_at DESC
    `).all(botId);
  }

  // ---- Bot E2EE Keys ----

  /**
   * Store encrypted wave key for bot
   */
  createBotWaveKey(botId, waveId, encryptedWaveKey, senderPublicKey, keyVersion = 1) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const existing = this.db.prepare(`
      SELECT id FROM bot_wave_keys WHERE bot_id = ? AND wave_id = ? AND key_version = ?
    `).get(botId, waveId, keyVersion);

    if (existing) {
      this.db.prepare(`
        UPDATE bot_wave_keys SET encrypted_wave_key = ?, sender_public_key = ?
        WHERE bot_id = ? AND wave_id = ? AND key_version = ?
      `).run(encryptedWaveKey, senderPublicKey, botId, waveId, keyVersion);
      return existing.id;
    }

    this.db.prepare(`
      INSERT INTO bot_wave_keys (id, bot_id, wave_id, encrypted_wave_key, sender_public_key, key_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, botId, waveId, encryptedWaveKey, senderPublicKey, keyVersion, now);

    return id;
  }

  /**
   * Get bot's encrypted wave key
   */
  getBotWaveKey(botId, waveId, keyVersion = null) {
    if (keyVersion) {
      return this.db.prepare(`
        SELECT * FROM bot_wave_keys WHERE bot_id = ? AND wave_id = ? AND key_version = ?
      `).get(botId, waveId, keyVersion);
    }
    // Get latest version
    return this.db.prepare(`
      SELECT * FROM bot_wave_keys WHERE bot_id = ? AND wave_id = ?
      ORDER BY key_version DESC LIMIT 1
    `).get(botId, waveId);
  }

  // ============ Outgoing Webhooks (v2.15.5) ============

  /**
   * Create a new outgoing webhook for a wave
   */
  createWaveWebhook({ waveId, name, url, platform = 'generic', includeBotMessages = true, includeEncrypted = false, cooldownSeconds = 0, createdBy }) {
    const id = `webhook-${uuidv4()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO wave_webhooks (id, wave_id, name, url, platform, enabled, include_bot_messages, include_encrypted, cooldown_seconds, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(id, waveId, name, url, platform, includeBotMessages ? 1 : 0, includeEncrypted ? 1 : 0, cooldownSeconds, createdBy, now);

    return this.getWaveWebhook(id);
  }

  /**
   * Get a webhook by ID
   */
  getWaveWebhook(webhookId) {
    const row = this.db.prepare(`SELECT * FROM wave_webhooks WHERE id = ?`).get(webhookId);
    if (!row) return null;
    return this._formatWebhook(row);
  }

  /**
   * Get all webhooks for a wave
   */
  getWaveWebhooks(waveId) {
    const rows = this.db.prepare(`
      SELECT * FROM wave_webhooks WHERE wave_id = ? ORDER BY created_at ASC
    `).all(waveId);
    return rows.map(row => this._formatWebhook(row));
  }

  /**
   * Get all enabled webhooks for a wave
   */
  getEnabledWaveWebhooks(waveId) {
    const rows = this.db.prepare(`
      SELECT * FROM wave_webhooks WHERE wave_id = ? AND enabled = 1 ORDER BY created_at ASC
    `).all(waveId);
    return rows.map(row => this._formatWebhook(row));
  }

  /**
   * Update a webhook
   */
  updateWaveWebhook(webhookId, updates) {
    const allowedFields = ['name', 'url', 'platform', 'enabled', 'include_bot_messages', 'include_encrypted', 'cooldown_seconds'];
    const sets = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase to snake_case
      if (allowedFields.includes(dbKey)) {
        sets.push(`${dbKey} = ?`);
        values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
    }

    if (sets.length === 0) return this.getWaveWebhook(webhookId);

    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(webhookId);

    this.db.prepare(`UPDATE wave_webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.getWaveWebhook(webhookId);
  }

  /**
   * Delete a webhook
   */
  deleteWaveWebhook(webhookId) {
    this.db.prepare(`DELETE FROM wave_webhooks WHERE id = ?`).run(webhookId);
  }

  /**
   * Record successful webhook trigger
   */
  recordWebhookSuccess(webhookId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE wave_webhooks SET total_sent = total_sent + 1, last_triggered_at = ? WHERE id = ?
    `).run(now, webhookId);
  }

  /**
   * Record webhook error
   */
  recordWebhookError(webhookId, errorMessage) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE wave_webhooks SET total_errors = total_errors + 1, last_error = ?, last_error_at = ? WHERE id = ?
    `).run(errorMessage, now, webhookId);
  }

  /**
   * Format webhook row to object
   */
  _formatWebhook(row) {
    return {
      id: row.id,
      waveId: row.wave_id,
      name: row.name,
      url: row.url,
      platform: row.platform,
      enabled: !!row.enabled,
      includeBotMessages: !!row.include_bot_messages,
      includeEncrypted: !!row.include_encrypted,
      cooldownSeconds: row.cooldown_seconds,
      lastTriggeredAt: row.last_triggered_at,
      totalSent: row.total_sent,
      totalErrors: row.total_errors,
      lastError: row.last_error,
      lastErrorAt: row.last_error_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ============ Jellyfin Integration Methods (v2.14.0) ============

  /**
   * Add a Jellyfin server connection for a user
   */
  createJellyfinConnection({ userId, serverUrl, accessToken, jellyfinUserId, serverName }) {
    const id = `jfconn-${uuidv4()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO jellyfin_connections (id, user_id, server_url, access_token, jellyfin_user_id, server_name, status, last_connected, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, userId, serverUrl, accessToken, jellyfinUserId, serverName, now, now);

    return this.getJellyfinConnection(id);
  }

  /**
   * Get a Jellyfin connection by ID
   */
  getJellyfinConnection(connectionId) {
    const row = this.db.prepare(`
      SELECT * FROM jellyfin_connections WHERE id = ?
    `).get(connectionId);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      serverUrl: row.server_url,
      accessToken: row.access_token,
      jellyfinUserId: row.jellyfin_user_id,
      serverName: row.server_name,
      status: row.status,
      lastConnected: row.last_connected,
      createdAt: row.created_at,
    };
  }

  /**
   * Get all Jellyfin connections for a user
   */
  getJellyfinConnectionsByUser(userId) {
    const rows = this.db.prepare(`
      SELECT * FROM jellyfin_connections
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `).all(userId);

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      serverUrl: row.server_url,
      accessToken: row.access_token,
      jellyfinUserId: row.jellyfin_user_id,
      serverName: row.server_name,
      status: row.status,
      lastConnected: row.last_connected,
      createdAt: row.created_at,
    }));
  }

  /**
   * Update Jellyfin connection
   */
  updateJellyfinConnection(connectionId, updates) {
    const allowedFields = ['access_token', 'jellyfin_user_id', 'server_name', 'status', 'last_connected'];
    const sets = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase to snake_case
      if (allowedFields.includes(dbKey)) {
        sets.push(`${dbKey} = ?`);
        values.push(value);
      }
    }

    if (sets.length === 0) return false;

    values.push(connectionId);
    this.db.prepare(`UPDATE jellyfin_connections SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  /**
   * Update connection last_connected timestamp
   */
  touchJellyfinConnection(connectionId) {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE jellyfin_connections SET last_connected = ? WHERE id = ?`).run(now, connectionId);
  }

  /**
   * Delete a Jellyfin connection
   */
  deleteJellyfinConnection(connectionId) {
    const result = this.db.prepare(`DELETE FROM jellyfin_connections WHERE id = ?`).run(connectionId);
    return result.changes > 0;
  }

  /**
   * Verify user owns a Jellyfin connection (for auth checks)
   */
  userOwnsJellyfinConnection(userId, connectionId) {
    const row = this.db.prepare(`
      SELECT id FROM jellyfin_connections WHERE id = ? AND user_id = ?
    `).get(connectionId, userId);
    return !!row;
  }

  // ---- Watch Party Methods ----

  /**
   * Create a watch party
   */
  createWatchParty({ waveId, hostUserId, jellyfinConnectionId, jellyfinItemId, mediaTitle, mediaType }) {
    const id = `wp-${uuidv4()}`;
    const now = new Date().toISOString();

    // End any existing active party in this wave
    this.db.prepare(`
      UPDATE watch_parties SET status = 'ended', ended_at = ?
      WHERE wave_id = ? AND status = 'active'
    `).run(now, waveId);

    this.db.prepare(`
      INSERT INTO watch_parties (id, wave_id, host_user_id, jellyfin_connection_id, jellyfin_item_id, media_title, media_type, status, playback_position, is_playing, last_sync_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, ?, ?)
    `).run(id, waveId, hostUserId, jellyfinConnectionId, jellyfinItemId, mediaTitle, mediaType, now, now);

    return this.getWatchParty(id);
  }

  /**
   * Get a watch party by ID
   */
  getWatchParty(partyId) {
    const row = this.db.prepare(`
      SELECT wp.*, u.handle as host_handle, u.display_name as host_name, u.avatar as host_avatar,
             jc.server_url as jellyfin_server_url
      FROM watch_parties wp
      LEFT JOIN users u ON wp.host_user_id = u.id
      LEFT JOIN jellyfin_connections jc ON wp.jellyfin_connection_id = jc.id
      WHERE wp.id = ?
    `).get(partyId);

    if (!row) return null;

    return {
      id: row.id,
      waveId: row.wave_id,
      hostUserId: row.host_user_id,
      hostHandle: row.host_handle,
      hostName: row.host_name,
      hostAvatar: row.host_avatar,
      jellyfinConnectionId: row.jellyfin_connection_id,
      jellyfinServerUrl: row.jellyfin_server_url,
      jellyfinItemId: row.jellyfin_item_id,
      mediaTitle: row.media_title,
      mediaType: row.media_type,
      status: row.status,
      playbackPosition: row.playback_position,
      isPlaying: row.is_playing === 1,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
      endedAt: row.ended_at,
    };
  }

  /**
   * Get active watch party for a wave
   */
  getActiveWatchPartyForWave(waveId) {
    const row = this.db.prepare(`
      SELECT wp.*, u.handle as host_handle, u.display_name as host_name, u.avatar as host_avatar,
             jc.server_url as jellyfin_server_url, jc.access_token as jellyfin_access_token
      FROM watch_parties wp
      LEFT JOIN users u ON wp.host_user_id = u.id
      LEFT JOIN jellyfin_connections jc ON wp.jellyfin_connection_id = jc.id
      WHERE wp.wave_id = ? AND wp.status = 'active'
    `).get(waveId);

    if (!row) return null;

    return {
      id: row.id,
      waveId: row.wave_id,
      hostUserId: row.host_user_id,
      hostHandle: row.host_handle,
      hostName: row.host_name,
      hostAvatar: row.host_avatar,
      jellyfinConnectionId: row.jellyfin_connection_id,
      jellyfinServerUrl: row.jellyfin_server_url,
      jellyfinAccessToken: row.jellyfin_access_token,
      jellyfinItemId: row.jellyfin_item_id,
      mediaTitle: row.media_title,
      mediaType: row.media_type,
      status: row.status,
      playbackPosition: row.playback_position,
      isPlaying: row.is_playing === 1,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Get all active watch parties for waves the user participates in
   */
  getActiveWatchPartiesForUser(userId) {
    const rows = this.db.prepare(`
      SELECT wp.*, u.handle as host_handle, u.display_name as host_name, u.avatar as host_avatar
      FROM watch_parties wp
      LEFT JOIN users u ON wp.host_user_id = u.id
      INNER JOIN wave_participants wpart ON wp.wave_id = wpart.wave_id
      WHERE wpart.user_id = ? AND wp.status = 'active'
    `).all(userId);

    return rows.map(row => ({
      id: row.id,
      waveId: row.wave_id,
      hostUserId: row.host_user_id,
      hostHandle: row.host_handle,
      hostName: row.host_name,
      hostAvatar: row.host_avatar,
      jellyfinItemId: row.jellyfin_item_id,
      mediaTitle: row.media_title,
      mediaType: row.media_type,
      status: row.status,
      playbackPosition: row.playback_position,
      isPlaying: row.is_playing === 1,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * Update watch party playback state
   */
  updateWatchPartyPlayback(partyId, { playbackPosition, isPlaying }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE watch_parties SET playback_position = ?, is_playing = ?, last_sync_at = ?
      WHERE id = ? AND status = 'active'
    `).run(playbackPosition, isPlaying ? 1 : 0, now, partyId);
  }

  /**
   * End a watch party
   */
  endWatchParty(partyId) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE watch_parties SET status = 'ended', ended_at = ?
      WHERE id = ? AND status = 'active'
    `).run(now, partyId);
    return result.changes > 0;
  }

  /**
   * Check if user is host of a watch party
   */
  isWatchPartyHost(partyId, userId) {
    const row = this.db.prepare(`
      SELECT id FROM watch_parties WHERE id = ? AND host_user_id = ?
    `).get(partyId, userId);
    return !!row;
  }

  // ---- Jellyfin Feed Import Methods ----

  /**
   * Import a Jellyfin video to the feed
   */
  createJellyfinFeedImport({ userId, connectionId, jellyfinItemId, title, thumbnailUrl, durationTicks, mediaType }) {
    const id = `jfimport-${uuidv4()}`;
    const now = new Date().toISOString();

    // Use INSERT OR REPLACE to update existing imports
    this.db.prepare(`
      INSERT OR REPLACE INTO jellyfin_feed_imports (id, user_id, connection_id, jellyfin_item_id, title, thumbnail_url, duration_ticks, media_type, imported_at)
      VALUES (
        COALESCE((SELECT id FROM jellyfin_feed_imports WHERE user_id = ? AND jellyfin_item_id = ?), ?),
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(userId, jellyfinItemId, id, userId, connectionId, jellyfinItemId, title, thumbnailUrl, durationTicks, mediaType || 'Video', now);

    return this.getJellyfinFeedImport(userId, jellyfinItemId);
  }

  /**
   * Get a specific Jellyfin feed import
   */
  getJellyfinFeedImport(userId, jellyfinItemId) {
    const row = this.db.prepare(`
      SELECT fi.*, jc.server_url, jc.access_token
      FROM jellyfin_feed_imports fi
      LEFT JOIN jellyfin_connections jc ON fi.connection_id = jc.id
      WHERE fi.user_id = ? AND fi.jellyfin_item_id = ?
    `).get(userId, jellyfinItemId);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      connectionId: row.connection_id,
      jellyfinItemId: row.jellyfin_item_id,
      title: row.title,
      thumbnailUrl: row.thumbnail_url,
      durationTicks: row.duration_ticks,
      mediaType: row.media_type,
      serverUrl: row.server_url,
      accessToken: row.access_token,
      importedAt: row.imported_at,
    };
  }

  /**
   * Get all Jellyfin feed imports for a user
   */
  getJellyfinFeedImportsByUser(userId) {
    const rows = this.db.prepare(`
      SELECT fi.*, jc.server_url, jc.server_name
      FROM jellyfin_feed_imports fi
      LEFT JOIN jellyfin_connections jc ON fi.connection_id = jc.id
      WHERE fi.user_id = ?
      ORDER BY fi.imported_at DESC
    `).all(userId);

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      connectionId: row.connection_id,
      jellyfinItemId: row.jellyfin_item_id,
      title: row.title,
      thumbnailUrl: row.thumbnail_url,
      durationTicks: row.duration_ticks,
      mediaType: row.media_type,
      serverUrl: row.server_url,
      serverName: row.server_name,
      importedAt: row.imported_at,
    }));
  }

  /**
   * Delete a Jellyfin feed import
   */
  deleteJellyfinFeedImport(importId, userId) {
    const result = this.db.prepare(`
      DELETE FROM jellyfin_feed_imports WHERE id = ? AND user_id = ?
    `).run(importId, userId);
    return result.changes > 0;
  }

  /**
   * Delete all feed imports for a connection (when connection is deleted)
   */
  deleteJellyfinFeedImportsByConnection(connectionId) {
    const result = this.db.prepare(`
      DELETE FROM jellyfin_feed_imports WHERE connection_id = ?
    `).run(connectionId);
    return result.changes;
  }

  // ============ Plex Integration Methods (v2.15.0) ============

  /**
   * Add a Plex server connection for a user
   */
  createPlexConnection({ userId, serverUrl, accessToken, plexUserId, serverName, machineIdentifier }) {
    const id = `plex-${uuidv4()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO plex_connections (id, user_id, server_url, access_token, plex_user_id, server_name, machine_identifier, status, last_connected, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, userId, serverUrl, accessToken, plexUserId, serverName, machineIdentifier, now, now);

    return this.getPlexConnection(id);
  }

  /**
   * Get a Plex connection by ID
   */
  getPlexConnection(connectionId) {
    const row = this.db.prepare(`
      SELECT * FROM plex_connections WHERE id = ?
    `).get(connectionId);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      serverUrl: row.server_url,
      accessToken: row.access_token,
      plexUserId: row.plex_user_id,
      serverName: row.server_name,
      machineIdentifier: row.machine_identifier,
      status: row.status,
      lastConnected: row.last_connected,
      createdAt: row.created_at,
    };
  }

  /**
   * Get all Plex connections for a user
   */
  getPlexConnectionsByUser(userId) {
    const rows = this.db.prepare(`
      SELECT * FROM plex_connections
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `).all(userId);

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      serverUrl: row.server_url,
      accessToken: row.access_token,
      plexUserId: row.plex_user_id,
      serverName: row.server_name,
      machineIdentifier: row.machine_identifier,
      status: row.status,
      lastConnected: row.last_connected,
      createdAt: row.created_at,
    }));
  }

  /**
   * Update Plex connection
   */
  updatePlexConnection(connectionId, updates) {
    const allowedFields = ['access_token', 'plex_user_id', 'server_name', 'machine_identifier', 'status', 'last_connected'];
    const sets = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase to snake_case
      if (allowedFields.includes(dbKey)) {
        sets.push(`${dbKey} = ?`);
        values.push(value);
      }
    }

    if (sets.length === 0) return false;

    values.push(connectionId);
    this.db.prepare(`UPDATE plex_connections SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  /**
   * Update connection last_connected timestamp
   */
  touchPlexConnection(connectionId) {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE plex_connections SET last_connected = ? WHERE id = ?`).run(now, connectionId);
  }

  /**
   * Delete a Plex connection
   */
  deletePlexConnection(connectionId) {
    const result = this.db.prepare(`DELETE FROM plex_connections WHERE id = ?`).run(connectionId);
    return result.changes > 0;
  }

  /**
   * Verify user owns a Plex connection (for auth checks)
   */
  userOwnsPlexConnection(userId, connectionId) {
    const row = this.db.prepare(`
      SELECT id FROM plex_connections WHERE id = ? AND user_id = ?
    `).get(connectionId, userId);
    return !!row;
  }

  // ============ Video Feed Methods (v2.8.0) ============

  /**
   * Get video feed for a user
   * Returns videos from public waves and waves the user participates in
   * Excludes encrypted videos and videos from blocked users
   * @param {string} userId - The user ID
   * @param {number} limit - Max videos to return (default 10, max 50)
   * @param {string} cursor - Cursor for pagination (ping ID)
   * @param {number} seed - Random seed for consistent shuffle within session
   * @returns {Object} { videos: [], hasMore: boolean, nextCursor: string }
   */
  // Video Feed Recommendation Algorithm (v2.10.0)
  // Scores videos based on user preferences and engagement
  // Scoring: -100 own video, +50 liked creator, +30 contact, +100 unseen, -80 watched, +random(0-30)
  getVideoFeedForUser(userId, limit = 10, cursor = null, seed = null) {
    limit = Math.min(Math.max(1, limit), 50);

    // Get blocked users for this user
    const blockedUsers = this.db.prepare(`
      SELECT blocked_user_id FROM blocks WHERE user_id = ?
    `).all(userId).map(r => r.blocked_user_id);

    // Get users who have opted out of video feed (showInFeed: false)
    const optedOutUsers = this.db.prepare(`
      SELECT id FROM users WHERE json_extract(preferences, '$.videoFeed.showInFeed') = false
    `).all().map(r => r.id);

    const excludedUsers = [...new Set([...blockedUsers, ...optedOutUsers])];

    // Get user's contacts for scoring boost
    const contacts = this.db.prepare(`
      SELECT contact_id FROM contacts WHERE user_id = ?
    `).all(userId).map(r => r.contact_id);
    const contactSet = new Set(contacts);

    // Get creators the user has reacted to (liked)
    const likedCreators = this.db.prepare(`
      SELECT DISTINCT p.author_id
      FROM pings p
      WHERE p.reactions LIKE ?
        AND p.author_id != ?
    `).all(`%"${userId}"%`, userId).map(r => r.author_id);
    const likedCreatorSet = new Set(likedCreators);

    // Get videos the user has already viewed
    const viewedVideos = this.db.prepare(`
      SELECT prb.ping_id
      FROM ping_read_by prb
      JOIN pings p ON prb.ping_id = p.id
      WHERE prb.user_id = ?
        AND p.media_type = 'video'
    `).all(userId).map(r => r.ping_id);
    const viewedSet = new Set(viewedVideos);

    // Build query for video pings - fetch more to have candidates after scoring
    const fetchLimit = Math.min(limit * 5, 200); // Fetch 5x requested to have enough after filtering

    let query = `
      SELECT
        p.id,
        p.wave_id,
        p.author_id,
        p.content,
        p.media_url,
        p.media_duration,
        p.media_type,
        p.created_at,
        p.reactions,
        p.encrypted,
        p.broken_out_to,
        w.title as wave_title,
        w.privacy as wave_privacy,
        w.is_profile_wave,
        u.display_name as author_name,
        u.handle as author_handle,
        u.avatar as author_avatar,
        u.avatar_url as author_avatar_url,
        (SELECT COUNT(*) FROM pings WHERE wave_id = p.broken_out_to AND deleted = 0) as conversation_count,
        (SELECT COUNT(*) FROM pings p2
         WHERE p2.reactions LIKE '%"' || ? || '"%'
         AND json_extract(p2.reactions, '$') != '{}') as total_reactions
      FROM pings p
      JOIN waves w ON p.wave_id = w.id
      JOIN users u ON p.author_id = u.id
      WHERE p.media_type = 'video'
        AND p.deleted = 0
        AND p.encrypted = 0
        AND (
          w.privacy = 'public'
          OR EXISTS (
            SELECT 1 FROM wave_participants wp
            WHERE wp.wave_id = w.id AND wp.user_id = ?
          )
        )
    `;

    const params = [userId, userId];

    // Exclude blocked and opted-out users
    if (excludedUsers.length > 0) {
      query += ` AND p.author_id NOT IN (${excludedUsers.map(() => '?').join(',')})`;
      params.push(...excludedUsers);
    }

    // For cursor-based pagination, we need to track which videos were already shown
    // Use a combination of score-based selection and cursor to avoid duplicates
    let shownVideoIds = new Set();
    if (cursor) {
      // The cursor contains the last video ID, we'll exclude videos already shown
      // For simplicity, we'll use created_at as a secondary filter
      const cursorPing = this.db.prepare('SELECT created_at FROM pings WHERE id = ?').get(cursor);
      if (cursorPing) {
        // Include videos from before the cursor time, but we'll filter by score
        query += ` AND p.created_at <= ?`;
        params.push(cursorPing.created_at);
      }
    }

    query += ` ORDER BY p.created_at DESC LIMIT ?`;
    params.push(fetchLimit);

    const rows = this.db.prepare(query).all(...params);

    // Seeded random generator for consistent discovery randomness per session
    const seededRandom = (s) => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };
    let seedValue = seed || Date.now();

    // Score each video
    const scoredVideos = rows.map(row => {
      let score = 0;

      // -100 if own video (practically excludes from top results)
      if (row.author_id === userId) {
        score -= 100;
      }

      // +50 if from a creator the user has reacted to before
      if (likedCreatorSet.has(row.author_id)) {
        score += 50;
      }

      // +30 if from a contact
      if (contactSet.has(row.author_id)) {
        score += 30;
      }

      // +100 if unseen, -80 if already watched
      if (viewedSet.has(row.id)) {
        score -= 80;
      } else {
        score += 100;
      }

      // +20 if video has high engagement (conversations)
      if (row.conversation_count > 0) {
        score += Math.min(row.conversation_count * 5, 20);
      }

      // +random(0-30) for discovery and variety
      seedValue = (seedValue * 9301 + 49297) % 233280;
      score += Math.floor(seededRandom(seedValue) * 31);

      return {
        ...row,
        _score: score,
      };
    });

    // Sort by score descending
    scoredVideos.sort((a, b) => b._score - a._score);

    // For cursor pagination, skip videos we've already shown
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = scoredVideos.findIndex(v => v.id === cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    // Take the requested number of videos
    const selectedVideos = scoredVideos.slice(startIndex, startIndex + limit + 1);
    const hasMore = selectedVideos.length > limit;
    const videos = selectedVideos.slice(0, limit).map(row => ({
      id: row.id,
      wave_id: row.wave_id,
      wave_title: row.wave_title,
      wave_privacy: row.wave_privacy,
      is_profile_wave: row.is_profile_wave === 1,
      author_id: row.author_id,
      author_name: row.author_name,
      author_handle: row.author_handle,
      author_avatar: row.author_avatar,
      author_avatar_url: row.author_avatar_url,
      media_url: row.media_url,
      media_duration: row.media_duration,
      content: row.content,
      created_at: row.created_at,
      reactions: row.reactions ? JSON.parse(row.reactions) : {},
      is_encrypted: row.encrypted === 1,
      conversation_wave_id: row.broken_out_to || null,
      conversation_count: row.conversation_count || 0,
    }));

    return {
      videos,
      hasMore,
      nextCursor: hasMore && videos.length > 0 ? videos[videos.length - 1].id : null,
    };
  }

  // === Encrypted Contacts Methods (v2.18.0 - Phase 2 Privacy Hardening) ===

  /**
   * Get encrypted contacts blob for a user
   * @param {string} userId
   * @returns {{ encryptedData: string, nonce: string, version: number } | null}
   */
  getEncryptedContacts(userId) {
    const row = this.db.prepare(`
      SELECT encrypted_data, nonce, version, updated_at
      FROM encrypted_contacts
      WHERE user_id = ?
    `).get(userId);

    if (!row) return null;

    return {
      encryptedData: row.encrypted_data,
      nonce: row.nonce,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Save encrypted contacts blob for a user
   * @param {string} userId
   * @param {string} encryptedData - Base64 encrypted contact list
   * @param {string} nonce - Base64 AES-GCM nonce
   * @param {number} expectedVersion - For optimistic locking (optional)
   * @returns {{ success: boolean, version: number, error?: string }}
   */
  saveEncryptedContacts(userId, encryptedData, nonce, expectedVersion = null) {
    const now = new Date().toISOString();

    // Check if record exists
    const existing = this.db.prepare('SELECT version FROM encrypted_contacts WHERE user_id = ?').get(userId);

    if (existing) {
      // Optimistic locking check
      if (expectedVersion !== null && existing.version !== expectedVersion) {
        return { success: false, version: existing.version, error: 'Version conflict - contacts were modified elsewhere' };
      }

      const newVersion = existing.version + 1;
      this.db.prepare(`
        UPDATE encrypted_contacts
        SET encrypted_data = ?, nonce = ?, version = ?, updated_at = ?
        WHERE user_id = ?
      `).run(encryptedData, nonce, newVersion, now, userId);

      return { success: true, version: newVersion };
    } else {
      // Insert new record
      this.db.prepare(`
        INSERT INTO encrypted_contacts (user_id, encrypted_data, nonce, version, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(userId, encryptedData, nonce, now, now);

      return { success: true, version: 1 };
    }
  }

  /**
   * Delete encrypted contacts for a user (for account deletion)
   * @param {string} userId
   */
  deleteEncryptedContacts(userId) {
    this.db.prepare('DELETE FROM encrypted_contacts WHERE user_id = ?').run(userId);
  }

  /**
   * Check if user has migrated to encrypted contacts
   * @param {string} userId
   * @returns {boolean}
   */
  hasEncryptedContacts(userId) {
    const row = this.db.prepare('SELECT 1 FROM encrypted_contacts WHERE user_id = ?').get(userId);
    return !!row;
  }

  // Placeholder for JSON compatibility - not needed with SQLite
  saveUsers() {}
  saveWaves() {}
  saveDroplets() {}
  saveMessages() {} // Backward compatibility alias
  saveGroups() {}
  saveHandleRequests() {}
  saveReports() {}
  saveContactRequests() {}
  saveGroupInvitations() {}
  saveModeration() {}
  savePushSubscriptions() {}
  saveAll() {}

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// Export for use in server.js
export default DatabaseSQLite;
