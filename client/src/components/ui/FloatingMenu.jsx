import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A ⋮ / + menu that floats above the page instead of inside its row (v2.131.1).
 *
 * The menus used to be `position: absolute` under their button, inside the
 * scrolling wave list. One opened on the last row hung below the list and
 * stretched what the list could scroll, so the panel grew scroll bars, and on a
 * short list the menu was cut off. Rendered into <body> with fixed coordinates,
 * a menu takes no room in the list. It opens below its button, or above when
 * there is no room below, and is kept inside the window.
 *
 * Theme colours are variables on the document root, so the menu keeps them.
 * React events still bubble through a portal to the component that rendered
 * it, so clicks are stopped here: choosing an item must not also open the row.
 */
const MARGIN = 8;

const FloatingMenu = ({ anchorRef, onClose, children, minWidth = 180, zIndex = 1000, role = 'menu' }) => {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current, menu = menuRef.current;
      if (!anchor || !menu) return;
      const a = anchor.getBoundingClientRect();
      const m = menu.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(MARGIN, Math.min(a.right - m.width, vw - m.width - MARGIN));
      let top = a.bottom + 4;
      if (top + m.height > vh - MARGIN) {
        const above = a.top - 4 - m.height;
        top = above >= MARGIN ? above : Math.max(MARGIN, vh - m.height - MARGIN);
      }
      setPos({ left, top });
    };
    place();
  }, [anchorRef]);

  // The anchor moves with any scroll or resize, so the menu closes rather than
  // drifting away from it. Scrolling inside a tall menu is its own business.
  useEffect(() => {
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: zIndex - 1 }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
      <div
        ref={menuRef}
        role={role}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', left: pos ? pos.left : 0, top: pos ? pos.top : 0,
          visibility: pos ? 'visible' : 'hidden',
          zIndex, minWidth: `${minWidth}px`,
          maxHeight: `calc(100vh - ${MARGIN * 2}px)`, overflowY: 'auto',
          background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
};

export default FloatingMenu;
