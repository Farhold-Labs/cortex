import { sanitizeMessageHtml } from '../../utils/html.js';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { API_URL, BASE_URL } from '../../config/constants.js';
import { detectEmbedUrls, EMBED_PLATFORMS, embedUploadedImages } from '../../utils/embed.js';
import { renderMarkdown } from '../../utils/markdown.js';
import JellyfinEmbed from '../media/JellyfinEmbed.jsx';
import PlexEmbed from '../media/PlexEmbed.jsx';

// Single embed component with click-to-load
const RichEmbed = ({ embed, autoLoad = false }) => {
  const [loaded, setLoaded] = useState(autoLoad);
  const [error, setError] = useState(false);
  const [oembedHtml, setOembedHtml] = useState(null);
  const [oembedLoading, setOembedLoading] = useState(false);
  const [meta, setMeta] = useState(null);
  const [gifData, setGifData] = useState(null);
  const platform = EMBED_PLATFORMS[embed.platform] || { icon: '🔗', color: '#666', name: 'Link' };
  const embedContainerRef = useRef(null);

  // Platforms that require oEmbed HTML injection (no direct iframe embed URL)
  const requiresOembed = ['twitter', 'soundcloud'].includes(embed.platform);

  // Title, picture and, where the link does not name the video, the player's
  // address (v2.133.0): a TikTok short link or a Rumble page only says which
  // video it is through the provider's oEmbed, which the server proxies.
  const wantsMeta = ['tiktok', 'rumble', 'vimeo'].includes(embed.platform);
  useEffect(() => {
    if (!wantsMeta || meta) return;
    let live = true;
    fetch(`${API_URL}/embeds/oembed?url=${encodeURIComponent(embed.url)}`)
      .then(res => res.json())
      .then(data => { if (live) setMeta(data || {}); })
      .catch(() => { if (live) setMeta({}); }); // the card still opens the link
    return () => { live = false; };
  }, [wantsMeta, embed.url, meta]);
  const playerSrc = embed.embedUrl || meta?.playerUrl || null;
  const thumbnail = embed.thumbnail || meta?.thumbnail || null;

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
      default: // video players size by aspect ratio, below
        return { width: '100%', height: '100%' };
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

  // The player's box. Video keeps its shape at any width instead of a fixed
  // 315 px height (v2.133.0); upright video (TikTok, Instagram, Shorts, Reels)
  // gets an upright box. Instagram's frame adds its own header and caption
  // around the picture, so it is taller still.
  const frameBox = embed.platform === 'spotify'
    ? { width: '100%', maxWidth: '100%', height: dimensions.height }
    : embed.platform === 'instagram'
      ? { width: '100%', maxWidth: '400px', aspectRatio: '400 / 720' }
      : embed.portrait
        ? { width: '100%', maxWidth: '325px', aspectRatio: '9 / 16' }
        : { width: '100%', maxWidth: '560px', aspectRatio: '16 / 9' };

  // Clicked, but the player's address is still being asked for, or the
  // provider would not say: show the way to the provider instead.
  const awaitingPlayer = loaded && !requiresOembed && !playerSrc && wantsMeta && meta === null;
  const noPlayer = loaded && !requiresOembed && !playerSrc && !awaitingPlayer;

  if (error || noPlayer) {
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

  if (!loaded || awaitingPlayer) {
    return (
      <div
        onClick={() => setLoaded(true)}
        style={{
          ...frameBox,
          position: 'relative',
          boxSizing: 'border-box',
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
        {/* The video's picture, where the provider gives one */}
        {thumbnail && (
          <img
            src={thumbnail}
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
          padding: '0 12px',
          textAlign: 'center',
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
            {awaitingPlayer ? `Loading ${platform.name}…` : `Click to load ${platform.name}`}
          </span>
          {(meta?.title || meta?.author) && (
            <span style={{
              color: 'var(--text-secondary)', fontSize: '0.75rem', textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            }}>
              {meta.author ? `@${meta.author}` : ''}{meta.author && meta.title ? ' · ' : ''}{meta.title || ''}
            </span>
          )}
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

  // Loaded state: the provider's own player in a frame
  return (
    <div style={{ ...frameBox, marginTop: '8px' }}>
      <iframe
        src={playerSrc}
        title={meta?.title || `${platform.name} player`}
        width="100%"
        height="100%"
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          display: 'block',
          boxSizing: 'border-box',
          background: '#000',
        }}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
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
    // Render markdown first (client-side, at display time) so the stored content
    // stays raw source. The renderer preserves any existing HTML (media/links)
    // and only emits a safe tag subset; the passes below (mentions, media,
    // auto-links) then run on the result.
    let result = renderMarkdown(content);
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

    // Embed bare /uploads/messages/ paths as <img> tags.
    // Server does this via detectAndEmbedMedia, but E2EE waves store encrypted content,
    // so decrypted messages arrive as plain text URLs instead of pre-processed HTML.
    // Including a picture on its own line after a caption — see embedUploadedImages.
    result = embedUploadedImages(result);

    // Convert raw [file:name:size]/path markers to styled download cards.
    // Same situation as images — E2EE decrypted messages carry the unprocessed marker.
    result = result.replace(
      /\[file:([^\]:]+):(\d+)\](\/uploads\/files\/[^\s<"']+)/g,
      (match, filename, sizeStr, url) => {
        const size = parseInt(sizeStr, 10);
        let formatted;
        if (size >= 1024 * 1024) formatted = `${(size / (1024 * 1024)).toFixed(1)} MB`;
        else if (size >= 1024) formatted = `${(size / 1024).toFixed(1)} KB`;
        else formatted = `${size} B`;
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        let icon = '📄';
        if (ext === 'pdf') icon = '📕';
        else if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) icon = '📝';
        else if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) icon = '📊';
        else if (['ppt', 'pptx', 'odp'].includes(ext)) icon = '📽️';
        else if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) icon = '📦';
        else if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) icon = '🎵';
        else if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) icon = '🎬';
        else if (['json', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) icon = '📋';
        else if (['js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'jsx', 'tsx'].includes(ext)) icon = '💻';
        return `<a href="${url}" download="${filename}" class="file-attachment-card" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;text-decoration:none;color:var(--text-primary);margin:6px 0;max-width:320px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--accent-teal)'" onmouseout="this.style.borderColor='var(--border-subtle)'"><span style="font-size:1.5rem;flex-shrink:0;">${icon}</span><span style="flex:1;min-width:0;"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.85rem;font-family:monospace;color:var(--text-primary);">${filename}</span><span style="display:block;font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${formatted}</span></span><span style="flex-shrink:0;color:var(--text-dim);font-size:0.9rem;" title="Download">⬇</span></a>`;
      }
    );

    // Convert bare video CDN URLs (e.g. Klipy clips) to <video> tags.
    // Must run before the <img> pass below so mp4/webm URLs on GIF CDN hosts
    // become playable video instead of a broken image.
    result = result.replace(
      /(?<!['"=])(https?:\/\/(?:[a-z0-9-]+\.klipy\.com|media[0-9]?\.tenor\.com|c\.tenor\.com|media[0-9]?\.giphy\.com|i\.giphy\.com)[^\s<"']+\.(?:mp4|webm)(?:\?[^\s<"']*)?)/gi,
      '<video src="$1" controls playsinline preload="metadata" class="message-media"></video>'
    );

    // Convert bare GIF CDN URLs to <img> tags.
    // Server does this via detectAndEmbedMedia, but E2EE waves store encrypted
    // content so decrypted messages arrive with the raw CDN URL as plain text.
    // The negative lookbehind skips URLs already inside HTML attributes.
    result = result.replace(
      /(?<!['"=])(https?:\/\/(?:media[0-9]?\.tenor\.com|c\.tenor\.com|media[0-9]?\.giphy\.com|i\.giphy\.com|[a-z0-9-]+\.klipy\.com)[^\s<"']+)/gi,
      '<img src="$1" alt="GIF" style="max-width: 100%; height: auto;" loading="eager" class="message-media" />'
    );

    // Rescue mp4/webm URLs wrapped in <img> — messages posted before v2.60.1
    // (or by old clients) stored clips as broken images; render them as <video>.
    result = result.replace(
      /<img\b[^>]*\bsrc="([^"]+\.(?:mp4|webm)(?:\?[^"]*)?)"[^>]*\/?>/gi,
      '<video src="$1" controls playsinline preload="metadata" class="message-media"></video>'
    );

    // Absolutize relative server paths so Electron (app:// origin) loads
    // images and file links from the remote server, not the local filesystem.
    // Attached audio and video play in place (v2.112.0). An MP3 or MP4 sent
    // as a file used to be only a download card. Since v2.113.2 the player
    // replaces the card rather than sitting above it: the player's own ⋮ menu
    // downloads (confirmed in the Android app), so both was a duplicate. The
    // card's name and size stay as a caption. Formats limited to ones browsers play
    // AND the server serves inline (RENDERABLE_UPLOAD_TYPES) — anything else
    // is sent as a forced download and could never play.
    // Display-time only: stored messages are unchanged, so every existing
    // attachment gains a player too, encrypted waves included.
    result = result.replace(
      /<a href="(\/uploads\/files\/[^"]+\.(mp3|m4a|wav|ogg|oga|opus|mp4|webm|m4v|mov))" download="([^"]*)" class="file-attachment-card"[\s\S]*?<\/a>/gi,
      (card, url, ext, filename) => {
        const video = ['mp4', 'webm', 'm4v', 'mov'].includes(ext.toLowerCase());
        const player = video
          ? `<video src="${url}" controls playsinline preload="metadata" class="message-media" style="display:block;max-width:100%;max-height:420px;margin:6px 0 2px;background:#000;"></video>`
          : `<audio src="${url}" controls preload="metadata" class="message-audio" style="display:block;width:100%;max-width:360px;margin:6px 0 2px;"></audio>`;
        // Both pieces come out of the card already escaped.
        const size = (card.match(/margin-top:2px;">([^<]*)<\/span>/) || [])[1] || '';
        const caption = `<span class="message-media-caption" style="display:block;max-width:360px;margin:0 0 6px;font-family:monospace;font-size:0.72rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${filename}${size ? ` · ${size}` : ''}</span>`;
        return player + caption;
      }
    );

    if (BASE_URL) {
      result = result
        .replace(/(<(?:video|audio)\b[^>]*\ssrc=")(\/uploads\/)/g, `$1${BASE_URL}$2`)
        .replace(/(<img\b[^>]*\ssrc=")(\/(uploads|api\/media)\/)/g, `$1${BASE_URL}$2`)
        .replace(/(<a\b[^>]*\shref=")(\/(uploads|api\/media)\/)/g, `$1${BASE_URL}$2`);
    }

    // Labeled links: render custom text for a link (v2.62.0). Client-side
    // equivalent of the server's detectAndEmbedMedia (E2EE waves decrypt to
    // plain text here, so the server never processed them). Two forms:
    //   "URL|Buy Tickets|" → multi-word label (closing pipe; excludes :// so it
    //                         can't swallow a following URL)
    //   "URL|cortex"       → single-word label
    // Must run before the bare-URL autolink below.
    result = result
      .replace(
        /(?<!["'>=/])(https?:\/\/[^\s<>"'|]+)\|((?:(?!https?:\/\/)[^<>"'|\n])+?)\|/gi,
        (m, url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label.trim()}</a>`
      )
      .replace(
        /(?<!["'>=/])(https?:\/\/[^\s<>"'|]+)\|([^\s<>"'|]+)/gi,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>'
      );

    // Autolink remaining bare URLs (skip any already inside a tag or as an
    // anchor's text). Mirrors the server's bare-URL linkification so plain links
    // are clickable in E2EE waves too.
    result = result.replace(
      /(?<!["'>=/])(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/)/gi,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

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
        dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(displayContent) }}
        onClick={handleClick}
      />
      {embeds.map((embed, index) => (
        embed.platform === 'jellyfin' ? (
          <JellyfinEmbed
            key={`jellyfin-${embed.connectionId}-${embed.itemId}-${index}`}
            connectionId={embed.connectionId}
            shareId={embed.shareId}
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
            shareId={embed.shareId}
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
