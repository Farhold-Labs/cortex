import { useEffect, useRef, useState } from 'react';

// Swipe in from the left edge to go back (v2.77.0).
//
// Anchored to the edge deliberately. A back-swipe that worked anywhere would
// compete with the per-ping swipe actions for the same finger, and one of them
// would have to lose. Reserving a narrow left strip lets both exist: pings
// ignore gestures that start there (see useSwipeActions), and this ignores
// gestures that start anywhere else.
//
// Additive — the ← button in the header is unchanged.

const EDGE_ZONE = 32;    // must match useSwipeActions' reserved strip
const TRIGGER = 70;      // px of horizontal travel to count as "back"
const MAX_VERTICAL = 60; // more drift than this and it was a scroll

export function useEdgeSwipeBack(ref, onBack, { enabled = true } = {}) {
  const start = useRef(null);
  const onBackRef = useRef(onBack);
  const enabledRef = useRef(enabled);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);


// ⚠️ Ref-attachment note (v2.77.0). A ref *object*'s identity never changes, so
// an effect keyed on `[ref]` runs exactly once — and if the element is not
// mounted yet (WaveView renders a loading spinner first), it binds to nothing
// and never retries. Both wave gestures failed silently this way. The extra
// effect below re-runs each render and promotes `ref.current` into state, so
// the binding effect fires again the moment the node actually appears.
  const [node, setNode] = useState(null);
  useEffect(() => { if (ref.current !== node) setNode(ref.current); });

  useEffect(() => {
    const el = node;
    if (!el) return undefined;

    const onStart = (e) => {
      if (!enabledRef.current || !onBackRef.current) { start.current = null; return; }
      const t = e.touches?.[0];
      // Only gestures beginning in the edge strip are ours.
      start.current = (t && t.clientX <= EDGE_ZONE) ? { x: t.clientX, y: t.clientY } : null;
    };

    const onEnd = (e) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches?.[0];
      if (!t) return;
      if (t.clientX - s.x >= TRIGGER && Math.abs(t.clientY - s.y) <= MAX_VERTICAL) {
        onBackRef.current?.();
      }
    };

    // Passive throughout: this never needs to suppress the browser's own
    // scrolling, and a non-passive listener on the wave root would tax every
    // touch in the conversation for no reason.
    const onCancel = () => { start.current = null; };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [node]);
}
