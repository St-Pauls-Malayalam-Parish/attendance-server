import { describe, expect, it } from 'vitest';
import {
  buildAttendanceHistoryExportModel,
  buildAttendanceHistoryPdf,
  buildAttendanceHistoryWorkbook,
} from '../../src/utils/attendance-history-export.js';

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

  it('labels each attendance status and supports date filters', () => {
    const rows = [
      {
        event: { title: 'Practice', date: new Date('2026-02-01T10:00:00.000Z'), type: 'practice', liturgicalColor: 'green' },
        status: 'present',
        notes: '',
      },
      {
        event: { title: 'Concert', date: new Date('2026-03-01T10:00:00.000Z'), type: 'concert', liturgicalColor: 'purple' },
        status: 'absent',
        notes: 'Travel',
      },
      {
        event: { title: 'Service', date: new Date('2026-04-01T10:00:00.000Z'), type: 'service', liturgicalColor: 'white' },
        status: 'excused',
        notes: '',
      },
      {
        event: { title: 'Future', date: new Date('2026-12-01T10:00:00.000Z'), type: 'other', liturgicalColor: 'gold' },
        status: 'upcoming',
        notes: '',
      },
      {
        event: { title: 'Unmarked', date: new Date('2026-05-01T10:00:00.000Z'), type: 'rehearsal', liturgicalColor: '' },
        status: '',
        notes: '',
      },
    ];

    const model = buildAttendanceHistoryExportModel({
      history: rows,
      user: { name: 'Susan Jacob' },
      query: {
        search: 'service',
        type: 'service',
        liturgicalColor: 'white',
        status: 'excused',
        from: '2026-01-01',
        to: '2026-12-31',
      },
      generatedAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(model.columns).toHaveLength(6);
    expect(model.rows.map((row) => row[4])).toEqual([
      'Present',
      'Absent',
      'Excused',
      'Upcoming',
      'Not marked',
    ]);
    expect(model.filters.find(([label]) => label === 'Dates')[1]).toMatch(/2026-01-01/);
    expect(model.tally).toMatch(/Excused 1/);
    expect(model.emptyLabel).toBe('No events match these filters.');
  });

  it('renders attendance history PDF and workbook exports', async () => {
    const model = buildAttendanceHistoryExportModel({
      history,
      user: { name: 'Sajini M Chandy' },
      query: {},
    });

    const pdf = await buildAttendanceHistoryPdf(model);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

    const workbook = await buildAttendanceHistoryWorkbook(model);
    expect(Buffer.from(workbook).subarray(0, 2).toString()).toBe('PK');
  });
});
