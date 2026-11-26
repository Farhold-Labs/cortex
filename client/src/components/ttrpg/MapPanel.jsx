import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listTableDocs, createTableDoc, deleteTableDoc, updateTableDoc, onTableDocUpdated, openTableDoc } from '../../utils/tableDocs.js';
import { uploadFile } from '../../utils/uploads.js';
import { listSheets, openSheet } from '../../utils/sheets.js';
import { plainText } from '../../utils/plainText.js';
import {
  blankMap, blankToken, TOKEN_COLORS, cellAt, cellOrigin, snapToken, squaresBetween, cellKey, gridSize, paintFog, tokenVisibleToPlayer,
} from '../../ttrpg/map.js';
import { btn, labelStyle, inputStyle, box } from './sheetUi.jsx';

/**
 * Maps (v2.166.0, docs/ttrpg/README.md phase 5). The GM uploads a map, sets
 * its grid, reveals squares through the fog and places tokens; players see
 * the maps the GM has shown and move their own tokens. Changes go to the
 * server on drop and reach everyone through table_doc_updated.
 */

const small = { ...btn(), minHeight: '28px', padding: '2px 8px' };

export function MapTab({ wave, table, isGm, names, currentUser, fetchAPI, e2ee, isMobile, showToast }) {
  const [maps, setMaps] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const fileRef = useRef(null);
  const e2eeRef = useRef(e2ee); e2eeRef.current = e2ee;

  const load = useCallback(async () => {
    try { setMaps(await listTableDocs(fetchAPI, e2eeRef.current, wave.id, 'map')); } catch { setMaps([]); }
  }, [fetchAPI, wave.id, e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => onTableDocUpdated(({ waveId, kind }) => { if (waveId === wave.id && kind === 'map') load(); }), [wave.id, load]);
  // Players land on the map the GM showed last.
  useEffect(() => {
    if (openId || !maps || isGm) return;
    const shown = maps.filter(m => m.audience === 'table' && m.body).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (shown) setOpenId(shown.id);
  }, [maps]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const img = await uploadFile(`/waves/${encodeURIComponent(wave.id)}/table/map-image`, form, { label: file.name || 'Map', size: file.size });
      const doc = await createTableDoc(fetchAPI, e2ee, wave, { kind: 'map', data: blankMap(name.trim() || file.name.replace(/\.[^.]+$/, ''), { url: img.url, width: img.width, height: img.height }) });
      setName(''); setOpenId(doc.id);
    } catch (err) {
      if (!err.cancelled) showToast?.(err.message || 'Could not upload the map', 'error');
    } finally { setUploading(false); }
  };

  if (openId) {
    return (
      <MapView key={openId} mapId={openId} wave={wave} table={table} isGm={isGm} names={names} currentUser={currentUser}
        fetchAPI={fetchAPI} e2ee={e2ee} isMobile={isMobile} showToast={showToast} onBack={() => { setOpenId(null); load(); }} />
    );
  }
  const visible = (maps || []).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {isGm && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Map name" aria-label="Map name" style={{ ...inputStyle, flex: '1 1 140px', width: 'auto' }} />
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} style={btn(true)}>{uploading ? 'Uploading…' : '+ Upload a map'}</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        </div>
      )}
      {isGm && <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>A new map is yours until you show it to the players. Pictures up to 20MB; kept up to 4096 pixels.</div>}
      {!maps && <div style={{ color: 'var(--text-dim)' }}>Loading…</div>}
      {maps && !visible.length && <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{isGm ? 'No maps yet.' : 'The GM hasn\'t shown a map yet.'}</div>}
      {visible.map(m => (
        <button key={m.id} type="button" onClick={() => setOpenId(m.id)}
          style={{ ...box, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'monospace', display: 'flex', gap: '8px' }}>
          <span style={{ flex: 1 }}>{m.body ? plainText(m.body.name || '') || 'Map' : '🔒 Unlock encryption to see this'}</span>
          {isGm && <span style={{ color: m.audience === 'table' ? 'var(--accent-green)' : 'var(--text-dim)', fontSize: '0.7rem' }}>{m.audience === 'table' ? 'SHOWN' : 'GM ONLY'}</span>}
        </button>
      ))}
    </div>
  );
}

function MapView({ mapId, wave, table, isGm, names, currentUser, fetchAPI, e2ee, isMobile, showToast, onBack }) {
  const [mapDoc, setMapDoc] = useState(null); // the stored doc
  const [map, setMap] = useState(null);       // its data
  const [tokens, setTokens] = useState([]);   // [{ doc, data }]
  const [tool, setTool] = useState('move');   // move | reveal | hide
  const [adding, setAdding] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const e2eeRef = useRef(e2ee); e2eeRef.current = e2ee;

  const loadMap = useCallback(async () => {
    try {
      const { doc } = await fetchAPI(`/waves/${encodeURIComponent(wave.id)}/table-docs/${encodeURIComponent(mapId)}`);
      setMapDoc(doc); setMap(await openTableDoc(e2eeRef.current, wave.id, doc));
    } catch (err) { showToast?.(err.message || 'Could not open the map', 'error'); }
  }, [fetchAPI, wave.id, mapId, showToast]);
  const loadTokens = useCallback(async () => {
    try {
      const all = await listTableDocs(fetchAPI, e2eeRef.current, wave.id, 'token');
      setTokens(all.filter(t => t.body?.mapId === mapId).map(t => ({ doc: t, data: t.body })));
    } catch { /* keep */ }
  }, [fetchAPI, wave.id, mapId]);
  useEffect(() => { loadMap(); loadTokens(); }, [loadMap, loadTokens]);
  useEffect(() => onTableDocUpdated(({ waveId, kind, docId }) => {
    if (waveId !== wave.id) return;
    if (kind === 'map' && docId === mapId) loadMap();
    if (kind === 'token') loadTokens();
  }), [wave.id, mapId, loadMap, loadTokens]);

  const saveMap = async (mutate, opts) => {
    if (!mapDoc) return;
    // Show the change at once; the server's copy follows.
    setMap(m => { const next = JSON.parse(JSON.stringify(m)); mutate(next); return next; });
    try {
      const doc = await updateTableDoc(fetchAPI, e2ee, wave, mapDoc, mutate, opts);
      setMapDoc(doc);
      if (opts?.audience) setMap(await openTableDoc(e2ee, wave.id, doc));
    } catch (err) { showToast?.(err.message || 'Could not save the map', 'error'); loadMap(); }
  };
  const moveToken = async (t, x, y) => {
    setTokens(list => list.map(o => (o.doc.id === t.doc.id ? { ...o, data: { ...o.data, x, y } } : o)));
    try {
      const doc = await updateTableDoc(fetchAPI, e2ee, wave, t.doc, (d) => { d.x = x; d.y = y; });
      setTokens(list => list.map(o => (o.doc.id === t.doc.id ? { ...o, doc } : o)));
    } catch (err) { showToast?.(err.message || 'Could not move the token', 'error'); loadTokens(); }
  };

  if (!map) return <div style={{ color: 'var(--text-dim)' }}>Loading the map…</div>;
  const shown = mapDoc?.audience === 'table';
  const removeMap = async () => {
    if (!window.confirm(`Delete ${map.name || 'this map'} and its tokens?`)) return;
    try {
      for (const t of tokens) await deleteTableDoc(fetchAPI, wave.id, t.doc.id).catch(() => {});
      await deleteTableDoc(fetchAPI, wave.id, mapId); onBack();
    } catch (err) { showToast?.(err.message || 'Could not delete', 'error'); }
  };
  const myTokens = tokens.filter(t => t.doc.ownerId === currentUser?.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={btn()} aria-label="All maps">◀</button>
        <span style={{ flex: 1, color: 'var(--accent-amber)' }}>{plainText(map.name || '') || 'Map'}</span>
        {isGm && (
          <button type="button" onClick={() => saveMap(() => {}, { audience: shown ? 'gm' : 'table' })} style={shown ? small : { ...small, ...btn(true) }}>
            {shown ? 'Hide from players' : 'Show to players'}
          </button>
        )}
      </div>

      {isGm && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
          {[['move', '✋ Move'], ['reveal', '◻ Reveal'], ['hide', '◼ Hide']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={tool === k} onClick={() => setTool(k)} style={{ ...small, ...btn(tool === k) }}>{l}</button>
          ))}
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={!!map.fog?.enabled} onChange={(e) => saveMap(m => { m.fog = { ...(m.fog || { revealed: [] }), enabled: e.target.checked }; })} />Fog
          </label>
          {map.fog?.enabled && <button type="button" onClick={() => saveMap(m => { const { cols, rows } = gridSize(m); const all = []; for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) all.push(cellKey(x, y)); m.fog.revealed = all; })} style={small}>Reveal all</button>}
          {map.fog?.enabled && <button type="button" onClick={() => saveMap(m => { m.fog.revealed = []; })} style={small}>Fog all</button>}
          <button type="button" aria-pressed={showGrid} onClick={() => setShowGrid(v => !v)} style={{ ...small, ...btn(showGrid) }}>Grid…</button>
          <button type="button" onClick={() => setAdding(a => !a)} style={{ ...small, ...btn(adding) }}>+ Token</button>
        </div>
      )}
      {!isGm && !myTokens.length && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button type="button" onClick={() => setAdding(a => !a)} style={{ ...small, ...btn(adding) }}>+ My token</button>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>Put your character on the map, then drag it.</span>
        </div>
      )}
      {isGm && showGrid && <GridSettings map={map} saveMap={saveMap} />}
      {adding && (
        <AddToken map={map} mapId={mapId} wave={wave} isGm={isGm} names={names} currentUser={currentUser} fetchAPI={fetchAPI} e2ee={e2ee}
          showToast={showToast} onDone={() => { setAdding(false); loadTokens(); }} />
      )}

      <MapCanvas map={map} tokens={tokens} isGm={isGm} me={currentUser?.id} tool={isGm ? tool : 'move'} isMobile={isMobile}
        onMoveToken={moveToken}
        onFogPaint={(cells, reveal) => saveMap(m => { m.fog = { ...(m.fog || {}), revealed: paintFog(m.fog?.revealed, cells, reveal) }; })} />

      <TokenList tokens={tokens} isGm={isGm} me={currentUser?.id} names={names} wave={wave} fetchAPI={fetchAPI} e2ee={e2ee} showToast={showToast} reload={loadTokens} />

      {isGm && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          <button type="button" onClick={removeMap} style={{ ...small, color: 'var(--accent-orange)' }}>Delete map</button>
        </div>
      )}
    </div>
  );
}

function GridSettings({ map, saveMap }) {
  const g = map.grid || {};
  const num = (key, label, min, max, step = 1) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      <input type="number" inputMode="numeric" aria-label={label} min={min} max={max} step={step} value={g[key] ?? 0}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) saveMap(m => { m.grid = { ...m.grid, [key]: Math.max(min, Math.min(max, v)) }; }); }}
        style={{ ...inputStyle, width: '5.5em' }} />
    </label>
  );
  return (
    <div style={{ ...box, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {num('size', 'SQUARE (PX)', 8, 600)}
      {num('offsetX', 'SHIFT X', -600, 600)}
      {num('offsetY', 'SHIFT Y', -600, 600)}
      {num('feet', 'FEET A SQUARE', 1, 100)}
      <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><input type="checkbox" checked={g.show !== false} onChange={(e) => saveMap(m => { m.grid = { ...m.grid, show: e.target.checked }; })} />Show grid</label>
      <input type="color" aria-label="Grid colour" value={g.color || '#000000'} onChange={(e) => saveMap(m => { m.grid = { ...m.grid, color: e.target.value }; })} />
      <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', flexBasis: '100%' }}>Match the squares to the picture's own grid: size first, then shift.</span>
    </div>
  );
}

function AddToken({ map, mapId, wave, isGm, names, currentUser, fetchAPI, e2ee, showToast, onDone }) {
  const [sheets, setSheets] = useState([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState(TOKEN_COLORS[isGm ? 0 : 3]);
  const [owner, setOwner] = useState(isGm ? '' : currentUser?.id);
  const [sheetId, setSheetId] = useState('');
  const [size, setSize] = useState(1);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let live = true;
    listSheets(fetchAPI, wave.id).then(async (list) => {
      const out = [];
      for (const s of list) { try { out.push({ meta: s, data: await openSheet(e2ee, wave.id, s) }); } catch { /* unreadable */ } }
      if (live) setSheets(isGm ? out : out.filter(s => s.meta.ownerId === currentUser?.id));
    }).catch(() => {});
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    const sheet = sheets.find(s => s.meta.id === sheetId);
    const tokenName = name.trim() || (sheet ? plainText(sheet.data.name || '') : '') || 'Token';
    // A new token starts in the middle of what's on screen: the map's centre square.
    const { cols, rows } = gridSize(map);
    try {
      await createTableDoc(fetchAPI, e2ee, wave, {
        kind: 'token', audience: isGm && hidden ? 'gm' : 'table',
        ownerId: isGm ? (sheet?.meta.ownerId || owner || undefined) : currentUser?.id,
        data: blankToken({ mapId, name: tokenName, color, size, sheetId: sheet?.meta.id || null, x: Math.max(0, Math.floor(cols / 2)), y: Math.max(0, Math.floor(rows / 2)) }),
      });
      onDone();
    } catch (err) { showToast?.(err.message || 'Could not add the token', 'error'); }
  };
  return (
    <div style={{ ...box, display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
      {sheets.length > 0 && (
        <select aria-label="Character" value={sheetId} onChange={(e) => setSheetId(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">{isGm ? 'A character, or…' : 'My character…'}</option>
          {sheets.map(s => <option key={s.meta.id} value={s.meta.id}>{plainText(s.data.name || '') || 'Unnamed'}</option>)}
        </select>
      )}
      <input aria-label="Token name" placeholder={sheetId ? 'Name (from the sheet)' : 'Name (Goblin 1, Door…)'} value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} style={{ ...inputStyle, width: 'auto', flex: '1 1 120px' }} />
      <span style={{ display: 'inline-flex', gap: '3px' }}>
        {TOKEN_COLORS.map(c => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} style={{ width: '20px', height: '20px', borderRadius: '50%', background: c, border: color === c ? '2px solid var(--accent-amber)' : '1px solid var(--border-primary)', padding: 0, cursor: 'pointer' }} />)}
      </span>
      <select aria-label="Size" value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
        <option value={1}>1 square</option><option value={2}>2×2 (Large)</option><option value={3}>3×3 (Huge)</option><option value={4}>4×4 (Gargantuan)</option>
      </select>
      {isGm && !sheetId && (
        <select aria-label="Who moves it" value={owner} onChange={(e) => setOwner(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">Only GMs move it</option>
          {Object.entries(names || {}).map(([id, n]) => <option key={id} value={id}>{n} moves it</option>)}
        </select>
      )}
      {isGm && <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Hidden from players</label>}
      <button type="button" onClick={add} style={btn(true)}>Add</button>
    </div>
  );
}

function TokenList({ tokens, isGm, me, names, wave, fetchAPI, e2ee, showToast, reload }) {
  const mine = tokens.filter(t => isGm || t.doc.ownerId === me);
  if (!mine.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      {mine.map(t => (
        <span key={t.doc.id} style={{ ...box, padding: '2px 6px', display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '0.72rem', opacity: t.doc.audience === 'gm' ? 0.7 : 1 }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: t.data.color, display: 'inline-block' }} />
          {plainText(t.data.name || '')}{t.doc.ownerId && isGm ? ` · ${names?.[t.doc.ownerId] || ''}` : ''}
          {isGm && (
            <button type="button" onClick={async () => {
              try { await updateTableDoc(fetchAPI, e2ee, wave, t.doc, () => {}, { audience: t.doc.audience === 'gm' ? 'table' : 'gm' }); reload(); }
              catch (err) { showToast?.(err.message || 'Could not change it', 'error'); }
            }} style={{ ...small, minHeight: '22px', padding: '0 6px' }}>{t.doc.audience === 'gm' ? 'Reveal' : 'Hide'}</button>
          )}
          <button type="button" aria-label={`Remove ${t.data.name}`} onClick={async () => {
            if (!window.confirm(`Remove ${t.data.name}?`)) return;
            try { await deleteTableDoc(fetchAPI, wave.id, t.doc.id); reload(); } catch (err) { showToast?.(err.message || 'Could not remove it', 'error'); }
          }} style={{ ...small, minHeight: '22px', padding: '0 6px', color: 'var(--text-dim)' }}>✕</button>
        </span>
      ))}
    </div>
  );
}

/**
 * The map itself: the picture, the grid, the fog and the tokens, panned with
 * a drag (or two fingers), zoomed with the wheel or a pinch. A token you may
 * move is dragged and snaps to the grid when let go; the GM's Reveal and Hide
 * tools paint fog.
 */
function MapCanvas({ map, tokens, isGm, me, tool, isMobile, onMoveToken, onFogPaint }) {
  const boxRef = useRef(null);
  const [view, setView] = useState(null); // { x, y, z }
  const [drag, setDrag] = useState(null); // { token, px, py, from }
  const [paint, setPaint] = useState(null); // { cells: Map, reveal }
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const W = map.image?.width || 1; const H = map.image?.height || 1;
  const grid = map.grid || {};
  const size = Math.max(4, Number(grid.size) || 70);

  // Fit the picture when it first shows.
  useEffect(() => {
    const el = boxRef.current; if (!el || view) return;
    const r = el.getBoundingClientRect();
    const z = Math.min(r.width / W, r.height / H) || 1;
    setView({ x: (r.width - W * z) / 2, y: (r.height - H * z) / 2, z });
  }, [W, H, view]);

  const toMap = (clientX, clientY) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  };
  const zoomAt = (clientX, clientY, factor) => setView(v => {
    const r = boxRef.current.getBoundingClientRect();
    const z = Math.max(0.05, Math.min(8, v.z * factor));
    const mx = clientX - r.left; const my = clientY - r.top;
    return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z };
  });

  const visibleTokens = tokens.filter(t => isGm || tokenVisibleToPlayer(t.data, map, me, t.doc.ownerId));
  const canMove = (t) => isGm || (t.doc.ownerId && t.doc.ownerId === me);

  const onPointerDown = (e) => {
    if (!view) return;
    boxRef.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // A second finger: pinch, not drag.
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) };
      setDrag(null); setPaint(null);
      return;
    }
    const tokenId = e.target?.closest?.('[data-token]')?.getAttribute('data-token');
    const t = tokenId && tokens.find(x => x.doc.id === tokenId);
    const p = toMap(e.clientX, e.clientY);
    if (tool === 'move' && t && canMove(t)) {
      setDrag({ token: t, px: p.x, py: p.y, from: { x: t.data.x, y: t.data.y } });
      gesture.current = { kind: 'token' };
    } else if (tool !== 'move' && isGm) {
      const c = cellAt(p.x, p.y, grid);
      // A drag reveals (or hides) the rectangle of squares from where it began.
      setPaint({ start: c, cells: new Map([[cellKey(c.x, c.y), c]]), reveal: tool === 'reveal' });
      gesture.current = { kind: 'paint' };
    } else {
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY };
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !view) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / g.dist);
      g.dist = dist;
    } else if (g.kind === 'pan') {
      const dx = e.clientX - g.x; const dy = e.clientY - g.y;
      g.x = e.clientX; g.y = e.clientY;
      setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (g.kind === 'token') {
      const p = toMap(e.clientX, e.clientY);
      setDrag(d => (d ? { ...d, px: p.x, py: p.y } : d));
    } else if (g.kind === 'paint') {
      const p = toMap(e.clientX, e.clientY);
      const c = cellAt(p.x, p.y, grid);
      setPaint(pt => {
        if (!pt) return pt;
        const cells = new Map();
        for (let x = Math.min(pt.start.x, c.x); x <= Math.max(pt.start.x, c.x); x++) {
          for (let y = Math.min(pt.start.y, c.y); y <= Math.max(pt.start.y, c.y); y++) cells.set(cellKey(x, y), { x, y });
        }
        return { ...pt, cells };
      });
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'token' && drag) {
      const to = snapToken(drag.px, drag.py, drag.token.data.size, grid);
      if (to.x !== drag.from.x || to.y !== drag.from.y) onMoveToken(drag.token, to.x, to.y);
    }
    if (g?.kind === 'paint' && paint) onFogPaint([...paint.cells.values()], paint.reveal);
    setDrag(null); setPaint(null);
    if (pointers.current.size === 0) gesture.current = null;
  };
  const onWheel = (e) => { if (view) { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); } };
  useEffect(() => {
    const el = boxRef.current; if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const fogOn = !!map.fog?.enabled;
  const revealed = map.fog?.revealed || [];
  const pending = paint ? [...paint.cells.values()] : [];
  const dropCell = drag ? snapToken(drag.px, drag.py, drag.token.data.size, grid) : null;
  const moved = drag && dropCell ? squaresBetween(drag.from, dropCell) : 0;

  return (
    <div
      ref={boxRef} role="application" aria-label="Map"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ position: 'relative', overflow: 'hidden', height: isMobile ? '58vh' : '62vh', background: '#111', touchAction: 'none', userSelect: 'none', cursor: tool === 'move' ? 'grab' : 'crosshair', border: '1px solid var(--border-secondary)' }}
    >
      {view && (
        <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' }}>
          <img src={map.image?.url} alt={map.name || 'Map'} width={W} height={H} draggable={false} style={{ display: 'block', width: W, height: H, pointerEvents: 'none' }} />
          <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
            <defs>
              <pattern id="cortex-map-grid" width={size} height={size} patternUnits="userSpaceOnUse" x={Number(grid.offsetX) || 0} y={Number(grid.offsetY) || 0}>
                <path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke={grid.color || '#000'} strokeOpacity={grid.opacity ?? 0.35} strokeWidth={Math.max(1, size / 50)} />
              </pattern>
              {fogOn && (
                <mask id="cortex-map-fog">
                  <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="white" />
                  {revealed.map(k => { const [cx, cy] = k.split(',').map(Number); const o = cellOrigin(cx, cy, grid); return <rect key={k} x={o.x} y={o.y} width={size} height={size} fill="black" />; })}
                </mask>
              )}
            </defs>
            {grid.show !== false && <rect x={0} y={0} width={W} height={H} fill="url(#cortex-map-grid)" pointerEvents="none" />}
            {visibleTokens.map(t => {
              const o = cellOrigin(t.data.x, t.data.y, grid);
              const k = Math.max(1, Number(t.data.size) || 1);
              const dragging = drag?.token.doc.id === t.doc.id;
              const mineOrGm = canMove(t);
              return (
                <g key={t.doc.id} data-token={t.doc.id} style={{ cursor: tool === 'move' && mineOrGm ? 'grab' : 'default', opacity: dragging ? 0.35 : 1 }}>
                  <circle cx={o.x + (k * size) / 2} cy={o.y + (k * size) / 2} r={k * size * 0.42} fill={t.data.color || '#e4572e'}
                    stroke={t.doc.ownerId === me ? 'var(--accent-amber, #ffd23f)' : '#fff'} strokeWidth={Math.max(2, size / 18)}
                    strokeDasharray={t.doc.audience === 'gm' ? `${size / 8} ${size / 10}` : undefined} />
                  <text x={o.x + (k * size) / 2} y={o.y + (k * size) / 2} textAnchor="middle" dominantBaseline="central"
                    fontSize={Math.max(10, k * size * 0.32)} fontFamily="monospace" fill="#fff" stroke="#000" strokeWidth={Math.max(1, size / 40)} paintOrder="stroke" pointerEvents="none">
                    {initials(t.data.name)}
                  </text>
                </g>
              );
            })}
            {fogOn && <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="#000" fillOpacity={isGm ? 0.45 : 1} mask="url(#cortex-map-fog)" pointerEvents="none" />}
            {pending.map(c => { const o = cellOrigin(c.x, c.y, grid); return <rect key={cellKey(c.x, c.y)} x={o.x} y={o.y} width={size} height={size} fill={paint.reveal ? '#0ead69' : '#e4572e'} fillOpacity={0.35} pointerEvents="none" />; })}
            {drag && dropCell && (() => {
              const k = Math.max(1, Number(drag.token.data.size) || 1);
              const o = cellOrigin(dropCell.x, dropCell.y, grid);
              return (
                <g pointerEvents="none">
                  <rect x={o.x} y={o.y} width={k * size} height={k * size} fill="none" stroke="#ffd23f" strokeWidth={Math.max(2, size / 20)} />
                  <circle cx={drag.px} cy={drag.py} r={k * size * 0.42} fill={drag.token.data.color} fillOpacity={0.8} />
                  <text x={o.x + (k * size) / 2} y={o.y - size * 0.15} textAnchor="middle" fontSize={Math.max(12, size * 0.35)} fontFamily="monospace" fill="#ffd23f" stroke="#000" strokeWidth={Math.max(1, size / 30)} paintOrder="stroke">
                    {moved} sq · {moved * (Number(grid.feet) || 5)} ft.
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>
      )}
      <div style={{ position: 'absolute', right: '6px', bottom: '6px', display: 'flex', gap: '4px' }}>
        <button type="button" aria-label="Zoom in" onClick={() => { const r = boxRef.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.3); }} style={{ ...small, background: 'var(--bg-surface)' }}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => { const r = boxRef.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.3); }} style={{ ...small, background: 'var(--bg-surface)' }}>−</button>
        <button type="button" aria-label="Fit the map" onClick={() => setView(null)} style={{ ...small, background: 'var(--bg-surface)' }}>⤢</button>
      </div>
    </div>
  );
}

function initials(name) {
  const words = plainText(String(name || '?')).trim().split(/\s+/).filter(Boolean);
  const digits = words.find(w => /^\d+$/.test(w));
  return ((words[0]?.[0] || '?') + (digits || words[1]?.[0] || '')).toUpperCase().slice(0, 3);
}

export default MapTab;
