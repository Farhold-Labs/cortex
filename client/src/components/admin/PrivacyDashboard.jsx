import React, { useState, useEffect, useCallback } from 'react';
import { formatError, FEDERATION } from '../../../messages.js';
import { T } from '../../config/terminology.js';

/**
 * Privacy & Encryption Dashboard (v2.24.0)
 *
 * Admin panel showing encryption status for all encryptable data types
 * with one-click migration buttons.
 */
const PrivacyDashboard = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(null); // 'emails' | 'participation' | 'pushSubs' | 'crewMembers' | null
  const [fedStatus, setFedStatus] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [data, fedData] = await Promise.all([
        fetchAPI('/admin/maintenance/privacy-status'),
        fetchAPI('/admin/federation/status').catch(() => null)
      ]);
      setStatus(data);
      setFedStatus(fedData);
    } catch (err) {
      if (!err.message?.includes('401')) {
        showToast(err.message || formatError('Failed to load privacy status'), 'error');
      }
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen && !status) {
      loadStatus();
    }
  }, [isOpen, status, loadStatus]);

  const handleMigrateEmails = async () => {
    setMigrating('emails');
    try {
      const data = await fetchAPI('/admin/maintenance/migrate-emails', { method: 'POST' });
      showToast(data.message || `Migrated ${data.migrated} emails`, 'success');
      loadStatus(); // Refresh stats
    } catch (err) {
      showToast(err.message || formatError('Email migration failed'), 'error');
    }
    setMigrating(null);
  };

  const handleMigrateParticipation = async () => {
    setMigrating('participation');
    try {
      const data = await fetchAPI('/admin/maintenance/migrate-wave-participants', { method: 'POST' });
      showToast(data.message || `Migrated ${data.migratedWaves} ${T.waves}`, 'success');
      loadStatus(); // Refresh stats
    } catch (err) {
      showToast(err.message || formatError('Participation migration failed'), 'error');
    }
    setMigrating(null);
  };

  const handleMigratePushSubscriptions = async () => {
    setMigrating('pushSubs');
    try {
      const data = await fetchAPI('/admin/maintenance/migrate-push-subscriptions', { method: 'POST' });
      showToast(data.message || `Migrated ${data.migratedSubscriptions} push subscriptions`, 'success');
      loadStatus(); // Refresh stats
    } catch (err) {
      showToast(err.message || formatError('Push subscription migration failed'), 'error');
    }
    setMigrating(null);
  };

  const handleMigrateCrewMembers = async () => {
    setMigrating('crewMembers');
    try {
      const data = await fetchAPI('/admin/maintenance/migrate-crew-members', { method: 'POST' });
      showToast(data.message || `Migrated ${data.migratedCrews} ${T.crews}`, 'success');
      loadStatus(); // Refresh stats
    } catch (err) {
      showToast(err.message || formatError(`${T.Crew} membership migration failed`), 'error');
    }
    setMigrating(null);
  };

  const cardStyle = {
    padding: isMobile ? '16px' : '16px 20px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    marginBottom: '12px',
  };

  const labelStyle = {
    fontSize: '0.7rem',
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '4px',
  };

  const valueStyle = {
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
  };

  const statusBadge = (enabled, label) => (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      fontSize: '0.7rem',
      fontFamily: 'monospace',
      background: enabled ? 'var(--accent-green)20' : 'var(--accent-amber)20',
      color: enabled ? 'var(--accent-green)' : 'var(--accent-amber)',
      border: `1px solid ${enabled ? 'var(--accent-green)' : 'var(--accent-amber)'}40`,
    }}>
      {label}
    </span>
  );

  const migrateButton = (onClick, disabled, loading, count) => (
    <button
      onClick={onClick}
      disabled={disabled || loading || count === 0}
      style={{
        padding: isMobile ? '10px 16px' : '8px 14px',
        minHeight: isMobile ? '44px' : 'auto',
        background: count > 0 ? 'var(--accent-teal)20' : 'transparent',
        border: `1px solid ${count > 0 ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
        color: count > 0 ? 'var(--accent-teal)' : 'var(--text-dim)',
        cursor: disabled || loading || count === 0 ? 'not-allowed' : 'pointer',
        fontFamily: 'monospace',
        fontSize: isMobile ? '0.85rem' : '0.8rem',
        opacity: disabled || loading ? 0.5 : 1,
      }}
    >
      {loading ? '...' : count > 0 ? `MIGRATE ${count}` : 'DONE'}
    </button>
  );

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-green)40',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: 'var(--accent-green)', fontSize: '0.8rem', fontWeight: 500 }}>
          🔐 PRIVACY & ENCRYPTION
        </div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-green)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-green)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-green)' : 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
          }}
        >
          {isOpen ? '▼ HIDE' : '▶ SHOW'}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '16px' }}>
          {loading ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>
              Loading encryption status...
            </div>
          ) : status ? (
            <>
              {/* Email Encryption */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '1rem' }}>📧</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Email Addresses</span>
                      {statusBadge(status.config?.emailEncryptionEnabled, status.config?.emailEncryptionEnabled ? 'KEY SET' : 'NO KEY')}
                    </div>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={labelStyle}>Hashed</div>
                        <div style={valueStyle}>{status.emailProtection?.hashed || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Encrypted</div>
                        <div style={valueStyle}>{status.emailProtection?.encrypted || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Plaintext</div>
                        <div style={{ ...valueStyle, color: status.emailProtection?.plaintext > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                          {status.emailProtection?.plaintext || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ alignSelf: 'center' }}>
                    {migrateButton(
                      handleMigrateEmails,
                      !status.config?.emailEncryptionEnabled,
                      migrating === 'emails',
                      status.emailProtection?.migrationNeeded || 0
                    )}
                  </div>
                </div>
                {!status.config?.emailEncryptionEnabled && (
                  <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Set EMAIL_ENCRYPTION_KEY to enable
                  </div>
                )}
              </div>

              {/* Wave Participation Encryption */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '1rem' }}>👥</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{T.Wave} Participation</span>
                      {statusBadge(status.config?.waveParticipationEncryptionEnabled, status.config?.waveParticipationEncryptionEnabled ? 'KEY SET' : 'NO KEY')}
                    </div>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={labelStyle}>Total {T.Waves}</div>
                        <div style={valueStyle}>{status.waveParticipation?.totalWaves || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Encrypted</div>
                        <div style={valueStyle}>{status.waveParticipation?.encryptedWaves || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Pending</div>
                        <div style={{ ...valueStyle, color: status.waveParticipation?.migrationNeeded > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                          {status.waveParticipation?.migrationNeeded || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ alignSelf: 'center' }}>
                    {migrateButton(
                      handleMigrateParticipation,
                      !status.config?.waveParticipationEncryptionEnabled,
                      migrating === 'participation',
                      status.waveParticipation?.migrationNeeded || 0
                    )}
                  </div>
                </div>
                {!status.config?.waveParticipationEncryptionEnabled && (
                  <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Set WAVE_PARTICIPATION_KEY to enable
                  </div>
                )}
              </div>

              {/* Push Subscriptions Encryption (v2.22.0) */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '1rem' }}>🔔</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Push Subscriptions</span>
                      {statusBadge(status.config?.pushSubscriptionEncryptionEnabled, status.config?.pushSubscriptionEncryptionEnabled ? 'KEY SET' : 'NO KEY')}
                    </div>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={labelStyle}>Users</div>
                        <div style={valueStyle}>{status.pushSubscriptions?.totalUsers || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Subscriptions</div>
                        <div style={valueStyle}>{status.pushSubscriptions?.totalSubscriptions || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Encrypted</div>
                        <div style={valueStyle}>{status.pushSubscriptions?.encryptedUsers || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Pending</div>
                        <div style={{ ...valueStyle, color: status.pushSubscriptions?.migrationNeeded > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                          {status.pushSubscriptions?.migrationNeeded || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ alignSelf: 'center' }}>
                    {migrateButton(
                      handleMigratePushSubscriptions,
                      !status.config?.pushSubscriptionEncryptionEnabled,
                      migrating === 'pushSubs',
                      status.pushSubscriptions?.migrationNeeded || 0
                    )}
                  </div>
                </div>
                {!status.config?.pushSubscriptionEncryptionEnabled && (
                  <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Set PUSH_SUBSCRIPTION_KEY to enable
                  </div>
                )}
              </div>

              {/* Crew Membership Encryption (v2.24.0) */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '1rem' }}>🚀</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{T.Crew} Membership</span>
                      {statusBadge(status.config?.crewMembershipEncryptionEnabled, status.config?.crewMembershipEncryptionEnabled ? 'KEY SET' : 'NO KEY')}
                    </div>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={labelStyle}>Total {T.Crews}</div>
                        <div style={valueStyle}>{status.crewMembership?.totalCrews || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Encrypted</div>
                        <div style={valueStyle}>{status.crewMembership?.encryptedCrews || 0}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Pending</div>
                        <div style={{ ...valueStyle, color: status.crewMembership?.migrationNeeded > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                          {status.crewMembership?.migrationNeeded || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ alignSelf: 'center' }}>
                    {migrateButton(
                      handleMigrateCrewMembers,
                      !status.config?.crewMembershipEncryptionEnabled,
                      migrating === 'crewMembers',
                      status.crewMembership?.migrationNeeded || 0
                    )}
                  </div>
                </div>
                {!status.config?.crewMembershipEncryptionEnabled && (
                  <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Set CREW_MEMBERSHIP_KEY to enable
                  </div>
                )}
              </div>

              {/* Contacts (client-side encrypted) */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1rem' }}>📇</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Contact Lists</span>
                  {statusBadge(true, 'CLIENT-SIDE')}
                </div>
                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Encrypted on user devices with their E2EE keys. Server cannot decrypt.
                </div>
              </div>

              {/* Federation Cover Traffic (v2.28.0) */}
              {fedStatus?.enabled && (
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1rem' }}>📡</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Federation Cover Traffic</span>
                    {statusBadge(
                      fedStatus.decoy?.enabled && fedStatus.decoy?.activeTargets > 0,
                      fedStatus.decoy?.enabled ? FEDERATION.runningDark : FEDERATION.exposed
                    )}
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {fedStatus.decoy?.enabled
                      ? `${FEDERATION.coverTrafficEnabled} — ${fedStatus.decoy.activeTargets || 0} V2 targets`
                      : FEDERATION.coverTrafficDisabled
                    }
                  </div>
                </div>
              )}

              {/* Cache Stats */}
              {(status.waveParticipation?.cacheStats || status.pushSubscriptions?.cacheStats || status.crewMembership?.cacheStats) && (
                <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-surface)', border: '1px dashed var(--border-subtle)' }}>
                  <div style={{ ...labelStyle, marginBottom: '8px' }}>IN-MEMORY CACHE</div>
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    {status.waveParticipation?.cacheStats && (
                      <>
                        <span>Waves: {status.waveParticipation.cacheStats.waveCount}</span>
                        <span>Participants: {status.waveParticipation.cacheStats.userCount}</span>
                        <span>Mappings: {status.waveParticipation.cacheStats.totalMappings}</span>
                      </>
                    )}
                    {status.pushSubscriptions?.cacheStats && (
                      <>
                        <span style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '12px' }}>
                          Push Users: {status.pushSubscriptions.cacheStats.userCount}
                        </span>
                        <span>Push Subs: {status.pushSubscriptions.cacheStats.subscriptionCount}</span>
                      </>
                    )}
                    {status.crewMembership?.cacheStats && (
                      <>
                        <span style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '12px' }}>
                          Crews: {status.crewMembership.cacheStats.crewCount}
                        </span>
                        <span>Members: {status.crewMembership.cacheStats.userCount}</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Refresh Button */}
              <div style={{ marginTop: '16px', textAlign: 'right' }}>
                <button
                  onClick={loadStatus}
                  disabled={loading}
                  style={{
                    padding: isMobile ? '10px 16px' : '8px 14px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-dim)',
                    cursor: loading ? 'wait' : 'pointer',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.85rem' : '0.8rem',
                  }}
                >
                  ↻ REFRESH
                </button>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>
              Failed to load privacy status
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PrivacyDashboard;
