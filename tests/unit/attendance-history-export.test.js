import { describe, expect, it } from 'vitest';
import { buildAttendanceHistoryExportModel } from '../../src/utils/attendance-history-export.js';

const history = [
  {
    event: {
      id: '1',
      title: 'Sunday service',
      date: new Date('2026-01-04T04:30:00.000Z'),
      type: 'service',
      liturgicalColor: 'white',
    },
    status: 'late',
    late: true,
    notes: 'Arrived during the hymn',
  },
];

describe('attendance history export', () => {
  it('keeps the requested columns and names the selected event', () => {
    const model = buildAttendanceHistoryExportModel({
      history,
      user: { name: 'Sajini M Chandy' },
      query: { fields: 'event,status,notes', eventId: '1', status: 'late' },
      selectedEvent: { title: 'Sunday service', date: history[0].event.date },
      generatedAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(model.error).toBeUndefined();
    expect(model.title).toBe('Sajini M Chandy — My attendance');
    expect(model.columns.map((column) => column.header)).toEqual(['Event', 'Attendance', 'Notes']);
    expect(model.rows[0]).toEqual(['Sunday service', 'Present (arrived late)', 'Arrived during the hymn']);
    expect(model.filters.find(([label]) => label === 'Event')[1]).toMatch(/Sunday service/);
    expect(model.filters.find(([label]) => label === 'Status')[1]).toMatch(/arrived late/i);
    expect(model.filters.some(([label]) => label === 'Dates')).toBe(false);
    expect(model.tally).toMatch(/Arrived late 1/);
  });

  it('rejects an export with no valid columns', () => {
    const model = buildAttendanceHistoryExportModel({
      history,
      user: { name: 'Sajini M Chandy' },
      query: { fields: 'voice,email' },
    });
    expect(model.error).toMatch(/at least one column/i);
  });
});
