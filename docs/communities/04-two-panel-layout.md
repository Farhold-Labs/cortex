# Two-panel wave list

**Status: proposed 2026-10-28. Not built.** Decisions below were taken with Jared
on 2026-10-28; the rest is the plan for agreeing before code.

## Why

Since v2.102.0 the wave list is one nested scroll: COMMUNITIES (each Community
→ its channels → their waves) above WAVES (pinned, categories, uncategorized).
That is four levels in a 300px column. v2.123.1 fixed the indentation so the
levels read correctly, but the list still grows with every channel of every
Community, and personal waves get pushed below the fold by Communities you are
not looking at.

The fix is to give a Community its own panel, the way chat apps with servers
and channels do, while keeping Cortex's personal waves one tap away.

## Decisions (2026-10-28)

| Question | Decision |
| --- | --- |
| What does the home panel collapse to on desktop when a Community is open? | **An icon rail**: a home button, then one tile per Community with its unread dot. One click switches Community or goes home. |
| Keep the nested single list as an option? | **No.** Two panels replace it. One layout to support, test and document. |
| What does tapping a Community in the home list do? | **Opens its panel.** The home list shows each Community as one row; channels appear only inside the Community panel. |

## The two panels

**Home panel.** What the wave list is today, minus the channel tree:

- COMMUNITIES: one row per Community — name, unread total, a 🔊 marker while
  someone is in one of its voice channels, ⋮ menu (New Channel, Invite People,
  Manage Community). The section's +, ⋮ and fold stay as they are.
- WAVES: unchanged — PINNED, categories, UNCATEGORIZED. A pinned channel wave
  stays under PINNED here, as today, and still counts toward its Community's
  unread total.

**Community panel.** One Community:

- Header: ‹ back to home, the Community name, ⋮ (the same menu as its home row).
- Its channels in channel order, each foldable, with their waves nested one
  step in (the v2.123.1 steps); voice channels with their occupants and JOIN.
- "No channels yet" / "No waves filed here yet" as now.
- Reorder mode (v2.121.0) works here for channels and channel waves, under the
  same `channel.manage` rule. Reordering Communities themselves stays in the
  home panel.

## Desktop

```
 Home (nothing open)          A Community open
┌────────────────┬──────┐    ┌──┬────────────────┬──────┐
│ COMMUNITIES  + │      │    │⌂ │‹ MY PRIVATE   ⋮│      │
│ My Public    0 │      │    │MP│ # Main Stage   │ wave │
│ My Private   2 │ wave │    │●M│   test crew    │ view │
│ My Unlisted  0 │ view │    │MU│ # MPTC Chan 1  │      │
│ WAVES        + │      │    │  │   Test mptc    │      │
│ UNCATEGORIZED  │      │    │  │ 🔊 Lounge JOIN │      │
└────────────────┴──────┘    └──┴────────────────┴──────┘
```

- The rail is about 56px. Tiles are the Community's initials (Communities have
  no icon today); the open one is highlighted, others show an unread dot or a
  🔊 marker. Hover and `aria-label` give the full name.
- ⌂ returns to the home panel and removes the rail.
- Opening a personal wave from the home panel doesn't open a rail.
- Ctrl+B and the ◀ toggle still collapse the whole sidebar, rail included.
- The sidebar grows from 300px to about 356px while a Community is open. At
  the narrowest desktop widths that comes out of the wave view; check at
  1024px.

## Phone (and portrait touch tablets — `isMobile`)

There's no room for a rail, so it's a drill-down:

1. WAVES tab → home panel.
2. Tap a Community → its panel replaces the home panel.
3. Tap a wave → the wave view.
4. Back (‹ in the wave header, Android system back) → the Community panel, not
   home. Back again → home.
5. Tapping the WAVES tab while inside a Community goes home.

Switching between Communities on a phone means going back home first. That is
the cost of not having a rail; unread totals on the home rows are what tell you
where to go.

## State

- `openCommunityId` lives in `MainApp`, beside `previewWaveId` and the tabs.
  It is navigation state, not a preference: nothing goes to the server.
- It is remembered per person in `localStorage` (a per-viewer convenience, read
  in try/catch). Reopening the app returns you to the Community you were in.
- **Opening a channel wave from anywhere else opens its Community:** a
  notification, search, a pinned row, a link. On desktop the panel switches; on
  a phone, back from that wave lands in its Community panel. The wave's
  `channel_id` → channel → Community is already in the channel cache.
- A Community you lose access to (removed, Community closed, instance feature
  turned off) closes its panel and falls back home. The `instance_config_changed`
  push (v2.118.1) covers the feature switch.
- With the `communities` feature off there is no COMMUNITIES section and no
  rail: the list is exactly the WAVES section, as today.

## What does not change

- No server or API change. Channel lists, unread counts, voice presence and
  ordering are all already on the client; this is a re-arrangement of
  `WaveList.jsx` into two components and some `MainApp` navigation state.
- The low-bandwidth wave query, the wave-list cache and the encrypted
  `user_list_order` are untouched.
- The wave view, focus view and tabs are untouched.

## Build plan

1. Split `WaveCategoryList` into `HomeWaveList` (Community rows + WAVES) and
   `CommunityPanel` (channels + waves), sharing `renderWaveItem` and the
   unread helpers. `components/communities/CommunityPanel.jsx` already exists
   (the Community settings/members screen) — the new one needs another name,
   e.g. `CommunityChannelList.jsx`.
2. `openCommunityId` in `MainApp`, the rail, and the desktop layout.
3. Phone drill-down and back handling (`useSystemBack` is used by `WaveView`
   only today; the Community panel needs its own entry).
4. "Opening a channel wave opens its Community" for notifications, search and
   pinned rows.
5. Docs: README, CLAUDE.md wave-list notes, CHANGELOG.

One minor release (v2.124.0), client only.

## Testing

- Headless, at 390px and 1280px (and 1024px for the rail squeeze), across the
  font-size × density combinations used for v2.123.1.
- Drive the flows: open a Community, switch with the rail, go home; on phone,
  drill down and back out with the header ‹ and with history back; open a
  channel wave from a notification and check where back lands.
- Unread: a new ping in a channel wave lights its rail tile and its home row,
  and clears when read.
- Voice: join a voice channel, go home, check the 🔊 marker and that the call
  stays up.
- Android system back and tablet portrait need a real device — say so in the
  release notes rather than claim them.

## Open questions

- Rail tile for a Community: initials only, or should Communities get an icon
  upload (a server change, so a later release)?
- Should a person's personal waves be reachable from inside a Community on a
  phone without going home — e.g. a "Waves" row at the top of the Community
  panel? Suggest no, and see whether it's missed.
