import React from 'react';
import { triggerHaptic } from '../../utils/capacitor-push.js';
import { isNativeApp } from '../../config/constants.js';

// ============ BOTTOM NAVIGATION ============
const BottomNav = ({ activeView, onNavigate, unreadCount, pendingContacts, pendingGroups }) => {
  const pendingPeople = (pendingContacts || 0) + (pendingGroups || 0);
  const items = [
    { id: 'waves',    icon: '◈', label: 'Waves',    badge: unreadCount },
    { id: 'feed',     icon: '▶', label: 'Feed' },
    { id: 'people',   icon: '●', label: 'People',   badge: pendingPeople },
    { id: 'calendar', icon: '▦', label: 'Calendar' },
    { id: 'profile',  icon: '⚙', label: 'Profile' },
  ];

  const handleNavigate = (view) => {
    // Haptic feedback — prefer Capacitor native haptics, fall back to Web Vibration API
    if (isNativeApp) {
      triggerHaptic();
    } else if (navigator.vibrate) {
      navigator.vibrate(10);
    }
    onNavigate(view);
  };

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '60px',
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: 'var(--bg-surface)',
      borderTop: '1px solid var(--border-subtle)',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      zIndex: 1000,
    }}>
      {items.map(item => {
        const isActive = activeView === item.id;
        const badgeColor = item.badgeColor ? item.badgeColor :
                          item.id === 'people' && item.badge > 0 ? 'var(--accent-teal)' : 'var(--accent-orange)';

        return (
          <button
            key={item.id}
            onClick={() => handleNavigate(item.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '8px 4px',
              background: 'transparent',
              border: 'none',
              color: isActive ? 'var(--accent-amber)' : 'var(--text-dim)',
              cursor: 'pointer',
              position: 'relative',
              transition: 'color 0.2s ease',
            }}
          >
            <span style={{
              fontSize: '1.2rem',
              textShadow: isActive ? '0 0 10px var(--accent-amber)80' : 'none',
            }}>
              {item.icon}
            </span>
            <span style={{
              fontSize: '0.6rem',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              textShadow: isActive ? '0 0 8px var(--accent-amber)40' : 'none',
            }}>
              {item.label}
            </span>
            {item.badge > 0 && (
              <span style={{
                position: 'absolute',
                top: '4px',
                right: '10%',
                background: badgeColor,
                color: item.id === 'groups' ? '#000' : '#fff',
                fontSize: '0.55rem',
                fontWeight: 700,
                padding: '2px 4px',
                borderRadius: '10px',
                minWidth: '16px',
                textAlign: 'center',
                boxShadow: `0 0 8px ${badgeColor}80`,
              }}>
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
