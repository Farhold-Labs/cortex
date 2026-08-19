import React, { useState, useEffect, useCallback } from 'react';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { THEMES } from '../../config/themes.js';
import { FONT_SIZES, MESSAGE_FONTS, WAVE_DENSITY } from '../../config/constants.js';

// ============ INSTANCE CONFIG ADMIN PANEL (v2.65.0) ============
// Server-wide settings: preference defaults every user inherits until they choose for
// themselves, hard feature switches, and login-screen branding.

// Choice-style defaults an admin can set. Value lists come from the same constants the
// user-facing settings use, so the two can never drift apart.
const CHOICE_DEFAULTS = [
  { key: 'theme', label: 'THEME', options: Object.entries(THEMES).map(([id, t]) => [id, t.name]) },
  { key: 'fontSize', label: 'FONT SIZE', options: Object.entries(FONT_SIZES).map(([id, f]) => [id, f.name]) },
  { key: 'messageFont', label: 'MESSAGE FONT', options: Object.entries(MESSAGE_FONTS).map(([id, f]) => [id, f.name]) },
  { key: 'waveDensity', label: 'WAVE DENSITY', options: Object.entries(WAVE_DENSITY).map(([id, d]) => [id, d.name]) },
];

const TOGGLE_DEFAULTS = [
  { key: 'scanLines', label: 'CRT SCAN LINES' },
  { key: 'holidayEffects', label: 'HOLIDAY EFFECTS' },
  { key: 'autoCollapseMessages', label: 'AUTO-COLLAPSE MESSAGES' },
  { key: 'autoFocusMessages', label: 'AUTO-FOCUS THREADS' },
];

const FEATURES = [
  { key: 'videoFeed', label: 'VIDEO FEED', hint: 'Hides the Feed tab and refuses feed API calls' },
  { key: 'crawlBar', label: 'CRAWL BAR', hint: 'Disables the stocks/weather/news ticker' },
  { key: 'calendar', label: 'CALENDAR', hint: 'Hides the Calendar tab' },
  { key: 'publicPortal', label: 'PUBLIC PORTAL', hint: 'Disables the unauthenticated portal' },
  { key: 'registration', label: 'OPEN REGISTRATION', hint: 'When off, only an admin can add users' },
];

const BRANDING = [
  { key: 'instanceName', label: 'INSTANCE NAME', placeholder: 'Cortex' },
  { key: 'tagline', label: 'LOGIN TAGLINE', placeholder: 'Leave blank for the rotating default' },
];

const InstanceConfigAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [config, setConfig] = useState(null);
  const [codeDefaults, setCodeDefaults] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI('/admin/instance-config');
      setConfig(data);
      setCodeDefaults(data.codeDefaults || {});
      setBranding(data.branding || {});
    } catch (err) {
      showToast(err.message || 'Failed to load instance configuration', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const save = async (patch, successMessage) => {
    setSaving(true);
    try {
      const updated = await fetchAPI('/admin/instance-config', { method: 'PUT', body: patch });
      setConfig(prev => ({ ...prev, ...updated }));
      showToast(successMessage, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  // A default is "set" only when the admin has explicitly chosen it; otherwise the code
  // default applies and clearing it hands control back to the code.
  const effectiveDefault = (key) => (config?.defaults?.[key] !== undefined ? config.defaults[key] : codeDefaults[key]);
  const isOverridden = (key) => config?.defaults?.[key] !== undefined;

  const pillStyle = (active, color = 'var(--accent-amber)') => ({
    padding: '5px 12px',
    background: active ? `${color}20` : 'transparent',
    border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
    color: active ? color : 'var(--text-dim)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    borderRadius: '2px',
  });

  const labelStyle = { display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' };

  return (
    <CollapsibleSection title="INSTANCE DEFAULTS" isOpen={isOpen} onToggle={onToggle} isMobile={isMobile} accentColor="var(--accent-teal)">
      {loading ? <LoadingSpinner /> : !config ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Configuration unavailable.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.5 }}>
            Defaults apply to every user who has not chosen for themselves — including existing
            users. Anyone who has explicitly picked a value keeps it. Clearing a default hands
            the setting back to the built-in value.
          </div>

          {/* ---- Preference defaults ---- */}
          <div>
            <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', marginBottom: '12px' }}>▸ APPEARANCE DEFAULTS</div>

            {CHOICE_DEFAULTS.map(({ key, label, options }) => (
              <div key={key} style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>
                  {label}
                  {isOverridden(key) && <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>• set by admin</span>}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {options.map(([id, name]) => (
                    <button
                      key={id}
                      disabled={saving}
                      onClick={() => save({ defaults: { [key]: id } }, `Default ${label.toLowerCase()} set to ${name}`)}
                      style={pillStyle(effectiveDefault(key) === id)}
                    >
                      {name}
                    </button>
                  ))}
                  {isOverridden(key) && (
                    <button
                      disabled={saving}
                      onClick={() => save({ defaults: { [key]: null } }, `Default ${label.toLowerCase()} cleared`)}
                      style={{ ...pillStyle(false), color: 'var(--text-muted)' }}
                    >
                      ✕ clear
                    </button>
                  )}
                </div>
              </div>
            ))}

            {TOGGLE_DEFAULTS.map(({ key, label }) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>
                  {label}
                  {isOverridden(key) && <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>• set by admin</span>}
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button disabled={saving} onClick={() => save({ defaults: { [key]: true } }, `${label} default enabled`)} style={pillStyle(effectiveDefault(key) === true, 'var(--accent-green)')}>▣ ON</button>
                  <button disabled={saving} onClick={() => save({ defaults: { [key]: false } }, `${label} default disabled`)} style={pillStyle(effectiveDefault(key) === false, 'var(--accent-orange)')}>▢ OFF</button>
                  {isOverridden(key) && (
                    <button disabled={saving} onClick={() => save({ defaults: { [key]: null } }, `${label} default cleared`)} style={{ ...pillStyle(false), color: 'var(--text-muted)' }}>✕ clear</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ---- Feature switches ---- */}
          <div>
            <div style={{ color: 'var(--accent-orange)', fontSize: '0.8rem', marginBottom: '4px' }}>▸ FEATURES</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '12px', lineHeight: 1.5 }}>
              Switching a feature off hides it AND refuses the matching API calls — users cannot
              re-enable it for themselves.
            </div>
            {FEATURES.map(({ key, label, hint }) => {
              const enabled = config.features?.[key] !== false;
              return (
                <div key={key} style={{ marginBottom: '12px' }}>
                  <label style={labelStyle}>{label}</label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button disabled={saving} onClick={() => save({ features: { [key]: true } }, `${label} enabled`)} style={pillStyle(enabled, 'var(--accent-green)')}>▣ ENABLED</button>
                    <button disabled={saving} onClick={() => save({ features: { [key]: false } }, `${label} disabled`)} style={pillStyle(!enabled, 'var(--accent-orange)')}>▢ DISABLED</button>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{hint}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- Branding ---- */}
          <div>
            <div style={{ color: 'var(--accent-purple)', fontSize: '0.8rem', marginBottom: '12px' }}>▸ BRANDING</div>
            {BRANDING.map(({ key, label, placeholder }) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>{label}</label>
                <input
                  type="text"
                  value={branding[key] || ''}
                  placeholder={placeholder}
                  maxLength={120}
                  onChange={(e) => setBranding(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{
                    width: '100%', padding: '8px', background: 'var(--bg-base)',
                    border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
                    fontFamily: 'monospace', fontSize: '0.8rem', borderRadius: '2px',
                  }}
                />
              </div>
            ))}
            <button
              disabled={saving}
              onClick={() => save({ branding }, 'Branding saved')}
              style={{ ...pillStyle(true, 'var(--accent-purple)'), padding: '8px 20px' }}
            >
              {saving ? 'SAVING…' : 'SAVE BRANDING'}
            </button>
          </div>

          {config.updatedAt && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
              Last changed {new Date(config.updatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
};

export default InstanceConfigAdminPanel;
