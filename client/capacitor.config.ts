import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.farhold.cortex',
  appName: 'Cortex',
  webDir: 'dist',

  // Loads bundled dist/ on launch; launcher script redirects to saved server
  server: {
    allowNavigation: ['*'],
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
