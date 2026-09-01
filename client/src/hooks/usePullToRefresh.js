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

export function usePullToRefresh(ref, onRefresh, { enabled = true } = {}) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef(0);
  const distanceRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const enabledRef = useRef(enabled);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

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

    const handleTouchStart = (e) => {
      if (!enabledRef.current || refreshingRef.current) return;
      // Only arm at the very top, or the gesture would hijack ordinary scrolling.
      if (el.scrollTop === 0) {
        startY.current = e.touches[0].clientY;
        pullingRef.current = true;
        setPulling(true);
      }
    };

    const handleTouchMove = (e) => {
      if (!pullingRef.current || el.scrollTop !== 0) return;
      const distance = e.touches[0].clientY - startY.current;
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
