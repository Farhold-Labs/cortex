import React, { useState, useEffect, useMemo } from 'react';
import { Shamrock } from '../glyphs.jsx';

/**
 * Shamrock Effect - Floating shamrock characters
 * Used for St. Patrick's Day (Mar 15-18)
 */
const ShamrockEffect = ({ colors = ['#228B22', '#32CD32', '#FFD700'] }) => {
  const [particles, setParticles] = useState([]);

  // Generate shamrocks on mount
  useEffect(() => {
    const shamrocks = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 15,
      duration: 12 + Math.random() * 10, // 12-22 seconds
      size: 14 + Math.random() * 18, // 14-32px
      opacity: 0.35 + Math.random() * 0.45,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      sway: -40 + Math.random() * 80
    }));
    setParticles(shamrocks);
  }, [colors]);

  const keyframes = useMemo(() => `
    @keyframes shamrock-fall {
      0% {
        transform: translateY(-10px) translateX(0) rotate(0deg);
        opacity: 0;
      }
      10% {
        opacity: 1;
      }
      25% {
        transform: translateY(25vh) translateX(calc(var(--sway) * 0.5)) rotate(90deg);
      }
      50% {
        transform: translateY(50vh) translateX(calc(var(--sway) * -0.5)) rotate(180deg);
      }
      75% {
        transform: translateY(75vh) translateX(calc(var(--sway) * 0.3)) rotate(270deg);
      }
      90% {
        opacity: 1;
      }
      100% {
        transform: translateY(100vh) translateX(0) rotate(360deg);
        opacity: 0;
      }
    }
  `, []);

  return (
    <>
      <style>{keyframes}</style>
      {particles.map((shamrock) => (
        <div
          key={shamrock.id}
          style={{
            position: 'absolute',
            left: `${shamrock.left}%`,
            top: '-30px',
            opacity: shamrock.opacity,
            animation: `shamrock-fall ${shamrock.duration}s linear infinite`,
            animationDelay: `${shamrock.delay}s`,
            '--sway': `${shamrock.sway}px`,
            filter: `drop-shadow(0 0 5px ${shamrock.color}60)`,
            willChange: 'transform, opacity'
          }}
        >
          <Shamrock size={shamrock.size} color={shamrock.color} />
        </div>
      ))}
    </>
  );
};

export default ShamrockEffect;
