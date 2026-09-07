import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_STATUSES,
  MEMBER_STATUS_FILTERS,
  countsFromAttendanceRows,
  displayAttendanceStatus,
  isLateArrival,
  normalizeAttendanceInput,
  serializeRosterAttendance,
} from '../../src/utils/attendance-status.js';

describe('attendance-status', () => {
  it('exports attendance status constants', () => {
    expect(ATTENDANCE_STATUSES).toEqual(['present', 'absent', 'excused']);
    expect(MEMBER_STATUS_FILTERS).toContain('late');
    expect(MEMBER_STATUS_FILTERS).toContain('unmarked');
  });

  describe('isLateArrival', () => {
    it('detects legacy late status and present+late flag', () => {
      expect(isLateArrival(null)).toBe(false);
      expect(isLateArrival({ status: 'late' })).toBe(true);
      expect(isLateArrival({ status: 'present', late: true })).toBe(true);
      expect(isLateArrival({ status: 'present', late: false })).toBe(false);
      expect(isLateArrival({ status: 'absent' })).toBe(false);
    });
  });

  describe('normalizeAttendanceInput', () => {
    it('normalizes present with optional late flag', () => {
      expect(normalizeAttendanceInput({ status: 'present', late: false })).toEqual({
        status: 'present',
        late: false,
      });
      expect(normalizeAttendanceInput({ status: 'present', late: true })).toEqual({
        status: 'present',
        late: true,
      });
    });

    it('maps legacy late status to present+late', () => {
      expect(normalizeAttendanceInput({ status: 'late' })).toEqual({
        status: 'present',
        late: true,
      });
    });

    it('clears late flag for absent and excused', () => {
      expect(normalizeAttendanceInput({ status: 'absent', late: true })).toEqual({
        status: 'absent',
        late: false,
      });
      expect(normalizeAttendanceInput({ status: 'excused', late: true })).toEqual({
        status: 'excused',
        late: false,
      });
    });

    it('rejects invalid statuses', () => {
      expect(normalizeAttendanceInput({ status: 'maybe' })).toBeNull();
      expect(normalizeAttendanceInput({ status: 'upcoming' })).toBeNull();
    });
  });

  describe('displayAttendanceStatus', () => {
    it('returns late for late arrivals and base status otherwise', () => {
      expect(displayAttendanceStatus({ status: 'present', late: true })).toBe('late');
      expect(displayAttendanceStatus({ status: 'late' })).toBe('late');
      expect(displayAttendanceStatus({ status: 'present', late: false })).toBe('present');
      expect(displayAttendanceStatus({ status: 'absent' })).toBe('absent');
      expect(displayAttendanceStatus(null)).toBe('');
    });
  });

  describe('countsFromAttendanceRows', () => {
    it('counts present, late, absent, and excused separately', () => {
      expect(
        countsFromAttendanceRows([
          { status: 'present', late: false },
          { status: 'present', late: true },
          { status: 'late' },
          { status: 'absent' },
          { status: 'excused' },
        ])
      ).toEqual({ present: 1, absent: 1, late: 2, excused: 1 });
    });
  });

  describe('serializeRosterAttendance', () => {
    it('serializes empty, legacy late, and flagged present records', () => {
      expect(serializeRosterAttendance(null)).toEqual({
        status: '',
        late: false,
        notes: '',
      });
      expect(serializeRosterAttendance({ status: 'late', notes: 'Traffic' })).toEqual({
        status: 'present',
        late: true,
        notes: 'Traffic',
      });
      expect(serializeRosterAttendance({ status: 'present', late: true, notes: '' })).toEqual({
        status: 'present',
        late: true,
        notes: '',
      });
      expect(serializeRosterAttendance({ status: 'absent', notes: 'Away' })).toEqual({
        status: 'absent',
        late: false,
        notes: 'Away',
      });
    });
  });
});
