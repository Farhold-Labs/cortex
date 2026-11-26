/**
 * Maps (v2.166.0, docs/ttrpg/README.md phase 5): an uploaded picture with a
 * square grid, tokens on squares, and fog: the squares the GM has revealed.
 * Fog is drawn over the map on players' screens; it isn't a secret from
 * someone who opens their browser's developer tools (decided 2026-11-25:
 * "drawn on the player's screen is enough"). Things that must stay secret
 * (monsters not yet seen) are GM-only tokens, which players never receive.
 * Coordinates are in the picture's own pixels; squares are whole numbers.
 */

export function blankMap(name, image) {
  return {
    schema: 1, name: name || 'Map', image,
    grid: { size: 70, offsetX: 0, offsetY: 0, show: true, color: '#000000', opacity: 0.35, feet: 5 },
    fog: { enabled: false, revealed: [] },
  };
}

export const TOKEN_COLORS = ['#e4572e', '#29335c', '#f3a712', '#669bbc', '#a8c686', '#8f2d56', '#ffffff', '#222222'];

export function blankToken({ mapId, name, color, x = 0, y = 0, size = 1, sheetId = null }) {
  return { schema: 1, mapId, name: name || 'Token', color: color || TOKEN_COLORS[0], x, y, size, sheetId };
}

/** Which square a point (picture pixels) is in. */
export function cellAt(px, py, grid) {
  const size = Math.max(4, Number(grid.size) || 70);
  return { x: Math.floor((px - (Number(grid.offsetX) || 0)) / size), y: Math.floor((py - (Number(grid.offsetY) || 0)) / size) };
}

/** A square's top-left corner in picture pixels. */
export function cellOrigin(cx, cy, grid) {
  const size = Math.max(4, Number(grid.size) || 70);
  return { x: (Number(grid.offsetX) || 0) + cx * size, y: (Number(grid.offsetY) || 0) + cy * size };
}

/** Where a token of `size` squares lands when dropped with its centre at a point. */
export function snapToken(px, py, size, grid) {
  const s = Math.max(4, Number(grid.size) || 70);
  const k = Math.max(1, Number(size) || 1);
  return cellAt(px - ((k - 1) * s) / 2, py - ((k - 1) * s) / 2, grid);
}

/** Squares moved, 5e style: a diagonal counts as one. */
export function squaresBetween(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export const cellKey = (x, y) => `${x},${y}`;

/** How many squares the picture holds. */
export function gridSize(map) {
  const s = Math.max(4, Number(map.grid?.size) || 70);
  return {
    cols: Math.ceil(((map.image?.width || 0) - (Number(map.grid?.offsetX) || 0)) / s),
    rows: Math.ceil(((map.image?.height || 0) - (Number(map.grid?.offsetY) || 0)) / s),
  };
}

/** Reveal or hide squares; returns the new revealed list (sorted, no repeats). */
export function paintFog(revealed, cells, reveal) {
  const set = new Set(revealed || []);
  for (const c of cells) { const k = cellKey(c.x, c.y); if (reveal) set.add(k); else set.delete(k); }
  return [...set].sort();
}

/** Does a player see this token? Its own always; others only on revealed squares when there's fog. */
export function tokenVisibleToPlayer(token, map, userId, ownerId) {
  if (ownerId && ownerId === userId) return true;
  if (!map.fog?.enabled) return true;
  const revealed = new Set(map.fog.revealed || []);
  const k = Math.max(1, Number(token.size) || 1);
  for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) if (revealed.has(cellKey(token.x + dx, token.y + dy))) return true;
  return false;
}
