// ============ CONFIGURATION ============
// Version - keep in sync with package.json
export const VERSION = '2.69.1';

// Native app detection (Capacitor / Electron)
const isCapacitor = typeof window !== 'undefined' && window.Capacitor !== undefined;
const isElectron = typeof window !== 'undefined' && window.navigator?.userAgent?.includes('Electron');
export const isNativeApp = isCapacitor || isElectron;

// Resolve server URL: both Electron and Capacitor load the server URL directly,
// so window.location.origin is authoritative. localStorage override is kept for
// web users who self-host at a non-standard origin.
const storedServerUrl = localStorage.getItem('farhold_server_url');
const isLocalOrigin = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
const resolvedUrl = (() => {
  if (storedServerUrl) return storedServerUrl;
  // Non-localhost origin means we're either running on the server itself (web),
  // or Electron/Capacitor loaded the server URL directly — use it as-is.
  if (!isLocalOrigin) return window.location.origin;
  return 'http://localhost:3001';
})();

export const isProduction = isNativeApp || window.location.hostname !== 'localhost';

// Derive legacy exports from resolved URL
const _resolved = new URL(resolvedUrl);
export const protocol = _resolved.protocol;
export const wsProtocol = _resolved.protocol === 'https:' ? 'wss:' : 'ws:';
export const hostname = _resolved.hostname;
export const port = _resolved.port ? `:${_resolved.port}` : '';

export const BASE_URL = resolvedUrl.replace(/\/+$/, '');
export const API_URL = `${BASE_URL}/api`;
export const WS_URL = `${wsProtocol}//${_resolved.host}${_resolved.protocol === 'https:' ? '/ws' : ''}`;

// ============ PRIVACY LEVELS ============
export const PRIVACY_LEVELS = {
  private: { name: 'Private', color: 'var(--accent-orange)', bgColor: 'var(--overlay-orange)', icon: '●', desc: 'Only invited participants' },
  group: { name: 'Crew', color: 'var(--accent-amber)', bgColor: 'var(--overlay-amber)', icon: '●', desc: 'All crew members' },
  crossServer: { name: 'Verse-Wide', color: 'var(--accent-teal)', bgColor: 'var(--overlay-teal)', icon: '●', desc: 'Allied ports in the Verse' },
  public: { name: 'Public', color: 'var(--accent-green)', bgColor: 'var(--overlay-green)', icon: '○', desc: 'Visible to everyone' },
};

// ============ ROLE-BASED ACCESS (v1.20.0) ============
export const ROLE_HIERARCHY = { admin: 3, moderator: 2, user: 1 };

// Check if user has required role level (admin > moderator > user)
export const canAccess = (user, requiredRole) => {
  if (!user) return false;
  const userRole = user.role || (user.isAdmin ? 'admin' : 'user');
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
};

// ============ THREADING DEPTH LIMIT ============
// Maximum nesting depth before prompting user to Focus or Burst
export const THREAD_DEPTH_LIMIT = 2;

// ============ FONT SIZES ============
export const FONT_SIZES = {
  small: { name: 'Small', multiplier: 0.9 },
  medium: { name: 'Medium', multiplier: 1 },
  large: { name: 'Large', multiplier: 1.15 },
  xlarge: { name: 'X-Large', multiplier: 1.3 },
};

// ============ WAVE LIST DENSITY (v2.61.0) ============
// Row spacing/size for the wave list. `comfy` matches the historical default,
// so existing users see no change until they pick another option.
export const WAVE_DENSITY = {
  compact: { name: 'Compact', padding: '3px 12px', fontSize: '0.8rem' },
  comfy: { name: 'Comfy', padding: '6px 12px', fontSize: '0.85rem' },
  spacious: { name: 'Spacious', padding: '10px 12px', fontSize: '0.95rem' },
};
export const DEFAULT_WAVE_DENSITY = 'comfy';

// ============ MESSAGE FONT (v2.62.0) ============
// Font for ping text + the composer only (not the terminal UI chrome). Each
// stack ends in a generic family so it resolves on every OS with no bundled
// font files (keeps the strict self-only CSP intact). `terminal` is the default
// and matches the historical monospace look, so existing users see no change.
export const MESSAGE_FONTS = {
  terminal: { name: 'Terminal', stack: "'Courier New', Monaco, 'Lucida Console', monospace" },
  sans: { name: 'Sans-Serif', stack: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  serif: { name: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  system: { name: 'System', stack: "system-ui, sans-serif" },
};
export const DEFAULT_MESSAGE_FONT = 'terminal';

// ============ NOTIFICATION BADGE COLORS ============
export const NOTIFICATION_BADGE_COLORS = {
  direct_mention: { bg: 'var(--accent-amber)', shadow: 'var(--glow-amber)', icon: '@' },  // Amber - someone mentioned you
  reply: { bg: 'var(--accent-green)', shadow: 'var(--glow-green)', icon: '↩' },           // Green - reply to your ping
  burst: { bg: 'var(--accent-purple)', shadow: 'var(--glow-purple)', icon: '◈' },          // Purple - burst activity
  wave_activity: { bg: 'var(--accent-orange)', shadow: 'var(--glow-orange)', icon: null },  // Orange - general activity
};
