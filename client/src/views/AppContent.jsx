import React, { useState, useEffect, useMemo } from 'react';
import { VERSION } from '../config/constants.js';
import { storage } from '../utils/storage.js';
import { useAuth } from '../hooks/useAPI.js';
import LoginScreen from './LoginScreen.jsx';
import AboutServerPage from './AboutServerPage.jsx';
import ResetPasswordPage from './ResetPasswordPage.jsx';
import PublicMessageView from './PublicMessageView.jsx';
import PublicPortalView from './PublicPortalView.jsx';
import CrossPortAuthView from './CrossPortAuthView.jsx';
import CrossPortCallbackView from './CrossPortCallbackView.jsx';
import AuthProvider from './AuthProvider.jsx';
import E2EEAuthenticatedApp from './E2EEAuthenticatedApp.jsx';

function AppContent() {
  const { user, token, logout } = useAuth();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [showLoginScreen, setShowLoginScreen] = useState(false);
  const [showRegisterScreen, setShowRegisterScreen] = useState(false);

  // Check for ?clear=1 URL parameter to force clear all data
  // This runs before anything else so it works even if the app is broken
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('clear') === '1') {
      console.log('[Clear] Clearing all data via URL parameter...');

      (async () => {
        try {
          // Clear all storage (preserve server URL)
          const savedServerUrl = localStorage.getItem('farhold_server_url');
          localStorage.clear();
          if (savedServerUrl) localStorage.setItem('farhold_server_url', savedServerUrl);
          sessionStorage.clear();

          // Clear IndexedDB
          const databases = await indexedDB.databases?.() || [];
          for (const db of databases) {
            if (db.name) indexedDB.deleteDatabase(db.name);
          }

          // Unregister service workers
          const registrations = await navigator.serviceWorker?.getRegistrations() || [];
          for (const registration of registrations) {
            await registration.unregister();
          }

          // Clear caches
          const cacheNames = await caches?.keys() || [];
          for (const cacheName of cacheNames) {
            await caches.delete(cacheName);
          }

          // Remove the ?clear=1 param and reload cleanly
          window.history.replaceState({}, '', window.location.pathname);
          window.location.reload();
        } catch (err) {
          console.error('[Clear] Failed to clear data:', err);
          alert('Failed to clear some data. Try clearing manually in browser settings.');
        }
      })();
      return;
    }
  }, []);

  // Version check - clear stale data on major version upgrade
  useEffect(() => {
    const storedVersion = localStorage.getItem('farhold_app_version');
    const currentMajor = VERSION.split('.')[0];
    const storedMajor = storedVersion?.split('.')[0];

    if (storedVersion && storedMajor && currentMajor !== storedMajor) {
      console.log(`[Version] Major version change detected: ${storedVersion} → ${VERSION}. Clearing stale data...`);

      // Clear E2EE session data (but not localStorage entirely - that would log them out)
      sessionStorage.clear();

      // Clear service worker caches
      caches?.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });

      // Update stored version
      localStorage.setItem('farhold_app_version', VERSION);

      // Force reload to get fresh assets
      window.location.reload();
      return;
    }

    // Store current version
    localStorage.setItem('farhold_app_version', VERSION);
  }, []);

  // Capture share parameter on mount - check both URL formats:
  // 1. /?share=pingId (query param style)
  // 2. /share/pingId (path style - when server redirect doesn't work due to proxy)
  const [sharePingId] = useState(() => {
    // Check query param first
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('share');
    if (fromQuery) return fromQuery;

    // Check path: /share/:pingId
    const pathMatch = window.location.pathname.match(/^\/share\/(.+)$/);
    if (pathMatch) return pathMatch[1];

    return null;
  });

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Navigate function for internal links
  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // Public routes (accessible without login)
  if (currentPath === '/cross-port-auth') {
    return <CrossPortAuthView />;
  }

  if (currentPath === '/cross-port/callback') {
    return <CrossPortCallbackView onLogin={() => window.location.replace('/')} />;
  }

  if (currentPath === '/portal') {
    return (
      <PublicPortalView onLogin={() => {
        window.history.pushState({}, '', '/');
        setCurrentPath('/');
        setShowLoginScreen(true);
      }} />
    );
  }

  if (currentPath === '/about') {
    return <AboutServerPage onBack={() => navigate('/')} />;
  }

  if (currentPath === '/reset-password' || currentPath.startsWith('/reset-password?')) {
    return <ResetPasswordPage onBack={() => navigate('/')} />;
  }

  // Handle shared ping for unauthenticated users
  if (sharePingId && !user) {
    if (showLoginScreen) {
      return <LoginScreen onAbout={() => navigate('/about')} />;
    }
    if (showRegisterScreen) {
      return <LoginScreen onAbout={() => navigate('/about')} initialView="register" />;
    }
    return (
      <PublicMessageView
        pingId={sharePingId}
        onLogin={() => setShowLoginScreen(true)}
        onRegister={() => setShowRegisterScreen(true)}
      />
    );
  }

  // Show login screen for unauthenticated users
  if (!user) {
    return <LoginScreen onAbout={() => navigate('/about')} />;
  }

  // User is authenticated - wrap with E2EE flow
  return <E2EEAuthenticatedApp sharePingId={sharePingId} logout={logout} />;
}

// E2EE authenticated app wrapper - handles E2EE setup/unlock before showing main app
export default AppContent;
