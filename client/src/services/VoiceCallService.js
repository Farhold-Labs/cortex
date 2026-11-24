// ============ LIVEKIT VOICE CALL SERVICE (v2.6.0) ============
// Singleton service for managing LiveKit voice/video calls
// This lives outside React's component lifecycle, enabling persistent calls across navigation

import { BASE_URL } from '../config/constants.js';
import { setCallOverLockScreen, nativeCallStarted, nativeCallEnded, onNativeCallEvents } from '../utils/nativeCalls.js';

// A direct call that has finished (v2.145.0).
const FINAL_CALL_STATES = new Set(['declined', 'missed', 'cancelled', 'busy', 'ended']);

/** What to tell this device when a direct call stops. */
function endedNotice(call) {
  const name = call.other?.displayName || 'They';
  if (call.direction === 'outgoing') {
    if (call.state === 'declined') return `${name} declined`;
    if (call.state === 'missed') return `${name} didn't answer`;
    if (call.state === 'busy') return `${name} is on another call`;
  }
  if (call.state === 'ended' && call.durationSeconds != null) {
    const m = Math.floor(call.durationSeconds / 60), sec = call.durationSeconds % 60;
    return `Call ended · ${m}:${String(sec).padStart(2, '0')}`;
  }
  return 'Call ended';
}

// A wave call has no per-person publishing rules.
const ALL_ALLOWED = Object.freeze({ speak: true, video: true, screen: true, moderate: false });

class VoiceCallService {
  constructor() {
    // LiveKit connection
    this.room = null;
    this.livekitToken = null;
    this.livekitUrl = null;
    this.currentWaveId = null;

    // Connection state
    this.connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.participants = [];
    this.error = null;

    // Audio/Video state
    this.isMuted = false;
    this.isCameraOff = true; // Camera off by default
    this.isScreenSharing = false;
    this.audioLevel = 0;

    // Community voice channel (v2.118.0). Null for a wave call. A voice
    // channel has no wave: the room is the channel's, and what you may publish
    // in it comes from the token's grants, mirrored in `can`.
    this.voiceChannel = null; // { communityId, channelId, name }
    this.can = { ...ALL_ALLOWED };
    // v2.119.0, voice channels only:
    this.rights = { ...ALL_ALLOWED }; // what the member's roles allow at all
    this.stage = false;               // the channel is a stage
    this.onStage = true;              // ...and we are up on it
    this.handRaised = false;
    this.cameraLimit = null;
    this.e2ee = null;                 // { key, roomSid }: media is encrypted against LiveKit
    this.isDeafened = false;
    // Why the last voice connection ended, if the server ended it.
    this.endedBy = null; // 'removed' | 'closed' | null

    // Direct calls (v2.145.0): one person rang another, outside waves.
    // `directCall` is the call this device is in or placing; `incomingCall`
    // one ringing here, not yet answered. Both are the server's view of the
    // call ({ id, kind, state, direction, other, ... }); the server decides.
    this.directCall = null;
    this.incomingCall = null;
    // Something to tell the person once a direct call stops: "No answer".
    this.directCallNotice = null;
    // Which camera a phone is using; flip swaps it.
    this.facingMode = 'user'; // 'user' | 'environment'
    // A call this device was in when the page went away (a reload): offered back.
    this.interruptedCall = null;
    // The call this device answered, so "answered on another device" isn't said here.
    this.answeredHere = null;

    // Server call status
    this.callActive = false;
    this.serverParticipantCount = 0;
    this.activeCallWaveId = null; // Track which wave has an active call

    // Device management
    this.audioDevices = [];
    this.videoDevices = [];
    this.selectedMic = localStorage.getItem('farhold_mic_device') || 'default';
    this.selectedCamera = localStorage.getItem('farhold_camera_device') || 'default';
    this.selectedSpeaker = localStorage.getItem('farhold_speaker_device') || 'default';

    // Subscriber pattern for React components
    this.subscribers = new Set();

    // Intervals
    this.audioLevelInterval = null;
    this.statusPollInterval = null;

    // Auth token (set by React component)
    this.authToken = null;

    // The Android app's side of a call in progress (v2.148.0): call volume,
    // and the ongoing-call notification with HANG UP.
    this.nativeCallKey = null;
    onNativeCallEvents({
      onHangUp: () => { if (this.livekitToken) this.leaveCall(); },
    });

    // Dock state (v2.6.1)
    this.isDocked = false;
    this.dockMinimized = true;
    this.dockPosition = this.loadDockPosition();

    // Enumerate devices on initialization
    this.enumerateDevices();

    // Listen for device changes
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => this.enumerateDevices());
    }
  }

  // ============ SUBSCRIBER PATTERN ============
  subscribe(callback) {
    this.subscribers.add(callback);
    // Immediately notify new subscriber of current state
    callback(this.getState());
    // Return unsubscribe function
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers() {
    this.syncNativeCall();
    const state = this.getState();
    this.subscribers.forEach(callback => callback(state));
  }

  /**
   * Tell the Android app when a call starts, changes camera, or ends
   * (v2.148.0). A no-op in a browser and on an APK without it.
   */
  syncNativeCall() {
    const active = Boolean(this.livekitToken) && this.connectionState !== 'disconnected';
    const name = this.directCall?.other?.displayName || this.voiceChannel?.name || 'Cortex call';
    const key = active ? `${name}|${this.isCameraOff ? 'audio' : 'video'}` : null;
    if (key === this.nativeCallKey) return;
    const wasActive = this.nativeCallKey !== null;
    this.nativeCallKey = key;
    if (active) nativeCallStarted({ name, video: !this.isCameraOff });
    else if (wasActive) nativeCallEnded();
  }

  getState() {
    return {
      connectionState: this.connectionState,
      participants: this.participants,
      isMuted: this.isMuted,
      isCameraOff: this.isCameraOff,
      isScreenSharing: this.isScreenSharing,
      audioLevel: this.audioLevel,
      error: this.error,
      livekitToken: this.livekitToken,
      livekitUrl: this.livekitUrl,
      roomName: this.currentWaveId,
      callActive: this.callActive,
      serverParticipantCount: this.serverParticipantCount,
      activeCallWaveId: this.activeCallWaveId,
      audioDevices: this.audioDevices,
      videoDevices: this.videoDevices,
      selectedMic: this.selectedMic,
      selectedCamera: this.selectedCamera,
      selectedSpeaker: this.selectedSpeaker,
      isDocked: this.isDocked,
      dockMinimized: this.dockMinimized,
      dockPosition: this.dockPosition,
      voiceChannel: this.voiceChannel,
      can: this.can,
      rights: this.rights,
      stage: this.stage,
      onStage: this.onStage,
      handRaised: this.handRaised,
      cameraLimit: this.cameraLimit,
      e2ee: this.e2ee,
      isDeafened: this.isDeafened,
      endedBy: this.endedBy,
      directCall: this.directCall,
      incomingCall: this.incomingCall,
      directCallNotice: this.directCallNotice,
      facingMode: this.facingMode,
      interruptedCall: this.interruptedCall,
    };
  }

  // ============ DEVICE MANAGEMENT ============
  async enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      this.audioDevices = [...audioInputs, ...audioOutputs];
      this.videoDevices = videoInputs;
      this.notifySubscribers();
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }

  changeMic(deviceId) {
    this.selectedMic = deviceId;
    localStorage.setItem('farhold_mic_device', deviceId);
    this.notifySubscribers();
    // TODO: If in call, update the active track
  }

  changeCamera(deviceId) {
    this.selectedCamera = deviceId;
    localStorage.setItem('farhold_camera_device', deviceId);
    this.notifySubscribers();
    // TODO: If in call, update the active track
  }

  changeSpeaker(deviceId) {
    this.selectedSpeaker = deviceId;
    localStorage.setItem('farhold_speaker_device', deviceId);
    this.notifySubscribers();
    // TODO: If in call, update the audio output
  }

  // ============ AUTHENTICATION ============
  setAuthToken(token) {
    this.authToken = token;
    // ANSWER on the phone's ring arrived before sign-in finished (v2.146.0).
    if (token && this.pendingRingAnswer) {
      const callId = this.pendingRingAnswer;
      this.pendingRingAnswer = null;
      this.answerFromRing(callId);
    }
  }

  // ============ SERVER API CALLS ============
  async fetchToken(waveId) {
    if (!this.authToken || !waveId) {
      this.error = 'Authentication required';
      this.notifySubscribers();
      return null;
    }

    try {
      const response = await fetch(`${BASE_URL}/api/waves/${waveId}/call/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || data.error || 'Failed to get call token');
      }

      const data = await response.json();
      console.log('🎤 [Service] Received LiveKit token:', { url: data.url, roomName: data.roomName });
      return data;
    } catch (err) {
      console.error('Error fetching LiveKit token:', err);
      this.error = err.message || 'Failed to connect to call';
      this.notifySubscribers();
      return null;
    }
  }

  async checkCallStatus(waveId) {
    if (!this.authToken || !waveId) return;

    try {
      const response = await fetch(`${BASE_URL}/api/waves/${waveId}/call/status`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.callActive = data.active;
        this.serverParticipantCount = data.participantCount || 0;
        this.activeCallWaveId = data.active ? waveId : null; // Track which wave has the call
        this.notifySubscribers();
      }
    } catch (err) {
      console.error('Error checking call status:', err);
    }
  }

  // ============ CALL MANAGEMENT ============
  async startCall(waveId, withVideo = false) {
    // Disconnect from any existing call first
    if (this.connectionState !== 'disconnected') {
      console.warn('🎤 [Service] Already in a call, disconnecting first...');
      await this.leaveCall();
    }

    this.connectionState = 'connecting';
    this.currentWaveId = waveId;
    this.voiceChannel = null;
    this.can = { ...ALL_ALLOWED };
    this.rights = { ...ALL_ALLOWED };
    this.stage = false;
    this.onStage = true;
    this.handRaised = false;
    this.e2ee = null;
    this.endedBy = null;
    this.error = null;

    // Set camera state before connecting
    if (withVideo) {
      console.log('🎥 [Service] Starting video call - camera will be enabled');
      this.isCameraOff = false;
    } else {
      console.log('🎤 [Service] Starting voice call - camera will be disabled');
      this.isCameraOff = true;
    }

    this.notifySubscribers();

    const tokenData = await this.fetchToken(waveId);
    if (!tokenData) {
      this.connectionState = 'disconnected';
      this.notifySubscribers();
      return;
    }

    // Auto-dock call BEFORE setting token to prevent dual LiveKitRoom rendering
    // (CallModal renders when !isDocked, DockedCallWindow renders when isDocked)
    this.isDocked = true;

    this.livekitToken = tokenData.token;
    this.livekitUrl = tokenData.url;
    this.notifySubscribers();

    console.log(`🎤 [Service] Starting ${withVideo ? 'video' : 'voice'} call...`);

    // Start polling call status
    this.startStatusPolling(waveId);
  }

  /**
   * Join a Community voice channel (v2.118.0).
   *
   * Always joins MUTED with the camera off (decided 2026-10-16): dropping into
   * a room must never broadcast you before you meant to. The server says so in
   * `startMuted`, and the token decides what may be published at all — `can`
   * only mirrors it so the dock does not offer a button LiveKit would refuse.
   *
   * Returns { ok } or { error } so the caller can show why a join failed (a
   * full channel, access removed).
   */
  async joinVoiceChannel({ communityId, channelId, name }) {
    if (!this.authToken) return { error: 'Not signed in' };
    if (this.connectionState !== 'disconnected' || this.livekitToken) {
      await this.leaveCall();
    }

    this.connectionState = 'connecting';
    this.voiceChannel = { communityId, channelId, name };
    this.currentWaveId = null;
    this.error = null;
    this.endedBy = null;
    this.notifySubscribers();

    let data;
    try {
      const response = await fetch(`${BASE_URL}/api/communities/${communityId}/channels/${channelId}/voice/token`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.authToken}`, 'Content-Type': 'application/json' },
      });
      data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not join the voice channel');
    } catch (err) {
      this.connectionState = 'disconnected';
      this.voiceChannel = null;
      this.error = err.message;
      this.notifySubscribers();
      return { error: err.message };
    }

    this.can = { ...ALL_ALLOWED, ...(data.can || {}) };
    this.rights = { ...ALL_ALLOWED, ...(data.rights || data.can || {}) };
    this.stage = data.stage === true;
    this.onStage = data.onStage !== false;
    this.handRaised = false;
    this.cameraLimit = data.cameraLimit || null;
    this.e2ee = data.e2ee || null;
    this.isMuted = data.startMuted !== false || !this.can.speak;
    this.isCameraOff = true;
    this.isScreenSharing = false;
    this.isDeafened = false;
    this.currentWaveId = data.roomName;
    this.isDocked = true;
    this.dockMinimized = true;
    this.livekitToken = data.token;
    this.livekitUrl = data.url;
    this.notifySubscribers();
    return { ok: true };
  }

  /**
   * The room ended the connection. For a voice channel that is final — the
   * person was removed, the channel was deleted, or they sat idle — so tidy up
   * instead of leaving a dead dock, and remember why for the toast.
   */
  handleRoomDisconnected(reason) {
    if (!this.voiceChannel) {
      this.setConnectionState('disconnected');
      return;
    }
    // livekit-client DisconnectReason: 1 CLIENT_INITIATED, 4 PARTICIPANT_REMOVED, 5 ROOM_DELETED
    this.endedBy = reason === 4 ? 'removed' : reason === 5 ? 'closed' : null;
    const endedBy = this.endedBy;
    this.leaveCall().then(() => {
      this.endedBy = endedBy;
      this.notifySubscribers();
    });
  }

  /**
   * LiveKit changed what we may publish (v2.119.0): a host brought us up or
   * sent us back, the cameras filled up, a role changed. Follow it, and switch
   * off whatever is no longer allowed rather than leave a control that fails.
   */
  setLivePermissions({ speak, video, screen }) {
    const can = { ...this.can, speak, video, screen };
    if (JSON.stringify(can) === JSON.stringify(this.can)) return;
    this.can = can;
    if (this.stage) this.onStage = speak || video || screen;
    if (!speak) this.isMuted = true;
    if (!video) this.isCameraOff = true;
    if (!screen) this.isScreenSharing = false;
    if (this.onStage) this.handRaised = false;
    this.notifySubscribers();
  }

  /** Raise or lower our hand on a stage. */
  async raiseHand(raised) {
    if (!this.voiceChannel || !this.authToken) return { error: 'Not in a voice channel' };
    const { communityId, channelId } = this.voiceChannel;
    try {
      const response = await fetch(`${BASE_URL}/api/communities/${communityId}/channels/${channelId}/voice/hand`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raised }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { error: data.error || 'That did not work' };
      this.handRaised = raised;
      this.notifySubscribers();
      return { ok: true };
    } catch {
      return { error: 'That did not work' };
    }
  }

  setHandRaised(raised) {
    if (this.handRaised === raised) return;
    this.handRaised = raised;
    this.notifySubscribers();
  }

  /** Something stopped this voice channel being joinable here (an old browser). */
  failVoice(message) {
    const channel = this.voiceChannel;
    this.leaveCall().then(() => {
      this.error = message;
      this.endedBy = channel ? 'unsupported' : null;
      this.notifySubscribers();
    });
  }

  /** The media key no longer matches the room (it restarted between token and join): join again. */
  async rejoinVoiceChannel() {
    const channel = this.voiceChannel;
    if (!channel || this.rejoining) return;
    this.rejoining = true;
    try {
      await this.joinVoiceChannel(channel);
    } finally {
      this.rejoining = false;
    }
  }

  /** The room muted our microphone (a moderator did it). Show it as muted. */
  setMutedByRoom() {
    if (this.isMuted) return;
    this.isMuted = true;
    this.notifySubscribers();
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    // Deafened means you hear nothing, and nobody hears you either.
    if (this.isDeafened) this.isMuted = true;
    this.notifySubscribers();
  }

  clearEndedBy() {
    this.endedBy = null;
    this.notifySubscribers();
  }

  async leaveCall() {
    // Leaving a direct call hangs it up for both (v2.145.0).
    const direct = this.directCall;
    this.directCall = null;
    if (direct && !FINAL_CALL_STATES.has(direct.state)) {
      this.callApi(`/api/calls/${encodeURIComponent(direct.id)}/end`, 'POST').catch(() => {});
    }
    this.facingMode = 'user';
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }

    this.connectionState = 'disconnected';
    this.livekitToken = null;
    this.livekitUrl = null;
    this.currentWaveId = null;
    this.voiceChannel = null;
    this.can = { ...ALL_ALLOWED };
    this.rights = { ...ALL_ALLOWED };
    this.stage = false;
    this.onStage = true;
    this.handRaised = false;
    this.cameraLimit = null;
    this.e2ee = null;
    this.isDeafened = false;
    this.participants = [];
    this.audioLevel = 0;
    this.isScreenSharing = false;
    this.error = null;

    // Hide dock when leaving call
    this.hideDock();

    this.stopStatusPolling();
    this.notifySubscribers();

    console.log('🎤 [Service] Left call');
  }

  // ============ DIRECT CALLS (v2.145.0) ============
  async callApi(path, method = 'GET', body) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${this.authToken}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || 'That did not work');
      err.code = data.code;
      err.call = data.call;
      throw err;
    }
    return data;
  }

  /** Join the room of a direct call this device is part of. */
  async joinDirectRoom(call, withVideo) {
    if (this.connectionState !== 'disconnected' || this.livekitToken) {
      // Into a direct call from a wave call or voice channel: leave that first,
      // without hanging up the call being joined.
      const keep = this.directCall;
      this.directCall = null;
      await this.leaveCall();
      this.directCall = keep;
    }
    this.connectionState = 'connecting';
    this.voiceChannel = null;
    this.can = { ...ALL_ALLOWED };
    this.rights = { ...ALL_ALLOWED };
    this.stage = false;
    this.onStage = true;
    this.e2ee = null;
    this.endedBy = null;
    this.error = null;
    this.isMuted = false;
    this.isCameraOff = !withVideo;
    this.facingMode = 'user';
    this.notifySubscribers();
    let data;
    try {
      data = await this.callApi(`/api/calls/${encodeURIComponent(call.id)}/token`, 'POST');
    } catch (err) {
      this.directCall = null;
      this.connectionState = 'disconnected';
      this.directCallNotice = err.message;
      this.notifySubscribers();
      return false;
    }
    // Hung up while the token was coming.
    if (this.directCall?.id !== call.id) {
      this.connectionState = 'disconnected';
      this.notifySubscribers();
      return false;
    }
    this.currentWaveId = data.roomName;
    this.isDocked = true;
    this.dockMinimized = false;
    this.livekitToken = data.token;
    this.livekitUrl = data.url;
    this.notifySubscribers();
    return true;
  }

  /**
   * Ring a contact. Joins the call's room straight away, so the caller sees
   * their own picture while it rings, as on a phone.
   * Returns { ok } or { error }.
   */
  async placeCall(person, kind = 'video') {
    if (!this.authToken) return { error: 'Not signed in' };
    if (this.directCall) return { error: 'You are already in a call' };
    let data;
    try {
      data = await this.callApi('/api/calls', 'POST', { to: person.id, kind });
    } catch (err) {
      return { error: err.code === 'BUSY' ? `${person.name || person.displayName || 'They'} is on another call` : err.message };
    }
    this.directCall = data.call;
    this.directCallNotice = null;
    this.notifySubscribers();
    await this.joinDirectRoom(data.call, kind === 'video');
    return { ok: true };
  }

  /** Answer the call ringing here. */
  async answerCall(withVideo) {
    const call = this.incomingCall;
    if (!call) return;
    this.incomingCall = null;
    this.notifySubscribers();
    let data;
    try {
      data = await this.callApi(`/api/calls/${encodeURIComponent(call.id)}/answer`, 'POST');
    } catch (err) {
      setCallOverLockScreen(false);
      this.directCallNotice = err.code === 'NOT_RINGING' ? 'That call has ended' : err.message;
      this.notifySubscribers();
      return;
    }
    this.directCall = data.call;
    this.answeredHere = data.call.id;
    this.notifySubscribers();
    await this.joinDirectRoom(data.call, withVideo);
  }

  /**
   * ANSWER tapped on the Android app's own ring (v2.146.0). The app may have
   * just started, so the call is fetched rather than waited for.
   */
  async answerFromRing(callId) {
    if (!callId || this.directCall?.id === callId) return;
    if (!this.authToken) { this.pendingRingAnswer = callId; return; }
    if (this.incomingCall?.id !== callId) {
      let call;
      try {
        ({ call } = await this.callApi(`/api/calls/${encodeURIComponent(callId)}`));
      } catch {
        setCallOverLockScreen(false);
        return;
      }
      if (call?.direction !== 'incoming' || call.state !== 'ringing') {
        // Nothing to show above the lock screen after all.
        setCallOverLockScreen(false);
        this.directCallNotice = 'That call has ended';
        this.notifySubscribers();
        return;
      }
      this.incomingCall = call;
    }
    await this.answerCall(this.incomingCall.kind === 'video');
  }

  async declineCall() {
    const call = this.incomingCall;
    if (!call) return;
    this.incomingCall = null;
    this.notifySubscribers();
    this.callApi(`/api/calls/${encodeURIComponent(call.id)}/decline`, 'POST').catch(() => {});
  }

  clearDirectCallNotice() {
    if (!this.directCallNotice) return;
    this.directCallNotice = null;
    this.notifySubscribers();
  }

  /**
   * The server says a call changed (WebSocket `direct_call`). Every device of
   * both people hears every change; each works out what it means here.
   */
  handleDirectCallUpdate(call) {
    if (!call?.id) return;
    // Ringing for us: ring, unless this device is already in that call.
    if (call.direction === 'incoming' && call.state === 'ringing') {
      if (this.directCall?.id !== call.id) {
        this.incomingCall = call;
        this.notifySubscribers();
      }
      return;
    }
    // It stopped ringing here: answered elsewhere, declined, or given up.
    if (this.incomingCall?.id === call.id) {
      this.incomingCall = null;
      if (call.state === 'answered' && this.answeredHere !== call.id) this.directCallNotice = 'Answered on another device';
      this.notifySubscribers();
    }
    if (this.directCall?.id !== call.id) return;
    this.directCall = call;
    if (FINAL_CALL_STATES.has(call.state)) {
      this.directCallNotice = endedNotice(call);
      this.directCall = null; // over: leaving must not hang it up again
      this.leaveCall();
    }
    this.notifySubscribers();
  }

  /** On start-up and reconnect: a call ringing for us now, or one we were in. */
  async loadLiveCall() {
    if (!this.authToken) return;
    try {
      const { live } = await this.callApi('/api/calls');
      if (!live) {
        if (this.incomingCall) { this.incomingCall = null; this.notifySubscribers(); }
        return;
      }
      if (live.direction === 'incoming' && live.state === 'ringing') {
        if (this.directCall?.id !== live.id) { this.incomingCall = live; this.notifySubscribers(); }
      } else if (!this.directCall && live.state === 'answered') {
        this.interruptedCall = live;
        this.notifySubscribers();
      }
    } catch { /* not this time */ }
  }

  /** Back into a call this device dropped out of (a reload). */
  async rejoinCall() {
    const call = this.interruptedCall;
    this.interruptedCall = null;
    if (!call) return;
    this.directCall = call;
    this.notifySubscribers();
    await this.joinDirectRoom(call, call.kind === 'video');
  }

  dismissInterruptedCall(hangUp) {
    const call = this.interruptedCall;
    this.interruptedCall = null;
    this.notifySubscribers();
    if (hangUp && call) this.callApi(`/api/calls/${encodeURIComponent(call.id)}/end`, 'POST').catch(() => {});
  }

  /** Front camera to back, or back to front (phones). */
  flipCamera() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    this.notifySubscribers();
  }

  // ============ AUDIO/VIDEO CONTROLS ============
  toggleMute() {
    if (this.isMuted && !this.can.speak) return;
    this.isMuted = !this.isMuted;
    // Speaking again means hearing again.
    if (!this.isMuted) this.isDeafened = false;
    this.notifySubscribers();
    console.log(`🎤 [Service] Mute toggled: ${this.isMuted ? 'MUTED' : 'UNMUTED'}`);
    // Note: Actual mute/unmute happens in LiveKitCallRoom component via LiveKit API
  }

  toggleCamera() {
    if (this.isCameraOff && !this.can.video) return;
    this.isCameraOff = !this.isCameraOff;
    // A camera turned back on starts with the front one again.
    if (this.isCameraOff) this.facingMode = 'user';
    this.notifySubscribers();
    console.log(`🎥 [Service] Camera toggled: ${this.isCameraOff ? 'OFF' : 'ON'}`);
    // Note: Actual camera on/off happens in LiveKitCallRoom component via LiveKit API
  }

  /** The camera could not be turned on (refused by the room): show it off. */
  cameraFailed() {
    if (this.isCameraOff) return;
    this.isCameraOff = true;
    this.notifySubscribers();
  }

  setScreenSharing(isSharing) {
    this.isScreenSharing = isSharing;
    this.notifySubscribers();
    console.log(`🖥️ [Service] Screen sharing: ${isSharing ? 'ON' : 'OFF'}`);
  }

  // ============ LIVEKIT ROOM CALLBACKS ============
  // These are called by the LiveKitCallRoom component
  setConnectionState(state) {
    this.connectionState = state;
    this.notifySubscribers();
  }

  setParticipants(participants) {
    this.participants = participants;
    this.notifySubscribers();
  }

  setAudioLevel(level) {
    // Only notify if value actually changed (avoid spamming re-renders every 100ms)
    if (this.audioLevel !== level) {
      this.audioLevel = level;
      this.notifySubscribers();
    }
  }

  setRoom(room) {
    this.room = room;
  }

  // ============ STATUS POLLING ============
  startStatusPolling(waveId) {
    // Initial check
    this.checkCallStatus(waveId);

    // Poll every 5 seconds
    this.statusPollInterval = setInterval(() => {
      if (this.currentWaveId) {
        this.checkCallStatus(this.currentWaveId);
      }
    }, 5000);
  }

  stopStatusPolling() {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  // ============ DOCK MANAGEMENT (v2.6.1) ============
  showDock() {
    this.isDocked = true;
    this.notifySubscribers();
    console.log('🪟 [Service] Dock shown');
  }

  hideDock() {
    this.isDocked = false;
    this.notifySubscribers();
    console.log('🪟 [Service] Dock hidden');
  }

  toggleDockSize() {
    this.dockMinimized = !this.dockMinimized;
    this.notifySubscribers();
    console.log(`🪟 [Service] Dock ${this.dockMinimized ? 'minimized' : 'maximized'}`);
  }

  setDockPosition(pos) {
    this.dockPosition = pos;
    localStorage.setItem('farhold_dock_position', JSON.stringify(pos));
    this.notifySubscribers();
  }

  loadDockPosition() {
    try {
      const saved = localStorage.getItem('farhold_dock_position');
      if (saved) {
        const pos = JSON.parse(saved);
        // Validate position is on-screen
        if (pos.x >= 0 && pos.y >= 0 && pos.x < window.innerWidth && pos.y < window.innerHeight) {
          return pos;
        }
      }
    } catch (e) {
      console.warn('Failed to load dock position from localStorage:', e);
    }

    // Default: bottom-right corner
    return {
      x: Math.max(0, window.innerWidth - 420),
      y: Math.max(0, window.innerHeight - 620),
      width: 400,
      height: 600
    };
  }

  // ============ CLEANUP ============
  cleanup() {
    if (this.room) {
      this.room.disconnect();
    }
    this.stopStatusPolling();
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
    }
  }
}

// Export singleton instance
export const voiceCallService = new VoiceCallService();
