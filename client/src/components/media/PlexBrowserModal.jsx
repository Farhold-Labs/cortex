import React, { useState, useEffect, useCallback } from 'react';
import { GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';

/**
 * Plex Media Browser Modal (v2.15.0)
 * Allows users to browse their Plex libraries and select media to share
 */
const PlexBrowserModal = ({ isOpen, onClose, onSelect, fetchAPI, isMobile, connections, waveId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [sections, setSections] = useState([]);
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{key, name, type}]
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);

  // Load connections when modal opens
  useEffect(() => {
    if (isOpen && connections && connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0]);
    }
  }, [isOpen, connections, selectedConnection]);

  // Load library sections when connection changes
  useEffect(() => {
    if (selectedConnection) {
      loadSections();
    }
  }, [selectedConnection]);

  const loadSections = async () => {
    if (!selectedConnection) return;
    setLoading(true);
    setError(null);
    setBreadcrumbs([]);
    setItems([]);
    try {
      const data = await fetchAPI(`/plex/library/${selectedConnection.id}`);
      setSections(data.sections || []);
    } catch (err) {
      setError(err.message || 'Failed to load library sections');
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async (sectionKey = null, parentRatingKey = null, name = null) => {
    if (!selectedConnection) return;
    setLoading(true);
    setError(null);
    setSearchResults(null);
    try {
      const params = new URLSearchParams();
      if (sectionKey) params.set('sectionKey', sectionKey);
      if (parentRatingKey) params.set('parentRatingKey', parentRatingKey);
      params.set('limit', '50');

      const data = await fetchAPI(`/plex/items/${selectedConnection.id}?${params.toString()}`);
      setItems(data.items || []);

      // Update breadcrumbs
      if (name) {
        setBreadcrumbs(prev => [...prev, { key: sectionKey || parentRatingKey, name }]);
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
        limit: '50',
      });
      const data = await fetchAPI(`/plex/items/${selectedConnection.id}?${params.toString()}`);
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

  const handleSectionClick = (section) => {
    setBreadcrumbs([{ key: section.key, name: section.title }]);
    loadItems(section.key, null, section.title);
  };

  const handleItemClick = async (item) => {
    if (item.type === 'show' || item.type === 'season') {
      // Navigate into show/season
      loadItems(null, item.ratingKey, item.title);
    } else {
      if (!waveId) { setError('Open this picker from a wave to share media.'); return; }
      setLoading(true);
      setError(null);
      try {
        const { share } = await fetchAPI('/media/shares', { method: 'POST', body: {
          provider: 'plex', connectionId: selectedConnection.id, itemId: String(item.ratingKey), waveId,
        } });
        await onSelect({
          shareId: share.id,
          connectionId: selectedConnection.id,
          serverUrl: selectedConnection.serverUrl,
          ratingKey: item.ratingKey,
          name: item.title,
          type: item.type,
          summary: item.summary,
          duration: item.duration,
          grandparentTitle: item.grandparentTitle,
          parentTitle: item.parentTitle,
          index: item.index,
          parentIndex: item.parentIndex,
          thumb: item.thumb,
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
      // Go back to section list
      setBreadcrumbs([]);
      setItems([]);
    } else if (index === 0) {
      // First breadcrumb is the section - reload it
      const sectionKey = breadcrumbs[0].key;
      setBreadcrumbs([breadcrumbs[0]]);
      loadItems(sectionKey, null, null);
    } else {
      // Navigate to specific breadcrumb
      setBreadcrumbs(breadcrumbs.slice(0, index + 1));
    }
  };

  const formatDuration = (ms) => {
    if (!ms) return null;
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getImageUrl = (item) => {
    if (!item.thumb || !selectedConnection) return null;
    const token = storage.getToken();
    return `${API_URL}/plex/thumbnail/${selectedConnection.id}/${item.ratingKey}?width=200&height=300${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  };

  const getSectionIcon = (type) => {
    switch (type) {
      case 'movie': return '🎬';
      case 'show': return '📺';
      case 'artist': return '🎵';
      case 'photo': return '📷';
      default: return '📁';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'movie': return '🎬';
      case 'show': return '📺';
      case 'season': return '📅';
      case 'episode': return '📺';
      case 'track': return '🎵';
      case 'album': return '💿';
      case 'artist': return '🎤';
      default: return '🎥';
    }
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
        border: '2px solid #e5a00d40', // Plex orange
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
          <GlowText color="#e5a00d" size={isMobile ? '1rem' : '0.9rem'}>
            PLEX MEDIA
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
          }}>X CLOSE</button>
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
              border: '1px solid #e5a00d50',
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
                color: '#e5a00d',
                cursor: 'pointer',
                padding: '4px 8px',
                fontFamily: 'monospace',
              }}
            >
              Libraries
            </button>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <button
                  onClick={() => idx < breadcrumbs.length - 1 && handleBreadcrumbClick(idx)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: idx < breadcrumbs.length - 1 ? '#e5a00d' : 'var(--text-primary)',
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
              No Plex servers connected. Add a server in Settings.
            </div>
          )}

          {/* Section List */}
          {!loading && !error && selectedConnection && breadcrumbs.length === 0 && !showingSearch && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
              gap: '12px',
            }}>
              {sections.map(section => (
                <button
                  key={section.key}
                  onClick={() => handleSectionClick(section)}
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
                    {getSectionIcon(section.type)}
                  </div>
                  <div style={{
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                  }}>
                    {section.title}
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
                  key={item.ratingKey}
                  onClick={() => handleItemClick(item)}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    padding: 0,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textAlign: 'left',
                  }}
                  title={item.summary || item.title}
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
                    {item.thumb ? (
                      <img
                        src={getImageUrl(item)}
                        alt={item.title}
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
                        {getTypeIcon(item.type)}
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
                    {item.duration && (
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
                        {formatDuration(item.duration)}
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
                      {item.title}
                    </div>
                    {(item.grandparentTitle || item.parentTitle) && (
                      <div style={{
                        color: 'var(--text-muted)',
                        fontSize: '0.65rem',
                        marginTop: '2px',
                      }}>
                        {item.grandparentTitle || item.parentTitle}
                        {item.parentIndex !== undefined && item.index !== undefined &&
                          ` S${item.parentIndex}E${item.index}`}
                      </div>
                    )}
                    {item.year && !item.grandparentTitle && (
                      <div style={{
                        color: 'var(--text-muted)',
                        fontSize: '0.65rem',
                        marginTop: '2px',
                      }}>
                        {item.year}
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

export default PlexBrowserModal;
