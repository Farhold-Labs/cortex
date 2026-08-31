import React, { useState, useEffect, useCallback } from 'react';

// Pinned pings for the wave you're reading (v2.74.0).
//
// A pin is wave-wide, not personal: anyone in the wave can pin, everyone sees
// it, anyone can take it down. That is what "all participants should be able to
// pin a ping they want to save for later" asks for — a shared shelf. It mirrors
// the upcoming-events banner directly above it so the top of a wave reads as one
// consistent strip rather than two unrelated widgets.

// Message content is sanitized HTML. The banner is one line per pin, so tags,
// entities and newlines all have to come out for the preview to be legible.
const plainPreview = (html) => {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  el.querySelectorAll('img').forEach(img => { img.replaceWith(document.createTextNode('🖼 ')); });
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
};

const shortWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const previewOf = (pin) => {
  // Ciphertext is never shown. decryptPins marks what it managed to open; an
  // encrypted pin that isn't marked means the wave is still locked, and the
  // pin is announced rather than rendered.
  if (pin.encrypted && !pin._decrypted) return '🔒 Encrypted ping';
  if (pin.eventId) return '📅 Event';
  const text = plainPreview(pin.content);
  if (text) return text;
  if (pin.mediaType) return `📎 ${pin.mediaType}`;
  return '(no text)';
};

const WavePinsBanner = ({
  waveId, fetchAPI, isMobile, onScrollToPing, onUnpin,
  decryptPins, reloadTrigger, showToast,
}) => {
  const [pins, setPins] = useState([]);
  const [collapsed, setCollapsed] = useState(true);

  const load = useCallback((isLive) => {
    if (!waveId) return;
    fetchAPI(`/waves/${waveId}/pins`)
      .then(async (d) => {
        const raw = d.pins || [];
        // Decryption is async, so a wave switch mid-flight would otherwise land
        // one wave's pins in another wave's banner.
        const opened = decryptPins ? await decryptPins(raw, waveId) : raw;
        if (isLive()) setPins(opened);
      })
      // 403 just means this user isn't a participant; nothing to show.
      .catch(() => { if (isLive()) setPins([]); });
  }, [waveId, fetchAPI, decryptPins]);

  useEffect(() => {
    let cancelled = false;
    load(() => !cancelled);
    return () => { cancelled = true; };
  }, [load, reloadTrigger]);

  if (pins.length === 0) return null;

  const shown = collapsed ? pins.slice(0, 3) : pins;

  const unpin = async (pin) => {
    try {
      await fetchAPI(`/pings/${pin.id}/pin`, { method: 'DELETE' });
      // Drop it locally now; the websocket event will confirm for everyone else.
      setPins(prev => prev.filter(p => p.id !== pin.id));
      onUnpin?.(pin.id);
    } catch (err) {
      showToast?.(err.message || 'Could not unpin', 'error');
    }
  };

  return (
    <div style={{
      marginBottom: 16,
      background: 'var(--bg-surface)',
      border: '1px solid var(--accent-amber)40',
      borderLeft: '3px solid var(--accent-amber)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '8px 12px' : '7px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <span style={{
          color: 'var(--accent-amber)', fontFamily: 'monospace', fontSize: '0.65rem',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          📌 Pinned{pins.length > 1 ? ` · ${pins.length}` : ''}
        </span>
        {pins.length > 3 && (
          <button
            onClick={() => setCollapsed(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.65rem',
            }}
          >
            {collapsed ? `▶ show all ${pins.length}` : '▼ hide'}
          </button>
        )}
      </div>

      {shown.map(pin => (
        <div
          key={pin.id}
          style={{
            display: 'flex', gap: 10, alignItems: 'center',
            padding: isMobile ? '10px 12px' : '9px 14px',
            borderTop: '1px solid var(--border-subtle)',
            minHeight: isMobile ? 44 : 'auto',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div
            onClick={() => onScrollToPing?.(pin.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onScrollToPing?.(pin.id); } }}
            title="Jump to this ping"
            style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          >
            <div style={{
              color: 'var(--text-primary)', fontSize: isMobile ? '0.85rem' : '0.9rem',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {previewOf(pin)}
            </div>
            <div style={{
              color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.65rem', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {pin.authorName || 'Unknown'} · {shortWhen(pin.createdAt)}
              {pin.pinnedByName ? ` · pinned by ${pin.pinnedByName}` : ''}
            </div>
          </div>

          {/* Anyone in the wave can unpin — the pin belongs to the wave. */}
          <button
            onClick={(e) => { e.stopPropagation(); unpin(pin); }}
            title="Unpin"
            aria-label={`Unpin ping from ${pin.authorName || 'unknown'}`}
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: '0.8rem',
              padding: isMobile ? '8px' : '4px 6px', minWidth: isMobile ? 36 : 'auto',
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};

export default WavePinsBanner;
