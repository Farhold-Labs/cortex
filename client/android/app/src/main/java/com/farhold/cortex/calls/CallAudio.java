package com.farhold.cortex.calls;

import android.app.Activity;
import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

/**
 * A call's sound is a call's, not a video's (v2.148.0).
 *
 * The WebView played calls as media, so the volume buttons set the media
 * volume and a phone with media turned down was silent on a call. While a call
 * lasts the app puts Android in communication mode and points the volume
 * buttons at the call volume, as the phone app does; afterwards both go back
 * to how they were.
 *
 * Communication mode sends sound to the earpiece by default. Cortex calls are
 * held in front of you, not to the ear, so the sound goes to a headset or
 * Bluetooth device when one is connected and to the loudspeaker otherwise, and
 * follows a headset plugged in or out mid-call.
 */
final class CallAudio {
    private static Integer previousMode = null;
    private static AudioDeviceCallback deviceCallback = null;

    private CallAudio() {}

    static void start(Context ctx, Activity activity) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (previousMode == null) previousMode = am.getMode();
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if (activity != null) activity.setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
        route(am);
        if (deviceCallback == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            deviceCallback = new AudioDeviceCallback() {
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { route(am); }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { route(am); }
            };
            am.registerAudioDeviceCallback(deviceCallback, new Handler(Looper.getMainLooper()));
        }
    }

    static void stop(Context ctx, Activity activity) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (deviceCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.unregisterAudioDeviceCallback(deviceCallback);
            deviceCallback = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
        else am.setSpeakerphoneOn(false);
        am.setMode(previousMode != null ? previousMode : AudioManager.MODE_NORMAL);
        previousMode = null;
        if (activity != null) activity.setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE);
    }

    static boolean active() {
        return previousMode != null;
    }

    /** A headset if there is one, else the loudspeaker; never the earpiece. */
    private static void route(AudioManager am) {
        if (previousMode == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo pick = null;
            int best = Integer.MAX_VALUE;
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                int rank = rank(d.getType());
                if (rank < best) { best = rank; pick = d; }
            }
            if (pick != null) am.setCommunicationDevice(pick);
        } else {
            boolean headset = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                    if (rank(d.getType()) < 2) { headset = true; break; }
                }
            }
            am.setSpeakerphoneOn(!headset);
        }
    }

    private static int rank(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
                return 0;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                return 1;
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                return 2;
            default:
                return Integer.MAX_VALUE; // the earpiece and anything else: not chosen
        }
    }
}
