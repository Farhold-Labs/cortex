// Turning the screen for a broadcast (v2.113.0).
//
// A performance is filmed sideways, but the Android app stayed portrait when
// the phone's auto-rotate was off — and even with it on, a web page cannot
// ask a WebView to turn. Two routes:
//
//  - Inside the Android app: the native CortexOrientation plugin (MainActivity),
//    which sets the activity's orientation directly. Uses the SENSOR variants,
//    so "landscape" still follows which way up the phone is held. Present from
//    the v2.113.0 APK; an older installed app falls through to the web route.
//  - In a browser: the Screen Orientation API. Chrome only allows locking
//    while something is full screen, so the page goes full screen first.
//
// window.Capacitor is used directly rather than importing @capacitor/core:
// that import puts a Capacitor stub on window in ordinary browsers, which
// breaks native-app detection elsewhere (see capacitor-push.js).

function nativeOrientation() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.('CortexOrientation')) return null;
  return cap.registerPlugin ? cap.registerPlugin('CortexOrientation') : cap.Plugins?.CortexOrientation || null;
}

/** Can this device be told to turn? (Shown or hidden the Rotate button.) */
export function canLockOrientation() {
  if (nativeOrientation()) return true;
  return typeof screen !== 'undefined' && typeof screen.orientation?.lock === 'function';
}

/** Turn to 'landscape' or 'portrait'. Resolves true if it took. */
export async function lockOrientation(kind) {
  const native = nativeOrientation();
  if (native) {
    try { await native.lock({ orientation: kind }); return true; } catch { /* fall through */ }
  }
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    await screen.orientation.lock(kind);
    return true;
  } catch {
    return false;
  }
}

/** Back to following the phone (and the system's auto-rotate setting). */
export async function unlockOrientation() {
  const native = nativeOrientation();
  if (native) {
    try { await native.unlock(); } catch { /* nothing to undo */ }
  }
  try { screen.orientation?.unlock?.(); } catch { /* not locked */ }
}
