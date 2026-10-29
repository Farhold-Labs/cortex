import React from 'react';

/**
 * Alert priority icons, drawn as SVG (v2.122.3).
 *
 * These were the emoji 🚨 ⚠️ ℹ️ 🎉, which depend on the system's emoji font:
 * without one they show as boxes, and with one they come out in the font's
 * own colours instead of the alert's. Drawn, they take the priority colour
 * (`color`, default currentColor) and look the same everywhere.
 */
const Svg = ({ size, children, style, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : 'true'}
    aria-label={title}
    focusable="false"
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, overflow: 'visible', ...style }}
  >
    {children}
  </svg>
);

/** A beacon with light rays. */
const Critical = ({ color }) => (
  <>
    <path fill={color} d="M9 24v-8a7 7 0 0 1 14 0v8z" />
    <rect x="6" y="24" width="20" height="4" rx="1" fill={color} />
    <path d="M13 17.5a3 3 0 0 1 3-3" stroke="rgba(255,255,255,0.75)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <g stroke={color} strokeWidth="2" strokeLinecap="round">
      <path d="M16 2.5v3.5M5.5 6.5l2.5 2.5M26.5 6.5L24 9M2 15h3.5M30 15h-3.5" />
    </g>
  </>
);

const Warning = ({ color }) => (
  <>
    <path d="M16 3.5L29.5 27.5h-27z" fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M16 11.5v8" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
    <circle cx="16" cy="23.6" r="1.7" fill={color} />
  </>
);

const Info = ({ color }) => (
  <>
    <circle cx="16" cy="16" r="13" fill="none" stroke={color} strokeWidth="2.4" />
    <circle cx="16" cy="9.6" r="1.9" fill={color} />
    <path d="M16 14.5v9.5" stroke={color} strokeWidth="3" strokeLinecap="round" />
  </>
);

/** A party popper: cone, burst lines and confetti. Confetti keeps its own colours. */
const Celebration = ({ color }) => (
  <>
    <path fill={color} d="M3 29l6.5-17.5 11 11z" />
    <path d="M6.2 20.4l5.4 5.4M8.4 14.6l9 9" stroke="rgba(0,0,0,0.3)" strokeWidth="1.4" />
    <g stroke={color} strokeWidth="1.8" strokeLinecap="round" fill="none">
      <path d="M15 9.5c1-3 .2-5 -1.5-6.5" />
      <path d="M22.5 17c3-1 5-.2 6.5 1.5" />
      <path d="M18.5 13.5L26 6" />
    </g>
    <circle cx="20" cy="4.5" r="1.4" fill="#FFD23F" />
    <circle cx="27.5" cy="12" r="1.4" fill="#3BA7FF" />
    <rect x="23" y="1.5" width="2.4" height="2.4" fill="#FF3B7F" transform="rotate(25 24.2 2.7)" />
    <rect x="28" y="22" width="2.4" height="2.4" fill="#0EAD69" transform="rotate(-20 29.2 23.2)" />
  </>
);

const SHAPES = { critical: Critical, warning: Warning, info: Info, celebration: Celebration };

const AlertPriorityIcon = ({ priority, size = '1em', color = 'currentColor', title, style }) => {
  const Shape = SHAPES[priority] || Info;
  return <Svg size={size} title={title} style={style}><Shape color={color} /></Svg>;
};

export default AlertPriorityIcon;
