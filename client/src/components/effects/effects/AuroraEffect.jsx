import React, { useMemo } from 'react';

/**
 * Aurora / Bifrost Effect - Ethereal bands of shifting color
 * Used for Elderxeke Day — a quiet, reverent tribute
 */

// Parse hex color to rgba with given alpha
const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const AuroraEffect = ({ colors = ['#2ECC71', '#3498DB', '#FFD700'] }) => {
  const keyframes = useMemo(() => `
    @keyframes aurora-drift-1 {
      0% { transform: translateX(-5%) scaleY(1); opacity: 0.7; }
      25% { transform: translateX(3%) scaleY(1.15); opacity: 1; }
      50% { transform: translateX(5%) scaleY(0.9); opacity: 0.6; }
      75% { transform: translateX(-3%) scaleY(1.1); opacity: 0.9; }
      100% { transform: translateX(-5%) scaleY(1); opacity: 0.7; }
    }
    @keyframes aurora-drift-2 {
      0% { transform: translateX(4%) scaleY(1.1); opacity: 0.6; }
      30% { transform: translateX(-6%) scaleY(0.85); opacity: 0.9; }
      60% { transform: translateX(3%) scaleY(1.2); opacity: 0.5; }
      100% { transform: translateX(4%) scaleY(1.1); opacity: 0.6; }
    }
    @keyframes aurora-drift-3 {
      0% { transform: translateX(-3%) scaleY(0.9); opacity: 0.5; }
      35% { transform: translateX(5%) scaleY(1.15); opacity: 0.8; }
      65% { transform: translateX(-4%) scaleY(1); opacity: 0.4; }
      100% { transform: translateX(-3%) scaleY(0.9); opacity: 0.5; }
    }
    @keyframes aurora-mote-rise {
      0% { transform: translateY(0); opacity: 0; }
      15% { opacity: 0.6; }
      85% { opacity: 0.6; }
      100% { transform: translateY(-30vh); opacity: 0; }
    }
  `, []);

  const motes = useMemo(() =>
    Array.from({ length: 15 }, (_, i) => ({
      id: i,
      left: 5 + Math.random() * 90,
      delay: Math.random() * 20,
      duration: 12 + Math.random() * 10,
      size: 2 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)],
    })), [colors]);

  return (
    <>
      <style>{keyframes}</style>

      {/* Primary aurora band */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '40%',
        background: `linear-gradient(180deg,
          ${hexToRgba(colors[0], 0.25)} 0%,
          ${hexToRgba(colors[1], 0.15)} 40%,
          ${hexToRgba(colors[2], 0.06)} 70%,
          transparent 100%
        )`,
        filter: 'blur(20px)',
        animation: 'aurora-drift-1 18s ease-in-out infinite',
        willChange: 'transform, opacity',
      }} />

      {/* Secondary band */}
      <div style={{
        position: 'absolute',
        top: '3%',
        left: 0,
        right: 0,
        height: '35%',
        background: `linear-gradient(180deg,
          ${hexToRgba(colors[1], 0.2)} 0%,
          ${hexToRgba(colors[2], 0.12)} 35%,
          ${hexToRgba(colors[0], 0.05)} 65%,
          transparent 100%
        )`,
        filter: 'blur(25px)',
        animation: 'aurora-drift-2 22s ease-in-out infinite',
        willChange: 'transform, opacity',
      }} />

      {/* Tertiary band */}
      <div style={{
        position: 'absolute',
        top: '6%',
        left: 0,
        right: 0,
        height: '30%',
        background: `linear-gradient(180deg,
          ${hexToRgba(colors[2], 0.18)} 0%,
          ${hexToRgba(colors[0], 0.1)} 50%,
          transparent 100%
        )`,
        filter: 'blur(30px)',
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
            top: '60%',
            width: `${mote.size}px`,
            height: `${mote.size}px`,
            borderRadius: '50%',
            background: mote.color,
            boxShadow: `0 0 ${mote.size * 4}px ${mote.color}`,
            animation: `aurora-mote-rise ${mote.duration}s ease-in-out infinite`,
            animationDelay: `${mote.delay}s`,
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </>
  );
};

export default AuroraEffect;
