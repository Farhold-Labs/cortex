import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG, FEDERATION } from '../../../messages.js';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';

const AlertSubscriptionsPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [subscriptions, setSubscriptions] = useState([]);
  const [federationNodes, setFederationNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSub, setEditingSub] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formSourceNode, setFormSourceNode] = useState('');
  const [formCategories, setFormCategories] = useState({ system: false, announcement: false, emergency: false });

  const availableCategories = ['system', 'announcement', 'emergency'];

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load both subscriptions and federation nodes
      const [subsData, nodesData] = await Promise.all([
        fetchAPI('/admin/alert-subscriptions'),
        fetchAPI('/admin/federation/nodes').catch(() => ({ nodes: [] })) // Gracefully handle if federation disabled
      ]);
      setSubscriptions(subsData.subscriptions || []);
      setFederationNodes(nodesData.nodes || []);
    } catch (err) {
      if (!err.message?.includes('401')) {
        showToast(err.message || formatError('Failed to load subscriptions'), 'error');
      }
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  const loadSubscriptions = loadData; // Alias for refresh

  useEffect(() => {
    if (isOpen && subscriptions.length === 0 && federationNodes.length === 0) {
      loadData();
    }
  }, [isOpen, subscriptions.length, federationNodes.length, loadData]);

  const resetForm = () => {
    setFormSourceNode('');
    setFormCategories({ system: false, announcement: false, emergency: false });
    setEditingSub(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (sub) => {
    setEditingSub(sub);
    setFormSourceNode(sub.source_node);
    const cats = JSON.parse(sub.categories || '[]');
    setFormCategories({
      system: cats.includes('system'),
      announcement: cats.includes('announcement'),
      emergency: cats.includes('emergency'),
    });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    const selectedCats = Object.entries(formCategories)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (!formSourceNode && !editingSub) {
      showToast(FEDERATION.selectAlliedPort, 'error');
      return;
    }
    if (selectedCats.length === 0) {
      showToast('Please select at least one category', 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingSub) {
        await fetchAPI(`/admin/alert-subscriptions/${editingSub.id}`, {
          method: 'PUT',
          body: { categories: selectedCats }
        });
        showToast('Subscription updated', 'success');
      } else {
        await fetchAPI('/admin/alert-subscriptions', {
          method: 'POST',
          body: { sourceNode: formSourceNode, categories: selectedCats }
        });
        showToast('Subscription created', 'success');
      }
      setShowAddModal(false);
      loadSubscriptions();
    } catch (err) {
      showToast(err.message || formatError('Failed to save subscription'), 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (subId) => {
    if (!confirm(CONFIRM_DIALOG.unsubscribe)) return;
    try {
      await fetchAPI(`/admin/alert-subscriptions/${subId}`, { method: 'DELETE' });
      showToast('Subscription removed', 'success');
      loadSubscriptions();
    } catch (err) {
      showToast(err.message || formatError('Failed to remove subscription'), 'error');
    }
  };

  const handleToggleStatus = async (sub) => {
    try {
      await fetchAPI(`/admin/alert-subscriptions/${sub.id}`, {
        method: 'PUT',
        body: { status: sub.status === 'active' ? 'paused' : 'active' }
      });
      showToast(`Subscription ${sub.status === 'active' ? 'paused' : 'resumed'}`, 'success');
      loadSubscriptions();
    } catch (err) {
      showToast(err.message || formatError('Failed to update subscription'), 'error');
    }
  };

  // Get nodes we haven't subscribed to yet
  const subscribedNodes = subscriptions.map(s => s.source_node);
  const availableNodes = federationNodes.filter(n => !subscribedNodes.includes(n.node_name) && n.status === 'active');

  return (
    <CollapsibleSection title="ALERT SUBSCRIPTIONS" isOpen={isOpen} onToggle={onToggle} isMobile={isMobile}>
        {loading ? (
          <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>Loading...</div>
        ) : (
          <>
            {/* Info text */}
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '12px' }}>
              {FEDERATION.subscribeInfo}
            </div>

            {/* Add button */}
            <div style={{ marginBottom: '16px' }}>
              <button onClick={openAddModal} disabled={availableNodes.length === 0} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-purple)20',
                border: '1px solid var(--accent-purple)',
                color: 'var(--accent-purple)',
                cursor: availableNodes.length === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                opacity: availableNodes.length === 0 ? 0.5 : 1,
              }}>+ NEW SUBSCRIPTION</button>
              {availableNodes.length === 0 && federationNodes.length > 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '8px' }}>
                  {FEDERATION.subscribedToAllPorts}
                </span>
              )}
              {federationNodes.length === 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '8px' }}>
                  {FEDERATION.noAlliedPortsConfigured}
                </span>
              )}
            </div>

            {/* Subscriptions list */}
            {subscriptions.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                {FEDERATION.noAlertSubscriptions}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {subscriptions.map(sub => {
                  const cats = JSON.parse(sub.categories || '[]');
                  return (
                    <div key={sub.id} style={{
                      padding: '12px',
                      background: 'var(--bg-surface)',
                      border: `1px solid ${sub.status === 'active' ? 'var(--accent-purple)40' : 'var(--border-subtle)'}`,
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      gap: '8px',
                      alignItems: isMobile ? 'flex-start' : 'center',
                      opacity: sub.status === 'paused' ? 0.6 : 1,
                    }}>
                      {/* Node name and categories */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <span style={{
                            color: 'var(--text-primary)',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                          }}>
                            {sub.source_node}
                          </span>
                          {sub.status === 'paused' && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>(paused)</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {cats.map(cat => (
                            <span key={cat} style={{
                              fontSize: '0.65rem',
                              padding: '2px 6px',
                              background: 'var(--accent-purple)20',
                              border: '1px solid var(--accent-purple)40',
                              color: 'var(--accent-purple)',
                              fontFamily: 'monospace',
                            }}>
                              {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => handleToggleStatus(sub)} style={{
                          padding: '4px 8px',
                          background: 'transparent',
                          border: '1px solid var(--border-secondary)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                        }}>{sub.status === 'active' ? 'PAUSE' : 'RESUME'}</button>
                        <button onClick={() => openEditModal(sub)} style={{
                          padding: '4px 8px',
                          background: 'transparent',
                          border: '1px solid var(--border-secondary)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                        }}>EDIT</button>
                        <button onClick={() => handleDelete(sub.id)} style={{
                          padding: '4px 8px',
                          background: 'transparent',
                          border: '1px solid var(--accent-orange)40',
                          color: 'var(--accent-orange)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                        }}>DEL</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.8)', padding: '16px',
        }} onClick={() => setShowAddModal(false)}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--accent-purple)',
            borderRadius: '4px', padding: isMobile ? '16px' : '24px',
            maxWidth: '400px', width: '100%',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--accent-purple)', fontFamily: 'monospace' }}>
              {editingSub ? 'EDIT SUBSCRIPTION' : 'NEW SUBSCRIPTION'}
            </h3>

            {/* Node selector */}
            {!editingSub && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>{FEDERATION.alliedPortLabel}</label>
                <select
                  value={formSourceNode}
                  onChange={e => setFormSourceNode(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="">{FEDERATION.selectPort}</option>
                  {availableNodes.map(node => (
                    <option key={node.id} value={node.node_name}>{node.node_name}</option>
                  ))}
                </select>
              </div>
            )}

            {editingSub && (
              <div style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                Node: <span style={{ color: 'var(--accent-purple)' }}>{editingSub.source_node}</span>
              </div>
            )}

            {/* Category checkboxes */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>CATEGORIES TO RECEIVE</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {availableCategories.map(cat => (
                  <label key={cat} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'monospace',
                  }}>
                    <input
                      type="checkbox"
                      checked={formCategories[cat] || false}
                      onChange={e => setFormCategories(prev => ({ ...prev, [cat]: e.target.checked }))}
                      style={{ accentColor: 'var(--accent-purple)' }}
                    />
                    {cat}
                  </label>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddModal(false)} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'transparent',
                border: '1px solid var(--border-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
              }}>CANCEL</button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-purple)20',
                border: '1px solid var(--accent-purple)',
                color: 'var(--accent-purple)',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'SAVING...' : (editingSub ? 'UPDATE' : 'SUBSCRIBE')}</button>
            </div>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
};

// ============ FEDERATION ADMIN PANEL ============
export default AlertSubscriptionsPanel;
