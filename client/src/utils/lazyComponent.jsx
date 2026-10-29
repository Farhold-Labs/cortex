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
// launch "loading" one of these is a cache read, not a network request. A chunk
// that cannot load (the page outlived its build) is handled below.
export function lazyComponent(load, { fallback = null, renderIf = null } = {}) {
  const Lazy = React.lazy(load);
  function LazyComponent(props) {
    if (renderIf && !renderIf(props)) return null;
    return (
      <ChunkBoundary>
        <React.Suspense fallback={fallback}>
          <Lazy {...props} />
        </React.Suspense>
      </ChunkBoundary>
    );
  }
  return LazyComponent;
}

// ----- When a chunk will not load (v2.127.0) -----
//
// A page keeps running the build it started with. After a deploy that build's
// files may be gone, and the import rejects with "Failed to fetch dynamically
// imported module". Without a boundary that rejection unmounted the whole app:
// a blank screen, and since the login screen is lazy, signing out or an expired
// session left people unable to sign in until they cleared the cache. The
// server now keeps earlier builds' files for 30 days; this is for the rest.
//
// The cure is the current build, so the page reloads — once. If it fails again
// within a minute (offline, or a real fault) it shows a message with a Reload
// button rather than looping.

const RELOAD_KEY = 'cortex_chunk_reload_at';
const RELOAD_WINDOW_MS = 60 * 1000;

export function isChunkLoadError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i.test(text);
}

/** Reload onto the current build, unless that was just tried. True if reloading. */
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No session storage: reloading without a guard could loop, so don't.
    return false;
  }
  window.location.reload();
  return true;
}

export class ChunkBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (!isChunkLoadError(error)) return;
    if (reloadForNewBuild()) this.setState({ reloading: true });
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    // Anything else is a real fault in the screen: let it reach the boundary
    // that would have caught it before.
    if (!isChunkLoadError(error)) throw error;
    return (
      <div role="alert" style={{
        padding: '24px', color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: '0.85rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center',
      }}>
        {reloading ? 'Updating Cortex…' : (
          <>
            <div>Cortex has been updated, and this screen could not load.</div>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px', background: 'transparent', border: '1px solid var(--accent-amber)',
                color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace',
              }}
            >RELOAD</button>
          </>
        )}
      </div>
    );
  }
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
