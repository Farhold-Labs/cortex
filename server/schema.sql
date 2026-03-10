-- Cortex SQLite Database Schema
-- Version 2.0.0
--
-- Terminology:
--   pings (formerly droplets) - individual messages
--   crews (formerly groups) - user groups
--   burst (formerly ripple) - break-out threads

-- ============ Users ============
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    handle TEXT UNIQUE NOT NULL COLLATE NOCASE,
    email TEXT COLLATE NOCASE,                    -- Legacy: plaintext email (will be migrated)
    email_hash TEXT,                              -- SHA-256(lowercase(email)) for lookup
    email_encrypted TEXT,                         -- AES-256-GCM encrypted email for password reset
    email_iv TEXT,                                -- AES-GCM initialization vector (12 bytes, base64)
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
    -- Security flags
    require_password_change INTEGER DEFAULT 0,
    -- Preferences stored as JSON
    preferences TEXT DEFAULT '{"theme":"firefly","fontSize":"medium"}',
    notification_preferences TEXT DEFAULT NULL,
    -- Account moderation (v2.37.0)
    account_status TEXT DEFAULT 'active',        -- active, disabled, banned
    moderation_reason TEXT,
    moderated_at TEXT,
    moderated_by TEXT
);

-- Handle history for tracking username changes
CREATE TABLE IF NOT EXISTS handle_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_handle TEXT NOT NULL,
    changed_at TEXT NOT NULL
);

-- Contacts relationship (one-directional, need two rows for mutual)
-- Note: contact_id has no FK to allow federated user follows
CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (user_id, contact_id)
);

-- ============ Waves ============
CREATE TABLE IF NOT EXISTS waves (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    privacy TEXT NOT NULL DEFAULT 'private',
    crew_id TEXT REFERENCES crews(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- Burst (break-out) tracking fields
    root_ping_id TEXT REFERENCES pings(id) ON DELETE SET NULL,
    broken_out_from TEXT REFERENCES waves(id) ON DELETE SET NULL,
    -- JSON array storing the lineage: [{"wave_id":"...", "ping_id":"...", "title":"..."}]
    breakout_chain TEXT,
    -- Federation fields (v1.13.0)
    federation_state TEXT DEFAULT 'local',  -- local, origin, participant
    origin_node TEXT,                        -- node name if participant wave
    origin_wave_id TEXT,                     -- original wave id on origin server
    -- E2EE field (v1.19.0)
    encrypted INTEGER DEFAULT 0,            -- 1 if wave uses E2EE (all new waves)
    -- Profile Wave fields (v2.9.0)
    is_profile_wave INTEGER DEFAULT 0,      -- 1 if this is a user's profile video wave
    profile_owner_id TEXT REFERENCES users(id) -- Owner of the profile wave
);

-- Wave participants
CREATE TABLE IF NOT EXISTS wave_participants (
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    archived INTEGER DEFAULT 0,
    last_read TEXT,
    pinned INTEGER DEFAULT 0,  -- v2.2.0: Pin wave to top of list
    PRIMARY KEY (wave_id, user_id)
);

-- ============ Wave Organization (v2.2.0) ============

-- User-defined wave categories for organizing wave list
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

-- Wave category assignments (which wave belongs to which category for each user)
CREATE TABLE IF NOT EXISTS wave_category_assignments (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES wave_categories(id) ON DELETE SET NULL,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (user_id, wave_id)
);

-- ============ Pings (formerly Droplets/Messages) ============
CREATE TABLE IF NOT EXISTS pings (
    id TEXT PRIMARY KEY,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES pings(id) ON DELETE SET NULL,
    author_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    privacy TEXT DEFAULT 'private',
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    edited_at TEXT,
    deleted INTEGER DEFAULT 0,
    deleted_at TEXT,
    -- Reactions stored as JSON: {"emoji": ["userId1", "userId2"]}
    reactions TEXT DEFAULT '{}',
    -- Burst (break-out) tracking fields
    broken_out_to TEXT REFERENCES waves(id) ON DELETE SET NULL,
    original_wave_id TEXT REFERENCES waves(id) ON DELETE SET NULL,
    -- E2EE fields (v1.19.0)
    encrypted INTEGER DEFAULT 0,           -- 1 if content is encrypted
    nonce TEXT,                            -- Base64 AES-GCM nonce (12 bytes)
    key_version INTEGER DEFAULT 1,         -- Wave key version used for encryption
    -- Threading fields (v2.38.0)
    threaded INTEGER DEFAULT 0,            -- 1 if message has been burst/threaded
    is_thread_reply INTEGER DEFAULT 0      -- 1 if reply was made within thread panel
);

-- Ping read tracking (many-to-many)
CREATE TABLE IF NOT EXISTS ping_read_by (
    ping_id TEXT NOT NULL REFERENCES pings(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    PRIMARY KEY (ping_id, user_id)
);

-- Ping edit history
CREATE TABLE IF NOT EXISTS ping_history (
    id TEXT PRIMARY KEY,
    ping_id TEXT NOT NULL REFERENCES pings(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    version INTEGER NOT NULL,
    edited_at TEXT NOT NULL
);

-- ============ Crews (formerly Groups) ============
CREATE TABLE IF NOT EXISTS crews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

-- Crew members (formerly group_members)
CREATE TABLE IF NOT EXISTS crew_members (
    crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (crew_id, user_id)
);

-- ============ Requests & Invitations ============

-- Handle change requests
CREATE TABLE IF NOT EXISTS handle_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_handle TEXT NOT NULL,
    new_handle TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT,
    processed_by TEXT REFERENCES users(id)
);

-- Contact requests
CREATE TABLE IF NOT EXISTS contact_requests (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    responded_at TEXT
);

-- Crew invitations (formerly group_invitations)
CREATE TABLE IF NOT EXISTS crew_invitations (
    id TEXT PRIMARY KEY,
    crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
    invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    responded_at TEXT
);

-- ============ Moderation ============

-- User blocks
CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_at TEXT NOT NULL,
    UNIQUE (user_id, blocked_user_id)
);

-- User mutes
CREATE TABLE IF NOT EXISTS mutes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_at TEXT NOT NULL,
    UNIQUE (user_id, muted_user_id)
);

-- Content reports
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

-- User warnings (issued by moderators)
CREATE TABLE IF NOT EXISTS warnings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_by TEXT NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

-- Moderation appeals (v2.37.0)
CREATE TABLE IF NOT EXISTS moderation_appeals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appeal_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',      -- pending, approved, denied
    admin_response TEXT,
    reviewed_by TEXT REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_user ON moderation_appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_appeals_status ON moderation_appeals(status);

-- Moderation audit log
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

-- ============ Account Security ============

-- Account lockouts (persisted across restarts)
CREATE TABLE IF NOT EXISTS account_lockouts (
    handle TEXT PRIMARY KEY COLLATE NOCASE,
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

-- ============ Multi-Factor Authentication ============

-- User MFA settings
CREATE TABLE IF NOT EXISTS user_mfa (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    totp_secret TEXT,                    -- Encrypted TOTP secret
    totp_enabled INTEGER DEFAULT 0,
    email_mfa_enabled INTEGER DEFAULT 0,
    recovery_codes TEXT,                 -- JSON array of hashed codes
    recovery_codes_generated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- MFA challenge tokens (for login flow)
CREATE TABLE IF NOT EXISTS mfa_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_type TEXT NOT NULL,        -- totp, email, recovery
    code_hash TEXT,                      -- For email codes (hashed)
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    created_at TEXT NOT NULL,
    session_duration TEXT DEFAULT '24h'  -- Session duration for post-MFA token (v2.0.5)
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires ON mfa_challenges(expires_at);

-- ============ Activity Log (v1.14.0) ============

-- Activity log for security auditing
CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,           -- login, logout, password_change, etc.
    resource_type TEXT,                  -- user, wave, droplet, etc.
    resource_id TEXT,                    -- ID of the affected resource
    ip_address TEXT,
    user_agent TEXT,
    metadata TEXT,                       -- JSON for additional context
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_resource ON activity_log(resource_type, resource_id);

-- ============ Session Management (v1.18.0) ============

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

-- ============ End-to-End Encryption (v1.19.0) ============

-- User encryption keypairs (ECDH P-384)
-- Private key is encrypted with user's passphrase-derived key (PBKDF2)
CREATE TABLE IF NOT EXISTS user_encryption_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,              -- Base64 SPKI-encoded ECDH public key
    encrypted_private_key TEXT NOT NULL,   -- Base64 AES-KW encrypted JWK private key
    key_derivation_salt TEXT NOT NULL,     -- Base64 PBKDF2 salt (16 bytes)
    key_version INTEGER DEFAULT 1,         -- Incremented on key rotation
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Wave encryption keys (per-participant)
-- Each participant has the wave key encrypted with their public key
CREATE TABLE IF NOT EXISTS wave_encryption_keys (
    id TEXT PRIMARY KEY,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_wave_key TEXT NOT NULL,      -- Base64 encrypted AES-256-GCM key
    sender_public_key TEXT NOT NULL,       -- Base64 SPKI of key used to encrypt
    key_version INTEGER DEFAULT 1,         -- Version of wave key
    created_at TEXT NOT NULL,
    UNIQUE(wave_id, user_id, key_version)
);

-- Wave key metadata
-- Tracks current key version and rotation history
CREATE TABLE IF NOT EXISTS wave_key_metadata (
    wave_id TEXT PRIMARY KEY REFERENCES waves(id) ON DELETE CASCADE,
    current_key_version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    last_rotated_at TEXT
);

-- E2EE Recovery (optional passphrase recovery)
CREATE TABLE IF NOT EXISTS user_recovery_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_private_key TEXT NOT NULL,   -- Private key encrypted with recovery passphrase
    recovery_salt TEXT NOT NULL,           -- Separate salt for recovery key derivation
    hint TEXT,                             -- User-provided hint for recovery passphrase
    created_at TEXT NOT NULL
);

-- Encrypted contact lists (v2.18.0 - Phase 2 Privacy Hardening)
-- User's contact list stored as encrypted blob, only they can decrypt
CREATE TABLE IF NOT EXISTS encrypted_contacts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_data TEXT NOT NULL,          -- Base64 AES-256-GCM encrypted JSON contact list
    nonce TEXT NOT NULL,                   -- Base64 AES-GCM nonce (12 bytes)
    version INTEGER DEFAULT 1,             -- Incremented on each update for conflict detection
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Encrypted wave participation (v2.21.0 - Privacy Hardening)
-- Participant lists encrypted so DB dump cannot reveal social graph
CREATE TABLE IF NOT EXISTS wave_participants_encrypted (
    wave_id TEXT PRIMARY KEY,
    participant_blob TEXT NOT NULL,        -- AES-256-GCM encrypted JSON array of user IDs
    iv TEXT NOT NULL,                      -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Encrypted crew membership (v2.24.0 - Privacy Hardening Phase 4)
-- Crew member lists encrypted so DB dump cannot reveal group associations
CREATE TABLE IF NOT EXISTS crew_members_encrypted (
    crew_id TEXT PRIMARY KEY,
    member_blob TEXT NOT NULL,             -- AES-256-GCM encrypted JSON array of user IDs
    iv TEXT NOT NULL,                      -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Encrypted wave user metadata (v2.27.0 - Privacy Hardening Phase 5)
-- Per-user wave settings (archived, pinned, hidden, category) stored encrypted
-- lookup_key is HMAC-SHA256(waveId|userId, WAVE_PARTICIPATION_KEY) — no plaintext user/wave IDs
CREATE TABLE IF NOT EXISTS wave_user_metadata (
    lookup_key TEXT PRIMARY KEY,              -- HMAC-SHA256(waveId|userId, key)
    encrypted_data TEXT NOT NULL,             -- AES-256-GCM encrypted JSON blob
    iv TEXT NOT NULL,                         -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- E2EE indexes
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_wave ON wave_encryption_keys(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_user ON wave_encryption_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_version ON wave_encryption_keys(wave_id, key_version);
-- v2.27.0: Blinded user key ID for wave encryption keys (HMAC of user_id)
-- user_key_id column added via migration in database-sqlite.js initializeDatabase()
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_user_key ON wave_encryption_keys(user_key_id) WHERE user_key_id IS NOT NULL;

-- ============ Indexes ============

-- User lookups
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Handle history lookup
CREATE INDEX IF NOT EXISTS idx_handle_history_user ON handle_history(user_id);

-- Contact lookups
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_contact ON contacts(contact_id);

-- Wave lookups
CREATE INDEX IF NOT EXISTS idx_waves_created_by ON waves(created_by);
CREATE INDEX IF NOT EXISTS idx_waves_privacy ON waves(privacy);
CREATE INDEX IF NOT EXISTS idx_waves_crew ON waves(crew_id);
CREATE INDEX IF NOT EXISTS idx_waves_updated ON waves(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_waves_root_ping ON waves(root_ping_id);
CREATE INDEX IF NOT EXISTS idx_waves_broken_out_from ON waves(broken_out_from);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waves_profile_owner ON waves(profile_owner_id) WHERE is_profile_wave = 1;

-- Wave participant lookups
CREATE INDEX IF NOT EXISTS idx_wave_participants_user ON wave_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_participants_wave ON wave_participants(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_participants_archived ON wave_participants(user_id, archived);
CREATE INDEX IF NOT EXISTS idx_wave_participants_pinned ON wave_participants(user_id, pinned) WHERE pinned = 1;

-- Wave category lookups (v2.2.0)
CREATE INDEX IF NOT EXISTS idx_wave_categories_user ON wave_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_categories_sort ON wave_categories(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_user ON wave_category_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_category ON wave_category_assignments(category_id);
CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_wave ON wave_category_assignments(wave_id);

-- Ping lookups (formerly droplet lookups)
CREATE INDEX IF NOT EXISTS idx_pings_wave ON pings(wave_id);
CREATE INDEX IF NOT EXISTS idx_pings_author ON pings(author_id);
CREATE INDEX IF NOT EXISTS idx_pings_parent ON pings(parent_id);
CREATE INDEX IF NOT EXISTS idx_pings_created ON pings(wave_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pings_deleted ON pings(deleted);
CREATE INDEX IF NOT EXISTS idx_pings_broken_out ON pings(broken_out_to);
CREATE INDEX IF NOT EXISTS idx_pings_original_wave ON pings(original_wave_id);

-- Ping read tracking (formerly droplet read tracking)
CREATE INDEX IF NOT EXISTS idx_ping_read_user ON ping_read_by(user_id);
CREATE INDEX IF NOT EXISTS idx_ping_read_ping ON ping_read_by(ping_id);

-- Ping history (formerly droplet history)
CREATE INDEX IF NOT EXISTS idx_ping_history_ping ON ping_history(ping_id);

-- Crew lookups (formerly group lookups)
CREATE INDEX IF NOT EXISTS idx_crews_created_by ON crews(created_by);

-- Crew member lookups (formerly group member lookups)
CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_crew ON crew_members(crew_id);

-- Handle request lookups
CREATE INDEX IF NOT EXISTS idx_handle_requests_user ON handle_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_handle_requests_status ON handle_requests(status);

-- Contact request lookups
CREATE INDEX IF NOT EXISTS idx_contact_requests_from ON contact_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_to ON contact_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_status ON contact_requests(status);

-- Crew invitation lookups (formerly group invitation lookups)
CREATE INDEX IF NOT EXISTS idx_crew_invitations_crew ON crew_invitations(crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_invitations_inviter ON crew_invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_crew_invitations_invitee ON crew_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_crew_invitations_status ON crew_invitations(status);

-- Moderation lookups
CREATE INDEX IF NOT EXISTS idx_blocks_user ON blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_user_id);
CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes(user_id);
CREATE INDEX IF NOT EXISTS idx_mutes_muted ON mutes(muted_user_id);

-- Report lookups
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);

-- Warning lookups
CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);
CREATE INDEX IF NOT EXISTS idx_warnings_issued_by ON warnings(issued_by);
CREATE INDEX IF NOT EXISTS idx_warnings_report ON warnings(report_id);

-- Moderation log lookups
CREATE INDEX IF NOT EXISTS idx_moderation_log_admin ON moderation_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_moderation_log_target ON moderation_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_moderation_log_created ON moderation_log(created_at DESC);

-- ============ Notifications ============

-- User notifications
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,  -- direct_mention, reply, wave_activity, burst, system
    wave_id TEXT REFERENCES waves(id) ON DELETE SET NULL,
    ping_id TEXT REFERENCES pings(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT,
    preview TEXT,  -- Truncated content preview
    read INTEGER DEFAULT 0,
    dismissed INTEGER DEFAULT 0,
    push_sent INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    read_at TEXT,
    crew_key TEXT  -- For collapsing similar notifications
);

-- Notification preferences per wave
CREATE TABLE IF NOT EXISTS wave_notification_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    enabled INTEGER DEFAULT 1,
    level TEXT DEFAULT 'all',  -- all, mentions, none
    sound INTEGER DEFAULT 1,
    push INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, wave_id)
);

-- ============ Push Subscriptions ============

-- Web Push API subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    -- Keys stored as JSON: {"p256dh": "...", "auth": "..."}
    keys TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, endpoint)
);

-- Push subscription lookups
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- Encrypted push subscriptions (v2.22.0 - Privacy Hardening)
-- User's push subscriptions stored as encrypted blob
CREATE TABLE IF NOT EXISTS push_subscriptions_encrypted (
    user_hash TEXT PRIMARY KEY,           -- SHA-256 of user_id (for deduplication)
    subscriptions_blob TEXT NOT NULL,     -- AES-256-GCM encrypted JSON array
    iv TEXT NOT NULL,                     -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Notification lookups
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = 0;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_wave ON notifications(wave_id);
CREATE INDEX IF NOT EXISTS idx_notifications_ping ON notifications(ping_id);
CREATE INDEX IF NOT EXISTS idx_notifications_crew_key ON notifications(crew_key);

-- Wave notification settings lookups
CREATE INDEX IF NOT EXISTS idx_wave_notification_settings_user ON wave_notification_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_notification_settings_wave ON wave_notification_settings(wave_id);

-- ============ Federation ============

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
    status TEXT DEFAULT 'pending',  -- pending, outbound_pending, active, suspended, blocked, declined
    added_by TEXT REFERENCES users(id),
    last_contact_at TEXT,
    failure_count INTEGER DEFAULT 0,
    protocol_version INTEGER DEFAULT 1,  -- v2.28.0: federation protocol version (1=legacy, 2=decoy+padding)
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
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, declined
    created_at TEXT NOT NULL,
    responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_federation_requests_status ON federation_requests(status);
CREATE INDEX IF NOT EXISTS idx_federation_requests_to_node ON federation_requests(to_node_name);

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
    status TEXT DEFAULT 'active',  -- active, pending, removed
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (wave_id, node_name)
);

-- Cached pings from federated servers (formerly remote_droplets)
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
    message_type TEXT NOT NULL,  -- wave_invite, new_droplet, droplet_edited, etc.
    payload TEXT NOT NULL,       -- JSON payload
    status TEXT DEFAULT 'pending',  -- pending, processing, delivered, failed
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
    status TEXT DEFAULT 'received'  -- received, processed, rejected
);

-- Federation indexes
CREATE INDEX IF NOT EXISTS idx_federation_nodes_status ON federation_nodes(status);
CREATE INDEX IF NOT EXISTS idx_federation_nodes_name ON federation_nodes(node_name);
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

-- ============ Crawl Bar (v1.15.0) ============

-- Server-wide crawl bar configuration (singleton)
CREATE TABLE IF NOT EXISTS crawl_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    -- Stock symbols to display (JSON array)
    stock_symbols TEXT DEFAULT '["AAPL","GOOGL","MSFT","AMZN","TSLA"]',
    -- News sources configuration (JSON array of {type, url, name})
    news_sources TEXT DEFAULT '[]',
    -- Default location for weather (JSON: {lat, lon, name})
    default_location TEXT DEFAULT '{"lat":40.7128,"lon":-74.0060,"name":"New York, NY"}',
    -- Refresh intervals in seconds
    stock_refresh_interval INTEGER DEFAULT 60,
    weather_refresh_interval INTEGER DEFAULT 300,
    news_refresh_interval INTEGER DEFAULT 180,
    -- Feature toggles
    stocks_enabled INTEGER DEFAULT 1,
    weather_enabled INTEGER DEFAULT 1,
    news_enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Cache for external API responses
CREATE TABLE IF NOT EXISTS crawl_cache (
    id TEXT PRIMARY KEY,
    cache_type TEXT NOT NULL,  -- 'stocks', 'weather', 'news'
    cache_key TEXT NOT NULL,   -- Symbol, location hash, or source URL
    data TEXT NOT NULL,        -- JSON cached response
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (cache_type, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_crawl_cache_type ON crawl_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_crawl_cache_expires ON crawl_cache(expires_at);

-- ============ Alert Droplets (v1.16.0) ============

-- Admin-created alerts that display in crawl bar
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'info',    -- info, warning, critical
    category TEXT NOT NULL DEFAULT 'system',  -- system, announcement, emergency
    scope TEXT NOT NULL DEFAULT 'local',      -- local, federated
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT,
    -- Federation tracking (NULL if local, populated if received from federated server)
    origin_node TEXT,
    origin_alert_id TEXT,
    UNIQUE (origin_node, origin_alert_id)
);

-- Subscriptions: what alert categories we subscribe to from other servers
CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id TEXT PRIMARY KEY,
    source_node TEXT NOT NULL UNIQUE,         -- Node we're subscribing to
    categories TEXT NOT NULL DEFAULT '[]',    -- JSON array: ["system","emergency"]
    status TEXT NOT NULL DEFAULT 'active',    -- active, paused
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Subscribers: who subscribes to our alerts (populated by federation inbox)
CREATE TABLE IF NOT EXISTS alert_subscribers (
    id TEXT PRIMARY KEY,
    subscriber_node TEXT NOT NULL UNIQUE,     -- Node subscribing to us
    categories TEXT NOT NULL DEFAULT '[]',    -- JSON array
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

-- ============ Bots & Webhooks (v2.1.0) ============

-- Bots: Automated systems that can post to waves via API
CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,                      -- bot-{uuid}
    name TEXT NOT NULL,                       -- Display name (e.g., "GitHub Notifier")
    description TEXT,                         -- Bot purpose description
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_hash TEXT UNIQUE NOT NULL,        -- SHA-256 hash of API key
    status TEXT DEFAULT 'active',             -- active, suspended, revoked
    created_at TEXT NOT NULL,
    last_used_at TEXT,                        -- Track last API call
    -- E2EE support
    public_key TEXT,                          -- Base64 SPKI-encoded ECDH public key
    encrypted_private_key TEXT,               -- Base64 AES-KW encrypted with master bot key
    key_version INTEGER DEFAULT 1,
    -- Metadata
    total_pings INTEGER DEFAULT 0,            -- Usage stats
    total_api_calls INTEGER DEFAULT 0,
    -- Settings
    can_create_waves INTEGER DEFAULT 0,       -- Permission flag (future feature)
    webhook_secret TEXT                       -- Optional webhook validation secret
);

CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
CREATE INDEX IF NOT EXISTS idx_bots_api_key_hash ON bots(api_key_hash);

-- Bot Permissions: Wave-level access control for bots
CREATE TABLE IF NOT EXISTS bot_permissions (
    id TEXT PRIMARY KEY,                      -- perm-{uuid}
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    can_post INTEGER DEFAULT 1,               -- Can send pings
    can_read INTEGER DEFAULT 1,               -- Can read wave history
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
    encrypted_wave_key TEXT NOT NULL,         -- Wave key encrypted for bot
    sender_public_key TEXT NOT NULL,          -- Public key used to encrypt
    key_version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(bot_id, wave_id, key_version)
);

CREATE INDEX IF NOT EXISTS idx_bot_wave_keys_bot ON bot_wave_keys(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_wave_keys_wave ON bot_wave_keys(wave_id);

-- ============ Outgoing Webhooks (v2.15.5) ============

-- Wave webhooks: Auto-forward messages to external services (Discord, Slack, etc.)
CREATE TABLE IF NOT EXISTS wave_webhooks (
    id TEXT PRIMARY KEY,                      -- webhook-{uuid}
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                       -- Display name (e.g., "Discord Updates")
    url TEXT NOT NULL,                        -- Webhook URL (must be HTTPS)
    platform TEXT DEFAULT 'generic',          -- discord, slack, teams, generic
    enabled INTEGER DEFAULT 1,

    -- Filtering options
    include_bot_messages INTEGER DEFAULT 1,   -- Forward bot messages?
    include_encrypted INTEGER DEFAULT 0,      -- Forward encrypted (shows "[Encrypted]")?

    -- Rate limiting
    cooldown_seconds INTEGER DEFAULT 0,       -- Min seconds between webhook calls
    last_triggered_at TEXT,

    -- Stats & debugging
    total_sent INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    last_error TEXT,
    last_error_at TEXT,

    -- Metadata
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_wave_webhooks_wave ON wave_webhooks(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_webhooks_enabled ON wave_webhooks(enabled);

-- ============ Full-Text Search ============

-- FTS5 virtual table for ping content search (formerly droplets_fts)
CREATE VIRTUAL TABLE IF NOT EXISTS pings_fts USING fts5(
    id UNINDEXED,
    content,
    content='pings',
    content_rowid='rowid'
);

-- Triggers to keep FTS table in sync with pings table
-- Note: These triggers use external content table, so we need to handle inserts/updates/deletes

-- After INSERT trigger
CREATE TRIGGER IF NOT EXISTS pings_fts_insert AFTER INSERT ON pings BEGIN
    INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
END;

-- After DELETE trigger
CREATE TRIGGER IF NOT EXISTS pings_fts_delete AFTER DELETE ON pings BEGIN
    INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
END;

-- After UPDATE trigger
CREATE TRIGGER IF NOT EXISTS pings_fts_update AFTER UPDATE ON pings BEGIN
    INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
    INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
END;
