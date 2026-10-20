// ============ LIVEKIT VOICE CALL SERVICE (v2.6.0) ============
// Singleton service for managing LiveKit voice/video calls
// This lives outside React's component lifecycle, enabling persistent calls across navigation

import { BASE_URL } from '../config/constants.js';

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
    const state = this.getState();
    this.subscribers.forEach(callback => callback(state));
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
