import React from 'react';
import {
  Firework, Heart, Shamrock, Egg, Flag, Pumpkin, Turkey, ChristmasTree, Menorah,
} from './glyphs.jsx';

/**
 * The picture beside a holiday's crawl-bar alert (v2.122.2).
 *
 * The server used to start these alert titles with an emoji (🎃, 🎄, 🕎…),
 * which only showed on systems with a colour emoji font; elsewhere it was a
 * box. The crawl bar also asked for /holidays/<id>.png, which exists only for
 * ElderXeke. Now every holiday gets a drawn shape, and ElderXeke keeps its
 * picture.
 */
const SHAPES = {
  newYear: (size) => <Firework size={size} color="#FFD700" />,
  valentines: (size) => <Heart size={size} color="#FF1493" />,
  stPatricks: (size) => <Shamrock size={size} color="#32CD32" />,
  easter: (size) => <Egg size={size} color="#DDA0DD" />,
  independenceDay: (size) => <Flag size={size} />,
  halloween: (size) => <Pumpkin size={size} />,
  thanksgiving: (size) => <Turkey size={size} />,
  christmas: (size) => <ChristmasTree size={size} />,
  hanukkah: (size) => <Menorah size={size} />,
};

/** Title words that identify each holiday; the server writes "<name> celebration is active!". */
const TITLE_NAMES = [
  ['new year', 'newYear'], ['valentine', 'valentines'], ['elderxeke', 'elderxeke'],
  ['patrick', 'stPatricks'], ['easter', 'easter'], ['independence', 'independenceDay'],
  ['halloween', 'halloween'], ['thanksgiving', 'thanksgiving'], ['christmas', 'christmas'],
  ['hanukkah', 'hanukkah'],
];

export function holidayFromAlertTitle(title = '') {
  const lower = title.toLowerCase();
  return TITLE_NAMES.find(([name]) => lower.includes(name))?.[1] || null;
}

/**
 * Drops the emoji older servers put in front of the title. Alerts already in
 * a database, or arriving from a node not yet upgraded, still carry it.
 */
export function withoutLeadingEmoji(title = '') {
  return title.replace(/^[\p{Extended_Pictographic}\p{Regional_Indicator}️‍\s]+/u, '');
}

const HolidayIcon = ({ holiday, size = 18, style }) => {
  const box = { display: 'inline-flex', verticalAlign: 'middle', flexShrink: 0, ...style };
  if (holiday === 'elderxeke') {
    return (
      <img
        src="/holidays/elderxeke.png"
        alt=""
        style={{ height: size, width: 'auto', ...box }}
        onError={(e) => { e.target.style.display = 'none'; }}
      />
    );
  }
  const draw = SHAPES[holiday];
  return draw ? <span style={box}>{draw(size)}</span> : null;
};

export default HolidayIcon;
