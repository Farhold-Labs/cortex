/**
 * Who is in which LiveKit room, kept on the server (v2.118.0).
 *
 * WHY THIS EXISTS
 *
 * Voice channels show who is in them before you join, so the server has to
 * know. Wave calls already wanted the same thing and got it by polling: every
 * open client asked `GET /api/waves/active-calls` every 10 seconds, and each of
 * those requests called LiveKit's `ListRooms` across the whole project. Ten
 * people with the app open was a LiveKit API call every second, to report
 * something that changes a few times an hour.
 *
 * Now LiveKit tells us. Its webhooks (`participant_joined`, `participant_left`,
 * `track_published`, …) update this roster, and the server pushes changes over
 * the WebSocket it already has. Webhooks can be missed or not configured, so a
 * reconcile pass rebuilds the roster from `ListRooms` + `ListParticipants`:
 * every 10 s when no webhook has been seen lately, every 40 s when they are flowing.
 * Either way it is one caller per node, not one per open client.
 *
 * Mute state is not in any webhook, so idle detection reads it from the
 * reconcile pass, which is why the idle sweep always reconciles first.
 *
 * PROCESS-LOCAL, like the HLS sessions in media-proxy.js. A restart loses the
 * roster and the first reconcile rebuilds it.
 */

export const VOICE_ROOM_PREFIX = 'vc-';
const BROADCAST_ROOM_PREFIX = 'broadcast-';

export function voiceRoomName(channelId) {
  return `${VOICE_ROOM_PREFIX}${channelId}`;
}

/**
 * What a LiveKit room name refers to. Wave calls are named after the wave,
 * broadcasts and voice channels carry a prefix, so a voice channel can never be
 * mistaken for a wave and looked up as one.
 */
export function classifyRoom(name) {
  if (typeof name !== 'string' || !name) return null;
  if (name.startsWith(VOICE_ROOM_PREFIX)) return { kind: 'voice', channelId: name.slice(VOICE_ROOM_PREFIX.length) };
  if (name.startsWith(BROADCAST_ROOM_PREFIX)) return { kind: 'broadcast' };
  return { kind: 'wave', waveId: name };
}

// LiveKit's TrackSource enum, as numbers (webhooks and Twirp JSON may carry
// either form).
const SOURCE_NAMES = { 1: 'camera', 2: 'microphone', 3: 'screen_share', 4: 'screen_share_audio' };
function sourceName(source) {
  if (typeof source === 'number') return SOURCE_NAMES[source] || null;
  if (typeof source === 'string') {
    const s = source.toLowerCase();
    return Object.values(SOURCE_NAMES).includes(s) ? s : null;
  }
  return null;
}

const toMs = (seconds) => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
};

export class VoiceRoster {
  /**
   * @param {object} opts
   * @param {object|null} opts.roomService  LiveKit RoomServiceClient (or a stand-in)
   * @param {(room: string) => void} [opts.onChange]  called when a room's occupants or tracks change
   * @param {() => number} [opts.now]
   */
  constructor({ roomService, onChange = () => {}, now = () => Date.now() }) {
    this.roomService = roomService;
    this.onChange = onChange;
    this.now = now;
    /** room name → Map(identity → participant) */
    this.rooms = new Map();
    /** room name → when its occupant count last became 1 */
    this.aloneSince = new Map();
    this.lastWebhookAt = 0;
  }

  /** Occupants of a room, oldest first. */
  participants(room) {
    const map = this.rooms.get(room);
    if (!map) return [];
    return [...map.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(p => ({ identity: p.identity, name: p.name, joinedAt: p.joinedAt, sources: [...p.sources] }));
  }

  /** Every occupied room's name. */
  roomNames() {
    return [...this.rooms.keys()];
  }

  count(room) {
    return this.rooms.get(room)?.size || 0;
  }

  has(room, identity) {
    return Boolean(this.rooms.get(room)?.has(identity));
  }

  _room(room) {
    let map = this.rooms.get(room);
    if (!map) { map = new Map(); this.rooms.set(room, map); }
    return map;
  }

  _settle(room) {
    const n = this.count(room);
    if (n === 0) {
      this.rooms.delete(room);
      this.aloneSince.delete(room);
    } else if (n === 1) {
      if (!this.aloneSince.has(room)) this.aloneSince.set(room, this.now());
    } else {
      this.aloneSince.delete(room);
    }
  }

  _join(room, identity, name, joinedAt) {
    const map = this._room(room);
    if (map.has(identity)) return false;
    const now = this.now();
    // Joining counts as activity: the idle clock starts at the join.
    map.set(identity, { identity, name: name || identity, joinedAt: joinedAt || now, lastActiveAt: now, sources: new Set() });
    this._settle(room);
    return true;
  }

  _leave(room, identity) {
    const map = this.rooms.get(room);
    if (!map || !map.delete(identity)) return false;
    this._settle(room);
    return true;
  }

  /** Forget someone at once, e.g. after removing them, without waiting for the webhook. */
  forget(room, identity) {
    if (this._leave(room, identity)) this.onChange(room);
  }

  /**
   * Apply a verified LiveKit webhook event. Returns the room it changed, or null.
   * The caller verifies the signature first; this trusts its input.
   */
  applyEvent(event) {
    this.lastWebhookAt = this.now();
    const room = event?.room?.name;
    if (!room) return null;
    const identity = event.participant?.identity;
    let changed = false;

    switch (event.event) {
      case 'participant_joined':
        if (identity) changed = this._join(room, identity, event.participant.name, toMs(event.participant.joinedAt));
        break;
      case 'participant_left':
      case 'participant_connection_aborted':
        if (identity) changed = this._leave(room, identity);
        break;
      case 'room_finished':
        changed = this.rooms.has(room);
        this.rooms.delete(room);
        this.aloneSince.delete(room);
        break;
      case 'track_published':
      case 'track_unpublished': {
        if (!identity) break;
        // A track from someone we have not heard join: the join webhook was
        // missed. Add them rather than ignore the evidence they are there.
        if (event.event === 'track_published') this._join(room, identity, event.participant.name, toMs(event.participant.joinedAt));
        const p = this.rooms.get(room)?.get(identity);
        const source = sourceName(event.track?.source);
        if (!p || !source) break;
        if (event.event === 'track_published') {
          p.sources.add(source);
          if (!event.track?.muted) p.lastActiveAt = this.now();
        } else {
          p.sources.delete(source);
        }
        changed = true;
        break;
      }
      default:
        break;
    }
    if (changed) this.onChange(room);
    return changed ? room : null;
  }

  /**
   * Rebuild from LiveKit itself. Catches missed webhooks, nodes with no webhook
   * configured, and a server restart; it is also the only source of mute state.
   */
  async reconcile() {
    if (!this.roomService) return;
    const rooms = await this.roomService.listRooms();
    const live = new Set();
    for (const r of rooms || []) {
      if (!r?.name || !(Number(r.numParticipants) > 0)) continue;
      live.add(r.name);
      let participants;
      try {
        participants = await this.roomService.listParticipants(r.name);
      } catch {
        continue; // keep what we had for this room rather than emptying it
      }
      const before = this.participants(r.name);
      const map = this._room(r.name);
      const seen = new Set();
      for (const info of participants || []) {
        if (!info?.identity) continue;
        seen.add(info.identity);
        this._join(r.name, info.identity, info.name, toMs(info.joinedAt));
        const p = map.get(info.identity);
        const sources = new Set();
        let active = false;
        for (const t of info.tracks || []) {
          const s = sourceName(t.source);
          if (s) sources.add(s);
          if (!t.muted) active = true;
        }
        p.sources = sources;
        if (active) p.lastActiveAt = this.now();
      }
      for (const identity of [...map.keys()]) if (!seen.has(identity)) map.delete(identity);
      this._settle(r.name);
      if (JSON.stringify(before) !== JSON.stringify(this.participants(r.name))) this.onChange(r.name);
    }
    for (const room of [...this.rooms.keys()]) {
      if (!live.has(room)) {
        this.rooms.delete(room);
        this.aloneSince.delete(room);
        this.onChange(room);
      }
    }
  }

  /**
   * Who should be disconnected for being idle, from current state. Pure: the
   * caller removes them. Only rooms `applies(room)` accepts are considered, so
   * wave calls keep their existing behaviour.
   *
   *   aloneMs  — the only person in the room for this long
   *   idleMs   — every track muted or absent for this long
   */
  idleRemovals({ aloneMs, idleMs, applies = () => true }) {
    const now = this.now();
    const out = [];
    for (const [room, map] of this.rooms) {
      if (!applies(room)) continue;
      const since = this.aloneSince.get(room);
      if (aloneMs > 0 && map.size === 1 && since !== undefined && now - since >= aloneMs) {
        out.push({ room, identity: [...map.keys()][0], reason: 'alone' });
        continue;
      }
      if (idleMs > 0) {
        for (const p of map.values()) {
          if (now - p.lastActiveAt >= idleMs) out.push({ room, identity: p.identity, reason: 'idle' });
        }
      }
    }
    return out;
  }
}
