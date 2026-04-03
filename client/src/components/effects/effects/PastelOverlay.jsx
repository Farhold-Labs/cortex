import React, { useState, useEffect, useMemo } from 'react';

/**
 * Pastel Overlay - Subtle gradient overlay with floating elements
 * Used for Easter (variable +/- 2 days)
 */
const PastelOverlay = ({ colors = ['#FFB6C1', '#87CEEB', '#DDA0DD', '#98FB98'] }) => {
  const [particles, setParticles] = useState([]);

  // Generate pastel elements (eggs, flowers, butterflies)
  useEffect(() => {
    const elements = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 20,
      duration: 15 + Math.random() * 10, // 15-25 seconds
      size: 12 + Math.random() * 14, // 12-26px
      opacity: 0.25 + Math.random() * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)],
      type: ['egg', 'flower', 'butterfly'][Math.floor(Math.random() * 3)],
      drift: -30 + Math.random() * 60
    }));
    setParticles(elements);
  }, [colors]);

  const keyframes = useMemo(() => `
    @keyframes pastel-float {
      0% {
        transform: translateY(100vh) translateX(0) scale(0.8);
        opacity: 0;
      }
      10% {
        opacity: 1;
      }
      50% {
        transform: translateY(50vh) translateX(var(--drift)) scale(1);
      }
      90% {
        opacity: 1;
      }
      100% {
        transform: translateY(-10vh) translateX(calc(var(--drift) * -0.5)) scale(0.8);
        opacity: 0;
      }
    }
    @keyframes butterfly-flutter {
      0%, 100% { transform: scaleX(1); }
      50% { transform: scaleX(0.3); }
    }
  `, []);

  const getSymbol = (type) => {
    switch (type) {
      case 'egg': return String.fromCharCode(0x1F423); // hatching chick emoji
      case 'flower': return String.fromCharCode(0x1F338); // cherry blossom emoji
      case 'butterfly': return String.fromCharCode(0x1F407); // rabbit emoji
      default: return '*';
    }
  };

  return (
    <>
      <style>{keyframes}</style>
      {/* Subtle gradient overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${colors[0]}08, ${colors[1]}05, ${colors[2]}08, ${colors[3]}05)`,
          pointerEvents: 'none'
        }}
      />
      {/* Floating elements */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          style={{
            position: 'absolute',
            left: `${particle.left}%`,
            bottom: '-30px',
            fontSize: `${particle.size}px`,
            opacity: particle.opacity,
            animation: `pastel-float ${particle.duration}s ease-in-out infinite`,
            animationDelay: `${particle.delay}s`,
            '--drift': `${particle.drift}px`,
            filter: `drop-shadow(0 0 4px ${particle.color}80)`,
            willChange: 'transform, opacity'
          }}
        >
          <span style={{
            display: 'inline-block',
            animation: particle.type === 'butterfly' ? 'butterfly-flutter 0.3s ease-in-out infinite' : 'none'
          }}>
            {getSymbol(particle.type)}
          </span>
        </div>
      ))}
    </>
  );
};

export default PastelOverlay;
