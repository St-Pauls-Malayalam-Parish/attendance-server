import '../helpers/mongoose-mock.js';
import '../helpers/model-mocks.js';
import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User, Event, Attendance, resetModelMocks } from '../helpers/model-mocks.js';
import { buildAdmin, buildUser, buildEvent, authHeader, userId, eventId } from '../helpers/fixtures.js';

describe('events routes', () => {
  const admin = buildAdmin();

  beforeEach(() => {
    resetModelMocks();
    User.findById.mockResolvedValue(admin);
  });

  it('lists events with pagination', async () => {
    const event = buildEvent();
    Event.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    Event.find.mockReturnValue({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [event],
          }),
        }),
      }),
    });

    const res = await request(createApp()).get('/api/events').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.meta.totalUnfiltered).toBe(5);
  });

  it('rejects invalid date filters', async () => {
    const res = await request(createApp()).get('/api/events?from=bad').set(authHeader(admin));
    expect(res.status).toBe(400);
  });

  it('returns event years', async () => {
    Event.aggregate.mockResolvedValue([{ _id: 2026 }, { _id: 2025 }]);
    const res = await request(createApp()).get('/api/events/years').set(authHeader(admin));
    expect(res.body.years).toEqual([2026, 2025]);
  });

  it('creates, updates, and deletes events as admin', async () => {
    const created = buildEvent();
    Event.create.mockResolvedValue(created);

    const post = await request(createApp())
      .post('/api/events')
      .set(authHeader(admin))
      .send({
        title: 'Friday practice',
        date: '2026-01-10T18:30:00.000Z',
        type: 'practice',
        liturgicalColor: 'green',
      });
    expect(post.status).toBe(201);

    Event.findByIdAndUpdate.mockResolvedValue(created);
    const patch = await request(createApp())
      .patch(`/api/events/${created._id}`)
      .set(authHeader(admin))
      .send({
        title: 'Updated',
        date: '2026-01-11T18:30:00.000Z',
        type: 'service',
        liturgicalColor: 'white',
      });
    expect(patch.status).toBe(200);

    Event.findByIdAndDelete.mockResolvedValue(created);
    Attendance.deleteMany.mockResolvedValue({});
    const del = await request(createApp()).delete(`/api/events/${created._id}`).set(authHeader(admin));
    expect(del.status).toBe(200);
  });

  it('validates event body and handles missing records', async () => {
    const bad = await request(createApp()).post('/api/events').set(authHeader(admin)).send({ title: '' });
    expect(bad.status).toBe(400);

    Event.findByIdAndUpdate.mockResolvedValue(null);
    const missing = await request(createApp())
      .patch(`/api/events/${eventId()}`)
      .set(authHeader(admin))
      .send({
        title: 'X',
        date: '2026-01-10T18:30:00.000Z',
        type: 'practice',
      });
    expect(missing.status).toBe(404);

    Event.findByIdAndDelete.mockResolvedValue(null);
    const del = await request(createApp()).delete(`/api/events/${eventId()}`).set(authHeader(admin));
    expect(del.status).toBe(404);
  });

  it('rejects invalid event body on patch', async () => {
    const badPatch = await request(createApp())
      .patch(`/api/events/${eventId()}`)
      .set(authHeader(admin))
      .send({
        title: 'X',
        date: '2026-01-10T18:30:00.000Z',
        type: 'invalid-type',
      });
    expect(badPatch.status).toBe(400);
  });

  it('blocks non-admin writes and pending members', async () => {
    const member = buildAdmin({ role: 'member', approvalStatus: 'approved' });
    User.findById.mockResolvedValue(member);
    const forbidden = await request(createApp())
      .post('/api/events')
      .set(authHeader(member))
      .send({ title: 'X', date: '2026-01-10T18:30:00.000Z', type: 'practice' });
    expect(forbidden.status).toBe(403);

    const pending = buildAdmin({ role: 'member', approvalStatus: 'pending' });
    User.findById.mockResolvedValue(pending);
    const blocked = await request(createApp()).get('/api/events').set(authHeader(pending));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/approval/i);

    const mustChange = buildUser({ mustChangePassword: true });
    User.findById.mockResolvedValue(mustChange);
    const passwordGate = await request(createApp()).get('/api/events').set(authHeader(mustChange));
    expect(passwordGate.status).toBe(403);
    expect(passwordGate.body.error).toMatch(/new password/i);
  });

  it('serializes events with empty liturgical color and trims notes on create', async () => {
    const created = buildEvent({ liturgicalColor: '' });
    Event.create.mockResolvedValue(created);

    const res = await request(createApp())
      .post('/api/events')
      .set(authHeader(admin))
      .send({
        title: 'Sunday service',
        date: '2026-01-10T18:30:00.000Z',
        type: 'service',
        notes: '  Welcome all  ',
      });

    expect(res.status).toBe(201);
    expect(res.body.event.liturgicalColor).toBe('');
    expect(Event.create).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Welcome all' })
    );
  });

  it('filters events by member attendance', async () => {
    const event = buildEvent();
    const memberId = userId().toString();
    Attendance.distinct.mockResolvedValue([event._id]);
    Event.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    Event.find.mockReturnValue({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [event],
          }),
        }),
      }),
    });

    const res = await request(createApp())
      .get(`/api/events?memberId=${memberId}&attendanceStatus=present`)
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(Attendance.distinct).toHaveBeenCalled();
    expect(res.body.events).toHaveLength(1);
    expect(res.body.meta.memberId).toBe(memberId);
    expect(res.body.meta.attendanceStatus).toBe('present');
  });

  it('rejects member attendance filters without a member', async () => {
    const res = await request(createApp())
      .get('/api/events?attendanceStatus=present')
      .set(authHeader(admin));
    expect(res.status).toBe(400);
  });

  it('rejects invalid member id for attendance filter', async () => {
    const res = await request(createApp())
      .get('/api/events?memberId=not-valid')
      .set(authHeader(admin));
    expect(res.status).toBe(400);
  });

  it('blocks non-admin member attendance filters', async () => {
    const memberUser = buildAdmin({ role: 'member', approvalStatus: 'approved' });
    User.findById.mockResolvedValue(memberUser);

    const res = await request(createApp())
      .get(`/api/events?memberId=${userId()}`)
      .set(authHeader(memberUser));
    expect(res.status).toBe(403);
  });

  it('returns empty list when member has no matching attendance', async () => {
    const memberId = userId().toString();
    Attendance.distinct.mockResolvedValue([]);
    Event.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(5);
    Event.find.mockReturnValue({
      sort: () => ({
        skip: () => ({
          limit: () => ({ lean: async () => [] }),
        }),
      }),
    });

    const res = await request(createApp())
      .get(`/api/events?memberId=${memberId}&attendanceStatus=absent`)
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.meta.attendanceStatus).toBe('absent');
  });
});
