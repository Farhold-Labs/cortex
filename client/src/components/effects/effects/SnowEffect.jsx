import React, { useState, useEffect, useMemo } from 'react';
import { Snowflake } from '../glyphs.jsx';

/**
 * Snow Effect - Falling snowflakes with CSS keyframes
 * Used for Christmas (Dec 20-26)
 *
 * The flakes were a '*' character until v2.122.2, so they looked like
 * whatever the font's asterisk was. They are drawn now (glyphs.jsx).
 */
const SnowEffect = ({ colors = ['#FFFFFF', '#F0F8FF', '#E0E0E0'] }) => {
  const [particles, setParticles] = useState([]);

  // Generate snowflakes on mount
  useEffect(() => {
    const snowflakes = Array.from({ length: 35 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 10,
      duration: 8 + Math.random() * 7, // 8-15 seconds
      size: 8 + Math.random() * 16, // 8-24px
      opacity: 0.4 + Math.random() * 0.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      drift: -20 + Math.random() * 40 // horizontal drift
    }));
    setParticles(snowflakes);
  }, [colors]);

  const keyframes = useMemo(() => `
    @keyframes snowfall {
      0% {
        transform: translateY(-10px) translateX(0) rotate(0deg);
        opacity: 0;
      }
      10% {
        opacity: 1;
      }
      90% {
        opacity: 1;
      }
      100% {
        transform: translateY(100vh) translateX(var(--drift)) rotate(360deg);
        opacity: 0;
      }
    }
  `, []);

  return (
    <>
      <style>{keyframes}</style>
      {particles.map((flake) => (
        <div
          key={flake.id}
          style={{
            position: 'absolute',
            left: `${flake.left}%`,
            top: '-20px',
            opacity: flake.opacity,
            animation: `snowfall ${flake.duration}s linear infinite`,
            animationDelay: `${flake.delay}s`,
            '--drift': `${flake.drift}px`,
            filter: `drop-shadow(0 0 3px ${flake.color}80)`,
            willChange: 'transform, opacity'
          }}
        >
          <Snowflake size={flake.size} color={flake.color} />
        </div>
      ))}
    </>
  );
};

export default SnowEffect;
