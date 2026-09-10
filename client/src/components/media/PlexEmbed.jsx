import { mediaPlaybackUrl } from '../../utils/media.js';
import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';

/**
 * Plex Media Embed Component (v2.15.0)
 * Renders a media card for Plex content shared in waves
 * Supports both direct play (MP4) and HLS transcoded streams
 *
 * Embed URL format: cortex://plex/{connectionId}/{ratingKey}?name={name}&type={type}&duration={ms}
 */
const PlexEmbed = ({
  connectionId,
  shareId,
  ratingKey,
  name,
  type,
  duration,
  summary,
  onPlay,
}) => {
  const [imageError, setImageError] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [streamUrl, setStreamUrl] = useState(null);
  const [streamFormat, setStreamFormat] = useState(null); // 'direct' or 'hls'
  const [loadingStream, setLoadingStream] = useState(false);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

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

  // Include token in URL since <img src> and <video src> can't pass auth headers
  const token = storage.getToken();
  const shareQuery = shareId ? `&share=${encodeURIComponent(shareId)}` : '';
  const thumbnailUrl = `${API_URL}/plex/thumbnail/${connectionId}/${ratingKey}?width=300&height=450${token ? `&token=${encodeURIComponent(token)}` : ''}${shareQuery}`;

  // Clean up HLS instance on unmount or when stopping playback
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);

  // Initialize HLS player when we have an HLS stream URL
  useEffect(() => {
    if (playing && streamFormat === 'hls' && streamUrl && videoRef.current) {
      if (Hls.isSupported()) {
        // Clean up any existing HLS instance
        if (hlsRef.current) {
          hlsRef.current.destroy();
        }

        const hls = new Hls();

        hls.loadSource(streamUrl);
        hls.attachMedia(videoRef.current);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play().catch((e) => {
            console.warn('Autoplay blocked:', e);
          });
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS error:', data);
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setVideoError('Network error loading video. Try again.');
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                setVideoError('Media error. Attempting recovery...');
                hls.recoverMediaError();
                break;
              default:
                setVideoError('Failed to play video. The format may not be supported.');
                hls.destroy();
                break;
            }
          }
        });

        hlsRef.current = hls;
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari has native HLS support
        videoRef.current.src = streamUrl;
        videoRef.current.play().catch((e) => {
          console.warn('Autoplay blocked:', e);
        });
      } else {
        setVideoError('HLS playback not supported in this browser.');
      }
    }
  }, [playing, streamFormat, streamUrl]);

  // Fetch stream URL from server
  const startPlayback = async () => {
    setLoadingStream(true);
    setVideoError(null);

    try {
      const response = await fetch(`${API_URL}/plex/stream/${connectionId}/${ratingKey}?${shareQuery.slice(1)}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        setVideoError(data.error || 'Failed to get stream info');
        return;
      }

      if (data.needsHlsPlayer && data.streamUrl) {
        // HLS playlists and segments stay on the authenticated Cortex proxy.
        console.log('Plex: Using HLS stream');
        setStreamUrl(mediaPlaybackUrl(data.streamUrl, API_URL, token));
        setStreamFormat('hls');
        setPlaying(true);
      } else if (data.streamUrl) {
        // Direct stream - proxy through our server
        const fullStreamUrl = mediaPlaybackUrl(data.streamUrl, API_URL, token);
        console.log('Plex: Using direct stream');
        setStreamUrl(fullStreamUrl);
        setStreamFormat('direct');
        setPlaying(true);
      } else if (data.error) {
        setVideoError(data.error);
      }
    } catch (err) {
      setVideoError('Failed to connect to server');
    } finally {
      setLoadingStream(false);
    }
  };

  // Stop playback and clean up
  const stopPlayback = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setPlaying(false);
    setVideoError(null);
    setStreamUrl(null);
    setStreamFormat(null);
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'movie': return '🎬';
      case 'show': return '📺';
      case 'season': return '📅';
      case 'episode': return '📺';
      case 'track': return '🎵';
      case 'album': return '💿';
      case 'artist': return '🎤';
      default: return '▶';
    }
  };

  const getTypeLabel = () => {
    switch (type) {
      case 'movie': return 'Movie';
      case 'show': return 'Series';
      case 'season': return 'Season';
      case 'episode': return 'Episode';
      case 'track': return 'Track';
      case 'album': return 'Album';
      case 'artist': return 'Artist';
      default: return 'Video';
    }
  };

  // Plex orange color
  const plexColor = '#e5a00d';

  return (
    <div style={{
      marginTop: '8px',
      maxWidth: '400px',
      background: 'linear-gradient(135deg, var(--bg-elevated), var(--bg-base))',
      border: `1px solid ${plexColor}40`,
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
              ref={videoRef}
              src={streamFormat === 'direct' ? streamUrl : undefined}
              controls
              autoPlay={streamFormat === 'direct'}
              playsInline
              preload="auto"
              style={{
                width: '100%',
                height: '100%',
                background: '#000',
              }}
              onError={(e) => {
                // Only handle errors for direct streams (HLS errors handled by hls.js)
                if (streamFormat !== 'hls') {
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
                }
              }}
            />
            {/* Close button */}
            <button
              onClick={stopPlayback}
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
              X
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
                  onPlay({ connectionId, ratingKey, name, type });
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
                background: `rgba(229, 160, 13, 0.9)`, // Plex orange
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                color: '#000',
                cursor: 'pointer',
                transition: 'transform 0.2s, background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
                e.currentTarget.style.background = 'rgba(229, 160, 13, 1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
                e.currentTarget.style.background = 'rgba(229, 160, 13, 0.9)';
              }}
              title="Play video"
            >
              {loadingStream ? '...' : '▶'}
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
            background: `rgba(229, 160, 13, 0.9)`, // Plex orange
            padding: '4px 8px',
            fontSize: '0.65rem',
            color: '#000',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: 'bold',
          }}>
            <span>{getTypeIcon()}</span>
            <span>Plex</span>
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
          {getTypeLabel()}
          {duration && ` - ${formatDuration(duration)}`}
        </div>

        {/* Summary toggle */}
        {summary && (
          <>
            <button
              onClick={() => setShowSummary(!showSummary)}
              style={{
                background: 'transparent',
                border: 'none',
                color: plexColor,
                cursor: 'pointer',
                fontSize: '0.7rem',
                padding: 0,
                marginBottom: showSummary ? '8px' : 0,
              }}
            >
              {showSummary ? '- Hide description' : '+ Show description'}
            </button>
            {showSummary && (
              <div style={{
                color: 'var(--text-secondary)',
                fontSize: '0.75rem',
                lineHeight: 1.4,
                maxHeight: '100px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {summary}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Parse Plex embed URL
 * Format: cortex://plex/{connectionId}/{ratingKey}?name={name}&type={type}&duration={ms}
 */
export const parsePlexUrl = (url) => {
  if (!url || !url.startsWith('cortex://plex/')) return null;

  try {
    // Parse the URL
    const pathPart = url.replace('cortex://plex/', '');
    const [pathWithParams] = pathPart.split('?');
    const [connectionId, ratingKey] = pathWithParams.split('/');

    if (!connectionId || !ratingKey) return null;

    // Parse query params
    const params = new URLSearchParams(url.split('?')[1] || '');

    return {
      connectionId,
      ratingKey,
      shareId: params.get('share') || null,
      name: params.get('name') || 'Unknown Media',
      type: params.get('type') || 'movie',
      duration: params.get('duration') ? parseInt(params.get('duration')) : null,
      summary: params.get('summary') || null,
    };
  } catch {
    return null;
  }
};

/**
 * Create Plex embed URL from media info
 */
export const createPlexUrl = ({ connectionId, ratingKey, name, type, duration, summary, shareId }) => {
  const params = new URLSearchParams();
  if (shareId) params.set('share', shareId);
  if (name) params.set('name', name);
  if (type) params.set('type', type);
  if (duration) params.set('duration', duration.toString());
  if (summary) params.set('summary', summary.substring(0, 200)); // Limit length

  return `cortex://plex/${connectionId}/${ratingKey}?${params.toString()}`;
};

export default PlexEmbed;
