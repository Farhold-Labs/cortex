import React, { useRef, useCallback, useState, useEffect } from 'react';
import { LiveKitRoom, useParticipants, useLocalParticipant, useRoomContext, RoomAudioRenderer, ParticipantTile, useTracks } from '@livekit/components-react';
import { Track, Room, ExternalE2EEKeyProvider, isE2EESupported } from 'livekit-client';
// The media encryption worker (v2.119.0), bundled as its own file by Vite.
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import { useDraggable } from '../../hooks/useDraggable.js';
import { Avatar } from '../ui/SimpleComponents.jsx';

// Reuse LiveKitCallRoom from CallModal
// Use refs to prevent callback recreation and avoid unnecessary LiveKit reconnection attempts
const LiveKitCallRoom = React.memo(({ token, url, roomName, voiceCall, children }) => {
  // Store voiceCall in ref to avoid recreating callbacks
  const voiceCallRef = useRef(voiceCall);
  voiceCallRef.current = voiceCall;

  // Stable callbacks that don't change on every render
  const handleConnected = useCallback(() => {
    console.log('🎤 Connected to LiveKit room:', roomName);
    voiceCallRef.current.setConnectionState('connected');
  }, [roomName]);

  const handleDisconnected = useCallback((reason) => {
    console.log('🎤 Disconnected from LiveKit room', reason);
    // The service decides what an ending means: for a voice channel it is final.
    voiceCallRef.current.handleRoomDisconnected(reason);
  }, []);

  const handleError = useCallback((error) => {
    console.error('🎤 LiveKit error:', error);
    voiceCallRef.current.setConnectionState('disconnected');
  }, []);

  const audioDeviceId = voiceCall.selectedMic !== 'default' ? voiceCall.selectedMic : undefined;
  const videoDeviceId = voiceCall.selectedCamera !== 'default' ? voiceCall.selectedCamera : undefined;
  const roomOptions = {
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      deviceId: audioDeviceId
    },
    videoCaptureDefaults: {
      resolution: { width: 1280, height: 720, frameRate: 30 },
      deviceId: videoDeviceId
    }
  };

  // Voice channels encrypt their media end to end against LiveKit (v2.119.0).
  // The key comes with the join token; the Room is built with it before it
  // connects, so not one packet leaves unencrypted.
  const encrypted = useEncryptedRoom(token, voiceCall.e2ee, roomOptions, voiceCallRef);

  if (!token || !url) return null;
  if (voiceCall.e2ee && !encrypted) return null; // still setting up, or refused

  return (
    <LiveKitRoom
      key={token} // Only remount when token changes, not on every voiceCall state update
      token={token}
      serverUrl={url}
      connect={true}
      room={encrypted || undefined}
      // Only publish a microphone that is meant to be live. A voice channel is
      // joined muted, and with audio={true} the mic went out until the mute
      // effect caught up — a moment of open mic in a room full of people.
      audio={voiceCall.can.speak && !voiceCall.isMuted}
      video={!voiceCall.isCameraOff}
      onConnected={handleConnected}
      onDisconnected={handleDisconnected}
      onError={handleError}
      options={roomOptions}
    >
      <RoomAudioRenderer muted={voiceCall.isDeafened} />
      <CallControls
        canSpeak={voiceCall.can.speak}
        isVoiceChannel={Boolean(voiceCall.voiceChannel)}
        expectedRoomSid={voiceCall.e2ee?.roomSid || null}
        onWrongRoom={voiceCall.rejoinVoiceChannel}
        onPermissions={voiceCall.setLivePermissions}
        onCameraFailed={voiceCall.cameraFailed}
        onMutedByRoom={voiceCall.setMutedByRoom}
        isMuted={voiceCall.isMuted}
        isCameraOff={voiceCall.isCameraOff}
        isScreenSharing={voiceCall.isScreenSharing}
        setParticipants={voiceCall.setParticipants}
        setAudioLevel={voiceCall.setAudioLevel}
        setRoom={voiceCall.setRoom}
        setScreenSharing={voiceCall.setScreenSharing}
      />
      {children}
    </LiveKitRoom>
  );
});

/**
 * A LiveKit Room set up for end-to-end encrypted media, or null while it is
 * being made. A browser without the encoded-transform APIs cannot take part —
 * it would send clear media and hear noise — so it is refused with a reason.
 */
function useEncryptedRoom(token, e2ee, roomOptions, voiceCallRef) {
  const [room, setRoom] = useState(null);
  const optionsRef = useRef(roomOptions);
  optionsRef.current = roomOptions;
  useEffect(() => {
    setRoom(null);
    if (!token || !e2ee?.key) return undefined;
    if (!isE2EESupported()) {
      voiceCallRef.current.failVoice('This browser cannot join encrypted voice channels. Update it, or use the Cortex app.');
      return undefined;
    }
    let cancelled = false;
    const keyProvider = new ExternalE2EEKeyProvider();
    const worker = new E2EEWorker();
    const r = new Room({ ...optionsRef.current, e2ee: { keyProvider, worker } });
    (async () => {
      await keyProvider.setKey(e2ee.key);
      await r.setE2EEEnabled(true);
      if (!cancelled) setRoom(r);
    })().catch(err => {
      console.error('🔒 Media encryption setup failed:', err);
      if (!cancelled) voiceCallRef.current.failVoice('Could not set up encryption for this voice channel');
    });
    return () => {
      cancelled = true;
      r.disconnect().catch(() => {});
      worker.terminate();
    };
  }, [token, e2ee?.key, voiceCallRef]);
  return room;
}

// LiveKit's TrackSource numbers, as they appear in a participant's permissions.
const PERMISSION_SOURCE = { camera: 1, microphone: 2, screen: 3 };

// Call controls that sync with LiveKit
const CallControls = ({ canSpeak = true, isVoiceChannel = false, expectedRoomSid = null, onWrongRoom, onPermissions, onCameraFailed, onMutedByRoom, isMuted, isCameraOff, isScreenSharing, setParticipants, setAudioLevel, setRoom, setScreenSharing }) => {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  // The key is made from the room's session. If the room closed and opened
  // again between the token and the join, everyone else has the new session's
  // key and we have the old one: join again for a fresh token.
  useEffect(() => {
    if (!expectedRoomSid || !room || !onWrongRoom) return undefined;
    let done = false;
    const check = async () => {
      if (done) return;
      try {
        const sid = await room.getSid();
        if (!done && sid && sid !== expectedRoomSid) { done = true; onWrongRoom(); }
      } catch { /* not connected yet */ }
    };
    room.on('connected', check);
    if (room.state === 'connected') check();
    return () => { done = true; room.off('connected', check); };
  }, [room, expectedRoomSid, onWrongRoom]);

  // What we may publish can change during a voice channel call (v2.119.0): a
  // host brings us up, the cameras fill, a role changes. LiveKit tells us.
  useEffect(() => {
    if (!isVoiceChannel || !localParticipant || !onPermissions) return undefined;
    const update = () => {
      const perm = localParticipant.permissions;
      if (!perm) return;
      const list = perm.canPublishSources || [];
      const may = (src) => Boolean(perm.canPublish) && (list.length === 0 || list.includes(src));
      onPermissions({ speak: may(PERMISSION_SOURCE.microphone), video: may(PERMISSION_SOURCE.camera), screen: may(PERMISSION_SOURCE.screen) });
    };
    localParticipant.on('participantPermissionsChanged', update);
    update();
    return () => { localParticipant.off('participantPermissionsChanged', update); };
  }, [isVoiceChannel, localParticipant, onPermissions]);

  React.useEffect(() => {
    const participantIds = participants.map(p => p.identity);
    setParticipants(participantIds);
  }, [participants, setParticipants]);

  React.useEffect(() => {
    if (!localParticipant) return;

    const interval = setInterval(() => {
      const audioTrack = localParticipant.getTrackPublication(Track.Source.Microphone);
      if (audioTrack?.track) {
        const level = audioTrack.isSpeaking ? 0.7 : 0.1;
        setAudioLevel(level);
      } else {
        setAudioLevel(0);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [localParticipant, setAudioLevel]);

  // A moderator's server-side mute arrives as a mute of our own track. Without
  // this the dock would go on showing a live microphone that nobody can hear.
  React.useEffect(() => {
    if (!localParticipant || !onMutedByRoom) return;
    const onMuted = (publication) => {
      if (publication?.source === Track.Source.Microphone) onMutedByRoom();
    };
    localParticipant.on('trackMuted', onMuted);
    return () => { localParticipant.off('trackMuted', onMuted); };
  }, [localParticipant, onMutedByRoom]);

  React.useEffect(() => {
    // Without voice.speak the token cannot publish a microphone; asking would
    // only produce a permissions error.
    if (localParticipant && canSpeak) {
      localParticipant.setMicrophoneEnabled(!isMuted).catch?.(err => console.error('🎤 Microphone change failed:', err));
    }
  }, [isMuted, localParticipant, canSpeak]);

  React.useEffect(() => {
    if (!localParticipant) return;

    const updateCamera = async () => {
      try {
        const shouldEnable = !isCameraOff;
        if (shouldEnable) {
          const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
          if (cameraPub && cameraPub.isMuted) {
            await cameraPub.unmute();
          } else {
            await localParticipant.setCameraEnabled(true);
          }
        } else {
          // Off means unpublished, not muted (v2.119.0). A muted camera was
          // still a published one: it went on showing as 📷 in the channel
          // list, and it held one of the room's camera places.
          const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
          if (cameraPub?.track) {
            await localParticipant.unpublishTrack(cameraPub.track);
          }
        }
      } catch (err) {
        console.error('🎥 Failed to change camera state:', err);
        // Refused (the cameras are full, or no permission): show it as off.
        if (!isCameraOff && onCameraFailed) onCameraFailed();
      }
    };

    updateCamera();
  }, [isCameraOff, localParticipant, onCameraFailed]);

  // Sync screen share state with LiveKit
  React.useEffect(() => {
    if (!localParticipant) return;

    const updateScreenShare = async () => {
      try {
        const screenPub = localParticipant.getTrackPublication(Track.Source.ScreenShare);
        const isCurrentlySharing = screenPub && !screenPub.isMuted;

        if (isScreenSharing && !isCurrentlySharing) {
          console.log('🖥️ Enabling screen share...');
          await localParticipant.setScreenShareEnabled(true);
          console.log('🖥️ Screen share enabled');
        } else if (!isScreenSharing && isCurrentlySharing) {
          console.log('🖥️ Disabling screen share...');
          await localParticipant.setScreenShareEnabled(false);
          console.log('🖥️ Screen share disabled');
        }
      } catch (err) {
        console.error('🖥️ Failed to change screen share state:', err);
        // If user cancelled or error occurred, reset the state
        if (setScreenSharing) {
          setScreenSharing(false);
        }
      }
    };

    updateScreenShare();
  }, [isScreenSharing, localParticipant, setScreenSharing]);

  return null;
};

// Main DockedCallWindow component
const DockedCallWindow = ({ voiceCall, isMobile, user }) => {
  const windowRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // All hooks must be called unconditionally before any early returns
  const handlePositionChange = useCallback((newPos) => {
    voiceCall.setDockPosition(newPos);
  }, [voiceCall]);

  const { position, isDragging, handleMouseDown } = useDraggable(windowRef, {
    onPositionChange: handlePositionChange,
    initialPosition: voiceCall.dockPosition,
    disabled: isMobile || isFullscreen
  });

  const handleClose = useCallback(() => {
    voiceCall.hideDock();
  }, [voiceCall]);

  const handleToggleSize = useCallback(() => {
    voiceCall.toggleDockSize();
  }, [voiceCall]);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  const handleToggleMute = useCallback(() => {
    voiceCall.toggleMute();
  }, [voiceCall]);

  const handleToggleCamera = useCallback(() => {
    voiceCall.toggleCamera();
  }, [voiceCall]);

  const handleToggleDeafen = useCallback(() => {
    voiceCall.toggleDeafen();
  }, [voiceCall]);

  const handleToggleScreenShare = useCallback(() => {
    voiceCall.setScreenSharing(!voiceCall.isScreenSharing);
  }, [voiceCall]);

  const handleLeaveCall = useCallback(() => {
    voiceCall.leaveCall();
  }, [voiceCall]);

  const handleToggleHand = useCallback(() => {
    voiceCall.raiseHand(!voiceCall.handRaised);
  }, [voiceCall]);

  // No token means no active call - don't render anything
  // Also don't render if dock is hidden - CallModal will handle the LiveKitRoom when !isDocked
  if (!voiceCall.livekitToken || !voiceCall.livekitUrl || !voiceCall.isDocked) {
    return null;
  }

  // Fullscreen style
  const fullscreenStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 2000,
    background: 'var(--bg-base)',
    border: 'none',
    boxShadow: 'none',
    display: 'flex',
    flexDirection: 'column',
  };

  // Mobile: fixed bottom position
  const containerStyle = isFullscreen ? fullscreenStyle : (isMobile ? {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: voiceCall.dockMinimized ? '60px' : '70vh',
    zIndex: 1500,
    background: 'var(--bg-surface)',
    border: '1px solid var(--accent-teal)',
    borderBottom: 'none',
    boxShadow: '0 -4px 12px rgba(0, 255, 170, 0.2)',
    display: 'flex',
    flexDirection: 'column',
  } : {
    // Desktop: draggable position
    position: 'fixed',
    left: `${position.x}px`,
    top: `${position.y}px`,
    width: `${position.width}px`,
    height: voiceCall.dockMinimized ? '80px' : `${position.height}px`,
    zIndex: 1500,
    background: 'var(--bg-surface)',
    border: '1px solid var(--accent-teal)',
    boxShadow: '0 4px 12px rgba(0, 255, 170, 0.3)',
    cursor: isDragging ? 'grabbing' : 'default',
    display: 'flex',
    flexDirection: 'column',
  });

  const headerStyle = {
    padding: isMobile ? '8px 12px' : '10px 14px',
    background: 'var(--bg-hover)',
    borderBottom: voiceCall.dockMinimized ? 'none' : '1px solid var(--accent-teal)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: isMobile ? 'default' : 'grab',
    userSelect: 'none',
  };

  const buttonStyle = {
    background: 'transparent',
    border: '1px solid var(--accent-teal)',
    color: 'var(--accent-teal)',
    cursor: 'pointer',
    padding: '4px 8px',
    fontSize: '0.9rem',
    marginLeft: '4px',
  };

  const controlButtonStyle = {
    ...buttonStyle,
    fontSize: isMobile ? '1rem' : '0.85rem',
    padding: isMobile ? '8px 12px' : '6px 12px',
    whiteSpace: 'nowrap',
  };
  // The minimised bar's buttons, narrower on a phone so four fit beside the
  // label at 360 px. Still a 40 px touch target in height.
  const barButtonStyle = {
    ...controlButtonStyle,
    marginLeft: 0,
    padding: isMobile ? '8px 9px' : '6px 12px',
    flexShrink: 0,
  };

  // A stage listener: no microphone, a hand to raise instead (v2.119.0).
  const inAudience = Boolean(voiceCall.voiceChannel && voiceCall.stage && !voiceCall.onStage);
  // Allowed a camera, but the room's camera places are taken.
  const camerasFull = Boolean(voiceCall.voiceChannel && voiceCall.onStage && voiceCall.rights?.video && !voiceCall.can.video);

  // Single LiveKitRoom instance that persists across minimize/maximize/hide states
  // Wrap everything in LiveKitRoom so we have ONE connection only
  return (
    <LiveKitCallRoom
      token={voiceCall.livekitToken}
      url={voiceCall.livekitUrl}
      roomName={voiceCall.roomName}
      voiceCall={voiceCall}
    >
      {/* Dock window UI */}
      <div ref={windowRef} style={containerStyle}>
        {/* Header */}
        <div
          style={headerStyle}
          onMouseDown={isMobile ? undefined : handleMouseDown}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            {/* One line, truncated: on a phone the minimised bar also holds four
                buttons, and a wrapping label pushed them off the edge. */}
            <span style={{
              color: 'var(--accent-teal)', fontSize: isMobile ? '0.9rem' : '0.85rem',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
            }}>
              {voiceCall.voiceChannel
                ? <>{!voiceCall.dockMinimized && voiceCall.e2ee ? <span title="Encrypted end to end: LiveKit cannot hear or see it">🔒 </span> : null}{voiceCall.stage ? '🎤' : '🔊'} {voiceCall.voiceChannel.name}</>
                : <>{voiceCall.dockMinimized ? '🎤 In Call' : '📞 Call'}</>} • {voiceCall.participants.length || 0}{voiceCall.voiceChannel ? '' : ` participant${voiceCall.participants.length !== 1 ? 's' : ''}`}
            </span>
            {voiceCall.audioLevel > 0.3 && (
              <span style={{ color: 'var(--accent-green)', fontSize: '0.7rem' }}>●</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: voiceCall.dockMinimized ? (isMobile ? '4px' : '6px') : '4px', alignItems: 'center', flexShrink: 0 }}>
            {voiceCall.dockMinimized && (
              <>
                {voiceCall.can.speak && (
                  <button
                    style={barButtonStyle}
                    onClick={handleToggleMute}
                    data-draggable="false"
                    title={voiceCall.isMuted ? 'Unmute' : 'Mute'}
                    aria-label={voiceCall.isMuted ? 'Unmute' : 'Mute'}
                  >
                    {voiceCall.isMuted ? '🔇' : '🎤'}
                  </button>
                )}
                {inAudience && (
                  <button
                    style={{ ...barButtonStyle, ...(voiceCall.handRaised ? { background: 'var(--accent-amber)', color: 'var(--bg-base)' } : {}) }}
                    onClick={handleToggleHand}
                    data-draggable="false"
                    title={voiceCall.handRaised ? 'Lower your hand' : 'Raise your hand to speak'}
                    aria-label={voiceCall.handRaised ? 'Lower hand' : 'Raise hand'}
                  >
                    ✋
                  </button>
                )}
                {voiceCall.voiceChannel && (
                  <button
                    style={barButtonStyle}
                    onClick={handleToggleDeafen}
                    data-draggable="false"
                    title={voiceCall.isDeafened ? 'Undeafen' : 'Deafen'}
                    aria-label={voiceCall.isDeafened ? 'Undeafen' : 'Deafen'}
                  >
                    {voiceCall.isDeafened ? '🙉' : '🎧'}
                  </button>
                )}
                {voiceCall.can.video && (
                  <button
                    style={barButtonStyle}
                    onClick={handleToggleCamera}
                    data-draggable="false"
                    title={voiceCall.isCameraOff ? 'Turn camera on' : 'Turn camera off'}
                    aria-label={voiceCall.isCameraOff ? 'Turn camera on' : 'Turn camera off'}
                  >
                    {voiceCall.isCameraOff ? '📹' : '📷'}
                  </button>
                )}
                <button
                  style={barButtonStyle}
                  onClick={handleLeaveCall}
                  data-draggable="false"
                  title={voiceCall.voiceChannel ? 'Leave voice channel' : 'Leave call'}
                  aria-label={voiceCall.voiceChannel ? 'Leave voice channel' : 'Leave call'}
                >
                  📞
                </button>
              </>
            )}
            {!voiceCall.dockMinimized && (
              <button
                style={buttonStyle}
                onClick={handleToggleFullscreen}
                data-draggable="false"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? '⊡' : '⛶'}
              </button>
            )}
            {!isFullscreen && (
              <button
                style={buttonStyle}
                onClick={handleToggleSize}
                data-draggable="false"
                title={voiceCall.dockMinimized ? 'Maximize' : 'Minimize'}
              >
                {voiceCall.dockMinimized ? '□' : '_'}
              </button>
            )}
            {/* A wave call hands its connection to the wave's call screen when the
                dock closes. A voice channel has no such screen, so closing the
                dock would silently drop you from the room: it minimises instead. */}
            {(isFullscreen || !voiceCall.voiceChannel) && (
              <button
                style={buttonStyle}
                onClick={isFullscreen ? handleToggleFullscreen : handleClose}
                data-draggable="false"
                title={isFullscreen ? 'Exit fullscreen' : 'Close dock'}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Video tiles area - only shown when maximized or fullscreen */}
        {(isFullscreen || !voiceCall.dockMinimized) && (
          <>
            <div style={{
              flex: 1,
              overflow: 'auto',
              background: 'var(--bg-primary)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              padding: '8px',
              alignContent: 'flex-start',
            }}>
              <VideoTiles />
            </div>

            {/* Controls footer */}
            <div style={{
              padding: isMobile ? '12px' : '10px',
              background: 'var(--bg-hover)',
              borderTop: '1px solid var(--accent-teal)',
              display: 'flex',
              justifyContent: 'center',
              // Wraps: five buttons do not fit a phone, and a centred row that
              // overflows is clipped at BOTH ends, beyond reach of scrolling.
              flexWrap: 'wrap',
              gap: '8px',
            }}>
              {voiceCall.can.speak && <button
                style={{
                  ...controlButtonStyle,
                  background: voiceCall.isMuted ? 'var(--accent-orange)' : 'transparent',
                  borderColor: voiceCall.isMuted ? 'var(--accent-orange)' : 'var(--accent-teal)',
                  color: voiceCall.isMuted ? 'var(--text-primary)' : 'var(--accent-teal)',
                }}
                onClick={handleToggleMute}
              >
                {voiceCall.isMuted ? '🔇 Muted' : '🎤 Mute'}
              </button>}
              {inAudience && (
                <button
                  style={{
                    ...controlButtonStyle,
                    background: voiceCall.handRaised ? 'var(--accent-amber)' : 'transparent',
                    borderColor: voiceCall.handRaised ? 'var(--accent-amber)' : 'var(--accent-teal)',
                    color: voiceCall.handRaised ? 'var(--bg-base)' : 'var(--accent-teal)',
                  }}
                  onClick={handleToggleHand}
                >
                  {voiceCall.handRaised ? '✋ Hand raised' : '✋ Raise hand'}
                </button>
              )}
              {voiceCall.voiceChannel && (
                <button
                  style={{
                    ...controlButtonStyle,
                    background: voiceCall.isDeafened ? 'var(--accent-orange)' : 'transparent',
                    borderColor: voiceCall.isDeafened ? 'var(--accent-orange)' : 'var(--accent-teal)',
                    color: voiceCall.isDeafened ? 'var(--text-primary)' : 'var(--accent-teal)',
                  }}
                  onClick={handleToggleDeafen}
                >
                  {voiceCall.isDeafened ? '🙉 Deafened' : '🎧 Deafen'}
                </button>
              )}
              {voiceCall.can.video && <button
                style={{
                  ...controlButtonStyle,
                  background: voiceCall.isCameraOff ? 'var(--accent-amber)' : 'transparent',
                  borderColor: voiceCall.isCameraOff ? 'var(--accent-amber)' : 'var(--accent-teal)',
                  color: voiceCall.isCameraOff ? 'var(--text-primary)' : 'var(--accent-teal)',
                }}
                onClick={handleToggleCamera}
              >
                {voiceCall.isCameraOff ? '📹 Camera Off' : '📷 Camera On'}
              </button>}
              {camerasFull && (
                <button style={{ ...controlButtonStyle, opacity: 0.5, cursor: 'default' }} disabled
                  title={`This channel allows ${voiceCall.cameraLimit || 'a few'} cameras at once`}>
                  📹 Cameras full
                </button>
              )}
              {voiceCall.can.screen && <button
                style={{
                  ...controlButtonStyle,
                  background: voiceCall.isScreenSharing ? 'var(--accent-green)' : 'transparent',
                  borderColor: voiceCall.isScreenSharing ? 'var(--accent-green)' : 'var(--accent-teal)',
                  color: voiceCall.isScreenSharing ? 'var(--text-primary)' : 'var(--accent-teal)',
                }}
                onClick={handleToggleScreenShare}
              >
                {voiceCall.isScreenSharing ? '🖥️ Stop Share' : '🖥️ Share'}
              </button>}
              <button
                style={{
                  ...controlButtonStyle,
                  background: 'var(--accent-orange)',
                  borderColor: 'var(--accent-orange)',
                  color: 'var(--text-primary)',
                }}
                onClick={handleLeaveCall}
              >
                📞 Leave
              </button>
            </div>
          </>
        )}
      </div>
    </LiveKitCallRoom>
  );
};

// Video tiles component with focus capability
const VideoTiles = () => {
  const [focusedTrackId, setFocusedTrackId] = useState(null);

  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: false },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  // Filter for tracks that are actually enabled and publishing
  const activeTracks = tracks.filter(trackRef => {
    const track = trackRef.publication?.track;
    return track && !track.isMuted && trackRef.publication?.isSubscribed;
  });

  // Handle click to focus/unfocus
  const handleTrackClick = (trackId) => {
    setFocusedTrackId(prev => prev === trackId ? null : trackId);
  };

  if (activeTracks.length === 0) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-dim)', textAlign: 'center', width: '100%' }}>
        No video tracks yet
      </div>
    );
  }

  // Find focused track
  const focusedTrack = focusedTrackId
    ? activeTracks.find(t => t.publication.trackSid === focusedTrackId)
    : null;
  const otherTracks = focusedTrack
    ? activeTracks.filter(t => t.publication.trackSid !== focusedTrackId)
    : activeTracks;

  // If there's a focused track, show it large with thumbnails
  if (focusedTrack) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px' }}>
        {/* Focused video - main area */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            background: 'var(--bg-base)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            border: '2px solid var(--accent-teal)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
          onClick={() => handleTrackClick(focusedTrackId)}
          title="Click to unfocus"
        >
          <ParticipantTile
            trackRef={focusedTrack}
            style={{
              width: '100%',
              height: '100%',
              background: 'transparent',
            }}
          />
          {/* Unfocus hint */}
          <div style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(0,0,0,0.6)',
            color: 'var(--accent-teal)',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '0.7rem',
            fontFamily: 'monospace',
          }}>
            Click to unfocus
          </div>
        </div>

        {/* Thumbnail strip */}
        {otherTracks.length > 0 && (
          <div style={{
            display: 'flex',
            gap: '8px',
            height: '100px',
            flexShrink: 0,
          }}>
            {otherTracks.map((trackRef) => (
              <div
                key={trackRef.publication.trackSid}
                style={{
                  width: '140px',
                  height: '100%',
                  position: 'relative',
                  cursor: 'pointer',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  background: 'var(--bg-surface)',
                }}
                onClick={() => handleTrackClick(trackRef.publication.trackSid)}
                title="Click to focus"
              >
                <ParticipantTile
                  trackRef={trackRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    background: 'transparent',
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // No focused track - show grid layout
  // Calculate grid based on number of tracks
  const getGridStyle = (count) => {
    if (count === 1) {
      return { gridTemplateColumns: '1fr' };
    } else if (count === 2) {
      return { gridTemplateColumns: '1fr 1fr' };
    } else if (count <= 4) {
      return { gridTemplateColumns: '1fr 1fr' };
    } else {
      return { gridTemplateColumns: 'repeat(3, 1fr)' };
    }
  };

  return (
    <div style={{
      display: 'grid',
      ...getGridStyle(activeTracks.length),
      gap: '8px',
      height: '100%',
      alignContent: 'center',
    }}>
      {activeTracks.map((trackRef) => {
        const isScreenShare = trackRef.source === Track.Source.ScreenShare;
        return (
          <div
            key={trackRef.publication.trackSid}
            style={{
              position: 'relative',
              aspectRatio: isScreenShare ? '16/9' : '4/3',
              minHeight: '120px',
              maxHeight: activeTracks.length === 1 ? '100%' : '300px',
              cursor: 'pointer',
              border: '1px solid var(--border-primary)',
              borderRadius: '4px',
              overflow: 'hidden',
              background: 'var(--bg-surface)',
            }}
            onClick={() => handleTrackClick(trackRef.publication.trackSid)}
            title="Click to focus"
          >
            <ParticipantTile
              trackRef={trackRef}
              style={{
                width: '100%',
                height: '100%',
                background: 'transparent',
              }}
            />
            {/* Source label */}
            <div style={{
              position: 'absolute',
              bottom: '4px',
              left: '4px',
              background: 'rgba(0,0,0,0.6)',
              color: 'var(--text-secondary)',
              padding: '2px 6px',
              borderRadius: '3px',
              fontSize: '0.65rem',
              fontFamily: 'monospace',
            }}>
              {isScreenShare ? '🖥️ Screen' : '📷 Camera'} • {trackRef.participant?.name || trackRef.participant?.identity || 'Unknown'}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DockedCallWindow;
