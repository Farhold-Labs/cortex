import React, { useState, useEffect, useRef } from 'react';
import { API_URL } from '../config/constants.js';
import { LoadingSpinner } from '../components/ui/SimpleComponents.jsx';

const params = new URLSearchParams(window.location.search);
const code = params.get('code') || '';
const state = params.get('state') || '';
const errorParam = params.get('error') || '';

const CrossPortCallbackView = ({ onLogin }) => {
  const [status, setStatus] = useState(errorParam ? 'error' : 'loading');
  const [errorMsg, setErrorMsg] = useState(errorParam === 'denied' ? 'The request was denied on the home server.' : errorParam || '');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (errorParam) { setStatus('error'); return; }
    if (!code || !state) { setErrorMsg('Missing code or state in callback URL.'); setStatus('error'); return; }

    const homeServerUrl = sessionStorage.getItem('crossPortHomeUrl') || '';
    sessionStorage.removeItem('crossPortHomeUrl');

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
        <a href="/" style={{ color: '#ffd23f', fontSize: '0.85rem' }}>← Back to Cortex</a>
      </div>
    </div>
  );
};

export default CrossPortCallbackView;
