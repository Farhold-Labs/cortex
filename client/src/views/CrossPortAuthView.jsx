import React, { useState, useEffect } from 'react';
import { storage } from '../utils/storage.js';
import { API_URL } from '../config/constants.js';
import { useAuth } from '../hooks/useAPI.js';
import { useWindowSize } from '../hooks/useWindowSize.js';
import { LoadingSpinner } from '../components/ui/SimpleComponents.jsx';

const params = new URLSearchParams(window.location.search);
const guestNode = params.get('from') || '';
const guestFromUrl = params.get('from_url') || '';
const requestId = params.get('request_id') || '';
const nonce = params.get('nonce') || '';
const callbackUrl = params.get('callback') || '';
// 'step_up': the guest server is asking this person to confirm it is really
// them (CORTEX-COMM-021), so approval needs their password, not just a session.
const isStepUp = params.get('purpose') === 'step_up';

const inputStyle = {
  width: '100%', padding: '10px 12px', background: '#0a140a',
  border: '1px solid #1e3a1e', color: '#e8f5e8',
  fontFamily: 'Courier New, monospace', fontSize: '0.9rem', boxSizing: 'border-box',
};

const btnStyle = (variant = 'primary') => ({
  padding: '10px 24px', fontFamily: 'Courier New, monospace', fontSize: '0.9rem',
  fontWeight: 'bold', cursor: 'pointer', border: 'none',
  background: variant === 'primary' ? '#0ead69' : variant === 'danger' ? 'transparent' : 'transparent',
  color: variant === 'primary' ? '#000' : variant === 'danger' ? '#ff6b35' : '#7aad7a',
  ...(variant !== 'primary' ? { border: `1px solid ${variant === 'danger' ? '#ff6b35' : '#1e3a1e'}` } : {}),
});

const CrossPortAuthView = () => {
  const { login } = useAuth();
  const { isMobile } = useWindowSize();

  const [phase, setPhase] = useState('loading'); // loading | login | approve | working | done | error
  const [requestInfo, setRequestInfo] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Login form state
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState('');

  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('farhold_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (!guestNode) { setErrorMsg('Missing guest server information.'); setPhase('error'); return; }
    fetch(`${API_URL}/cross-port/request-info?from=${encodeURIComponent(guestNode)}&from_url=${encodeURIComponent(guestFromUrl)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.trusted) { setErrorMsg(`${guestNode} is not a trusted server on this Cortex instance.`); setPhase('error'); return; }
        setRequestInfo(data);
        setPhase(user ? 'approve' : 'login');
      })
      .catch(() => { setErrorMsg('Failed to verify the requesting server.'); setPhase('error'); });
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const result = await login(handle, password);
      // login() reports { success } and keeps the user in storage; it never
      // returned { user }. Checking for one rejected every correct password
      // with "Invalid handle or password" — anyone not already signed in here
      // had to reload the page to get through (found v2.108.0).
      if (result?.success) {
        setUser(storage.getUser());
        setPhase('approve');
      } else if (result?.mfaRequired) {
        setLoginError('This account uses two-step sign-in. Sign in to this server in another tab first, then reload this page.');
      } else {
        setLoginError('Invalid handle or password.');
      }
    } catch (err) {
      setLoginError(err.message || 'Login failed.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleApprove = async () => {
    if (isStepUp && !confirmPassword) { setConfirmError('Enter your password to confirm it is you.'); return; }
    setPhase('working');
    try {
      const token = localStorage.getItem('farhold_token');
      const res = await fetch(`${API_URL}/cross-port/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          guestNode, callbackUrl, nonce, requestId,
          ...(isStepUp ? { purpose: 'step_up', password: confirmPassword } : {}),
        }),
      });
      const data = await res.json();
      if (isStepUp && res.status === 401) {
        // A wrong password: let them try again rather than ending the flow.
        setConfirmPassword('');
        setConfirmError(data.error || 'Incorrect password');
        setPhase('approve');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Approval failed');
      window.location.href = data.callbackUrl;
    } catch (err) {
      setErrorMsg(err.message || 'Failed to approve request.');
      setPhase('error');
    }
  };

  const handleDeny = async () => {
    setPhase('working');
    try {
      const token = localStorage.getItem('farhold_token');
      const res = await fetch(`${API_URL}/cross-port/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guestNode, callbackUrl, nonce }),
      });
      const data = await res.json();
      if (data.callbackUrl) { window.location.href = data.callbackUrl; return; }
    } catch { /* ignore */ }
    // No fallback to the `callback` in this page's URL: that came from
    // whoever built the link, and following it made "deny" an open redirect
    // (CORTEX-COMM-002). The server derives the way back from its peer record.
    setPhase('done');
    setErrorMsg('Request denied. You can close this page.');
  };

  const containerStyle = {
    minHeight: '100vh', background: '#050805', color: '#e8f5e8',
    fontFamily: 'Courier New, monospace', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: isMobile ? 16 : 40,
  };

  const cardStyle = {
    background: '#0a140a', border: '1px solid #1e3a1e',
    padding: isMobile ? 24 : 40, maxWidth: 480, width: '100%',
  };

  if (phase === 'loading') return (
    <div style={containerStyle}><LoadingSpinner /></div>
  );

  if (phase === 'error' || phase === 'done') return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#0ead69', fontSize: '0.8rem', marginBottom: 20 }}>○ CORTEX / CROSS-PORT AUTH</div>
        <p style={{ color: phase === 'error' ? '#ff6b35' : '#7aad7a' }}>{errorMsg || 'Request denied.'}</p>
        <a href="/" style={{ color: '#ffd23f', fontSize: '0.85rem' }}>← Back to Cortex</a>
      </div>
    </div>
  );

  if (phase === 'working') return (
    <div style={containerStyle}><LoadingSpinner /></div>
  );

  if (phase === 'login') return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#0ead69', fontSize: '0.8rem', marginBottom: 4 }}>○ CORTEX / CROSS-PORT AUTH</div>
        <h2 style={{ color: '#ffd23f', margin: '0 0 8px', fontSize: '1.1rem' }}>Sign in to continue</h2>
        <p style={{ color: '#7aad7a', fontSize: '0.85rem', margin: '0 0 24px' }}>
          <strong style={{ color: '#e8f5e8' }}>{guestNode}</strong> is requesting access to your Cortex identity.
          Sign in to review and approve or deny.
        </p>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#4a7a4a', fontSize: '0.7rem', marginBottom: 4 }}>HANDLE</div>
            <input style={inputStyle} value={handle} onChange={e => setHandle(e.target.value)} autoFocus autoComplete="username" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: '#4a7a4a', fontSize: '0.7rem', marginBottom: 4 }}>PASSWORD</div>
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {loginError && <p style={{ color: '#ff6b35', fontSize: '0.85rem', margin: '0 0 12px' }}>{loginError}</p>}
          <button type="submit" disabled={loginLoading || !handle || !password} style={btnStyle('primary')}>
            {loginLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );

  // approve phase
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#0ead69', fontSize: '0.8rem', marginBottom: 4 }}>○ CORTEX / CROSS-PORT AUTH</div>
        <h2 style={{ color: '#ffd23f', margin: '0 0 16px', fontSize: '1.1rem' }}>{isStepUp ? 'Confirm It’s You' : 'Access Request'}</h2>

        <div style={{ padding: '16px', background: '#050805', border: '1px solid #1e3a1e', marginBottom: 24 }}>
          <div style={{ color: '#4a7a4a', fontSize: '0.7rem', marginBottom: 8 }}>REQUESTING SERVER</div>
          <div style={{ color: '#00b4d8', fontWeight: 'bold' }}>{guestNode}</div>
          {guestFromUrl && <div style={{ color: '#4a7a4a', fontSize: '0.75rem', marginTop: 4 }}>{guestFromUrl}</div>}
        </div>

        <p style={{ color: '#7aad7a', fontSize: '0.85rem', margin: '0 0 8px' }}>
          Signed in as <strong style={{ color: '#e8f5e8' }}>@{user?.handle}</strong>
        </p>
        {isStepUp ? (
          <div style={{ margin: '0 0 24px' }}>
            <p style={{ color: '#7aad7a', fontSize: '0.85rem', margin: '0 0 12px' }}>
              You are signed in to <strong style={{ color: '#e8f5e8' }}>{guestNode}</strong> and started
              something there that needs your password. Enter it here to confirm it is you — your password
              stays on this server.
            </p>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setConfirmError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleApprove(); }}
              placeholder="Your password"
              autoComplete="current-password"
              autoFocus
              style={inputStyle}
            />
            {confirmError && <div role="alert" style={{ color: '#ff6b35', fontSize: '0.8rem', marginTop: 8 }}>{confirmError}</div>}
          </div>
        ) : (
          <p style={{ color: '#7aad7a', fontSize: '0.85rem', margin: '0 0 24px' }}>
            Approving grants <strong style={{ color: '#e8f5e8' }}>{guestNode}</strong> a session
            using your identity. You can revoke it by changing your password.
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={handleApprove} style={btnStyle('primary')}>{isStepUp ? 'Confirm' : 'Approve'}</button>
          <button onClick={handleDeny} style={btnStyle('danger')}>Deny</button>
        </div>
      </div>
    </div>
  );
};

export default CrossPortAuthView;
