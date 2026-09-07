import { Attendance } from '../models/Attendance.js';

export const ROSTER_ATTENDANCE_FILTERS = ['present', 'late', 'absent', 'excused'];

export function parseRosterAttendanceFilter(value) {
  if (typeof value !== 'string' || !ROSTER_ATTENDANCE_FILTERS.includes(value)) {
    return '';
  }
  return value;
}

export function buildAttendanceStatusMongoMatch(status) {
  switch (status) {
    case 'present':
      return { status: { $in: ['present', 'late'] } };
    case 'late':
      return {
        $or: [{ status: 'late' }, { status: 'present', late: true }],
      };
    case 'absent':
      return { status: 'absent' };
    case 'excused':
      return { status: 'excused' };
    default:
      return null;
  }
}

export function buildMemberAttendanceMatch(userId, attendanceStatus = '') {
  const userMatch = { user: userId };
  const statusMatch = attendanceStatus ? buildAttendanceStatusMongoMatch(attendanceStatus) : null;
  if (!statusMatch) {
    return userMatch;
  }
  return { $and: [userMatch, statusMatch] };
}

export async function findEventIdsByMemberAttendance(userId, attendanceStatus = '') {
  return Attendance.distinct('event', buildMemberAttendanceMatch(userId, attendanceStatus));
}

export async function findUserIdsByAttendanceStatus(status, dateRange = null) {
  const statusMatch = buildAttendanceStatusMongoMatch(status);
  if (!statusMatch) {
    return null;
  }

  const pipeline = [
    { $match: statusMatch },
    {
      $lookup: {
        from: 'events',
        localField: 'event',
        foreignField: '_id',
        as: 'eventDoc',
      },
    },
    { $unwind: '$eventDoc' },
  ];

  if (dateRange) {
    pipeline.push({ $match: { 'eventDoc.date': dateRange } });
  }

  pipeline.push({ $group: { _id: '$user' } });

  const rows = await Attendance.aggregate(pipeline);
  return rows.map((row) => row._id);
}
