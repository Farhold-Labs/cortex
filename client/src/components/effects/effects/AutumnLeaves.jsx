import React, { useState, useEffect, useMemo } from 'react';
import { MapleLeaf, OakLeaf, Leaf } from '../glyphs.jsx';

/**
 * Autumn Leaves Effect - Falling leaves
 * Used for Thanksgiving (4th Thursday of November +/- 2 days)
 */
const AutumnLeaves = ({ colors = ['#D2691E', '#FF8C00', '#8B4513', '#DAA520'] }) => {
  const [particles, setParticles] = useState([]);

  // Generate leaves on mount
  useEffect(() => {
    const leaves = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 12,
      duration: 10 + Math.random() * 8, // 10-18 seconds
      size: 16 + Math.random() * 18, // 16-34px
      opacity: 0.5 + Math.random() * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      type: ['maple', 'oak', 'generic'][Math.floor(Math.random() * 3)],
      rotations: 1 + Math.floor(Math.random() * 3), // 1-3 full rotations
      sway: -60 + Math.random() * 120
    }));
    setParticles(leaves);
  }, [colors]);

  const keyframes = useMemo(() => `
    @keyframes leaf-fall {
      0% {
        transform: translateY(-20px) translateX(0) rotate(0deg);
        opacity: 0;
      }
      10% {
        opacity: 1;
      }
      20% {
        transform: translateY(18vh) translateX(calc(var(--sway) * 0.4)) rotate(calc(var(--rotations) * 72deg));
      }
      40% {
        transform: translateY(38vh) translateX(calc(var(--sway) * -0.6)) rotate(calc(var(--rotations) * 144deg));
      }
      60% {
        transform: translateY(58vh) translateX(calc(var(--sway) * 0.5)) rotate(calc(var(--rotations) * 216deg));
      }
      80% {
        transform: translateY(78vh) translateX(calc(var(--sway) * -0.3)) rotate(calc(var(--rotations) * 288deg));
      }
      90% {
        opacity: 1;
      }
      100% {
        transform: translateY(100vh) translateX(0) rotate(calc(var(--rotations) * 360deg));
        opacity: 0;
      }
    }
  `, []);

  // Drawn shapes, not emoji: see ../glyphs.jsx.
  const LEAVES = { maple: MapleLeaf, oak: OakLeaf, generic: Leaf };

  return (
    <>
      <style>{keyframes}</style>
      {particles.map((leaf) => (
        <div
          key={leaf.id}
          style={{
            position: 'absolute',
            left: `${leaf.left}%`,
            top: '-30px',
            opacity: leaf.opacity,
            animation: `leaf-fall ${leaf.duration}s ease-in-out infinite`,
            animationDelay: `${leaf.delay}s`,
            '--sway': `${leaf.sway}px`,
            '--rotations': leaf.rotations,
            filter: `drop-shadow(0 2px 4px ${leaf.color}40)`,
            willChange: 'transform, opacity'
          }}
        >
          {React.createElement(LEAVES[leaf.type], { size: leaf.size, color: leaf.color })}
        </div>
      ))}
    </>
  );
};

export default AutumnLeaves;
