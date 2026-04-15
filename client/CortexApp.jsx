import React, { useState, useEffect, useLayoutEffect, useRef, createContext, useContext, useCallback, useMemo } from 'react';
import { E2EEProvider, useE2EE } from './e2ee-context.jsx';
import { E2EESetupModal, PassphraseUnlockModal, E2EEStatusIndicator, EncryptedWaveBadge, LegacyWaveNotice, PartialEncryptionBanner } from './e2ee-components.jsx';
import { SUCCESS, EMPTY, LOADING, CONFIRM, TAGLINES, getRandomTagline } from './messages.js';
import { LiveKitRoom, useParticipants, useLocalParticipant, RoomAudioRenderer, ParticipantTile, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';

// Extracted modules
import { VERSION, API_URL, WS_URL, BASE_URL, PRIVACY_LEVELS, ROLE_HIERARCHY, canAccess, THREAD_DEPTH_LIMIT, FONT_SIZES } from './src/config/constants.js';
import { THEMES } from './src/config/themes.js';
import { storage, isPWA } from './src/utils/storage.js';
import { updateAppBadge, subscribeToPush, unsubscribeFromPush, urlBase64ToUint8Array } from './src/utils/pwa.js';
import { generateNotificationFavicon, updateDocumentTitle, setFavicon, startFaviconFlash, stopFaviconFlash } from './src/utils/favicon.js';
import { EMBED_PLATFORMS, EMBED_URL_PATTERNS, detectEmbedUrls } from './src/utils/embed.js';
import { useWindowSize } from './src/hooks/useWindowSize.js';
import { useSwipeGesture } from './src/hooks/useSwipeGesture.js';
import { usePullToRefresh } from './src/hooks/usePullToRefresh.js';
import { AuthContext, useAuth, useAPI } from './src/hooks/useAPI.js';
import { useWebSocket } from './src/hooks/useWebSocket.js';
import { useVoiceCall } from './src/hooks/useVoiceCall.js';

// Extracted UI components
import ImageLightbox from './src/components/ui/ImageLightbox.jsx';
import { ScanLines, GlowText, Avatar, PrivacyBadge, Toast, LoadingSpinner, OfflineIndicator, PullIndicator } from './src/components/ui/SimpleComponents.jsx';
import BottomNav from './src/components/ui/BottomNav.jsx';

// Lazy-loaded Admin Panels (code splitting)
const AdminReportsPanel = React.lazy(() => import('./src/components/admin/AdminReportsPanel.jsx'));
const UserManagementPanel = React.lazy(() => import('./src/components/admin/UserManagementPanel.jsx'));
const ActivityLogPanel = React.lazy(() => import('./src/components/admin/ActivityLogPanel.jsx'));
const CrawlBarAdminPanel = React.lazy(() => import('./src/components/admin/CrawlBarAdminPanel.jsx'));
const AlertsAdminPanel = React.lazy(() => import('./src/components/admin/AlertsAdminPanel.jsx'));
const AlertSubscriptionsPanel = React.lazy(() => import('./src/components/admin/AlertSubscriptionsPanel.jsx'));
const FederationAdminPanel = React.lazy(() => import('./src/components/admin/FederationAdminPanel.jsx'));
const HandleRequestsList = React.lazy(() => import('./src/components/admin/HandleRequestsList.jsx'));
const BotsAdminPanel = React.lazy(() => import('./src/components/admin/BotsAdminPanel.jsx'));

// Extracted views
import AuthProvider from './src/views/AuthProvider.jsx';
import E2EEWrapper from './src/views/E2EEWrapper.jsx';

// ============ SERVICE WORKER REGISTRATION ============
// Skip in native apps — Electron/Capacitor don't support Service Workers
const _isNativeApp = typeof window !== 'undefined' &&
  (window.Capacitor !== undefined || window.navigator?.userAgent?.includes('Electron'));
if ('serviceWorker' in navigator && !_isNativeApp) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service worker registered:', registration.scope);

        // Check for updates periodically (every hour)
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available
                console.log('[PWA] New version available');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error('[PWA] Service worker registration failed:', error);
      });
  });
}

// ============ UI COMPONENTS ============
// PWA Badge API - shows unread count on installed app icon
// ============ IMAGE LIGHTBOX COMPONENT ============

// Single embed component with click-to-load
const RichEmbed = ({ embed, autoLoad = false }) => {
  const [loaded, setLoaded] = useState(autoLoad);
  const [error, setError] = useState(false);
  const [oembedHtml, setOembedHtml] = useState(null);
  const [oembedLoading, setOembedLoading] = useState(false);
  const [tiktokData, setTiktokData] = useState(null);
  const [gifData, setGifData] = useState(null);
  const platform = EMBED_PLATFORMS[embed.platform] || { icon: '🔗', color: '#666', name: 'Link' };
  const embedContainerRef = useRef(null);

  // Platforms that require oEmbed HTML injection (no direct iframe embed URL)
  // Note: TikTok removed - their embed.js doesn't work well with React's virtual DOM
  const requiresOembed = ['twitter', 'soundcloud'].includes(embed.platform);

  // Fetch TikTok oEmbed data for thumbnail and title
  useEffect(() => {
    if (embed.platform === 'tiktok' && !tiktokData) {
      fetch(`${API_URL}/embeds/oembed?url=${encodeURIComponent(embed.url)}`)
        .then(res => res.json())
        .then(data => {
          // Server returns 'thumbnail' and 'author', normalize to what we expect
          if (data.thumbnail || data.author || data.title) {
            setTiktokData({
              thumbnail_url: data.thumbnail,
              author_name: data.author,
              title: data.title,
            });
          }
        })
        .catch(() => {}); // Silently fail - link card still works without thumbnail
    }
  }, [embed.platform, embed.url, tiktokData]);

  // Fetch Tenor/GIPHY oEmbed data to get the actual GIF URL
  useEffect(() => {
    if (['tenor', 'giphy'].includes(embed.platform) && !gifData) {
      fetch(`${API_URL}/embeds/oembed?url=${encodeURIComponent(embed.url)}`)
        .then(res => res.json())
        .then(data => {
          // Tenor returns 'url' field with direct GIF URL
          // GIPHY returns 'url' field with direct GIF URL
          if (data.url || data.thumbnail) {
            setGifData(data);
          }
        })
        .catch(() => {}); // Silently fail
    }
  }, [embed.platform, embed.url, gifData]);

  // Determine iframe dimensions based on platform
  const getDimensions = () => {
    switch (embed.platform) {
      case 'spotify':
        return { width: '100%', height: embed.contentType === 'track' ? '152px' : '352px' };
      case 'soundcloud':
        return { width: '100%', height: '166px' };
      case 'twitter':
        return { width: '100%', height: '400px' };
      case 'tiktok':
        return { width: '100%', height: '750px' };
      default: // YouTube, Vimeo
        return { width: '100%', height: '315px' };
    }
  };

  const dimensions = getDimensions();

  // Fetch oEmbed data when loaded for platforms that need it
  useEffect(() => {
    if (loaded && requiresOembed && !oembedHtml && !oembedLoading) {
      setOembedLoading(true);
      fetch(`${API_URL}/embeds/oembed?url=${encodeURIComponent(embed.url)}`)
        .then(res => res.json())
        .then(data => {
          if (data.html) {
            // Strip script tags from oEmbed HTML - we'll load scripts ourselves
            const cleanHtml = data.html.replace(/<script[^>]*>.*?<\/script>/gi, '');
            setOembedHtml(cleanHtml);
          } else {
            setError(true);
          }
        })
        .catch(() => setError(true))
        .finally(() => setOembedLoading(false));
    }
  }, [loaded, requiresOembed, oembedHtml, oembedLoading, embed.url]);

  // Load external embed scripts after oEmbed HTML is inserted (run once)
  const scriptLoadedRef = useRef(false);
  useEffect(() => {
    if (oembedHtml && embedContainerRef.current && !scriptLoadedRef.current) {
      scriptLoadedRef.current = true;

      // Twitter/X embed script
      if (embed.platform === 'twitter') {
        if (window.twttr?.widgets) {
          // Script already loaded - re-process embeds
          setTimeout(() => window.twttr.widgets.load(embedContainerRef.current), 100);
        } else if (!document.querySelector('script[src*="platform.twitter.com"]')) {
          const script = document.createElement('script');
          script.src = 'https://platform.twitter.com/widgets.js';
          script.async = true;
          document.body.appendChild(script);
        }
      }
      // SoundCloud doesn't need external script - oEmbed returns iframe directly
    }
  }, [oembedHtml, embed.platform]);

  // Tenor/GIPHY - show the GIF directly as an image
  if (['tenor', 'giphy'].includes(embed.platform)) {
    const gifUrl = gifData?.url || gifData?.thumbnail;
    const imgStyle = 'max-width:200px;max-height:150px;border-radius:4px;cursor:pointer;object-fit:cover;display:block;border:1px solid var(--border-primary);';

    if (gifUrl) {
      // GIF loaded - show it
      return (
        <div style={{ marginTop: '8px' }}>
          <img
            src={gifUrl}
            alt={gifData?.title || 'GIF'}
            style={{
              maxWidth: '200px',
              maxHeight: '150px',
              borderRadius: '4px',
              cursor: 'pointer',
              objectFit: 'cover',
              display: 'block',
              border: '1px solid var(--border-primary)',
            }}
            className="zoomable-image"
            loading="lazy"
          />
        </div>
      );
    }

    // Loading state - show placeholder with platform branding
    return (
      <div style={{
        marginTop: '8px',
        padding: '12px',
        background: 'var(--bg-elevated)',
        border: `1px solid ${platform.color}40`,
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        maxWidth: '200px',
      }}>
        <span style={{ color: platform.color }}>{platform.icon}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Loading {platform.name}...</span>
      </div>
    );
  }

  // TikTok doesn't work with React - show a styled link card with thumbnail
  if (embed.platform === 'tiktok') {
    const hasThumbnail = tiktokData?.thumbnail_url;
    const authorName = tiktokData?.author_name || '';
    const title = tiktokData?.title || 'Click to open in TikTok';

    return (
      <a
        href={embed.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: '0',
          background: 'linear-gradient(135deg, var(--bg-elevated), var(--bg-base))',
          border: '1px solid #ff0050',
          borderRadius: '8px',
          color: '#e5e5e5',
          textDecoration: 'none',
          marginTop: '8px',
          maxWidth: '400px',
          overflow: 'hidden',
        }}
      >
        {/* Thumbnail or fallback icon */}
        <div style={{
          width: hasThumbnail ? '100px' : '60px',
          minHeight: hasThumbnail ? '130px' : '60px',
          flexShrink: 0,
          background: hasThumbnail ? '#000' : '#ff0050',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {hasThumbnail ? (
            <>
              <img
                src={tiktokData.thumbnail_url}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              {/* Play button overlay */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'rgba(255, 0, 80, 0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                color: 'white',
              }}>
                ▶
              </div>
            </>
          ) : (
            <span style={{ fontSize: '24px' }}>♪</span>
          )}
        </div>
        {/* Text content */}
        <div style={{
          padding: '12px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flex: 1,
        }}>
          <div style={{ color: '#ff0050', fontSize: '0.7rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>♪</span> TikTok
          </div>
          {authorName && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              @{authorName}
            </div>
          )}
          <div style={{
            fontSize: '0.85rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: '1.3',
          }}>
            {title}
          </div>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          color: '#ff0050',
          fontSize: '1.2rem',
        }}>→</div>
      </a>
    );
  }

  if (error) {
    return (
      <a
        href={embed.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block',
          padding: '12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          marginTop: '8px',
        }}
      >
        <span style={{ color: platform.color, marginRight: '8px' }}>{platform.icon}</span>
        {embed.url}
      </a>
    );
  }

  if (!loaded) {
    return (
      <div
        onClick={() => setLoaded(true)}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '560px',
          aspectRatio: embed.platform === 'spotify' ? 'auto' : '16/9',
          height: embed.platform === 'spotify' ? dimensions.height : 'auto',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          cursor: 'pointer',
          marginTop: '8px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Thumbnail background for YouTube */}
        {embed.thumbnail && (
          <img
            src={embed.thumbnail}
            alt=""
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.4,
            }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}

        {/* Play button overlay */}
        <div style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: platform.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}>
            {platform.icon}
          </div>
          <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
            Click to load {platform.name}
          </span>
        </div>
      </div>
    );
  }

  // Loading state for oEmbed platforms
  if (requiresOembed && oembedLoading) {
    return (
      <div style={{
        width: '100%',
        maxWidth: '560px',
        padding: '20px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '4px',
        marginTop: '8px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
      }}>
        Loading {platform.name}...
      </div>
    );
  }

  // Render oEmbed HTML for platforms that need it
  if (requiresOembed && oembedHtml) {
    return (
      <div
        ref={embedContainerRef}
        style={{
          width: '100%',
          maxWidth: '560px',
          marginTop: '8px',
          overflow: 'hidden',
        }}
        dangerouslySetInnerHTML={{ __html: oembedHtml }}
      />
    );
  }

  // Loaded state - render iframe (for YouTube, Vimeo, Spotify)
  return (
    <div style={{
      width: '100%',
      maxWidth: embed.platform === 'spotify' || embed.platform === 'soundcloud' ? '100%' : '560px',
      marginTop: '8px',
    }}>
      <iframe
        src={embed.embedUrl}
        width={dimensions.width}
        height={dimensions.height}
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          display: 'block',
        }}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        onError={() => setError(true)}
      />
    </div>
  );
};

// Component to render ping content with embeds (formerly MessageWithEmbeds)
const PingWithEmbeds = ({ content, autoLoadEmbeds = false, participants = [], contacts = [], onMentionClick, fetchAPI }) => {
  const embeds = useMemo(() => detectEmbedUrls(content), [content]);

  // Get the plain text URLs that have embeds (to potentially hide them)
  const embedUrls = useMemo(() => new Set(embeds.map(e => e.url)), [embeds]);

  // Combine participants and contacts for user lookup
  const allUsers = useMemo(() => {
    const combined = [...participants, ...contacts];
    // Dedupe by id
    const seen = new Set();
    return combined.filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
  }, [participants, contacts]);

  // Process @mentions to make them styled and clickable
  const processMentions = (html) => {
    // Match @handle patterns not already inside HTML tags
    return html.replace(/@([a-zA-Z0-9_]+)/g, (match, handle) => {
      // Find the user by handle in participants or contacts
      const user = allUsers.find(p =>
        (p.handle || '').toLowerCase() === handle.toLowerCase()
      );
      const userId = user?.id || '';
      const displayName = user?.displayName || user?.display_name || user?.name || handle;
      // Show display name but keep handle in tooltip and data attribute
      return `<span class="mention-link" data-handle="${handle}" data-user-id="${userId}" style="color: var(--accent-teal); cursor: pointer;" title="@${handle}">@${displayName}</span>`;
    });
  };

  // Strip embed URLs from displayed content if we're showing the embed
  const displayContent = useMemo(() => {
    let result = content;
    if (embeds.length > 0) {
      for (const url of embedUrls) {
        // Only hide the URL if it's on its own line or at the end
        result = result.replace(new RegExp(`\\s*${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g'), ' ');
      }
      result = result.trim();
    }
    // Process mentions
    result = processMentions(result);
    return result;
  }, [content, embedUrls, embeds.length, allUsers]);

  // Handle click events with delegation for mentions
  const handleClick = async (e) => {
    const mentionEl = e.target.closest('.mention-link');
    if (mentionEl && onMentionClick) {
      e.preventDefault();
      e.stopPropagation();
      let userId = mentionEl.dataset.userId;
      const handle = mentionEl.dataset.handle;

      // If we don't have the userId, try to look up the user by handle
      if (!userId && handle && fetchAPI) {
        try {
          const users = await fetchAPI(`/users/search?q=${encodeURIComponent(handle)}&limit=1`);
          if (users && users.length > 0 && users[0].handle.toLowerCase() === handle.toLowerCase()) {
            userId = users[0].id;
          }
        } catch (err) {
          console.error('Failed to look up user by handle:', err);
        }
      }

      if (userId) {
        onMentionClick(userId);
      }
    }
  };

  return (
    <>
      <div
        dangerouslySetInnerHTML={{ __html: displayContent }}
        onClick={handleClick}
      />
      {embeds.map((embed, index) => (
        <RichEmbed key={`${embed.platform}-${embed.contentId}-${index}`} embed={embed} autoLoad={autoLoadEmbeds} />
      ))}
    </>
  );
};

// ============ COLLAPSIBLE SECTION COMPONENT ============
// Supports controlled mode (isOpen + onToggle) or uncontrolled mode (defaultOpen)
const CollapsibleSection = ({ title, children, defaultOpen = true, isOpen: controlledIsOpen, onToggle, isMobile, titleColor = 'var(--text-dim)', accentColor, badge }) => {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);

  // Use controlled mode if onToggle is provided, otherwise use internal state
  const isOpen = onToggle ? controlledIsOpen : internalIsOpen;
  const handleToggle = onToggle || (() => setInternalIsOpen(!internalIsOpen));

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: accentColor ? `1px solid ${accentColor}40` : '1px solid var(--border-subtle)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ color: titleColor, fontSize: '0.8rem', fontWeight: 500 }}>{title}</div>
          {badge && (
            <span style={{
              padding: '2px 6px',
              background: 'var(--accent-amber)20',
              border: '1px solid var(--accent-amber)',
              color: 'var(--accent-amber)',
              fontSize: '0.65rem',
              borderRadius: '3px',
            }}>{badge}</span>
          )}
        </div>
        <button
          onClick={handleToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? (accentColor ? `${accentColor}20` : 'var(--accent-amber)20') : 'transparent',
            border: `1px solid ${isOpen ? (accentColor || 'var(--accent-amber)') : 'var(--border-primary)'}`,
            color: isOpen ? (accentColor || 'var(--accent-amber)') : 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
          }}
        >
          {isOpen ? '▼ HIDE' : '▶ SHOW'}
        </button>
      </div>
      {isOpen && (
        <div style={{ marginTop: '16px' }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ============ EMOJI PICKER COMPONENT ============
const EmojiPicker = ({ onSelect, isMobile }) => {
  const emojis = ['😀', '😂', '😍', '🤔', '👍', '☝️', '👎', '🎉', '🔥', '💯', '❤️', '😎', '🚀', '✨', '💪', '👏', '🙌'];
  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px',
      background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
      padding: isMobile ? '10px' : '6px', display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(8, 1fr)',
      gap: isMobile ? '6px' : '2px',
      zIndex: 10,
    }}>
      {emojis.map(emoji => (
        <button key={emoji} onClick={() => onSelect(emoji)} style={{
          width: isMobile ? '44px' : '32px',
          height: isMobile ? '44px' : '32px',
          padding: 0,
          background: 'transparent', border: '1px solid var(--border-subtle)',
          cursor: 'pointer', fontSize: isMobile ? '1.3rem' : '1.1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}>{emoji}</button>
      ))}
    </div>
  );
};

// ============ GIF SEARCH MODAL ============
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
          Powered by {provider === 'tenor' ? 'Tenor' : provider === 'both' ? 'GIPHY & Tenor' : 'GIPHY'}
        </div>
      </div>
    </div>
  );
};

// ============ PWA INSTALL PROMPT ============
const InstallPrompt = ({ isMobile }) => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Check if dismissed recently (within 7 days)
    const dismissedAt = localStorage.getItem('farhold_install_dismissed');
    if (dismissedAt) {
      const daysSinceDismissed = (Date.now() - parseInt(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) {
        return; // Don't show prompt
      }
    }

    // Listen for install prompt event
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);

      // Show prompt after second visit or 30 seconds
      const visitCount = parseInt(localStorage.getItem('farhold_visits') || '0') + 1;
      localStorage.setItem('farhold_visits', visitCount.toString());

      if (visitCount >= 2) {
        setShowPrompt(true);
      } else {
        setTimeout(() => setShowPrompt(true), 30000);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setDeferredPrompt(null);
      console.log('[PWA] App installed successfully');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('[PWA] User accepted install prompt');
    } else {
      console.log('[PWA] User dismissed install prompt');
    }

    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('farhold_install_dismissed', Date.now().toString());
  };

  if (isInstalled || !showPrompt || !deferredPrompt) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: isMobile ? '70px' : '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '2px solid var(--accent-green)',
      padding: isMobile ? '16px' : '20px',
      zIndex: 1000,
      maxWidth: '400px',
      width: 'calc(100% - 40px)',
      boxShadow: '0 4px 20px rgba(14, 173, 105, 0.3)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '12px'
      }}>
        <div style={{ color: 'var(--accent-green)', fontWeight: 'bold', fontSize: '1rem', fontFamily: 'monospace' }}>
          Install Cortex
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '1.2rem',
            padding: 0,
            lineHeight: 1
          }}
        >
          x
        </button>
      </div>

      <p style={{
        color: 'var(--text-primary)',
        fontSize: '0.85rem',
        marginBottom: '16px',
        lineHeight: 1.4,
        fontFamily: 'monospace'
      }}>
        Install Cortex on your device for quick access and offline support.
      </p>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleInstall}
          style={{
            flex: 1,
            padding: '12px 20px',
            background: 'var(--accent-green)',
            border: 'none',
            color: 'var(--bg-base)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            fontSize: '0.9rem'
          }}
        >
          INSTALL APP
        </button>
        <button
          onClick={handleDismiss}
          style={{
            padding: '12px 20px',
            background: 'transparent',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '0.9rem'
          }}
        >
          LATER
        </button>
      </div>
    </div>
  );
};

// ============ OFFLINE INDICATOR ============
// ============ BOTTOM NAVIGATION ============
const LiveKitCallRoom = React.memo(({ token, url, roomName, voiceCall, children }) => {
  const handleConnected = useCallback(() => {
    console.log('🎤 Connected to LiveKit room:', roomName);
    voiceCall.setConnectionState('connected');
  }, [roomName]);

  const handleDisconnected = useCallback(() => {
    console.log('🎤 Disconnected from LiveKit room');
    voiceCall.setConnectionState('disconnected');
  }, []);

  const handleError = useCallback((error) => {
    console.error('🎤 LiveKit error:', error);
    voiceCall.setConnectionState('disconnected');
  }, []);

  if (!token || !url) return null;

  // Build device constraints - memoize to prevent re-renders
  const audioDeviceId = voiceCall.selectedMic !== 'default' ? voiceCall.selectedMic : undefined;
  const videoDeviceId = voiceCall.selectedCamera !== 'default' ? voiceCall.selectedCamera : undefined;

  return (
    <LiveKitRoom
      token={token}
      serverUrl={url}
      connect={true}
      audio={true}
      video={!voiceCall.isCameraOff}
      onConnected={handleConnected}
      onDisconnected={handleDisconnected}
      onError={handleError}
      options={{
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          deviceId: audioDeviceId
        },
        videoCaptureDefaults: {
          resolution: {
            width: 1280,
            height: 720,
            frameRate: 30
          },
          deviceId: videoDeviceId
        }
      }}
    >
      <RoomAudioRenderer />
      <CallControls
        isMuted={voiceCall.isMuted}
        isCameraOff={voiceCall.isCameraOff}
        setParticipants={voiceCall.setParticipants}
        setAudioLevel={voiceCall.setAudioLevel}
      />
      {children}
    </LiveKitRoom>
  );
}, (prevProps, nextProps) => {
  // Only skip re-render if token, url, AND voiceCall control states are unchanged
  return prevProps.token === nextProps.token &&
         prevProps.url === nextProps.url &&
         prevProps.voiceCall.isMuted === nextProps.voiceCall.isMuted &&
         prevProps.voiceCall.isCameraOff === nextProps.voiceCall.isCameraOff;
});

const CallControls = ({ isMuted, isCameraOff, setParticipants, setAudioLevel }) => {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Update participants list
  useEffect(() => {
    const participantIds = participants.map(p => p.identity);
    setParticipants(participantIds);
  }, [participants, setParticipants]);

  // Monitor audio level
  useEffect(() => {
    if (!localParticipant) return;

    const interval = setInterval(() => {
      const audioTrack = localParticipant.getTrackPublication(Track.Source.Microphone);
      if (audioTrack?.track) {
        const level = audioTrack.isSpeaking ? 0.7 : 0.1;
        setAudioLevel(level);
      } else {
        setAudioLevel(0);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [localParticipant, setAudioLevel]);

  // Sync mute state with LiveKit
  useEffect(() => {
    if (localParticipant) {
      localParticipant.setMicrophoneEnabled(!isMuted);
    }
  }, [isMuted, localParticipant]);

  // Sync camera state with LiveKit
  useEffect(() => {
    if (!localParticipant) return;

    const shouldEnable = !isCameraOff;
    console.log(`🎥 Syncing camera state: ${shouldEnable ? 'enabling' : 'disabling'} (isCameraOff=${isCameraOff})`);

    // Get the current camera track
    const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
    console.log(`🎥 Camera track exists: ${!!cameraPublication}, isEnabled: ${cameraPublication?.track?.isEnabled}, isMuted: ${cameraPublication?.isMuted}`);

    const updateCamera = async () => {
      try {
        if (shouldEnable) {
          // Enable camera - unmute if it was muted
          console.log('🎥 Enabling camera track...');
          const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
          if (cameraPub && cameraPub.isMuted) {
            await cameraPub.unmute();
            console.log('🎥 Camera unmuted successfully');
          } else {
            await localParticipant.setCameraEnabled(true);
            console.log('🎥 Camera enabled successfully');
          }
        } else {
          // Disable camera by muting the track (more reliable than setCameraEnabled(false))
          console.log('🎥 Disabling camera track...');
          const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
          if (cameraPub) {
            await cameraPub.mute();
            console.log('🎥 Camera muted successfully');
          } else {
            console.log('🎥 No camera track to mute');
          }
        }
      } catch (err) {
        console.error('🎥 Failed to change camera state:', err);
      }
    };

    updateCamera();
  }, [isCameraOff, localParticipant]);

  return null;
};

// ============ CALL MODAL (v2.5.0 - Voice/Video) ============

const CallModal = ({ isOpen, onClose, wave, voiceCall, user, isMobile }) => {
  if (!isOpen || !wave || !user) return null;

  const { connectionState, participants, isMuted, isCameraOff, audioLevel, error, livekitToken, livekitUrl, callActive, serverParticipantCount, checkCallStatus } = voiceCall;
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const participantCount = participants.length;

  // Check if there are actual video tracks to determine window size
  const [hasAnyVideo, setHasAnyVideo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);

  // Check call status immediately when modal opens
  useEffect(() => {
    if (isOpen && checkCallStatus) {
      setCheckingStatus(true);
      checkCallStatus().finally(() => {
        // Keep loading state for at least 300ms to prevent flickering
        setTimeout(() => setCheckingStatus(false), 300);
      });
    }
  }, [isOpen, checkCallStatus]);

  // Pop-out window handler
  const handlePopOut = useCallback(() => {
    const width = 900;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    // Build URL with call parameters
    const baseUrl = window.location.origin + window.location.pathname;
    const callUrl = `${baseUrl}?call=${wave.id}&popout=true`;

    const popoutWindow = window.open(
      callUrl,
      'CortexCall_' + wave.id,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no`
    );

    // Close the modal in the parent window after pop-out opens
    if (popoutWindow) {
      setTimeout(() => onClose(), 100);
    }
  }, [wave, onClose]);

  // Video Tiles and Audio Level Component (must be inside LiveKitRoom)
  const CallContent = () => {
    const tracks = useTracks([
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ]);

    // Filter for tracks that are actually enabled and publishing
    const activeTracks = tracks.filter(trackRef => {
      const track = trackRef.publication?.track;
      return track && !track.isMuted && trackRef.publication?.isSubscribed;
    });

    const hasVideoTracks = activeTracks.length > 0;

    // Update parent state when video tracks change
    useEffect(() => {
      setHasAnyVideo(hasVideoTracks);
    }, [hasVideoTracks]);

    // Calculate grid layout based on participant count
    const getGridLayout = (count) => {
      if (count === 1) return { columns: '1fr', minSize: '400px' };
      if (count === 2) return { columns: 'repeat(2, 1fr)', minSize: '300px' };
      if (count <= 4) return { columns: 'repeat(2, 1fr)', minSize: '250px' };
      if (count <= 6) return { columns: 'repeat(3, 1fr)', minSize: '200px' };
      return { columns: 'repeat(auto-fit, minmax(200px, 1fr))', minSize: '200px' };
    };

    const layout = getGridLayout(activeTracks.length);

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Video Tiles */}
        {hasVideoTracks ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: layout.columns,
            gap: '8px',
            padding: '12px',
            flex: 1,
            overflow: 'auto',
            minHeight: 0,
            alignContent: 'start'
          }}>
            {activeTracks.map((trackRef) => (
              <ParticipantTile
                key={trackRef.publication.trackSid}
                trackRef={trackRef}
                style={{
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  minHeight: layout.minSize,
                  aspectRatio: '16/9'
                }}
              />
            ))}
          </div>
        ) : (
          /* Audio level indicator (when no video) */
          <div style={{
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            flex: 1
          }}>
            <div style={{ fontSize: '3rem' }}>🎤</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Voice Only</div>
            {audioLevel > 0 && !isMuted && (
              <div style={{ width: '200px' }}>
                <div style={{
                  height: '4px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    background: 'var(--accent-green)',
                    width: `${audioLevel * 100}%`,
                    transition: 'width 0.1s ease-out'
                  }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: isMobile ? '0' : '20px'
    }}
      onClick={onClose}
    >
      <div style={{
        background: 'var(--bg-primary)',
        border: isMobile ? 'none' : '1px solid var(--border-primary)',
        borderRadius: isMobile ? '0' : '8px',
        width: isMobile ? '100%' : (hasAnyVideo ? 'min(900px, 90vw)' : '400px'),
        height: isMobile ? '100%' : (hasAnyVideo ? 'min(700px, 85vh)' : 'auto'),
        maxHeight: isMobile ? '100%' : '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.3s ease, height 0.3s ease'
      }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-elevated)',
          flexShrink: 0
        }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
              {isConnecting ? '📞 Connecting...' : isConnected ? '📞 In Call' : '📞 Voice/Video Call'}
            </div>
            {isConnected && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {participantCount} participant{participantCount !== 1 ? 's' : ''} • {wave.title}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isConnected && (
              <button
                onClick={handlePopOut}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  padding: '4px 8px',
                  lineHeight: 1
                }}
                title="Pop Out"
              >
                ⧉
              </button>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: '4px 8px',
                lineHeight: 1
              }}
              title="Settings"
            >
              ⚙️
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '1.5rem',
                padding: '4px 8px',
                lineHeight: 1
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {!isConnected && !isConnecting && !livekitToken ? (
            // Not in call - show start/join UI
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px'
            }}>
              {checkingStatus ? (
                <>
                  <div style={{
                    fontSize: '3rem',
                    marginBottom: '20px'
                  }}>📞</div>
                  <div style={{
                    fontSize: '1.2rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '30px'
                  }}>
                    Checking call status...
                  </div>
                </>
              ) : callActive ? (
                <>
                  <div style={{
                    fontSize: '3rem',
                    marginBottom: '20px'
                  }}>📞</div>
                  <div style={{
                    fontSize: '1.2rem',
                    color: 'var(--accent-green)',
                    marginBottom: '8px',
                    fontWeight: 'bold'
                  }}>
                    Call in Progress
                  </div>
                  <div style={{
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '30px'
                  }}>
                    {serverParticipantCount > 0
                      ? `${serverParticipantCount} participant${serverParticipantCount !== 1 ? 's' : ''} in call`
                      : 'Someone is connecting...'}
                  </div>
                  <button
                    onClick={() => voiceCall.startCall(false)}
                    disabled={!!error}
                    style={{
                      padding: '14px 32px',
                      background: 'var(--accent-green)',
                      color: 'var(--bg-primary)',
                      border: '1px solid var(--accent-green)',
                      borderRadius: '6px',
                      cursor: error ? 'not-allowed' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      opacity: error ? 0.5 : 1
                    }}
                  >
                    Join Call
                  </button>
                </>
              ) : (
                <>
                  <div style={{
                    fontSize: '3rem',
                    marginBottom: '20px'
                  }}>📞</div>
                  <div style={{
                    fontSize: '1.2rem',
                    color: 'var(--text-primary)',
                    marginBottom: '30px'
                  }}>
                    Start a call
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                      onClick={() => voiceCall.startCall(false)}
                      disabled={!!error}
                      style={{
                        padding: '14px 32px',
                        background: 'var(--accent-green)',
                        color: 'var(--bg-primary)',
                        border: '1px solid var(--accent-green)',
                        borderRadius: '6px',
                        cursor: error ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        opacity: error ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      🎤 Voice Call
                    </button>
                    <button
                      onClick={() => voiceCall.startCall(true)}
                      disabled={!!error}
                      style={{
                        padding: '14px 32px',
                        background: 'var(--accent-teal-bg)',
                        color: 'var(--accent-teal)',
                        border: '1px solid var(--accent-teal)',
                        borderRadius: '6px',
                        cursor: error ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        opacity: error ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      🎥 Video Call
                    </button>
                  </div>
                </>
              )}
              {error && (
                <div style={{
                  marginTop: '20px',
                  padding: '12px 20px',
                  background: 'var(--error-bg)',
                  border: '1px solid var(--error-border)',
                  borderRadius: '4px',
                  color: 'var(--error-text)',
                  fontSize: '0.85rem',
                  maxWidth: '400px',
                  textAlign: 'center'
                }}>
                  {error}
                </div>
              )}
            </div>
          ) : (
            // In call - show video tiles and controls
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0 }}>
              {livekitToken && livekitUrl && (
                <LiveKitCallRoom
                  token={livekitToken}
                  url={livekitUrl}
                  roomName={wave.id}
                  voiceCall={voiceCall}
                >
                  <CallContent />
                </LiveKitCallRoom>
              )}
            </div>
          )}
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)',
            maxHeight: '300px',
            overflowY: 'auto',
            flexShrink: 0
          }}>
            <div style={{
              fontSize: '0.9rem',
              fontWeight: 'bold',
              color: 'var(--text-primary)',
              marginBottom: '12px'
            }}>
              Device Settings
            </div>

            {/* Microphone Selection */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                fontFamily: 'monospace'
              }}>
                Microphone
              </label>
              <select
                value={voiceCall.selectedMic}
                onChange={(e) => voiceCall.changeMic(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem'
                }}
              >
                <option value="default">Default Microphone</option>
                {voiceCall.audioDevices
                  .filter(d => d.kind === 'audioinput')
                  .map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
              </select>
            </div>

            {/* Camera Selection */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                fontFamily: 'monospace'
              }}>
                Camera
              </label>
              <select
                value={voiceCall.selectedCamera}
                onChange={(e) => voiceCall.changeCamera(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem'
                }}
              >
                <option value="default">Default Camera</option>
                {voiceCall.videoDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Speaker Selection */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                fontFamily: 'monospace'
              }}>
                Speaker
              </label>
              <select
                value={voiceCall.selectedSpeaker}
                onChange={(e) => voiceCall.changeSpeaker(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem'
                }}
              >
                <option value="default">Default Speaker</option>
                {voiceCall.audioDevices
                  .filter(d => d.kind === 'audiooutput')
                  .map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{
              fontSize: '0.7rem',
              color: 'var(--text-dim)',
              fontStyle: 'italic',
              marginTop: '12px'
            }}>
              Note: Changes will apply to new calls. You may need to rejoin for changes to take effect.
            </div>
          </div>
        )}

        {/* Controls (when connected) */}
        {isConnected && (
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-primary)',
            background: 'var(--bg-elevated)',
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            flexShrink: 0
          }}>
            <button
              onClick={voiceCall.toggleMute}
              style={{
                padding: '12px 24px',
                background: isMuted ? 'var(--error-bg)' : 'var(--bg-secondary)',
                color: isMuted ? 'var(--error-text)' : 'var(--text-primary)',
                border: `1px solid ${isMuted ? 'var(--error-border)' : 'var(--border)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isMuted ? '🔇' : '🎤'} {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={voiceCall.toggleCamera}
              style={{
                padding: '12px 24px',
                background: isCameraOff ? 'var(--bg-secondary)' : 'var(--accent-teal-bg)',
                color: isCameraOff ? 'var(--text-primary)' : 'var(--accent-teal)',
                border: `1px solid ${isCameraOff ? 'var(--border)' : 'var(--accent-teal)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isCameraOff ? '📹' : '🎥'} {isCameraOff ? 'Start Video' : 'Stop Video'}
            </button>
            <button
              onClick={() => {
                voiceCall.leaveCall();
                onClose();
              }}
              style={{
                padding: '12px 24px',
                background: 'var(--error-bg)',
                color: 'var(--error-text)',
                border: '1px solid var(--error-border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              📞 Leave
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const VoiceCallControls = ({ wave, voiceCall, user }) => {
  if (!wave || !user) return null;

  const { connectionState, participants, isMuted, audioLevel, error, livekitToken, livekitUrl, callActive, serverParticipantCount } = voiceCall;
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const participantCount = participants.length;

  // Not in call - check if others are in call
  if (!isConnected && !isConnecting && !livekitToken) {
    // Call is active with other participants - show Join button
    if (callActive && serverParticipantCount > 0) {
      return (
        <div style={{
          padding: '12px',
          background: 'var(--accent-green-bg)',
          border: '1px solid var(--accent-green)',
          borderRadius: '4px',
          marginBottom: '12px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}>
            <span style={{
              color: 'var(--accent-green)',
              fontSize: '14px',
              fontFamily: 'monospace'
            }}>
              📞 Call in progress
            </span>
            <span style={{
              color: 'var(--text-secondary)',
              fontSize: '12px',
              fontFamily: 'monospace'
            }}>
              {serverParticipantCount} participant{serverParticipantCount !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={voiceCall.startCall}
            disabled={!!error}
            style={{
              width: '100%',
              padding: '10px',
              background: 'var(--accent-green)',
              color: 'var(--bg-primary)',
              border: '1px solid var(--accent-green)',
              borderRadius: '2px',
              cursor: error ? 'not-allowed' : 'pointer',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: 'bold',
              opacity: error ? 0.5 : 1
            }}
          >
            Join Call
          </button>
          {error && (
            <div style={{
              marginTop: '8px',
              padding: '8px',
              background: 'var(--error-bg)',
              border: '1px solid var(--error-border)',
              borderRadius: '2px',
              color: 'var(--error-text)',
              fontSize: '12px',
              fontFamily: 'monospace'
            }}>
              {error}
            </div>
          )}
        </div>
      );
    }

    // No active call - show Start button
    return (
      <div style={{
        padding: '12px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        marginBottom: '12px'
      }}>
        <button
          onClick={voiceCall.startCall}
          disabled={!!error}
          style={{
            width: '100%',
            padding: '10px',
            background: 'var(--accent-green)',
            color: 'var(--bg-primary)',
            border: '1px solid var(--accent-green)',
            borderRadius: '2px',
            cursor: error ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace',
            fontSize: '14px',
            fontWeight: 'bold',
            opacity: error ? 0.5 : 1
          }}
        >
          📞 Start Voice Call
        </button>
        {error && (
          <div style={{
            marginTop: '8px',
            padding: '8px',
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
            borderRadius: '2px',
            color: 'var(--error-text)',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // In call - show controls
  return (
    <div style={{
      padding: '12px',
      background: 'var(--accent-green-bg)',
      border: '1px solid var(--accent-green)',
      borderRadius: '4px',
      marginBottom: '12px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px'
      }}>
        <span style={{
          color: 'var(--accent-green)',
          fontSize: '14px',
          fontFamily: 'monospace',
          fontWeight: 'bold'
        }}>
          {isConnecting ? '📞 Connecting...' : '📞 In Call'}
        </span>
        <span style={{
          color: 'var(--text-secondary)',
          fontSize: '12px',
          fontFamily: 'monospace'
        }}>
          {participantCount} participant{participantCount !== 1 ? 's' : ''}
        </span>
      </div>

      {audioLevel > 0 && !isMuted && (
        <div style={{
          marginBottom: '12px',
          height: '4px',
          background: 'var(--bg-secondary)',
          borderRadius: '2px',
          overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            background: 'var(--accent-green)',
            width: `${audioLevel * 100}%`,
            transition: 'width 0.1s ease-out'
          }} />
        </div>
      )}

      {isConnected && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={voiceCall.toggleMute}
            style={{
              flex: 1,
              padding: '10px',
              background: isMuted ? 'var(--error-bg)' : 'var(--bg-secondary)',
              color: isMuted ? 'var(--error-text)' : 'var(--text-primary)',
              border: `1px solid ${isMuted ? 'var(--error-border)' : 'var(--border)'}`,
              borderRadius: '2px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '14px'
            }}
          >
            {isMuted ? '🔇 Unmute' : '🎤 Mute'}
          </button>
          <button
            onClick={voiceCall.leaveCall}
            style={{
              flex: 1,
              padding: '10px',
              background: 'var(--error-bg)',
              color: 'var(--error-text)',
              border: '1px solid var(--error-border)',
              borderRadius: '2px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            📞 Leave Call
          </button>
        </div>
      )}

      {livekitToken && livekitUrl && (
        <LiveKitCallRoom
          token={livekitToken}
          url={livekitUrl}
          roomName={wave.id}
          voiceCall={voiceCall}
        />
      )}
    </div>
  );
};

// ============ UI COMPONENTS ============
// ============ CRAWL BAR COMPONENT ============
const CRAWL_SCROLL_SPEEDS = {
  slow: 60,     // seconds for full scroll - leisurely pace
  normal: 45,   // comfortable reading speed
  fast: 30,     // quicker but still readable
};

const CrawlBar = ({ fetchAPI, enabled = true, userPrefs = {}, isMobile = false, onAlertClick }) => {
  const [data, setData] = useState({ stocks: { data: [] }, weather: { data: null }, news: { data: [] }, alerts: { data: [] } });
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef(null);
  const animationRef = useRef(null);
  const [contentWidth, setContentWidth] = useState(0);
  const dragStartRef = useRef({ x: 0, animTime: 0 });
  const resumeTimeoutRef = useRef(null);

  const scrollSpeed = CRAWL_SCROLL_SPEEDS[userPrefs.scrollSpeed || 'normal'];
  const RESUME_DELAY = 3000; // Resume after 3 seconds of no interaction

  // Fetch crawl data without resetting animation (using Web Animations API)
  const loadData = useCallback(async () => {
    try {
      // Save current animation time before update
      let savedTime = 0;
      if (animationRef.current) {
        savedTime = animationRef.current.currentTime || 0;
      }

      const result = await fetchAPI('/crawl/all');
      setData(result);

      // Restore animation position after React re-render
      requestAnimationFrame(() => {
        if (scrollRef.current && savedTime > 0) {
          // Re-measure content width in case it changed
          const newContentWidth = scrollRef.current.scrollWidth / 2;

          // Cancel existing animation if any
          if (animationRef.current) {
            animationRef.current.cancel();
          }
          // Create new animation and restore position
          const anim = scrollRef.current.animate(
            [
              { transform: 'translateX(0px)' },
              { transform: `translateX(-${newContentWidth}px)` }
            ],
            {
              duration: scrollSpeed * 1000,
              iterations: Infinity,
              easing: 'linear'
            }
          );
          anim.currentTime = savedTime;
          animationRef.current = anim;
          setContentWidth(newContentWidth);
        }
      });
    } catch (err) {
      console.error('Crawl bar error:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, scrollSpeed]);

  // Initial load and polling
  useEffect(() => {
    if (!enabled) return;

    loadData();
    const interval = setInterval(loadData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [enabled, loadData]);

  // Measure content width for pixel-perfect seamless looping
  useEffect(() => {
    if (!scrollRef.current || loading) return;

    // Measure the width of one set of items (half the total since content is duplicated)
    const measureWidth = () => {
      if (scrollRef.current) {
        const totalWidth = scrollRef.current.scrollWidth;
        setContentWidth(totalWidth / 2); // Half because content is duplicated
      }
    };

    measureWidth();
    // Re-measure on window resize
    window.addEventListener('resize', measureWidth);
    return () => window.removeEventListener('resize', measureWidth);
  }, [loading, data]);

  // Initialize WAAPI animation when content width is known
  useEffect(() => {
    if (!scrollRef.current || loading || contentWidth === 0) return;

    // Create animation using pixel-based translation for seamless loop
    if (!animationRef.current) {
      const anim = scrollRef.current.animate(
        [
          { transform: 'translateX(0px)' },
          { transform: `translateX(-${contentWidth}px)` }
        ],
        {
          duration: scrollSpeed * 1000,
          iterations: Infinity,
          easing: 'linear'
        }
      );
      animationRef.current = anim;
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.cancel();
        animationRef.current = null;
      }
    };
  }, [loading, scrollSpeed, contentWidth]);

  // Handle pause/resume
  useEffect(() => {
    if (animationRef.current) {
      if (isPaused) {
        animationRef.current.pause();
      } else {
        animationRef.current.play();
      }
    }
  }, [isPaused]);

  // Clear resume timeout on unmount
  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, []);

  // Schedule resume after delay
  const scheduleResume = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }
    resumeTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
      setIsDragging(false);
    }, RESUME_DELAY);
  }, [RESUME_DELAY]);

  // Cancel scheduled resume
  const cancelResume = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
  }, []);

  // Pause and cancel any pending resume
  const handleInteractionStart = useCallback(() => {
    cancelResume();
    setIsPaused(true);
  }, [cancelResume]);

  // Schedule resume after interaction ends (if not dragging)
  const handleInteractionEnd = useCallback(() => {
    if (!isDragging) {
      scheduleResume();
    }
  }, [isDragging, scheduleResume]);

  // Drag handlers
  const handleDragStart = useCallback((clientX) => {
    if (!animationRef.current) return;
    setIsDragging(true);
    cancelResume();
    dragStartRef.current = {
      x: clientX,
      animTime: animationRef.current.currentTime || 0,
    };
  }, [cancelResume]);

  const handleDragMove = useCallback((clientX) => {
    if (!isDragging || !animationRef.current || contentWidth === 0) return;

    const deltaX = clientX - dragStartRef.current.x;
    // Convert pixel movement to animation time
    // Positive deltaX (drag right) = go backwards in time (see earlier content)
    // Negative deltaX (drag left) = go forwards in time (see later content)
    const duration = scrollSpeed * 1000;
    const timePerPixel = duration / contentWidth;
    const deltaTime = -deltaX * timePerPixel;

    let newTime = dragStartRef.current.animTime + deltaTime;
    // Wrap around for seamless looping
    while (newTime < 0) newTime += duration;
    while (newTime >= duration) newTime -= duration;

    animationRef.current.currentTime = newTime;
  }, [isDragging, contentWidth, scrollSpeed]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    scheduleResume();
  }, [scheduleResume]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    handleDragStart(e.clientX);
  }, [handleDragStart]);

  const handleMouseMove = useCallback((e) => {
    handleDragMove(e.clientX);
  }, [handleDragMove]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      handleDragEnd();
    }
  }, [isDragging, handleDragEnd]);

  // Touch event handlers
  const handleTouchStart = useCallback((e) => {
    handleInteractionStart();
    if (e.touches.length === 1) {
      handleDragStart(e.touches[0].clientX);
    }
  }, [handleInteractionStart, handleDragStart]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 1) {
      handleDragMove(e.touches[0].clientX);
    }
  }, [handleDragMove]);

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Add/remove global mouse listeners when dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (!enabled) {
    return null;
  }

  // Build crawl items
  const items = [];

  // System Alerts (from admins) - displayed first, highest priority
  const alertPriorityConfig = {
    critical: { icon: '🚨', color: 'var(--accent-orange)' },
    warning: { icon: '⚠️', color: 'var(--accent-amber)' },
    info: { icon: 'ℹ️', color: 'var(--accent-teal)' }
  };

  if (data.alerts?.enabled && data.alerts?.data?.length > 0) {
    // Sort by priority (critical first, then warning, then info)
    const priorityOrder = { critical: 0, warning: 1, info: 2 };
    const sortedAlerts = [...data.alerts.data].sort((a, b) =>
      (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2)
    );

    sortedAlerts.forEach(alert => {
      const cfg = alertPriorityConfig[alert.priority] || alertPriorityConfig.info;
      items.push({
        type: 'system-alert',
        key: `system-alert-${alert.id}`,
        content: (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onAlertClick?.(alert);
            }}
            style={{
              cursor: 'pointer',
              color: cfg.color,
            }}
          >
            {cfg.icon} [{alert.priority.toUpperCase()}] {alert.title}
            {alert.originNode && (
              <span style={{ fontSize: '0.7em', opacity: 0.7, marginLeft: '4px' }}>
                (@{alert.originNode})
              </span>
            )}
          </span>
        ),
      });
    });
  }

  // Stocks - clickable links to Yahoo Finance
  if (userPrefs.showStocks !== false && data.stocks?.enabled && data.stocks?.data?.length > 0) {
    data.stocks.data.forEach(stock => {
      if (!stock) return;
      const isUp = (stock.change || 0) >= 0;
      items.push({
        type: 'stock',
        key: `stock-${stock.symbol}`,
        content: (
          <a
            href={`https://finance.yahoo.com/quote/${stock.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>{stock.symbol}</span>
            {' '}
            <span style={{ color: 'var(--text-primary)' }}>${stock.price?.toFixed(2)}</span>
            {' '}
            <span style={{ color: isUp ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
              {isUp ? '▲' : '▼'} {Math.abs(stock.changePercent || 0).toFixed(2)}%
            </span>
          </a>
        ),
      });
    });
  }

  // Weather - clickable link to OpenWeatherMap
  if (userPrefs.showWeather !== false && data.weather?.enabled && data.weather?.data) {
    const weather = data.weather.data;
    const location = data.weather.location;
    const hasAlerts = weather.alerts?.length > 0;
    const weatherUrl = location?.lat && location?.lon
      ? `https://openweathermap.org/weathermap?basemap=map&cities=true&layer=temperature&lat=${location.lat}&lon=${location.lon}&zoom=10`
      : 'https://openweathermap.org/';

    items.push({
      type: 'weather',
      key: 'weather-current',
      content: (
        <a
          href={weatherUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ color: 'var(--accent-teal)' }}>🌡</span>
          {' '}
          <span style={{ color: 'var(--text-primary)' }}>{location?.name || 'Weather'}</span>
          {': '}
          <span style={{ color: 'var(--text-secondary)' }}>
            {weather.temp}°F, {weather.description}
          </span>
        </a>
      ),
    });

    // Weather alerts - clickable link to location-specific NWS forecast page
    if (hasAlerts) {
      const alertUrl = location?.lat && location?.lon
        ? `https://forecast.weather.gov/MapClick.php?lat=${location.lat}&lon=${location.lon}`
        : 'https://www.weather.gov/alerts';

      weather.alerts.slice(0, 2).forEach((alert, i) => {
        items.push({
          type: 'alert',
          key: `alert-${i}`,
          content: (
            <a
              href={alertUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: 'var(--accent-orange)' }}
              onClick={(e) => e.stopPropagation()}
            >
              ⚠️ ALERT: {alert.event}
            </a>
          ),
        });
      });
    }
  }

  // News
  if (userPrefs.showNews !== false && data.news?.enabled && data.news?.data?.length > 0) {
    data.news.data.slice(0, 5).forEach((headline, i) => {
      if (!headline?.title) return;
      items.push({
        type: 'news',
        key: `news-${i}`,
        content: (
          <a
            href={headline.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ color: 'var(--accent-purple)' }}>◆</span>
            {' '}
            {headline.title?.substring(0, 80)}{headline.title?.length > 80 ? '...' : ''}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.7em', marginLeft: '6px' }}>
              [{headline.source}]
            </span>
          </a>
        ),
      });
    });
  }

  // If no items to display, hide the bar
  if (items.length === 0 && !loading) {
    return null;
  }

  // Duplicate items for seamless loop
  const allItems = items.length > 0 ? [...items, ...items] : [];

  return (
    <div
      style={{
        position: 'relative',
        height: isMobile ? '28px' : '32px',
        background: 'var(--bg-surface)',
        borderBottom: `1px solid ${isPaused ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
        overflow: 'hidden',
        fontFamily: "'Courier New', monospace",
        fontSize: isMobile ? '0.7rem' : '0.75rem',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transition: 'border-color 0.2s ease',
      }}
      onMouseEnter={handleInteractionStart}
      onMouseLeave={handleInteractionEnd}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pause indicator */}
      {isPaused && !loading && (
        <div style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--accent-amber)',
          fontSize: '0.65rem',
          fontWeight: 500,
          zIndex: 10,
          background: 'var(--bg-surface)',
          padding: '2px 6px',
          borderRadius: '3px',
          opacity: 0.9,
        }}>
          {isDragging ? '◀ ▶' : '⏸'}
        </div>
      )}

      {/* Animation controlled via Web Animations API for seamless data refresh */}

      {loading && items.length === 0 ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
        }}>
          Loading crawl data...
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            whiteSpace: 'nowrap',
            // Animation controlled via Web Animations API (see useEffect above)
          }}
        >
          {allItems.map((item, index) => (
            <span
              key={`${item.key}-${index}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 24px',
              }}
            >
              {item.content}
            </span>
          ))}
        </div>
      )}

      {/* Gradient fade edges */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '40px',
        height: '100%',
        background: 'linear-gradient(90deg, var(--bg-surface), transparent)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: '40px',
        height: '100%',
        background: 'linear-gradient(-90deg, var(--bg-surface), transparent)',
        pointerEvents: 'none',
      }} />
    </div>
  );
};

// Notification type styling
const NOTIFICATION_TYPES = {
  direct_mention: { icon: '@', color: 'var(--accent-amber)', label: 'Mentioned you' },
  reply: { icon: '↩', color: 'var(--accent-teal)', label: 'Replied to you' },
  wave_activity: { icon: '◎', color: 'var(--accent-green)', label: 'Wave activity' },
  burst: { icon: '◈', color: 'var(--accent-purple)', label: 'Burst' },
  system: { icon: '⚡', color: 'var(--accent-orange)', label: 'System' },
};

const NotificationItem = ({ notification, onRead, onDismiss, onClick }) => {
  const typeConfig = NOTIFICATION_TYPES[notification.type] || NOTIFICATION_TYPES.system;
  const timeAgo = (date) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div
      onClick={() => onClick(notification)}
      style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: notification.read ? 'transparent' : 'var(--accent-amber)08',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        position: 'relative',
      }}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <div style={{
          position: 'absolute',
          left: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: typeConfig.color,
        }} />
      )}

      {/* Type icon */}
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: `${typeConfig.color}20`,
        border: `1px solid ${typeConfig.color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: typeConfig.color,
        fontSize: '0.9rem',
        fontWeight: 'bold',
        flexShrink: 0,
      }}>
        {typeConfig.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>
            {notification.actorDisplayName || notification.title}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{timeAgo(notification.createdAt)}</span>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>
          {notification.body || typeConfig.label}
        </div>
        {notification.preview && (
          <div style={{
            color: 'var(--text-dim)',
            fontSize: '0.7rem',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            "{notification.preview.substring(0, 60)}{notification.preview.length > 60 ? '...' : ''}"
          </div>
        )}
        {notification.waveTitle && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '4px' }}>
            in {notification.waveTitle}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '0.8rem',
          padding: '4px',
          opacity: 0.6,
        }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
};

const NotificationDropdown = ({ notifications, unreadCount, onRead, onDismiss, onClick, onReadAll, onClose, isMobile }) => {
  return (
    <div style={{
      position: isMobile ? 'fixed' : 'absolute',
      top: isMobile ? '0' : '100%',
      right: isMobile ? '0' : '-10px',
      left: isMobile ? '0' : 'auto',
      bottom: isMobile ? '0' : 'auto',
      width: isMobile ? '100%' : '360px',
      maxHeight: isMobile ? '100%' : '480px',
      background: 'var(--bg-surface)',
      border: isMobile ? 'none' : '1px solid var(--border-primary)',
      zIndex: 300,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        paddingTop: isMobile ? 'calc(12px + env(safe-area-inset-top, 0px))' : '12px',
        borderBottom: '1px solid var(--border-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-hover)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.9rem', fontWeight: 600 }}>Notifications</span>
          {unreadCount > 0 && (
            <span style={{
              background: 'var(--accent-orange)',
              color: '#fff',
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '10px',
            }}>{unreadCount}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {unreadCount > 0 && (
            <button
              onClick={onReadAll}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-teal)',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontFamily: 'monospace',
              }}
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: '1rem',
              padding: '4px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Notification list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
          }}>
            {EMPTY.noNotifications}
          </div>
        ) : (
          notifications.map(n => (
            <NotificationItem
              key={n.id}
              notification={n}
              onRead={onRead}
              onDismiss={onDismiss}
              onClick={onClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

const NotificationBell = ({ fetchAPI, onNavigateToWave, isMobile, refreshTrigger }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const bellRef = useRef(null);

  // Load notifications
  const loadNotifications = useCallback(async () => {
    try {
      const [notifData, countData] = await Promise.all([
        fetchAPI('/notifications?limit=20'),
        fetchAPI('/notifications/count'),
      ]);
      setNotifications(notifData.notifications || []);
      setUnreadCount(countData.total || 0);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  }, [fetchAPI]);

  // Load on mount and periodically
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Refresh when trigger changes (WebSocket notification received)
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadNotifications();
    }
  }, [refreshTrigger, loadNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown && !isMobile) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown, isMobile]);

  const handleMarkRead = async (notificationId) => {
    try {
      await fetchAPI(`/notifications/${notificationId}/read`, { method: 'POST' });
      setNotifications(prev => prev.map(n =>
        n.id === notificationId ? { ...n, read: true } : n
      ));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetchAPI('/notifications/read-all', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const handleDismiss = async (notificationId) => {
    try {
      await fetchAPI(`/notifications/${notificationId}`, { method: 'DELETE' });
      const notification = notifications.find(n => n.id === notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      if (notification && !notification.read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
    }
  };

  const handleNotificationClick = (notification) => {
    // Mark as read
    if (!notification.read) {
      handleMarkRead(notification.id);
    }

    // Navigate to the relevant content
    if (notification.waveId) {
      onNavigateToWave(notification.waveId, notification.pingId);
    }

    setShowDropdown(false);
  };

  return (
    <div ref={bellRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        style={{
          padding: '8px 12px',
          background: showDropdown ? 'var(--accent-amber)15' : 'transparent',
          border: `1px solid ${showDropdown ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
          color: showDropdown ? 'var(--accent-amber)' : 'var(--text-dim)',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          position: 'relative',
        }}
        title="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-6px',
            right: '-6px',
            background: 'var(--accent-orange)',
            color: '#fff',
            fontSize: '0.55rem',
            fontWeight: 700,
            padding: '2px 5px',
            borderRadius: '10px',
            minWidth: '16px',
            textAlign: 'center',
            boxShadow: '0 0 8px rgba(255, 107, 53, 0.8)',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <NotificationDropdown
          notifications={notifications}
          unreadCount={unreadCount}
          onRead={handleMarkRead}
          onDismiss={handleDismiss}
          onClick={handleNotificationClick}
          onReadAll={handleMarkAllRead}
          onClose={() => setShowDropdown(false)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
};

// ============ ERROR BOUNDARY ============
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'var(--accent-orange)', background: 'var(--bg-base)', border: '1px solid var(--accent-orange)', margin: '10px' }}>
          <h3 style={{ margin: '0 0 10px 0' }}>⚠️ Something went wrong</h3>
          <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: 'var(--accent-amber)' }}>
            {this.state.error?.toString()}
          </pre>
          <details style={{ marginTop: '10px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            <summary>Stack trace</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.errorInfo?.componentStack}</pre>
          </details>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{ marginTop: '10px', padding: '8px 16px', background: 'var(--accent-green)', border: 'none', color: 'var(--bg-base)', cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============ MAIN APP ENTRY POINT ============
export default function CortexApp() {
  return (
    <AuthProvider>
      <E2EEWrapper />
    </AuthProvider>
  );
}
