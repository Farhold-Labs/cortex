package com.farhold.cortex.calls;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.farhold.cortex.MainActivity;

import java.lang.ref.WeakReference;

/**
 * The web layer's side of the native ring (v2.146.0).
 *
 * Its presence is how the app says it can ring: the web code registers for
 * push with the `call-ring` feature only when this plugin is there, so an
 * older APK keeps getting plain notifications.
 *
 * - configure({ apiBase }): where DECLINE is sent when the app is closed.
 * - takePendingAnswer(): the call ANSWER opened the app for, once.
 *   The `answer` event carries the same when the app was already running.
 * - stopRing({ callId }): the app saw the call stop ringing first.
 * - setOverLockScreen({ on }): keep the call above the lock screen while it
 *   lasts, as a phone call is; off again when it ends.
 *
 * A call in progress (v2.148.0):
 * - callStarted({ name, video }): call volume and routing (CallAudio), the
 *   ongoing-call notification that keeps the microphone alive off screen
 *   (OngoingCallService), and the floating window when the app is left
 *   (MainActivity). Called again when the camera goes on or off.
 * - callEnded(): all three undone.
 * - events: `pip` { active } when the app goes into or out of its floating
 *   window; `hangUp` when HANG UP is pressed on the notification.
 */
@CapacitorPlugin(name = "CortexCalls")
public class CortexCallsPlugin extends Plugin {
    private static volatile boolean foreground = false;
    private static WeakReference<CortexCallsPlugin> instance = new WeakReference<>(null);
    private String pendingAnswer = null;
    private boolean inCall = false;

    public static boolean isAppInForeground() { return foreground; }

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        CallRinger.createChannel(getContext());
        Activity activity = getActivity();
        if (activity != null) takeAnswer(activity.getIntent(), false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        takeAnswer(intent, true);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        foreground = false;
    }

    private void takeAnswer(Intent intent, boolean tell) {
        if (intent == null || !CallRinger.ACTION_ANSWER.equals(intent.getAction())) return;
        String callId = intent.getStringExtra(CallRinger.EXTRA_CALL_ID);
        // Answered once; a later recreation of the activity must not answer again.
        intent.setAction(Intent.ACTION_MAIN);
        if (callId == null) return;
        CallRinger.stop(getContext(), callId);
        pendingAnswer = callId;
        if (tell) {
            JSObject data = new JSObject();
            data.put("callId", callId);
            notifyListeners("answer", data, true);
        }
    }

    /** HANG UP on the ongoing-call notification. False if the app is not there to hear it. */
    public static boolean hangUpFromNotification() {
        CortexCallsPlugin p = instance.get();
        if (p == null || !p.inCall) return false;
        p.notifyListeners("hangUp", new JSObject(), true);
        return true;
    }

    /** The app went into or out of its floating window. */
    public static void pictureInPictureChanged(boolean active) {
        CortexCallsPlugin p = instance.get();
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("active", active);
        p.notifyListeners("pip", data, true);
    }

    @PluginMethod
    public void callStarted(PluginCall call) {
        String name = call.getString("name", "Cortex call");
        boolean video = Boolean.TRUE.equals(call.getBoolean("video", false));
        Activity activity = getActivity();
        Runnable start = () -> {
            inCall = true;
            CallAudio.start(getContext(), activity);
            OngoingCallService.start(getContext(), name, video);
            if (activity instanceof MainActivity) ((MainActivity) activity).setCallActive(true, video);
            call.resolve();
        };
        if (activity != null) activity.runOnUiThread(start); else start.run();
    }

    @PluginMethod
    public void callEnded(PluginCall call) {
        Activity activity = getActivity();
        Runnable end = () -> {
            endCall(activity);
            call.resolve();
        };
        if (activity != null) activity.runOnUiThread(end); else end.run();
    }

    private void endCall(Activity activity) {
        inCall = false;
        CallAudio.stop(getContext(), activity);
        OngoingCallService.stop(getContext());
        if (activity instanceof MainActivity) ((MainActivity) activity).setCallActive(false, false);
    }

    @Override
    protected void handleOnDestroy() {
        // The app is closing: nothing may be left holding the call's audio.
        if (inCall || CallAudio.active()) endCall(getActivity());
        super.handleOnDestroy();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String apiBase = call.getString("apiBase");
        if (apiBase != null && apiBase.startsWith("https://")) {
            CallRinger.prefs(getContext()).edit().putString(CallRinger.PREF_API_BASE, apiBase).apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void takePendingAnswer(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingAnswer != null) result.put("callId", pendingAnswer);
        pendingAnswer = null;
        call.resolve(result);
    }

    @PluginMethod
    public void stopRing(PluginCall call) {
        CallRinger.stop(getContext(), call.getString("callId"));
        call.resolve();
    }

    @PluginMethod
    public void setOverLockScreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                activity.setShowWhenLocked(on);
                activity.setTurnScreenOn(on);
            } else if (on) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            }
            call.resolve();
        });
    }
}
