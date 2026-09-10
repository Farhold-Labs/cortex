// Resolve only Cortex playback URLs before attaching this user's app token.
export function mediaPlaybackUrl(value, apiUrl, token) {
  const api = new URL(apiUrl);
  const url = new URL(value, api);
  if (url.username || url.password || url.origin !== api.origin || !/^\/api\/(?:jellyfin|plex)\/(?:video|hls)\//.test(url.pathname)) {
    throw new Error('Invalid playback URL');
  }
  url.searchParams.set('token', token || '');
  return url.toString();
}
