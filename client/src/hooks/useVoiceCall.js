import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAPI.js';
import { voiceCallService } from '../services/VoiceCallService.js';

// ============ LIVEKIT VOICE CALL HOOK (v2.6.0 - Service-based) ============
// Thin wrapper around VoiceCallService that enables persistent calls across navigation
export function useVoiceCall(waveId) {
  const { token } = useAuth();
  const [state, setState] = useState(voiceCallService.getState());
  const waveIdRef = useRef(waveId);

  // Update waveId ref when it changes
  useEffect(() => {
    waveIdRef.current = waveId;
  }, [waveId]);

  // Set auth token in service when it changes
  useEffect(() => {
    if (token) {
      voiceCallService.setAuthToken(token);
    }
  }, [token]);

  // Subscribe to service state changes
  useEffect(() => {
    const unsubscribe = voiceCallService.subscribe(setState);
    return unsubscribe;
  }, []);

  // Start status polling for this wave
  useEffect(() => {
    if (waveId && token) {
      voiceCallService.checkCallStatus(waveId);
      const interval = setInterval(() => {
        voiceCallService.checkCallStatus(waveId);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [waveId, token]);

  // Wrapper functions that call service methods
  const startCall = useCallback((withVideo = false) => {
    return voiceCallService.startCall(waveIdRef.current, withVideo);
  }, []);

  const leaveCall = useCallback(() => {
    return voiceCallService.leaveCall();
  }, []);

  const toggleMute = useCallback(() => {
    voiceCallService.toggleMute();
  }, []);

  const toggleCamera = useCallback(() => {
    voiceCallService.toggleCamera();
  }, []);

  const setScreenSharing = useCallback((isSharing) => {
    voiceCallService.setScreenSharing(isSharing);
  }, []);

  const changeMic = useCallback((deviceId) => {
    voiceCallService.changeMic(deviceId);
  }, []);

  const changeCamera = useCallback((deviceId) => {
    voiceCallService.changeCamera(deviceId);
  }, []);

  const changeSpeaker = useCallback((deviceId) => {
    voiceCallService.changeSpeaker(deviceId);
  }, []);

  const enumerateDevices = useCallback(() => {
    return voiceCallService.enumerateDevices();
  }, []);

  const checkCallStatus = useCallback(() => {
    return voiceCallService.checkCallStatus(waveIdRef.current);
  }, []);

  // Dock methods (v2.6.1)
  const showDock = useCallback(() => {
    voiceCallService.showDock();
  }, []);

  const hideDock = useCallback(() => {
    voiceCallService.hideDock();
  }, []);

  const toggleDockSize = useCallback(() => {
    voiceCallService.toggleDockSize();
  }, []);

  const setDockPosition = useCallback((pos) => {
    voiceCallService.setDockPosition(pos);
  }, []);

  return {
    // State from service
    connectionState: state.connectionState,
    participants: state.participants,
    isMuted: state.isMuted,
    isCameraOff: state.isCameraOff,
    isScreenSharing: state.isScreenSharing,
    audioLevel: state.audioLevel,
    error: state.error,
    livekitToken: state.livekitToken,
    livekitUrl: state.livekitUrl,
    roomName: state.roomName,
    callActive: state.callActive,
    serverParticipantCount: state.serverParticipantCount,
    activeCallWaveId: state.activeCallWaveId,
    audioDevices: state.audioDevices,
    videoDevices: state.videoDevices,
    selectedMic: state.selectedMic,
    selectedCamera: state.selectedCamera,
    selectedSpeaker: state.selectedSpeaker,
    // Dock state (v2.6.1)
    isDocked: state.isDocked,
    dockMinimized: state.dockMinimized,
    dockPosition: state.dockPosition,
    // Community voice channel (v2.118.0)
    voiceChannel: state.voiceChannel,
    can: state.can,
    rights: state.rights,
    stage: state.stage,
    onStage: state.onStage,
    handRaised: state.handRaised,
    cameraLimit: state.cameraLimit,
    e2ee: state.e2ee,
    isDeafened: state.isDeafened,
    endedBy: state.endedBy,

    // Actions
    startCall,
    leaveCall,
    toggleMute,
    toggleCamera,
    setScreenSharing,
    changeMic,
    changeCamera,
    changeSpeaker,
    enumerateDevices,
    checkCallStatus,
    // Dock actions (v2.6.1)
    showDock,
    hideDock,
    toggleDockSize,
    setDockPosition,
    // Voice channel actions (v2.118.0)
    joinVoiceChannel: voiceCallService.joinVoiceChannel.bind(voiceCallService),
    toggleDeafen: voiceCallService.toggleDeafen.bind(voiceCallService),
    clearEndedBy: voiceCallService.clearEndedBy.bind(voiceCallService),
    setLivePermissions: voiceCallService.setLivePermissions.bind(voiceCallService),
    raiseHand: voiceCallService.raiseHand.bind(voiceCallService),
    cameraFailed: voiceCallService.cameraFailed.bind(voiceCallService),
    setHandRaised: voiceCallService.setHandRaised.bind(voiceCallService),
    failVoice: voiceCallService.failVoice.bind(voiceCallService),
    rejoinVoiceChannel: voiceCallService.rejoinVoiceChannel.bind(voiceCallService),
    handleRoomDisconnected: voiceCallService.handleRoomDisconnected.bind(voiceCallService),
    setMutedByRoom: voiceCallService.setMutedByRoom.bind(voiceCallService),

    // Service methods for LiveKitCallRoom component
    setConnectionState: voiceCallService.setConnectionState.bind(voiceCallService),
    setParticipants: voiceCallService.setParticipants.bind(voiceCallService),
    setAudioLevel: voiceCallService.setAudioLevel.bind(voiceCallService),
    setRoom: voiceCallService.setRoom.bind(voiceCallService),
    roomRef: { current: voiceCallService.room },
  };
}
