// The Android app's own ring for direct calls (v2.146.0).
//
// From the v2.146.0 APK the app has a CortexCalls plugin: an incoming call
// rings the phone like a phone call, over the lock screen, even with the app
// closed (CallMessagingService, CallRinger, IncomingCallActivity). This is the
// web layer's side of it:
//
//  - the plugin being there is what lets push registration ask the server for
//    the native ring (`call-ring`); an older APK keeps plain notifications;
//  - ANSWER on the ring opens the app with that call to answer;
//  - while a call lasts the app stays above the lock screen, and stops when
//    it ends.
//
// window.Capacitor is used directly, never `import '@capacitor/core'`, which
// stubs window.Capacitor in a plain browser (see orientation.js).

import { API_URL } from '../config/constants.js';

function plugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.('CortexCalls')) return null;
  return cap.registerPlugin ? cap.registerPlugin('CortexCalls') : cap.Plugins?.CortexCalls || null;
}

/** Can this app ring natively? */
export function canRingNatively() {
  return !!plugin();
}

/**
 * Tell the app where to send DECLINE, then hand every ANSWER, the one that
 * opened the app and any later one, to `onAnswer(callId)`. Returns a cleanup.
 */
export function startNativeCalls(onAnswer) {
  const p = plugin();
  if (!p) return () => {};
  p.configure({ apiBase: API_URL }).catch(() => {});
  let handle = null;
  let live = true;
  Promise.resolve(p.addListener('answer', (data) => { if (data?.callId) onAnswer(data.callId); }))
    .then((h) => { if (live) handle = h; else h?.remove?.(); })
    .catch(() => {});
  p.takePendingAnswer()
    .then((r) => { if (live && r?.callId) onAnswer(r.callId); })
    .catch(() => {});
  return () => { live = false; handle?.remove?.(); };
}

/** The call stopped ringing (seen here first): silence the phone's ring. */
export function stopNativeRing(callId) {
  if (callId) plugin()?.stopRing({ callId }).catch(() => {});
}

/** Keep the app above the lock screen while a call lasts. */
export function setCallOverLockScreen(on) {
  plugin()?.setOverLockScreen({ on: !!on }).catch(() => {});
}
