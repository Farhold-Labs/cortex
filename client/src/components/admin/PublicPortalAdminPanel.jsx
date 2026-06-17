import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';

const PublicPortalAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [portalWaves, setPortalWaves] = useState([]);
  const [allWaves, setAllWaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWaveId, setSelectedWaveId] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [portalData, wavesData] = await Promise.all([
        fetchAPI('/admin/portal'),
        fetchAPI('/admin/portal/waves'),
      ]);
      const portalIds = new Set((portalData.waves || []).map(w => w.waveId));
      setPortalWaves(portalData.waves || []);
      setAllWaves((wavesData.waves || []).filter(w => !portalIds.has(w.id)));
    } catch (err) {
      showToast(err.message || 'Failed to load portal settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const handleAdd = async () => {
    if (!selectedWaveId) return;
    setAdding(true);
    try {
      await fetchAPI('/admin/portal', { method: 'POST', body: { waveId: selectedWaveId, label: label.trim() || undefined } });
      showToast('Wave added to portal', 'success');
      setSelectedWaveId('');
      setLabel('');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to add wave', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (waveId) => {
    try {
      await fetchAPI(`/admin/portal/${waveId}`, { method: 'DELETE' });
      showToast('Wave removed from portal', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to remove wave', 'error');
    }
  };

  const handleUpdateLabel = async (waveId, newLabel) => {
    try {
      await fetchAPI(`/admin/portal/${waveId}`, { method: 'PATCH', body: { label: newLabel.trim() || null } });
      showToast('Label updated', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to update label', 'error');
    }
  };

  const embedSnippet = (waveId) =>
    `<iframe\n  src="${window.location.origin}/portal?wave=${waveId}&embed=1"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border:none;"\n></iframe>`;

  const copySnippet = (waveId) => {
    navigator.clipboard.writeText(embedSnippet(waveId)).then(() => {
      setCopiedId(waveId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const inputStyle = {
    padding: '6px 10px', background: 'var(--bg-base)',
    border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
    fontFamily: 'monospace', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box',
  };

  const smallBtnStyle = (color = 'var(--border-primary)', textColor = 'var(--text-dim)') => ({
    padding: isMobile ? '8px 12px' : '6px 10px',
    background: 'transparent', border: `1px solid ${color}`,
    color: textColor, cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem',
  });

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-teal)40',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>
          🌐 PUBLIC PORTAL
        </div>
        <button onClick={onToggle} style={{
          ...smallBtnStyle(
            isOpen ? 'var(--accent-teal)' : 'var(--border-primary)',
            isOpen ? 'var(--accent-teal)' : 'var(--text-dim)'
          ),
          background: isOpen ? 'var(--accent-teal)20' : 'transparent',
        }}>
          {isOpen ? '▼ HIDE' : '▶ SHOW'}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '16px' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace', margin: '0 0 16px 0' }}>
            Waves added here are readable at{' '}
            <a href="/portal" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-amber)' }}>
              {window.location.origin}/portal
            </a>{' '}
            without login. E2EE-encrypted waves cannot be added.
          </p>

          {/* Add wave form */}
          <div style={{ marginBottom: 20, padding: 14, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 10, fontFamily: 'monospace' }}>
              ADD WAVE TO PORTAL
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>WAVE</div>
              <select value={selectedWaveId} onChange={e => setSelectedWaveId(e.target.value)} style={inputStyle}>
                <option value="">— select a wave —</option>
                {allWaves.map(w => (
                  <option key={w.id} value={w.id}>{w.title} ({w.privacy})</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>DISPLAY LABEL (optional)</div>
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Leave blank to use wave title"
                style={inputStyle}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!selectedWaveId || adding}
              style={{
                padding: '6px 16px', background: selectedWaveId ? 'var(--accent-green)' : 'var(--bg-hover)',
                border: 'none', color: selectedWaveId ? '#000' : 'var(--text-muted)',
                cursor: selectedWaveId ? 'pointer' : 'default',
                fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 'bold',
              }}
            >
              {adding ? 'Adding...' : 'Add to Portal'}
            </button>
          </div>

          {/* Portal wave list */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><LoadingSpinner /></div>
          ) : portalWaves.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.8rem', textAlign: 'center', margin: '24px 0' }}>
              No waves in portal yet.
            </p>
          ) : (
            portalWaves.map(w => (
              <PortalWaveRow
                key={w.waveId}
                wave={w}
                onRemove={() => handleRemove(w.waveId)}
                onUpdateLabel={(lbl) => handleUpdateLabel(w.waveId, lbl)}
                embedSnippet={embedSnippet(w.waveId)}
                onCopy={() => copySnippet(w.waveId)}
                copied={copiedId === w.waveId}
                isMobile={isMobile}
                inputStyle={inputStyle}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

const PortalWaveRow = ({ wave, onRemove, onUpdateLabel, embedSnippet, onCopy, copied, isMobile, inputStyle }) => {
  const [editLabel, setEditLabel] = useState(wave.label || '');
  const [showEmbed, setShowEmbed] = useState(false);

  const rowBtnStyle = (variant) => ({
    padding: isMobile ? '6px 10px' : '4px 10px',
    background: 'transparent',
    border: `1px solid ${variant === 'danger' ? 'var(--accent-orange)' : variant === 'amber' ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
    color: variant === 'danger' ? 'var(--accent-orange)' : variant === 'amber' ? 'var(--accent-amber)' : 'var(--text-dim)',
    cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem',
  });

  return (
    <div style={{ marginBottom: 10, padding: 12, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div>
          <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {wave.label || wave.title}
          </span>
          {wave.label && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'monospace', marginLeft: 8 }}>
              ({wave.title})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowEmbed(v => !v)} style={rowBtnStyle('amber')}>
            {showEmbed ? 'HIDE EMBED' : 'EMBED'}
          </button>
          <button onClick={onRemove} style={rowBtnStyle('danger')}>REMOVE</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>DISPLAY LABEL</div>
          <input
            type="text"
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
            placeholder={wave.title}
            style={inputStyle}
          />
        </div>
        <button
          onClick={() => onUpdateLabel(editLabel)}
          style={{
            padding: '6px 12px', background: 'var(--accent-green)', border: 'none',
            color: '#000', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 'bold',
            whiteSpace: 'nowrap',
          }}
        >
          Save
        </button>
      </div>

      {showEmbed && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>EMBED SNIPPET</div>
          <pre style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            padding: '8px 10px', fontSize: '0.72rem', color: 'var(--text-secondary)',
            overflowX: 'auto', margin: '0 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            fontFamily: 'monospace',
          }}>
            {embedSnippet}
          </pre>
          <button onClick={onCopy} style={rowBtnStyle('amber')}>
            {copied ? '✓ COPIED' : 'COPY SNIPPET'}
          </button>
        </div>
      )}
    </div>
  );
};

export default PublicPortalAdminPanel;
