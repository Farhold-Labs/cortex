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

// ===== A call in progress (v2.148.0) =====
//
// The v2.148.0 APK makes a call sound and behave like a phone call: the volume
// buttons set the call volume, an ongoing-call notification keeps the
// microphone alive when the app is off screen, and leaving the app shrinks it
// into a floating window showing the call. An older APK answers these with
// "not implemented", which is ignored.

/** A call started, or its camera went on or off. */
export function nativeCallStarted({ name, video }) {
  plugin()?.callStarted?.({ name: name || 'Cortex call', video: !!video })?.catch?.(() => {});
}

/** The call is over: volume, notification and floating window back to normal. */
export function nativeCallEnded() {
  plugin()?.callEnded?.()?.catch?.(() => {});
}

/**
 * HANG UP on the notification (`onHangUp`), and the app going into or out of
 * its floating window (`onPip(active)`). Returns a cleanup.
 */
export function onNativeCallEvents({ onHangUp, onPip }) {
  const p = plugin();
  if (!p) return () => {};
  const handles = [];
  let live = true;
  const keep = (h) => Promise.resolve(h).then((x) => { if (live) handles.push(x); else x?.remove?.(); }).catch(() => {});
  keep(p.addListener('hangUp', () => onHangUp?.()));
  keep(p.addListener('pip', (data) => onPip?.(!!data?.active)));
  return () => { live = false; handles.forEach((h) => h?.remove?.()); };
}
