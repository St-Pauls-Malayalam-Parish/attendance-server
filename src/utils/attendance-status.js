export const ATTENDANCE_STATUSES = ['present', 'absent', 'excused'];
export const MEMBER_STATUS_FILTERS = [...ATTENDANCE_STATUSES, 'late', 'upcoming', 'unmarked'];

export function isLateArrival(record) {
  if (!record) {
    return false;
  }
  if (record.status === 'late') {
    return true;
  }
  return record.status === 'present' && Boolean(record.late);
}

export function normalizeAttendanceInput({ status, late }) {
  if (status === 'late') {
    return { status: 'present', late: true };
  }
  if (!ATTENDANCE_STATUSES.includes(status)) {
    return null;
  }
  return {
    status,
    late: status === 'present' ? Boolean(late) : false,
  };
}

export function displayAttendanceStatus(record) {
  if (!record?.status) {
    return record?.status ?? '';
  }
  if (isLateArrival(record)) {
    return 'late';
  }
  return record.status;
}

export function countsFromAttendanceRows(rows) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const row of rows) {
    if (row.status === 'excused') {
      counts.excused += 1;
      continue;
    }
    if (row.status === 'absent') {
      counts.absent += 1;
      continue;
    }
    if (row.status === 'present' || row.status === 'late') {
      if (isLateArrival(row)) {
        counts.late += 1;
      } else {
        counts.present += 1;
      }
    }
  }
  return counts;
}

export function serializeRosterAttendance(record) {
  if (!record) {
    return { status: '', late: false, notes: '' };
  }
  if (record.status === 'late') {
    return { status: 'present', late: true, notes: record.notes || '' };
  }
  return {
    status: record.status ?? '',
    late: Boolean(record.late),
    notes: record.notes || '',
  };
}
