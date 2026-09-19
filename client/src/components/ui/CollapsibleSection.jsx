import React, { useState } from 'react';

const CollapsibleSection = ({ title, menu, menuTitle, indent = 0, children, defaultOpen = true, isOpen: controlledIsOpen, onToggle, isMobile, titleColor = 'var(--text-dim)', accentColor, badge, unreadCount = 0, compact = false }) => {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);
  const [menuOpen, setMenuOpen] = useState(false);

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
            padding: '6px 12px',
            paddingLeft: `${12 + indent * 12}px`,
            cursor: 'pointer',
            userSelect: 'none',
            borderTop: '1px solid var(--bg-hover)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ color: titleColor, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            {badge && (
              <span style={{
                color: 'var(--text-muted)',
                fontSize: '0.65rem',
                fontFamily: 'monospace',
              }}>{badge}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {unreadCount > 0 && (
              <span style={{
                minWidth: '18px',
                height: '18px',
                padding: '0 5px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: accentColor || 'var(--accent-amber)',
                color: 'var(--bg-base)',
                fontSize: '0.65rem',
                fontWeight: 700,
                fontFamily: 'monospace',
                borderRadius: '9px',
                lineHeight: 1,
              }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
            {menu && menu.length > 0 && (
              // The same three-dot affordance every wave row has, so "there are
              // actions here" looks identical everywhere rather than being a
              // gear in one place and dots in another.
              //
              // stopPropagation throughout: acting on a group must not also
              // collapse the group.
              <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                <button
                  title={menuTitle || 'Options'}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
                  style={{
                    background: menuOpen ? 'var(--bg-hover)' : 'transparent', border: 'none',
                    color: menuOpen ? 'var(--accent-amber)' : 'var(--text-dim)',
                    cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.9rem',
                    padding: '0 4px', lineHeight: 1,
                  }}
                >⋮</button>
                {menuOpen && (
                  <>
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}
                    />
                    <div style={{
                      position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)',
                      zIndex: 100, minWidth: '180px',
                    }}>
                      {menu.map((item, i) => (
                        <button
                          key={item.label}
                          onClick={(e) => { e.stopPropagation(); setMenuOpen(false); item.onClick(); }}
                          style={{
                            display: 'block', width: '100%', padding: '9px 12px',
                            background: 'transparent', border: 'none',
                            borderBottom: i < menu.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                            color: item.danger ? 'var(--accent-orange)' : 'var(--text-primary)',
                            cursor: 'pointer', textAlign: 'left',
                            fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >{item.label}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', fontFamily: 'monospace' }}>
              {isOpen ? '▾' : '▸'}
            </span>
          </div>
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
