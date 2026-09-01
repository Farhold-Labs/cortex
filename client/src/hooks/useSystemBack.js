import { useEffect, useRef } from 'react';

// Integrate with the platform's own "back", instead of inventing a gesture
// (v2.78.0, replacing the v2.77.0 left-edge swipe).
//
// ## Why the edge swipe had to go
//
// v2.77.0 reserved a 32px left strip for a back-swipe. That strip is not ours
// to reserve: **Android's system back gesture owns both screen edges.** In the
// installed PWA the system took the gesture and navigated back out of the app —
// so swiping to leave a wave closed Cortex. In the Capacitor build the system
// swallowed it too, and the only sign anything had happened was the back
// gesture's haptic tick. It was an iOS idiom applied to the wrong platform.
//
// The right answer is not a different gesture. Android already *has* a back
// gesture and a back button, and users already know them — so the fix is to
// make them mean "close this wave" instead of "quit". iOS Safari's own edge
// swipe drives history too, so both platforms are served by one mechanism and
// nothing has to be reserved.
//
// Pushes one history entry when `active` becomes true, and calls `onBack` when
// that entry is popped.

export function useSystemBack(active, onBack, { marker = 'cortex-back' } = {}) {
  const onBackRef = useRef(onBack);
  const pushedRef = useRef(false);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!active) return undefined;

    // One entry, and only one: pushing per render would take several presses
    // to escape a single wave.
    if (!pushedRef.current) {
      window.history.pushState({ [marker]: true }, '');
      pushedRef.current = true;
    }

    const onPop = () => {
      pushedRef.current = false;
      onBackRef.current?.();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      // Left by any other route (the ← button, opening another wave): drop the
      // entry we added, or it accumulates and back-presses stop doing anything
      // visible while the stack unwinds.
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [active, marker]);
}
