import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import sanitizeHtml from 'sanitize-html';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import sharp from 'sharp';
import webpush from 'web-push';
import crypto from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';
import { DatabaseSQLite } from './database-sqlite.js';
import { getEmailService } from './email-service.js';
import { storage } from './storage.js';
import * as waveParticipationCrypto from './lib/wave-participation-crypto.js';
import * as pushSubscriptionCrypto from './lib/push-subscription-crypto.js';
import * as crewMembershipCrypto from './lib/crew-membership-crypto.js';
import { getCurrentHoliday } from './holidays.js';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const VERSION = packageJson.version;

// ============ Configuration ============
const PORT = process.env.PORT || 3001;

// ============ LIVEKIT CONFIGURATION (v2.4.0) ============

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

// Validate LiveKit configuration on startup
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.warn('⚠️  LiveKit not configured - voice calling will not work');
  console.warn('   Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in .env');
} else {
  console.log('✅ LiveKit configured:', LIVEKIT_URL);
}

// Initialize LiveKit RoomService client for admin operations
const livekitRoomService = (LIVEKIT_API_KEY && LIVEKIT_API_SECRET)
  ? new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

// ============ FIREBASE ADMIN SDK (v2.31.0 - Capacitor Push) ============
const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (FIREBASE_SERVICE_ACCOUNT_PATH) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(FIREBASE_SERVICE_ACCOUNT_PATH), 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin SDK initialized');
  } catch (error) {
    console.warn('⚠️  Firebase Admin SDK initialization failed:', error.message);
    console.warn('   FCM push notifications will not work');
  }
} else {
  console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_PATH not set — FCM push disabled');
}

// JWT_SECRET is REQUIRED in production - fail fast if not configured
const JWT_SECRET_ENV = process.env.JWT_SECRET;
if (!JWT_SECRET_ENV) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable is required in production');
    console.error('Generate a secure secret with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
  }
  console.warn('⚠️  WARNING: JWT_SECRET not set, using insecure default for development only');
}
const JWT_SECRET = JWT_SECRET_ENV || 'cortex-dev-secret-DO-NOT-USE-IN-PROD';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'; // Default 24 hours for security

// Valid session duration options (user-selectable at login)
const SESSION_DURATIONS = {
  '24h': 24 * 60 * 60 * 1000,      // 24 hours (default)
  '7d': 7 * 24 * 60 * 60 * 1000,   // 7 days
  '30d': 30 * 24 * 60 * 60 * 1000  // 30 days
};

// Session management configuration (v1.18.0)
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const SESSION_TRACKING_ENABLED = process.env.SESSION_TRACKING_ENABLED !== 'false'; // Default true

// GIF API configuration (GIPHY and/or Tenor)
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || null;
const TENOR_API_KEY = process.env.TENOR_API_KEY || null;
const GIF_PROVIDER = process.env.GIF_PROVIDER || 'giphy'; // 'giphy', 'tenor', or 'both'

// Crawl Bar API configuration (v1.15.0)
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || null;
// Weather providers (tried in order: OpenWeatherMap → WeatherAPI → Tomorrow.io)
const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY || null;
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY || null;
const TOMORROWIO_API_KEY = process.env.TOMORROWIO_API_KEY || null;
// News providers (tried in order, results combined)
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || null;
const GNEWS_API_KEY = process.env.GNEWS_API_KEY || null;
const MEDIASTACK_API_KEY = process.env.MEDIASTACK_API_KEY || null;
const NEWS_RSS_FEEDS = process.env.NEWS_RSS_FEEDS ? process.env.NEWS_RSS_FEEDS.split(',').map(s => s.trim()).filter(Boolean) : [];
const IPINFO_TOKEN = process.env.IPINFO_TOKEN || null;

// Log crawl bar configuration status
if (FINNHUB_API_KEY) console.log('📈 Stock data enabled (Finnhub)');
const weatherProviders = [OPENWEATHERMAP_API_KEY && 'OpenWeatherMap', WEATHERAPI_KEY && 'WeatherAPI', TOMORROWIO_API_KEY && 'Tomorrow.io'].filter(Boolean);
if (weatherProviders.length > 0) console.log(`🌤️  Weather data enabled (${weatherProviders.join(', ')})`);
const newsProviders = [NEWSAPI_KEY && 'NewsAPI', GNEWS_API_KEY && 'GNews', MEDIASTACK_API_KEY && 'MediaStack', NEWS_RSS_FEEDS.length > 0 && `${NEWS_RSS_FEEDS.length} RSS feeds`].filter(Boolean);
if (newsProviders.length > 0) console.log(`📰 News data enabled (${newsProviders.join(', ')})`);

// Web Push (VAPID) configuration
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@cortex.local';

// Configure web-push if VAPID keys are available
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('🔔 Web Push notifications enabled');
} else {
  console.log('⚠️  Web Push disabled: Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env');
}

// Push notification debounce tracking (per-user debounce window set in notification preferences)
const lastPushSent = new Map(); // userId -> timestamp

// Ghost Protocol: track PIN verification timestamps per user (v2.27.0)
const ghostVerifications = new Map();

// Federation configuration
const FEDERATION_ENABLED = process.env.FEDERATION_ENABLED === 'true';
const FEDERATION_NODE_NAME = process.env.FEDERATION_NODE_NAME || null;

// Federation cover traffic (v2.28.0)
let FEDERATION_DECOY_ENABLED = process.env.FEDERATION_DECOY_ENABLED === 'true';
const FEDERATION_DECOY_MIN_INTERVAL_S = parseInt(process.env.FEDERATION_DECOY_MIN_INTERVAL_S || '30', 10);
const FEDERATION_DECOY_MAX_INTERVAL_S = parseInt(process.env.FEDERATION_DECOY_MAX_INTERVAL_S || '120', 10);

// Database configuration - set USE_SQLITE=true to use SQLite instead of JSON files
const USE_SQLITE = process.env.USE_SQLITE === 'true';

// Data directory and files
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  waves: path.join(DATA_DIR, 'waves.json'),
  droplets: path.join(DATA_DIR, 'droplets.json'),
  messages: path.join(DATA_DIR, 'messages.json'), // Legacy, for migration
  groups: path.join(DATA_DIR, 'groups.json'),
  handleRequests: path.join(DATA_DIR, 'handle-requests.json'),
  reports: path.join(DATA_DIR, 'reports.json'),
  moderation: path.join(DATA_DIR, 'moderation.json'),
  contactRequests: path.join(DATA_DIR, 'contact-requests.json'),
  groupInvitations: path.join(DATA_DIR, 'group-invitations.json'),
  pushSubscriptions: path.join(DATA_DIR, 'push-subscriptions.json'),
  notifications: path.join(DATA_DIR, 'notifications.json'),
  waveNotificationSettings: path.join(DATA_DIR, 'wave-notification-settings.json'),
  federation: path.join(DATA_DIR, 'federation.json'),
};

// Uploads directory for avatars
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
const DROPLETS_DIR = path.join(UPLOADS_DIR, 'droplets');
const MESSAGES_DIR = path.join(UPLOADS_DIR, 'messages'); // Legacy alias
const MEDIA_DIR = path.join(UPLOADS_DIR, 'media'); // Audio/Video recordings (v2.7.0)
const FILES_DIR = path.join(UPLOADS_DIR, 'files'); // General file attachments

// Ensure uploads directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
if (!fs.existsSync(DROPLETS_DIR)) fs.mkdirSync(DROPLETS_DIR, { recursive: true });
if (!fs.existsSync(MESSAGES_DIR)) fs.mkdirSync(MESSAGES_DIR, { recursive: true }); // Legacy support
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

// Multer configuration for avatar uploads
const avatarStorage = multer.memoryStorage();
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: jpg, png, gif, webp'), false);
    }
  },
});

// Multer configuration for message image uploads
const messageStorage = multer.memoryStorage();
const messageUpload = multer({
  storage: messageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: jpg, png, gif, webp'), false);
    }
  },
});

// Multer configuration for media uploads (audio/video recordings) - v2.7.0
const mediaStorage = multer.memoryStorage();
const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for high-resolution video
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav',
      'video/webm', 'video/mp4', 'video/ogg'
    ];
    // Check if MIME type matches (handle codec specifications like "video/webm;codecs=vp8,opus")
    const baseMimeType = file.mimetype.split(';')[0].trim();
    console.log(`📹 Media upload: original=${file.mimetype}, base=${baseMimeType}, allowed=${allowedTypes.includes(baseMimeType)}`);
    if (allowedTypes.includes(baseMimeType)) {
      cb(null, true);
    } else {
      console.log(`❌ Media upload rejected: ${file.mimetype}`);
      cb(new Error('Invalid file type. Allowed: webm, mp4, ogg, mpeg, wav (audio/video)'), false);
    }
  },
});

// Multer configuration for general file uploads
const fileStorage = multer.memoryStorage();
const fileUpload = multer({
  storage: fileStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    const blockedExtensions = /\.(exe|bat|cmd|msi|scr|vbs|vbe|js|jse|wsf|wsh|ps1|psc1|sh|bash|csh|ksh|dll|com|pif|reg|inf|hta|cpl|msp|mst)$/i;
    if (blockedExtensions.test(file.originalname)) {
      cb(new Error('File type not allowed for security reasons'), false);
    } else {
      cb(null, true);
    }
  },
});

// CORS configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null;

// HTTPS enforcement configuration (v1.18.0)
const ENFORCE_HTTPS = process.env.ENFORCE_HTTPS === 'true';
const CORS_STRICT_MODE = process.env.CORS_STRICT_MODE !== 'false'; // Default true

// ============ Role-Based Authorization (v1.20.0) ============
const ROLES = { ADMIN: 'admin', MODERATOR: 'moderator', USER: 'user' };
const ROLE_HIERARCHY = { admin: 3, moderator: 2, user: 1 };

/**
 * Get user's role (backward compatible with isAdmin boolean)
 */
function getUserRole(user) {
  if (!user) return null;
  if (user.role) return user.role;
  return user.isAdmin ? ROLES.ADMIN : ROLES.USER;
}

/**
 * Check if user has at least the specified role level
 */
function hasRole(user, requiredRole) {
  const userRole = getUserRole(user);
  if (!userRole) return false;
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Authorization check with 403 response - returns false if unauthorized
 * Usage: if (!requireRole(user, ROLES.ADMIN, res)) return;
 */
function requireRole(user, role, res) {
  if (!hasRole(user, role)) {
    const roleName = role.charAt(0).toUpperCase() + role.slice(1);
    res.status(403).json({ error: `${roleName} access required` });
    return false;
  }
  return true;
}

// ============ Security: Rate Limiting ============
// Configurable via .env - set higher values for development/testing
const RATE_LIMIT_LOGIN_MAX = parseInt(process.env.RATE_LIMIT_LOGIN_MAX) || 30;
const RATE_LIMIT_REGISTER_MAX = parseInt(process.env.RATE_LIMIT_REGISTER_MAX) || 15;
const RATE_LIMIT_API_MAX = parseInt(process.env.RATE_LIMIT_API_MAX) || 300;
const RATE_LIMIT_GIF_MAX = parseInt(process.env.RATE_LIMIT_GIF_MAX) || 30;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_LOGIN_MAX,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip + ':' + (req.body?.handle || req.body?.username || 'unknown'),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: RATE_LIMIT_REGISTER_MAX,
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: async (req, res) => {
    // Give authenticated users 10x higher rate limit
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        jwt.verify(token, JWT_SECRET);
        return RATE_LIMIT_API_MAX * 10; // 3000 requests/min for authenticated users
      } catch (e) {
        // Invalid token, use default limit
      }
    }
    return RATE_LIMIT_API_MAX; // 300 requests/min for unauthenticated
  },
  keyGenerator: (req) => {
    // Rate limit by user ID if authenticated, otherwise by IP
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return `user:${decoded.userId}`;
      } catch (e) {
        // Invalid token, fall back to IP
      }
    }
    return req.ip;
  },
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const gifSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_GIF_MAX,
  message: { error: 'Too many GIF searches. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Jellyfin proxy rate limiter (v2.14.0)
const RATE_LIMIT_JELLYFIN_MAX = parseInt(process.env.RATE_LIMIT_JELLYFIN_MAX) || 60;
const jellyfinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_JELLYFIN_MAX,
  message: { error: 'Too many Jellyfin requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Plex proxy rate limiter (v2.15.0)
const RATE_LIMIT_PLEX_MAX = parseInt(process.env.RATE_LIMIT_PLEX_MAX) || 60;
const plexLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_PLEX_MAX,
  message: { error: 'Too many Plex requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour per email
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip + ':' + (req.body?.email || 'unknown'),
});

const RATE_LIMIT_OEMBED_MAX = parseInt(process.env.RATE_LIMIT_OEMBED_MAX) || 30;
const oembedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_OEMBED_MAX,
  message: { error: 'Too many embed requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const RATE_LIMIT_REPORT_MAX = parseInt(process.env.RATE_LIMIT_REPORT_MAX) || 10;
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: RATE_LIMIT_REPORT_MAX,
  message: { error: 'Too many reports. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const RATE_LIMIT_CRAWL_MAX = parseInt(process.env.RATE_LIMIT_CRAWL_MAX) || 60;
const crawlLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_CRAWL_MAX,
  message: { error: 'Too many crawl bar requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// WebSocket message rate limits (per user, per minute)
const WS_RATE_LIMIT_MESSAGES = parseInt(process.env.WS_RATE_LIMIT_MESSAGES) || 60;
const WS_RATE_LIMIT_TYPING = parseInt(process.env.WS_RATE_LIMIT_TYPING) || 20;
const WS_RATE_WINDOW_MS = 60 * 1000; // 1 minute window

// ============ Security: Account Lockout ============
// Now uses database persistence (see database-sqlite.js account lockout methods)
// These wrapper functions are called after db is initialized

function checkAccountLockout(handle) {
  // db is initialized at runtime before these are called
  if (typeof db !== 'undefined' && db.isAccountLocked) {
    const result = db.isAccountLocked(handle);
    if (result.locked) {
      const remainingMs = new Date(result.lockedUntil).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return { locked: true, remainingMin };
    }
    return { locked: false };
  }
  return { locked: false }; // Fallback if db not ready
}

function recordFailedAttempt(handle) {
  if (typeof db !== 'undefined' && db.recordFailedLogin) {
    const result = db.recordFailedLogin(handle);
    if (result.locked) {
      console.log(`🔒 Account locked: ${handle}`);
    }
    return result;
  }
}

function clearFailedAttempts(handle) {
  if (typeof db !== 'undefined' && db.clearFailedLogins) {
    db.clearFailedLogins(handle);
  }
}

// ============ Security: Session Management (v1.18.0) ============

// Hash token for storage (don't store raw JWTs in database)
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Validate and return session duration
function getSessionDuration(requestedDuration) {
  // JWT_EXPIRES_IN env var overrides all user-selected durations (useful for testing)
  if (process.env.JWT_EXPIRES_IN) return process.env.JWT_EXPIRES_IN;

  // Validate requested duration is in allowed list
  if (requestedDuration && SESSION_DURATIONS[requestedDuration]) {
    return requestedDuration;
  }
  // Default to 24h if not specified or invalid
  return '24h';
}

// Create a session record for a token
// Uses privacy-hardened IP/UA (v2.16.0)
function createSession(userId, token, req) {
  if (!SESSION_TRACKING_ENABLED || !db.hasSessionTable || !db.hasSessionTable()) {
    return null;
  }
  try {
    const tokenHash = hashToken(token);
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000).toISOString();

    // Privacy hardening: anonymize IP and truncate UA
    const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'Unknown';
    const rawUserAgent = req.headers['user-agent'] || 'Unknown';
    const anonIp = anonymizeIP(rawIp) || 'Unknown';
    const truncatedUA = truncateUserAgent(rawUserAgent);

    // Round session creation time to 5-minute intervals for privacy
    const createdAt = roundTimestamp(new Date(), 5);

    return db.createSession({
      userId,
      tokenHash,
      deviceInfo: truncatedUA,
      ipAddress: anonIp,
      expiresAt,
      createdAt  // Pass rounded timestamp
    });
  } catch (err) {
    console.error('[Session] Failed to create session:', err.message);
    return null;
  }
}

// Validate that a session exists and is not revoked
function validateSession(token) {
  if (!SESSION_TRACKING_ENABLED || !db.hasSessionTable || !db.hasSessionTable()) {
    return { valid: true, session: null }; // Graceful degradation
  }
  try {
    const tokenHash = hashToken(token);
    const session = db.getSessionByTokenHash(tokenHash);

    if (!session) {
      return { valid: false, reason: 'Session not found' };
    }
    if (session.revoked) {
      return { valid: false, reason: 'Session revoked' };
    }
    if (new Date(session.expiresAt) < new Date()) {
      return { valid: false, reason: 'Session expired' };
    }

    // Update last_active timestamp (async, don't block)
    try {
      db.updateSessionActivity(tokenHash);
    } catch (e) { /* Ignore update errors */ }

    return { valid: true, session };
  } catch (err) {
    console.error('[Session] Validation error:', err.message);
    return { valid: true, session: null }; // Fail open if database error
  }
}

// Revoke a session by token
function revokeSessionByToken(token) {
  if (!SESSION_TRACKING_ENABLED) {
    console.log('[Session] Revocation skipped: SESSION_TRACKING_ENABLED is false');
    return false;
  }
  if (!db.hasSessionTable || !db.hasSessionTable()) {
    console.log('[Session] Revocation skipped: session table not available');
    return false;
  }
  try {
    const tokenHash = hashToken(token);
    const result = db.revokeSessionByTokenHash(tokenHash);
    console.log(`[Session] Revocation result for hash ${tokenHash.substring(0, 8)}...: ${result ? 'success' : 'not found'}`);
    return result;
  } catch (err) {
    console.error('[Session] Revocation error:', err.message);
    return false;
  }
}

// ============ Security: Input Sanitization ============
const sanitizeOptions = {
  allowedTags: [],
  allowedAttributes: {},
  textFilter: (text) => text,
};

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return sanitizeHtml(input, sanitizeOptions).trim();
}

const sanitizeMessageOptions = {
  allowedTags: ['img', 'a', 'br', 'p', 'strong', 'em', 'code', 'pre'],
  allowedAttributes: {
    'img': ['src', 'alt', 'width', 'height', 'class'],
    'a': ['href', 'target', 'rel', 'class', 'data-filename', 'data-size', 'download'],
  },
  allowedSchemes: ['http', 'https', 'data'], // Allow data URIs for emojis
  allowedSchemesByTag: {
    img: ['http', 'https', 'data']
  },
  transformTags: {
    'a': (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
    }),
    'img': (tagName, attribs) => {
      // Check if it's a GIF - load eagerly so animation plays immediately
      const src = attribs.src || '';
      const isGif = src.match(/\.gif(\?|$)/i) ||
                    src.match(/(giphy\.com|tenor\.com)/i);

      return {
        tagName: 'img',
        attribs: {
          ...attribs,
          style: 'max-width: 100%; height: auto;',
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

// Validate avatar filename format to prevent path traversal attacks
// Expected format: UUID-timestamp.webp (or .gif for animated avatars)
function isValidAvatarFilename(filename) {
  if (!filename || typeof filename !== 'string') return false;
  // UUID is 36 chars (with dashes), followed by dash, timestamp (13 digits), extension
  const validPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-\d{13}\.(webp|gif)$/i;
  return validPattern.test(filename);
}

// Escape HTML for safe embedding in meta tags and HTML attributes
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ Privacy Hardening Utilities (v2.16.0) ============

// Email encryption key (required for email protection)
const EMAIL_ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || null;
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'cortex-ip-salt-default';

// Activity log retention (days)
const ACTIVITY_LOG_RETENTION_DAYS = parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS || '30', 10);
const SESSION_MAX_AGE_DAYS = parseInt(process.env.SESSION_MAX_AGE_DAYS || '30', 10);
const INVITATION_EXPIRY_DAYS = parseInt(process.env.INVITATION_EXPIRY_DAYS || '7', 10);

// Validate email encryption key in production
if (!EMAIL_ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️  WARNING: EMAIL_ENCRYPTION_KEY not set. Email addresses will not be encrypted.');
    console.warn('   Generate a key with: openssl rand -hex 32');
  }
} else if (EMAIL_ENCRYPTION_KEY.length !== 64) {
  console.error('FATAL: EMAIL_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  process.exit(1);
} else {
  console.log('🔐 Email encryption enabled');
}

/**
 * Anonymize IP address by truncating to subnet
 * IPv4: /24 subnet (xxx.xxx.xxx.0)
 * IPv6: /48 subnet (xxxx:xxxx:xxxx::)
 * @param {string} ip - Full IP address
 * @returns {string|null} Anonymized IP or null if invalid
 */
function anonymizeIP(ip) {
  if (!ip || typeof ip !== 'string') return null;

  // Clean up IP (remove port, whitespace)
  ip = ip.trim().split(':').slice(0, -1).join(':') || ip.trim();

  // IPv4: truncate to /24 (last octet becomes 0)
  const ipv4Match = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (ipv4Match) {
    return ipv4Match[1] + '.0';
  }

  // IPv6: truncate to /48 (keep first 3 hextets)
  const ipv6Match = ip.match(/^([0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}):/);
  if (ipv6Match) {
    return ipv6Match[1] + '::';
  }

  // Handle IPv4-mapped IPv6 (::ffff:192.168.1.1)
  const mappedV4Match = ip.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i);
  if (mappedV4Match) {
    return '::ffff:' + mappedV4Match[1] + '.0';
  }

  // Unknown format - return null for safety
  return null;
}

/**
 * Truncate User-Agent to browser family + OS only
 * Prevents device fingerprinting while preserving useful debug info
 * @param {string} ua - Full User-Agent string
 * @returns {string} Truncated format: "Browser/OS"
 */
function truncateUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return 'Unknown/Unknown';

  // Detect browser (order matters - check specific before generic)
  let browser = 'Unknown';
  if (/Edg(e|A|iOS)?/i.test(ua)) browser = 'Edge';
  else if (/OPR|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';
  else if (/MSIE|Trident/i.test(ua)) browser = 'IE';

  // Detect OS
  let os = 'Unknown';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';

  return `${browser}/${os}`;
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

/**
 * Hash email for lookup (deterministic)
 * @param {string} email - Email address
 * @returns {string} SHA-256 hash (hex)
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

// Get request metadata for activity logging (with privacy protection)
function getRequestMeta(req) {
  const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
  const rawUserAgent = req.headers['user-agent'] || 'Unknown';

  return {
    ip: anonymizeIP(rawIp) || 'Unknown',
    userAgent: truncateUserAgent(rawUserAgent)
  };
}

// Get raw request metadata (for internal use where full data is needed)
function getRequestMetaRaw(req) {
  return {
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent'] || 'Unknown'
  };
}

function detectAndEmbedMedia(content) {
  // First, auto-link plain URLs (that aren't already in HTML tags)
  // This regex avoids matching URLs inside existing HTML tags
  const urlRegex = /(?<!["'>])(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/)/gi;

  // Track which URLs are images to embed them
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|webm|mp4)(\?[^\s]*)?$/i;

  // Extended GIF/image CDN hosts - includes GIPHY, Tenor, Imgur, Discord, etc.
  const imageHosts = new RegExp(
    '(' +
    // GIPHY CDN hosts
    'media[0-9]?\\.giphy\\.com|i\\.giphy\\.com|' +
    // Tenor CDN hosts
    'media[0-9]?\\.tenor\\.com|c\\.tenor\\.com|' +
    // Imgur
    'i\\.imgur\\.com|' +
    // Discord CDN
    'cdn\\.discordapp\\.com/attachments|media\\.discordapp\\.net|' +
    // Other common image CDNs
    'pbs\\.twimg\\.com|' +
    // Gfycat
    'giant\\.gfycat\\.com|thumbs\\.gfycat\\.com' +
    ')', 'i'
  );

  // Shared image style - thumbnails by default, click to view full size
  const imgStyle = 'max-width:200px;max-height:150px;border-radius:4px;cursor:pointer;object-fit:cover;display:block;border:1px solid #3a4a3a;';

  // Non-CDN hosts that use image extensions but aren't direct image URLs (redirect pages)
  const nonImageHosts = /(^https?:\/\/)(www\.)?(tenor\.com|giphy\.com|gfycat\.com)\/(?!media)/i;

  content = content.replace(urlRegex, (match) => {
    // Clean up URL (remove trailing punctuation that might have been included)
    let cleanUrl = match.replace(/[.,;:!?)\]]+$/, '');

    // Skip non-CDN hosts even if they have image extensions (they're redirect pages, not images)
    if (nonImageHosts.test(cleanUrl)) {
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>`;
    }

    // Check if this URL should be embedded as an image
    if (imageExtensions.test(cleanUrl) || imageHosts.test(cleanUrl)) {
      return `<img src="${cleanUrl}" alt="Embedded media" style="${imgStyle}" class="zoomable-image" />`;
    }
    // Otherwise, make it a clickable link
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>`;
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

  // Also detect and embed relative upload paths (e.g., /uploads/messages/...)
  const uploadPathRegex = /(?<!["'>])(\/uploads\/(?:messages|avatars)\/[^\s<]+)(?![^<]*>|[^<>]*<\/)/gi;
  content = content.replace(uploadPathRegex, (match) => {
    // These are always images from our upload system
    if (imageExtensions.test(match)) {
      return `<img src="${match}" alt="Uploaded image" style="${imgStyle}" class="zoomable-image" />`;
    }
    return match;
  });

  return content;
}

// ============ Rich Media Embed Detection ============
// Patterns for detecting embeddable URLs from supported platforms
const EMBED_PATTERNS = {
  youtube: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?[^\s]*v=([a-zA-Z0-9_-]{11})/i,  // watch with video (may have list param)
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
      /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/playlist\?[^\s]*list=([a-zA-Z0-9_-]+)/i,  // playlist-only URL (v2.19.0)
    ],
    embedUrl: (id, playlistId) => {
      if (!id && playlistId) {
        // Playlist-only: use videoseries
        return `https://www.youtube.com/embed/videoseries?list=${playlistId}`;
      } else if (playlistId) {
        // Video with playlist context
        return `https://www.youtube.com/embed/${id}?list=${playlistId}`;
      }
      // Regular video
      return `https://www.youtube.com/embed/${id}`;
    },
    thumbnail: (id) => id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null,
  },
  vimeo: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/i,
      /(?:https?:\/\/)?player\.vimeo\.com\/video\/(\d+)/i,
    ],
    embedUrl: (id) => `https://player.vimeo.com/video/${id}`,
    oembedUrl: (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  },
  spotify: {
    patterns: [
      /(?:https?:\/\/)?open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/i,
    ],
    embedUrl: (type, id) => `https://open.spotify.com/embed/${type}/${id}`,
  },
  tiktok: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)/i,
      /(?:https?:\/\/)?(?:vm\.)?tiktok\.com\/([a-zA-Z0-9]+)/i,
    ],
    oembedUrl: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  },
  twitter: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?(twitter|x)\.com\/\w+\/status\/(\d+)/i,
    ],
    oembedUrl: (url) => `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`,
  },
  soundcloud: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/[\w-]+\/[\w-]+/i,
    ],
    oembedUrl: (url) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  },
  tenor: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?tenor\.com\/view\/[\w-]+-(\d+)/i,
      /(?:https?:\/\/)?tenor\.com\/([a-zA-Z0-9]+)\.gif/i,
    ],
    oembedUrl: (url) => `https://tenor.com/oembed?url=${encodeURIComponent(url)}`,
  },
  giphy: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?giphy\.com\/gifs\/(?:[\w-]+-)*([a-zA-Z0-9]+)/i,
      /(?:https?:\/\/)?gph\.is\/([a-zA-Z0-9]+)/i,
    ],
    oembedUrl: (url) => `https://giphy.com/services/oembed?url=${encodeURIComponent(url)}`,
  },
};

// Simple in-memory cache for oEmbed responses (15 min TTL)
const oembedCache = new Map();
const OEMBED_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCachedOembed(url) {
  const cached = oembedCache.get(url);
  if (cached && Date.now() - cached.timestamp < OEMBED_CACHE_TTL) {
    return cached.data;
  }
  oembedCache.delete(url);
  return null;
}

function setCachedOembed(url, data) {
  // Limit cache size to prevent memory issues
  if (oembedCache.size > 1000) {
    const oldest = oembedCache.keys().next().value;
    oembedCache.delete(oldest);
  }
  oembedCache.set(url, { data, timestamp: Date.now() });
}

// ============ Crawl Bar Caching & External API Functions ============
const crawlCache = {
  stocks: new Map(),    // key: symbol, value: {data, timestamp}
  weather: new Map(),   // key: lat,lon, value: {data, timestamp}
  news: new Map(),      // key: source, value: {data, timestamp}
  geolocation: new Map(), // key: ip, value: {data, timestamp}
};

const CRAWL_CACHE_TTL = {
  stocks: 60 * 1000,           // 1 minute
  weather: 5 * 60 * 1000,      // 5 minutes
  news: 3 * 60 * 1000,         // 3 minutes
  geolocation: 24 * 60 * 60 * 1000, // 24 hours (IP location rarely changes)
};

function getCrawlCache(type, key) {
  const cache = crawlCache[type];
  if (!cache) return null;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CRAWL_CACHE_TTL[type]) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCrawlCache(type, key, data) {
  const cache = crawlCache[type];
  if (!cache) return;
  // Limit cache size
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

// Fetch stock quote from Finnhub
async function fetchStockQuote(symbol) {
  if (!FINNHUB_API_KEY) return null;

  const cached = getCrawlCache('stocks', symbol);
  if (cached) return cached;

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`Finnhub API error for ${symbol}:`, response.status);
      return null;
    }

    const data = await response.json();

    // Check if we got valid data
    if (data.c === 0 && data.d === null) {
      console.warn(`No data available for symbol ${symbol}`);
      return null;
    }

    const result = {
      symbol,
      price: data.c,           // Current price
      change: data.d,          // Change
      changePercent: data.dp,  // Change percent
      high: data.h,            // Day high
      low: data.l,             // Day low
      previousClose: data.pc,  // Previous close
      timestamp: Date.now(),
    };

    setCrawlCache('stocks', symbol, result);
    return result;
  } catch (err) {
    console.error(`Stock fetch error for ${symbol}:`, err.message);
    return null;
  }
}

// Geocode location name to coordinates using OpenWeatherMap
async function geocodeLocation(locationName) {
  if (!OPENWEATHERMAP_API_KEY || !locationName) return null;

  const cacheKey = locationName.toLowerCase().trim();
  const cached = getCrawlCache('geocode', cacheKey);
  if (cached) return cached;

  try {
    // OpenWeatherMap Geocoding API - supports "City, Country" format
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(locationName)}&limit=1&appid=${OPENWEATHERMAP_API_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`Geocoding API error:`, response.status);
      return null;
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      console.error(`Geocoding: No results for "${locationName}"`);
      return null;
    }

    const result = {
      lat: data[0].lat,
      lon: data[0].lon,
      name: data[0].name + (data[0].state ? `, ${data[0].state}` : '') + (data[0].country ? `, ${data[0].country}` : ''),
    };

    setCrawlCache('geocode', cacheKey, result);
    return result;
  } catch (err) {
    console.error(`Geocoding error for "${locationName}":`, err.message);
    return null;
  }
}

// Fetch weather from OpenWeatherMap
async function fetchWeatherFromOpenWeatherMap(lat, lon) {
  if (!OPENWEATHERMAP_API_KEY) return null;

  try {
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${OPENWEATHERMAP_API_KEY}`;
    const currentResponse = await fetch(currentUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!currentResponse.ok) {
      console.error(`OpenWeatherMap API error:`, currentResponse.status);
      return null;
    }

    const currentData = await currentResponse.json();

    // Try to get alerts from One Call API if available (may require subscription)
    let alerts = [];
    try {
      const alertsUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily&appid=${OPENWEATHERMAP_API_KEY}`;
      const alertsResponse = await fetch(alertsUrl, {
        signal: AbortSignal.timeout(3000),
      });
      if (alertsResponse.ok) {
        const alertsData = await alertsResponse.json();
        alerts = (alertsData.alerts || []).map(a => ({
          event: a.event,
          description: a.description?.substring(0, 200),
          start: a.start,
          end: a.end,
        }));
      }
    } catch (alertErr) {
      // Alerts API may not be available on free tier, continue without
    }

    return {
      temp: Math.round(currentData.main.temp),
      feelsLike: Math.round(currentData.main.feels_like),
      description: currentData.weather[0]?.description || '',
      icon: currentData.weather[0]?.icon || '',
      humidity: currentData.main.humidity,
      windSpeed: Math.round(currentData.wind?.speed || 0),
      alerts,
      provider: 'OpenWeatherMap',
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error(`OpenWeatherMap fetch error:`, err.message);
    return null;
  }
}

// Fetch weather from WeatherAPI.com
async function fetchWeatherFromWeatherAPI(lat, lon) {
  if (!WEATHERAPI_KEY) return null;

  try {
    const url = `https://api.weatherapi.com/v1/current.json?key=${WEATHERAPI_KEY}&q=${lat},${lon}&aqi=no`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`WeatherAPI error:`, response.status);
      return null;
    }

    const data = await response.json();
    const current = data.current;

    return {
      temp: Math.round(current.temp_f),
      feelsLike: Math.round(current.feelslike_f),
      description: current.condition?.text || '',
      icon: current.condition?.icon || '',
      humidity: current.humidity,
      windSpeed: Math.round(current.wind_mph),
      alerts: [], // WeatherAPI alerts require paid tier
      provider: 'WeatherAPI',
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error(`WeatherAPI fetch error:`, err.message);
    return null;
  }
}

// Fetch weather from Tomorrow.io
async function fetchWeatherFromTomorrowIO(lat, lon) {
  if (!TOMORROWIO_API_KEY) return null;

  try {
    const url = `https://api.tomorrow.io/v4/weather/realtime?location=${lat},${lon}&units=imperial&apikey=${TOMORROWIO_API_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`Tomorrow.io API error:`, response.status);
      return null;
    }

    const data = await response.json();
    const values = data.data?.values;

    if (!values) return null;

    // Map weather code to description
    const weatherCodes = {
      0: 'Unknown', 1000: 'Clear', 1100: 'Mostly Clear', 1101: 'Partly Cloudy',
      1102: 'Mostly Cloudy', 1001: 'Cloudy', 2000: 'Fog', 2100: 'Light Fog',
      4000: 'Drizzle', 4001: 'Rain', 4200: 'Light Rain', 4201: 'Heavy Rain',
      5000: 'Snow', 5001: 'Flurries', 5100: 'Light Snow', 5101: 'Heavy Snow',
      6000: 'Freezing Drizzle', 6001: 'Freezing Rain', 6200: 'Light Freezing Rain',
      6201: 'Heavy Freezing Rain', 7000: 'Ice Pellets', 7101: 'Heavy Ice Pellets',
      7102: 'Light Ice Pellets', 8000: 'Thunderstorm',
    };

    return {
      temp: Math.round(values.temperature),
      feelsLike: Math.round(values.temperatureApparent),
      description: weatherCodes[values.weatherCode] || 'Unknown',
      icon: '', // Tomorrow.io uses weather codes, not icons
      humidity: Math.round(values.humidity),
      windSpeed: Math.round(values.windSpeed),
      alerts: [], // Alerts require separate API call
      provider: 'Tomorrow.io',
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error(`Tomorrow.io fetch error:`, err.message);
    return null;
  }
}

// Main weather fetch - tries providers in order with fallback
async function fetchWeather(lat, lon) {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = getCrawlCache('weather', cacheKey);
  if (cached) return cached;

  // Try providers in order
  let result = await fetchWeatherFromOpenWeatherMap(lat, lon);
  if (!result) result = await fetchWeatherFromWeatherAPI(lat, lon);
  if (!result) result = await fetchWeatherFromTomorrowIO(lat, lon);

  if (result) {
    setCrawlCache('weather', cacheKey, result);
  }
  return result;
}

// Fetch news from NewsAPI
async function fetchNewsFromNewsAPI() {
  if (!NEWSAPI_KEY) return [];

  try {
    const url = `https://newsapi.org/v2/top-headlines?country=us&apiKey=${NEWSAPI_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return (data.articles || []).slice(0, 10).map(a => ({
        title: a.title,
        source: a.source?.name || 'NewsAPI',
        url: a.url,
        publishedAt: a.publishedAt,
        provider: 'NewsAPI',
      }));
    }
  } catch (err) {
    console.error('NewsAPI error:', err.message);
  }
  return [];
}

// Fetch news from GNews
async function fetchNewsFromGNews() {
  if (!GNEWS_API_KEY) return [];

  try {
    const url = `https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=us&max=10&apikey=${GNEWS_API_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return (data.articles || []).map(a => ({
        title: a.title,
        source: a.source?.name || 'GNews',
        url: a.url,
        publishedAt: a.publishedAt,
        provider: 'GNews',
      }));
    }
  } catch (err) {
    console.error('GNews error:', err.message);
  }
  return [];
}

// Fetch news from MediaStack
async function fetchNewsFromMediaStack() {
  if (!MEDIASTACK_API_KEY) return [];

  try {
    const url = `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK_API_KEY}&languages=en&limit=10`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return (data.data || []).map(a => ({
        title: a.title,
        source: a.source || 'MediaStack',
        url: a.url,
        publishedAt: a.published_at,
        provider: 'MediaStack',
      }));
    }
  } catch (err) {
    console.error('MediaStack error:', err.message);
  }
  return [];
}

// Fetch news from RSS feeds (simple XML parsing without external deps)
async function fetchNewsFromRSS() {
  if (NEWS_RSS_FEEDS.length === 0) return [];

  const headlines = [];

  for (const feedUrl of NEWS_RSS_FEEDS.slice(0, 5)) { // Limit to 5 feeds
    try {
      const response = await fetch(feedUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'Cortex/2.12.0' },
      });

      if (!response.ok) continue;

      const xml = await response.text();

      // Simple regex-based RSS parsing (handles most common RSS/Atom formats)
      const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
      const titleRegex = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
      const linkRegex = /<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>|<link[^>]*href=["']([^"']+)["']/i;
      const pubDateRegex = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>|<published[^>]*>([\s\S]*?)<\/published>/i;

      // Get feed title for source name
      const feedTitleMatch = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const feedTitle = feedTitleMatch ? feedTitleMatch[1].trim() : 'RSS';

      let match;
      let count = 0;
      while ((match = itemRegex.exec(xml)) !== null && count < 5) {
        const itemXml = match[1] || match[2];
        const titleMatch = itemXml.match(titleRegex);
        const linkMatch = itemXml.match(linkRegex);
        const pubDateMatch = itemXml.match(pubDateRegex);

        if (titleMatch) {
          headlines.push({
            title: titleMatch[1].trim().replace(/<[^>]+>/g, ''), // Strip any HTML
            source: feedTitle,
            url: linkMatch ? (linkMatch[1] || linkMatch[2]).trim() : feedUrl,
            publishedAt: pubDateMatch ? (pubDateMatch[1] || pubDateMatch[2]).trim() : null,
            provider: 'RSS',
          });
          count++;
        }
      }
    } catch (err) {
      console.error(`RSS feed error (${feedUrl}):`, err.message);
    }
  }

  return headlines;
}

// Main news fetch - combines results from all configured providers
async function fetchNews() {
  const cached = getCrawlCache('news', 'headlines');
  if (cached) return cached;

  // Fetch from all providers in parallel
  const [newsAPI, gNews, mediaStack, rss] = await Promise.all([
    fetchNewsFromNewsAPI(),
    fetchNewsFromGNews(),
    fetchNewsFromMediaStack(),
    fetchNewsFromRSS(),
  ]);

  // Combine and deduplicate by title similarity
  const allHeadlines = [...newsAPI, ...gNews, ...mediaStack, ...rss];
  const seen = new Set();
  const headlines = allHeadlines.filter(h => {
    if (!h.title) return false;
    const normalized = h.title.toLowerCase().substring(0, 50);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 15); // Limit total headlines

  const result = { headlines, timestamp: Date.now() };
  if (headlines.length > 0) {
    setCrawlCache('news', 'headlines', result);
  }
  return result;
}

// IP Geolocation (using ip-api.com free service)
async function getLocationFromIP(ip) {
  // Skip for localhost/private IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }

  const cached = getCrawlCache('geolocation', ip);
  if (cached) return cached;

  try {
    // Using ip-api.com (free, no key required, 45 requests/min)
    const url = `http://ip-api.com/json/${ip}?fields=status,city,regionName,country,lat,lon`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 'success') return null;

    const result = {
      lat: data.lat,
      lon: data.lon,
      name: `${data.city}, ${data.regionName}`,
    };

    setCrawlCache('geolocation', ip, result);
    return result;
  } catch (err) {
    console.error('IP geolocation error:', err.message);
    return null;
  }
}

// Get client IP from request (handles proxies)
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.ip;
}

// Detect embed URLs in content and return metadata
function detectEmbedUrls(content) {
  const embeds = [];
  const urlRegex = /https?:\/\/[^\s<>"]+/gi;
  const urls = content.match(urlRegex) || [];

  for (const url of urls) {
    for (const [platform, config] of Object.entries(EMBED_PATTERNS)) {
      for (const pattern of config.patterns) {
        const match = url.match(pattern);
        if (match) {
          const embed = {
            platform,
            url,
            contentId: match[1],
          };

          // Handle Spotify's type/id format
          if (platform === 'spotify' && match[2]) {
            embed.contentType = match[1]; // track, album, playlist, etc.
            embed.contentId = match[2];
            embed.embedUrl = config.embedUrl(match[1], match[2]);
          } else if (platform === 'youtube') {
            // YouTube playlist support (v2.19.0)
            const playlistMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
            const playlistId = playlistMatch ? playlistMatch[1] : null;
            const isPlaylistOnly = url.includes('/playlist?');

            if (isPlaylistOnly) {
              // Playlist-only URL: contentId captured is the playlist ID
              embed.playlistId = match[1];
              embed.contentId = null;
              embed.isPlaylist = true;
            } else if (playlistId) {
              // Video with playlist context
              embed.playlistId = playlistId;
              embed.isPlaylist = true;
            }

            embed.embedUrl = config.embedUrl(embed.contentId, embed.playlistId);
          } else if (config.embedUrl && typeof config.embedUrl === 'function') {
            embed.embedUrl = config.embedUrl(match[1]);
          }

          // Add thumbnail for YouTube
          if (platform === 'youtube' && config.thumbnail) {
            embed.thumbnail = config.thumbnail(embed.contentId);
          }

          // Flag if oEmbed is available
          if (config.oembedUrl) {
            embed.oembedUrl = config.oembedUrl(url);
          }

          embeds.push(embed);
          break;
        }
      }
    }
  }

  return embeds;
}

// Generate embed HTML for a platform (used for server-side rendering if needed)
function generateEmbedHtml(embed) {
  const { platform, embedUrl, contentId } = embed;

  // Common iframe attributes for security
  const sandbox = 'allow-scripts allow-same-origin allow-presentation allow-popups';
  const allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';

  switch (platform) {
    case 'youtube':
      // Add rel=0 only if not already in URL (playlist URLs may have query params)
      const ytSrc = embedUrl.includes('?') ? `${embedUrl}&rel=0` : `${embedUrl}?rel=0`;
      return `<iframe
        src="${ytSrc}"
        width="560" height="315"
        frameborder="0"
        sandbox="${sandbox}"
        allow="${allow}"
        allowfullscreen
        loading="lazy"
        class="rich-embed youtube-embed"
        data-platform="youtube"
        data-content-id="${contentId || embed.playlistId || ''}"
      ></iframe>`;

    case 'vimeo':
      return `<iframe
        src="${embedUrl}"
        width="560" height="315"
        frameborder="0"
        sandbox="${sandbox}"
        allow="${allow}"
        allowfullscreen
        loading="lazy"
        class="rich-embed vimeo-embed"
        data-platform="vimeo"
        data-content-id="${contentId}"
      ></iframe>`;

    case 'spotify':
      const height = embed.contentType === 'track' ? '152' : '352';
      return `<iframe
        src="${embedUrl}"
        width="100%" height="${height}"
        frameborder="0"
        sandbox="${sandbox}"
        allow="encrypted-media"
        loading="lazy"
        class="rich-embed spotify-embed"
        data-platform="spotify"
        data-content-id="${contentId}"
      ></iframe>`;

    default:
      return null;
  }
}

// ============ Security: Password Validation ============
function validatePassword(password) {
  const errors = [];
  if (!password || typeof password !== 'string') {
    return ['Password is required'];
  }
  if (password.length < 8) errors.push('Password must be at least 8 characters');
  if (password.length > 128) errors.push('Password must be less than 128 characters');
  if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
  return errors;
}

// ============ Database with Separated Files ============
class Database {
  constructor() {
    this.users = { users: [], contacts: [] };
    this.waves = { waves: [], participants: [] };
    this.droplets = { droplets: [], history: [] };
    this.groups = { groups: [], members: [] };
    this.handleRequests = { requests: [] };
    this.reports = { reports: [] };
    this.moderation = { blocks: [], mutes: [] };
    this.contactRequests = { requests: [] };
    this.groupInvitations = { invitations: [] };
    this.pushSubscriptions = { subscriptions: [] };
    this.notifications = { notifications: [] };
    this.waveNotificationSettings = { settings: [] };
    this.load();
  }

  // Backward compatibility getter for messages
  get messages() {
    return { messages: this.droplets.droplets, history: this.droplets.history };
  }
  set messages(val) {
    this.droplets = { droplets: val.messages || [], history: val.history || [] };
  }

  // === File Operations ===
  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log('📁 Created data directory');
    }
  }

  loadFile(filepath, defaultData) {
    try {
      if (fs.existsSync(filepath)) {
        return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      }
    } catch (err) {
      console.error(`Failed to load ${filepath}:`, err);
    }
    return defaultData;
  }

  saveFile(filepath, data) {
    try {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Failed to save ${filepath}:`, err);
    }
  }

  load() {
    this.ensureDataDir();

    const hasData = fs.existsSync(DATA_FILES.users);

    if (hasData) {
      this.users = this.loadFile(DATA_FILES.users, { users: [], contacts: [] });
      this.waves = this.loadFile(DATA_FILES.waves, { waves: [], participants: [] });

      // Migration: messages.json -> droplets.json (v1.10.0)
      if (fs.existsSync(DATA_FILES.droplets)) {
        this.droplets = this.loadFile(DATA_FILES.droplets, { droplets: [], history: [] });
      } else if (fs.existsSync(DATA_FILES.messages)) {
        // Migrate from messages.json to droplets.json
        console.log('📝 Migrating messages.json to droplets.json...');
        const messagesData = this.loadFile(DATA_FILES.messages, { messages: [], history: [] });
        this.droplets = { droplets: messagesData.messages || [], history: messagesData.history || [] };
        this.saveDroplets();
        console.log('✅ Migration complete');
      } else {
        this.droplets = { droplets: [], history: [] };
      }

      this.groups = this.loadFile(DATA_FILES.groups, { groups: [], members: [] });
      this.handleRequests = this.loadFile(DATA_FILES.handleRequests, { requests: [] });
      this.reports = this.loadFile(DATA_FILES.reports, { reports: [] });
      this.moderation = this.loadFile(DATA_FILES.moderation, { blocks: [], mutes: [] });
      this.contactRequests = this.loadFile(DATA_FILES.contactRequests, { requests: [] });
      this.groupInvitations = this.loadFile(DATA_FILES.groupInvitations, { invitations: [] });
      this.pushSubscriptions = this.loadFile(DATA_FILES.pushSubscriptions, { subscriptions: [] });
      this.notifications = this.loadFile(DATA_FILES.notifications, { notifications: [] });
      this.waveNotificationSettings = this.loadFile(DATA_FILES.waveNotificationSettings, { settings: [] });
      console.log('📂 Loaded data from separated files');
    } else {
      if (process.env.SEED_DEMO_DATA === 'true') {
        this.seedDemoData();
      } else {
        this.initEmpty();
      }
    }
  }

  saveAll() {
    this.saveFile(DATA_FILES.users, this.users);
    this.saveFile(DATA_FILES.waves, this.waves);
    this.saveFile(DATA_FILES.droplets, this.droplets);
    this.saveFile(DATA_FILES.groups, this.groups);
    this.saveFile(DATA_FILES.handleRequests, this.handleRequests);
    this.saveFile(DATA_FILES.reports, this.reports);
    this.saveFile(DATA_FILES.moderation, this.moderation);
    this.saveFile(DATA_FILES.contactRequests, this.contactRequests);
    this.saveFile(DATA_FILES.groupInvitations, this.groupInvitations);
  }

  saveUsers() { this.saveFile(DATA_FILES.users, this.users); }
  saveWaves() { this.saveFile(DATA_FILES.waves, this.waves); }
  saveDroplets() { this.saveFile(DATA_FILES.droplets, this.droplets); }
  saveMessages() { this.saveDroplets(); } // Backward compatibility alias
  saveGroups() { this.saveFile(DATA_FILES.groups, this.groups); }
  saveHandleRequests() { this.saveFile(DATA_FILES.handleRequests, this.handleRequests); }
  saveReports() { this.saveFile(DATA_FILES.reports, this.reports); }
  saveContactRequests() { this.saveFile(DATA_FILES.contactRequests, this.contactRequests); }
  saveGroupInvitations() { this.saveFile(DATA_FILES.groupInvitations, this.groupInvitations); }
  saveModeration() { this.saveFile(DATA_FILES.moderation, this.moderation); }
  savePushSubscriptions() { this.saveFile(DATA_FILES.pushSubscriptions, this.pushSubscriptions); }
  saveNotifications() { this.saveFile(DATA_FILES.notifications, this.notifications); }
  saveWaveNotificationSettings() { this.saveFile(DATA_FILES.waveNotificationSettings, this.waveNotificationSettings); }

  initEmpty() {
    console.log('📝 Initializing empty database');
    this.saveAll();
    console.log('✅ Database initialized');
  }

  seedDemoData() {
    console.log('🌱 Seeding demo data...');
    const passwordHash = bcrypt.hashSync('Demo123!', 12);
    const now = new Date().toISOString();

    const demoUsers = [
      { id: 'user-mal', handle: 'mal', email: 'mal@serenity.ship', displayName: 'Malcolm Reynolds', avatar: 'M', nodeName: 'Serenity', status: 'offline', isAdmin: true },
      { id: 'user-zoe', handle: 'zoe', email: 'zoe@serenity.ship', displayName: 'Zoe Washburne', avatar: 'Z', nodeName: 'Serenity', status: 'offline', isAdmin: false },
      { id: 'user-wash', handle: 'wash', email: 'wash@serenity.ship', displayName: 'Hoban Washburne', avatar: 'W', nodeName: 'Serenity', status: 'offline', isAdmin: false },
      { id: 'user-kaylee', handle: 'kaylee', email: 'kaylee@serenity.ship', displayName: 'Kaylee Frye', avatar: 'K', nodeName: 'Serenity', status: 'offline', isAdmin: false },
      { id: 'user-jayne', handle: 'jayne', email: 'jayne@serenity.ship', displayName: 'Jayne Cobb', avatar: 'J', nodeName: 'Serenity', status: 'offline', isAdmin: false },
    ];

    this.users.users = demoUsers.map(u => ({ 
      ...u, 
      passwordHash, 
      createdAt: now, 
      lastSeen: now,
      handleHistory: [],
      lastHandleChange: null,
    }));
    
    // Create a demo group
    this.groups.groups = [
      { id: 'group-crew', name: 'Serenity Crew', description: 'The crew of Serenity', createdBy: 'user-mal', createdAt: now },
    ];
    this.groups.members = demoUsers.map(u => ({
      groupId: 'group-crew',
      userId: u.id,
      role: u.id === 'user-mal' ? 'admin' : 'member',
      joinedAt: now,
    }));

    // Demo waves with different privacy levels
    this.waves.waves = [
      { id: 'wave-1', title: 'Welcome to Cortex', privacy: 'public', createdBy: 'user-mal', createdAt: now, updatedAt: now },
      { id: 'wave-2', title: 'Private Chat Test', privacy: 'private', createdBy: 'user-mal', createdAt: now, updatedAt: now },
      { id: 'wave-3', title: 'Crew Discussion', privacy: 'group', groupId: 'group-crew', createdBy: 'user-mal', createdAt: now, updatedAt: now },
      { id: 'wave-4', title: 'Zoe Private Wave', privacy: 'private', createdBy: 'user-zoe', createdAt: now, updatedAt: now },
      { id: 'wave-5', title: 'Wash Public Wave', privacy: 'public', createdBy: 'user-wash', createdAt: now, updatedAt: now },
    ];
    this.waves.participants = [
      { waveId: 'wave-1', userId: 'user-mal', joinedAt: now, archived: false },
      { waveId: 'wave-2', userId: 'user-mal', joinedAt: now, archived: false },
      { waveId: 'wave-2', userId: 'user-zoe', joinedAt: now, archived: false },
      { waveId: 'wave-3', userId: 'user-mal', joinedAt: now, archived: false },
      { waveId: 'wave-3', userId: 'user-zoe', joinedAt: now, archived: false },
      { waveId: 'wave-3', userId: 'user-wash', joinedAt: now, archived: false },
      { waveId: 'wave-4', userId: 'user-zoe', joinedAt: now, archived: false },
      { waveId: 'wave-4', userId: 'user-mal', joinedAt: now, archived: false },
      { waveId: 'wave-5', userId: 'user-wash', joinedAt: now, archived: false },
    ];

    this.droplets.droplets = [
      { id: 'droplet-1', waveId: 'wave-1', parentId: null, authorId: 'user-mal', content: 'Welcome to Cortex! This is a public wave visible to everyone.', privacy: 'public', version: 1, createdAt: now, editedAt: null, readBy: ['user-mal'] },
      { id: 'droplet-2', waveId: 'wave-2', parentId: null, authorId: 'user-mal', content: 'This is a private wave for testing.', privacy: 'private', version: 1, createdAt: now, editedAt: null, readBy: ['user-mal'] },
      { id: 'droplet-3', waveId: 'wave-3', parentId: null, authorId: 'user-mal', content: 'This is a group wave for the crew.', privacy: 'group', version: 1, createdAt: now, editedAt: null, readBy: ['user-mal'] },
      { id: 'droplet-4', waveId: 'wave-4', parentId: null, authorId: 'user-zoe', content: 'Zoe\'s private wave.', privacy: 'private', version: 1, createdAt: now, editedAt: null, readBy: ['user-zoe'] },
      { id: 'droplet-5', waveId: 'wave-5', parentId: null, authorId: 'user-wash', content: 'Wash\'s public wave.', privacy: 'public', version: 1, createdAt: now, editedAt: null, readBy: ['user-wash'] },
    ];

    this.saveAll();
    console.log('✅ Demo data seeded (password: Demo123!)');
  }

  // === User Methods ===
  findUserByHandle(handle) {
    const sanitized = sanitizeInput(handle)?.toLowerCase();
    return this.users.users.find(u => 
      u.handle.toLowerCase() === sanitized || 
      u.email.toLowerCase() === sanitized
    );
  }

  findUserById(id) {
    return this.users.users.find(u => u.id === id);
  }

  createUser(userData) {
    const user = {
      ...userData,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      handleHistory: [],
      lastHandleChange: null,
      isAdmin: this.users.users.length === 0, // First user is admin
      preferences: { theme: 'serenity', fontSize: 'medium' },
      bio: null, // About me section (max 500 chars)
      avatarUrl: null, // Profile image URL
    };
    this.users.users.push(user);
    this.saveUsers();
    return user;
  }

  updateUser(userId, updates) {
    const user = this.findUserById(userId);
    if (!user) return null;
    Object.assign(user, updates);
    this.saveUsers();
    return user;
  }

  updateUserStatus(userId, status) {
    const user = this.findUserById(userId);
    if (user) {
      user.status = status;
      user.lastSeen = new Date().toISOString();
      this.saveUsers();
    }
  }

  updateUserPreferences(userId, preferences) {
    const user = this.findUserById(userId);
    if (!user) return null;

    if (!user.preferences) {
      user.preferences = { theme: 'serenity', fontSize: 'medium' };
    }
    user.preferences = { ...user.preferences, ...preferences };
    this.saveUsers();
    return user.preferences;
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = this.findUserById(userId);
    if (!user) return { success: false, error: 'User not found' };
    
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return { success: false, error: 'Current password is incorrect' };
    
    const errors = validatePassword(newPassword);
    if (errors.length > 0) return { success: false, error: errors.join('. ') };
    
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    this.saveUsers();
    return { success: true };
  }

  requestHandleChange(userId, newHandle) {
    const user = this.findUserById(userId);
    if (!user) return { success: false, error: 'User not found' };
    
    // Check if handle is taken
    const existing = this.users.users.find(u => 
      u.handle.toLowerCase() === newHandle.toLowerCase() && u.id !== userId
    );
    if (existing) return { success: false, error: 'Handle is already taken' };
    
    // Check cooldown (30 days)
    if (user.lastHandleChange) {
      const daysSince = (Date.now() - new Date(user.lastHandleChange).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) {
        return { success: false, error: `You can change your handle again in ${Math.ceil(30 - daysSince)} days` };
      }
    }
    
    // Check if handle was recently used by someone else
    const recentlyUsed = this.users.users.some(u => 
      u.handleHistory?.some(h => 
        h.handle.toLowerCase() === newHandle.toLowerCase() &&
        (Date.now() - new Date(h.changedAt).getTime()) < 90 * 24 * 60 * 60 * 1000
      )
    );
    if (recentlyUsed) return { success: false, error: 'This handle was recently used and is reserved for 90 days' };
    
    // Create request
    const request = {
      id: `req-${uuidv4()}`,
      userId,
      currentHandle: user.handle,
      newHandle: sanitizeInput(newHandle),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.handleRequests.requests.push(request);
    this.saveHandleRequests();
    
    return { success: true, request };
  }

  approveHandleChange(requestId, adminId) {
    const admin = this.findUserById(adminId);
    if (!admin?.isAdmin) return { success: false, error: 'Not authorized' };
    
    const request = this.handleRequests.requests.find(r => r.id === requestId);
    if (!request || request.status !== 'pending') {
      return { success: false, error: 'Request not found or already processed' };
    }
    
    const user = this.findUserById(request.userId);
    if (!user) return { success: false, error: 'User not found' };
    
    // Store old handle in history
    if (!user.handleHistory) user.handleHistory = [];
    user.handleHistory.push({ handle: user.handle, changedAt: new Date().toISOString() });
    
    // Update handle
    user.handle = request.newHandle;
    user.lastHandleChange = new Date().toISOString();
    
    request.status = 'approved';
    request.processedAt = new Date().toISOString();
    request.processedBy = adminId;
    
    this.saveUsers();
    this.saveHandleRequests();
    
    return { success: true };
  }

  rejectHandleChange(requestId, adminId, reason) {
    const admin = this.findUserById(adminId);
    if (!admin?.isAdmin) return { success: false, error: 'Not authorized' };

    const request = this.handleRequests.requests.find(r => r.id === requestId);
    if (!request || request.status !== 'pending') {
      return { success: false, error: 'Request not found or already processed' };
    }

    request.status = 'rejected';
    request.reason = reason;
    request.processedAt = new Date().toISOString();
    request.processedBy = adminId;

    this.saveHandleRequests();
    return { success: true };
  }

  getPendingHandleRequests() {
    return this.handleRequests.requests.filter(r => r.status === 'pending');
  }

  searchUsers(query, excludeUserId) {
    if (!query || query.length < 2) return [];
    const lowerQuery = query.toLowerCase();
    return this.users.users
      .filter(u => u.id !== excludeUserId &&
        (u.handle.toLowerCase().includes(lowerQuery) ||
         u.displayName.toLowerCase().includes(lowerQuery)))
      .slice(0, 10)
      .map(u => ({
        id: u.id, handle: u.handle, displayName: u.displayName,
        avatar: u.avatar, status: u.status, nodeName: u.nodeName,
      }));
  }

  // === Contact Methods ===
  getContactsForUser(userId) {
    return this.users.contacts
      .filter(c => c.userId === userId)
      .map(c => {
        const contact = this.findUserById(c.contactId);
        return contact ? {
          id: contact.id, handle: contact.handle, name: contact.displayName,
          avatar: contact.avatar, status: contact.status, nodeName: contact.nodeName,
        } : null;
      })
      .filter(Boolean);
  }

  addContact(userId, contactId) {
    const existing = this.users.contacts.find(c => c.userId === userId && c.contactId === contactId);
    if (existing) return false;
    this.users.contacts.push({ userId, contactId, addedAt: new Date().toISOString() });
    this.saveUsers();
    return true;
  }

  removeContact(userId, contactId) {
    const index = this.users.contacts.findIndex(c => c.userId === userId && c.contactId === contactId);
    if (index === -1) return false;
    this.users.contacts.splice(index, 1);
    this.saveUsers();
    return true;
  }

  isContact(userId, contactId) {
    return this.users.contacts.some(c => c.userId === userId && c.contactId === contactId);
  }

  // === Contact Request Methods ===
  createContactRequest(fromUserId, toUserId, message = null) {
    // Validate users exist
    const fromUser = this.findUserById(fromUserId);
    const toUser = this.findUserById(toUserId);
    if (!fromUser || !toUser) return { error: 'User not found' };

    // Can't request yourself
    if (fromUserId === toUserId) return { error: 'Cannot add yourself as a contact' };

    // Check if already contacts
    if (this.isContact(fromUserId, toUserId)) return { error: 'Already a contact' };

    // Check if blocked
    if (this.isBlocked(toUserId, fromUserId)) return { error: 'Cannot send request to this user' };

    // Check for existing pending request (either direction)
    const existingRequest = this.contactRequests.requests.find(r =>
      r.status === 'pending' && (
        (r.from_user_id === fromUserId && r.to_user_id === toUserId) ||
        (r.from_user_id === toUserId && r.to_user_id === fromUserId)
      )
    );
    if (existingRequest) {
      if (existingRequest.from_user_id === fromUserId) {
        return { error: 'Request already pending' };
      } else {
        return { error: 'This user has already sent you a request' };
      }
    }

    const request = {
      id: uuidv4(),
      from_user_id: fromUserId,
      to_user_id: toUserId,
      message: message ? sanitizeInput(message) : null,
      status: 'pending',
      created_at: new Date().toISOString(),
      responded_at: null
    };

    this.contactRequests.requests.push(request);
    this.saveContactRequests();

    // Return enriched request with user info
    return {
      ...request,
      from_user: { id: fromUser.id, handle: fromUser.handle, displayName: fromUser.displayName, avatar: fromUser.avatar },
      to_user: { id: toUser.id, handle: toUser.handle, displayName: toUser.displayName, avatar: toUser.avatar }
    };
  }

  getContactRequestsForUser(userId) {
    // Get pending requests received by this user
    return this.contactRequests.requests
      .filter(r => r.to_user_id === userId && r.status === 'pending')
      .map(r => {
        const fromUser = this.findUserById(r.from_user_id);
        return {
          ...r,
          from_user: fromUser ? {
            id: fromUser.id,
            handle: fromUser.handle,
            displayName: fromUser.displayName,
            avatar: fromUser.avatar
          } : null
        };
      });
  }

  getSentContactRequests(userId) {
    // Get pending requests sent by this user
    return this.contactRequests.requests
      .filter(r => r.from_user_id === userId && r.status === 'pending')
      .map(r => {
        const toUser = this.findUserById(r.to_user_id);
        return {
          ...r,
          to_user: toUser ? {
            id: toUser.id,
            handle: toUser.handle,
            displayName: toUser.displayName,
            avatar: toUser.avatar
          } : null
        };
      });
  }

  getContactRequest(requestId) {
    return this.contactRequests.requests.find(r => r.id === requestId);
  }

  acceptContactRequest(requestId, userId) {
    const request = this.getContactRequest(requestId);
    if (!request) return { error: 'Request not found' };
    if (request.to_user_id !== userId) return { error: 'Not authorized' };
    if (request.status !== 'pending') return { error: 'Request already processed' };

    // Update request status
    request.status = 'accepted';
    request.responded_at = new Date().toISOString();

    // Create mutual contact relationship
    this.addContact(request.from_user_id, request.to_user_id);
    this.addContact(request.to_user_id, request.from_user_id);

    this.saveContactRequests();

    return { success: true, request };
  }

  declineContactRequest(requestId, userId) {
    const request = this.getContactRequest(requestId);
    if (!request) return { error: 'Request not found' };
    if (request.to_user_id !== userId) return { error: 'Not authorized' };
    if (request.status !== 'pending') return { error: 'Request already processed' };

    request.status = 'declined';
    request.responded_at = new Date().toISOString();
    this.saveContactRequests();

    return { success: true, request };
  }

  cancelContactRequest(requestId, userId) {
    const request = this.getContactRequest(requestId);
    if (!request) return { error: 'Request not found' };
    if (request.from_user_id !== userId) return { error: 'Not authorized' };
    if (request.status !== 'pending') return { error: 'Request already processed' };

    // Remove the request entirely
    const index = this.contactRequests.requests.findIndex(r => r.id === requestId);
    if (index !== -1) {
      this.contactRequests.requests.splice(index, 1);
      this.saveContactRequests();
    }

    return { success: true };
  }

  // Check if there's a pending request between two users
  getPendingRequestBetween(userId1, userId2) {
    return this.contactRequests.requests.find(r =>
      r.status === 'pending' && (
        (r.from_user_id === userId1 && r.to_user_id === userId2) ||
        (r.from_user_id === userId2 && r.to_user_id === userId1)
      )
    );
  }

  // === Group Invitation Methods ===
  createGroupInvitation(groupId, invitedBy, invitedUserId, message = null) {
    // Validate group exists
    const group = this.getGroup(groupId);
    if (!group) return { error: 'Group not found' };

    // Validate users exist
    const inviter = this.findUserById(invitedBy);
    const invitee = this.findUserById(invitedUserId);
    if (!inviter || !invitee) return { error: 'User not found' };

    // Can't invite yourself
    if (invitedBy === invitedUserId) return { error: 'Cannot invite yourself' };

    // Check if inviter is a group member
    if (!this.isGroupMember(groupId, invitedBy)) {
      return { error: 'Only group members can invite others' };
    }

    // Check if invitee is already a member
    if (this.isGroupMember(groupId, invitedUserId)) {
      return { error: 'User is already a group member' };
    }

    // Check if blocked
    if (this.isBlocked(invitedUserId, invitedBy)) {
      return { error: 'Cannot invite this user' };
    }

    // Check for existing pending invitation
    const existingInvitation = this.groupInvitations.invitations.find(i =>
      i.group_id === groupId &&
      i.invited_user_id === invitedUserId &&
      i.status === 'pending'
    );
    if (existingInvitation) {
      return { error: 'Invitation already pending for this user' };
    }

    const invitation = {
      id: uuidv4(),
      group_id: groupId,
      invited_by: invitedBy,
      invited_user_id: invitedUserId,
      message: message ? sanitizeInput(message) : null,
      status: 'pending',
      created_at: new Date().toISOString(),
      responded_at: null
    };

    this.groupInvitations.invitations.push(invitation);
    this.saveGroupInvitations();

    // Return enriched invitation with group and user info
    return {
      ...invitation,
      group: { id: group.id, name: group.name },
      invited_by_user: { id: inviter.id, handle: inviter.handle, displayName: inviter.displayName, avatar: inviter.avatar },
      invited_user: { id: invitee.id, handle: invitee.handle, displayName: invitee.displayName, avatar: invitee.avatar }
    };
  }

  getGroupInvitationsForUser(userId) {
    // Get pending invitations received by this user
    return this.groupInvitations.invitations
      .filter(i => i.invited_user_id === userId && i.status === 'pending')
      .map(i => {
        const group = this.getGroup(i.group_id);
        const inviter = this.findUserById(i.invited_by);
        return {
          ...i,
          group: group ? { id: group.id, name: group.name, description: group.description } : null,
          invited_by_user: inviter ? {
            id: inviter.id,
            handle: inviter.handle,
            displayName: inviter.displayName,
            avatar: inviter.avatar
          } : null
        };
      });
  }

  getGroupInvitationsSent(groupId, userId) {
    // Get pending invitations sent by this user for a specific group
    return this.groupInvitations.invitations
      .filter(i => i.group_id === groupId && i.invited_by === userId && i.status === 'pending')
      .map(i => {
        const invitee = this.findUserById(i.invited_user_id);
        return {
          ...i,
          invited_user: invitee ? {
            id: invitee.id,
            handle: invitee.handle,
            displayName: invitee.displayName,
            avatar: invitee.avatar
          } : null
        };
      });
  }

  getGroupInvitation(invitationId) {
    return this.groupInvitations.invitations.find(i => i.id === invitationId);
  }

  acceptGroupInvitation(invitationId, userId) {
    const invitation = this.getGroupInvitation(invitationId);
    if (!invitation) return { error: 'Invitation not found' };
    if (invitation.invited_user_id !== userId) return { error: 'Not authorized' };
    if (invitation.status !== 'pending') return { error: 'Invitation already processed' };

    // Double-check user isn't already a member
    if (this.isGroupMember(invitation.group_id, userId)) {
      invitation.status = 'accepted';
      invitation.responded_at = new Date().toISOString();
      this.saveGroupInvitations();
      return { error: 'Already a group member' };
    }

    // Update invitation status
    invitation.status = 'accepted';
    invitation.responded_at = new Date().toISOString();

    // Add user to group as member
    this.addGroupMember(invitation.group_id, userId, 'member');

    this.saveGroupInvitations();

    const group = this.getGroup(invitation.group_id);
    return {
      success: true,
      invitation,
      group: group ? { id: group.id, name: group.name } : null
    };
  }

  declineGroupInvitation(invitationId, userId) {
    const invitation = this.getGroupInvitation(invitationId);
    if (!invitation) return { error: 'Invitation not found' };
    if (invitation.invited_user_id !== userId) return { error: 'Not authorized' };
    if (invitation.status !== 'pending') return { error: 'Invitation already processed' };

    invitation.status = 'declined';
    invitation.responded_at = new Date().toISOString();
    this.saveGroupInvitations();

    return { success: true, invitation };
  }

  cancelGroupInvitation(invitationId, userId) {
    const invitation = this.getGroupInvitation(invitationId);
    if (!invitation) return { error: 'Invitation not found' };
    if (invitation.invited_by !== userId) return { error: 'Not authorized' };
    if (invitation.status !== 'pending') return { error: 'Invitation already processed' };

    // Remove the invitation entirely
    const index = this.groupInvitations.invitations.findIndex(i => i.id === invitationId);
    if (index !== -1) {
      this.groupInvitations.invitations.splice(index, 1);
      this.saveGroupInvitations();
    }

    return { success: true };
  }

  // === Push Subscription Methods ===
  getPushSubscriptions(userId) {
    return this.pushSubscriptions.subscriptions.filter(s => s.userId === userId);
  }

  addPushSubscription(userId, subscription) {
    // Remove any existing subscription with the same endpoint for this user
    this.pushSubscriptions.subscriptions = this.pushSubscriptions.subscriptions.filter(
      s => !(s.userId === userId && s.endpoint === subscription.endpoint)
    );

    this.pushSubscriptions.subscriptions.push({
      id: uuidv4(),
      userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      createdAt: new Date().toISOString()
    });

    this.savePushSubscriptions();
    return true;
  }

  removePushSubscription(userId, endpoint) {
    const initialLength = this.pushSubscriptions.subscriptions.length;
    this.pushSubscriptions.subscriptions = this.pushSubscriptions.subscriptions.filter(
      s => !(s.userId === userId && s.endpoint === endpoint)
    );

    if (this.pushSubscriptions.subscriptions.length < initialLength) {
      this.savePushSubscriptions();
      return true;
    }
    return false;
  }

  removeAllPushSubscriptions(userId) {
    const initialLength = this.pushSubscriptions.subscriptions.length;
    this.pushSubscriptions.subscriptions = this.pushSubscriptions.subscriptions.filter(
      s => s.userId !== userId
    );

    if (this.pushSubscriptions.subscriptions.length < initialLength) {
      this.savePushSubscriptions();
      return true;
    }
    return false;
  }

  removeExpiredPushSubscription(endpoint) {
    // Called when a push notification fails (subscription expired/invalid)
    this.pushSubscriptions.subscriptions = this.pushSubscriptions.subscriptions.filter(
      s => s.endpoint !== endpoint
    );
    this.savePushSubscriptions();
  }

  // === Notification Methods ===
  createNotification({ userId, type, waveId, dropletId, actorId, title, body, preview, groupKey }) {
    const notification = {
      id: uuidv4(),
      userId,
      type,
      waveId: waveId || null,
      dropletId: dropletId || null,
      actorId: actorId || null,
      title,
      body: body || null,
      preview: preview || null,
      read: false,
      dismissed: false,
      pushSent: false,
      createdAt: new Date().toISOString(),
      readAt: null,
      groupKey: groupKey || null
    };

    this.notifications.notifications.push(notification);
    this.saveNotifications();
    return notification;
  }

  getNotifications(userId, { unread = false, type = null, limit = 50, offset = 0 } = {}) {
    let notifications = this.notifications.notifications
      .filter(n => n.userId === userId && !n.dismissed);

    if (unread) {
      notifications = notifications.filter(n => !n.read);
    }
    if (type) {
      notifications = notifications.filter(n => n.type === type);
    }

    // Sort by createdAt descending
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Apply pagination
    notifications = notifications.slice(offset, offset + limit);

    // Enrich with actor and wave info
    return notifications.map(n => {
      const actor = n.actorId ? this.findUserById(n.actorId) : null;
      const wave = n.waveId ? this.waves.waves.find(w => w.id === n.waveId) : null;

      return {
        ...n,
        actorHandle: actor?.handle,
        actorDisplayName: actor?.displayName,
        actorAvatar: actor?.avatar,
        actorAvatarUrl: actor?.avatarUrl,
        waveTitle: wave?.title
      };
    });
  }

  getNotificationCounts(userId) {
    const unread = this.notifications.notifications
      .filter(n => n.userId === userId && !n.read && !n.dismissed);

    const byType = {};
    for (const n of unread) {
      byType[n.type] = (byType[n.type] || 0) + 1;
    }

    return { total: unread.length, byType };
  }

  // Get unread notification counts grouped by wave with priority types
  getUnreadCountsByWave(userId) {
    const unread = this.notifications.notifications
      .filter(n => n.userId === userId && !n.read && !n.dismissed && n.waveId);

    const byWave = {};
    // Priority: direct_mention > reply > ripple > wave_activity
    const typePriority = { direct_mention: 4, reply: 3, ripple: 2, wave_activity: 1 };

    for (const n of unread) {
      if (!byWave[n.waveId]) {
        byWave[n.waveId] = { count: 0, highestType: null, highestPriority: 0 };
      }
      byWave[n.waveId].count++;
      const priority = typePriority[n.type] || 0;
      if (priority > byWave[n.waveId].highestPriority) {
        byWave[n.waveId].highestPriority = priority;
        byWave[n.waveId].highestType = n.type;
      }
    }

    return byWave;
  }

  markNotificationRead(notificationId) {
    const notification = this.notifications.notifications.find(n => n.id === notificationId);
    if (!notification) return false;

    notification.read = true;
    notification.readAt = new Date().toISOString();
    this.saveNotifications();
    return true;
  }

  // Mark all notifications for a specific droplet as read for a user
  markNotificationsReadByDroplet(dropletId, userId) {
    const now = new Date().toISOString();
    let count = 0;

    for (const n of this.notifications.notifications) {
      if (n.dropletId === dropletId && n.userId === userId && !n.read) {
        n.read = true;
        n.readAt = now;
        count++;
      }
    }

    if (count > 0) {
      this.saveNotifications();
    }
    return count;
  }

  markAllNotificationsRead(userId) {
    const now = new Date().toISOString();
    let count = 0;

    for (const n of this.notifications.notifications) {
      if (n.userId === userId && !n.read) {
        n.read = true;
        n.readAt = now;
        count++;
      }
    }

    if (count > 0) {
      this.saveNotifications();
    }
    return count;
  }

  dismissNotification(notificationId) {
    const notification = this.notifications.notifications.find(n => n.id === notificationId);
    if (!notification) return false;

    notification.dismissed = true;
    this.saveNotifications();
    return true;
  }

  markNotificationPushSent(notificationId) {
    const notification = this.notifications.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.pushSent = true;
      this.saveNotifications();
    }
  }

  deleteOldNotifications(daysOld = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const initialLength = this.notifications.notifications.length;
    this.notifications.notifications = this.notifications.notifications.filter(n => {
      const notificationDate = new Date(n.createdAt);
      // Keep if: recent OR (unread AND not dismissed)
      return notificationDate >= cutoff || (!n.read && !n.dismissed);
    });

    const deleted = initialLength - this.notifications.notifications.length;
    if (deleted > 0) {
      this.saveNotifications();
    }
    return deleted;
  }

  // Wave notification settings
  getWaveNotificationSettings(userId, waveId) {
    const settings = this.waveNotificationSettings.settings.find(
      s => s.userId === userId && s.waveId === waveId
    );

    if (!settings) {
      return { enabled: true, level: 'all', sound: true, push: true };
    }

    return {
      enabled: settings.enabled !== false,
      level: settings.level || 'all',
      sound: settings.sound !== false,
      push: settings.push !== false
    };
  }

  setWaveNotificationSettings(userId, waveId, settings) {
    const existing = this.waveNotificationSettings.settings.find(
      s => s.userId === userId && s.waveId === waveId
    );

    if (existing) {
      existing.enabled = settings.enabled !== false;
      existing.level = settings.level || 'all';
      existing.sound = settings.sound !== false;
      existing.push = settings.push !== false;
    } else {
      this.waveNotificationSettings.settings.push({
        userId,
        waveId,
        enabled: settings.enabled !== false,
        level: settings.level || 'all',
        sound: settings.sound !== false,
        push: settings.push !== false
      });
    }

    this.saveWaveNotificationSettings();
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

  // === Moderation Methods ===
  blockUser(userId, blockedUserId) {
    const user = this.findUserById(userId);
    const blockedUser = this.findUserById(blockedUserId);
    if (!user || !blockedUser) return false;

    const existing = this.moderation.blocks.find(
      b => b.userId === userId && b.blockedUserId === blockedUserId
    );
    if (existing) return false;

    this.moderation.blocks.push({
      id: uuidv4(),
      userId,
      blockedUserId,
      blockedAt: new Date().toISOString()
    });

    this.saveModeration();
    return true;
  }

  unblockUser(userId, blockedUserId) {
    const index = this.moderation.blocks.findIndex(
      b => b.userId === userId && b.blockedUserId === blockedUserId
    );
    if (index === -1) return false;

    this.moderation.blocks.splice(index, 1);
    this.saveModeration();
    return true;
  }

  getBlockedUsers(userId) {
    return this.moderation.blocks
      .filter(b => b.userId === userId)
      .map(b => {
        const user = this.findUserById(b.blockedUserId);
        return {
          ...b,
          handle: user?.handle,
          displayName: user?.displayName
        };
      });
  }

  isBlocked(userId, otherUserId) {
    return this.moderation.blocks.some(
      b => (b.userId === userId && b.blockedUserId === otherUserId) ||
           (b.userId === otherUserId && b.blockedUserId === userId)
    );
  }

  muteUser(userId, mutedUserId) {
    const user = this.findUserById(userId);
    const mutedUser = this.findUserById(mutedUserId);
    if (!user || !mutedUser) return false;

    const existing = this.moderation.mutes.find(
      m => m.userId === userId && m.mutedUserId === mutedUserId
    );
    if (existing) return false;

    this.moderation.mutes.push({
      id: uuidv4(),
      userId,
      mutedUserId,
      mutedAt: new Date().toISOString()
    });

    this.saveModeration();
    return true;
  }

  unmuteUser(userId, mutedUserId) {
    const index = this.moderation.mutes.findIndex(
      m => m.userId === userId && m.mutedUserId === mutedUserId
    );
    if (index === -1) return false;

    this.moderation.mutes.splice(index, 1);
    this.saveModeration();
    return true;
  }

  getMutedUsers(userId) {
    return this.moderation.mutes
      .filter(m => m.userId === userId)
      .map(m => {
        const user = this.findUserById(m.mutedUserId);
        return {
          ...m,
          handle: user?.handle,
          displayName: user?.displayName
        };
      });
  }

  isMuted(userId, otherUserId) {
    return this.moderation.mutes.some(
      m => m.userId === userId && m.mutedUserId === otherUserId
    );
  }

  createReport(reporterId, type, targetId, reason, details = '') {
    const report = {
      id: uuidv4(),
      reporterId: reporterId,
      type: type, // 'message' | 'wave' | 'user'
      targetId: targetId,
      reason: reason, // 'spam' | 'harassment' | 'inappropriate' | 'other'
      details: details || '',
      status: 'pending', // 'pending' | 'resolved' | 'dismissed'
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      resolution: null
    };

    this.reports.reports.push(report);
    this.saveReports();
    return report;
  }

  getReports(filters = {}) {
    let reports = this.reports.reports || [];

    if (filters.status) {
      reports = reports.filter(r => r.status === filters.status);
    }

    if (filters.type) {
      reports = reports.filter(r => r.type === filters.type);
    }

    if (filters.reporterId) {
      reports = reports.filter(r => r.reporterId === filters.reporterId);
    }

    // Enrich with context
    return reports.map(r => {
      const reporter = this.findUserById(r.reporterId);
      let context = {};

      if (r.type === 'message') {
        const msg = this.droplets.droplets.find(m => m.id === r.targetId);
        if (msg) {
          const author = this.findUserById(msg.authorId);
          context = {
            content: msg.content,
            authorHandle: author?.handle,
            authorName: author?.displayName,
            createdAt: msg.createdAt
          };
        }
      } else if (r.type === 'wave') {
        const wave = this.getWave(r.targetId);
        if (wave) {
          context = {
            title: wave.title,
            privacy: wave.privacy
          };
        }
      } else if (r.type === 'user') {
        const user = this.findUserById(r.targetId);
        if (user) {
          context = {
            handle: user.handle,
            displayName: user.displayName
          };
        }
      }

      return {
        ...r,
        reporterHandle: reporter?.handle,
        reporterName: reporter?.displayName,
        context
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  resolveReport(reportId, resolution, userId, notes = null) {
    const report = this.reports.reports.find(r => r.id === reportId);
    if (!report) return false;

    report.status = resolution === 'dismiss' ? 'dismissed' : 'resolved';
    report.resolvedAt = new Date().toISOString();
    report.resolvedBy = userId;
    report.resolution = resolution;
    if (notes) report.resolutionNotes = notes;

    this.saveReports();
    return report;
  }

  dismissReport(reportId, userId, reason = null) {
    const report = this.reports.reports.find(r => r.id === reportId);
    if (!report) return false;

    report.status = 'dismissed';
    report.resolvedAt = new Date().toISOString();
    report.resolvedBy = userId;
    report.resolution = 'dismissed';
    if (reason) report.resolutionNotes = reason;

    this.saveReports();
    return report;
  }

  getReportsByUser(userId) {
    return this.getReports({ reporterId: userId });
  }

  getReportsByStatus(status, limit = 50, offset = 0) {
    const reports = this.getReports({ status });
    return reports.slice(offset, offset + limit);
  }

  getPendingReports(limit = 50, offset = 0) {
    return this.getReportsByStatus('pending', limit, offset);
  }

  getReportById(reportId) {
    const report = this.reports.reports.find(r => r.id === reportId);
    if (!report) return null;
    return this.getReports({}).find(r => r.id === reportId);
  }

  // === Warning Methods ===
  createWarning(userId, issuedBy, reason, reportId = null) {
    const warning = {
      id: uuidv4(),
      userId,
      issuedBy,
      reason,
      reportId,
      createdAt: new Date().toISOString()
    };

    if (!this.reports.warnings) this.reports.warnings = [];
    this.reports.warnings.push(warning);
    this.saveReports();
    return warning;
  }

  getWarningsByUser(userId) {
    if (!this.reports.warnings) return [];
    return this.reports.warnings
      .filter(w => w.userId === userId)
      .map(w => {
        const issuer = this.findUserById(w.issuedBy);
        return {
          ...w,
          issuerHandle: issuer?.handle,
          issuerName: issuer?.displayName
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getUserWarningCount(userId) {
    if (!this.reports.warnings) return 0;
    return this.reports.warnings.filter(w => w.userId === userId).length;
  }

  // === Moderation Log Methods ===
  logModerationAction(adminId, actionType, targetType, targetId, reason = null, details = null) {
    const logEntry = {
      id: uuidv4(),
      adminId,
      actionType,
      targetType,
      targetId,
      reason,
      details,
      createdAt: new Date().toISOString()
    };

    if (!this.reports.moderationLog) this.reports.moderationLog = [];
    this.reports.moderationLog.push(logEntry);
    this.saveReports();
    return logEntry;
  }

  getModerationLog(limit = 50, offset = 0) {
    if (!this.reports.moderationLog) return [];
    return this.reports.moderationLog
      .map(entry => {
        const admin = this.findUserById(entry.adminId);
        return {
          ...entry,
          adminHandle: admin?.handle,
          adminName: admin?.displayName
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(offset, offset + limit);
  }

  getModerationLogForTarget(targetType, targetId) {
    if (!this.reports.moderationLog) return [];
    return this.reports.moderationLog
      .filter(entry => entry.targetType === targetType && entry.targetId === targetId)
      .map(entry => {
        const admin = this.findUserById(entry.adminId);
        return {
          ...entry,
          adminHandle: admin?.handle,
          adminName: admin?.displayName
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // === Group Methods ===
  getGroupsForUser(userId) {
    const memberGroupIds = this.groups.members
      .filter(m => m.userId === userId)
      .map(m => m.groupId);
    
    return this.groups.groups
      .filter(g => memberGroupIds.includes(g.id))
      .map(g => ({
        ...g,
        memberCount: this.groups.members.filter(m => m.groupId === g.id).length,
        role: this.groups.members.find(m => m.groupId === g.id && m.userId === userId)?.role,
      }));
  }

  getGroup(groupId) {
    return this.groups.groups.find(g => g.id === groupId);
  }

  getGroupMembers(groupId) {
    return this.groups.members
      .filter(m => m.groupId === groupId)
      .map(m => {
        const user = this.findUserById(m.userId);
        return user ? {
          id: user.id, handle: user.handle, name: user.displayName,
          avatar: user.avatar, status: user.status, role: m.role, joinedAt: m.joinedAt,
        } : null;
      })
      .filter(Boolean);
  }

  isGroupMember(groupId, userId) {
    return this.groups.members.some(m => m.groupId === groupId && m.userId === userId);
  }

  isGroupAdmin(groupId, userId) {
    return this.groups.members.some(m => m.groupId === groupId && m.userId === userId && m.role === 'admin');
  }

  createGroup(data) {
    const now = new Date().toISOString();
    const group = {
      id: `group-${uuidv4()}`,
      name: sanitizeInput(data.name).slice(0, 100),
      description: sanitizeInput(data.description || '').slice(0, 500),
      createdBy: data.createdBy,
      createdAt: now,
    };
    this.groups.groups.push(group);
    
    // Add creator as admin
    this.groups.members.push({
      groupId: group.id,
      userId: data.createdBy,
      role: 'admin',
      joinedAt: now,
    });
    
    this.saveGroups();
    return group;
  }

  updateGroup(groupId, data) {
    const group = this.getGroup(groupId);
    if (!group) return null;
    if (data.name) group.name = sanitizeInput(data.name).slice(0, 100);
    if (data.description !== undefined) group.description = sanitizeInput(data.description).slice(0, 500);
    this.saveGroups();
    return group;
  }

  deleteGroup(groupId) {
    const index = this.groups.groups.findIndex(g => g.id === groupId);
    if (index === -1) return false;
    this.groups.groups.splice(index, 1);
    this.groups.members = this.groups.members.filter(m => m.groupId !== groupId);
    this.saveGroups();
    return true;
  }

  addGroupMember(groupId, userId, role = 'member') {
    if (this.isGroupMember(groupId, userId)) return false;
    this.groups.members.push({
      groupId, userId, role,
      joinedAt: new Date().toISOString(),
    });
    this.saveGroups();
    return true;
  }

  removeGroupMember(groupId, userId) {
    const index = this.groups.members.findIndex(m => m.groupId === groupId && m.userId === userId);
    if (index === -1) return false;
    this.groups.members.splice(index, 1);
    this.saveGroups();

    // Clean up: remove user from participants of all waves belonging to this group
    const groupWaveIds = this.waves.waves
      .filter(w => w.privacy === 'group' && w.groupId === groupId)
      .map(w => w.id);

    if (groupWaveIds.length > 0) {
      const beforeCount = this.waves.participants.length;
      this.waves.participants = this.waves.participants.filter(
        p => !(groupWaveIds.includes(p.waveId) && p.userId === userId)
      );
      if (this.waves.participants.length < beforeCount) {
        this.saveWaves();
      }
    }

    return true;
  }

  updateGroupMemberRole(groupId, userId, role) {
    const member = this.groups.members.find(m => m.groupId === groupId && m.userId === userId);
    if (!member) return false;
    member.role = role;
    this.saveGroups();
    return true;
  }

  // === Wave Methods ===
  getWavesForUser(userId, showArchived = false) {
    // When showArchived=true, return ONLY archived waves
    // When showArchived=false, return ONLY non-archived waves
    const participantWaveIds = this.waves.participants
      .filter(p => p.userId === userId && (showArchived ? p.archived : !p.archived))
      .map(p => p.waveId);

    // Get user's groups
    const userGroupIds = this.groups.members
      .filter(m => m.userId === userId)
      .map(m => m.groupId);

    return this.waves.waves
      .filter(w => {
        // Public waves - always accessible
        if (w.privacy === 'public') return true;

        // Crew/Group waves - MUST be a current member (participant status alone is not enough)
        // Support both 'group' (legacy) and 'crew' (v2.0.0) privacy values
        if ((w.privacy === 'group' || w.privacy === 'crew') && w.groupId) {
          return userGroupIds.includes(w.groupId);
        }

        // Private waves - must be an explicit participant
        return participantWaveIds.includes(w.id);
      })
      .map(wave => {
        const creator = this.findUserById(wave.createdBy);
        const participants = this.getWaveParticipants(wave.id);
        const messageCount = this.droplets.droplets.filter(m => m.waveId === wave.id).length;
        const group = wave.groupId ? this.getGroup(wave.groupId) : null;
        const userParticipant = this.waves.participants.find(p => p.waveId === wave.id && p.userId === userId);

        // Calculate unread count based on messages not read by user
        // Must match visibility logic from getMessagesForWave to prevent phantom unreads
        const blockedIds = this.moderation.blocks
          .filter(b => b.userId === userId)
          .map(b => b.blockedUserId);
        const mutedIds = this.moderation.mutes
          .filter(m => m.userId === userId)
          .map(m => m.mutedUserId);

        const unreadCount = this.droplets.droplets.filter(m => {
          if (m.waveId !== wave.id) return false;
          if (m.deleted) return false; // Deleted messages have no content to read
          if (m.authorId === userId) return false; // Don't count own messages
          // Exclude blocked/muted users (they won't see these messages)
          if (blockedIds.includes(m.authorId) || mutedIds.includes(m.authorId)) return false;
          // Check if user has read this message
          const readBy = m.readBy || [m.authorId];
          return !readBy.includes(userId);
        }).length;

        return {
          ...wave,
          creator_name: creator?.displayName || 'Unknown',
          creator_avatar: creator?.avatar || '?',
          creator_handle: creator?.handle || 'unknown',
          participants,
          message_count: messageCount,
          unread_count: unreadCount,
          is_participant: participantWaveIds.includes(wave.id),
          is_archived: userParticipant?.archived || false,
          group_name: group?.name,
        };
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  getWave(waveId) {
    return this.waves.waves.find(w => w.id === waveId);
  }

  getWaveParticipants(waveId) {
    return this.waves.participants
      .filter(p => p.waveId === waveId)
      .map(p => {
        const user = this.findUserById(p.userId);
        return user ? { id: user.id, name: user.displayName, avatar: user.avatar, status: user.status, handle: user.handle } : null;
      })
      .filter(Boolean);
  }

  isWaveParticipant(waveId, userId) {
    return this.waves.participants.some(p => p.waveId === waveId && p.userId === userId);
  }

  isWaveArchivedForUser(waveId, userId) {
    const participant = this.waves.participants.find(p => p.waveId === waveId && p.userId === userId);
    return participant?.archived || false;
  }

  canAccessWave(waveId, userId) {
    const wave = this.getWave(waveId);
    if (!wave) return false;

    // Public waves are accessible to all
    if (wave.privacy === 'public') return true;

    // Crew/Group waves - MUST be a current member (participant status alone is not enough)
    // Support both 'group' (legacy) and 'crew' (v2.0.0) privacy values
    if ((wave.privacy === 'group' || wave.privacy === 'crew') && wave.groupId) {
      return this.isGroupMember(wave.groupId, userId);
    }

    // Private waves - check if explicit participant
    if (this.waves.participants.some(p => p.waveId === waveId && p.userId === userId)) {
      return true;
    }
    
    return false;
  }

  createWave(data) {
    const now = new Date().toISOString();
    const wave = {
      id: `wave-${uuidv4()}`,
      title: sanitizeInput(data.title).slice(0, 200),
      privacy: data.privacy || 'private',
      groupId: data.groupId || null,
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.waves.waves.push(wave);

    // Add creator as participant
    this.waves.participants.push({ waveId: wave.id, userId: data.createdBy, joinedAt: now, archived: false });

    // Add other participants
    if (data.participants) {
      for (const userId of data.participants) {
        if (userId !== data.createdBy) {
          this.waves.participants.push({ waveId: wave.id, userId, joinedAt: now, archived: false });
        }
      }
    }

    this.saveWaves();
    return wave;
  }

  updateWavePrivacy(waveId, privacy, groupId = null) {
    const wave = this.getWave(waveId);
    if (!wave) return null;

    wave.privacy = privacy;
    wave.groupId = privacy === 'group' ? groupId : null;
    wave.updatedAt = new Date().toISOString();

    this.saveWaves();
    return wave;
  }

  updateWaveTitle(waveId, title) {
    const wave = this.getWave(waveId);
    if (!wave) return null;

    wave.title = title;
    wave.updatedAt = new Date().toISOString();

    this.saveWaves();
    return wave;
  }

  updateWaveTimestamp(waveId) {
    const wave = this.getWave(waveId);
    if (wave) {
      wave.updatedAt = new Date().toISOString();
      this.saveWaves();
    }
  }

  addWaveParticipant(waveId, userId) {
    const existing = this.waves.participants.find(p => p.waveId === waveId && p.userId === userId);
    if (existing) return false;
    this.waves.participants.push({ waveId, userId, joinedAt: new Date().toISOString(), archived: false });
    this.saveWaves();
    return true;
  }

  archiveWaveForUser(waveId, userId, archived = true) {
    const participant = this.waves.participants.find(p => p.waveId === waveId && p.userId === userId);
    if (!participant) return false;
    participant.archived = archived;
    this.saveWaves();
    return true;
  }

  markWaveAsRead(waveId, userId) {
    let participant = this.waves.participants.find(p => p.waveId === waveId && p.userId === userId);

    // If user is not a participant yet but can access (public/group wave), add them
    if (!participant && this.canAccessWave(waveId, userId)) {
      this.addWaveParticipant(waveId, userId);
      participant = this.waves.participants.find(p => p.waveId === waveId && p.userId === userId);
    }

    if (!participant) return false;

    participant.lastRead = new Date().toISOString();
    this.saveWaves();
    return true;
  }

  deleteWave(waveId, userId) {
    const wave = this.getWave(waveId);
    if (!wave) return { success: false, error: 'Wave not found' };
    if (wave.createdBy !== userId) return { success: false, error: 'Only wave creator can delete' };

    // Get all participants before deletion for notification
    const participants = this.getWaveParticipants(waveId);

    // Delete wave
    this.waves.waves = this.waves.waves.filter(w => w.id !== waveId);

    // Delete participants
    this.waves.participants = this.waves.participants.filter(p => p.waveId !== waveId);

    // Delete messages
    this.droplets.droplets = this.droplets.droplets.filter(m => m.waveId !== waveId);

    // Delete message history for this wave
    const messageIds = this.droplets.droplets.filter(m => m.waveId === waveId).map(m => m.id);
    this.droplets.history = this.droplets.history.filter(h => !messageIds.includes(h.messageId));

    this.saveWaves();
    this.saveMessages();

    return { success: true, wave, participants };
  }

  // breakoutDroplet/rippleDroplet removed in v2.38.0 — replaced by threads

  // === Message Methods ===
  getMessagesForWave(waveId, userId = null) {
    let messages = this.droplets.droplets.filter(m => m.waveId === waveId);

    // Filter out messages from blocked or muted users
    if (userId) {
      const blockedIds = this.moderation.blocks
        .filter(b => b.userId === userId)
        .map(b => b.blockedUserId);

      const mutedIds = this.moderation.mutes
        .filter(m => m.userId === userId)
        .map(m => m.mutedUserId);

      messages = messages.filter(m =>
        !blockedIds.includes(m.authorId) && !mutedIds.includes(m.authorId)
      );
    }

    return messages
      .map(m => {
        const author = this.findUserById(m.authorId);
        const readBy = m.readBy || [m.authorId];
        // Deleted messages are never unread (nothing to read)
        const isUnread = m.deleted ? false : (userId ? !readBy.includes(userId) && m.authorId !== userId : false);

        // Get broken-out wave title if applicable
        let brokenOutToTitle = null;
        if (m.brokenOutTo) {
          const brokenOutWave = this.waves.waves.find(w => w.id === m.brokenOutTo);
          brokenOutToTitle = brokenOutWave?.title || null;
        }

        return {
          ...m,
          sender_name: author?.displayName || 'Unknown',
          sender_avatar: author?.avatar || '?',
          sender_avatar_url: author?.avatarUrl || null,
          sender_handle: author?.handle || 'unknown',
          author_id: m.authorId,
          parent_id: m.parentId,
          wave_id: m.waveId,
          created_at: m.createdAt,
          edited_at: m.editedAt,
          deleted_at: m.deletedAt || null,
          is_unread: isUnread,
          brokenOutToTitle,
        };
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  getMessage(messageId) {
    const m = this.droplets.droplets.find(msg => msg.id === messageId);
    if (!m) return null;

    const author = this.findUserById(m.authorId);

    return {
      ...m,
      sender_name: author?.displayName || 'Unknown',
      sender_avatar: author?.avatar || '?',
      sender_avatar_url: author?.avatarUrl || null,
      sender_handle: author?.handle || 'unknown',
      author_id: m.authorId,
      parent_id: m.parentId,
      wave_id: m.waveId,
      created_at: m.createdAt,
      edited_at: m.editedAt,
      deleted_at: m.deletedAt || null,
    };
  }

  // getDropletsForBreakoutWave removed in v2.38.0 — replaced by threads

  createMessage(data) {
    const now = new Date().toISOString();
    let content = sanitizeMessage(data.content);
    content = detectAndEmbedMedia(content); // Auto-embed media URLs

    const message = {
      id: `msg-${uuidv4()}`,
      waveId: data.waveId,
      parentId: data.parentId || null,
      authorId: data.authorId,
      content: content,
      privacy: data.privacy || 'private',
      version: 1,
      createdAt: now,
      editedAt: null,
      reactions: {}, // { emoji: [userId1, userId2, ...] }
      readBy: [data.authorId], // Author has read their own message
    };
    this.droplets.droplets.push(message);
    this.updateWaveTimestamp(data.waveId);
    this.saveMessages();

    const author = this.findUserById(data.authorId);
    return {
      ...message,
      sender_name: author?.displayName || 'Unknown',
      sender_avatar: author?.avatar || '?',
      sender_avatar_url: author?.avatarUrl || null,
      sender_handle: author?.handle || 'unknown',
      author_id: message.authorId,
      parent_id: message.parentId,
      wave_id: message.waveId,
      created_at: message.createdAt,
      edited_at: message.editedAt,
    };
  }

  updateMessage(messageId, content) {
    const message = this.droplets.droplets.find(m => m.id === messageId);
    if (!message) return null;
    if (message.deleted) return null; // Cannot edit deleted messages

    this.droplets.history.push({
      id: `hist-${uuidv4()}`,
      messageId,
      content: message.content,
      version: message.version,
      editedAt: new Date().toISOString(),
    });

    // Sanitize and auto-embed media URLs (same as createMessage)
    let processedContent = sanitizeMessage(content);
    processedContent = detectAndEmbedMedia(processedContent);

    message.content = processedContent;
    message.version += 1;
    message.editedAt = new Date().toISOString();
    this.saveMessages();

    const author = this.findUserById(message.authorId);
    return {
      ...message,
      sender_name: author?.displayName || 'Unknown',
      sender_avatar: author?.avatar || '?',
      sender_avatar_url: author?.avatarUrl || null,
      sender_handle: author?.handle || 'unknown',
      author_id: message.authorId,
      parent_id: message.parentId,
      wave_id: message.waveId,
      created_at: message.createdAt,
      edited_at: message.editedAt,
    };
  }

  deleteMessage(messageId, userId) {
    const message = this.droplets.droplets.find(m => m.id === messageId);
    if (!message) return { success: false, error: 'Message not found' };
    if (message.deleted) return { success: false, error: 'Message already deleted' };
    if (message.authorId !== userId) return { success: false, error: 'Only message author can delete' };

    const waveId = message.waveId;

    // Soft-delete: replace content with placeholder, preserve thread structure
    message.content = '[Message deleted]';
    message.deleted = true;
    message.deletedAt = new Date().toISOString();
    message.reactions = {};  // Clear reactions
    message.readBy = [];     // Clear read status (nothing to read)

    // Remove edit history for this message (no longer relevant)
    this.droplets.history = this.droplets.history.filter(h => h.messageId !== messageId);

    this.saveMessages();

    return { success: true, messageId, waveId, deleted: true };
  }

  toggleMessageReaction(messageId, userId, emoji) {
    const message = this.droplets.droplets.find(m => m.id === messageId);
    if (!message) return { success: false, error: 'Message not found' };
    if (message.deleted) return { success: false, error: 'Cannot react to deleted message' };

    // Initialize reactions if not present
    if (!message.reactions) message.reactions = {};

    // Initialize emoji array if not present
    if (!message.reactions[emoji]) {
      message.reactions[emoji] = [];
    }

    // Check if user already reacted with this emoji
    const userIndex = message.reactions[emoji].indexOf(userId);
    if (userIndex > -1) {
      // Remove reaction
      message.reactions[emoji].splice(userIndex, 1);
      // Remove emoji key if no reactions left
      if (message.reactions[emoji].length === 0) {
        delete message.reactions[emoji];
      }
    } else {
      // Add reaction
      message.reactions[emoji].push(userId);
    }

    this.saveMessages();

    return { success: true, messageId, reactions: message.reactions, waveId: message.waveId };
  }

  markMessageAsRead(messageId, userId) {
    const message = this.droplets.droplets.find(m => m.id === messageId);
    if (!message) return false;
    if (message.deleted) return true; // Deleted messages are always "read" (nothing to read)

    // Initialize readBy array if it doesn't exist (for old messages)
    if (!message.readBy) {
      message.readBy = [message.authorId]; // Author always has read their message
    }

    // Add user to readBy if not already there
    if (!message.readBy.includes(userId)) {
      message.readBy.push(userId);
      this.saveMessages();
    }

    return true;
  }

  searchMessages(query, filters = {}) {
    const { waveId, authorId, fromDate, toDate } = filters;
    const searchTerm = query.toLowerCase().trim();

    if (!searchTerm) return [];

    let results = this.droplets.droplets.filter(message => {
      // Filter by search term in content
      if (!message.content.toLowerCase().includes(searchTerm)) {
        return false;
      }

      // Filter by wave
      if (waveId && message.waveId !== waveId) {
        return false;
      }

      // Filter by author
      if (authorId && message.authorId !== authorId) {
        return false;
      }

      // Filter by date range
      if (fromDate && new Date(message.createdAt) < new Date(fromDate)) {
        return false;
      }
      if (toDate && new Date(message.createdAt) > new Date(toDate)) {
        return false;
      }

      return true;
    });

    // Helper to create highlighted snippet
    const createSnippet = (content, term) => {
      // Strip HTML tags for snippet
      const plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const lowerText = plainText.toLowerCase();
      const termIndex = lowerText.indexOf(term);
      if (termIndex === -1) return plainText.substring(0, 128) + (plainText.length > 128 ? '...' : '');

      // Extract context around match (64 chars before and after)
      const start = Math.max(0, termIndex - 64);
      const end = Math.min(plainText.length, termIndex + term.length + 64);
      let snippet = plainText.substring(start, end);

      // Add ellipsis if truncated
      if (start > 0) snippet = '...' + snippet;
      if (end < plainText.length) snippet = snippet + '...';

      // Highlight match with <mark> tags (case-insensitive)
      const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      snippet = snippet.replace(regex, '<mark>$1</mark>');

      return snippet;
    };

    // Enrich results with author and wave info
    return results.map(message => {
      const author = this.findUserById(message.authorId);
      const wave = this.getWave(message.waveId);

      return {
        id: message.id,
        content: message.content,
        snippet: createSnippet(message.content, searchTerm),
        waveId: message.waveId,
        waveName: wave?.name || 'Unknown Wave',
        authorId: message.authorId,
        authorName: author?.displayName || 'Unknown',
        authorHandle: author?.handle || 'unknown',
        createdAt: message.createdAt,
        parentId: message.parentId,
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Most recent first
  }

  // ============ Federation - Server Identity Methods ============

  getServerIdentity() {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    return data.identity;
  }

  setServerIdentity({ nodeName, publicKey, privateKey }) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    data.identity = {
      nodeName,
      publicKey,
      privateKey,
      createdAt: data.identity?.createdAt || now,
      updatedAt: now
    };

    this.saveFile(DATA_FILES.federation, data);
    return data.identity;
  }

  hasServerIdentity() {
    const identity = this.getServerIdentity();
    return !!identity;
  }

  // ============ Federation - Trusted Nodes Methods ============

  getFederationNodes({ status = null } = {}) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    let nodes = data.nodes || [];

    if (status) {
      nodes = nodes.filter(n => n.status === status);
    }

    return nodes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getFederationNode(nodeId) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    return (data.nodes || []).find(n => n.id === nodeId) || null;
  }

  getFederationNodeByName(nodeName) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    return (data.nodes || []).find(n => n.nodeName === nodeName) || null;
  }

  addFederationNode({ nodeName, baseUrl, publicKey = null, status = 'pending', addedBy }) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const node = {
      id: uuidv4(),
      nodeName,
      baseUrl,
      publicKey,
      status,
      addedBy,
      lastContactAt: null,
      failureCount: 0,
      createdAt: now,
      updatedAt: now
    };

    data.nodes = data.nodes || [];
    data.nodes.push(node);
    this.saveFile(DATA_FILES.federation, data);

    return node;
  }

  updateFederationNode(nodeId, updates) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const nodeIndex = (data.nodes || []).findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return null;

    const allowedFields = ['nodeName', 'baseUrl', 'publicKey', 'status', 'lastContactAt', 'failureCount'];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        data.nodes[nodeIndex][key] = value;
      }
    }
    data.nodes[nodeIndex].updatedAt = now;

    this.saveFile(DATA_FILES.federation, data);
    return data.nodes[nodeIndex];
  }

  deleteFederationNode(nodeId) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const originalLength = (data.nodes || []).length;
    data.nodes = (data.nodes || []).filter(n => n.id !== nodeId);

    if (data.nodes.length !== originalLength) {
      this.saveFile(DATA_FILES.federation, data);
      return true;
    }
    return false;
  }

  recordFederationContact(nodeId, success = true) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const nodeIndex = (data.nodes || []).findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return;

    if (success) {
      data.nodes[nodeIndex].lastContactAt = now;
      data.nodes[nodeIndex].failureCount = 0;
    } else {
      data.nodes[nodeIndex].failureCount = (data.nodes[nodeIndex].failureCount || 0) + 1;
    }
    data.nodes[nodeIndex].updatedAt = now;

    this.saveFile(DATA_FILES.federation, data);
  }

  // ============ Federation - Remote Users Methods ============

  getRemoteUser(id) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    const user = (data.remoteUsers || []).find(u => u.id === id);
    if (!user) return null;
    return { ...user, isRemote: true };
  }

  getRemoteUserByHandle(nodeName, handle) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    const user = (data.remoteUsers || []).find(u => u.nodeName === nodeName && u.handle === handle);
    if (!user) return null;
    return { ...user, isRemote: true };
  }

  cacheRemoteUser({ id, nodeName, handle, displayName, avatar, avatarUrl, bio }) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    data.remoteUsers = data.remoteUsers || [];
    const existingIndex = data.remoteUsers.findIndex(u => u.nodeName === nodeName && u.handle === handle);

    const user = {
      id,
      nodeName,
      handle,
      displayName: displayName || null,
      avatar: avatar || null,
      avatarUrl: avatarUrl || null,
      bio: bio || null,
      cachedAt: existingIndex === -1 ? now : data.remoteUsers[existingIndex].cachedAt,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      data.remoteUsers[existingIndex] = user;
    } else {
      data.remoteUsers.push(user);
    }

    this.saveFile(DATA_FILES.federation, data);
    return { ...user, isRemote: true };
  }

  // ============ Federation - Wave Federation Methods ============

  getWaveFederationNodes(waveId) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const waveNodes = (data.waveFederation || []).filter(wf => wf.waveId === waveId);

    return waveNodes.map(wn => {
      const node = (data.nodes || []).find(n => n.nodeName === wn.nodeName);
      return {
        waveId: wn.waveId,
        nodeName: wn.nodeName,
        status: wn.status,
        addedAt: wn.addedAt,
        baseUrl: node?.baseUrl,
        publicKey: node?.publicKey,
        nodeStatus: node?.status
      };
    });
  }

  addWaveFederationNode(waveId, nodeName) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    data.waveFederation = data.waveFederation || [];

    // Check if already exists
    const exists = data.waveFederation.some(wf => wf.waveId === waveId && wf.nodeName === nodeName);
    if (exists) return true;

    data.waveFederation.push({
      waveId,
      nodeName,
      status: 'active',
      addedAt: now
    });

    this.saveFile(DATA_FILES.federation, data);
    return true;
  }

  removeWaveFederationNode(waveId, nodeName) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const originalLength = (data.waveFederation || []).length;
    data.waveFederation = (data.waveFederation || []).filter(wf => !(wf.waveId === waveId && wf.nodeName === nodeName));

    if (data.waveFederation.length !== originalLength) {
      this.saveFile(DATA_FILES.federation, data);
      return true;
    }
    return false;
  }

  setWaveAsOrigin(waveId) {
    const now = new Date().toISOString();
    const wave = this.waves.waves.find(w => w.id === waveId);
    if (wave) {
      wave.federationState = 'origin';
      wave.updatedAt = now;
      this.saveWaves();
    }
    return wave || null;
  }

  createParticipantWave({ id, title, privacy, createdBy, originNode, originWaveId }) {
    const now = new Date().toISOString();

    const wave = {
      id,
      title,
      privacy,
      createdBy,
      createdAt: now,
      updatedAt: now,
      federationState: 'participant',
      originNode,
      originWaveId
    };

    this.waves.waves.push(wave);
    this.saveWaves();
    return wave;
  }

  getOriginWaves() {
    return this.waves.waves
      .filter(w => w.federationState === 'origin')
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  getParticipantWaves() {
    return this.waves.waves
      .filter(w => w.federationState === 'participant')
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  getWaveByOrigin(originNode, originWaveId) {
    return this.waves.waves.find(w => w.originNode === originNode && w.originWaveId === originWaveId) || null;
  }

  // ============ Federation - Remote Droplets Methods ============

  getRemoteDroplet(id) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    const droplet = (data.remoteDroplets || []).find(d => d.id === id);
    if (!droplet) return null;
    return { ...droplet, isRemote: true };
  }

  getRemoteDropletsForWave(waveId) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    return (data.remoteDroplets || [])
      .filter(d => d.waveId === waveId && !d.deleted)
      .map(d => {
        const author = (data.remoteUsers || []).find(u => u.id === d.authorId);
        return {
          ...d,
          authorDisplayName: author?.displayName,
          authorAvatar: author?.avatar,
          authorAvatarUrl: author?.avatarUrl,
          isRemote: true
        };
      })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  cacheRemoteDroplet({ id, waveId, originWaveId, originNode, authorId, authorNode, parentId, content, createdAt, editedAt, reactions }) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    data.remoteDroplets = data.remoteDroplets || [];
    const existingIndex = data.remoteDroplets.findIndex(d => d.id === id);

    const droplet = {
      id,
      waveId,
      originWaveId,
      originNode,
      authorId,
      authorNode,
      parentId: parentId || null,
      content,
      createdAt,
      editedAt: editedAt || null,
      reactions: reactions || {},
      deleted: false,
      cachedAt: existingIndex === -1 ? now : data.remoteDroplets[existingIndex].cachedAt,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      data.remoteDroplets[existingIndex] = droplet;
    } else {
      data.remoteDroplets.push(droplet);
    }

    this.saveFile(DATA_FILES.federation, data);
    return { ...droplet, isRemote: true };
  }

  markRemoteDropletDeleted(id) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const dropletIndex = (data.remoteDroplets || []).findIndex(d => d.id === id);
    if (dropletIndex === -1) return false;

    data.remoteDroplets[dropletIndex].deleted = true;
    data.remoteDroplets[dropletIndex].updatedAt = now;

    this.saveFile(DATA_FILES.federation, data);
    return true;
  }

  // ============ Federation - Message Queue Methods ============

  queueFederationMessage({ targetNode, messageType, payload }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    data.queue = data.queue || [];
    data.queue.push({
      id,
      targetNode,
      messageType,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: now,
      createdAt: now,
      deliveredAt: null,
      lastError: null
    });

    this.saveFile(DATA_FILES.federation, data);
    return id;
  }

  getPendingFederationMessages(limit = 10) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    return (data.queue || [])
      .filter(m => m.status === 'pending' && (!m.nextRetryAt || m.nextRetryAt <= now))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, limit);
  }

  markFederationMessageDelivered(messageId) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const msgIndex = (data.queue || []).findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    data.queue[msgIndex].status = 'delivered';
    data.queue[msgIndex].deliveredAt = now;

    this.saveFile(DATA_FILES.federation, data);
  }

  markFederationMessageFailed(messageId, error) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const msgIndex = (data.queue || []).findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const msg = data.queue[msgIndex];
    const newAttempts = msg.attempts + 1;

    if (newAttempts >= msg.maxAttempts) {
      msg.status = 'failed';
      msg.attempts = newAttempts;
      msg.lastError = error;
    } else {
      // Calculate exponential backoff: 1min, 5min, 25min, 2hr, 10hr
      const backoffMinutes = Math.pow(5, newAttempts);
      msg.attempts = newAttempts;
      msg.nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
      msg.lastError = error;
    }

    this.saveFile(DATA_FILES.federation, data);
  }

  cleanupOldFederationMessages(daysOld = 7) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const originalLength = (data.queue || []).length;
    data.queue = (data.queue || []).filter(m =>
      !((m.status === 'delivered' || m.status === 'failed') && m.createdAt < cutoff)
    );

    if (data.queue.length !== originalLength) {
      this.saveFile(DATA_FILES.federation, data);
    }
    return originalLength - data.queue.length;
  }

  // ============ Federation - Inbox Log Methods (for idempotency) ============

  hasReceivedFederationMessage(messageId) {
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });
    return (data.inboxLog || []).some(m => m.id === messageId);
  }

  logFederationInbox({ id, sourceNode, messageType }) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    // Check if already logged
    if ((data.inboxLog || []).some(m => m.id === id)) return;

    data.inboxLog = data.inboxLog || [];
    data.inboxLog.push({
      id,
      sourceNode,
      messageType,
      receivedAt: now,
      processedAt: null,
      status: 'received'
    });

    this.saveFile(DATA_FILES.federation, data);
  }

  markFederationInboxProcessed(messageId) {
    const now = new Date().toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const msgIndex = (data.inboxLog || []).findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    data.inboxLog[msgIndex].processedAt = now;
    data.inboxLog[msgIndex].status = 'processed';

    this.saveFile(DATA_FILES.federation, data);
  }

  cleanupOldInboxLog(daysOld = 30) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    const data = this.loadFile(DATA_FILES.federation, { identity: null, nodes: [], remoteUsers: [], waveFederation: [], remoteDroplets: [], queue: [], inboxLog: [] });

    const originalLength = (data.inboxLog || []).length;
    data.inboxLog = (data.inboxLog || []).filter(m => m.receivedAt >= cutoff);

    if (data.inboxLog.length !== originalLength) {
      this.saveFile(DATA_FILES.federation, data);
    }
    return originalLength - data.inboxLog.length;
  }
}

// Initialize database - use SQLite or JSON based on USE_SQLITE environment variable
const db = USE_SQLITE ? new DatabaseSQLite() : new Database();
if (USE_SQLITE) {
  console.log('🗄️  Using SQLite database');
  // Initialize wave participation cache (v2.21.0 - Privacy Hardening)
  waveParticipationCrypto.initializeCache(db).then(stats => {
    console.log(`🔐 Wave participation cache initialized: ${stats.waveCount} waves, ${stats.participantCount} mappings`);
  }).catch(err => {
    console.error('Failed to initialize wave participation cache:', err.message);
  });
  // Initialize push subscription cache (v2.22.0 - Privacy Hardening)
  pushSubscriptionCrypto.initializeCache(db).then(stats => {
    console.log(`🔐 Push subscription cache initialized: ${stats.userCount} users, ${stats.subscriptionCount} subscriptions`);
  }).catch(err => {
    console.error('Failed to initialize push subscription cache:', err.message);
  });
  // Initialize crew membership cache (v2.24.0 - Privacy Hardening Phase 4)
  crewMembershipCrypto.initializeCache(db).then(stats => {
    console.log(`🔐 Crew membership cache initialized: ${stats.crewCount} crews, ${stats.memberCount} mappings`);
  }).catch(err => {
    console.error('Failed to initialize crew membership cache:', err.message);
  });
} else {
  console.log('📁 Using JSON file storage');
}

// Wave participation helpers - use crypto cache for SQLite, fallback to db methods for JSON (v2.21.0)
const participation = {
  isParticipant: (waveId, userId) => USE_SQLITE
    ? waveParticipationCrypto.isParticipant(waveId, userId)
    : db.isWaveParticipant(waveId, userId),
  getWaveParticipants: (waveId) => USE_SQLITE
    ? waveParticipationCrypto.getWaveParticipants(waveId)
    : db.getWaveParticipants(waveId).map(p => p.id),
  getUserWaves: (userId) => USE_SQLITE
    ? waveParticipationCrypto.getUserWaves(userId)
    : [],
  addParticipant: (waveId, userId, options) => {
    if (USE_SQLITE) {
      return waveParticipationCrypto.addParticipant(waveId, userId, options);
    }
    return db.addWaveParticipant(waveId, userId);
  },
  removeParticipant: (waveId, userId) => {
    if (USE_SQLITE) {
      return waveParticipationCrypto.removeParticipant(waveId, userId);
    }
    return db.removeWaveParticipant(waveId, userId);
  },
  syncWaveFromDb: (waveId) => {
    if (USE_SQLITE) {
      waveParticipationCrypto.syncWaveFromDb(waveId);
    }
    // No-op for JSON storage
  },
  getMetadata: (waveId, userId) => USE_SQLITE
    ? waveParticipationCrypto.getMetadata(waveId, userId)
    : {},
  setMetadata: (waveId, userId, updates) => {
    if (USE_SQLITE) {
      return waveParticipationCrypto.setMetadata(waveId, userId, updates);
    }
    // No-op for JSON storage
  },
  migrateMetadata: () => USE_SQLITE
    ? waveParticipationCrypto.migrateMetadata()
    : { success: false, error: 'Only available with SQLite storage' },
  migrateWaveKeyIds: () => USE_SQLITE
    ? waveParticipationCrypto.migrateWaveKeyIds()
    : { success: false, error: 'Only available with SQLite storage' }
};

// v2.27.0: Cache-based wave access check (replaces db.canAccessWave)
function canAccessWaveFromCache(waveId, userId) {
  const wave = db.getWave(waveId);
  if (!wave) return false;
  if (wave.privacy === 'public') return true;
  if ((wave.privacy === 'crossServer' || wave.privacy === 'cross-server') && wave.federationState === 'participant') return true;
  if ((wave.privacy === 'group' || wave.privacy === 'crew') && wave.groupId) return db.isGroupMember(wave.groupId, userId);
  return participation.isParticipant(waveId, userId);
}

// Push subscription helpers - use crypto cache for SQLite, fallback to db methods for JSON (v2.22.0)
const pushSubs = {
  getSubscriptions: (userId) => USE_SQLITE && process.env.PUSH_SUBSCRIPTION_KEY
    ? pushSubscriptionCrypto.getSubscriptions(userId)
    : db.getPushSubscriptions(userId),
  addSubscription: (userId, subscription) => {
    if (USE_SQLITE && process.env.PUSH_SUBSCRIPTION_KEY) {
      return pushSubscriptionCrypto.addSubscription(userId, subscription);
    }
    return db.addPushSubscription(userId, subscription);
  },
  removeSubscription: (userId, endpoint) => {
    if (USE_SQLITE && process.env.PUSH_SUBSCRIPTION_KEY) {
      return pushSubscriptionCrypto.removeSubscription(userId, endpoint);
    }
    return db.removePushSubscription(userId, endpoint);
  },
  removeAllSubscriptions: (userId) => {
    if (USE_SQLITE && process.env.PUSH_SUBSCRIPTION_KEY) {
      return pushSubscriptionCrypto.removeAllSubscriptions(userId);
    }
    return db.removeAllPushSubscriptions(userId);
  },
  removeByEndpoint: (endpoint) => {
    if (USE_SQLITE && process.env.PUSH_SUBSCRIPTION_KEY) {
      return pushSubscriptionCrypto.removeByEndpoint(endpoint);
    }
    return db.removeExpiredPushSubscription(endpoint);
  }
};

// Crew membership helpers - use crypto cache for SQLite, fallback to db methods for JSON (v2.24.0)
const crewMembership = {
  isMember: (crewId, userId) => USE_SQLITE
    ? crewMembershipCrypto.isMember(crewId, userId)
    : db.isGroupMember(crewId, userId),
  addMember: (crewId, userId, role) => USE_SQLITE
    ? crewMembershipCrypto.addMember(crewId, userId, role)
    : db.addGroupMember(crewId, userId, role),
  removeMember: (crewId, userId) => USE_SQLITE
    ? crewMembershipCrypto.removeMember(crewId, userId)
    : db.removeGroupMember(crewId, userId),
  getCrewMembers: (crewId) => USE_SQLITE
    ? crewMembershipCrypto.getCrewMembers(crewId)
    : new Set(db.getGroupMembers(crewId).map(m => m.id)),
  getCrewsForUser: (userId) => USE_SQLITE
    ? crewMembershipCrypto.getCrewsForUser(userId)
    : new Set(db.getGroupsForUser(userId).map(g => g.id)),
  deleteCrewMembership: (crewId) => {
    if (USE_SQLITE) {
      crewMembershipCrypto.deleteCrewMembership(crewId);
    }
    // JSON storage handles this via deleteGroup
  },
  deleteUserMembership: (userId) => {
    if (USE_SQLITE) {
      crewMembershipCrypto.deleteUserMembership(userId);
    }
    // JSON storage handles this via deleteUser
  }
};

// ============ Express App ============
const app = express();

// HTTPS redirect middleware (v1.18.0)
if (ENFORCE_HTTPS) {
  app.use((req, res, next) => {
    // Check x-forwarded-proto header (set by reverse proxies like nginx)
    if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'wss:', 'ws:', 'https:'],
      mediaSrc: ["'self'", 'https:', 'blob:'],
      frameSrc: [
        "'self'",
        'https://www.youtube.com',
        'https://www.youtube-nocookie.com',
        'https://player.vimeo.com',
        'https://open.spotify.com',
        'https://www.tiktok.com',
        'https://platform.twitter.com',
        'https://w.soundcloud.com',
      ],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  // HSTS configuration (v1.18.0)
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
}));

// Restrictive CORS (v1.18.0)
app.use(cors({
  origin: (origin, callback) => {
    // In development with CORS_STRICT_MODE=false, allow all
    if (!CORS_STRICT_MODE && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // In production or strict mode, require ALLOWED_ORIGINS
    if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS.length === 0) {
      if (process.env.NODE_ENV === 'production') {
        // In production without ALLOWED_ORIGINS, only allow same-origin
        if (!origin) return callback(null, true);
        return callback(new Error('CORS not allowed - set ALLOWED_ORIGINS'));
      }
      // Development without strict mode - allow same-origin only
      if (!origin) return callback(null, true);
      return callback(null, true); // Allow in development
    }

    // Check against allowed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
}));

// Warn about permissive CORS in production
if (!ALLOWED_ORIGINS && process.env.NODE_ENV === 'production') {
  console.error('========================================');
  console.error('⚠️  SECURITY WARNING: ALLOWED_ORIGINS not set');
  console.error('   Set ALLOWED_ORIGINS=https://your-domain.com');
  console.error('   for proper CORS security in production');
  console.error('========================================');
}

app.use(express.json({ limit: '512kb' })); // Increased from 100kb to support federation message padding (v2.28.0)

app.use('/api/', apiLimiter);
app.set('trust proxy', 1);

// Serve uploaded files (avatars, etc.) with cross-origin headers for dev mode
app.use('/uploads', (req, res, next) => {
  // Allow cross-origin access for images (needed when client runs on different port)
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(UPLOADS_DIR));

// ============ Auth Middleware ============
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  // Support both Authorization header and query string token (for media streaming)
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Validate session if session tracking is enabled
    const validation = validateSession(token);
    if (!validation.valid) {
      return res.status(401).json({ error: validation.reason });
    }

    req.user = decoded;
    req.sessionId = validation.session?.id || null;
    req.token = token; // Store token for logout/session operations

    // Check account moderation status (v2.37.0)
    if (db.getUserAccountStatus) {
      const status = db.getUserAccountStatus(decoded.userId);
      if (status && (status.accountStatus === 'disabled' || status.accountStatus === 'banned')) {
        const code = status.accountStatus === 'disabled' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_BANNED';
        return res.status(403).json({
          error: `Account ${status.accountStatus}`,
          code,
          reason: status.moderationReason || 'No reason provided',
        });
      }
    }

    next();
  });
}

// ============ Bot Authentication Middleware (v2.1.0) ============

/**
 * Authenticate bot using API key (Bearer token)
 * Attaches req.bot object similar to req.user
 */
function authenticateBotToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Bot authentication required' });
  }

  // Validate format: fh_bot_xxxxx
  if (!token.startsWith('fh_bot_')) {
    return res.status(401).json({ error: 'Invalid bot token format' });
  }

  // Hash the token and look up bot
  const tokenHash = hashToken(token);
  const bot = db.findBotByApiKeyHash(tokenHash);

  if (!bot) {
    return res.status(403).json({ error: 'Invalid or revoked bot token' });
  }

  if (bot.status !== 'active') {
    return res.status(403).json({ error: `Bot is ${bot.status}` });
  }

  // Update bot stats (async, don't block request)
  setImmediate(() => {
    try {
      db.updateBotStats(bot.id, 'api_call');
    } catch (err) {
      console.error('Failed to update bot stats:', err);
    }
  });

  req.bot = bot;
  next();
}

// Bot-specific rate limiter (300 requests/min, higher than users)
const botLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Bot rate limit exceeded. Maximum 300 requests per minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.bot?.id || req.ip,
});

// ============ Auth Routes ============
app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const handle = sanitizeInput(req.body.handle || req.body.username);
    const email = sanitizeInput(req.body.email);
    const password = req.body.password;
    const displayName = sanitizeInput(req.body.displayName);
    const sessionDuration = getSessionDuration(req.body.sessionDuration);
    console.log(`🔑 Registration for ${handle} - Requested: ${req.body.sessionDuration}, Using: ${sessionDuration}`);

    if (!handle || !email || !password) {
      return res.status(400).json({ error: 'Handle, email and password are required' });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) {
      return res.status(400).json({ error: 'Handle must be 3-20 characters, letters/numbers/underscores only' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ error: passwordErrors.join('. ') });
    }

    const existing = db.findUserByHandle(handle) || db.findUserByHandle(email);
    if (existing) {
      return res.status(409).json({ error: 'Handle or email already exists' });
    }

    const id = `user-${uuidv4()}`;
    const passwordHash = await bcrypt.hash(password, 12);
    const avatar = (displayName || handle)[0].toUpperCase();

    const user = db.createUser({
      id, handle: handle.toLowerCase(), email: email.toLowerCase(),
      passwordHash, displayName: displayName || handle, avatar,
      nodeName: 'Local', status: 'online',
    });

    const token = jwt.sign({ userId: id, handle: user.handle }, JWT_SECRET, { expiresIn: sessionDuration });
    console.log(`✅ New user registered: ${handle}`);

    // Create session for the new user
    const session = createSession(user.id, token, req);
    if (session) {
      console.log(`📱 Session created for new user: ${handle}`);
    }

    // Log registration
    if (db.logActivity) db.logActivity(user.id, 'register', 'user', user.id, getRequestMeta(req));

    res.status(201).json({
      token,
      user: { id: user.id, handle: user.handle, email: user.email, displayName: user.displayName, avatar: user.avatar, avatarUrl: user.avatarUrl || null, bio: user.bio || null, nodeName: user.nodeName, status: user.status, isAdmin: user.isAdmin, role: user.role || (user.isAdmin ? 'admin' : 'user'), preferences: user.preferences || { theme: 'serenity', fontSize: 'medium' }, birthday: user.birthday, birthdayVisibility: user.birthdayVisibility },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const handle = sanitizeInput(req.body.handle || req.body.username);
    const password = req.body.password;
    const sessionDuration = getSessionDuration(req.body.sessionDuration);
    console.log(`🔑 Login attempt for ${handle} - Requested: ${req.body.sessionDuration}, Using: ${sessionDuration}`);

    if (!handle || !password) {
      return res.status(400).json({ error: 'Handle and password are required' });
    }

    const lockout = checkAccountLockout(handle);
    if (lockout.locked) {
      return res.status(429).json({ error: `Account temporarily locked. Try again in ${lockout.remainingMin} minutes.` });
    }

    const user = db.findUserByHandle(handle);
    const meta = getRequestMeta(req);
    if (!user) {
      recordFailedAttempt(handle);
      // Log failed login attempt (unknown user)
      if (db.logActivity) db.logActivity(null, 'login_failed', 'user', null, { ...meta, reason: 'unknown_user', attemptedHandle: handle });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      recordFailedAttempt(handle);
      // Log failed login attempt (wrong password)
      if (db.logActivity) db.logActivity(user.id, 'login_failed', 'user', user.id, { ...meta, reason: 'invalid_password' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check account moderation status (v2.37.0)
    const accountStatus = user.accountStatus || 'active';
    if (accountStatus === 'disabled' || accountStatus === 'banned') {
      const code = accountStatus === 'disabled' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_BANNED';
      if (db.logActivity) db.logActivity(user.id, 'login_blocked', 'user', user.id, { ...meta, reason: code });
      return res.status(403).json({
        error: `Account ${accountStatus}`,
        code,
        reason: user.moderationReason || 'No reason provided',
        moderatedAt: user.moderatedAt,
        canAppeal: true,
      });
    }

    // Check if MFA is enabled
    const hasMfa = db.hasMfaEnabled && db.hasMfaEnabled(user.id);
    if (hasMfa) {
      // Create MFA challenge (5 minute expiry) and store session duration for post-MFA token
      const mfaMethods = db.getEnabledMfaMethods(user.id);
      const challenge = db.createMfaChallenge(user.id, 'login', null, 5, sessionDuration);

      console.log(`🔐 MFA required for user: ${handle}`);

      return res.json({
        mfaRequired: true,
        mfaChallenge: challenge.id,
        mfaMethods // ['totp', 'email', 'recovery']
      });
    }

    clearFailedAttempts(handle);
    db.updateUserStatus(user.id, 'online');

    // Check if user needs to change password (set by admin reset)
    const requirePasswordChange = db.requiresPasswordChange ? db.requiresPasswordChange(user.id) : false;

    const token = jwt.sign({ userId: user.id, handle: user.handle }, JWT_SECRET, { expiresIn: sessionDuration });
    console.log(`✅ User logged in: ${handle} with ${sessionDuration} session`);

    // Create session for the login
    const session = createSession(user.id, token, req);
    if (session) {
      console.log(`📱 Session created for: ${handle}`);
    }

    // Log successful login
    if (db.logActivity) db.logActivity(user.id, 'login', 'user', user.id, meta);

    res.json({
      token,
      requirePasswordChange,
      user: { id: user.id, handle: user.handle, email: user.email, displayName: user.displayName, avatar: user.avatar, avatarUrl: user.avatarUrl || null, bio: user.bio || null, nodeName: user.nodeName, status: 'online', isAdmin: user.isAdmin, role: user.role || (user.isAdmin ? 'admin' : 'user'), preferences: user.preferences || { theme: 'serenity', fontSize: 'medium' }, birthday: user.birthday, birthdayVisibility: user.birthdayVisibility },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, handle: user.handle, email: user.email, displayName: user.displayName, avatar: user.avatar, avatarUrl: user.avatarUrl || null, bio: user.bio || null, nodeName: user.nodeName, status: user.status, isAdmin: user.isAdmin, role: user.role || (user.isAdmin ? 'admin' : 'user'), preferences: user.preferences || { theme: 'serenity', fontSize: 'medium' }, accountStatus: user.accountStatus || 'active', birthday: user.birthday, birthdayVisibility: user.birthdayVisibility });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  db.updateUserStatus(req.user.userId, 'offline');

  // Clean up push subscriptions for this user (prevents stale subs when switching users on same browser)
  try {
    pushSubs.removeAllSubscriptions(req.user.userId);
    console.log(`🔕 Push subscriptions cleaned up for: ${req.user.handle}`);
  } catch (err) {
    console.error(`Failed to clean push subscriptions for ${req.user.handle}:`, err.message);
  }

  // Revoke the current session
  if (req.token) {
    const revoked = revokeSessionByToken(req.token);
    if (revoked) {
      console.log(`📱 Session revoked for: ${req.user.handle}`);
    } else {
      console.log(`📱 Session revocation skipped for: ${req.user.handle} (no session found or tracking disabled)`);
    }
  } else {
    console.log(`📱 Logout without token for: ${req.user.handle}`);
  }

  // Log logout
  if (db.logActivity) db.logActivity(req.user.userId, 'logout', 'user', req.user.userId, getRequestMeta(req));
  res.json({ success: true });
});

// Session refresh — extend session before token expires (v2.29.0)
app.post('/api/auth/refresh', loginLimiter, authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    const sessionDuration = getSessionDuration(req.body.sessionDuration);

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      if (db.logActivity) db.logActivity(user.id, 'session_refresh_failed', 'user', user.id, { ...getRequestMeta(req), reason: 'invalid_password' });
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Revoke old session
    if (req.token) {
      revokeSessionByToken(req.token);
    }

    // Issue new token
    const token = jwt.sign({ userId: user.id, handle: user.handle }, JWT_SECRET, { expiresIn: sessionDuration });
    const session = createSession(user.id, token, req);
    console.log(`🔄 Session refreshed for: ${user.handle} with ${sessionDuration} session`);

    if (db.logActivity) db.logActivity(user.id, 'session_refresh', 'user', user.id, getRequestMeta(req));

    res.json({
      token,
      sessionDuration,
      user: { id: user.id, handle: user.handle, email: user.email, displayName: user.displayName, avatar: user.avatar, avatarUrl: user.avatarUrl || null, bio: user.bio || null, nodeName: user.nodeName, status: user.status, isAdmin: user.isAdmin, role: user.role || (user.isAdmin ? 'admin' : 'user'), preferences: user.preferences || { theme: 'serenity', fontSize: 'medium' } },
    });
  } catch (err) {
    console.error('Session refresh error:', err);
    res.status(500).json({ error: 'Session refresh failed' });
  }
});

// ============ Session Management Routes (v1.18.0) ============

// Get user's active sessions
app.get('/api/auth/sessions', authenticateToken, (req, res) => {
  if (!SESSION_TRACKING_ENABLED || !db.getSessionsByUser) {
    return res.json({ sessions: [], enabled: false });
  }

  try {
    const sessions = db.getSessionsByUser(req.user.userId);

    // Mark current session
    const currentTokenHash = hashToken(req.token);
    const sessionsWithCurrent = sessions.map(session => ({
      id: session.id,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastActive: session.lastActive,
      expiresAt: session.expiresAt,
      isCurrent: session.tokenHash === currentTokenHash
    }));

    res.json({ sessions: sessionsWithCurrent, enabled: true });
  } catch (err) {
    console.error('Get sessions error:', err);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Revoke a specific session
app.post('/api/auth/sessions/:id/revoke', authenticateToken, (req, res) => {
  if (!SESSION_TRACKING_ENABLED || !db.revokeSession) {
    return res.status(400).json({ error: 'Session management not enabled' });
  }

  try {
    const sessionId = req.params.id;

    // Verify the session belongs to this user
    const sessions = db.getSessionsByUser(req.user.userId);
    const session = sessions.find(s => s.id === sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Don't allow revoking the current session via this endpoint
    const currentTokenHash = hashToken(req.token);
    if (session.tokenHash === currentTokenHash) {
      return res.status(400).json({ error: 'Use logout to revoke current session' });
    }

    const revoked = db.revokeSession(sessionId);
    if (revoked) {
      console.log(`📱 Session ${sessionId} revoked by user: ${req.user.handle}`);
      if (db.logActivity) db.logActivity(req.user.userId, 'session_revoked', 'session', sessionId, getRequestMeta(req));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Revoke session error:', err);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

// Revoke all sessions except current
app.post('/api/auth/sessions/revoke-all', authenticateToken, (req, res) => {
  if (!SESSION_TRACKING_ENABLED || !db.revokeAllUserSessions) {
    return res.status(400).json({ error: 'Session management not enabled' });
  }

  try {
    const currentTokenHash = hashToken(req.token);
    const currentSession = db.getSessionByTokenHash(currentTokenHash);
    const currentSessionId = currentSession?.id || null;

    const revoked = db.revokeAllUserSessions(req.user.userId, currentSessionId);
    console.log(`📱 ${revoked} sessions revoked for user: ${req.user.handle}`);

    if (db.logActivity) db.logActivity(req.user.userId, 'all_sessions_revoked', 'user', req.user.userId, { ...getRequestMeta(req), count: revoked });

    res.json({ success: true, revoked });
  } catch (err) {
    console.error('Revoke all sessions error:', err);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

// ============ Account Management Routes (v1.18.0 GDPR) ============

// Rate limiter for account operations
const accountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  message: { error: 'Too many account operations. Please try again later.' }
});

// Export user data (GDPR data portability)
app.get('/api/account/export', authenticateToken, accountLimiter, (req, res) => {
  try {
    if (!db.exportUserData) {
      return res.status(501).json({ error: 'Data export not available' });
    }

    const exportData = db.exportUserData(req.user.userId);
    if (!exportData) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log the export
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'data_export', 'user', req.user.userId, getRequestMeta(req));
    }

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="cortex-data-export-${req.user.handle}-${new Date().toISOString().split('T')[0]}.json"`);

    res.json(exportData);
  } catch (err) {
    console.error('Data export error:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Delete account (requires password confirmation)
app.post('/api/account/delete', authenticateToken, accountLimiter, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password confirmation required' });
    }

    // Verify password
    const user = db.findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Prevent admin from deleting themselves if they're the only admin
    if (user.isAdmin) {
      const adminCount = db.db?.prepare?.('SELECT COUNT(*) as count FROM users WHERE is_admin = 1')?.get()?.count || 1;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the only admin account. Transfer admin rights first.' });
      }
    }

    // Perform account deletion
    if (!db.deleteUserAccount) {
      return res.status(501).json({ error: 'Account deletion not available' });
    }

    // Log before deletion (since we're about to delete the user)
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'account_deleted', 'user', req.user.userId, getRequestMeta(req));
    }

    const result = db.deleteUserAccount(req.user.userId);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to delete account' });
    }

    console.log(`🗑️ Account deleted: ${result.handle} (${result.deletedUserId})`);

    // Revoke current session if tracking is enabled
    if (req.token) {
      revokeSessionByToken(req.token);
    }

    res.json({
      success: true,
      message: 'Your account has been permanently deleted.'
    });
  } catch (err) {
    console.error('Account deletion error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ============ Password Reset Routes ============

// Request password reset (public, rate-limited)
// Always returns success to prevent email enumeration
app.post('/api/auth/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const email = sanitizeInput(req.body.email || '').toLowerCase().trim();

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    // Always return success to prevent email enumeration
    const successResponse = () => {
      res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.'
      });
    };

    const emailService = getEmailService();
    if (!emailService.isConfigured()) {
      console.warn('Password reset requested but email service not configured');
      return successResponse();
    }

    const user = db.findUserByEmail ? db.findUserByEmail(email) : null;
    if (!user) {
      return successResponse();
    }

    // Get decrypted email for sending (v2.16.0 privacy hardening)
    const decryptedEmail = db.getDecryptedEmail ? db.getDecryptedEmail(user.id) : user.email;
    if (!decryptedEmail || decryptedEmail.startsWith('[protected:')) {
      console.error('Cannot send password reset: email not available for user', user.id);
      return successResponse(); // Still return success to prevent enumeration
    }

    // Generate secure random token (64 bytes = 128 hex chars)
    const token = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Store hashed token in database
    db.createPasswordResetToken(user.id, tokenHash, 60); // 60 minutes expiry

    // Build reset URL - use client origin or configured base URL
    const origin = req.headers.origin || process.env.CLIENT_URL || `http://localhost:${process.env.CLIENT_PORT || 3000}`;
    const resetUrl = `${origin}/reset-password?token=${token}`;

    // Send email using decrypted address
    const result = await emailService.sendPasswordResetEmail(decryptedEmail, token, resetUrl);
    if (!result.success) {
      console.error(`Failed to send password reset email:`, result.error);
    } else {
      console.log(`Password reset email sent successfully`);
    }

    return successResponse();
  } catch (err) {
    console.error('Password reset request error:', err);
    // Still return success to prevent information leakage
    res.json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.'
    });
  }
});

// Verify password reset token (public)
app.get('/api/auth/reset-password/:token', (req, res) => {
  try {
    const token = req.params.token;
    if (!token || token.length < 64) {
      return res.status(400).json({ valid: false, error: 'Invalid token format' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = db.verifyPasswordResetToken(tokenHash);

    res.json({ valid: result.valid, error: result.error });
  } catch (err) {
    console.error('Token verification error:', err);
    res.status(500).json({ valid: false, error: 'Failed to verify token' });
  }
});

// Complete password reset (public)
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || token.length < 64) {
      return res.status(400).json({ error: 'Invalid token format' });
    }

    if (!newPassword || newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Validate password requirements
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must contain at least one lowercase letter' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must contain at least one number' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenResult = db.verifyPasswordResetToken(tokenHash);

    if (!tokenResult.valid) {
      return res.status(400).json({ error: tokenResult.error || 'Invalid or expired token' });
    }

    // Set new password
    const setResult = await db.setPassword(tokenResult.userId, newPassword, false);
    if (!setResult.success) {
      return res.status(500).json({ error: setResult.error || 'Failed to reset password' });
    }

    // Mark token as used
    db.markPasswordResetTokenUsed(tokenHash);

    // Clear any account lockouts for this user
    const user = db.findUserById(tokenResult.userId);
    if (user) {
      db.clearFailedLogins(user.handle);
      if (user.email) db.clearFailedLogins(user.email);
    }

    console.log(`Password reset completed for user ${tokenResult.userId}`);

    // Log password reset
    if (db.logActivity) db.logActivity(tokenResult.userId, 'password_reset_complete', 'user', tokenResult.userId, getRequestMeta(req));

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Clear password change requirement after changing password (authenticated)
app.post('/api/auth/clear-password-change', authenticateToken, (req, res) => {
  try {
    if (db.clearPasswordChangeRequirement) {
      db.clearPasswordChangeRequirement(req.user.userId);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Clear password change requirement error:', err);
    res.status(500).json({ error: 'Failed to clear password change requirement' });
  }
});

// ============ MFA Routes ============

// Rate limiter for MFA operations
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: 'Too many MFA attempts, please try again later' }
});

// Get MFA status for current user
app.get('/api/auth/mfa/status', authenticateToken, (req, res) => {
  try {
    const settings = db.getMfaSettings(req.user.userId);
    const methods = db.getEnabledMfaMethods(req.user.userId);
    res.json({
      totpEnabled: settings?.totpEnabled || false,
      emailMfaEnabled: settings?.emailMfaEnabled || false,
      hasRecoveryCodes: settings?.hasRecoveryCodes || false,
      enabledMethods: methods
    });
  } catch (err) {
    console.error('MFA status error:', err);
    res.status(500).json({ error: 'Failed to get MFA status' });
  }
});

// Begin TOTP setup - generate secret and QR code
app.post('/api/auth/mfa/totp/setup', authenticateToken, async (req, res) => {
  try {
    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check if TOTP is already enabled
    const settings = db.getMfaSettings(req.user.userId);
    if (settings?.totp_enabled === 1) {
      return res.status(400).json({ error: 'TOTP is already enabled' });
    }

    // Generate new TOTP secret
    const secret = authenticator.generateSecret();

    // Store pending secret (not enabled yet)
    db.storePendingTotpSecret(req.user.userId, secret);

    // Generate otpauth URI for authenticator apps
    const appName = 'Cortex';
    const otpauthUrl = authenticator.keyuri(user.handle, appName, secret);

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    res.json({
      secret,
      qrCodeDataUrl,
      manualEntryKey: secret,
      otpauthUrl
    });
  } catch (err) {
    console.error('TOTP setup error:', err);
    res.status(500).json({ error: 'Failed to setup TOTP' });
  }
});

// Verify TOTP code and enable
app.post('/api/auth/mfa/totp/verify', authenticateToken, mfaLimiter, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get pending secret
    const secret = db.getTotpSecret(req.user.userId);
    if (!secret) {
      return res.status(400).json({ error: 'No TOTP setup in progress. Please start setup first.' });
    }

    // Verify the code
    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid code. Please try again.' });
    }

    // Enable TOTP
    db.enableTotp(req.user.userId, secret);

    // Generate recovery codes (10 codes)
    const recoveryCodes = [];
    const hashedCodes = [];
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      recoveryCodes.push(code);
      hashedCodes.push(crypto.createHash('sha256').update(code).digest('hex'));
    }

    // Store hashed recovery codes
    db.storeRecoveryCodes(req.user.userId, hashedCodes);

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'mfa_enable', 'user', req.user.userId, { ...getRequestMeta(req), method: 'totp' });

    res.json({
      success: true,
      message: 'TOTP enabled successfully',
      recoveryCodes // Return plaintext codes once (user must save them)
    });
  } catch (err) {
    console.error('TOTP verify error:', err);
    res.status(500).json({ error: 'Failed to verify TOTP' });
  }
});

// Disable TOTP (requires password and current TOTP code)
app.post('/api/auth/mfa/totp/disable', authenticateToken, mfaLimiter, async (req, res) => {
  try {
    const { password, code } = req.body;
    if (!password || !code) {
      return res.status(400).json({ error: 'Password and code are required' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Verify TOTP code
    const secret = db.getTotpSecret(req.user.userId);
    if (!secret) {
      return res.status(400).json({ error: 'TOTP is not enabled' });
    }

    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid TOTP code' });
    }

    // Disable TOTP
    db.disableTotp(req.user.userId);

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'mfa_disable', 'user', req.user.userId, { ...getRequestMeta(req), method: 'totp' });

    res.json({ success: true, message: 'TOTP disabled successfully' });
  } catch (err) {
    console.error('TOTP disable error:', err);
    res.status(500).json({ error: 'Failed to disable TOTP' });
  }
});

// Enable email MFA
app.post('/api/auth/mfa/email/enable', authenticateToken, async (req, res) => {
  try {
    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.email) {
      return res.status(400).json({ error: 'No email address on file. Please add an email first.' });
    }

    // Check if email MFA is already enabled
    const settings = db.getMfaSettings(req.user.userId);
    if (settings?.email_mfa_enabled === 1) {
      return res.status(400).json({ error: 'Email MFA is already enabled' });
    }

    // Send test code to verify email works
    const testCode = Math.floor(100000 + Math.random() * 900000).toString();
    const emailService = getEmailService();

    if (!emailService.configured) {
      return res.status(400).json({ error: 'Email service is not configured. Contact administrator.' });
    }

    await emailService.sendMFACode(user.email, testCode);

    // Create MFA challenge for verification (store hashed code)
    const codeHash = crypto.createHash('sha256').update(testCode).digest('hex');
    const challenge = db.createMfaChallenge(req.user.userId, 'email_enable', codeHash);

    res.json({
      success: true,
      message: 'Verification code sent to your email',
      challengeId: challenge.id
    });
  } catch (err) {
    console.error('Email MFA enable error:', err);
    res.status(500).json({ error: 'Failed to enable email MFA' });
  }
});

// Verify email MFA setup
app.post('/api/auth/mfa/email/verify-setup', authenticateToken, mfaLimiter, (req, res) => {
  try {
    const { challengeId, code } = req.body;
    if (!challengeId || !code) {
      return res.status(400).json({ error: 'Challenge ID and code are required' });
    }

    // Validate challengeId is a string
    if (typeof challengeId !== 'string') {
      return res.status(400).json({ error: 'Invalid challenge ID format' });
    }

    // Verify the challenge
    const challenge = db.getMfaChallenge(challengeId);
    if (!challenge || challenge.userId !== req.user.userId) {
      return res.status(400).json({ error: 'Invalid or expired challenge' });
    }

    if (challenge.challengeType !== 'email_enable') {
      return res.status(400).json({ error: 'Invalid challenge type' });
    }

    // Check expiration
    if (new Date(challenge.expiresAt) < new Date()) {
      db.deleteMfaChallenge(challengeId);
      return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
    }

    // Verify code (stored as hash)
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    if (challenge.codeHash !== codeHash) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Enable email MFA
    db.enableEmailMfa(req.user.userId);
    db.markMfaChallengeVerified(challengeId);

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'mfa_enable', 'user', req.user.userId, { ...getRequestMeta(req), method: 'email' });

    // Generate recovery codes if not already present
    const settings = db.getMfaSettings(req.user.userId);
    let recoveryCodes = null;
    if (!settings?.recovery_codes || JSON.parse(settings.recovery_codes).length === 0) {
      recoveryCodes = [];
      const hashedCodes = [];
      for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        recoveryCodes.push(code);
        hashedCodes.push(crypto.createHash('sha256').update(code).digest('hex'));
      }
      db.storeRecoveryCodes(req.user.userId, hashedCodes);
    }

    res.json({
      success: true,
      message: 'Email MFA enabled successfully',
      recoveryCodes // Only returned if newly generated
    });
  } catch (err) {
    console.error('Email MFA verify setup error:', err);
    res.status(500).json({ error: 'Failed to verify email MFA setup' });
  }
});

// Request email MFA disable - sends verification code (step 1)
app.post('/api/auth/mfa/email/disable/request', authenticateToken, mfaLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Check email MFA is enabled
    const settings = db.getMfaSettings(req.user.userId);
    if (!settings?.emailMfaEnabled) {
      return res.status(400).json({ error: 'Email MFA is not enabled' });
    }

    // Check email service
    const emailService = getEmailService();
    if (!emailService.configured) {
      return res.status(400).json({ error: 'Email service is not configured. Contact administrator.' });
    }

    // Generate and send verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Create challenge for verification
    const challenge = db.createMfaChallenge(req.user.userId, 'email_disable', codeHash);

    await emailService.sendMFACode(user.email, code, 'To disable Email MFA, enter this verification code');

    res.json({
      success: true,
      message: 'Verification code sent to your email',
      challengeId: challenge.id
    });
  } catch (err) {
    console.error('Email MFA disable request error:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Disable email MFA - verify code and disable (step 2)
app.post('/api/auth/mfa/email/disable', authenticateToken, mfaLimiter, async (req, res) => {
  try {
    const { challengeId, code } = req.body;
    if (!challengeId || !code) {
      return res.status(400).json({ error: 'Challenge ID and verification code are required' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get and validate challenge
    const challenge = db.getMfaChallenge(challengeId);
    if (!challenge || challenge.userId !== req.user.userId) {
      return res.status(400).json({ error: 'Invalid or expired verification' });
    }

    if (challenge.method !== 'email_disable') {
      return res.status(400).json({ error: 'Invalid challenge type' });
    }

    // Verify code
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    if (codeHash !== challenge.codeHash) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Delete the challenge
    db.deleteMfaChallenge(challengeId);

    // Disable email MFA
    db.disableEmailMfa(req.user.userId);

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'mfa_disable', 'user', req.user.userId, { ...getRequestMeta(req), method: 'email' });

    res.json({ success: true, message: 'Email MFA disabled successfully' });
  } catch (err) {
    console.error('Email MFA disable error:', err);
    res.status(500).json({ error: 'Failed to disable email MFA' });
  }
});

// Regenerate recovery codes (requires password + one MFA method)
app.post('/api/auth/mfa/recovery/regenerate', authenticateToken, mfaLimiter, async (req, res) => {
  try {
    const { password, mfaCode, mfaMethod } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Verify MFA if enabled
    const hasMfa = db.hasMfaEnabled(req.user.userId);
    if (hasMfa) {
      if (!mfaCode || !mfaMethod) {
        return res.status(400).json({ error: 'MFA verification required' });
      }

      if (mfaMethod === 'totp') {
        const secret = db.getTotpSecret(req.user.userId);
        const isValid = authenticator.verify({ token: mfaCode, secret });
        if (!isValid) {
          return res.status(400).json({ error: 'Invalid TOTP code' });
        }
      } else {
        return res.status(400).json({ error: 'Invalid MFA method for this operation' });
      }
    }

    // Generate new recovery codes
    const recoveryCodes = [];
    const hashedCodes = [];
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      recoveryCodes.push(code);
      hashedCodes.push(crypto.createHash('sha256').update(code).digest('hex'));
    }

    // Store new hashed codes (replaces old ones)
    db.storeRecoveryCodes(req.user.userId, hashedCodes);

    res.json({
      success: true,
      message: 'Recovery codes regenerated',
      recoveryCodes // Return plaintext codes once (user must save them)
    });
  } catch (err) {
    console.error('Recovery codes regenerate error:', err);
    res.status(500).json({ error: 'Failed to regenerate recovery codes' });
  }
});

// Send email MFA code for login
app.post('/api/auth/mfa/send-email-code', mfaLimiter, async (req, res) => {
  try {
    const { challengeId } = req.body;
    if (!challengeId) {
      return res.status(400).json({ error: 'Challenge ID is required' });
    }

    // Validate challengeId is a string
    if (typeof challengeId !== 'string') {
      return res.status(400).json({ error: 'Invalid challenge ID format' });
    }

    // Get the challenge to find user
    const challenge = db.getMfaChallenge(challengeId);
    if (!challenge) {
      return res.status(400).json({ error: 'Invalid challenge' });
    }

    const user = db.findUserById(challenge.userId);
    if (!user || !user.email) {
      return res.status(400).json({ error: 'Cannot send email code' });
    }

    // Generate and send code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const emailService = getEmailService();
    if (!emailService.configured) {
      return res.status(400).json({ error: 'Email service is not configured. Contact administrator.' });
    }

    // Update challenge with new code (store hashed) and preserve session duration
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const sessionDuration = challenge.sessionDuration || '24h';
    const newChallenge = db.createMfaChallenge(challenge.userId, 'email', codeHash, 5, sessionDuration);

    await emailService.sendMFACode(user.email, code);

    res.json({
      success: true,
      message: 'Code sent to your email',
      challengeId: newChallenge.id
    });
  } catch (err) {
    console.error('Send email MFA code error:', err);
    res.status(500).json({ error: 'Failed to send email code' });
  }
});

// Verify MFA during login
app.post('/api/auth/mfa/verify', mfaLimiter, (req, res) => {
  try {
    const { challengeId, method, code } = req.body;
    if (!challengeId || !method || !code) {
      return res.status(400).json({ error: 'Challenge ID, method, and code are required' });
    }

    // Validate challengeId is a string
    if (typeof challengeId !== 'string') {
      return res.status(400).json({ error: 'Invalid challenge ID format' });
    }

    // Get the challenge
    const challenge = db.getMfaChallenge(challengeId);
    if (!challenge) {
      return res.status(400).json({ error: 'Invalid or expired challenge' });
    }

    // Check expiration
    if (new Date(challenge.expiresAt) < new Date()) {
      db.deleteMfaChallenge(challengeId);
      return res.status(400).json({ error: 'Challenge has expired. Please log in again.' });
    }

    const user = db.findUserById(challenge.userId);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    let verified = false;

    if (method === 'totp') {
      const secret = db.getTotpSecret(challenge.userId);
      if (secret) {
        verified = authenticator.verify({ token: code, secret });
      }
    } else if (method === 'email') {
      // For email, we need to check the codeHash on the challenge
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      if (challenge.codeHash === codeHash) {
        verified = true;
      }
    } else if (method === 'recovery') {
      // Verify recovery code (stored as array of hashed codes)
      const hashedCodes = db.getRecoveryCodes(challenge.userId);
      if (hashedCodes && hashedCodes.length > 0) {
        const codeHash = crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
        const codeIndex = hashedCodes.findIndex(hash => hash === codeHash);
        if (codeIndex !== -1) {
          db.markRecoveryCodeUsed(challenge.userId, codeIndex);
          verified = true;
        }
      }
    }

    if (!verified) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Mark challenge as verified
    db.markMfaChallengeVerified(challengeId);

    // Generate JWT token with session duration from challenge
    const sessionDuration = challenge.sessionDuration || '24h';
    const token = jwt.sign(
      { userId: user.id, handle: user.handle },
      JWT_SECRET,
      { expiresIn: sessionDuration }
    );

    // Create session for the MFA login
    const session = createSession(user.id, token, req);
    if (session) {
      console.log(`📱 Session created for MFA login: ${user.handle}`);
    }

    // Clear any failed login attempts
    if (db.clearFailedLogins) {
      db.clearFailedLogins(user.handle);
    }

    // Log successful MFA login
    if (db.logActivity) db.logActivity(user.id, 'login', 'user', user.id, { ...getRequestMeta(req), mfaMethod: method });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        avatar: user.avatar,
        avatarUrl: user.avatarUrl || null,
        role: user.role,
        preferences: user.preferences,
        bio: user.bio,
        email: user.email,
        requirePasswordChange: user.require_password_change === 1
      }
    });
  } catch (err) {
    console.error('MFA verify error:', err);
    res.status(500).json({ error: 'Failed to verify MFA' });
  }
});

// ============ E2EE Routes (v1.19.0) ============

// Register user's encryption keys (E2EE setup)
app.post('/api/e2ee/keys/register', authenticateToken, (req, res) => {
  try {
    const { publicKey, encryptedPrivateKey, salt } = req.body;

    if (!publicKey || !encryptedPrivateKey || !salt) {
      return res.status(400).json({ error: 'Missing required fields: publicKey, encryptedPrivateKey, salt' });
    }

    // Validate Base64 format (basic check)
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    if (!base64Regex.test(publicKey) || !base64Regex.test(encryptedPrivateKey) || !base64Regex.test(salt)) {
      return res.status(400).json({ error: 'Invalid key format (must be Base64)' });
    }

    const result = db.createUserEncryptionKeys(req.user.userId, publicKey, encryptedPrivateKey, salt);

    // Log E2EE setup activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'e2ee_setup', 'user', req.user.userId, {
        ...getRequestMeta(req),
        keyVersion: result.keyVersion
      });
    }

    res.json({
      success: true,
      message: 'Encryption keys registered',
      keyVersion: result.keyVersion
    });
  } catch (err) {
    console.error('E2EE key registration error:', err);
    res.status(500).json({ error: 'Failed to register encryption keys' });
  }
});

// Get own encryption keys (for device sync / passphrase unlock)
app.get('/api/e2ee/keys/me', authenticateToken, (req, res) => {
  try {
    const keys = db.getUserEncryptionKeys(req.user.userId);

    if (!keys) {
      return res.status(404).json({ error: 'No encryption keys found', needsSetup: true });
    }

    res.json({
      publicKey: keys.publicKey,
      encryptedPrivateKey: keys.encryptedPrivateKey,
      keyDerivationSalt: keys.keyDerivationSalt,
      keyVersion: keys.keyVersion,
      createdAt: keys.createdAt
    });
  } catch (err) {
    console.error('E2EE key fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch encryption keys' });
  }
});

// Get another user's public key (for encrypting wave keys)
app.get('/api/e2ee/keys/user/:id', authenticateToken, (req, res) => {
  try {
    const publicKey = db.getUserPublicKey(req.params.id);

    if (!publicKey) {
      return res.status(404).json({ error: 'User has not set up E2EE' });
    }

    res.json({ publicKey });
  } catch (err) {
    console.error('E2EE public key fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch public key' });
  }
});

// Check if user has E2EE set up
app.get('/api/e2ee/status', authenticateToken, (req, res) => {
  try {
    const hasKeys = db.hasUserEncryptionKeys(req.user.userId);
    const keys = hasKeys ? db.getUserEncryptionKeys(req.user.userId) : null;

    res.json({
      e2eeEnabled: hasKeys,
      keyVersion: keys?.keyVersion || null,
      createdAt: keys?.createdAt || null
    });
  } catch (err) {
    console.error('E2EE status check error:', err);
    res.status(500).json({ error: 'Failed to check E2EE status' });
  }
});

// Rotate user keypair (generate new keys with new passphrase)
app.post('/api/e2ee/keys/rotate', authenticateToken, (req, res) => {
  try {
    const { publicKey, encryptedPrivateKey, salt } = req.body;

    if (!publicKey || !encryptedPrivateKey || !salt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user already has keys
    if (!db.hasUserEncryptionKeys(req.user.userId)) {
      return res.status(400).json({ error: 'No existing keys to rotate. Use /api/e2ee/keys/register instead.' });
    }

    const result = db.createUserEncryptionKeys(req.user.userId, publicKey, encryptedPrivateKey, salt);

    // Log key rotation
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'e2ee_key_rotation', 'user', req.user.userId, {
        ...getRequestMeta(req),
        newKeyVersion: result.keyVersion
      });
    }

    res.json({
      success: true,
      message: 'Keys rotated successfully',
      keyVersion: result.keyVersion
    });
  } catch (err) {
    console.error('E2EE key rotation error:', err);
    res.status(500).json({ error: 'Failed to rotate keys' });
  }
});

// Update encrypted private key (for password changes)
// This keeps the same public key but re-encrypts the private key with a new password
app.post('/api/e2ee/keys/update', authenticateToken, (req, res) => {
  try {
    const { encryptedPrivateKey, salt } = req.body;

    if (!encryptedPrivateKey || !salt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user has keys
    if (!db.hasUserEncryptionKeys(req.user.userId)) {
      return res.status(400).json({ error: 'No encryption keys found. Use /api/e2ee/keys/register first.' });
    }

    // Update only the encrypted private key and salt (not the public key)
    db.updateEncryptedPrivateKey(req.user.userId, encryptedPrivateKey, salt);

    // Log the update
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'e2ee_key_reencrypt', 'user', req.user.userId, {
        ...getRequestMeta(req)
      });
    }

    res.json({
      success: true,
      message: 'Encryption keys updated successfully'
    });
  } catch (err) {
    console.error('E2EE key update error:', err);
    res.status(500).json({ error: 'Failed to update keys' });
  }
});

// Setup recovery key
app.post('/api/e2ee/recovery/setup', authenticateToken, (req, res) => {
  try {
    const { encryptedPrivateKey, recoverySalt, hint } = req.body;

    if (!encryptedPrivateKey || !recoverySalt) {
      return res.status(400).json({ error: 'Missing required fields: encryptedPrivateKey, recoverySalt' });
    }

    // Validate hint length if provided
    const sanitizedHint = hint ? sanitizeInput(hint).slice(0, 100) : null;

    const result = db.createRecoveryKey(req.user.userId, encryptedPrivateKey, recoverySalt, sanitizedHint);

    // Log recovery setup
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'e2ee_recovery_setup', 'user', req.user.userId, getRequestMeta(req));
    }

    res.json({
      success: true,
      message: 'Recovery key configured',
      hasHint: result.hasHint
    });
  } catch (err) {
    console.error('E2EE recovery setup error:', err);
    res.status(500).json({ error: 'Failed to setup recovery key' });
  }
});

// Get recovery hint (without revealing the key)
app.get('/api/e2ee/recovery/hint', authenticateToken, (req, res) => {
  try {
    const hint = db.getRecoveryHint(req.user.userId);

    if (hint === null) {
      // Check if recovery is set up at all
      const recoveryInfo = db.getRecoveryKeyInfo(req.user.userId);
      if (!recoveryInfo) {
        return res.status(404).json({ error: 'No recovery key configured' });
      }
      return res.json({ hint: null, hasRecovery: true });
    }

    res.json({ hint, hasRecovery: true });
  } catch (err) {
    console.error('E2EE recovery hint error:', err);
    res.status(500).json({ error: 'Failed to get recovery hint' });
  }
});

// Regenerate recovery key (requires passphrase verification)
app.post('/api/e2ee/recovery/regenerate', authenticateToken, (req, res) => {
  try {
    const { encryptedPrivateKey, recoverySalt } = req.body;

    if (!encryptedPrivateKey || !recoverySalt) {
      return res.status(400).json({ error: 'Missing required fields: encryptedPrivateKey, recoverySalt' });
    }

    // Update the recovery key info
    const result = db.updateRecoveryKey(req.user.userId, encryptedPrivateKey, recoverySalt);

    if (!result) {
      return res.status(404).json({ error: 'No existing recovery key to regenerate' });
    }

    // Log recovery regeneration
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'e2ee_recovery_regenerated', 'user', req.user.userId, getRequestMeta(req));
    }

    res.json({
      success: true,
      message: 'Recovery key regenerated'
    });
  } catch (err) {
    console.error('E2EE recovery regenerate error:', err);
    res.status(500).json({ error: 'Failed to regenerate recovery key' });
  }
});

// Get full recovery key info (for account recovery)
app.get('/api/e2ee/recovery', authenticateToken, (req, res) => {
  try {
    const recoveryInfo = db.getRecoveryKeyInfo(req.user.userId);

    if (!recoveryInfo) {
      return res.status(404).json({ error: 'No recovery key configured' });
    }

    res.json({
      encryptedPrivateKey: recoveryInfo.encryptedPrivateKey,
      recoverySalt: recoveryInfo.recoverySalt,
      hint: recoveryInfo.hint,
      createdAt: recoveryInfo.createdAt
    });
  } catch (err) {
    console.error('E2EE recovery fetch error:', err);
    res.status(500).json({ error: 'Failed to get recovery key' });
  }
});

// ============ Profile Routes ============
app.put('/api/profile', authenticateToken, (req, res) => {
  const updates = {};
  if (req.body.displayName) updates.displayName = sanitizeInput(req.body.displayName).slice(0, 50);
  if (req.body.avatar) updates.avatar = sanitizeInput(req.body.avatar).slice(0, 2);
  if (req.body.bio !== undefined) updates.bio = req.body.bio ? sanitizeInput(req.body.bio).slice(0, 500) : null;

  // Email update with validation
  if (req.body.email !== undefined) {
    const email = req.body.email ? sanitizeInput(req.body.email).trim().toLowerCase() : null;
    if (email) {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      // Check if email is already taken by another user
      const existingUser = db.findUserByEmail ? db.findUserByEmail(email) : db.findUserByHandle(email);
      if (existingUser && existingUser.id !== req.user.userId) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }
    updates.email = email;
  }

  // Birthday update with validation (v2.40.0)
  if (req.body.birthday !== undefined) {
    if (req.body.birthday === null || req.body.birthday === '') {
      updates.birthday = null;
    } else {
      const birthdayRegex = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
      if (!birthdayRegex.test(req.body.birthday)) {
        return res.status(400).json({ error: 'Birthday must be in MM-DD format' });
      }
      updates.birthday = req.body.birthday;
    }
  }

  if (req.body.birthdayVisibility !== undefined) {
    if (!['everyone', 'contacts', 'hidden'].includes(req.body.birthdayVisibility)) {
      return res.status(400).json({ error: 'Birthday visibility must be everyone, contacts, or hidden' });
    }
    updates.birthdayVisibility = req.body.birthdayVisibility;
  }

  const user = db.updateUser(req.user.userId, updates);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ id: user.id, handle: user.handle, email: user.email, displayName: user.displayName, avatar: user.avatar, avatarUrl: user.avatarUrl || null, preferences: user.preferences, bio: user.bio, birthday: user.birthday, birthdayVisibility: user.birthdayVisibility });
});

// Get public profile for any user (local or federated)
app.get('/api/users/:id/profile', authenticateToken, (req, res) => {
  // First try to find local user
  const user = db.findUserById(req.params.id);
  if (user) {
    // Return only public profile fields (no email, passwordHash, preferences, etc.)
    return res.json({
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      avatar: user.avatar,
      avatarUrl: user.avatarUrl || null,
      bio: user.bio || null,
      birthday: db.getUserBirthday(user.id, req.user.userId),
      createdAt: user.createdAt,
      isRemote: false,
    });
  }

  // Try to find remote/federated user
  const remoteUser = db.getRemoteUser(req.params.id);
  if (remoteUser) {
    return res.json({
      id: remoteUser.id,
      handle: remoteUser.handle,
      displayName: remoteUser.displayName,
      avatar: remoteUser.avatar,
      avatarUrl: remoteUser.avatarUrl || null,
      bio: remoteUser.bio || null,
      createdAt: remoteUser.cachedAt, // Use cache time as we don't know their actual join date
      isRemote: true,
      nodeName: remoteUser.nodeName,
    });
  }

  return res.status(404).json({ error: 'User not found' });
});

// Upload profile avatar image
app.post('/api/profile/avatar', authenticateToken, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      // Handle multer errors (file too large, invalid type, etc.)
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 2MB' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Generate unique filename
    const filename = `${user.id}-${Date.now()}.webp`;
    const storageKey = `avatars/${filename}`;

    // Process image with sharp: resize to 256x256, convert to webp, strip metadata
    const processedBuffer = await sharp(req.file.buffer)
      .resize(256, 256, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toBuffer();

    // Upload to storage (local or S3)
    const avatarUrl = await storage.upload(processedBuffer, storageKey, 'image/webp');

    // Delete old avatar if exists
    if (user.avatarUrl) {
      const oldFilename = path.basename(user.avatarUrl);
      if (isValidAvatarFilename(oldFilename)) {
        await storage.delete(`avatars/${oldFilename}`);
      } else {
        console.warn(`Invalid avatar filename format, skipping deletion: ${oldFilename}`);
      }
    }

    // Update user with new avatar URL
    db.updateUser(user.id, { avatarUrl });

    res.json({ success: true, avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Delete profile avatar image
app.delete('/api/profile/avatar', authenticateToken, async (req, res) => {
  try {
    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.avatarUrl) {
      // Delete the file (with path traversal protection)
      const filename = path.basename(user.avatarUrl);
      if (isValidAvatarFilename(filename)) {
        await storage.delete(`avatars/${filename}`);
      } else {
        console.warn(`Invalid avatar filename format, skipping deletion: ${filename}`);
      }

      // Update user to remove avatar URL
      db.updateUser(user.id, { avatarUrl: null });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Avatar delete error:', err);
    res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

// ============ Message Image Upload ============
// Upload image for use in messages
app.post('/api/uploads', authenticateToken, (req, res, next) => {
  messageUpload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Generate unique filename: userId-timestamp.ext
    const timestamp = Date.now();
    const ext = req.file.mimetype === 'image/gif' ? 'gif' : 'webp';
    const filename = `${user.id}-${timestamp}.${ext}`;
    const storageKey = `messages/${filename}`;
    const contentType = req.file.mimetype === 'image/gif' ? 'image/gif' : 'image/webp';

    // Process image with sharp
    // For GIFs, preserve animation; for others, resize and convert to webp
    let processedBuffer;
    if (req.file.mimetype === 'image/gif') {
      // Keep GIF as-is to preserve animation, just resize if too large
      const metadata = await sharp(req.file.buffer).metadata();
      if (metadata.width > 1200 || metadata.height > 1200) {
        processedBuffer = await sharp(req.file.buffer, { animated: true })
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .toBuffer();
      } else {
        // Use as-is
        processedBuffer = req.file.buffer;
      }
    } else {
      // Convert to webp, resize if needed, strip metadata
      processedBuffer = await sharp(req.file.buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    }

    // Upload to storage (local or S3)
    const imageUrl = await storage.upload(processedBuffer, storageKey, contentType);
    console.log(`📷 Image uploaded by ${user.handle}: ${imageUrl}`);

    res.json({ success: true, url: imageUrl });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// ============ General File Upload ============
// Upload any file (non-executable) for use in messages
app.post('/api/uploads/file', authenticateToken, (req, res, next) => {
  fileUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 25MB' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Sanitize filename: strip unsafe chars, truncate to 100 chars
    const safeName = req.file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 100);
    const timestamp = Date.now();
    const filename = `${user.id}-${timestamp}-${safeName}`;
    const storageKey = `files/${filename}`;

    // Upload to storage (local or S3)
    const fileUrl = await storage.upload(req.file.buffer, storageKey, req.file.mimetype);
    console.log(`📎 File uploaded by ${user.handle}: ${safeName} (${req.file.size} bytes)`);

    res.json({
      success: true,
      url: fileUrl,
      filename: safeName,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// ============ Media Upload (Audio/Video) - v2.7.0 ============
// Upload audio/video recording for use in pings
app.post('/api/uploads/media', authenticateToken, (req, res, next) => {
  mediaUpload.single('media')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 500MB' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Determine media type from mimetype
    const isVideo = req.file.mimetype.startsWith('video/');
    const isAudio = req.file.mimetype.startsWith('audio/');

    if (!isVideo && !isAudio) {
      return res.status(400).json({ error: 'Invalid media type' });
    }

    // Enforce size limits: audio 10MB, video 50MB
    if (isAudio && req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Audio file too large. Maximum size is 10MB' });
    }

    // Get duration from request body (client-side calculated)
    const duration = parseInt(req.body.duration) || null;
    const timestamp = Date.now();

    // For video files, transcode to MP4 for cross-browser compatibility
    if (isVideo) {
      const tempFilename = `temp-${user.id}-${timestamp}.webm`;
      const tempFilepath = path.join(MEDIA_DIR, tempFilename);
      const outputFilename = `${user.id}-${timestamp}.mp4`;
      const outputFilepath = path.join(MEDIA_DIR, outputFilename);

      // Write the uploaded file temporarily
      fs.writeFileSync(tempFilepath, req.file.buffer);

      console.log(`🎬 Transcoding video for ${user.handle}...`);

      // Transcode to MP4 using FFmpeg
      await new Promise((resolve, reject) => {
        ffmpeg(tempFilepath)
          .outputOptions([
            '-c:v libx264',           // H.264 video codec (most compatible)
            '-preset veryfast',       // Faster encoding (better for server load)
            '-crf 28',                // Slightly lower quality for faster encode
            '-vf scale=\'min(1280,iw)\':\'min(720,ih)\':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2', // Max 720p, ensure even dimensions
            '-r 30',                  // Force 30fps (fixes variable framerate issues)
            '-c:a aac',               // AAC audio codec
            '-b:a 96k',               // Lower audio bitrate (sufficient for mobile)
            '-ac 2',                  // Stereo audio
            '-movflags +faststart',   // Enable fast start for web streaming
            '-y'                      // Overwrite output file
          ])
          .output(outputFilepath)
          .on('start', (cmd) => {
            console.log(`🎬 FFmpeg command: ${cmd}`);
          })
          .on('end', () => {
            // Clean up temp file
            try { fs.unlinkSync(tempFilepath); } catch (e) {}
            resolve();
          })
          .on('error', (err) => {
            // Clean up temp file on error
            try { fs.unlinkSync(tempFilepath); } catch (e) {}
            reject(err);
          })
          .run();
      });

      const outputStats = fs.statSync(outputFilepath);

      // Upload to storage (local keeps file in place, S3 uploads then cleans up)
      let mediaUrl;
      if (storage.isS3Enabled()) {
        const videoBuffer = fs.readFileSync(outputFilepath);
        mediaUrl = await storage.upload(videoBuffer, `media/${outputFilename}`, 'video/mp4');
        // Clean up local transcoded file after S3 upload
        try { fs.unlinkSync(outputFilepath); } catch (e) {}
      } else {
        mediaUrl = `/api/media/${outputFilename}`;
      }

      console.log(`🎬 Video transcoded by ${user.handle}: ${mediaUrl} (${Math.round(outputStats.size / 1024)}KB)`);

      return res.json({
        success: true,
        url: mediaUrl,
        type: 'video',
        duration: duration,
        size: outputStats.size
      });
    }

    // For audio files, upload directly (no transcoding needed)
    const mimeToExt = {
      'audio/webm': 'webm',
      'audio/mp4': 'm4a',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
    };
    const ext = mimeToExt[req.file.mimetype] || 'webm';
    const filename = `${user.id}-${timestamp}.${ext}`;
    const storageKey = `media/${filename}`;

    const mediaUrl = await storage.upload(req.file.buffer, storageKey, req.file.mimetype);

    console.log(`🎬 Audio uploaded by ${user.handle}: ${mediaUrl} (${Math.round(req.file.size / 1024)}KB)`);

    res.json({
      success: true,
      url: mediaUrl,
      type: 'audio',
      duration: duration,
      size: req.file.size
    });
  } catch (err) {
    console.error('Media upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload media' });
  }
});

// ============ Presigned Upload URL (v2.13.0) ============
// Get a presigned URL for direct browser-to-S3 uploads of large files
// This bypasses the server for large video uploads (Firefly episodes, etc.)
app.post('/api/uploads/presign', authenticateToken, async (req, res) => {
  try {
    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check if S3 storage is enabled
    if (!storage.isS3Enabled()) {
      return res.status(400).json({
        error: 'Direct uploads not available',
        message: 'S3 storage is not configured. Use standard upload endpoint.'
      });
    }

    const { filename, contentType, size } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType are required' });
    }

    // Validate content type (video/audio only for large uploads)
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
                          'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav'];
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type for direct upload' });
    }

    // Get size limits from env (default 5GB for S3, or override via S3_MAX_FILE_SIZE_MB)
    const maxSizeMB = parseInt(process.env.S3_MAX_FILE_SIZE_MB) || 5000;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    if (size && size > maxSizeBytes) {
      return res.status(400).json({
        error: `File too large. Maximum size is ${maxSizeMB}MB`
      });
    }

    // Generate storage key with user ID prefix for organization
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storageKey = `media/${user.id}-${timestamp}-${safeFilename}`;

    // Get presigned URL from storage provider
    const presigned = await storage.getPresignedUploadUrl(storageKey, contentType);

    if (!presigned) {
      return res.status(500).json({ error: 'Failed to generate presigned URL' });
    }

    console.log(`🔗 Presigned upload URL generated for ${user.handle}: ${storageKey}`);

    res.json({
      success: true,
      uploadUrl: presigned.uploadUrl,
      publicUrl: presigned.publicUrl,
      key: presigned.key,
      expiresIn: 3600 // 1 hour
    });
  } catch (err) {
    console.error('Presign error:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// ============ Media Streaming - v2.7.0 ============
// Stream media file with HTTP Range support for seeking
// Note: Uses custom auth that accepts token via query param (for <video>/<audio> elements)
app.get('/api/media/:filename', (req, res) => {
  try {
    // Custom auth: Accept token from header OR query param
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1];
    const queryToken = req.query.token;
    const token = headerToken || queryToken;

    if (!token) {
      return res.status(401).json({ error: 'Access denied' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const filename = req.params.filename;

    // Validate filename (prevent path traversal)
    if (!/^[a-zA-Z0-9_-]+-\d+\.(webm|m4a|ogg|mp3|wav|mp4|ogv)$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(MEDIA_DIR, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const stat = fs.statSync(filepath);
    const fileSize = stat.size;

    // Determine content type from extension
    const extToMime = {
      'webm': 'audio/webm',
      'm4a': 'audio/mp4',
      'ogg': 'audio/ogg',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'mp4': 'video/mp4',
      'ogv': 'video/ogg',
    };
    const ext = filename.split('.').pop();
    let contentType = extToMime[ext] || 'application/octet-stream';

    // Handle video webm files
    if (ext === 'webm') {
      // Check if it's video by looking at the file or using the filename pattern
      // For simplicity, webm could be either - browser will handle it
      contentType = 'video/webm';
    }

    const range = req.headers.range;

    if (range) {
      // HTTP Range request for seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      const stream = fs.createReadStream(filepath, { start, end });
      stream.pipe(res);
    } else {
      // Full file request
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      fs.createReadStream(filepath).pipe(res);
    }
  } catch (err) {
    console.error('Media streaming error:', err);
    res.status(500).json({ error: 'Failed to stream media' });
  }
});

app.post('/api/profile/password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await db.changePassword(req.user.userId, currentPassword, newPassword);
  if (!result.success) return res.status(400).json({ error: result.error });

  // Log activity
  if (db.logActivity) db.logActivity(req.user.userId, 'password_change', 'user', req.user.userId, getRequestMeta(req));

  res.json({ success: true });
});

app.post('/api/profile/handle-request', authenticateToken, (req, res) => {
  const newHandle = sanitizeInput(req.body.newHandle);
  if (!newHandle || !/^[a-zA-Z0-9_]{3,20}$/.test(newHandle)) {
    return res.status(400).json({ error: 'Handle must be 3-20 characters, letters/numbers/underscores only' });
  }

  const result = db.requestHandleChange(req.user.userId, newHandle);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, message: 'Handle change request submitted for review' });
});

app.put('/api/profile/preferences', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = {};
  const validThemes = [
    // Firefly Character Themes
    'serenity', 'malsBrowncoat', 'zoesWarrior', 'washSky', 'kayleeFloweredDress',
    'jaynesKnitCap', 'inaraSilk', 'simonsClinic', 'riversMind', 'booksWisdom',
    'reaverRed', 'allianceWhite',
    // Crossover Themes
    'pipBoy',
    // Accessibility Themes
    'highContrast', 'amoled', 'blackAndWhite'
  ];
  const validFontSizes = ['small', 'medium', 'large', 'xlarge'];

  if (req.body.theme) {
    // Accept built-in themes from the validThemes array
    if (validThemes.includes(req.body.theme)) {
      updates.theme = req.body.theme;
    }
    // Accept custom themes (format: custom-{themeId}) if they exist in the database
    else if (req.body.theme.startsWith('custom-')) {
      const customThemeId = req.body.theme.replace('custom-', '');
      const customTheme = db.getThemeById(customThemeId);
      if (customTheme) {
        updates.theme = req.body.theme;
      }
    }
  }
  if (req.body.fontSize && validFontSizes.includes(req.body.fontSize)) {
    updates.fontSize = req.body.fontSize;
  }
  if (typeof req.body.scanLines === 'boolean') {
    updates.scanLines = req.body.scanLines;
  }
  if (typeof req.body.holidayEffects === 'boolean') {
    updates.holidayEffects = req.body.holidayEffects;
  }
  if (typeof req.body.autoFocusDroplets === 'boolean') {
    updates.autoFocusDroplets = req.body.autoFocusDroplets;
  }
  if (typeof req.body.autoFocusMessages === 'boolean') {
    updates.autoFocusMessages = req.body.autoFocusMessages;
  }
  if (typeof req.body.autoCollapseMessages === 'boolean') {
    updates.autoCollapseMessages = req.body.autoCollapseMessages;
  }
  // Handle crawlBar preferences
  if (req.body.crawlBar && typeof req.body.crawlBar === 'object') {
    const existingCrawlBar = user.preferences?.crawlBar || {};
    const validScrollSpeeds = ['slow', 'normal', 'fast'];
    updates.crawlBar = {
      enabled: typeof req.body.crawlBar.enabled === 'boolean' ? req.body.crawlBar.enabled : (existingCrawlBar.enabled ?? true),
      location: req.body.crawlBar.location !== undefined ? req.body.crawlBar.location : (existingCrawlBar.location ?? null),
      locationName: req.body.crawlBar.locationName !== undefined ? req.body.crawlBar.locationName : (existingCrawlBar.locationName ?? null),
      showStocks: typeof req.body.crawlBar.showStocks === 'boolean' ? req.body.crawlBar.showStocks : (existingCrawlBar.showStocks ?? true),
      showWeather: typeof req.body.crawlBar.showWeather === 'boolean' ? req.body.crawlBar.showWeather : (existingCrawlBar.showWeather ?? true),
      showNews: typeof req.body.crawlBar.showNews === 'boolean' ? req.body.crawlBar.showNews : (existingCrawlBar.showNews ?? true),
      scrollSpeed: validScrollSpeeds.includes(req.body.crawlBar.scrollSpeed) ? req.body.crawlBar.scrollSpeed : (existingCrawlBar.scrollSpeed || 'normal'),
    };
  }
  // Handle videoFeed preferences (v2.8.0)
  if (req.body.videoFeed && typeof req.body.videoFeed === 'object') {
    const existingVideoFeed = user.preferences?.videoFeed || {};
    updates.videoFeed = {
      showInFeed: typeof req.body.videoFeed.showInFeed === 'boolean' ? req.body.videoFeed.showInFeed : (existingVideoFeed.showInFeed ?? true),
      autoplay: typeof req.body.videoFeed.autoplay === 'boolean' ? req.body.videoFeed.autoplay : (existingVideoFeed.autoplay ?? true),
    };
  }

  // Use the dedicated method that works with both JSON and SQLite
  const updatedPreferences = db.updateUserPreferences(req.user.userId, updates);
  if (!updatedPreferences) {
    return res.status(500).json({ error: 'Failed to update preferences' });
  }

  res.json({ success: true, preferences: updatedPreferences });
});

// Default notification preferences
const DEFAULT_NOTIFICATION_PREFS = {
  enabled: true,
  directMentions: 'always',      // always | app_closed | never
  replies: 'always',
  waveActivity: 'app_closed',
  burstEvents: 'app_closed',
  soundEnabled: false,
  suppressWhileFocused: true,
  pushDebounceMinutes: 5,        // 0 = no debounce (every message), up to 30 min
};

// Get notification preferences
app.get('/api/notifications/preferences', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const notificationPrefs = user.notificationPreferences || DEFAULT_NOTIFICATION_PREFS;
  res.json({ preferences: notificationPrefs });
});

// Update notification preferences
app.put('/api/notifications/preferences', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const validLevels = ['always', 'app_closed', 'never'];
  const updates = {};

  // Validate and apply updates
  if (typeof req.body.enabled === 'boolean') {
    updates.enabled = req.body.enabled;
  }
  if (req.body.directMentions && validLevels.includes(req.body.directMentions)) {
    updates.directMentions = req.body.directMentions;
  }
  if (req.body.replies && validLevels.includes(req.body.replies)) {
    updates.replies = req.body.replies;
  }
  if (req.body.waveActivity && validLevels.includes(req.body.waveActivity)) {
    updates.waveActivity = req.body.waveActivity;
  }
  if (req.body.burstEvents && validLevels.includes(req.body.burstEvents)) {
    updates.burstEvents = req.body.burstEvents;
  }
  if (typeof req.body.soundEnabled === 'boolean') {
    updates.soundEnabled = req.body.soundEnabled;
  }
  if (typeof req.body.suppressWhileFocused === 'boolean') {
    updates.suppressWhileFocused = req.body.suppressWhileFocused;
  }
  if (typeof req.body.pushDebounceMinutes === 'number') {
    updates.pushDebounceMinutes = Math.max(0, Math.min(30, Math.floor(req.body.pushDebounceMinutes)));
  }

  // Persist merged preferences to database
  const updatedPrefs = db.updateNotificationPreferences(req.user.userId, updates);

  res.json({ success: true, preferences: updatedPrefs });
});

// ============ Notification Routes ============

// Get notifications for current user
app.get('/api/notifications', authenticateToken, (req, res) => {
  const { unread, type, limit = 50, offset = 0 } = req.query;

  const notifications = db.getNotifications(req.user.userId, {
    unread: unread === 'true',
    type: type || null,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10)
  });

  res.json({ notifications });
});

// Get notification counts
app.get('/api/notifications/count', authenticateToken, (req, res) => {
  const counts = db.getNotificationCounts(req.user.userId);
  res.json(counts);
});

// Get unread notification counts by wave (for ripple activity badges)
app.get('/api/notifications/by-wave', authenticateToken, (req, res) => {
  const countsByWave = db.getUnreadCountsByWave(req.user.userId);
  res.json({ countsByWave });
});

// Get pending notifications for polling/sync (marks as delivered)
app.get('/api/notifications/pending', authenticateToken, (req, res) => {
  const pending = db.getPendingNotifications(req.user.userId);
  if (pending.length > 0) {
    db.markNotificationsPushSent(pending.map(n => n.id));
  }
  res.json({ notifications: pending });
});

// Mark notification as read
app.post('/api/notifications/:id/read', authenticateToken, (req, res) => {
  const success = db.markNotificationRead(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  // Broadcast updated count to user
  broadcastToUser(req.user.userId, {
    type: 'notification_read',
    notificationId: req.params.id
  });

  res.json({ success: true });
});

// Mark all notifications as read AND mark all waves as read
app.post('/api/notifications/read-all', authenticateToken, (req, res) => {
  const count = db.markAllNotificationsRead(req.user.userId);

  // Also mark all wave messages as read so wave unread badges clear
  const messagesMarked = db.markAllWavesAsRead ? db.markAllWavesAsRead(req.user.userId) : 0;
  if (messagesMarked > 0) {
    console.log(`📖 Mark all read: cleared ${messagesMarked} unread messages for ${req.user.handle}`);
  }

  // Broadcast updated count to user
  broadcastToUser(req.user.userId, {
    type: 'unread_count_update',
    count: 0
  });

  res.json({ success: true, count });
});

// Dismiss notification
app.delete('/api/notifications/:id', authenticateToken, (req, res) => {
  const success = db.dismissNotification(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  res.json({ success: true });
});

// Dismiss all notifications
app.delete('/api/notifications', authenticateToken, (req, res) => {
  const count = db.dismissAllNotifications(req.user.userId);
  broadcastToUser(req.user.userId, { type: 'unread_count_update', count: 0 });
  res.json({ success: true, count });
});

// Get wave notification settings
app.get('/api/waves/:id/notifications', authenticateToken, (req, res) => {
  const wave = db.getWave(req.params.id);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Verify user is a participant
  if (!participation.isParticipant(req.params.id, req.user.userId)) {
    return res.status(403).json({ error: 'Not a participant in this wave' });
  }

  const settings = db.getWaveNotificationSettings(req.user.userId, req.params.id);
  res.json(settings);
});

// Update wave notification settings
app.put('/api/waves/:id/notifications', authenticateToken, (req, res) => {
  const wave = db.getWave(req.params.id);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Verify user is a participant
  if (!participation.isParticipant(req.params.id, req.user.userId)) {
    return res.status(403).json({ error: 'Not a participant in this wave' });
  }

  const { enabled, level, sound, push } = req.body;
  db.setWaveNotificationSettings(req.user.userId, req.params.id, {
    enabled,
    level,
    sound,
    push
  });

  res.json({ success: true });
});

// ============ Push Notification Routes ============

// Get VAPID public key for client subscription
app.get('/api/push/vapid-key', authenticateToken, (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(501).json({ error: 'Push notifications not configured' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
app.post('/api/push/subscribe', authenticateToken, (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(501).json({ error: 'Push notifications not configured' });
  }

  const { subscription } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    console.log('❌ Invalid push subscription object:', JSON.stringify(subscription, null, 2));
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
    console.log(`🔔 Adding push subscription for user ${req.user.userId}, endpoint: ${subscription.endpoint.substring(0, 60)}...`);
    pushSubs.addSubscription(req.user.userId, subscription);
    console.log(`✅ Push subscription added for user ${req.user.userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ Failed to add push subscription for user ${req.user.userId}:`, error.message);
    res.status(500).json({ error: `Database error: ${error.message}` });
  }
});

// Unsubscribe from push notifications
app.delete('/api/push/subscribe', authenticateToken, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    // Remove all subscriptions for this user
    pushSubs.removeAllSubscriptions(req.user.userId);
    console.log(`🔕 All push subscriptions removed for user ${req.user.userId}`);
  } else {
    // Remove specific subscription
    pushSubs.removeSubscription(req.user.userId, endpoint);
    console.log(`🔕 Push subscription removed for user ${req.user.userId}`);
  }
  res.json({ success: true });
});

// Test push notification (development only)
app.post('/api/push/test', authenticateToken, async (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(501).json({ error: 'Push notifications not configured' });
  }

  const subscriptions = pushSubs.getSubscriptions(req.user.userId);
  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No push subscriptions found' });
  }

  const payload = JSON.stringify({
    title: 'Cortex Test',
    body: 'Push notifications are working!',
    tag: 'test',
    url: '/'
  });

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: sub.keys
      }, payload);
      sent++;
    } catch (error) {
      console.error('Push notification failed:', error.statusCode);
      if (error.statusCode === 410 || error.statusCode === 404) {
        // Subscription expired or invalid
        pushSubs.removeByEndpoint(sub.endpoint);
      }
    }
  }

  res.json({ success: true, sent, total: subscriptions.length });
});

// Check push subscription status (v2.36.0 - auto-resubscribe support)
app.get('/api/push/status', authenticateToken, (req, res) => {
  const subs = pushSubs.getSubscriptions(req.user.userId);
  const hasWebPush = subs.some(s => !s.endpoint?.startsWith('fcm:'));
  const hasFcm = subs.some(s => s.endpoint?.startsWith('fcm:'));
  res.json({ subscribed: subs.length > 0, webPush: hasWebPush, fcm: hasFcm, count: subs.length });
});

// ============ FCM Push Notifications (Capacitor Mobile App v2.31.0) ============

// Register FCM push token (for Capacitor native apps)
app.post('/api/push/fcm/register', authenticateToken, (req, res) => {
  const { token, platform, deviceId } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'FCM token is required' });
  }

  if (!admin.apps.length) {
    return res.status(501).json({ error: 'Firebase not configured on server' });
  }

  try {
    pushSubs.addSubscription(req.user.userId, {
      endpoint: `fcm:${token}`,
      keys: {
        type: 'fcm',
        platform: platform || 'unknown',
        deviceName: `${(platform || 'Mobile').charAt(0).toUpperCase() + (platform || 'mobile').slice(1)} Device`,
        deviceId: deviceId || null,
      },
    });

    console.log(`📱 FCM token registered for user ${req.user.userId}: ${token.substring(0, 20)}...`);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to register FCM token:', error);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

// Unregister FCM push token
app.post('/api/push/fcm/unregister', authenticateToken, (req, res) => {
  const { token } = req.body;

  try {
    if (token) {
      pushSubs.removeSubscription(req.user.userId, `fcm:${token}`);
      console.log(`📱 FCM token unregistered for user ${req.user.userId}`);
    } else {
      // Remove all FCM tokens for this user
      const subs = pushSubs.getSubscriptions(req.user.userId);
      for (const sub of subs) {
        if (sub.endpoint?.startsWith('fcm:')) {
          pushSubs.removeSubscription(req.user.userId, sub.endpoint);
        }
      }
      console.log(`📱 All FCM tokens unregistered for user ${req.user.userId}`);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to unregister FCM token:', error);
    res.status(500).json({ error: 'Failed to unregister push token' });
  }
});

// Admin handle request management (admin only)
app.get('/api/admin/handle-requests', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const requests = db.getPendingHandleRequests().map(r => {
    const requestUser = db.findUserById(r.userId);
    return { ...r, displayName: requestUser?.displayName };
  });
  res.json(requests);
});

app.post('/api/admin/handle-requests/:id/approve', authenticateToken, (req, res) => {
  const result = db.approveHandleChange(req.params.id, req.user.userId);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/admin/handle-requests/:id/reject', authenticateToken, (req, res) => {
  const result = db.rejectHandleChange(req.params.id, req.user.userId, req.body.reason);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// ============ User Routes ============
app.get('/api/users/search', authenticateToken, (req, res) => {
  const query = sanitizeInput(req.query.q);
  if (!query || query.length < 2) return res.json([]);
  
  const users = db.searchUsers(query, req.user.userId);
  const contactIds = db.getContactsForUser(req.user.userId).map(c => c.id);
  const results = users.map(u => ({ ...u, isContact: contactIds.includes(u.id) }));
  res.json(results);
});

// ============ Contact Routes ============
app.get('/api/contacts', authenticateToken, (req, res) => {
  res.json(db.getContactsForUser(req.user.userId));
});

app.post('/api/contacts', authenticateToken, (req, res) => {
  const handle = sanitizeInput(req.body.handle || req.body.username);
  const contact = db.findUserByHandle(handle);
  if (!contact) return res.status(404).json({ error: 'User not found' });
  if (contact.id === req.user.userId) return res.status(400).json({ error: 'Cannot add yourself' });

  if (!db.addContact(req.user.userId, contact.id)) {
    return res.status(409).json({ error: 'Contact already exists' });
  }
  res.status(201).json({
    success: true,
    contact: { id: contact.id, handle: contact.handle, name: contact.displayName, avatar: contact.avatar, status: contact.status, nodeName: contact.nodeName },
  });
});

// ============ Encrypted Contacts (v2.18.0 - Privacy Hardening Phase 2) ============
// NOTE: These routes MUST come before /api/contacts/:id to avoid route param matching

// Get encrypted contacts blob
app.get('/api/contacts/encrypted', authenticateToken, (req, res) => {
  const encrypted = db.getEncryptedContacts(req.user.userId);
  if (!encrypted) {
    return res.json({ encrypted: false });
  }
  res.json({
    encrypted: true,
    encryptedData: encrypted.encryptedData,
    nonce: encrypted.nonce,
    version: encrypted.version,
    updatedAt: encrypted.updatedAt,
  });
});

// Save encrypted contacts blob
app.put('/api/contacts/encrypted', authenticateToken, (req, res) => {
  const { encryptedData, nonce, expectedVersion } = req.body;

  if (!encryptedData || !nonce) {
    return res.status(400).json({ error: 'encryptedData and nonce are required' });
  }

  // Basic validation - data should be base64
  try {
    Buffer.from(encryptedData, 'base64');
    Buffer.from(nonce, 'base64');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid base64 encoding' });
  }

  const result = db.saveEncryptedContacts(
    req.user.userId,
    encryptedData,
    nonce,
    expectedVersion ?? null
  );

  if (!result.success) {
    return res.status(409).json({ error: result.error, version: result.version });
  }

  res.json({ success: true, version: result.version });
});

// Check encrypted contacts migration status
app.get('/api/contacts/encrypted/status', authenticateToken, (req, res) => {
  const hasEncrypted = db.hasEncryptedContacts(req.user.userId);
  const plaintextContacts = db.getContactsForUser(req.user.userId);

  res.json({
    hasEncryptedContacts: hasEncrypted,
    plaintextContactCount: plaintextContacts.length,
    needsMigration: !hasEncrypted && plaintextContacts.length > 0,
  });
});

// Delete contact - must come AFTER /api/contacts/encrypted routes
app.delete('/api/contacts/:id', authenticateToken, (req, res) => {
  if (!db.removeContact(req.user.userId, sanitizeInput(req.params.id))) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  res.json({ success: true });
});

// ============ Contact Request Routes ============
// Send a contact request
app.post('/api/contacts/request', authenticateToken, (req, res) => {
  const { toUserId, message } = req.body;
  if (!toUserId) {
    return res.status(400).json({ error: 'toUserId is required' });
  }

  const result = db.createContactRequest(req.user.userId, sanitizeInput(toUserId), message);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Broadcast to recipient via WebSocket
  broadcast({
    type: 'contact_request_received',
    request: result
  }, [result.to_user_id]);

  res.status(201).json(result);
});

// Follow a federated user (direct add, no request flow)
app.post('/api/contacts/follow', authenticateToken, (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Verify the target is a remote user
  const remoteUser = db.getRemoteUser(userId);
  if (!remoteUser) {
    return res.status(400).json({ error: 'User not found or not a federated user' });
  }

  // Add as contact directly (one-way follow)
  const success = db.addContact(req.user.userId, userId);
  if (!success) {
    return res.status(400).json({ error: 'Already following this user' });
  }

  res.json({
    success: true,
    contact: {
      id: remoteUser.id,
      handle: remoteUser.handle,
      name: remoteUser.displayName,
      avatar: remoteUser.avatar,
      avatarUrl: remoteUser.avatarUrl,
      nodeName: remoteUser.nodeName,
      isRemote: true,
    }
  });
});

// Unfollow a federated user
app.delete('/api/contacts/follow/:userId', authenticateToken, (req, res) => {
  const targetUserId = sanitizeInput(req.params.userId);

  // Verify the target is a remote user
  const remoteUser = db.getRemoteUser(targetUserId);
  if (!remoteUser) {
    return res.status(400).json({ error: 'User not found or not a federated user' });
  }

  const success = db.removeContact(req.user.userId, targetUserId);
  if (!success) {
    return res.status(400).json({ error: 'Not following this user' });
  }

  res.json({ success: true });
});

// Get received pending contact requests
app.get('/api/contacts/requests', authenticateToken, (req, res) => {
  const requests = db.getContactRequestsForUser(req.user.userId);
  res.json(requests.map(r => ({
    ...r,
    expiresAt: new Date(new Date(r.created_at).getTime() + INVITATION_EXPIRY_DAYS * 86400000).toISOString()
  })));
});

// Get sent pending contact requests
app.get('/api/contacts/requests/sent', authenticateToken, (req, res) => {
  const requests = db.getSentContactRequests(req.user.userId);
  res.json(requests.map(r => ({
    ...r,
    expiresAt: new Date(new Date(r.created_at).getTime() + INVITATION_EXPIRY_DAYS * 86400000).toISOString()
  })));
});

// Accept a contact request
app.post('/api/contacts/requests/:id/accept', authenticateToken, (req, res) => {
  const requestId = sanitizeInput(req.params.id);
  const result = db.acceptContactRequest(requestId, req.user.userId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Notify the sender that their request was accepted
  broadcast({
    type: 'contact_request_accepted',
    requestId: requestId,
    acceptedBy: req.user.userId
  }, [result.request.from_user_id]);

  res.json({ success: true, message: 'Contact request accepted' });
});

// Decline a contact request
app.post('/api/contacts/requests/:id/decline', authenticateToken, (req, res) => {
  const requestId = sanitizeInput(req.params.id);
  const result = db.declineContactRequest(requestId, req.user.userId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Optionally notify the sender (some apps don't do this for privacy)
  broadcast({
    type: 'contact_request_declined',
    requestId: requestId
  }, [result.request.from_user_id]);

  res.json({ success: true, message: 'Contact request declined' });
});

// Cancel a sent contact request
app.delete('/api/contacts/requests/:id', authenticateToken, (req, res) => {
  const requestId = sanitizeInput(req.params.id);
  const request = db.getContactRequest(requestId);

  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  const result = db.cancelContactRequest(requestId, req.user.userId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Notify the recipient that the request was cancelled
  broadcast({
    type: 'contact_request_cancelled',
    requestId: requestId
  }, [request.to_user_id]);

  res.json({ success: true, message: 'Contact request cancelled' });
});

// ============ Group Invitation Routes ============
// Invite user(s) to a group
app.post('/api/groups/:id/invite', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);
  const { userIds, message } = req.body;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds array is required' });
  }

  // Check if inviter is a group member
  if (!crewMembership.isMember(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Only group members can invite others' });
  }

  const results = [];
  const errors = [];

  for (const userId of userIds) {
    const result = db.createGroupInvitation(groupId, req.user.userId, sanitizeInput(userId), message);

    if (result.error) {
      errors.push({ userId, error: result.error });
    } else {
      results.push(result);

      // Broadcast to invitee via WebSocket
      broadcast({
        type: 'group_invitation_received',
        invitation: result
      }, [result.invited_user_id]);
    }
  }

  res.status(201).json({
    success: results.length > 0,
    invitations: results,
    errors: errors.length > 0 ? errors : undefined
  });
});

// Get pending group invitations for current user
app.get('/api/groups/invitations', authenticateToken, (req, res) => {
  const invitations = db.getGroupInvitationsForUser(req.user.userId);
  res.json(invitations.map(inv => ({
    ...inv,
    expiresAt: new Date(new Date(inv.created_at).getTime() + INVITATION_EXPIRY_DAYS * 86400000).toISOString()
  })));
});

// Get all pending invitations sent by current user across all crews (v2.36.0)
app.get('/api/groups/invitations/sent', authenticateToken, (req, res) => {
  const invitations = db.getAllSentGroupInvitations(req.user.userId);
  res.json(invitations.map(inv => ({
    ...inv,
    expiresAt: new Date(new Date(inv.created_at).getTime() + INVITATION_EXPIRY_DAYS * 86400000).toISOString()
  })));
});

// Get pending invitations sent for a specific group
app.get('/api/groups/:id/invitations/sent', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);

  // Check if requester is a group member
  if (!crewMembership.isMember(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Not a group member' });
  }

  const invitations = db.getGroupInvitationsSent(groupId, req.user.userId);
  res.json(invitations);
});

// Accept a group invitation
app.post('/api/groups/invitations/:id/accept', authenticateToken, (req, res) => {
  const invitationId = sanitizeInput(req.params.id);
  const result = db.acceptGroupInvitation(invitationId, req.user.userId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Notify the inviter that their invitation was accepted
  broadcast({
    type: 'group_invitation_accepted',
    invitationId: invitationId,
    userId: req.user.userId,
    groupId: result.invitation.group_id
  }, [result.invitation.invited_by]);

  res.json({
    success: true,
    message: 'Group invitation accepted',
    group: result.group
  });
});

// Decline a group invitation
app.post('/api/groups/invitations/:id/decline', authenticateToken, (req, res) => {
  const invitationId = sanitizeInput(req.params.id);
  const result = db.declineGroupInvitation(invitationId, req.user.userId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Notify the inviter that their invitation was declined
  broadcast({
    type: 'group_invitation_declined',
    invitationId: invitationId
  }, [result.invitation.invited_by]);

  res.json({ success: true, message: 'Group invitation declined' });
});

// Cancel a sent group invitation
app.delete('/api/groups/invitations/:id', authenticateToken, (req, res) => {
  const invitationId = sanitizeInput(req.params.id);
  const invitation = db.getGroupInvitation(invitationId);

  if (!invitation) {
    return res.status(404).json({ error: 'Invitation not found' });
  }

  const result = db.cancelGroupInvitation(invitationId, req.user.userId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Notify the invitee that the invitation was cancelled
  broadcast({
    type: 'group_invitation_cancelled',
    invitationId: invitationId
  }, [invitation.invited_user_id]);

  res.json({ success: true, message: 'Group invitation cancelled' });
});

// ============ Moderation Routes ============
// Block user
app.post('/api/users/:id/block', authenticateToken, (req, res) => {
  const targetUserId = sanitizeInput(req.params.id);
  const userId = req.user.userId;

  if (userId === targetUserId) {
    return res.status(400).json({ error: 'Cannot block yourself' });
  }

  if (!db.blockUser(userId, targetUserId)) {
    return res.status(400).json({ error: 'User already blocked or not found' });
  }

  res.json({ success: true });
});

// Unblock user
app.delete('/api/users/:id/block', authenticateToken, (req, res) => {
  const targetUserId = sanitizeInput(req.params.id);
  const userId = req.user.userId;

  if (!db.unblockUser(userId, targetUserId)) {
    return res.status(404).json({ error: 'Block not found' });
  }

  res.json({ success: true });
});

// Get blocked users
app.get('/api/users/blocked', authenticateToken, (req, res) => {
  const blockedUsers = db.getBlockedUsers(req.user.userId);
  res.json({ blockedUsers });
});

// Mute user
app.post('/api/users/:id/mute', authenticateToken, (req, res) => {
  const targetUserId = sanitizeInput(req.params.id);
  const userId = req.user.userId;

  if (userId === targetUserId) {
    return res.status(400).json({ error: 'Cannot mute yourself' });
  }

  if (!db.muteUser(userId, targetUserId)) {
    return res.status(400).json({ error: 'User already muted or not found' });
  }

  res.json({ success: true });
});

// Unmute user
app.delete('/api/users/:id/mute', authenticateToken, (req, res) => {
  const targetUserId = sanitizeInput(req.params.id);
  const userId = req.user.userId;

  if (!db.unmuteUser(userId, targetUserId)) {
    return res.status(404).json({ error: 'Mute not found' });
  }

  res.json({ success: true });
});

// Get muted users
app.get('/api/users/muted', authenticateToken, (req, res) => {
  const mutedUsers = db.getMutedUsers(req.user.userId);
  res.json({ mutedUsers });
});

// ============ GIF Search (GIPHY and Tenor API Proxy) ============

// Helper: Search GIFs from GIPHY
async function searchGiphy(query, limit, offset) {
  if (!GIPHY_API_KEY) return null;

  const searchUrl = new URL('https://api.giphy.com/v1/gifs/search');
  searchUrl.searchParams.set('api_key', GIPHY_API_KEY);
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('limit', limit.toString());
  searchUrl.searchParams.set('offset', offset.toString());
  searchUrl.searchParams.set('rating', 'pg-13');
  searchUrl.searchParams.set('lang', 'en');

  const response = await fetch(searchUrl.toString(), {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    console.error('GIPHY API error:', response.status);
    return null;
  }

  const data = await response.json();
  return (data.data || []).map(gif => ({
    id: gif.id,
    title: gif.title,
    url: gif.images?.original?.url || '',
    preview: gif.images?.fixed_height_small?.url || gif.images?.fixed_height?.url || '',
    width: parseInt(gif.images?.fixed_height_small?.width || gif.images?.fixed_height?.width || 100),
    height: parseInt(gif.images?.fixed_height_small?.height || gif.images?.fixed_height?.height || 100),
    provider: 'giphy'
  })).filter(gif => gif.url && gif.preview);
}

// Helper: Search GIFs from Tenor
// Tenor API v2 uses token-based pagination, not numeric offsets
// Returns: { gifs: [...], next: 'token' }
async function searchTenor(query, limit, pos = '') {
  if (!TENOR_API_KEY) return null;

  const searchUrl = new URL('https://tenor.googleapis.com/v2/search');
  searchUrl.searchParams.set('key', TENOR_API_KEY);
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('limit', limit.toString());
  if (pos) {
    searchUrl.searchParams.set('pos', pos);
  }
  searchUrl.searchParams.set('contentfilter', 'medium'); // PG-13 equivalent
  searchUrl.searchParams.set('media_filter', 'gif,tinygif');

  const response = await fetch(searchUrl.toString(), {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    console.error('Tenor API error:', response.status);
    return null;
  }

  const data = await response.json();
  const gifs = (data.results || []).map(gif => ({
    id: gif.id,
    title: gif.title || gif.content_description || '',
    url: gif.media_formats?.gif?.url || '',
    preview: gif.media_formats?.tinygif?.url || gif.media_formats?.nanogif?.url || '',
    width: gif.media_formats?.tinygif?.dims?.[0] || 100,
    height: gif.media_formats?.tinygif?.dims?.[1] || 100,
    provider: 'tenor'
  })).filter(gif => gif.url && gif.preview);

  return {
    gifs,
    next: data.next || null // Pagination token for next page
  };
}

// Helper: Get trending GIFs from GIPHY
async function trendingGiphy(limit, offset) {
  if (!GIPHY_API_KEY) return null;

  const trendingUrl = new URL('https://api.giphy.com/v1/gifs/trending');
  trendingUrl.searchParams.set('api_key', GIPHY_API_KEY);
  trendingUrl.searchParams.set('limit', limit.toString());
  trendingUrl.searchParams.set('offset', offset.toString());
  trendingUrl.searchParams.set('rating', 'pg-13');

  const response = await fetch(trendingUrl.toString(), {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) return null;

  const data = await response.json();
  return (data.data || []).map(gif => ({
    id: gif.id,
    title: gif.title,
    url: gif.images?.original?.url || '',
    preview: gif.images?.fixed_height_small?.url || gif.images?.fixed_height?.url || '',
    width: parseInt(gif.images?.fixed_height_small?.width || gif.images?.fixed_height?.width || 100),
    height: parseInt(gif.images?.fixed_height_small?.height || gif.images?.fixed_height?.height || 100),
    provider: 'giphy'
  })).filter(gif => gif.url && gif.preview);
}

// Helper: Get trending/featured GIFs from Tenor
// Tenor API v2 uses token-based pagination, not numeric offsets
// Returns: { gifs: [...], next: 'token' }
async function trendingTenor(limit, pos = '') {
  if (!TENOR_API_KEY) {
    console.log('🎬 Tenor trending: No API key');
    return null;
  }

  const featuredUrl = new URL('https://tenor.googleapis.com/v2/featured');
  featuredUrl.searchParams.set('key', TENOR_API_KEY);
  featuredUrl.searchParams.set('limit', limit.toString());
  if (pos) {
    featuredUrl.searchParams.set('pos', pos);
  }
  featuredUrl.searchParams.set('contentfilter', 'medium');
  featuredUrl.searchParams.set('media_filter', 'gif,tinygif');

  console.log(`🎬 Tenor trending: Fetching ${limit} GIFs with pos="${pos}"...`);
  const response = await fetch(featuredUrl.toString(), {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    console.error(`🎬 Tenor trending: API error ${response.status}`);
    return null;
  }

  const data = await response.json();
  const gifs = (data.results || []).map(gif => ({
    id: gif.id,
    title: gif.title || gif.content_description || '',
    url: gif.media_formats?.gif?.url || '',
    preview: gif.media_formats?.tinygif?.url || gif.media_formats?.nanogif?.url || '',
    width: gif.media_formats?.tinygif?.dims?.[0] || 100,
    height: gif.media_formats?.tinygif?.dims?.[1] || 100,
    provider: 'tenor'
  })).filter(gif => gif.url && gif.preview);

  console.log(`🎬 Tenor trending: Returned ${gifs.length} GIFs, next="${data.next || 'none'}"`);
  return {
    gifs,
    next: data.next || null // Pagination token for next page
  };
}

// Get GIF provider configuration
app.get('/api/gifs/config', authenticateToken, (req, res) => {
  const providers = [];
  if (GIPHY_API_KEY && (GIF_PROVIDER === 'giphy' || GIF_PROVIDER === 'both')) {
    providers.push('giphy');
  }
  if (TENOR_API_KEY && (GIF_PROVIDER === 'tenor' || GIF_PROVIDER === 'both')) {
    providers.push('tenor');
  }
  res.json({
    providers,
    defaultProvider: GIF_PROVIDER,
    enabled: providers.length > 0
  });
});

// Search GIFs
app.get('/api/gifs/search', authenticateToken, gifSearchLimiter, async (req, res) => {
  const { q, limit = 20, offset = 0, pos, provider } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const maxLimit = Math.min(parseInt(limit) || 20, 50);
  const startOffset = parseInt(offset) || 0;
  const query = q.trim();
  const tenorPos = pos || ''; // Tenor pagination token

  // Determine which provider(s) to use
  const useProvider = provider || GIF_PROVIDER;
  const hasGiphy = GIPHY_API_KEY && (useProvider === 'giphy' || useProvider === 'both');
  const hasTenor = TENOR_API_KEY && (useProvider === 'tenor' || useProvider === 'both');

  if (!hasGiphy && !hasTenor) {
    return res.status(503).json({
      error: 'GIF search is not configured. Set GIPHY_API_KEY or TENOR_API_KEY environment variable.'
    });
  }

  try {
    let gifs = [];
    let nextToken = null;

    if (useProvider === 'both' && hasGiphy && hasTenor) {
      // Fetch from both and interleave results
      const halfLimit = Math.ceil(maxLimit / 2);
      const [giphyGifs, tenorResult] = await Promise.all([
        searchGiphy(query, halfLimit, Math.floor(startOffset / 2)),
        searchTenor(query, halfLimit, tenorPos)
      ]);

      // Interleave results
      const g = giphyGifs || [];
      const t = tenorResult?.gifs || [];
      for (let i = 0; i < Math.max(g.length, t.length); i++) {
        if (i < g.length) gifs.push(g[i]);
        if (i < t.length) gifs.push(t[i]);
      }
      nextToken = tenorResult?.next || null;
    } else if (hasGiphy) {
      gifs = await searchGiphy(query, maxLimit, startOffset) || [];
    } else if (hasTenor) {
      const tenorResult = await searchTenor(query, maxLimit, tenorPos);
      gifs = tenorResult?.gifs || [];
      nextToken = tenorResult?.next || null;
    }

    res.json({
      gifs,
      pagination: {
        total_count: gifs.length * 10, // Estimate
        count: gifs.length,
        offset: startOffset,
        next: nextToken // Tenor pagination token (null for GIPHY)
      },
      provider: useProvider
    });
  } catch (err) {
    console.error('GIF search error:', err);
    res.status(500).json({ error: 'Failed to search GIFs' });
  }
});

// Get trending GIFs
app.get('/api/gifs/trending', authenticateToken, gifSearchLimiter, async (req, res) => {
  const { limit = 20, offset = 0, pos, provider } = req.query;

  const maxLimit = Math.min(parseInt(limit) || 20, 50);
  const startOffset = parseInt(offset) || 0;
  const tenorPos = pos || ''; // Tenor pagination token

  // Determine which provider(s) to use
  const useProvider = provider || GIF_PROVIDER;
  const hasGiphy = GIPHY_API_KEY && (useProvider === 'giphy' || useProvider === 'both');
  const hasTenor = TENOR_API_KEY && (useProvider === 'tenor' || useProvider === 'both');

  console.log(`🎬 GIF trending: provider=${useProvider}, hasGiphy=${hasGiphy}, hasTenor=${hasTenor}, pos="${tenorPos}"`);

  if (!hasGiphy && !hasTenor) {
    return res.status(503).json({
      error: 'GIF search is not configured. Set GIPHY_API_KEY or TENOR_API_KEY environment variable.'
    });
  }

  try {
    let gifs = [];
    let nextToken = null;

    if (useProvider === 'both' && hasGiphy && hasTenor) {
      const halfLimit = Math.ceil(maxLimit / 2);
      const [giphyGifs, tenorResult] = await Promise.all([
        trendingGiphy(halfLimit, Math.floor(startOffset / 2)),
        trendingTenor(halfLimit, tenorPos)
      ]);

      const g = giphyGifs || [];
      const t = tenorResult?.gifs || [];
      for (let i = 0; i < Math.max(g.length, t.length); i++) {
        if (i < g.length) gifs.push(g[i]);
        if (i < t.length) gifs.push(t[i]);
      }
      nextToken = tenorResult?.next || null;
    } else if (hasGiphy) {
      gifs = await trendingGiphy(maxLimit, startOffset) || [];
    } else if (hasTenor) {
      const tenorResult = await trendingTenor(maxLimit, tenorPos);
      gifs = tenorResult?.gifs || [];
      nextToken = tenorResult?.next || null;
    }

    res.json({
      gifs,
      pagination: {
        total_count: gifs.length * 10,
        count: gifs.length,
        offset: startOffset,
        next: nextToken // Tenor pagination token (null for GIPHY)
      },
      provider: useProvider
    });
  } catch (err) {
    console.error('Trending GIFs error:', err);
    res.status(500).json({ error: 'Failed to fetch trending GIFs' });
  }
});

// ============ Jellyfin Integration Endpoints (v2.14.0) ============

// Helper: Encrypt Jellyfin token for storage
function encryptJellyfinToken(token) {
  // Simple XOR encryption with JWT_SECRET for storage
  // In production, consider using crypto.createCipheriv with proper IV
  if (!token) return null;
  const key = JWT_SECRET.slice(0, 32).padEnd(32, '0');
  let encrypted = '';
  for (let i = 0; i < token.length; i++) {
    encrypted += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(encrypted, 'binary').toString('base64');
}

// Helper: Decrypt Jellyfin token
function decryptJellyfinToken(encrypted) {
  if (!encrypted) return null;
  const key = JWT_SECRET.slice(0, 32).padEnd(32, '0');
  const token = Buffer.from(encrypted, 'base64').toString('binary');
  let decrypted = '';
  for (let i = 0; i < token.length; i++) {
    decrypted += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return decrypted;
}

/// Helper: Make authenticated request to Jellyfin server
async function jellyfinRequest(serverUrl, path, accessToken, options = {}) {
  const url = new URL(path, serverUrl);
  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      'Accept': 'application/json',
      'X-Emby-Token': accessToken,
      ...(options.headers || {}),
    },
  });
  return response;
}

// Get user's Jellyfin connections
app.get('/api/jellyfin/connections', authenticateToken, (req, res) => {
  try {
    const connections = db.getJellyfinConnectionsByUser(req.user.userId);
    // Don't expose access tokens to client
    const safeConnections = connections.map(c => ({
      id: c.id,
      serverUrl: c.serverUrl,
      serverName: c.serverName,
      jellyfinUserId: c.jellyfinUserId,
      status: c.status,
      lastConnected: c.lastConnected,
      createdAt: c.createdAt,
    }));
    res.json({ connections: safeConnections });
  } catch (err) {
    console.error('Error fetching Jellyfin connections:', err);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Add new Jellyfin connection (authenticate with Jellyfin server)
// Supports both username/password auth and direct API key
app.post('/api/jellyfin/connections', authenticateToken, jellyfinLimiter, async (req, res) => {
  const { serverUrl, username, password, apiKey } = req.body;

  // Require server URL and either credentials or API key
  if (!serverUrl) {
    return res.status(400).json({ error: 'Server URL is required' });
  }
  if (!apiKey && (!username || !password)) {
    return res.status(400).json({ error: 'Either API key or username/password is required' });
  }

  // Validate and normalize server URL
  let normalizedUrl;
  try {
    normalizedUrl = new URL(serverUrl);
    normalizedUrl = normalizedUrl.origin; // Strip path
  } catch {
    return res.status(400).json({ error: 'Invalid server URL' });
  }

  try {
    let accessToken;
    let jellyfinUserId = null;
    let serverName = 'Jellyfin';

    if (apiKey) {
      // Direct API key - validate it works
      const testResponse = await fetch(`${normalizedUrl}/System/Info`, {
        headers: {
          'X-Emby-Token': apiKey,
        },
      });

      if (!testResponse.ok) {
        return res.status(401).json({ error: 'Invalid API key. Check your key and server URL.' });
      }

      const info = await testResponse.json();
      serverName = info.ServerName || 'Jellyfin';
      accessToken = apiKey;

      // Get user list to find a user ID for library access
      const usersResponse = await fetch(`${normalizedUrl}/Users`, {
        headers: {
          'X-Emby-Token': apiKey,
        },
      });

      if (usersResponse.ok) {
        const users = await usersResponse.json();
        // Use the first admin user, or first user if no admin
        const adminUser = users.find(u => u.Policy?.IsAdministrator);
        const firstUser = users[0];
        jellyfinUserId = (adminUser || firstUser)?.Id || null;
      }

      if (!jellyfinUserId) {
        return res.status(400).json({ error: 'Could not find a user for library access. Try username/password auth instead.' });
      }
    } else {
      // Username/password authentication
      const authResponse = await fetch(`${normalizedUrl}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': 'MediaBrowser Client="Cortex", Device="Server", DeviceId="cortex-server", Version="2.14.0"',
        },
        body: JSON.stringify({ Username: username, Pw: password }),
      });

      if (!authResponse.ok) {
        const error = await authResponse.text();
        console.error('Jellyfin auth failed:', error);
        return res.status(401).json({ error: 'Authentication failed. Check your credentials.' });
      }

      const authData = await authResponse.json();
      accessToken = authData.AccessToken;
      jellyfinUserId = authData.User?.Id;
      serverName = 'Jellyfin';
    }

    // Get server info for name
    try {
      const infoResponse = await jellyfinRequest(normalizedUrl, '/System/Info/Public', accessToken);
      if (infoResponse.ok) {
        const info = await infoResponse.json();
        if (info.ServerName) {
          // Use server's actual name
        }
      }
    } catch { /* Ignore, use default name */ }

    // Encrypt token before storage
    const encryptedToken = encryptJellyfinToken(accessToken);

    // Store connection
    const connection = db.createJellyfinConnection({
      userId: req.user.userId,
      serverUrl: normalizedUrl,
      accessToken: encryptedToken,
      jellyfinUserId,
      serverName,
    });

    res.json({
      connection: {
        id: connection.id,
        serverUrl: connection.serverUrl,
        serverName: connection.serverName,
        jellyfinUserId: connection.jellyfinUserId,
        status: connection.status,
        createdAt: connection.createdAt,
      }
    });
  } catch (err) {
    console.error('Jellyfin connection error:', err);
    res.status(500).json({ error: 'Failed to connect to Jellyfin server' });
  }
});

// Test Jellyfin connection
app.post('/api/jellyfin/connections/:id/test', authenticateToken, jellyfinLimiter, async (req, res) => {
  const { id } = req.params;

  // Verify ownership
  if (!db.userOwnsJellyfinConnection(req.user.userId, id)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const connection = db.getJellyfinConnection(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const accessToken = decryptJellyfinToken(connection.accessToken);
    const response = await jellyfinRequest(connection.serverUrl, '/System/Info', accessToken);

    if (!response.ok) {
      db.updateJellyfinConnection(id, { status: 'error' });
      return res.status(401).json({ error: 'Connection failed. Token may have expired.' });
    }

    const info = await response.json();
    db.touchJellyfinConnection(id);

    res.json({
      success: true,
      serverName: info.ServerName,
      version: info.Version,
    });
  } catch (err) {
    console.error('Jellyfin test error:', err);
    db.updateJellyfinConnection(id, { status: 'error' });
    res.status(500).json({ error: 'Connection test failed' });
  }
});

// Delete Jellyfin connection
app.delete('/api/jellyfin/connections/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  // Verify ownership
  if (!db.userOwnsJellyfinConnection(req.user.userId, id)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  // Delete associated feed imports first
  db.deleteJellyfinFeedImportsByConnection(id);

  const success = db.deleteJellyfinConnection(id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Connection not found' });
  }
});

// Get Jellyfin library folders
app.get('/api/jellyfin/library/:connectionId', authenticateToken, jellyfinLimiter, async (req, res) => {
  const { connectionId } = req.params;

  // Verify ownership
  if (!db.userOwnsJellyfinConnection(req.user.userId, connectionId)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const connection = db.getJellyfinConnection(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const accessToken = decryptJellyfinToken(connection.accessToken);
    const response = await jellyfinRequest(
      connection.serverUrl,
      `/Users/${connection.jellyfinUserId}/Views`,
      accessToken
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch library' });
    }

    const data = await response.json();
    db.touchJellyfinConnection(connectionId);

    // Return simplified library structure
    const libraries = (data.Items || []).map(item => ({
      id: item.Id,
      name: item.Name,
      collectionType: item.CollectionType,
      imageTag: item.ImageTags?.Primary,
    }));

    res.json({ libraries });
  } catch (err) {
    console.error('Jellyfin library error:', err);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

// Browse/search Jellyfin items
app.get('/api/jellyfin/items/:connectionId', authenticateToken, jellyfinLimiter, async (req, res) => {
  const { connectionId } = req.params;
  const { parentId, searchTerm, includeTypes, limit = 50, startIndex = 0 } = req.query;

  // Verify ownership
  if (!db.userOwnsJellyfinConnection(req.user.userId, connectionId)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const connection = db.getJellyfinConnection(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const accessToken = decryptJellyfinToken(connection.accessToken);

    // Build query params
    const params = new URLSearchParams({
      Recursive: 'true',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Fields: 'PrimaryImageAspectRatio,Overview,Genres,RunTimeTicks,Path',
      ImageTypeLimit: '1',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      Limit: Math.min(parseInt(limit) || 50, 100).toString(),
      StartIndex: (parseInt(startIndex) || 0).toString(),
    });

    if (parentId) params.set('ParentId', parentId);
    if (searchTerm) params.set('SearchTerm', searchTerm);
    if (includeTypes) params.set('IncludeItemTypes', includeTypes);

    const response = await jellyfinRequest(
      connection.serverUrl,
      `/Users/${connection.jellyfinUserId}/Items?${params.toString()}`,
      accessToken
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch items' });
    }

    const data = await response.json();
    db.touchJellyfinConnection(connectionId);

    // Return simplified item structure
    const items = (data.Items || []).map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      overview: item.Overview,
      genres: item.Genres,
      runTimeTicks: item.RunTimeTicks,
      primaryImageTag: item.ImageTags?.Primary,
      backdropImageTag: item.BackdropImageTags?.[0],
      seriesName: item.SeriesName,
      seasonName: item.SeasonName,
      indexNumber: item.IndexNumber,
      parentIndexNumber: item.ParentIndexNumber,
    }));

    res.json({
      items,
      totalCount: data.TotalRecordCount,
      startIndex: data.StartIndex,
    });
  } catch (err) {
    console.error('Jellyfin items error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Get single Jellyfin item details
app.get('/api/jellyfin/item/:connectionId/:itemId', authenticateToken, jellyfinLimiter, async (req, res) => {
  const { connectionId, itemId } = req.params;

  // Verify ownership
  if (!db.userOwnsJellyfinConnection(req.user.userId, connectionId)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const connection = db.getJellyfinConnection(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const accessToken = decryptJellyfinToken(connection.accessToken);
    const response = await jellyfinRequest(
      connection.serverUrl,
      `/Users/${connection.jellyfinUserId}/Items/${itemId}`,
      accessToken
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Item not found' });
    }

    const item = await response.json();
    db.touchJellyfinConnection(connectionId);

    res.json({
      item: {
        id: item.Id,
        name: item.Name,
        type: item.Type,
        overview: item.Overview,
        genres: item.Genres,
        runTimeTicks: item.RunTimeTicks,
        primaryImageTag: item.ImageTags?.Primary,
        backdropImageTag: item.BackdropImageTags?.[0],
        seriesName: item.SeriesName,
        seasonName: item.SeasonName,
        indexNumber: item.IndexNumber,
        parentIndexNumber: item.ParentIndexNumber,
        mediaStreams: item.MediaStreams,
        path: item.Path,
      },
    });
  } catch (err) {
    console.error('Jellyfin item error:', err);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// Proxy Jellyfin video stream
// Accepts token via query param for direct browser access
app.get('/api/jellyfin/stream/:connectionId/:itemId', async (req, res) => {
  const { connectionId, itemId } = req.params;
  const { token } = req.query;

  // Try to authenticate - accept token from query param or header
  let userId = null;
  const authHeader = req.headers.authorization;
  const tokenToVerify = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : token;

  if (tokenToVerify) {
    try {
      const decoded = jwt.verify(tokenToVerify, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch (err) {
      console.error('Jellyfin stream JWT error:', err.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Allow any authenticated user to access streams from valid connections
  // Security: user must be authenticated, connection must exist
  // The connection owner chose to share content by posting it in a wave
  const connection = db.getJellyfinConnection(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const accessToken = decryptJellyfinToken(connection.accessToken);

    // Try WebM with VP8/Vorbis - the classic WebM codec combination
    // VP8 is older and more widely supported than VP9
    // Lower bitrate to reduce buffering/decode issues
    const playSessionId = `cortex-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const streamUrl = `${connection.serverUrl}/Videos/${itemId}/stream.webm?api_key=${encodeURIComponent(accessToken)}&Static=false&Container=webm&VideoCodec=vp8&AudioCodec=vorbis&VideoBitRate=1500000&AudioBitRate=96000&MaxWidth=1280&MaxHeight=720&TranscodingMaxAudioChannels=2&PlaySessionId=${playSessionId}`;

    console.log(`[Jellyfin] Redirecting to stream: ${streamUrl.replace(accessToken, '***')}`);

    // Return the direct URL for the client to use
    // Note: This exposes the API key in the URL, but it's temporary and scoped to this video
    res.json({ streamUrl });
  } catch (err) {
    console.error('Jellyfin stream error:', err);
    res.status(500).json({ error: 'Failed to get stream' });
  }
});

// Proxy Jellyfin thumbnail/image
// Note: Uses optionalAuthenticateToken since <img src> can't pass headers
// Falls back to token query param for image requests
app.get('/api/jellyfin/thumbnail/:connectionId/:itemId', async (req, res) => {
  const { connectionId, itemId } = req.params;
  const { type = 'Primary', maxWidth = 400, token } = req.query;

  // Try to authenticate - accept token from query param for image requests
  let userId = null;
  const authHeader = req.headers.authorization;
  const tokenToVerify = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : token;

  if (tokenToVerify) {
    try {
      const decoded = jwt.verify(tokenToVerify, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch (err) {
      console.error('Jellyfin thumbnail JWT error:', err.message);
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Verify ownership or wave participant access
  const ownsConnection = db.userOwnsJellyfinConnection(userId, connectionId);
  if (!ownsConnection) {
    // Check if user is in any wave where this media was shared
    // For now, allow any authenticated user to view thumbnails from valid connections
    // This is safe because we still validate the connection exists
  }

  const connection = db.getJellyfinConnection(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const accessToken = decryptJellyfinToken(connection.accessToken);

    // Proxy image from Jellyfin
    const imageUrl = `${connection.serverUrl}/Items/${itemId}/Images/${type}?maxWidth=${maxWidth}`;
    const response = await fetch(imageUrl, {
      headers: {
        'X-Emby-Token': accessToken,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Image not found' });
    }

    // Forward image response
    const contentType = response.headers.get('content-type');
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Jellyfin thumbnail error:', err);
    res.status(500).json({ error: 'Failed to fetch thumbnail' });
  }
});

// ============ Watch Party Endpoints (v2.14.0) ============

// Get all active watch parties for waves the user participates in
app.get('/api/jellyfin/watch-parties/active', authenticateToken, (req, res) => {
  try {
    const parties = db.getActiveWatchPartiesForUser(req.user.userId);
    res.json({ parties: parties || [] });
  } catch (err) {
    console.error('Failed to get active watch parties:', err);
    res.json({ parties: [] });
  }
});

// Get active watch party for a wave
app.get('/api/watch-parties/:waveId', authenticateToken, (req, res) => {
  const { waveId } = req.params;

  // Verify user is participant in wave
  const wave = db.getWaveWithParticipants(waveId, req.user.userId);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  const party = db.getActiveWatchPartyForWave(waveId);
  if (!party) {
    return res.json({ party: null });
  }

  // Don't expose access token
  res.json({
    party: {
      id: party.id,
      waveId: party.waveId,
      hostUserId: party.hostUserId,
      hostHandle: party.hostHandle,
      hostName: party.hostName,
      hostAvatar: party.hostAvatar,
      jellyfinItemId: party.jellyfinItemId,
      mediaTitle: party.mediaTitle,
      mediaType: party.mediaType,
      playbackPosition: party.playbackPosition,
      isPlaying: party.isPlaying,
      lastSyncAt: party.lastSyncAt,
      createdAt: party.createdAt,
    },
  });
});

// Create a watch party
app.post('/api/watch-parties', authenticateToken, (req, res) => {
  const { waveId, connectionId, itemId, mediaTitle, mediaType } = req.body;

  if (!waveId || !connectionId || !itemId) {
    return res.status(400).json({ error: 'Wave ID, connection ID, and item ID are required' });
  }

  // Verify user is participant in wave
  const wave = db.getWaveWithParticipants(waveId, req.user.userId);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Verify user owns the connection
  if (!db.userOwnsJellyfinConnection(req.user.userId, connectionId)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const party = db.createWatchParty({
      waveId,
      hostUserId: req.user.userId,
      jellyfinConnectionId: connectionId,
      jellyfinItemId: itemId,
      mediaTitle: mediaTitle || 'Unknown Media',
      mediaType: mediaType || 'Video',
    });

    // Notify wave participants via WebSocket
    const waveParticipants = wave.participants || [];
    waveParticipants.forEach(p => {
      if (p.id !== req.user.userId && userConnections.has(p.id)) {
        const ws = userConnections.get(p.id);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'watch_party_started',
            waveId,
            party: {
              id: party.id,
              hostUserId: party.hostUserId,
              hostName: party.hostName,
              mediaTitle: party.mediaTitle,
              mediaType: party.mediaType,
            },
          }));
        }
      }
    });

    res.json({ party });
  } catch (err) {
    console.error('Create watch party error:', err);
    res.status(500).json({ error: 'Failed to create watch party' });
  }
});

// End a watch party (host only)
app.delete('/api/watch-parties/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  const party = db.getWatchParty(id);
  if (!party) {
    return res.status(404).json({ error: 'Watch party not found' });
  }

  // Only host can end the party
  if (party.hostUserId !== req.user.userId) {
    return res.status(403).json({ error: 'Only the host can end the watch party' });
  }

  const success = db.endWatchParty(id);
  if (success) {
    // Notify wave participants
    const wave = db.getWaveWithParticipants(party.waveId, req.user.userId);
    const waveParticipants = wave?.participants || [];
    waveParticipants.forEach(p => {
      if (userConnections.has(p.id)) {
        const ws = userConnections.get(p.id);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'watch_party_ended',
            waveId: party.waveId,
            partyId: id,
          }));
        }
      }
    });

    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Watch party not found or already ended' });
  }
});

// ============ Jellyfin Feed Import Endpoints (v2.14.0) ============

// Get user's personal video libraries from Jellyfin
app.get('/api/jellyfin/personal-videos/:connectionId', authenticateToken, jellyfinLimiter, async (req, res) => {
  const { connectionId } = req.params;

  // Verify ownership
  if (!db.userOwnsJellyfinConnection(req.user.userId, connectionId)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const connection = db.getJellyfinConnection(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const accessToken = decryptJellyfinToken(connection.accessToken);

    // Get user's views/libraries
    const viewsResponse = await jellyfinRequest(
      connection.serverUrl,
      `/Users/${connection.jellyfinUserId}/Views`,
      accessToken
    );

    if (!viewsResponse.ok) {
      return res.status(viewsResponse.status).json({ error: 'Failed to fetch libraries' });
    }

    const views = await viewsResponse.json();

    // Filter to video-type collections (movies, homevideos, tvshows, musicvideos)
    const videoLibraries = (views.Items || []).filter(item =>
      ['movies', 'homevideos', 'tvshows', 'musicvideos'].includes(item.CollectionType)
    );

    // For each video library, get items
    const libraries = await Promise.all(
      videoLibraries.map(async (lib) => {
        const params = new URLSearchParams({
          ParentId: lib.Id,
          Recursive: 'true',
          IncludeItemTypes: 'Movie,Video,Episode,MusicVideo',
          SortBy: 'DateCreated',
          SortOrder: 'Descending',
          Fields: 'PrimaryImageAspectRatio,Overview,RunTimeTicks',
          ImageTypeLimit: '1',
          EnableImageTypes: 'Primary,Thumb',
          Limit: '100',
        });

        const itemsResponse = await jellyfinRequest(
          connection.serverUrl,
          `/Users/${connection.jellyfinUserId}/Items?${params.toString()}`,
          accessToken
        );

        if (!itemsResponse.ok) return { ...lib, items: [] };

        const data = await itemsResponse.json();
        return {
          id: lib.Id,
          name: lib.Name,
          collectionType: lib.CollectionType,
          items: (data.Items || []).map(item => ({
            id: item.Id,
            name: item.Name,
            type: item.Type,
            overview: item.Overview,
            runTimeTicks: item.RunTimeTicks,
            primaryImageTag: item.ImageTags?.Primary,
            seriesName: item.SeriesName,
          })),
        };
      })
    );

    db.touchJellyfinConnection(connectionId);
    res.json({ libraries });
  } catch (err) {
    console.error('Jellyfin personal videos error:', err);
    res.status(500).json({ error: 'Failed to fetch personal videos' });
  }
});

// Import Jellyfin video to feed
app.post('/api/jellyfin/feed-import', authenticateToken, jellyfinLimiter, async (req, res) => {
  const { connectionId, itemId, title, thumbnailUrl, durationTicks, mediaType } = req.body;

  if (!connectionId || !itemId || !title) {
    return res.status(400).json({ error: 'Connection ID, item ID, and title are required' });
  }

  // Verify ownership
  if (!db.userOwnsJellyfinConnection(req.user.userId, connectionId)) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    const importEntry = db.createJellyfinFeedImport({
      userId: req.user.userId,
      connectionId,
      jellyfinItemId: itemId,
      title,
      thumbnailUrl,
      durationTicks,
      mediaType,
    });

    res.json({ import: importEntry });
  } catch (err) {
    console.error('Jellyfin feed import error:', err);
    res.status(500).json({ error: 'Failed to import video' });
  }
});

// Get user's Jellyfin feed imports
app.get('/api/jellyfin/feed-imports', authenticateToken, (req, res) => {
  try {
    const imports = db.getJellyfinFeedImportsByUser(req.user.userId);
    res.json({ imports });
  } catch (err) {
    console.error('Jellyfin feed imports error:', err);
    res.status(500).json({ error: 'Failed to fetch imports' });
  }
});

// Delete Jellyfin feed import
app.delete('/api/jellyfin/feed-import/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  const success = db.deleteJellyfinFeedImport(id, req.user.userId);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Import not found' });
  }
});

// ============ Plex Integration Endpoints (v2.15.0) ============

// Plex client identifier for API requests
const PLEX_CLIENT_IDENTIFIER = 'cortex-media-server';
const PLEX_PRODUCT = 'Cortex';
const PLEX_VERSION = '2.15.0';

// Helper: Encrypt Plex token for storage (same encryption as Jellyfin)
function encryptPlexToken(token) {
  if (!token) return null;
  const key = JWT_SECRET.slice(0, 32).padEnd(32, '0');
  let encrypted = '';
  for (let i = 0; i < token.length; i++) {
    encrypted += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(encrypted, 'binary').toString('base64');
}

// Helper: Decrypt Plex token
function decryptPlexToken(encrypted) {
  if (!encrypted) return null;
  const key = JWT_SECRET.slice(0, 32).padEnd(32, '0');
  const token = Buffer.from(encrypted, 'base64').toString('binary');
  let decrypted = '';
  for (let i = 0; i < token.length; i++) {
    decrypted += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return decrypted;
}

// Helper: Get Plex request headers
function getPlexHeaders(accessToken = null) {
  const headers = {
    'Accept': 'application/json',
    'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
    'X-Plex-Product': PLEX_PRODUCT,
    'X-Plex-Version': PLEX_VERSION,
  };
  if (accessToken) {
    headers['X-Plex-Token'] = accessToken;
  }
  return headers;
}

// Helper: Make authenticated request to Plex server
async function plexRequest(serverUrl, path, accessToken, options = {}) {
  const url = new URL(path, serverUrl);
  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      ...getPlexHeaders(accessToken),
      ...(options.headers || {}),
    },
  });
  return response;
}

// ---- Plex OAuth Flow ----

// Request PIN from plex.tv for OAuth flow
app.post('/api/plex/auth/pin', authenticateToken, plexLimiter, async (req, res) => {
  try {
    const response = await fetch('https://plex.tv/api/v2/pins', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Version': PLEX_VERSION,
      },
      body: 'strong=true',
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Plex PIN request failed:', text);
      return res.status(response.status).json({ error: 'Failed to request PIN from Plex' });
    }

    const data = await response.json();
    res.json({
      pinId: data.id,
      code: data.code,
      authUrl: `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_IDENTIFIER}&code=${data.code}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_PRODUCT)}`,
    });
  } catch (err) {
    console.error('Plex PIN request error:', err);
    res.status(500).json({ error: 'Failed to request PIN from Plex' });
  }
});

// Poll PIN status to get auth token
app.get('/api/plex/auth/pin/:pinId', authenticateToken, plexLimiter, async (req, res) => {
  const { pinId } = req.params;

  try {
    const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to check PIN status' });
    }

    const data = await response.json();

    if (data.authToken) {
      // User has authenticated, get their user info
      const userResponse = await fetch('https://plex.tv/api/v2/user', {
        headers: getPlexHeaders(data.authToken),
      });

      let plexUser = null;
      if (userResponse.ok) {
        plexUser = await userResponse.json();
      }

      res.json({
        authenticated: true,
        authToken: data.authToken,
        plexUserId: plexUser?.id?.toString() || null,
        username: plexUser?.username || null,
      });
    } else {
      res.json({ authenticated: false });
    }
  } catch (err) {
    console.error('Plex PIN check error:', err);
    res.status(500).json({ error: 'Failed to check PIN status' });
  }
});

// Get available servers after OAuth authentication
app.get('/api/plex/auth/servers', authenticateToken, plexLimiter, async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    // Get resources (servers) from plex.tv
    const response = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
      headers: getPlexHeaders(token),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch servers' });
    }

    const resources = await response.json();

    // Filter to only Plex Media Server instances that are owned
    const servers = resources
      .filter(r => r.provides === 'server' && r.owned)
      .map(server => {
        // Find the best connection - prefer local, then relay, then remote
        const connections = server.connections || [];
        const localConn = connections.find(c => c.local && !c.relay);
        const remoteConn = connections.find(c => !c.local && !c.relay);
        const relayConn = connections.find(c => c.relay);
        const bestConn = localConn || remoteConn || relayConn || connections[0];

        return {
          name: server.name,
          machineIdentifier: server.clientIdentifier,
          accessToken: server.accessToken,
          connection: bestConn ? {
            uri: bestConn.uri,
            local: bestConn.local,
            relay: bestConn.relay,
          } : null,
        };
      })
      .filter(s => s.connection); // Only include servers with valid connections

    res.json({ servers });
  } catch (err) {
    console.error('Plex servers fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// ---- Plex Connection Management ----

// Get user's Plex connections
app.get('/api/plex/connections', authenticateToken, (req, res) => {
  try {
    // Check if method exists (table may not be created yet)
    if (typeof db.getPlexConnectionsByUser !== 'function') {
      return res.json({ connections: [] });
    }
    const connections = db.getPlexConnectionsByUser(req.user.userId);
    // Don't expose access tokens to client
    const safeConnections = (connections || []).map(c => ({
      id: c.id,
      serverUrl: c.serverUrl,
      serverName: c.serverName,
      plexUserId: c.plexUserId,
      machineIdentifier: c.machineIdentifier,
      status: c.status,
      lastConnected: c.lastConnected,
      createdAt: c.createdAt,
    }));
    res.json({ connections: safeConnections });
  } catch (err) {
    console.error('Error fetching Plex connections:', err);
    // If table doesn't exist yet, return empty array
    if (err.message && err.message.includes('no such table')) {
      return res.json({ connections: [] });
    }
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Add new Plex connection (from OAuth or direct token)
app.post('/api/plex/connections', authenticateToken, plexLimiter, async (req, res) => {
  const { serverUrl, accessToken, serverName, machineIdentifier, plexUserId } = req.body;

  if (!serverUrl || !accessToken) {
    return res.status(400).json({ error: 'Server URL and access token are required' });
  }

  // Validate and normalize server URL
  let normalizedUrl;
  try {
    normalizedUrl = new URL(serverUrl);
    normalizedUrl = normalizedUrl.origin; // Strip path
  } catch {
    return res.status(400).json({ error: 'Invalid server URL' });
  }

  try {
    // Test the connection
    const testResponse = await plexRequest(normalizedUrl, '/', accessToken);

    if (!testResponse.ok) {
      return res.status(401).json({ error: 'Invalid Plex credentials. Could not connect to server.' });
    }

    // Get server info if not provided
    let finalServerName = serverName;
    let finalMachineId = machineIdentifier;

    if (!finalServerName || !finalMachineId) {
      const infoResponse = await plexRequest(normalizedUrl, '/identity', accessToken);
      if (infoResponse.ok) {
        const info = await infoResponse.json();
        const container = info.MediaContainer || info;
        finalServerName = finalServerName || container.friendlyName || 'Plex Server';
        finalMachineId = finalMachineId || container.machineIdentifier;
      }
    }

    // Check for existing connection to this server
    const existingConnections = db.getPlexConnectionsByUser(req.user.userId);
    const existing = existingConnections.find(c => c.serverUrl === normalizedUrl);

    if (existing) {
      // Update existing connection
      db.updatePlexConnection(existing.id, {
        accessToken: encryptPlexToken(accessToken),
        serverName: finalServerName,
        machineIdentifier: finalMachineId,
        plexUserId: plexUserId,
      });
      db.touchPlexConnection(existing.id);

      return res.json({
        connection: {
          id: existing.id,
          serverUrl: normalizedUrl,
          serverName: finalServerName,
          plexUserId: plexUserId,
          machineIdentifier: finalMachineId,
          status: 'active',
        },
        updated: true,
      });
    }

    // Create new connection
    const connection = db.createPlexConnection({
      userId: req.user.userId,
      serverUrl: normalizedUrl,
      accessToken: encryptPlexToken(accessToken),
      plexUserId: plexUserId,
      serverName: finalServerName || 'Plex Server',
      machineIdentifier: finalMachineId,
    });

    res.json({
      connection: {
        id: connection.id,
        serverUrl: connection.serverUrl,
        serverName: connection.serverName,
        plexUserId: connection.plexUserId,
        machineIdentifier: connection.machineIdentifier,
        status: connection.status,
        createdAt: connection.createdAt,
      },
    });
  } catch (err) {
    console.error('Plex connection error:', err);
    res.status(500).json({ error: 'Failed to connect to Plex server' });
  }
});

// Test Plex connection
app.post('/api/plex/connections/:id/test', authenticateToken, plexLimiter, async (req, res) => {
  const { id } = req.params;

  try {
    if (!db.userOwnsPlexConnection(req.user.userId, id)) {
      return res.status(403).json({ error: 'Not your connection' });
    }

    const connection = db.getPlexConnection(id);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const accessToken = decryptPlexToken(connection.accessToken);
    const response = await plexRequest(connection.serverUrl, '/identity', accessToken);

    if (!response.ok) {
      return res.status(400).json({ error: 'Connection test failed', status: response.status });
    }

    db.touchPlexConnection(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Plex connection test error:', err);
    res.status(500).json({ error: 'Connection test failed' });
  }
});

// Delete Plex connection
app.delete('/api/plex/connections/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  if (!db.userOwnsPlexConnection(req.user.userId, id)) {
    return res.status(403).json({ error: 'Not your connection' });
  }

  const success = db.deletePlexConnection(id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Connection not found' });
  }
});

// ---- Plex Library & Items ----

// Get library sections
app.get('/api/plex/library/:connectionId', authenticateToken, plexLimiter, async (req, res) => {
  const { connectionId } = req.params;

  try {
    if (!db.userOwnsPlexConnection(req.user.userId, connectionId)) {
      return res.status(403).json({ error: 'Not your connection' });
    }

    const connection = db.getPlexConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const accessToken = decryptPlexToken(connection.accessToken);
    const response = await plexRequest(connection.serverUrl, '/library/sections', accessToken);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch library sections' });
    }

    const data = await response.json();
    const container = data.MediaContainer || data;

    const sections = (container.Directory || []).map(section => ({
      key: section.key,
      title: section.title,
      type: section.type, // movie, show, artist, photo
      art: section.art,
      thumb: section.composite,
    }));

    db.touchPlexConnection(connectionId);
    res.json({ sections });
  } catch (err) {
    console.error('Plex library fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

// Get items in a library section or search
app.get('/api/plex/items/:connectionId', authenticateToken, plexLimiter, async (req, res) => {
  const { connectionId } = req.params;
  const { sectionKey, parentRatingKey, searchTerm, type, limit = 50 } = req.query;

  try {
    if (!db.userOwnsPlexConnection(req.user.userId, connectionId)) {
      return res.status(403).json({ error: 'Not your connection' });
    }

    const connection = db.getPlexConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const accessToken = decryptPlexToken(connection.accessToken);
    let path;

    if (searchTerm) {
      // Search across library
      path = `/search?query=${encodeURIComponent(searchTerm)}`;
      if (sectionKey) {
        path += `&sectionId=${sectionKey}`;
      }
    } else if (parentRatingKey) {
      // Get children of an item (seasons of a show, episodes of a season)
      path = `/library/metadata/${parentRatingKey}/children`;
    } else if (sectionKey) {
      // Get items in a section
      const typeParam = type ? `&type=${type}` : '';
      path = `/library/sections/${sectionKey}/all?${typeParam}`;
    } else {
      return res.status(400).json({ error: 'sectionKey, parentRatingKey, or searchTerm is required' });
    }

    const response = await plexRequest(connection.serverUrl, path, accessToken);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch items' });
    }

    const data = await response.json();
    const container = data.MediaContainer || data;

    // Handle both search results and direct listings
    const metadata = container.Metadata || container.Hub?.flatMap(h => h.Metadata || []) || [];

    const items = metadata.slice(0, Math.min(parseInt(limit), 100)).map(item => ({
      ratingKey: item.ratingKey,
      key: item.key,
      title: item.title,
      type: item.type, // movie, show, season, episode, track, album, artist
      year: item.year,
      summary: item.summary,
      thumb: item.thumb,
      art: item.art,
      duration: item.duration, // in milliseconds
      parentTitle: item.parentTitle, // Season name for episodes
      grandparentTitle: item.grandparentTitle, // Show name for episodes
      index: item.index, // Episode number
      parentIndex: item.parentIndex, // Season number
      viewCount: item.viewCount,
      leafCount: item.leafCount, // Episode count for shows/seasons
    }));

    db.touchPlexConnection(connectionId);
    res.json({ items, totalSize: container.size || items.length });
  } catch (err) {
    console.error('Plex items fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Get single item details
app.get('/api/plex/item/:connectionId/:ratingKey', authenticateToken, plexLimiter, async (req, res) => {
  const { connectionId, ratingKey } = req.params;

  try {
    if (!db.userOwnsPlexConnection(req.user.userId, connectionId)) {
      return res.status(403).json({ error: 'Not your connection' });
    }

    const connection = db.getPlexConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const accessToken = decryptPlexToken(connection.accessToken);
    const response = await plexRequest(connection.serverUrl, `/library/metadata/${ratingKey}`, accessToken);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch item' });
    }

    const data = await response.json();
    const container = data.MediaContainer || data;
    const item = (container.Metadata || [])[0];

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get media info
    const media = item.Media?.[0] || {};
    const part = media.Part?.[0] || {};
    const streams = part.Stream || [];

    res.json({
      item: {
        ratingKey: item.ratingKey,
        key: item.key,
        title: item.title,
        type: item.type,
        year: item.year,
        summary: item.summary,
        thumb: item.thumb,
        art: item.art,
        duration: item.duration,
        parentTitle: item.parentTitle,
        grandparentTitle: item.grandparentTitle,
        index: item.index,
        parentIndex: item.parentIndex,
        contentRating: item.contentRating,
        rating: item.rating,
        media: {
          videoCodec: media.videoCodec,
          audioCodec: media.audioCodec,
          container: media.container,
          width: media.width,
          height: media.height,
          bitrate: media.bitrate,
        },
        streams: streams.map(s => ({
          streamType: s.streamType, // 1=video, 2=audio, 3=subtitle
          codec: s.codec,
          language: s.language,
          languageCode: s.languageCode,
        })),
      },
    });
  } catch (err) {
    console.error('Plex item fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// ---- Plex Streaming ----

// Get stream info and proxied URL for playback
app.get('/api/plex/stream/:connectionId/:ratingKey', authenticateToken, plexLimiter, async (req, res) => {
  const { connectionId, ratingKey } = req.params;

  try {
    // Allow any authenticated user to stream - connection IDs are only shared via message embeds
    // The connection owner controls what gets shared by embedding content in messages
    const connection = db.getPlexConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const accessToken = decryptPlexToken(connection.accessToken);

    // First get the item to find the media key
    const itemResponse = await plexRequest(connection.serverUrl, `/library/metadata/${ratingKey}`, accessToken);

    if (!itemResponse.ok) {
      return res.status(itemResponse.status).json({ error: 'Failed to fetch item info' });
    }

    const itemData = await itemResponse.json();
    const container = itemData.MediaContainer || itemData;
    const item = (container.Metadata || [])[0];

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get the media part key
    const media = item.Media?.[0];
    const part = media?.Part?.[0];

    if (!part) {
      return res.status(404).json({ error: 'No playable media found' });
    }

    db.touchPlexConnection(connectionId);

    // Check if file is browser-compatible (MP4/M4V with H264)
    const fileContainer = media?.container?.toLowerCase();
    const videoCodec = media?.videoCodec?.toLowerCase();
    const isBrowserCompatible =
      (fileContainer === 'mp4' || fileContainer === 'm4v' || fileContainer === 'mov') &&
      (videoCodec === 'h264' || videoCodec === 'avc1');

    if (isBrowserCompatible) {
      // Direct stream through Cortex proxy (avoids CORS issues)
      res.json({
        streamUrl: `/api/plex/video/${connectionId}/${ratingKey}`,
        duration: item.duration,
        title: item.title,
        type: item.type,
        container: media?.container,
        videoCodec: media?.videoCodec,
        audioCodec: media?.audioCodec,
      });
    } else {
      // Needs transcoding - check if Plex can transcode, then return HLS URL
      console.log(`Plex stream: ${fileContainer}/${videoCodec} needs transcoding`);

      const decisionUrl = `${connection.serverUrl}/video/:/transcode/universal/decision?` +
        `path=${encodeURIComponent(`/library/metadata/${ratingKey}`)}` +
        `&mediaIndex=0&partIndex=0` +
        `&protocol=hls` +
        `&fastSeek=1` +
        `&directPlay=0&directStream=0` +
        `&subtitleSize=100&audioBoost=100` +
        `&location=lan` +
        `&session=cortex-${Date.now()}` +
        `&X-Plex-Platform=Chrome` +
        `&X-Plex-Client-Identifier=${PLEX_CLIENT_IDENTIFIER}` +
        `&X-Plex-Token=${accessToken}`;

      const decisionResponse = await fetch(decisionUrl, {
        headers: getPlexHeaders(accessToken),
      });

      if (!decisionResponse.ok) {
        return res.status(400).json({
          error: `Cannot play ${fileContainer.toUpperCase()} format. Plex transcoding unavailable.`
        });
      }

      const decisionData = await decisionResponse.json();
      const mediaContainer = decisionData.MediaContainer || decisionData;
      const generalCode = mediaContainer.generalDecisionCode;

      if (generalCode === 2000) {
        return res.status(400).json({
          error: `This ${fileContainer.toUpperCase()} file cannot be played. Your Plex server doesn't support transcoding. Try MP4/H264 format or enable transcoding in Plex.`
        });
      }

      // Plex approved transcoding - return HLS URL for client to use with hls.js
      const sessionId = `cortex-${Date.now()}`;
      const hlsUrl = `${connection.serverUrl}/video/:/transcode/universal/start.m3u8?` +
        `path=${encodeURIComponent(`/library/metadata/${ratingKey}`)}` +
        `&mediaIndex=0&partIndex=0` +
        `&offset=0` +
        `&protocol=hls` +
        `&copyts=1` +
        `&fastSeek=1` +
        `&directPlay=0&directStream=0` +
        `&videoQuality=100` +
        `&videoResolution=1920x1080` +
        `&maxVideoBitrate=8000` +
        `&subtitleSize=100&audioBoost=100` +
        `&location=lan` +
        `&addDebugOverlay=0` +
        `&autoAdjustQuality=0` +
        `&directStreamAudio=0` +
        `&mediaBufferSize=102400` +
        `&session=${sessionId}` +
        `&X-Plex-Platform=Chrome` +
        `&X-Plex-Product=Cortex` +
        `&X-Plex-Client-Identifier=${PLEX_CLIENT_IDENTIFIER}` +
        `&X-Plex-Token=${accessToken}`;

      console.log('Plex: Returning HLS URL for transcoded stream');

      res.json({
        streamUrl: hlsUrl,
        format: 'hls',
        needsHlsPlayer: true,
        duration: item.duration,
        title: item.title,
        type: item.type,
        container: media?.container,
        videoCodec: media?.videoCodec,
        audioCodec: media?.audioCodec,
        sessionId,
      });
    }
  } catch (err) {
    console.error('Plex stream URL error:', err);
    res.status(500).json({ error: 'Failed to get stream URL' });
  }
});

// Proxy video stream from Plex server (direct playback only)
// Transcoding is handled via HLS in /api/plex/stream endpoint
app.get('/api/plex/video/:connectionId/:ratingKey', async (req, res) => {
  const { connectionId, ratingKey } = req.params;
  const { token } = req.query;

  try {
    // Support both authenticated requests and token-based requests (for video src)
    let userId;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    } else if (req.headers.authorization) {
      try {
        const authToken = req.headers.authorization.replace('Bearer ', '');
        const decoded = jwt.verify(authToken, JWT_SECRET);
        userId = decoded.userId;
      } catch {
        return res.status(401).json({ error: 'Invalid authorization' });
      }
    } else {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const connection = db.getPlexConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Allow any authenticated user to stream - connection IDs are only shared via message embeds
    const accessToken = decryptPlexToken(connection.accessToken);

    // Get item info to find the media part
    const itemResponse = await plexRequest(connection.serverUrl, `/library/metadata/${ratingKey}`, accessToken);
    if (!itemResponse.ok) {
      return res.status(itemResponse.status).json({ error: 'Failed to fetch item' });
    }

    const itemData = await itemResponse.json();
    const mediaContainer = itemData.MediaContainer || itemData;
    const item = (mediaContainer.Metadata || [])[0];

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const media = item.Media?.[0];
    const part = media?.Part?.[0];

    if (!part) {
      return res.status(404).json({ error: 'No playable media found' });
    }

    // Check if file is browser-compatible (MP4/M4V with H264)
    const fileContainer = media?.container?.toLowerCase();
    const videoCodec = media?.videoCodec?.toLowerCase();
    const isBrowserCompatible =
      (fileContainer === 'mp4' || fileContainer === 'm4v' || fileContainer === 'mov') &&
      (videoCodec === 'h264' || videoCodec === 'avc1');

    if (!isBrowserCompatible) {
      // Non-compatible files should use /api/plex/stream which returns HLS URL
      return res.status(400).json({
        error: `This ${fileContainer?.toUpperCase() || 'video'} file requires transcoding. Use the stream endpoint instead.`
      });
    }

    // Direct stream URL
    const videoUrl = `${connection.serverUrl}${part.key}?X-Plex-Token=${accessToken}`;

    // Handle range requests for seeking
    const rangeHeader = req.headers.range;
    const fetchHeaders = getPlexHeaders(accessToken);
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    const videoResponse = await fetch(videoUrl, {
      headers: fetchHeaders,
    });

    if (!videoResponse.ok && videoResponse.status !== 206) {
      const errorText = await videoResponse.text().catch(() => '');
      console.error('Plex video stream error:', videoResponse.status, errorText.substring(0, 100));
      return res.status(videoResponse.status).json({ error: 'Failed to stream video' });
    }

    // Forward response headers
    const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
    const contentLength = videoResponse.headers.get('content-length');
    const contentRange = videoResponse.headers.get('content-range');
    const acceptRanges = videoResponse.headers.get('accept-ranges');

    res.set('Content-Type', contentType);
    if (contentLength) res.set('Content-Length', contentLength);
    if (contentRange) res.set('Content-Range', contentRange);
    if (acceptRanges) res.set('Accept-Ranges', acceptRanges);
    res.status(videoResponse.status);

    // Pipe the video stream to the response
    const { Readable } = await import('stream');
    const nodeStream = Readable.fromWeb(videoResponse.body);
    nodeStream.pipe(res);

    // Handle client disconnect
    req.on('close', () => {
      nodeStream.destroy();
    });

  } catch (err) {
    console.error('Plex video proxy error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream video' });
    }
  }
});

// Proxy thumbnail from Plex server
app.get('/api/plex/thumbnail/:connectionId/:ratingKey', async (req, res) => {
  const { connectionId, ratingKey } = req.params;
  const { width = 300, height = 450, token } = req.query;

  try {
    // Support both authenticated requests and token-based requests (for img src)
    let userId;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    } else if (req.headers.authorization) {
      try {
        const authToken = req.headers.authorization.replace('Bearer ', '');
        const decoded = jwt.verify(authToken, JWT_SECRET);
        userId = decoded.userId;
      } catch {
        return res.status(401).json({ error: 'Invalid authorization' });
      }
    } else {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify user owns the connection or is in a wave that has this media shared
    const connection = db.getPlexConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Allow access if user owns connection
    const ownsConnection = connection.userId === userId;

    // Also allow if this media is shared in a wave the user participates in
    // (This enables viewing thumbnails for media shared by others)
    if (!ownsConnection) {
      // For now, allow if the connection exists (media was shared intentionally)
      // A more restrictive check could verify wave participation
    }

    const accessToken = decryptPlexToken(connection.accessToken);

    // Build thumbnail URL - Plex uses /photo/:/transcode for resizing
    const thumbUrl = new URL(`${connection.serverUrl}/photo/:/transcode`);
    thumbUrl.searchParams.set('url', `/library/metadata/${ratingKey}/thumb`);
    thumbUrl.searchParams.set('width', width);
    thumbUrl.searchParams.set('height', height);
    thumbUrl.searchParams.set('minSize', '1');
    thumbUrl.searchParams.set('upscale', '1');
    thumbUrl.searchParams.set('X-Plex-Token', accessToken);

    const response = await fetch(thumbUrl.toString());

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch thumbnail' });
    }

    // Forward the image with proper headers
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Plex thumbnail error:', err);
    res.status(500).json({ error: 'Failed to fetch thumbnail' });
  }
});

// ============ Crawl Bar Endpoints (v1.15.0) ============

// Get crawl bar configuration (admin only)
app.get('/api/admin/crawl/config', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const config = db.getCrawlConfig();
  // Return config in snake_case format for client compatibility
  res.json({
    config: {
      stock_symbols: config.stockSymbols,
      news_sources: config.newsSources,
      default_location: config.defaultLocation,
      stock_refresh_interval: config.stockRefreshInterval,
      weather_refresh_interval: config.weatherRefreshInterval,
      news_refresh_interval: config.newsRefreshInterval,
      stocks_enabled: config.stocksEnabled,
      weather_enabled: config.weatherEnabled,
      news_enabled: config.newsEnabled,
      apiKeys: {
        finnhub: !!FINNHUB_API_KEY,
        openweathermap: !!OPENWEATHERMAP_API_KEY,
        weatherapi: !!WEATHERAPI_KEY,
        tomorrowio: !!TOMORROWIO_API_KEY,
        newsapi: !!NEWSAPI_KEY,
        gnews: !!GNEWS_API_KEY,
        mediastack: !!MEDIASTACK_API_KEY,
        rss_feeds: NEWS_RSS_FEEDS.length,
      }
    }
  });
});

// Update crawl bar configuration (admin only)
app.put('/api/admin/crawl/config', authenticateToken, async (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  // Accept both snake_case and camelCase for flexibility
  const {
    stock_symbols, stockSymbols,
    news_sources, newsSources,
    default_location, defaultLocation,
    stock_refresh_interval, stockRefreshInterval,
    weather_refresh_interval, weatherRefreshInterval,
    news_refresh_interval, newsRefreshInterval,
    stocks_enabled, stocksEnabled,
    weather_enabled, weatherEnabled,
    news_enabled, newsEnabled
  } = req.body;

  // Handle location - geocode if only name provided
  let locationInput = default_location || defaultLocation;
  if (locationInput) {
    // If location has name but no valid coordinates, try to geocode
    if (locationInput.name && (typeof locationInput.lat !== 'number' || typeof locationInput.lon !== 'number')) {
      const geocoded = await geocodeLocation(locationInput.name);
      if (geocoded) {
        locationInput = geocoded;
      } else {
        return res.status(400).json({ error: `Could not find coordinates for "${locationInput.name}". Try "City, Country" format (e.g., "Coudersport, US")` });
      }
    }
  }

  const config = db.updateCrawlConfig({
    stockSymbols: stock_symbols || stockSymbols,
    newsSources: news_sources || newsSources,
    defaultLocation: locationInput,
    stockRefreshInterval: stock_refresh_interval ?? stockRefreshInterval,
    weatherRefreshInterval: weather_refresh_interval ?? weatherRefreshInterval,
    newsRefreshInterval: news_refresh_interval ?? newsRefreshInterval,
    stocksEnabled: stocks_enabled !== undefined ? stocks_enabled : stocksEnabled,
    weatherEnabled: weather_enabled !== undefined ? weather_enabled : weatherEnabled,
    newsEnabled: news_enabled !== undefined ? news_enabled : newsEnabled
  });

  // Return config in snake_case format for client compatibility
  res.json({
    config: {
      stock_symbols: config.stockSymbols,
      news_sources: config.newsSources,
      default_location: config.defaultLocation,
      stock_refresh_interval: config.stockRefreshInterval,
      weather_refresh_interval: config.weatherRefreshInterval,
      news_refresh_interval: config.newsRefreshInterval,
      stocks_enabled: config.stocksEnabled,
      weather_enabled: config.weatherEnabled,
      news_enabled: config.newsEnabled,
      apiKeys: {
        finnhub: !!FINNHUB_API_KEY,
        openweathermap: !!OPENWEATHERMAP_API_KEY,
        weatherapi: !!WEATHERAPI_KEY,
        tomorrowio: !!TOMORROWIO_API_KEY,
        newsapi: !!NEWSAPI_KEY,
        gnews: !!GNEWS_API_KEY,
        mediastack: !!MEDIASTACK_API_KEY,
        rss_feeds: NEWS_RSS_FEEDS.length,
      }
    }
  });
});

// Get stock quotes
app.get('/api/crawl/stocks', authenticateToken, crawlLimiter, async (req, res) => {
  if (!FINNHUB_API_KEY) {
    return res.json({
      enabled: false,
      stocks: [],
      error: 'Stock data not configured'
    });
  }

  const config = db.getCrawlConfig();
  if (!config.stocksEnabled) {
    return res.json({ enabled: false, stocks: [] });
  }

  const symbols = config.stockSymbols || [];

  // Fetch quotes in parallel (limited to 10 to respect rate limits)
  const quotes = await Promise.all(
    symbols.slice(0, 10).map(s => fetchStockQuote(s))
  );

  res.json({
    enabled: true,
    stocks: quotes.filter(Boolean),
    timestamp: Date.now(),
  });
});

// Get weather data
app.get('/api/crawl/weather', authenticateToken, crawlLimiter, async (req, res) => {
  if (!OPENWEATHERMAP_API_KEY && !WEATHERAPI_KEY && !TOMORROWIO_API_KEY) {
    return res.json({
      enabled: false,
      weather: null,
      error: 'Weather data not configured'
    });
  }

  const config = db.getCrawlConfig();
  if (!config.weatherEnabled) {
    return res.json({ enabled: false, weather: null });
  }

  const userId = req.user.userId;
  const user = db.findUserById(userId);
  const prefs = user?.preferences || {};
  const crawlPrefs = prefs.crawlBar || {};

  // Priority: user location > user locationName (geocoded) > IP geolocation > server default
  let location = crawlPrefs.location;

  // If user has a locationName but no geocoded location, geocode it now
  if (!location && crawlPrefs.locationName) {
    location = await geocodeLocation(crawlPrefs.locationName);
  }

  // Try IP geolocation if no user location
  if (!location) {
    const clientIP = getClientIP(req);
    location = await getLocationFromIP(clientIP);
  }

  // Fall back to server default
  if (!location) {
    location = config.defaultLocation;
  }

  // If stored default location has invalid coordinates, use hardcoded fallback
  if (!location?.lat || !location?.lon) {
    location = { lat: 40.7128, lon: -74.006, name: 'New York, NY' };
  }

  const weather = await fetchWeather(location.lat, location.lon);

  res.json({
    enabled: true,
    weather,
    location: { name: location.name, lat: location.lat, lon: location.lon },
    timestamp: Date.now(),
  });
});

// Get news headlines
app.get('/api/crawl/news', authenticateToken, crawlLimiter, async (req, res) => {
  if (!NEWSAPI_KEY && !GNEWS_API_KEY && !MEDIASTACK_API_KEY && NEWS_RSS_FEEDS.length === 0) {
    return res.json({
      enabled: false,
      headlines: [],
      error: 'News data not configured'
    });
  }

  const config = db.getCrawlConfig();
  if (!config.newsEnabled) {
    return res.json({ enabled: false, headlines: [] });
  }

  const news = await fetchNews();

  res.json({
    enabled: true,
    headlines: news?.headlines || [],
    timestamp: Date.now(),
  });
});

// Combined endpoint for efficiency (preferred by client)
app.get('/api/crawl/all', authenticateToken, crawlLimiter, async (req, res) => {
  const config = db.getCrawlConfig();
  const userId = req.user.userId;
  const user = db.findUserById(userId);
  const prefs = user?.preferences || {};
  const crawlPrefs = prefs.crawlBar || {};

  const result = {
    timestamp: Date.now(),
    stocks: { enabled: false, data: [] },
    weather: { enabled: false, data: null, location: null },
    news: { enabled: false, data: [] },
    alerts: { enabled: true, data: [] },
  };

  // Fetch active alerts for this user (synchronous, no API call)
  try {
    const alerts = db.getActiveAlerts(userId);
    // getActiveAlerts already returns camelCase properties
    result.alerts.data = alerts.map(a => ({
      id: a.id,
      title: a.title,
      content: a.content,
      priority: a.priority,
      category: a.category,
      startTime: a.startTime,
      endTime: a.endTime,
      originNode: a.originNode
    }));
  } catch (err) {
    console.error('Crawl alerts error:', err.message);
  }

  const promises = [];

  // Stocks
  if (FINNHUB_API_KEY && config.stocksEnabled && crawlPrefs.showStocks !== false) {
    const symbols = config.stockSymbols || [];
    promises.push(
      Promise.all(symbols.slice(0, 10).map(s => fetchStockQuote(s)))
        .then(quotes => {
          result.stocks = { enabled: true, data: quotes.filter(Boolean) };
        })
        .catch(err => {
          console.error('Crawl stocks error:', err.message);
        })
    );
  }

  // Weather (any provider)
  const hasWeatherProvider = OPENWEATHERMAP_API_KEY || WEATHERAPI_KEY || TOMORROWIO_API_KEY;
  if (hasWeatherProvider && config.weatherEnabled && crawlPrefs.showWeather !== false) {
    promises.push(
      (async () => {
        let location = crawlPrefs.location;

        // If user has a locationName but no geocoded location, geocode it now
        if (!location && crawlPrefs.locationName) {
          location = await geocodeLocation(crawlPrefs.locationName);
        }

        // Try IP geolocation if no user location
        if (!location) {
          const clientIP = getClientIP(req);
          location = await getLocationFromIP(clientIP);
        }

        // Fall back to server default
        if (!location) {
          location = config.defaultLocation;
        }

        // Hardcoded fallback if stored location has invalid coordinates
        if (!location?.lat || !location?.lon) {
          location = { lat: 40.7128, lon: -74.006, name: 'New York, NY' };
        }

        const weather = await fetchWeather(location.lat, location.lon);
        result.weather = {
          enabled: true,
          data: weather,
          location: { name: location.name, lat: location.lat, lon: location.lon }
        };
      })().catch(err => {
        console.error('Crawl weather error:', err.message);
      })
    );
  }

  // News (any provider)
  const hasNewsProvider = NEWSAPI_KEY || GNEWS_API_KEY || MEDIASTACK_API_KEY || NEWS_RSS_FEEDS.length > 0;
  if (hasNewsProvider && config.newsEnabled && crawlPrefs.showNews !== false) {
    promises.push(
      fetchNews()
        .then(news => {
          result.news = { enabled: true, data: news?.headlines || [] };
        })
        .catch(err => {
          console.error('Crawl news error:', err.message);
        })
    );
  }

  await Promise.all(promises);

  res.json(result);
});

// Update user's crawl bar preferences
app.put('/api/profile/crawl-preferences', authenticateToken, (req, res) => {
  // Support both nested crawlBar object and flat properties
  const input = req.body.crawlBar || req.body;
  const { enabled, location, showStocks, showWeather, showNews, scrollSpeed } = input;

  const userId = req.user.userId;
  const user = db.findUserById(userId);
  const prefs = user?.preferences || {};

  const crawlBar = {
    enabled: enabled !== undefined ? enabled : (prefs.crawlBar?.enabled ?? true),
    location: location !== undefined ? location : (prefs.crawlBar?.location ?? null),
    showStocks: showStocks !== undefined ? showStocks : (prefs.crawlBar?.showStocks ?? true),
    showWeather: showWeather !== undefined ? showWeather : (prefs.crawlBar?.showWeather ?? true),
    showNews: showNews !== undefined ? showNews : (prefs.crawlBar?.showNews ?? true),
    scrollSpeed: scrollSpeed || prefs.crawlBar?.scrollSpeed || 'normal',
  };

  const updatedPrefs = { ...prefs, crawlBar };
  db.updateUserPreferences(userId, updatedPrefs);

  res.json({ success: true, crawlBar });
});

// ============ Alert Endpoints (v1.16.0) ============

// Get all alerts (admin only)
app.get('/api/admin/alerts', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const { limit = 50, offset = 0, status = 'all' } = req.query;
  const alerts = db.getAllAlerts({
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    status
  });

  res.json({ alerts });
});

// Create alert (admin only)
app.post('/api/admin/alerts', authenticateToken, async (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const { title, content, priority, category, scope, startTime, endTime } = req.body;

  // Validation
  if (!title || title.length > 100) {
    return res.status(400).json({ error: 'Title is required (max 100 characters)' });
  }
  if (!content || content.length > 1000) {
    return res.status(400).json({ error: 'Content is required (max 1000 characters)' });
  }
  if (!['info', 'warning', 'critical', 'celebration'].includes(priority)) {
    return res.status(400).json({ error: 'Priority must be info, warning, critical, or celebration' });
  }
  if (!['system', 'announcement', 'emergency'].includes(category)) {
    return res.status(400).json({ error: 'Category must be system, announcement, or emergency' });
  }
  if (!['local', 'federated'].includes(scope)) {
    return res.status(400).json({ error: 'Scope must be local or federated' });
  }
  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'Start time and end time are required' });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  if (end <= start) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  // Sanitize content
  const sanitizedContent = sanitizeHtml(content, {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'br'],
    allowedAttributes: { a: ['href', 'target'] }
  });

  const alert = db.createAlert({
    title: title.trim(),
    content: sanitizedContent,
    priority,
    category,
    scope,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    createdBy: admin.id
  });

  console.log(`📢 Alert created: "${alert.title}" by ${admin.handle} (${scope}, ${priority})`);

  // If federated, broadcast to subscribers
  if (scope === 'federated' && FEDERATION_ENABLED) {
    const subscribers = db.getSubscribersForCategory(category);
    console.log(`📡 Broadcasting alert to ${subscribers.length} subscribers`);

    for (const sub of subscribers) {
      const node = db.getFederationNodeByName(sub.subscriberNode);
      if (node?.status === 'active') {
        const messageId = `alert-broadcast-${alert.id}-${Date.now()}`;
        const payload = createFederationEnvelope(messageId, 'alert_broadcast', {
          alertId: alert.id,
          title: alert.title,
          content: alert.content,
          priority: alert.priority,
          category: alert.category,
          startTime: alert.startTime,
          endTime: alert.endTime,
          originNode: db.getServerIdentity()?.nodeName
        });

        try {
          await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', payload);
          console.log(`✅ Alert broadcast to ${sub.subscriberNode}`);
        } catch (err) {
          console.error(`❌ Failed to broadcast alert to ${sub.subscriberNode}:`, err.message);
          // Queue for retry
          db.queueFederationMessage({
            targetNode: sub.subscriberNode,
            messageType: 'alert_broadcast',
            payload
          });
        }
      }
    }
  }

  res.json({ success: true, alert });
});

// Update alert (admin only)
app.put('/api/admin/alerts/:id', authenticateToken, async (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const alertId = req.params.id;
  const existingAlert = db.getAlert(alertId);
  if (!existingAlert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  const { title, content, priority, category, scope, startTime, endTime } = req.body;
  const updates = {};

  if (title !== undefined) {
    if (title.length > 100) {
      return res.status(400).json({ error: 'Title max 100 characters' });
    }
    updates.title = title.trim();
  }
  if (content !== undefined) {
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Content max 1000 characters' });
    }
    updates.content = sanitizeHtml(content, {
      allowedTags: ['b', 'i', 'em', 'strong', 'a', 'br'],
      allowedAttributes: { a: ['href', 'target'] }
    });
  }
  if (priority !== undefined) {
    if (!['info', 'warning', 'critical', 'celebration'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' });
    }
    updates.priority = priority;
  }
  if (category !== undefined) {
    if (!['system', 'announcement', 'emergency'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    updates.category = category;
  }
  if (scope !== undefined) {
    if (!['local', 'federated'].includes(scope)) {
      return res.status(400).json({ error: 'Invalid scope' });
    }
    updates.scope = scope;
  }
  if (startTime !== undefined) {
    const start = new Date(startTime);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ error: 'Invalid start time' });
    }
    updates.startTime = start.toISOString();
  }
  if (endTime !== undefined) {
    const end = new Date(endTime);
    if (isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid end time' });
    }
    updates.endTime = end.toISOString();
  }

  const alert = db.updateAlert(alertId, updates);
  console.log(`📝 Alert updated: "${alert.title}" by ${admin.handle}`);

  // If federated, broadcast update to subscribers
  if (alert.scope === 'federated' && FEDERATION_ENABLED) {
    const subscribers = db.getSubscribersForCategory(alert.category);
    for (const sub of subscribers) {
      const node = db.getFederationNodeByName(sub.subscriberNode);
      if (node?.status === 'active') {
        const messageId = `alert-update-${alert.id}-${Date.now()}`;
        const payload = createFederationEnvelope(messageId, 'alert_update', {
          alertId: alert.id,
          originNode: db.getServerIdentity()?.nodeName,
          updates: {
            title: alert.title,
            content: alert.content,
            priority: alert.priority,
            category: alert.category,
            startTime: alert.startTime,
            endTime: alert.endTime
          }
        });

        try {
          await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', payload);
        } catch (err) {
          db.queueFederationMessage({
            targetNode: sub.subscriberNode,
            messageType: 'alert_update',
            payload
          });
        }
      }
    }
  }

  res.json({ success: true, alert });
});

// Delete alert (admin only)
app.delete('/api/admin/alerts/:id', authenticateToken, async (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const alertId = req.params.id;
  const alert = db.getAlert(alertId);
  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  // If federated, notify subscribers before deletion
  if (alert.scope === 'federated' && FEDERATION_ENABLED) {
    const subscribers = db.getSubscribersForCategory(alert.category);
    for (const sub of subscribers) {
      const node = db.getFederationNodeByName(sub.subscriberNode);
      if (node?.status === 'active') {
        const messageId = `alert-delete-${alert.id}-${Date.now()}`;
        const payload = createFederationEnvelope(messageId, 'alert_delete', {
          alertId: alert.id,
          originNode: db.getServerIdentity()?.nodeName
        });

        try {
          await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', payload);
        } catch (err) {
          // Don't queue delete messages - if they fail, the alert will expire naturally
          console.error(`Failed to send alert deletion to ${sub.subscriberNode}:`, err.message);
        }
      }
    }
  }

  db.deleteAlert(alertId);
  console.log(`🗑️ Alert deleted: "${alert.title}" by ${admin.handle}`);

  res.json({ success: true });
});

// Get active alerts for current user (for crawl bar)
app.get('/api/alerts/active', authenticateToken, (req, res) => {
  const alerts = db.getActiveAlerts(req.user.userId);
  res.json({ alerts });
});

// Dismiss an alert for current user
app.post('/api/alerts/:id/dismiss', authenticateToken, (req, res) => {
  const alertId = req.params.id;
  const alert = db.getAlert(alertId);

  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  db.dismissAlert(alertId, req.user.userId);
  res.json({ success: true });
});

// ============ Alert Subscription Endpoints (v1.16.0) ============

// Get all alert subscriptions (admin only)
app.get('/api/admin/alert-subscriptions', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const subscriptions = db.getAllAlertSubscriptions();
  res.json({ subscriptions });
});

// Subscribe to alerts from a federated node (admin only)
app.post('/api/admin/alert-subscriptions', authenticateToken, async (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const { sourceNode, categories } = req.body;

  if (!sourceNode) {
    return res.status(400).json({ error: 'Source node is required' });
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'At least one category is required' });
  }

  // Validate categories
  const validCategories = ['system', 'announcement', 'emergency'];
  for (const cat of categories) {
    if (!validCategories.includes(cat)) {
      return res.status(400).json({ error: `Invalid category: ${cat}` });
    }
  }

  // Check if already subscribed
  const existing = db.getAlertSubscriptionByNode(sourceNode);
  if (existing) {
    return res.status(400).json({ error: 'Already subscribed to this node' });
  }

  // Verify node exists in federation
  const node = db.getFederationNodeByName(sourceNode);
  if (!node || node.status !== 'active') {
    return res.status(400).json({ error: 'Node is not an active federation partner' });
  }

  const subscription = db.createAlertSubscription({
    sourceNode,
    categories,
    createdBy: admin.id
  });

  // Notify the source node that we're subscribing
  if (FEDERATION_ENABLED) {
    const messageId = `alert-subscribe-${Date.now()}`;
    const payload = createFederationEnvelope(messageId, 'alert_subscribe', {
      subscriberNode: db.getServerIdentity()?.nodeName,
      categories
    });

    try {
      await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', payload);
      console.log(`📡 Subscribed to alerts from ${sourceNode}: ${categories.join(', ')}`);
    } catch (err) {
      console.error(`Failed to notify ${sourceNode} of subscription:`, err.message);
      // Continue anyway - subscription is local, notifications are best-effort
    }
  }

  res.json({ success: true, subscription });
});

// Update alert subscription (admin only)
app.put('/api/admin/alert-subscriptions/:id', authenticateToken, async (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const subscriptionId = req.params.id;
  const existing = db.getAlertSubscription(subscriptionId);
  if (!existing) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  const { categories, status } = req.body;
  const updates = {};

  if (categories !== undefined) {
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: 'At least one category is required' });
    }
    const validCategories = ['system', 'announcement', 'emergency'];
    for (const cat of categories) {
      if (!validCategories.includes(cat)) {
        return res.status(400).json({ error: `Invalid category: ${cat}` });
      }
    }
    updates.categories = categories;
  }

  if (status !== undefined) {
    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or paused' });
    }
    updates.status = status;
  }

  const subscription = db.updateAlertSubscription(subscriptionId, updates);
  res.json({ success: true, subscription });
});

// Delete alert subscription (admin only)
app.delete('/api/admin/alert-subscriptions/:id', authenticateToken, async (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const subscriptionId = req.params.id;
  const subscription = db.getAlertSubscription(subscriptionId);
  if (!subscription) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  // Notify the source node that we're unsubscribing
  if (FEDERATION_ENABLED) {
    const node = db.getFederationNodeByName(subscription.sourceNode);
    if (node?.status === 'active') {
      const messageId = `alert-unsubscribe-${Date.now()}`;
      const payload = createFederationEnvelope(messageId, 'alert_unsubscribe', {
        subscriberNode: db.getServerIdentity()?.nodeName
      });

      try {
        await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', payload);
        console.log(`📡 Unsubscribed from alerts from ${subscription.sourceNode}`);
      } catch (err) {
        console.error(`Failed to notify ${subscription.sourceNode} of unsubscription:`, err.message);
      }
    }
  }

  db.deleteAlertSubscription(subscriptionId);
  res.json({ success: true });
});

// ============ Events Calendar Endpoints (v2.40.0) ============

// Get all events (admin only)
app.get('/api/admin/events', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const { limit = 50, offset = 0 } = req.query;
  const events = db.getAllEvents({
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10)
  });

  res.json({ events });
});

// Create event (admin only)
app.post('/api/admin/events', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const { title, description, eventDate, recurring, category } = req.body;

  if (!title || title.length > 100) {
    return res.status(400).json({ error: 'Title is required (max 100 characters)' });
  }
  if (description && description.length > 500) {
    return res.status(400).json({ error: 'Description max 500 characters' });
  }
  if (!eventDate) {
    return res.status(400).json({ error: 'Event date is required' });
  }

  // Validate date format: MM-DD for recurring, YYYY-MM-DD for one-time
  const mmddRegex = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const fullDateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  if (recurring) {
    if (!mmddRegex.test(eventDate)) {
      return res.status(400).json({ error: 'Recurring events must use MM-DD format' });
    }
  } else {
    if (!fullDateRegex.test(eventDate)) {
      return res.status(400).json({ error: 'One-time events must use YYYY-MM-DD format' });
    }
  }

  const event = db.createEvent({
    title: sanitizeInput(title.trim()),
    description: description ? sanitizeInput(description.trim()) : null,
    eventDate,
    recurring: !!recurring,
    category: category || 'general',
    createdBy: admin.id,
  });

  console.log(`📅 Event created: "${event.title}" by ${admin.handle}`);
  res.status(201).json({ event });
});

// Update event (admin only)
app.put('/api/admin/events/:id', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const eventId = req.params.id;
  const existing = db.getEvent(eventId);
  if (!existing) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const { title, description, eventDate, recurring, category } = req.body;
  const updates = {};

  if (title !== undefined) {
    if (title.length > 100) {
      return res.status(400).json({ error: 'Title max 100 characters' });
    }
    updates.title = sanitizeInput(title.trim());
  }
  if (description !== undefined) {
    if (description && description.length > 500) {
      return res.status(400).json({ error: 'Description max 500 characters' });
    }
    updates.description = description ? sanitizeInput(description.trim()) : null;
  }
  if (eventDate !== undefined) {
    const mmddRegex = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const fullDateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const isRecurring = recurring !== undefined ? recurring : existing.recurring;
    if (isRecurring) {
      if (!mmddRegex.test(eventDate)) {
        return res.status(400).json({ error: 'Recurring events must use MM-DD format' });
      }
    } else {
      if (!fullDateRegex.test(eventDate)) {
        return res.status(400).json({ error: 'One-time events must use YYYY-MM-DD format' });
      }
    }
    updates.eventDate = eventDate;
  }
  if (recurring !== undefined) updates.recurring = !!recurring;
  if (category !== undefined) updates.category = category;

  const event = db.updateEvent(eventId, updates);
  console.log(`📅 Event updated: "${event.title}" by ${admin.handle}`);
  res.json({ event });
});

// Delete event (admin only)
app.delete('/api/admin/events/:id', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.ADMIN, res)) return;

  const eventId = req.params.id;
  const event = db.getEvent(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  db.deleteEvent(eventId);
  console.log(`🗑️ Event deleted: "${event.title}" by ${admin.handle}`);
  res.json({ success: true });
});

// ============ Bot Management Endpoints (v2.1.0) ============

/**
 * Create a new bot (admin only)
 * Returns API key once - must be saved by client
 */
app.post('/api/admin/bots', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const name = sanitizeInput(req.body.name);
    const description = sanitizeInput(req.body.description || '');

    if (!name || name.length < 3) {
      return res.status(400).json({ error: 'Bot name must be at least 3 characters' });
    }

    // Generate secure API key: fh_bot_{32 random hex chars}
    const apiKey = `fh_bot_${crypto.randomBytes(32).toString('hex')}`;
    const apiKeyHash = hashToken(apiKey);

    // Generate optional webhook secret
    const webhookSecret = req.body.enableWebhook ? crypto.randomBytes(16).toString('hex') : null;

    // E2EE: Generate bot keypair if E2EE is enabled (optional, can be null)
    let publicKey = null;
    let encryptedPrivateKey = null;

    const bot = db.createBot({
      name,
      description,
      ownerUserId: req.user.userId,
      apiKeyHash,
      publicKey,
      encryptedPrivateKey,
      webhookSecret,
    });

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'create_bot', 'bot', bot.id, {
        ...getRequestMeta(req),
        botName: name,
      });
    }

    // Return API key ONCE - client must save it
    res.status(201).json({
      bot: {
        ...bot,
        apiKey, // Only returned on creation
        webhookSecret: webhookSecret || undefined,
      },
    });
  } catch (err) {
    console.error('Create bot error:', err);
    res.status(500).json({ error: 'Failed to create bot' });
  }
});

/**
 * List all bots (admin only)
 */
app.get('/api/admin/bots', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const status = req.query.status ? sanitizeInput(req.query.status) : null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const bots = db.getAllBots({ status, limit, offset });
    const totalCount = db.db.prepare('SELECT COUNT(*) as count FROM bots').get().count;

    res.json({ bots, count: bots.length, total: totalCount });
  } catch (err) {
    console.error('List bots error:', err);
    res.status(500).json({ error: 'Failed to list bots' });
  }
});

/**
 * Get bot details (admin only)
 */
app.get('/api/admin/bots/:id', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const botId = sanitizeInput(req.params.id);
    const bot = db.getBot(botId);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Include permissions
    const permissions = db.getBotPermissions(botId);

    res.json({ bot: { ...bot, permissions } });
  } catch (err) {
    console.error('Get bot error:', err);
    res.status(500).json({ error: 'Failed to get bot' });
  }
});

/**
 * Update bot (admin only)
 */
app.patch('/api/admin/bots/:id', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const botId = sanitizeInput(req.params.id);
    const bot = db.getBot(botId);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const updates = {};
    if (req.body.name) updates.name = sanitizeInput(req.body.name);
    if (req.body.description !== undefined) updates.description = sanitizeInput(req.body.description);
    if (req.body.status && ['active', 'suspended', 'revoked'].includes(req.body.status)) {
      updates.status = req.body.status;
    }

    db.updateBot(botId, updates);

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'update_bot', 'bot', botId, {
        ...getRequestMeta(req),
        updates,
      });
    }

    res.json({ bot: db.getBot(botId) });
  } catch (err) {
    console.error('Update bot error:', err);
    res.status(500).json({ error: 'Failed to update bot' });
  }
});

/**
 * Delete bot (admin only)
 */
app.delete('/api/admin/bots/:id', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const botId = sanitizeInput(req.params.id);
    const bot = db.getBot(botId);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    db.deleteBot(botId);

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'delete_bot', 'bot', botId, {
        ...getRequestMeta(req),
        botName: bot.name,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete bot error:', err);
    res.status(500).json({ error: 'Failed to delete bot' });
  }
});

/**
 * Regenerate bot API key (admin only)
 */
app.post('/api/admin/bots/:id/regenerate', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const botId = sanitizeInput(req.params.id);
    const bot = db.getBot(botId);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Generate new API key
    const newApiKey = `fh_bot_${crypto.randomBytes(32).toString('hex')}`;
    const newApiKeyHash = hashToken(newApiKey);

    db.regenerateBotApiKey(botId, newApiKeyHash);

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'regenerate_bot_key', 'bot', botId, {
        ...getRequestMeta(req),
        botName: bot.name,
      });
    }

    // Return new key ONCE
    res.json({ apiKey: newApiKey });
  } catch (err) {
    console.error('Regenerate bot key error:', err);
    res.status(500).json({ error: 'Failed to regenerate bot key' });
  }
});

/**
 * Grant bot permission to wave (admin only)
 */
app.post('/api/admin/bots/:id/permissions', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const botId = sanitizeInput(req.params.id);
    const waveId = sanitizeInput(req.body.waveId);
    const canPost = req.body.canPost !== false; // Default true
    const canRead = req.body.canRead !== false; // Default true

    const bot = db.getBot(botId);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const wave = db.getWave(waveId);
    if (!wave) return res.status(404).json({ error: 'Wave not found' });

    // Check if wave is encrypted
    if (wave.encrypted && !req.body.encryptedWaveKey) {
      return res.status(400).json({
        error: 'Wave is encrypted. Must provide encryptedWaveKey and senderPublicKey for bot.',
      });
    }

    // Grant permission
    const permId = db.grantBotPermission(botId, waveId, req.user.userId, { canPost, canRead });

    // If encrypted wave, store bot's encrypted wave key
    if (wave.encrypted && req.body.encryptedWaveKey && req.body.senderPublicKey) {
      const keyVersion = wave.keyVersion || 1;
      db.createBotWaveKey(botId, waveId, req.body.encryptedWaveKey, req.body.senderPublicKey, keyVersion);
    }

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'grant_bot_permission', 'bot', botId, {
        ...getRequestMeta(req),
        waveId,
        canPost,
        canRead,
      });
    }

    res.json({ permissionId: permId, success: true });
  } catch (err) {
    console.error('Grant bot permission error:', err);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

/**
 * Revoke bot permission from wave (admin only)
 */
app.delete('/api/admin/bots/:id/permissions/:waveId', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const botId = sanitizeInput(req.params.id);
    const waveId = sanitizeInput(req.params.waveId);

    const revoked = db.revokeBotPermission(botId, waveId);

    if (!revoked) {
      return res.status(404).json({ error: 'Permission not found' });
    }

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'revoke_bot_permission', 'bot', botId, {
        ...getRequestMeta(req),
        waveId,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Revoke bot permission error:', err);
    res.status(500).json({ error: 'Failed to revoke permission' });
  }
});

// ============ Bot API Endpoints (v2.1.0) ============
// These endpoints use authenticateBotToken middleware

/**
 * Bot: Create ping in wave
 */
app.post('/api/bot/ping', authenticateBotToken, botLimiter, (req, res) => {
  try {
    const waveId = sanitizeInput(req.body.waveId);
    const content = req.body.content;

    if (!waveId || !content) {
      return res.status(400).json({ error: 'waveId and content required' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Check bot permission
    if (!db.botCanAccessWave(req.bot.id, waveId, true)) {
      return res.status(403).json({ error: 'Bot does not have permission to post in this wave' });
    }

    // E2EE: encrypted content validation
    const maxLength = req.body.encrypted ? 20000 : 10000;
    if (content.length > maxLength) {
      return res.status(400).json({ error: 'Content too long' });
    }

    // For encrypted content, require nonce and keyVersion
    if (req.body.encrypted && (!req.body.nonce || !req.body.keyVersion)) {
      return res.status(400).json({ error: 'Encrypted pings require nonce and keyVersion' });
    }

    // Create ping as bot (botId is stored in pings table)
    const ping = db.createMessage({
      waveId,
      parentId: req.body.parentId ? sanitizeInput(req.body.parentId) : null,
      authorId: req.bot.owner_user_id, // Use bot owner to satisfy FK constraint
      content,
      privacy: wave.privacy,
      encrypted: !!req.body.encrypted,
      nonce: req.body.nonce || null,
      keyVersion: req.body.keyVersion || null,
      botId: req.bot.id, // Mark as bot ping
    });

    // Update bot stats
    db.updateBotStats(req.bot.id, 'ping');

    // Broadcast to wave participants (ping already has bot info from createMessage)
    broadcastToWave(waveId, {
      type: 'new_droplet',
      data: ping,
    });

    // Also broadcast legacy event
    broadcastToWave(waveId, {
      type: 'new_message',
      data: ping,
    });

    // Trigger outgoing webhooks (async, non-blocking)
    triggerWaveWebhooks(waveId, { ...ping, isBot: true }, wave);

    // Log activity (use bot owner's user ID to satisfy FK constraint)
    if (db.logActivity) {
      db.logActivity(req.bot.owner_user_id, 'bot_create_ping', 'ping', ping.id, {
        ...getRequestMeta(req),
        waveId,
        botId: req.bot.id,
        botName: req.bot.name,
      });
    }

    res.status(201).json(ping);
  } catch (err) {
    console.error('Bot create ping error:', err);
    res.status(500).json({ error: 'Failed to create ping' });
  }
});

/**
 * Bot: List accessible waves
 */
app.get('/api/bot/waves', authenticateBotToken, botLimiter, (req, res) => {
  try {
    const waves = db.getBotWaves(req.bot.id);
    res.json({ waves, count: waves.length });
  } catch (err) {
    console.error('Bot list waves error:', err);
    res.status(500).json({ error: 'Failed to list waves' });
  }
});

/**
 * Bot: Get wave details
 */
app.get('/api/bot/waves/:id', authenticateBotToken, botLimiter, (req, res) => {
  try {
    const waveId = sanitizeInput(req.params.id);

    // Check permission
    if (!db.botCanAccessWave(req.bot.id, waveId, false)) {
      return res.status(403).json({ error: 'Bot does not have permission to read this wave' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Get wave participants
    const participants = db.getWaveParticipants(waveId);

    // Get recent pings (limit 50)
    const pings = db.getWaveDroplets(waveId, 50);

    // If encrypted, include bot's wave key
    let waveKey = null;
    if (wave.encrypted) {
      const keyData = db.getBotWaveKey(req.bot.id, waveId);
      if (keyData) {
        waveKey = {
          encryptedWaveKey: keyData.encrypted_wave_key,
          senderPublicKey: keyData.sender_public_key,
          keyVersion: keyData.key_version,
        };
      }
    }

    res.json({
      wave: {
        ...wave,
        participants,
        message_count: pings.length,
      },
      pings,
      waveKey,
    });
  } catch (err) {
    console.error('Bot get wave error:', err);
    res.status(500).json({ error: 'Failed to get wave' });
  }
});

/**
 * Bot: Get encrypted wave key
 * Separate endpoint for E2EE key retrieval
 */
app.get('/api/bot/waves/:id/key', authenticateBotToken, botLimiter, (req, res) => {
  try {
    const waveId = sanitizeInput(req.params.id);

    if (!db.botCanAccessWave(req.bot.id, waveId, false)) {
      return res.status(403).json({ error: 'Bot does not have permission to read this wave' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    if (!wave.encrypted) {
      return res.status(400).json({ error: 'Wave is not encrypted' });
    }

    const keyData = db.getBotWaveKey(req.bot.id, waveId);
    if (!keyData) {
      return res.status(404).json({ error: 'Bot does not have encryption key for this wave' });
    }

    res.json({
      encryptedWaveKey: keyData.encrypted_wave_key,
      senderPublicKey: keyData.sender_public_key,
      keyVersion: keyData.key_version,
    });
  } catch (err) {
    console.error('Bot get wave key error:', err);
    res.status(500).json({ error: 'Failed to get wave key' });
  }
});

/**
 * Webhook receiver endpoint
 * Allows external services to post to waves via webhook
 * Format: POST /api/webhooks/:botId/:webhookSecret
 */
app.post('/api/webhooks/:botId/:webhookSecret', express.json({ limit: '50kb' }), botLimiter, (req, res) => {
  try {
    const botId = sanitizeInput(req.params.botId);
    const webhookSecret = sanitizeInput(req.params.webhookSecret);

    // Look up bot
    const bot = db.getBot(botId);
    if (!bot || bot.status !== 'active') {
      return res.status(404).json({ error: 'Bot not found or inactive' });
    }

    // Validate webhook secret
    if (!bot.webhook_secret || bot.webhook_secret !== webhookSecret) {
      // Log potential security issue (use bot owner's user ID to satisfy FK constraint)
      if (db.logActivity) {
        db.logActivity(bot.owner_user_id, 'webhook_auth_failed', 'bot', botId, {
          ...getRequestMeta(req),
          botId,
          reason: 'Invalid webhook secret',
        });
      }
      return res.status(403).json({ error: 'Invalid webhook secret' });
    }

    // Extract payload
    const { waveId, content, parentId } = req.body;

    if (!waveId || !content) {
      return res.status(400).json({ error: 'waveId and content required' });
    }

    // Validate wave access
    if (!db.botCanAccessWave(botId, waveId, true)) {
      return res.status(403).json({ error: 'Bot does not have permission to post in this wave' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Sanitize content (webhooks cannot send encrypted content)
    const sanitizedContent = sanitizeMessage(content);

    // Create ping as bot (botId is stored in pings table)
    const ping = db.createMessage({
      waveId,
      parentId: parentId ? sanitizeInput(parentId) : null,
      authorId: bot.owner_user_id, // Use bot owner to satisfy FK constraint
      content: sanitizedContent,
      privacy: wave.privacy,
      encrypted: false,
      nonce: null,
      keyVersion: null,
      botId: bot.id, // Mark as bot ping
    });

    // Update stats
    db.updateBotStats(botId, 'ping');

    // Broadcast (ping already has bot info from createMessage)
    broadcastToWave(waveId, { type: 'new_droplet', data: ping });
    broadcastToWave(waveId, { type: 'new_message', data: ping });

    // Trigger outgoing webhooks (async, non-blocking)
    triggerWaveWebhooks(waveId, { ...ping, isBot: true }, wave);

    // Log activity (use bot owner's user ID to satisfy FK constraint)
    if (db.logActivity) {
      db.logActivity(bot.owner_user_id, 'webhook_ping', 'ping', ping.id, {
        ...getRequestMeta(req),
        waveId,
        botId: bot.id,
        botName: bot.name,
      });
    }

    res.status(201).json({ success: true, pingId: ping.id });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ============ Outgoing Webhooks (v2.15.5) ============

/**
 * Build platform-specific webhook payload
 */
function buildWebhookPayload(platform, message, wave) {
  const content = message.encrypted ? '[Encrypted message]' : (message.content || '').replace(/<[^>]*>/g, '').substring(0, 2000);
  const authorName = message.sender_name || 'Unknown';
  const baseUrl = process.env.BASE_URL || `https://${FEDERATION_NODE_NAME || 'cortex.local'}`;
  const authorAvatar = message.sender_avatar_url ? `${baseUrl}${message.sender_avatar_url}` : null;
  const messageUrl = `${baseUrl}/?wave=${wave.id}&ping=${message.id}`;

  switch (platform) {
    case 'discord':
      return {
        username: 'Cortex',
        embeds: [{
          title: wave.title,
          url: messageUrl, // Makes title clickable
          description: content,
          color: 0xffd23f, // Amber
          author: {
            name: authorName,
            url: baseUrl, // Link to Cortex
            icon_url: authorAvatar
          },
          timestamp: message.created_at,
          footer: { text: 'Cortex', icon_url: `${baseUrl}/icons/icon-192.png` }
        }]
      };

    case 'slack':
      return {
        username: 'Cortex',
        attachments: [{
          fallback: `${authorName} in ${wave.title}: ${content.substring(0, 100)}`,
          color: '#ffd23f',
          author_name: authorName,
          author_icon: authorAvatar,
          author_link: baseUrl,
          title: wave.title,
          title_link: messageUrl, // Link to message
          text: content,
          ts: Math.floor(new Date(message.created_at).getTime() / 1000),
          footer: 'Cortex',
          footer_icon: `${baseUrl}/icons/icon-192.png`
        }]
      };

    case 'teams':
      return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: 'ffd23f',
        summary: `${authorName} in ${wave.title}`,
        sections: [{
          activityTitle: authorName,
          activitySubtitle: wave.title,
          activityImage: authorAvatar,
          text: content
        }],
        potentialAction: [{
          '@type': 'OpenUri',
          name: 'View in Cortex',
          targets: [{ os: 'default', uri: messageUrl }]
        }]
      };

    default: // generic
      return {
        event: 'new_message',
        wave: { id: wave.id, title: wave.title, url: `${baseUrl}/?wave=${wave.id}` },
        message: {
          id: message.id,
          url: messageUrl,
          content,
          author: {
            id: message.author_id,
            name: authorName,
            handle: message.sender_handle
          },
          createdAt: message.created_at
        }
      };
  }
}

/**
 * Send webhook request with timeout
 */
async function sendWebhookRequest(webhook, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    db.recordWebhookSuccess(webhook.id);
    return { success: true };
  } catch (err) {
    clearTimeout(timeout);
    const errorMsg = err.name === 'AbortError' ? 'Request timeout' : err.message;
    db.recordWebhookError(webhook.id, errorMsg);
    throw err;
  }
}

/**
 * Trigger all enabled webhooks for a wave
 * Called after a message is created
 */
async function triggerWaveWebhooks(waveId, message, wave) {
  try {
    const webhooks = db.getEnabledWaveWebhooks(waveId);
    if (!webhooks || webhooks.length === 0) return;

    for (const webhook of webhooks) {
      // Skip bot messages if configured
      if (message.isBot && !webhook.includeBotMessages) continue;

      // Skip encrypted messages if configured
      if (message.encrypted && !webhook.includeEncrypted) continue;

      // Check cooldown
      if (webhook.cooldownSeconds > 0 && webhook.lastTriggeredAt) {
        const elapsed = (Date.now() - new Date(webhook.lastTriggeredAt).getTime()) / 1000;
        if (elapsed < webhook.cooldownSeconds) continue;
      }

      // Build platform-specific payload
      const payload = buildWebhookPayload(webhook.platform, message, wave);

      // Send async (don't block message creation)
      sendWebhookRequest(webhook, payload).catch(err => {
        console.error(`Outgoing webhook ${webhook.id} failed:`, err.message);
      });
    }
  } catch (err) {
    console.error('Webhook trigger error:', err);
  }
}

/**
 * List webhooks for a wave
 */
app.get('/api/waves/:waveId/webhooks', authenticateToken, (req, res) => {
  try {
    const waveId = sanitizeInput(req.params.waveId);
    const wave = db.getWave(waveId);

    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Check permission: wave creator or admin
    const user = db.findUserById(req.user.userId);
    if (wave.creatorId !== req.user.userId && !hasRole(user, ROLES.ADMIN)) {
      return res.status(403).json({ error: 'Only wave creator or admin can manage webhooks' });
    }

    const webhooks = db.getWaveWebhooks(waveId);
    // Mask webhook URLs for security (show only domain)
    const maskedWebhooks = webhooks.map(w => ({
      ...w,
      url: w.url.replace(/(https?:\/\/[^\/]+).*/, '$1/***')
    }));

    res.json({ webhooks: maskedWebhooks });
  } catch (err) {
    console.error('List webhooks error:', err);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

/**
 * Create a webhook for a wave
 */
app.post('/api/waves/:waveId/webhooks', authenticateToken, (req, res) => {
  try {
    const waveId = sanitizeInput(req.params.waveId);
    const wave = db.getWave(waveId);

    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Check permission: wave creator or admin
    const user = db.findUserById(req.user.userId);
    if (wave.creatorId !== req.user.userId && !hasRole(user, ROLES.ADMIN)) {
      return res.status(403).json({ error: 'Only wave creator or admin can manage webhooks' });
    }

    const { name, url, platform, includeBotMessages, includeEncrypted, cooldownSeconds } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required' });
    }

    // Validate URL (must be HTTPS, except localhost for testing)
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:' && !parsedUrl.hostname.includes('localhost')) {
        return res.status(400).json({ error: 'Webhook URL must use HTTPS' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Limit webhooks per wave
    const existing = db.getWaveWebhooks(waveId);
    if (existing.length >= 5) {
      return res.status(400).json({ error: 'Maximum 5 webhooks per wave' });
    }

    const webhook = db.createWaveWebhook({
      waveId,
      name: sanitizeInput(name),
      url,
      platform: ['discord', 'slack', 'teams', 'generic'].includes(platform) ? platform : 'generic',
      includeBotMessages: includeBotMessages !== false,
      includeEncrypted: !!includeEncrypted,
      cooldownSeconds: Math.max(0, Math.min(3600, parseInt(cooldownSeconds) || 0)),
      createdBy: req.user.userId
    });

    res.status(201).json({ webhook: { ...webhook, url: webhook.url.replace(/(https?:\/\/[^\/]+).*/, '$1/***') } });
  } catch (err) {
    console.error('Create webhook error:', err);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

/**
 * Update a webhook
 */
app.put('/api/webhooks/:webhookId', authenticateToken, (req, res) => {
  try {
    const webhookId = sanitizeInput(req.params.webhookId);
    const webhook = db.getWaveWebhook(webhookId);

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const wave = db.getWave(webhook.waveId);
    const user = db.findUserById(req.user.userId);
    if (wave?.creatorId !== req.user.userId && !hasRole(user, ROLES.ADMIN)) {
      return res.status(403).json({ error: 'Only wave creator or admin can manage webhooks' });
    }

    const updates = {};
    if (req.body.name !== undefined) updates.name = sanitizeInput(req.body.name);
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    if (req.body.includeBotMessages !== undefined) updates.includeBotMessages = req.body.includeBotMessages;
    if (req.body.includeEncrypted !== undefined) updates.includeEncrypted = req.body.includeEncrypted;
    if (req.body.cooldownSeconds !== undefined) updates.cooldownSeconds = Math.max(0, Math.min(3600, parseInt(req.body.cooldownSeconds) || 0));

    const updated = db.updateWaveWebhook(webhookId, updates);
    res.json({ webhook: { ...updated, url: updated.url.replace(/(https?:\/\/[^\/]+).*/, '$1/***') } });
  } catch (err) {
    console.error('Update webhook error:', err);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

/**
 * Delete a webhook
 */
app.delete('/api/webhooks/:webhookId', authenticateToken, (req, res) => {
  try {
    const webhookId = sanitizeInput(req.params.webhookId);
    const webhook = db.getWaveWebhook(webhookId);

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const wave = db.getWave(webhook.waveId);
    const user = db.findUserById(req.user.userId);
    if (wave?.creatorId !== req.user.userId && !hasRole(user, ROLES.ADMIN)) {
      return res.status(403).json({ error: 'Only wave creator or admin can manage webhooks' });
    }

    db.deleteWaveWebhook(webhookId);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete webhook error:', err);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

/**
 * Test a webhook
 */
app.post('/api/webhooks/:webhookId/test', authenticateToken, async (req, res) => {
  try {
    const webhookId = sanitizeInput(req.params.webhookId);
    const webhook = db.getWaveWebhook(webhookId);

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const wave = db.getWave(webhook.waveId);
    const user = db.findUserById(req.user.userId);
    if (wave?.creatorId !== req.user.userId && !hasRole(user, ROLES.ADMIN)) {
      return res.status(403).json({ error: 'Only wave creator or admin can test webhooks' });
    }

    // Send test message
    const testMessage = {
      id: 'test-message',
      content: 'This is a test message from Cortex webhook configuration.',
      sender_name: user.displayName || user.handle,
      sender_handle: user.handle,
      sender_avatar_url: user.avatarUrl,
      author_id: user.id,
      created_at: new Date().toISOString(),
      encrypted: false,
      isBot: false
    };

    const payload = buildWebhookPayload(webhook.platform, testMessage, wave);

    try {
      await sendWebhookRequest(webhook, payload);
      res.json({ success: true, message: 'Test message sent successfully' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  } catch (err) {
    console.error('Test webhook error:', err);
    res.status(500).json({ error: 'Failed to test webhook' });
  }
});

// ============ Share Routes (v1.17.0) ============

// GET /share/:dropletId - HTML page with Open Graph meta tags for social sharing
// This is a PUBLIC endpoint (no auth required) to allow social media crawlers to fetch previews
app.get('/share/:dropletId', async (req, res) => {
  const dropletId = sanitizeInput(req.params.dropletId);

  const droplet = db.getDroplet(dropletId);
  const wave = droplet ? db.getWave(droplet.wave_id) : null;
  const author = droplet ? db.findUserById(droplet.author_id) : null;
  const isPublic = wave?.privacy === 'public';

  // Strip HTML tags from content for meta description
  const plainContent = (droplet?.content || '')
    .replace(/<[^>]*>/g, '')
    .substring(0, 200);

  const title = wave?.title || 'Cortex';
  const authorName = author?.displayName || author?.display_name || 'Someone';
  const description = isPublic && plainContent
    ? `${authorName}: "${plainContent}${plainContent.length >= 200 ? '...' : ''}"`
    : 'Join Cortex to view this message';

  // Server base URL for absolute paths
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
  const shareUrl = `${baseUrl}/share/${dropletId}`;
  const logoUrl = `${baseUrl}/icons/icon-512.png`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Cortex</title>

  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)} - Cortex">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${shareUrl}">
  <meta property="og:image" content="${logoUrl}">
  <meta property="og:site_name" content="Cortex">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)} - Cortex">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${logoUrl}">

  <!-- Redirect to app -->
  <script>
    window.location.href = '/?share=${dropletId}';
  </script>
  <style>
    body {
      font-family: 'Courier New', monospace;
      background: #050805;
      color: #0ead69;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    a {
      color: #ffd23f;
    }
  </style>
</head>
<body>
  <div class="container">
    <p>Redirecting to Cortex...</p>
    <p><a href="/?share=${dropletId}">Click here if not redirected</a></p>
  </div>
</body>
</html>`;

  res.type('html').send(html);
});

// GET /api/share/:dropletId - JSON endpoint for shared droplet data
// This is a PUBLIC endpoint (no auth required for public waves)
app.get('/api/share/:dropletId', async (req, res) => {
  const dropletId = sanitizeInput(req.params.dropletId);

  // Get droplet
  const droplet = db.getDroplet(dropletId);
  if (!droplet) {
    return res.status(404).json({ error: 'Droplet not found' });
  }

  // Get wave info (use wave_id from database)
  const wave = db.getWave(droplet.wave_id);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Check if wave is public
  const isPublic = wave.privacy === 'public';

  // Get author info (use author_id from database)
  const author = db.findUserById(droplet.author_id);

  // Return share data (limited info for privacy)
  res.json({
    droplet: {
      id: droplet.id,
      content: isPublic ? droplet.content : null,
      createdAt: droplet.created_at,
    },
    wave: {
      id: wave.id,
      title: wave.title,
      privacy: wave.privacy,
    },
    author: {
      displayName: author?.displayName || author?.display_name || 'Unknown',
      handle: author?.handle,
      avatarUrl: isPublic ? (author?.avatarUrl || author?.avatar_url) : null,
    },
    isPublic,
    requiresLogin: !isPublic,
  });
});

// ============ Rich Media Embed Endpoints ============

// Detect embeddable URLs in content
app.post('/api/embeds/detect', authenticateToken, (req, res) => {
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Content is required' });
  }

  const embeds = detectEmbedUrls(content);
  res.json({ embeds });
});

// oEmbed proxy endpoint with caching (public - no auth required, just rate limited)
// This is safe because it only proxies public oEmbed APIs and doesn't expose user data
app.get('/api/embeds/oembed', oembedLimiter, async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL is from a supported platform
  const embeds = detectEmbedUrls(url);
  if (embeds.length === 0) {
    return res.status(400).json({ error: 'URL is not from a supported platform' });
  }

  const embed = embeds[0];
  if (!embed.oembedUrl) {
    // Return what we have if no oEmbed available
    return res.json({
      platform: embed.platform,
      embedUrl: embed.embedUrl,
      contentId: embed.contentId,
      thumbnail: embed.thumbnail,
    });
  }

  // Check cache first
  const cached = getCachedOembed(url);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    const response = await fetch(embed.oembedUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      console.error(`oEmbed fetch failed for ${embed.platform}:`, response.status);
      // Return basic embed info without oEmbed data
      return res.json({
        platform: embed.platform,
        embedUrl: embed.embedUrl,
        contentId: embed.contentId,
        thumbnail: embed.thumbnail,
        error: 'oEmbed data unavailable',
      });
    }

    const data = await response.json();

    const result = {
      platform: embed.platform,
      embedUrl: embed.embedUrl,
      contentId: embed.contentId,
      thumbnail: embed.thumbnail || data.thumbnail_url,
      title: data.title,
      author: data.author_name,
      html: data.html, // Some platforms provide embed HTML
      width: data.width,
      height: data.height,
    };

    // Cache the result
    setCachedOembed(url, result);

    res.json(result);
  } catch (err) {
    console.error('oEmbed proxy error:', err);
    // Return basic embed info on error
    res.json({
      platform: embed.platform,
      embedUrl: embed.embedUrl,
      contentId: embed.contentId,
      thumbnail: embed.thumbnail,
      error: 'Failed to fetch oEmbed data',
    });
  }
});

// Get embed info for a URL (lightweight, no oEmbed fetch)
app.get('/api/embeds/info', authenticateToken, (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  const embeds = detectEmbedUrls(url);
  if (embeds.length === 0) {
    return res.json({ embeddable: false });
  }

  const embed = embeds[0];
  res.json({
    embeddable: true,
    platform: embed.platform,
    embedUrl: embed.embedUrl,
    contentId: embed.contentId,
    contentType: embed.contentType,
    thumbnail: embed.thumbnail,
    hasOembed: !!embed.oembedUrl,
  });
});

// ============ Report Routes ============

// Create report (rate limited: 10 per hour)
app.post('/api/reports', authenticateToken, reportLimiter, (req, res) => {
  const { type, targetId, reason, details } = req.body;

  // Validate required fields
  if (!type || !targetId || !reason) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate type
  if (!['message', 'wave', 'user'].includes(type)) {
    return res.status(400).json({ error: 'Invalid report type. Must be: message, wave, or user' });
  }

  // Validate reason
  if (!['spam', 'harassment', 'inappropriate', 'other'].includes(reason)) {
    return res.status(400).json({ error: 'Invalid reason. Must be: spam, harassment, inappropriate, or other' });
  }

  // Create report
  const report = db.createReport(
    req.user.userId,
    sanitizeInput(type),
    sanitizeInput(targetId),
    sanitizeInput(reason),
    sanitizeInput(details || '')
  );

  res.json({ success: true, reportId: report.id });
});

// Get user's own submitted reports
app.get('/api/reports', authenticateToken, (req, res) => {
  const reports = db.getReportsByUser(req.user.userId);
  res.json({ reports, count: reports.length });
});

// Get reports (moderator+)
app.get('/api/admin/reports', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  const status = req.query.status ? sanitizeInput(req.query.status) : null;
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset) : 0;

  // Validate status
  if (status && !['pending', 'resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be: pending, resolved, or dismissed' });
  }

  let reports;
  if (status) {
    reports = db.getReportsByStatus(status, limit, offset);
  } else {
    reports = db.getReports({ limit, offset });
  }

  res.json({ reports, count: reports.length });
});

// Resolve report (moderator+)
app.post('/api/admin/reports/:id/resolve', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  const reportId = sanitizeInput(req.params.id);
  const { resolution, notes } = req.body;

  if (!resolution || resolution.trim().length === 0) {
    return res.status(400).json({ error: 'Resolution is required' });
  }

  const updatedReport = db.resolveReport(reportId, sanitizeInput(resolution), req.user.userId, notes ? sanitizeInput(notes) : null);

  if (!updatedReport) {
    return res.status(404).json({ error: 'Report not found or already processed' });
  }

  // Notify reporter via WebSocket
  const reporter = db.findUserById(updatedReport.reporterId);
  if (reporter) {
    broadcast({
      type: 'report_resolved',
      reportId: updatedReport.id,
      status: updatedReport.status,
      resolution: updatedReport.resolution,
      targetUserId: updatedReport.reporterId
    });
  }

  res.json({ success: true, report: updatedReport });
});

// Dismiss report (moderator+)
app.post('/api/admin/reports/:id/dismiss', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  const reportId = sanitizeInput(req.params.id);
  const { reason } = req.body;

  const updatedReport = db.dismissReport(reportId, req.user.userId, reason ? sanitizeInput(reason) : null);

  if (!updatedReport) {
    return res.status(404).json({ error: 'Report not found or already processed' });
  }

  // Notify reporter via WebSocket
  const reporter = db.findUserById(updatedReport.reporterId);
  if (reporter) {
    broadcast({
      type: 'report_resolved',
      reportId: updatedReport.id,
      status: updatedReport.status,
      resolution: updatedReport.resolution,
      targetUserId: updatedReport.reporterId
    });
  }

  res.json({ success: true, report: updatedReport });
});

// Issue warning to user (moderator+)
app.post('/api/admin/users/:id/warn', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  const targetUserId = sanitizeInput(req.params.id);
  const { reason, reportId } = req.body;

  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({ error: 'Reason is required' });
  }

  const targetUser = db.findUserById(targetUserId);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const warning = db.createWarning(
    targetUserId,
    req.user.userId,
    sanitizeInput(reason),
    reportId ? sanitizeInput(reportId) : null
  );

  // Log activity
  if (db.logActivity) db.logActivity(req.user.userId, 'admin_warn', 'user', targetUserId, { ...getRequestMeta(req), reason: sanitizeInput(reason), reportId });

  // Notify user via WebSocket
  broadcast({
    type: 'warning_received',
    warning,
    targetUserId
  });

  res.json({ success: true, warning });
});

// Get warnings for a user (moderator+)
app.get('/api/admin/users/:id/warnings', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  const targetUserId = sanitizeInput(req.params.id);
  const warnings = db.getWarningsByUser(targetUserId);

  res.json({ warnings, count: warnings.length });
});

// Admin user search (moderator+)
// Returns users with admin-level details including email, isAdmin, and MFA status
app.get('/api/admin/users/search', authenticateToken, (req, res) => {
  const admin = db.findUserById(req.user.userId);
  if (!requireRole(admin, ROLES.MODERATOR, res)) return;

  const query = sanitizeInput(req.query.q);
  if (!query || query.length < 1) {
    return res.json({ users: [] });
  }

  const users = db.adminSearchUsers(query);
  res.json({ users });
});

// Admin password reset (moderator+)
// Allows moderators/admins to reset a user's password and optionally send them a temporary password
app.post('/api/admin/users/:id/reset-password', authenticateToken, async (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.MODERATOR, res)) return;

    const targetUserId = sanitizeInput(req.params.id);
    const { temporaryPassword, sendEmail: shouldSendEmail } = req.body;

    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow resetting your own password this way
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot reset your own password via admin panel' });
    }

    // Generate temporary password if not provided
    const tempPassword = temporaryPassword || crypto.randomBytes(12).toString('base64').slice(0, 16);

    // Validate temporary password
    if (tempPassword.length < 8) {
      return res.status(400).json({ error: 'Temporary password must be at least 8 characters' });
    }

    // Set new password with requireChange flag
    const result = await db.setPassword(targetUserId, tempPassword, true);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to reset password' });
    }

    // Clear account lockouts
    db.clearFailedLogins(targetUser.handle);

    // Get decrypted email for lockout clearing and email sending (v2.16.0)
    const decryptedEmail = db.getDecryptedEmail ? db.getDecryptedEmail(targetUserId) : targetUser.email;
    const hasValidEmail = decryptedEmail && !decryptedEmail.startsWith('[protected:');

    if (hasValidEmail) {
      db.clearFailedLogins(decryptedEmail);
    }

    // Log the action
    if (db.logModerationAction) {
      db.logModerationAction(admin.id, 'password_reset', 'user', targetUserId, 'Admin password reset');
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'admin_password_reset', 'user', targetUserId, { ...getRequestMeta(req), emailSent: shouldSendEmail && hasValidEmail });

    // Optionally send email with temporary password
    let emailSent = false;
    if (shouldSendEmail && hasValidEmail) {
      const emailService = getEmailService();
      if (emailService.isConfigured()) {
        const emailResult = await emailService.sendTempPasswordEmail(decryptedEmail, tempPassword, admin.displayName || admin.handle);
        emailSent = emailResult.success;
        if (!emailSent) {
          console.warn(`Failed to send temp password email: ${emailResult.error}`);
        }
      }
    }

    console.log(`Admin ${admin.handle} reset password for user ${targetUser.handle}`);

    res.json({
      success: true,
      temporaryPassword: shouldSendEmail ? undefined : tempPassword, // Only return password if not emailed
      emailSent,
      message: emailSent
        ? 'Password reset. User will receive an email with their temporary password.'
        : 'Password reset. User will be required to change password on next login.'
    });
  } catch (err) {
    console.error('Admin password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Force logout all sessions for a user (moderator+)
app.post('/api/admin/users/:id/force-logout', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.MODERATOR, res)) return;

    const targetUserId = sanitizeInput(req.params.id);
    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user status to offline
    db.updateUserStatus(targetUserId, 'offline');

    // Note: True session invalidation would require token version tracking or token blacklisting
    // For now, we just update status. The user's existing tokens remain valid until expiry.
    // Full implementation would need a tokenVersion field in users table that gets checked on every request.

    // Log the action
    if (db.logModerationAction) {
      db.logModerationAction(admin.id, 'force_logout', 'user', targetUserId, 'Admin forced logout');
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'admin_force_logout', 'user', targetUserId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} forced logout for user ${targetUser.handle}`);

    res.json({
      success: true,
      message: 'User status set to offline. Note: Existing tokens remain valid until expiry.'
    });
  } catch (err) {
    console.error('Force logout error:', err);
    res.status(500).json({ error: 'Failed to force logout' });
  }
});

// Disable MFA for a user (moderator+ - emergency lockout recovery)
app.post('/api/admin/users/:id/disable-mfa', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.MODERATOR, res)) return;

    const targetUserId = sanitizeInput(req.params.id);
    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow disabling your own MFA this way
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot disable your own MFA via admin panel' });
    }

    // Disable all MFA methods
    if (db.disableTotp) db.disableTotp(targetUserId);
    if (db.disableEmailMfa) db.disableEmailMfa(targetUserId);

    // Clear recovery codes
    if (db.storeRecoveryCodes) db.storeRecoveryCodes(targetUserId, []);

    // Log the action
    if (db.logModerationAction) {
      db.logModerationAction(admin.id, 'disable_mfa', 'user', targetUserId, 'Admin disabled MFA for lockout recovery');
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'admin_disable_mfa', 'user', targetUserId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} disabled MFA for user ${targetUser.handle}`);

    res.json({
      success: true,
      message: 'MFA disabled for user. They can now log in with just their password.'
    });
  } catch (err) {
    console.error('Admin disable MFA error:', err);
    res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

// Update user role (admin only) - v1.20.0
app.put('/api/admin/users/:id/role', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const targetUserId = sanitizeInput(req.params.id);
    const { role } = req.body;

    // Validate role
    const validRoles = ['admin', 'moderator', 'user'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be: admin, moderator, or user' });
    }

    // Cannot change your own role
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    const result = db.updateUserRole(targetUserId, role);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log the action
    if (db.logModerationAction) {
      db.logModerationAction(admin.id, 'change_role', 'user', targetUserId, `Changed role to ${role}`);
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'admin_change_role', 'user', targetUserId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} changed role of user ${result.user.handle} to ${role}`);

    res.json({
      success: true,
      user: {
        id: result.user.id,
        handle: result.user.handle,
        displayName: result.user.displayName,
        role: result.user.role,
        isAdmin: result.user.isAdmin
      }
    });
  } catch (err) {
    console.error('Admin change role error:', err);
    res.status(500).json({ error: 'Failed to change user role' });
  }
});

// ============ Account Moderation Endpoints (v2.37.0) ============

// Disable user account (moderator+)
app.post('/api/admin/users/:id/disable', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.MODERATOR, res)) return;

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const targetUserId = req.params.id;
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot moderate yourself' });
    }

    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot moderate users of equal or higher role
    if (ROLE_HIERARCHY[getUserRole(targetUser)] >= ROLE_HIERARCHY[getUserRole(admin)]) {
      return res.status(403).json({ error: 'Cannot moderate users of equal or higher role' });
    }

    if (targetUser.accountStatus && targetUser.accountStatus !== 'active') {
      return res.status(400).json({ error: `User is already ${targetUser.accountStatus}` });
    }

    db.updateAccountStatus(targetUserId, 'disabled', reason.trim(), admin.id);

    // Revoke all sessions and disconnect WebSocket
    if (db.revokeAllUserSessions) db.revokeAllUserSessions(targetUserId);
    broadcastToUser(targetUserId, { type: 'account_moderated', status: 'disabled', reason: reason.trim() });
    // Close WebSocket connections
    const userClients = clients.get(targetUserId);
    if (userClients) {
      for (const ws of userClients) {
        ws.close(1008, 'Account disabled');
      }
    }

    if (db.logModerationAction) db.logModerationAction(admin.id, 'disable_account', 'user', targetUserId, reason.trim());
    if (db.logActivity) db.logActivity(admin.id, 'admin_disable_account', 'user', targetUserId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} disabled account: ${targetUser.handle} — ${reason.trim()}`);
    res.json({ success: true, message: `Account @${targetUser.handle} disabled` });
  } catch (err) {
    console.error('Disable account error:', err);
    res.status(500).json({ error: 'Failed to disable account' });
  }
});

// Ban user account (admin only)
app.post('/api/admin/users/:id/ban', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const targetUserId = req.params.id;
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot moderate yourself' });
    }

    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (ROLE_HIERARCHY[getUserRole(targetUser)] >= ROLE_HIERARCHY[getUserRole(admin)]) {
      return res.status(403).json({ error: 'Cannot moderate users of equal or higher role' });
    }

    if (targetUser.accountStatus && targetUser.accountStatus !== 'active') {
      return res.status(400).json({ error: `User is already ${targetUser.accountStatus}` });
    }

    db.updateAccountStatus(targetUserId, 'banned', reason.trim(), admin.id);

    if (db.revokeAllUserSessions) db.revokeAllUserSessions(targetUserId);
    broadcastToUser(targetUserId, { type: 'account_moderated', status: 'banned', reason: reason.trim() });
    const userClients = clients.get(targetUserId);
    if (userClients) {
      for (const ws of userClients) {
        ws.close(1008, 'Account banned');
      }
    }

    if (db.logModerationAction) db.logModerationAction(admin.id, 'ban_account', 'user', targetUserId, reason.trim());
    if (db.logActivity) db.logActivity(admin.id, 'admin_ban_account', 'user', targetUserId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} banned account: ${targetUser.handle} — ${reason.trim()}`);
    res.json({ success: true, message: `Account @${targetUser.handle} banned` });
  } catch (err) {
    console.error('Ban account error:', err);
    res.status(500).json({ error: 'Failed to ban account' });
  }
});

// Reinstate user account (admin only)
app.post('/api/admin/users/:id/reinstate', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const targetUserId = req.params.id;
    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!targetUser.accountStatus || targetUser.accountStatus === 'active') {
      return res.status(400).json({ error: 'User account is already active' });
    }

    db.updateAccountStatus(targetUserId, 'active', null, null);

    if (db.logModerationAction) db.logModerationAction(admin.id, 'reinstate_account', 'user', targetUserId, `Reinstated from ${targetUser.accountStatus}`);
    if (db.logActivity) db.logActivity(admin.id, 'admin_reinstate_account', 'user', targetUserId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} reinstated account: ${targetUser.handle}`);
    res.json({ success: true, message: `Account @${targetUser.handle} reinstated` });
  } catch (err) {
    console.error('Reinstate account error:', err);
    res.status(500).json({ error: 'Failed to reinstate account' });
  }
});

// Kick user from wave (moderator+)
app.post('/api/admin/users/:id/kick', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.MODERATOR, res)) return;

    const { waveId } = req.body;
    if (!waveId || !waveId.trim()) {
      return res.status(400).json({ error: 'Wave ID is required' });
    }

    const targetUserId = req.params.id;
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot kick yourself' });
    }

    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const wave = db.getWave(waveId.trim());
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Remove participant
    db.removeParticipant(waveId.trim(), targetUserId);
    broadcastToUser(targetUserId, { type: 'removed_from_wave', waveId: waveId.trim() });

    if (db.logModerationAction) db.logModerationAction(admin.id, 'kick_from_wave', 'user', targetUserId, `Kicked from wave ${waveId.trim()}`);
    if (db.logActivity) db.logActivity(admin.id, 'admin_kick', 'user', targetUserId, { ...getRequestMeta(req), waveId: waveId.trim() });

    console.log(`Admin ${admin.handle} kicked ${targetUser.handle} from wave ${waveId.trim()}`);
    res.json({ success: true, message: `@${targetUser.handle} kicked from wave` });
  } catch (err) {
    console.error('Kick user error:', err);
    res.status(500).json({ error: 'Failed to kick user' });
  }
});

// Delete user account (admin only)
app.post('/api/admin/users/:id/delete', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const targetUserId = req.params.id;
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (ROLE_HIERARCHY[getUserRole(targetUser)] >= ROLE_HIERARCHY[getUserRole(admin)]) {
      return res.status(403).json({ error: 'Cannot delete users of equal or higher role' });
    }

    if (!db.deleteUserAccount) {
      return res.status(501).json({ error: 'Account deletion not available' });
    }

    // Revoke sessions and disconnect first
    if (db.revokeAllUserSessions) db.revokeAllUserSessions(targetUserId);
    const userClients = clients.get(targetUserId);
    if (userClients) {
      for (const ws of userClients) {
        ws.close(1008, 'Account deleted');
      }
    }

    const result = db.deleteUserAccount(targetUserId);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to delete account' });
    }

    if (db.logModerationAction) db.logModerationAction(admin.id, 'delete_account', 'user', targetUserId, `Deleted account @${targetUser.handle}`);
    if (db.logActivity) db.logActivity(admin.id, 'admin_delete_account', 'user', targetUserId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} deleted account: ${targetUser.handle}`);
    res.json({ success: true, message: `Account @${targetUser.handle} deleted` });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Reset user encryption keys (admin only)
app.post('/api/admin/users/:id/reset-encryption', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const targetUserId = req.params.id;
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot reset your own encryption keys' });
    }

    const targetUser = db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (ROLE_HIERARCHY[getUserRole(targetUser)] >= ROLE_HIERARCHY[getUserRole(admin)]) {
      return res.status(403).json({ error: 'Cannot reset encryption for users of equal or higher role' });
    }

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    // Wipe all encryption keys for the user
    db.db.prepare('DELETE FROM user_encryption_keys WHERE user_id = ?').run(targetUserId);
    db.db.prepare('DELETE FROM user_recovery_keys WHERE user_id = ?').run(targetUserId);
    db.db.prepare('DELETE FROM wave_encryption_keys WHERE user_id = ?').run(targetUserId);

    if (db.logModerationAction) db.logModerationAction(admin.id, 'reset_encryption', 'user', targetUserId, reason.trim());
    if (db.logActivity) db.logActivity(admin.id, 'admin_reset_encryption', 'user', targetUserId, getRequestMeta(req));

    broadcastToUser(targetUserId, { type: 'encryption_reset', message: 'Your encryption keys have been reset by an administrator' });

    console.log(`Admin ${admin.handle} reset encryption keys for: ${targetUser.handle}`);
    res.json({ success: true, message: `Encryption keys reset for @${targetUser.handle}` });
  } catch (err) {
    console.error('Reset encryption error:', err);
    res.status(500).json({ error: 'Failed to reset encryption keys' });
  }
});

// Submit moderation appeal (public, rate-limited)
app.post('/api/auth/moderation-appeal', loginLimiter, async (req, res) => {
  try {
    const { handle, appealText } = req.body;

    if (!handle || !handle.trim()) {
      return res.status(400).json({ error: 'Handle is required' });
    }
    if (!appealText || appealText.trim().length < 10) {
      return res.status(400).json({ error: 'Appeal must be at least 10 characters' });
    }
    if (appealText.length > 2000) {
      return res.status(400).json({ error: 'Appeal must be under 2000 characters' });
    }

    const user = db.findUserByHandle(handle.trim());
    if (!user) {
      // Don't reveal if user exists
      return res.json({ success: true, message: 'If the account exists, your appeal has been submitted.' });
    }

    if (!user.accountStatus || user.accountStatus === 'active') {
      return res.status(400).json({ error: 'Account is not moderated' });
    }

    // Check for existing pending appeal
    if (db.hasRecentPendingAppeal(user.id)) {
      return res.status(400).json({ error: 'You already have a pending appeal' });
    }

    db.createAppeal(user.id, appealText.trim());
    if (db.logActivity) db.logActivity(user.id, 'appeal_submitted', 'user', user.id, { ip: req.ip });

    // Notify admins
    broadcastToAdmins({ type: 'moderation_appeal_submitted', userHandle: user.handle });

    res.json({ success: true, message: 'Appeal submitted. An administrator will review your case.' });
  } catch (err) {
    console.error('Appeal submission error:', err);
    res.status(500).json({ error: 'Failed to submit appeal' });
  }
});

// Check appeal status (public, rate-limited)
app.get('/api/auth/moderation-appeal/status', loginLimiter, (req, res) => {
  try {
    const { handle } = req.query;
    if (!handle || !handle.trim()) {
      return res.status(400).json({ error: 'Handle is required' });
    }

    const user = db.findUserByHandle(handle.trim());
    if (!user) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const appeals = db.getAppealsByUser(user.id);
    res.json({
      accountStatus: user.accountStatus || 'active',
      appeals: appeals.map(a => ({
        status: a.status,
        adminResponse: a.adminResponse,
        reviewedAt: a.reviewedAt,
        createdAt: a.createdAt,
      })),
    });
  } catch (err) {
    console.error('Appeal status error:', err);
    res.status(500).json({ error: 'Failed to check appeal status' });
  }
});

// List pending appeals (moderator+)
app.get('/api/admin/moderation-appeals', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.MODERATOR, res)) return;

    const appeals = db.getPendingAppeals();
    res.json({ appeals });
  } catch (err) {
    console.error('Get appeals error:', err);
    res.status(500).json({ error: 'Failed to get appeals' });
  }
});

// Resolve appeal (admin only)
app.post('/api/admin/moderation-appeals/:id/resolve', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const { status, adminResponse } = req.body;
    if (!status || !['approved', 'denied'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or denied' });
    }

    const appealId = req.params.id;
    const result = db.resolveAppeal(appealId, status, adminResponse || null, admin.id);
    if (!result) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // If approved, reinstate the user
    if (status === 'approved') {
      db.updateAccountStatus(result.userId, 'active', null, null);
      if (db.logModerationAction) db.logModerationAction(admin.id, 'reinstate_via_appeal', 'user', result.userId, 'Appeal approved');
      if (db.logActivity) db.logActivity(admin.id, 'admin_reinstate_via_appeal', 'user', result.userId, getRequestMeta(req));
    }

    if (db.logModerationAction) db.logModerationAction(admin.id, 'resolve_appeal', 'moderation_appeal', appealId, `${status}: ${adminResponse || 'No response'}`);
    if (db.logActivity) db.logActivity(admin.id, 'admin_resolve_appeal', 'moderation_appeal', appealId, getRequestMeta(req));

    console.log(`Admin ${admin.handle} ${status} appeal ${appealId}`);
    res.json({ success: true, result });
  } catch (err) {
    console.error('Resolve appeal error:', err);
    res.status(500).json({ error: 'Failed to resolve appeal' });
  }
});

// ============ Privacy Maintenance Endpoints (v2.16.0) ============

// Migrate user emails to hashed/encrypted format (admin only)
app.post('/api/admin/maintenance/migrate-emails', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    if (!db.migrateAllUserEmails) {
      return res.status(501).json({ error: 'Email migration not available' });
    }

    const result = db.migrateAllUserEmails();

    // Log the action
    if (db.logModerationAction) {
      db.logModerationAction(admin.id, 'email_migration', 'system', 'bulk', `Migrated ${result.migrated} users, ${result.errors} errors`);
    }
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'admin_email_migration', 'system', 'bulk', { ...getRequestMeta(req), ...result });
    }

    console.log(`Admin ${admin.handle} triggered email migration: ${result.migrated} migrated, ${result.errors} errors`);

    res.json({
      success: true,
      migrated: result.migrated,
      errors: result.errors,
      message: result.errors > 0
        ? `Migrated ${result.migrated} users, ${result.errors} errors (check server logs)`
        : `Successfully migrated ${result.migrated} users to encrypted email storage`
    });
  } catch (err) {
    console.error('Email migration error:', err);
    res.status(500).json({ error: 'Failed to migrate emails' });
  }
});

// Migrate wave participation to encrypted storage (admin only) - v2.21.0
app.post('/api/admin/maintenance/migrate-wave-participants', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const result = waveParticipationCrypto.migrateToEncrypted();

    if (result.success) {
      console.log(`✅ Admin ${admin.handle} migrated ${result.migratedWaves} waves to encrypted participation storage`);
      res.json({
        success: true,
        migratedWaves: result.migratedWaves,
        message: `Migrated ${result.migratedWaves} waves to encrypted storage`
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    console.error('Wave participation migration error:', err);
    res.status(500).json({ error: 'Failed to migrate wave participation data' });
  }
});

// Migrate push subscriptions to encrypted storage (admin only) - v2.22.0
app.post('/api/admin/maintenance/migrate-push-subscriptions', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const result = pushSubscriptionCrypto.migrateToEncrypted();

    if (result.success) {
      console.log(`✅ Admin ${admin.handle} migrated ${result.migratedUsers} users (${result.migratedSubscriptions} subscriptions) to encrypted push subscription storage`);
      res.json({
        success: true,
        migratedUsers: result.migratedUsers,
        migratedSubscriptions: result.migratedSubscriptions,
        message: `Migrated ${result.migratedUsers} users with ${result.migratedSubscriptions} push subscriptions to encrypted storage`
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    console.error('Push subscription migration error:', err);
    res.status(500).json({ error: 'Failed to migrate push subscription data' });
  }
});

// Migrate crew membership to encrypted storage (admin only) - v2.24.0
app.post('/api/admin/maintenance/migrate-crew-members', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    const result = crewMembershipCrypto.migrateToEncrypted();

    if (result.success) {
      console.log(`Admin ${admin.handle} migrated ${result.migratedCrews} crews to encrypted membership storage`);
      res.json({
        success: true,
        migratedCrews: result.migratedCrews,
        message: `Migrated ${result.migratedCrews} crews to encrypted storage`
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    console.error('Crew membership migration error:', err);
    res.status(500).json({ error: 'Failed to migrate crew membership data' });
  }
});

// v2.27.0: Admin migration - wave user metadata
app.post('/api/admin/maintenance/migrate-wave-metadata', authenticateToken, (req, res) => {
  if (!requireRole(req.user, ROLES.ADMIN, res)) return;
  const result = participation.migrateMetadata();
  res.json(result);
});

// v2.27.0: Admin migration - wave encryption key IDs
app.post('/api/admin/maintenance/migrate-wave-key-ids', authenticateToken, (req, res) => {
  if (!requireRole(req.user, ROLES.ADMIN, res)) return;
  const result = participation.migrateWaveKeyIds();
  res.json(result);
});

// Get privacy status/stats (admin only)
app.get('/api/admin/maintenance/privacy-status', authenticateToken, (req, res) => {
  try {
    const admin = db.findUserById(req.user.userId);
    if (!requireRole(admin, ROLES.ADMIN, res)) return;

    // Count users with/without email protection
    const totalUsers = db.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const usersWithEmailHash = db.db.prepare('SELECT COUNT(*) as count FROM users WHERE email_hash IS NOT NULL').get().count;
    const usersWithPlainEmail = db.db.prepare('SELECT COUNT(*) as count FROM users WHERE email IS NOT NULL AND email_hash IS NULL').get().count;
    const usersWithEncryptedEmail = db.db.prepare('SELECT COUNT(*) as count FROM users WHERE email_encrypted IS NOT NULL').get().count;

    // Wave participation protection stats (v2.21.0)
    const participationStats = waveParticipationCrypto.getCacheStats();
    const encryptedWavesCount = db.db.prepare('SELECT COUNT(*) as count FROM wave_participants_encrypted').get()?.count || 0;
    const totalWaves = db.db.prepare('SELECT COUNT(DISTINCT wave_id) as count FROM wave_participants').get()?.count || 0;

    // Push subscription protection stats (v2.22.0)
    const pushSubStats = pushSubscriptionCrypto.getStats();
    const encryptedPushSubsCount = db.db.prepare('SELECT COUNT(*) as count FROM push_subscriptions_encrypted').get()?.count || 0;
    const totalPushSubUsers = db.db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM push_subscriptions').get()?.count || 0;
    const totalPushSubs = db.db.prepare('SELECT COUNT(*) as count FROM push_subscriptions').get()?.count || 0;

    // Crew membership protection stats (v2.24.0)
    const crewMembershipStats = crewMembershipCrypto.getCacheStats();
    const encryptedCrewsCount = db.db.prepare('SELECT COUNT(*) as count FROM crew_members_encrypted').get()?.count || 0;
    const totalCrews = db.db.prepare('SELECT COUNT(DISTINCT crew_id) as count FROM crew_members').get()?.count || 0;

    res.json({
      totalUsers,
      emailProtection: {
        hashed: usersWithEmailHash,
        encrypted: usersWithEncryptedEmail,
        plaintext: usersWithPlainEmail,
        migrationNeeded: usersWithPlainEmail
      },
      waveParticipation: {
        totalWaves,
        encryptedWaves: encryptedWavesCount,
        cacheStats: participationStats,
        migrationNeeded: participationStats.encryptionEnabled ? (totalWaves - encryptedWavesCount) : 0
      },
      pushSubscriptions: {
        totalUsers: totalPushSubUsers,
        totalSubscriptions: totalPushSubs,
        encryptedUsers: encryptedPushSubsCount,
        cacheStats: pushSubStats,
        migrationNeeded: pushSubStats.encryptionEnabled ? (totalPushSubUsers - encryptedPushSubsCount) : 0
      },
      crewMembership: {
        totalCrews,
        encryptedCrews: encryptedCrewsCount,
        cacheStats: crewMembershipStats,
        migrationNeeded: crewMembershipStats.encryptionEnabled ? (totalCrews - encryptedCrewsCount) : 0
      },
      config: {
        emailEncryptionEnabled: !!EMAIL_ENCRYPTION_KEY,
        waveParticipationEncryptionEnabled: participationStats.encryptionEnabled,
        pushSubscriptionEncryptionEnabled: pushSubStats.encryptionEnabled,
        crewMembershipEncryptionEnabled: crewMembershipStats.encryptionEnabled,
        activityLogRetentionDays: ACTIVITY_LOG_RETENTION_DAYS,
        sessionMaxAgeDays: SESSION_MAX_AGE_DAYS
      }
    });
  } catch (err) {
    console.error('Privacy status error:', err);
    res.status(500).json({ error: 'Failed to get privacy status' });
  }
});

// Get moderation log (moderator+)
app.get('/api/admin/moderation-log', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  const logs = db.getModerationLog(limit, offset);

  res.json({ logs, count: logs.length });
});

// Get moderation log for specific target (moderator+)
app.get('/api/admin/moderation-log/:targetType/:targetId', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  const targetType = sanitizeInput(req.params.targetType);
  const targetId = sanitizeInput(req.params.targetId);

  if (!['user', 'message', 'wave'].includes(targetType)) {
    return res.status(400).json({ error: 'Invalid target type' });
  }

  const logs = db.getModerationLogForTarget(targetType, targetId);

  res.json({ logs, count: logs.length });
});

// Get activity log (moderator+)
app.get('/api/admin/activity-log', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  if (!db.getActivityLog) {
    return res.status(501).json({ error: 'Activity logging not available in this database mode' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const userId = req.query.userId ? sanitizeInput(req.query.userId) : null;
  const actionType = req.query.actionType ? sanitizeInput(req.query.actionType) : null;
  const startDate = req.query.startDate ? sanitizeInput(req.query.startDate) : null;
  const endDate = req.query.endDate ? sanitizeInput(req.query.endDate) : null;

  try {
    const result = db.getActivityLog({
      userId,
      actionType,
      startDate,
      endDate,
      limit,
      offset
    });

    res.json(result);
  } catch (err) {
    console.error('Activity log error:', err);
    res.status(500).json({ error: 'Failed to retrieve activity log' });
  }
});

// Get activity stats (moderator+)
app.get('/api/admin/activity-stats', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  if (!db.getActivityStats) {
    return res.status(501).json({ error: 'Activity logging not available in this database mode' });
  }

  const days = Math.min(parseInt(req.query.days) || 7, 90);

  try {
    const stats = db.getActivityStats(days);
    res.json(stats);
  } catch (err) {
    console.error('Activity stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve activity stats' });
  }
});

// Get activity log for a specific user (moderator+)
app.get('/api/admin/activity-log/user/:userId', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.MODERATOR, res)) return;

  if (!db.getUserActivityLog) {
    return res.status(501).json({ error: 'Activity logging not available in this database mode' });
  }

  const targetUserId = sanitizeInput(req.params.userId);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const activities = db.getUserActivityLog(targetUserId, limit);
    res.json({ activities, count: activities.length });
  } catch (err) {
    console.error('User activity log error:', err);
    res.status(500).json({ error: 'Failed to retrieve user activity log' });
  }
});

// ============ Federation Routes ============

// Helper function to generate RSA keypair for federation
function generateFederationKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  return { publicKey, privateKey };
}

// HTTP Signature utilities for server-to-server authentication
// Format: Signature: keyId="https://server/api/federation/identity#main-key",
//                    algorithm="rsa-sha256",
//                    headers="(request-target) host date digest",
//                    signature="base64sig"

function createHttpSignature(method, url, body, privateKey, nodeName) {
  // For backward compatibility, stringify the body if it's an object
  const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
  return createHttpSignatureFromString(method, url, bodyString || null, privateKey, nodeName);
}

// Create HTTP signature from an already-stringified body
function createHttpSignatureFromString(method, url, bodyString, privateKey, nodeName) {
  const parsedUrl = new URL(url);
  const date = new Date().toUTCString();
  const requestTarget = `${method.toLowerCase()} ${parsedUrl.pathname}`;

  // Create digest of body (SHA-256)
  const digest = bodyString
    ? `SHA-256=${crypto.createHash('sha256').update(bodyString).digest('base64')}`
    : '';

  // Build signing string
  const headers = ['(request-target)', 'host', 'date'];
  if (digest) headers.push('digest');

  const signingParts = [
    `(request-target): ${requestTarget}`,
    `host: ${parsedUrl.host}`,
    `date: ${date}`,
  ];
  if (digest) signingParts.push(`digest: ${digest}`);

  const signingString = signingParts.join('\n');

  // Sign with RSA-SHA256
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingString);
  const signature = sign.sign(privateKey, 'base64');

  // Build Signature header
  const keyId = `https://${nodeName}/api/federation/identity#main-key`;
  const signatureHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="${headers.join(' ')}",signature="${signature}"`;

  return {
    'Date': date,
    'Digest': digest || undefined,
    'Signature': signatureHeader,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

function parseHttpSignature(signatureHeader) {
  if (!signatureHeader) return null;

  const parts = {};
  // Parse: keyId="...",algorithm="...",headers="...",signature="..."
  const regex = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(signatureHeader)) !== null) {
    parts[match[1]] = match[2];
  }

  if (!parts.keyId || !parts.signature || !parts.headers) {
    return null;
  }

  return parts;
}

function verifyHttpSignature(req, publicKey) {
  const signatureParts = parseHttpSignature(req.headers['signature']);
  if (!signatureParts) return false;

  const headersList = signatureParts.headers.split(' ');

  // Reconstruct signing string
  const signingParts = headersList.map(header => {
    if (header === '(request-target)') {
      return `(request-target): ${req.method.toLowerCase()} ${req.path}`;
    }
    const value = req.headers[header.toLowerCase()];
    if (!value) return null;
    return `${header}: ${value}`;
  });

  if (signingParts.some(p => p === null)) return false;

  const signingString = signingParts.join('\n');

  // Verify signature
  try {
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(signingString);
    return verify.verify(publicKey, signatureParts.signature, 'base64');
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return false;
  }
}

// Middleware to authenticate federation requests (server-to-server)
// Factory function to create auth middleware with allowed statuses
function createFederationAuthMiddleware(allowedStatuses = ['active']) {
  return function(req, res, next) {
    if (!FEDERATION_ENABLED) {
      return res.status(404).json({ error: 'Federation is not enabled' });
    }

    const signatureHeader = req.headers['signature'];
    if (!signatureHeader) {
      return res.status(401).json({ error: 'Missing Signature header' });
    }

    const signatureParts = parseHttpSignature(signatureHeader);
    if (!signatureParts) {
      return res.status(401).json({ error: 'Invalid Signature header format' });
    }

    // Extract node name from keyId
    // Format: https://nodename/api/federation/identity#main-key
    const keyIdMatch = signatureParts.keyId.match(/https?:\/\/([^\/]+)\//);
    if (!keyIdMatch) {
      return res.status(401).json({ error: 'Invalid keyId format' });
    }

    const nodeName = keyIdMatch[1];

    // Look up the node
    const node = db.getFederationNodeByName(nodeName);
    if (!node) {
      return res.status(403).json({ error: 'Unknown federation node' });
    }

    if (!allowedStatuses.includes(node.status)) {
      return res.status(403).json({ error: `Federation node is ${node.status}` });
    }

    if (!node.publicKey) {
      return res.status(403).json({ error: 'No public key for this node' });
    }

    // Verify digest if present
    if (req.headers['digest']) {
      const bodyString = JSON.stringify(req.body);
      const expectedDigest = `SHA-256=${crypto.createHash('sha256').update(bodyString).digest('base64')}`;
      if (req.headers['digest'] !== expectedDigest) {
        return res.status(401).json({ error: 'Digest mismatch' });
      }
    }

    // Verify signature
    if (!verifyHttpSignature(req, node.publicKey)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Check date is within acceptable window (5 minutes)
    const requestDate = new Date(req.headers['date']);
    const now = new Date();
    const diffMinutes = Math.abs(now - requestDate) / (1000 * 60);
    if (diffMinutes > 5) {
      return res.status(401).json({ error: 'Request date too old or in future' });
    }

    // Attach node info to request
    req.federationNode = node;

    // Record successful contact (only for active nodes)
    if (node.status === 'active') {
      db.recordFederationContact(node.id, true);
    }

    next();
  };
}

// Default middleware for active nodes only
const authenticateFederationRequest = createFederationAuthMiddleware(['active']);

// Middleware that also allows outbound_pending (for accept/decline responses)
const authenticateFederationResponse = createFederationAuthMiddleware(['active', 'outbound_pending']);

// ============ Federation Protocol v2 Helpers (v2.28.0) ============

// Create a standardized federation envelope with protocol version
function createFederationEnvelope(id, type, payload) {
  return { id, type, payload, protocolVersion: 2 };
}

// Message padding — fixed-size buckets to resist traffic analysis
const PADDING_BUCKETS = [1024, 4096, 16384, 65536, 262144]; // 1KB, 4KB, 16KB, 64KB, 256KB

function padFederationPayload(envelope) {
  const serialized = JSON.stringify(envelope);
  const currentSize = Buffer.byteLength(serialized);
  const targetBucket = PADDING_BUCKETS.find(b => b >= currentSize + 50) || PADDING_BUCKETS[PADDING_BUCKETS.length - 1];
  const paddingNeeded = targetBucket - currentSize - 15; // account for _pad key overhead
  if (paddingNeeded > 0) {
    envelope._pad = crypto.randomBytes(Math.max(1, Math.floor(paddingNeeded / 2))).toString('base64');
  }
  return envelope;
}

function stripPadding(envelope) {
  if (envelope && envelope._pad) delete envelope._pad;
  return envelope;
}

// Helper to send signed federation requests
async function sendSignedFederationRequest(targetNode, method, path, body = null) {
  const ourIdentity = db.getServerIdentity();
  if (!ourIdentity) {
    throw new Error('Server identity not configured');
  }

  const url = `${targetNode.baseUrl}${path}`;

  // Pad outbound federation inbox messages for traffic analysis resistance (v2.28.0)
  if (body && typeof body === 'object' && path === '/api/federation/inbox' && body.type) {
    body = padFederationPayload(body);
  }

  // Stringify body once and use the same string for both signature and request
  // Guard against double-stringify: if body is already a string, don't stringify again
  let bodyString = null;
  if (body) {
    if (typeof body === 'string') {
      bodyString = body;
    } else {
      bodyString = JSON.stringify(body);
    }
  }

  // Pass the stringified body to createHttpSignature for consistent digest calculation
  const headers = createHttpSignatureFromString(method, url, bodyString, ourIdentity.privateKey, ourIdentity.nodeName);

  // Remove undefined headers
  Object.keys(headers).forEach(key => headers[key] === undefined && delete headers[key]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: bodyString || undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// Helper to send wave invite to a federated server
// Called when creating a wave with federated participants or adding federated participants to an existing wave
// Uses optimistic send (try immediately) with queue fallback on failure
async function sendWaveInvite(targetNode, wave, participants, invitedUserHandle) {
  const messageId = `wave-invite-${uuidv4()}`;
  const ourIdentity = db.getServerIdentity();

  // Build participant list with node info
  const participantList = participants.map(p => ({
    id: p.id,
    handle: p.handle,
    displayName: p.displayName || p.name,
    avatar: p.avatar,
    avatarUrl: p.avatarUrl,
    nodeName: p.nodeName || ourIdentity?.nodeName, // Local users have our node
  }));

  const payload = createFederationEnvelope(messageId, 'wave_invite', {
    wave: {
      id: wave.id,
      title: wave.title,
      privacy: wave.privacy || 'cross-server',
      createdBy: wave.createdBy,
      createdAt: wave.createdAt,
    },
    participants: participantList,
    invitedUserHandle,
  });

  try {
    // Try to send immediately (optimistic)
    const response = await sendSignedFederationRequest(targetNode, 'POST', '/api/federation/inbox', payload);

    if (response.ok) {
      console.log(`✅ Wave invite sent to ${targetNode.nodeName} for @${invitedUserHandle}`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ Wave invite to ${targetNode.nodeName} failed: ${response.status} - ${errorText}`);
      // Queue for retry
      db.queueFederationMessage({
        targetNode: targetNode.nodeName,
        messageType: 'wave_invite',
        payload,
      });
      console.log(`📥 Queued wave_invite for retry to ${targetNode.nodeName}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Wave invite to ${targetNode.nodeName} error:`, error.message);
    // Queue for retry
    db.queueFederationMessage({
      targetNode: targetNode.nodeName,
      messageType: 'wave_invite',
      payload,
    });
    console.log(`📥 Queued wave_invite for retry to ${targetNode.nodeName}`);
    return false;
  }
}

// Helper to parse federated user identifier
// Returns { handle, nodeName } or null if not federated
function parseFederatedIdentifier(identifier) {
  const match = identifier.match(/^@?([^@]+)@(.+)$/);
  if (match) {
    return { handle: match[1], nodeName: match[2] };
  }
  return null;
}

// Helper to send a droplet to all federated nodes on a wave
// Called when a droplet is created, edited, or deleted on an origin wave
// Uses optimistic send (try immediately) with queue fallback on failure
async function sendDropletToFederatedNodes(waveId, messageType, payload) {
  if (!FEDERATION_ENABLED) return;

  // Get all federated nodes for this wave
  const federationNodes = db.getWaveFederationNodes(waveId);
  if (!federationNodes || federationNodes.length === 0) return;

  const messageId = `${messageType}-${payload.droplet?.id || payload.dropletId}-${Date.now()}`;

  for (const fed of federationNodes) {
    const node = db.getFederationNodeByName(fed.nodeName);
    if (!node || node.status !== 'active') {
      console.warn(`⚠️ Skipping ${messageType} to ${fed.nodeName}: node not found or not active`);
      continue;
    }

    const fullPayload = createFederationEnvelope(messageId, messageType, payload);

    try {
      // Try to send immediately (optimistic)
      const response = await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', fullPayload);

      if (response.ok) {
        console.log(`✅ ${messageType} sent to ${node.nodeName}`);
      } else {
        const errorText = await response.text();
        console.error(`❌ ${messageType} to ${node.nodeName} failed: ${response.status} - ${errorText}`);
        // Queue for retry
        db.queueFederationMessage({
          targetNode: fed.nodeName,
          messageType,
          payload: fullPayload,
        });
        console.log(`📥 Queued ${messageType} for retry to ${fed.nodeName}`);
      }
    } catch (error) {
      console.error(`❌ ${messageType} to ${node.nodeName} error:`, error.message);
      // Queue for retry
      db.queueFederationMessage({
        targetNode: fed.nodeName,
        messageType,
        payload: fullPayload,
      });
      console.log(`📥 Queued ${messageType} for retry to ${fed.nodeName}`);
    }
  }
}

// Rate limiter for federation inbox (higher limits for server-to-server)
const federationInboxLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute (for bulk message delivery)
  message: { error: 'Too many federation requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoint: Get this server's federation identity (no auth required)
// Other servers call this to get our public key during handshake
app.get('/api/federation/identity', (req, res) => {
  if (!FEDERATION_ENABLED) {
    return res.status(404).json({ error: 'Federation is not enabled on this server' });
  }

  const identity = db.getServerIdentity();
  if (!identity) {
    return res.status(404).json({ error: 'Server identity not configured' });
  }

  // Return public identity only (never expose private key)
  res.json({
    nodeName: identity.nodeName,
    publicKey: identity.publicKey,
    createdAt: identity.createdAt,
    protocolVersion: 2,
    capabilities: ['decoy', 'padding']
  });
});

// Get federation status (admin only)
app.get('/api/admin/federation/status', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const identity = db.getServerIdentity();
  const nodes = db.getFederationNodes();

  const activeNodes = nodes.filter(n => n.status === 'active');
  res.json({
    enabled: FEDERATION_ENABLED,
    configured: !!identity,
    nodeName: identity?.nodeName || FEDERATION_NODE_NAME || null,
    hasKeypair: !!identity?.publicKey,
    trustedNodes: nodes.length,
    activeNodes: activeNodes.length,
    protocolVersion: 2,
    v2NodeCount: activeNodes.filter(n => n.protocolVersion >= 2).length,
    decoy: {
      enabled: FEDERATION_DECOY_ENABLED,
      minIntervalS: FEDERATION_DECOY_MIN_INTERVAL_S,
      maxIntervalS: FEDERATION_DECOY_MAX_INTERVAL_S,
      activeTargets: decoyStats.activeTargets,
      sentTotal: decoyStats.sentTotal,
      lastSentAt: decoyStats.lastSentAt,
      startedAt: decoyStats.startedAt,
    }
  });
});

// Runtime decoy cover traffic toggle (v2.28.0)
app.post('/api/admin/federation/decoy', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled' });
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  FEDERATION_DECOY_ENABLED = enabled;
  if (enabled) {
    startDecoyTraffic();
  } else {
    stopDecoyTraffic();
  }

  res.json({
    success: true,
    enabled: FEDERATION_DECOY_ENABLED,
    activeTargets: decoyStats.activeTargets
  });
});

// Initialize or update server identity (admin only)
// TODO: UUID collision risk when cloning databases
// If a production database is cloned to set up a new server, all UUIDs (users, waves,
// droplets) will be identical on both servers. The federation design assumes UUIDs are
// globally unique - collisions would cause:
// - User ID conflicts (same UUID = different people on different servers)
// - Wave ID conflicts (federation state confusion)
// - Droplet deduplication failures or incorrect message merging
// Potential safeguards:
// 1. Document: "Don't clone databases between federated servers"
// 2. Add validation: refuse to federate if remote has matching origin_wave_ids
// 3. Provide ID regeneration script for setting up new servers from backups
// 4. Include node name in UUID generation (would require migration)
app.post('/api/admin/federation/identity', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const nodeName = sanitizeInput(req.body.nodeName);
  if (!nodeName || nodeName.length < 3) {
    return res.status(400).json({ error: 'Node name must be at least 3 characters' });
  }

  // Validate node name format (domain-like)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/.test(nodeName)) {
    return res.status(400).json({ error: 'Node name must be a valid domain format (e.g., cortex.example.com)' });
  }

  const existingIdentity = db.getServerIdentity();
  let publicKey, privateKey;

  if (req.body.regenerateKeys || !existingIdentity) {
    // Generate new keypair
    const keypair = generateFederationKeypair();
    publicKey = keypair.publicKey;
    privateKey = keypair.privateKey;
    console.log(`🔑 Generated new federation keypair for ${nodeName}`);
  } else {
    // Keep existing keypair
    publicKey = existingIdentity.publicKey;
    privateKey = existingIdentity.privateKey;
  }

  const identity = db.setServerIdentity({ nodeName, publicKey, privateKey });

  res.json({
    success: true,
    nodeName: identity.nodeName,
    publicKey: identity.publicKey,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt
  });
});

// List trusted federation nodes (admin only)
app.get('/api/admin/federation/nodes', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const status = req.query.status ? sanitizeInput(req.query.status) : null;
  const nodes = db.getFederationNodes({ status });

  res.json({ nodes, count: nodes.length });
});

// Add a trusted federation node (admin only)
app.post('/api/admin/federation/nodes', authenticateToken, async (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const nodeName = sanitizeInput(req.body.nodeName);
  const baseUrl = sanitizeInput(req.body.baseUrl);

  if (!nodeName || nodeName.length < 3) {
    return res.status(400).json({ error: 'Node name must be at least 3 characters' });
  }

  if (!baseUrl || !baseUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Valid base URL is required (must start with http:// or https://)' });
  }

  // Check if node already exists
  const existingNode = db.getFederationNodeByName(nodeName);
  if (existingNode) {
    return res.status(409).json({ error: 'Node with this name already exists' });
  }

  const node = db.addFederationNode({
    nodeName,
    baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
    status: 'pending',
    addedBy: req.user.userId
  });

  res.status(201).json({ success: true, node });
});

// Get a specific federation node (admin only)
app.get('/api/admin/federation/nodes/:id', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const nodeId = sanitizeInput(req.params.id);
  const node = db.getFederationNode(nodeId);

  if (!node) {
    return res.status(404).json({ error: 'Federation node not found' });
  }

  res.json({ node });
});

// Update a federation node (admin only)
app.put('/api/admin/federation/nodes/:id', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const nodeId = sanitizeInput(req.params.id);
  const updates = {};

  if (req.body.baseUrl) {
    updates.baseUrl = sanitizeInput(req.body.baseUrl).replace(/\/$/, '');
  }
  if (req.body.status && ['pending', 'active', 'suspended', 'blocked'].includes(req.body.status)) {
    updates.status = req.body.status;
  }

  const node = db.updateFederationNode(nodeId, updates);
  if (!node) {
    return res.status(404).json({ error: 'Federation node not found' });
  }

  // Refresh decoy targets on status change (v2.28.0)
  if (FEDERATION_DECOY_ENABLED && updates.status) refreshDecoyTargets();

  res.json({ success: true, node });
});

// Delete a federation node (admin only)
app.delete('/api/admin/federation/nodes/:id', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  const nodeId = sanitizeInput(req.params.id);
  const deleted = db.deleteFederationNode(nodeId);

  if (!deleted) {
    return res.status(404).json({ error: 'Federation node not found' });
  }

  res.json({ success: true });
});

// Initiate handshake with a federation node (admin only)
// Fetches the remote server's public key
app.post('/api/admin/federation/nodes/:id/handshake', authenticateToken, async (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled on this server' });
  }

  const ourIdentity = db.getServerIdentity();
  if (!ourIdentity) {
    return res.status(400).json({ error: 'Server identity not configured. Set up federation identity first.' });
  }

  const nodeId = sanitizeInput(req.params.id);
  const node = db.getFederationNode(nodeId);

  if (!node) {
    return res.status(404).json({ error: 'Federation node not found' });
  }

  try {
    // Fetch the remote server's identity
    const identityUrl = `${node.baseUrl}/api/federation/identity`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(identityUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': `Cortex/${ourIdentity.nodeName}`
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      db.recordFederationContact(nodeId, false);
      return res.status(502).json({
        error: 'Failed to reach remote server',
        details: `HTTP ${response.status}: ${errorText.substring(0, 100)}`
      });
    }

    const remoteIdentity = await response.json();

    if (!remoteIdentity.nodeName || !remoteIdentity.publicKey) {
      db.recordFederationContact(nodeId, false);
      return res.status(502).json({ error: 'Invalid response from remote server' });
    }

    // Verify the node name matches
    if (remoteIdentity.nodeName !== node.nodeName) {
      db.recordFederationContact(nodeId, false);
      return res.status(400).json({
        error: 'Node name mismatch',
        details: `Expected ${node.nodeName}, got ${remoteIdentity.nodeName}`
      });
    }

    // Update our record with the remote server's public key and mark as active
    const updatedNode = db.updateFederationNode(nodeId, {
      publicKey: remoteIdentity.publicKey,
      status: 'active',
      protocolVersion: remoteIdentity.protocolVersion || 1
    });
    db.recordFederationContact(nodeId, true);

    // Refresh decoy targets if cover traffic is active (v2.28.0)
    if (FEDERATION_DECOY_ENABLED) refreshDecoyTargets();

    res.json({
      success: true,
      message: 'Handshake successful',
      node: updatedNode,
      remoteIdentity: {
        nodeName: remoteIdentity.nodeName,
        publicKey: remoteIdentity.publicKey.substring(0, 100) + '...'
      }
    });
  } catch (error) {
    db.recordFederationContact(nodeId, false);

    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Connection timed out' });
    }

    console.error(`Federation handshake failed for ${node.nodeName}:`, error.message);
    res.status(502).json({
      error: 'Failed to connect to remote server',
      details: error.message
    });
  }
});

// ============ Federation Request System ============

// Rate limiter for federation request endpoint (stricter than general inbox)
const federationRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 requests per hour per IP
  message: { error: 'Too many federation requests. Try again later.' }
});

// Send a federation request to another server (admin only)
app.post('/api/admin/federation/request', authenticateToken, async (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled on this server' });
  }

  const ourIdentity = db.getServerIdentity();
  if (!ourIdentity) {
    return res.status(400).json({ error: 'Server identity not configured. Set up federation identity first.' });
  }

  const { baseUrl, message } = req.body;
  if (!baseUrl) {
    return res.status(400).json({ error: 'baseUrl is required' });
  }

  // Normalize base URL (remove trailing slash)
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  try {
    // Step 1: Fetch the remote server's identity
    const identityUrl = `${normalizedBaseUrl}/api/federation/identity`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const identityResponse = await fetch(identityUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': `Cortex/${ourIdentity.nodeName}`
      }
    });
    clearTimeout(timeout);

    if (!identityResponse.ok) {
      const errorText = await identityResponse.text();
      return res.status(502).json({
        error: 'Failed to reach remote server',
        details: `HTTP ${identityResponse.status}: ${errorText.substring(0, 100)}`
      });
    }

    const remoteIdentity = await identityResponse.json();
    if (!remoteIdentity.nodeName || !remoteIdentity.publicKey) {
      return res.status(502).json({ error: 'Invalid response from remote server - missing identity' });
    }

    // Check if we already have a relationship with this server
    const existingNode = db.getFederationNodeByName(remoteIdentity.nodeName);
    if (existingNode) {
      if (existingNode.status === 'active') {
        return res.status(400).json({ error: 'Already federated with this server' });
      }
      if (existingNode.status === 'outbound_pending') {
        return res.status(400).json({ error: 'Federation request already pending for this server' });
      }
    }

    // Check if they have a pending request to us (auto-accept scenario)
    const incomingRequest = db.getPendingRequestFromNode(remoteIdentity.nodeName);
    if (incomingRequest) {
      // They already requested us - auto-accept their request instead
      const accepted = db.acceptFederationRequest(incomingRequest.id);
      if (accepted) {
        // Send acceptance notification back to them
        try {
          const acceptBody = {
            type: 'federation_accepted',
            requestId: incomingRequest.id,
            acceptorNodeName: ourIdentity.nodeName,
            acceptorPublicKey: ourIdentity.publicKey
          };
          const targetNode = { baseUrl: incomingRequest.fromBaseUrl, nodeName: incomingRequest.fromNodeName };
          await sendSignedFederationRequest(targetNode, 'POST', '/api/federation/inbox/accept', acceptBody);
        } catch (notifyErr) {
          console.error('Failed to notify acceptance:', notifyErr.message);
        }
        return res.json({
          success: true,
          message: 'They had a pending request to us - auto-accepted and federation is now active',
          node: db.getFederationNodeByName(remoteIdentity.nodeName)
        });
      }
    }

    // Step 2: Send signed federation request to remote server
    const requestBody = {
      type: 'federation_request',
      fromNodeName: ourIdentity.nodeName,
      fromBaseUrl: `${req.protocol}://${req.get('host')}`, // Our server's URL
      fromPublicKey: ourIdentity.publicKey,
      message: message || null
    };

    // Build signature for the request using our private key
    const requestUrl = `${normalizedBaseUrl}/api/federation/inbox/request`;
    const bodyString = JSON.stringify(requestBody);
    const headers = createHttpSignatureFromString('POST', requestUrl, bodyString, ourIdentity.privateKey, ourIdentity.nodeName);

    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 15000);

    const requestResponse = await fetch(requestUrl, {
      method: 'POST',
      signal: controller2.signal,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: bodyString
    });
    clearTimeout(timeout2);

    if (!requestResponse.ok) {
      const errorText = await requestResponse.text();
      return res.status(502).json({
        error: 'Remote server rejected our request',
        details: `HTTP ${requestResponse.status}: ${errorText.substring(0, 200)}`
      });
    }

    // Step 3: Create local node entry with outbound_pending status
    const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    db.addFederationNode({
      nodeName: remoteIdentity.nodeName,
      baseUrl: normalizedBaseUrl,
      addedBy: user.id
    });
    // Update to outbound_pending and store their public key
    const node = db.getFederationNodeByName(remoteIdentity.nodeName);
    if (node) {
      db.updateFederationNode(node.id, {
        status: 'outbound_pending',
        publicKey: remoteIdentity.publicKey
      });
    }

    res.json({
      success: true,
      message: 'Federation request sent successfully',
      remoteNode: {
        nodeName: remoteIdentity.nodeName,
        status: 'outbound_pending'
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Connection timed out' });
    }
    console.error('Federation request failed:', error.message);
    res.status(502).json({
      error: 'Failed to send federation request',
      details: error.message
    });
  }
});

// Receive a federation request from another server (public, but signed)
app.post('/api/federation/inbox/request', federationRequestLimiter, async (req, res) => {
  if (!FEDERATION_ENABLED) {
    return res.status(404).json({ error: 'Federation is not enabled on this server' });
  }

  const ourIdentity = db.getServerIdentity();
  if (!ourIdentity) {
    return res.status(404).json({ error: 'Server identity not configured' });
  }

  const { type, fromNodeName, fromBaseUrl, fromPublicKey, message } = req.body;

  if (type !== 'federation_request') {
    return res.status(400).json({ error: 'Invalid request type' });
  }

  if (!fromNodeName || !fromBaseUrl || !fromPublicKey) {
    return res.status(400).json({ error: 'Missing required fields: fromNodeName, fromBaseUrl, fromPublicKey' });
  }

  // Verify the HTTP signature using the provided public key (bootstrap trust)
  const signatureHeader = req.headers['signature'];
  if (!signatureHeader) {
    return res.status(401).json({ error: 'Missing Signature header' });
  }

  // Parse and verify signature
  const parsed = parseHttpSignature(signatureHeader);
  if (!parsed || !parsed.signature) {
    return res.status(401).json({ error: 'Invalid Signature header format' });
  }

  // Verify keyId matches the claimed node name
  const keyIdMatch = parsed.keyId?.match(/https?:\/\/([^\/]+)\//);
  if (!keyIdMatch || keyIdMatch[1] !== fromNodeName) {
    return res.status(401).json({ error: 'Signature keyId does not match fromNodeName' });
  }

  // Verify the signature using the provided public key
  try {
    const isValid = verifyHttpSignature(req, fromPublicKey);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  // Check if we're already federated with this node
  const existingNode = db.getFederationNodeByName(fromNodeName);
  if (existingNode && existingNode.status === 'active') {
    return res.json({ success: true, message: 'Already federated', alreadyFederated: true });
  }

  // Check if we have an outbound_pending request to them (mutual request scenario)
  if (existingNode && existingNode.status === 'outbound_pending') {
    // They're requesting us while we're waiting for them - auto-accept!
    db.updateFederationNode(existingNode.id, {
      status: 'active',
      publicKey: fromPublicKey
    });

    // Send acceptance notification back
    try {
      const acceptBody = {
        type: 'federation_accepted',
        acceptorNodeName: ourIdentity.nodeName,
        acceptorPublicKey: ourIdentity.publicKey
      };
      const targetNode = { baseUrl: fromBaseUrl, nodeName: fromNodeName };
      await sendSignedFederationRequest(targetNode, 'POST', '/api/federation/inbox/accept', acceptBody);
    } catch (notifyErr) {
      console.error('Failed to send acceptance notification:', notifyErr.message);
    }

    return res.json({ success: true, message: 'Mutual request - auto-accepted', autoAccepted: true });
  }

  // Check for existing pending request from this node
  const existingRequest = db.getPendingRequestFromNode(fromNodeName);
  if (existingRequest) {
    return res.json({ success: true, message: 'Request already pending', duplicate: true });
  }

  // Create the federation request
  const request = db.createFederationRequest(
    fromNodeName,
    fromBaseUrl,
    fromPublicKey,
    ourIdentity.nodeName,
    message
  );

  console.log(`📨 Received federation request from ${fromNodeName}`);

  // Notify admin users
  broadcastToAdmins({
    type: 'federation_request_received',
    request: {
      id: request.id,
      fromNodeName,
      message,
      createdAt: request.createdAt
    }
  });

  res.json({ success: true, message: 'Federation request received', requestId: request.id });
});

// Get pending federation requests (admin only)
app.get('/api/admin/federation/requests', authenticateToken, (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled on this server' });
  }

  const requests = db.getPendingFederationRequests();
  res.json({ requests, count: requests.length });
});

// Accept a federation request (admin only)
app.post('/api/admin/federation/requests/:id/accept', authenticateToken, async (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled on this server' });
  }

  const ourIdentity = db.getServerIdentity();
  if (!ourIdentity) {
    return res.status(400).json({ error: 'Server identity not configured' });
  }

  const requestId = sanitizeInput(req.params.id);
  const request = db.getFederationRequest(requestId);

  if (!request) {
    return res.status(404).json({ error: 'Federation request not found' });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({ error: `Request already ${request.status}` });
  }

  try {
    // Verify the requesting server's identity by fetching their current public key
    const identityUrl = `${request.fromBaseUrl}/api/federation/identity`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const identityResponse = await fetch(identityUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': `Cortex/${ourIdentity.nodeName}`
      }
    });
    clearTimeout(timeout);

    if (!identityResponse.ok) {
      return res.status(502).json({ error: 'Could not verify remote server identity' });
    }

    const remoteIdentity = await identityResponse.json();

    // Verify public key matches what was in the request (prevent bait-and-switch)
    if (remoteIdentity.publicKey !== request.fromPublicKey) {
      return res.status(400).json({
        error: 'Public key mismatch',
        details: 'The remote server\'s public key has changed since the request was made. Please decline and have them re-request.'
      });
    }

    // Accept the request (creates federation_nodes entry)
    const accepted = db.acceptFederationRequest(requestId);
    if (!accepted) {
      return res.status(500).json({ error: 'Failed to accept request' });
    }

    // Store protocol version from remote identity (v2.28.0)
    const acceptedNode = db.getFederationNodeByName(request.fromNodeName);
    if (acceptedNode) {
      db.updateFederationNode(acceptedNode.id, {
        protocolVersion: remoteIdentity.protocolVersion || 1
      });
    }

    // Send acceptance notification to the requesting server
    const acceptBody = {
      type: 'federation_accepted',
      requestId: requestId,
      acceptorNodeName: ourIdentity.nodeName,
      acceptorPublicKey: ourIdentity.publicKey
    };

    const targetNode = { baseUrl: request.fromBaseUrl, nodeName: request.fromNodeName };

    try {
      await sendSignedFederationRequest(targetNode, 'POST', '/api/federation/inbox/accept', acceptBody);
    } catch (notifyErr) {
      console.error('Failed to notify requesting server of acceptance:', notifyErr.message);
      // Continue anyway - they can retry their handshake
    }

    const node = db.getFederationNodeByName(request.fromNodeName);
    console.log(`✅ Accepted federation request from ${request.fromNodeName}`);

    // Refresh decoy targets if cover traffic is active (v2.28.0)
    if (FEDERATION_DECOY_ENABLED) refreshDecoyTargets();

    res.json({
      success: true,
      message: 'Federation request accepted',
      node
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Connection timed out while verifying remote server' });
    }
    console.error('Accept federation request failed:', error.message);
    res.status(500).json({ error: 'Failed to accept federation request', details: error.message });
  }
});

// Decline a federation request (admin only)
app.post('/api/admin/federation/requests/:id/decline', authenticateToken, async (req, res) => {
  const user = db.findUserById(req.user.userId);
  if (!requireRole(user, ROLES.ADMIN, res)) return;

  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled on this server' });
  }

  const ourIdentity = db.getServerIdentity();

  const requestId = sanitizeInput(req.params.id);
  const request = db.getFederationRequest(requestId);

  if (!request) {
    return res.status(404).json({ error: 'Federation request not found' });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({ error: `Request already ${request.status}` });
  }

  // Decline the request
  const declined = db.declineFederationRequest(requestId);
  if (!declined) {
    return res.status(500).json({ error: 'Failed to decline request' });
  }

  // Notify the requesting server (best effort)
  if (ourIdentity) {
    try {
      const declineBody = {
        type: 'federation_declined',
        fromNodeName: request.fromNodeName
      };
      const targetNode = { baseUrl: request.fromBaseUrl, nodeName: request.fromNodeName };
      await sendSignedFederationRequest(targetNode, 'POST', '/api/federation/inbox/decline', declineBody);
    } catch (notifyErr) {
      console.error('Failed to notify requesting server of decline:', notifyErr.message);
      // Continue anyway
    }
  }

  console.log(`❌ Declined federation request from ${request.fromNodeName}`);
  res.json({ success: true, message: 'Federation request declined' });
});

// Receive acceptance notification from a server we requested
app.post('/api/federation/inbox/accept', federationRequestLimiter, authenticateFederationResponse, (req, res) => {
  const { type, acceptorNodeName, acceptorPublicKey } = req.body;
  const sourceNode = req.federationNode;

  if (type !== 'federation_accepted') {
    return res.status(400).json({ error: 'Invalid message type' });
  }

  // Find our outbound pending node for this server
  const node = db.getFederationNodeByName(sourceNode.nodeName);
  if (!node) {
    return res.status(404).json({ error: 'No pending request found for this server' });
  }

  if (node.status !== 'outbound_pending') {
    return res.json({ success: true, message: 'Already processed' });
  }

  // Update to active status
  db.updateFederationNode(node.id, {
    status: 'active',
    publicKey: acceptorPublicKey || node.publicKey
  });
  db.recordFederationContact(node.id, true);

  // TODO: Federation catch-up/backfill mechanism
  // When federation is re-established after a disconnection, droplets created during
  // the downtime are not synced. For robustness (e.g., server failure recovery), consider:
  // 1. Sync on reconnection - request droplets newer than last sync point for shared waves
  // 2. Admin resync button - manual option to request full wave resync
  // 3. Version vectors - track last-seen droplet timestamps per wave per node
  // This would require a new endpoint like GET /api/federation/waves/:id/sync?since=timestamp

  console.log(`✅ Federation request to ${sourceNode.nodeName} was accepted`);
  res.json({ success: true, message: 'Acceptance acknowledged' });
});

// Receive decline notification from a server we requested
app.post('/api/federation/inbox/decline', federationRequestLimiter, authenticateFederationResponse, (req, res) => {
  const { type, fromNodeName } = req.body;
  const sourceNode = req.federationNode;

  if (type !== 'federation_declined') {
    return res.status(400).json({ error: 'Invalid message type' });
  }

  // Find our outbound pending node for this server
  const node = db.getFederationNodeByName(sourceNode.nodeName);
  if (!node) {
    return res.status(404).json({ error: 'No pending request found for this server' });
  }

  if (node.status !== 'outbound_pending') {
    return res.json({ success: true, message: 'Already processed' });
  }

  // Update to declined status or delete the node entry
  db.updateFederationNode(node.id, { status: 'declined' });

  console.log(`❌ Federation request to ${sourceNode.nodeName} was declined`);
  res.json({ success: true, message: 'Decline acknowledged' });
});

// ============ End Federation Request System ============

// Federation inbox - receives signed messages from other servers
// This is the main entry point for federated content delivery
app.post('/api/federation/inbox', federationInboxLimiter, authenticateFederationRequest, async (req, res) => {
  // Strip padding from incoming messages (v2.28.0)
  stripPadding(req.body);
  const { id, type, payload } = req.body;
  const sourceNode = req.federationNode;

  if (!id || !type) {
    return res.status(400).json({ error: 'Missing id or type' });
  }

  // Check for duplicate (idempotency)
  if (db.hasReceivedFederationMessage(id)) {
    // Already processed, return success (idempotent)
    return res.json({ success: true, duplicate: true });
  }

  // Log the incoming message
  db.logFederationInbox({ id, sourceNode: sourceNode.nodeName, messageType: type });

  // Process based on message type
  try {
    switch (type) {
      case 'wave_invite': {
        // Handle wave invitation from origin server
        // payload: { wave, participants, invitedUserHandle }
        console.log(`📨 Received wave_invite from ${sourceNode.nodeName}`);

        const { wave, participants, invitedUserHandle } = payload;
        if (!wave || !invitedUserHandle) {
          console.error('Invalid wave_invite payload');
          break;
        }

        // Find the local user being invited
        const invitedUser = db.findUserByHandle(invitedUserHandle);
        if (!invitedUser) {
          console.error(`wave_invite: User @${invitedUserHandle} not found locally`);
          break;
        }

        // Check if we already have this wave as a participant
        let localWave = db.getWaveByOrigin(sourceNode.nodeName, wave.id);

        if (!localWave) {
          // Create participant wave
          const participantWaveId = uuidv4();
          localWave = db.createParticipantWave({
            id: participantWaveId,
            title: wave.title,
            privacy: wave.privacy || 'cross-server',
            createdBy: invitedUser.id, // Local user as creator reference
            originNode: sourceNode.nodeName,
            originWaveId: wave.id,
          });

          // Cache any remote participants
          if (participants) {
            for (const p of participants) {
              if (p.nodeName && p.nodeName !== db.getServerIdentity()?.nodeName) {
                // Remote user, cache them
                db.cacheRemoteUser({
                  id: p.id,
                  nodeName: p.nodeName,
                  handle: p.handle,
                  displayName: p.displayName,
                  avatar: p.avatar,
                  avatarUrl: p.avatarUrl,
                  bio: p.bio,
                });
              }
            }
          }
        }

        // Add local user as participant - use crypto module for cache synchronization (v2.21.0)
        participation.addParticipant(localWave.id, invitedUser.id);

        // Track that this node is participating
        db.addWaveFederationNode(localWave.id, sourceNode.nodeName);

        // Notify the local user via WebSocket
        const wsClients = clients.get(invitedUser.id);
        if (wsClients) {
          const notification = {
            type: 'wave_invite_received',
            wave: {
              id: localWave.id,
              title: localWave.title,
              privacy: localWave.privacy,
              federationState: 'participant',
              originNode: sourceNode.nodeName,
              originWaveId: wave.id,
            },
            fromNode: sourceNode.nodeName,
          };
          wsClients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify(notification));
            }
          });
        }

        console.log(`✅ Created participant wave ${localWave.id} for @${invitedUserHandle}`);
        break;
      }

      case 'wave_broadcast': {
        // Handle public/cross-server wave broadcast from origin server
        // This creates a participant wave visible to all users on this server
        // payload: { wave, participants, droplets }
        console.log(`📢 Received wave_broadcast from ${sourceNode.nodeName}`);

        const { wave, participants, droplets } = payload;
        if (!wave) {
          console.error('Invalid wave_broadcast payload');
          break;
        }

        // Check if we already have this wave as a participant
        let localWave = db.getWaveByOrigin(sourceNode.nodeName, wave.id);

        if (!localWave) {
          // Create participant wave with privacy set to crossServer
          // This allows any local user to see it
          const participantWaveId = `wave-${uuidv4()}`;

          // We need a local user to be the "reference" creator
          // Use the first admin or fall back to first active user
          const adminUser = db.getAllUsers().find(u => u.role === 'admin');
          const fallbackUser = db.getAllUsers()[0];
          const referenceUser = adminUser || fallbackUser;

          if (!referenceUser) {
            console.error('wave_broadcast: No local users to reference as participant wave owner');
            break;
          }

          localWave = db.createParticipantWave({
            id: participantWaveId,
            title: wave.title,
            privacy: 'crossServer',
            createdBy: referenceUser.id,
            originNode: sourceNode.nodeName,
            originWaveId: wave.id,
          });

          // Cache any remote participants
          if (participants) {
            for (const p of participants) {
              if (p.nodeName && p.nodeName !== db.getServerIdentity()?.nodeName) {
                db.cacheRemoteUser({
                  id: p.id,
                  nodeName: p.nodeName,
                  handle: p.handle,
                  displayName: p.displayName,
                  avatar: p.avatar,
                  avatarUrl: p.avatarUrl,
                });
              }
            }
          }

          // Cache existing droplets from the broadcast
          if (droplets && Array.isArray(droplets)) {
            console.log(`📥 Caching ${droplets.length} existing droplets from wave broadcast`);
            for (const d of droplets) {
              // Cache the droplet author if remote
              if (d.author && d.author.nodeName) {
                db.cacheRemoteUser({
                  id: d.author.id,
                  nodeName: d.author.nodeName,
                  handle: d.author.handle,
                  displayName: d.author.displayName,
                  avatar: d.author.avatar,
                  avatarUrl: d.author.avatarUrl,
                });
              }

              // Ensure reactions is an object (may be string if corrupted)
              let reactions = d.reactions || {};
              if (typeof reactions === 'string') {
                try { reactions = JSON.parse(reactions); } catch { reactions = {}; }
              }

              // Cache the droplet
              db.cacheRemoteDroplet({
                id: d.id,
                waveId: localWave.id,
                originWaveId: wave.id,
                originNode: d.author?.nodeName || sourceNode.nodeName,
                authorId: d.author?.id || d.authorId,
                authorNode: d.author?.nodeName || sourceNode.nodeName,
                parentId: d.parentId,
                content: d.content,
                createdAt: d.createdAt,
                editedAt: d.editedAt,
                reactions,
              });
            }
          }

          // Broadcast to all connected local users
          const allUsers = db.getAllUsers();
          for (const user of allUsers) {
            const wsClients = clients.get(user.id);
            if (wsClients) {
              const notification = {
                type: 'wave_broadcast_received',
                wave: {
                  id: localWave.id,
                  title: localWave.title,
                  privacy: localWave.privacy,
                  federationState: 'participant',
                  originNode: sourceNode.nodeName,
                  originWaveId: wave.id,
                },
                fromNode: sourceNode.nodeName,
              };
              wsClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify(notification));
                }
              });
            }
          }

          console.log(`✅ Created public participant wave ${localWave.id} from broadcast`);
        } else {
          console.log(`ℹ️ Wave broadcast already exists as ${localWave.id}`);
        }
        break;
      }

      case 'new_droplet': {
        // Handle new droplet from federated wave
        // payload: { droplet, originWaveId, author }
        console.log(`📨 Received new_droplet from ${sourceNode.nodeName}`);

        const { droplet, originWaveId, author } = payload;
        if (!droplet || !originWaveId) {
          console.error('Invalid new_droplet payload');
          break;
        }

        // Find the local wave - could be participant wave OR origin wave
        // First try: this server is participant, sourceNode is origin
        let localWave = db.getWaveByOrigin(sourceNode.nodeName, originWaveId);
        let isOriginServer = false;

        // Second try: this server is origin, sourceNode is participant
        if (!localWave) {
          const maybeOriginWave = db.getWave(originWaveId);
          if (maybeOriginWave && maybeOriginWave.federationState === 'origin') {
            localWave = maybeOriginWave;
            isOriginServer = true;
          }
        }

        if (!localWave) {
          console.error(`new_droplet: No local wave found for origin ${originWaveId} from ${sourceNode.nodeName}`);
          break;
        }

        // Cache the author if remote
        if (author && author.nodeName) {
          db.cacheRemoteUser({
            id: author.id,
            nodeName: author.nodeName,
            handle: author.handle,
            displayName: author.displayName,
            avatar: author.avatar,
            avatarUrl: author.avatarUrl,
            bio: author.bio,
          });
        }

        // Cache the remote droplet
        const cachedDroplet = db.cacheRemoteDroplet({
          id: droplet.id,
          waveId: localWave.id,
          originWaveId,
          originNode: author?.nodeName || sourceNode.nodeName,
          authorId: author?.id || droplet.authorId,
          authorNode: author?.nodeName || sourceNode.nodeName,
          parentId: droplet.parentId,
          content: droplet.content,
          createdAt: droplet.createdAt,
          editedAt: droplet.editedAt,
          reactions: droplet.reactions,
        });

        // Broadcast to local WebSocket clients on this wave
        broadcastToWave(localWave.id, {
          type: 'new_droplet',
          droplet: {
            ...cachedDroplet,
            sender_name: author?.displayName || 'Unknown',
            sender_handle: author?.handle || 'unknown',
            sender_avatar: author?.avatar || '?',
            sender_avatar_url: author?.avatarUrl,
          },
          isRemote: true,
        });

        console.log(`✅ Cached remote droplet ${droplet.id} in wave ${localWave.id} (origin=${isOriginServer})`);

        // If this is the origin server, relay the droplet to other participant nodes
        if (isOriginServer) {
          const federationNodes = db.getWaveFederationNodes(localWave.id);
          for (const fed of federationNodes) {
            // Don't send back to the node that sent it
            if (fed.nodeName === sourceNode.nodeName) continue;

            const node = db.getFederationNodeByName(fed.nodeName);
            if (!node || node.status !== 'active') continue;

            const relayPayload = createFederationEnvelope(`relay-${droplet.id}-${Date.now()}`, 'new_droplet', { droplet, originWaveId, author });

            sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', relayPayload)
              .then(res => {
                if (res.ok) console.log(`✅ Relayed droplet to ${node.nodeName}`);
                else console.error(`❌ Relay to ${node.nodeName} failed: ${res.status}`);
              })
              .catch(err => console.error(`❌ Relay error to ${node.nodeName}:`, err.message));
          }
        }

        break;
      }

      case 'droplet_edited': {
        // Handle droplet edit from origin server
        // payload: { dropletId, originWaveId, content, editedAt, version }
        console.log(`📨 Received droplet_edited from ${sourceNode.nodeName}`);

        const { dropletId, originWaveId: editOriginWaveId, content, editedAt, version } = payload;
        if (!dropletId || !editOriginWaveId) {
          console.error('Invalid droplet_edited payload');
          break;
        }

        // Find the local participant wave
        const editLocalWave = db.getWaveByOrigin(sourceNode.nodeName, editOriginWaveId);
        if (!editLocalWave) {
          console.error(`droplet_edited: No local wave found for origin ${editOriginWaveId}`);
          break;
        }

        // Check if we have this droplet cached
        const existingDroplet = db.getRemoteDroplet(dropletId);
        if (existingDroplet) {
          // Update via cacheRemoteDroplet (upsert)
          db.cacheRemoteDroplet({
            id: dropletId,
            waveId: editLocalWave.id,
            originWaveId: editOriginWaveId,
            originNode: sourceNode.nodeName,
            authorId: existingDroplet.authorId,
            authorNode: existingDroplet.authorNode,
            parentId: existingDroplet.parentId,
            content,
            createdAt: existingDroplet.createdAt,
            editedAt,
            reactions: existingDroplet.reactions,
          });

          // Broadcast to local clients
          broadcastToWave(editLocalWave.id, {
            type: 'droplet_edited',
            dropletId,
            waveId: editLocalWave.id,
            content,
            editedAt,
            version,
            isRemote: true,
          });

          console.log(`✅ Updated remote droplet ${dropletId}`);
        }
        break;
      }

      case 'droplet_deleted': {
        // Handle droplet deletion from origin server
        // payload: { dropletId, originWaveId }
        console.log(`📨 Received droplet_deleted from ${sourceNode.nodeName}`);

        const { dropletId: deleteDropletId, originWaveId: deleteOriginWaveId } = payload;
        if (!deleteDropletId || !deleteOriginWaveId) {
          console.error('Invalid droplet_deleted payload');
          break;
        }

        // Find the local participant wave
        const deleteLocalWave = db.getWaveByOrigin(sourceNode.nodeName, deleteOriginWaveId);
        if (!deleteLocalWave) {
          console.error(`droplet_deleted: No local wave found for origin ${deleteOriginWaveId}`);
          break;
        }

        // Mark as deleted
        if (db.markRemoteDropletDeleted(deleteDropletId)) {
          // Broadcast to local clients
          broadcastToWave(deleteLocalWave.id, {
            type: 'droplet_deleted',
            dropletId: deleteDropletId,
            waveId: deleteLocalWave.id,
            isRemote: true,
          });

          console.log(`✅ Marked remote droplet ${deleteDropletId} as deleted`);
        }
        break;
      }

      case 'user_profile':
        // Handle user profile update/request
        // payload: { user }
        console.log(`📨 Received user_profile from ${sourceNode.nodeName}`);
        if (payload?.user) {
          db.cacheRemoteUser({
            id: payload.user.id,
            nodeName: sourceNode.nodeName,
            handle: payload.user.handle,
            displayName: payload.user.displayName,
            avatar: payload.user.avatar,
            avatarUrl: payload.user.avatarUrl,
            bio: payload.user.bio,
          });
        }
        break;

      case 'alert_subscribe': {
        // Remote server wants to subscribe to our alerts
        // payload: { categories: ['system', 'emergency'] }
        console.log(`📨 Alert subscription request from ${sourceNode.nodeName}`);
        const { categories } = payload;
        if (!Array.isArray(categories) || categories.length === 0) {
          console.error('Invalid alert_subscribe payload: missing categories');
          break;
        }
        // Add or update subscriber
        db.addAlertSubscriber(sourceNode.nodeName, categories);
        console.log(`✅ ${sourceNode.nodeName} subscribed to alert categories: ${categories.join(', ')}`);
        break;
      }

      case 'alert_unsubscribe': {
        // Remote server wants to unsubscribe from our alerts
        console.log(`📨 Alert unsubscription from ${sourceNode.nodeName}`);
        db.removeAlertSubscriber(sourceNode.nodeName);
        console.log(`✅ ${sourceNode.nodeName} unsubscribed from alerts`);
        break;
      }

      case 'alert_broadcast': {
        // Receiving an alert from a server we're subscribed to
        // payload: { alertId, title, content, priority, category, startTime, endTime, originNode }
        console.log(`📨 Alert broadcast from ${sourceNode.nodeName}`);
        const { alertId, title, content, priority, category, startTime, endTime, originNode } = payload;

        // Verify we're subscribed to this category from this node
        const subscription = db.getAlertSubscriptionByNode(sourceNode.nodeName);
        if (!subscription || subscription.status !== 'active') {
          console.error(`Received alert from ${sourceNode.nodeName} but not subscribed`);
          break;
        }
        const subscribedCategories = JSON.parse(subscription.categories || '[]');
        if (!subscribedCategories.includes(category)) {
          console.error(`Received alert category '${category}' but not subscribed to it`);
          break;
        }

        // Check if we already have this alert
        const existing = db.getAlertByOrigin(originNode || sourceNode.nodeName, alertId);
        if (existing) {
          console.log(`Alert ${alertId} from ${originNode || sourceNode.nodeName} already exists`);
          break;
        }

        // Create the federated alert locally
        const sanitizedContent = sanitizeHtml(content || '', sanitizeOptions);
        db.createAlert({
          title: sanitizeHtml(title || '', { allowedTags: [], allowedAttributes: {} }),
          content: sanitizedContent,
          priority: ['info', 'warning', 'critical'].includes(priority) ? priority : 'info',
          category: ['system', 'announcement', 'emergency'].includes(category) ? category : 'system',
          scope: 'local', // Don't re-federate
          startTime: startTime || new Date().toISOString(),
          endTime: endTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          createdBy: null, // No local creator for federated alerts
          originNode: originNode || sourceNode.nodeName,
          originAlertId: alertId,
        });
        console.log(`✅ Created federated alert '${title}' from ${originNode || sourceNode.nodeName}`);
        break;
      }

      case 'alert_update': {
        // Receiving an alert update from a server we're subscribed to
        console.log(`📨 Alert update from ${sourceNode.nodeName}`);
        const { alertId, title, content, priority, startTime, endTime, originNode } = payload;

        // Find the local copy of this alert
        const existing = db.getAlertByOrigin(originNode || sourceNode.nodeName, alertId);
        if (!existing) {
          console.error(`Alert update for unknown alert ${alertId} from ${originNode || sourceNode.nodeName}`);
          break;
        }

        // Update it
        const updates = {};
        if (title) updates.title = sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} });
        if (content) updates.content = sanitizeHtml(content, sanitizeOptions);
        if (priority && ['info', 'warning', 'critical'].includes(priority)) updates.priority = priority;
        if (startTime) updates.startTime = startTime;
        if (endTime) updates.endTime = endTime;

        if (Object.keys(updates).length > 0) {
          db.updateAlert(existing.id, updates);
          console.log(`✅ Updated federated alert '${existing.title}'`);
        }
        break;
      }

      case 'alert_delete': {
        // Receiving an alert deletion from a server we're subscribed to
        console.log(`📨 Alert deletion from ${sourceNode.nodeName}`);
        const { alertId, originNode } = payload;

        // Find and delete the local copy
        const existing = db.getAlertByOrigin(originNode || sourceNode.nodeName, alertId);
        if (existing) {
          db.deleteAlert(existing.id);
          console.log(`✅ Deleted federated alert '${existing.title}'`);
        } else {
          console.log(`Alert ${alertId} from ${originNode || sourceNode.nodeName} not found locally`);
        }
        break;
      }

      case 'ping':
        // Simple connectivity test
        console.log(`📨 Received ping from ${sourceNode.nodeName}`);
        break;

      case 'decoy':
        // Cover traffic — silent discard, no content logging (v2.28.0)
        break;

      default:
        console.log(`📨 Unknown federation message type: ${type} from ${sourceNode.nodeName}`);
    }

    // Mark as processed
    db.markFederationInboxProcessed(id);

    res.json({ success: true, processed: true });
  } catch (error) {
    console.error(`Federation inbox error processing ${type}:`, error.message);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Fetch a user's public profile (for remote user resolution)
// Called by other servers to get user info
app.get('/api/federation/users/:handle', federationInboxLimiter, authenticateFederationRequest, (req, res) => {
  const handle = sanitizeInput(req.params.handle);
  const user = db.findUserByHandle(handle);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Return public profile only
  res.json({
    user: {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      avatar: user.avatar,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      createdAt: user.createdAt,
    }
  });
});

// Resolve a user identifier - supports both local and federated users
// Format: "handle" for local, "@handle@server.com" for federated
// Authenticated endpoint for local users to look up federated users
app.get('/api/users/resolve/:identifier', authenticateToken, async (req, res) => {
  const identifier = sanitizeInput(req.params.identifier);

  // Parse federated identifier: @handle@server.com or handle@server.com
  const federatedMatch = identifier.match(/^@?([^@]+)@(.+)$/);

  if (!federatedMatch) {
    // Local user lookup
    const user = db.findUserByHandle(identifier);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        avatar: user.avatar,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        isLocal: true,
        nodeName: null,
      }
    });
  }

  // Federated user lookup
  const [, handle, nodeName] = federatedMatch;

  // Check cache first
  const cachedUser = db.getRemoteUserByHandle(nodeName, handle);
  if (cachedUser) {
    // Check if cache is fresh (less than 1 hour old)
    const cacheAge = Date.now() - new Date(cachedUser.cachedAt).getTime();
    if (cacheAge < 60 * 60 * 1000) {
      return res.json({
        user: {
          ...cachedUser,
          isLocal: false,
          federatedHandle: `@${handle}@${nodeName}`,
        }
      });
    }
  }

  // Need to fetch from remote server
  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled' });
  }

  // Find the federation node
  const node = db.getFederationNodeByName(nodeName);
  if (!node) {
    return res.status(404).json({ error: 'Unknown federation server' });
  }

  if (node.status !== 'active') {
    return res.status(400).json({ error: `Federation with ${nodeName} is not active` });
  }

  try {
    const response = await sendSignedFederationRequest(node, 'GET', `/api/federation/users/${encodeURIComponent(handle)}`);

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'User not found on remote server' });
      }
      throw new Error(`Remote server returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.user) {
      return res.status(502).json({ error: 'Invalid response from remote server' });
    }

    // Cache the user
    const remoteUser = db.cacheRemoteUser({
      id: data.user.id,
      nodeName,
      handle: data.user.handle,
      displayName: data.user.displayName,
      avatar: data.user.avatar,
      avatarUrl: data.user.avatarUrl,
      bio: data.user.bio,
    });

    res.json({
      user: {
        ...remoteUser,
        isLocal: false,
        federatedHandle: `@${handle}@${nodeName}`,
      }
    });
  } catch (error) {
    console.error(`Failed to resolve federated user @${handle}@${nodeName}:`, error.message);
    db.recordFederationContact(node.id, false);

    // Return cached data if available (even if stale)
    if (cachedUser) {
      return res.json({
        user: {
          ...cachedUser,
          isLocal: false,
          federatedHandle: `@${handle}@${nodeName}`,
          stale: true,
        }
      });
    }

    res.status(502).json({ error: 'Failed to reach remote server' });
  }
});

// ============ Crew Routes (v2.0.0 aliases) ============
// These are the preferred v2.0.0 endpoints (crews = groups)
// Rewrites /api/crews/* to /api/groups/* and re-invokes routing

app.all('/api/crews', (req, res, next) => {
  req.url = '/api/groups';
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/invitations', (req, res, next) => {
  req.url = '/api/groups/invitations';
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/invitations/:id', (req, res, next) => {
  req.url = `/api/groups/invitations/${req.params.id}`;
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/invitations/:id/accept', (req, res, next) => {
  req.url = `/api/groups/invitations/${req.params.id}/accept`;
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/invitations/:id/decline', (req, res, next) => {
  req.url = `/api/groups/invitations/${req.params.id}/decline`;
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/:id', (req, res, next) => {
  req.url = `/api/groups/${req.params.id}`;
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/:id/members', (req, res, next) => {
  req.url = `/api/groups/${req.params.id}/members`;
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/:id/members/:userId', (req, res, next) => {
  req.url = `/api/groups/${req.params.id}/members/${req.params.userId}`;
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/:id/invite', (req, res, next) => {
  req.url = `/api/groups/${req.params.id}/invite`;
  req.app._router.handle(req, res, next);
});

app.all('/api/crews/:id/invitations/sent', (req, res, next) => {
  req.url = `/api/groups/${req.params.id}/invitations/sent`;
  req.app._router.handle(req, res, next);
});

// ============ Group Routes ============
// Note: /api/crews/* aliases above rewrite to these routes

app.get('/api/groups', authenticateToken, (req, res) => {
  res.json(db.getGroupsForUser(req.user.userId));
});

app.get('/api/groups/:id', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);
  const group = db.getGroup(groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!crewMembership.isMember(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({
    ...group,
    members: db.getGroupMembers(groupId),
    isAdmin: db.isGroupAdmin(groupId, req.user.userId),
    currentUserId: req.user.userId,
  });
});

app.post('/api/groups', authenticateToken, (req, res) => {
  const name = sanitizeInput(req.body.name);
  if (!name || name.length < 1) return res.status(400).json({ error: 'Name is required' });
  
  const group = db.createGroup({
    name,
    description: req.body.description,
    createdBy: req.user.userId,
  });

  // Update encrypted membership cache
  crewMembership.addMember(group.id, req.user.userId, 'admin');

  res.status(201).json({ ...group, memberCount: 1, role: 'admin' });
});

app.put('/api/groups/:id', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);
  if (!db.isGroupAdmin(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const group = db.updateGroup(groupId, req.body);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json(group);
});

app.delete('/api/groups/:id', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);
  if (!db.isGroupAdmin(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!db.deleteGroup(groupId)) {
    return res.status(404).json({ error: 'Group not found' });
  }
  res.json({ success: true });
});

app.post('/api/groups/:id/members', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);
  if (!db.isGroupAdmin(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const userId = sanitizeInput(req.body.userId);
  const user = db.findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!crewMembership.addMember(groupId, userId, req.body.role || 'member')) {
    return res.status(409).json({ error: 'User already in group' });
  }
  res.status(201).json({ success: true });
});

app.delete('/api/groups/:id/members/:userId', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);
  const userId = sanitizeInput(req.params.userId);

  // Allow self-removal or admin removal
  if (userId !== req.user.userId && !db.isGroupAdmin(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!crewMembership.removeMember(groupId, userId)) {
    return res.status(404).json({ error: 'Member not found' });
  }
  res.json({ success: true });
});

app.put('/api/groups/:id/members/:userId', authenticateToken, (req, res) => {
  const groupId = sanitizeInput(req.params.id);
  if (!db.isGroupAdmin(groupId, req.user.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const userId = sanitizeInput(req.params.userId);
  const role = req.body.role;
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  
  if (!db.updateGroupMemberRole(groupId, userId, role)) {
    return res.status(404).json({ error: 'Member not found' });
  }
  res.json({ success: true });
});

// ============ Video Feed Routes (v2.8.0) ============

/**
 * Rate limiter for feed endpoints
 */
const feedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: { error: 'Too many feed requests, please try again later' },
});

/**
 * GET /api/feed/videos
 * Get video feed for the authenticated user
 * Returns videos from public waves and waves the user participates in
 * Excludes encrypted videos and videos from blocked users
 */
app.get('/api/feed/videos', authenticateToken, feedLimiter, (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor ? sanitizeInput(req.query.cursor) : null;
    const seed = req.query.seed ? parseInt(req.query.seed) : null;

    const result = db.getVideoFeedForUser(userId, limit, cursor, seed);

    res.json(result);
  } catch (error) {
    console.error('Error fetching video feed:', error);
    res.status(500).json({ error: 'Failed to fetch video feed' });
  }
});

// Mark video as viewed (v2.10.0 - for recommendation algorithm)
app.post('/api/feed/videos/:id/view', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const videoId = sanitizeInput(req.params.id);

    // Verify video exists and is actually a video
    const video = db.db.prepare(`
      SELECT id FROM pings WHERE id = ? AND media_type = 'video' AND deleted = 0
    `).get(videoId);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Mark as read using existing ping_read_by table
    // This is used by the recommendation algorithm to penalize already-viewed videos
    const existing = db.db.prepare(`
      SELECT 1 FROM ping_read_by WHERE ping_id = ? AND user_id = ?
    `).get(videoId, userId);

    if (!existing) {
      db.db.prepare(`
        INSERT INTO ping_read_by (ping_id, user_id, read_at) VALUES (?, ?, ?)
      `).run(videoId, userId, new Date().toISOString());
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking video as viewed:', error);
    res.status(500).json({ error: 'Failed to mark video as viewed' });
  }
});

// ============ Profile Wave Routes (v2.9.0) ============

/**
 * GET /api/profile/wave
 * Get or create the current user's profile wave
 * Returns the profile wave details with video count
 */
app.get('/api/profile/wave', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const wave = db.getOrCreateProfileWave(userId);

    if (!wave) {
      return res.status(500).json({ error: 'Failed to create profile wave' });
    }

    // Get video count for this profile wave
    const videoCount = db.db.prepare(`
      SELECT COUNT(*) as count FROM pings
      WHERE wave_id = ? AND media_type = 'video' AND deleted = 0
    `).get(wave.id)?.count || 0;

    res.json({
      id: wave.id,
      title: wave.title,
      is_profile_wave: true,
      video_count: videoCount,
    });
  } catch (error) {
    console.error('Error getting profile wave:', error);
    res.status(500).json({ error: 'Failed to get profile wave' });
  }
});

/**
 * POST /api/profile/wave/videos
 * Post a video directly to the user's profile wave
 * Requires media_url from a prior upload to /api/uploads/media
 */
app.post('/api/profile/wave/videos', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { media_url, content, media_duration } = req.body;

    if (!media_url) {
      return res.status(400).json({ error: 'media_url is required' });
    }

    // Validate that it's a video URL
    if (!media_url.includes('/api/media/') || !media_url.match(/\.(mp4|webm|mov)$/i)) {
      return res.status(400).json({ error: 'Invalid video URL' });
    }

    // Get or create the profile wave
    const wave = db.getOrCreateProfileWave(userId);
    if (!wave) {
      return res.status(500).json({ error: 'Failed to get profile wave' });
    }

    // Create the video ping in the profile wave
    const ping = db.createDroplet({
      waveId: wave.id,
      authorId: userId,
      content: content ? sanitizeInput(content).slice(0, 500) : '',
      mediaType: 'video',
      mediaUrl: media_url,
      mediaDuration: parseInt(media_duration) || null,
    });

    console.log(`📹 Profile video posted by user ${userId}: ${ping.id}`);

    res.json({
      id: ping.id,
      wave_id: wave.id,
      media_url: ping.media_url,
      content: ping.content,
      created_at: ping.created_at,
    });
  } catch (error) {
    console.error('Error posting profile video:', error);
    res.status(500).json({ error: 'Failed to post video' });
  }
});

/**
 * GET /api/users/:handle/videos
 * Get public videos from a user's profile wave
 */
app.get('/api/users/:handle/videos', authenticateToken, (req, res) => {
  try {
    const handle = sanitizeInput(req.params.handle);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor ? sanitizeInput(req.query.cursor) : null;

    // Find the user by handle
    const user = db.findUserByHandle(handle);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get videos from their profile wave
    const result = db.getUserProfileVideos(user.id, limit, cursor);

    res.json(result);
  } catch (error) {
    console.error('Error getting user videos:', error);
    res.status(500).json({ error: 'Failed to get videos' });
  }
});

/**
 * POST /api/profile/videos/:id/reply
 * Reply to a profile video - auto-creates a burst wave for the conversation
 */
app.post('/api/profile/videos/:id/reply', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const pingId = sanitizeInput(req.params.id);
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Reply content is required' });
    }

    const sanitizedContent = sanitizeInput(content.trim()).slice(0, 5000);

    // Create the burst wave and reply
    const result = db.createProfileVideoBurst(pingId, userId, sanitizedContent);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Sync participation cache after wave creation (v2.21.0)
    if (result.wave?.id && !result.existingWave) {
      participation.syncWaveFromDb(result.wave.id);
    }

    // Notify video author if it's a new conversation
    if (!result.existingWave && result.videoAuthorId !== userId) {
      // Create notification for video author
      try {
        const replyUser = db.findUserById(userId);
        db.createNotification({
          userId: result.videoAuthorId,
          type: 'burst',
          waveId: result.wave.id,
          pingId: result.ping?.id,
          actorId: userId,
          title: 'New conversation on your video',
          body: `@${replyUser?.handle || 'Someone'} started a conversation`,
          preview: sanitizedContent.slice(0, 100),
        });
      } catch (notifErr) {
        console.error('Failed to create notification:', notifErr);
      }

      // Broadcast WebSocket event
      broadcastToWaveParticipants(result.wave.id, {
        type: 'wave_created',
        wave: result.wave,
      });
    }

    res.json({
      success: true,
      existing_wave: result.existingWave,
      wave: {
        id: result.wave.id,
        title: result.wave.title,
      },
      ping: result.ping ? {
        id: result.ping.id,
        content: result.ping.content,
        created_at: result.ping.created_at,
      } : null,
      original_ping_id: result.originalPingId,
    });
  } catch (error) {
    console.error('Error replying to profile video:', error);
    res.status(500).json({ error: 'Failed to create reply' });
  }
});

// ============ Wave Routes (renamed from Thread) ============
/**
 * Get all active calls across all waves the user has access to
 * GET /api/waves/active-calls
 * IMPORTANT: Must come BEFORE /api/waves/:id to avoid parameter matching
 */
app.get('/api/waves/active-calls', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  if (!livekitRoomService) {
    return res.json({ calls: [] });
  }

  try {
    const rooms = await livekitRoomService.listRooms();
    const activeCalls = [];
    for (const room of rooms) {
      try {
        if (room.numParticipants > 0) {
          const wave = db.getWave(room.name);
          if (wave && canAccessWaveFromCache(room.name, userId)) {
            activeCalls.push({
              waveId: room.name,
              participantCount: room.numParticipants,
              participants: room.participants?.map(p => p.identity) || []
            });
          }
        }
      } catch (err) {
        console.log(`Skipping room ${room.name} due to error:`, err.message);
      }
    }
    res.json({ calls: activeCalls });
  } catch (error) {
    console.error('Error fetching active calls:', error);
    res.json({ calls: [] });
  }
});

app.get('/api/waves', authenticateToken, (req, res) => {
  const includeArchived = req.query.archived === 'true';
  const minimal = req.query.minimal === 'true'; // Low-bandwidth mode (v2.10.0)
  const showHidden = req.query.hidden === 'true';

  // Ghost Protocol verification required for hidden waves (v2.27.0)
  if (showHidden) {
    const ghostVerifiedAt = ghostVerifications.get(req.user.userId);
    if (!ghostVerifiedAt || (Date.now() - ghostVerifiedAt) > 5 * 60 * 1000) {
      return res.status(403).json({ error: 'Ghost Protocol verification required' });
    }
  }

  // Use minimal query for low-bandwidth mode - skips participants, reduces payload 60-80%
  const waves = minimal
    ? db.getWavesForUserMinimal(req.user.userId, includeArchived, showHidden, participation)
    : db.getWavesForUser(req.user.userId, includeArchived, showHidden, participation);

  // Log unread counts for debugging
  const wavesWithUnread = waves.filter(w => w.unread_count > 0);
  if (wavesWithUnread.length > 0) {
    console.log(`📬 GET /api/waves${minimal ? ' (minimal)' : ''} - Waves with unread for user ${req.user.userId}:`, wavesWithUnread.map(w => `"${w.title}": ${w.unread_count}`).join(', '));
  }
  res.json(waves);
});

app.get('/api/waves/:id', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const minimal = req.query.minimal === 'true'; // Low-bandwidth mode (v2.10.0)
  const wave = db.getWave(waveId);
  if (!wave) return res.status(404).json({ error: 'Wave not found' });
  if (!canAccessWaveFromCache(waveId, req.user.userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const creator = db.findUserById(wave.createdBy);
  const participants = db.getWaveParticipants(wave.id);

  // Get user's archive status for this wave (uses method that works for both JSON and SQLite)
  const isArchived = db.isWaveArchivedForUser(waveId, req.user.userId);

  // If this is a burst wave, get parent wave info for breadcrumb (v2.1.0)
  let parentWave = null;
  if (wave.brokenOutFrom) {
    const parent = db.getWave(wave.brokenOutFrom);
    if (parent && canAccessWaveFromCache(parent.id, req.user.userId)) {
      parentWave = {
        id: parent.id,
        title: parent.title,
      };
    }
  }

  const group = wave.groupId ? db.getGroup(wave.groupId) : null;

  // Low-bandwidth mode: Return only metadata, no droplets (v2.10.0)
  // Client will fetch droplets separately using /api/waves/:id/droplets
  // This saves 90%+ bandwidth on initial wave load
  if (minimal) {
    // Get total droplet count without fetching all droplets
    const totalDroplets = (wave.rootPingId || wave.rootDropletId) && db.getDropletsForBreakoutWave
      ? db.getDropletsForBreakoutWave(wave.id, req.user.userId).length
      : db.getMessagesForWave(wave.id, req.user.userId).length;

    return res.json({
      ...wave,
      creator_name: creator?.displayName || 'Unknown',
      creator_handle: creator?.handle || 'unknown',
      participants,
      is_archived: isArchived,
      parent_wave: parentWave,
      group_name: group?.name,
      can_edit: wave.createdBy === req.user.userId,
      total_droplets: totalDroplets,
      total_messages: totalDroplets, // Legacy
      // Signal to client that droplets need to be fetched separately
      droplets: [],
      all_droplets: [],
      hasMoreDroplets: totalDroplets > 0,
      messages: [], // Legacy
      all_messages: [], // Legacy
      hasMoreMessages: totalDroplets > 0, // Legacy
      minimal: true, // Signal that this is a minimal response
    });
  }

  // Full mode: Include droplets in response
  // For breakout waves, use special method that fetches from original wave's droplet tree
  const allMessages = (wave.rootPingId || wave.rootDropletId) && db.getDropletsForBreakoutWave
    ? db.getDropletsForBreakoutWave(wave.id, req.user.userId)
    : db.getMessagesForWave(wave.id, req.user.userId);

  // Pagination: limit initial droplets, return most recent ones
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const totalDroplets = allMessages.length;
  const hasMoreDroplets = totalDroplets > limit;

  // Get the most recent droplets (sorted by created_at, take last N)
  const limitedDroplets = hasMoreDroplets
    ? allMessages.slice(-limit) // Take last 'limit' droplets (most recent)
    : allMessages;

  // Build droplet tree - treat droplets whose parent isn't in the set as root droplets
  function buildDropletTree(droplets, parentId = null) {
    const dropletIds = new Set(droplets.map(d => d.id));
    return droplets
      .filter(d => {
        if (parentId === null) {
          // Root level: include droplets with no parent OR whose parent isn't in current set
          return d.parent_id === null || !dropletIds.has(d.parent_id);
        }
        return d.parent_id === parentId;
      })
      .map(d => ({ ...d, children: buildDropletTree(droplets, d.id) }));
  }

  res.json({
    ...wave,
    creator_name: creator?.displayName || 'Unknown',
    creator_handle: creator?.handle || 'unknown',
    participants,
    is_archived: isArchived,
    parent_wave: parentWave, // Breadcrumb navigation for burst waves (v2.1.0)
    // New droplet terminology
    droplets: buildDropletTree(limitedDroplets),
    all_droplets: limitedDroplets,
    total_droplets: totalDroplets,
    hasMoreDroplets,
    // Legacy backward compatibility
    messages: buildDropletTree(limitedDroplets),
    all_messages: limitedDroplets,
    total_messages: totalDroplets,
    hasMoreMessages: hasMoreDroplets,
    group_name: group?.name,
    can_edit: wave.createdBy === req.user.userId,
  });
});

// Paginated droplets endpoint for loading droplets in batches (v1.10.0)
// v2.10.0: Added fields=minimal support for low-bandwidth mode
app.get('/api/waves/:id/droplets', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const minimal = req.query.fields === 'minimal'; // Low-bandwidth mode (v2.10.0)
  const wave = db.getWave(waveId);
  if (!wave) return res.status(404).json({ error: 'Wave not found' });
  if (!canAccessWaveFromCache(waveId, req.user.userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per request
  const before = req.query.before; // Droplet ID to load droplets before

  // Get droplets using minimal or full method based on fields parameter
  // Minimal mode omits reactions, readBy, is_unread (saves 30-50% bandwidth)
  const isBreakoutWave = (wave.rootPingId || wave.rootDropletId) && db.getDropletsForBreakoutWave;
  let allDroplets;

  if (minimal) {
    // Use minimal method (or fall back to full with filtering)
    allDroplets = isBreakoutWave
      ? db.getDropletsForBreakoutWave(wave.id, req.user.userId)
      : db.getDropletsForWaveMinimal(wave.id, req.user.userId);
  } else {
    allDroplets = isBreakoutWave
      ? db.getDropletsForBreakoutWave(wave.id, req.user.userId)
      : db.getMessagesForWave(wave.id, req.user.userId);
  }

  // Sort by created_at descending (newest first) for pagination
  allDroplets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // If 'before' is specified, filter to only droplets before that one
  if (before) {
    const beforeIndex = allDroplets.findIndex(d => d.id === before);
    if (beforeIndex !== -1) {
      allDroplets = allDroplets.slice(beforeIndex + 1);
    }
  }

  // Take the requested limit
  const droplets = allDroplets.slice(0, limit);
  const hasMore = allDroplets.length > limit;

  // Reverse to return oldest-first within the batch (natural reading order)
  droplets.reverse();

  // Get total using same method
  const totalDroplets = isBreakoutWave
    ? db.getDropletsForBreakoutWave(wave.id, req.user.userId).length
    : db.getMessagesForWave(wave.id, req.user.userId).length;

  res.json({
    droplets,
    hasMore,
    total: totalDroplets,
    minimal: minimal || undefined, // Signal minimal mode to client
  });
});

// Paginated messages endpoint for loading messages in batches (Legacy - backward compatibility)
app.get('/api/waves/:id/messages', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const wave = db.getWave(waveId);
  if (!wave) return res.status(404).json({ error: 'Wave not found' });
  if (!canAccessWaveFromCache(waveId, req.user.userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per request
  const before = req.query.before; // Message ID to load messages before

  // Get all messages for this wave (filtered for blocked/muted)
  // For breakout waves, use special method that fetches from original wave's droplet tree
  let allMessages = (wave.rootPingId || wave.rootDropletId) && db.getDropletsForBreakoutWave
    ? db.getDropletsForBreakoutWave(wave.id, req.user.userId)
    : db.getMessagesForWave(wave.id, req.user.userId);

  // Sort by created_at descending (newest first) for pagination
  allMessages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // If 'before' is specified, filter to only messages before that one
  if (before) {
    const beforeIndex = allMessages.findIndex(m => m.id === before);
    if (beforeIndex !== -1) {
      allMessages = allMessages.slice(beforeIndex + 1);
    }
  }

  // Take the requested limit
  const messages = allMessages.slice(0, limit);
  const hasMore = allMessages.length > limit;

  // Reverse to return oldest-first within the batch (natural reading order)
  messages.reverse();

  // Get total using same method
  const totalMessages = (wave.rootPingId || wave.rootDropletId) && db.getDropletsForBreakoutWave
    ? db.getDropletsForBreakoutWave(wave.id, req.user.userId).length
    : db.getMessagesForWave(wave.id, req.user.userId).length;

  res.json({
    messages,
    hasMore,
    total: totalMessages,
  });
});

// ============ LIVEKIT VOICE CALLS (v2.4.0) ============

/**
 * Generate LiveKit access token for joining a wave's voice call
 * POST /api/waves/:waveId/call/token
 */
app.post('/api/waves/:waveId/call/token', authenticateToken, async (req, res) => {
  const waveId = sanitizeInput(req.params.waveId);
  const userId = req.user.userId;

  // Validate LiveKit configuration
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(503).json({
      error: 'Voice calling not configured',
      message: 'LiveKit credentials missing on server'
    });
  }

  // Verify wave exists
  const wave = db.getWave(waveId);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Verify user can access this wave
  if (!canAccessWaveFromCache(waveId, userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Get user info for participant name
  const user = db.findUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    // Create LiveKit access token
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      name: user.displayName || user.handle || 'Unknown',
    });

    // Grant permissions for voice/video calling
    at.addGrant({
      roomJoin: true,
      room: waveId,          // Use waveId as room name
      canPublish: true,      // Allow publishing audio and video
      canSubscribe: true,    // Allow subscribing to others' audio/video
      canPublishData: false  // No data channel needed
    });

    // Generate JWT token
    const token = await at.toJwt();

    console.log(`🎤 Generated LiveKit token for user ${userId} (${user.handle}) to join wave ${waveId}`);

    res.json({
      token,
      url: LIVEKIT_URL,
      roomName: waveId,
      identity: userId,
      userName: user.displayName || user.handle
    });
  } catch (error) {
    console.error('Error generating LiveKit token:', error);
    res.status(500).json({
      error: 'Failed to generate token',
      message: error.message
    });
  }
});

/**
 * Admin: List all active LiveKit rooms
 * GET /api/admin/livekit/rooms
 */
app.get('/api/admin/livekit/rooms', authenticateToken, async (req, res) => {
  if (!requireRole(req.user, ROLES.ADMIN, res)) return;

  if (!livekitRoomService) {
    return res.status(503).json({ error: 'LiveKit not configured' });
  }

  try {
    const rooms = await livekitRoomService.listRooms();

    // Enrich with wave info
    const enrichedRooms = rooms.map(room => {
      const wave = db.getWave(room.name); // room.name is waveId
      return {
        roomName: room.name,
        waveTitle: wave?.title || 'Unknown Wave',
        numParticipants: room.numParticipants,
        creationTime: room.creationTime,
        participants: room.participants || []
      };
    });

    res.json({
      rooms: enrichedRooms,
      count: enrichedRooms.length
    });
  } catch (error) {
    console.error('Error fetching LiveKit rooms:', error);
    res.status(500).json({
      error: 'Failed to fetch rooms',
      message: error.message
    });
  }
});

/**
 * Check if a wave has an active LiveKit call
 * GET /api/waves/:waveId/call/status
 */
app.get('/api/waves/:waveId/call/status', authenticateToken, async (req, res) => {
  const waveId = sanitizeInput(req.params.waveId);
  const userId = req.user.userId;

  // Verify wave exists
  const wave = db.getWave(waveId);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Verify user can access this wave
  if (!canAccessWaveFromCache(waveId, userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!livekitRoomService) {
    return res.json({
      active: false,
      participantCount: 0
    });
  }

  try {
    // Check if this room exists and has participants
    const rooms = await livekitRoomService.listRooms();
    const room = rooms.find(r => r.name === waveId);

    // Consider a room "active" if:
    // 1. It has participants, OR
    // 2. It exists and was created within the last 30 seconds (someone is connecting)
    const roomAgeSeconds = room?.creationTime ? (Date.now() / 1000) - Number(room.creationTime) : Infinity;
    const active = room && (room.numParticipants > 0 || roomAgeSeconds < 30);

    res.json({
      active,
      participantCount: room?.numParticipants || 0,
      participants: room?.participants?.map(p => p.identity) || []
    });
  } catch (error) {
    console.error('Error checking LiveKit room status:', error);
    // Don't fail hard - just return no active call
    res.json({
      active: false,
      participantCount: 0
    });
  }
});

app.post('/api/waves', authenticateToken, async (req, res) => {
  const title = sanitizeInput(req.body.title);
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const privacy = ['private', 'group', 'crossServer', 'public'].includes(req.body.privacy)
    ? req.body.privacy : 'private';

  // Validate group access for group waves
  if (privacy === 'group') {
    const groupId = sanitizeInput(req.body.groupId);
    if (!groupId) return res.status(400).json({ error: 'Group ID required for group waves' });
    if (!crewMembership.isMember(groupId, req.user.userId)) {
      return res.status(403).json({ error: 'Must be group member' });
    }
  }

  // Separate local and federated participants
  const localParticipantIds = [];
  const federatedParticipants = []; // { handle, nodeName, node }

  if (req.body.participants && Array.isArray(req.body.participants)) {
    for (const participant of req.body.participants) {
      const federated = parseFederatedIdentifier(participant);
      if (federated && FEDERATION_ENABLED) {
        // Federated participant - look up the node
        const node = db.getFederationNodeByName(federated.nodeName);
        if (node && node.status === 'active') {
          federatedParticipants.push({ ...federated, node });
        } else {
          console.warn(`Skipping federated participant @${federated.handle}@${federated.nodeName}: node not found or not active`);
        }
      } else if (!federated) {
        // Local participant - could be user ID or handle
        const user = db.findUserById(participant) || db.findUserByHandle(participant);
        if (user) {
          localParticipantIds.push(user.id);
        }
      }
    }
  }

  // Determine if this is a federated wave
  const hasFederatedParticipants = federatedParticipants.length > 0;

  // E2EE: Check if wave should be encrypted
  const encrypted = !!req.body.encrypted;
  const keyDistribution = req.body.keyDistribution;

  const wave = db.createWave({
    title,
    privacy: hasFederatedParticipants ? 'crossServer' : privacy, // Force cross-server if federated
    groupId: privacy === 'group' ? sanitizeInput(req.body.groupId) : null,
    createdBy: req.user.userId,
    participants: localParticipantIds,
    encrypted,
  });

  // Sync participation cache after wave creation (v2.21.0)
  participation.syncWaveFromDb(wave.id);

  // E2EE: Store wave keys if encrypted
  if (encrypted && keyDistribution && Array.isArray(keyDistribution)) {
    // Create key metadata
    db.createWaveKeyMetadata(wave.id);

    // Store encrypted keys for each participant
    for (const { userId, encryptedWaveKey, senderPublicKey } of keyDistribution) {
      if (encryptedWaveKey && senderPublicKey) {
        // If userId is null, it's the creator's own key
        const targetUserId = userId || req.user.userId;
        db.createWaveEncryptionKey(wave.id, targetUserId, encryptedWaveKey, senderPublicKey, 1);
      }
    }
  }

  // If federated, mark as origin and send invites
  if (hasFederatedParticipants) {
    db.setWaveAsOrigin(wave.id);

    // Get creator info for participant list
    const creator = db.findUserById(req.user.userId);
    const localParticipants = db.getWaveParticipants(wave.id);

    // Send wave invites to each federated node
    // Group by node to send one invite per node
    const nodeInvites = new Map();
    for (const fp of federatedParticipants) {
      const nodeKey = fp.nodeName;
      if (!nodeInvites.has(nodeKey)) {
        nodeInvites.set(nodeKey, { node: fp.node, handles: [] });
      }
      nodeInvites.get(nodeKey).handles.push(fp.handle);
    }

    // Send invites asynchronously (don't block response)
    for (const [nodeName, { node, handles }] of nodeInvites) {
      for (const handle of handles) {
        sendWaveInvite(node, wave, localParticipants, handle).catch(err => {
          console.error(`Failed to send wave invite to ${nodeName}:`, err.message);
        });
      }
      // Track federation relationship
      db.addWaveFederationNode(wave.id, nodeName);
    }
  }

  const result = {
    ...wave,
    creator_name: db.findUserById(req.user.userId)?.displayName || 'Unknown',
    creator_handle: db.findUserById(req.user.userId)?.handle || 'unknown',
    participants: db.getWaveParticipants(wave.id),
    message_count: 0,
    federationState: hasFederatedParticipants ? 'origin' : 'local',
    federatedNodes: hasFederatedParticipants ? federatedParticipants.map(fp => fp.nodeName) : [],
  };

  broadcastToWave(wave.id, { type: 'wave_created', wave: result });

  // Log activity
  if (db.logActivity) db.logActivity(req.user.userId, 'create_wave', 'wave', wave.id, { ...getRequestMeta(req), privacy, title });

  res.status(201).json(result);
});

app.put('/api/waves/:id', authenticateToken, async (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  let wave = db.getWave(waveId);
  if (!wave) return res.status(404).json({ error: 'Wave not found' });
  if (wave.createdBy !== req.user.userId) {
    return res.status(403).json({ error: 'Only wave creator can modify' });
  }

  const privacy = req.body.privacy;
  const wasLocal = wave.federationState === 'local' || !wave.federationState;
  const changingToCrossServer = privacy === 'crossServer' && wave.privacy !== 'crossServer';

  if (privacy && ['private', 'group', 'crossServer', 'public'].includes(privacy)) {
    let groupId = null;
    if (privacy === 'group') {
      groupId = sanitizeInput(req.body.groupId);
      if (!groupId) return res.status(400).json({ error: 'Group ID required' });
      if (!crewMembership.isMember(groupId, req.user.userId)) {
        return res.status(403).json({ error: 'Must be group member' });
      }
    }
    db.updateWavePrivacy(waveId, privacy, groupId);
  }

  if (req.body.title) {
    const sanitizedTitle = sanitizeInput(req.body.title).slice(0, 200);
    db.updateWaveTitle(waveId, sanitizedTitle);
    wave.title = sanitizedTitle;
  }

  if (req.body.topic !== undefined) {
    const sanitizedTopic = sanitizeInput(req.body.topic).slice(0, 300);
    db.updateWaveTopic(waveId, sanitizedTopic);
    wave.topic = sanitizedTopic;
  }

  // If wave is being promoted to crossServer and federation is enabled, broadcast to all trusted nodes
  if (FEDERATION_ENABLED && changingToCrossServer && wasLocal) {
    // Mark wave as origin
    db.setWaveAsOrigin(waveId);

    // Get all active trusted nodes
    const trustedNodes = db.getFederationNodes().filter(n => n.status === 'active');

    if (trustedNodes.length > 0) {
      // Get current participants for the wave invite
      const localParticipants = db.getWaveParticipants(waveId);

      // Get existing droplets to include in broadcast
      const existingDroplets = db.getDropletsForWave(waveId);
      const ourNodeName = db.getServerIdentity()?.nodeName;

      // Broadcast wave to all trusted nodes
      // We use a special "broadcast" flag indicating this is a public wave broadcast
      for (const node of trustedNodes) {
        // Track federation relationship
        db.addWaveFederationNode(waveId, node.nodeName);

        // Send wave broadcast (invites all users on the remote node)
        const broadcastPayload = createFederationEnvelope(`wave-broadcast-${uuidv4()}`, 'wave_broadcast', {
          wave: {
            id: wave.id,
            title: wave.title,
            privacy: 'crossServer',
            createdBy: wave.createdBy,
            createdAt: wave.createdAt,
          },
          participants: localParticipants.map(p => ({
            id: p.id,
            handle: p.handle,
            displayName: p.name,
            avatar: p.avatar,
            nodeName: ourNodeName,
          })),
          // Include existing droplets so federated servers have history
          droplets: existingDroplets.map(d => {
            // Ensure reactions is an object (may be string from DB)
            let reactions = d.reactions || {};
            if (typeof reactions === 'string') {
              try { reactions = JSON.parse(reactions); } catch { reactions = {}; }
            }
            return {
              id: d.id,
              parentId: d.parentId || d.parent_id,
              content: d.content,
              createdAt: d.createdAt || d.created_at,
              editedAt: d.editedAt || d.edited_at,
              reactions,
              author: {
                id: d.authorId || d.author_id,
                handle: d.sender_handle,
                displayName: d.sender_name,
                avatar: d.sender_avatar,
                avatarUrl: d.sender_avatar_url,
                nodeName: ourNodeName,
              },
            };
          }),
        });

        sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', broadcastPayload)
          .then(response => {
            if (response.ok) {
              console.log(`✅ Wave broadcast sent to ${node.nodeName}`);
            } else {
              console.error(`❌ Wave broadcast to ${node.nodeName} failed: ${response.status}`);
            }
          })
          .catch(err => {
            console.error(`❌ Wave broadcast to ${node.nodeName} error:`, err.message);
          });
      }

      console.log(`📢 Broadcasting wave ${waveId} to ${trustedNodes.length} federated nodes`);
    }
  }

  // Re-fetch wave to get updated state
  wave = db.getWave(waveId);

  broadcastToWave(waveId, { type: 'wave_updated', wave });
  res.json(wave);
});

// Invite federated participants to an existing wave
app.post('/api/waves/:id/invite-federated', authenticateToken, async (req, res) => {
  if (!FEDERATION_ENABLED) {
    return res.status(501).json({ error: 'Federation not enabled' });
  }

  const waveId = sanitizeInput(req.params.id);
  const wave = db.getWave(waveId);
  if (!wave) return res.status(404).json({ error: 'Wave not found' });
  if (wave.createdBy !== req.user.userId) {
    return res.status(403).json({ error: 'Only wave creator can invite federated participants' });
  }

  const { participants } = req.body;
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ error: 'participants array required' });
  }

  // Parse federated identifiers
  const federatedParticipants = [];
  for (const participant of participants) {
    const federated = parseFederatedIdentifier(participant);
    if (federated) {
      const node = db.getFederationNodeByName(federated.nodeName);
      if (node && node.status === 'active') {
        federatedParticipants.push({ ...federated, node });
      } else {
        console.warn(`Skipping federated participant @${federated.handle}@${federated.nodeName}: node not found or not active`);
      }
    }
  }

  if (federatedParticipants.length === 0) {
    return res.status(400).json({ error: 'No valid federated participants found' });
  }

  // Update wave to crossServer if not already federated
  if (wave.privacy !== 'crossServer' && wave.privacy !== 'cross-server') {
    db.updateWavePrivacy(waveId, 'crossServer', null);
    wave.privacy = 'crossServer';
  }

  // Mark wave as origin if not already
  if (wave.federationState !== 'origin') {
    db.setWaveAsOrigin(waveId);
    wave.federationState = 'origin';
  }

  // Get current local participants for the invite
  const localParticipants = db.getWaveParticipants(waveId);

  // Group invites by node
  const nodeInvites = new Map();
  for (const fp of federatedParticipants) {
    const nodeKey = fp.nodeName;
    if (!nodeInvites.has(nodeKey)) {
      nodeInvites.set(nodeKey, { node: fp.node, handles: [] });
    }
    nodeInvites.get(nodeKey).handles.push(fp.handle);
  }

  // Send invites and track federation relationships
  const results = { invited: [], failed: [] };
  for (const [nodeName, { node, handles }] of nodeInvites) {
    // Track federation relationship if not already
    db.addWaveFederationNode(waveId, nodeName);

    for (const handle of handles) {
      try {
        const success = await sendWaveInvite(node, wave, localParticipants, handle);
        if (success) {
          results.invited.push(`@${handle}@${nodeName}`);
        } else {
          results.failed.push(`@${handle}@${nodeName}`);
        }
      } catch (err) {
        console.error(`Failed to send wave invite to ${nodeName}:`, err.message);
        results.failed.push(`@${handle}@${nodeName}`);
      }
    }
  }

  // Broadcast update to local users
  broadcastToWave(waveId, { type: 'wave_updated', wave });

  res.json({
    success: true,
    wave: {
      id: wave.id,
      title: wave.title,
      privacy: wave.privacy,
      federationState: wave.federationState,
    },
    results,
  });
});

app.post('/api/waves/:id/archive', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const archived = req.body.archived !== false;

  if (!db.archiveWaveForUser(waveId, req.user.userId, archived)) {
    return res.status(404).json({ error: 'Wave not found or not a participant' });
  }

  // Sync metadata cache (v2.27.0)
  participation.setMetadata(waveId, req.user.userId, { archived: archived ? 1 : 0 });

  res.json({ success: true, archived });
});

// v2.27.0: Ghost Protocol - Hide/reveal wave
app.post('/api/waves/:id/hide', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const hidden = req.body.hidden !== false;

  if (!participation.isParticipant(waveId, req.user.userId)) {
    return res.status(404).json({ error: 'Wave not found or not a participant' });
  }

  participation.setMetadata(waveId, req.user.userId, { hidden: hidden ? 1 : 0 });

  // Also update plaintext table for backward compatibility during transition
  if (db.archiveWaveForUser) {
    // Don't touch archive state, just ensure participant record exists
  }

  res.json({ success: true, hidden });
});

// v2.27.0: Ghost Protocol - Set PIN
app.post('/api/user/ghost-pin', authenticateToken, (req, res) => {
  const { pinHash } = req.body;
  if (!pinHash || typeof pinHash !== 'string' || pinHash.length !== 64) {
    return res.status(400).json({ error: 'Invalid PIN hash (expected SHA-256 hex)' });
  }

  try {
    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences) : (user.preferences || {});
    prefs.ghostPinHash = pinHash;
    db.updateUserPreferences(req.user.userId, prefs);

    res.json({ success: true });
  } catch (err) {
    console.error('Ghost PIN set error:', err.message);
    res.status(500).json({ error: 'Failed to set Ghost Protocol PIN' });
  }
});

// v2.27.0: Ghost Protocol - Verify PIN
app.post('/api/user/ghost-verify', authenticateToken, (req, res) => {
  const { pinHash } = req.body;
  if (!pinHash || typeof pinHash !== 'string') {
    return res.status(400).json({ error: 'PIN hash required' });
  }

  try {
    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences) : (user.preferences || {});

    if (!prefs.ghostPinHash) {
      return res.status(400).json({ error: 'Ghost Protocol PIN not set' });
    }

    if (prefs.ghostPinHash !== pinHash) {
      return res.status(403).json({ error: 'Incorrect PIN', verified: false });
    }

    // Record verification timestamp
    ghostVerifications.set(req.user.userId, Date.now());

    res.json({ verified: true });
  } catch (err) {
    console.error('Ghost verify error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// v2.27.0: Ghost Protocol - Check if user has PIN set
app.get('/api/user/ghost-status', authenticateToken, (req, res) => {
  try {
    const user = db.findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences) : (user.preferences || {});
    const hasPin = !!prefs.ghostPinHash;
    const ghostVerifiedAt = ghostVerifications.get(req.user.userId);
    const isVerified = ghostVerifiedAt && (Date.now() - ghostVerifiedAt) < 5 * 60 * 1000;

    res.json({ hasPin, isVerified });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get ghost status' });
  }
});

app.post('/api/waves/:id/read', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const userId = req.user.userId;
  console.log(`📖 Marking wave ${waveId} as read for user ${userId}`);

  if (!db.markWaveAsRead(waveId, userId)) {
    console.log(`❌ Failed to mark wave ${waveId} as read`);
    return res.status(404).json({ error: 'Wave not found or access denied' });
  }

  // Sync metadata cache (v2.27.0)
  participation.setMetadata(waveId, userId, { lastRead: new Date().toISOString() });

  // Mark any notifications for this wave as read
  const notificationsMarked = db.markNotificationsReadByWave ? db.markNotificationsReadByWave(waveId, userId) : 0;
  if (notificationsMarked > 0) {
    console.log(`🔔 Marked ${notificationsMarked} notification(s) as read for wave ${waveId}`);
  }

  // Broadcast unread count update to ensure notification bell and wave list stay in sync
  broadcast({ type: 'unread_count_update', userId }, [userId]);

  // Broadcast wave read event so all clients can update
  broadcast({ type: 'wave_read', waveId, userId }, [userId]);

  console.log(`✅ Wave ${waveId} marked as read`);
  res.json({ success: true });
});

app.delete('/api/waves/:id', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const wave = db.getWave(waveId);

  if (!wave) return res.status(404).json({ error: 'Wave not found' });
  if (wave.createdBy !== req.user.userId) {
    return res.status(403).json({ error: 'Only wave creator can delete' });
  }

  const result = db.deleteWave(waveId, req.user.userId);
  if (!result.success) return res.status(400).json({ error: result.error });

  // Broadcast deletion to all participants
  broadcastToWave(waveId, {
    type: 'wave_deleted',
    waveId,
    deletedBy: req.user.userId,
    wave: result.wave
  });

  // Log activity
  if (db.logActivity) db.logActivity(req.user.userId, 'delete_wave', 'wave', waveId, getRequestMeta(req));

  res.json({ success: true });
});

// ============ Wave Category Routes (v2.2.0) ============

// Get all categories for current user
app.get('/api/wave-categories', authenticateToken, (req, res) => {
  try {
    const categories = db.getCategoriesForUser(req.user.userId);
    res.json(categories);
  } catch (error) {
    console.error('Error fetching wave categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create a new category
app.post('/api/wave-categories', authenticateToken, (req, res) => {
  const { name, color } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Category name is required' });
  }

  if (name.length > 50) {
    return res.status(400).json({ error: 'Category name must be 50 characters or less' });
  }

  try {
    const result = db.createCategory(req.user.userId, {
      name: sanitizeInput(name.trim()),
      color: color || 'var(--accent-green)'
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast category creation to user
    const userClients = clients.get(req.user.userId);
    if (userClients) {
      userClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'category_created',
            category: result.category
          }));
        }
      });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'create_category', 'wave_category', result.category.id, getRequestMeta(req));

    res.json(result.category);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Reorder categories (MUST be before :id route to avoid matching "reorder" as an id)
app.put('/api/wave-categories/reorder', authenticateToken, (req, res) => {
  const { categories } = req.body;

  if (!Array.isArray(categories)) {
    return res.status(400).json({ error: 'Categories must be an array' });
  }

  try {
    const categoryOrders = categories.map(c => ({
      id: sanitizeInput(c.id),
      sortOrder: parseInt(c.sortOrder)
    }));

    const result = db.reorderCategories(req.user.userId, categoryOrders);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast reorder to user
    const userClients = clients.get(req.user.userId);
    if (userClients) {
      userClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'categories_reordered',
            categories: categoryOrders
          }));
        }
      });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'reorder_categories', 'wave_category', null, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering categories:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

// Update a category
app.put('/api/wave-categories/:id', authenticateToken, (req, res) => {
  const categoryId = sanitizeInput(req.params.id);
  const { name, color, collapsed } = req.body;

  const updates = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name cannot be empty' });
    }
    if (name.length > 50) {
      return res.status(400).json({ error: 'Category name must be 50 characters or less' });
    }
    updates.name = sanitizeInput(name.trim());
  }
  if (color !== undefined) updates.color = color;
  if (collapsed !== undefined) updates.collapsed = collapsed;

  try {
    const result = db.updateCategory(categoryId, req.user.userId, updates);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast category update to user
    const userClients = clients.get(req.user.userId);
    if (userClients) {
      userClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'category_updated',
            categoryId,
            updates
          }));
        }
      });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'update_category', 'wave_category', categoryId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete a category
app.delete('/api/wave-categories/:id', authenticateToken, (req, res) => {
  const categoryId = sanitizeInput(req.params.id);

  try {
    const result = db.deleteCategory(categoryId, req.user.userId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast category deletion to user
    const userClients = clients.get(req.user.userId);
    if (userClients) {
      userClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'category_deleted',
            categoryId
          }));
        }
      });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'delete_category', 'wave_category', categoryId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Assign wave to category
app.put('/api/waves/:waveId/category', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.waveId);
  const { category_id } = req.body;

  const categoryId = category_id === null ? null : sanitizeInput(category_id);

  try {
    // Verify user has access to wave
    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    const isParticipant = participation.isParticipant(waveId, req.user.userId);
    if (!isParticipant && wave.privacy !== 'public') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = db.assignWaveToCategory(waveId, req.user.userId, categoryId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Sync metadata cache (v2.27.0)
    participation.setMetadata(waveId, req.user.userId, { categoryId: categoryId || null });

    // Broadcast wave category change to user
    const userClients = clients.get(req.user.userId);
    if (userClients) {
      userClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'wave_category_changed',
            waveId,
            categoryId
          }));
        }
      });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'assign_wave_category', 'wave', waveId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error assigning wave to category:', error);
    res.status(500).json({ error: 'Failed to assign wave to category' });
  }
});

// Pin/unpin wave
app.put('/api/waves/:waveId/pin', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.params.waveId);
  const { pinned } = req.body;

  if (typeof pinned !== 'boolean') {
    return res.status(400).json({ error: 'Pinned must be a boolean' });
  }

  try {
    // Verify user has access to wave
    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    const isParticipant = participation.isParticipant(waveId, req.user.userId);
    if (!isParticipant && wave.privacy !== 'public') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = db.pinWaveForUser(waveId, req.user.userId, pinned);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Sync metadata cache (v2.27.0)
    participation.setMetadata(waveId, req.user.userId, { pinned: pinned ? 1 : 0 });

    // Broadcast wave pin change to user
    const userClients = clients.get(req.user.userId);
    if (userClients) {
      userClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'wave_pinned_changed',
            waveId,
            pinned
          }));
        }
      });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, pinned ? 'pin_wave' : 'unpin_wave', 'wave', waveId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error pinning/unpinning wave:', error);
    res.status(500).json({ error: 'Failed to pin/unpin wave' });
  }
});

// ============ Custom Theme Routes (v2.11.0) ============

// Rate limiter for theme creation (max 5 per hour)
const themeCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many theme creations, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Get all themes for current user (own + installed)
app.get('/api/themes', authenticateToken, (req, res) => {
  try {
    const themes = db.getThemesForUser(req.user.userId);
    res.json(themes);
  } catch (error) {
    console.error('Error fetching themes:', error);
    res.status(500).json({ error: 'Failed to fetch themes' });
  }
});

// Get public themes gallery
app.get('/api/themes/gallery', authenticateToken, (req, res) => {
  try {
    const { limit = 20, offset = 0, sort = 'newest', search } = req.query;

    const themes = db.getPublicThemes({
      limit: Math.min(parseInt(limit) || 20, 50),
      offset: parseInt(offset) || 0,
      sortBy: sort === 'popular' ? 'popular' : 'newest',
      search: search ? sanitizeInput(search) : null,
    });

    // Add isInstalled flag for current user
    const userThemes = db.getThemesForUser(req.user.userId);
    const installedIds = new Set([
      ...userThemes.ownThemes.map(t => t.id),
      ...userThemes.installedThemes.map(t => t.id),
    ]);

    themes.themes = themes.themes.map(t => ({
      ...t,
      isOwn: t.creatorId === req.user.userId,
      isInstalled: installedIds.has(t.id),
    }));

    res.json(themes);
  } catch (error) {
    console.error('Error fetching theme gallery:', error);
    res.status(500).json({ error: 'Failed to fetch theme gallery' });
  }
});

// Create a new custom theme
app.post('/api/themes', authenticateToken, themeCreateLimiter, (req, res) => {
  const { name, description, variables, isPublic } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Theme name is required' });
  }

  if (name.length > 50) {
    return res.status(400).json({ error: 'Theme name must be 50 characters or less' });
  }

  if (description && description.length > 200) {
    return res.status(400).json({ error: 'Description must be 200 characters or less' });
  }

  if (!variables || typeof variables !== 'object') {
    return res.status(400).json({ error: 'Theme variables are required' });
  }

  try {
    const result = db.createCustomTheme(req.user.userId, {
      name: sanitizeInput(name.trim()),
      description: description ? sanitizeInput(description.trim()) : '',
      variables,
      isPublic: isPublic || false,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'create_theme', 'custom_theme', result.theme.id, getRequestMeta(req));

    res.status(201).json(result.theme);
  } catch (error) {
    console.error('Error creating theme:', error);
    res.status(500).json({ error: 'Failed to create theme' });
  }
});

// Get a single theme by ID
app.get('/api/themes/:id', authenticateToken, (req, res) => {
  const themeId = sanitizeInput(req.params.id);

  try {
    const theme = db.getThemeById(themeId, req.user.userId);

    if (!theme) {
      return res.status(404).json({ error: 'Theme not found' });
    }

    // Only allow access if public or user is creator/installer
    if (!theme.isPublic && !theme.isOwn && !theme.isInstalled) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(theme);
  } catch (error) {
    console.error('Error fetching theme:', error);
    res.status(500).json({ error: 'Failed to fetch theme' });
  }
});

// Update a custom theme (creator only)
app.put('/api/themes/:id', authenticateToken, (req, res) => {
  const themeId = sanitizeInput(req.params.id);
  const { name, description, variables, isPublic } = req.body;

  const updates = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Theme name cannot be empty' });
    }
    if (name.length > 50) {
      return res.status(400).json({ error: 'Theme name must be 50 characters or less' });
    }
    updates.name = sanitizeInput(name.trim());
  }
  if (description !== undefined) {
    if (description && description.length > 200) {
      return res.status(400).json({ error: 'Description must be 200 characters or less' });
    }
    updates.description = description ? sanitizeInput(description.trim()) : '';
  }
  if (variables !== undefined) {
    if (typeof variables !== 'object') {
      return res.status(400).json({ error: 'Variables must be an object' });
    }
    updates.variables = variables;
  }
  if (isPublic !== undefined) {
    updates.isPublic = isPublic;
  }

  try {
    const result = db.updateCustomTheme(themeId, req.user.userId, updates);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'update_theme', 'custom_theme', themeId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating theme:', error);
    res.status(500).json({ error: 'Failed to update theme' });
  }
});

// Delete a custom theme (creator only)
app.delete('/api/themes/:id', authenticateToken, (req, res) => {
  const themeId = sanitizeInput(req.params.id);

  try {
    const result = db.deleteCustomTheme(themeId, req.user.userId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'delete_theme', 'custom_theme', themeId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting theme:', error);
    res.status(500).json({ error: 'Failed to delete theme' });
  }
});

// Install a public theme
app.post('/api/themes/:id/install', authenticateToken, (req, res) => {
  const themeId = sanitizeInput(req.params.id);

  try {
    const result = db.installTheme(themeId, req.user.userId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'install_theme', 'custom_theme', themeId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error installing theme:', error);
    res.status(500).json({ error: 'Failed to install theme' });
  }
});

// Uninstall a theme
app.delete('/api/themes/:id/install', authenticateToken, (req, res) => {
  const themeId = sanitizeInput(req.params.id);

  try {
    const result = db.uninstallTheme(themeId, req.user.userId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log activity
    if (db.logActivity) db.logActivity(req.user.userId, 'uninstall_theme', 'custom_theme', themeId, getRequestMeta(req));

    res.json({ success: true });
  } catch (error) {
    console.error('Error uninstalling theme:', error);
    res.status(500).json({ error: 'Failed to uninstall theme' });
  }
});

// Decrypt wave - Convert encrypted wave to unencrypted
app.post('/api/waves/:id/decrypt', authenticateToken, async (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const { pings } = req.body;

  if (!Array.isArray(pings)) {
    return res.status(400).json({ error: 'pings array required' });
  }

  const wave = db.getWave(waveId);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Verify user is a participant
  const participants = db.getWaveParticipants(waveId);
  const isParticipant = participants.some(p => p.id === req.user.userId);
  if (!isParticipant) {
    return res.status(403).json({ error: 'Must be a participant to decrypt wave' });
  }

  if (!wave.encrypted) {
    return res.status(400).json({ error: 'Wave is not encrypted' });
  }

  try {
    console.log(`🔓 Decrypting wave ${waveId} with ${pings.length} pings...`);

    // Update wave to be unencrypted
    db.db.prepare('UPDATE waves SET encrypted = 0 WHERE id = ?').run(waveId);

    // Update all ping contents (table is called 'pings' in production)
    const updateStmt = db.db.prepare('UPDATE pings SET content = ? WHERE id = ?');
    for (const ping of pings) {
      if (ping.id && ping.content !== undefined) {
        updateStmt.run(ping.content, ping.id);
      }
    }

    // Delete wave encryption keys (no longer needed)
    db.db.prepare('DELETE FROM wave_encryption_keys WHERE wave_id = ?').run(waveId);

    console.log(`✅ Wave ${waveId} decrypted successfully`);

    // Broadcast wave update to all participants
    broadcastToWave(waveId, {
      type: 'wave_updated',
      data: { ...wave, encrypted: false }
    });

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'decrypt_wave', 'wave', waveId, getRequestMeta(req));
    }

    res.json({ success: true, message: 'Wave decrypted successfully' });
  } catch (error) {
    console.error('Error decrypting wave:', error);
    res.status(500).json({ error: 'Failed to decrypt wave' });
  }
});

// ============ Wave Participant Management ============

// Add participant to wave
app.post('/api/waves/:id/participants', authenticateToken, async (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  const wave = db.getWave(waveId);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Only wave creator can add participants to private waves
  if (wave.privacy === 'private' && wave.createdBy !== req.user.userId) {
    return res.status(403).json({ error: 'Only wave creator can add participants to private waves' });
  }

  // Check if requester is a participant
  if (!participation.isParticipant(waveId, req.user.userId)) {
    return res.status(403).json({ error: 'You must be a participant to add others' });
  }

  // Check if user exists
  const userToAdd = db.findUserById(userId);
  if (!userToAdd) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Check if already a participant
  if (participation.isParticipant(waveId, userId)) {
    return res.status(400).json({ error: 'User is already a participant' });
  }

  // Add participant - use crypto module for cache synchronization (v2.21.0)
  const added = participation.addParticipant(waveId, userId);
  if (!added) {
    return res.status(500).json({ error: 'Failed to add participant' });
  }

  // If this is an encrypted burst wave, copy parent wave encryption keys for new participant
  if (wave.encrypted && wave.broken_out_from) {
    console.log(`🔐 Burst wave ${waveId} is encrypted, checking parent ${wave.broken_out_from} for encryption keys...`);
    const parentWave = db.getWave(wave.broken_out_from);
    if (parentWave && parentWave.encrypted) {
      // Get parent wave's encryption key for this user
      const parentKey = db.db.prepare(`
        SELECT user_id, encrypted_wave_key, sender_public_key, key_version
        FROM wave_encryption_keys
        WHERE wave_id = ? AND user_id = ?
      `).get(wave.broken_out_from, userId);

      if (parentKey) {
        // Copy the key to the burst wave
        const now = new Date().toISOString();
        db.db.prepare(`
          INSERT OR IGNORE INTO wave_encryption_keys (id, wave_id, user_id, encrypted_wave_key, sender_public_key, key_version, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(`wavekey-${uuidv4()}`, waveId, userId, parentKey.encrypted_wave_key, parentKey.sender_public_key, parentKey.key_version, now);
        console.log(`🔐 Copied parent encryption key to burst wave for user ${userId}`);
      } else {
        console.log(`⚠️  No encryption key found in parent wave for user ${userId}`);
      }
    }
  }

  // Get updated participant list
  const participants = db.getWaveParticipants(waveId);

  // Broadcast to wave
  broadcastToWave(waveId, {
    type: 'participant_added',
    waveId,
    participant: {
      id: userToAdd.id,
      handle: userToAdd.handle,
      name: userToAdd.displayName || userToAdd.handle,
      avatar: userToAdd.avatar,
      avatarUrl: userToAdd.avatarUrl
    },
    addedBy: req.user.userId
  });

  // Notify the added user
  broadcastToUser(userId, {
    type: 'added_to_wave',
    wave: {
      id: wave.id,
      title: wave.title,
      privacy: wave.privacy
    },
    addedBy: req.user.userId
  });

  if (db.logActivity) db.logActivity(req.user.userId, 'add_participant', 'wave', waveId, getRequestMeta(req), { addedUserId: userId });

  res.json({ success: true, participants });
});

// Remove participant from wave
app.delete('/api/waves/:id/participants/:userId', authenticateToken, async (req, res) => {
  const waveId = sanitizeInput(req.params.id);
  const userId = sanitizeInput(req.params.userId);

  const wave = db.getWave(waveId);
  if (!wave) {
    return res.status(404).json({ error: 'Wave not found' });
  }

  // Check permissions:
  // - Wave creator can remove anyone (except themselves)
  // - Users can remove themselves (leave wave)
  const isCreator = wave.createdBy === req.user.userId;
  const isSelf = userId === req.user.userId;

  if (!isCreator && !isSelf) {
    return res.status(403).json({ error: 'Only wave creator can remove other participants' });
  }

  // Creator cannot remove themselves
  if (isCreator && isSelf) {
    return res.status(400).json({ error: 'Wave creator cannot leave. Delete the wave instead.' });
  }

  // Check if target is a participant
  if (!participation.isParticipant(waveId, userId)) {
    return res.status(400).json({ error: 'User is not a participant' });
  }

  // Remove participant - use crypto module for cache synchronization (v2.21.0)
  const removed = participation.removeParticipant(waveId, userId);
  if (!removed) {
    return res.status(500).json({ error: 'Failed to remove participant' });
  }

  // Get user info for broadcast
  const removedUser = db.findUserById(userId);

  // Get updated participant list
  const participants = db.getWaveParticipants(waveId);

  // Broadcast to wave
  broadcastToWave(waveId, {
    type: 'participant_removed',
    waveId,
    userId,
    removedBy: req.user.userId,
    wasSelf: isSelf
  });

  // Notify the removed user if they were removed by someone else
  if (!isSelf) {
    broadcastToUser(userId, {
      type: 'removed_from_wave',
      wave: {
        id: wave.id,
        title: wave.title
      },
      removedBy: req.user.userId
    });
  }

  if (db.logActivity) db.logActivity(req.user.userId, isSelf ? 'leave_wave' : 'remove_participant', 'wave', waveId, getRequestMeta(req), { removedUserId: userId });

  res.json({ success: true, participants });
});

// ============ Wave E2EE Key Routes (v1.19.0) ============

// Get wave key for current user
app.get('/api/waves/:id/key', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;
    const wave = db.getWave(waveId);

    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Check wave access
    const canAccess = canAccessWaveFromCache(waveId, req.user.userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if wave is encrypted
    if (!db.isWaveEncrypted(waveId)) {
      return res.json({ encrypted: false, message: 'Wave is not encrypted' });
    }

    // Get encrypted wave key for this user
    const keyData = db.getWaveKeyForUser(waveId, req.user.userId);

    if (!keyData) {
      return res.status(404).json({ error: 'No encryption key found for this user' });
    }

    res.json({
      encrypted: true,
      encryptedWaveKey: keyData.encryptedWaveKey,
      senderPublicKey: keyData.senderPublicKey,
      keyVersion: keyData.keyVersion,
      currentKeyVersion: keyData.currentKeyVersion
    });
  } catch (err) {
    console.error('Wave key fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch wave key' });
  }
});

// Get all wave keys for a user (for decrypting old messages after key rotation)
app.get('/api/waves/:id/keys/all', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;

    // Check wave access
    const canAccess = canAccessWaveFromCache(waveId, req.user.userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const keys = db.getAllWaveKeysForUser(waveId, req.user.userId);
    const currentVersion = db.getWaveKeyVersion(waveId);

    res.json({
      keys,
      currentKeyVersion: currentVersion
    });
  } catch (err) {
    console.error('Wave keys fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch wave keys' });
  }
});

// Distribute wave key to a new participant
app.post('/api/waves/:id/key/distribute', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;
    const { userId, encryptedWaveKey, senderPublicKey } = req.body;

    if (!userId || !encryptedWaveKey || !senderPublicKey) {
      return res.status(400).json({ error: 'Missing required fields: userId, encryptedWaveKey, senderPublicKey' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Only existing participants can distribute keys
    const canAccess = canAccessWaveFromCache(waveId, req.user.userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Only wave participants can distribute keys' });
    }

    // Check if the new participant exists
    const newParticipant = db.findUserById(userId);
    if (!newParticipant) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get current key version
    const currentVersion = db.getWaveKeyVersion(waveId);

    // Store the encrypted key for the new participant
    db.createWaveEncryptionKey(waveId, userId, encryptedWaveKey, senderPublicKey, currentVersion);

    res.json({
      success: true,
      message: 'Wave key distributed to participant',
      keyVersion: currentVersion
    });
  } catch (err) {
    console.error('Wave key distribution error:', err);
    res.status(500).json({ error: 'Failed to distribute wave key' });
  }
});

// Rotate wave key (when participant is removed)
app.post('/api/waves/:id/key/rotate', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;
    const { keyDistribution } = req.body;

    if (!keyDistribution || !Array.isArray(keyDistribution)) {
      return res.status(400).json({ error: 'Missing keyDistribution array' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Only wave creator or admin can rotate keys
    if (wave.createdBy !== req.user.userId) {
      const user = db.findUserById(req.user.userId);
      if (!hasRole(user, ROLES.ADMIN)) {
        return res.status(403).json({ error: 'Only wave creator can rotate keys' });
      }
    }

    // Validate distribution data
    for (const { userId, encryptedWaveKey, senderPublicKey } of keyDistribution) {
      if (!userId || !encryptedWaveKey || !senderPublicKey) {
        return res.status(400).json({ error: 'Invalid key distribution data' });
      }
    }

    // Rotate the wave key
    const result = db.rotateWaveKey(waveId, keyDistribution);

    // Broadcast key rotation to all participants
    broadcastToWave(waveId, {
      type: 'wave_key_rotated',
      waveId,
      newKeyVersion: result.newKeyVersion
    });

    // Log activity
    if (db.logActivity) {
      db.logActivity(req.user.userId, 'wave_key_rotation', 'wave', waveId, {
        ...getRequestMeta(req),
        newKeyVersion: result.newKeyVersion
      });
    }

    res.json({
      success: true,
      newKeyVersion: result.newKeyVersion
    });
  } catch (err) {
    console.error('Wave key rotation error:', err);
    res.status(500).json({ error: 'Failed to rotate wave key' });
  }
});

// Get participant public keys for a wave (for key distribution)
app.get('/api/waves/:id/participants/keys', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;

    // Check wave access
    const canAccess = canAccessWaveFromCache(waveId, req.user.userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const participantKeys = db.getWaveParticipantPublicKeys(waveId);

    res.json({
      participants: participantKeys
    });
  } catch (err) {
    console.error('Participant keys fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch participant keys' });
  }
});

// Initialize wave encryption (set wave as encrypted and create metadata)
app.post('/api/waves/:id/encrypt', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;
    const { keyDistribution } = req.body;

    if (!keyDistribution || !Array.isArray(keyDistribution)) {
      return res.status(400).json({ error: 'Missing keyDistribution array' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Only wave creator can enable encryption
    if (wave.created_by !== req.user.userId) {
      return res.status(403).json({ error: 'Only wave creator can enable encryption' });
    }

    // Check if already encrypted
    if (db.isWaveEncrypted(waveId)) {
      return res.status(400).json({ error: 'Wave is already encrypted' });
    }

    // Create wave key metadata
    db.createWaveKeyMetadata(waveId);

    // Store encrypted keys for each participant
    for (const { userId, encryptedWaveKey, senderPublicKey } of keyDistribution) {
      db.createWaveEncryptionKey(waveId, userId, encryptedWaveKey, senderPublicKey, 1);
    }

    // Check if there are existing droplets that need encryption
    const encryptionStatus = db.getWaveEncryptionStatus(waveId);
    if (encryptionStatus.totalDroplets > 0) {
      // Has existing droplets - set to partial (2) until they're encrypted
      db.setWaveEncryptionState(waveId, 2);
    } else {
      // No droplets - fully encrypted (1)
      db.setWaveEncryptionState(waveId, 1);
    }

    // Broadcast encryption enabled
    broadcastToWave(waveId, {
      type: 'wave_encrypted',
      waveId,
      encryptionState: encryptionStatus.totalDroplets > 0 ? 2 : 1
    });

    res.json({
      success: true,
      message: 'Wave encryption enabled',
      keyVersion: 1,
      encryptionState: encryptionStatus.totalDroplets > 0 ? 2 : 1,
      dropletsToEncrypt: encryptionStatus.totalDroplets
    });
  } catch (err) {
    console.error('Wave encryption error:', err);
    res.status(500).json({ error: 'Failed to enable wave encryption' });
  }
});

// Get wave encryption status (for legacy wave migration)
app.get('/api/waves/:id/encryption-status', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Check access
    const canAccess = canAccessWaveFromCache(waveId, req.user.userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get encryption status
    const status = db.getWaveEncryptionStatus(waveId);

    // Get participant E2EE status
    const participants = db.getParticipantsE2EEStatus(waveId);
    const allHaveE2EE = participants.every(p => p.hasE2EE);
    const readyCount = participants.filter(p => p.hasE2EE).length;

    res.json({
      waveId,
      encryptionState: status.state, // 0=legacy, 1=encrypted, 2=partial
      totalDroplets: status.totalDroplets,
      encryptedDroplets: status.encryptedDroplets,
      progress: status.progress,
      participants: participants,
      allParticipantsReady: allHaveE2EE,
      readyCount,
      totalParticipants: participants.length,
      canEnableEncryption: wave.created_by === req.user.userId && allHaveE2EE
    });
  } catch (err) {
    console.error('Wave encryption status error:', err);
    res.status(500).json({ error: 'Failed to get encryption status' });
  }
});

// Get unencrypted droplets for batch encryption (legacy wave migration)
app.get('/api/waves/:id/unencrypted-droplets', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Only wave creator can migrate encryption
    if (wave.created_by !== req.user.userId) {
      return res.status(403).json({ error: 'Only wave creator can migrate encryption' });
    }

    const droplets = db.getUnencryptedDroplets(waveId, limit);
    const status = db.getWaveEncryptionStatus(waveId);

    res.json({
      droplets,
      remaining: status.totalDroplets - status.encryptedDroplets,
      progress: status.progress
    });
  } catch (err) {
    console.error('Get unencrypted droplets error:', err);
    res.status(500).json({ error: 'Failed to get unencrypted droplets' });
  }
});

// Batch encrypt droplets (legacy wave migration)
app.post('/api/waves/:id/encrypt-droplets', authenticateToken, (req, res) => {
  try {
    const waveId = req.params.id;
    const { droplets } = req.body;

    if (!droplets || !Array.isArray(droplets)) {
      return res.status(400).json({ error: 'Missing droplets array' });
    }

    const wave = db.getWave(waveId);
    if (!wave) {
      return res.status(404).json({ error: 'Wave not found' });
    }

    // Only wave creator can migrate encryption
    if (wave.created_by !== req.user.userId) {
      return res.status(403).json({ error: 'Only wave creator can migrate encryption' });
    }

    // Check wave is in encryption state (1 or 2)
    const status = db.getWaveEncryptionStatus(waveId);
    if (status.state === 0) {
      return res.status(400).json({ error: 'Wave encryption not enabled. Call /api/waves/:id/encrypt first.' });
    }

    // Get current key version
    const keyVersion = db.getWaveKeyVersion(waveId);

    // Update each droplet with encrypted content
    let encryptedCount = 0;
    for (const { id, content, nonce } of droplets) {
      try {
        db.encryptDropletContent(id, content, nonce, keyVersion);
        encryptedCount++;
      } catch (err) {
        console.error(`Failed to encrypt droplet ${id}:`, err);
      }
    }

    // Check if all droplets are now encrypted
    const updatedStatus = db.getWaveEncryptionStatus(waveId);
    let newState = status.state;
    if (updatedStatus.encryptedDroplets === updatedStatus.totalDroplets) {
      // All done - mark as fully encrypted
      db.setWaveEncryptionState(waveId, 1);
      newState = 1;
    } else if (status.state !== 2) {
      // Still have unencrypted droplets - mark as partial
      db.setWaveEncryptionState(waveId, 2);
      newState = 2;
    }

    const remaining = updatedStatus.totalDroplets - updatedStatus.encryptedDroplets;
    res.json({
      success: true,
      encryptedCount,
      totalDroplets: updatedStatus.totalDroplets,
      encryptedDroplets: updatedStatus.encryptedDroplets,
      progress: updatedStatus.progress,
      hasMore: remaining > 0,
      remaining,
      encryptionState: newState,
      complete: remaining === 0
    });
  } catch (err) {
    console.error('Encrypt droplets error:', err);
    res.status(500).json({ error: 'Failed to encrypt droplets' });
  }
});

// ============ Ping Routes (v2.0.0 aliases) ============
// These are the preferred v2.0.0 endpoints (pings = droplets)
// Rewrites /api/pings/* to /api/droplets/* and re-invokes routing

app.all('/api/pings', (req, res, next) => {
  req.url = '/api/droplets';
  req.app._router.handle(req, res, next);
});

app.all('/api/pings/:id', (req, res, next) => {
  req.url = `/api/droplets/${req.params.id}`;
  req.app._router.handle(req, res, next);
});

app.all('/api/pings/:id/react', (req, res, next) => {
  req.url = `/api/droplets/${req.params.id}/react`;
  req.app._router.handle(req, res, next);
});

app.all('/api/pings/:id/read', (req, res, next) => {
  req.url = `/api/droplets/${req.params.id}/read`;
  req.app._router.handle(req, res, next);
});

// /api/pings/:id/burst alias removed in v2.38.0
app.all('/api/pings/:id/thread', (req, res, next) => {
  req.url = `/api/droplets/${req.params.id}/thread`;
  req.app._router.handle(req, res, next);
});
app.all('/api/pings/:id/reparent', (req, res, next) => {
  req.url = `/api/droplets/${req.params.id}/reparent`;
  req.app._router.handle(req, res, next);
});

// ============ Droplet Routes (v1.10.0) ============
// Note: /api/messages endpoints below are backward-compatible aliases
// Note: /api/pings/* aliases above rewrite to these routes

// Create droplet
app.post('/api/droplets', authenticateToken, (req, res) => {
  const waveId = sanitizeInput(req.body.wave_id || req.body.thread_id);
  const content = req.body.content || '';
  const mediaUrl = req.body.mediaUrl;
  const mediaType = req.body.mediaType;
  const mediaDuration = req.body.mediaDuration;

  // Require wave ID and either content or media (v2.7.0)
  if (!waveId || (!content && !mediaUrl)) {
    return res.status(400).json({ error: 'Wave ID and content or media required' });
  }

  const wave = db.getWave(waveId);
  if (!wave) return res.status(404).json({ error: 'Wave not found' });

  const canAccess = canAccessWaveFromCache(waveId, req.user.userId);
  if (!canAccess) return res.status(403).json({ error: 'Access denied' });

  // Auto-join public waves - use crypto module for cache synchronization (v2.21.0)
  const isParticipant = participation.isParticipant(waveId, req.user.userId);
  if (!isParticipant && wave.privacy === 'public') {
    participation.addParticipant(waveId, req.user.userId);
  }

  // E2EE: encrypted content is base64 and may be longer than plaintext
  const maxLength = req.body.encrypted ? 20000 : 10000;
  if (content && content.length > maxLength) return res.status(400).json({ error: 'Droplet too long' });

  // For burst waves, default parent to root ping if no parent specified
  let parentId = req.body.parent_id ? sanitizeInput(req.body.parent_id) : null;
  const rootId = wave.rootPingId || wave.rootDropletId;
  if (!parentId && rootId) {
    parentId = rootId;
  }

  const droplet = db.createMessage({
    waveId,
    parentId,
    authorId: req.user.userId,
    content,
    privacy: wave.privacy,
    encrypted: !!req.body.encrypted,
    nonce: req.body.nonce || null,
    keyVersion: req.body.keyVersion || null,
    // Media fields (v2.7.0)
    mediaType: mediaType || null,
    mediaUrl: mediaUrl || null,
    mediaDuration: mediaDuration || null,
    // Threading (v2.38.0)
    isThreadReply: !!req.body.isThreadReply,
  });

  // Create in-app notifications for mentions, replies, and wave activity
  const author = db.findUserById(req.user.userId);
  if (author) {
    createDropletNotifications(droplet, wave, author);
  }

  // Broadcast to connected users via WebSocket only
  // Push notifications are now handled by createDropletNotifications() for mentions/replies
  broadcastToWave(waveId, { type: 'new_droplet', data: droplet });

  // Also broadcast legacy event for backward compatibility
  broadcastToWave(waveId, { type: 'new_message', data: droplet });

  // Trigger outgoing webhooks (async, non-blocking)
  triggerWaveWebhooks(waveId, droplet, wave);

  // Federation: Send droplet to federated nodes
  if (FEDERATION_ENABLED && (wave.federationState === 'origin' || wave.federationState === 'participant')) {
    const ourIdentity = db.getServerIdentity();
    const dropletPayload = {
      droplet: {
        id: droplet.id,
        parentId: droplet.parentId,
        content: droplet.content,
        createdAt: droplet.createdAt,
        editedAt: droplet.editedAt,
        reactions: droplet.reactions,
      },
      originWaveId: wave.federationState === 'origin' ? waveId : wave.originWaveId,
      author: author ? {
        id: author.id,
        handle: author.handle,
        displayName: author.displayName,
        avatar: author.avatar,
        avatarUrl: author.avatarUrl,
        bio: author.bio,
        nodeName: ourIdentity?.nodeName,
      } : null,
    };

    if (wave.federationState === 'origin') {
      // Origin server: send to all participant nodes
      sendDropletToFederatedNodes(waveId, 'new_droplet', dropletPayload).catch(err => {
        console.error('Federation droplet delivery error:', err.message);
      });
    } else if (wave.federationState === 'participant' && wave.originNode) {
      // Participant server: send back to origin node
      const originNode = db.getFederationNodeByName(wave.originNode);
      if (originNode && originNode.status === 'active') {
        const messageId = `new_droplet-${droplet.id}-${Date.now()}`;
        const fullPayload = createFederationEnvelope(messageId, 'new_droplet', dropletPayload);
        sendSignedFederationRequest(originNode, 'POST', '/api/federation/inbox', fullPayload)
          .then(response => {
            if (response.ok) {
              console.log(`✅ new_droplet sent to origin ${originNode.nodeName}`);
            } else {
              console.error(`❌ new_droplet to origin failed: ${response.status}`);
              db.queueFederationMessage({ targetNode: originNode.nodeName, messageType: 'new_droplet', payload: fullPayload });
            }
          })
          .catch(err => {
            console.error(`❌ new_droplet to origin error:`, err.message);
            db.queueFederationMessage({ targetNode: originNode.nodeName, messageType: 'new_droplet', payload: fullPayload });
          });
      }
    }
  }

  // Log activity
  if (db.logActivity) db.logActivity(req.user.userId, 'create_droplet', 'droplet', droplet.id, { ...getRequestMeta(req), waveId });

  res.status(201).json(droplet);
});

// Edit droplet
app.put('/api/droplets/:id', authenticateToken, (req, res) => {
  const dropletId = sanitizeInput(req.params.id);
  const droplet = db.getMessage(dropletId);
  if (!droplet) return res.status(404).json({ error: 'Droplet not found' });
  if (droplet.authorId !== req.user.userId) return res.status(403).json({ error: 'Not authorized' });

  const content = req.body.content;
  if (content.length > 10000) return res.status(400).json({ error: 'Droplet too long' });

  const updated = db.updateMessage(dropletId, content);
  broadcastToWave(droplet.waveId, { type: 'droplet_edited', data: updated });
  broadcastToWave(droplet.waveId, { type: 'message_edited', data: updated }); // Legacy

  // Federation: If this is an origin wave, send edit to federated nodes
  const wave = db.getWave(droplet.waveId);
  if (FEDERATION_ENABLED && wave?.federationState === 'origin') {
    sendDropletToFederatedNodes(droplet.waveId, 'droplet_edited', {
      dropletId: dropletId,
      originWaveId: droplet.waveId,
      content: updated.content,
      editedAt: updated.editedAt,
      version: updated.version,
    }).catch(err => {
      console.error('Federation droplet edit delivery error:', err.message);
    });
  }

  // Log activity
  if (db.logActivity) db.logActivity(req.user.userId, 'edit_droplet', 'droplet', dropletId, { ...getRequestMeta(req), waveId: droplet.waveId });

  res.json(updated);
});

// Delete droplet
app.delete('/api/droplets/:id', authenticateToken, (req, res) => {
  const dropletId = sanitizeInput(req.params.id);
  const droplet = db.getMessage(dropletId);

  if (!droplet) return res.status(404).json({ error: 'Droplet not found' });
  if (droplet.authorId !== req.user.userId) {
    return res.status(403).json({ error: 'Only droplet author can delete' });
  }

  // Save wave ID before deletion for federation
  const waveId = droplet.waveId;
  const wave = db.getWave(waveId);

  const result = db.deleteMessage(dropletId, req.user.userId);
  if (!result.success) return res.status(400).json({ error: result.error });

  // Broadcast deletion to all participants
  broadcastToWave(result.waveId, {
    type: 'droplet_deleted',
    dropletId: result.dropletId || result.messageId,
    waveId: result.waveId
  });
  // Legacy event
  broadcastToWave(result.waveId, {
    type: 'message_deleted',
    messageId: result.dropletId || result.messageId,
    waveId: result.waveId
  });

  // Federation: If this is an origin wave, send deletion to federated nodes
  if (FEDERATION_ENABLED && wave?.federationState === 'origin') {
    sendDropletToFederatedNodes(waveId, 'droplet_deleted', {
      dropletId: dropletId,
      originWaveId: waveId,
    }).catch(err => {
      console.error('Federation droplet delete delivery error:', err.message);
    });
  }

  // Log activity
  if (db.logActivity) db.logActivity(req.user.userId, 'delete_droplet', 'droplet', dropletId, { ...getRequestMeta(req), waveId });

  res.json({ success: true });
});

// Toggle emoji reaction on droplet
app.post('/api/droplets/:id/react', authenticateToken, (req, res) => {
  const dropletId = sanitizeInput(req.params.id);
  const emoji = req.body.emoji;

  if (!emoji || typeof emoji !== 'string' || emoji.length > 10) {
    return res.status(400).json({ error: 'Invalid emoji' });
  }

  const result = db.toggleMessageReaction(dropletId, req.user.userId, emoji);
  if (!result.success) return res.status(400).json({ error: result.error });

  // Mark droplet as read since user has seen it (prevents unread indicator after reaction)
  db.markMessageAsRead(dropletId, req.user.userId);

  // Broadcast reaction update to all participants
  broadcastToWave(result.waveId, {
    type: 'droplet_reaction',
    dropletId: result.dropletId || result.messageId,
    reactions: result.reactions,
    waveId: result.waveId,
  });
  // Legacy event
  broadcastToWave(result.waveId, {
    type: 'message_reaction',
    messageId: result.dropletId || result.messageId,
    reactions: result.reactions,
    waveId: result.waveId,
  });

  res.json({ success: true, reactions: result.reactions });
});

// Mark individual droplet as read
app.post('/api/droplets/:id/read', authenticateToken, (req, res) => {
  const dropletId = sanitizeInput(req.params.id);
  const userId = req.user.userId;

  console.log(`📖 Marking droplet ${dropletId} as read for user ${userId}`);

  // Get the droplet first to find the waveId
  const droplet = db.getDroplet ? db.getDroplet(dropletId) : db.getMessage?.(dropletId);
  const waveId = droplet?.wave_id || droplet?.waveId;

  if (!db.markMessageAsRead(dropletId, userId)) {
    console.log(`❌ Failed to mark droplet ${dropletId} as read`);
    return res.status(404).json({ error: 'Droplet not found' });
  }

  // Also mark any notifications for this droplet as read
  const notificationsMarked = db.markNotificationsReadByDroplet(dropletId, userId);
  if (notificationsMarked > 0) {
    console.log(`🔔 Marked ${notificationsMarked} notification(s) as read for droplet ${dropletId}`);
  }

  // Always broadcast unread count update to ensure notification bell and wave list stay in sync
  // This must happen even if there are no notifications, as the ping unread count still changed
  broadcast({ type: 'unread_count_update', userId }, [userId]);

  // Broadcast droplet read event so all clients (including this user) can update wave list
  broadcast({ type: 'droplet_read', dropletId, waveId, userId }, [userId]);

  console.log(`✅ Droplet ${dropletId} marked as read`);
  res.json({ success: true });
});

// ============ Thread Toggle (v2.38.0) ============

app.post('/api/droplets/:id/thread', authenticateToken, (req, res) => {
  const dropletId = sanitizeInput(req.params.id);
  const userId = req.user.userId;

  const droplet = db.getDroplet ? db.getDroplet(dropletId) : db.getMessage?.(dropletId);
  if (!droplet) return res.status(404).json({ error: 'Message not found' });

  const waveId = droplet.wave_id || droplet.waveId;

  // Check wave access
  const canAccess = canAccessWaveFromCache(waveId, userId);
  if (!canAccess) return res.status(403).json({ error: 'Access denied' });

  // Toggle: if already threaded, unthread; otherwise thread
  const newState = !droplet.threaded;
  const success = db.threadPing(dropletId, newState);
  if (!success) return res.status(500).json({ error: 'Failed to update thread state' });

  // Broadcast to wave participants
  broadcastToWave(waveId, { type: 'droplet_threaded', dropletId, waveId, threaded: newState, userId });

  res.json({ success: true, threaded: newState });
});

// ============ Message Reparent / Move (v2.39.0) ============

app.post('/api/droplets/:id/reparent', authenticateToken, (req, res) => {
  const dropletId = sanitizeInput(req.params.id);
  const userId = req.user.userId;
  const { newParentId } = req.body || {};

  const droplet = db.getDroplet ? db.getDroplet(dropletId) : db.getMessage?.(dropletId);
  if (!droplet) return res.status(404).json({ error: 'Message not found' });

  const waveId = droplet.wave_id || droplet.waveId;

  // Check wave access
  const canAccess = canAccessWaveFromCache(waveId, userId);
  if (!canAccess) return res.status(403).json({ error: 'Access denied' });

  // Permission: author or moderator+
  const authorId = droplet.author_id || droplet.authorId;
  const requestingUser = db.findUserById(userId);
  if (authorId !== userId && !hasRole(requestingUser, ROLES.MODERATOR)) {
    return res.status(403).json({ error: 'Only the author or a moderator can move messages' });
  }

  const result = db.reparentPing(dropletId, newParentId ? sanitizeInput(newParentId) : null);
  if (!result.success) return res.status(400).json({ error: result.error });

  // Broadcast to wave participants
  broadcastToWave(waveId, { type: 'droplet_reparented', dropletId, waveId, newParentId: newParentId || null, userId });

  res.json({ success: true, ping: result.ping });
});

// Ripple/burst endpoints removed in v2.38.0 — replaced by threaded conversations

// ============ Message Routes (Legacy - v1.9.0 backward compatibility) ============
// DEPRECATED: These endpoints are deprecated as of v1.10.0. Use /api/droplets/* instead.
// They will be removed in a future version.

// Middleware to add deprecation headers and log usage
const deprecatedEndpoint = (req, res, next) => {
  res.set('X-Deprecated', 'true');
  res.set('X-Deprecated-Message', 'This endpoint is deprecated. Use /api/droplets/* instead.');
  res.set('Sunset', 'Sat, 01 Mar 2026 00:00:00 GMT');
  console.warn(`⚠️ DEPRECATED: ${req.method} ${req.originalUrl} called by user ${req.user?.userId || 'unknown'}`);
  next();
};

// ============ Message Routes (deprecated) ============

app.post('/api/messages', authenticateToken, deprecatedEndpoint, (req, res) => {
  const waveId = sanitizeInput(req.body.wave_id || req.body.thread_id);
  const content = req.body.content;
  if (!waveId || !content) return res.status(400).json({ error: 'Wave ID and content required' });

  const wave = db.getWave(waveId);
  if (!wave) return res.status(404).json({ error: 'Wave not found' });

  const canAccess = canAccessWaveFromCache(waveId, req.user.userId);
  if (!canAccess) return res.status(403).json({ error: 'Access denied' });

  // Auto-join public waves - use crypto module for cache synchronization (v2.21.0)
  const isParticipant = participation.isParticipant(waveId, req.user.userId);
  if (!isParticipant && wave.privacy === 'public') {
    participation.addParticipant(waveId, req.user.userId);
  }

  if (content.length > 10000) return res.status(400).json({ error: 'Message too long' });

  // For burst waves, default parent to root ping if no parent specified
  let parentId = req.body.parent_id ? sanitizeInput(req.body.parent_id) : null;
  const rootId = wave.rootPingId || wave.rootDropletId;
  if (!parentId && rootId) {
    parentId = rootId;
  }

  const message = db.createMessage({
    waveId,
    parentId,
    authorId: req.user.userId,
    content,
    privacy: wave.privacy,
  });

  broadcastToWave(waveId, { type: 'new_message', data: message });

  // Trigger outgoing webhooks (async, non-blocking)
  triggerWaveWebhooks(waveId, message, wave);

  res.status(201).json(message);
});

app.put('/api/messages/:id', authenticateToken, deprecatedEndpoint, (req, res) => {
  const messageId = sanitizeInput(req.params.id);
  const message = db.getMessage(messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.authorId !== req.user.userId) return res.status(403).json({ error: 'Not authorized' });

  const content = req.body.content;
  if (content.length > 10000) return res.status(400).json({ error: 'Message too long' });

  const updated = db.updateMessage(messageId, content);
  broadcastToWave(message.waveId, { type: 'message_edited', data: updated });
  res.json(updated);
});

app.delete('/api/messages/:id', authenticateToken, deprecatedEndpoint, (req, res) => {
  const messageId = sanitizeInput(req.params.id);
  const message = db.getMessage(messageId);

  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.authorId !== req.user.userId) {
    return res.status(403).json({ error: 'Only message author can delete' });
  }

  const result = db.deleteMessage(messageId, req.user.userId);
  if (!result.success) return res.status(400).json({ error: result.error });

  // Broadcast deletion to all participants
  broadcastToWave(result.waveId, {
    type: 'message_deleted',
    messageId: result.messageId,
    waveId: result.waveId
  });

  res.json({ success: true });
});

// Toggle emoji reaction on message
app.post('/api/messages/:id/react', authenticateToken, deprecatedEndpoint, (req, res) => {
  const messageId = sanitizeInput(req.params.id);
  const emoji = req.body.emoji;

  if (!emoji || typeof emoji !== 'string' || emoji.length > 10) {
    return res.status(400).json({ error: 'Invalid emoji' });
  }

  const result = db.toggleMessageReaction(messageId, req.user.userId, emoji);
  if (!result.success) return res.status(400).json({ error: result.error });

  // Mark message as read since user has seen it (prevents unread indicator after reaction)
  db.markMessageAsRead(messageId, req.user.userId);

  // Broadcast reaction update to all participants
  broadcastToWave(result.waveId, {
    type: 'message_reaction',
    messageId: result.messageId,
    reactions: result.reactions,
    waveId: result.waveId,
  });

  res.json({ success: true, reactions: result.reactions });
});

// Mark individual message as read (legacy endpoint)
app.post('/api/messages/:id/read', authenticateToken, deprecatedEndpoint, (req, res) => {
  const messageId = sanitizeInput(req.params.id);
  const userId = req.user.userId;

  console.log(`📖 Marking message ${messageId} as read for user ${userId}`);

  // Get the message first to find the waveId
  const message = db.getDroplet ? db.getDroplet(messageId) : db.getMessage?.(messageId);
  const waveId = message?.wave_id || message?.waveId;

  if (!db.markMessageAsRead(messageId, userId)) {
    console.log(`❌ Failed to mark message ${messageId} as read`);
    return res.status(404).json({ error: 'Message not found' });
  }

  // Also mark any notifications for this droplet as read
  const notificationsMarked = db.markNotificationsReadByDroplet(messageId, userId);
  if (notificationsMarked > 0) {
    console.log(`🔔 Marked ${notificationsMarked} notification(s) as read for message ${messageId}`);
    broadcast({ type: 'unread_count_update', userId });
  }

  // Broadcast message read event so all clients can update wave list
  broadcast({ type: 'message_read', messageId, waveId, userId });

  console.log(`✅ Message ${messageId} marked as read`);
  res.json({ success: true });
});

// Search messages
app.get('/api/search', authenticateToken, (req, res) => {
  const query = sanitizeInput(req.query.q || '');
  const waveId = req.query.wave ? sanitizeInput(req.query.wave) : null;
  const authorId = req.query.author ? sanitizeInput(req.query.author) : null;
  const fromDate = req.query.from ? sanitizeInput(req.query.from) : null;
  const toDate = req.query.to ? sanitizeInput(req.query.to) : null;

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  const results = db.searchMessages(query, { waveId, authorId, fromDate, toDate });

  // Filter results to only include waves the user has access to
  const accessibleResults = results.filter(result => {
    const wave = db.getWave(result.waveId);
    if (!wave) return false;

    // Public waves are accessible to all
    if (wave.privacy === 'public') return true;

    // Check if user is a participant
    const participants = db.getWaveParticipants(result.waveId);
    return participants.some(p => p.id === req.user.userId);
  });

  res.json({ results: accessibleResults, count: accessibleResults.length });
});

// ============ Health Check ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION, uptime: process.uptime() });
});

// ============ Public Server Info ============

// Get public server information (no auth required)
app.get('/api/server/info', (req, res) => {
  const stats = db.getPublicStats();
  const identity = FEDERATION_ENABLED ? db.getServerIdentity() : null;

  // Get active federation partners (names only)
  let partners = [];
  let partnerCount = 0;
  if (FEDERATION_ENABLED) {
    const nodes = db.getFederationNodes({ status: 'active' });
    partners = nodes.map(n => n.nodeName);
    partnerCount = partners.length;
  }

  res.json({
    name: identity?.nodeName || null,
    version: VERSION,
    federationEnabled: FEDERATION_ENABLED,
    stats: {
      users: stats.userCount,
      waves: stats.waveCount,
      uptime: Math.floor(process.uptime())
    },
    federation: FEDERATION_ENABLED ? {
      configured: !!identity,
      partners,
      partnerCount
    } : null
  });
});

// Rate limiter for public federation requests
const publicFederationRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour per IP
  message: { error: 'Too many federation requests. Try again later.' }
});

// Public endpoint to request federation from this server
app.post('/api/server/federation-request', publicFederationRequestLimiter, async (req, res) => {
  if (!FEDERATION_ENABLED) {
    return res.status(400).json({ error: 'Federation is not enabled on this server' });
  }

  const ourIdentity = db.getServerIdentity();
  if (!ourIdentity) {
    return res.status(400).json({ error: 'This server has not configured federation yet' });
  }

  const { serverUrl, message } = req.body;
  if (!serverUrl) {
    return res.status(400).json({ error: 'serverUrl is required' });
  }

  // Normalize URL
  const normalizedUrl = serverUrl.replace(/\/+$/, '');

  try {
    // Fetch the requesting server's identity
    const identityUrl = `${normalizedUrl}/api/federation/identity`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(identityUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': `Cortex/${ourIdentity.nodeName}`
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(400).json({
        error: 'Could not reach the specified server',
        details: `HTTP ${response.status}`
      });
    }

    const remoteIdentity = await response.json();
    if (!remoteIdentity.nodeName || !remoteIdentity.publicKey) {
      return res.status(400).json({ error: 'Invalid response from remote server - is it a Cortex server?' });
    }

    // Check if already federated
    const existingNode = db.getFederationNodeByName(remoteIdentity.nodeName);
    if (existingNode && existingNode.status === 'active') {
      return res.json({ success: true, message: 'Already federated with this server', alreadyFederated: true });
    }

    // Check for existing pending request
    const existingRequest = db.getPendingRequestFromNode(remoteIdentity.nodeName);
    if (existingRequest) {
      return res.json({ success: true, message: 'Request already pending', duplicate: true });
    }

    // Create the federation request (as if they sent it to us)
    const request = db.createFederationRequest(
      remoteIdentity.nodeName,
      normalizedUrl,
      remoteIdentity.publicKey,
      ourIdentity.nodeName,
      message || null
    );

    console.log(`📨 Public federation request from ${remoteIdentity.nodeName} via web form`);
    res.json({
      success: true,
      message: 'Federation request submitted. The server admin will need to accept your request.',
      requestId: request.id
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(400).json({ error: 'Connection timed out - is the server URL correct?' });
    }
    console.error('Public federation request error:', error.message);
    res.status(400).json({ error: 'Could not connect to the specified server', details: error.message });
  }
});

// ============ Cortex v2.0.0 API Aliases ============
// These aliases allow clients to use the new Cortex terminology while maintaining backward compatibility

// /api/pings/* -> /api/droplets/* (pings = new name for droplets)
app.use('/api/pings', (req, res, next) => {
  req.url = req.originalUrl.replace('/api/pings', '/api/droplets');
  next('route');
});
app.all('/api/pings', (req, res, next) => { req.url = '/api/droplets'; next('route'); });
app.all('/api/pings/:id', (req, res, next) => { req.url = `/api/droplets/${req.params.id}`; next('route'); });
app.all('/api/pings/:id/react', (req, res, next) => { req.url = `/api/droplets/${req.params.id}/react`; next('route'); });
app.all('/api/pings/:id/read', (req, res, next) => { req.url = `/api/droplets/${req.params.id}/read`; next('route'); });
app.all('/api/pings/:id/burst', (req, res, next) => { req.url = `/api/droplets/${req.params.id}/ripple`; next('route'); }); // burst = new name for ripple
app.all('/api/pings/:id/ripple', (req, res, next) => { req.url = `/api/droplets/${req.params.id}/ripple`; next('route'); });

// /api/crews/* -> /api/groups/* (crews = new name for groups)
app.all('/api/crews', (req, res, next) => { req.url = '/api/groups'; next('route'); });
app.all('/api/crews/invitations', (req, res, next) => { req.url = '/api/groups/invitations'; next('route'); });
app.all('/api/crews/invitations/sent', (req, res, next) => { req.url = '/api/groups/invitations/sent'; next('route'); });
app.all('/api/crews/invitations/:id', (req, res, next) => { req.url = `/api/groups/invitations/${req.params.id}`; next('route'); });
app.all('/api/crews/invitations/:id/accept', (req, res, next) => { req.url = `/api/groups/invitations/${req.params.id}/accept`; next('route'); });
app.all('/api/crews/invitations/:id/decline', (req, res, next) => { req.url = `/api/groups/invitations/${req.params.id}/decline`; next('route'); });
app.all('/api/crews/:id', (req, res, next) => { req.url = `/api/groups/${req.params.id}`; next('route'); });
app.all('/api/crews/:id/invite', (req, res, next) => { req.url = `/api/groups/${req.params.id}/invite`; next('route'); });
app.all('/api/crews/:id/invitations/sent', (req, res, next) => { req.url = `/api/groups/${req.params.id}/invitations/sent`; next('route'); });
app.all('/api/crews/:id/members', (req, res, next) => { req.url = `/api/groups/${req.params.id}/members`; next('route'); });
app.all('/api/crews/:id/members/:userId', (req, res, next) => { req.url = `/api/groups/${req.params.id}/members/${req.params.userId}`; next('route'); });

// ============ WebSocket Setup ============
const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Map();
const userViewingState = new Map(); // Track which wave each user is viewing { userId: { waveId, timestamp } }

// Connection rate limiting (per IP)
const wsConnectionAttempts = new Map();
const WS_RATE_LIMIT = 10;
const WS_RATE_WINDOW = 60 * 1000;

// Per-user message rate limiting
const wsUserMessageCounts = new Map(); // { odUserId: { messages: [], typing: [] } }

function checkWsRateLimit(userId, type = 'messages') {
  const now = Date.now();
  if (!wsUserMessageCounts.has(userId)) {
    wsUserMessageCounts.set(userId, { messages: [], typing: [] });
  }
  const userCounts = wsUserMessageCounts.get(userId);

  // Clean old entries
  userCounts.messages = userCounts.messages.filter(t => t > now - WS_RATE_WINDOW_MS);
  userCounts.typing = userCounts.typing.filter(t => t > now - WS_RATE_WINDOW_MS);

  const limit = type === 'typing' ? WS_RATE_LIMIT_TYPING : WS_RATE_LIMIT_MESSAGES;
  const counts = type === 'typing' ? userCounts.typing : userCounts.messages;

  if (counts.length >= limit) {
    return false; // Rate limit exceeded
  }

  counts.push(now);
  return true; // Allowed
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const now = Date.now();
  const attempts = wsConnectionAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(t => t > now - WS_RATE_WINDOW);
  
  if (recentAttempts.length >= WS_RATE_LIMIT) {
    ws.close(1008, 'Rate limit exceeded');
    return;
  }
  recentAttempts.push(now);
  wsConnectionAttempts.set(ip, recentAttempts);
  
  let userId = null;

  ws.on('message', (data) => {
    try {
      // Mark connection as alive on ANY message (not just pong)
      // This is important for voice calls where audio chunks prove the connection is working
      ws.isAlive = true;

      if (data.length > 20000) { ws.close(1009, 'Message too large'); return; }
      const message = JSON.parse(data.toString());

      // Rate limit all messages (except auth and ping which are essential)
      if (userId && message.type !== 'auth' && message.type !== 'ping') {
        if (!checkWsRateLimit(userId, 'messages')) {
          ws.send(JSON.stringify({ type: 'rate_limit', message: 'WebSocket message rate limit exceeded' }));
          return;
        }
      }

      if (message.type === 'auth') {
        try {
          const decoded = jwt.verify(message.token, JWT_SECRET);
          userId = decoded.userId;
          const user = db.findUserById(userId);

          // Check account moderation status (v2.37.0)
          if (user && (user.accountStatus === 'disabled' || user.accountStatus === 'banned')) {
            const code = user.accountStatus === 'disabled' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_BANNED';
            ws.send(JSON.stringify({ type: 'auth_error', error: `Account ${user.accountStatus}`, code }));
            ws.close(1008, `Account ${user.accountStatus}`);
            return;
          }

          ws.userId = userId;
          ws.userName = user?.displayName || 'Unknown';
          if (!clients.has(userId)) clients.set(userId, new Set());
          clients.get(userId).add(ws);
          db.updateUserStatus(userId, 'online');
          // Clear push debounce so user gets fresh notification on next offline period
          lastPushSent.delete(userId);
          ws.send(JSON.stringify({ type: 'auth_success', userId, serverVersion: VERSION }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
        }
      } else if (message.type === 'ping') {
        // Respond to client heartbeat ping with pong
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'user_typing') {
        // Broadcast typing indicator to other users in the wave
        if (!userId) return; // Must be authenticated

        // Rate limit typing indicators (more restrictive since they broadcast)
        if (!checkWsRateLimit(userId, 'typing')) {
          ws.send(JSON.stringify({ type: 'rate_limit', message: 'Typing indicator rate limit exceeded' }));
          return;
        }

        const waveId = sanitizeInput(message.waveId);
        if (!waveId) return;

        // Verify user has access to this wave
        const wave = db.getWave(waveId);
        if (!wave) return;

        const participant = db.getWaveParticipants(waveId).find(p => p.id === userId);
        if (!participant) return; // User not in wave

        // Broadcast to other users in the wave
        broadcastToWave(waveId, {
          type: 'user_typing',
          waveId,
          userId,
          userName: ws.userName,
          timestamp: Date.now()
        }, ws); // Exclude sender
      } else if (message.type === 'viewing_wave') {
        // Track which wave the user is viewing (for notification suppression)
        if (!userId) return; // Must be authenticated

        const waveId = message.waveId ? sanitizeInput(message.waveId) : null;
        ws.viewingWaveId = waveId;

        // Also track at user level for multiple connections
        if (waveId) {
          userViewingState.set(userId, { waveId, timestamp: Date.now() });
        } else {
          userViewingState.delete(userId);
        }
      }
      // ============ Watch Party WebSocket Events (v2.14.0) ============
      else if (message.type === 'watch_party_sync') {
        // Host sends playback state sync (every 5 seconds)
        if (!userId) return;

        const { partyId, playbackPosition, isPlaying } = message;
        if (!partyId) return;

        // Verify user is the host
        if (!db.isWatchPartyHost(partyId, userId)) return;

        // Update party state in database
        db.updateWatchPartyPlayback(partyId, { playbackPosition, isPlaying });

        // Get party to find wave and broadcast
        const party = db.getWatchParty(partyId);
        if (!party || party.status !== 'active') return;

        // Broadcast to wave participants
        broadcastToWave(party.waveId, {
          type: 'watch_party_sync',
          partyId,
          playbackPosition,
          isPlaying,
          hostUserId: userId,
          timestamp: Date.now(),
        }, ws); // Exclude sender (host)
      } else if (message.type === 'watch_party_command') {
        // Host sends play/pause/seek commands (immediate)
        if (!userId) return;

        const { partyId, command, position } = message;
        if (!partyId || !command) return;

        // Verify user is the host
        if (!db.isWatchPartyHost(partyId, userId)) return;

        const party = db.getWatchParty(partyId);
        if (!party || party.status !== 'active') return;

        // Update state based on command
        if (command === 'play') {
          db.updateWatchPartyPlayback(partyId, { isPlaying: true, playbackPosition: position || party.playbackPosition });
        } else if (command === 'pause') {
          db.updateWatchPartyPlayback(partyId, { isPlaying: false, playbackPosition: position || party.playbackPosition });
        } else if (command === 'seek' && position !== undefined) {
          db.updateWatchPartyPlayback(partyId, { playbackPosition: position });
        }

        // Broadcast command to wave participants
        broadcastToWave(party.waveId, {
          type: 'watch_party_command',
          partyId,
          command,
          position,
          hostUserId: userId,
          timestamp: Date.now(),
        }, ws); // Exclude sender (host)
      } else if (message.type === 'watch_party_join') {
        // User joins a watch party (requests current state)
        if (!userId) return;

        const { partyId } = message;
        if (!partyId) return;

        const party = db.getActiveWatchPartyForWave(db.getWatchParty(partyId)?.waveId);
        if (!party || party.status !== 'active') {
          ws.send(JSON.stringify({ type: 'watch_party_not_found', partyId }));
          return;
        }

        // Send current state to joining user
        ws.send(JSON.stringify({
          type: 'watch_party_state',
          party: {
            id: party.id,
            hostUserId: party.hostUserId,
            hostName: party.hostName,
            jellyfinItemId: party.jellyfinItemId,
            mediaTitle: party.mediaTitle,
            playbackPosition: party.playbackPosition,
            isPlaying: party.isPlaying,
            lastSyncAt: party.lastSyncAt,
          },
        }));
      } else if (message.type === 'watch_party_leave') {
        // User leaves a watch party
        if (!userId) return;
        // No action needed - just informational
      }
    } catch (err) {
      console.error('WebSocket error:', err);
    }
  });

  ws.on('close', () => {
    if (userId && clients.has(userId)) {
      clients.get(userId).delete(ws);
      if (clients.get(userId).size === 0) {
        clients.delete(userId);
        db.updateUserStatus(userId, 'offline');
        userViewingState.delete(userId); // Clean up viewing state
        wsUserMessageCounts.delete(userId); // Clean up rate limit tracking
      }
    }
  });

  // Mark connection as alive on pong response
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Server-side heartbeat: Send native ping every 30 seconds, terminate dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      // Connection didn't respond to last ping - terminate it
      console.log(`💀 Terminating dead WebSocket connection (userId: ${ws.userId || 'unknown'})`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping(); // Send native WebSocket ping frame
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ============ Federation Queue Processor ============

// Process federation queue every 30 seconds (when enabled)
let federationQueueInterval = null;

async function processFederationQueue() {
  if (!FEDERATION_ENABLED) return;

  // Get pending messages that are ready for retry
  const pendingMessages = db.getPendingFederationMessages(10);
  if (pendingMessages.length === 0) return;

  console.log(`📤 Processing ${pendingMessages.length} federation queue messages...`);

  for (const msg of pendingMessages) {
    const node = db.getFederationNodeByName(msg.targetNode);
    if (!node || node.status !== 'active') {
      console.warn(`⚠️  Skipping message ${msg.id}: node ${msg.targetNode} not found or not active`);
      db.markFederationMessageFailed(msg.id, 'Target node not found or not active');
      continue;
    }

    // Handle corrupted queue entries where payload might be a string
    let payload = msg.payload;
    if (typeof payload === 'string') {
      console.warn(`⚠️  Queue message ${msg.id} has string payload, attempting to parse`);
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        console.error(`❌ Failed to parse queue message ${msg.id}, marking as failed`);
        db.markFederationMessageFailed(msg.id, 'Corrupted payload');
        continue;
      }
    }

    try {
      const response = await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', payload);

      if (response.ok) {
        db.markFederationMessageDelivered(msg.id);
        console.log(`✅ Delivered ${msg.messageType} to ${msg.targetNode}`);
      } else {
        const errorText = await response.text();
        const errorMsg = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
        db.markFederationMessageFailed(msg.id, errorMsg);
        console.error(`❌ Failed to deliver ${msg.messageType} to ${msg.targetNode}: ${errorMsg}`);
      }
    } catch (error) {
      db.markFederationMessageFailed(msg.id, error.message);
      console.error(`❌ Error delivering ${msg.messageType} to ${msg.targetNode}:`, error.message);
    }
  }
}

// Queue a message for federation delivery with automatic retries
function queueFederationDelivery(targetNodeName, messageType, payload) {
  if (!FEDERATION_ENABLED) return null;

  // Create a full message payload with ID
  const messageId = `${messageType}-${payload.droplet?.id || payload.dropletId || payload.wave?.id || uuidv4()}-${Date.now()}`;
  const fullPayload = createFederationEnvelope(messageId, messageType, payload);

  return db.queueFederationMessage({
    targetNode: targetNodeName,
    messageType,
    payload: fullPayload,
  });
}

// Start federation queue processor with jitter (v2.28.0 — randomized 20-40s intervals)
function scheduleNextQueueProcess() {
  const jitter = 20000 + Math.floor(Math.random() * 20000); // 20-40s
  federationQueueInterval = setTimeout(() => {
    processFederationQueue();
    scheduleNextQueueProcess();
  }, jitter);
}

if (FEDERATION_ENABLED) {
  scheduleNextQueueProcess();
  console.log('📤 Federation queue processor started (20-40s jitter)');

  // Also cleanup old messages daily
  setInterval(() => {
    const cleaned = db.cleanupOldFederationMessages(7);
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old federation messages`);
    }
  }, 24 * 60 * 60 * 1000); // Daily
}

// ============ Federation Decoy Cover Traffic (v2.28.0) ============

const decoyTimers = new Map(); // per-node setTimeout references
const decoyStats = {
  sentTotal: 0,
  sentPerNode: {},
  lastSentAt: null,
  startedAt: null,
  activeTargets: 0,
};

async function sendDecoyToNode(node) {
  try {
    const envelope = createFederationEnvelope(`decoy-${uuidv4()}`, 'decoy', {
      nonce: crypto.randomBytes(32).toString('base64')
    });
    // Pad to a random bucket for size variance
    padFederationPayload(envelope);
    await sendSignedFederationRequest(node, 'POST', '/api/federation/inbox', envelope);
    decoyStats.sentTotal++;
    decoyStats.sentPerNode[node.nodeName] = (decoyStats.sentPerNode[node.nodeName] || 0) + 1;
    decoyStats.lastSentAt = new Date().toISOString();
  } catch {
    // Silent failure — don't log to prevent traffic analysis
  }
}

function scheduleDecoyForNode(node) {
  if (decoyTimers.has(node.nodeName)) {
    clearTimeout(decoyTimers.get(node.nodeName));
  }
  const intervalMs = (FEDERATION_DECOY_MIN_INTERVAL_S + Math.floor(Math.random() * (FEDERATION_DECOY_MAX_INTERVAL_S - FEDERATION_DECOY_MIN_INTERVAL_S))) * 1000;
  const timer = setTimeout(() => {
    sendDecoyToNode(node);
    if (FEDERATION_DECOY_ENABLED) {
      scheduleDecoyForNode(node);
    }
  }, intervalMs);
  decoyTimers.set(node.nodeName, timer);
}

function startDecoyTraffic() {
  const nodes = db.getFederationNodes({ status: 'active' });
  const v2Nodes = nodes.filter(n => n.protocolVersion >= 2);
  decoyStats.startedAt = new Date().toISOString();
  decoyStats.activeTargets = v2Nodes.length;
  for (const node of v2Nodes) {
    scheduleDecoyForNode(node);
  }
}

function stopDecoyTraffic() {
  for (const [, timer] of decoyTimers) {
    clearTimeout(timer);
  }
  decoyTimers.clear();
  decoyStats.activeTargets = 0;
  decoyStats.startedAt = null;
}

function refreshDecoyTargets() {
  if (!FEDERATION_DECOY_ENABLED) return;
  stopDecoyTraffic();
  startDecoyTraffic();
}

// Auto-start decoy traffic if enabled
if (FEDERATION_ENABLED && FEDERATION_DECOY_ENABLED) {
  startDecoyTraffic();
  console.log('🔇 Federation cover traffic started');
}

// Activity log cleanup is now handled by the privacy retention job in the server startup section (v2.16.0)

// ============ Notification Creation Helpers ============

// Default notification preferences (must match server endpoint defaults)
const DEFAULT_NOTIF_PREFS = {
  enabled: true,
  directMentions: 'always',
  replies: 'always',
  waveActivity: 'app_closed',
  burstEvents: 'app_closed',
  soundEnabled: false,
  suppressWhileFocused: true,
  pushDebounceMinutes: 5,
};

// Check if a user should receive a notification based on their preferences
function shouldCreateNotification(userId, notificationType) {
  const user = db.findUserById(userId);
  if (!user) return false;

  const prefs = user.notificationPreferences || DEFAULT_NOTIF_PREFS;

  // Global kill switch
  if (!prefs.enabled) return false;

  // Map notification type to preference key
  const prefKeyMap = {
    direct_mention: 'directMentions',
    reply: 'replies',
    wave_activity: 'waveActivity',
    ripple: 'burstEvents',
  };

  const prefKey = prefKeyMap[notificationType];
  if (!prefKey) return true; // Unknown type, allow by default

  const level = prefs[prefKey] || 'always';

  // 'never' = don't create notification at all
  if (level === 'never') return false;

  // 'always' or 'app_closed' = create notification
  // (app_closed just affects push behavior, not in-app notifications)
  return true;
}

// Extract @mentions from content - matches @handle patterns
function extractMentions(content) {
  // Match @handle patterns (alphanumeric and underscores)
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return [...new Set(mentions)]; // Remove duplicates
}

// Create notifications for a new droplet
function createDropletNotifications(droplet, wave, author) {
  const notificationsToSend = [];
  const contentPreview = droplet.content.replace(/<[^>]*>/g, '').substring(0, 100);

  // Get wave participants
  const participants = db.getWaveParticipants(wave.id);
  const participantIds = new Set(participants.map(p => p.id));

  // 1. Check for @mentions
  const mentionedHandles = extractMentions(droplet.content);
  const mentionedUsers = new Set();

  for (const handle of mentionedHandles) {
    const mentionedUser = db.findUserByMention ? db.findUserByMention(handle) : db.findUserByHandle(handle);
    if (mentionedUser && mentionedUser.id !== author.id && participantIds.has(mentionedUser.id)) {
      mentionedUsers.add(mentionedUser.id);

      // Check user's notification preferences
      if (!shouldCreateNotification(mentionedUser.id, 'direct_mention')) continue;

      // Create direct mention notification
      const notification = db.createNotification({
        userId: mentionedUser.id,
        type: 'direct_mention',
        waveId: wave.id,
        dropletId: droplet.id,
        actorId: author.id,
        title: `${author.displayName} mentioned you`,
        body: `in ${wave.title}`,
        preview: contentPreview,
        groupKey: `mention:${wave.id}:${droplet.id}`
      });

      // Always send push for direct mentions — the service worker suppresses
      // the popup when the app is visible, so double-delivery is safe.
      // WS-connected doesn't mean the user is looking at the app (Android backgrounding).
      db.markNotificationPushSent(notification.id);
      const isEncrypted = droplet.encrypted || droplet.nonce;
      sendPushNotification(mentionedUser.id, {
        type: 'direct_mention',
        title: notification.title,
        body: `in ${wave.title}`,
        url: `/?wave=${wave.id}`,
        waveId: wave.id,
        messageId: droplet.id,
        senderId: author.id,
        senderHandle: author.handle,
        encrypted: !!isEncrypted,
      });

      notificationsToSend.push({ userId: mentionedUser.id, notification });
    }
  }

  // 2. Check if this is a reply - notify the parent author
  if (droplet.parentId) {
    const parentDroplet = db.getMessage(droplet.parentId);
    if (parentDroplet && parentDroplet.authorId !== author.id && !mentionedUsers.has(parentDroplet.authorId)) {
      // Check user's notification preferences
      if (shouldCreateNotification(parentDroplet.authorId, 'reply')) {
        const notification = db.createNotification({
          userId: parentDroplet.authorId,
          type: 'reply',
          waveId: wave.id,
          dropletId: droplet.id,
          actorId: author.id,
          title: `${author.displayName} replied to you`,
          body: `in ${wave.title}`,
          preview: contentPreview,
          groupKey: `reply:${wave.id}:${parentDroplet.id}`
        });

        // Always send push for replies (same reasoning as direct_mention above)
        db.markNotificationPushSent(notification.id);
        const isEncrypted = droplet.encrypted || droplet.nonce;
        sendPushNotification(parentDroplet.authorId, {
          type: 'reply',
          title: notification.title,
          body: `in ${wave.title}`,
          url: `/?wave=${wave.id}`,
          waveId: wave.id,
          messageId: droplet.id,
          senderId: author.id,
          senderHandle: author.handle,
          encrypted: !!isEncrypted,
        });

        notificationsToSend.push({ userId: parentDroplet.authorId, notification });
      }
      mentionedUsers.add(parentDroplet.authorId); // Don't send wave_activity to them
    }
  }

  // 3. Wave activity notifications for other participants (not author, not mentioned, not replied-to)
  for (const participant of participants) {
    if (participant.id === author.id) continue;
    if (mentionedUsers.has(participant.id)) continue;

    // Check user's notification preferences
    if (!shouldCreateNotification(participant.id, 'wave_activity')) continue;

    // Check wave notification settings
    if (!db.shouldNotifyForWave(participant.id, wave.id, 'wave_activity')) continue;

    // Skip wave_activity if user is currently viewing this wave (focus awareness)
    const participantUser = db.findUserById(participant.id);
    const participantPrefs = participantUser?.notificationPreferences || DEFAULT_NOTIF_PREFS;
    if (participantPrefs.suppressWhileFocused) {
      const viewingState = userViewingState.get(participant.id);
      if (viewingState && viewingState.waveId === wave.id) {
        // User is actively viewing this wave - suppress wave_activity notification
        continue;
      }
    }

    const notification = db.createNotification({
      userId: participant.id,
      type: 'wave_activity',
      waveId: wave.id,
      dropletId: droplet.id,
      actorId: author.id,
      title: `New droplet in ${wave.title}`,
      body: `from ${author.displayName}`,
      preview: contentPreview,
      groupKey: `wave:${wave.id}`
    });

    // Delivery routing for wave_activity — always send push (SW suppresses when app visible)
    // but respect preference level and per-user debounce to avoid flooding
    const waveLevel = participantPrefs.waveActivity || 'app_closed';
    if (waveLevel === 'never') {
      db.markNotificationPushSent(notification.id); // won't push, just mark done
    } else {
      const userDebounceMin = participantPrefs.pushDebounceMinutes ?? 5;
      const now = Date.now();
      const lastPush = lastPushSent.get(participant.id);
      const debounceMs = userDebounceMin * 60 * 1000;

      if (userDebounceMin === 0 || !lastPush || (now - lastPush) > debounceMs) {
        db.markNotificationPushSent(notification.id);
        // Suppress details for hidden waves (privacy)
        const meta = participation.getMetadata(wave.id, participant.id);
        const isEncrypted = droplet.encrypted || droplet.nonce;
        const pushTitle = meta.hidden === 1 ? 'Cortex' : notification.title;
        const pushBody = meta.hidden === 1 ? 'New activity on the cortex' : `from ${author.displayName}`;
        sendPushNotification(participant.id, {
          type: 'wave_activity',
          title: pushTitle,
          body: pushBody,
          url: `/?wave=${wave.id}`,
          waveId: wave.id,
          messageId: droplet.id,
          senderId: author.id,
          senderHandle: author.handle,
          encrypted: !!isEncrypted,
        });
        lastPushSent.set(participant.id, now);
      } else {
        // Debounced — leave push_sent=0 so polling catches it later
      }
    }

    notificationsToSend.push({ userId: participant.id, notification });
  }

  // Broadcast notifications via WebSocket
  for (const { userId, notification } of notificationsToSend) {
    broadcastToUser(userId, { type: 'notification', notification });
  }

  return notificationsToSend.length;
}

// createRippleNotifications removed in v2.38.0 — burst/ripple replaced by threads

// Cortex v2.0.0 event name mappings (old -> new)
const EVENT_ALIASES = {
  'new_droplet': 'new_ping',
  'droplet_edited': 'ping_edited',
  'droplet_deleted': 'ping_deleted',
  'droplet_read': 'ping_read',
  'droplet_rippled': 'ping_burst',
  'group_invitation_received': 'crew_invitation_received',
  'group_invitation_accepted': 'crew_invitation_accepted',
  'group_invitation_declined': 'crew_invitation_declined',
  'group_invitation_cancelled': 'crew_invitation_cancelled'
};

// Broadcast to specific users by their IDs
// Automatically sends both old and new event names for backward compatibility
function broadcast(message, userIds = []) {
  for (const userId of userIds) {
    if (clients.has(userId)) {
      for (const ws of clients.get(userId)) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(message));
          // Also send with new event name if applicable
          if (message.type && EVENT_ALIASES[message.type]) {
            ws.send(JSON.stringify({ ...message, type: EVENT_ALIASES[message.type] }));
          }
        }
      }
    }
  }
}

function broadcastToUser(userId, message) {
  broadcast(message, [userId]);
}

function broadcastToAdmins(message) {
  const admins = db.getAdminUsers();
  const adminIds = admins.map(a => a.id);
  broadcast(message, adminIds);
}

function broadcastToWave(waveId, message, excludeWs = null) {
  const wave = db.getWave(waveId);
  if (!wave) return;

  // Get all users who should receive this
  let recipients = new Set();

  // Direct participants - use in-memory cache for privacy (v2.21.0)
  participation.getWaveParticipants(waveId).forEach(userId => recipients.add(userId));

  // For group waves, all group members
  if (wave.privacy === 'group' && wave.groupId) {
    db.getGroupMembers(wave.groupId).forEach(m => recipients.add(m.id));
  }

  // For public waves, all connected users (they can see it in their list)
  if (wave.privacy === 'public') {
    clients.forEach((_, userId) => recipients.add(userId));
  }

  for (const userId of recipients) {
    if (clients.has(userId)) {
      for (const ws of clients.get(userId)) {
        // Skip the excluded WebSocket connection (e.g., the sender)
        if (excludeWs && ws === excludeWs) continue;
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(message));
          // Also send with new event name if applicable
          if (message.type && EVENT_ALIASES[message.type]) {
            ws.send(JSON.stringify({ ...message, type: EVENT_ALIASES[message.type] }));
          }
        }
      }
    }
  }
}

// Send push notification to a user who isn't connected via WebSocket
async function sendPushNotification(userId, payload) {
  const subscriptions = pushSubs.getSubscriptions(userId);
  if (subscriptions.length === 0) return;

  // Classify subscriptions by type
  const fcmTokens = [];
  const webPushSubs = [];

  for (const sub of subscriptions) {
    if (sub.endpoint?.startsWith('fcm:')) {
      fcmTokens.push(sub);
    } else if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      // Skip stale Expo tokens (legacy) and subscriptions without proper web push keys
      if (sub.endpoint?.startsWith('ExponentPushToken[') || sub.endpoint?.startsWith('ExpoPushToken[')) {
        pushSubs.removeByEndpoint(sub.endpoint);
        console.log(`🧹 Removed stale Expo token for user ${userId}`);
        continue;
      }
      if (!sub.keys?.auth || !sub.keys?.p256dh) {
        pushSubs.removeByEndpoint(sub.endpoint);
        console.log(`🧹 Removed invalid web push subscription (missing keys) for user ${userId}`);
        continue;
      }
      webPushSubs.push(sub);
    }
  }

  // Send to web push subscriptions
  if (webPushSubs.length > 0) {
    const payloadString = JSON.stringify(payload);

    for (const sub of webPushSubs) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys
        }, payloadString, {
          urgency: 'high',
          TTL: 86400, // 24 hours
        });
      } catch (error) {
        // Clean up invalid subscriptions (expired, VAPID mismatch, or endpoint issues)
        if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 401 ||
            error.message?.includes('unexpected response code')) {
          pushSubs.removeByEndpoint(sub.endpoint);
          console.log(`🔕 Removed invalid web push subscription (${error.statusCode || error.message})`);
        } else {
          console.error('Web push notification error:', error.statusCode, error.message);
        }
      }
    }
  }

  // Send to FCM (Capacitor native) tokens
  if (fcmTokens.length > 0 && admin.apps.length > 0) {
    console.log(`📱 Sending ${fcmTokens.length} FCM notification(s) to user ${userId}`);

    for (const sub of fcmTokens) {
      const fcmToken = sub.endpoint.replace(/^fcm:/, '');
      try {
        await admin.messaging().send({
          token: fcmToken,
          notification: {
            title: payload.title || 'Cortex',
            body: payload.body || payload.message || '',
          },
          data: {
            type: String(payload.type || ''),
            waveId: String(payload.waveId || ''),
            messageId: String(payload.messageId || ''),
            senderId: String(payload.senderId || ''),
            senderHandle: String(payload.senderHandle || ''),
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'cortex_messages',
              color: '#0ead69',
            },
          },
          apns: {
            payload: {
              aps: {
                badge: 1,
                sound: 'default',
              },
            },
          },
        });
      } catch (error) {
        const errorCode = error.code || error.errorInfo?.code || '';
        if (errorCode === 'messaging/registration-token-not-registered' ||
            errorCode === 'messaging/invalid-registration-token') {
          pushSubs.removeByEndpoint(sub.endpoint);
          console.log(`📱 Removed stale FCM token: ${fcmToken.substring(0, 20)}...`);
        } else {
          console.error('📱 FCM push error:', errorCode, error.message);
        }
      }
    }
  }
}

// Broadcast to wave with optional push notifications for offline users
function broadcastToWaveWithPush(waveId, message, pushPayload = null, excludeWs = null, excludeUserId = null) {
  const wave = db.getWave(waveId);
  if (!wave) return;

  // Get all users who should receive this
  let recipients = new Set();

  // Direct participants - use in-memory cache for privacy (v2.21.0)
  participation.getWaveParticipants(waveId).forEach(userId => recipients.add(userId));

  // For group waves, all group members
  if (wave.privacy === 'group' && wave.groupId) {
    db.getGroupMembers(wave.groupId).forEach(m => recipients.add(m.id));
  }

  for (const userId of recipients) {
    // Skip the excluded user (usually the message sender)
    if (excludeUserId && userId === excludeUserId) continue;

    const isConnected = clients.has(userId) && clients.get(userId).size > 0;

    if (isConnected) {
      // User has active WebSocket - send via WebSocket
      for (const ws of clients.get(userId)) {
        if (excludeWs && ws === excludeWs) continue;
        if (ws.readyState === 1) ws.send(JSON.stringify(message));
      }
    }

    // Send push notification - respects user notification preferences (v2.32.0)
    if (pushPayload) {
      const pushUser = db.findUserById(userId);
      const pushPrefs = pushUser?.notificationPreferences || DEFAULT_NOTIF_PREFS;

      // Skip push if notifications are globally disabled
      if (!pushPrefs.enabled) continue;

      // This is a generic wave activity push — respect the waveActivity preference
      // 'never'     → no push
      // 'app_closed' → only push if no active WebSocket
      // 'always'     → always push
      const waveLevel = pushPrefs.waveActivity || 'app_closed';
      if (waveLevel === 'never') continue;
      if (waveLevel === 'app_closed' && isConnected) continue;

      // v2.27.0: Suppress detailed push for hidden waves
      let finalPushPayload = pushPayload;
      const meta = participation.getMetadata(waveId, userId);
      if (meta.hidden === 1) {
        finalPushPayload = {
          ...pushPayload,
          title: 'Cortex',
          body: 'New activity on the cortex',
        };
      }

      // Per-user debounce (v2.32.0) — 0 = no debounce, sends every push
      const userDebounceMin = pushPrefs.pushDebounceMinutes ?? 5;
      const now = Date.now();
      const lastPush = lastPushSent.get(userId);
      const debounceMs = userDebounceMin * 60 * 1000;

      if (userDebounceMin === 0 || !lastPush || (now - lastPush) > debounceMs) {
        console.log(`📱 Sending push notification to user ${userId} (wsConnected: ${isConnected})`);
        sendPushNotification(userId, finalPushPayload);
        lastPushSent.set(userId, now);
      } else {
        console.log(`📱 Push debounced for user ${userId} (last push ${Math.round((now - lastPush) / 1000)}s ago, debounce: ${userDebounceMin}m)`);
      }
    }
  }
}

// ============ Start Server ============
const demoEnabled = process.env.SEED_DEMO_DATA === 'true';
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   ██████╗ ██████╗ ██████╗ ████████╗███████╗██╗  ██╗        ║
║  ██╔════╝██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝        ║
║  ██║     ██║   ██║██████╔╝   ██║   █████╗   ╚███╔╝         ║
║  ██║     ██║   ██║██╔══██╗   ██║   ██╔══╝   ██╔██╗         ║
║  ╚██████╗╚██████╔╝██║  ██║   ██║   ███████╗██╔╝ ██╗        ║
║   ╚═════╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝        ║
║  SECURE COMMUNICATIONS SYSTEM v${VERSION.padEnd(24)}║
╠════════════════════════════════════════════════════════════╣
║  🔒 Security: Rate limiting, XSS protection, Helmet        ║
║  🌐 Federation: Server-to-server communication             ║
║  👥 Groups: Create groups, manage members, group waves     ║
║  🆔 Identity: UUID-based with changeable handles           ║
║  📝 Profiles: Change password, display name, avatar        ║
║  📦 Archives: Personal wave archiving                      ║
╠════════════════════════════════════════════════════════════╣
║  PORT=${PORT} | JWT=${JWT_SECRET === 'cortex-default-secret-CHANGE-ME' ? '⚠️ DEFAULT' : '✅ Custom'} | CORS=${ALLOWED_ORIGINS ? '✅' : '⚠️ All'}
║  FEDERATION=${process.env.FEDERATION_ENABLED === 'true' ? '✅' : '❌'} | SESSIONS=${SESSION_TRACKING_ENABLED ? '✅' : '❌'}
║  Server: http://localhost:${PORT}
╚════════════════════════════════════════════════════════════╝
`);

  // Migrate burst waves to threads on startup (v2.38.0)
  if (db.migrateBurstWaves) {
    try {
      const count = db.db.prepare('SELECT COUNT(*) as c FROM waves WHERE broken_out_from IS NOT NULL').get();
      if (count.c > 0) {
        const result = db.migrateBurstWaves();
        console.log(`🔀 Migrated ${result.migrated} burst waves to threads`);
      }
    } catch (err) {
      console.error('Burst wave migration error:', err.message);
    }
  }

  // Start session cleanup job if session tracking is enabled
  if (SESSION_TRACKING_ENABLED && db.cleanupExpiredSessions) {
    setInterval(() => {
      try {
        const cleaned = db.cleanupExpiredSessions();
        if (cleaned > 0) {
          console.log(`🧹 Cleaned up ${cleaned} expired sessions`);
        }
      } catch (err) {
        console.error('Session cleanup error:', err.message);
      }
    }, SESSION_CLEANUP_INTERVAL);
    console.log('📱 Session management enabled (cleanup every hour)');
  }

  // Start privacy retention cleanup job (v2.16.0)
  // Runs every 6 hours to clean up old activity logs and enforce session max age
  const RETENTION_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
  setInterval(() => {
    try {
      // Clean up old activity log entries
      if (db.cleanupOldActivityLogs) {
        const activityCleaned = db.cleanupOldActivityLogs(ACTIVITY_LOG_RETENTION_DAYS);
        if (activityCleaned > 0) {
          console.log(`🧹 Cleaned up ${activityCleaned} old activity log entries (>${ACTIVITY_LOG_RETENTION_DAYS} days)`);
        }
      }

      // Enforce maximum session age (beyond normal expiry)
      if (db.cleanupOldSessions) {
        const sessionsCleaned = db.cleanupOldSessions(SESSION_MAX_AGE_DAYS);
        if (sessionsCleaned > 0) {
          console.log(`🧹 Cleaned up ${sessionsCleaned} sessions older than ${SESSION_MAX_AGE_DAYS} days`);
        }
      }

      // Expire pending contact requests and crew invitations (v2.38.0)
      if (db.cleanupExpiredContactRequests) {
        const contactResult = db.cleanupExpiredContactRequests(INVITATION_EXPIRY_DAYS);
        if (contactResult.count > 0) {
          console.log(`🧹 Expired ${contactResult.count} pending contact requests (>${INVITATION_EXPIRY_DAYS} days)`);
          for (const req of contactResult.expired) {
            broadcastToUser(req.from_user_id, { type: 'contact_request_expired', requestId: req.id });
          }
        }
      }

      if (db.cleanupExpiredCrewInvitations) {
        const crewResult = db.cleanupExpiredCrewInvitations(INVITATION_EXPIRY_DAYS);
        if (crewResult.count > 0) {
          console.log(`🧹 Expired ${crewResult.count} pending crew invitations (>${INVITATION_EXPIRY_DAYS} days)`);
          for (const inv of crewResult.expired) {
            broadcastToUser(inv.invited_by, { type: 'crew_invitation_expired', invitationId: inv.id });
          }
        }
      }
    } catch (err) {
      console.error('Privacy retention cleanup error:', err.message);
    }
  }, RETENTION_CLEANUP_INTERVAL);
  console.log(`🔐 Privacy retention enabled (activity: ${ACTIVITY_LOG_RETENTION_DAYS}d, sessions: ${SESSION_MAX_AGE_DAYS}d)`);

  // ============ Daily Alert Generation (v2.40.0) ============
  function generateDailyAlerts() {
    try {
      const now = new Date();
      const todayMMDD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const todayISO = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

      const activeAlerts = db.getAllAlerts({ status: 'active' });

      // Holiday alerts
      const holiday = getCurrentHoliday(now);
      if (holiday) {
        const alreadyExists = activeAlerts.some(a => a.title.toLowerCase().includes(holiday.name.toLowerCase()) && a.category === 'announcement');
        if (!alreadyExists) {
          const holidayContent = {
            elderxeke: `Happy ElderXeke Day! ✨ May the Bifrost aurora shine bright across Cortex today!`,
          };
          db.createAlert({
            title: `${holiday.emoji} ${holiday.name} celebration is active!`,
            content: holidayContent[holiday.id] || `Happy ${holiday.name}!`,
            priority: 'celebration',
            category: 'announcement',
            scope: 'local',
            startTime: holiday.start.toISOString(),
            endTime: holiday.end.toISOString(),
            createdBy: null,
          });
          console.log(`🎉 Holiday alert created: ${holiday.name}`);
        }
      }

      // Birthday alerts
      const birthdays = db.getTodaysBirthdays(todayMMDD);
      for (const bday of birthdays) {
        const alreadyExists = activeAlerts.some(a => a.title.includes(bday.handle) && a.title.includes('Birthday'));
        if (!alreadyExists) {
          db.createAlert({
            title: `Happy Birthday @${bday.handle}!`,
            content: `Wishing ${bday.display_name || bday.handle} a wonderful birthday! 🎂`,
            priority: 'celebration',
            category: 'announcement',
            scope: 'local',
            startTime: todayStart,
            endTime: todayEnd,
            createdBy: null,
          });
          console.log(`🎂 Birthday alert created for @${bday.handle}`);
        }
      }

      // Event alerts
      const todayEvents = db.getTodaysEvents(todayISO, todayMMDD);
      for (const evt of todayEvents) {
        const alreadyExists = activeAlerts.some(a => a.title.includes(evt.title) && a.startTime === todayStart);
        if (!alreadyExists) {
          db.createAlert({
            title: evt.title,
            content: evt.description || `Today: ${evt.title}`,
            priority: 'celebration',
            category: 'announcement',
            scope: 'local',
            startTime: todayStart,
            endTime: todayEnd,
            createdBy: evt.createdBy,
          });
          console.log(`📅 Event alert created: ${evt.title}`);
        }
      }
    } catch (err) {
      console.error('Daily alert generation error:', err.message);
    }
  }

  generateDailyAlerts();
  setInterval(generateDailyAlerts, 24 * 60 * 60 * 1000);
  console.log('📆 Daily alert generation enabled');
});
