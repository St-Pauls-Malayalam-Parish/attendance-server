import { buildRosterPdf, buildRosterWorkbook } from './roster-export.js';

const TYPE_LABELS = {
  practice: 'Practice',
  rehearsal: 'Practice',
  service: 'Service',
  concert: 'Concert',
  other: 'Other',
};

const COLOR_LABELS = {
  white: 'White',
  green: 'Green',
  purple: 'Purple',
  red: 'Red',
  black: 'Black',
};

const STATUS_FILTER_LABELS = {
  present: 'Present (on time)',
  late: 'Present (arrived late)',
  absent: 'Absent',
  excused: 'Excused',
  upcoming: 'Upcoming',
  unmarked: 'Not marked',
};

const HISTORY_FIELDS = [
  { id: 'date', header: 'Date', excelWidth: 28, value: (row) => formatWhen(row.event.date) },
  { id: 'event', header: 'Event', excelWidth: 32, value: (row) => row.event.title || '—' },
  { id: 'type', header: 'Type', excelWidth: 14, value: (row) => typeLabel(row.event.type) },
  {
    id: 'color',
    header: 'Liturgical color',
    excelWidth: 18,
    value: (row) => colorLabel(row.event.liturgicalColor),
  },
  { id: 'status', header: 'Attendance', excelWidth: 24, value: (row) => historyStatusLabel(row) },
  { id: 'notes', header: 'Notes', excelWidth: 36, value: (row) => row.notes || '—' },
];

function formatWhen(value) {
  return new Date(value).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function typeLabel(value) {
  if (!value) return '—';
  return TYPE_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

function colorLabel(value) {
  if (!value) return 'Not set';
  return COLOR_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

function historyStatusLabel(row) {
  if (row.late || row.status === 'late') return 'Present (arrived late)';
  if (row.status === 'present') return 'Present';
  if (row.status === 'absent') return 'Absent';
  if (row.status === 'excused') return 'Excused';
  if (row.status === 'upcoming') return 'Upcoming';
  return 'Not marked';
}

function selectedFields(fieldsValue) {
  if (fieldsValue == null || fieldsValue === '') return HISTORY_FIELDS;
  const raw = Array.isArray(fieldsValue) ? fieldsValue.join(',') : String(fieldsValue);
  const requested = new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
  return HISTORY_FIELDS.filter((field) => requested.has(field.id));
}

function historyTally(history) {
  const counts = { Present: 0, Late: 0, Absent: 0, Excused: 0, Upcoming: 0 };
  for (const row of history) {
    const label = historyStatusLabel(row);
    if (label === 'Present (arrived late)') counts.Late += 1;
    else if (label === 'Present') counts.Present += 1;
    else if (label === 'Absent') counts.Absent += 1;
    else if (label === 'Excused') counts.Excused += 1;
    else if (label === 'Upcoming') counts.Upcoming += 1;
  }
  const parts = [
    `${history.length} event${history.length === 1 ? '' : 's'}`,
    `Present ${counts.Present + counts.Late}`,
  ];
  if (counts.Late) parts.push(`Arrived late ${counts.Late}`);
  parts.push(`Absent ${counts.Absent}`, `Excused ${counts.Excused}`);
  if (counts.Upcoming) parts.push(`Upcoming ${counts.Upcoming}`);
  return parts.join('   ·   ');
}

export function buildAttendanceHistoryExportModel({ history, user, query = {}, selectedEvent = null, generatedAt = new Date() }) {
  const columns = selectedFields(query.fields);
  if (query.fields != null && query.fields !== '' && columns.length === 0) {
    return { error: 'Choose at least one column to export' };
  }

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const filters = [
    ['Search', search || 'All events'],
    ['Event', selectedEvent ? `${selectedEvent.title} · ${formatWhen(selectedEvent.date)}` : 'All events'],
    ['Type', query.type ? typeLabel(query.type) : 'All types'],
    ['Liturgical color', query.liturgicalColor ? colorLabel(query.liturgicalColor) : 'All colors'],
    ['Status', STATUS_FILTER_LABELS[query.status] || 'All statuses'],
  ];
  if (!selectedEvent) {
    filters.push(['Dates', query.from || query.to ? `${query.from || 'Beginning'} to ${query.to || 'Today'}` : 'All recorded events']);
  }

  return {
    parish: 'St Pauls Malayalam Parish, Pune',
    church: 'Church of South India',
    title: `${user?.name || 'Choir member'} — My attendance`,
    generatedAt,
    generatedLabel: generatedAt.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    filters,
    tally: historyTally(history),
    columns,
    rows: history.map((row) => columns.map((column) => column.value(row))),
    eventMode: false,
    emptyLabel: 'No events match these filters.',
  };
}

export function buildAttendanceHistoryPdf(model) {
  return buildRosterPdf(model);
}

export function buildAttendanceHistoryWorkbook(model) {
  return buildRosterWorkbook(model);
}
