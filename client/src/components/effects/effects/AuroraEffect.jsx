import React, { useMemo } from 'react';

/**
 * Aurora / Bifrost Effect - Rainbow bands of shifting color across the top
 * with warm ember motes rising from below.
 * Used for Elderxeke Day — a quiet, reverent tribute
 */

// Bifrost spectrum — distinct from any theme's accent colors
const BIFROST = [
  '#9B59B6', // Purple
  '#6C5CE7', // Violet
  '#3498DB', // Blue
  '#00CEC9', // Cyan
  '#2ECC71', // Green
  '#F1C40F', // Yellow
  '#E67E22', // Orange
  '#E74C3C', // Red
];

// Warm ember colors for rising motes
const EMBER_COLORS = ['#FFD700', '#FF8C00', '#FF6347', '#FFA500'];

const AuroraEffect = () => {
  const keyframes = useMemo(() => `
    @keyframes aurora-sway-1 {
      0%, 100% { transform: translateX(-3%) skewX(-2deg); }
      50% { transform: translateX(3%) skewX(2deg); }
    }
    @keyframes aurora-sway-2 {
      0%, 100% { transform: translateX(4%) skewX(1deg); }
      50% { transform: translateX(-4%) skewX(-1deg); }
    }
    @keyframes aurora-pulse {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 0.55; }
    }
    @keyframes ember-rise {
      0% { transform: translateY(0) translateX(0); opacity: 0; }
      10% { opacity: 0.7; }
      90% { opacity: 0.5; }
      100% { transform: translateY(-40vh) translateX(var(--drift)); opacity: 0; }
    }
  `, []);

  // Generate ember motes once
  const embers = useMemo(() =>
    Array.from({ length: 18 }, (_, i) => ({
      id: i,
      left: 5 + Math.random() * 90,
      delay: Math.random() * 15,
      duration: 10 + Math.random() * 8,
      size: 2 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 40, // px horizontal drift
      color: EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
    })), []);

  return (
    <>
      <style>{keyframes}</style>

      {/* Bifrost band 1 — full rainbow gradient, slow sway */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: '-5%',
        right: '-5%',
        height: '25%',
        background: `linear-gradient(90deg,
          ${BIFROST[0]}60 0%,
          ${BIFROST[1]}50 12%,
          ${BIFROST[2]}50 25%,
          ${BIFROST[3]}45 37%,
          ${BIFROST[4]}40 50%,
          ${BIFROST[5]}45 62%,
          ${BIFROST[6]}50 75%,
          ${BIFROST[7]}50 87%,
          ${BIFROST[0]}60 100%
        )`,
        maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)',
        filter: 'blur(12px)',
        animation: 'aurora-sway-1 20s ease-in-out infinite, aurora-pulse 8s ease-in-out infinite',
        willChange: 'transform, opacity',
      }} />

      {/* Bifrost band 2 — offset, reversed spectrum */}
      <div style={{
        position: 'absolute',
        top: '2%',
        left: '-5%',
        right: '-5%',
        height: '20%',
        background: `linear-gradient(90deg,
          ${BIFROST[7]}50 0%,
          ${BIFROST[5]}40 20%,
          ${BIFROST[3]}45 40%,
          ${BIFROST[1]}50 60%,
          ${BIFROST[0]}45 80%,
          ${BIFROST[6]}50 100%
        )`,
        maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
        filter: 'blur(18px)',
        animation: 'aurora-sway-2 25s ease-in-out infinite, aurora-pulse 11s ease-in-out infinite 3s',
        willChange: 'transform, opacity',
      }} />

      {/* Subtle vertical curtain streaks */}
      {[0, 1, 2, 3, 4].map((i) => {
        const color = BIFROST[i + 1];
        const left = 10 + i * 18;
        return (
          <div key={`curtain-${i}`} style={{
            position: 'absolute',
            top: 0,
            left: `${left}%`,
            width: '8%',
            height: '30%',
            background: `linear-gradient(180deg, ${color}30 0%, ${color}15 40%, transparent 100%)`,
            filter: 'blur(15px)',
            animation: `aurora-pulse ${7 + i * 2}s ease-in-out infinite ${i * 1.5}s`,
            willChange: 'opacity',
          }} />
        );
      })}

      {/* Rising ember motes */}
      {embers.map((ember) => (
        <div
          key={ember.id}
          style={{
            position: 'absolute',
            left: `${ember.left}%`,
            bottom: '10%',
            width: `${ember.size}px`,
            height: `${ember.size}px`,
            borderRadius: '50%',
            background: ember.color,
            boxShadow: `0 0 ${ember.size * 3}px ${ember.color}80`,
            animation: `ember-rise ${ember.duration}s ease-out infinite`,
            animationDelay: `${ember.delay}s`,
            '--drift': `${ember.drift}px`,
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </>
  );
};

export default AuroraEffect;
