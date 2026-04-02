import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.farhold.cortex',
  appName: 'Cortex',
  webDir: 'dist',

  // Loads bundled dist/ on launch; API calls go to the configured server
  server: {
    allowNavigation: ['cortex.farhold.com'],
  },

  plugins: {
    SplashScreen: {
      backgroundColor: '#050805',
      launchAutoHide: true,
      autoHideDelay: 2000,
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#050805',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },

  android: {
    backgroundColor: '#050805',
  },

  ios: {
    backgroundColor: '#050805',
    contentInset: 'automatic',
  },
};

export default config;
