package com.farhold.cortex;

import android.app.DownloadManager;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.util.Rational;

import androidx.annotation.RequiresApi;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;

import com.farhold.cortex.calls.CallRinger;
import com.farhold.cortex.calls.CortexCallsPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts (v2.113.0).
        registerPlugin(OrientationPlugin.class);
        registerPlugin(CortexCallsPlugin.class);
        showOverLockScreenForCall(getIntent());
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        enableFileDownloads();
    }

    // ===== A call in progress floats when you leave the app (v2.148.0) =====
    //
    // As the phone app does: press Home or switch apps during a call and
    // Cortex shrinks into a floating window that keeps showing the call. The
    // web layer shows only the call while it floats (the `pip` event).
    private boolean callActive = false;
    private boolean callVideo = false;

    public void setCallActive(boolean active, boolean video) {
        callActive = active;
        callVideo = video;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                setPictureInPictureParams(pipParams());
            } catch (IllegalStateException | IllegalArgumentException e) {
                // No floating windows on this device.
            }
        }
        // The call ended while floating: put the window away, as the phone app does.
        if (!active && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode()) {
            moveTaskToBack(false);
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private PictureInPictureParams pipParams() {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder()
            .setAspectRatio(callVideo ? new Rational(9, 16) : new Rational(1, 1));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: float as the app leaves, without a jump.
            b.setAutoEnterEnabled(callActive).setSeamlessResizeEnabled(true);
        }
        return b.build();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Android 8-11 have no auto-enter: float when the person leaves.
        if (callActive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            try {
                enterPictureInPictureMode(pipParams());
            } catch (IllegalStateException | IllegalArgumentException e) {
                // Floating windows turned off for the app.
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPip, newConfig);
        CortexCallsPlugin.pictureInPictureChanged(inPip);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        showOverLockScreenForCall(intent);
        super.onNewIntent(intent);
    }

    /**
     * ANSWER on a locked phone opens the call over the lock screen, as a phone
     * call does (v2.146.0). The web layer turns this off when the call ends.
     */
    private void showOverLockScreenForCall(Intent intent) {
        if (intent == null || !CallRinger.ACTION_ANSWER.equals(intent.getAction())) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
    }

    /**
     * Let attachments actually download.
     *
     * An Android WebView ignores the HTML `download` attribute and has no
     * download support of its own — tapping a PDF simply did nothing, with no
     * error to explain it. Capacitor does not register a listener for this, so
     * the app has to. Downloads are handed to the system DownloadManager, which
     * puts the file in Downloads and shows the usual progress notification.
     *
     * DownloadManager runs outside the app and so cannot see the WebView's
     * Authorization header. Cortex serves media to `?token=` as well as to a
     * header, and the web layer appends that token to attachment links when it
     * is running natively — so the URL arriving here is already fetchable.
     * Cookies are forwarded too, for anything that relies on them.
     */
    private void enableFileDownloads() {
        if (bridge == null || bridge.getWebView() == null) return;

        bridge.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));

                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(filename);
                request.setDescription("Downloading from Cortex");
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);

                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);

                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);

                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (manager == null) return;
                manager.enqueue(request);

                Toast.makeText(getApplicationContext(), "Downloading " + filename, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                // Never crash the app over a download; say something instead of
                // failing silently, which is the behaviour being fixed here.
                Toast.makeText(getApplicationContext(), "Could not start download", Toast.LENGTH_LONG).show();
            }
        });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "cortex_messages",
                "Cortex Messages",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifications for new messages in Cortex");
            channel.enableLights(true);
            channel.setLightColor(0xFF0EAD69); // Cortex green
            channel.enableVibration(true);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
