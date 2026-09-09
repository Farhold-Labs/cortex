package com.farhold.cortex;

import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        enableFileDownloads();
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
