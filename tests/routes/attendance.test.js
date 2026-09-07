import '../helpers/mongoose-mock.js';
import '../helpers/model-mocks.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';
import { User, Event, Attendance, resetModelMocks } from '../helpers/model-mocks.js';
import { buildAdmin, buildUser, buildEvent, authHeader, userId, eventId } from '../helpers/fixtures.js';

describe('attendance routes', () => {
  const admin = buildAdmin();
  const member = buildUser();

  function mockApprovedMemberList(memberIds = []) {
    User.find.mockReturnValue({
      select: () => ({
        lean: async () => memberIds.map((id) => ({ _id: id })),
      }),
    });
  }

  beforeEach(() => {
    resetModelMocks();
  });

  it('blocks members who must change password from /me', async () => {
    const locked = buildUser({ mustChangePassword: true });
    User.findById.mockResolvedValue(locked);

    const res = await request(createApp()).get('/api/attendance/me').set(authHeader(locked));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/new password/i);
  });

  it('blocks unapproved members from /me via requireFullSession', async () => {
    const pending = buildUser({ approvalStatus: 'pending' });
    User.findById.mockResolvedValue(pending);

    const res = await request(createApp())
      .get('/api/attendance/me')
      .set(authHeader(pending));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/approval/i);
  });

  it('returns member attendance history', async () => {
    User.findById.mockResolvedValue(member);
    const event = buildEvent({ date: new Date('2020-01-01T10:00:00.000Z') });
    Event.countDocuments.mockResolvedValue(1);
    Event.find.mockReturnValue({ sort: () => ({ lean: async () => [event] }) });
    Attendance.find.mockReturnValue({
      populate: () => ({
        lean: async () => [
          {
            event,
            status: 'present',
            late: true,
            notes: '',
          },
        ],
      }),
    });

    const res = await request(createApp()).get('/api/attendance/me').set(authHeader(member));
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].status).toBe('late');
    expect(res.body.history[0].late).toBe(true);
    expect(res.body.summary.rate).toBe(100);
    expect(res.body.summary.counted).toBe(1);
  });

  it('does not assign a rate for excused-only history on /me', async () => {
    User.findById.mockResolvedValue(member);
    const event = buildEvent({ date: new Date('2020-01-01T10:00:00.000Z') });
    Event.countDocuments.mockResolvedValue(1);
    Event.find.mockReturnValue({ sort: () => ({ lean: async () => [event] }) });
    Attendance.find.mockReturnValue({
      populate: () => ({
        lean: async () => [{ event, status: 'excused', notes: '' }],
      }),
    });

    const res = await request(createApp()).get('/api/attendance/me').set(authHeader(member));
    expect(res.status).toBe(200);
    expect(res.body.summary.excused).toBe(1);
    expect(res.body.summary.rate).toBe(0);
    expect(res.body.summary.counted).toBe(0);
  });

  it('filters member history by status', async () => {
    User.findById.mockResolvedValue(member);
    const past = buildEvent({ date: new Date('2020-01-01T10:00:00.000Z') });
    const future = buildEvent({ _id: eventId(), date: new Date('2099-01-01T10:00:00.000Z') });
    Event.countDocuments.mockResolvedValue(2);
    Event.find.mockReturnValue({ sort: () => ({ lean: async () => [future, past] }) });
    Attendance.find.mockReturnValue({
      populate: () => ({
        lean: async () => [{ event: past, status: 'present', notes: '' }],
      }),
    });

    const res = await request(createApp())
      .get('/api/attendance/me?status=upcoming')
      .set(authHeader(member));
    expect(res.status).toBe(200);
    expect(res.body.history.every((row) => row.status === 'upcoming')).toBe(true);
  });

  it('admin lists records and event roster', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const uid = userId();

    Attendance.find.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      sort: () => ({
        lean: async () => [
          {
            _id: new mongoose.Types.ObjectId(),
            status: 'present',
            notes: '',
            user: { _id: uid, name: 'Evan', voicePart: 'tenor' },
            event,
          },
        ],
      }),
    });

    const list = await request(createApp()).get('/api/attendance').set(authHeader(admin));
    expect(list.status).toBe(200);
    expect(list.body.records).toHaveLength(1);

    Event.findById.mockReturnValue({ lean: async () => event });
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => [{ _id: uid, name: 'Evan', email: 'e@stpauls.parish', voicePart: 'tenor' }],
        }),
      }),
    });
    Attendance.find.mockReturnValue({ lean: async () => [] });

    const roster = await request(createApp()).get(`/api/attendance/event/${event._id}`).set(authHeader(admin));
    expect(roster.status).toBe(200);
    expect(roster.body.roster).toHaveLength(1);
  });

  it('saves attendance for an event', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const uid = userId().toString();
    Event.findById.mockResolvedValue(event);
    User.countDocuments.mockResolvedValue(1);
    mockApprovedMemberList([]);
    Attendance.bulkWrite.mockResolvedValue({});

    const res = await request(createApp())
      .put(`/api/attendance/event/${event._id}`)
      .set(authHeader(admin))
      .send({ records: [{ userId: uid, status: 'present', notes: 'On time' }] });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(1);
  });

  it('saves present attendance with late flag', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const uid = userId().toString();
    Event.findById.mockResolvedValue(event);
    User.countDocuments.mockResolvedValue(1);
    mockApprovedMemberList([]);
    Attendance.bulkWrite.mockResolvedValue({});

    const res = await request(createApp())
      .put(`/api/attendance/event/${event._id}`)
      .set(authHeader(admin))
      .send({ records: [{ userId: uid, status: 'present', late: true, notes: 'Traffic' }] });

    expect(res.status).toBe(200);
    expect(Attendance.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          update: {
            $set: expect.objectContaining({
              status: 'present',
              late: true,
              notes: 'Traffic',
            }),
          },
        }),
      }),
    ]);
  });

  it('validates attendance writes', async () => {
    User.findById.mockResolvedValue(admin);
    expect(
      (await request(createApp()).put('/api/attendance/event/bad').set(authHeader(admin)).send({ records: [] })).status
    ).toBe(400);

    const eid = eventId().toString();
    Event.findById.mockResolvedValue(null);
    expect(
      (await request(createApp()).put(`/api/attendance/event/${eid}`).set(authHeader(admin)).send({ records: [] })).status
    ).toBe(404);

    Event.findById.mockResolvedValue(buildEvent());
    mockApprovedMemberList([]);
    expect(
      (
        await request(createApp())
          .put(`/api/attendance/event/${eid}`)
          .set(authHeader(admin))
          .send({ records: 'nope' })
      ).status
    ).toBe(400);

    User.countDocuments.mockResolvedValue(0);
    mockApprovedMemberList([]);
    expect(
      (
        await request(createApp())
          .put(`/api/attendance/event/${eid}`)
          .set(authHeader(admin))
          .send({ records: [{ userId: userId().toString(), status: 'present' }] })
      ).status
    ).toBe(400);
  });

  it('validates admin list filters', async () => {
    User.findById.mockResolvedValue(admin);
    const bad = await request(createApp()).get('/api/attendance?eventId=bad').set(authHeader(admin));
    expect(bad.status).toBe(400);

    const badUser = await request(createApp()).get('/api/attendance?userId=bad').set(authHeader(admin));
    expect(badUser.status).toBe(400);
  });

  it('filters admin attendance list by event and member', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const uid = userId();

    Attendance.find.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      sort: () => ({ lean: async () => [] }),
    });

    const byEvent = await request(createApp())
      .get(`/api/attendance?eventId=${event._id}`)
      .set(authHeader(admin));
    expect(byEvent.status).toBe(200);

    const byUser = await request(createApp())
      .get(`/api/attendance?userId=${uid}`)
      .set(authHeader(admin));
    expect(byUser.status).toBe(200);
  });

  it('returns event roster with saved attendance records', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const uid = userId();

    Event.findById.mockReturnValue({ lean: async () => event });
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => [{ _id: uid, name: 'Evan', email: 'e@stpauls.parish', voicePart: 'tenor' }],
        }),
      }),
    });
    Attendance.find.mockReturnValue({
      lean: async () => [{ user: uid, status: 'late', notes: 'Traffic' }],
    });

    const res = await request(createApp()).get(`/api/attendance/event/${event._id}`).set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.roster[0].status).toBe('present');
    expect(res.body.roster[0].late).toBe(true);
    expect(res.body.roster[0].notes).toBe('Traffic');
  });

  it('rejects invalid date filter on /me', async () => {
    User.findById.mockResolvedValue(member);
    const res = await request(createApp()).get('/api/attendance/me?from=bad').set(authHeader(member));
    expect(res.status).toBe(400);
  });

  it('uses history summary when filtering /me by attendance status', async () => {
    User.findById.mockResolvedValue(member);
    const past = buildEvent({ date: new Date('2020-01-01T10:00:00.000Z') });
    Event.countDocuments.mockResolvedValue(1);
    Event.find.mockReturnValue({ sort: () => ({ lean: async () => [past] }) });
    Attendance.find.mockReturnValue({
      populate: () => ({
        lean: async () => [{ event: past, status: 'absent', notes: '' }],
      }),
    });

    const res = await request(createApp())
      .get('/api/attendance/me?status=absent')
      .set(authHeader(member));

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.summary.absent).toBe(1);
  });

  it('allows empty attendance save and rejects invalid status', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const eid = event._id.toString();
    const missingMemberId = userId();
    Event.findById.mockResolvedValue(event);
    User.find.mockReturnValue({
      select: () => ({
        lean: async () => [{ _id: missingMemberId }],
      }),
    });
    Attendance.bulkWrite.mockResolvedValue({});

    const empty = await request(createApp())
      .put(`/api/attendance/event/${eid}`)
      .set(authHeader(admin))
      .send({ records: [] });
    expect(empty.status).toBe(200);
    expect(empty.body.saved).toBe(1);
    expect(Attendance.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { user: missingMemberId.toString(), event: eid },
          update: {
            $set: expect.objectContaining({
              status: 'absent',
              late: false,
            }),
          },
        }),
      }),
    ]);

    const badStatus = await request(createApp())
      .put(`/api/attendance/event/${eid}`)
      .set(authHeader(admin))
      .send({ records: [{ userId: userId().toString(), status: 'maybe' }] });
    expect(badStatus.status).toBe(400);
  });

  it('marks omitted members as absent when saving attendance', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const eid = event._id.toString();
    const presentMemberId = userId();
    const absentMemberId = userId();
    Event.findById.mockResolvedValue(event);
    User.countDocuments.mockResolvedValue(1);
    User.find.mockImplementation(() => ({
      select: () => ({
        lean: async () => [{ _id: presentMemberId }, { _id: absentMemberId }],
      }),
    }));
    Attendance.bulkWrite.mockResolvedValue({});

    const res = await request(createApp())
      .put(`/api/attendance/event/${eid}`)
      .set(authHeader(admin))
      .send({
        records: [{ userId: presentMemberId.toString(), status: 'present', notes: 'On time' }],
      });

    expect(res.status).toBe(200);
    const writes = Attendance.bulkWrite.mock.calls.at(-1)?.[0] ?? [];
    expect(User.find).toHaveBeenCalled();
    expect(writes).toHaveLength(2);
    expect(res.body.saved).toBe(2);
    expect(Attendance.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { user: presentMemberId.toString(), event: eid },
        }),
      }),
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { user: absentMemberId.toString(), event: eid },
          update: {
            $set: expect.objectContaining({
              status: 'absent',
              late: false,
            }),
          },
        }),
      }),
    ]);
  });

  it('resolves absent and upcoming statuses on /me', async () => {
    User.findById.mockResolvedValue(member);
    const past = buildEvent({ date: new Date('2020-01-01T10:00:00.000Z') });
    const future = buildEvent({ _id: eventId(), date: new Date('2099-01-01T10:00:00.000Z') });
    Event.countDocuments.mockResolvedValue(2);
    Event.find.mockReturnValue({ sort: () => ({ lean: async () => [future, past] }) });
    Attendance.find.mockReturnValue({
      populate: () => ({ lean: async () => [] }),
    });

    const res = await request(createApp()).get('/api/attendance/me').set(authHeader(member));
    expect(res.status).toBe(200);
    const statuses = res.body.history.map((row) => row.status);
    expect(statuses).toContain('absent');
    expect(statuses).toContain('upcoming');
  });

  it('trims non-string notes and rejects partially invalid bulk save', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const eid = event._id.toString();
    const uid = userId().toString();
    Event.findById.mockResolvedValue(event);
    User.countDocuments.mockResolvedValue(1);
    mockApprovedMemberList([]);
    Attendance.bulkWrite.mockResolvedValue({});

    const saved = await request(createApp())
      .put(`/api/attendance/event/${eid}`)
      .set(authHeader(admin))
      .send({ records: [{ userId: uid, status: 'present', notes: 12345 }] });
    expect(saved.status).toBe(200);

    User.countDocuments.mockResolvedValue(1);
    mockApprovedMemberList([]);
    const partial = await request(createApp())
      .put(`/api/attendance/event/${eid}`)
      .set(authHeader(admin))
      .send({
        records: [
          { userId: uid, status: 'present' },
          { userId: userId().toString(), status: 'absent' },
        ],
      });
    expect(partial.status).toBe(400);
  });

  it('filters admin list by both event and member', async () => {
    User.findById.mockResolvedValue(admin);
    const event = buildEvent();
    const uid = userId();

    Attendance.find.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      sort: () => ({ lean: async () => [] }),
    });

    const res = await request(createApp())
      .get(`/api/attendance?eventId=${event._id}&userId=${uid}`)
      .set(authHeader(admin));
    expect(res.status).toBe(200);
  });

  it('serializes admin records with raw id references', async () => {
    User.findById.mockResolvedValue(admin);
    const eventIdRaw = eventId();
    const userIdRaw = userId();

    Attendance.find.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      sort: () => ({
        lean: async () => [
          {
            _id: new mongoose.Types.ObjectId(),
            status: 'excused',
            notes: '',
            user: userIdRaw.toString(),
            event: eventIdRaw.toString(),
          },
        ],
      }),
    });

    const res = await request(createApp()).get('/api/attendance').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.records[0].user.id).toBe(userIdRaw.toString());
    expect(res.body.records[0].event.id).toBe(eventIdRaw.toString());
  });
});
