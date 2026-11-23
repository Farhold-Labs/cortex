package com.farhold.cortex.calls;

import android.content.Context;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Tells the server a call was declined from the ring (v2.146.0).
 *
 * The app may not be open, so there is no session to use. The ring carried a
 * token that can decline that one call and nothing else; the server checks it.
 * The ring stops at once either way: DECLINE must never leave it ringing.
 */
final class CallDecliner {
    private CallDecliner() {}

    static void decline(Context ctx, String callId, Runnable done) {
        String token = CallRinger.declineToken(ctx, callId);
        String apiBase = CallRinger.prefs(ctx).getString(CallRinger.PREF_API_BASE, null);
        CallRinger.stop(ctx, callId);
        if (token == null || apiBase == null) {
            if (done != null) done.run();
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(apiBase + "/calls/" + URLEncoder.encode(callId, "UTF-8") + "/decline-from-ring");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                byte[] body = ("{\"token\":\"" + token.replaceAll("[^0-9a-f]", "") + "\"}").getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = conn.getOutputStream()) { out.write(body); }
                conn.getResponseCode();
            } catch (Exception e) {
                Log.w("CortexCalls", "decline failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
                if (done != null) done.run();
            }
        }).start();
    }
}
