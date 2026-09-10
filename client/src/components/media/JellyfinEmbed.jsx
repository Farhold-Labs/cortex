import { mediaPlaybackUrl } from '../../utils/media.js';
import React, { useState } from 'react';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';

/**
 * Jellyfin Media Embed Component (v2.14.0)
 * Renders a media card for Jellyfin content shared in waves
 *
 * Embed URL format: cortex://jellyfin/{connectionId}/{itemId}?name={name}&type={type}&duration={ticks}
 */
const JellyfinEmbed = ({
  connectionId,
  shareId,
  itemId,
  name,
  type,
  duration,
  serverUrl,
  overview,
  onStartWatchParty,
  canStartWatchParty = false,
  onPlay,
}) => {
  const [imageError, setImageError] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [directStreamUrl, setDirectStreamUrl] = useState(null);
  const [loadingStream, setLoadingStream] = useState(false);

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

  // Include token in URL since <img src> and <video src> can't pass auth headers
  const token = storage.getToken();
  const shareQuery = shareId ? `&share=${encodeURIComponent(shareId)}` : '';
  const thumbnailUrl = `${API_URL}/jellyfin/thumbnail/${connectionId}/${itemId}?type=Primary&maxWidth=300${token ? `&token=${encodeURIComponent(token)}` : ''}${shareQuery}`;

  // Fetch direct stream URL from server
  const startPlayback = async () => {
    setLoadingStream(true);
    setVideoError(null);

    try {
      const response = await fetch(`${API_URL}/jellyfin/stream/${connectionId}/${itemId}?token=${encodeURIComponent(token)}${shareQuery}`);
      const data = await response.json();

      if (data.streamUrl) {
        setDirectStreamUrl(mediaPlaybackUrl(data.streamUrl, API_URL, token));
        setPlaying(true);
      } else if (data.error) {
        setVideoError(data.error);
      }
    } catch (err) {
      setVideoError('Failed to get stream URL');
    } finally {
      setLoadingStream(false);
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'Movie': return '🎬';
      case 'Series': return '📺';
      case 'Episode': return '📺';
      case 'Video': return '🎥';
      case 'MusicVideo': return '🎵';
      default: return '▶';
    }
  };

  return (
    <div style={{
      marginTop: '8px',
      maxWidth: '400px',
      background: 'linear-gradient(135deg, var(--bg-elevated), var(--bg-base))',
      border: '1px solid var(--accent-purple)40',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      {/* Video/Thumbnail area */}
      <div style={{
        position: 'relative',
        aspectRatio: '16/9',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {playing ? (
          /* Inline video player */
          <>
            <video
              src={directStreamUrl}
              controls
              autoPlay
              playsInline
              preload="auto"
              style={{
                width: '100%',
                height: '100%',
                background: '#000',
              }}
              onError={(e) => {
                const error = e.target.error;
                let msg = 'Failed to play video.';
                if (error) {
                  switch (error.code) {
                    case 1: msg = 'Video loading aborted.'; break;
                    case 2: msg = 'Network error while loading video.'; break;
                    case 3: msg = 'Video decoding error.'; break;
                    case 4: msg = 'Video format not supported.'; break;
                    default: msg = 'Failed to play video.';
                  }
                }
                setVideoError(msg);
              }}
            />
            {/* Close button */}
            <button
              onClick={() => {
                setPlaying(false);
                setVideoError(null);
                setDirectStreamUrl(null);
              }}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.7)',
                border: 'none',
                color: '#fff',
                fontSize: '16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close player"
            >
              ✕
            </button>
            {videoError && (
              <div style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                right: '8px',
                background: 'rgba(255,100,100,0.9)',
                color: '#fff',
                padding: '8px',
                fontSize: '0.75rem',
                borderRadius: '4px',
              }}>
                {videoError}
              </div>
            )}
          </>
        ) : (
          /* Thumbnail with play button */
          <>
            {!imageError ? (
              <img
                src={thumbnailUrl}
                alt={name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                onError={() => setImageError(true)}
              />
            ) : (
              <div style={{
                fontSize: '3rem',
                opacity: 0.3,
              }}>
                {getTypeIcon()}
              </div>
            )}

            {/* Play button overlay */}
            <button
              onClick={() => {
                if (onPlay) {
                  onPlay({ connectionId, itemId, name, type });
                } else {
                  startPlayback();
                }
              }}
              disabled={loadingStream}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: 'rgba(138, 43, 226, 0.9)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                color: '#fff',
                cursor: 'pointer',
                transition: 'transform 0.2s, background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
                e.currentTarget.style.background = 'rgba(138, 43, 226, 1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
                e.currentTarget.style.background = 'rgba(138, 43, 226, 0.9)';
              }}
              title="Play video"
            >
              ▶
            </button>

            {/* Duration badge */}
            {duration && !playing && (
              <div style={{
                position: 'absolute',
                bottom: '8px',
                right: '8px',
                background: 'rgba(0,0,0,0.8)',
                padding: '4px 8px',
                fontSize: '0.7rem',
                color: '#fff',
                borderRadius: '4px',
              }}>
                {formatDuration(duration)}
              </div>
            )}
          </>
        )}

        {/* Type badge */}
        {!playing && (
          <div style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(138, 43, 226, 0.9)',
            padding: '4px 8px',
            fontSize: '0.65rem',
            color: '#fff',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span>{getTypeIcon()}</span>
            <span>Jellyfin</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '12px' }}>
        <div style={{
          color: 'var(--text-primary)',
          fontSize: '0.9rem',
          fontWeight: 500,
          marginBottom: '4px',
        }}>
          {name}
        </div>

        <div style={{
          color: 'var(--text-muted)',
          fontSize: '0.7rem',
          marginBottom: '8px',
        }}>
          {type}
          {duration && ` • ${formatDuration(duration)}`}
        </div>

        {/* Overview toggle */}
        {overview && (
          <>
            <button
              onClick={() => setShowOverview(!showOverview)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-purple)',
                cursor: 'pointer',
                fontSize: '0.7rem',
                padding: 0,
                marginBottom: showOverview ? '8px' : 0,
              }}
            >
              {showOverview ? '▼ Hide description' : '▶ Show description'}
            </button>
            {showOverview && (
              <div style={{
                color: 'var(--text-secondary)',
                fontSize: '0.75rem',
                lineHeight: 1.4,
                maxHeight: '100px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {overview}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        {canStartWatchParty && onStartWatchParty && (
          <div style={{ marginTop: '12px' }}>
            <button
              onClick={() => onStartWatchParty({ connectionId, itemId, name, type })}
              style={{
                width: '100%',
                padding: '10px',
                background: 'var(--accent-purple)20',
                border: '1px solid var(--accent-purple)',
                color: 'var(--accent-purple)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <span>🎬</span> START WATCH PARTY
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Parse Jellyfin embed URL
 * Format: cortex://jellyfin/{connectionId}/{itemId}?name={name}&type={type}&duration={ticks}
 */
export const parseJellyfinUrl = (url) => {
  if (!url || !url.startsWith('cortex://jellyfin/')) return null;

  try {
    // Parse the URL
    const pathPart = url.replace('cortex://jellyfin/', '');
    const [pathWithParams] = pathPart.split('?');
    const [connectionId, itemId] = pathWithParams.split('/');

    if (!connectionId || !itemId) return null;

    // Parse query params
    const params = new URLSearchParams(url.split('?')[1] || '');

    return {
      connectionId,
      itemId,
      shareId: params.get('share') || null,
      name: params.get('name') || 'Unknown Media',
      type: params.get('type') || 'Video',
      duration: params.get('duration') ? parseInt(params.get('duration')) : null,
      overview: params.get('overview') || null,
    };
  } catch {
    return null;
  }
};

/**
 * Create Jellyfin embed URL from media info
 */
export const createJellyfinUrl = ({ connectionId, itemId, name, type, duration, overview, shareId }) => {
  const params = new URLSearchParams();
  if (shareId) params.set('share', shareId);
  if (name) params.set('name', name);
  if (type) params.set('type', type);
  if (duration) params.set('duration', duration.toString());
  if (overview) params.set('overview', overview.substring(0, 200)); // Limit length

  return `cortex://jellyfin/${connectionId}/${itemId}?${params.toString()}`;
};

export default JellyfinEmbed;
