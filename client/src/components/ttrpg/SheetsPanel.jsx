import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { SYSTEM_LABELS } from '../../utils/rolls.js';
import { plainText } from '../../utils/plainText.js';
import { listSheets, openSheet, createSheet, deleteSheet, onSheetUpdated, useSheet } from '../../utils/sheets.js';
import { blankSheet, isDnd5e } from '../../ttrpg/dnd5e2024.js';
import { blankGenericSheet, GENERIC_PRESETS } from '../../ttrpg/generic.js';
import { btn, labelStyle, inputStyle, box } from './sheetUi.jsx';
import Dnd5eSheet from './Dnd5eSheet.jsx';
import GenericSheet from './GenericSheet.jsx';

/**
 * Character sheets at a table (v2.159.0, docs/ttrpg/README.md phase 2): a
 * panel beside the wave on a wide screen, the whole screen on a phone. The
 * list shows your sheets and the others you may see (the server decides);
 * a sheet opens in place, and its rolls go into the wave.
 */

const VIS_LABELS = { table: 'Everyone at the table', gm: 'Only me and the GMs' };

export function Frame({ isMobile, onClose, title, left, right, children, label = "Close", wide = false }) {
  return (
    <aside
      role="dialog" aria-label={title}
      style={{
        position: 'fixed', zIndex: 1500, background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', fontFamily: 'monospace',
        ...(isMobile
          ? { inset: 0, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }
          : { top: 0, right: 0, bottom: 0, width: wide ? 'min(960px, 100vw)' : 'min(460px, 100vw)', borderLeft: '1px solid var(--accent-purple)', boxShadow: '-8px 0 24px rgba(0,0,0,0.4)' }),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderBottom: '1px solid var(--border-secondary)' }}>
        {left}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <GlowText color="var(--accent-purple)" size="0.95rem">{title}</GlowText>
        </div>
        {right}
        <button type="button" onClick={onClose} aria-label={label} style={btn()}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', boxSizing: 'border-box' }}>{children}</div>
    </aside>
  );
}

export default function SheetsPanel({ wave, table, participants, currentUser, fetchAPI, e2ee, isMobile, showToast, onRoll, onClose, initialSheetId = null }) {
  const [openId, setOpenId] = useState(initialSheetId);
  const names = useMemo(() => Object.fromEntries((participants || []).map(p => [p.id, plainText(p.name || p.handle || '')])), [participants]);
  if (openId) {
    return (
      <OpenSheet
        key={openId} sheetId={openId} wave={wave} table={table} names={names} fetchAPI={fetchAPI} e2ee={e2ee} isMobile={isMobile}
        showToast={showToast} onRoll={onRoll} onClose={onClose} onBack={() => setOpenId(null)} currentUser={currentUser}
      />
    );
  }
  return (
    <SheetList wave={wave} table={table} names={names} fetchAPI={fetchAPI} e2ee={e2ee} isMobile={isMobile} showToast={showToast}
      currentUser={currentUser} onOpen={setOpenId} onClose={onClose} />
  );
}

function SheetList({ wave, table, names, fetchAPI, e2ee, isMobile, showToast, currentUser, onOpen, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef(null);
  const e2eeRef = useRef(e2ee);
  e2eeRef.current = e2ee;

  const load = useCallback(async () => {
    try {
      const sheets = await listSheets(fetchAPI, wave.id);
      const opened = await Promise.all(sheets.map(async (s) => {
        try { const d = await openSheet(e2eeRef.current, wave.id, s); return { ...s, name: d.name, summary: summary(d) }; }
        catch (err) { return { ...s, name: null, locked: !!err.locked }; }
      }));
      setRows(opened); setError(null);
    } catch (err) { setError(err.message || 'Could not load sheets'); }
  }, [fetchAPI, wave.id, e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => onSheetUpdated(({ waveId }) => { if (waveId === wave.id) load(); }), [wave.id, load]);

  const importJson = async (file) => {
    try {
      if (file.size > 120 * 1024) throw new Error('That file is too large for a sheet');
      const parsed = JSON.parse(await file.text());
      const data = parsed?.sheet && parsed?.system ? parsed.sheet : parsed;
      const system = parsed?.system || data?.system;
      if (!data || typeof data !== 'object' || !(isDnd5e(system) || system === 'generic')) throw new Error('That isn\'t a Cortex character sheet');
      const sheet = await createSheet(fetchAPI, e2ee, wave, { system, visibility: 'table', data: { ...(system === 'generic' ? blankGenericSheet() : blankSheet('', system)), ...data, system } });
      showToast?.('Sheet imported', 'success');
      onOpen(sheet.id);
    } catch (err) { showToast?.(err.message || 'Could not import that sheet', 'error'); }
  };

  const mine = (rows || []).filter(r => r.ownerId === currentUser?.id);
  const others = (rows || []).filter(r => r.ownerId !== currentUser?.id);
  const row = (r) => (
    <button key={r.id} type="button" onClick={() => onOpen(r.id)}
      style={{ ...box, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', width: '100%', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
      <span style={{ fontSize: '0.95rem' }}>{r.name ? plainText(r.name) || 'Unnamed' : (r.locked ? '🔒 Unlock encryption to read' : 'Can\'t be read')}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>
        {r.summary ? `${r.summary} · ` : ''}{r.ownerId === currentUser?.id ? 'you' : (names[r.ownerId] || 'someone')}
        {r.visibility === 'gm' ? ' · GMs only' : ''}
      </span>
    </button>
  );

  return (
    <Frame isMobile={isMobile} onClose={onClose} title="Character sheets">
      {error && <div style={{ color: 'var(--accent-orange)', marginBottom: '8px' }}>{error}</div>}
      {!rows && !error && <div style={{ color: 'var(--text-dim)' }}>Loading…</div>}
      {rows && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={labelStyle}>YOURS</div>
          {mine.length ? mine.map(row) : <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>You have no sheet at this table yet.</div>}
          {creating
            ? <NewSheet table={table} wave={wave} fetchAPI={fetchAPI} e2ee={e2ee} showToast={showToast} onDone={(id) => { setCreating(false); if (id) onOpen(id); }} />
            : (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setCreating(true)} style={btn(true)}>+ New sheet</button>
                <button type="button" onClick={() => fileRef.current?.click()} style={btn()}>Import JSON</button>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); }} />
              </div>
            )}
          {others.length > 0 && <div style={{ ...labelStyle, marginTop: '10px' }}>{table.isGm ? 'EVERYONE ELSE' : 'OTHERS AT THE TABLE'}</div>}
          {others.map(row)}
          {wave.encrypted && <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '10px' }}>🔒 Sheets in this wave are end-to-end encrypted; the server can't read them.</div>}
        </div>
      )}
    </Frame>
  );
}

function summary(d) {
  if (isDnd5e(d?.system)) {
    const classes = (d.classes || []).map(c => `${c.name} ${c.level}`).join(' / ');
    return [d.species, classes].filter(Boolean).join(' ');
  }
  return SYSTEM_LABELS.generic;
}

function NewSheet({ table, wave, fetchAPI, e2ee, showToast, onDone }) {
  const [name, setName] = useState('');
  const [system, setSystem] = useState(SYSTEM_LABELS[table.system] ? table.system : 'dnd5e-2024');
  const [visibility, setVisibility] = useState('table');
  const [preset, setPreset] = useState('blank');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const data = system === 'generic' ? blankGenericSheet(name.trim(), preset) : blankSheet(name.trim(), system);
      const sheet = await createSheet(fetchAPI, e2ee, wave, { system, visibility, data });
      onDone(sheet.id);
    } catch (err) { showToast?.(err.message || 'Could not make the sheet', 'error'); setBusy(false); }
  };
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div><div style={labelStyle}>CHARACTER NAME</div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} style={inputStyle} aria-label="Character name" /></div>
      <div><div style={labelStyle}>GAME</div>
        <select value={system} onChange={(e) => setSystem(e.target.value)} style={inputStyle} aria-label="Game">
          {Object.entries(SYSTEM_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></div>
      {system === 'generic' && (
        <div><div style={labelStyle}>START FROM</div>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={inputStyle} aria-label="Start from">
            {Object.entries(GENERIC_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select></div>
      )}
      <div><div style={labelStyle}>WHO CAN SEE IT</div>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={inputStyle} aria-label="Who can see it">
          {Object.entries(VIS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button type="button" disabled={busy} onClick={create} style={btn(true)}>{busy ? 'Making…' : 'Make sheet'}</button>
        <button type="button" onClick={() => onDone(null)} style={btn()}>Cancel</button>
      </div>
    </div>
  );
}

function OpenSheet({ sheetId, wave, table, names, fetchAPI, e2ee, isMobile, showToast, onRoll, onClose, onBack, currentUser }) {
  const { meta, data, error, saving, change } = useSheet({ fetchAPI, e2ee, wave, sheetId });
  const [menu, setMenu] = useState(false);
  const [last, setLast] = useState(null);
  const lastTimer = useRef(null);
  useEffect(() => () => clearTimeout(lastTimer.current), []);

  const roll = useCallback(async (expression, label) => {
    const r = await onRoll({ expression, label });
    if (r) {
      setLast({ label, roll: r });
      clearTimeout(lastTimer.current);
      lastTimer.current = setTimeout(() => setLast(null), 8000);
    }
    return r;
  }, [onRoll]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ format: 'cortex-sheet', version: 1, system: meta.system, sheet: data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(data.name || 'character').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'character'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const setVisibility = async (visibility) => {
    setMenu(false);
    change(() => {}, { now: true, visibility });
  };

  const remove = async () => {
    setMenu(false);
    if (!window.confirm(`Delete ${data?.name || 'this sheet'}? This can't be undone.`)) return;
    try { await deleteSheet(fetchAPI, wave.id, sheetId); onBack(); } catch (err) { showToast?.(err.message || 'Could not delete', 'error'); }
  };

  const title = data ? (plainText(data.name || '') || 'Unnamed') : 'Character sheet';
  const owner = meta && meta.ownerId !== currentUser?.id ? names[meta.ownerId] : null;
  return (
    <Frame
      isMobile={isMobile} onClose={onClose} title={title}
      left={<button type="button" onClick={onBack} aria-label="All sheets" style={btn()}>◀</button>}
      right={meta && (
        <span style={{ position: 'relative' }}>
          {saving && <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginRight: '6px' }}>saving…</span>}
          <button type="button" onClick={() => setMenu(m => !m)} aria-label="Sheet menu" aria-expanded={menu} style={btn()}>⋮</button>
          {menu && (
            <div role="menu" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)', minWidth: '210px' }}>
              <MenuItem onClick={() => { setMenu(false); exportJson(); }}>Export JSON</MenuItem>
              {meta.isOwner && Object.entries(VIS_LABELS).map(([k, l]) => (
                <MenuItem key={k} onClick={() => setVisibility(k)}>{meta.visibility === k ? '● ' : '○ '}{l}</MenuItem>
              ))}
              {meta.canEdit && <MenuItem onClick={remove} danger>Delete sheet</MenuItem>}
            </div>
          )}
        </span>
      )}
    >
      {owner && <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginBottom: '6px' }}>{owner}'s character{meta.canEdit ? ' · you can change it as GM' : ''}</div>}
      {error === 'locked' && <div style={{ color: 'var(--text-dim)' }}>🔒 Unlock encryption to read this sheet.</div>}
      {error && error !== 'locked' && <div style={{ color: 'var(--accent-orange)', marginBottom: '8px' }}>{error}</div>}
      {!data && !error && <div style={{ color: 'var(--text-dim)' }}>Loading…</div>}
      {data && isDnd5e(meta.system) && <Dnd5eSheet data={data} canEdit={meta.canEdit} change={change} roll={roll} isMobile={isMobile} />}
      {data && meta.system === 'generic' && <GenericSheet data={data} canEdit={meta.canEdit} change={change} roll={roll} showToast={showToast} />}
      {last && (
        <div role="status" style={{ position: 'sticky', bottom: 0, marginTop: '10px', ...box, borderColor: 'var(--accent-amber)', display: 'flex', gap: '10px', alignItems: 'baseline' }}>
          <span style={{ fontSize: '1.4rem', color: 'var(--accent-amber)', fontWeight: 700 }}>{last.roll.hidden ? '?' : last.roll.total}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', minWidth: 0 }}>{plainText(last.label)} · {last.roll.expression}</span>
        </div>
      )}
    </Frame>
  );
}

const MenuItem = ({ onClick, children, danger }) => (
  <button type="button" role="menuitem" onClick={onClick}
    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', border: 'none', color: danger ? 'var(--accent-orange)' : 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.8rem', cursor: 'pointer' }}>
    {children}
  </button>
);
