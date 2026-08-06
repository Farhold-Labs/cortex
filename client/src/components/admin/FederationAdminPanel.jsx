import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG, FEDERATION } from '../../../messages.js';

const FederationAdminPanel = ({ fetchAPI, showToast, isMobile, refreshTrigger = 0, isOpen, onToggle }) => {
  const [status, setStatus] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nodeName, setNodeName] = useState('');
  const [editingIdentity, setEditingIdentity] = useState(false); // edit an already-configured identity name
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeUrl, setNewNodeUrl] = useState('');
  const [handshakeLoading, setHandshakeLoading] = useState(null);
  // Federation request system
  const [federationRequests, setFederationRequests] = useState([]);
  const [requestUrl, setRequestUrl] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(null);
  // Cover traffic (v2.28.0)
  const [decoyToggling, setDecoyToggling] = useState(false);

  const loadFederationData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusData, nodesData, requestsData] = await Promise.all([
        fetchAPI('/admin/federation/status'),
        fetchAPI('/admin/federation/nodes'),
        fetchAPI('/admin/federation/requests').catch(() => ({ requests: [] }))
      ]);
      setStatus(statusData);
      setNodes(nodesData.nodes || []);
      setFederationRequests(requestsData.requests || []);
      if (statusData.nodeName) {
        setNodeName(statusData.nodeName);
      }
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToLoadVerse), 'error');
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen) {
      loadFederationData();
    }
  }, [isOpen, loadFederationData, refreshTrigger]);

  const handleSetupIdentity = async () => {
    if (!nodeName.trim() || nodeName.length < 3) {
      showToast(FEDERATION.portNameMinLength, 'error');
      return;
    }
    try {
      await fetchAPI('/admin/federation/identity', {
        method: 'POST',
        body: { nodeName: nodeName.trim() }
      });
      showToast(FEDERATION.identityConfigured, 'success');
      setEditingIdentity(false);
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToConfigureIdentity), 'error');
    }
  };

  const handleAddNode = async () => {
    if (!newNodeName.trim() || !newNodeUrl.trim()) {
      showToast(FEDERATION.portNameUrlRequired, 'error');
      return;
    }
    try {
      await fetchAPI('/admin/federation/nodes', {
        method: 'POST',
        body: { nodeName: newNodeName.trim(), baseUrl: newNodeUrl.trim() }
      });
      showToast(FEDERATION.portAdded, 'success');
      setNewNodeName('');
      setNewNodeUrl('');
      setShowAddNode(false);
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToAddPort), 'error');
    }
  };

  const handleHandshake = async (nodeId) => {
    setHandshakeLoading(nodeId);
    try {
      const result = await fetchAPI(`/admin/federation/nodes/${nodeId}/handshake`, {
        method: 'POST'
      });
      showToast(result.message || FEDERATION.dockingSuccessful, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToDock), 'error');
    }
    setHandshakeLoading(null);
  };

  const handleDeleteNode = async (nodeId) => {
    if (!confirm(CONFIRM_DIALOG.removeFederationNode)) return;
    try {
      await fetchAPI(`/admin/federation/nodes/${nodeId}`, { method: 'DELETE' });
      showToast(FEDERATION.portRemoved, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToRemovePort), 'error');
    }
  };

  const handleStatusChange = async (nodeId, newStatus) => {
    try {
      await fetchAPI(`/admin/federation/nodes/${nodeId}`, {
        method: 'PUT',
        body: { status: newStatus }
      });
      showToast(`Port ${newStatus}`, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToUpdateStatus), 'error');
    }
  };

  // Send federation request to another server
  const handleSendRequest = async () => {
    if (!requestUrl.trim()) {
      showToast('Port URL is required', 'error');
      return;
    }
    setRequestLoading(true);
    try {
      const result = await fetchAPI('/admin/federation/request', {
        method: 'POST',
        body: {
          baseUrl: requestUrl.trim(),
          message: requestMessage.trim() || null
        }
      });
      showToast(result.message || FEDERATION.dockingRequestSent, 'success');
      setRequestUrl('');
      setRequestMessage('');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToSendRequest), 'error');
    }
    setRequestLoading(false);
  };

  // Accept incoming federation request
  const handleAcceptRequest = async (requestId) => {
    setAcceptLoading(requestId);
    try {
      const result = await fetchAPI(`/admin/federation/requests/${requestId}/accept`, {
        method: 'POST'
      });
      showToast(result.message || FEDERATION.dockingRequestAccepted, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToAcceptRequest), 'error');
    }
    setAcceptLoading(null);
  };

  // Decline incoming federation request
  const handleDeclineRequest = async (requestId) => {
    if (!confirm(CONFIRM_DIALOG.declineFederationRequest)) return;
    setAcceptLoading(requestId);
    try {
      await fetchAPI(`/admin/federation/requests/${requestId}/decline`, {
        method: 'POST'
      });
      showToast(FEDERATION.dockingRequestDeclined, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToDeclineRequest), 'error');
    }
    setAcceptLoading(null);
  };

  // Toggle cover traffic (v2.28.0)
  const handleToggleDecoy = async () => {
    setDecoyToggling(true);
    try {
      const newEnabled = !status?.decoy?.enabled;
      const result = await fetchAPI('/admin/federation/decoy', {
        method: 'POST',
        body: { enabled: newEnabled }
      });
      showToast(newEnabled ? FEDERATION.coverTrafficStarted : FEDERATION.coverTrafficStopped, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || 'Failed to toggle cover traffic', 'error');
    }
    setDecoyToggling(false);
  };

  const getStatusColor = (s) => {
    switch (s) {
      case 'active': return 'var(--accent-green)';
      case 'pending': return 'var(--accent-amber)';
      case 'outbound_pending': return 'var(--accent-teal)';
      case 'suspended': return 'var(--accent-orange)';
      case 'blocked': return 'var(--status-error)';
      case 'declined': return 'var(--text-dim)';
      default: return 'var(--text-dim)';
    }
  };

  const getStatusLabel = (s) => {
    switch (s) {
      case 'outbound_pending': return 'AWAITING RESPONSE';
      case 'declined': return 'DECLINED';
      default: return s.toUpperCase();
    }
  };

  return (
    <div style={{ marginTop: '20px', padding: isMobile ? '16px' : '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--accent-teal)40' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>{FEDERATION.panelHeading}</div>
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
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)' }}>Loading...</div>
          ) : (
            <>
              {/* Status Overview */}
      <div style={{
        marginTop: '16px',
        padding: isMobile ? '14px' : '16px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>Status</span>
          <span style={{
            padding: '2px 10px',
            background: status?.enabled ? 'var(--accent-green)20' : 'var(--text-dim)20',
            color: status?.enabled ? 'var(--accent-green)' : 'var(--text-dim)',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
          }}>
            {status?.enabled ? FEDERATION.verseEnabled : FEDERATION.verseDisabled}
          </span>
        </div>

        {!status?.enabled && (
          <div style={{
            padding: '12px',
            background: 'var(--accent-amber)10',
            border: '1px solid var(--accent-amber)40',
            color: 'var(--accent-amber)',
            fontSize: isMobile ? '0.85rem' : '0.8rem',
            marginBottom: '16px',
          }}>
            {FEDERATION.envHint}
          </div>
        )}

        {/* Server Identity Setup */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px', textTransform: 'uppercase' }}>
            {FEDERATION.portIdentity}
          </div>

          {status?.configured ? (
            editingIdentity ? (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  placeholder="cortex.example.com"
                  style={{
                    flex: 1, minWidth: '200px', padding: isMobile ? '12px' : '10px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.85rem',
                  }}
                />
                <button
                  onClick={handleSetupIdentity}
                  style={{
                    padding: isMobile ? '12px 20px' : '10px 20px', minHeight: isMobile ? '44px' : 'auto',
                    background: 'var(--accent-teal)20', border: '1px solid var(--accent-teal)',
                    color: 'var(--accent-teal)', cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.8rem',
                  }}
                >SAVE</button>
                <button
                  onClick={() => { setEditingIdentity(false); setNodeName(status.nodeName || ''); }}
                  style={{
                    padding: isMobile ? '12px 20px' : '10px 20px', minHeight: isMobile ? '44px' : 'auto',
                    background: 'transparent', border: '1px solid var(--border-primary)',
                    color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.8rem',
                  }}
                >CANCEL</button>
                <div style={{ width: '100%', color: 'var(--accent-orange)', fontSize: '0.65rem', marginTop: '2px' }}>
                  ⚠ Changing the identity name breaks trust with existing partners — you'll need to re-establish federation with them afterward. The keypair is kept (no key change).
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--accent-teal)', fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>
                  {status.nodeName}
                </span>
                <span style={{
                  padding: '2px 8px',
                  background: 'var(--accent-green)20',
                  color: 'var(--accent-green)',
                  fontSize: '0.7rem',
                }}>
                  {status.hasKeypair ? 'KEYPAIR OK' : 'NO KEYPAIR'}
                </span>
                <button
                  onClick={() => { setNodeName(status.nodeName || ''); setEditingIdentity(true); }}
                  style={{
                    padding: '4px 12px', background: 'transparent',
                    border: '1px solid var(--border-primary)', color: 'var(--text-dim)',
                    cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem',
                  }}
                >EDIT</button>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="farhold.example.com"
                style={{
                  flex: 1,
                  minWidth: '200px',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                }}
              />
              <button
                onClick={handleSetupIdentity}
                style={{
                  padding: isMobile ? '12px 20px' : '10px 20px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'var(--accent-teal)20',
                  border: '1px solid var(--accent-teal)',
                  color: 'var(--accent-teal)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                }}
              >
                CONFIGURE
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '24px', color: 'var(--text-dim)', fontSize: isMobile ? '0.85rem' : '0.8rem' }}>
          <span>{FEDERATION.alliedPortsCount}: <span style={{ color: 'var(--text-primary)' }}>{status?.trustedNodes || 0}</span></span>
          <span>{FEDERATION.activeCount}: <span style={{ color: 'var(--accent-green)' }}>{status?.activeNodes || 0}</span></span>
        </div>
      </div>

      {/* Cover Traffic Section (v2.28.0) */}
      {status?.enabled && (
        <div style={{
          marginTop: '16px',
          padding: isMobile ? '14px' : '16px',
          background: 'var(--bg-surface)',
          border: `1px solid ${status?.decoy?.enabled ? 'var(--accent-green)40' : 'var(--accent-amber)40'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              {FEDERATION.coverTrafficSection}
            </span>
            <span style={{
              padding: '2px 10px',
              background: status?.decoy?.enabled ? 'var(--accent-green)20' : 'var(--accent-amber)20',
              color: status?.decoy?.enabled ? 'var(--accent-green)' : 'var(--accent-amber)',
              fontSize: '0.75rem',
              textShadow: status?.decoy?.enabled ? '0 0 6px var(--accent-green)' : 'none',
            }}>
              {status?.decoy?.enabled ? FEDERATION.runningDark : FEDERATION.exposed}
            </span>
          </div>

          <div style={{ marginBottom: '12px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            {FEDERATION.coverTrafficDescription}
          </div>

          {status?.decoy?.enabled && (
            <div style={{ display: 'flex', gap: '24px', color: 'var(--text-dim)', fontSize: isMobile ? '0.85rem' : '0.8rem', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span>{FEDERATION.activeTargets}: <span style={{ color: 'var(--text-primary)' }}>{status.decoy.activeTargets || 0}</span></span>
              <span>{FEDERATION.decoysSent}: <span style={{ color: 'var(--text-primary)' }}>{status.decoy.sentTotal || 0}</span></span>
              {status.decoy.lastSentAt && (
                <span>{FEDERATION.lastDecoy}: <span style={{ color: 'var(--text-primary)' }}>{new Date(status.decoy.lastSentAt).toLocaleTimeString()}</span></span>
              )}
            </div>
          )}

          {!status?.decoy?.enabled && (
            <div style={{
              padding: '8px 12px',
              background: 'var(--accent-amber)10',
              border: '1px solid var(--accent-amber)20',
              color: 'var(--accent-amber)',
              fontSize: '0.75rem',
              marginBottom: '12px',
            }}>
              {FEDERATION.coverTrafficDisabled}
            </div>
          )}

          <button
            onClick={handleToggleDecoy}
            disabled={decoyToggling}
            style={{
              padding: isMobile ? '12px 20px' : '10px 20px',
              minHeight: isMobile ? '44px' : 'auto',
              background: status?.decoy?.enabled ? 'transparent' : 'var(--accent-green)20',
              border: `1px solid ${status?.decoy?.enabled ? 'var(--accent-amber)' : 'var(--accent-green)'}`,
              color: status?.decoy?.enabled ? 'var(--accent-amber)' : 'var(--accent-green)',
              cursor: decoyToggling ? 'wait' : 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.85rem' : '0.8rem',
              opacity: decoyToggling ? 0.6 : 1,
            }}
          >
            {decoyToggling ? '...' : status?.decoy?.enabled ? FEDERATION.stopCoverTraffic : FEDERATION.startCoverTraffic}
          </button>
        </div>
      )}

      {/* Request Federation Section */}
      {status?.configured && status?.enabled && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '12px' }}>
            {FEDERATION.requestDocking}
          </div>
          <div style={{
            padding: isMobile ? '14px' : '16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--accent-purple)40',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                value={requestUrl}
                onChange={(e) => setRequestUrl(e.target.value)}
                placeholder={FEDERATION.portUrlPlaceholder}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                  marginBottom: '8px',
                }}
              />
              <textarea
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                placeholder={FEDERATION.optionalMessagePlaceholder}
                rows={2}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                  resize: 'vertical',
                }}
              />
            </div>
            <button
              onClick={handleSendRequest}
              disabled={requestLoading || !requestUrl.trim()}
              style={{
                padding: isMobile ? '12px 20px' : '10px 20px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-purple)20',
                border: '1px solid var(--accent-purple)',
                color: 'var(--accent-purple)',
                cursor: requestLoading || !requestUrl.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                opacity: requestLoading || !requestUrl.trim() ? 0.6 : 1,
              }}
            >
              {requestLoading ? FEDERATION.sendingRequest : FEDERATION.sendRequest}
            </button>
            <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              {FEDERATION.requestDockingHelp}
            </div>
          </div>
        </div>
      )}

      {/* Incoming Federation Requests */}
      {federationRequests.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              {FEDERATION.incomingRequests}
            </span>
            <span style={{
              padding: '2px 8px',
              background: 'var(--accent-purple)20',
              color: 'var(--accent-purple)',
              fontSize: '0.7rem',
              borderRadius: '10px',
            }}>
              {federationRequests.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {federationRequests.map((request) => (
              <div
                key={request.id}
                style={{
                  padding: isMobile ? '14px' : '12px 16px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--accent-purple)40',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <span style={{ color: 'var(--accent-purple)', fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>
                      {request.fromNodeName}
                    </span>
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    {new Date(request.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div style={{ color: 'var(--text-dim)', fontSize: isMobile ? '0.8rem' : '0.75rem', marginBottom: '8px' }}>
                  {request.fromBaseUrl}
                </div>

                {request.message && (
                  <div style={{
                    padding: '8px',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                    fontSize: isMobile ? '0.85rem' : '0.8rem',
                    fontStyle: 'italic',
                    marginBottom: '12px',
                  }}>
                    "{request.message}"
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleAcceptRequest(request.id)}
                    disabled={acceptLoading === request.id}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'var(--accent-green)20',
                      border: '1px solid var(--accent-green)',
                      color: 'var(--accent-green)',
                      cursor: acceptLoading === request.id ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                      opacity: acceptLoading === request.id ? 0.6 : 1,
                    }}
                  >
                    {acceptLoading === request.id ? FEDERATION.accepting : FEDERATION.accept}
                  </button>
                  <button
                    onClick={() => handleDeclineRequest(request.id)}
                    disabled={acceptLoading === request.id}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'transparent',
                      border: '1px solid var(--accent-orange)',
                      color: 'var(--accent-orange)',
                      cursor: acceptLoading === request.id ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                      opacity: acceptLoading === request.id ? 0.6 : 1,
                    }}
                  >
                    {FEDERATION.denyDocking}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trusted Nodes */}
      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase' }}>{FEDERATION.alliedPorts}</span>
          <button
            onClick={() => setShowAddNode(!showAddNode)}
            style={{
              padding: isMobile ? '8px 14px' : '6px 12px',
              background: showAddNode ? 'var(--accent-teal)20' : 'transparent',
              border: `1px solid ${showAddNode ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
              color: showAddNode ? 'var(--accent-teal)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.8rem' : '0.75rem',
            }}
          >
            {showAddNode ? 'CANCEL' : FEDERATION.addPort}
          </button>
        </div>

        {/* Add Node Form */}
        {showAddNode && (
          <div style={{
            padding: isMobile ? '14px' : '16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--accent-teal)40',
            marginBottom: '12px',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder={FEDERATION.addPortNamePlaceholder}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                  marginBottom: '8px',
                }}
              />
              <input
                type="text"
                value={newNodeUrl}
                onChange={(e) => setNewNodeUrl(e.target.value)}
                placeholder={FEDERATION.addPortUrlPlaceholder}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                }}
              />
            </div>
            <button
              onClick={handleAddNode}
              style={{
                padding: isMobile ? '12px 20px' : '10px 20px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-teal)20',
                border: '1px solid var(--accent-teal)',
                color: 'var(--accent-teal)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
              }}
            >
              {FEDERATION.addPortBtn}
            </button>
          </div>
        )}

        {/* Node List */}
        {nodes.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: 'var(--text-dim)',
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border-subtle)',
            fontSize: isMobile ? '0.9rem' : '0.85rem',
          }}>
            {FEDERATION.noAlliedPorts}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {nodes.map((node) => (
              <div
                key={node.id}
                style={{
                  padding: isMobile ? '14px' : '12px 16px',
                  background: 'var(--bg-surface)',
                  border: `1px solid ${node.status === 'active' ? 'var(--accent-green)40' : 'var(--border-subtle)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>
                      {node.nodeName}
                    </span>
                    <span style={{
                      marginLeft: '10px',
                      padding: '2px 8px',
                      background: `${getStatusColor(node.status)}20`,
                      color: getStatusColor(node.status),
                      fontSize: '0.7rem',
                    }}>
                      {getStatusLabel(node.status)}
                    </span>
                    {node.status === 'active' && (
                      <span style={{
                        marginLeft: '6px',
                        padding: '2px 6px',
                        background: node.protocolVersion >= 2 ? 'var(--accent-teal)20' : 'var(--text-dim)20',
                        color: node.protocolVersion >= 2 ? 'var(--accent-teal)' : 'var(--text-dim)',
                        fontSize: '0.65rem',
                        fontFamily: 'monospace',
                      }}>
                        {node.protocolVersion >= 2 ? FEDERATION.v2Badge : FEDERATION.v1Badge}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteNode(node.id)}
                    style={{
                      padding: '4px 8px',
                      background: 'transparent',
                      border: '1px solid var(--accent-orange)40',
                      color: 'var(--accent-orange)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ color: 'var(--text-dim)', fontSize: isMobile ? '0.8rem' : '0.75rem', marginBottom: '8px' }}>
                  {node.baseUrl}
                </div>

                {node.lastContactAt && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '8px' }}>
                    Last contact: {new Date(node.lastContactAt).toLocaleString()}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {node.status === 'pending' && (
                    <button
                      onClick={() => handleHandshake(node.id)}
                      disabled={handshakeLoading === node.id}
                      style={{
                        padding: isMobile ? '10px 16px' : '8px 14px',
                        minHeight: isMobile ? '44px' : 'auto',
                        background: 'var(--accent-teal)20',
                        border: '1px solid var(--accent-teal)',
                        color: 'var(--accent-teal)',
                        cursor: handshakeLoading === node.id ? 'wait' : 'pointer',
                        fontFamily: 'monospace',
                        fontSize: isMobile ? '0.8rem' : '0.75rem',
                        opacity: handshakeLoading === node.id ? 0.6 : 1,
                      }}
                    >
                      {handshakeLoading === node.id ? FEDERATION.docking : FEDERATION.dock}
                    </button>
                  )}

                  {node.status === 'outbound_pending' && (
                    <span style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      background: 'var(--accent-teal)10',
                      color: 'var(--accent-teal)',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                    }}>
                      {FEDERATION.waitingForResponse}
                    </span>
                  )}

                  {node.status === 'declined' && (
                    <span style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      background: 'var(--text-dim)10',
                      color: 'var(--text-dim)',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                    }}>
                      {FEDERATION.requestWasDeclined}
                    </span>
                  )}

                  {node.status === 'active' && (
                    <button
                      onClick={() => handleStatusChange(node.id, 'suspended')}
                      style={{
                        padding: isMobile ? '10px 16px' : '8px 14px',
                        minHeight: isMobile ? '44px' : 'auto',
                        background: 'transparent',
                        border: '1px solid var(--accent-orange)',
                        color: 'var(--accent-orange)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: isMobile ? '0.8rem' : '0.75rem',
                      }}
                    >
                      SUSPEND
                    </button>
                  )}

                  {node.status === 'suspended' && (
                    <>
                      <button
                        onClick={() => handleHandshake(node.id)}
                        disabled={handshakeLoading === node.id}
                        style={{
                          padding: isMobile ? '10px 16px' : '8px 14px',
                          minHeight: isMobile ? '44px' : 'auto',
                          background: 'var(--accent-green)20',
                          border: '1px solid var(--accent-green)',
                          color: 'var(--accent-green)',
                          cursor: handshakeLoading === node.id ? 'wait' : 'pointer',
                          fontFamily: 'monospace',
                          fontSize: isMobile ? '0.8rem' : '0.75rem',
                          opacity: handshakeLoading === node.id ? 0.6 : 1,
                        }}
                      >
                        REACTIVATE
                      </button>
                      <button
                        onClick={() => handleStatusChange(node.id, 'blocked')}
                        style={{
                          padding: isMobile ? '10px 16px' : '8px 14px',
                          minHeight: isMobile ? '44px' : 'auto',
                          background: 'transparent',
                          border: '1px solid var(--status-error)',
                          color: 'var(--status-error)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: isMobile ? '0.8rem' : '0.75rem',
                        }}
                      >
                        BLOCK
                      </button>
                    </>
                  )}

                  {node.publicKey && (
                    <span style={{
                      padding: '4px 8px',
                      background: 'var(--accent-green)10',
                      color: 'var(--accent-green)',
                      fontSize: '0.7rem',
                    }}>
                      KEY OK
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ============ HANDLE REQUESTS LIST (ADMIN) ============
export default FederationAdminPanel;
