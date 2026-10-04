const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const HAS_TIME_ZONE = /(Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i;

/** Fixed offset for Asia/Kolkata (no DST). Parish default when a bare datetime-local is posted. */
const KOLKATA_OFFSET_MINUTES = 330;

function parseWallClockInKolkata(text) {
  const match = text.match(LOCAL_DATE_TIME);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - KOLKATA_OFFSET_MINUTES * 60 * 1000;
  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parse event date from the API. Prefer UTC ISO strings from the client.
 * Bare `YYYY-MM-DDTHH:mm` values are treated as parish local time (Asia/Kolkata).
 */
export function parseEventDate(value) {
  if (value == null || value === '') {
    return { error: 'Event date is required' };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { error: 'Event date is required' };
    }
    return { date: value };
  }

  const text = String(value).trim();
  if (LOCAL_DATE_TIME.test(text) && !HAS_TIME_ZONE.test(text)) {
    const date = parseWallClockInKolkata(text);
    if (!date) {
      return { error: 'Event date is required' };
    }
    return { date };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return { error: 'Event date is required' };
  }
  return { date: parsed };
}

export function serializeEventDate(date) {
  if (!date) return date;
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return date;
  return value.toISOString();
}
