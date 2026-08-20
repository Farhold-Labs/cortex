import { useState, useEffect } from 'react';

// ============ RESPONSIVE HOOK ============

// Widths (CSS px) at which the layout changes.
const PHONE_MAX = 600;    // below this, always the single-pane mobile layout
const TABLET_MAX = 1024;  // below this, a touch device in portrait is still "mobile"

// Touch devices report a coarse primary pointer. Gating the portrait-tablet rule
// on this keeps desktop/Electron windows on the desktop layout no matter how
// narrow the user drags them — they still have Ctrl+B to collapse the sidebar.
function coarsePointer() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

export function useWindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [isTouch, setIsTouch] = useState(coarsePointer);
  useEffect(() => {
    function handleResize() {
      setSize({ width: window.innerWidth, height: window.innerHeight });
      setIsTouch(coarsePointer());
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    handleResize(); // Set initial size
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const isPortrait = size.height > size.width;

  // A tablet held vertically has nowhere near enough room for the 300px wave
  // list *and* a readable wave, so it gets the phone's single-pane layout.
  // Rotating to landscape puts it back on the desktop layout.
  const isPortraitTablet = isTouch && isPortrait
    && size.width >= PHONE_MAX && size.width < TABLET_MAX;

  // Note: width is 0 until the first measure, so isPhone starts true — the same
  // mobile-first default this hook has always had. Consumers that care gate on
  // hasMeasured instead.
  const isPhone = size.width < PHONE_MAX;
  const isMobile = isPhone || isPortraitTablet;              // single-pane layout
  const isTablet = !isMobile && size.width >= PHONE_MAX && size.width < TABLET_MAX;
  const isDesktop = size.width >= TABLET_MAX;
  const hasMeasured = size.width !== 0;

  return { ...size, isPhone, isPortraitTablet, isMobile, isTablet, isDesktop, hasMeasured };
}
