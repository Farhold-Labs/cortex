package com.farhold.cortex;

import android.app.Application;
import android.util.Log;

import com.google.firebase.FirebaseApp;

public class MainApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        try {
            FirebaseApp.initializeApp(this);
            Log.d("MainApplication", "FirebaseApp initialized successfully");
        } catch (Exception e) {
            Log.e("MainApplication", "Failed to initialize FirebaseApp: " + e.getMessage());
        }
    }
}
