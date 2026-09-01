import { useRef, useEffect, useCallback } from 'react';

// Long-press to open a ping's action menu (v2.77.0).
//
// Additive: the ⋮ button still does everything this does. Long-press exists
// because ⋮ is a small target, and the people this is for are not the ones with
// the steadiest hands.
//
// Two things it must not break:
//  - **Vertical scrolling.** Any movement past a few pixels cancels, so a press
//    that turns into a scroll never fires the menu.
//  - **Text selection.** The browser's own selection long-press is left alone
//    on links and images, and a press that produces a selection is abandoned.

const DEFAULT_DELAY = 500;   // matches the platform convention
const MOVE_TOLERANCE = 10;   // px of drift still counted as "held still"

export function useLongPress(onLongPress, { delay = DEFAULT_DELAY, enabled = true } = {}) {
  const timer = useRef(null);
  const start = useRef({ x: 0, y: 0 });
  const firedRef = useRef(false);
  const handlerRef = useRef(onLongPress);
  useEffect(() => { handlerRef.current = onLongPress; }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  useEffect(() => cancel, [cancel]);

  const onTouchStart = useCallback((e) => {
    if (!enabled || !handlerRef.current) return;
    // Leave anchors and images to the browser: long-press there is "open link"
    // / "save image", which people rely on and we should not steal.
    const t = e.target;
    if (t?.closest?.('a, img, button, input, textarea')) return;

    const touch = e.touches?.[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY };
    firedRef.current = false;

    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      // If the press produced a text selection, the user was selecting, not
      // summoning a menu — respect that and stay out of the way.
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) return;
      firedRef.current = true;
      handlerRef.current?.(e);
    }, delay);
  }, [enabled, delay, cancel]);

  const onTouchMove = useCallback((e) => {
    const touch = e.touches?.[0];
    if (!touch || !timer.current) return;
    const dx = Math.abs(touch.clientX - start.current.x);
    const dy = Math.abs(touch.clientY - start.current.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) cancel();
  }, [cancel]);

  const onTouchEnd = useCallback(() => { cancel(); }, [cancel]);

  // Callers use this to suppress the click that follows a fired long-press.
  const didFire = useCallback(() => firedRef.current, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd, didFire };
}
