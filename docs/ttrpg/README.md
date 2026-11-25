# Tabletop role-playing: dice, sheets, then maps

Proposed 2026-11-25. **Phase 1 (tables and dice) built in v2.158.0.**

## Why

A gaming group on farhold wants to run D&D 5e campaigns in Cortex. They want to play both live, with voice, and by post, over days. Most of what that needs is already here:

| They need | Cortex has |
|-----------|------------|
| A place for the group | A Community, or a group wave |
| An in-game table and an out-of-character channel | Channels, or two waves |
| Session scheduling | Events and the calendar |
| Talking at the table | Voice channels and wave calls |
| Play-by-post | Waves, threads, notifications |
| Things everyone sees change live | The watch-party pattern: one person drives, the server relays the state, everyone follows |

What's missing is the game itself: fair dice, character sheets, the GM's tools and, last, maps.

## Decisions (2026-11-25)

| Question | Decision |
|----------|----------|
| Who it's for | One group, on farhold, to start. It's an opt-in instance feature (`ttrpg`), off unless an admin turns it on. |
| Which game | **D&D 5e first, any system eventually.** So sheets are driven by templates (data), never code written for 5e. 5e is the first template, and a generic template ships alongside it. |
| How they play | **Both play-by-post and live.** Everything works in a wave without anyone being online at the same time. Live sessions add voice and the live-state pattern on top. |
| In what order | **Dice, then sheets, then the GM's tools, then maps.** Maps come last. |
| Encryption | **Campaigns can be encrypted waves.** Dice rolls are visible to the server: accepted. Everything else (the narration, sheets, notes) stays end-to-end encrypted. |
| Across servers | **Wanted, not required.** The design leaves room for it (below). It's built in its own phase. |
| Which 5e (2026-11-25) | **The 2024 rules**, so the 5e template uses SRD 5.2. |
| What the group uses now | **D&D Beyond.** Its sheets are what phase 2 has to replace well enough. |
| Who sees a roll | **A table setting, defaulting to the GM and the roller.** Anyone can still choose for a single roll. |
| Fog of war | **Drawn on the player's screen is enough.** |

## The one rule: the server rolls the dice

A roll made on a player's device can be faked, and fair dice are the point. So the server rolls (`crypto.randomInt`) and records the result. Nobody can edit or delete a roll record, and a roll can be used once.

This is the CLAUDE.md rule that a feature needing server knowledge must be **explicit metadata, never inferred from message text**:

- **The roll record** (`dice_rolls`) holds what the server must know: the wave, who rolled, the dice expression (`1d20+5`), each die's face, the total, who may see it, and when. That's all.
- **The ping** holds the meaning. "Stealth check", "Fireball at the goblins": the label and narration are ordinary ping text, encrypted in an encrypted wave. The ping points at the roll (`pings.roll_id`, the way `event_id` points at an event).
- **So in an encrypted campaign the server learns "Mal rolled 1d20+5 = 17 at 20:14", and not what for.**

The server refuses a `roll_id` that isn't the author's, isn't from this wave, or is already on another ping. Rolling until a good number comes up and posting only that roll is still possible, but every roll is kept and the GM can see them all (the roll log), so it can be spotted.

### Notation

Built to cover 5e and to stretch to other systems:

| Notation | Meaning |
|----------|---------|
| `d20`, `3d6`, `d%` | Dice; `d%` is d100 |
| `+5`, `-1`, `2d6+1d4+3` | Modifiers, and more than one group of dice |
| `adv`, `dis` | 5e advantage and disadvantage (`2d20kh1`, `2d20kl1`) |
| `4d6kh3`, `kl`, `dh`, `dl` | Keep or drop the highest or lowest dice |
| `2d6r1`, `2d6ro1` | Reroll 1s; reroll once (Great Weapon Fighting) |
| `1d6!` | Exploding dice (later, for other systems) |
| `4dF` | Fudge or Fate dice (later) |

Limits: at most 100 dice per roll, at most 1000 sides per die, 20 groups, a rate limit per person, and an expression of at most 100 characters. Spaces are allowed only around `+` and `-`, so `1d20 5` is refused rather than read as a d205. The parser is its own module with its own tests (`server/lib/dice.js`). The device only splits a typed command into dice and label (`client/src/utils/diceCommand.js`), because the label must never reach the roll request; it never decides a roll.

### Who sees a roll

- **Public:** everyone in the wave.
- **To the GM** (the default, which a table can change to public): the roller and the table's GMs see the result. Everyone else sees "🎲 Rolled 1d20+5 for the GM", the dice without the result.
- **GM secret:** a GM rolls, and only the GMs see the result.

The server enforces this on every read. A hidden result is never sent to someone who may not see it, not even to a client that would hide it.

## Tables and GMs

A **table** is a wave with the TTRPG setting turned on: the game system (`dnd5e`, `generic`) and its GMs. It can be a group wave or a wave in a Community channel. A GM is chosen per table and defaults to the wave's owner; a table can have several. Being GM is a table setting, not a new wave role, because it grants game powers (secret rolls, seeing every sheet, running encounters) rather than moderation.

## Phases

### Phase 1: tables and dice (server and web client only) — built in v2.158.0

As built: the ⋮ menu of a wave offers its owner and admins **Make this a table** (game, default visibility, GMs) and everyone at a table **Roll log**. The composer's ⋮ menu has **🎲 Roll Dice**, a tray of d4 to d%, modifier, ADV and DIS, a label and who sees it. Typed commands: `/roll` (or `/r`), `/gmroll`, `/publicroll`, `/secretroll` (GMs). Commands are read in a wave's main message box; the thread panel and focus view send them as text. Not yet: exploding and Fate dice.

- The `ttrpg` instance feature; the table setting on a wave (system, GMs).
- `/roll <notation> [label]` in the composer, plus a dice button that opens a small tray of d4 to d20 and d100, with modifier, advantage and disadvantage.
- The `dice_rolls` table, `POST /api/waves/:id/rolls`, `pings.roll_id`, and the checks above.
- A roll card in the wave: each die shown, the dropped dice greyed, the total large, and criticals (natural 20 or 1) marked.
- Roll visibility (public, to the GM, GM secret).
- The roll log: every roll in the table, filterable by person. GMs see all of them; others see what they may see.
- Works in encrypted waves (the label is encrypted, the roll isn't) and in play-by-post (rolls notify like pings).
- **Tests:** the parser (every row of the notation table, the limits, malformed input), the randomness shape (bounds and rough distribution), visibility on every read path, refusing a `roll_id` from another person or wave or one already used, and that an encrypted wave stores no label. Security tests get a counterfactual.

### Phase 2: character sheets
- **Templates are data:** fields, derived values (in 5e an ability modifier is `floor((score - 10) / 2)`; the proficiency bonus comes from level), lists (attacks, spells, inventory), resources with a current and maximum (HP, spell slots, hit dice), and roll buttons, which are notation built from fields (`1d20 + {dex_mod} + {prof_if_stealth}`).
- **The 5e template** uses the SRD only (below). **The generic template** offers free fields, resources and roll buttons, for any other game until it has its own template.
- **Encrypted like pings.** A sheet is a blob encrypted under the table's wave key, so the server stores it and can't read it. Derived values are worked out on the device. Rolling from a sheet sends the server only the finished expression (`1d20+7`).
- The player owns their sheet; the table's GMs can see it and adjust resources (damage, healing). Each change is a small encrypted update, so two people editing HP at once don't overwrite each other.
- A sheet panel beside the wave, and a compact mode on a phone showing HP, AC, the main rolls and conditions.
- **Import and export as JSON.** D&D Beyond has no public API, so there's no import from it.

### Phase 3: the GM's tools
- **Initiative and encounters:** the GM adds monsters and players, everyone rolls initiative from their sheets, and the GM steps through the turns, live through the watch-party pattern. In play-by-post, the person whose turn it is is notified.
- **Monster stat blocks** from the SRD, plus the GM's own. Monster HP is hidden from players.
- **GM-only notes and handouts.** These need a key only GMs hold: they're sealed to the GMs' public keys, not under the wave key, because every player holds the wave key.
- Conditions (prone, poisoned and so on) on sheets and in the initiative order.

### Phase 4: tables across servers
- **The wave's own server rolls.** A player on PMP at a farhold table asks their server, which asks farhold over federation (a signed `roll_request`). Farhold rolls, keeps the record and returns it signed with its federation key (`signingKeyFor`). Copies of the wave store the record with the ping, check the signature, and never accept a roll that the wave's server didn't make. This is the same pattern as keys for encrypted waves crossing servers.
- Sheets travel like pings: encrypted, under the wave key the remote player already holds.
- Visibility applies on every server: a copy receives a hidden result only for its own GMs and roller.

### Phase 5: maps
- A map is an uploaded image (an attachment bound to the table) with a square or hex grid set by the GM.
- Tokens: players move their own and the GM moves anything; moves are relayed live. In play-by-post a move is kept and shown to whoever opens the map next.
- **Fog of war: a decision to make before building this phase.** A cover drawn on the player's device can be removed by anyone who opens their browser's developer tools. Real secrecy means the server sends only the revealed parts of the map, which is more work. For a group of friends the drawn cover is probably enough, and the server-side version can come later.
- Encrypted waves: the map image is an encrypted attachment like any other, and token positions are encrypted under the wave key.

### Phase 6: rules reference
- Searchable SRD text (spells, conditions, monsters, equipment) beside the wave, plus the table's own homebrew entries. Phase 2 already needs spell and equipment data for sheets, so most of this comes for free by then.

## Content and licensing

- **D&D 5e content comes only from the System Reference Document,** which Wizards of the Coast released under Creative Commons Attribution 4.0 (CC-BY-4.0). That covers SRD 5.1, for the 2014 rules, and SRD 5.2, for the 2024 rules. The attribution goes in the About page and in this folder.
- **Nothing outside the SRD:** no book text, art or setting material (Wizards' product identity), and no copying another virtual tabletop's look.
- **Other systems** get templates only where their rules are openly licensed (for example Pathfinder under the ORC licence, or Fate under CC-BY), or as generic sheets the group fills in.

## Privacy

`docs/PRIVACY.md` gains a section when phase 1 ships: the server stores each roll's dice, results, roller, wave and time, even in an encrypted wave; GMs can see every roll in their table; and sheets, labels and notes are encrypted in encrypted waves.

## Open questions

All four were answered on 2026-11-25 (see Decisions). For phase 2: which D&D Beyond features the group leans on most (its character builder, spell lists, inventory, conditions) decides what the 5e sheet does first.
