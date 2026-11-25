/**
 * Which of a Plex server's addresses Cortex should use (v2.156.2).
 *
 * plex.tv lists every address a server has: LAN ("local"), public, and
 * Plex's relay. It was the browser's choice that mattered once, so the LAN
 * address came first. But it is this server, not the browser, that talks to
 * Plex: every request is proxied. A hosted Cortex (farhold, at Bluehost) can't
 * reach someone's 192.168.x.x, so connecting through the sign-in offered an
 * address that could never work, and the only way round was pasting a token.
 *
 * So each address is tried from here, and the first that answers wins, in the
 * order public, relay, LAN. A Cortex on the same LAN as its Plex still gets
 * the LAN address when the public one doesn't answer (no remote access set up).
 * If none answers, the public one is offered anyway, marked unreachable.
 */

export function orderConnections(connections = []) {
  const rank = (c) => (!c.local && !c.relay ? 0 : c.relay ? 1 : 2);
  return connections
    .filter(c => c && typeof c.uri === 'string' && /^https?:\/\//i.test(c.uri))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

// `probe(uri)` resolves true when that address answers. Every address is tried
// at once, so the wait is one probe's timeout, not one per address.
export async function pickConnection(connections, probe) {
  const ordered = orderConnections(connections);
  if (!ordered.length) return null;
  const answers = await Promise.all(ordered.map(c => Promise.resolve().then(() => probe(c.uri)).catch(() => false)));
  const index = answers.findIndex(Boolean);
  const chosen = index >= 0 ? ordered[index] : ordered[0];
  return { uri: chosen.uri, local: !!chosen.local, relay: !!chosen.relay, reachable: index >= 0 };
}
