import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LiveKitRoom, useParticipants, useLocalParticipant, RoomAudioRenderer, ParticipantTile, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { BASE_URL, isNativeApp } from '../../config/constants.js';

// Nested component: LiveKitCallRoom
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

  const handleDisconnected = useCallback(() => {
    console.log('🎤 Disconnected from LiveKit room');
    voiceCallRef.current.setConnectionState('disconnected');
  }, []);

  const handleError = useCallback((error) => {
    console.error('🎤 LiveKit error:', error);
    voiceCallRef.current.setConnectionState('disconnected');
  }, []);

  if (!token || !url) return null;

  // Build device constraints
  const audioDeviceId = voiceCall.selectedMic !== 'default' ? voiceCall.selectedMic : undefined;
  const videoDeviceId = voiceCall.selectedCamera !== 'default' ? voiceCall.selectedCamera : undefined;

  return (
    <LiveKitRoom
      key={token} // Only remount when token changes, not on every voiceCall state update
      token={token}
      serverUrl={url}
      connect={true}
      audio={true}
      video={!voiceCall.isCameraOff}
      onConnected={handleConnected}
      onDisconnected={handleDisconnected}
      onError={handleError}
      options={{
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          deviceId: audioDeviceId
        },
        videoCaptureDefaults: {
          resolution: {
            width: 1280,
            height: 720,
            frameRate: 30
          },
          deviceId: videoDeviceId
        }
      }}
    >
      <RoomAudioRenderer />
      <CallControls
        isMuted={voiceCall.isMuted}
        isCameraOff={voiceCall.isCameraOff}
        isScreenSharing={voiceCall.isScreenSharing}
        setParticipants={voiceCall.setParticipants}
        setAudioLevel={voiceCall.setAudioLevel}
        setScreenSharing={voiceCall.setScreenSharing}
      />
      {children}
    </LiveKitRoom>
  );
});

// Nested component: CallControls
const CallControls = ({ isMuted, isCameraOff, isScreenSharing, setParticipants, setAudioLevel, setScreenSharing }) => {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Update participants list
  useEffect(() => {
    const participantIds = participants.map(p => p.identity);
    setParticipants(participantIds);
  }, [participants, setParticipants]);

  // Monitor audio level
  useEffect(() => {
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

  // Sync mute state with LiveKit
  useEffect(() => {
    if (localParticipant) {
      localParticipant.setMicrophoneEnabled(!isMuted);
    }
  }, [isMuted, localParticipant]);

  // Sync camera state with LiveKit
  useEffect(() => {
    if (!localParticipant) return;

    const shouldEnable = !isCameraOff;
    console.log(`🎥 Syncing camera state: ${shouldEnable ? 'enabling' : 'disabling'} (isCameraOff=${isCameraOff})`);

    // Get the current camera track
    const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
    console.log(`🎥 Camera track exists: ${!!cameraPublication}, isEnabled: ${cameraPublication?.track?.isEnabled}, isMuted: ${cameraPublication?.isMuted}`);

    const updateCamera = async () => {
      try {
        if (shouldEnable) {
          // Enable camera - unmute if it was muted
          console.log('🎥 Enabling camera track...');
          const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
          if (cameraPub && cameraPub.isMuted) {
            await cameraPub.unmute();
            console.log('🎥 Camera unmuted successfully');
          } else {
            await localParticipant.setCameraEnabled(true);
            console.log('🎥 Camera enabled successfully');
          }
        } else {
          // Disable camera by muting the track (more reliable than setCameraEnabled(false))
          console.log('🎥 Disabling camera track...');
          const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
          if (cameraPub) {
            await cameraPub.mute();
            console.log('🎥 Camera muted successfully');
          } else {
            console.log('🎥 No camera track to mute');
          }
        }
      } catch (err) {
        console.error('🎥 Failed to change camera state:', err);
      }
    };

    updateCamera();
  }, [isCameraOff, localParticipant]);

  // Sync screen share state with LiveKit
  useEffect(() => {
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

// Main component: CallModal
const CallModal = ({ isOpen, onClose, wave, voiceCall, user, isMobile }) => {
  if (!isOpen || !wave || !user) return null;

  const { connectionState, participants, isMuted, isCameraOff, isScreenSharing, audioLevel, error, callActive, serverParticipantCount, checkCallStatus, setScreenSharing } = voiceCall;
  // A Community voice channel (v2.118.0) uses the same connection, but it is
  // not this wave's call. Seen from here you are not in a call, and starting
  // one moves you out of the voice channel.
  const inVoiceChannel = Boolean(voiceCall.voiceChannel);
  const livekitToken = inVoiceChannel ? null : voiceCall.livekitToken;
  const livekitUrl = inVoiceChannel ? null : voiceCall.livekitUrl;
  const isConnected = !inVoiceChannel && connectionState === 'connected';
  const isConnecting = !inVoiceChannel && connectionState === 'connecting';
  const participantCount = participants.length;

  // Check if there are actual video tracks to determine window size
  const [hasAnyVideo, setHasAnyVideo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);

  // Check call status immediately when modal opens
  useEffect(() => {
    if (isOpen && checkCallStatus) {
      setCheckingStatus(true);
      checkCallStatus().finally(() => {
        // Keep loading state for at least 300ms to prevent flickering
        setTimeout(() => setCheckingStatus(false), 300);
      });
    }
  }, [isOpen, checkCallStatus]);

  // Pop-out window handler
  const handlePopOut = useCallback(() => {
    const width = 900;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    // Build URL with call parameters
    const callUrl = `${BASE_URL}/?call=${wave.id}&popout=true`;

    const popoutWindow = window.open(
      callUrl,
      'CortexCall_' + wave.id,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no`
    );

    // Close the modal in the parent window after pop-out opens
    if (popoutWindow) {
      setTimeout(() => onClose(), 100);
    }
  }, [wave, onClose]);

  // Video Tiles and Audio Level Component (must be inside LiveKitRoom)
  const CallContent = () => {
    const tracks = useTracks([
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ]);

    // Filter for tracks that are actually enabled and publishing
    const activeTracks = tracks.filter(trackRef => {
      const track = trackRef.publication?.track;
      return track && !track.isMuted && trackRef.publication?.isSubscribed;
    });

    const hasVideoTracks = activeTracks.length > 0;

    // Update parent state when video tracks change
    useEffect(() => {
      setHasAnyVideo(hasVideoTracks);
    }, [hasVideoTracks]);

    // Calculate grid layout based on participant count
    const getGridLayout = (count) => {
      if (count === 1) return { columns: '1fr', minSize: '400px' };
      if (count === 2) return { columns: 'repeat(2, 1fr)', minSize: '300px' };
      if (count <= 4) return { columns: 'repeat(2, 1fr)', minSize: '250px' };
      if (count <= 6) return { columns: 'repeat(3, 1fr)', minSize: '200px' };
      return { columns: 'repeat(auto-fit, minmax(200px, 1fr))', minSize: '200px' };
    };

    const layout = getGridLayout(activeTracks.length);

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Video Tiles */}
        {hasVideoTracks ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: layout.columns,
            gap: '8px',
            padding: '12px',
            flex: 1,
            overflow: 'auto',
            minHeight: 0,
            alignContent: 'start'
          }}>
            {activeTracks.map((trackRef) => (
              <ParticipantTile
                key={trackRef.publication.trackSid}
                trackRef={trackRef}
                style={{
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  minHeight: layout.minSize,
                  aspectRatio: '16/9'
                }}
              />
            ))}
          </div>
        ) : (
          /* Audio level indicator (when no video) */
          <div style={{
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            flex: 1
          }}>
            <div style={{ fontSize: '3rem' }}>🎤</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Voice Only</div>
            {audioLevel > 0 && !isMuted && (
              <div style={{ width: '200px' }}>
                <div style={{
                  height: '4px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    background: 'var(--accent-green)',
                    width: `${audioLevel * 100}%`,
                    transition: 'width 0.1s ease-out'
                  }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: isMobile ? '0' : '20px'
    }}
      onClick={onClose}
    >
      <div style={{
        background: 'var(--bg-primary)',
        border: isMobile ? 'none' : '1px solid var(--border-primary)',
        borderRadius: isMobile ? '0' : '8px',
        width: isMobile ? '100%' : (hasAnyVideo ? 'min(900px, 90vw)' : '400px'),
        height: isMobile ? '100%' : (hasAnyVideo ? 'min(700px, 85vh)' : 'auto'),
        maxHeight: isMobile ? '100%' : '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.3s ease, height 0.3s ease'
      }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-elevated)',
          flexShrink: 0
        }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
              {isConnecting ? '📞 Connecting...' : isConnected ? '📞 In Call' : '📞 Voice/Video Call'}
            </div>
            {isConnected && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {participantCount} participant{participantCount !== 1 ? 's' : ''} • {wave.title}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isConnected && !isNativeApp && (
              <button
                onClick={handlePopOut}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  padding: '4px 8px',
                  lineHeight: 1
                }}
                title="Pop Out"
              >
                ⧉
              </button>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: '4px 8px',
                lineHeight: 1
              }}
              title="Settings"
            >
              ⚙️
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '1.5rem',
                padding: '4px 8px',
                lineHeight: 1
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {!isConnected && !isConnecting && !livekitToken ? (
            // Not in call - show start/join UI
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px'
            }}>
              {checkingStatus ? (
                <>
                  <div style={{
                    fontSize: '3rem',
                    marginBottom: '20px'
                  }}>📞</div>
                  <div style={{
                    fontSize: '1.2rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '30px'
                  }}>
                    Checking call status...
                  </div>
                </>
              ) : callActive ? (
                <>
                  <div style={{
                    fontSize: '3rem',
                    marginBottom: '20px'
                  }}>📞</div>
                  <div style={{
                    fontSize: '1.2rem',
                    color: 'var(--accent-green)',
                    marginBottom: '8px',
                    fontWeight: 'bold'
                  }}>
                    Call in Progress
                  </div>
                  <div style={{
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '30px'
                  }}>
                    {serverParticipantCount > 0
                      ? `${serverParticipantCount} participant${serverParticipantCount !== 1 ? 's' : ''} in call`
                      : 'Someone is connecting...'}
                  </div>
                  <button
                    onClick={() => {
                      voiceCall.startCall(false);
                      onClose(); // Close modal, call will auto-dock
                    }}
                    disabled={!!error}
                    style={{
                      padding: '14px 32px',
                      background: 'var(--accent-green)',
                      color: 'var(--bg-primary)',
                      border: '1px solid var(--accent-green)',
                      borderRadius: '6px',
                      cursor: error ? 'not-allowed' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      opacity: error ? 0.5 : 1
                    }}
                  >
                    Join Call
                  </button>
                </>
              ) : (
                <>
                  <div style={{
                    fontSize: '3rem',
                    marginBottom: '20px'
                  }}>📞</div>
                  <div style={{
                    fontSize: '1.2rem',
                    color: 'var(--text-primary)',
                    marginBottom: '30px'
                  }}>
                    Start a call
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                      onClick={() => {
                        voiceCall.startCall(false);
                        onClose(); // Close modal, call will auto-dock
                      }}
                      disabled={!!error}
                      style={{
                        padding: '14px 32px',
                        background: 'var(--accent-green)',
                        color: 'var(--bg-primary)',
                        border: '1px solid var(--accent-green)',
                        borderRadius: '6px',
                        cursor: error ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        opacity: error ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      🎤 Voice Call
                    </button>
                    <button
                      onClick={() => {
                        voiceCall.startCall(true);
                        onClose(); // Close modal, call will auto-dock
                      }}
                      disabled={!!error}
                      style={{
                        padding: '14px 32px',
                        background: 'var(--accent-teal-bg)',
                        color: 'var(--accent-teal)',
                        border: '1px solid var(--accent-teal)',
                        borderRadius: '6px',
                        cursor: error ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        opacity: error ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      🎥 Video Call
                    </button>
                  </div>
                </>
              )}
              {error && (
                <div style={{
                  marginTop: '20px',
                  padding: '12px 20px',
                  background: 'var(--error-bg)',
                  border: '1px solid var(--error-border)',
                  borderRadius: '4px',
                  color: 'var(--error-text)',
                  fontSize: '0.85rem',
                  maxWidth: '400px',
                  textAlign: 'center'
                }}>
                  {error}
                </div>
              )}
            </div>
          ) : (
            // In call - show video tiles and controls
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0 }}>
              {livekitToken && livekitUrl && !voiceCall.isDocked && (
                <LiveKitCallRoom
                  token={livekitToken}
                  url={livekitUrl}
                  roomName={wave.id}
                  voiceCall={voiceCall}
                >
                  <CallContent />
                </LiveKitCallRoom>
              )}
              {voiceCall.isDocked && (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  color: 'var(--text-dim)',
                  fontSize: '1.1rem'
                }}>
                  Call is docked. Check the floating window.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)',
            maxHeight: '300px',
            overflowY: 'auto',
            flexShrink: 0
          }}>
            <div style={{
              fontSize: '0.9rem',
              fontWeight: 'bold',
              color: 'var(--text-primary)',
              marginBottom: '12px'
            }}>
              Device Settings
            </div>

            {/* Microphone Selection */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                fontFamily: 'monospace'
              }}>
                Microphone
              </label>
              <select
                value={voiceCall.selectedMic}
                onChange={(e) => voiceCall.changeMic(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem'
                }}
              >
                <option value="default">Default Microphone</option>
                {voiceCall.audioDevices
                  .filter(d => d.kind === 'audioinput')
                  .map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
              </select>
            </div>

            {/* Camera Selection */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                fontFamily: 'monospace'
              }}>
                Camera
              </label>
              <select
                value={voiceCall.selectedCamera}
                onChange={(e) => voiceCall.changeCamera(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem'
                }}
              >
                <option value="default">Default Camera</option>
                {voiceCall.videoDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Speaker Selection */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '4px',
                fontFamily: 'monospace'
              }}>
                Speaker
              </label>
              <select
                value={voiceCall.selectedSpeaker}
                onChange={(e) => voiceCall.changeSpeaker(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem'
                }}
              >
                <option value="default">Default Speaker</option>
                {voiceCall.audioDevices
                  .filter(d => d.kind === 'audiooutput')
                  .map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{
              fontSize: '0.7rem',
              color: 'var(--text-dim)',
              fontStyle: 'italic',
              marginTop: '12px'
            }}>
              Note: Changes will apply to new calls. You may need to rejoin for changes to take effect.
            </div>
          </div>
        )}

        {/* Controls (when connected) */}
        {isConnected && (
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-primary)',
            background: 'var(--bg-elevated)',
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            flexShrink: 0
          }}>
            <button
              onClick={voiceCall.toggleMute}
              style={{
                padding: '12px 24px',
                background: isMuted ? 'var(--error-bg)' : 'var(--bg-secondary)',
                color: isMuted ? 'var(--error-text)' : 'var(--text-primary)',
                border: `1px solid ${isMuted ? 'var(--error-border)' : 'var(--border)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isMuted ? '🔇' : '🎤'} {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={voiceCall.toggleCamera}
              style={{
                padding: '12px 24px',
                background: isCameraOff ? 'var(--bg-secondary)' : 'var(--accent-teal-bg)',
                color: isCameraOff ? 'var(--text-primary)' : 'var(--accent-teal)',
                border: `1px solid ${isCameraOff ? 'var(--border)' : 'var(--accent-teal)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isCameraOff ? '📹' : '🎥'} {isCameraOff ? 'Start Video' : 'Stop Video'}
            </button>
            <button
              onClick={() => setScreenSharing(!isScreenSharing)}
              style={{
                padding: '12px 24px',
                background: isScreenSharing ? 'var(--accent-amber)20' : 'var(--bg-secondary)',
                color: isScreenSharing ? 'var(--accent-amber)' : 'var(--text-primary)',
                border: `1px solid ${isScreenSharing ? 'var(--accent-amber)' : 'var(--border)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isScreenSharing ? '🖥️' : '🖥️'} {isScreenSharing ? 'Stop Share' : 'Share Screen'}
            </button>
            <button
              onClick={() => {
                voiceCall.leaveCall();
                onClose();
              }}
              style={{
                padding: '12px 24px',
                background: 'var(--error-bg)',
                color: 'var(--error-text)',
                border: '1px solid var(--error-border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              📞 Leave
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CallModal;
