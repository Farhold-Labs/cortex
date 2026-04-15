import React, { useState, useEffect, useRef, useMemo } from 'react';
import { API_URL, BASE_URL } from '../../config/constants.js';
import { detectEmbedUrls, EMBED_PLATFORMS } from '../../utils/embed.js';
import JellyfinEmbed from '../media/JellyfinEmbed.jsx';
import PlexEmbed from '../media/PlexEmbed.jsx';

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

// Component to render message content with embeds (formerly MessageWithEmbeds)
const MessageWithEmbeds = ({ content, autoLoadEmbeds = false, participants = [], contacts = [], onMentionClick, fetchAPI }) => {
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

    // Transform file-attachment anchors into styled download cards
    result = result.replace(
      /<a\s+href="([^"]*?)"\s+class="file-attachment"\s+data-filename="([^"]*?)"\s+data-size="([^"]*?)"\s+download="[^"]*?">[^<]*?<\/a>/g,
      (match, url, filename, size) => {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        let icon = '📄';
        if (['pdf'].includes(ext)) icon = '📕';
        else if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) icon = '📝';
        else if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) icon = '📊';
        else if (['ppt', 'pptx', 'odp'].includes(ext)) icon = '📽️';
        else if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) icon = '📦';
        else if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) icon = '🎵';
        else if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) icon = '🎬';
        else if (['json', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) icon = '📋';
        else if (['js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'jsx', 'tsx'].includes(ext)) icon = '💻';

        return `<a href="${url}" download="${filename}" class="file-attachment-card" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;text-decoration:none;color:var(--text-primary);margin:6px 0;max-width:320px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--accent-teal)'" onmouseout="this.style.borderColor='var(--border-subtle)'"><span style="font-size:1.5rem;flex-shrink:0;">${icon}</span><span style="flex:1;min-width:0;"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.85rem;font-family:monospace;color:var(--text-primary);">${filename}</span><span style="display:block;font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${size}</span></span><span style="flex-shrink:0;color:var(--text-dim);font-size:0.9rem;" title="Download">⬇</span></a>`;
      }
    );

    // Absolutize relative server paths so Electron (app:// origin) loads
    // images and file links from the remote server, not the local filesystem.
    if (BASE_URL) {
      result = result
        .replace(/(<img\b[^>]*\ssrc=")(\/(uploads|api\/media)\/)/g, `$1${BASE_URL}$2`)
        .replace(/(<a\b[^>]*\shref=")(\/(uploads|api\/media)\/)/g, `$1${BASE_URL}$2`);
    }

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
        embed.platform === 'jellyfin' ? (
          <JellyfinEmbed
            key={`jellyfin-${embed.connectionId}-${embed.itemId}-${index}`}
            connectionId={embed.connectionId}
            itemId={embed.itemId}
            name={embed.name}
            type={embed.type}
            duration={embed.duration}
            overview={embed.overview}
            canStartWatchParty={false}
          />
        ) : embed.platform === 'plex' ? (
          <PlexEmbed
            key={`plex-${embed.connectionId}-${embed.ratingKey}-${index}`}
            connectionId={embed.connectionId}
            ratingKey={embed.ratingKey}
            name={embed.name}
            type={embed.type}
            duration={embed.duration}
            summary={embed.summary}
          />
        ) : (
          <RichEmbed key={`${embed.platform}-${embed.contentId}-${index}`} embed={embed} autoLoad={autoLoadEmbeds} />
        )
      ))}
    </>
  );
};

export default MessageWithEmbeds;
