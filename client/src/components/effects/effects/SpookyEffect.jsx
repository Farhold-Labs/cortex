import React, { useState, useEffect, useMemo } from 'react';
import { Bat, Ghost, Pumpkin, Witch } from '../glyphs.jsx';

/**
 * Spooky Effect - bats, ghosts, jack-o'-lanterns and a couple of witches
 * Used for Halloween (Oct 28 - Nov 1)
 *
 * Drawn shapes (../glyphs.jsx), not emoji: see the note there.
 */

// Glow colours for the dark silhouettes, which a black glow would hide.
const GLOWS = ['#FF6600', '#B04CFF'];

function spookyType(i) {
  if (i < 2) return 'witch';
  const r = Math.random();
  return r < 0.45 ? 'bat' : r < 0.72 ? 'ghost' : 'pumpkin';
}

const SHAPES = { bat: Bat, ghost: Ghost, pumpkin: Pumpkin, witch: Witch };
const SpookyEffect = ({ colors = ['#FF6600', '#800080', '#000000'] }) => {
  const [particles, setParticles] = useState([]);

  // Generate spooky elements
  useEffect(() => {
    const elements = Array.from({ length: 25 }, (_, i) => {
      const type = spookyType(i);
      const witch = type === 'witch';
      return {
        id: i,
        left: -10 + Math.random() * 120, // Can start off-screen
        top: Math.random() * 80,
        delay: Math.random() * 15,
        duration: (witch ? 14 : 8) + Math.random() * 10, // witches cross slower
        size: (witch ? 34 : 18) + Math.random() * (witch ? 14 : 20),
        opacity: 0.45 + Math.random() * 0.4,
        glow: GLOWS[Math.floor(Math.random() * GLOWS.length)],
        type,
        verticalDrift: -50 + Math.random() * 100
      };
    });
    setParticles(elements);
  }, [colors]);

  const keyframes = useMemo(() => `
    @keyframes fly-across {
      0% {
        transform: translateX(-50px) translateY(0);
        opacity: 0;
      }
      10% {
        opacity: 1;
      }
      25% {
        transform: translateX(25vw) translateY(calc(var(--vdrift) * 0.5));
      }
      50% {
        transform: translateX(50vw) translateY(calc(var(--vdrift) * -0.3));
      }
      75% {
        transform: translateX(75vw) translateY(calc(var(--vdrift) * 0.4));
      }
      90% {
        opacity: 1;
      }
      100% {
        transform: translateX(110vw) translateY(0);
        opacity: 0;
      }
    }
    @keyframes bat-flap {
      0%, 100% { transform: scaleY(1) scaleX(1); }
      50% { transform: scaleY(0.8) scaleX(0.7); }
    }
    @keyframes ghost-wobble {
      0%, 100% { transform: rotate(-3deg); }
      50% { transform: rotate(3deg); }
    }
  `, []);

  return (
    <>
      <style>{keyframes}</style>
      {/* Subtle dark overlay for atmosphere */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.15) 100%)',
          pointerEvents: 'none'
        }}
      />
      {/* Flying creatures */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          style={{
            position: 'absolute',
            left: `${particle.left}%`,
            top: `${particle.top}%`,
            opacity: particle.opacity,
            animation: `fly-across ${particle.duration}s linear infinite`,
            animationDelay: `${particle.delay}s`,
            '--vdrift': `${particle.verticalDrift}px`,
            willChange: 'transform, opacity'
          }}
        >
          <span style={{
            display: 'inline-block',
            animation: particle.type === 'bat'
              ? 'bat-flap 0.15s ease-in-out infinite'
              : 'ghost-wobble 2s ease-in-out infinite',
            filter: particle.type === 'ghost'
              ? 'drop-shadow(0 0 8px rgba(255,255,255,0.5))'
              : particle.type === 'pumpkin'
                ? 'drop-shadow(0 0 6px rgba(255,140,0,0.7))'
                : `drop-shadow(0 0 5px ${particle.glow}) drop-shadow(0 0 2px ${particle.glow})`
          }}>
            {React.createElement(SHAPES[particle.type], { size: particle.size })}
          </span>
        </div>
      ))}
    </>
  );
};

export default SpookyEffect;
