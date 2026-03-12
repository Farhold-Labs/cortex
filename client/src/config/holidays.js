/**
 * Holiday Calendar System (v2.20.0)
 * Automatic holiday-themed visual effects
 */

/**
 * Calculate Easter Sunday for a given year using the Anonymous Gregorian algorithm
 * @param {number} year - The year to calculate Easter for
 * @returns {Date} - Easter Sunday date
 */
export function calculateEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
}

/**
 * Get Hanukkah start dates using a lookup table for common years
 * Hanukkah begins on 25 Kislev in the Hebrew calendar
 * @param {number} year - The Gregorian year
 * @returns {{ start: Date, end: Date }} - Start and end dates of Hanukkah
 */
export function getHanukkahDates(year) {
  // Lookup table for Hanukkah start dates (25 Kislev in Gregorian)
  // These are approximate - Hanukkah can start between late November and late December
  const hanukkahLookup = {
    2024: new Date(2024, 11, 25), // Dec 25, 2024
    2025: new Date(2025, 11, 14), // Dec 14, 2025
    2026: new Date(2026, 11, 4),  // Dec 4, 2026
    2027: new Date(2027, 11, 24), // Dec 24, 2027
    2028: new Date(2028, 11, 12), // Dec 12, 2028
    2029: new Date(2029, 11, 1),  // Dec 1, 2029
    2030: new Date(2030, 11, 20), // Dec 20, 2030
    2031: new Date(2031, 11, 9),  // Dec 9, 2031
    2032: new Date(2032, 10, 27), // Nov 27, 2032
    2033: new Date(2033, 11, 16), // Dec 16, 2033
    2034: new Date(2034, 11, 6),  // Dec 6, 2034
    2035: new Date(2035, 11, 26), // Dec 26, 2035
  };

  const start = hanukkahLookup[year];
  if (!start) {
    // Fallback: estimate based on typical range (mid-December)
    return {
      start: new Date(year, 11, 10),
      end: new Date(year, 11, 18)
    };
  }

  // Hanukkah lasts 8 days
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return { start, end };
}

/**
 * Holiday definitions with date range functions, effect types, and colors
 */
export const HOLIDAYS = {
  newYear: {
    name: "New Year's",
    effect: 'fireworks',
    colors: ['#FFD700', '#FFFFFF', '#C0C0C0'], // Gold, White, Silver
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      // Dec 31 - Jan 2
      return (month === 11 && day === 31) || (month === 0 && day <= 2);
    }
  },

  valentines: {
    name: "Valentine's Day",
    effect: 'hearts',
    colors: ['#FF69B4', '#FF1493', '#FFC0CB'], // Pink, Deep Pink, Light Pink
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      // Feb 12-15
      return month === 1 && day >= 12 && day <= 15;
    }
  },

  elderxeke: {
    name: 'Elderxeke Day',
    effect: 'aurora',
    colors: ['#9B59B6', '#3498DB', '#FFD700'], // Purple, Blue, Gold (Bifrost)
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      // Mar 11-13
      return month === 2 && day >= 11 && day <= 13;
    }
  },

  stPatricks: {
    name: "St. Patrick's Day",
    effect: 'shamrocks',
    colors: ['#228B22', '#32CD32', '#FFD700'], // Green, Lime Green, Gold
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      // Mar 15-18
      return month === 2 && day >= 15 && day <= 18;
    }
  },

  easter: {
    name: 'Easter',
    effect: 'pastel',
    colors: ['#FFB6C1', '#87CEEB', '#DDA0DD', '#98FB98'], // Light Pink, Sky Blue, Plum, Pale Green
    isActive: (date) => {
      const year = date.getFullYear();
      const easter = calculateEaster(year);
      const diffDays = Math.abs(Math.floor((date - easter) / (1000 * 60 * 60 * 24)));
      // Easter +/- 2 days
      return diffDays <= 2;
    }
  },

  independenceDay: {
    name: 'Independence Day',
    effect: 'fireworks',
    colors: ['#FF0000', '#FFFFFF', '#0000FF'], // Red, White, Blue
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      // Jul 3-5
      return month === 6 && day >= 3 && day <= 5;
    }
  },

  halloween: {
    name: 'Halloween',
    effect: 'spooky',
    colors: ['#FF6600', '#800080', '#000000'], // Orange, Purple, Black
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      // Oct 28 - Nov 1
      return (month === 9 && day >= 28) || (month === 10 && day === 1);
    }
  },

  thanksgiving: {
    name: 'Thanksgiving',
    effect: 'autumn',
    colors: ['#D2691E', '#FF8C00', '#8B4513', '#DAA520'], // Chocolate, Dark Orange, Saddle Brown, Goldenrod
    isActive: (date) => {
      const year = date.getFullYear();
      // Find 4th Thursday of November
      const nov1 = new Date(year, 10, 1);
      const dayOfWeek = nov1.getDay();
      // Days until first Thursday
      const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
      // 4th Thursday
      const thanksgiving = new Date(year, 10, 1 + daysUntilThursday + 21);

      const diffDays = Math.floor((date - thanksgiving) / (1000 * 60 * 60 * 24));
      // Thanksgiving +/- 2 days
      return diffDays >= -2 && diffDays <= 2;
    }
  },

  christmas: {
    name: 'Christmas',
    effect: 'snow',
    colors: ['#FF0000', '#00FF00', '#FFD700'], // Red, Green, Gold
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      // Dec 20-26
      return month === 11 && day >= 20 && day <= 26;
    }
  },

  hanukkah: {
    name: 'Hanukkah',
    effect: 'candle',
    colors: ['#0000FF', '#FFFFFF', '#FFD700'], // Blue, White, Gold
    isActive: (date) => {
      const year = date.getFullYear();
      const { start, end } = getHanukkahDates(year);
      return date >= start && date <= end;
    }
  }
};

/**
 * Get the currently active holiday, if any
 * @param {Date} [checkDate] - Date to check (defaults to current date)
 * @returns {Object|null} - Active holiday object or null
 */
export function getCurrentHoliday(checkDate = new Date()) {
  // Normalize to midnight for consistent date comparisons
  const date = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());

  for (const [key, holiday] of Object.entries(HOLIDAYS)) {
    if (holiday.isActive(date)) {
      return {
        id: key,
        ...holiday
      };
    }
  }

  return null;
}

/**
 * Get all holidays and their next occurrence
 * Useful for testing/debugging
 * @returns {Array} - Array of holidays with their details
 */
export function getAllHolidays() {
  return Object.entries(HOLIDAYS).map(([key, holiday]) => ({
    id: key,
    name: holiday.name,
    effect: holiday.effect,
    colors: holiday.colors
  }));
}
