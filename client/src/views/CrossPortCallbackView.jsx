import React, { useState, useEffect, useRef } from 'react';
import { API_URL } from '../config/constants.js';
import { LoadingSpinner } from '../components/ui/SimpleComponents.jsx';
import { STEP_UP_HANDOFF_KEY } from '../utils/stepUp.js';

const params = new URLSearchParams(window.location.search);
const code = params.get('code') || '';
const state = params.get('state') || '';
const errorParam = params.get('error') || '';

const CrossPortCallbackView = ({ onLogin }) => {
  const [status, setStatus] = useState(errorParam ? 'error' : 'loading');
  const [errorMsg, setErrorMsg] = useState(errorParam === 'denied' ? 'The request was denied on the home server.' : errorParam || '');
  const ran = useRef(false);
  const [returnTo, setReturnTo] = useState(null);  // set for a step-up, so an error can lead back

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Read and clear the flow markers FIRST, whatever happens next: a step-up
    // marker left behind by a cancelled confirmation would send the next real
    // sign-in down the step-up path.
    const homeServerUrl = sessionStorage.getItem('crossPortHomeUrl') || '';
    sessionStorage.removeItem('crossPortHomeUrl');
    const purpose = sessionStorage.getItem('crossPortPurpose');
    sessionStorage.removeItem('crossPortPurpose');
    const stepUpReturn = sessionStorage.getItem('crossPortReturnTo') || '/';
    sessionStorage.removeItem('crossPortReturnTo');
    if (purpose === 'step_up') setReturnTo(stepUpReturn);

    if (errorParam) {
      if (purpose === 'step_up') setErrorMsg('The confirmation was cancelled on your home server. Nothing was changed.');
      setStatus('error');
      return;
    }
    if (!code || !state) { setErrorMsg('Missing code or state in callback URL.'); setStatus('error'); return; }

    // A step-up confirmation (v2.108.0, CORTEX-COMM-021): this person is
    // already signed in here and confirmed at their home node. Collect the
    // proof, hand it across the reload, and go back where they were.
    if (purpose === 'step_up') {
      fetch(`${API_URL}/cross-port/step-up/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('farhold_token')}` },
        credentials: 'same-origin',
        body: JSON.stringify({ code, state }),
      })
        .then(async r => ({ ok: r.ok, data: await r.json() }))
        .then(({ ok, data }) => {
          if (!ok || !data.stepUpToken) throw new Error(data.error || 'Your home server did not confirm it');
          sessionStorage.setItem(STEP_UP_HANDOFF_KEY, JSON.stringify({
            token: data.stepUpToken,
            expiresAt: Date.now() + Math.max(0, (data.expiresInMinutes || 15) * 60 * 1000 - 5000),
          }));
          setStatus('confirmed');
          setTimeout(() => window.location.replace(/^\/(?![\/\\])/.test(stepUpReturn) ? stepUpReturn : '/'), 1200);
        })
        .catch(err => { setErrorMsg(err.message || 'Could not confirm it is you.'); setStatus('error'); });
      return;
    }

    fetch(`${API_URL}/cross-port/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state, homeServerUrl }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.token) throw new Error(data.error || 'Session exchange failed');
        localStorage.setItem('farhold_token', data.token);
        localStorage.setItem('farhold_user', JSON.stringify(data.user));
        setStatus('success');
        setTimeout(() => {
          onLogin(data.token, data.user);
        }, 1200);
      })
      .catch(err => {
        setErrorMsg(err.message || 'Failed to complete cross-port sign-in.');
        setStatus('error');
      });
  }, []);

  const containerStyle = {
    minHeight: '100vh', background: '#050805', color: '#e8f5e8',
    fontFamily: 'Courier New, monospace', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 40,
  };

  const cardStyle = {
    background: '#0a140a', border: '1px solid #1e3a1e',
    padding: 40, maxWidth: 400, width: '100%',
  };

  if (status === 'loading') return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#0ead69', fontSize: '0.8rem', marginBottom: 20 }}>○ CORTEX / CROSS-PORT AUTH</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LoadingSpinner />
          <span style={{ color: '#7aad7a' }}>Completing sign-in...</span>
        </div>
      </div>
    </div>
  );

  if (status === 'confirmed') return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#0ead69', fontSize: '0.8rem', marginBottom: 20 }}>○ CORTEX / CROSS-PORT AUTH</div>
        <p style={{ color: '#0ead69', marginBottom: 8 }}>✓ Confirmed by your home server</p>
        <p style={{ color: '#4a7a4a', fontSize: '0.85rem' }}>Taking you back — repeat what you were doing to finish it.</p>
      </div>
    </div>
  );

  if (status === 'success') return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#0ead69', fontSize: '0.8rem', marginBottom: 20 }}>○ CORTEX / CROSS-PORT AUTH</div>
        <p style={{ color: '#0ead69', marginBottom: 8 }}>✓ Signed in successfully</p>
        <p style={{ color: '#4a7a4a', fontSize: '0.85rem' }}>Redirecting to Cortex...</p>
      </div>
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#0ead69', fontSize: '0.8rem', marginBottom: 20 }}>○ CORTEX / CROSS-PORT AUTH</div>
        <p style={{ color: '#ff6b35', marginBottom: 16 }}>{errorMsg || 'An error occurred during sign-in.'}</p>
        <a href={returnTo && /^\/(?![\/\\])/.test(returnTo) ? returnTo : '/'} style={{ color: '#ffd23f', fontSize: '0.85rem' }}>← Back to Cortex</a>
      </div>
    </div>
  );
};

export default CrossPortCallbackView;
