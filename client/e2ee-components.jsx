/**
 * E2EE UI Components (v1.19.0)
 *
 * Modal components for E2EE setup and passphrase unlock.
 */

import { useState } from 'react';

// ============ E2EE Setup Modal ============
// Shown to new users or users who haven't set up E2EE
export function E2EESetupModal({ onSetup, onSkip, isLoading }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [error, setError] = useState(null);
  const [step, setStep] = useState(1);  // 1: passphrase, 2: show recovery key
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rememberDuration, setRememberDuration] = useState('days7');  // Default to 7 days for new users

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (step === 1) {
      // Validate passphrase
      if (passphrase.length < 8) {
        setError('Passphrase must be at least 8 characters');
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError('Passphrases do not match');
        return;
      }

      // Setup E2EE and get recovery key
      try {
        const result = await onSetup(passphrase, true, rememberDuration);  // true = create recovery key
        if (result.recoveryKey) {
          setRecoveryKey(result.recoveryKey);
          setStep(2);
        }
      } catch (err) {
        setError(err.message || 'Setup failed');
      }
      return;
    }
  };

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleComplete = () => {
    if (!acknowledged) {
      setError('Please confirm you have saved your recovery key');
      return;
    }
    // Setup is already complete, just close
    window.location.reload();
  };

  const modalStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px'
  };

  const contentStyle = {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-primary)',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '450px',
    width: '100%',
    boxShadow: '0 0 30px var(--glow-green)'
  };

  const inputStyle = {
    width: '100%',
    padding: '12px',
    backgroundColor: 'var(--bg-base)',
    border: '1px solid var(--border-secondary)',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '14px',
    marginBottom: '12px'
  };

  const buttonStyle = {
    width: '100%',
    padding: '12px',
    backgroundColor: 'var(--accent-green)',
    border: 'none',
    borderRadius: '4px',
    color: 'var(--bg-base)',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '8px'
  };

  const recoveryKeyStyle = {
    backgroundColor: 'var(--bg-base)',
    border: '2px solid var(--accent-green)',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center',
    marginBottom: '16px'
  };

  const keyTextStyle = {
    fontFamily: 'monospace',
    fontSize: '18px',
    letterSpacing: '2px',
    color: 'var(--accent-green)',
    wordBreak: 'break-all',
    userSelect: 'all'
  };

  return (
    <div style={modalStyle}>
      <div style={contentStyle}>
        <h2 style={{ color: 'var(--accent-green)', marginBottom: '8px', fontSize: '20px' }}>
          {step === 1 ? 'End-to-End Encryption' : 'Save Your Recovery Key'}
        </h2>

        {step === 1 ? (
          <>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '14px' }}>
              End-to-end encryption protects your messages. Your login password is used to secure your encryption keys,
              so there's no separate passphrase to remember.
            </p>

            <div style={{ backgroundColor: 'var(--overlay-teal)', padding: '12px', borderRadius: '4px', marginBottom: '16px', border: '1px solid var(--accent-teal)' }}>
              <p style={{ color: 'var(--accent-teal)', fontSize: '12px', margin: 0 }}>
                <strong>Note:</strong> A recovery key will be generated for backup access. Save it somewhere safe!
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              {/* Remember duration selector */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'block', marginBottom: '8px' }}>
                  Remember passphrase:
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    { value: 'session', label: 'This session only' },
                    { value: 'days7', label: 'For 7 days' },
                    { value: 'days30', label: 'For 30 days' }
                  ].map(option => (
                    <label
                      key={option.value}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        color: rememberDuration === option.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontSize: '13px'
                      }}
                    >
                      <input
                        type="radio"
                        name="setupRememberDuration"
                        value={option.value}
                        checked={rememberDuration === option.value}
                        onChange={(e) => setRememberDuration(e.target.value)}
                        style={{ width: '16px', height: '16px', accentColor: 'var(--accent-green)' }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <p style={{ color: 'var(--accent-orange)', fontSize: '12px', marginBottom: '8px' }}>{error}</p>
              )}

              <button type="submit" style={buttonStyle} disabled={isLoading}>
                {isLoading ? 'Setting up...' : 'Enable End-to-End Encryption'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '14px' }}>
              Your encryption is set up! Save this recovery key somewhere safe. You'll need it to recover access if needed.
            </p>

            <div style={recoveryKeyStyle}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '8px', textTransform: 'uppercase' }}>
                Recovery Key
              </p>
              <p style={keyTextStyle}>{recoveryKey}</p>
            </div>

            <button
              onClick={handleCopyKey}
              style={{
                ...buttonStyle,
                backgroundColor: copied ? 'var(--accent-green)' : 'var(--bg-surface)',
                border: '1px solid var(--accent-green)',
                color: copied ? 'var(--bg-base)' : 'var(--accent-green)',
                marginBottom: '16px'
              }}
            >
              {copied ? '✓ Copied!' : 'Copy Recovery Key'}
            </button>

            <div style={{ backgroundColor: 'var(--overlay-orange)', padding: '12px', borderRadius: '4px', marginBottom: '16px', border: '1px solid var(--accent-orange)' }}>
              <p style={{ color: 'var(--accent-orange)', fontSize: '12px', margin: 0 }}>
                <strong>Warning:</strong> This key will only be shown once. If you lose this recovery key, you may lose access to your encrypted messages.
              </p>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer', marginBottom: '12px' }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ width: '18px', height: '18px', marginTop: '2px' }}
              />
              <span>I have saved my recovery key in a safe place</span>
            </label>

            {error && (
              <p style={{ color: 'var(--accent-orange)', fontSize: '12px', marginBottom: '8px' }}>{error}</p>
            )}

            <button
              onClick={handleComplete}
              style={{
                ...buttonStyle,
                opacity: acknowledged ? 1 : 0.5
              }}
            >
              Continue to Cortex
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============ Passphrase Unlock Modal ============
// Shown on login when user has E2EE set up
// recoveryOnly: skip passphrase input and show recovery only
// showMigrationNotice: show notice for users migrating from old passphrase system
export function PassphraseUnlockModal({ onUnlock, onRecover, onLogout, isLoading, error: propError, recoveryOnly = false, showMigrationNotice = false }) {
  const [passphrase, setPassphrase] = useState('');
  const [showRecovery, setShowRecovery] = useState(recoveryOnly);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [error, setError] = useState(propError);
  const [rememberDuration, setRememberDuration] = useState('session');

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      await onUnlock(passphrase, rememberDuration);
    } catch (err) {
      setError(err.message || 'Incorrect passphrase');
    }
  };

  const handleRecover = async (e) => {
    e.preventDefault();
    setError(null);

    // Validate recovery key format (should be 24 chars without dashes, or with dashes)
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();
    if (cleanKey.length !== 24) {
      setError('Invalid recovery key format');
      return;
    }

    try {
      await onRecover(recoveryKey);
    } catch (err) {
      setError(err.message || 'Invalid recovery key');
    }
  };

  const modalStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px'
  };

  const contentStyle = {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-primary)',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '400px',
    width: '100%',
    boxShadow: '0 0 30px var(--glow-green)'
  };

  const inputStyle = {
    width: '100%',
    padding: '12px',
    backgroundColor: 'var(--bg-base)',
    border: '1px solid var(--border-secondary)',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '14px',
    marginBottom: '12px'
  };

  const recoveryInputStyle = {
    ...inputStyle,
    fontFamily: 'monospace',
    fontSize: '16px',
    letterSpacing: '1px',
    textTransform: 'uppercase'
  };

  const buttonStyle = {
    width: '100%',
    padding: '12px',
    backgroundColor: 'var(--accent-green)',
    border: 'none',
    borderRadius: '4px',
    color: 'var(--bg-base)',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer'
  };

  return (
    <div style={modalStyle}>
      <div style={contentStyle}>
        <h2 style={{ color: 'var(--accent-green)', marginBottom: '8px', fontSize: '20px' }}>
          Unlock Encryption
        </h2>

        {!showRecovery ? (
          <>
            {showMigrationNotice ? (
              <>
                <div style={{ backgroundColor: 'var(--overlay-amber)', padding: '12px', borderRadius: '4px', marginBottom: '16px', border: '1px solid var(--accent-amber)' }}>
                  <p style={{ color: 'var(--accent-amber)', fontSize: '12px', margin: 0 }}>
                    <strong>Password Mismatch:</strong> Your encryption keys are protected with a different password than your current login password.
                    This can happen if you recently changed or reset your password.
                  </p>
                </div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '13px' }}>
                  Enter your <strong>previous password</strong> to unlock, or use your <strong>recovery key</strong> if you don't remember it.
                </p>
              </>
            ) : (
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '14px' }}>
                Enter your password to unlock your encrypted messages.
              </p>
            )}

            <form onSubmit={handleUnlock}>
              <label style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                {showMigrationNotice ? 'Previous Password' : 'Password'}
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={showMigrationNotice ? "Enter your previous password" : "Enter your login password"}
                style={inputStyle}
                autoComplete="current-password"
                autoFocus
                required
              />

              {/* Remember duration selector */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'block', marginBottom: '8px' }}>
                  Remember passphrase:
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    { value: 'session', label: 'This session only' },
                    { value: 'days7', label: 'For 7 days' },
                    { value: 'days30', label: 'For 30 days' }
                  ].map(option => (
                    <label
                      key={option.value}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        color: rememberDuration === option.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontSize: '13px'
                      }}
                    >
                      <input
                        type="radio"
                        name="rememberDuration"
                        value={option.value}
                        checked={rememberDuration === option.value}
                        onChange={(e) => setRememberDuration(e.target.value)}
                        style={{ width: '16px', height: '16px', accentColor: 'var(--accent-green)' }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              {(error || propError) && (
                <p style={{ color: 'var(--accent-orange)', fontSize: '12px', marginBottom: '8px' }}>
                  {error || propError}
                </p>
              )}

              <button type="submit" style={buttonStyle} disabled={isLoading}>
                {isLoading ? 'Unlocking...' : 'Unlock Encryption'}
              </button>
            </form>

            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <button
                onClick={() => setShowRecovery(true)}
                style={{ background: 'none', border: 'none', color: 'var(--accent-teal)', cursor: 'pointer', fontSize: '13px' }}
              >
                Can't unlock? Use recovery key
              </button>
            </div>

            <div style={{ marginTop: '8px', textAlign: 'center' }}>
              <button
                onClick={onLogout}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}
              >
                Log out
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '14px' }}>
              Enter your recovery key to regain access.
            </p>

            <form onSubmit={handleRecover}>
              <input
                type="text"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                style={recoveryInputStyle}
                autoComplete="off"
                autoFocus
                required
              />

              {error && (
                <p style={{ color: 'var(--accent-orange)', fontSize: '12px', marginBottom: '8px' }}>{error}</p>
              )}

              <button type="submit" style={buttonStyle} disabled={isLoading}>
                {isLoading ? 'Recovering...' : 'Recover Access'}
              </button>
            </form>

            {!recoveryOnly && (
              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <button
                  onClick={() => setShowRecovery(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}
                >
                  Back to passphrase
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============ E2EE Status Indicator ============
// Small indicator showing encryption status
export function E2EEStatusIndicator({ isUnlocked, onClick }) {
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: onClick ? 'pointer' : 'default',
    backgroundColor: isUnlocked ? 'var(--overlay-green)' : 'var(--overlay-amber)',
    color: isUnlocked ? 'var(--accent-green)' : 'var(--accent-amber)',
    border: `1px solid ${isUnlocked ? 'var(--accent-green)' : 'var(--accent-amber)'}`
  };

  return (
    <span style={style} onClick={onClick} title={isUnlocked ? 'End-to-end encrypted' : 'Encryption locked'}>
      {isUnlocked ? '🔐' : '🔒'} E2EE
    </span>
  );
}

// ============ Encrypted Wave Badge ============
// Badge shown on encrypted waves
export function EncryptedWaveBadge({ small }) {
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: small ? '2px 4px' : '3px 6px',
    borderRadius: '3px',
    fontSize: small ? '10px' : '11px',
    backgroundColor: 'var(--overlay-green)',
    color: 'var(--accent-green)',
    border: '1px solid var(--accent-green)'
  };

  return (
    <span style={style} title="This wave is end-to-end encrypted">
      🔐 {!small && 'Encrypted'}
    </span>
  );
}

// ============ Legacy Wave Notice ============
// Shown on waves that predate E2EE with option to enable encryption
export function LegacyWaveNotice({ isCreator, onEnableEncryption, isEnabling }) {
  const containerStyle = {
    backgroundColor: 'var(--overlay-amber)',
    border: '1px solid var(--accent-amber)',
    borderRadius: '4px',
    padding: '10px 12px',
    marginBottom: '12px',
    fontSize: '12px',
    color: 'var(--accent-amber)'
  };

  const contentStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap'
  };

  const textStyle = {
    flex: 1,
    minWidth: '200px'
  };

  const buttonStyle = {
    padding: '6px 12px',
    backgroundColor: 'var(--accent-green)',
    border: 'none',
    borderRadius: '4px',
    color: 'var(--bg-base)',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: isEnabling ? 'wait' : 'pointer',
    opacity: isEnabling ? 0.7 : 1,
    whiteSpace: 'nowrap'
  };

  return (
    <div style={containerStyle}>
      <div style={contentStyle}>
        <span style={textStyle}>
          This wave predates end-to-end encryption. {isCreator ? 'Enable encryption to secure existing and future messages.' : 'New messages are not encrypted.'}
        </span>
        {isCreator && onEnableEncryption && (
          <button
            style={buttonStyle}
            onClick={onEnableEncryption}
            disabled={isEnabling}
          >
            {isEnabling ? 'Enabling...' : '🔐 Enable Encryption'}
          </button>
        )}
      </div>
    </div>
  );
}

// ============ Partial Encryption Banner ============
// Shown when wave is being migrated to E2EE
export function PartialEncryptionBanner({ progress, participantsWithE2EE, totalParticipants, onContinue, isContinuing }) {
  const allHaveE2EE = participantsWithE2EE === totalParticipants;

  const containerStyle = {
    backgroundColor: 'var(--overlay-teal)',
    border: '1px solid var(--accent-teal)',
    borderRadius: '4px',
    padding: '10px 12px',
    marginBottom: '12px',
    fontSize: '12px',
    color: 'var(--accent-teal)'
  };

  const contentStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  };

  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap'
  };

  const progressBarContainerStyle = {
    width: '100%',
    height: '6px',
    backgroundColor: 'var(--bg-base)',
    borderRadius: '3px',
    overflow: 'hidden'
  };

  const progressBarStyle = {
    height: '100%',
    width: `${progress}%`,
    backgroundColor: 'var(--accent-teal)',
    borderRadius: '3px',
    transition: 'width 0.3s ease'
  };

  const buttonStyle = {
    padding: '6px 12px',
    backgroundColor: 'var(--accent-teal)',
    border: 'none',
    borderRadius: '4px',
    color: 'var(--bg-base)',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: isContinuing ? 'wait' : 'pointer',
    opacity: isContinuing ? 0.7 : 1,
    whiteSpace: 'nowrap'
  };

  const statusStyle = {
    fontSize: '11px',
    color: 'var(--text-secondary)'
  };

  return (
    <div style={containerStyle}>
      <div style={contentStyle}>
        <div style={headerStyle}>
          <span>
            {progress < 100 ? (
              <>Encrypting wave... {Math.round(progress)}% complete</>
            ) : !allHaveE2EE ? (
              <>Wave encrypted. Waiting for {totalParticipants - participantsWithE2EE} participant{totalParticipants - participantsWithE2EE > 1 ? 's' : ''} to enable E2EE.</>
            ) : (
              <>Wave fully encrypted!</>
            )}
          </span>
          {progress < 100 && onContinue && (
            <button
              style={buttonStyle}
              onClick={onContinue}
              disabled={isContinuing}
            >
              {isContinuing ? 'Encrypting...' : 'Continue Encrypting'}
            </button>
          )}
        </div>
        {progress < 100 && (
          <div style={progressBarContainerStyle}>
            <div style={progressBarStyle} />
          </div>
        )}
        {!allHaveE2EE && (
          <div style={statusStyle}>
            {participantsWithE2EE}/{totalParticipants} participants have E2EE enabled
          </div>
        )}
      </div>
    </div>
  );
}

export default {
  E2EESetupModal,
  PassphraseUnlockModal,
  E2EEStatusIndicator,
  EncryptedWaveBadge,
  LegacyWaveNotice,
  PartialEncryptionBanner
};
