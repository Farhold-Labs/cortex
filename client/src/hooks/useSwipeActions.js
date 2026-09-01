import { useRef, useState, useEffect, useCallback } from 'react';

// Swipe a ping sideways to act on it (v2.77.0; reworked v2.78.0).
//
// Additive: everything here is also in the ⋮ menu.
//
// ## Why this uses native listeners rather than `touch-action`
//
// v2.77.0 claimed horizontal movement by putting `touch-action: pan-y` on the
// row. That was wrong. `touch-action` **intersects down the ancestor chain**, so
// `pan-y` on the row disabled horizontal panning for everything inside it —
// including the emoji reaction picker (`overflow-x: auto`), code blocks and
// tables. Worse, this hook then captured the movement the browser had just been
// forbidden from using, so scrolling the emoji row fired a swipe instead.
//
// A declarative property cannot express "claim horizontal movement, except when
// it starts somewhere that scrolls horizontally" — that decision has to be made
// per gesture. So the listeners are attached natively with `{ passive: false }`
// (React 18 registers its own as passive, where `preventDefault` is a silent
// no-op) and the gesture is declined at touchstart when it begins inside a
// horizontal scroller or a text field.

const COMMIT_SLOP = 12;      // px before a gesture picks an axis
const AXIS_RATIO = 1.4;      // horizontal must beat vertical by this to commit
const TRIGGER = 72;          // px of travel that fires the action
const MAX_TRAVEL = 96;       // clamp, so the row never slides off

const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Walk from the touched node up to the row. Anything that scrolls sideways, or
// opts out, or takes text input, keeps the gesture for itself.
function declines(target, root) {
  let el = target;
  while (el && el !== root && el.nodeType === 1) {
    if (el.hasAttribute?.('data-no-swipe')) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
    el = el.parentElement;
  }
  return false;
}

export function useSwipeActions(ref, { onSwipeRight, onSwipeLeft, enabled = true } = {}) {
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);

  const startRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef(null);      // null | 'x' | 'y'
  const activeRef = useRef(false);
  const offsetRef = useRef(0);

  const cfg = useRef({ onSwipeRight, onSwipeLeft, enabled });
  useEffect(() => { cfg.current = { onSwipeRight, onSwipeLeft, enabled }; },
    [onSwipeRight, onSwipeLeft, enabled]);

  const setOffsetBoth = useCallback((v) => { offsetRef.current = v; setOffset(v); }, []);

  // See the note in usePullToRefresh: a ref object's identity
  // never changes, so an effect keyed on it binds once — before the element
  // exists, if the parent renders a placeholder first.
  const [node, setNode] = useState(null);
  useEffect(() => { if (ref.current !== node) setNode(ref.current); });

  useEffect(() => {
    const el = node;
    if (!el) return undefined;

    const reset = (animate) => {
      axisRef.current = null;
      activeRef.current = false;
      if (animate && !reducedMotion()) {
        setSettling(true);
        setOffsetBoth(0);
        setTimeout(() => setSettling(false), 180);
      } else {
        setSettling(false);
        setOffsetBoth(0);
      }
    };

    const onStart = (e) => {
      if (!cfg.current.enabled) { activeRef.current = false; return; }
      const t = e.touches?.[0];
      if (!t) return;
      if (declines(e.target, el)) { activeRef.current = false; return; }
      startRef.current = { x: t.clientX, y: t.clientY };
      axisRef.current = null;
      activeRef.current = true;
      setSettling(false);
    };

    const onMove = (e) => {
      if (!activeRef.current) return;
      const t = e.touches?.[0];
      if (!t) return;
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;

      if (axisRef.current === null) {
        if (Math.abs(dx) < COMMIT_SLOP && Math.abs(dy) < COMMIT_SLOP) return;
        // Commit once, for the life of the gesture, so a scroll that begins
        // with a little sideways drift stays a scroll.
        axisRef.current = (Math.abs(dx) > Math.abs(dy) * AXIS_RATIO) ? 'x' : 'y';
        if (axisRef.current === 'y') { activeRef.current = false; return; }
      }
      if (axisRef.current !== 'x') return;

      const allowed = dx > 0 ? !!cfg.current.onSwipeRight : !!cfg.current.onSwipeLeft;
      if (!allowed) { setOffsetBoth(0); return; }

      // Only now is the gesture ours, so suppressing the browser is correct.
      if (e.cancelable) e.preventDefault();

      const capped = Math.sign(dx) * Math.min(Math.abs(dx), MAX_TRAVEL);
      const eased = Math.abs(capped) > TRIGGER
        ? Math.sign(capped) * (TRIGGER + (Math.abs(capped) - TRIGGER) * 0.35)
        : capped;
      setOffsetBoth(eased);
    };

    const onEnd = () => {
      if (axisRef.current !== 'x') { reset(false); return; }
      const travelled = offsetRef.current;
      if (Math.abs(travelled) >= TRIGGER) {
        const fire = travelled > 0 ? cfg.current.onSwipeRight : cfg.current.onSwipeLeft;
        reset(true);
        // Let the row settle before the action's own UI appears.
        setTimeout(() => fire?.(), reducedMotion() ? 0 : 120);
      } else {
        reset(true);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [node, setOffsetBoth]);

  return {
    offset,
    progress: Math.min(Math.abs(offset) / TRIGGER, 1),
    direction: offset === 0 ? null : (offset > 0 ? 'right' : 'left'),
    armed: Math.abs(offset) >= TRIGGER,
    settling,
  };
}
