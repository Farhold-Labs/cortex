import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VERSION, API_URL, BASE_URL, PRIVACY_LEVELS, isNativeApp } from '../config/constants.js';
import { CONFIRM_DIALOG, SERVER } from '../../messages.js';
import { storage } from '../utils/storage.js';
import { useAuth } from '../hooks/useAPI.js';
import { useWindowSize } from '../hooks/useWindowSize.js';
import { LoadingSpinner, Toast, Avatar, GlowText, ScanLines } from '../components/ui/SimpleComponents.jsx';

const LoginScreen = ({ onAbout }) => {
  const { login, completeMfaLogin, register } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState({ loading: false, message: '', error: '' });
  // MFA state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaMethods, setMfaMethods] = useState([]);
  const [mfaMethod, setMfaMethod] = useState('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCodeSending, setEmailCodeSending] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('24h');
  // Change Server state (v2.30.0)
  const [showChangeServer, setShowChangeServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(storage.getServerUrl() || BASE_URL);
  const [serverUrlError, setServerUrlError] = useState('');
  const [testingServer, setTestingServer] = useState(false);
  const { isMobile, isTablet, isDesktop } = useWindowSize();

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotEmail || !forgotEmail.includes('@')) {
      setForgotStatus({ loading: false, message: '', error: 'Please enter a valid email address' });
      return;
    }
    setForgotStatus({ loading: true, message: '', error: '' });
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setForgotStatus({ loading: false, message: data.message || 'Check your email for reset instructions.', error: '' });
      } else {
        setForgotStatus({ loading: false, message: '', error: data.error || 'Failed to send reset email' });
      }
    } catch (err) {
      setForgotStatus({ loading: false, message: '', error: 'Network error. Please try again.' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate password confirmation during registration
    if (isRegistering && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      if (isRegistering) {
        await register(handle, email, password, displayName, sessionDuration);
      } else {
        const result = await login(handle, password, sessionDuration);
        if (result?.mfaRequired) {
          setMfaRequired(true);
          setMfaChallenge(result.mfaChallenge);
          setMfaMethods(result.mfaMethods || []);
          setMfaMethod(result.mfaMethods?.[0] || 'totp');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMfaLoading(true);
    try {
      await completeMfaLogin(mfaChallenge, mfaMethod, mfaCode);
    } catch (err) {
      setError(err.message);
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaCancel = () => {
    setMfaRequired(false);
    setMfaChallenge(null);
    setMfaMethods([]);
    setMfaCode('');
    setError('');
    setEmailCodeSent(false);
    setEmailCodeSending(false);
  };

  const handleSendEmailCode = async () => {
    setEmailCodeSending(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/mfa/send-email-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: mfaChallenge }),
      });
      const data = await res.json();
      if (res.ok) {
        setMfaChallenge(data.challengeId); // Update to new challenge ID
        setEmailCodeSent(true);
      } else {
        setError(data.error || 'Failed to send email code');
      }
    } catch (err) {
      console.error('Send email code error:', err);
      setError('Network error. Please try again.');
    } finally {
      setEmailCodeSending(false);
    }
  };

  const isCapacitorNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

  const handleChangeServer = async () => {
    setServerUrlError('');
    let url = serverUrl.trim();
    if (!url) { setServerUrlError(SERVER.enterUrl); return; }
    // Auto-prepend https:// if no protocol
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    // Strip trailing slashes
    url = url.replace(/\/+$/, '');
    // Validate URL format
    try { new URL(url); } catch { setServerUrlError(SERVER.invalidUrl); return; }

    setTestingServer(true);
    try {
      await fetch(`${url}/api/server/info`, { signal: AbortSignal.timeout(5000) });
    } catch {
      setTestingServer(false);
      if (!confirm(`Could not reach ${url}. Connect anyway?`)) return;
    }
    setTestingServer(false);

    storage.removeToken();
    storage.removeUser();
    storage.removeSessionStart();

    if (isCapacitorNative) {
      // Capacitor native: save to Preferences (cross-origin safe) and redirect
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: 'cortex_server_url', value: url });
      window.location.replace(url);
    } else if (window.electronAPI?.setServerUrl) {
      // Electron: persist in userData and navigate to new server
      window.electronAPI.setServerUrl(url);
      window.location.replace(url);
    } else {
      // Web: use localStorage and reload
      storage.setServerUrl(url);
      window.location.reload();
    }
  };

  const handleResetServer = async () => {
    storage.removeToken();
    storage.removeUser();
    storage.removeSessionStart();

    if (isCapacitorNative) {
      // Capacitor native: clear Preferences and redirect to default
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key: 'cortex_server_url' });
      window.location.replace('https://cortex.farhold.com');
    } else if (window.electronAPI?.removeServerUrl) {
      // Electron: clear userData preference and navigate to default
      window.electronAPI.removeServerUrl();
      window.location.replace('https://cortex.farhold.com');
    } else {
      // Web: clear localStorage and reload
      storage.removeServerUrl();
      window.location.reload();
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', boxSizing: 'border-box',
    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(180deg, var(--bg-surface), var(--bg-base))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Courier New', monospace", padding: isMobile ? '20px' : '0',
    }}>
      <ScanLines />
      <div style={{
        width: '100%', maxWidth: '400px', padding: isMobile ? '24px' : '40px',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-amber)40',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <GlowText color="var(--accent-amber)" size={isMobile ? '2rem' : '2.5rem'} weight={700}>CORTEX</GlowText>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '8px' }}>SECURE COMMUNICATIONS</div>
        </div>

        {mfaRequired ? (
          <div>
            <div style={{ color: 'var(--accent-teal)', fontSize: '0.9rem', marginBottom: '24px', textAlign: 'center' }}>
              🔐 Two-Factor Authentication Required
            </div>

            {mfaMethods.length > 1 && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                  VERIFICATION METHOD
                </label>
                <select
                  value={mfaMethod}
                  onChange={(e) => { setMfaMethod(e.target.value); setMfaCode(''); setError(''); setEmailCodeSent(false); }}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {mfaMethods.includes('totp') && <option value="totp">Authenticator App</option>}
                  {mfaMethods.includes('email') && <option value="email">Email Code</option>}
                  {mfaMethods.includes('recovery') && <option value="recovery">Recovery Code</option>}
                </select>
              </div>
            )}

            <form onSubmit={handleMfaSubmit}>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                  {mfaMethod === 'totp' ? 'AUTHENTICATOR CODE' : mfaMethod === 'email' ? 'EMAIL CODE' : 'RECOVERY CODE'}
                </label>
                <input
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\s/g, ''))}
                  placeholder={mfaMethod === 'totp' ? '6-digit code' : mfaMethod === 'email' ? '6-digit code' : '8-character code'}
                  style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.2em', textAlign: 'center' }}
                  autoFocus
                  autoComplete="one-time-code"
                />
                {mfaMethod === 'totp' && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '8px' }}>
                    Enter the code from your authenticator app
                  </div>
                )}
                {mfaMethod === 'email' && (
                  <div style={{ marginTop: '8px' }}>
                    {!emailCodeSent ? (
                      <button
                        type="button"
                        onClick={handleSendEmailCode}
                        disabled={emailCodeSending}
                        style={{
                          width: '100%', padding: '10px',
                          background: emailCodeSending ? 'var(--border-subtle)' : 'var(--accent-amber)20',
                          border: `1px solid ${emailCodeSending ? 'var(--border-primary)' : 'var(--accent-amber)'}`,
                          color: emailCodeSending ? 'var(--text-muted)' : 'var(--accent-amber)',
                          cursor: emailCodeSending ? 'not-allowed' : 'pointer',
                          fontFamily: 'monospace', fontSize: '0.8rem',
                        }}
                      >
                        {emailCodeSending ? 'SENDING...' : '📧 SEND CODE TO EMAIL'}
                      </button>
                    ) : (
                      <div style={{ color: 'var(--accent-green)', fontSize: '0.7rem' }}>
                        ✓ Code sent! Check your email and enter the 6-digit code above.
                        <button
                          type="button"
                          onClick={handleSendEmailCode}
                          disabled={emailCodeSending}
                          style={{
                            background: 'none', border: 'none', color: 'var(--accent-amber)',
                            cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem',
                            marginLeft: '8px', textDecoration: 'underline',
                          }}
                        >
                          {emailCodeSending ? 'Sending...' : 'Resend'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {mfaMethod === 'recovery' && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '8px' }}>
                    Enter one of your recovery codes (each can only be used once)
                  </div>
                )}
              </div>

              {error && <div style={{ color: 'var(--accent-orange)', fontSize: '0.85rem', marginBottom: '16px', padding: '10px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)30' }}>{error}</div>}

              <button type="submit" disabled={mfaLoading || !mfaCode} style={{
                width: '100%', padding: '14px',
                background: mfaLoading ? 'var(--border-subtle)' : 'var(--accent-teal)20',
                border: `1px solid ${mfaLoading ? 'var(--border-primary)' : 'var(--accent-teal)'}`,
                color: mfaLoading ? 'var(--text-muted)' : 'var(--accent-teal)',
                cursor: mfaLoading || !mfaCode ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace', fontSize: '0.9rem',
              }}>
                {mfaLoading ? 'VERIFYING...' : 'VERIFY'}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button onClick={handleMfaCancel}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                ← Cancel and try again
              </button>
            </div>
          </div>
        ) : (
        <>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
              {isRegistering ? 'HANDLE' : 'HANDLE / EMAIL'}
            </label>
            <input type="text" value={handle} onChange={(e) => setHandle(e.target.value)}
              placeholder={isRegistering ? 'Choose handle' : 'Enter handle or email'} style={inputStyle} />
          </div>

          {isRegistering && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>EMAIL</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com" style={inputStyle} />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>DISPLAY NAME</label>
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How others see you" style={inputStyle} />
              </div>
            </>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>SESSION DURATION</label>
            <select value={sessionDuration} onChange={(e) => setSessionDuration(e.target.value)} style={inputStyle}>
              <option value="24h">24 hours (recommended)</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', marginTop: '4px' }}>
              Your session will expire after this duration for security
            </div>
          </div>

          <div style={{ marginBottom: isRegistering ? '16px' : '24px' }}>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>PASSWORD</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegistering ? 'Min 8 chars, upper, lower, number' : 'Enter password'} style={inputStyle} />
          </div>

          {isRegistering && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>CONFIRM PASSWORD</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password" style={inputStyle} />
            </div>
          )}

          {error && <div style={{ color: 'var(--accent-orange)', fontSize: '0.85rem', marginBottom: '16px', padding: '10px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)30' }}>{error}</div>}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '14px',
            background: loading ? 'var(--border-subtle)' : 'var(--accent-amber)20',
            border: `1px solid ${loading ? 'var(--border-primary)' : 'var(--accent-amber)'}`,
            color: loading ? 'var(--text-muted)' : 'var(--accent-amber)',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace', fontSize: '0.9rem',
          }}>
            {loading ? 'PROCESSING...' : isRegistering ? 'CREATE ACCOUNT' : 'LOGIN'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <button onClick={() => { setIsRegistering(!isRegistering); setError(''); setConfirmPassword(''); setShowForgotPassword(false); }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-teal)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.8rem' }}>
            {isRegistering ? '← BACK TO LOGIN' : 'NEW USER? CREATE ACCOUNT →'}
          </button>
        </div>

        {!isRegistering && !showForgotPassword && (
          <div style={{ textAlign: 'center', marginTop: '12px' }}>
            <button onClick={() => { setShowForgotPassword(true); setError(''); setForgotStatus({ loading: false, message: '', error: '' }); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              Forgot password?
            </button>
          </div>
        )}

        {showForgotPassword && (
          <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
              Enter your email address and we'll send you a link to reset your password.
            </div>
            <form onSubmit={handleForgotPassword}>
              <div style={{ marginBottom: '16px' }}>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Enter your email"
                  style={inputStyle}
                />
              </div>
              {forgotStatus.error && (
                <div style={{ color: 'var(--accent-orange)', fontSize: '0.85rem', marginBottom: '16px', padding: '10px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)30' }}>
                  {forgotStatus.error}
                </div>
              )}
              {forgotStatus.message && (
                <div style={{ color: 'var(--accent-green)', fontSize: '0.85rem', marginBottom: '16px', padding: '10px', background: 'var(--accent-green)10', border: '1px solid var(--accent-green)30' }}>
                  {forgotStatus.message}
                </div>
              )}
              <button type="submit" disabled={forgotStatus.loading} style={{
                width: '100%', padding: '12px',
                background: forgotStatus.loading ? 'var(--border-subtle)' : 'var(--accent-teal)20',
                border: `1px solid ${forgotStatus.loading ? 'var(--border-primary)' : 'var(--accent-teal)'}`,
                color: forgotStatus.loading ? 'var(--text-muted)' : 'var(--accent-teal)',
                cursor: forgotStatus.loading ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace', fontSize: '0.9rem',
              }}>
                {forgotStatus.loading ? 'SENDING...' : 'SEND RESET LINK'}
              </button>
            </form>
            <button onClick={() => { setShowForgotPassword(false); setForgotStatus({ loading: false, message: '', error: '' }); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem', marginTop: '12px', display: 'block', width: '100%', textAlign: 'center' }}>
              ← Back to login
            </button>
          </div>
        )}
        </>
        )}

        {onAbout && (
          <div style={{ textAlign: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
            <button onClick={onAbout}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              About this server ◇
            </button>
          </div>
        )}

        {/* Change Server (v2.30.0) */}
        <div style={{ textAlign: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          {!showChangeServer ? (
            <button onClick={() => setShowChangeServer(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              {storage.getServerUrl() ? `Port: ${new URL(storage.getServerUrl()).hostname} ◈` : `${SERVER.changeServer} ◈`}
            </button>
          ) : (
            <div style={{ textAlign: 'left' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                {SERVER.serverUrl}
              </label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => { setServerUrl(e.target.value); setServerUrlError(''); }}
                placeholder={SERVER.serverUrlPlaceholder}
                style={inputStyle}
              />
              <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', marginTop: '4px', marginBottom: '12px' }}>
                {SERVER.serverUrlHint}
              </div>
              {serverUrlError && (
                <div style={{ color: 'var(--accent-orange)', fontSize: '0.8rem', marginBottom: '12px', padding: '8px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)30' }}>
                  {serverUrlError}
                </div>
              )}
              <button
                onClick={handleChangeServer}
                disabled={testingServer}
                style={{
                  width: '100%', padding: '12px',
                  background: testingServer ? 'var(--border-subtle)' : 'var(--accent-amber)20',
                  border: `1px solid ${testingServer ? 'var(--border-primary)' : 'var(--accent-amber)'}`,
                  color: testingServer ? 'var(--text-muted)' : 'var(--accent-amber)',
                  cursor: testingServer ? 'not-allowed' : 'pointer',
                  fontFamily: 'monospace', fontSize: '0.85rem',
                }}
              >
                {testingServer ? SERVER.testing : SERVER.connect}
              </button>
              {storage.getServerUrl() && (
                <button
                  onClick={handleResetServer}
                  style={{
                    width: '100%', padding: '10px', marginTop: '8px',
                    background: 'none', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    fontFamily: 'monospace', fontSize: '0.75rem',
                  }}
                >
                  {SERVER.resetToDefault}
                </button>
              )}
              <div style={{ textAlign: 'center', marginTop: '10px' }}>
                <button onClick={() => { setShowChangeServer(false); setServerUrlError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  ← Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Clear All Data - for troubleshooting stale data issues */}
        <div style={{ textAlign: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={async () => {
              if (confirm(CONFIRM_DIALOG.clearLocalData)) {
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

                  alert('All data cleared. The page will now reload.');
                  window.location.reload();
                } catch (err) {
                  console.error('Failed to clear data:', err);
                  alert('Failed to clear some data. Try clearing manually in browser settings.');
                }
              }
            }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem', opacity: 0.7 }}
          >
            Having trouble? Clear all data ✕
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ RESET PASSWORD PAGE ============
export default LoginScreen;
