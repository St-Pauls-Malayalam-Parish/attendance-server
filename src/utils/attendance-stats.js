import { Attendance } from '../models/Attendance.js';
import { countsFromAttendanceRows } from './attendance-status.js';

/**
 * Attendance rate uses those who attended (on-time or late) vs absent.
 * Excused absences are tracked but excluded from the rate.
 * Late is a flag on present, not a separate attendance outcome.
 */
export function summaryFromCounts(stats = {}) {
  const present = stats.present || 0;
  const absent = stats.absent || 0;
  const late = stats.late || 0;
  const excused = stats.excused || 0;
  const attended = present + late;
  const total = stats.total ?? attended + absent + excused;
  const counted = attended + absent;

  let rate = 0;
  if (counted > 0) {
    rate = Math.round((attended / counted) * 100);
  }

  return { present, absent, late, excused, total, rate, counted };
}

export function summaryFromStatusRows(rows) {
  const counts = countsFromAttendanceRows(rows);
  return summaryFromCounts({ ...counts, total: rows.length });
}

export async function aggregateAttendanceByUsers(userIds, dateRange = null) {
  if (!userIds.length) {
    return new Map();
  }

  const pipeline = [
    { $match: { user: { $in: userIds } } },
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

  pipeline.push({
    $group: {
      _id: '$user',
      present: {
        $sum: {
          $cond: [
            {
              $and: [
                { $in: ['$status', ['present', 'late']] },
                { $not: { $or: [{ $eq: ['$status', 'late'] }, '$late'] } },
              ],
            },
            1,
            0,
          ],
        },
      },
      absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
      late: {
        $sum: {
          $cond: [
            { $or: [{ $eq: ['$status', 'late'] }, { $and: [{ $eq: ['$status', 'present'] }, '$late'] }] },
            1,
            0,
          ],
        },
      },
      excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
      total: { $sum: 1 },
    },
  });

  const records = await Attendance.aggregate(pipeline);
  return new Map(records.map((row) => [row._id.toString(), row]));
}
