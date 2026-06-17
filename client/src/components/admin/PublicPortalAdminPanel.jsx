import React, { useState, useEffect, useCallback } from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';

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
        fetchAPI('/waves'),
      ]);
      setPortalWaves(portalData.waves || []);
      const portalIds = new Set((portalData.waves || []).map(w => w.waveId));
      setAllWaves((wavesData.waves || []).filter(w => !w.encrypted && !portalIds.has(w.id)));
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

  const embedSnippet = (waveId) => {
    const base = `${window.location.origin}/portal`;
    return `<iframe\n  src="${base}?wave=${waveId}&embed=1"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border:none;"\n></iframe>`;
  };

  const copySnippet = (waveId) => {
    navigator.clipboard.writeText(embedSnippet(waveId)).then(() => {
      setCopiedId(waveId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const sectionStyle = {
    marginBottom: 16, padding: 16,
    background: 'var(--bg-surface)', border: '1px solid var(--border-secondary)',
    borderRadius: 2,
  };

  const labelStyle = { color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 4, display: 'block' };
  const inputStyle = {
    width: '100%', padding: '7px 10px', background: 'var(--bg-base)',
    border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
    fontFamily: 'Courier New, monospace', fontSize: '0.85rem', boxSizing: 'border-box',
  };
  const btnStyle = (variant = 'primary') => ({
    padding: '7px 14px', fontFamily: 'Courier New, monospace', fontSize: '0.8rem',
    cursor: 'pointer', border: 'none',
    background: variant === 'primary' ? 'var(--accent-green)' : variant === 'danger' ? 'transparent' : 'transparent',
    color: variant === 'primary' ? '#000' : variant === 'danger' ? 'var(--accent-orange)' : 'var(--accent-amber)',
    ...(variant !== 'primary' ? { border: `1px solid ${variant === 'danger' ? 'var(--accent-orange)' : 'var(--accent-amber)'}` } : {}),
  });

  if (!isOpen) {
    return (
      <div
        onClick={onToggle}
        style={{ padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: '0.95rem' }}>Public Portal</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>▶</span>
      </div>
    );
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div
        onClick={onToggle}
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: '0.95rem' }}>Public Portal</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>▼</span>
      </div>

      <div style={{ padding: '0 16px 20px' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
          Waves added here are publicly readable at{' '}
          <a href="/portal" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-amber)' }}>
            {window.location.origin}/portal
          </a>{' '}
          without requiring a Cortex account. E2EE-encrypted waves cannot be added.
        </p>

        {/* Add wave */}
        <div style={sectionStyle}>
          <GlowText style={{ fontSize: '0.8rem', marginBottom: 12 }}>Add Wave to Portal</GlowText>
          <span style={labelStyle}>Wave</span>
          <select
            value={selectedWaveId}
            onChange={e => setSelectedWaveId(e.target.value)}
            style={{ ...inputStyle, marginBottom: 10 }}
          >
            <option value="">— select a wave —</option>
            {allWaves.map(w => (
              <option key={w.id} value={w.id}>{w.title} ({w.privacy})</option>
            ))}
          </select>
          <span style={labelStyle}>Display label (optional — overrides wave title)</span>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Leave blank to use wave title"
            style={{ ...inputStyle, marginBottom: 12 }}
          />
          <button onClick={handleAdd} disabled={!selectedWaveId || adding} style={btnStyle('primary')}>
            {adding ? 'Adding...' : 'Add to Portal'}
          </button>
        </div>

        {/* Current portal waves */}
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</div>
        ) : portalWaves.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No waves in portal yet.</div>
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
              btnStyle={btnStyle}
              inputStyle={inputStyle}
              labelStyle={labelStyle}
            />
          ))
        )}
      </div>
    </div>
  );
};

const PortalWaveRow = ({ wave, onRemove, onUpdateLabel, embedSnippet, onCopy, copied, isMobile, btnStyle, inputStyle, labelStyle }) => {
  const [editLabel, setEditLabel] = useState(wave.label || '');
  const [showEmbed, setShowEmbed] = useState(false);

  return (
    <div style={{ marginBottom: 12, padding: 14, background: 'var(--bg-surface)', border: '1px solid var(--border-secondary)', borderRadius: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: '0.9rem' }}>
            {wave.label || wave.title}
          </span>
          {wave.label && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>({wave.title})</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowEmbed(v => !v)} style={btnStyle('amber')}>
            {showEmbed ? 'Hide Embed' : 'Embed'}
          </button>
          <button onClick={onRemove} style={btnStyle('danger')}>Remove</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: showEmbed ? 12 : 0 }}>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Display label</span>
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
          style={{ ...btnStyle('primary'), whiteSpace: 'nowrap' }}
        >
          Save
        </button>
      </div>

      {showEmbed && (
        <div style={{ marginTop: 12 }}>
          <span style={labelStyle}>Embed snippet</span>
          <pre style={{
            background: 'var(--bg-base)', border: '1px solid var(--border-primary)',
            padding: 10, fontSize: '0.75rem', color: 'var(--text-secondary)',
            overflowX: 'auto', margin: '4px 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {embedSnippet}
          </pre>
          <button onClick={onCopy} style={btnStyle('amber')}>
            {copied ? 'Copied!' : 'Copy Snippet'}
          </button>
        </div>
      )}
    </div>
  );
};

export default PublicPortalAdminPanel;
