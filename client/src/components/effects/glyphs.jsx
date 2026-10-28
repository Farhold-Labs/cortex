import React from 'react';

/**
 * Holiday effect shapes, drawn as SVG (v2.122.1).
 *
 * The effects used to draw characters with String.fromCharCode, e.g. 0x1F987.
 * fromCharCode only takes 16-bit values, so every emoji above U+FFFF was cut
 * to a different character: the bat became 驪 (U+F987) and the ghost, pumpkin
 * and leaf codes became private-use boxes. Characters below U+FFFF, such as
 * the shamrock and florettes, depended on fonts some systems lack.
 *
 * Drawn shapes look the same on every system and take the holiday's colours.
 * All of them share a 32×32 viewBox.
 */
const Svg = ({ size, children, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    aria-hidden="true"
    focusable="false"
    style={{ display: 'block', overflow: 'visible', ...style }}
  >
    {children}
  </svg>
);

export const Bat = ({ size, color = '#120818', style }) => (
  <Svg size={size} style={style}>
    <path
      fill={color}
      transform="translate(-4 -3.5) scale(1.25)"
      d="M16 11c-1 0-1.6.8-1.8 1.6L13.6 11l-.4 2.2C11 11.5 8 10.6 4.5 11.5c1.6 1.2 2.2 2.8 1.8 4.4 1.6-.6 3.2-.2 4.2 1 .4-1.2 1.6-1.8 2.8-1.4.4 1.6 1.4 3 2.7 4 1.3-1 2.3-2.4 2.7-4 1.2-.4 2.4.2 2.8 1.4 1-1.2 2.6-1.6 4.2-1-.4-1.6.2-3.2 1.8-4.4-3.5-.9-6.5 0-8.7 1.7l-.4-2.2-.6 1.6C17.6 11.8 17 11 16 11z"
    />
  </Svg>
);

export const Ghost = ({ size, color = '#F2F2F2', style }) => (
  <Svg size={size} style={style}>
    <path
      fill={color}
      stroke="rgba(0,0,0,0.25)"
      strokeWidth="0.6"
      d="M16 4C10.5 4 8 8.5 8 13v13l2.7-2.2 2.6 2.2 2.7-2.2 2.7 2.2 2.6-2.2L24 26V13c0-4.5-2.5-9-8-9z"
    />
    <ellipse cx="13" cy="13" rx="1.3" ry="1.8" fill="#1a1a1a" />
    <ellipse cx="19" cy="13" rx="1.3" ry="1.8" fill="#1a1a1a" />
    <ellipse cx="16" cy="18" rx="1.2" ry="1.6" fill="#1a1a1a" />
  </Svg>
);

export const Pumpkin = ({ size, color = '#FF6600', style }) => (
  <Svg size={size} style={style}>
    <path fill="#4a6b2a" d="M15 8c0-2 1-3.2 2.8-3.6l.6 1.2C17.2 6 17 7 17 8.2z" />
    <ellipse cx="11.2" cy="18.5" rx="6.2" ry="8" fill={color} />
    <ellipse cx="20.8" cy="18.5" rx="6.2" ry="8" fill={color} />
    <ellipse cx="16" cy="18.5" rx="6" ry="8.6" fill={color} />
    <path d="M16 10v17M11.6 11c-1.6 4-1.6 11 0 15M20.4 11c1.6 4 1.6 11 0 15" stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" fill="none" />
    <path fill="#FFD23F" d="M10.6 16.4l2.4-3.2 2.4 3.2zM16.6 16.4l2.4-3.2 2.4 3.2z" />
    <path fill="#FFD23F" d="M9.8 19.6l2 1.5 2.1-1.5 2.1 1.5 2.1-1.5 2.1 1.5 2-1.5c-.8 3.2-3.3 5-6.2 5s-5.4-1.8-6.2-5z" />
  </Svg>
);

/** A witch on a broomstick, flying to the right. */
export const Witch = ({ size, color = '#120818', style }) => (
  <Svg size={size} style={style}>
    <g fill={color}>
      <path d="M2 22.6L27 17.2l.3 1-25 5.4z" />
      <path d="M1 21l4.5.6.3 2-4.2 1.9.8-2.1-2.4.2 1.8-1.2z" />
      <path d="M14 11.5c-2 1.5-3.5 5-4.5 9.5l10-2c-.5-3-1.5-6-2.7-7.4z" />
      <path d="M13.6 12.4c-2.6.2-5.2 1.6-7.2 4.2 2.6-.8 4.6-.4 5.6.4z" />
      <path d="M16.5 13l4.5 4.8-1.2.6-4.2-4.2z" />
      <circle cx="15.8" cy="9.8" r="2" />
      <path d="M11.8 8.6l8.4-1.2.1 1-8.4 1.2z" />
      <path d="M13.5 8.4l5.1-.8c-1-2-2.4-4-5.6-5.2 1.4 1.8 1.2 4 .5 6z" />
    </g>
  </Svg>
);

export const MapleLeaf = ({ size, color = '#D2691E', style }) => (
  <Svg size={size} style={style}>
    <path
      fill={color}
      d="M16 2l2.2 4.6 2.6-1.2-.8 6.2 4.4-4 1 2.6 3.4-.6-1.6 4.4 2 1-6 5 1 2.6-6.2-.8-1.4 1.2V30h-1.2v-7L14 21.8l-6.2.8 1-2.6-6-5 2-1-1.6-4.4 3.4.6 1-2.6 4.4 4-.8-6.2 2.6 1.2z"
    />
  </Svg>
);

export const OakLeaf = ({ size, color = '#8B4513', style }) => (
  <Svg size={size} style={style}>
    <path
      fill={color}
      transform="translate(16 0) scale(1.35 1) translate(-16 0)"
      d="M16 2c2.5 1 3.5 3 2.6 4.6 2.9-.6 4 1.8 2.4 3.4 3-.2 4 2.6 1.6 4 2.8.4 3 3.4.2 4.2 1.6 1.8-.2 4.2-2.8 3.2-.4 2-2 2.8-3.4 2.6V30h-1.2v-6c-1.4.2-3-.6-3.4-2.6-2.6 1-4.4-1.4-2.8-3.2-2.8-.8-2.6-3.8.2-4.2-2.4-1.4-1.4-4.2 1.6-4-1.6-1.6-.5-4 2.4-3.4C12.5 5 13.5 3 16 2z"
    />
  </Svg>
);

export const Leaf = ({ size, color = '#DAA520', style }) => (
  <Svg size={size} style={style}>
    <path fill={color} d="M6 26C6 14 14 5 27 5c0 13-9 21-21 21z" />
    <path d="M4 28L20 12" stroke="rgba(0,0,0,0.3)" strokeWidth="1" fill="none" />
  </Svg>
);

export const Heart = ({ size, color = '#FF69B4', style }) => (
  <Svg size={size} style={style}>
    <path
      fill={color}
      d="M16 28S3 20 3 11.5C3 7.4 6.2 4.5 9.8 4.5c2.8 0 5 1.7 6.2 4.1 1.2-2.4 3.4-4.1 6.2-4.1 3.6 0 6.8 2.9 6.8 7C29 20 16 28 16 28z"
    />
  </Svg>
);

const SHAMROCK_LEAF = 'M0 0C-1-2-7-4-7-8.5-7-11-5-12.5-3.2-12.5c1.4 0 2.6.9 3.2 2.1.6-1.2 1.8-2.1 3.2-2.1C5-12.5 7-11 7-8.5 7-4 1-2 0 0z';

export const Shamrock = ({ size, color = '#00A86B', style }) => (
  <Svg size={size} style={style}>
    <path d="M16 15c.5 5 2 10 5 14" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    {[0, 120, 240].map((angle) => (
      <path key={angle} fill={color} d={SHAMROCK_LEAF} transform={`translate(16 15) rotate(${angle})`} />
    ))}
  </Svg>
);

export const Egg = ({ size, color = '#FFB6C1', style }) => (
  <Svg size={size} style={style}>
    <path fill={color} d="M16 3c-5.5 0-9 8.5-9 15 0 6 4 11 9 11s9-5 9-11c0-6.5-3.5-15-9-15z" />
    <path d="M7.6 17l2.8-2 2.8 2 2.8-2 2.8 2 2.8-2 2.8 2" stroke="rgba(255,255,255,0.85)" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
    <circle cx="12" cy="22.5" r="1.1" fill="rgba(255,255,255,0.85)" />
    <circle cx="16" cy="23.5" r="1.1" fill="rgba(255,255,255,0.85)" />
    <circle cx="20" cy="22.5" r="1.1" fill="rgba(255,255,255,0.85)" />
  </Svg>
);

export const Flower = ({ size, color = '#DDA0DD', style }) => (
  <Svg size={size} style={style}>
    {[0, 72, 144, 216, 288].map((angle) => (
      <ellipse key={angle} cx="16" cy="9" rx="4.2" ry="6" fill={color} transform={`rotate(${angle} 16 16)`} />
    ))}
    <circle cx="16" cy="16" r="3.6" fill="#FFE066" />
  </Svg>
);

export const Butterfly = ({ size, color = '#87CEEB', style }) => (
  <Svg size={size} style={style}>
    <g fill={color}>
      <path d="M16 15c-3-7-10-11-12.5-8C1.5 9.8 5 15 16 15z" />
      <path d="M16 16c-7 0-11 3-9.5 7C8 26.5 13 23 16 16z" />
      <path d="M16 15c3-7 10-11 12.5-8 2 2.8-1.5 8-12.5 8z" />
      <path d="M16 16c7 0 11 3 9.5 7-1.5 3.5-6.5 0-9.5-7z" />
    </g>
    <ellipse cx="16" cy="16" rx="1" ry="6" fill="#3a2a1a" />
    <path d="M15.6 10.4C15 8 13.6 6.4 12.4 6M16.4 10.4C17 8 18.4 6.4 19.6 6" stroke="#3a2a1a" strokeWidth="0.8" fill="none" strokeLinecap="round" />
  </Svg>
);
