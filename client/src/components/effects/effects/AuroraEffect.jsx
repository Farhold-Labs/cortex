import React, { useMemo } from 'react';

/**
 * Aurora / Bifrost Effect - Ethereal bands of shifting color
 * Used for Elderxeke Day — a quiet, reverent tribute
 */
const AuroraEffect = ({ colors = ['#2ECC71', '#3498DB', '#FFD700'] }) => {
  const keyframes = useMemo(() => `
    @keyframes aurora-drift-1 {
      0% { transform: translateX(-10%) scaleY(1); opacity: 0.12; }
      25% { transform: translateX(5%) scaleY(1.2); opacity: 0.18; }
      50% { transform: translateX(10%) scaleY(0.9); opacity: 0.1; }
      75% { transform: translateX(-5%) scaleY(1.1); opacity: 0.16; }
      100% { transform: translateX(-10%) scaleY(1); opacity: 0.12; }
    }
    @keyframes aurora-drift-2 {
      0% { transform: translateX(8%) scaleY(1.1); opacity: 0.1; }
      30% { transform: translateX(-8%) scaleY(0.8); opacity: 0.15; }
      60% { transform: translateX(4%) scaleY(1.3); opacity: 0.08; }
      100% { transform: translateX(8%) scaleY(1.1); opacity: 0.1; }
    }
    @keyframes aurora-drift-3 {
      0% { transform: translateX(-5%) scaleY(0.9); opacity: 0.08; }
      35% { transform: translateX(10%) scaleY(1.2); opacity: 0.14; }
      65% { transform: translateX(-8%) scaleY(1); opacity: 0.06; }
      100% { transform: translateX(-5%) scaleY(0.9); opacity: 0.08; }
    }
    @keyframes aurora-shimmer {
      0%, 100% { opacity: 0; }
      50% { opacity: 0.4; }
    }
  `, []);

  // Faint motes of light drifting upward through the aurora
  const motes = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => ({
      id: i,
      left: 10 + Math.random() * 80,
      delay: Math.random() * 20,
      duration: 15 + Math.random() * 10,
      size: 2 + Math.random() * 2,
      color: colors[Math.floor(Math.random() * colors.length)],
    })), [colors]);

  return (
    <>
      <style>{keyframes}</style>

      {/* Primary aurora band */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: '-10%',
        right: '-10%',
        height: '35%',
        background: `linear-gradient(180deg,
          ${colors[0]}30 0%,
          ${colors[1]}20 40%,
          ${colors[2]}10 70%,
          transparent 100%
        )`,
        filter: 'blur(40px)',
        animation: 'aurora-drift-1 18s ease-in-out infinite',
        willChange: 'transform, opacity',
      }} />

      {/* Secondary band — offset timing */}
      <div style={{
        position: 'absolute',
        top: '2%',
        left: '-10%',
        right: '-10%',
        height: '28%',
        background: `linear-gradient(180deg,
          ${colors[1]}25 0%,
          ${colors[2]}18 35%,
          ${colors[0]}10 65%,
          transparent 100%
        )`,
        filter: 'blur(50px)',
        animation: 'aurora-drift-2 22s ease-in-out infinite',
        willChange: 'transform, opacity',
      }} />

      {/* Tertiary band — deepest, slowest */}
      <div style={{
        position: 'absolute',
        top: '5%',
        left: '-10%',
        right: '-10%',
        height: '22%',
        background: `linear-gradient(180deg,
          ${colors[2]}20 0%,
          ${colors[0]}12 50%,
          transparent 100%
        )`,
        filter: 'blur(60px)',
        animation: 'aurora-drift-3 26s ease-in-out infinite',
        willChange: 'transform, opacity',
      }} />

      {/* Gentle ascending motes */}
      {motes.map((mote) => (
        <div
          key={mote.id}
          style={{
            position: 'absolute',
            left: `${mote.left}%`,
            bottom: '20%',
            width: `${mote.size}px`,
            height: `${mote.size}px`,
            borderRadius: '50%',
            background: mote.color,
            boxShadow: `0 0 ${mote.size * 3}px ${mote.color}`,
            animation: `aurora-shimmer ${mote.duration}s ease-in-out infinite`,
            animationDelay: `${mote.delay}s`,
            willChange: 'opacity',
          }}
        />
      ))}
    </>
  );
};

export default AuroraEffect;
