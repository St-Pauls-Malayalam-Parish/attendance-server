import { describe, expect, it } from 'vitest';
import {
  buildRosterExportModel,
  buildRosterPdf,
  buildRosterWorkbook,
} from '../../src/utils/roster-export.js';

const member = {
  name: 'Angel Benny',
  username: 'angel.benny',
  email: 'angel.benny@stpauls.parish',
  voicePart: 'tenor',
  voiceRange: 'C3–B4',
  choirPathway: 'lead-vocalists',
  role: 'admin',
  onRoster: true,
  summary: { present: 2, late: 1, absent: 1, excused: 0, rate: 75, counted: 4 },
  eventAttendance: { status: 'present', late: true },
};

describe('roster export', () => {
  it('builds a readable summary row from the active filters', () => {
    const model = buildRosterExportModel({
      members: [member],
      meta: { attendanceStatus: 'present', dateFiltered: true, from: '2026-01-01', to: '2026-01-31' },
      query: { search: 'angel', voicePart: 'tenor', attendanceStatus: 'present' },
      generatedAt: new Date('2026-09-30T12:30:00.000Z'),
    });

    expect(model.parish).toMatch(/St Pauls Malayalam Parish/);
    expect(model.rows[0]).toEqual([
      'Angel Benny',
      'angel.benny',
      'angel.benny@stpauls.parish',
      'Tenor',
      'C3–B4',
      'Lead vocalists',
      'Admin',
      '75%',
      '3 present (1 late) · 1 absent',
    ]);
    expect(model.filters).toEqual(
      expect.arrayContaining([
        ['Search', 'angel'],
        ['Voice', 'Tenor'],
        ['Attendance', 'Present'],
        ['Dates', '2026-01-01 to 2026-01-31'],
      ])
    );
  });

  it('keeps only the columns the user selects', () => {
    const model = buildRosterExportModel({
      members: [member],
      meta: {
        attendanceStatus: '',
        event: { id: 'event-1', title: 'Sunday service', date: '2026-09-27T04:00:00.000Z', type: 'service' },
      },
      query: { fields: 'email,name,status,rate' },
    });

    expect(model.columns.map((column) => column.id)).toEqual(['name', 'email', 'status']);
    expect(model.rows[0]).toEqual([
      'Angel Benny',
      'angel.benny@stpauls.parish',
      'Present (arrived late)',
    ]);
  });

  it('rejects an export when no selected column is valid', () => {
    const model = buildRosterExportModel({
      members: [member],
      meta: { attendanceStatus: '', dateFiltered: false },
      query: { fields: 'nope' },
    });
    expect(model.error).toMatch(/at least one column/i);
  });

  it('uses the selected event status instead of the overall rate', () => {
    const model = buildRosterExportModel({
      members: [member],
      meta: {
        attendanceStatus: '',
        event: { id: 'event-1', title: 'Sunday service', date: '2026-09-27T04:00:00.000Z', type: 'service' },
      },
      query: {},
    });

    expect(model.rows[0].at(-1)).toBe('Present (arrived late)');
    expect(model.tally).toMatch(/Arrived late 1/);
    expect(model.filters.some((line) => line[0] === 'Event' && line[1].includes('Sunday service'))).toBe(
      true
    );
  });

  it('renders a PDF and an Excel workbook', async () => {
    const model = buildRosterExportModel({
      members: [member],
      meta: { attendanceStatus: '', dateFiltered: false },
      query: {},
    });

    const pdf = await buildRosterPdf(model);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);

    const workbook = await buildRosterWorkbook(model);
    expect(Buffer.from(workbook).subarray(0, 2).toString()).toBe('PK');
  });
});
