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
 */
@CapacitorPlugin(name = "CortexCalls")
public class CortexCallsPlugin extends Plugin {
    private static volatile boolean foreground = false;
    private String pendingAnswer = null;

    public static boolean isAppInForeground() { return foreground; }

    @Override
    public void load() {
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
