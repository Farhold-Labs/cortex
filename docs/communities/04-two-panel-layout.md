# Two-panel wave list

**Status: built in v2.125.0 (2026-10-29).** The decisions below were taken
with Jared on 2026-10-28. The notes at the end say where the build differs
from the plan.

## Why

Since v2.102.0 the wave list has been one nested scroll: COMMUNITIES (each
Community, then its channels, then their waves) above WAVES (pinned,
categories, uncategorized). That is four levels in a 300px column. v2.123.1
fixed the indentation so the levels read correctly. The list still grows with
every channel of every Community, though, and Communities you aren't looking
at push your personal waves below the fold.

The fix is to give a Community its own panel, the way chat apps with servers
and channels do, while keeping Cortex's personal waves one click away.

## Decisions (2026-10-28)

| Question | Decision |
| --- | --- |
| What does the home panel collapse to on desktop? | **An icon rail.** It is a navigator for everything in the home list, not just Communities. |
| What is on the rail? | **Communities, then your other waves.** Your other waves are personal and node waves, meaning every wave not filed in a Community. They appear as category tiles if you use categories, and as one tile per wave if you don't. |
| What does a tile look like? | **Initials by default.** A Community can upload a **logo**, which replaces its initials. Categories and waves use initials. |
| What does clicking a tile do? | **Takes you to what you clicked:** the Community, the category or the wave. |
| A long rail? | **It scrolls, and is not capped.** Forty uncategorized waves make forty tiles, and that is the nudge to use categories. |
| Category icons? | **Not now.** Initials in the category's colour. Uploaded category icons are a welcome later addition. |
| Keep the nested single list as an option? | **No.** Two panels replace it. That leaves one layout to support, test and document. |
| What does tapping a Community in the home list do? | **Opens its panel.** The home list shows each Community as one row; its channels appear only inside its panel. |

## The panels

**Home panel.** This is the wave list today, minus the channel tree:

- **COMMUNITIES:** one row per Community. Each row shows:
  - its logo or initials and its name;
  - its unread total;
  - a 🔊 marker while someone is in one of its voice channels;
  - a ⋮ menu with New Channel, Invite People and Manage Community.

  The section's +, ⋮ and fold stay as they are.
- **WAVES:** unchanged: PINNED, then categories, then UNCATEGORIZED. A pinned
  channel wave stays under PINNED here, as it does today, and still counts
  toward its Community's unread total.

**Community panel.** One Community:

- **Header:** ‹ (back to home), the logo or initials, the Community name, and ⋮
  (the same menu as its home row).
- **Channels** in channel order, each foldable, with their waves nested one
  step in (the v2.123.1 steps).
- **Voice channels** with their occupants and JOIN.
- "No channels yet" and "No waves filed here yet", as now.
- **Reorder mode** (v2.121.0) works here for channels and channel waves, under
  the same `channel.manage` rule. Communities themselves are still reordered
  in the home panel.

**Category panel.** One of your categories, opened from its rail tile:

- **Header:** ‹, the category's initials in its colour, its name, and ⋮ (New
  Wave Here, Manage Categories).
- Its waves, as they appear under that category in the home panel, with the
  same row menus and reorder.

## The rail (desktop)

```
 Home (nothing open)          A Community open             A category open
┌────────────────┬──────┐    ┌──┬────────────────┬──────┐  ┌──┬────────────────┬──────┐
│ COMMUNITIES  + │      │    │⌂ │‹ MY PRIVATE   ⋮│      │  │⌂ │‹ GENERAL      ⋮│      │
│ My Public    0 │      │    │MP│ # Main Stage   │ wave │  │MP│ test           │ wave │
│ My Private   2 │ wave │    │▣ │   test crew    │ view │  │MT│ Test Public    │ view │
│ My Unlisted  0 │ view │    │MU│ # MPTC Chan 1  │      │  │MU│ test wave      │      │
│ WAVES        + │      │    │──│   Test mptc    │      │  │──│                │      │
│ GENERAL        │      │    │GE│ 🔊 Lounge JOIN │      │  │▣ │                │      │
│ UNCATEGORIZED  │      │    │UN│                │      │  │UN│                │      │
└────────────────┴──────┘    └──┴────────────────┴──────┘  └──┴────────────────┴──────┘
                                ▣ = the open tile
```

**When it shows.** Opening a Community or a category, from the home panel or a
link, collapses the home panel to the rail. ⌂ at the top brings the full home
panel back and hides the rail.

**What's on it, top to bottom:**

1. **⌂** (home).
2. **Communities,** in your order, one tile each: the logo if it has one,
   otherwise its initials.
3. A divider.
4. **Pinned waves,** one tile each, because pinning is how you say "keep this
   in reach".
5. **Your other waves,** which depend on whether you use categories:
   - **You have categories:** one tile per category, plus an **UNCATEGORIZED**
     tile if any waves are unfiled. Tiles are the category's initials in its
     colour.
   - **You have no categories:** one tile per wave, in your wave order, showing
     the wave's initials.

The rail scrolls on its own when it is longer than the window. It is never
capped: someone with forty uncategorized waves gets forty tiles, and the cure
is categories.

**Every tile** shows an unread dot when anything inside it is unread, and a 🔊
marker for a Community with people in voice. Hover and `aria-label` give the
full name.

**Clicking a tile:**

- **A Community** opens its Community panel.
- **A category** (or UNCATEGORIZED) opens its category panel.
- **A wave** opens that wave in the wave view. The panel beside the rail stays
  as it is, so you can glance at a pinned wave and come straight back to the
  channel you were in.

**Initials.** These are the first letters of the first two words ("My Private
Test" gives MP), or the first two letters of a one-word name ("Main" gives
MA). Upper-cased, ignoring emoji and punctuation.

Two tiles can share initials, as MP and MP could. The tile's colour and
position tell them apart, and hovering shows the name. A logo is the way to
make a Community unmistakable.

**Other desktop details:**

- Ctrl+B and the ◀ toggle still collapse the whole sidebar, rail included.
- The rail is about 56px wide, so the sidebar grows from 300px to about 356px
  while something is open. At the narrowest desktop widths that space comes
  out of the wave view; check it at 1024px.

## Community logos

- **Who can set it:** whoever holds `community.manage`, the same people who can
  rename the Community. They do it from Manage Community, with upload, replace
  and remove.
- **Server.** Uploads go to `POST /api/communities/:id/logo` (multipart,
  through `uploadFile()`), and `DELETE` on the same path removes the logo. The
  server:
  - processes the image with `sharp` into a square WebP, as `/api/profile/avatar`
    does (256px, so the rail looks sharp at 2x);
  - stores it through `storage.upload()`;
  - records it in a new nullable `communities.logo_url` column;
  - deletes the old file through `lib/s3-delete.js` when a logo is replaced or
    removed.

  The usual limiter and image type checks apply.
- **Who can see it.** A logo is an **unbound file**, like an avatar: anyone
  with its URL can load it. The URL is random and is only sent in Community
  responses, so it reaches only people who could already see the Community.
  The access rules stay exactly as they are. A PRIVATE Community's logo is
  therefore no more exposed than its name already is to its members. Say this
  in `docs/PRIVACY.md`.
- **Remote members** reach the Community on its hosting node through
  cross-port auth (v2.56.0). The logo URL belongs to that node, so it loads for
  them too.
- **Closing or deleting a Community** deletes its logo file.

## Phone (and portrait touch tablets: `isMobile`)

There is no room for a rail, so it's a drill-down. Logos and initials show on
the Community rows and in the panel header.

1. The WAVES tab shows the home panel.
2. Tap a Community, and its panel replaces the home panel.
3. Tap a wave to open the wave view.
4. Back goes to the Community panel, not home. That is the ‹ in the wave
   header or Android system back. Back again goes home.
5. Tapping the WAVES tab while inside a Community goes home.

Categories keep folding in place in the phone's home panel. With no rail there
is nothing to drill into, and folding already keeps them short.

Switching between Communities on a phone means going back home first. That is
the cost of not having a rail; the unread totals on the home rows tell you
where to go.

## State

- **`openContainer` is navigation state, not a preference.** It lives in
  `MainApp`, next to `previewWaveId` and the tabs, and is either
  `{ kind: 'community' | 'category', id }` or null. Nothing goes to the server.
- **It is remembered per person in `localStorage`.** That is a per-viewer
  convenience, and every read and write is wrapped in try/catch. Reopening the
  app brings you back to what you had open.
- **Opening a channel wave from anywhere else opens its Community.** That
  covers a notification, search, a pinned row or a link. On desktop the panel
  switches. On a phone, back from that wave lands in its Community panel. The
  path from the wave's `channel_id` to its channel and Community is already in
  the channel cache.
- **Access lost means back to home.** If you lose access to the open Community
  (you were removed, it was closed, or the instance feature was turned off), or
  the open category is deleted, the panel closes and you fall back to home. The
  `instance_config_changed` push (v2.118.1) covers the feature switch.
- **With the `communities` feature off,** there is no COMMUNITIES section. The
  rail still works for categories and waves.

## What changes on the server

Only the logo:

- the column;
- the upload and remove routes;
- the old file deleted on replace;
- `logoUrl` in the Community responses the client already fetches (the list,
  the detail and the channel cache's Community entry).

The column is added through the boot-time update logic in
`database-sqlite.js`; then regenerate `schema.sql`. **This is a migrating
release, so take a verified backup on every node first.**

Everything else is already on the client: channel lists, unread counts, voice
presence and ordering. The low-bandwidth wave query, the wave-list cache and
the encrypted `user_list_order` stay as they are.

## Build plan

0. **The Community manager first, as its own release (v2.124.0):** collapsible
   sections, plus appointing admins and moderators. The two panels and logos
   follow as v2.125.0, and the logo upload then goes into the new ABOUT
   section.
1. **Split the list.** `WaveCategoryList` becomes three components sharing
   `renderWaveItem` and the unread helpers:
   - `HomeWaveList`: the Community rows and WAVES.
   - `CommunityChannelList`: channels and their waves. It needs a new name
     because `components/communities/CommunityPanel.jsx` already exists; that
     is the Community settings and members screen.
   - `CategoryWaveList`.
2. **The rail.** Add `WaveRail.jsx` with tiles, the initials helper, unread
   dots and voice markers, plus `openContainer` in `MainApp` and the desktop
   layout.
3. **Phone.** The drill-down and its back handling. Only `WaveView` uses
   `useSystemBack` today, so the Community panel needs its own entry.
4. **Links into a Community.** Opening a channel wave from a notification,
   search or a pinned row opens its Community.
5. **Logos.**
   - The migration and routes, with tests: who may upload, image type checks,
     the old file deleted, and only Community members get `logoUrl`.
   - The upload in Manage Community.
   - The logo on the rail, the rows and the header.
6. **Docs:** README, PRIVACY.md (logos), API.md (the routes), CLAUDE.md's
   wave-list notes and CHANGELOG.

This is one minor release, v2.125.0, and it migrates.

## Testing

- **Layout.** Headless, at 390px, 1024px and 1280px, across the font-size ×
  density combinations used for v2.123.1.
- **Rail.**
  - A person with categories sees category tiles.
  - A person without categories sees wave tiles.
  - Pinned waves sit above both.
  - Each tile opens the right thing.
  - Opening a wave tile leaves the panel alone.
- **Phone.** Drill down, then back out with the header ‹ and with history back.
  Open a channel wave from a notification and check where back lands.
- **Unread.** A new ping in a channel wave lights its rail tile and its home
  row. A new ping in a categorized wave lights the category tile. Both clear
  once read.
- **Logos.** Upload, replace and remove; check the old file goes, and that a
  non-manager gets 403. A remote member sees the logo.
- **Voice.** Join a voice channel and go home. The 🔊 marker shows, and the call
  stays up.
- **Real devices.** Android system back and portrait tablets need a person with
  a phone. Say so in the release notes rather than claim them.

## Community manager (Manage Community)

**Built in v2.124.0.** The manager was redesigned before the two panels,
because the logo upload lives there and it already takes too much room.

What it is today (`CommunitySettingsPanel.jsx`) is one long column of always
open boxes: CHANNELS, NEW CHANNEL, INVITES, INVITE SOMEONE FROM ANOTHER
SERVER, ADD SOMEONE FROM THIS SERVER, MEMBERS. On a phone, MEMBERS is several
screens down.

**Collapsible sections.** Built in v2.124.0. Same `CollapsibleSection`
accordion as Settings (v2.115.0), in a denser variant, one section open at a
time:

| Section | Holds | Shown to holders of |
| --- | --- | --- |
| **ABOUT** | Name, description, visibility; the **logo** goes here in v2.125.0 | everyone (editing needs `community.manage`) |
| **CHANNELS** | List, rename, delete, stage, new channel | `channel.view` (changes need `channel.manage`) |
| **MEMBERS** | Search, members with their roles, each with a ⋮ for role changes, hand over, remove, ban | `member.view` |
| **INVITES** | Add from this server, invite codes, invite from another server | `member.invite` |
| **ROLES** | Who is owner, admin and moderator | `member.view` |
| **LEAVE OR CLOSE** | Pending handover, leave, close | members (closing needs `community.delete`) |

- "+ New Channel" opens CHANNELS and "Invite People" opens INVITES.
- Switching, creating, joining and browsing fold into YOUR COMMUNITIES, closed
  when the screen opens on a Community.

**Admins and moderators.** The server has had them since v2.94.0:

- built-in `admin` and `moderator` roles with priorities 300 and 200;
- grant and revoke routes, `PUT` and `DELETE`
  `/api/communities/:id/members/:userId/roles/:roleId`;
- `canActOnMember`, which stops you acting on anyone at or above your own rank.

There has never been a control to use them. The manager only lists role names.
So:

- **On each member's row**, a ⋮ menu with Make admin, Make moderator, Remove
  admin and Remove moderator. Only the moves the server would allow are shown:
  you need `member.roles`, the role must sit below your own, and so must the
  member. The server checks again whatever the menu shows.
- **ROLES** lists the owner, the admins and the moderators with a one-line
  description of each, so you can see who runs the Community without scrolling
  through everyone.
- **What each role can do is fixed for now:** the built-in capability sets in
  `server/lib/communities/capabilities.js`. Custom roles exist server-side but
  get no editor in this release.
- **Remote members** (cross-port) can be appointed like anyone else, with the
  standing re-check still applying (v2.97.0).

Server additions were small: `myRoles` on the Community detail, `q` and
`staff=1` on the member list, and a `community_roles_changed` push so a new
admin's open app picks up their powers.

## Open questions

- **Temporary wave tiles.** Here is an example. You click the GENERAL tile, and
  the panel beside the rail lists GENERAL's waves, just as a Community lists its
  channels. You open "test wave" from that list. Then you click a Community
  tile: the panel switches to that Community, and "test wave" stays open on the
  right until you pick something else.

  The question is whether "test wave" should also get a tile of its own (TW) so
  you can jump back to it in one click. The suggestion is **no**: the GENERAL
  tile gets you back in two clicks, and wave tabs already keep several waves
  open at once. Temporary tiles would be a second tab bar. Only pinned waves get
  tiles of their own.

## As built (v2.125.0)

- **Opening a category on desktop** is "▣ Open in Panel" in the category's ⋮
  (and UNCATEGORIZED's), as well as its rail tile. The rail only appears once
  something is open, so without the menu item someone with no Communities
  could never reach it.
- **The home panel lists every Community**, including ones with no channels
  yet. Before, a Community appeared in the list only once it had a channel.
- **Back on a phone.** `useSystemBack` used to act on every `popstate`, so with
  a wave open over a Community's panel one back press closed both. A handler
  now ignores a pop that lands on its own history entry. The panel's entry is
  pushed only while no wave is over it, so it always sits beneath the wave's.
- **Logo URLs** are resolved against the API host, as avatars are, and fall
  back to initials if the image fails to load.

