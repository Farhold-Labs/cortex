import { useRef, useState, useCallback, useEffect } from 'react';

// Swipe a ping sideways to act on it (v2.77.0).
//
// Additive: everything reachable here is also in the ⋮ menu. This exists
// because hitting ⋮ on a phone is fiddly.
//
// The hard part is coexisting with the message list's vertical scroll. Two
// things make that work:
//
//  - **`touch-action: pan-y`** on the row (returned as `style` — apply it, the
//    gesture does not work without it). It tells the browser the element scrolls
//    vertically and that horizontal movement belongs to us. This is why nothing
//    here calls preventDefault: React 18 attaches `touchmove` as a **passive**
//    listener at the root, so preventDefault in a synthetic handler is a silent
//    no-op. Reaching for it would have produced a gesture that looked correct in
//    review and fought the scroller on a real device.
//  - **Axis lock**: once a gesture starts moving it is committed to one axis for
//    its whole life, so a scroll that begins with a few degrees of horizontal
//    drift keeps scrolling instead of dragging the row.

const COMMIT_SLOP = 12;      // px before a gesture picks an axis
const AXIS_RATIO = 1.4;      // horizontal must beat vertical by this to commit
const TRIGGER = 72;          // px of travel that fires the action
const MAX_TRAVEL = 96;       // clamp, so the row never slides off
const EDGE_ZONE = 32;        // left-edge strip reserved for back-navigation

const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useSwipeActions({ onSwipeRight, onSwipeLeft, enabled = true } = {}) {
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const startRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef(null);      // null | 'x' | 'y'
  const activeRef = useRef(false);

  const cbs = useRef({ onSwipeRight, onSwipeLeft });
  useEffect(() => { cbs.current = { onSwipeRight, onSwipeLeft }; }, [onSwipeRight, onSwipeLeft]);

  const reset = useCallback((animate) => {
    axisRef.current = null;
    activeRef.current = false;
    if (animate && !reducedMotion()) {
      setSettling(true);
      setOffset(0);
      setTimeout(() => setSettling(false), 180);
    } else {
      setSettling(false);
      setOffset(0);
    }
  }, []);

  const onTouchStart = useCallback((e) => {
    if (!enabled) return;
    const t = e.touches?.[0];
    if (!t) return;
    // The left edge belongs to back-navigation; starting there must not also
    // drag a ping, or the two gestures fight over the same finger.
    if (t.clientX <= EDGE_ZONE) { activeRef.current = false; return; }
    startRef.current = { x: t.clientX, y: t.clientY };
    axisRef.current = null;
    activeRef.current = true;
    setSettling(false);
  }, [enabled]);

  const onTouchMove = useCallback((e) => {
    if (!activeRef.current) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;

    if (axisRef.current === null) {
      if (Math.abs(dx) < COMMIT_SLOP && Math.abs(dy) < COMMIT_SLOP) return;
      // Commit once, for the life of the gesture.
      axisRef.current = (Math.abs(dx) > Math.abs(dy) * AXIS_RATIO) ? 'x' : 'y';
      if (axisRef.current === 'y') { activeRef.current = false; return; }
    }
    if (axisRef.current !== 'x') return;

    // Refuse a direction with no action behind it, rather than sliding to
    // reveal nothing.
    const allowed = dx > 0 ? !!cbs.current.onSwipeRight : !!cbs.current.onSwipeLeft;
    if (!allowed) { setOffset(0); return; }

    // Resistance past the trigger point: the row keeps responding but signals
    // that further travel achieves nothing.
    const capped = Math.sign(dx) * Math.min(Math.abs(dx), MAX_TRAVEL);
    const eased = Math.abs(capped) > TRIGGER
      ? Math.sign(capped) * (TRIGGER + (Math.abs(capped) - TRIGGER) * 0.35)
      : capped;
    setOffset(eased);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (axisRef.current !== 'x') { reset(false); return; }
    const travelled = offset;
    if (Math.abs(travelled) >= TRIGGER) {
      // Fire after the row has snapped back, so the action's own UI (a reply
      // box, a toast) doesn't appear underneath a still-animating row.
      const fire = travelled > 0 ? cbs.current.onSwipeRight : cbs.current.onSwipeLeft;
      reset(true);
      setTimeout(() => fire?.(), reducedMotion() ? 0 : 120);
    } else {
      reset(true);
    }
  }, [offset, reset]);

  return {
    // Apply to the swiped row. Without `touch-action: pan-y` the browser keeps
    // horizontal panning for itself and the row never moves.
    style: { touchAction: 'pan-y' },
    offset,
    // How far through the gesture we are, for fading in the action hint.
    progress: Math.min(Math.abs(offset) / TRIGGER, 1),
    direction: offset === 0 ? null : (offset > 0 ? 'right' : 'left'),
    armed: Math.abs(offset) >= TRIGGER,
    settling,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
