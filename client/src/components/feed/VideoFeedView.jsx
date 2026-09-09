import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePullToRefresh } from '../../hooks/usePullToRefresh.js';
import { useVerticalSwipe } from '../../hooks/useVerticalSwipe.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import VideoFeedItem from './VideoFeedItem.jsx';
import EmojiPicker from '../ui/EmojiPicker.jsx';
import ProfileVideoUpload from './ProfileVideoUpload.jsx';
import { T } from '../../config/terminology.js';

/**
 * VideoFeedView Component (v2.8.0)
 *
 * Main container for the TikTok/Reels-style vertical video feed.
 * Handles pagination, navigation, and preloading.
 *
 * Props:
 * - fetchAPI: API fetch function
 * - showToast: Toast notification function
 * - onNavigateToWave: Function to navigate to a wave
 * - onShowProfile: Function to show user profile
 * - isMobile: Boolean for mobile-specific styling
 * - currentUser: Current user object
 */
const VideoFeedView = ({
  fetchAPI,
  showToast,
  onNavigateToWave,
  onShowProfile,
  isMobile,
  currentUser,
}) => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactingToVideo, setReactingToVideo] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const containerRef = useRef(null);
  const videoRefs = useRef([]);

  // Generate a session seed for consistent random ordering
  const sessionSeed = useMemo(() => Math.floor(Math.random() * 1000000), []);

  // Fetch initial videos
  const loadVideos = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      setNextCursor(null);
      setCurrentIndex(0);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const cursor = reset ? null : nextCursor;
      const params = new URLSearchParams({
        limit: '10',
        seed: sessionSeed.toString(),
      });
      if (cursor) {
        params.append('cursor', cursor);
      }

      const result = await fetchAPI(`/feed/videos?${params.toString()}`);

      if (reset) {
        setVideos(result.videos || []);
      } else {
        setVideos(prev => [...prev, ...(result.videos || [])]);
      }

      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } catch (err) {
      console.error('Failed to load video feed:', err);
      setError(err.message || 'Failed to load videos');
      showToast?.('Failed to load video feed', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [fetchAPI, nextCursor, sessionSeed, showToast]);

  // Initial load
  useEffect(() => {
    loadVideos(true);
  }, []);

  // Pull to refresh
  const { pulling, pullDistance, refreshing } = usePullToRefresh(containerRef, () => loadVideos(true));

  // Navigate to next video
  const goToNext = useCallback(() => {
    if (currentIndex < videos.length - 1) {
      setCurrentIndex(prev => prev + 1);
      // Preload more when near the end
      if (currentIndex >= videos.length - 3 && hasMore && !loadingMore) {
        loadVideos(false);
      }
    }
  }, [currentIndex, videos.length, hasMore, loadingMore, loadVideos]);

  // Navigate to previous video
  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  // Vertical swipe handling
  useVerticalSwipe(containerRef, {
    onSwipeUp: goToNext,
    onSwipeDown: goToPrevious,
    threshold: 50,
    enabled: !loading,
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        goToNext();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        goToPrevious();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrevious]);

  // Scroll to current video when index changes (only for programmatic navigation)
  const isScrollingRef = useRef(false);
  useEffect(() => {
    if (videoRefs.current[currentIndex] && !isScrollingRef.current) {
      videoRefs.current[currentIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentIndex]);

  // IntersectionObserver to detect which video is visible during manual scrolling
  // This ensures currentIndex stays in sync and only one video plays at a time
  useEffect(() => {
    const options = {
      root: containerRef.current?.querySelector('[style*="overflowY"]') || containerRef.current,
      rootMargin: '0px',
      threshold: 0.6, // Video must be 60% visible to become active
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = videoRefs.current.findIndex(ref => ref === entry.target);
          if (index !== -1 && index !== currentIndex) {
            isScrollingRef.current = true;
            setCurrentIndex(index);
            // Reset scroll flag after a short delay
            setTimeout(() => {
              isScrollingRef.current = false;
            }, 100);
          }
        }
      });
    }, options);

    // Observe all video containers
    videoRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [videos.length, currentIndex]);

  // Track video views for recommendation algorithm (v2.10.0)
  // Mark video as viewed after 2 seconds of watching
  useEffect(() => {
    const currentVideo = videos[currentIndex];
    if (!currentVideo) return;

    const viewTimer = setTimeout(async () => {
      try {
        // Fire and forget - don't need to await or handle errors
        fetchAPI(`/feed/videos/${currentVideo.id}/view`, { method: 'POST' });
      } catch (err) {
        // Silently ignore view tracking errors
      }
    }, 2000); // Mark as viewed after 2 seconds

    return () => clearTimeout(viewTimer);
  }, [currentIndex, videos, fetchAPI]);

  // Handle navigate to wave
  const handleNavigateToWave = useCallback((waveId, waveTitle) => {
    onNavigateToWave?.({ id: waveId, title: waveTitle });
  }, [onNavigateToWave]);

  // Handle reaction
  const handleReact = useCallback((videoId, waveId) => {
    setReactingToVideo({ id: videoId, waveId });
    setShowEmojiPicker(true);
  }, []);

  // Handle reply - navigate to burst wave (v2.9.0)
  const handleReply = useCallback((waveId, waveTitle, isExisting) => {
    onNavigateToWave?.({ id: waveId, title: waveTitle });
  }, [onNavigateToWave]);

  // Add reaction to video
  const addReaction = useCallback(async (emoji) => {
    if (!reactingToVideo) return;

    try {
      await fetchAPI(`/pings/${reactingToVideo.id}/react`, {
        method: 'POST',
        body: { emoji },
      });
      showToast?.('Reaction added', 'success');

      // Update local state
      setVideos(prev => prev.map(v => {
        if (v.id === reactingToVideo.id) {
          const reactions = { ...v.reactions };
          if (!reactions[emoji]) {
            reactions[emoji] = [];
          }
          if (!reactions[emoji].includes(currentUser?.id)) {
            reactions[emoji] = [...reactions[emoji], currentUser?.id];
          }
          return { ...v, reactions };
        }
        return v;
      }));
    } catch (err) {
      showToast?.(err.message || 'Failed to add reaction', 'error');
    } finally {
      setShowEmojiPicker(false);
      setReactingToVideo(null);
    }
  }, [reactingToVideo, fetchAPI, showToast, currentUser?.id]);

  // Loading state
  if (loading && videos.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--text-muted)',
        gap: '16px',
      }}>
        <div style={{ fontSize: '2rem' }}>◎</div>
        <div>Loading feed...</div>
      </div>
    );
  }

  // Error state
  if (error && videos.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--text-muted)',
        gap: '16px',
        padding: '20px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem' }}>⚠</div>
        <div>{error}</div>
        <button
          onClick={() => loadVideos(true)}
          style={{
            padding: '10px 20px',
            background: 'var(--accent-amber)20',
            border: '1px solid var(--accent-amber)',
            color: 'var(--accent-amber)',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          TRY AGAIN
        </button>
      </div>
    );
  }

  // Empty state
  if (videos.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--text-muted)',
        gap: '16px',
        padding: '20px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '3rem' }}>▶</div>
        <GlowText color="var(--accent-amber)" size="1.1rem">NO VIDEOS YET</GlowText>
        <div style={{ fontSize: '0.85rem', maxWidth: '300px' }}>
          Videos from public {T.waves} and {T.waves} you participate in will appear here.
          Record a video {T.ping} to get started!
        </div>
        <button
          onClick={() => loadVideos(true)}
          style={{
            padding: '10px 20px',
            background: 'var(--accent-teal)20',
            border: '1px solid var(--accent-teal)',
            color: 'var(--accent-teal)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            marginTop: '8px',
          }}
        >
          REFRESH
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Pull to refresh indicator */}
      {(pulling || refreshing) && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: `${Math.min(pullDistance, 80)}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-surface)',
            zIndex: 10,
            transition: 'height 0.2s',
          }}
        >
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.8rem' }}>
            {refreshing ? 'Refreshing...' : (pullDistance >= 60 ? 'Release to refresh' : 'Pull to refresh')}
          </span>
        </div>
      )}

      {/* Video feed container - snap scrolling */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {videos.map((video, index) => (
          <div
            key={video.id}
            ref={el => videoRefs.current[index] = el}
            style={{
              height: '100%',
              minHeight: isMobile ? 'calc(100vh - 120px)' : 'calc(100vh - 140px)',
              scrollSnapAlign: 'start',
              scrollSnapStop: 'always',
            }}
          >
            <VideoFeedItem
              video={video}
              isActive={index === currentIndex}
              onNavigateToWave={handleNavigateToWave}
              onShowProfile={onShowProfile}
              onReact={handleReact}
              onReply={handleReply}
              fetchAPI={fetchAPI}
              isMobile={isMobile}
              showToast={showToast}
              currentUserId={currentUser?.id}
            />
          </div>
        ))}

        {/* Loading more indicator */}
        {loadingMore && (
          <div
            style={{
              height: '60px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            Loading more...
          </div>
        )}
      </div>

      {/* Navigation indicators */}
      <div
        style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          opacity: 0.6,
        }}
      >
        {videos.slice(0, Math.min(10, videos.length)).map((_, index) => (
          <div
            key={index}
            style={{
              width: '3px',
              height: index === currentIndex ? '16px' : '8px',
              background: index === currentIndex ? 'var(--accent-amber)' : 'rgba(255,255,255,0.5)',
              borderRadius: '2px',
              transition: 'all 0.2s',
              cursor: 'pointer',
            }}
            onClick={() => setCurrentIndex(index)}
          />
        ))}
        {videos.length > 10 && (
          <div style={{ color: 'white', fontSize: '0.6rem', textAlign: 'center' }}>
            +{videos.length - 10}
          </div>
        )}
      </div>

      {/* Video counter */}
      <div
        style={{
          position: 'absolute',
          top: isMobile ? '12px' : '16px',
          left: '16px',
          padding: '4px 10px',
          background: 'rgba(0,0,0,0.6)',
          borderRadius: '4px',
          fontSize: '0.75rem',
          color: 'white',
          fontFamily: 'monospace',
        }}
      >
        {currentIndex + 1} / {videos.length}
      </div>

      {/* Emoji picker modal */}
      {showEmojiPicker && (
        <div
          style={{
            position: 'absolute',
            bottom: isMobile ? '80px' : '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
          }}
        >
          <EmojiPicker
            onSelect={addReaction}
            onClose={() => {
              setShowEmojiPicker(false);
              setReactingToVideo(null);
            }}
          />
        </div>
      )}

      {/* Floating post button (v2.9.0) - positioned bottom-center */}
      <button
        onClick={() => setShowUploadModal(true)}
        style={{
          position: 'absolute',
          bottom: isMobile ? '90px' : '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'var(--accent-amber)',
          border: 'none',
          color: '#000',
          fontSize: '1.8rem',
          fontWeight: 'bold',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(255, 210, 63, 0.4)',
          transition: 'transform 0.2s, box-shadow 0.2s',
          zIndex: 50,
        }}
        onMouseEnter={(e) => {
          e.target.style.transform = 'translateX(-50%) scale(1.1)';
          e.target.style.boxShadow = '0 6px 16px rgba(255, 210, 63, 0.5)';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'translateX(-50%) scale(1)';
          e.target.style.boxShadow = '0 4px 12px rgba(255, 210, 63, 0.4)';
        }}
        title="Post Video"
      >
        +
      </button>

      {/* Profile Video Upload Modal (v2.9.0) */}
      {showUploadModal && (
        <ProfileVideoUpload
          fetchAPI={fetchAPI}
          showToast={showToast}
          isMobile={isMobile}
          onClose={() => setShowUploadModal(false)}
          onVideoPosted={(video) => {
            // Add the new video to the beginning of the feed
            setVideos(prev => [{
              id: video.id,
              wave_id: video.wave_id,
              author_id: currentUser?.id,
              author_name: currentUser?.displayName || currentUser?.display_name,
              author_handle: currentUser?.handle,
              author_avatar: currentUser?.avatar,
              author_avatar_url: currentUser?.avatarUrl || currentUser?.avatar_url,
              media_url: video.media_url,
              content: video.content,
              created_at: video.created_at,
              reactions: {},
              wave_title: `@${currentUser?.handle}'s Videos`,
              wave_privacy: 'public',
            }, ...prev]);
            setCurrentIndex(0);
          }}
        />
      )}
    </div>
  );
};

export default VideoFeedView;
