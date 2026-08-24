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
  { key: 'registration', label: 'OPEN REGISTRATION', hint: 'When off, people can only join via an invitation link' },
  // Unlike the others this defaults OFF — publishing server-wide events to the
  // open internet is a disclosure, so it has to be switched on deliberately.
  { key: 'publicServerEvents', label: 'PUBLIC SERVER EVENTS', defaultOff: true,
    hint: 'Lists server-wide calendar events on the public /events page. Off by default.' },
];

// Notification defaults. `always | app_closed | never` for the per-type ones, matching
// the user-facing notification settings.
const NOTIF_MODE_OPTIONS = [['always', 'Always'], ['app_closed', 'App closed'], ['never', 'Never']];
const NOTIF_MODE_DEFAULTS = [
  { key: 'directMentions', label: 'MENTIONS' },
  { key: 'replies', label: 'REPLIES' },
  { key: 'reactions', label: 'REACTIONS' },
  { key: 'waveActivity', label: 'WAVE ACTIVITY' },
  { key: 'burstEvents', label: 'THREAD EVENTS' },
];
const NOTIF_TOGGLE_DEFAULTS = [
  { key: 'enabled', label: 'NOTIFICATIONS ON' },
  { key: 'soundEnabled', label: 'NOTIFICATION SOUND' },
  { key: 'suppressWhileFocused', label: 'SUPPRESS WHILE FOCUSED' },
];
// Frequency settings. Values mirror the user-facing controls exactly so the admin
// default and the user's own choice always speak the same language.
const PUSH_FREQUENCY_OPTIONS = [[0, 'None'], [1, '1 min'], [5, '5 min'], [15, '15 min'], [30, '30 min']];
const EMAIL_THRESHOLD_OPTIONS = [[0, 'Immediately'], [15, '15 min'], [30, '30 min'], [60, '1 hour']];

const EMAIL_TOGGLE_DEFAULTS = [
  { key: 'enabled', label: 'EMAIL NOTIFICATIONS ON' },
  { key: 'mentions', label: 'EMAIL ON MENTIONS' },
  { key: 'replies', label: 'EMAIL ON REPLIES' },
  { key: 'calendarReminders', label: 'EMAIL CALENDAR REMINDERS' },
];

const BRANDING = [
  { key: 'instanceName', label: 'INSTANCE NAME', placeholder: 'Cortex' },
  { key: 'tagline', label: 'LOGIN TAGLINE', placeholder: 'Leave blank for the rotating default' },
];

// Theme applied to the public portal and event pages, for everyone, regardless
// of what any individual visitor has chosen for themselves.
const PUBLIC_THEMES = [
  ['', 'Default (Serenity)'],
  ['serenity', 'Serenity'], ['malsBrowncoat', "Mal's Browncoat"], ['zoesWarrior', "Zoe's Warrior"],
  ['washSky', "Wash's Sky"], ['kayleeFloweredDress', "Kaylee's Flowered Dress"],
  ['jaynesKnitCap', "Jayne's Knit Cap"], ['inaraSilk', 'Inara Silk'], ['simonsClinic', "Simon's Clinic"],
  ['riversMind', "River's Mind"], ['booksWisdom', "Book's Wisdom"], ['reaverRed', 'Reaver Red'],
  ['allianceWhite', 'Alliance White'], ['pipBoy', 'Pip-Boy'],
  ['highContrast', 'High Contrast'], ['amoled', 'AMOLED'], ['blackAndWhite', 'Black & White'],
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

  const codeNotif = config?.codeNotificationDefaults || {};
  const notifSet = config?.notificationDefaults || {};
  const effectiveNotif = (key) => (notifSet[key] !== undefined ? notifSet[key] : codeNotif[key]);
  const isNotifOverridden = (key) => notifSet[key] !== undefined;
  const effectiveEmailNotif = (key) => (notifSet.email?.[key] !== undefined ? notifSet.email[key] : codeNotif.email?.[key]);
  const isEmailNotifOverridden = (key) => notifSet.email?.[key] !== undefined;

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

          {/* ---- Notification defaults ---- */}
          <div>
            <div style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', marginBottom: '4px' }}>▸ NOTIFICATION DEFAULTS</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '12px', lineHeight: 1.5 }}>
              What new users start with. Existing users who never opened their notification
              settings pick these up too; anyone who has changed a setting keeps their choice.
            </div>

            {NOTIF_TOGGLE_DEFAULTS.map(({ key, label }) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>
                  {label}
                  {isNotifOverridden(key) && <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>• set by admin</span>}
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button disabled={saving} onClick={() => save({ notificationDefaults: { [key]: true } }, `${label} default enabled`)} style={pillStyle(effectiveNotif(key) === true, 'var(--accent-green)')}>▣ ON</button>
                  <button disabled={saving} onClick={() => save({ notificationDefaults: { [key]: false } }, `${label} default disabled`)} style={pillStyle(effectiveNotif(key) === false, 'var(--accent-orange)')}>▢ OFF</button>
                  {isNotifOverridden(key) && (
                    <button disabled={saving} onClick={() => save({ notificationDefaults: { [key]: null } }, `${label} default cleared`)} style={{ ...pillStyle(false), color: 'var(--text-muted)' }}>✕ clear</button>
                  )}
                </div>
              </div>
            ))}

            {NOTIF_MODE_DEFAULTS.map(({ key, label }) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>
                  {label}
                  {isNotifOverridden(key) && <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>• set by admin</span>}
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {NOTIF_MODE_OPTIONS.map(([id, name]) => (
                    <button key={id} disabled={saving} onClick={() => save({ notificationDefaults: { [key]: id } }, `Default ${label.toLowerCase()} set to ${name}`)} style={pillStyle(effectiveNotif(key) === id)}>{name}</button>
                  ))}
                  {isNotifOverridden(key) && (
                    <button disabled={saving} onClick={() => save({ notificationDefaults: { [key]: null } }, `${label} default cleared`)} style={{ ...pillStyle(false), color: 'var(--text-muted)' }}>✕ clear</button>
                  )}
                </div>
              </div>
            ))}

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>
                PUSH FREQUENCY
                {isNotifOverridden('pushDebounceMinutes') && <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>• set by admin</span>}
              </label>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginBottom: '6px' }}>
                At most one push notification per user in this window. "None" sends every one.
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {PUSH_FREQUENCY_OPTIONS.map(([value, name]) => (
                  <button key={value} disabled={saving} onClick={() => save({ notificationDefaults: { pushDebounceMinutes: value } }, `Default push frequency set to ${name}`)} style={pillStyle(effectiveNotif('pushDebounceMinutes') === value)}>{name}</button>
                ))}
                {isNotifOverridden('pushDebounceMinutes') && (
                  <button disabled={saving} onClick={() => save({ notificationDefaults: { pushDebounceMinutes: null } }, 'Push frequency default cleared')} style={{ ...pillStyle(false), color: 'var(--text-muted)' }}>✕ clear</button>
                )}
              </div>
            </div>

            <div style={{ color: 'var(--accent-teal)', fontSize: '0.75rem', margin: '18px 0 10px' }}>▹ EMAIL</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '12px', lineHeight: 1.5 }}>
              Email notifications only send when a user is offline past their threshold, and
              only if this server has SMTP configured.
            </div>
            {EMAIL_TOGGLE_DEFAULTS.map(({ key, label }) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>
                  {label}
                  {isEmailNotifOverridden(key) && <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>• set by admin</span>}
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button disabled={saving} onClick={() => save({ notificationDefaults: { email: { [key]: true } } }, `${label} default enabled`)} style={pillStyle(effectiveEmailNotif(key) === true, 'var(--accent-green)')}>▣ ON</button>
                  <button disabled={saving} onClick={() => save({ notificationDefaults: { email: { [key]: false } } }, `${label} default disabled`)} style={pillStyle(effectiveEmailNotif(key) === false, 'var(--accent-orange)')}>▢ OFF</button>
                  {isEmailNotifOverridden(key) && (
                    <button disabled={saving} onClick={() => save({ notificationDefaults: { email: { [key]: null } } }, `${label} default cleared`)} style={{ ...pillStyle(false), color: 'var(--text-muted)' }}>✕ clear</button>
                  )}
                </div>
              </div>
            ))}

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>
                EMAIL AFTER OFFLINE FOR
                {isEmailNotifOverridden('offlineThresholdMinutes') && <span style={{ color: 'var(--accent-amber)', marginLeft: '8px' }}>• set by admin</span>}
              </label>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginBottom: '6px' }}>
                How long a user must be offline before email notifications start.
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {EMAIL_THRESHOLD_OPTIONS.map(([value, name]) => (
                  <button key={value} disabled={saving} onClick={() => save({ notificationDefaults: { email: { offlineThresholdMinutes: value } } }, `Default email threshold set to ${name}`)} style={pillStyle(effectiveEmailNotif('offlineThresholdMinutes') === value)}>{name}</button>
                ))}
                {isEmailNotifOverridden('offlineThresholdMinutes') && (
                  <button disabled={saving} onClick={() => save({ notificationDefaults: { email: { offlineThresholdMinutes: null } } }, 'Email threshold default cleared')} style={{ ...pillStyle(false), color: 'var(--text-muted)' }}>✕ clear</button>
                )}
              </div>
            </div>
          </div>

          {/* ---- Feature switches ---- */}
          <div>
            <div style={{ color: 'var(--accent-orange)', fontSize: '0.8rem', marginBottom: '4px' }}>▸ FEATURES</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '12px', lineHeight: 1.5 }}>
              Switching a feature off hides it AND refuses the matching API calls — users cannot
              re-enable it for themselves.
            </div>
            {FEATURES.map(({ key, label, hint, defaultOff }) => {
              const enabled = defaultOff
                ? config.features?.[key] === true
                : config.features?.[key] !== false;
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
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>PUBLIC PAGE THEME</label>
              <select
                value={branding.publicTheme || ''}
                onChange={(e) => setBranding(prev => ({ ...prev, publicTheme: e.target.value }))}
                style={{
                  width: '100%', padding: '8px', background: 'var(--bg-base)',
                  border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
                  fontFamily: 'monospace', fontSize: '0.8rem', borderRadius: '2px',
                }}
              >
                {PUBLIC_THEMES.map(([value, label]) => (
                  <option key={value || 'default'} value={value}>{label}</option>
                ))}
              </select>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '4px', lineHeight: 1.5 }}>
                Applies to the public portal and event pages, for every visitor. Members' own theme
                choices are unaffected — and no longer leak onto public pages, which they previously did
                for anyone who had signed in on that browser.
              </div>
            </div>

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
