package com.farhold.cortex;

import android.app.Activity;
import android.content.pm.ActivityInfo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web layer turn the screen (v2.113.0).
 *
 * A live broadcast is filmed sideways, but the app stayed portrait whenever
 * the phone's auto-rotate was off, and a WebView cannot lock orientation on
 * its own. The SENSOR variants keep "landscape" following which way up the
 * phone is held, and they apply regardless of the system auto-rotate setting.
 * `unlock` hands control back to the system.
 */
@CapacitorPlugin(name = "CortexOrientation")
public class OrientationPlugin extends Plugin {

    @PluginMethod
    public void lock(PluginCall call) {
        String which = call.getString("orientation", "landscape");
        int value = "portrait".equals(which)
            ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        apply(call, value);
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        apply(call, ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    private void apply(PluginCall call, int value) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(value);
            call.resolve();
        });
    }
}
