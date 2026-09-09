import { storage } from './storage.js';

// Make attachment links downloadable inside the Android app (v2.81.3).
//
// Two problems stack on Android:
//
//  1. A WebView ignores the HTML `download` attribute and has no download
//     handling of its own, so tapping a PDF did nothing at all — no error, no
//     file. MainActivity now registers a DownloadListener that hands the URL to
//     the system DownloadManager.
//  2. DownloadManager runs outside the app and cannot see the WebView's
//     Authorization header, so an authenticated media URL would come back 401.
//     Cortex's media route accepts `?token=` as well as a header, so the token
//     is appended here, at click time.
//
// The token is added only on the native shell and only at the moment of the
// click, so it is never written into stored message content and never lives
// longer than the click. On the web nothing changes: `download` works there.

export function isNativeApp() {
  return typeof window !== 'undefined'
    && !!window.Capacitor?.isNativePlatform?.();
}

// Only ever add a token to this instance's own media routes.
function needsToken(url) {
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    if (u.searchParams.has('token')) return false;
    return /\/api\/(media|files|attachments)\//.test(u.pathname);
  } catch {
    return false;
  }
}

function withToken(url) {
  const token = storage.getToken();
  if (!token) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set('token', token);
  return u.toString();
}

/**
 * Delegated click handler for attachment links. Mounted once at the app root.
 * A no-op on the web, where the browser already handles `download` correctly.
 */
export function installNativeDownloadHandler() {
  if (typeof document === 'undefined' || !isNativeApp()) return () => {};

  const onClick = (e) => {
    const link = e.target?.closest?.('a[download], a.file-attachment-card, a.file-attachment');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('blob:') || href.startsWith('data:')) return;
    if (!needsToken(href)) return;

    // Navigating with the token lets the WebView's DownloadListener fire with a
    // URL the system DownloadManager can actually fetch.
    e.preventDefault();
    window.location.href = withToken(href);
  };

  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
