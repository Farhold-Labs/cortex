// ============ EMBED UTILITIES ============

// Platform icons and colors
export const EMBED_PLATFORMS = {
  youtube: { icon: '▶', color: '#ff0000', name: 'YouTube' },
  vimeo: { icon: '▶', color: '#1ab7ea', name: 'Vimeo' },
  spotify: { icon: '🎵', color: '#1db954', name: 'Spotify' },
  tiktok: { icon: '♪', color: '#ff0050', name: 'TikTok' },
  twitter: { icon: '𝕏', color: '#1da1f2', name: 'X/Twitter' },
  soundcloud: { icon: '☁', color: '#ff5500', name: 'SoundCloud' },
  tenor: { icon: '🎬', color: '#5856d6', name: 'Tenor' },
  giphy: { icon: '🎬', color: '#00ff99', name: 'GIPHY' },
  jellyfin: { icon: '🎬', color: '#a86ce8', name: 'Jellyfin' },
  plex: { icon: '▶', color: '#e5a00d', name: 'Plex' },
};

// URL patterns for detecting embeddable content (mirrors server)
// Note: YouTube patterns capture video ID; playlist ID is extracted separately via URL parsing
export const EMBED_URL_PATTERNS = {
  youtube: [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?[^\s]*v=([a-zA-Z0-9_-]{11})/i,  // watch with video (may have list param)
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/playlist\?[^\s]*list=([a-zA-Z0-9_-]+)/i,  // playlist-only URL (v2.19.0)
  ],
  vimeo: [
    /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/i,
  ],
  spotify: [
    /(?:https?:\/\/)?open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/i,
  ],
  tiktok: [
    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)/i,
    /(?:https?:\/\/)?(?:vm\.)?tiktok\.com\/([a-zA-Z0-9]+)/i,
  ],
  twitter: [
    /(?:https?:\/\/)?(?:www\.)?(twitter|x)\.com\/\w+\/status\/(\d+)/i,
  ],
  soundcloud: [
    /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/[\w-]+\/[\w-]+/i,
  ],
  tenor: [
    /(?:https?:\/\/)?(?:www\.)?tenor\.com\/view\/[\w-]+-(\d+)/i,
    /(?:https?:\/\/)?tenor\.com\/([a-zA-Z0-9]+)\.gif/i,
  ],
  giphy: [
    /(?:https?:\/\/)?(?:www\.)?giphy\.com\/gifs\/(?:[\w-]+-)*([a-zA-Z0-9]+)/i,
    /(?:https?:\/\/)?gph\.is\/([a-zA-Z0-9]+)/i,
  ],
};

// Detect embed URLs in text (skip image URLs already embedded as <img> tags)
export function detectEmbedUrls(text) {
  const embeds = [];
  const seenUrls = new Set(); // Prevent duplicate embeds

  // Collect URLs already embedded as <img> tags (we don't want to re-embed images)
  const imgSrcRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  const alreadyEmbeddedImages = new Set();
  let imgMatch;
  while ((imgMatch = imgSrcRegex.exec(text)) !== null) {
    alreadyEmbeddedImages.add(imgMatch[1]);
  }

  // Detect Jellyfin cortex:// URLs (v2.14.0)
  const jellyfinRegex = /cortex:\/\/jellyfin\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9]+)(\?[^\s<>"]*)?/gi;
  let jellyfinMatch;
  while ((jellyfinMatch = jellyfinRegex.exec(text)) !== null) {
    const fullUrl = jellyfinMatch[0];
    if (!seenUrls.has(fullUrl)) {
      const params = new URLSearchParams(jellyfinMatch[3]?.substring(1) || '');
      embeds.push({
        platform: 'jellyfin',
        url: fullUrl,
        connectionId: jellyfinMatch[1],
        itemId: jellyfinMatch[2],
        name: params.get('name') || 'Unknown Media',
        type: params.get('type') || 'Video',
        duration: params.get('duration') ? parseInt(params.get('duration'), 10) : null,
        overview: params.get('overview') || null,
      });
      seenUrls.add(fullUrl);
    }
  }

  // Detect Plex cortex:// URLs (v2.15.0)
  const plexRegex = /cortex:\/\/plex\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9]+)(\?[^\s<>"]*)?/gi;
  let plexMatch;
  while ((plexMatch = plexRegex.exec(text)) !== null) {
    const fullUrl = plexMatch[0];
    if (!seenUrls.has(fullUrl)) {
      const params = new URLSearchParams(plexMatch[3]?.substring(1) || '');
      embeds.push({
        platform: 'plex',
        url: fullUrl,
        connectionId: plexMatch[1],
        ratingKey: plexMatch[2],
        name: params.get('name') || 'Unknown Media',
        type: params.get('type') || 'movie',
        duration: params.get('duration') ? parseInt(params.get('duration'), 10) : null,
        summary: params.get('summary') || null,
      });
      seenUrls.add(fullUrl);
    }
  }

  // Find all URLs in the text (including those in <a> tags - we want to embed videos)
  const urlRegex = /https?:\/\/[^\s<>"]+/gi;
  const urls = text.match(urlRegex) || [];

  for (const url of urls) {
    // Skip URLs already embedded as images
    if (alreadyEmbeddedImages.has(url)) continue;
    // Skip duplicate URLs
    if (seenUrls.has(url)) continue;

    for (const [platform, patterns] of Object.entries(EMBED_URL_PATTERNS)) {
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          const embed = { platform, url, contentId: match[1] };

          // Handle Spotify's type/id format
          if (platform === 'spotify' && match[2]) {
            embed.contentType = match[1];
            embed.contentId = match[2];
          }

          // Generate embed URLs
          if (platform === 'youtube') {
            // Extract playlist ID from URL if present (v2.19.0)
            const playlistMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
            const playlistId = playlistMatch ? playlistMatch[1] : null;

            // Check if this is a playlist-only URL (contentId is the playlist ID)
            const isPlaylistOnly = url.includes('/playlist?');

            if (isPlaylistOnly) {
              // Playlist-only URL: use videoseries embed
              embed.playlistId = embed.contentId;
              embed.contentId = null;
              embed.embedUrl = `https://www.youtube.com/embed/videoseries?list=${embed.playlistId}&rel=0`;
              // Use a generic playlist thumbnail (first video thumbnail not easily available)
              embed.thumbnail = null;
              embed.isPlaylist = true;
            } else if (playlistId) {
              // Video URL with playlist context
              embed.playlistId = playlistId;
              embed.embedUrl = `https://www.youtube.com/embed/${embed.contentId}?list=${playlistId}&rel=0`;
              embed.thumbnail = `https://img.youtube.com/vi/${embed.contentId}/hqdefault.jpg`;
              embed.isPlaylist = true;
            } else {
              // Regular video URL
              embed.embedUrl = `https://www.youtube.com/embed/${embed.contentId}?rel=0`;
              embed.thumbnail = `https://img.youtube.com/vi/${embed.contentId}/hqdefault.jpg`;
            }
          } else if (platform === 'vimeo') {
            embed.embedUrl = `https://player.vimeo.com/video/${embed.contentId}`;
          } else if (platform === 'spotify') {
            embed.embedUrl = `https://open.spotify.com/embed/${embed.contentType}/${embed.contentId}`;
          }

          embeds.push(embed);
          seenUrls.add(url);
          break;
        }
      }
    }
  }

  return embeds;
}

// Build the HTML snippet the composers insert for a picked GIF/sticker/clip.
// Klipy clips post an .mp4 URL, which must become a <video> — wrapping it in
// <img> renders a broken image (v2.60.1). The server sanitizer allows both
// tags with these exact attributes.
export function mediaEmbedHtml(url) {
  if (/\.(mp4|webm)(\?|$)/i.test(url)) {
    return `<video src="${url}" controls playsinline preload="metadata" class="message-media"></video>`;
  }
  return `<img src="${url}" alt="GIF" style="max-width: 100%; height: auto;" loading="eager" class="message-media" />`;
}
