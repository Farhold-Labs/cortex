/**
 * Server-side Holiday Definitions (v2.40.0)
 * Ported from client/src/config/holidays.js — pure date math, no DOM.
 * Used by daily alert generation to create CrawlBar holiday notices.
 */

/**
 * Calculate Easter Sunday for a given year using the Anonymous Gregorian algorithm
 */
function calculateEaster(year) {
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
 * Get Hanukkah start dates using a lookup table
 */
function getHanukkahDates(year) {
  const hanukkahLookup = {
    2024: new Date(2024, 11, 25),
    2025: new Date(2025, 11, 14),
    2026: new Date(2026, 11, 4),
    2027: new Date(2027, 11, 24),
    2028: new Date(2028, 11, 12),
    2029: new Date(2029, 11, 1),
    2030: new Date(2030, 11, 20),
    2031: new Date(2031, 11, 9),
    2032: new Date(2032, 10, 27),
    2033: new Date(2033, 11, 16),
    2034: new Date(2034, 11, 6),
    2035: new Date(2035, 11, 26),
  };

  const start = hanukkahLookup[year];
  if (!start) {
    return {
      start: new Date(year, 11, 10),
      end: new Date(year, 11, 18)
    };
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return { start, end };
}

/**
 * Holiday definitions with date ranges for alert generation
 */
const HOLIDAYS = {
  newYear: {
    name: "New Year's",
    emoji: '🎆',
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      return (month === 11 && day === 31) || (month === 0 && day <= 2);
    },
    getDateRange: (year) => ({
      start: new Date(year - 1, 11, 31),
      end: new Date(year, 0, 2, 23, 59, 59)
    })
  },

  valentines: {
    name: "Valentine's Day",
    emoji: '❤️',
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      return month === 1 && day >= 12 && day <= 15;
    },
    getDateRange: (year) => ({
      start: new Date(year, 1, 12),
      end: new Date(year, 1, 15, 23, 59, 59)
    })
  },

  elderxeke: {
    name: 'ElderXeke Day',
    emoji: '✨',
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      return month === 2 && day >= 11 && day <= 13;
    },
    getDateRange: (year) => ({
      start: new Date(year, 2, 11),
      end: new Date(year, 2, 13, 23, 59, 59)
    })
  },

  stPatricks: {
    name: "St. Patrick's Day",
    emoji: '☘️',
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      return month === 2 && day >= 15 && day <= 18;
    },
    getDateRange: (year) => ({
      start: new Date(year, 2, 15),
      end: new Date(year, 2, 18, 23, 59, 59)
    })
  },

  easter: {
    name: 'Easter',
    emoji: '🐰',
    isActive: (date) => {
      const year = date.getFullYear();
      const easter = calculateEaster(year);
      const diffDays = Math.abs(Math.floor((date - easter) / (1000 * 60 * 60 * 24)));
      return diffDays <= 2;
    },
    getDateRange: (year) => {
      const easter = calculateEaster(year);
      const start = new Date(easter);
      start.setDate(start.getDate() - 2);
      const end = new Date(easter);
      end.setDate(end.getDate() + 2);
      end.setHours(23, 59, 59);
      return { start, end };
    }
  },

  independenceDay: {
    name: 'Independence Day',
    emoji: '🇺🇸',
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      return month === 6 && day >= 3 && day <= 5;
    },
    getDateRange: (year) => ({
      start: new Date(year, 6, 3),
      end: new Date(year, 6, 5, 23, 59, 59)
    })
  },

  halloween: {
    name: 'Halloween',
    emoji: '🎃',
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      return (month === 9 && day >= 28) || (month === 10 && day === 1);
    },
    getDateRange: (year) => ({
      start: new Date(year, 9, 28),
      end: new Date(year, 10, 1, 23, 59, 59)
    })
  },

  thanksgiving: {
    name: 'Thanksgiving',
    emoji: '🦃',
    isActive: (date) => {
      const year = date.getFullYear();
      const nov1 = new Date(year, 10, 1);
      const dayOfWeek = nov1.getDay();
      const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
      const thanksgiving = new Date(year, 10, 1 + daysUntilThursday + 21);
      const diffDays = Math.floor((date - thanksgiving) / (1000 * 60 * 60 * 24));
      return diffDays >= -2 && diffDays <= 2;
    },
    getDateRange: (year) => {
      const nov1 = new Date(year, 10, 1);
      const dayOfWeek = nov1.getDay();
      const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
      const thanksgiving = new Date(year, 10, 1 + daysUntilThursday + 21);
      const start = new Date(thanksgiving);
      start.setDate(start.getDate() - 2);
      const end = new Date(thanksgiving);
      end.setDate(end.getDate() + 2);
      end.setHours(23, 59, 59);
      return { start, end };
    }
  },

  christmas: {
    name: 'Christmas',
    emoji: '🎄',
    isActive: (date) => {
      const month = date.getMonth();
      const day = date.getDate();
      return month === 11 && day >= 20 && day <= 26;
    },
    getDateRange: (year) => ({
      start: new Date(year, 11, 20),
      end: new Date(year, 11, 26, 23, 59, 59)
    })
  },

  hanukkah: {
    name: 'Hanukkah',
    emoji: '🕎',
    isActive: (date) => {
      const year = date.getFullYear();
      const { start, end } = getHanukkahDates(year);
      return date >= start && date <= end;
    },
    getDateRange: (year) => {
      const { start, end } = getHanukkahDates(year);
      end.setHours(23, 59, 59);
      return { start, end };
    }
  }
};

/**
 * Get the currently active holiday, if any
 * @param {Date} [checkDate] - Date to check (defaults to current date)
 * @returns {{ id: string, name: string, start: Date, end: Date } | null}
 */
export function getCurrentHoliday(checkDate = new Date()) {
  const date = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
  const year = date.getFullYear();

  for (const [key, holiday] of Object.entries(HOLIDAYS)) {
    if (holiday.isActive(date)) {
      const { start, end } = holiday.getDateRange(year);
      return {
        id: key,
        name: holiday.name,
        emoji: holiday.emoji,
        start,
        end
      };
    }
  }

  return null;
}
