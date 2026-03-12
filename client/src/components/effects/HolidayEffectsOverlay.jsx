import React, { useState, useEffect, useCallback } from 'react';
import { getCurrentHoliday } from '../../config/holidays.js';

// Lazy-load effect components
import SnowEffect from './effects/SnowEffect.jsx';
import HeartsEffect from './effects/HeartsEffect.jsx';
import FireworksEffect from './effects/FireworksEffect.jsx';
import ShamrockEffect from './effects/ShamrockEffect.jsx';
import PastelOverlay from './effects/PastelOverlay.jsx';
import SpookyEffect from './effects/SpookyEffect.jsx';
import AutumnLeaves from './effects/AutumnLeaves.jsx';
import CandleGlow from './effects/CandleGlow.jsx';
import AuroraEffect from './effects/AuroraEffect.jsx';

/**
 * Holiday Effects Overlay (v2.20.0, fixed v2.22.1)
 *
 * Main orchestrator component for holiday visual effects.
 * - Checks for active holiday on mount and at midnight
 * - Applies holiday CSS variables to document root
 * - Renders appropriate effect component
 */
const HolidayEffectsOverlay = ({ enabled = true }) => {
  const [activeHoliday, setActiveHoliday] = useState(null);

  // Check for active holiday
  const checkHoliday = useCallback(() => {
    const holiday = getCurrentHoliday();
    setActiveHoliday(holiday);

    // Apply or remove CSS variables based on active holiday
    if (holiday) {
      document.documentElement.style.setProperty('--holiday-color-1', holiday.colors[0] || '#FFD700');
      document.documentElement.style.setProperty('--holiday-color-2', holiday.colors[1] || '#FFFFFF');
      document.documentElement.style.setProperty('--holiday-color-3', holiday.colors[2] || '#C0C0C0');
      document.documentElement.style.setProperty('--holiday-name', `"${holiday.name}"`);
    } else {
      document.documentElement.style.removeProperty('--holiday-color-1');
      document.documentElement.style.removeProperty('--holiday-color-2');
      document.documentElement.style.removeProperty('--holiday-color-3');
      document.documentElement.style.removeProperty('--holiday-name');
    }
  }, []);

  // Initial check and midnight check setup
  useEffect(() => {
    checkHoliday();

    // Calculate time until next midnight
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow - now;

    // Check at midnight and then every 24 hours
    const midnightTimeout = setTimeout(() => {
      checkHoliday();
      // Set up daily interval after first midnight
      const dailyInterval = setInterval(checkHoliday, 24 * 60 * 60 * 1000);
      return () => clearInterval(dailyInterval);
    }, msUntilMidnight);

    return () => clearTimeout(midnightTimeout);
  }, [checkHoliday]);

  // Cleanup CSS variables on unmount
  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty('--holiday-color-1');
      document.documentElement.style.removeProperty('--holiday-color-2');
      document.documentElement.style.removeProperty('--holiday-color-3');
      document.documentElement.style.removeProperty('--holiday-name');
    };
  }, []);

  // Don't render if disabled or no active holiday
  if (!enabled || !activeHoliday) {
    return null;
  }

  // Map effect type to component
  const EffectComponent = {
    snow: SnowEffect,
    hearts: HeartsEffect,
    fireworks: FireworksEffect,
    shamrocks: ShamrockEffect,
    pastel: PastelOverlay,
    spooky: SpookyEffect,
    autumn: AutumnLeaves,
    candle: CandleGlow,
    aurora: AuroraEffect
  }[activeHoliday.effect];

  if (!EffectComponent) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        overflow: 'hidden'
      }}
    >
      <EffectComponent colors={activeHoliday.colors} holidayName={activeHoliday.name} />
    </div>
  );
};

export default HolidayEffectsOverlay;
