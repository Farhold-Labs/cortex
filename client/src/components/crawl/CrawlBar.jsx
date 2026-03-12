import React, { useState, useEffect, useCallback, useRef } from 'react';

const CRAWL_SCROLL_SPEEDS = {
  slow: 60,     // seconds for full scroll - leisurely pace
  normal: 45,   // comfortable reading speed
  fast: 30,     // quicker but still readable
};

const CrawlBar = ({ fetchAPI, enabled = true, userPrefs = {}, isMobile = false, onAlertClick }) => {
  const [data, setData] = useState({ stocks: { data: [] }, weather: { data: null }, news: { data: [] }, alerts: { data: [] } });
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef(null);
  const animationRef = useRef(null);
  const [contentWidth, setContentWidth] = useState(0);
  const dragStartRef = useRef({ x: 0, animTime: 0 });
  const resumeTimeoutRef = useRef(null);

  const scrollSpeed = CRAWL_SCROLL_SPEEDS[userPrefs.scrollSpeed || 'normal'];
  const RESUME_DELAY = 3000; // Resume after 3 seconds of no interaction

  // Fetch crawl data without resetting animation (using Web Animations API)
  const loadData = useCallback(async () => {
    try {
      // Save current animation time before update
      let savedTime = 0;
      if (animationRef.current) {
        savedTime = animationRef.current.currentTime || 0;
      }

      const result = await fetchAPI('/crawl/all');
      setData(result);

      // Restore animation position after React re-render
      requestAnimationFrame(() => {
        if (scrollRef.current && savedTime > 0) {
          // Re-measure content width in case it changed
          const newContentWidth = scrollRef.current.scrollWidth / 2;

          // Cancel existing animation if any
          if (animationRef.current) {
            animationRef.current.cancel();
          }
          // Create new animation and restore position
          const anim = scrollRef.current.animate(
            [
              { transform: 'translateX(0px)' },
              { transform: `translateX(-${newContentWidth}px)` }
            ],
            {
              duration: scrollSpeed * 1000,
              iterations: Infinity,
              easing: 'linear'
            }
          );
          anim.currentTime = savedTime;
          animationRef.current = anim;
          setContentWidth(newContentWidth);
        }
      });
    } catch (err) {
      console.error('Crawl bar error:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, scrollSpeed]);

  // Initial load and polling
  useEffect(() => {
    if (!enabled) return;

    loadData();
    const interval = setInterval(loadData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [enabled, loadData]);

  // Measure content width for pixel-perfect seamless looping
  useEffect(() => {
    if (!scrollRef.current || loading) return;

    // Measure the width of one set of items (half the total since content is duplicated)
    const measureWidth = () => {
      if (scrollRef.current) {
        const totalWidth = scrollRef.current.scrollWidth;
        setContentWidth(totalWidth / 2); // Half because content is duplicated
      }
    };

    measureWidth();
    // Re-measure on window resize
    window.addEventListener('resize', measureWidth);
    return () => window.removeEventListener('resize', measureWidth);
  }, [loading, data]);

  // Initialize WAAPI animation when content width is known
  useEffect(() => {
    if (!scrollRef.current || loading || contentWidth === 0) return;

    // Create animation using pixel-based translation for seamless loop
    if (!animationRef.current) {
      const anim = scrollRef.current.animate(
        [
          { transform: 'translateX(0px)' },
          { transform: `translateX(-${contentWidth}px)` }
        ],
        {
          duration: scrollSpeed * 1000,
          iterations: Infinity,
          easing: 'linear'
        }
      );
      animationRef.current = anim;
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.cancel();
        animationRef.current = null;
      }
    };
  }, [loading, scrollSpeed, contentWidth]);

  // Handle pause/resume
  useEffect(() => {
    if (animationRef.current) {
      if (isPaused) {
        animationRef.current.pause();
      } else {
        animationRef.current.play();
      }
    }
  }, [isPaused]);

  // Clear resume timeout on unmount
  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, []);

  // Schedule resume after delay
  const scheduleResume = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }
    resumeTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
      setIsDragging(false);
    }, RESUME_DELAY);
  }, [RESUME_DELAY]);

  // Cancel scheduled resume
  const cancelResume = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
  }, []);

  // Pause and cancel any pending resume
  const handleInteractionStart = useCallback(() => {
    cancelResume();
    setIsPaused(true);
  }, [cancelResume]);

  // Schedule resume after interaction ends (if not dragging)
  const handleInteractionEnd = useCallback(() => {
    if (!isDragging) {
      scheduleResume();
    }
  }, [isDragging, scheduleResume]);

  // Drag handlers
  const handleDragStart = useCallback((clientX) => {
    if (!animationRef.current) return;
    setIsDragging(true);
    cancelResume();
    dragStartRef.current = {
      x: clientX,
      animTime: animationRef.current.currentTime || 0,
    };
  }, [cancelResume]);

  const handleDragMove = useCallback((clientX) => {
    if (!isDragging || !animationRef.current || contentWidth === 0) return;

    const deltaX = clientX - dragStartRef.current.x;
    // Convert pixel movement to animation time
    // Positive deltaX (drag right) = go backwards in time (see earlier content)
    // Negative deltaX (drag left) = go forwards in time (see later content)
    const duration = scrollSpeed * 1000;
    const timePerPixel = duration / contentWidth;
    const deltaTime = -deltaX * timePerPixel;

    let newTime = dragStartRef.current.animTime + deltaTime;
    // Wrap around for seamless looping
    while (newTime < 0) newTime += duration;
    while (newTime >= duration) newTime -= duration;

    animationRef.current.currentTime = newTime;
  }, [isDragging, contentWidth, scrollSpeed]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    scheduleResume();
  }, [scheduleResume]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    handleDragStart(e.clientX);
  }, [handleDragStart]);

  const handleMouseMove = useCallback((e) => {
    handleDragMove(e.clientX);
  }, [handleDragMove]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      handleDragEnd();
    }
  }, [isDragging, handleDragEnd]);

  // Touch event handlers
  const handleTouchStart = useCallback((e) => {
    handleInteractionStart();
    if (e.touches.length === 1) {
      handleDragStart(e.touches[0].clientX);
    }
  }, [handleInteractionStart, handleDragStart]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 1) {
      handleDragMove(e.touches[0].clientX);
    }
  }, [handleDragMove]);

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Add/remove global mouse listeners when dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (!enabled) {
    return null;
  }

  // Build crawl items
  const items = [];

  // System Alerts (from admins) - displayed first, highest priority
  const alertPriorityConfig = {
    critical: { icon: '🚨', color: 'var(--accent-orange)', showLabel: true },
    warning: { icon: '⚠️', color: 'var(--accent-amber)', showLabel: true },
    info: { icon: 'ℹ️', color: 'var(--accent-teal)', showLabel: true },
    celebration: { icon: '', color: 'var(--accent-purple)', showLabel: false },
  };

  if (data.alerts?.enabled && data.alerts?.data?.length > 0) {
    // Sort by priority (critical first, then warning, then info/celebration)
    const priorityOrder = { critical: 0, warning: 1, info: 2, celebration: 2 };
    const sortedAlerts = [...data.alerts.data].sort((a, b) =>
      (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
    );

    sortedAlerts.forEach(alert => {
      const cfg = alertPriorityConfig[alert.priority] || alertPriorityConfig.info;

      // For celebration alerts, match holiday name in title to resolve icon
      let holidayIcon = null;
      if (alert.priority === 'celebration') {
        const holidayNameMap = { "new year": 'newYear', "valentine": 'valentines', "elderxeke": 'elderxeke', "patrick": 'stPatricks', "easter": 'easter', "independence": 'independenceDay', "halloween": 'halloween', "thanksgiving": 'thanksgiving', "christmas": 'christmas', "hanukkah": 'hanukkah' };
        const titleLower = alert.title.toLowerCase();
        for (const [name, key] of Object.entries(holidayNameMap)) {
          if (titleLower.includes(name)) {
            holidayIcon = `/holidays/${key}.png`;
            break;
          }
        }
      }

      items.push({
        type: 'system-alert',
        key: `system-alert-${alert.id}`,
        content: (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onAlertClick?.(alert);
            }}
            style={{
              cursor: 'pointer',
              color: cfg.color,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {holidayIcon && (
              <img
                src={holidayIcon}
                alt=""
                style={{ height: '1.1em', width: 'auto', verticalAlign: 'middle' }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            {cfg.showLabel ? `${cfg.icon} [${alert.priority.toUpperCase()}] ${alert.title}` : alert.title}
            {alert.originNode && (
              <span style={{ fontSize: '0.7em', opacity: 0.7, marginLeft: '4px' }}>
                (@{alert.originNode})
              </span>
            )}
          </span>
        ),
      });
    });
  }

  // Stocks - clickable links to Yahoo Finance
  if (userPrefs.showStocks !== false && data.stocks?.enabled && data.stocks?.data?.length > 0) {
    data.stocks.data.forEach(stock => {
      if (!stock) return;
      const isUp = (stock.change || 0) >= 0;
      items.push({
        type: 'stock',
        key: `stock-${stock.symbol}`,
        content: (
          <a
            href={`https://finance.yahoo.com/quote/${stock.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>{stock.symbol}</span>
            {' '}
            <span style={{ color: 'var(--text-primary)' }}>${stock.price?.toFixed(2)}</span>
            {' '}
            <span style={{ color: isUp ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
              {isUp ? '▲' : '▼'} {Math.abs(stock.changePercent || 0).toFixed(2)}%
            </span>
          </a>
        ),
      });
    });
  }

  // Weather - clickable link to OpenWeatherMap
  if (userPrefs.showWeather !== false && data.weather?.enabled && data.weather?.data) {
    const weather = data.weather.data;
    const location = data.weather.location;
    const hasAlerts = weather.alerts?.length > 0;
    const weatherUrl = location?.lat && location?.lon
      ? `https://openweathermap.org/weathermap?basemap=map&cities=true&layer=temperature&lat=${location.lat}&lon=${location.lon}&zoom=10`
      : 'https://openweathermap.org/';

    items.push({
      type: 'weather',
      key: 'weather-current',
      content: (
        <a
          href={weatherUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ color: 'var(--accent-teal)' }}>🌡</span>
          {' '}
          <span style={{ color: 'var(--text-primary)' }}>{location?.name || 'Weather'}</span>
          {': '}
          <span style={{ color: 'var(--text-secondary)' }}>
            {weather.temp}°F, {weather.description}
          </span>
        </a>
      ),
    });

    // Weather alerts - clickable link to location-specific NWS forecast page
    if (hasAlerts) {
      const alertUrl = location?.lat && location?.lon
        ? `https://forecast.weather.gov/MapClick.php?lat=${location.lat}&lon=${location.lon}`
        : 'https://www.weather.gov/alerts';

      weather.alerts.slice(0, 2).forEach((alert, i) => {
        items.push({
          type: 'alert',
          key: `alert-${i}`,
          content: (
            <a
              href={alertUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: 'var(--accent-orange)' }}
              onClick={(e) => e.stopPropagation()}
            >
              ⚠️ ALERT: {alert.event}
            </a>
          ),
        });
      });
    }
  }

  // News
  if (userPrefs.showNews !== false && data.news?.enabled && data.news?.data?.length > 0) {
    data.news.data.slice(0, 5).forEach((headline, i) => {
      if (!headline?.title) return;
      items.push({
        type: 'news',
        key: `news-${i}`,
        content: (
          <a
            href={headline.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ color: 'var(--accent-purple)' }}>◆</span>
            {' '}
            {headline.title?.substring(0, 80)}{headline.title?.length > 80 ? '...' : ''}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.7em', marginLeft: '6px' }}>
              [{headline.source}]
            </span>
          </a>
        ),
      });
    });
  }

  // If no items to display, hide the bar
  if (items.length === 0 && !loading) {
    return null;
  }

  // Duplicate items for seamless loop
  const allItems = items.length > 0 ? [...items, ...items] : [];

  return (
    <div
      style={{
        position: 'relative',
        height: isMobile ? '28px' : '32px',
        background: 'var(--bg-surface)',
        borderBottom: `1px solid ${isPaused ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
        overflow: 'hidden',
        fontFamily: "'Courier New', monospace",
        fontSize: isMobile ? '0.7rem' : '0.75rem',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transition: 'border-color 0.2s ease',
      }}
      onMouseEnter={handleInteractionStart}
      onMouseLeave={handleInteractionEnd}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pause indicator */}
      {isPaused && !loading && (
        <div style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--accent-amber)',
          fontSize: '0.65rem',
          fontWeight: 500,
          zIndex: 10,
          background: 'var(--bg-surface)',
          padding: '2px 6px',
          borderRadius: '3px',
          opacity: 0.9,
        }}>
          {isDragging ? '◀ ▶' : '⏸'}
        </div>
      )}

      {/* Animation controlled via Web Animations API for seamless data refresh */}

      {loading && items.length === 0 ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
        }}>
          Loading crawl data...
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            whiteSpace: 'nowrap',
            // Animation controlled via Web Animations API (see useEffect above)
          }}
        >
          {allItems.map((item, index) => (
            <span
              key={`${item.key}-${index}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 24px',
              }}
            >
              {item.content}
            </span>
          ))}
        </div>
      )}

      {/* Gradient fade edges */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '40px',
        height: '100%',
        background: 'linear-gradient(90deg, var(--bg-surface), transparent)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: '40px',
        height: '100%',
        background: 'linear-gradient(-90deg, var(--bg-surface), transparent)',
        pointerEvents: 'none',
      }} />
    </div>
  );
};

export default CrawlBar;
