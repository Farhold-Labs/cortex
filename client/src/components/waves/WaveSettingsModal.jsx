import React, { useState, useEffect } from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { PRIVACY_LEVELS } from '../../config/constants.js';
import { SUCCESS, CONFIRM_DIALOG, FEDERATION, formatError } from '../../../messages.js';
import { useE2EE } from '../../../e2ee-context.jsx';

const WaveSettingsModal = ({ isOpen, onClose, wave, groups, fetchAPI, showToast, onUpdate, participants = [], showParticipants, setShowParticipants, federationEnabled, currentUserId, onFederate, isMobile }) => {
  const e2ee = useE2EE();
  const [privacy, setPrivacy] = useState(wave?.privacy || 'private');
  const [selectedGroup, setSelectedGroup] = useState(wave?.groupId || null);
  const [title, setTitle] = useState(wave?.title || '');
  const [decrypting, setDecrypting] = useState(false);

  // Webhooks state
  const [webhooks, setWebhooks] = useState([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState(null);
  const [testingWebhook, setTestingWebhook] = useState(null);

  // New webhook form state
  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookPlatform, setWebhookPlatform] = useState('discord');
  const [webhookIncludeBots, setWebhookIncludeBots] = useState(true);

  // Posting tokens state
  const [tokens, setTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [showAddToken, setShowAddToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [revealedToken, setRevealedToken] = useState(null); // { id, plaintext }

  const isWaveCreator = wave?.createdBy === currentUserId || wave?.creatorId === currentUserId;

  useEffect(() => {
    if (wave) {
      setPrivacy(wave.privacy);
      setSelectedGroup(wave.groupId);
      setTitle(wave.title);
    }
  }, [wave]);

  // Fetch webhooks when modal opens (only for wave creator)
  useEffect(() => {
    if (isOpen && wave && isWaveCreator) {
      setLoadingWebhooks(true);
      fetchAPI(`/waves/${wave.id}/webhooks`)
        .then(data => setWebhooks(data.webhooks || []))
        .catch(err => console.error('Failed to load webhooks:', err))
        .finally(() => setLoadingWebhooks(false));
    }
  }, [isOpen, wave?.id, isWaveCreator]);

  // Fetch posting tokens when modal opens (only for wave creator)
  useEffect(() => {
    if (isOpen && wave && isWaveCreator) {
      setLoadingTokens(true);
      fetchAPI(`/waves/${wave.id}/tokens`)
        .then(data => setTokens(data.tokens || []))
        .catch(err => console.error('Failed to load posting tokens:', err))
        .finally(() => setLoadingTokens(false));
    }
  }, [isOpen, wave?.id, isWaveCreator]);

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) {
      showToast('Token name is required', 'error');
      return;
    }
    try {
      const data = await fetchAPI(`/waves/${wave.id}/tokens`, {
        method: 'POST',
        body: { name: newTokenName.trim() },
      });
      setTokens([...tokens, data.token]);
      setRevealedToken({ id: data.token.id, plaintext: data.plaintext });
      setNewTokenName('');
      setShowAddToken(false);
    } catch (err) {
      showToast(err.message || formatError('Failed to create token'), 'error');
    }
  };

  const handleRevokeToken = async (tokenId) => {
    if (!window.confirm('Revoke this posting token? Any scripts using it will stop working.')) return;
    try {
      await fetchAPI(`/waves/${wave.id}/tokens/${tokenId}`, { method: 'DELETE' });
      setTokens(tokens.filter(t => t.id !== tokenId));
      if (revealedToken?.id === tokenId) setRevealedToken(null);
      showToast('Token revoked', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to revoke token'), 'error');
    }
  };

  const resetWebhookForm = () => {
    setWebhookName('');
    setWebhookUrl('');
    setWebhookPlatform('discord');
    setWebhookIncludeBots(true);
    setShowAddWebhook(false);
    setEditingWebhook(null);
  };

  const handleAddWebhook = async () => {
    if (!webhookName.trim() || !webhookUrl.trim()) {
      showToast('Name and URL are required', 'error');
      return;
    }

    try {
      const data = await fetchAPI(`/waves/${wave.id}/webhooks`, {
        method: 'POST',
        body: {
          name: webhookName,
          url: webhookUrl,
          platform: webhookPlatform,
          includeBotMessages: webhookIncludeBots,
        },
      });
      setWebhooks([...webhooks, data.webhook]);
      showToast('Webhook created', 'success');
      resetWebhookForm();
    } catch (err) {
      showToast(err.message || formatError('Failed to create webhook'), 'error');
    }
  };

  const handleUpdateWebhook = async (webhookId, updates) => {
    try {
      const data = await fetchAPI(`/webhooks/${webhookId}`, {
        method: 'PUT',
        body: updates,
      });
      setWebhooks(webhooks.map(w => w.id === webhookId ? data.webhook : w));
      if (updates.enabled !== undefined) {
        showToast(updates.enabled ? 'Webhook enabled' : 'Webhook disabled', 'success');
      }
    } catch (err) {
      showToast(err.message || formatError('Failed to update webhook'), 'error');
    }
  };

  const handleDeleteWebhook = async (webhookId) => {
    if (!window.confirm(CONFIRM_DIALOG.deleteWebhook)) return;
    try {
      await fetchAPI(`/webhooks/${webhookId}`, { method: 'DELETE' });
      setWebhooks(webhooks.filter(w => w.id !== webhookId));
      showToast('Webhook deleted', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to delete webhook'), 'error');
    }
  };

  const handleTestWebhook = async (webhookId) => {
    setTestingWebhook(webhookId);
    try {
      await fetchAPI(`/webhooks/${webhookId}/test`, { method: 'POST' });
      showToast('Test message sent!', 'success');
    } catch (err) {
      showToast(err.message || formatError('Test failed'), 'error');
    } finally {
      setTestingWebhook(null);
    }
  };

  if (!isOpen || !wave) return null;

  const handleSave = async () => {
    try {
      await fetchAPI(`/waves/${wave.id}`, {
        method: 'PUT',
        body: { title, privacy, groupId: privacy === 'group' ? selectedGroup : null },
      });
      showToast(SUCCESS.waveUpdated, 'success');
      onUpdate();
      onClose();
    } catch (err) {
      showToast(err.message || formatError('Failed to update wave'), 'error');
    }
  };

  const handleDecryptWave = async () => {
    if (!wave.encrypted) {
      showToast('Wave is not encrypted', 'error');
      return;
    }

    if (!e2ee.isUnlocked) {
      showToast('Unlock E2EE first to decrypt this wave', 'error');
      return;
    }

    const confirmed = window.confirm(
      'This will permanently decrypt all messages in this wave. Encrypted content will be converted to plain text. This cannot be undone.\n\nContinue?'
    );
    if (!confirmed) return;

    setDecrypting(true);
    try {
      // Fetch all pings in the wave
      const pingsData = await fetchAPI(`/waves/${wave.id}/pings`);
      const pings = pingsData.pings || [];

      console.log(`Decrypting ${pings.length} pings in wave ${wave.id}...`);

      // Decrypt each ping
      const decryptedPings = [];
      for (const ping of pings) {
        try {
          // Check if ping is encrypted (has nonce)
          if (ping.encrypted && ping.nonce) {
            const decryptedContent = await e2ee.decryptPing(ping.content, ping.nonce, wave.id, ping.keyVersion);
            decryptedPings.push({
              id: ping.id,
              content: decryptedContent
            });
          } else {
            // Already decrypted or not encrypted
            decryptedPings.push({
              id: ping.id,
              content: ping.content
            });
          }
        } catch (decryptErr) {
          console.error(`Failed to decrypt ping ${ping.id}:`, decryptErr);
          // If decryption fails, keep original content (might already be decrypted)
          decryptedPings.push({
            id: ping.id,
            content: ping.content
          });
        }
      }

      // Send decrypted pings to server
      await fetchAPI(`/waves/${wave.id}/decrypt`, {
        method: 'POST',
        body: { pings: decryptedPings }
      });

      showToast('Wave decrypted successfully! All messages are now unencrypted.', 'success');
      onUpdate();
      onClose();
    } catch (err) {
      console.error('Wave decryption error:', err);
      showToast(err.message || formatError('Failed to decrypt wave'), 'error');
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
    }}>
      <div style={{
        width: '100%', maxWidth: '450px', maxHeight: '80vh', overflowY: 'auto',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-teal)40', padding: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <GlowText color="var(--accent-teal)" size="1.1rem">Wave Settings</GlowText>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>TITLE</div>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{
            width: '100%', padding: '10px 12px', boxSizing: 'border-box',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
          }} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>PRIVACY LEVEL</div>
          {Object.entries(PRIVACY_LEVELS).map(([key, config]) => (
            <button key={key} onClick={() => { setPrivacy(key); if (key !== 'group') setSelectedGroup(null); }}
              style={{
                width: '100%', padding: '12px', marginBottom: '8px', textAlign: 'left',
                background: privacy === key ? config.bgColor : 'var(--bg-elevated)',
                border: `1px solid ${privacy === key ? config.color : 'var(--border-subtle)'}`, cursor: 'pointer',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: config.color, fontSize: '1.1rem' }}>{config.icon}</span>
                <div>
                  <div style={{ color: config.color }}>{config.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{config.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {privacy === 'group' && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>SELECT CREW</div>
            {groups.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '10px', background: 'var(--bg-elevated)' }}>No crews available</div>
            ) : groups.map(g => (
              <button key={g.id} onClick={() => setSelectedGroup(g.id)} style={{
                width: '100%', padding: '10px', marginBottom: '4px', textAlign: 'left',
                background: selectedGroup === g.id ? 'var(--accent-amber)15' : 'var(--bg-elevated)',
                border: `1px solid ${selectedGroup === g.id ? 'var(--accent-amber)' : 'var(--border-subtle)'}`, cursor: 'pointer',
              }}>
                <div style={{ color: 'var(--text-primary)' }}>{g.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{g.memberCount} members</div>
              </button>
            ))}
          </div>
        )}

        {/* Participants Section */}
        {participants.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>PARTICIPANTS ({participants.length})</div>
            <button
              onClick={() => { setShowParticipants(!showParticipants); onClose(); }}
              style={{
                width: '100%', padding: '12px', textAlign: 'left',
                background: showParticipants ? 'var(--accent-green)15' : 'var(--bg-elevated)',
                border: `1px solid ${showParticipants ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                color: showParticipants ? 'var(--accent-green)' : 'var(--text-primary)',
                cursor: 'pointer', fontFamily: 'monospace',
              }}
            >
              {showParticipants ? '✓ Participants panel visible' : 'Show participants panel'}
            </button>
          </div>
        )}

        {/* Federation Section */}
        {federationEnabled && wave?.createdBy === currentUserId && wave?.federationState !== 'participant' && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>{FEDERATION.verseSection}</div>
            <button
              onClick={onFederate}
              style={{
                width: '100%', padding: '12px', textAlign: 'left',
                background: wave?.federationState === 'origin' ? 'var(--accent-teal)15' : 'var(--bg-elevated)',
                border: `1px solid ${wave?.federationState === 'origin' ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
                color: wave?.federationState === 'origin' ? 'var(--accent-teal)' : 'var(--text-primary)',
                cursor: 'pointer', fontFamily: 'monospace',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              <span>◇</span>
              {wave?.federationState === 'origin' ? FEDERATION.manageTravelers : FEDERATION.broadcastBtn}
            </button>
          </div>
        )}

        {/* Decrypt Wave Button - Only show for encrypted waves */}
        {wave.encrypted && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>ENCRYPTION</div>
            <button
              onClick={handleDecryptWave}
              disabled={decrypting}
              style={{
                width: '100%', padding: '12px', textAlign: 'left',
                background: 'var(--accent-orange)15',
                border: '1px solid var(--accent-orange)',
                color: 'var(--accent-orange)',
                cursor: decrypting ? 'wait' : 'pointer',
                fontFamily: 'monospace',
                display: 'flex', alignItems: 'center', gap: '8px',
                opacity: decrypting ? 0.6 : 1,
              }}
            >
              <span>🔓</span>
              <div style={{ flex: 1 }}>
                <div>{decrypting ? 'Decrypting wave...' : 'Decrypt Wave (Remove E2EE)'}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Convert all encrypted messages to plain text
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Outgoing Webhooks - Only show for wave creator */}
        {isWaveCreator && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
              OUTGOING WEBHOOKS
              <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
                ({webhooks.length}/5)
              </span>
            </div>

            {loadingWebhooks ? (
              <div style={{ color: 'var(--text-muted)', padding: '10px', background: 'var(--bg-elevated)' }}>
                Loading webhooks...
              </div>
            ) : (
              <>
                {/* Webhook List */}
                {webhooks.map(webhook => (
                  <div key={webhook.id} style={{
                    padding: '10px 12px', marginBottom: '8px',
                    background: webhook.enabled ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                    border: `1px solid ${webhook.enabled ? 'var(--border-subtle)' : 'var(--border-dim)'}`,
                    opacity: webhook.enabled ? 1 : 0.6,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.9rem' }}>
                          {webhook.platform === 'discord' ? '💬' : webhook.platform === 'slack' ? '📱' : webhook.platform === 'teams' ? '👥' : '🔗'}
                        </span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{webhook.name}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => handleTestWebhook(webhook.id)}
                          disabled={testingWebhook === webhook.id || !webhook.enabled}
                          title="Send test message"
                          style={{
                            padding: '4px 8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                            color: 'var(--text-dim)', cursor: testingWebhook === webhook.id ? 'wait' : 'pointer', fontSize: '0.75rem',
                          }}
                        >
                          {testingWebhook === webhook.id ? '...' : 'Test'}
                        </button>
                        <button
                          onClick={() => handleUpdateWebhook(webhook.id, { enabled: !webhook.enabled })}
                          title={webhook.enabled ? 'Disable' : 'Enable'}
                          style={{
                            padding: '4px 8px', background: webhook.enabled ? 'var(--accent-green)20' : 'var(--bg-surface)',
                            border: `1px solid ${webhook.enabled ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                            color: webhook.enabled ? 'var(--accent-green)' : 'var(--text-dim)', cursor: 'pointer', fontSize: '0.75rem',
                          }}
                        >
                          {webhook.enabled ? 'On' : 'Off'}
                        </button>
                        <button
                          onClick={() => handleDeleteWebhook(webhook.id)}
                          title="Delete webhook"
                          style={{
                            padding: '4px 8px', background: 'var(--bg-surface)', border: '1px solid var(--accent-red)',
                            color: 'var(--accent-red)', cursor: 'pointer', fontSize: '0.75rem',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {webhook.platform.charAt(0).toUpperCase() + webhook.platform.slice(1)} • {webhook.url}
                      {webhook.totalSent > 0 && ` • ${webhook.totalSent} sent`}
                      {webhook.totalErrors > 0 && <span style={{ color: 'var(--accent-red)' }}> • {webhook.totalErrors} errors</span>}
                    </div>
                  </div>
                ))}

                {/* Add Webhook Form */}
                {showAddWebhook ? (
                  <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--accent-purple)', marginBottom: '8px' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <input
                        type="text"
                        placeholder="Webhook name (e.g., Discord Updates)"
                        value={webhookName}
                        onChange={(e) => setWebhookName(e.target.value)}
                        style={{
                          width: '100%', padding: '8px', boxSizing: 'border-box',
                          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                          color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit',
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <select
                        value={webhookPlatform}
                        onChange={(e) => setWebhookPlatform(e.target.value)}
                        style={{
                          width: '100%', padding: '8px', boxSizing: 'border-box',
                          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                          color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit',
                        }}
                      >
                        <option value="discord">Discord</option>
                        <option value="slack">Slack</option>
                        <option value="teams">Microsoft Teams</option>
                        <option value="generic">Generic (JSON)</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <input
                        type="url"
                        placeholder="Webhook URL (https://...)"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        style={{
                          width: '100%', padding: '8px', boxSizing: 'border-box',
                          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                          color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit',
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        <input
                          type="checkbox"
                          checked={webhookIncludeBots}
                          onChange={(e) => setWebhookIncludeBots(e.target.checked)}
                        />
                        Include bot messages
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={resetWebhookForm}
                        style={{
                          flex: 1, padding: '8px', background: 'transparent',
                          border: '1px solid var(--border-subtle)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.85rem',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAddWebhook}
                        style={{
                          flex: 1, padding: '8px', background: 'var(--accent-purple)20',
                          border: '1px solid var(--accent-purple)', color: 'var(--accent-purple)', cursor: 'pointer', fontSize: '0.85rem',
                        }}
                      >
                        Add Webhook
                      </button>
                    </div>
                  </div>
                ) : webhooks.length < 5 && (
                  <button
                    onClick={() => setShowAddWebhook(true)}
                    style={{
                      width: '100%', padding: '10px', textAlign: 'left',
                      background: 'var(--bg-elevated)', border: '1px dashed var(--border-subtle)',
                      color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}
                  >
                    <span>+</span> Add webhook (Discord, Slack, etc.)
                  </button>
                )}

                {webhooks.length === 0 && !showAddWebhook && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Auto-forward messages to Discord, Slack, or other services
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Posting Tokens - Only show for wave creator */}
        {isWaveCreator && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
              POSTING TOKENS
              <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
                ({tokens.length}/10)
              </span>
            </div>

            {/* Revealed token — shown once after creation */}
            {revealedToken && (
              <div style={{
                padding: '10px 12px', marginBottom: '8px',
                background: 'var(--accent-amber)10', border: '1px solid var(--accent-amber)',
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', marginBottom: '6px' }}>
                  Token created — copy it now, it won't be shown again:
                </div>
                <div style={{
                  fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-primary)',
                  wordBreak: 'break-all', background: 'var(--bg-surface)', padding: '6px 8px',
                  border: '1px solid var(--border-subtle)', marginBottom: '6px',
                }}>
                  {revealedToken.plaintext}
                </div>
                <button
                  onClick={() => { navigator.clipboard?.writeText(revealedToken.plaintext); showToast('Token copied', 'success'); }}
                  style={{
                    padding: '4px 10px', background: 'var(--accent-amber)20',
                    border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)',
                    cursor: 'pointer', fontSize: '0.75rem', marginRight: '8px',
                  }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setRevealedToken(null)}
                  style={{
                    padding: '4px 10px', background: 'transparent',
                    border: '1px solid var(--border-subtle)', color: 'var(--text-dim)',
                    cursor: 'pointer', fontSize: '0.75rem',
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {loadingTokens ? (
              <div style={{ color: 'var(--text-muted)', padding: '10px', background: 'var(--bg-elevated)' }}>
                Loading tokens...
              </div>
            ) : (
              <>
                {/* Token List */}
                {tokens.map(token => (
                  <div key={token.id} style={{
                    padding: '10px 12px', marginBottom: '8px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{token.name}</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Created {new Date(token.createdAt).toLocaleDateString()}
                          {token.lastUsedAt && ` • Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeToken(token.id)}
                        style={{
                          padding: '4px 8px', background: 'var(--bg-surface)',
                          border: '1px solid var(--accent-red)', color: 'var(--accent-red)',
                          cursor: 'pointer', fontSize: '0.75rem',
                        }}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}

                {/* Create Token Form */}
                {showAddToken ? (
                  <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--accent-amber)', marginBottom: '8px' }}>
                    <input
                      type="text"
                      placeholder="Token name (e.g., Status Bot)"
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateToken()}
                      style={{
                        width: '100%', padding: '8px', boxSizing: 'border-box',
                        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.85rem',
                        marginBottom: '8px',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => { setShowAddToken(false); setNewTokenName(''); }}
                        style={{
                          flex: 1, padding: '8px', background: 'transparent',
                          border: '1px solid var(--border-subtle)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.85rem',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateToken}
                        style={{
                          flex: 1, padding: '8px', background: 'var(--accent-amber)20',
                          border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)', cursor: 'pointer', fontSize: '0.85rem',
                        }}
                      >
                        Create Token
                      </button>
                    </div>
                  </div>
                ) : tokens.length < 10 && (
                  <button
                    onClick={() => setShowAddToken(true)}
                    style={{
                      width: '100%', padding: '10px', textAlign: 'left',
                      background: 'var(--bg-elevated)', border: '1px dashed var(--border-subtle)',
                      color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.8rem',
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}
                  >
                    <span>+</span> Create posting token
                  </button>
                )}

                {tokens.length === 0 && !showAddToken && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Post to this wave via API without a user account
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', background: 'transparent',
            border: '1px solid var(--border-primary)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
          }}>CANCEL</button>
          <button onClick={handleSave} style={{
            flex: 1, padding: '12px', background: 'var(--accent-teal)20',
            border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)', cursor: 'pointer', fontFamily: 'monospace',
          }}>SAVE</button>
        </div>
      </div>
    </div>
  );
};

export default WaveSettingsModal;
