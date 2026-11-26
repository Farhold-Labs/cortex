import React from 'react';
import { newId } from '../../ttrpg/dnd5e2024.js';
import { fillRoll } from '../../ttrpg/generic.js';
import { btn, rollBtn, labelStyle, sectionTitle, Field, Counter, ListRows } from './sheetUi.jsx';

/**
 * A sheet for any game (v2.159.0): fields, resources and roll buttons the
 * player makes. A roll button's dice can name a field: `1d20+{Agility}`.
 */
export default function GenericSheet({ data, canEdit, change, roll, showToast }) {
  const set = (fn) => change(fn);
  const now = (fn) => change(fn, { now: true });
  const name = data.name || 'Unnamed';

  const rollButton = (r) => {
    const filled = fillRoll(r.expression, data);
    if (filled.error) { showToast?.(filled.error, 'error'); return; }
    roll(filled.expression, `${name}: ${r.label || 'Roll'}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'monospace', fontSize: '0.82rem' }}>
      <div>
        <div style={labelStyle}>NAME</div>
        <Field disabled={!canEdit} value={data.name} onChange={(v) => set(s => { s.name = v.slice(0, 60); })} />
      </div>

      <div style={sectionTitle}>ROLLS</div>
      <ListRows
        items={data.rolls || []} canEdit={canEdit} addLabel="Roll" empty="No roll buttons yet."
        onAdd={() => now(s => { s.rolls = [...(s.rolls || []), { id: newId(), label: '', expression: '1d20' }]; })}
        onRemove={(i) => now(s => { s.rolls = s.rolls.filter((_, j) => j !== i); })}
        render={(r, i) => (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {canEdit ? (
              <>
                <div style={{ flex: '1 1 100px' }}><Field ariaLabel="Label" placeholder="Label" value={r.label} onChange={(v) => set(s => { s.rolls[i].label = v.slice(0, 60); })} /></div>
                <div style={{ flex: '1 1 120px' }}><Field ariaLabel="Dice" placeholder="1d20+{Agility}" value={r.expression} onChange={(v) => set(s => { s.rolls[i].expression = v.slice(0, 100); })} /></div>
              </>
            ) : <span style={{ flex: 1 }}>{r.label || 'Roll'} <span style={{ color: 'var(--text-dim)' }}>{r.expression}</span></span>}
            <button type="button" onClick={() => rollButton(r)} style={rollBtn}>Roll</button>
          </div>
        )}
      />
      {canEdit && <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Put a field's name in braces to use its number: 1d20+{'{'}Agility{'}'}.</div>}

      <div style={sectionTitle}>RESOURCES</div>
      <ListRows
        items={data.resources || []} canEdit={canEdit} addLabel="Resource" empty="No resources."
        onAdd={() => now(s => { s.resources = [...(s.resources || []), { id: newId(), name: '', current: 1, max: 1, reset: 'none' }]; })}
        onRemove={(i) => now(s => { s.resources = s.resources.filter((_, j) => j !== i); })}
        render={(r, i) => (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 100px' }}><Field disabled={!canEdit} ariaLabel="Name" placeholder="Name" value={r.name} onChange={(v) => set(s => { s.resources[i].name = v.slice(0, 60); })} /></div>
            <Counter label={r.name || 'Resource'} value={r.current} max={r.max} disabled={!canEdit} onChange={(v) => now(s => { s.resources[i].current = v; })} />
            {canEdit && <>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>max</span>
              <Field type="number" ariaLabel="Maximum" value={r.max} onChange={(v) => set(s => { s.resources[i].max = Math.max(0, v); })} style={{ width: '4.5em' }} />
              <button type="button" onClick={() => now(s => { s.resources[i].current = s.resources[i].max; })} style={{ ...btn(), minHeight: '28px', padding: '2px 8px' }}>Fill</button>
            </>}
          </div>
        )}
      />

      <div style={sectionTitle}>FIELDS</div>
      <ListRows
        items={data.fields || []} canEdit={canEdit} addLabel="Field" empty="No fields."
        onAdd={() => now(s => { s.fields = [...(s.fields || []), { id: newId(), label: '', value: '' }]; })}
        onRemove={(i) => now(s => { s.fields = s.fields.filter((_, j) => j !== i); })}
        render={(f, i) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: '6px' }}>
            <Field disabled={!canEdit} ariaLabel="Field name" placeholder="Name" value={f.label} onChange={(v) => set(s => { s.fields[i].label = v.slice(0, 40); })} />
            <Field disabled={!canEdit} ariaLabel={f.label || 'Value'} placeholder="Value" value={f.value} onChange={(v) => set(s => { s.fields[i].value = v.slice(0, 500); })} />
          </div>
        )}
      />

      <div style={sectionTitle}>NOTES</div>
      <Field multiline rows={8} disabled={!canEdit} ariaLabel="Notes" value={data.notes} onChange={(v) => set(s => { s.notes = v.slice(0, 20000); })} />
    </div>
  );
}
