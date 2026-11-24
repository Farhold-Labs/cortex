package com.farhold.cortex.calls;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

/**
 * The full-screen incoming call, over the lock screen (v2.146.0).
 *
 * Shown by the ring's full-screen intent when the phone is locked or asleep;
 * the ringtone itself belongs to the notification. ANSWER opens the app into
 * the call, DECLINE tells the server. It closes when the ring stops anywhere
 * else: answered on another device, given up, or timed out.
 */
public class IncomingCallActivity extends Activity {
    private String callId;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final BroadcastReceiver stopped = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String id = intent.getStringExtra(CallRinger.EXTRA_CALL_ID);
            if (callId != null && callId.equals(id)) finish();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();

        Intent intent = getIntent();
        callId = intent.getStringExtra(CallRinger.EXTRA_CALL_ID);
        String who = intent.getStringExtra(CallRinger.EXTRA_CALLER);
        boolean video = "video".equals(intent.getStringExtra(CallRinger.EXTRA_KIND));
        long expiresAt = intent.getLongExtra(CallRinger.EXTRA_EXPIRES, 0);
        long left = expiresAt - System.currentTimeMillis();
        if (callId == null || left <= 0) {
            finish();
            return;
        }
        handler.postDelayed(this::finish, left);

        IntentFilter filter = new IntentFilter(CallRinger.ACTION_STOPPED);
        ContextCompat.registerReceiver(this, stopped, filter, ContextCompat.RECEIVER_NOT_EXPORTED);

        setContentView(buildView(who == null ? "Someone" : who, video));
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private View buildView(String who, boolean video) {
        float dp = getResources().getDisplayMetrics().density;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#050805"));
        root.setPadding((int) (24 * dp), (int) (96 * dp), (int) (24 * dp), (int) (64 * dp));

        TextView label = new TextView(this);
        label.setText(video ? "INCOMING VIDEO CALL" : "INCOMING CALL");
        label.setTextColor(Color.parseColor("#0ead69"));
        label.setTypeface(Typeface.MONOSPACE);
        label.setTextSize(14);
        label.setGravity(Gravity.CENTER);
        root.addView(label);

        TextView name = new TextView(this);
        name.setText(who);
        name.setTextColor(Color.parseColor("#ffd23f"));
        name.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        name.setTextSize(30);
        name.setGravity(Gravity.CENTER);
        name.setPadding(0, (int) (16 * dp), 0, 0);
        root.addView(name);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        Button decline = roundButton("DECLINE", "#c0392b", dp);
        Button answer = roundButton("ANSWER", "#0ead69", dp);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, (int) (64 * dp), 1f);
        lp.setMargins((int) (12 * dp), 0, (int) (12 * dp), 0);
        buttons.addView(decline, lp);
        buttons.addView(answer, new LinearLayout.LayoutParams(lp));
        root.addView(buttons, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        decline.setOnClickListener(v -> {
            CallDecliner.decline(getApplicationContext(), callId, null);
            finish();
        });
        answer.setOnClickListener(v -> {
            CallRinger.stop(getApplicationContext(), callId);
            startActivity(CallRinger.answerIntent(this, callId));
            finish();
        });
        return root;
    }

    private Button roundButton(String text, String color, float dp) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        b.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(color));
        bg.setCornerRadius(32 * dp);
        b.setBackground(bg);
        return b;
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try { unregisterReceiver(stopped); } catch (IllegalArgumentException e) { /* never registered */ }
        super.onDestroy();
    }
}
