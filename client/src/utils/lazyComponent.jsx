import React from 'react';

// Load a component's code the first time it is shown, not with the app (v2.107.0).
//
// The main bundle carried every screen and modal, so a phone on a weak signal
// downloaded and parsed Settings, the calendar, the video feed, the theme
// editor and the rest before it could show a single wave. Each use of this
// helper moves one of them into its own chunk.
//
// The returned component brings its own Suspense boundary, so call sites stay
// unchanged and one slow chunk never blanks the rest of the screen.
//
// `renderIf` is for components that are always mounted and decide visibility
// themselves through an `isOpen` prop: rendering them at all would fetch the
// chunk immediately and gain nothing, so while `renderIf(props)` is false
// nothing is rendered and nothing is fetched.
//
// The service worker precaches every chunk at install, so after the first
// launch "loading" one of these is a cache read, not a network request.
export function lazyComponent(load, { fallback = null, renderIf = null } = {}) {
  const Lazy = React.lazy(load);
  function LazyComponent(props) {
    if (renderIf && !renderIf(props)) return null;
    return (
      <React.Suspense fallback={fallback}>
        <Lazy {...props} />
      </React.Suspense>
    );
  }
  return LazyComponent;
}

// Placeholder for a whole view (Settings, Calendar…) while its code arrives.
export const ViewLoading = (
  <div style={{ padding: '24px', color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: '0.8rem' }}>
    Loading…
  </div>
);

// The same branded loader index.html paints before the app boots (its styles
// live there), for a screen that is the first thing someone sees.
export const BootLoading = (
  <div id="initial-loader">
    <div className="il-logo">CORTEX</div>
    <div className="il-sub">ESTABLISHING SIGNAL…</div>
    <div className="il-track"><div className="il-bar"></div></div>
  </div>
);

export default lazyComponent;
