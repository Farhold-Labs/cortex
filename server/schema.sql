-- Cortex SQLite Database Schema
--
-- Terminology:
--   pings (formerly droplets) - individual messages
--   crews (formerly groups) - user groups
--   burst (formerly ripple) - break-out threads
--
-- ⚠️  GENERATED FILE — do not add tables here by hand.
--
-- This is a dump of the schema a fully-migrated database actually has. Historically
-- this file drifted from the live schema: tables and columns were added only to
-- applySchemaUpdates(), so fresh installs came up incomplete and crashed at runtime
-- (see CHANGELOG v2.61.1 and v2.64.1).
--
-- To add schema: put the change in applySchemaUpdates() so existing databases migrate,
-- then run `node tools/generate-schema.mjs` and commit both.

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
    preferences TEXT DEFAULT '{}',
    notification_preferences TEXT DEFAULT NULL,
    -- Account moderation (v2.37.0)
    account_status TEXT DEFAULT 'active',        -- active, disabled, banned
    moderation_reason TEXT,
    moderated_at TEXT,
    moderated_by TEXT,
    -- Birthday & calendar (v2.40.0)
    birthday TEXT,                               -- MM-DD format (no year for privacy)
    birthday_visibility TEXT DEFAULT 'contacts'  -- everyone, contacts, hidden
, is_cross_port INTEGER DEFAULT 0, home_node TEXT, home_user_id TEXT);
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_birthday ON users(birthday) WHERE birthday IS NOT NULL;

CREATE TABLE IF NOT EXISTS handle_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_handle TEXT NOT NULL,
    changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handle_history_user ON handle_history(user_id);

CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (user_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_contact ON contacts(contact_id);

CREATE TABLE IF NOT EXISTS gif_favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    gif_id TEXT NOT NULL,
    url TEXT NOT NULL,
    preview TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    title TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, provider, gif_id)
);
CREATE INDEX IF NOT EXISTS idx_gif_favorites_user ON gif_favorites(user_id, created_at DESC);

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
, audio_encryption_enabled INTEGER DEFAULT 0, topic TEXT DEFAULT NULL);
CREATE INDEX IF NOT EXISTS idx_waves_created_by ON waves(created_by);
CREATE INDEX IF NOT EXISTS idx_waves_privacy ON waves(privacy);
CREATE INDEX IF NOT EXISTS idx_waves_crew ON waves(crew_id);
CREATE INDEX IF NOT EXISTS idx_waves_updated ON waves(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_waves_root_ping ON waves(root_ping_id);
CREATE INDEX IF NOT EXISTS idx_waves_broken_out_from ON waves(broken_out_from);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waves_profile_owner ON waves(profile_owner_id) WHERE is_profile_wave = 1;

CREATE TABLE IF NOT EXISTS wave_participants (
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    archived INTEGER DEFAULT 0,
    last_read TEXT,
    pinned INTEGER DEFAULT 0,  -- v2.2.0: Pin wave to top of list
    PRIMARY KEY (wave_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_wave_participants_user ON wave_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_participants_wave ON wave_participants(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_participants_archived ON wave_participants(user_id, archived);
CREATE INDEX IF NOT EXISTS idx_wave_participants_pinned ON wave_participants(user_id, pinned) WHERE pinned = 1;

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
CREATE INDEX IF NOT EXISTS idx_wave_categories_user ON wave_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_categories_sort ON wave_categories(user_id, sort_order);

CREATE TABLE IF NOT EXISTS wave_category_assignments (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES wave_categories(id) ON DELETE SET NULL,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (user_id, wave_id)
);
CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_user ON wave_category_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_category ON wave_category_assignments(category_id);
CREATE INDEX IF NOT EXISTS idx_wave_category_assignments_wave ON wave_category_assignments(wave_id);

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
, bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL, media_type TEXT, media_url TEXT, media_duration INTEGER, media_encrypted INTEGER DEFAULT 0, event_id TEXT REFERENCES events(id) ON DELETE SET NULL, pinned_at TEXT, pinned_by TEXT REFERENCES users(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_pings_wave ON pings(wave_id);
CREATE INDEX IF NOT EXISTS idx_pings_author ON pings(author_id);
CREATE INDEX IF NOT EXISTS idx_pings_parent ON pings(parent_id);
CREATE INDEX IF NOT EXISTS idx_pings_created ON pings(wave_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pings_deleted ON pings(deleted);
CREATE INDEX IF NOT EXISTS idx_pings_broken_out ON pings(broken_out_to);
CREATE INDEX IF NOT EXISTS idx_pings_original_wave ON pings(original_wave_id);
CREATE INDEX IF NOT EXISTS idx_pings_bot_id ON pings(bot_id);
CREATE INDEX IF NOT EXISTS idx_pings_video_feed
        ON pings(media_type, created_at DESC)
        WHERE media_type = 'video' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_pings_event_id ON pings(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pings_pinned ON pings(wave_id, pinned_at) WHERE pinned_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ping_read_by (
    ping_id TEXT NOT NULL REFERENCES pings(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    PRIMARY KEY (ping_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ping_read_user ON ping_read_by(user_id);
CREATE INDEX IF NOT EXISTS idx_ping_read_ping ON ping_read_by(ping_id);

CREATE TABLE IF NOT EXISTS ping_history (
    id TEXT PRIMARY KEY,
    ping_id TEXT NOT NULL REFERENCES pings(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    version INTEGER NOT NULL,
    edited_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ping_history_ping ON ping_history(ping_id);

CREATE TABLE IF NOT EXISTS crews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crews_created_by ON crews(created_by);

CREATE TABLE IF NOT EXISTS crew_members (
    crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_crew ON crew_members(crew_id);

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
CREATE INDEX IF NOT EXISTS idx_handle_requests_user ON handle_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_handle_requests_status ON handle_requests(status);

CREATE TABLE IF NOT EXISTS contact_requests (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contact_requests_from ON contact_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_to ON contact_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_status ON contact_requests(status);

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
CREATE INDEX IF NOT EXISTS idx_crew_invitations_crew ON crew_invitations(crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_invitations_inviter ON crew_invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_crew_invitations_invitee ON crew_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_crew_invitations_status ON crew_invitations(status);

CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_at TEXT NOT NULL,
    UNIQUE (user_id, blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_user ON blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_user_id);

CREATE TABLE IF NOT EXISTS mutes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_at TEXT NOT NULL,
    UNIQUE (user_id, muted_user_id)
);
CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes(user_id);
CREATE INDEX IF NOT EXISTS idx_mutes_muted ON mutes(muted_user_id);

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

CREATE TABLE IF NOT EXISTS account_lockouts (
    handle TEXT PRIMARY KEY COLLATE NOCASE,
    failed_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    last_attempt TEXT
);

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

CREATE TABLE IF NOT EXISTS user_encryption_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,              -- Base64 SPKI-encoded ECDH public key
    encrypted_private_key TEXT NOT NULL,   -- Base64 AES-KW encrypted JWK private key
    key_derivation_salt TEXT NOT NULL,     -- Base64 PBKDF2 salt (16 bytes)
    key_version INTEGER DEFAULT 1,         -- Incremented on key rotation
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS wave_encryption_keys (
    id TEXT PRIMARY KEY,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_wave_key TEXT NOT NULL,      -- Base64 encrypted AES-256-GCM key
    sender_public_key TEXT NOT NULL,       -- Base64 SPKI of key used to encrypt
    key_version INTEGER DEFAULT 1,         -- Version of wave key
    created_at TEXT NOT NULL,
    user_key_id TEXT,                      -- Blinded user key id (v2.27.0); also added via migration for pre-existing DBs
    UNIQUE(wave_id, user_id, key_version)
);
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_wave ON wave_encryption_keys(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_user ON wave_encryption_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_version ON wave_encryption_keys(wave_id, key_version);
CREATE INDEX IF NOT EXISTS idx_wave_encryption_keys_user_key ON wave_encryption_keys(user_key_id) WHERE user_key_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wave_key_metadata (
    wave_id TEXT PRIMARY KEY REFERENCES waves(id) ON DELETE CASCADE,
    current_key_version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    last_rotated_at TEXT
);

CREATE TABLE IF NOT EXISTS wave_key_requests (
    id TEXT PRIMARY KEY,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester_public_key TEXT NOT NULL,     -- Requester's new public key to encrypt for
    status TEXT NOT NULL DEFAULT 'pending', -- pending | granted
    created_at TEXT NOT NULL,
    granted_at TEXT,
    granted_by TEXT REFERENCES users(id),
    UNIQUE(wave_id, requester_id)           -- One pending request per wave per user
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wave_key_requests_wave_user ON wave_key_requests(wave_id, requester_id);
CREATE INDEX IF NOT EXISTS idx_wave_key_requests_status ON wave_key_requests(status);

CREATE TABLE IF NOT EXISTS user_recovery_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_private_key TEXT NOT NULL,   -- Private key encrypted with recovery passphrase
    recovery_salt TEXT NOT NULL,           -- Separate salt for recovery key derivation
    hint TEXT,                             -- User-provided hint for recovery passphrase
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encrypted_contacts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_data TEXT NOT NULL,          -- Base64 AES-256-GCM encrypted JSON contact list
    nonce TEXT NOT NULL,                   -- Base64 AES-GCM nonce (12 bytes)
    version INTEGER DEFAULT 1,             -- Incremented on each update for conflict detection
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wave_participants_encrypted (
    wave_id TEXT PRIMARY KEY,
    participant_blob TEXT NOT NULL,        -- AES-256-GCM encrypted JSON array of user IDs
    iv TEXT NOT NULL,                      -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS crew_members_encrypted (
    crew_id TEXT PRIMARY KEY,
    member_blob TEXT NOT NULL,             -- AES-256-GCM encrypted JSON array of user IDs
    iv TEXT NOT NULL,                      -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS wave_user_metadata (
    lookup_key TEXT PRIMARY KEY,              -- HMAC-SHA256(waveId|userId, key)
    encrypted_data TEXT NOT NULL,             -- AES-256-GCM encrypted JSON blob
    iv TEXT NOT NULL,                         -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

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
    group_key TEXT  -- For collapsing similar notifications (code uses group_key; NOT part of the v2.0.0 crews rename)
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
    level TEXT DEFAULT 'all',  -- all, mentions, none
    sound INTEGER DEFAULT 1,
    push INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, wave_id)
);
CREATE INDEX IF NOT EXISTS idx_wave_notification_settings_user ON wave_notification_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_wave_notification_settings_wave ON wave_notification_settings(wave_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    -- Keys stored as JSON: {"p256dh": "...", "auth": "..."}
    keys TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

CREATE TABLE IF NOT EXISTS push_subscriptions_encrypted (
    user_hash TEXT PRIMARY KEY,           -- SHA-256 of user_id (for deduplication)
    subscriptions_blob TEXT NOT NULL,     -- AES-256-GCM encrypted JSON array
    iv TEXT NOT NULL,                     -- Base64 initialization vector (12 bytes)
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS server_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    node_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

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
CREATE INDEX IF NOT EXISTS idx_federation_nodes_status ON federation_nodes(status);
CREATE INDEX IF NOT EXISTS idx_federation_nodes_name ON federation_nodes(node_name);

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
CREATE INDEX IF NOT EXISTS idx_remote_users_node ON remote_users(node_name);
CREATE INDEX IF NOT EXISTS idx_remote_users_handle ON remote_users(node_name, handle);

CREATE TABLE IF NOT EXISTS wave_federation (
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    node_name TEXT NOT NULL,
    status TEXT DEFAULT 'active',  -- active, pending, removed
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (wave_id, node_name)
);
CREATE INDEX IF NOT EXISTS idx_wave_federation_wave ON wave_federation(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_federation_node ON wave_federation(node_name);

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
CREATE INDEX IF NOT EXISTS idx_remote_pings_wave ON remote_pings(wave_id);
CREATE INDEX IF NOT EXISTS idx_remote_pings_origin ON remote_pings(origin_node, origin_wave_id);
CREATE INDEX IF NOT EXISTS idx_remote_pings_author ON remote_pings(author_node, author_id);

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
CREATE INDEX IF NOT EXISTS idx_federation_queue_status ON federation_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_federation_queue_node ON federation_queue(target_node);

CREATE TABLE IF NOT EXISTS federation_inbox_log (
    id TEXT PRIMARY KEY,
    source_node TEXT NOT NULL,
    message_type TEXT NOT NULL,
    received_at TEXT DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT,
    status TEXT DEFAULT 'received'  -- received, processed, rejected
);
CREATE INDEX IF NOT EXISTS idx_federation_inbox_source ON federation_inbox_log(source_node);
CREATE INDEX IF NOT EXISTS idx_federation_inbox_status ON federation_inbox_log(status);

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

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'info',    -- info, warning, critical, celebration
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
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_alerts_priority ON alerts(priority);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON alerts(category);
CREATE INDEX IF NOT EXISTS idx_alerts_scope ON alerts(scope);
CREATE INDEX IF NOT EXISTS idx_alerts_origin ON alerts(origin_node);

CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id TEXT PRIMARY KEY,
    source_node TEXT NOT NULL UNIQUE,         -- Node we're subscribing to
    categories TEXT NOT NULL DEFAULT '[]',    -- JSON array: ["system","emergency"]
    status TEXT NOT NULL DEFAULT 'active',    -- active, paused
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_source ON alert_subscriptions(source_node);
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_status ON alert_subscriptions(status);

CREATE TABLE IF NOT EXISTS alert_subscribers (
    id TEXT PRIMARY KEY,
    subscriber_node TEXT NOT NULL UNIQUE,     -- Node subscribing to us
    categories TEXT NOT NULL DEFAULT '[]',    -- JSON array
    created_at TEXT NOT NULL,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_subscribers_node ON alert_subscribers(subscriber_node);

CREATE TABLE IF NOT EXISTS alert_dismissals (
    alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (alert_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_dismissals_user ON alert_dismissals(user_id);

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

CREATE TABLE IF NOT EXISTS wave_tokens (
    id TEXT PRIMARY KEY,                      -- token-{uuid}
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                       -- Display name shown on posted messages
    token_hash TEXT UNIQUE NOT NULL,          -- SHA-256 hash of plaintext token (never stored plain)
    bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL, -- Backing bot entry for message attribution
    created_at TEXT NOT NULL,
    last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wave_tokens_wave ON wave_tokens(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_tokens_created_by ON wave_tokens(created_by);
CREATE INDEX IF NOT EXISTS idx_wave_tokens_hash ON wave_tokens(token_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS pings_fts USING fts5(
    id UNINDEXED,
    content,
    content='pings',
    content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_date TEXT NOT NULL,
    recurring INTEGER DEFAULT 0,
    category TEXT DEFAULT 'general',
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT
, event_time TEXT, event_end_time TEXT, timezone TEXT, location TEXT, scope TEXT NOT NULL DEFAULT 'server', wave_id TEXT REFERENCES waves(id) ON DELETE CASCADE, rsvp_enabled INTEGER DEFAULT 0, recurrence TEXT, recurrence_end_date TEXT);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_recurring ON events(recurring);
CREATE INDEX IF NOT EXISTS idx_events_scope ON events(scope);
CREATE INDEX IF NOT EXISTS idx_events_wave_id ON events(wave_id);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);

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
CREATE INDEX IF NOT EXISTS idx_custom_themes_creator
        ON custom_themes(creator_id);
CREATE INDEX IF NOT EXISTS idx_custom_themes_public
        ON custom_themes(is_public) WHERE is_public = 1;

CREATE TABLE IF NOT EXISTS custom_theme_installs (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          theme_id TEXT NOT NULL REFERENCES custom_themes(id) ON DELETE CASCADE,
          installed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, theme_id)
        );
CREATE INDEX IF NOT EXISTS idx_custom_theme_installs_user
        ON custom_theme_installs(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_theme_installs_theme
        ON custom_theme_installs(theme_id);

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

CREATE TABLE IF NOT EXISTS event_rsvp (
          id         TEXT PRIMARY KEY,
          event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status     TEXT NOT NULL CHECK(status IN ('going','maybe','not_going')),
          created_at TEXT NOT NULL,
          updated_at TEXT,
          UNIQUE(event_id, user_id)
        );
CREATE INDEX IF NOT EXISTS idx_event_rsvp_event ON event_rsvp(event_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvp_user  ON event_rsvp(user_id);

CREATE TABLE IF NOT EXISTS event_reminder_sent (
          id       TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          window   TEXT NOT NULL,
          sent_at  TEXT NOT NULL,
          UNIQUE(event_id, user_id, window)
        );
CREATE INDEX IF NOT EXISTS idx_reminder_sent_event ON event_reminder_sent(event_id);
CREATE INDEX IF NOT EXISTS idx_reminder_sent_user  ON event_reminder_sent(user_id);

CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT UNIQUE NOT NULL,
          created_at TEXT NOT NULL,
          last_used_at TEXT
        );
CREATE INDEX IF NOT EXISTS idx_cal_feed_user ON calendar_feed_tokens(user_id);

CREATE TABLE IF NOT EXISTS support_tickets (
          id          TEXT PRIMARY KEY,
          email       TEXT,
          handle      TEXT,
          message     TEXT NOT NULL,
          user_agent  TEXT,
          status      TEXT NOT NULL DEFAULT 'open',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT,
          resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
        );
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS incoming_webhooks (
          id          TEXT PRIMARY KEY,
          token       TEXT UNIQUE NOT NULL,
          wave_id     TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          bot_id      TEXT REFERENCES bots(id),
          created_by  TEXT REFERENCES users(id),
          created_at  TEXT NOT NULL,
          last_used_at TEXT
        );
CREATE INDEX IF NOT EXISTS idx_incoming_webhooks_wave ON incoming_webhooks(wave_id);

CREATE TABLE IF NOT EXISTS cross_port_requests (
          id          TEXT PRIMARY KEY,
          guest_node  TEXT NOT NULL,
          guest_base_url TEXT NOT NULL,
          nonce       TEXT NOT NULL UNIQUE,
          status      TEXT NOT NULL DEFAULT 'pending',
          created_at  TEXT NOT NULL,
          expires_at  TEXT NOT NULL
        );
CREATE INDEX IF NOT EXISTS idx_cp_requests_nonce ON cross_port_requests(nonce);

CREATE TABLE IF NOT EXISTS cross_port_codes (
          code        TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          guest_node  TEXT NOT NULL,
          request_id  TEXT NOT NULL,
          nonce       TEXT NOT NULL,
          created_at  TEXT NOT NULL,
          expires_at  TEXT NOT NULL,
          used        INTEGER NOT NULL DEFAULT 0
        );
CREATE INDEX IF NOT EXISTS idx_cp_codes_code ON cross_port_codes(code);

CREATE TABLE IF NOT EXISTS portal_waves (
          wave_id       TEXT PRIMARY KEY REFERENCES waves(id) ON DELETE CASCADE,
          label         TEXT,
          display_order INTEGER NOT NULL DEFAULT 0,
          added_at      TEXT NOT NULL,
          added_by      TEXT REFERENCES users(id)
        , slug TEXT, events_enabled INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_waves_slug
        ON portal_waves(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS instance_config (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          defaults              TEXT NOT NULL DEFAULT '{}',
          notification_defaults TEXT NOT NULL DEFAULT '{}',
          features              TEXT NOT NULL DEFAULT '{}',
          branding              TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
        , security TEXT NOT NULL DEFAULT '{}');

CREATE TABLE IF NOT EXISTS user_invitations (
          id         TEXT PRIMARY KEY,
          token_hash TEXT UNIQUE NOT NULL,
          email      TEXT,
          role       TEXT NOT NULL DEFAULT 'user',
          note       TEXT,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at    TEXT,
          used_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
          revoked_at TEXT
        );
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_invitations_created_by ON user_invitations(created_by);

CREATE TABLE IF NOT EXISTS event_rsvp_guest (
          id              TEXT PRIMARY KEY,
          event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          email_encrypted TEXT,
          email_iv        TEXT,
          email_hash      TEXT NOT NULL,
          guest_count     INTEGER NOT NULL DEFAULT 1,
          status          TEXT NOT NULL DEFAULT 'going' CHECK(status IN ('going','maybe','not_going')),
          cancel_token_hash TEXT UNIQUE,
          created_at      TEXT NOT NULL,
          updated_at      TEXT,
          UNIQUE(event_id, email_hash)
        );
CREATE INDEX IF NOT EXISTS idx_event_rsvp_guest_event ON event_rsvp_guest(event_id);

CREATE TABLE IF NOT EXISTS event_reminder_sent_guest (
          id            TEXT PRIMARY KEY,
          event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          guest_rsvp_id TEXT NOT NULL REFERENCES event_rsvp_guest(id) ON DELETE CASCADE,
          window        TEXT NOT NULL,
          sent_at       TEXT NOT NULL,
          UNIQUE(event_id, guest_rsvp_id, window)
        );
CREATE INDEX IF NOT EXISTS idx_reminder_guest_event ON event_reminder_sent_guest(event_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
          id                  TEXT PRIMARY KEY,
          user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          -- One family per login. Rotation replaces a token within its family;
          -- reuse detection revokes the family, never just the one token.
          family_id           TEXT NOT NULL,
          token_hash          TEXT UNIQUE NOT NULL,
          parent_id           TEXT,
          device_info         TEXT,
          device_label        TEXT,
          ip_address          TEXT,
          created_at          TEXT NOT NULL,
          last_used_at        TEXT,
          -- Sliding: pushed forward on every rotation. This is the idle window.
          expires_at          TEXT NOT NULL,
          -- Hard ceiling for the family, NULL when the operator sets no cap.
          absolute_expires_at TEXT,
          -- Set when redeemed. A token with used_at that is presented again is
          -- the theft signal.
          used_at             TEXT,
          revoked_at          TEXT,
          revoked_reason      TEXT
        );
CREATE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS known_devices (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_hash  TEXT NOT NULL,
          device_label TEXT,
          first_seen   TEXT NOT NULL,
          last_seen    TEXT NOT NULL,
          UNIQUE(user_id, device_hash)
        );
CREATE INDEX IF NOT EXISTS idx_known_devices_user ON known_devices(user_id);

-- ============ Full-text search triggers ============
CREATE TRIGGER IF NOT EXISTS pings_fts_insert AFTER INSERT ON pings BEGIN
    INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS pings_fts_delete AFTER DELETE ON pings BEGIN
    INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
END;

CREATE TRIGGER IF NOT EXISTS pings_fts_update AFTER UPDATE ON pings BEGIN
    INSERT INTO pings_fts(pings_fts, rowid, id, content) VALUES ('delete', OLD.rowid, OLD.id, OLD.content);
    INSERT INTO pings_fts(rowid, id, content) VALUES (NEW.rowid, NEW.id, NEW.content);
END;
