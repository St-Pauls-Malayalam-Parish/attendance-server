import '../helpers/mongoose-mock.js';
import '../helpers/model-mocks.js';
import { describe, expect, it, beforeEach } from 'vitest';
import { Attendance, resetModelMocks } from '../helpers/model-mocks.js';
import {
  buildAttendanceStatusMongoMatch,
  buildMemberAttendanceMatch,
  findEventIdsByMemberAttendance,
  findUserIdsByAttendanceStatus,
  parseRosterAttendanceFilter,
} from '../../src/utils/roster-attendance-filter.js';
import { eventId, userId } from '../helpers/fixtures.js';

describe('roster-attendance-filter', () => {
  it('parses supported attendance filters', () => {
    expect(parseRosterAttendanceFilter('present')).toBe('present');
    expect(parseRosterAttendanceFilter('late')).toBe('late');
    expect(parseRosterAttendanceFilter('absent')).toBe('absent');
    expect(parseRosterAttendanceFilter('excused')).toBe('excused');
    expect(parseRosterAttendanceFilter('upcoming')).toBe('');
    expect(parseRosterAttendanceFilter('')).toBe('');
  });

  it('builds mongo matches for each attendance filter', () => {
    expect(buildAttendanceStatusMongoMatch('present')).toEqual({
      status: { $in: ['present', 'late'] },
    });
    expect(buildAttendanceStatusMongoMatch('late')).toEqual({
      $or: [{ status: 'late' }, { status: 'present', late: true }],
    });
    expect(buildAttendanceStatusMongoMatch('absent')).toEqual({ status: 'absent' });
    expect(buildAttendanceStatusMongoMatch('excused')).toEqual({ status: 'excused' });
    expect(buildAttendanceStatusMongoMatch('')).toBeNull();
  });

  it('builds member attendance matches', () => {
    expect(buildMemberAttendanceMatch('user-1')).toEqual({ user: 'user-1' });
    expect(buildMemberAttendanceMatch('user-1', 'late')).toEqual({
      $and: [{ user: 'user-1' }, { $or: [{ status: 'late' }, { status: 'present', late: true }] }],
    });
  });

  describe('findEventIdsByMemberAttendance', () => {
    beforeEach(() => {
      resetModelMocks();
    });

    it('returns distinct event ids for a member', async () => {
      const memberId = userId().toString();
      const events = [eventId(), eventId()];
      Attendance.distinct.mockResolvedValue(events);

      const result = await findEventIdsByMemberAttendance(memberId, 'present');
      expect(Attendance.distinct).toHaveBeenCalledWith(
        'event',
        buildMemberAttendanceMatch(memberId, 'present')
      );
      expect(result).toEqual(events);
    });

    it('returns all marked events when attendance status is omitted', async () => {
      const memberId = userId().toString();
      Attendance.distinct.mockResolvedValue([]);

      await findEventIdsByMemberAttendance(memberId);
      expect(Attendance.distinct).toHaveBeenCalledWith('event', { user: memberId });
    });
  });

  describe('findUserIdsByAttendanceStatus', () => {
    beforeEach(() => {
      resetModelMocks();
    });

    it('returns null when status is empty', async () => {
      expect(await findUserIdsByAttendanceStatus('')).toBeNull();
      expect(Attendance.aggregate).not.toHaveBeenCalled();
    });

    it('aggregates matching user ids with optional date range', async () => {
      const uid = userId();
      Attendance.aggregate.mockResolvedValue([{ _id: uid }]);
      const range = { $gte: new Date('2026-01-01'), $lte: new Date('2026-01-31') };

      const result = await findUserIdsByAttendanceStatus('excused', range);
      expect(result).toEqual([uid]);
      const pipeline = Attendance.aggregate.mock.calls[0][0];
      expect(pipeline[0].$match).toEqual({ status: 'excused' });
      expect(pipeline.some((stage) => stage.$match?.['eventDoc.date'])).toBe(true);
    });
  });
});
