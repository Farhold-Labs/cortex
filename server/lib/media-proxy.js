import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function upstreamUrl(base, resource, prefix) {
  const origin = new URL(base);
  const target = new URL(resource, origin);
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== origin.origin
    || target.username || target.password || (prefix && !target.pathname.startsWith(prefix))) {
    throw new Error('Invalid upstream media resource');
  }
  // Credentials are attached by the server as headers, never forwarded in URLs.
  for (const name of [...target.searchParams.keys()]) {
    if (['x-plex-token', 'api_key', 'access_token'].includes(name.toLowerCase())) target.searchParams.delete(name);
  }
  target.hash = '';
  return target;
}

export async function readLimitedText(response, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('Upstream playlist too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Relay only media headers. In particular, upstream Location, cookies and auth
// headers never reach a client. Abort upstream work on disconnect/error.
export async function proxyMedia(req, res, url, headers, { playlist } = {}) {
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  res.once('close', disconnect);
  let timer;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(), 30000);
  };
  resetTimeout();
  try {
    const forwarded = { ...headers, 'Accept-Encoding': 'identity' };
    if (req.headers.range) {
      if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) {
        res.status(416).end();
        return;
      }
      forwarded.Range = req.headers.range;
    }
    const upstream = await fetch(url, { headers: forwarded, redirect: 'error', signal: abort.signal });
    resetTimeout();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!upstream.ok) {
      await upstream.body?.cancel();
      res.status(upstream.status === 416 ? 416 : 502).json({ error: 'Media unavailable' });
      return;
    }
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    if (playlist && (/mpegurl/i.test(type) || new URL(url).pathname.endsWith('.m3u8'))) {
      const text = await readLimitedText(upstream);
      res.type('application/vnd.apple.mpegurl').send(playlist(text));
      return;
    }
    // Do not let a remote server turn a media proxy into same-origin HTML/JS.
    if (!/^(?:video\/|audio\/|image\/(?:jpeg|png|webp|gif|avif)(?:;|$)|application\/octet-stream(?:;|$))/i.test(type)) {
      await upstream.body?.cancel();
      res.status(502).json({ error: 'Invalid media response' });
      return;
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', type);
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    await pipeline(Readable.fromWeb(upstream.body), async function* (source) {
      for await (const chunk of source) {
        resetTimeout();
        yield chunk;
      }
    }, res);
  } catch {
    // Fetch errors can include credential-bearing upstream URLs. Keep them out
    // of logs and responses, and never attempt JSON after streaming has begun.
    if (!res.headersSent && !res.destroyed) res.status(502).json({ error: 'Media unavailable' });
    else if (!res.destroyed) res.destroy();
  } finally {
    clearTimeout(timer);
    res.off('close', disconnect);
    abort.abort();
  }
}

// HLS references are opaque, server-registered resources. Clients cannot submit
// a path or URL to this proxy, including a path for a different library item.
export class HlsSessions {
  constructor({ ttl = 8 * 60 * 60 * 1000, maxSessions = 128, maxResources = 10000, maxPerUser = 8, now = Date.now } = {}) {
    this.maxPerUser = maxPerUser;
    this.ttl = ttl; this.maxSessions = maxSessions; this.maxResources = maxResources; this.now = now;
    this.sessions = new Map();
  }
  create(scope, url) {
    for (const [id, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(id);
    const ownSessions = [...this.sessions.values()].filter(session => session.userId === scope.userId);
    if (ownSessions.length >= this.maxPerUser) this.sessions.delete(ownSessions[0].id);
    if (this.sessions.size >= this.maxSessions) throw new Error('Playback capacity reached');
    const session = { ...scope, id: crypto.randomUUID(), expires: this.now() + this.ttl, resources: new Map(), urls: new Map() };
    this.register(session, url);
    this.sessions.set(session.id, session);
    return session;
  }
  get(id, userId) {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return null;
    if (session.expires <= this.now()) { this.sessions.delete(id); return null; }
    return session;
  }
  register(session, url) {
    const target = upstreamUrl(session.serverUrl, url, '/video/:/transcode/universal/').toString();
    if (session.urls.has(target)) return session.urls.get(target);
    if (session.resources.size >= this.maxResources) throw new Error('Playlist resource limit reached');
    const id = crypto.randomUUID();
    session.resources.set(id, target); session.urls.set(target, id);
    return id;
  }
  localUrl(session, resourceId, token) {
    return `/api/plex/hls/${session.id}/${resourceId}?token=${encodeURIComponent(token)}`;
  }
  rewrite(session, text, base, token) {
    if (!text.startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist');
    const map = value => this.localUrl(session, this.register(session, upstreamUrl(base, value).toString()), token);
    return text.split(/\r?\n/).map(line => {
      if (!line.trim()) return '';
      if (!line.startsWith('#')) return map(line.trim());
      if (!line.startsWith('#EXT')) return ''; // discard upstream comments
      // HLS URI attributes include keys, init segments, renditions and variants.
      return line.replace(/\b((?:SERVER-)?URI)="([^"]*)"/g, (_, attribute, value) => `${attribute}="${map(value)}"`);
    }).join('\n');
  }
}
