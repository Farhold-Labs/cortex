import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.farhold.cortex',
  appName: 'Cortex',
  webDir: 'dist',

  server: {
    url: 'https://cortex.farhold.com',
    cleartext: false,
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
