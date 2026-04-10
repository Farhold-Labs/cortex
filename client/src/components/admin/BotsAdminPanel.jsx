import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner, GlowText } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG } from '../../../messages.js';

const BotsAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [newApiKey, setNewApiKey] = useState(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState(null);

  // Form state
  const [botName, setBotName] = useState('');
  const [botDescription, setBotDescription] = useState('');
  const [enableWebhook, setEnableWebhook] = useState(false);

  // Load bots
  const loadBots = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI('/admin/bots');
      setBots(data.bots || []);
    } catch (err) {
      showToast(err.message || formatError('Failed to load bots'), 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen) loadBots();
  }, [isOpen, loadBots]);

  // Create bot
  const handleCreateBot = async () => {
    if (!botName || botName.length < 3) {
      showToast('Bot name must be at least 3 characters', 'error');
      return;
    }

    try {
      const data = await fetchAPI('/admin/bots', {
        method: 'POST',
        body: { name: botName, description: botDescription, enableWebhook },
      });

      // Show API key modal with the new key
      setNewApiKey(data.bot.apiKey);
      setNewWebhookSecret(data.bot.webhookSecret || null);
      setShowApiKeyModal(true);
      setShowCreateModal(false);

      // Reset form
      setBotName('');
      setBotDescription('');
      setEnableWebhook(false);

      loadBots();
      showToast(`Bot "${data.bot.name}" created`, 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to create bot'), 'error');
    }
  };

  // Update bot status
  const handleUpdateStatus = async (botId, status) => {
    try {
      await fetchAPI(`/admin/bots/${botId}`, {
        method: 'PATCH',
        body: { status },
      });
      showToast(`Bot ${status}`, 'success');
      loadBots();
    } catch (err) {
      showToast(err.message || formatError('Failed to update bot'), 'error');
    }
  };

  // Delete bot
  const handleDeleteBot = async (botId, botName) => {
    if (!confirm(CONFIRM_DIALOG.deleteBot(botName))) return;

    try {
      await fetchAPI(`/admin/bots/${botId}`, { method: 'DELETE' });
      showToast(`Bot "${botName}" deleted`, 'success');
      loadBots();
    } catch (err) {
      showToast(err.message || formatError('Failed to delete bot'), 'error');
    }
  };

  // Regenerate API key
  const handleRegenerateKey = async (botId) => {
    if (!confirm(CONFIRM_DIALOG.regenerateKey)) return;

    try {
      const data = await fetchAPI(`/admin/bots/${botId}/regenerate`, { method: 'POST' });
      setNewApiKey(data.apiKey);
      setNewWebhookSecret(null);
      setShowApiKeyModal(true);
      showToast('API key regenerated', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to regenerate key'), 'error');
    }
  };

  // View bot details
  const handleViewDetails = async (botId) => {
    try {
      const data = await fetchAPI(`/admin/bots/${botId}`);
      setSelectedBot(data.bot);
      setShowDetailsModal(true);
    } catch (err) {
      showToast(err.message || formatError('Failed to load bot details'), 'error');
    }
  };

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-teal)40',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>
          🤖 BOTS & WEBHOOKS
        </div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-teal)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-teal)' : 'var(--text-dim)',
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
              Loading bots...
            </div>
          ) : (
            <>
              {/* Info */}
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Bots can post messages to waves via API. Each bot has a unique API key and optional webhook URL.
              </div>

              {/* Create button */}
              <div style={{ marginBottom: '16px' }}>
                <button
                  onClick={() => setShowCreateModal(true)}
                  style={{
                    padding: isMobile ? '10px 16px' : '8px 14px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: 'var(--accent-teal)20',
                    border: '1px solid var(--accent-teal)',
                    color: 'var(--accent-teal)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.85rem' : '0.8rem',
                  }}
                >
                  + CREATE BOT
                </button>
              </div>

              {/* Bots list */}
              {bots.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  No bots created yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {bots.map(bot => (
                    <div
                      key={bot.id}
                      style={{
                        padding: '12px',
                        background: 'var(--bg-surface)',
                        border: `1px solid ${bot.status === 'active' ? 'var(--accent-green)40' : 'var(--text-dim)40'}`,
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        gap: '12px',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '1.2rem' }}>🤖</span>
                          <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>
                            {bot.name}
                          </span>
                          <span style={{
                            padding: '2px 6px',
                            fontSize: '0.65rem',
                            background: bot.status === 'active' ? 'var(--accent-green)20' : 'var(--text-dim)20',
                            color: bot.status === 'active' ? 'var(--accent-green)' : 'var(--text-dim)',
                            border: `1px solid ${bot.status === 'active' ? 'var(--accent-green)' : 'var(--text-dim)'}`,
                          }}>
                            {bot.status.toUpperCase()}
                          </span>
                        </div>
                        {bot.description && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginBottom: '6px' }}>
                            {bot.description}
                          </div>
                        )}
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>
                          Owner: {bot.owner_name} (@{bot.owner_handle}) •
                          Waves: {bot.wave_count} •
                          Pings: {bot.total_pings} •
                          API Calls: {bot.total_api_calls}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <button
                          onClick={() => handleViewDetails(bot.id)}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--accent-purple)20',
                            border: '1px solid var(--accent-purple)',
                            color: 'var(--accent-purple)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                          }}
                        >
                          DETAILS
                        </button>
                        <button
                          onClick={() => handleRegenerateKey(bot.id)}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--accent-amber)20',
                            border: '1px solid var(--accent-amber)',
                            color: 'var(--accent-amber)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                          }}
                        >
                          REGEN KEY
                        </button>
                        {bot.status === 'active' && (
                          <button
                            onClick={() => handleUpdateStatus(bot.id, 'suspended')}
                            style={{
                              padding: '6px 10px',
                              background: 'transparent',
                              border: '1px solid var(--accent-orange)',
                              color: 'var(--accent-orange)',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                            }}
                          >
                            SUSPEND
                          </button>
                        )}
                        {bot.status === 'suspended' && (
                          <button
                            onClick={() => handleUpdateStatus(bot.id, 'active')}
                            style={{
                              padding: '6px 10px',
                              background: 'var(--accent-green)20',
                              border: '1px solid var(--accent-green)',
                              color: 'var(--accent-green)',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                            }}
                          >
                            ACTIVATE
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteBot(bot.id, bot.name)}
                          style={{
                            padding: '6px 10px',
                            background: 'transparent',
                            border: '1px solid var(--status-error)',
                            color: 'var(--status-error)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                          }}
                        >
                          DELETE
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Create Bot Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            width: '100%', maxWidth: '500px',
            background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
            border: '2px solid var(--accent-teal)80', padding: isMobile ? '20px' : '24px',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: '20px' }}>
              <GlowText color="var(--accent-teal)" size={isMobile ? '1rem' : '1.1rem'}>Create Bot</GlowText>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                BOT NAME *
              </label>
              <input
                type="text"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="e.g., GitHub Notifier"
                maxLength={50}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                DESCRIPTION
              </label>
              <textarea
                value={botDescription}
                onChange={(e) => setBotDescription(e.target.value)}
                placeholder="What does this bot do?"
                maxLength={500}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  resize: 'vertical',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableWebhook}
                  onChange={(e) => setEnableWebhook(e.target.checked)}
                />
                <span style={{ color: 'var(--text-primary)', fontSize: '0.8rem' }}>
                  Enable webhook endpoint
                </span>
              </label>
              {enableWebhook && (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '4px', marginLeft: '24px' }}>
                  A webhook secret will be generated for secure external integrations
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
              <button
                onClick={handleCreateBot}
                style={{
                  padding: '10px 16px',
                  background: 'var(--accent-teal)',
                  border: '1px solid var(--accent-teal)',
                  color: 'var(--bg-primary)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                CREATE BOT
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* API Key Display Modal */}
      {showApiKeyModal && newApiKey && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
        }} onClick={() => {
          setShowApiKeyModal(false);
          setNewApiKey(null);
          setNewWebhookSecret(null);
        }}>
          <div style={{
            width: '100%', maxWidth: '550px',
            background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
            border: '2px solid var(--accent-orange)80', padding: isMobile ? '20px' : '24px',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: '20px' }}>
              <GlowText color="var(--accent-orange)" size={isMobile ? '1rem' : '1.1rem'}>⚠️ Save Your API Key</GlowText>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ color: 'var(--accent-orange)', fontSize: '0.85rem', fontWeight: 500 }}>
              This API key will only be shown once. Save it securely!
            </div>

            <div>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                API KEY
              </label>
              <div style={{
                padding: '12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent-teal)',
                color: 'var(--accent-teal)',
                fontSize: '0.8rem',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}>
                {newApiKey}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newApiKey);
                  showToast('API key copied!', 'success');
                }}
                style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  background: 'var(--accent-teal)20',
                  border: '1px solid var(--accent-teal)',
                  color: 'var(--accent-teal)',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                📋 COPY KEY
              </button>
            </div>

            {newWebhookSecret && (
              <div>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                  WEBHOOK SECRET
                </label>
                <div style={{
                  padding: '12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--accent-purple)',
                  color: 'var(--accent-purple)',
                  fontSize: '0.8rem',
                  wordBreak: 'break-all',
                  fontFamily: 'monospace',
                }}>
                  {newWebhookSecret}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newWebhookSecret);
                    showToast('Webhook secret copied!', 'success');
                  }}
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    background: 'var(--accent-purple)20',
                    border: '1px solid var(--accent-purple)',
                    color: 'var(--accent-purple)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                  }}
                >
                  📋 COPY SECRET
                </button>
              </div>
            )}

            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
              Use this key in your bot's Authorization header:
              <code style={{
                display: 'block',
                marginTop: '8px',
                padding: '8px',
                background: 'var(--bg-elevated)',
                fontSize: '0.7rem',
              }}>
                Authorization: Bearer {newApiKey.substring(0, 20)}...
              </code>
            </div>

            <button
              onClick={() => {
                setShowApiKeyModal(false);
                setNewApiKey(null);
                setNewWebhookSecret(null);
              }}
              style={{
                padding: '10px 16px',
                background: 'var(--accent-green)',
                border: '1px solid var(--accent-green)',
                color: 'var(--bg-primary)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              I'VE SAVED IT
            </button>
            </div>
          </div>
        </div>
      )}

      {/* Bot Details Modal */}
      {showDetailsModal && selectedBot && (
        <BotDetailsModal
          bot={selectedBot}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedBot(null);
          }}
          fetchAPI={fetchAPI}
          showToast={showToast}
          isMobile={isMobile}
          onUpdate={loadBots}
        />
      )}
    </div>
  );
};

// Bot Details Modal Component (separate for complexity management)
export default BotsAdminPanel;
