import React, { useState, useEffect, useCallback } from 'react';
import { GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';

/**
 * Jellyfin Media Browser Modal (v2.14.0)
 * Allows users to browse their Jellyfin libraries and select media to share
 */
const JellyfinBrowserModal = ({ isOpen, onClose, onSelect, fetchAPI, isMobile, connections, waveId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [libraries, setLibraries] = useState([]);
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, name}]
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);

  // Load connections when modal opens
  useEffect(() => {
    if (isOpen && connections && connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0]);
    }
  }, [isOpen, connections, selectedConnection]);

  // Load libraries when connection changes
  useEffect(() => {
    if (selectedConnection) {
      loadLibraries();
    }
  }, [selectedConnection]);

  const loadLibraries = async () => {
    if (!selectedConnection) return;
    setLoading(true);
    setError(null);
    setBreadcrumbs([]);
    setItems([]);
    try {
      const data = await fetchAPI(`/jellyfin/library/${selectedConnection.id}`);
      setLibraries(data.libraries || []);
    } catch (err) {
      setError(err.message || 'Failed to load libraries');
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async (parentId = null, parentName = null) => {
    if (!selectedConnection) return;
    setLoading(true);
    setError(null);
    setSearchResults(null);
    try {
      const params = new URLSearchParams({
        includeTypes: 'Movie,Series,Episode,Video,MusicVideo',
        limit: '50',
      });
      if (parentId) params.set('parentId', parentId);

      const data = await fetchAPI(`/jellyfin/items/${selectedConnection.id}?${params.toString()}`);
      setItems(data.items || []);

      // Update breadcrumbs
      if (parentId && parentName) {
        setBreadcrumbs(prev => [...prev, { id: parentId, name: parentName }]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  };

  const searchItems = useCallback(async (query) => {
    if (!selectedConnection || !query.trim()) {
      setSearchResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        searchTerm: query,
        includeTypes: 'Movie,Series,Episode,Video,MusicVideo',
        limit: '50',
      });
      const data = await fetchAPI(`/jellyfin/items/${selectedConnection.id}?${params.toString()}`);
      setSearchResults(data.items || []);
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [selectedConnection, fetchAPI]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        searchItems(searchQuery);
      } else {
        setSearchResults(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, searchItems]);

  const handleLibraryClick = (library) => {
    setBreadcrumbs([{ id: library.id, name: library.name }]);
    loadItems(library.id, library.name);
  };

  const handleItemClick = async (item) => {
    if (item.type === 'Series' || item.type === 'Season' || item.type === 'Folder') {
      // Navigate into folder/series
      loadItems(item.id, item.name);
    } else {
      if (!waveId) { setError('Open this picker from a wave to share media.'); return; }
      setLoading(true);
      setError(null);
      try {
        const { share } = await fetchAPI('/media/shares', { method: 'POST', body: {
          provider: 'jellyfin', connectionId: selectedConnection.id, itemId: String(item.id), waveId,
        } });
        await onSelect({
          shareId: share.id,
          connectionId: selectedConnection.id,
          serverUrl: selectedConnection.serverUrl,
          itemId: item.id,
          name: item.name,
          type: item.type,
          overview: item.overview,
          runTimeTicks: item.runTimeTicks,
          seriesName: item.seriesName,
          imageTag: item.primaryImageTag,
        });
      } catch (err) {
        setError(err.message || 'Failed to share media');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleBreadcrumbClick = (index) => {
    if (index < 0) {
      // Go back to library list
      setBreadcrumbs([]);
      setItems([]);
    } else {
      // Navigate to specific breadcrumb
      const crumb = breadcrumbs[index];
      setBreadcrumbs(breadcrumbs.slice(0, index + 1));
      loadItems(crumb.id, crumb.name);
    }
  };

  const formatDuration = (ticks) => {
    if (!ticks) return null;
    const seconds = Math.floor(ticks / 10000000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getImageUrl = (item) => {
    if (!item.primaryImageTag || !selectedConnection) return null;
    const token = storage.getToken();
    return `${API_URL}/jellyfin/thumbnail/${selectedConnection.id}/${item.id}?type=Primary&maxWidth=200${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  };

  if (!isOpen) return null;

  const displayItems = searchResults || items;
  const showingSearch = searchResults !== null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: isMobile ? '10px' : '20px',
    }} onClick={onClose}>
      <div style={{
        width: '100%',
        maxWidth: isMobile ? '100%' : '800px',
        maxHeight: isMobile ? '95vh' : '85vh',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-purple)40',
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
          <GlowText color="var(--accent-purple)" size={isMobile ? '1rem' : '0.9rem'}>
            JELLYFIN MEDIA
          </GlowText>
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

        {/* Connection Selector & Search */}
        <div style={{ padding: isMobile ? '12px 16px' : '10px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          {/* Connection dropdown */}
          {connections && connections.length > 1 && (
            <div style={{ marginBottom: '10px' }}>
              <select
                value={selectedConnection?.id || ''}
                onChange={(e) => {
                  const conn = connections.find(c => c.id === e.target.value);
                  setSelectedConnection(conn);
                  setBreadcrumbs([]);
                  setItems([]);
                  setSearchQuery('');
                  setSearchResults(null);
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                }}
              >
                {connections.map(conn => (
                  <option key={conn.id} value={conn.id}>
                    {conn.serverName || conn.serverUrl}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Search input */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search media..."
            style={{
              width: '100%',
              padding: isMobile ? '14px 16px' : '10px 14px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--accent-purple)50',
              color: 'var(--text-primary)',
              fontSize: isMobile ? '1rem' : '0.9rem',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && !showingSearch && (
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            fontSize: '0.75rem',
          }}>
            <button
              onClick={() => handleBreadcrumbClick(-1)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-purple)',
                cursor: 'pointer',
                padding: '4px 8px',
                fontFamily: 'monospace',
              }}
            >
              Libraries
            </button>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <button
                  onClick={() => idx < breadcrumbs.length - 1 && handleBreadcrumbClick(idx)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: idx < breadcrumbs.length - 1 ? 'var(--accent-purple)' : 'var(--text-primary)',
                    cursor: idx < breadcrumbs.length - 1 ? 'pointer' : 'default',
                    padding: '4px 8px',
                    fontFamily: 'monospace',
                  }}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: isMobile ? '12px' : '16px',
        }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <LoadingSpinner />
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

          {!loading && !error && !selectedConnection && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
              No Jellyfin servers connected. Add a server in Settings.
            </div>
          )}

          {/* Library List */}
          {!loading && !error && selectedConnection && breadcrumbs.length === 0 && !showingSearch && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
              gap: '12px',
            }}>
              {libraries.map(lib => (
                <button
                  key={lib.id}
                  onClick={() => handleLibraryClick(lib)}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    padding: '16px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{
                    fontSize: '2rem',
                    opacity: 0.6,
                  }}>
                    {lib.collectionType === 'movies' ? '🎬' :
                     lib.collectionType === 'tvshows' ? '📺' :
                     lib.collectionType === 'music' ? '🎵' :
                     lib.collectionType === 'homevideos' ? '🎥' : '📁'}
                  </div>
                  <div style={{
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                  }}>
                    {lib.name}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Media Items Grid */}
          {!loading && !error && displayItems.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
              gap: '12px',
            }}>
              {displayItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    padding: 0,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textAlign: 'left',
                  }}
                  title={item.overview || item.name}
                >
                  {/* Thumbnail */}
                  <div style={{
                    aspectRatio: '2/3',
                    background: 'var(--bg-base)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    {item.primaryImageTag ? (
                      <img
                        src={getImageUrl(item)}
                        alt={item.name}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: '2.5rem', opacity: 0.3 }}>
                        {item.type === 'Series' || item.type === 'Season' ? '📺' :
                         item.type === 'Movie' ? '🎬' :
                         item.type === 'Episode' ? '📺' :
                         item.type === 'MusicVideo' ? '🎵' : '🎥'}
                      </div>
                    )}
                    {/* Type badge */}
                    <div style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '4px',
                      background: 'rgba(0,0,0,0.7)',
                      padding: '2px 6px',
                      fontSize: '0.6rem',
                      color: 'var(--text-secondary)',
                      borderRadius: '2px',
                    }}>
                      {item.type}
                    </div>
                    {/* Duration badge */}
                    {item.runTimeTicks && (
                      <div style={{
                        position: 'absolute',
                        bottom: '4px',
                        left: '4px',
                        background: 'rgba(0,0,0,0.7)',
                        padding: '2px 6px',
                        fontSize: '0.6rem',
                        color: 'var(--text-secondary)',
                        borderRadius: '2px',
                      }}>
                        {formatDuration(item.runTimeTicks)}
                      </div>
                    )}
                  </div>
                  {/* Title */}
                  <div style={{ padding: '8px' }}>
                    <div style={{
                      color: 'var(--text-primary)',
                      fontSize: '0.75rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.name}
                    </div>
                    {item.seriesName && (
                      <div style={{
                        color: 'var(--text-muted)',
                        fontSize: '0.65rem',
                        marginTop: '2px',
                      }}>
                        {item.seriesName}
                        {item.parentIndexNumber && item.indexNumber &&
                          ` S${item.parentIndexNumber}E${item.indexNumber}`}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && !error && breadcrumbs.length > 0 && displayItems.length === 0 && !showingSearch && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
              No media found in this folder
            </div>
          )}

          {!loading && !error && showingSearch && searchResults.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
              No results found for "{searchQuery}"
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border-subtle)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.6rem',
        }}>
          {selectedConnection ? `Connected to ${selectedConnection.serverName || selectedConnection.serverUrl}` : 'No server selected'}
        </div>
      </div>
    </div>
  );
};

export default JellyfinBrowserModal;
