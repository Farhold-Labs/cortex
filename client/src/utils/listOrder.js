/**
 * Sidebar order (v2.121.0).
 *
 * The list used to be sorted by last activity, so whatever had just been
 * posted in jumped to the top. Now it keeps the order people give it:
 *
 *  - `position` is the person's own order for their waves (and Communities);
 *  - `channelPosition` is the order a channel's managers gave its waves,
 *    shared by everyone in the Community.
 *
 * Anything without a place lists after the placed ones, oldest first, so a
 * new wave arrives at the bottom rather than above what was arranged.
 */

const created = (item) => item.createdAt || item.created_at || '';

const comparator = (key) => (a, b) => {
  const pa = a[key] ?? Infinity;
  const pb = b[key] ?? Infinity;
  if (pa !== pb) return pa < pb ? -1 : 1;
  const ca = created(a), cb = created(b);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
};

/** Someone's own order. */
export const byPersonalOrder = comparator('position');

/** A channel's shared order. */
export const byChannelOrder = comparator('channelPosition');

/**
 * Move one item a step up (-1) or down (+1) within its group, and return the
 * new order of the WHOLE list, or null if it is already at that end.
 *
 * The personal order is one list across every section, so a wave keeps its
 * place when it is filed elsewhere. Moving within a section therefore means
 * moving past the neighbour in that section, which may be several places away
 * in the whole list.
 */
export function moveInGroup(allIds, groupIds, id, dir) {
  const at = groupIds.indexOf(id);
  const neighbour = groupIds[at + dir];
  if (at < 0 || neighbour === undefined) return null;
  const rest = allIds.filter(x => x !== id);
  const j = rest.indexOf(neighbour);
  if (j < 0) return null;
  rest.splice(dir < 0 ? j : j + 1, 0, id);
  return rest;
}

/** Swap an item with its neighbour in a single list; null at either end. */
export function moveInList(ids, id, dir) {
  return moveInGroup(ids, ids, id, dir);
}
