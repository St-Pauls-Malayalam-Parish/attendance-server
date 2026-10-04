import '../helpers/mongoose-mock.js';
import '../helpers/model-mocks.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { User, Event, Attendance, resetModelMocks, setFindOneResult, findOneQuery } from '../helpers/model-mocks.js';
import {
  authHeader,
  buildDefaultPasswordAdmin,
  buildDefaultPasswordUser,
  buildUser,
  sessionScopeForUser,
} from '../helpers/fixtures.js';
import { hashRefreshToken } from '../../src/utils/tokens.js';

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('new-hash'),
    compare: vi.fn(),
  },
}));

describe('must-change-password workflow', () => {
  beforeEach(() => {
    resetModelMocks();
    bcrypt.compare.mockReset();
    bcrypt.hash.mockResolvedValue('new-hash');
  });

  describe('login and restricted session', () => {
    it('logs in imported member with mustChangePassword and restricted scope', async () => {
      const user = buildDefaultPasswordUser();
      setFindOneResult(User, user);
      bcrypt.compare.mockResolvedValue(true);

      const res = await request(createApp())
        .post('/api/auth/login')
        .set('X-Auth-Client', 'bearer')
        .send({ username: user.username, password: 'Choir@2026' });

      expect(res.status).toBe(200);
      expect(res.body.user.mustChangePassword).toBe(true);
      expect(sessionScopeForUser(user)).toBe('must-change-password');
    });

    it('allows auth endpoints while password change is required', async () => {
      const user = buildDefaultPasswordUser();
      User.findById.mockResolvedValue(user);

      const me = await request(createApp())
        .get('/api/auth/me')
        .set(authHeader(user))
        .set('X-Auth-Client', 'bearer');
      expect(me.status).toBe(200);
      expect(me.body.user.mustChangePassword).toBe(true);

      const refreshToken = 'member-refresh-token';
      user.refreshTokenExpiresAt = new Date(Date.now() + 60_000);
      User.findOne.mockImplementation(({ refreshTokenHash }) =>
        findOneQuery(refreshTokenHash === hashRefreshToken(refreshToken) ? user : null)
      );
      const refresh = await request(createApp()).post('/api/auth/refresh').send({ refreshToken });
      expect(refresh.status).toBe(200);

      const logout = await request(createApp()).post('/api/auth/logout').send({ refreshToken });
      expect(logout.status).toBe(200);
    });

    it('blocks member routes that require a full session', async () => {
      const user = buildDefaultPasswordUser();
      User.findById.mockResolvedValue(user);

      const events = await request(createApp()).get('/api/events').set(authHeader(user));
      expect(events.status).toBe(403);
      expect(events.body.error).toMatch(/new password/i);

      const attendance = await request(createApp()).get('/api/attendance/me').set(authHeader(user));
      expect(attendance.status).toBe(403);
      expect(attendance.body.error).toMatch(/new password/i);
    });

    it('blocks admin attendance until password is changed', async () => {
      const admin = buildDefaultPasswordAdmin();
      User.findById.mockResolvedValue(admin);

      const attendance = await request(createApp()).get('/api/attendance').set(authHeader(admin));
      expect(attendance.status).toBe(403);
      expect(attendance.body.error).toMatch(/new password/i);
    });

    it('still lets admin manage members before changing password', async () => {
      const admin = buildDefaultPasswordAdmin();
      User.findById.mockResolvedValue(admin);
      User.find.mockReturnValue({
        select: () => ({
          sort: () => ({
            lean: async () => [buildUser({ approvalStatus: 'pending', active: true })],
          }),
        }),
      });

      const res = await request(createApp()).get('/api/members').set(authHeader(admin));
      expect(res.status).toBe(200);
      expect(res.body.pending).toHaveLength(1);
    });
  });

  describe('password change unlocks the app', () => {
    it('clears mustChangePassword and unlocks events and attendance', async () => {
      const user = buildDefaultPasswordUser({ passwordHash: 'old-hash' });
      User.findById.mockResolvedValue(user);
      bcrypt.compare.mockResolvedValue(true);

      const change = await request(createApp())
        .post('/api/auth/change-password')
        .set(authHeader(user))
        .set('X-Auth-Client', 'bearer')
        .send({
          currentPassword: 'Choir@2026',
          newPassword: 'my-secure-pass',
          email: 'evan.thomas@gmail.com',
        });

      expect(change.status).toBe(200);
      expect(change.body.user.mustChangePassword).toBe(false);
      expect(change.body.token).toBeTruthy();
      expect(user.mustChangePassword).toBe(false);

      User.findById.mockResolvedValue(user);
      Event.countDocuments.mockResolvedValue(0);
      Event.find.mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: async () => [] }),
          }),
        }),
      });

      const events = await request(createApp()).get('/api/events').set({
        Authorization: `Bearer ${change.body.token}`,
      });
      expect(events.status).toBe(200);

      Event.countDocuments.mockResolvedValue(0);
      Event.find.mockReturnValue({ sort: () => ({ lean: async () => [] }) });
      Attendance.find.mockReturnValue({
        populate: () => ({ lean: async () => [] }),
      });

      const attendance = await request(createApp()).get('/api/attendance/me').set({
        Authorization: `Bearer ${change.body.token}`,
      });
      expect(attendance.status).toBe(200);
    });

    it('re-issues session on /me when token scope is stale after password change', async () => {
      const user = buildUser({ approvalStatus: 'approved', mustChangePassword: true });
      User.findById.mockResolvedValue(user);

      const before = await request(createApp())
        .get('/api/auth/me')
        .set(authHeader(user))
        .set('X-Auth-Client', 'bearer');

      expect(before.status).toBe(200);
      expect(before.body.user.mustChangePassword).toBe(true);
      expect(before.body.token).toBeUndefined();

      user.mustChangePassword = false;
      User.findById.mockResolvedValue(user);

      const after = await request(createApp())
        .get('/api/auth/me')
        .set(authHeader(user, 'must-change-password'))
        .set('X-Auth-Client', 'bearer');

      expect(after.status).toBe(200);
      expect(after.body.user.mustChangePassword).toBe(false);
      expect(after.body.token).toBeTruthy();
    });
  });

  describe('admin password reset forces member to change password', () => {
    it('sets mustChangePassword when admin resets a member password', async () => {
      const admin = buildDefaultPasswordAdmin({ mustChangePassword: false });
      const member = buildUser();
      const id = member._id.toString();

      User.findById.mockImplementation((lookupId) =>
        Promise.resolve(String(lookupId) === String(member._id) ? member : admin)
      );
      User.findOne
        .mockImplementationOnce(() => findOneQuery(null))
        .mockImplementationOnce(() => findOneQuery(null));

      const res = await request(createApp())
        .patch(`/api/members/${id}`)
        .set(authHeader(admin))
        .send({
          name: member.name,
          username: member.username,
          email: member.email,
          voicePart: member.voicePart,
          password: 'temporary-reset1',
        });

      expect(res.status).toBe(200);
      expect(member.mustChangePassword).toBe(true);
    });
  });
});
