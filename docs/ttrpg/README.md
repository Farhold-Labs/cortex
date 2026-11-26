# Tabletop role-playing: dice, sheets, then maps

Proposed 2026-11-25. **Phase 1 (tables and dice) built in v2.158.0; phase 2 (character sheets) in v2.159.0; phase 3 (the GM's tools) and the 2014 rules in v2.160.0; phase 6 (the rules reference) in v2.161.0, ahead of 4 and 5.**

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
| The 2014 rules (2026-11-25) | **Asked for by the group: added in v2.160.0** as a second 5e system (`dnd5e-2014`, SRD 5.1) beside 2024. |
| Classic Marvel Super Heroes (2026-11-25) | **Only if it's easy.** Its rules aren't openly licensed, so no template that reads the colour chart; the generic sheet has a FASERIP starting layout (v2.160.0) and the group's book does the rest. |

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

### Phase 2: character sheets — built in v2.159.0

As built (the group's most-used D&D Beyond features weren't named, so the core of a D&D Beyond sheet was chosen): **📜 Character sheets** in the wave's ⋮ menu and the message box's ⋮ menu opens a panel beside the wave (the whole screen on a phone). On top, always: HP with Damage, Heal and Temp, AC, initiative, speed, proficiency, passive Perception, advantage or disadvantage for the next d20, Heroic Inspiration, conditions and Exhaustion (2024: −2 to d20 Tests and −5 ft speed per level, applied to every roll). Tabs: abilities, saves and skills (proficiency and expertise, Jack of All Trades), each a roll button; attacks with to-hit, damage and critical damage; spells (DC, attack, slots worked out for full, half and pact casters and multiclassing by the 2024 rules, overridable; cast uses a slot); inventory with weight and carrying capacity, and coins; limited-use features with short or long rest resets, Hit Point Dice spent by rolling, short and long rests; the character's details and classes. A death save at 0 HP is rolled and marked. Labels name the character (`Vex: Stealth (advantage)`). A sheet is the table's to see or only the GMs'; its owner chooses.

How it differs from the plan below: **the 5e sheet's layout is code, its rules tables are data** (`client/src/ttrpg/dnd5e2024.js`); a general formula language for every system wasn't worth building before a second system needs it. The generic sheet is the any-system path: fields, resources and roll buttons whose dice name fields (`1d20+{Agility}`, whole numbers only). **Concurrent changes:** a write names the version it started from; the server refuses a stale one with the current sheet, and the device applies its pending changes again on top (so two people taking HP off at once both count; checked with mal and zoe damaging at the same moment). The sheet is unsigned: who changed it is the server's record (`updated_by`). Not yet: an SRD spell and equipment list to pick from (phase 6), and anything automated by class level beyond slots, hit dice and saves.

As planned:
- **Templates are data:** fields, derived values (in 5e an ability modifier is `floor((score - 10) / 2)`; the proficiency bonus comes from level), lists (attacks, spells, inventory), resources with a current and maximum (HP, spell slots, hit dice), and roll buttons, which are notation built from fields (`1d20 + {dex_mod} + {prof_if_stealth}`).
- **The 5e template** uses the SRD only (below). **The generic template** offers free fields, resources and roll buttons, for any other game until it has its own template.
- **Encrypted like pings.** A sheet is a blob encrypted under the table's wave key, so the server stores it and can't read it. Derived values are worked out on the device. Rolling from a sheet sends the server only the finished expression (`1d20+7`).
- The player owns their sheet; the table's GMs can see it and adjust resources (damage, healing). Each change is a small encrypted update, so two people editing HP at once don't overwrite each other.
- A sheet panel beside the wave, and a compact mode on a phone showing HP, AC, the main rolls and conditions.
- **Import and export as JSON.** D&D Beyond has no public API, so there's no import from it.

### Phase 3: the GM's tools — built in v2.160.0

As built: **⚔ GM screen** in the wave's ⋮ menu (players get **Encounter and handouts**).
- **Encounters.** The GM names one and adds characters (from the table's sheets, with their initiative bonus), monsters from the stat blocks (several at once, numbered, average or rolled HP, optionally hidden) and others. **Roll for monsters** rolls their initiative in secret. Players tap **Roll initiative**, which rolls from their sheet in public with a ref (`enc:<encounter>:<combatant>`); the GM's device finds those rolls (`GET /rolls?ref=`, told by `table_roll`), fills in the first roll by the character's owner, ignores re-rolls, and sorts. The GM steps through turns and rounds (a downed monster loses its turn, a downed PC keeps it for death saves) and can tell the player whose turn it is (`POST /table/turn`: an in-app notification and push, for play-by-post). Everyone sees the order live, conditions, PCs' HP from sheets they can read, and a monster's state as **Bloodied** or **Down**; its HP and AC are only in the GMs' half. Combatants can be hidden and revealed, moved, removed.
- **Monster stat blocks:** the GM's own, in the 2024 layout, with ability, attack and damage roll buttons; JSON import and export. **No SRD monster list yet** (phase 6, with the rules reference).
- **Notes and handouts:** GM notes; **Share with the table** makes one a handout (and says so in the wave), and it can be made GM-only again.
- The GM's rolls from the screen are hidden (dice shown), secret, or public, chosen on the screen.

**The GM key (v2.162.0).** GM-only documents (an encounter's GM half, stat blocks, unshared notes) are sealed with a key only the table's GMs hold, in every wave, plain or encrypted, so neither the server nor a player who also runs it can read them. (In v2.160.0 they were only kept from players by the server, which was a stated limit.)
- A GM's device makes it (AES-256-GCM) and wraps a copy for each GM like a wave key: ECDH with the GM's fingerprint-signed key, bound to `"cortex-gmkey-v1" ‖ wave ‖ version ‖ GM`. The server keeps only wrapped copies (`table_gm_keys`) and who wrapped each; a device opens one only if its wrapper's key is one their fingerprint signed, and for the current version only if the wrapper is a GM here. Documents are sealed bound to `"cortex-gmdoc-v1" ‖ wave ‖ id ‖ kind`.
- The server refuses a GM-only document that isn't sealed with the GM key (`GM_KEY_REQUIRED`), and one for the table that is. Sharing a note as a handout seals it for the table again; un-sharing seals it with the GM key.
- **A new GM is given the key by a GM's choice, never automatically:** the GM screen says "Zoe is a GM here but doesn't have the GM key yet" with **Share it**. So a GM the server invented gets nothing unless a real GM agrees. Until then the new GM is told they're waiting.
- **When someone holding the current version is no longer a GM** (removed, or left the wave), the next GM to open the screen makes a new version for the remaining GMs and seals everything again with it. The one who left keeps what they had, as with wave keys, but the server no longer sends them GM documents.
- Documents made before v2.162.0 are sealed with the GM key the first time a GM opens the screen.

As planned:
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

### Phase 6: rules reference — built in v2.161.0 (ahead of phases 4 and 5)

As built: **📖 Rules reference** in a table's ⋮ menu, for everyone: spells, monsters, equipment, magic items and conditions for the 2014 rules (SRD 5.1) and the 2024 rules (SRD 5.2), searchable, with a filter (spell level, CR, category, rarity). The same list is a picker: a sheet takes spells (with save, attack and dice; cantrips grow with level; the full text on demand from the SRD id, not stored in the sheet) and equipment and magic items (a weapon also becomes an attack, finesse picking the better of Strength and Dexterity); the GM screen takes monsters into the GM's stat blocks as an editable copy.

The data comes from [5e-bits/5e-database](https://github.com/5e-bits/5e-database) at a pinned commit, converted by `tools/build-srd.mjs` into `client/src/srd/` (see its `SOURCE.md`); nothing was typed in from memory. A test checks every set, spot-checks numbers against the books, and rolls every dice string in it through the server's roller (a flat "5" for Aid, or a blowgun's 1, stays text). Each set is its own chunk, loaded when first opened and left out of the service worker's precache, so nobody downloads its 2 MB until they open it. Not yet: the table's own homebrew entries.

**Fill from the SRD (v2.163.0).** A 5e sheet's About and Features tabs have **Fill from the SRD…**, and each class row **Level up**:
- **Class and subclass features** for every level the character has (the subclass matched by name, or chosen), each kept as a reference (name, source, SRD id) whose text is read from the SRD, not stored in the sheet. Options of a feature (each Fighting Style) aren't added: they're chosen.
- **Limited-use features become resources**, with the maximum and the rest that brings them back (`classResources()` in `client/src/ttrpg/fill.js`, our reading of the SRD class tables: Rage, Bardic Inspiration, Channel Divinity, Wild Shape, Second Wind, Action Surge, Indomitable, Ki or Focus Points, Divine Sense, Lay on Hands, Sorcery Points, Mystic Arcanum, Arcane Recovery, Favored Enemy). 2024 features that come back one at a time on a short rest are marked so. A fill again raises the maximum and adds the new uses to what's left.
- **Species** (traits, speed, size; 2014 racial increases optionally added to the scores), **background** (skills, tools, feature or feat), the first class's **skills** (choose as many as it allows), **starting equipment** (each choice, and an item for "any martial weapon"; packs unpacked; weapons become attacks; gold to the purse) and **hit points** (the whole die at level 1, the fixed value after, plus Constitution).
- **Level up** adds that level's features only, updates resources, and adds the fixed hit points (or not, for those who roll).
- It **only adds**: nothing already on the sheet is added twice or replaced, and **Undo** takes it back out, leaving anything changed since.
- **Several spells at once:** the spell picker can show only the character's classes' spells up to their highest slot, with a tick box each.

**Ability Score Improvements, feats and multiclassing (v2.164.0).** At each Ability Score Improvement (filling, levelling up, or later with **Choose** on the Features tab): +2 to one score, +1 to two (to 20), or a feat the character qualifies for (level, scores, not taken already; a feat's own +1 chosen too). An Epic Boon (2024, level 19) takes a boon or another feat, and a boon can raise a score to 30. Feats come from the SRD: Grappler in 5.1; in 5.2 the general feats and the Epic Boons. **Adding a class** (About → + Class) checks the multiclassing scores for the new class and the current ones (a warning, not a block), adds its level-1 features, its multiclass proficiencies and its skill choice (Bard, Ranger, Rogue), and the fixed hit points. Levelling up one class touches only that class (in v2.163.0 it also added the other classes' missing features).

Not yet: 2024 background ability increases (shown, chosen by the player).

As planned:
- Searchable SRD text (spells, conditions, monsters, equipment) beside the wave, plus the table's own homebrew entries. Phase 2 already needs spell and equipment data for sheets, so most of this comes for free by then.

## Content and licensing

- **D&D 5e content comes only from the System Reference Document,** which Wizards of the Coast released under Creative Commons Attribution 4.0 (CC-BY-4.0). That covers SRD 5.1, for the 2014 rules, and SRD 5.2, for the 2024 rules. The attribution goes in the About page and in this folder.
- **Nothing outside the SRD:** no book text, art or setting material (Wizards' product identity), and no copying another virtual tabletop's look.
- **Other systems** get templates only where their rules are openly licensed (for example Pathfinder under the ORC licence, or Fate under CC-BY), or as generic sheets the group fills in.

## Privacy

`docs/PRIVACY.md` gains a section when phase 1 ships: the server stores each roll's dice, results, roller, wave and time, even in an encrypted wave; GMs can see every roll in their table; and sheets, labels and notes are encrypted in encrypted waves.

## Open questions

All four were answered on 2026-11-25 (see Decisions). Still open: which D&D Beyond features the group misses most, now that phase 2 has the core sheet (its character builder, a spell list to pick from, homebrew).
