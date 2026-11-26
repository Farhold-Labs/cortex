import React, { useEffect, useState } from 'react';

/** Small pieces the sheets share (v2.159.0). */

export function btn(active = false, color = 'var(--accent-purple)') {
  return {
    padding: '6px 10px', minHeight: '36px', background: active ? color : 'transparent', color: active ? 'var(--bg-base)' : 'var(--text-primary)',
    border: `1px solid ${active ? color : 'var(--border-primary)'}`, cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.78rem',
  };
}
export const rollBtn = {
  ...btn(), minHeight: '32px', padding: '4px 8px', color: 'var(--accent-amber)', borderColor: 'var(--border-secondary)', whiteSpace: 'nowrap',
};
export const labelStyle = { display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem', letterSpacing: '0.05em', marginBottom: '4px' };
export const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'var(--bg-base)', color: 'var(--text-primary)',
  border: '1px solid var(--border-primary)', fontFamily: 'monospace', fontSize: '0.85rem', minWidth: 0,
};
export const box = { border: '1px solid var(--border-secondary)', background: 'var(--bg-elevated)', padding: '8px 10px' };
export const sectionTitle = { color: 'var(--accent-purple)', fontSize: '0.72rem', letterSpacing: '0.08em', margin: '14px 0 6px' };

/**
 * An input that edits locally and reports each change; the sheet saves after
 * a pause. It follows the value from outside unless it has focus.
 */
export function Field({ value, onChange, type = 'text', disabled, placeholder, style, multiline, rows = 4, ariaLabel, min, max }) {
  const [local, setLocal] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setLocal(value ?? ''); }, [value, focused]);
  const common = {
    value: local, disabled, placeholder, 'aria-label': ariaLabel,
    onFocus: () => setFocused(true), onBlur: () => setFocused(false),
    onChange: (e) => {
      setLocal(e.target.value);
      if (type === 'number') {
        if (e.target.value === '' || e.target.value === '-') return;
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      } else onChange(e.target.value);
    },
    style: { ...inputStyle, ...(multiline ? { resize: 'vertical', fontFamily: 'var(--app-font, monospace)' } : {}), ...style },
  };
  if (multiline) return <textarea rows={rows} {...common} />;
  return <input type={type === 'number' ? 'number' : 'text'} inputMode={type === 'number' ? 'numeric' : undefined} min={min} max={max} {...common} />;
}

/** current / max, with − and + */
export function Counter({ value, max, onChange, disabled, label }) {
  const v = Number(value) || 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <button type="button" disabled={disabled || v <= 0} aria-label={`${label}: one less`} onClick={() => onChange(v - 1)} style={{ ...btn(), minHeight: '28px', padding: '2px 8px' }}>−</button>
      <span style={{ minWidth: '3.2em', textAlign: 'center', color: 'var(--text-primary)' }}>{v}{max != null ? ` / ${max}` : ''}</span>
      <button type="button" disabled={disabled || (max != null && v >= max)} aria-label={`${label}: one more`} onClick={() => onChange(v + 1)} style={{ ...btn(), minHeight: '28px', padding: '2px 8px' }}>+</button>
    </span>
  );
}

/** Filled and empty pips, for spell slots and death saves: tap to use or restore one. */
export function Pips({ total, used, onChange, disabled, color = 'var(--accent-purple)', label }) {
  return (
    <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }} aria-label={`${label}: ${total - used} of ${total} left`}>
      {Array.from({ length: total }, (_, i) => {
        const spent = i >= total - used;
        return (
          <button
            key={i} type="button" disabled={disabled}
            aria-label={spent ? `${label}: restore one` : `${label}: use one`}
            onClick={() => onChange(spent ? used - 1 : used + 1)}
            style={{ width: '18px', height: '18px', borderRadius: '50%', border: `1px solid ${color}`, background: spent ? 'transparent' : color, cursor: disabled ? 'default' : 'pointer', padding: 0 }}
          />
        );
      })}
    </span>
  );
}

/** A list editor: rows, each removable, and an add button. */
export function ListRows({ items, onAdd, onRemove, addLabel, canEdit, render, empty }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {!items.length && <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>{empty}</div>}
      {items.map((item, i) => (
        <div key={item.id || i} style={{ ...box, display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{render(item, i)}</div>
          {canEdit && <button type="button" onClick={() => onRemove(i)} aria-label="Remove" style={{ ...btn(), minHeight: '28px', padding: '2px 8px', color: 'var(--text-dim)' }}>✕</button>}
        </div>
      ))}
      {canEdit && <button type="button" onClick={onAdd} style={{ ...btn(), alignSelf: 'flex-start' }}>+ {addLabel}</button>}
    </div>
  );
}
