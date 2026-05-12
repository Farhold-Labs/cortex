// Each entry: [primaryName, ...aliases, unicodeChar]
// Last element is always the emoji character; everything before it is a searchable name.
const EMOJI_DATA = [
  // Faces
  ['smile', '😄'], ['grin', '😁'], ['joy', '😂'], ['rofl', '🤣'], ['lol', '😆'],
  ['wink', '😉'], ['blush', '😊'], ['heart_eyes', '😍'], ['kissing_heart', '😘'],
  ['yum', '😋'], ['sunglasses', '😎'], ['thinking', '🤔'], ['neutral', '😐'],
  ['unamused', '😒'], ['rolling_eyes', '🙄'], ['smirk', '😏'], ['flushed', '😳'],
  ['disappointed', '😞'], ['worried', '😟'], ['angry', '😠'], ['rage', '😡'],
  ['cry', '😢'], ['sob', '😭'], ['fearful', '😨'], ['cold_sweat', '😰'],
  ['open_mouth', '😮'], ['astonished', '😲'], ['dizzy_face', '😵'],
  ['exploding_head', '🤯'], ['monocle', '🧐'], ['nerd', '🤓'],
  ['partying', '🥳'], ['star_struck', '🤩'], ['shushing', '🤫'],
  ['pleading', '🥺'], ['hot_face', '🥵'], ['cold_face', '🥶'],
  ['nauseated', '🤢'], ['sneezing', '🤧'], ['yawning', '🥱'], ['sleeping', '😴'],
  ['zany', '🤪'], ['pensive', '😔'], ['relieved', '😌'],
  ['upside_down', '🙃'], ['sweat_smile', '😅'], ['woozy', '🥴'],
  ['money_mouth', '🤑'], ['mask', '😷'], ['skull', '💀'],
  ['ghost', '👻'], ['alien', '👽'], ['robot', '🤖'], ['poop', '💩'],
  ['clown', '🤡'], ['devil', '😈'],

  // Hands / gestures
  ['thumbsup', '+1', '👍'], ['thumbsdown', '-1', '👎'],
  ['ok_hand', '👌'], ['fingers_crossed', '🤞'], ['peace', '✌️'],
  ['wave', '👋'], ['raised_hand', '✋'], ['clap', '👏'], ['pray', '🙏'],
  ['point_up', '☝️'], ['point_right', '👉'], ['point_left', '👈'],
  ['muscle', '💪'], ['fist', '✊'], ['punch', '👊'],
  ['vulcan', '🖖'], ['call_me', '🤙'], ['raised_hands', '🙌'],

  // Hearts
  ['heart', '❤️'], ['orange_heart', '🧡'], ['yellow_heart', '💛'],
  ['green_heart', '💚'], ['blue_heart', '💙'], ['purple_heart', '💜'],
  ['black_heart', '🖤'], ['white_heart', '🤍'], ['broken_heart', '💔'],
  ['sparkling_heart', '💖'], ['two_hearts', '💕'],

  // Common symbols
  ['fire', '🔥'], ['100', '💯'], ['tada', '🎉'], ['sparkles', '✨'],
  ['star', '⭐'], ['star2', '🌟'], ['boom', '💥'], ['ocean', '🌊'],
  ['zap', '⚡'], ['snowflake', '❄️'], ['rainbow', '🌈'], ['sunny', '☀️'],
  ['moon', '🌙'], ['coffee', '☕'], ['pizza', '🍕'], ['beer', '🍺'],
  ['wine', '🍷'], ['champagne', '🍾'], ['cake', '🎂'],
  ['trophy', '🏆'], ['medal', '🥇'], ['rocket', '🚀'], ['eyes', '👀'],
  ['check', '✅'], ['x', '❌'], ['warning', '⚠️'], ['stop', '🛑'],
  ['question', '❓'], ['exclamation', '❗'], ['lock', '🔒'], ['key', '🔑'],
  ['bell', '🔔'], ['pin', '📌'], ['link', '🔗'],
  ['pencil', '✏️'], ['book', '📖'], ['calendar', '📅'], ['clock', '🕐'],
  ['hourglass', '⏳'], ['search', '🔍'], ['bulb', '💡'], ['money', '💰'],
  ['gem', '💎'], ['gift', '🎁'], ['balloon', '🎈'], ['music', '🎵'],
  ['microphone', '🎤'], ['camera', '📷'], ['phone', '📞'],
  ['laptop', '💻'], ['email', '📧'], ['package', '📦'],
  ['hammer', '🔨'], ['wrench', '🔧'], ['gear', '⚙️'], ['globe', '🌍'],
  ['recycle', '♻️'], ['flag', '🚩'],

  // Animals
  ['dog', '🐶'], ['cat', '🐱'], ['fox', '🦊'], ['bear', '🐻'],
  ['panda', '🐼'], ['tiger', '🐯'], ['lion', '🦁'], ['pig', '🐷'],
  ['frog', '🐸'], ['monkey', '🐵'], ['penguin', '🐧'], ['duck', '🦆'],
  ['eagle', '🦅'], ['owl', '🦉'], ['whale', '🐳'], ['shark', '🦈'],
  ['snake', '🐍'], ['dragon', '🐲'], ['unicorn', '🦄'], ['bee', '🐝'],
  ['butterfly', '🦋'], ['turtle', '🐢'], ['rabbit', '🐰'],
  ['mushroom', '🍄'], ['sunflower', '🌻'], ['rose', '🌹'],
  ['tulip', '🌷'], ['leaves', '🍃'],

  // Food
  ['apple', '🍎'], ['grapes', '🍇'], ['watermelon', '🍉'], ['banana', '🍌'],
  ['strawberry', '🍓'], ['cherry', '🍒'], ['avocado', '🥑'],
  ['pizza', '🍕'], ['burger', '🍔'], ['fries', '🍟'], ['taco', '🌮'],
  ['sushi', '🍣'], ['ramen', '🍜'], ['cake', '🎂'],
  ['donut', '🍩'], ['cookie', '🍪'], ['chocolate', '🍫'],
  ['popcorn', '🍿'], ['tea', '🍵'], ['boba', '🧋'],
];

const EMOJI_MAP = new Map();
export const EMOJI_LIST = [];

for (const entry of EMOJI_DATA) {
  const char = entry[entry.length - 1];
  const primaryName = entry[0];
  for (let i = 0; i < entry.length - 1; i++) {
    EMOJI_MAP.set(entry[i], char);
  }
  if (!EMOJI_LIST.find(e => e.char === char)) {
    EMOJI_LIST.push({ name: primaryName, char });
  }
}

export function searchEmoji(query) {
  if (!query) return EMOJI_LIST.slice(0, 20);
  const q = query.toLowerCase();
  return EMOJI_LIST.filter(e => e.name.includes(q)).slice(0, 20);
}

export function resolveEmojiShortcodes(text) {
  return text.replace(/:([a-z0-9_+\-]+):/gi, (match, code) => {
    return EMOJI_MAP.get(code.toLowerCase()) || match;
  });
}
