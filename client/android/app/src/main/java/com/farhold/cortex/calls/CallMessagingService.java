package com.farhold.cortex.calls;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Takes Cortex's push messages in place of the push plugin's own service, and
 * handles the two call signals itself (v2.146.0). Everything else goes on to
 * the plugin unchanged.
 *
 * With the app on screen it doesn't ring: the app's own call screen is up, and
 * two rings would be one too many.
 */
public class CallMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if ("incoming_call".equals(type) && message.getNotification() == null) {
            if (!CortexCallsPlugin.isAppInForeground()) {
                long expiresAt;
                try { expiresAt = Long.parseLong(data.get("expiresAt")); } catch (Exception e) { expiresAt = System.currentTimeMillis() + 45000; }
                CallRinger.ring(this, data.get("callId"), data.get("callerName"), data.get("kind"), data.get("declineToken"), expiresAt);
            }
            return;
        }
        if ("call_ring_stop".equals(type)) {
            CallRinger.stop(this, data.get("callId"));
            return;
        }
        super.onMessageReceived(message);
    }
}
