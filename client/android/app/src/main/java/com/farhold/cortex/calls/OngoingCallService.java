package com.farhold.cortex.calls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

import com.farhold.cortex.MainActivity;
import com.farhold.cortex.R;

/**
 * A call in progress, as the phone sees it (v2.148.0).
 *
 * While Cortex is in a call this foreground service holds an ongoing-call
 * notification (tap to go back, HANG UP to end) and tells Android the app is
 * using the microphone and camera on purpose. Without it Android silences the
 * microphone of an app that is no longer on screen, so leaving the app during
 * a call would have muted it.
 *
 * Started and stopped by CortexCallsPlugin.callStarted / callEnded; it only
 * shows the call, it never decides it.
 */
public class OngoingCallService extends Service {
    public static final String CHANNEL_ID = "cortex_ongoing_call";
    public static final String EXTRA_NAME = "name";
    public static final String EXTRA_VIDEO = "video";
    private static final int NOTIFICATION_ID = 0x0C411;

    public static void start(Context ctx, String name, boolean video) {
        Intent intent = new Intent(ctx, OngoingCallService.class)
            .putExtra(EXTRA_NAME, name)
            .putExtra(EXTRA_VIDEO, video);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent);
            else ctx.startService(intent);
        } catch (RuntimeException e) {
            // Not allowed from the background (Android 12+): the call still
            // works while the app is on screen.
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, OngoingCallService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String name = intent != null ? intent.getStringExtra(EXTRA_NAME) : null;
        boolean video = intent != null && intent.getBooleanExtra(EXTRA_VIDEO, false);
        Notification notification = build(name == null || name.isEmpty() ? "Cortex call" : name, video);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            if (video) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
            try {
                startForeground(NOTIFICATION_ID, notification, types);
            } catch (RuntimeException e) {
                // The camera type needs the camera permission granted; the
                // microphone alone still keeps the call audible.
                try {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                } catch (RuntimeException e2) {
                    stopSelf();
                }
            }
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_NOT_STICKY;
    }

    private Notification build(String name, boolean video) {
        createChannel(this);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent openIntent = PendingIntent.getActivity(this, 1, open, piFlags);
        Intent hangUp = new Intent(this, CallActionReceiver.class).setAction(CallRinger.ACTION_HANG_UP);
        PendingIntent hangUpIntent = PendingIntent.getBroadcast(this, 2, hangUp, piFlags);
        Person other = new Person.Builder().setName(name).setImportant(true).build();
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(name)
            .setContentText(video ? "Video call" : "Call")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setUsesChronometer(true)
            .setWhen(System.currentTimeMillis())
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(other, hangUpIntent).setIsVideo(video))
            .build();
    }

    static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // Low: it sits in the shade while the call lasts; it must not ring or pop up.
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Call in progress", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
