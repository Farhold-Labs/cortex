package com.farhold.cortex.calls;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** DECLINE on the ring's notification, with the app closed (v2.146.0). */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!CallRinger.ACTION_DECLINE.equals(intent.getAction())) return;
        String callId = intent.getStringExtra(CallRinger.EXTRA_CALL_ID);
        PendingResult pending = goAsync();
        CallDecliner.decline(ctx.getApplicationContext(), callId, pending::finish);
    }
}
