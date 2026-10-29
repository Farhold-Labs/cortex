import { byChannelOrder } from './listOrder.js';

/**
 * How the wave list files waves (v2.121.0, shared since v2.125.0).
 *
 * The home panel, the Community and category panels and the desktop rail all
 * have to agree on where a wave lives and what counts as unread in a group,
 * so the grouping is one function rather than a copy in each.
 *
 * - A wave filed in a Community channel is listed under that channel, not
 *   under a personal category: the shared grouping wins, because that is the
 *   one other people can also see.
 * - A pinned wave is listed under PINNED, but `allByChannel` still holds it so
 *   its unread pings count toward its channel and Community.
 */
export function groupWaves(waves, categories, channels) {
  const pinned = waves.filter(w => w.pinned);
  const byChannel = {};
  const allByChannel = {};
  for (const ch of channels) {
    allByChannel[ch.id] = waves.filter(w => w.channelId === ch.id);
    byChannel[ch.id] = allByChannel[ch.id].filter(w => !w.pinned).sort(byChannelOrder);
  }
  const filedIds = new Set(Object.values(byChannel).flat().map(w => w.id));
  const uncategorized = waves.filter(w => !w.pinned && !w.category_id && !filedIds.has(w.id));
  const categorized = {};
  for (const cat of categories) {
    categorized[cat.id] = waves.filter(w => !w.pinned && w.category_id === cat.id && !filedIds.has(w.id));
  }
  return { pinned, uncategorized, categorized, byChannel, allByChannel };
}

/** Unread for a group: notification count where there is one, else unread pings. */
export function unreadOf(wavesInGroup, waveNotifications = {}) {
  return wavesInGroup.reduce((sum, wave) =>
    sum + (waveNotifications[wave.id]?.count || wave.unread_count || 0), 0);
}

/** The id the UNCATEGORIZED group goes by when it is opened as a panel. */
export const UNCATEGORIZED_ID = '__uncategorized__';

/**
 * Two letters for a tile: the first letters of the first two words, or the
 * first two letters of a one-word name. Emoji and punctuation are skipped, so
 * "🎭 Main Stage" is MS and "#general" is GE.
 */
export function initialsFor(name) {
  const words = String(name || '')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1
    ? [...words[0]].slice(0, 2).join('')
    : [...words[0]][0] + [...words[1]][0];
  return letters.toUpperCase();
}
