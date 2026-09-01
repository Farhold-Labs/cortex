import { useState, useRef, useEffect, useCallback } from 'react';

// ============ PULL TO REFRESH HOOK ============
//
// Rewritten v2.77.0 to bind its listeners **once**. The original had `pulling`,
// `pullDistance` and `refreshing` in the effect's dependency array, so every
// frame of a pull tore down and re-attached the touch listeners — including the
// non-passive `touchmove` the gesture depends on. It happened to work in the
// video feed; re-binding a listener mid-gesture is not something to extend to
// the wave list and an open wave. State the UI renders still lives in state;
// state the *handlers* need lives in refs.

// `edge` picks which end of the list arms the gesture (v2.78.0):
//   'top'    — pull DOWN at the top (a list newest-first, like the wave list)
//   'bottom' — pull UP at the bottom (a wave, which is newest-LAST and where you
//              are already sitting; requiring a scroll to the top of a
//              thousand-message wave made the gesture unreachable in practice)
export function usePullToRefresh(ref, onRefresh, { enabled = true, edge = 'top' } = {}) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef(0);
  const distanceRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const enabledRef = useRef(enabled);
  const edgeRef = useRef(edge);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { edgeRef.current = edge; }, [edge]);

  const threshold = 60;

  const setDistance = useCallback((d) => {
    distanceRef.current = d;
    setPullDistance(d);
  }, []);


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

    // Armed only at the relevant end, or the gesture would hijack ordinary
    // scrolling. Bottom needs a tolerance: fractional scroll heights mean
    // scrollTop rarely lands exactly on the maximum.
    const atEdge = () => (edgeRef.current === 'bottom'
      ? (el.scrollHeight - el.scrollTop - el.clientHeight) <= 2
      : el.scrollTop === 0);

    const handleTouchStart = (e) => {
      if (!enabledRef.current || refreshingRef.current) return;
      if (atEdge()) {
        startY.current = e.touches[0].clientY;
        pullingRef.current = true;
        setPulling(true);
      }
    };

    const handleTouchMove = (e) => {
      if (!pullingRef.current || !atEdge()) return;
      const raw = e.touches[0].clientY - startY.current;
      // At the bottom the pull travels upward, so the sign flips. Everything
      // downstream works in "distance pulled", never in screen direction.
      const distance = edgeRef.current === 'bottom' ? -raw : raw;
      if (distance > 0) {
        setDistance(Math.min(distance * 0.5, threshold + 20)); // resistance
        // Non-passive listener below, so this genuinely suppresses the bounce.
        if (distance > 10 && e.cancelable) e.preventDefault();
      } else if (distanceRef.current !== 0) {
        setDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      const travelled = distanceRef.current;
      pullingRef.current = false;
      setPulling(false);
      setDistance(0);
      startY.current = 0;
      if (travelled > threshold && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        try {
          await onRefreshRef.current?.();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
        }
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
    // Binds once per element. Everything mutable is read through a ref.
  }, [node, setDistance]);

  return { pulling, pullDistance, refreshing };
}
