import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listTableDocs, createTableDoc, deleteTableDoc, onTableDocUpdated, useTableDoc } from '../../utils/tableDocs.js';
import { plainText } from '../../utils/plainText.js';
import { btn, labelStyle, inputStyle, box, Field } from './sheetUi.jsx';
import { Frame } from './SheetsPanel.jsx';
import { EncounterTab } from './EncounterView.jsx';
import { MonsterLibrary } from './MonsterViews.jsx';

/**
 * The GM's screen (v2.160.0, docs/ttrpg/README.md phase 3). GMs get the
 * encounter, their monster stat blocks and their notes; players get the
 * encounter and the handouts the GMs have shared. The server decides who
 * reads what; this only lays it out.
 */
export default function GmPanel(props) {
  const { table, isMobile, onClose } = props;
  const isGm = !!table.isGm;
  const tabs = isGm ? [['encounter', 'Encounter'], ['monsters', 'Monsters'], ['notes', 'Notes']] : [['encounter', 'Encounter'], ['notes', 'Handouts']];
  const [tab, setTab] = useState('encounter');
  // The GM's own rolls from stat blocks: for the GMs (dice shown, result hidden) or for everyone.
  const [gmRollVisibility, setGmRollVisibility] = useState('gm');
  const shared = { ...props, isGm, gmRollVisibility };
  return (
    <Frame isMobile={isMobile} onClose={onClose} title={isGm ? 'GM screen' : 'Encounter and handouts'} label="Close the GM screen"
      right={isGm && (
        <select aria-label="Who sees the GM's rolls" value={gmRollVisibility} onChange={(e) => setGmRollVisibility(e.target.value)} style={{ ...inputStyle, width: 'auto', fontSize: '0.72rem', padding: '4px' }}>
          <option value="gm">My rolls: hidden</option>
          <option value="gm_secret">My rolls: secret</option>
          <option value="public">My rolls: public</option>
        </select>
      )}>
      <div role="tablist" style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ ...btn(tab === k), flex: 1 }}>{l}</button>)}
      </div>
      {tab === 'encounter' && <EncounterTab {...shared} />}
      {tab === 'monsters' && isGm && (
        <MonsterLibrary {...shared} roll={(expression, label) => props.roll({ expression, label, visibility: gmRollVisibility })} />
      )}
      {tab === 'notes' && <Notes {...shared} />}
    </Frame>
  );
}

function Notes({ wave, isGm, fetchAPI, e2ee, showToast, onShare }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [title, setTitle] = useState('');
  const e2eeRef = useRef(e2ee); e2eeRef.current = e2ee;
  const load = useCallback(async () => {
    try { setList(await listTableDocs(fetchAPI, e2eeRef.current, wave.id, 'note')); } catch { setList([]); }
  }, [fetchAPI, wave.id, e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => onTableDocUpdated(({ waveId, kind }) => { if (waveId === wave.id && kind === 'note') load(); }), [wave.id, load]);

  const create = async () => {
    try {
      const doc = await createTableDoc(fetchAPI, e2ee, wave, { kind: 'note', audience: 'gm', data: { schema: 1, title: title.trim() || 'Note', body: '' } });
      setTitle(''); setOpenId(doc.id);
    } catch (err) { showToast?.(err.message || 'Could not make the note', 'error'); }
  };

  if (openId) return <NoteView wave={wave} docId={openId} isGm={isGm} fetchAPI={fetchAPI} e2ee={e2ee} showToast={showToast} onShare={onShare} onBack={() => { setOpenId(null); load(); }} />;
  const notes = (list || []).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {isGm && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="Note title" aria-label="Note title" style={inputStyle} />
          <button type="button" onClick={create} style={{ ...btn(true), whiteSpace: 'nowrap' }}>+ New</button>
        </div>
      )}
      {isGm && <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>Notes are for the GMs. Share one and it becomes a handout everyone at the table can read.</div>}
      {!list && <div style={{ color: 'var(--text-dim)' }}>Loading…</div>}
      {list && !notes.length && <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{isGm ? 'No notes yet.' : 'No handouts yet.'}</div>}
      {notes.map(n => (
        <button key={n.id} type="button" onClick={() => setOpenId(n.id)}
          style={{ ...box, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'monospace', display: 'flex', gap: '8px' }}>
          <span style={{ flex: 1 }}>{n.body ? plainText(n.body.title || '') || 'Note' : '🔒 Unlock encryption to read'}</span>
          {isGm && <span style={{ color: n.audience === 'table' ? 'var(--accent-green)' : 'var(--text-dim)', fontSize: '0.7rem' }}>{n.audience === 'table' ? 'SHARED' : 'GMs ONLY'}</span>}
        </button>
      ))}
    </div>
  );
}

function NoteView({ wave, docId, isGm, fetchAPI, e2ee, showToast, onShare, onBack }) {
  const { meta, data, error, saving, change } = useTableDoc({ fetchAPI, e2ee, wave, docId, kind: 'note' });
  const set = (fn) => change(fn);
  const share = (audience) => {
    if (audience === 'table' && !window.confirm('Share this note with everyone at the table? It becomes a handout.')) return;
    change(() => {}, { now: true, audience });
    if (audience === 'table') onShare?.(`📜 New handout: ${data?.title || 'Note'}`);
  };
  const remove = async () => {
    if (!window.confirm('Delete this note?')) return;
    try { await deleteTableDoc(fetchAPI, wave.id, docId); onBack(); } catch (err) { showToast?.(err.message || 'Could not delete', 'error'); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={btn()} aria-label="All notes">◀</button>
        <span style={{ flex: 1 }} />
        {saving && <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>saving…</span>}
        {isGm && meta && (meta.audience === 'table'
          ? <button type="button" onClick={() => share('gm')} style={btn()}>Make GM-only again</button>
          : <button type="button" onClick={() => share('table')} style={btn(true)}>Share with the table</button>)}
        {isGm && <button type="button" onClick={remove} style={{ ...btn(), color: 'var(--accent-orange)' }}>Delete</button>}
      </div>
      {error && <div style={{ color: error === 'locked' ? 'var(--text-dim)' : 'var(--accent-orange)' }}>{error === 'locked' ? '🔒 Unlock encryption to read this.' : error}</div>}
      {data && (isGm ? (
        <>
          <div><div style={labelStyle}>TITLE</div><Field value={data.title} onChange={(v) => set(s => { s.title = v.slice(0, 80); })} /></div>
          <Field multiline rows={14} ariaLabel="Note" value={data.body} onChange={(v) => set(s => { s.body = v.slice(0, 50000); })} />
          {meta?.audience === 'table' && <div style={{ color: 'var(--accent-green)', fontSize: '0.72rem' }}>Shared: everyone at the table can read this.</div>}
        </>
      ) : (
        <div style={{ ...box }}>
          <div style={{ color: 'var(--accent-amber)', fontSize: '1rem', marginBottom: '8px' }}>{plainText(data.title || '')}</div>
          <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontFamily: 'var(--app-font, monospace)', lineHeight: 1.5 }}>{data.body}</div>
        </div>
      ))}
    </div>
  );
}
