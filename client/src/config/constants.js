// ============ CONFIGURATION ============
// Version - keep in sync with package.json
export const VERSION = '2.38.2';

// Native app detection (Capacitor / Electron)
const isCapacitor = typeof window !== 'undefined' && window.Capacitor !== undefined;
const isElectron = typeof window !== 'undefined' && window.navigator?.userAgent?.includes('Electron');
export const isNativeApp = isCapacitor || isElectron;

// Resolve server URL: localStorage override > native remote origin > native default > auto-detect
const storedServerUrl = localStorage.getItem('farhold_server_url');
const isLocalOrigin = ['localhost', ''].includes(window.location.hostname) ||
  window.location.protocol === 'capacitor:' || window.location.protocol === 'ionic:';
const resolvedUrl = (() => {
  if (storedServerUrl) return storedServerUrl;
  if (isCapacitor && !isLocalOrigin) {
    // Native app redirected to remote server — use that origin
    return window.location.origin;
  }
  if (isNativeApp) return 'https://cortex.farhold.com';
  // Web app: auto-detect from current origin (unchanged behavior)
  return window.location.hostname !== 'localhost'
    ? `${window.location.protocol}//${window.location.hostname}`
    : 'http://localhost:3001';
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
  private: { name: 'Private', color: 'var(--accent-orange)', bgColor: 'var(--overlay-orange)', icon: '◉', desc: 'Only invited participants' },
  group: { name: 'Crew', color: 'var(--accent-amber)', bgColor: 'var(--overlay-amber)', icon: '◈', desc: 'All crew members' },
  crossServer: { name: 'Verse-Wide', color: 'var(--accent-teal)', bgColor: 'var(--overlay-teal)', icon: '◇', desc: 'Allied ports in the Verse' },
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

// ============ NOTIFICATION BADGE COLORS ============
export const NOTIFICATION_BADGE_COLORS = {
  direct_mention: { bg: 'var(--accent-amber)', shadow: 'var(--glow-amber)', icon: '@' },  // Amber - someone mentioned you
  reply: { bg: 'var(--accent-green)', shadow: 'var(--glow-green)', icon: '↩' },           // Green - reply to your ping
  burst: { bg: 'var(--accent-purple)', shadow: 'var(--glow-purple)', icon: '◈' },          // Purple - burst activity
  wave_activity: { bg: 'var(--accent-orange)', shadow: 'var(--glow-orange)', icon: null },  // Orange - general activity
};
