import React, { useState, useRef } from 'react';
import FloatingMenu from './FloatingMenu.jsx';

const CollapsibleSection = ({ title, menu, menuTitle, indent = 0, titleSize = '0.75rem', children, defaultOpen = true, isOpen: controlledIsOpen, onToggle, isMobile, titleColor = 'var(--text-dim)', accentColor, badge, unreadCount = 0, compact = false, dense = false, headerAction, collapsible = true }) => {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);

  // collapsible={false} (compact only): a fixed header that always shows its
  // children, e.g. a voice channel row, where folding hides nothing useful.
  const isOpen = !collapsible || (onToggle ? controlledIsOpen : internalIsOpen);
  const handleToggle = !collapsible ? undefined : (onToggle || (() => setInternalIsOpen(!internalIsOpen)));

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
            // In rem, so each level of nesting stays a visible step at every
            // FONT SIZE (a fixed 12px all but vanishes at X-Large).
            paddingLeft: `${0.75 + indent * 0.75}rem`,
            cursor: collapsible ? 'pointer' : 'default',
            userSelect: 'none',
            borderTop: '1px solid var(--bg-hover)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ color: titleColor, fontSize: titleSize, fontWeight: 700, letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
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
            {headerAction && (
              // An action that is not "fold this" (e.g. JOIN on a voice
              // channel). Its clicks must not also toggle the section.
              <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>{headerAction}</span>
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
                  ref={menuButtonRef}
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
                  <FloatingMenu anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)}>
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
                  </FloatingMenu>
                )}
              </div>
            )}
            {collapsible && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                {isOpen ? '▾' : '▸'}
              </span>
            )}
          </div>
        </div>
        {isOpen && children}
      </div>
    );
  }

  return (
    // `dense` (v2.124.0): the same box at about half the height, for screens
    // that are a stack of sections, such as Manage Community.
    <div style={{
      marginTop: dense ? '8px' : '20px',
      padding: dense ? (isMobile ? '6px 10px' : '6px 12px') : (isMobile ? '16px' : '20px'),
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: accentColor ? `1px solid ${accentColor}40` : '1px solid var(--border-subtle)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
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
        {/* An action that belongs in the header, such as SIGN OUT on Profile
            (v2.115.0) — reachable whether or not the section is open. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {headerAction}
        <button
          onClick={handleToggle}
          style={{
            padding: dense ? (isMobile ? '6px 10px' : '4px 8px') : (isMobile ? '8px 12px' : '6px 10px'),
            background: isOpen ? (accentColor ? `${accentColor}20` : 'var(--accent-amber)20') : 'transparent',
            border: `1px solid ${isOpen ? (accentColor || 'var(--accent-amber)') : 'var(--border-primary)'}`,
            color: isOpen ? (accentColor || 'var(--accent-amber)') : 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {isOpen ? '▼ HIDE' : '▶ SHOW'}
        </button>
        </div>
      </div>
      {isOpen && (
        <div style={{ marginTop: dense ? '10px' : '16px', ...(dense ? { paddingBottom: '6px' } : {}) }}>
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
