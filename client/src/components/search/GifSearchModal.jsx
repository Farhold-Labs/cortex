import React, { useState, useEffect, useRef } from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';

const GifSearchModal = ({ isOpen, onClose, onSelect, fetchAPI, isMobile }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('trending'); // 'trending' | 'search' | 'favorites'
  const [provider, setProvider] = useState('giphy'); // Track which provider returned results
  const [hasMore, setHasMore] = useState(true);
  const [favoriteKeys, setFavoriteKeys] = useState(new Set()); // "provider:id" of favorited GIFs
  const searchTimeoutRef = useRef(null);
  const offsetRef = useRef(0); // Use ref for synchronous offset tracking (GIPHY/Klipy)
  const nextTokenRef = useRef(''); // Tenor pagination token

  const keyOf = (gif) => `${gif.provider || provider}:${gif.id}`;

  // Load trending GIFs + favorite state when the modal opens; reset everything.
  useEffect(() => {
    if (isOpen) {
      offsetRef.current = 0;
      nextTokenRef.current = '';
      setGifs([]);
      setHasMore(true);
      setSearchQuery('');
      setView('trending');
      refreshFavoriteKeys();
      loadTrending();
    }
  }, [isOpen]);

  // Fetch just the set of favorited keys so ★ state is correct on any view.
  const refreshFavoriteKeys = async () => {
    try {
      const data = await fetchAPI('/gifs/favorites');
      setFavoriteKeys(new Set((data.gifs || []).map(g => `${g.provider}:${g.id}`)));
    } catch (err) {
      // Non-fatal — stars just won't pre-fill
    }
  };

  const loadTrending = async (loadMore = false) => {
    if (loadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      offsetRef.current = 0;
      nextTokenRef.current = '';
    }
    setError(null);
    try {
      const currentOffset = loadMore ? offsetRef.current : 0;
      const currentPos = loadMore ? nextTokenRef.current : '';

      // Build URL with pos parameter for Tenor token pagination
      let url = `/gifs/trending?limit=20&offset=${currentOffset}`;
      if (currentPos) {
        url += `&pos=${encodeURIComponent(currentPos)}`;
      }

      const data = await fetchAPI(url);
      const newGifs = data.gifs || [];
      if (loadMore) {
        setGifs(prev => [...prev, ...newGifs]);
      } else {
        setGifs(newGifs);
      }
      setProvider(data.provider || 'giphy');
      offsetRef.current = currentOffset + newGifs.length;

      // Store next token from Tenor API (null/undefined for GIPHY/Klipy)
      nextTokenRef.current = data.pagination?.next || '';

      // Has more if: we got a full page AND (there's a next token OR we're offset-based)
      setHasMore(newGifs.length === 20 && (nextTokenRef.current || !data.pagination?.next));
    } catch (err) {
      setError(err.message || 'Failed to load trending GIFs');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const searchGifs = async (query, loadMore = false) => {
    if (!query.trim()) {
      setView('trending');
      loadTrending();
      return;
    }
    setView('search');
    if (loadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      offsetRef.current = 0;
      nextTokenRef.current = '';
    }
    setError(null);
    try {
      const currentOffset = loadMore ? offsetRef.current : 0;
      const currentPos = loadMore ? nextTokenRef.current : '';

      // Build URL with pos parameter for Tenor token pagination
      let url = `/gifs/search?q=${encodeURIComponent(query)}&limit=20&offset=${currentOffset}`;
      if (currentPos) {
        url += `&pos=${encodeURIComponent(currentPos)}`;
      }

      const data = await fetchAPI(url);
      const newGifs = data.gifs || [];
      if (loadMore) {
        setGifs(prev => [...prev, ...newGifs]);
      } else {
        setGifs(newGifs);
      }
      setProvider(data.provider || 'giphy');
      offsetRef.current = currentOffset + newGifs.length;

      // Store next token from Tenor API (null/undefined for GIPHY/Klipy)
      nextTokenRef.current = data.pagination?.next || '';

      setHasMore(newGifs.length === 20 && (nextTokenRef.current || !data.pagination?.next));
    } catch (err) {
      setError(err.message || 'Failed to search GIFs');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadFavorites = async () => {
    setView('favorites');
    setSearchQuery('');
    setLoading(true);
    setError(null);
    setHasMore(false); // favorites aren't paginated
    try {
      const data = await fetchAPI('/gifs/favorites');
      const favs = data.gifs || [];
      setGifs(favs);
      setFavoriteKeys(new Set(favs.map(g => `${g.provider}:${g.id}`)));
    } catch (err) {
      setError(err.message || 'Failed to load favorites');
    } finally {
      setLoading(false);
    }
  };

  const showTrendingView = () => {
    setSearchQuery('');
    setView('trending');
    loadTrending();
  };

  const toggleFavorite = async (gif, e) => {
    e.stopPropagation();
    const k = keyOf(gif);
    const gifProvider = gif.provider || provider;
    const isFav = favoriteKeys.has(k);

    // Optimistic update
    setFavoriteKeys(prev => {
      const next = new Set(prev);
      if (isFav) next.delete(k); else next.add(k);
      return next;
    });
    if (isFav && view === 'favorites') {
      setGifs(prev => prev.filter(g => `${g.provider || provider}:${g.id}` !== k));
    }

    try {
      if (isFav) {
        await fetchAPI(`/gifs/favorites?provider=${encodeURIComponent(gifProvider)}&id=${encodeURIComponent(gif.id)}`, { method: 'DELETE' });
      } else {
        await fetchAPI('/gifs/favorites', {
          method: 'POST',
          body: {
            id: gif.id,
            provider: gifProvider,
            url: gif.url,
            preview: gif.preview,
            width: gif.width,
            height: gif.height,
            title: gif.title,
          },
        });
      }
    } catch (err) {
      // Revert on failure
      setFavoriteKeys(prev => {
        const next = new Set(prev);
        if (isFav) next.add(k); else next.delete(k);
        return next;
      });
      setError(err.message || 'Failed to update favorite');
    }
  };

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);

    // Debounce search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      searchGifs(query);
    }, 500);
  };

  if (!isOpen) return null;

  const tabStyle = (active) => ({
    flex: 1,
    background: active ? 'var(--accent-teal)20' : 'transparent',
    border: '1px solid ' + (active ? 'var(--accent-teal)60' : 'var(--border-subtle)'),
    color: active ? 'var(--accent-teal)' : 'var(--text-dim)',
    padding: isMobile ? '10px' : '7px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.72rem',
    fontWeight: 'bold',
    minHeight: isMobile ? '40px' : 'auto',
  });

  const statusText = view === 'favorites'
    ? '⭐ FAVORITES'
    : view === 'search'
      ? `Searching for "${searchQuery}"`
      : '🔥 TRENDING';

  const emptyText = view === 'favorites'
    ? 'No favorites yet — tap the ☆ on any GIF to save it'
    : view === 'search'
      ? 'No GIFs found'
      : 'Search for GIFs above';

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: isMobile ? '10px' : '20px',
    }} onClick={onClose}>
      <div style={{
        width: '100%',
        maxWidth: isMobile ? '100%' : '600px',
        maxHeight: isMobile ? '90vh' : '80vh',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-teal)40',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: isMobile ? '14px 16px' : '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <GlowText color="var(--accent-teal)" size={isMobile ? '1rem' : '0.9rem'}>GIF SEARCH</GlowText>
          <button onClick={onClose} style={{
            background: 'transparent',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: isMobile ? '10px 14px' : '6px 12px',
            minHeight: isMobile ? '44px' : 'auto',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
          }}>✕ CLOSE</button>
        </div>

        {/* Search Input + Tabs */}
        <div style={{ padding: isMobile ? '14px 16px' : '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search for GIFs..."
            autoFocus
            style={{
              width: '100%',
              padding: isMobile ? '14px 16px' : '10px 14px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--accent-teal)50',
              color: 'var(--text-primary)',
              fontSize: isMobile ? '1rem' : '0.9rem',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={showTrendingView} style={tabStyle(view !== 'favorites')}>🔥 TRENDING</button>
            <button onClick={loadFavorites} style={tabStyle(view === 'favorites')}>⭐ FAVORITES</button>
          </div>
          <div style={{
            color: 'var(--text-muted)',
            fontSize: '0.65rem',
            marginTop: '8px',
            textAlign: 'center',
          }}>
            {statusText}
          </div>
        </div>

        {/* GIF Grid */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: isMobile ? '12px' : '12px 16px',
        }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
              Loading GIFs...
            </div>
          )}

          {error && (
            <div style={{
              textAlign: 'center',
              padding: '20px',
              color: 'var(--accent-orange)',
              background: 'var(--accent-orange)10',
              border: '1px solid var(--accent-orange)30',
              marginBottom: '12px',
            }}>
              {error}
            </div>
          )}

          {!loading && !error && gifs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
              {emptyText}
            </div>
          )}

          {!loading && gifs.length > 0 && (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                gap: '8px',
              }}>
                {gifs.map((gif) => {
                  const favorited = favoriteKeys.has(keyOf(gif));
                  return (
                    <div
                      key={keyOf(gif)}
                      onClick={() => onSelect(gif.url)}
                      role="button"
                      style={{
                        position: 'relative',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        aspectRatio: '1',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={gif.title}
                    >
                      <img
                        src={gif.preview}
                        alt={gif.title}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                      <button
                        onClick={(e) => toggleFavorite(gif, e)}
                        title={favorited ? 'Remove from favorites' : 'Add to favorites'}
                        aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
                        style={{
                          position: 'absolute',
                          top: '4px',
                          right: '4px',
                          width: isMobile ? '32px' : '26px',
                          height: isMobile ? '32px' : '26px',
                          borderRadius: '50%',
                          border: 'none',
                          background: 'rgba(0,0,0,0.55)',
                          color: favorited ? 'var(--accent-amber)' : '#fff',
                          cursor: 'pointer',
                          fontSize: isMobile ? '1rem' : '0.85rem',
                          lineHeight: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        {favorited ? '★' : '☆'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Load More Button */}
              {hasMore && !loadingMore && (
                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                  <button
                    onClick={() => view === 'search' ? searchGifs(searchQuery, true) : loadTrending(true)}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--accent-teal)50',
                      color: 'var(--accent-teal)',
                      padding: isMobile ? '14px 24px' : '10px 20px',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      minHeight: isMobile ? '44px' : 'auto',
                      width: isMobile ? '100%' : 'auto',
                    }}
                  >
                    LOAD MORE GIFs
                  </button>
                </div>
              )}

              {loadingMore && (
                <div style={{ textAlign: 'center', marginTop: '16px', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                  Loading more...
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer - Provider Attribution */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border-subtle)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.6rem',
        }}>
          {view === 'favorites'
            ? 'Your favorite GIFs'
            : `Powered by ${provider === 'klipy' ? 'Klipy' : provider === 'tenor' ? 'Tenor' : provider === 'both' ? 'GIPHY & Klipy' : 'GIPHY'}`}
        </div>
      </div>
    </div>
  );
};

export default GifSearchModal;
