import '../helpers/mongoose-mock.js';
import '../helpers/model-mocks.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { User, resetModelMocks, findOneQuery, setFindOneResult } from '../helpers/model-mocks.js';
import { buildUser, buildAdmin, authHeader, signTestToken, userId } from '../helpers/fixtures.js';
import { hashRefreshToken } from '../../src/utils/tokens.js';
import { issueAuthSession, requireAuth } from '../../src/middleware/auth.js';

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('new-hash'),
    compare: vi.fn(),
  },
}));

describe('auth routes', () => {
  beforeEach(() => {
    resetModelMocks();
    bcrypt.compare.mockReset();
    bcrypt.hash.mockResolvedValue('new-hash');
  });

  it('registers a pending member', async () => {
    setFindOneResult(User, null);
    const created = buildUser({ approvalStatus: 'pending' });
    User.create.mockResolvedValue(created);

    const res = await request(createApp())
      .post('/api/auth/register')
      .set('X-Auth-Client', 'bearer')
      .send({
        name: 'Evan Thomas',
        username: 'evan.thomas',
        email: 'evan@stpauls.parish',
        password: 'password123',
        voicePart: 'tenor',
      });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('evan.thomas');
    expect(res.body.token).toBeTruthy();
  });

  it('validates registration input', async () => {
    const res = await request(createApp()).post('/api/auth/register').send({ name: 'A' });
    expect(res.status).toBe(400);

    const shortPassword = await request(createApp()).post('/api/auth/register').send({
      name: 'Evan Thomas',
      username: 'evan.thomas',
      email: 'evan@stpauls.parish',
      password: 'short',
    });
    expect(shortPassword.status).toBe(400);
    expect(shortPassword.body.error).toMatch(/8 characters/i);
  });

  it('rejects duplicate username and email', async () => {
    setFindOneResult(User, buildUser());
    const username = await request(createApp()).post('/api/auth/register').send({
      name: 'Evan Thomas',
      username: 'evan.thomas',
      email: 'evan@stpauls.parish',
      password: 'password123',
    });
    expect(username.status).toBe(409);

    User.findOne
      .mockImplementationOnce(() => findOneQuery(null))
      .mockImplementationOnce(() => findOneQuery(buildUser()));
    const email = await request(createApp()).post('/api/auth/register').send({
      name: 'Evan Thomas',
      username: 'new.user',
      email: 'evan@stpauls.parish',
      password: 'password123',
    });
    expect(email.status).toBe(409);
  });

  it('logs in approved member', async () => {
    const user = buildUser();
    setFindOneResult(User, user);
    bcrypt.compare.mockResolvedValue(true);

    const res = await request(createApp())
      .post('/api/auth/login')
      .set('X-Auth-Client', 'bearer')
      .send({ username: 'evan.thomas', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.mustChangePassword).toBe(false);
  });

  it('logs in user who must change password with flag set in response', async () => {
    const user = buildUser({ mustChangePassword: true });
    setFindOneResult(User, user);
    bcrypt.compare.mockResolvedValue(true);

    const res = await request(createApp())
      .post('/api/auth/login')
      .set('X-Auth-Client', 'bearer')
      .send({ username: user.username, password: 'Choir@2026' });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('rejects invalid login and rejected users', async () => {
    setFindOneResult(User, null);
    expect((await request(createApp()).post('/api/auth/login').send({ username: 'x', password: 'y' })).status).toBe(400);

    setFindOneResult(User, buildUser({ active: false }));
    expect(
      (await request(createApp()).post('/api/auth/login').send({ username: 'evan.thomas', password: 'pw' })).status
    ).toBe(401);

    setFindOneResult(User, buildUser());
    bcrypt.compare.mockResolvedValue(false);
    expect(
      (await request(createApp()).post('/api/auth/login').send({ username: 'evan.thomas', password: 'wrong' })).status
    ).toBe(401);

    setFindOneResult(User, buildUser({ approvalStatus: 'rejected' }));
    bcrypt.compare.mockResolvedValue(true);
    expect(
      (await request(createApp()).post('/api/auth/login').send({ username: 'evan.thomas', password: 'pw' })).status
    ).toBe(403);
  });

  it('refreshes and logs out sessions', async () => {
    const user = buildUser();
    const refreshToken = 'refresh-token-value';
    user.refreshTokenExpiresAt = new Date(Date.now() + 60_000);
    User.findOne.mockImplementation(({ refreshTokenHash }) =>
      findOneQuery(refreshTokenHash === hashRefreshToken(refreshToken) ? user : null)
    );

    const refresh = await request(createApp())
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(refresh.status).toBe(200);

    const logout = await request(createApp()).post('/api/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(200);
    expect(logout.body.ok).toBe(true);
  });

  it('rejects missing or expired refresh', async () => {
    expect((await request(createApp()).post('/api/auth/refresh').send({})).status).toBe(401);
    setFindOneResult(User, buildUser({ refreshTokenExpiresAt: new Date(Date.now() - 1000) }));
    expect(
      (await request(createApp()).post('/api/auth/refresh').send({ refreshToken: 'x' })).status
    ).toBe(401);
  });

  it('returns current user and upgrades stale scope', async () => {
    const user = buildUser({ approvalStatus: 'approved' });
    User.findById.mockResolvedValue(user);

    const stale = await request(createApp())
      .get('/api/auth/me')
      .set(authHeader(user, 'pending'))
      .set('X-Auth-Client', 'bearer');
    expect(stale.status).toBe(200);
    expect(stale.body.token).toBeTruthy();

    const current = await request(createApp()).get('/api/auth/me').set(authHeader(user));
    expect(current.status).toBe(200);
    expect(current.body.user.username).toBe('evan.thomas');
  });

  it('returns choir profile for approved members only', async () => {
    const member = buildUser({
      voiceRange: 'C3–G5',
      choirPathway: 'lead-vocalists',
      voiceRangeHistory: [
        {
          _id: userId(),
          value: 'C3–G5',
          recordedAt: new Date('2026-02-01T10:00:00.000Z'),
          recordedByName: 'Choir admin',
        },
      ],
    });
    User.findById.mockResolvedValue(member);

    const res = await request(createApp()).get('/api/auth/my-profile').set(authHeader(member));
    expect(res.status).toBe(200);
    expect(res.body.profile.voiceRange).toBe('C3–G5');
    expect(res.body.profile.voiceRangeHistory).toHaveLength(1);
  });

  it('rejects choir profile for admins and pending members', async () => {
    const adminUser = buildAdmin();
    User.findById.mockResolvedValue(adminUser);
    expect(
      (await request(createApp()).get('/api/auth/my-profile').set(authHeader(adminUser))).status
    ).toBe(403);

    const pending = buildUser({ approvalStatus: 'pending' });
    User.findById.mockResolvedValue(pending);
    expect(
      (await request(createApp()).get('/api/auth/my-profile').set(authHeader(pending, 'pending'))).status
    ).toBe(403);
  });

  it('changes password and clears mustChangePassword', async () => {
    const user = buildUser({ mustChangePassword: true, passwordHash: 'old-hash' });
    User.findById.mockResolvedValue(user);
    bcrypt.compare.mockResolvedValue(true);

    const res = await request(createApp())
      .post('/api/auth/change-password')
      .set(authHeader(user, 'must-change-password'))
      .set('X-Auth-Client', 'bearer')
      .send({ currentPassword: 'old-pass', newPassword: 'new-pass-12' });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
  });

  it('validates change-password errors', async () => {
    const user = buildUser();
    User.findById.mockResolvedValue(user);

    expect(
      (await request(createApp()).post('/api/auth/change-password').set(authHeader(user)).send({})).status
    ).toBe(400);

    bcrypt.compare.mockResolvedValue(false);
    expect(
      (
        await request(createApp())
          .post('/api/auth/change-password')
          .set(authHeader(user))
          .send({ currentPassword: 'a', newPassword: 'bbbbbbbb' })
      ).status
    ).toBe(401);

    bcrypt.compare.mockResolvedValue(true);
    expect(
      (
        await request(createApp())
          .post('/api/auth/change-password')
          .set(authHeader(user))
          .send({ currentPassword: 'sameone1', newPassword: 'sameone1' })
      ).status
    ).toBe(400);

    expect(
      (
        await request(createApp())
          .post('/api/auth/change-password')
          .set(authHeader(user))
          .send({ currentPassword: 'validpass1', newPassword: 'short' })
      ).status
    ).toBe(400);
  });

  it('requireAuth rejects missing, invalid, and wrong-type tokens', async () => {
    const app = express();
    app.use(express.json());
    app.get('/test-auth', requireAuth, (req, res) => res.json({ ok: true }));

    expect((await request(app).get('/test-auth')).status).toBe(401);

    const bad = await request(app).get('/test-auth').set({ Authorization: 'Bearer not-a-jwt' });
    expect(bad.status).toBe(401);

    const user = buildUser({ active: false });
    User.findById.mockResolvedValue(user);
    const inactive = await request(app)
      .get('/test-auth')
      .set(authHeader(user));
    expect(inactive.status).toBe(401);
  });

  it('issueAuthSession persists refresh token', async () => {
    const res = { cookie: vi.fn() };
    const user = buildUser();
    const session = await issueAuthSession(res, user);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(user.save).toHaveBeenCalled();
  });

  describe('cookie-based auth (no bearer header)', () => {
    it('authenticates via token cookie on requireAuth', async () => {
      const app = express();
      app.use(cookieParser());
      app.use(express.json());
      const user = buildUser();
      User.findById.mockResolvedValue(user);
      app.get('/cookie-auth', requireAuth, (req, res) => res.json({ ok: true }));

      const res = await request(app)
        .get('/cookie-auth')
        .set('Cookie', [`token=${signTestToken(user)}`]);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns /me without bearer tokens in body', async () => {
      const user = buildUser({ approvalStatus: 'approved' });
      User.findById.mockResolvedValue(user);

      const res = await request(createApp())
        .get('/api/auth/me')
        .set('Cookie', [`token=${signTestToken(user)}`]);

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('evan.thomas');
      expect(res.body.token).toBeUndefined();
    });

    it('re-issues session cookies on stale /me without bearer body tokens', async () => {
      const user = buildUser({ approvalStatus: 'approved', mustChangePassword: false });
      User.findById.mockResolvedValue(user);

      const res = await request(createApp())
        .get('/api/auth/me')
        .set('Cookie', [`token=${signTestToken(user, 'must-change-password')}`]);

      expect(res.status).toBe(200);
      expect(res.body.user.mustChangePassword).toBe(false);
      expect(res.body.token).toBeUndefined();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('changes password without bearer tokens in response body', async () => {
      const user = buildUser({ passwordHash: 'old-hash' });
      User.findById.mockResolvedValue(user);
      bcrypt.compare.mockResolvedValue(true);

      const res = await request(createApp())
        .post('/api/auth/change-password')
        .set('Cookie', [`token=${signTestToken(user)}`])
        .send({ currentPassword: 'old-pass', newPassword: 'new-pass-12' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.user.mustChangePassword).toBe(false);
      expect(res.body.token).toBeUndefined();
    });

    it('logs out with refresh token cookie and without refresh token', async () => {
      const user = buildUser({ username: 'evan.thomas' });
      const refreshToken = 'cookie-refresh-token';
      User.findOne.mockImplementation(({ refreshTokenHash }) =>
        findOneQuery(refreshTokenHash === hashRefreshToken(refreshToken) ? user : null)
      );

      const withCookie = await request(createApp())
        .post('/api/auth/logout')
        .set('Cookie', [`refreshToken=${refreshToken}`]);
      expect(withCookie.status).toBe(200);

      const without = await request(createApp()).post('/api/auth/logout').send({});
      expect(without.status).toBe(200);
    });
  });
});
