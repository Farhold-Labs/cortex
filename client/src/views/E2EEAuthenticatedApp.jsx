import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAPI.js';
import { useE2EE } from '../../e2ee-context.jsx';
import { E2EESetupModal, PassphraseUnlockModal } from '../../e2ee-components.jsx';
import { LoadingSpinner } from '../components/ui/SimpleComponents.jsx';
import SessionExpiryModal from '../components/session/SessionExpiryModal.jsx';
import MainApp from './MainApp.jsx';

function E2EEAuthenticatedApp({ sharePingId, logout }) {
  const { getPendingPassword, clearPendingPassword, sessionExpiring, sessionExpired, reauth } = useAuth();
  const {
    e2eeStatus,
    isUnlocked,
    needsPassphrase,
    needsSetup,
    isUnlocking,
    unlockError,
    checkE2EEStatus,
    setupE2EE,
    unlockE2EE,
    recoverWithPassphrase,
    clearE2EE,
    isCryptoAvailable
  } = useE2EE();

  const [isSettingUp, setIsSettingUp] = useState(false);
  const [autoUnlockAttempted, setAutoUnlockAttempted] = useState(false);
  const [autoUnlockFailed, setAutoUnlockFailed] = useState(false);
  const [passwordMismatch, setPasswordMismatch] = useState(false); // True if auto-unlock failed due to wrong password

  // Check E2EE status on mount
  useEffect(() => {
    checkE2EEStatus();
  }, [checkE2EEStatus]);

  // Auto-unlock E2EE with pending password (from login)
  useEffect(() => {
    const pendingPassword = getPendingPassword();
    if (needsPassphrase && pendingPassword && !autoUnlockAttempted && !isUnlocking) {
      setAutoUnlockAttempted(true);
      console.log('E2EE: Auto-unlocking with login password...');
      unlockE2EE(pendingPassword)
        .then(() => {
          console.log('E2EE: Auto-unlock successful');
          clearPendingPassword();
        })
        .catch((err) => {
          console.error('E2EE: Auto-unlock failed:', err);
          setAutoUnlockFailed(true);
          setPasswordMismatch(true); // Login password didn't match E2EE passphrase
          clearPendingPassword();
        });
    }
    // If we need passphrase but there's no pending password (page refresh/PWA reopen),
    // mark auto-unlock as attempted so we show the unlock modal
    if (needsPassphrase && !pendingPassword && !autoUnlockAttempted && !isUnlocking) {
      console.log('E2EE: No pending password, showing unlock modal');
      setAutoUnlockAttempted(true);
      setAutoUnlockFailed(true); // This triggers the unlock modal
      // Don't set passwordMismatch - this is just a reopen, not a failed unlock
    }
  }, [needsPassphrase, autoUnlockAttempted, isUnlocking, getPendingPassword, clearPendingPassword, unlockE2EE]);

  // Auto-setup E2EE with pending password (from registration)
  useEffect(() => {
    const pendingPassword = getPendingPassword();
    if (needsSetup && pendingPassword && !isSettingUp) {
      console.log('E2EE: Auto-setting up with login password...');
      setIsSettingUp(true);
      setupE2EE(pendingPassword, true)
        .then((result) => {
          console.log('E2EE: Auto-setup successful');
          clearPendingPassword();
          // Note: Recovery key is still generated and available, but we don't show the modal
          // Users can regenerate it from Profile Settings if needed
        })
        .catch((err) => {
          console.error('E2EE: Auto-setup failed:', err);
          clearPendingPassword();
        })
        .finally(() => {
          setIsSettingUp(false);
        });
    }
  }, [needsSetup, isSettingUp, getPendingPassword, clearPendingPassword, setupE2EE]);

  // Handle logout (also clears E2EE state)
  const handleLogout = () => {
    clearPendingPassword();
    clearE2EE();
    logout();
  };

  // Check if Web Crypto is available
  if (!isCryptoAvailable) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>
        <h2 style={{ color: 'var(--accent-orange)' }}>Encryption Not Available</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Your browser does not support the Web Crypto API required for end-to-end encryption.
          Please use a modern browser (Chrome, Firefox, Safari, Edge) with HTTPS.
        </p>
        <button
          onClick={handleLogout}
          style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: 'var(--accent-orange)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Log Out
        </button>
      </div>
    );
  }

  // Show loading while checking E2EE status
  if (e2eeStatus === null) {
    return <LoadingSpinner message="Checking encryption status..." />;
  }

  // Show loading during auto-setup
  if (needsSetup && isSettingUp) {
    return <LoadingSpinner message="Setting up encryption..." />;
  }

  // Show loading during auto-unlock (only if we have a pending password)
  if (needsPassphrase && isUnlocking && !autoUnlockFailed) {
    return <LoadingSpinner message="Unlocking encryption..." />;
  }

  // Show unlock modal - either password mismatch or PWA reopen
  if (needsPassphrase && autoUnlockFailed) {
    return (
      <PassphraseUnlockModal
        onUnlock={async (passphrase, rememberDuration) => {
          const result = await unlockE2EE(passphrase, rememberDuration);
          setPasswordMismatch(false);
          // If session is in grace period, use the same password to reauth simultaneously
          // so the user isn't prompted twice for the same credential.
          // Silent failure — SessionExpiryModal remains as fallback if passphrases differ.
          if (sessionExpired) {
            reauth(passphrase).catch(() => {});
          }
          return result;
        }}
        onRecover={recoverWithPassphrase}
        onLogout={handleLogout}
        isLoading={isUnlocking}
        error={unlockError}
        showMigrationNotice={passwordMismatch}
      />
    );
  }

  // Waiting for auto-unlock/setup - shouldn't get here but just in case
  if (needsPassphrase && !autoUnlockAttempted) {
    return <LoadingSpinner message="Preparing encryption..." />;
  }
  if (needsSetup && !isSettingUp) {
    return <LoadingSpinner message="Preparing encryption setup..." />;
  }

  // E2EE is unlocked - render the main app
  return (
    <>
      <MainApp sharePingId={sharePingId} />
      {(sessionExpiring || sessionExpired) && <SessionExpiryModal />}
    </>
  );
}
export default E2EEAuthenticatedApp;
