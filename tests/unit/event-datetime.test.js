import { describe, expect, it } from 'vitest';
import { parseEventDate, serializeEventDate } from '../../src/utils/event-datetime.js';

describe('event-datetime', () => {
  it('parses UTC ISO strings', () => {
    const result = parseEventDate('2026-01-10T13:00:00.000Z');
    expect(result.error).toBeUndefined();
    expect(result.date.toISOString()).toBe('2026-01-10T13:00:00.000Z');
  });

  it('treats bare datetime-local values as Asia/Kolkata wall time', () => {
    const result = parseEventDate('2026-01-10T18:30');
    expect(result.date.toISOString()).toBe('2026-01-10T13:00:00.000Z');
  });

  it('serializes dates as UTC ISO', () => {
    expect(serializeEventDate(new Date('2026-01-10T13:00:00.000Z'))).toBe('2026-01-10T13:00:00.000Z');
  });
});
