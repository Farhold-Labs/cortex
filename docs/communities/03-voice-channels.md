# Communities — voice channels

Design sketch, 2026-10-16. **Phases 1 (server) and 2 (client) are built, in
v2.118.0; Phase 3 in v2.119.0.** Background audio in the Android app and
screen sharing still need checking on a real device.

Phase 3 as built (v2.119.0):

- **One publish rule, applied live.** `voiceSourcesFor()` decides what someone
  may publish from their capabilities, the stage and the camera limit. It goes
  into the token and is re-applied with LiveKit's UpdateParticipant whenever it
  could have changed, so LiveKit, not the client, enforces it.
- **Camera limit: 6 per channel.** With six on, nobody else may start one. A
  seventh that slips in is taken down (the latest goes) and its owner is told.
  Turning a camera off now unpublishes it; it used to stay published, muted,
  still showing 📷 and still holding a place.
- **Stage channels** are voice channels with `stage` set, at creation or later.
  Hosts are whoever holds `voice.moderate`; they bring people up and send them
  back. The audience raises hands. The flags live in LiveKit participant
  metadata, which only the server writes, so a restart loses nothing.
- **Move to another channel.** The person's app rejoins, with a token checked
  like any other and the other room's key. If it has not left within 15 s it
  is removed, so a move is never weaker than a disconnect.
- **End-to-end encryption against LiveKit.** Every voice channel. The key is an
  HMAC of the room's LiveKit session id under a secret derived from
  `JWT_SECRET`: it changes with each room session, survives a restart, and
  LiveKit never sees it. The host node can derive it; the point is to keep the
  media provider out. Browsers that cannot encrypt are not let in. Verified
  against LiveKit Cloud: it reports the tracks as encrypted (`encryption: 1`,
  GCM), and the other side decodes them.
- **Idle is per room.** A muted listener in a room where someone is talking
  stays; a room where nobody has anything on is emptied. Both limits are admin
  settings.
- **Found on the way: removed people could never rejoin.** The LiveKit SDK
  dates tokens 0, and LiveKit refuses a token dated before a removal. All
  tokens are now signed with `livekitJwt()`, dated now.

Phase 2 as built:

- **The channel row** is a compact section titled 🔊 with the occupants listed
  beneath, plus an explicit JOIN / LEAVE button. Tapping the name folds the list.
  The occupants show 📷 and 🖥️ for a published camera or screen. There is no
  speaking indicator for people you are not connected to, since the server does
  not see audio levels.
- **The docked call window is the connected bar.** It is not a second
  component: one LiveKit connection, as for wave calls. Closing it is not
  offered for a voice channel, because closing hands a wave call to the wave's
  call screen and a voice channel has none.
- **Moderator actions** appear on rows only while you are in the channel,
  because that is when this client knows (from the token's `can`) that you hold
  `voice.moderate` there. The server re-checks capability and rank.

What Phase 1 changed from the sketch:

- **No limit on simultaneous video publishers yet.** A token is issued before
  anyone turns a camera on, so the limit cannot go in the token; it needs the
  server to watch cameras appear and mute the excess. Moved to Phase 3. The
  per-room participant limit (25) is in, enforced by Cortex and set as the
  LiveKit room's `maxParticipants`.
- **Rooms of other nodes are ignored.** dev and farhold share one LiveKit
  project, and `ListRooms` reports the whole project, so a node acts only on
  voice rooms whose channel it has. Deleting a channel or Community therefore
  closes its rooms explicitly; the re-check would otherwise take a deleted
  channel's room for another node's.
- **The fallback poll runs every 10 s,** matching the client poll it replaced.
  Measured against LiveKit Cloud with no webhook: a join showed up after 18 s
  with a 15 s poll, so the poll was shortened. With the webhook it is immediate.
- **Moderators get mute and disconnect.** Moving someone to another channel
  waits for the client.

Discord-style voice channels: a channel you drop into and leave, showing who is
in it before you join, with voice, video and screen sharing. Prompted by Root
(rootapp.com), which has them.

Most of the parts already exist. Wave calls, video, screen sharing
(`CallModal.jsx`) and the docked call window (`DockedCallWindow.jsx`,
`services/VoiceCallService.js`) shipped long ago. Channels and their
authorization (`lib/communities/authorize.js`) shipped in Phases 1–7. Voice
channels mostly join the two.

## 0. Media backend

**LiveKit stays**, Cloud or self-hosted. Decided 2026-10-16:

- **Not our own media server.** mediasoup, Janus or Pion would still leave the
  signalling, simulcast, reconnection, bandwidth adaptation and client to write:
  months of work to rebuild what LiveKit already does.
- **Self-hosting is a config change.** Cortex calls only the open-source
  `livekit-server` APIs (`AccessToken`, `RoomServiceClient`, `EgressClient`).
  Moving off Cloud means pointing `LIVEKIT_URL` at our own server, opening UDP
  ports and running LiveKit's built-in TURN.
- **When to move off Cloud** depends on what Cloud costs with real use.
- **What limits self-hosting.** Bandwidth limits video and broadcasts. CPU
  limits only Egress recording (headless Chrome, 2–4 vCPU per recording), which
  does not fit beside the chat nodes on the 2 vCPU Bluehost box.

Nothing below depends on which LiveKit.

## 1. Model

- **A new channel type, `voice`**, beside `text` and `announcement`.
  - **It holds no waves.** A voice channel is a room that always exists. You
    join and leave it; nobody "starts a call".
  - **The room is named `vc-<channelId>`.** Wave calls name the room after the
    wave id, and `GET /api/waves/active-calls` resolves every room name with
    `db.getWave()`. A separate namespace keeps the two from colliding.
  - **Schema.** `channels.type` has `CHECK(type IN ('text','announcement'))`,
    which SQLite cannot alter in place. Adding `voice` is a table rebuild in
    `database-sqlite.js`, so it ships with the verified release backup, and
    `server/schema.sql` is regenerated (`tools/generate-schema.mjs`).
- **Not federated.** Like everything else in a Community, the room lives on the
  host node, and remote members connect to the host node's LiveKit.

## 2. Authorization

New capabilities in `lib/communities/capabilities.js`. These are persisted
data, so they are added, never renamed.

| Capability | Allows |
| --- | --- |
| `voice.connect` | join the room and listen |
| `voice.speak` | publish a microphone |
| `voice.video` | publish a camera |
| `voice.screen` | share a screen |
| `voice.moderate` | server-mute, disconnect or move other members |

Rules:

- **One evaluator.** These go through `authorize()` like every other capability,
  so channel overrides apply, pooled, with deny winning. No controller computes
  them inline.
- **The token is the control.** The token endpoint maps the capabilities onto
  LiveKit's `canPublishSources` (`MICROPHONE`, `CAMERA`, `SCREEN_SHARE`,
  `SCREEN_SHARE_AUDIO`). A member without `voice.screen` gets a token that
  cannot publish a screen, whatever the client shows.
- **Revocation reaches the live room.** A token matters only at join, so on its
  own it would let a removed member stay connected. Removing, banning or
  demoting a member, a channel override that takes away `voice.connect`, and a
  node-level suspension each call `RoomServiceClient.removeParticipant`.
  Removal and ban need a counterfactual test, per the standing rule for security
  fixes.
- **Remote members** join with their home identity, the same as Community
  access today. Their standing is re-checked with their home node when the
  token is issued. The LiveKit identity is their local stub user id, so it
  cannot collide with a local user's.

Endpoint, by analogy with `POST /api/waves/:waveId/call/token`:

```
POST /api/communities/:communityId/channels/:channelId/voice/token
  → 404 when the channel can't be seen (no existence leak, as with other routes)
  → 403 without voice.connect
  → { token, url, roomName: "vc-<channelId>", identity, userName }
```

## 3. Presence: pushed, not polled

Showing who is in a channel before you join is the core of the feature.

- **LiveKit webhooks** (`participant_joined`, `participant_left`,
  `room_finished`) go to a webhook endpoint, verified with `WebhookReceiver`.
  The server keeps an in-memory roster per room, rebuilds it with one
  `listRooms` at boot, and sends changes over the existing WebSocket only to
  users who pass `channel.view` for that channel.
- **This also fixes wave calls.** Today every open client polls
  `GET /api/waves/active-calls` every 10 seconds (`MainApp.jsx`), and each poll
  calls LiveKit's `listRooms` across the whole project. The farhold access log
  shows it from every connected client. Wave-call indicators would move to the
  same pushed roster. The webhook roster carries only what the poll already
  returns (who is in a room); it adds no new data.

## 4. Client

- **The channel row** in the wave list gets a speaker icon. Under it are the
  avatars of the people in the room, with a speaking indicator for those
  publishing audio.
- **One tap joins, muted**, reusing the docked call window, which already stays up
  while you move around the app. A persistent "Connected to #lounge" bar holds
  mute, deafen, camera, screen share and leave.
- **One voice connection at a time.** Joining another channel, or a wave call,
  moves you.
- **Moderator actions** (with `voice.moderate`): server-mute a track
  (`mutePublishedTrack`), disconnect, and move to another voice channel.
- **On a real phone:** whether the Android app keeps the audio going in the
  background, and whether it needs a foreground service for that, has to be
  tested on a device. Headless testing cannot show it.

## 5. Cost and privacy

- **Idle listeners are the cost.** LiveKit Cloud bills per participant-minute,
  and voice channels invite people to sit in them, muted, for hours. So:
  - **an opt-in instance feature, `voiceChannels`,** in
    `INSTANCE_OPT_IN_FEATURES`, off by default like `broadcasts`, and enforced
    server-side with 403;
  - **idle disconnect:** a member alone in a room, or idle beyond a limit, is
    disconnected;
  - **limits in `lib/communities/limits.js`:** most participants per room, and
    most simultaneous video publishers, which bounds bandwidth.
- **The audio is not end-to-end encrypted.** As with wave calls, media is
  encrypted to the SFU (DTLS-SRTP), not past it. `docs/PRIVACY.md` must say so
  plainly. LiveKit end-to-end encryption (insertable streams, a shared key per
  room) is a later option.
- **Nothing is recorded.** Voice channels have no Egress. Recording stays a
  broadcast feature.

## 6. Phases

1. **Server**
   - the `voice` type migration;
   - the capabilities and default role grants;
   - the token endpoint;
   - the webhook roster pushed over WebSocket, with wave-call indicators moved
     to it and the 10-second poll retired;
   - removal on revocation;
   - the feature flag and limits;
   - tests, including counterfactuals for the authorization and removal paths.
2. **Client:** the channel row with presence, the connected bar, and moderator
   actions. CDP-tested at phone size; background audio checked on a device.
3. **Built in v2.119.0:** the camera limit, moving people, stage mode,
   end-to-end encryption and idle tuning (see the top of this document).

Each phase is roughly the size of one Communities phase.

## 7. Decisions

Taken 2026-10-16:

| Question | Decision |
| --- | --- |
| Microphone on joining | **Muted.** Joining never broadcasts a room you didn't mean to. |
| Screen sharing | **Every member.** `voice.screen` is in the default member role; a Community can still take it away with a role change or channel override. |
| First node | **farhold.** Communities are already on there; `voiceChannels` stays off elsewhere. |

Still open, with the defaults Phase 1 will build to unless changed:

| Question | Default |
| --- | --- |
| Text beside the voice | **None at first.** A companion wave can be added later without changing the model. |
| Idle disconnect | **Alone in the room for 5 minutes,** or **muted with no activity for 60 minutes.** Both are per-node settings. |
