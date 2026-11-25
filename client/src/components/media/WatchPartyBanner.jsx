import React from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';

/**
 * WatchPartyBanner Component (v2.14.0; rewired v2.155.3)
 *
 * Shows a banner in WaveView when a watch party is active in that wave.
 *
 * Props:
 * - party: normalised party (utils/watchParty.js): { id, name, hostName, state }
 * - isHost: boolean - whether current user is the host
 * - onJoin: () => void - open the player (joining is watching)
 * - onEnd: () => void - host only: end the party for everyone
 * - isMobile: boolean
 */
const WatchPartyBanner = ({ party, isHost, onJoin, onEnd, isMobile }) => {
  if (!party) return null;

  const isPlaying = party.state === 'playing';
  const button = {
    padding: isMobile ? '10px 14px' : '8px 12px',
    minHeight: isMobile ? '44px' : 'auto',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(255, 210, 63, 0.15), transparent)',
      borderBottom: '1px solid rgba(255, 210, 63, 0.4)',
      padding: isMobile ? '10px 12px' : '10px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
        <div style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: isPlaying ? 'var(--status-color, #0ead69)' : 'var(--accent-color, #ffd23f)',
          boxShadow: isPlaying ? '0 0 8px var(--status-color, #0ead69)' : 'none',
          animation: isPlaying ? 'watchPartyPulse 2s infinite' : 'none',
          flexShrink: 0,
        }} />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <GlowText color="var(--accent-color, #ffd23f)" size="0.75rem">WATCH PARTY</GlowText>
            <span style={{ color: 'var(--text-secondary, rgba(255,255,255,0.6))', fontSize: '0.75rem', fontFamily: 'monospace' }}>
              {isPlaying ? 'Now playing' : 'Paused'}
            </span>
          </div>
          <div style={{
            color: 'var(--text-primary, #e0e0e0)',
            fontSize: '0.85rem',
            marginTop: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {party.name}
          </div>
          <div style={{ color: 'var(--text-muted, rgba(255,255,255,0.4))', fontSize: '0.7rem', marginTop: '2px' }}>
            {isHost ? 'You are hosting' : `Hosted by ${party.hostName || 'someone'}`}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        {isHost && (
          <button
            onClick={onEnd}
            style={{ ...button, background: 'transparent', border: '1px solid var(--accent-orange, #ff6b35)', color: 'var(--accent-orange, #ff6b35)' }}
            title="End the watch party for everyone"
          >
            END
          </button>
        )}
        <button
          onClick={onJoin}
          style={{ ...button, background: 'var(--accent-color, #ffd23f)', border: 'none', color: 'var(--bg-color, #050805)', fontWeight: 600 }}
          title="Open the player"
        >
          ▶ WATCH
        </button>
      </div>

      <style>{`
        @keyframes watchPartyPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};

export default WatchPartyBanner;
