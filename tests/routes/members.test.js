import '../helpers/mongoose-mock.js';
import '../helpers/model-mocks.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { User, Attendance, resetModelMocks, findOneQuery, setFindOneResult } from '../helpers/model-mocks.js';
import { buildAdmin, buildUser, authHeader, userId } from '../helpers/fixtures.js';
import { aggregateAttendanceByUsers } from '../../src/utils/attendance-stats.js';

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('new-hash'),
    compare: vi.fn(),
  },
}));

vi.mock('../../src/utils/attendance-stats.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    aggregateAttendanceByUsers: vi.fn().mockResolvedValue(new Map()),
  };
});

describe('members routes', () => {
  const admin = buildAdmin();

  beforeEach(() => {
    resetModelMocks();
    User.findById.mockResolvedValue(admin);
    aggregateAttendanceByUsers.mockResolvedValue(new Map());
  });

  it('lists pending, inactive, and declined members', async () => {
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => [
            buildUser({ approvalStatus: 'pending', active: true }),
            buildUser({ active: false }),
            buildUser({ approvalStatus: 'rejected', active: true }),
          ],
        }),
      }),
    });

    const res = await request(createApp()).get('/api/members').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.inactive).toHaveLength(1);
    expect(res.body.declined).toHaveLength(1);
  });

  it('returns roster with pagination', async () => {
    const member = buildUser();
    User.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(10);
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: async () => [member],
            }),
          }),
        }),
      }),
    });

    const res = await request(createApp()).get('/api/members/roster').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
  });

  it('validates roster date filters', async () => {
    const res = await request(createApp()).get('/api/members/roster?from=bad').set(authHeader(admin));
    expect(res.status).toBe(400);
  });

  it('creates a member', async () => {
    setFindOneResult(User, null);
    const created = buildUser();
    User.create.mockResolvedValue(created);

    const res = await request(createApp())
      .post('/api/members')
      .set(authHeader(admin))
      .send({
        name: 'New Singer',
        username: 'new.singer',
        email: 'new@stpauls.parish',
        password: 'password123',
        voicePart: 'alto',
      });
    expect(res.status).toBe(201);
  });

  it('updates, approves, deactivates, and deletes members', async () => {
    const member = buildUser();
    const id = member._id.toString();
    User.findOne
      .mockImplementationOnce(() => findOneQuery(member))
      .mockImplementationOnce(() => findOneQuery(null))
      .mockImplementationOnce(() => findOneQuery(null));

    const patch = await request(createApp())
      .patch(`/api/members/${id}`)
      .set(authHeader(admin))
      .send({
        name: 'Updated',
        username: 'evan.thomas',
        email: 'evan@stpauls.parish',
        voicePart: 'tenor',
        password: 'newpassword1',
      });
    expect(patch.status).toBe(200);
    expect(member.mustChangePassword).toBe(true);

    setFindOneResult(User, member);
    const approval = await request(createApp())
      .patch(`/api/members/${id}/approval`)
      .set(authHeader(admin))
      .send({ approvalStatus: 'approved' });
    expect(approval.status).toBe(200);

    const active = await request(createApp())
      .patch(`/api/members/${id}/active`)
      .set(authHeader(admin))
      .send({ active: false });
    expect(active.status).toBe(200);

    Attendance.deleteMany.mockResolvedValue({});
    member.deleteOne = vi.fn().mockResolvedValue(undefined);
    const del = await request(createApp()).delete(`/api/members/${id}`).set(authHeader(admin));
    expect(del.status).toBe(200);
  });

  it('handles member validation and conflicts', async () => {
    const id = userId().toString();
    expect(
      (await request(createApp()).patch(`/api/members/${id}`).set(authHeader(admin)).send({ name: 'A' })).status
    ).toBe(400);

    expect(
      (await request(createApp()).patch('/api/members/bad-id/approval').set(authHeader(admin)).send({ approvalStatus: 'approved' })).status
    ).toBe(400);

    setFindOneResult(User, null);
    expect(
      (await request(createApp()).patch(`/api/members/${id}`).set(authHeader(admin)).send({
        name: 'Evan Thomas',
        username: 'evan.thomas',
        email: 'evan@stpauls.parish',
        voicePart: 'tenor',
      })).status
    ).toBe(404);

    const member = buildUser({ _id: userId() });
    const conflictId = member._id.toString();
    User.findOne
      .mockReset()
      .mockImplementationOnce(() => findOneQuery(member))
      .mockImplementationOnce(() => findOneQuery(buildUser({ username: 'other' })));
    expect(
      (await request(createApp()).patch(`/api/members/${conflictId}`).set(authHeader(admin)).send({
        name: 'Evan Thomas',
        username: 'other.user',
        email: 'evan@stpauls.parish',
        voicePart: 'tenor',
      })).status
    ).toBe(409);
  });

  it('rejects non-admin access', async () => {
    const member = buildUser();
    User.findById.mockResolvedValue(member);
    const res = await request(createApp()).get('/api/members').set(authHeader(member));
    expect(res.status).toBe(403);
  });

  it('gets and updates member development profile', async () => {
    const member = buildUser();
    const id = member._id.toString();
    setFindOneResult(User, member);

    const getRes = await request(createApp()).get(`/api/members/${id}/profile`).set(authHeader(admin));
    expect(getRes.status).toBe(200);
    expect(getRes.body.profile.feedbackHistory).toEqual([]);

    const patchRes = await request(createApp())
      .patch(`/api/members/${id}/profile`)
      .set(authHeader(admin))
      .send({
        voiceRange: 'Tenor: C3–B4',
        feedback: 'Strong projection',
        choirPathway: 'emerging-vocalists',
      });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.profile.voiceRange).toBe('Tenor: C3–B4');
    expect(patchRes.body.profile.feedbackHistory).toHaveLength(1);
    expect(member.save).toHaveBeenCalled();
  });

  it('validates member profile updates', async () => {
    const member = buildUser();
    const id = member._id.toString();
    setFindOneResult(User, member);

    const empty = await request(createApp())
      .patch(`/api/members/${id}/profile`)
      .set(authHeader(admin))
      .send({});
    expect(empty.status).toBe(400);
  });

  it('validates member create body', async () => {
    const shortPassword = await request(createApp())
      .post('/api/members')
      .set(authHeader(admin))
      .send({
        name: 'New Singer',
        username: 'new.singer',
        email: 'new@stpauls.parish',
        password: 'short',
        voicePart: 'alto',
      });
    expect(shortPassword.status).toBe(400);

    const badVoice = await request(createApp())
      .post('/api/members')
      .set(authHeader(admin))
      .send({
        name: 'New Singer',
        username: 'new.singer',
        email: 'new@stpauls.parish',
        password: 'password123',
        voicePart: 'invalid',
      });
    expect(badVoice.status).toBe(400);
  });

  it('rejects duplicate username and email on create', async () => {
    User.findOne.mockImplementationOnce(() => findOneQuery(buildUser()));
    const dupUsername = await request(createApp())
      .post('/api/members')
      .set(authHeader(admin))
      .send({
        name: 'New Singer',
        username: 'evan.thomas',
        email: 'new@stpauls.parish',
        password: 'password123',
        voicePart: 'alto',
      });
    expect(dupUsername.status).toBe(409);
    expect(dupUsername.body.error).toMatch(/username/i);

    User.findOne
      .mockImplementationOnce(() => findOneQuery(null))
      .mockImplementationOnce(() => findOneQuery(buildUser()));
    const dupEmail = await request(createApp())
      .post('/api/members')
      .set(authHeader(admin))
      .send({
        name: 'New Singer',
        username: 'brand.new',
        email: 'evan@stpauls.parish',
        password: 'password123',
        voicePart: 'alto',
      });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error).toMatch(/email/i);
  });

  it('rejects duplicate email on patch', async () => {
    const member = buildUser();
    const id = member._id.toString();
    User.findOne
      .mockImplementationOnce(() => findOneQuery(member))
      .mockImplementationOnce(() => findOneQuery(null))
      .mockImplementationOnce(() => findOneQuery(buildUser({ email: 'taken@stpauls.parish' })));

    const res = await request(createApp())
      .patch(`/api/members/${id}`)
      .set(authHeader(admin))
      .send({
        name: member.name,
        username: member.username,
        email: 'taken@stpauls.parish',
        voicePart: 'tenor',
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email/i);
  });

  it('rejects invalid member id and weak optional password on patch', async () => {
    expect(
      (await request(createApp()).patch('/api/members/not-valid').set(authHeader(admin)).send({
        name: 'Evan Thomas',
        username: 'evan.thomas',
        email: 'evan@stpauls.parish',
        voicePart: 'tenor',
        password: 'short',
      })).status
    ).toBe(400);

    expect(
      (await request(createApp()).delete('/api/members/bad-id').set(authHeader(admin))).status
    ).toBe(400);

    expect(
      (
        await request(createApp())
          .patch('/api/members/bad-id/active')
          .set(authHeader(admin))
          .send({ active: false })
      ).status
    ).toBe(400);
  });

  it('rejects create with missing name', async () => {
    const res = await request(createApp())
      .post('/api/members')
      .set(authHeader(admin))
      .send({
        name: 'A',
        username: 'new.user',
        email: 'new@stpauls.parish',
        password: 'password123',
        voicePart: 'alto',
      });
    expect(res.status).toBe(400);
  });

  it('filters roster by search, voice part, date range, and attendance status', async () => {
    const member = buildUser({ voicePart: 'soprano' });
    const memberId = member._id;
    User.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: async () => [member] }),
          }),
        }),
      }),
    });
    Attendance.aggregate.mockResolvedValue([{ _id: memberId }]);
    aggregateAttendanceByUsers.mockResolvedValue(
      new Map([[member._id.toString(), { present: 2, absent: 0, late: 1, excused: 0, total: 2 }]])
    );

    const res = await request(createApp())
      .get(
        '/api/members/roster?search=evan&voicePart=soprano&from=2026-01-01&to=2026-01-31&attendanceStatus=late'
      )
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(Attendance.aggregate).toHaveBeenCalled();
    expect(res.body.members[0].summary.present).toBe(2);
    expect(res.body.meta.dateFiltered).toBe(true);
    expect(res.body.meta.attendanceStatus).toBe('late');
  });

  it('filters roster by excused attendance status', async () => {
    const member = buildUser({ voicePart: 'tenor' });
    User.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: async () => [member] }),
          }),
        }),
      }),
    });
    Attendance.aggregate.mockResolvedValue([{ _id: member._id }]);
    aggregateAttendanceByUsers.mockResolvedValue(
      new Map([[member._id.toString(), { present: 0, absent: 0, late: 0, excused: 1, total: 1 }]])
    );

    const res = await request(createApp())
      .get('/api/members/roster?attendanceStatus=excused')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.members[0].summary.excused).toBe(1);
    expect(res.body.meta.attendanceStatus).toBe('excused');
  });

  it('ignores invalid roster attendance status values', async () => {
    const member = buildUser();
    User.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: async () => [member] }),
          }),
        }),
      }),
    });
    aggregateAttendanceByUsers.mockResolvedValue(new Map());

    const res = await request(createApp())
      .get('/api/members/roster?attendanceStatus=upcoming')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(Attendance.aggregate).not.toHaveBeenCalled();
    expect(res.body.meta.attendanceStatus).toBe('');
  });
});
