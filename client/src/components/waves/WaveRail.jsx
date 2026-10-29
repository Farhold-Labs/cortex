import React, { useState, useEffect } from 'react';
import { BASE_URL } from '../../config/constants.js';
import { initialsFor, UNCATEGORIZED_ID } from '../../utils/waveGroups.js';
import { plainText } from '../../utils/plainText.js';
import { T } from '../../config/terminology.js';

/**
 * A Community's logo, or two letters (v2.125.0). Used on the rail, on the
 * Community rows in the home panel and in a panel's header, so a Community
 * looks the same everywhere it appears.
 */
export const ContainerTile = ({ name, logoUrl: rawLogo, color = 'var(--accent-amber)', size = 40, active = false, title }) => {
  const label = plainText(name || '');
  // Like Avatar: uploads live on the API host, and a logo that fails to load
  // falls back to the initials rather than a broken image.
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [rawLogo]);
  const logoUrl = rawLogo && !failed ? (/^https?:/i.test(rawLogo) ? rawLogo : `${BASE_URL}${rawLogo}`) : null;
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      style={{
        width: size, height: size, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: Math.round(size * 0.22),
        overflow: 'hidden',
        // color-mix, not a hex alpha suffix: `color` is usually a CSS variable,
        // and "var(--x)22" is not a colour.
        background: logoUrl ? 'var(--bg-base)' : `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `${active ? 2 : 1}px solid ${active ? color : `color-mix(in srgb, ${color} 45%, transparent)`}`,
        color, fontFamily: 'monospace', fontWeight: 700,
        fontSize: Math.max(10, Math.round(size * 0.36)), letterSpacing: '0.02em',
        boxSizing: 'border-box',
      }}
    >
      {logoUrl
        ? <img src={logoUrl} alt="" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initialsFor(label)}
    </span>
  );
};

const Dot = ({ color, label, glyph }) => (
  <span aria-label={label} style={{
    position: 'absolute', top: 2, right: 2,
    minWidth: glyph ? 14 : 9, height: glyph ? 14 : 9, borderRadius: 7,
    background: glyph ? 'var(--bg-elevated)' : color,
    border: `1px solid ${glyph ? 'var(--border-primary)' : 'var(--bg-surface)'}`,
    fontSize: '0.55rem', lineHeight: '12px', textAlign: 'center',
  }}>{glyph}</span>
);

/**
 * The desktop rail (v2.125.0).
 *
 * Shown while a Community or category is open beside it, in place of the full
 * home panel. It is a navigator for everything the home panel lists:
 *
 *   ⌂ · Communities · ── · pinned waves · categories (or waves, for someone
 *   who has no categories)
 *
 * A Community or category tile opens its panel; a wave tile opens the wave and
 * leaves the panel alone. It scrolls and is never capped: forty uncategorized
 * waves make forty tiles, and the cure for that is categories.
 */
const WaveRail = ({
  communities = [], communityUnread = {}, communityVoice = {},
  categories = [], categoryUnread = {}, uncategorized = [], pinned = [], looseWaves = null,
  waveNotifications = {}, openContainer, selectedWaveId, onHome, onOpen, onSelectWave,
}) => {
  const isOpen = (kind, id) => openContainer?.kind === kind && openContainer?.id === id;

  const tile = ({ key, label, onClick, content, active, unread, voice }) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={`${label}${unread ? `, ${unread} unread` : ''}`}
      aria-current={active ? 'true' : undefined}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', padding: '4px 0', background: 'transparent', border: 'none', cursor: 'pointer',
        borderLeft: `3px solid ${active ? 'var(--accent-amber)' : 'transparent'}`,
      }}
    >
      {content}
      {voice ? <Dot glyph="🔊" label="people in voice" /> : unread > 0 ? <Dot color="var(--accent-amber)" label="unread" /> : null}
    </button>
  );

  const waveTile = (wave) => tile({
    key: `w:${wave.id}`,
    label: plainText(wave.title || ''),
    onClick: () => onSelectWave(wave),
    active: selectedWaveId === wave.id,
    unread: waveNotifications[wave.id]?.count || wave.unread_count || 0,
    content: <ContainerTile name={wave.title} color="var(--text-secondary)" size={34} active={selectedWaveId === wave.id} />,
  });

  return (
    <nav aria-label="Navigate" style={{
      width: 56, flexShrink: 0, height: '100%', overflowY: 'auto', overflowX: 'hidden',
      borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
      display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0',
      scrollbarWidth: 'none',
    }}>
      {tile({
        key: 'home', label: `Home: all communities and ${T.waves}`, onClick: onHome,
        content: (
          <span style={{
            width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-amber)', fontSize: '1.3rem', border: '1px solid var(--border-primary)', borderRadius: 9,
          }}>⌂</span>
        ),
      })}

      {communities.map(c => tile({
        key: `c:${c.id}`, label: plainText(c.name || ''),
        onClick: () => onOpen({ kind: 'community', id: c.id }),
        active: isOpen('community', c.id),
        unread: communityUnread[c.id] || 0,
        voice: communityVoice[c.id],
        content: <ContainerTile name={c.name} logoUrl={c.logoUrl} active={isOpen('community', c.id)} />,
      }))}

      <div role="separator" style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 10px' }} />

      {pinned.map(waveTile)}

      {looseWaves ? looseWaves.map(waveTile) : (
        <>
          {categories.map(cat => tile({
            key: `k:${cat.id}`, label: plainText(cat.name || ''),
            onClick: () => onOpen({ kind: 'category', id: cat.id }),
            active: isOpen('category', cat.id),
            unread: categoryUnread[cat.id] || 0,
            content: <ContainerTile name={cat.name} color={cat.color || 'var(--accent-teal)'} size={36} active={isOpen('category', cat.id)} />,
          }))}
          {uncategorized.length > 0 && tile({
            key: 'k:uncategorized', label: 'Uncategorized',
            onClick: () => onOpen({ kind: 'category', id: UNCATEGORIZED_ID }),
            active: isOpen('category', UNCATEGORIZED_ID),
            unread: categoryUnread[UNCATEGORIZED_ID] || 0,
            content: <ContainerTile name="Uncategorized" color="var(--text-dim)" size={36} active={isOpen('category', UNCATEGORIZED_ID)} />,
          })}
        </>
      )}
    </nav>
  );
};

export default WaveRail;
