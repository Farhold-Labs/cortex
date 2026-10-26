import React, { useEffect, useState } from 'react';
import { timeLeft } from '../../utils/expiry.js';

/**
 * How long an expiring ping has left (v2.122.0). Re-renders itself, at a pace
 * that fits what is shown — every second in the last minute, every half
 * minute in the last hour, otherwise every ten — so a wave full of them does
 * not tick the whole message list.
 */
export default function ExpiryBadge({ expiresAt, compact = false }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return undefined;
    const ms = Date.parse(expiresAt) - now;
    if (!(ms > 0)) return undefined;
    const step = ms <= 60_000 ? 1000 : ms <= 3_600_000 ? 30_000 : 600_000;
    const t = setTimeout(() => setNow(Date.now()), Math.min(step, ms));
    return () => clearTimeout(t);
  }, [expiresAt, now]);

  const left = timeLeft(expiresAt, now);
  if (!left) return null;
  return (
    <span
      data-testid="expiry-badge"
      title={`Disappears ${new Date(expiresAt).toLocaleString()}`}
      aria-label={`Disappears in ${left}`}
      style={{
        color: 'var(--accent-teal)', fontFamily: 'monospace', whiteSpace: 'nowrap',
        fontSize: compact ? '0.5rem' : '0.6rem', userSelect: 'none',
      }}
    >⏳{left}</span>
  );
}
