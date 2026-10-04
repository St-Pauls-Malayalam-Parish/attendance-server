import { describe, expect, it } from 'vitest';
import {
  buildRosterExportModel,
  buildRosterPdf,
  buildRosterWorkbook,
  rosterExportFields,
  rosterFilterLines,
  selectedExportFields,
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

  it('builds filter lines and field selections for summary exports', () => {
    expect(rosterExportFields(false).map((field) => field.id)).toContain('rate');
    expect(rosterExportFields(true).map((field) => field.id)).toContain('status');
    expect(selectedExportFields(['name', 'voice'], false).map((field) => field.id)).toEqual(['name', 'voice']);

    const filters = rosterFilterLines({}, { attendanceStatus: '', dateFiltered: false });
    expect(filters).toEqual(
      expect.arrayContaining([
        ['Search', 'All members'],
        ['Dates', 'All recorded events'],
      ])
    );
  });

  it('formats members with sparse profile and attendance summaries', () => {
    const sparse = {
      name: '',
      username: '',
      email: '',
      voicePart: 'other',
      voiceRange: '',
      choirPathway: 'unknown-path',
      role: 'member',
      summary: { excused: 2 },
      eventAttendance: { status: 'excused' },
    };

    const model = buildRosterExportModel({
      members: [sparse],
      meta: {
        attendanceStatus: 'excused',
        event: { id: 'e1', title: 'Sunday', date: '2026-09-27T04:00:00.000Z', type: 'service' },
      },
      query: { fields: 'name,voice,pathway,status' },
    });

    expect(model.rows[0]).toEqual(['—', '—', 'unknown-path', 'Excused']);
    expect(model.tally).toMatch(/Excused 1/);
  });

  it('paginates long roster PDFs and handles empty result sets', async () => {
    const members = Array.from({ length: 30 }, (_, index) => ({
      ...member,
      name: `Singer ${index + 1}`,
      username: `singer${index + 1}`,
      eventAttendance: index % 5 === 0 ? { status: 'upcoming' } : { status: 'present' },
    }));

    const crowded = buildRosterExportModel({
      members,
      meta: {
        attendanceStatus: '',
        event: { id: 'event-1', title: 'Sunday service', date: '2026-09-27T04:00:00.000Z', type: 'service' },
      },
      query: { fields: 'name,status' },
    });
    const crowdedPdf = await buildRosterPdf(crowded);
    expect(crowdedPdf.length).toBeGreaterThan(4000);

    const empty = buildRosterExportModel({
      members: [],
      meta: { attendanceStatus: '', dateFiltered: false },
      query: {},
    });
    const emptyPdf = await buildRosterPdf(empty);
    expect(emptyPdf.subarray(0, 4).toString()).toBe('%PDF');

    const workbook = await buildRosterWorkbook({
      ...empty,
      rows: [],
      columns: rosterExportFields(false),
    });
    expect(Buffer.from(workbook).subarray(0, 2).toString()).toBe('PK');
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
