/**
 * capabilities/datetime.js
 *
 * Injects current date/time context into any query that asks about
 * time, dates, schedules, "today", "now", "when", etc.
 *
 * Without this, SOMA's brain has no idea what time it is — it has
 * a training cutoff and no live clock.
 */

export default {
  name: 'datetime',
  description: 'Current date, time, timezone and day of week',
  category: 'data',
  priority: 90,
  timeout: 500,

  trigger(query) {
    const q = query.toLowerCase();
    return /\b(today|now|current(ly)?|time|date|day|week|month|year|morning|afternoon|evening|night|tonight|tomorrow|yesterday|schedule|when|how long|ago|since|until|deadline)\b/.test(q);
  },

  handler() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];

    return {
      date: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      dayOfWeek: days[now.getDay()],
      month: months[now.getMonth()],
      year: now.getFullYear(),
      isoString: now.toISOString(),
      timestamp: now.getTime(),
    };
  }
};
