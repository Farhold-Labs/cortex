// ============ EMBED UTILITIES ============

// Platform icons and colors
export const EMBED_PLATFORMS = {
  youtube: { icon: '▶', color: '#ff0000', name: 'YouTube' },
  vimeo: { icon: '▶', color: '#1ab7ea', name: 'Vimeo' },
  spotify: { icon: '🎵', color: '#1db954', name: 'Spotify' },
  tiktok: { icon: '♪', color: '#ff0050', name: 'TikTok' },
  instagram: { icon: '◎', color: '#e1306c', name: 'Instagram' },
  facebook: { icon: 'f', color: '#1877f2', name: 'Facebook' },
  twitch: { icon: '▶', color: '#9146ff', name: 'Twitch' },
  dailymotion: { icon: '▶', color: '#0d0d0d', name: 'Dailymotion' },
  streamable: { icon: '▶', color: '#0f90fa', name: 'Streamable' },
  rumble: { icon: '▶', color: '#85c742', name: 'Rumble' },
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
  // TikTok, Instagram and the rest below (v2.133.0) are anchored to their
  // host: a link that merely mentions one of these addresses is not a video.
  tiktok: [
    /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)/i,
    /^https?:\/\/(?:www\.)?tiktok\.com\/(?:embed\/v2|player\/v1)\/(\d+)/i,
    // Short links name no video; the server asks TikTok which one (oEmbed).
    /^https?:\/\/(?:vm|vt)\.tiktok\.com\/([a-zA-Z0-9]+)/i,
    /^https?:\/\/(?:www\.)?tiktok\.com\/t\/([a-zA-Z0-9]+)/i,
  ],
  instagram: [
    /^https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/i,
  ],
  facebook: [
    /^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:[\w.-]+\/videos\/(?:[\w.-]+\/)?\d+|watch\/?\?v=\d+|reel\/\d+|share\/[vr]\/[\w-]+)/i,
    /^https?:\/\/fb\.watch\/[\w-]+/i,
  ],
  twitch: [
    /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/videos\/(\d+)/i,
    /^https?:\/\/clips\.twitch\.tv\/([\w-]+)/i,
    /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/\w+\/clip\/([\w-]+)/i,
    /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/(\w{3,25})\/?(?:[?#]|$)/i,
  ],
  dailymotion: [
    /^https?:\/\/(?:www\.)?dailymotion\.com\/video\/([a-zA-Z0-9]+)/i,
    /^https?:\/\/dai\.ly\/([a-zA-Z0-9]+)/i,
  ],
  streamable: [
    /^https?:\/\/(?:www\.)?streamable\.com\/(?:e\/)?([a-z0-9]+)\/?(?:[?#]|$)/i,
  ],
  rumble: [
    /^https?:\/\/(?:www\.)?rumble\.com\/embed\/(v[a-z0-9]+)/i,
    // A page address is not the player's; the server asks Rumble (oEmbed).
    /^https?:\/\/(?:www\.)?rumble\.com\/(v[a-z0-9]+)-[^\s]*\.html/i,
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

/**
 * Where the newer video providers' players live (v2.133.0).
 *
 * Each is the provider's own iframe player, the same arrangement as YouTube:
 * the video plays inside the wave. `embedUrl: null` means the link does not
 * say which video it is (a TikTok short link, a Rumble page), so the player
 * address comes from the server's oEmbed proxy as `playerUrl` instead.
 * `portrait` marks upright video, which gets a tall box rather than 16:9.
 */
export function videoPlayer(platform, rawUrl, match) {
  const url = rawUrl.replace(/&amp;/g, '&');
  switch (platform) {
    case 'tiktok':
      // TikTok's iframe player (2023) plays in place; its older embed.js
      // rewrote the page and could not live inside React, so TikTok was a
      // link card until v2.133.0.
      return {
        portrait: true,
        embedUrl: /^\d+$/.test(match[1])
          ? `https://www.tiktok.com/player/v1/${match[1]}?music_info=1&description=1&rel=0`
          : null,
      };
    case 'instagram': {
      const kind = match[1].toLowerCase() === 'p' ? 'p' : match[1].toLowerCase() === 'tv' ? 'tv' : 'reel';
      return {
        contentId: match[2],
        portrait: true,
        embedUrl: `https://www.instagram.com/${kind}/${match[2]}/embed/`,
      };
    }
    case 'facebook':
      return {
        contentId: url,
        portrait: /\/(reel|share\/r)\//i.test(url),
        embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false`,
      };
    case 'twitch': {
      // Twitch refuses to play unless told which site it is framed in.
      const parent = encodeURIComponent(typeof window !== 'undefined' ? window.location.hostname : 'localhost');
      const id = encodeURIComponent(match[1]);
      if (/\/videos\//i.test(url)) return { embedUrl: `https://player.twitch.tv/?video=${id}&parent=${parent}&autoplay=false` };
      if (/clips\.twitch\.tv|\/clip\//i.test(url)) return { embedUrl: `https://clips.twitch.tv/embed?clip=${id}&parent=${parent}&autoplay=false` };
      return { embedUrl: `https://player.twitch.tv/?channel=${id}&parent=${parent}&autoplay=false` };
    }
    case 'dailymotion':
      return { embedUrl: `https://geo.dailymotion.com/player.html?video=${match[1]}` };
    case 'streamable':
      return { embedUrl: `https://streamable.com/e/${match[1]}` };
    case 'rumble':
      return { embedUrl: /\/embed\//i.test(url) ? `https://rumble.com/embed/${match[1]}/` : null };
    default:
      return {};
  }
}

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
      const params = new URLSearchParams((jellyfinMatch[3]?.substring(1) || '').replace(/&amp;/g, '&'));
      embeds.push({
        platform: 'jellyfin',
        shareId: params.get('share') || null,
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
      const params = new URLSearchParams((plexMatch[3]?.substring(1) || '').replace(/&amp;/g, '&'));
      embeds.push({
        platform: 'plex',
        shareId: params.get('share') || null,
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
            // Shorts are upright; the player box follows the video.
            if (/\/shorts\//i.test(url)) embed.portrait = true;
          } else if (platform === 'vimeo') {
            embed.embedUrl = `https://player.vimeo.com/video/${embed.contentId}`;
          } else if (platform === 'spotify') {
            embed.embedUrl = `https://open.spotify.com/embed/${embed.contentType}/${embed.contentId}`;
          } else {
            Object.assign(embed, videoPlayer(platform, url, match));
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

/**
 * Turn bare uploaded-image paths in rendered (decrypted) message HTML into
 * <img> tags (v2.108.0).
 *
 * In an end-to-end encrypted wave the server never sees the message, so it
 * cannot embed uploads the way it does elsewhere; the client does it here,
 * after markdown has rendered the text. The path must stand on its own: at the
 * start, after whitespace, or right after a tag. It must not be part of an
 * attribute value (`src="/uploads/…"`), a longer path or URL, or a word.
 *
 * The earlier pattern refused a path preceded by `>`, to stay out of tags.
 * But markdown (v2.64.0) renders line breaks as `<br>` BEFORE this pass runs —
 * and the composer puts an uploaded image on its own line after any caption —
 * so every picture sent with text above it arrived as a bare path that could
 * not be opened. A `>` that ends a tag is exactly where a new line begins; it
 * is the characters INSIDE a tag's attributes that must be excluded, and those
 * are always preceded by a quote or `=`.
 */
export const UPLOADED_IMAGE_PATH = /(?<![\w'"=/.:%-])(\/uploads\/messages\/[^\s<"'>]+\.(?:webp|jpg|jpeg|png|gif|svg))(?![\w/'"])/gi;

export function embedUploadedImages(html) {
  return String(html).replace(UPLOADED_IMAGE_PATH, (match) =>
    `<img src="${match}" alt="Uploaded image" style="max-width:200px;max-height:150px;border-radius:4px;cursor:pointer;object-fit:cover;display:block;border:1px solid #3a4a3a;" class="zoomable-image" />`);
}
