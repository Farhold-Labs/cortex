import React, { useState, useEffect, useRef } from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';

const GifSearchModal = ({ isOpen, onClose, onSelect, fetchAPI, isMobile }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [showTrending, setShowTrending] = useState(true);
  const [provider, setProvider] = useState('giphy'); // Track which provider returned results
  const [hasMore, setHasMore] = useState(true);
  const searchTimeoutRef = useRef(null);
  const offsetRef = useRef(0); // Use ref for synchronous offset tracking (GIPHY)
  const nextTokenRef = useRef(''); // Tenor pagination token

  // Load trending GIFs when modal opens and reset state
  useEffect(() => {
    if (isOpen) {
      offsetRef.current = 0;
      nextTokenRef.current = '';
      setGifs([]);
      setHasMore(true);
      if (showTrending) {
        loadTrending();
      }
    }
  }, [isOpen]);

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

      console.log(`Loading trending GIFs with offset: ${currentOffset}, pos: "${currentPos}"`);
      const data = await fetchAPI(url);
      const newGifs = data.gifs || [];
      if (loadMore) {
        setGifs(prev => [...prev, ...newGifs]);
      } else {
        setGifs(newGifs);
      }
      setProvider(data.provider || 'giphy');
      offsetRef.current = currentOffset + newGifs.length;

      // Store next token from Tenor API (null/undefined for GIPHY)
      nextTokenRef.current = data.pagination?.next || '';
      console.log(`Loaded ${newGifs.length} GIFs, new offset: ${offsetRef.current}, next token: "${nextTokenRef.current}"`);

      // Has more if: we got 20 GIFs AND (there's a next token OR we're using GIPHY)
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
      setShowTrending(true);
      loadTrending();
      return;
    }
    setShowTrending(false);
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

      console.log(`Searching GIFs for "${query}" with offset: ${currentOffset}, pos: "${currentPos}"`);
      const data = await fetchAPI(url);
      const newGifs = data.gifs || [];
      if (loadMore) {
        setGifs(prev => [...prev, ...newGifs]);
      } else {
        setGifs(newGifs);
      }
      setProvider(data.provider || 'giphy');
      offsetRef.current = currentOffset + newGifs.length;

      // Store next token from Tenor API (null/undefined for GIPHY)
      nextTokenRef.current = data.pagination?.next || '';
      console.log(`Loaded ${newGifs.length} GIFs, new offset: ${offsetRef.current}, next token: "${nextTokenRef.current}"`);

      // Has more if: we got 20 GIFs AND (there's a next token OR we're using GIPHY)
      setHasMore(newGifs.length === 20 && (nextTokenRef.current || !data.pagination?.next));
    } catch (err) {
      setError(err.message || 'Failed to search GIFs');
    } finally {
      setLoading(false);
      setLoadingMore(false);
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

        {/* Search Input */}
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
          <div style={{
            color: 'var(--text-muted)',
            fontSize: '0.65rem',
            marginTop: '6px',
            textAlign: 'center',
          }}>
            {showTrending ? '🔥 TRENDING' : `Searching for "${searchQuery}"`}
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
              {searchQuery ? 'No GIFs found' : 'Search for GIFs above'}
            </div>
          )}

          {!loading && gifs.length > 0 && (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                gap: '8px',
              }}>
                {gifs.map((gif) => (
                  <button
                    key={gif.id}
                    onClick={() => onSelect(gif.url)}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      padding: 0,
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
                  </button>
                ))}
              </div>

              {/* Load More Button */}
              {hasMore && !loadingMore && (
                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                  <button
                    onClick={() => showTrending ? loadTrending(true) : searchGifs(searchQuery, true)}
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
          Powered by {provider === 'klipy' ? 'Klipy' : provider === 'tenor' ? 'Tenor' : provider === 'both' ? 'GIPHY & Klipy' : 'GIPHY'}
        </div>
      </div>
    </div>
  );
};

export default GifSearchModal;
