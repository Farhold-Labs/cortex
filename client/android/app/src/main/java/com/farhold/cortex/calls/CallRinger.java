package com.farhold.cortex.calls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

import com.farhold.cortex.MainActivity;
import com.farhold.cortex.R;

/**
 * Rings for an incoming direct call like a phone does (v2.146.0).
 *
 * The server sends a ringing app a data message instead of a notification, so
 * the app decides how to ring: a call-style notification with ANSWER and
 * DECLINE, the phone's ringtone repeating, and a full-screen call screen
 * (IncomingCallActivity) over the lock screen. A stop message, DECLINE, ANSWER
 * or the ring's own deadline ends it.
 *
 * The notification uses the tag the server's missed-call notice uses, so a
 * missed call replaces the ring rather than sitting beside it.
 */
public final class CallRinger {
    public static final String CHANNEL_ID = "cortex_calls";
    public static final String ACTION_ANSWER = "com.farhold.cortex.ANSWER_CALL";
    public static final String ACTION_DECLINE = "com.farhold.cortex.DECLINE_CALL";
    public static final String ACTION_STOPPED = "com.farhold.cortex.CALL_RING_STOPPED";
    public static final String EXTRA_CALL_ID = "callId";
    public static final String EXTRA_CALLER = "callerName";
    public static final String EXTRA_KIND = "kind";
    public static final String EXTRA_EXPIRES = "expiresAt";

    static final String PREFS = "cortex_calls";
    static final String PREF_API_BASE = "apiBase";
    private static final String PREF_TOKEN_PREFIX = "decline:";
    private static final int NOTIFICATION_ID = 0;

    private CallRinger() {}

    static String tag(String callId) { return "call-" + callId; }

    public static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Incoming calls from your contacts");
        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        channel.setSound(ringtone, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 1000, 1000 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }

    private static int flags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }

    /** Start ringing. Ignored once the ring's deadline has passed. */
    public static void ring(Context ctx, String callId, String callerName, String kind, String declineToken, long expiresAt) {
        long left = expiresAt - System.currentTimeMillis();
        if (callId == null || callId.isEmpty() || left <= 0) return;
        createChannel(ctx);
        prefs(ctx).edit().putString(PREF_TOKEN_PREFIX + callId, declineToken).apply();

        String who = callerName == null || callerName.isEmpty() ? "Someone" : callerName;
        boolean video = "video".equals(kind);

        Intent screen = new Intent(ctx, IncomingCallActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_CALLER, who)
            .putExtra(EXTRA_KIND, kind)
            .putExtra(EXTRA_EXPIRES, expiresAt);
        PendingIntent screenIntent = PendingIntent.getActivity(ctx, callId.hashCode(), screen, flags());

        PendingIntent answer = PendingIntent.getActivity(ctx, callId.hashCode() + 1, answerIntent(ctx, callId), flags());
        Intent decline = new Intent(ctx, CallActionReceiver.class).setAction(ACTION_DECLINE).putExtra(EXTRA_CALL_ID, callId);
        PendingIntent declineIntent = PendingIntent.getBroadcast(ctx, callId.hashCode() + 2, decline, flags());

        Person caller = new Person.Builder().setName(who).setImportant(true).build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(who)
            .setContentText(video ? "Video call" : "Voice call")
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declineIntent, answer).setIsVideo(video))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(screenIntent)
            .setFullScreenIntent(screenIntent, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(left)
            .setColor(0xFF0EAD69)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), android.media.AudioManager.STREAM_RING)
            .setVibrate(new long[] { 0, 1000, 1000 });
        Notification notification = builder.build();
        // Ring until stopped, as a phone does, not once.
        notification.flags |= Notification.FLAG_INSISTENT;

        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        try {
            nm.notify(tag(callId), NOTIFICATION_ID, notification);
        } catch (SecurityException e) {
            // Notifications refused: the app rings when it is opened instead.
        }
    }

    /** The intent ANSWER opens the app with. */
    public static Intent answerIntent(Context ctx, String callId) {
        return new Intent(ctx, MainActivity.class)
            .setAction(ACTION_ANSWER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL_ID, callId);
    }

    /** Stop ringing for a call, wherever it rings: notification and call screen. */
    public static void stop(Context ctx, String callId) {
        if (callId == null || callId.isEmpty()) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(tag(callId), NOTIFICATION_ID);
        prefs(ctx).edit().remove(PREF_TOKEN_PREFIX + callId).apply();
        ctx.sendBroadcast(new Intent(ACTION_STOPPED).setPackage(ctx.getPackageName()).putExtra(EXTRA_CALL_ID, callId));
    }

    static String declineToken(Context ctx, String callId) {
        return prefs(ctx).getString(PREF_TOKEN_PREFIX + callId, null);
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
