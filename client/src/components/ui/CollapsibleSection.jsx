import React, { useState } from 'react';

const CollapsibleSection = ({ title, children, defaultOpen = true, isOpen: controlledIsOpen, onToggle, isMobile, titleColor = 'var(--text-dim)', accentColor, badge, compact = false }) => {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);

  const isOpen = onToggle ? controlledIsOpen : internalIsOpen;
  const handleToggle = onToggle || (() => setInternalIsOpen(!internalIsOpen));

  if (compact) {
    return (
      <div>
        {/* Compact header: just a label row with toggle, no box */}
        <div
          onClick={handleToggle}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '3px 12px',
            cursor: 'pointer',
            userSelect: 'none',
            borderTop: '1px solid var(--bg-hover)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: titleColor, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.05em' }}>{title}</span>
            {badge && (
              <span style={{
                color: 'var(--text-muted)',
                fontSize: '0.6rem',
                fontFamily: 'monospace',
              }}>{badge}</span>
            )}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', fontFamily: 'monospace' }}>
            {isOpen ? '▾' : '▸'}
          </span>
        </div>
        {isOpen && children}
      </div>
    );
  }

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: accentColor ? `1px solid ${accentColor}40` : '1px solid var(--border-subtle)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ color: titleColor, fontSize: '0.8rem', fontWeight: 500 }}>{title}</div>
          {badge && (
            <span style={{
              padding: '2px 6px',
              background: 'var(--accent-amber)20',
              border: '1px solid var(--accent-amber)',
              color: 'var(--accent-amber)',
              fontSize: '0.65rem',
              borderRadius: '3px',
            }}>{badge}</span>
          )}
        </div>
        <button
          onClick={handleToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? (accentColor ? `${accentColor}20` : 'var(--accent-amber)20') : 'transparent',
            border: `1px solid ${isOpen ? (accentColor || 'var(--accent-amber)') : 'var(--border-primary)'}`,
            color: isOpen ? (accentColor || 'var(--accent-amber)') : 'var(--text-dim)',
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
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
