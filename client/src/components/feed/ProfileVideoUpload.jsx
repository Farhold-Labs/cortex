import React, { useState, useRef, useCallback } from 'react';
import MediaRecorder from '../media/MediaRecorder.jsx';
import { uploadFile } from '../../utils/uploads.js';

/**
 * ProfileVideoUpload Component (v2.9.0)
 *
 * Modal for recording/uploading profile videos.
 * Supports camera recording and file upload with caption.
 *
 * Props:
 * - fetchAPI: API fetch function
 * - showToast: Toast notification function
 * - onClose: Close modal callback
 * - onVideoPosted: Callback when video is posted (receives ping data)
 * - isMobile: Boolean for mobile-specific styling
 */
const ProfileVideoUpload = ({
  fetchAPI,
  showToast,
  onClose,
  onVideoPosted,
  isMobile,
}) => {
  const [mode, setMode] = useState(null); // 'record' | 'upload' | 'preparing'
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  const fileInputRef = useRef(null);

  // Handle file selection
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    console.log('File selected:', file ? { name: file.name, size: file.size, type: file.type } : 'none');

    // Reset file input so same file can be selected again
    if (e.target) e.target.value = '';

    if (!file) {
      console.log('No file selected');
      return;
    }

    // Validate file type
    if (!file.type.startsWith('video/')) {
      console.log('Invalid file type:', file.type);
      onClose?.(); // Close modal first so toast is visible
      setTimeout(() => showToast?.('Please select a video file', 'error'), 100);
      return;
    }

    // Validate file size (500MB max)
    const fileSizeMB = file.size / (1024 * 1024);
    console.log('File size:', fileSizeMB.toFixed(2), 'MB');

    if (file.size > 500 * 1024 * 1024) {
      console.log('File too large');
      onClose?.(); // Close modal first so toast is visible
      setTimeout(() => showToast?.(`Video too large (${fileSizeMB.toFixed(1)}MB). Maximum is 500MB.`, 'error'), 100);
      return;
    }

    // Show preparing state
    console.log('Setting mode to preparing');
    setMode('preparing');

    // Use setTimeout to allow UI to update before processing
    setTimeout(() => {
      try {
        console.log('Creating object URL...');
        // Create preview URL
        const url = URL.createObjectURL(file);
        console.log('Object URL created:', url);
        setPreviewFile(file);
        setPreviewUrl(url);
        setMode('upload');
        console.log('Mode set to upload');
      } catch (err) {
        console.error('Failed to prepare video:', err);
        onClose?.();
        setTimeout(() => showToast?.('Failed to prepare video. Try a smaller file.', 'error'), 100);
      }
    }, 100);
  }, [showToast, onClose]);

  // Handle video preview error
  const handleVideoError = useCallback((e) => {
    console.error('Video preview failed to load:', e);
    showToast?.('Failed to load video preview. The file may be too large or in an unsupported format.', 'error');
    setMode(null);
    setPreviewFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [showToast, previewUrl]);

  // Handle recording complete
  const handleRecordingComplete = useCallback((blob, duration) => {
    setRecordedBlob(blob);
    setRecordedDuration(duration);
    setPreviewUrl(URL.createObjectURL(blob));
    setMode('preview');
  }, []);

  // Upload media to server
  const uploadMedia = useCallback(async (blob, duration) => {
    setUploadProgress('Uploading video...');

    const formData = new FormData();
    formData.append('media', blob, `video-${Date.now()}.webm`);
    if (duration) {
      formData.append('duration', duration.toString());
    }

    // Through uploadFile so a long video shows real progress and is guarded
    // against a refresh (v2.111.0).
    return uploadFile('/uploads/media', formData, { label: 'Video', size: blob.size });
  }, []);

  // Post video to profile
  const postVideo = useCallback(async () => {
    if (!previewFile && !recordedBlob) {
      showToast?.('No video to post', 'error');
      return;
    }

    setUploading(true);

    try {
      // Upload the media file first
      const blob = previewFile || recordedBlob;
      const duration = recordedDuration || 0;

      setUploadProgress('Uploading video...');
      const uploadResult = await uploadMedia(blob, duration * 1000); // Convert to ms

      if (!uploadResult.url) {
        throw new Error('No URL returned from upload');
      }

      // Post to profile wave
      setUploadProgress('Posting to profile...');
      const postResult = await fetchAPI('/profile/wave/videos', {
        method: 'POST',
        body: {
          media_url: uploadResult.url,
          content: caption.trim(),
          media_duration: uploadResult.duration || (duration * 1000),
        },
      });

      showToast?.('Video posted!', 'success');
      onVideoPosted?.(postResult);
      onClose?.();

    } catch (error) {
      console.error('Failed to post video:', error);
      if (!error.cancelled) showToast?.(error.message || 'Failed to post video', 'error');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }, [previewFile, recordedBlob, recordedDuration, caption, uploadMedia, fetchAPI, showToast, onVideoPosted, onClose]);

  // Reset to mode selection
  const resetToModeSelect = useCallback(() => {
    setMode(null);
    setPreviewFile(null);
    setRecordedBlob(null);
    setRecordedDuration(0);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  // Modal backdrop style
  const backdropStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: isMobile ? '16px' : '24px',
  };

  const modalStyle = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-primary)',
    borderRadius: '12px',
    width: '100%',
    maxWidth: isMobile ? '100%' : '500px',
    maxHeight: '90vh',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-subtle)',
  };

  const contentStyle = {
    padding: '20px',
    flex: 1,
  };

  const buttonStyle = {
    padding: isMobile ? '14px 24px' : '12px 20px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: isMobile ? '0.95rem' : '0.85rem',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: 'var(--accent-amber)20',
    color: 'var(--accent-amber)',
    border: '1px solid var(--accent-amber)',
  };

  const secondaryButtonStyle = {
    ...buttonStyle,
    background: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-primary)',
  };

  return (
    <div style={backdropStyle} onClick={(e) => e.target === e.currentTarget && !uploading && onClose?.()}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '1rem', fontWeight: 'bold' }}>
            Post Video
          </span>
          {!uploading && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '1.5rem',
                padding: '4px 8px',
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Content */}
        <div style={contentStyle}>
          {/* Uploading State */}
          {uploading && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px',
              gap: '16px',
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                border: '3px solid var(--border-subtle)',
                borderTopColor: 'var(--accent-amber)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              <div style={{
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
              }}>
                {uploadProgress}
              </div>
            </div>
          )}

          {/* Preparing State */}
          {mode === 'preparing' && !uploading && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px',
              gap: '16px',
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                border: '3px solid var(--border-subtle)',
                borderTopColor: 'var(--accent-amber)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              <div style={{
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
              }}>
                Preparing video...
              </div>
            </div>
          )}

          {/* Mode Selection */}
          {!mode && !uploading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <button
                style={primaryButtonStyle}
                onClick={() => setMode('record')}
              >
                <span style={{ fontSize: '1.2rem' }}>🎥</span>
                Record Video
              </button>
              <button
                style={secondaryButtonStyle}
                onClick={() => fileInputRef.current?.click()}
              >
                <span style={{ fontSize: '1.2rem' }}>📁</span>
                Choose File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <div style={{
                textAlign: 'center',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: '8px',
              }}>
                Max 2 minutes for recording, 500MB for upload
              </div>
            </div>
          )}

          {/* Recording Mode */}
          {mode === 'record' && !uploading && (
            <div>
              <MediaRecorder
                type="video"
                maxDuration={120}
                isMobile={isMobile}
                onRecordingComplete={handleRecordingComplete}
                onCancel={resetToModeSelect}
              />
            </div>
          )}

          {/* Upload Preview / Post Preview */}
          {(mode === 'upload' || mode === 'preview') && previewUrl && !uploading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Video Preview */}
              <div style={{
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#000',
              }}>
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  onError={handleVideoError}
                  style={{
                    width: '100%',
                    maxHeight: isMobile ? '40vh' : '300px',
                    objectFit: 'contain',
                  }}
                />
              </div>

              {/* Caption Input */}
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                  fontFamily: 'monospace',
                }}>
                  Caption (optional)
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, 500))}
                  placeholder="Add a caption..."
                  maxLength={500}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontFamily: 'inherit',
                    fontSize: '0.9rem',
                    resize: 'none',
                  }}
                />
                <div style={{
                  textAlign: 'right',
                  fontSize: '0.7rem',
                  color: 'var(--text-dim)',
                  marginTop: '4px',
                }}>
                  {caption.length}/500
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  style={secondaryButtonStyle}
                  onClick={resetToModeSelect}
                >
                  Back
                </button>
                <button
                  style={primaryButtonStyle}
                  onClick={postVideo}
                >
                  Post Video
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spinner animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ProfileVideoUpload;
