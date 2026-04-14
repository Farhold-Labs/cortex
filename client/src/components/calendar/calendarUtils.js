// ============ Calendar Utilities (v2.47.0) ============

export const CATEGORY_COLORS = {
  general:   'var(--accent-teal)',
  birthday:  'var(--accent-purple)',
  holiday:   'var(--accent-amber)',
  community: 'var(--accent-green)',
  personal:  'var(--accent-orange)',
};

export const SCOPE_LABELS = {
  server:   'Server-Wide',
  wave:     'Wave',
  personal: 'Personal',
};

export function formatEventTime(event) {
  if (!event.eventTime) return 'All day';
  const [h, m] = event.eventTime.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  const end = event.eventEndTime ? ` – ${formatTime(event.eventEndTime)}` : '';
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}${end}`;
}

export function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatEventDate(dateStr) {
  if (!dateStr) return '';
  // Handle MM-DD recurring format
  if (/^\d{2}-\d{2}$/.test(dateStr)) {
    const [m, d] = dateStr.split('-');
    return new Date(2000, parseInt(m) - 1, parseInt(d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// Returns array of { date: 'YYYY-MM-DD', events: [] } for the given month
export function getMonthDays(year, month) {
  const days = [];
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  // Leading blanks
  for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push(dateStr);
  }
  return days;
}

export function eventsForDate(events, dateStr) {
  return events.filter(e => e.eventDate === dateStr);
}

export const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
export const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
