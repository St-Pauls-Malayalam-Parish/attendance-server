import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { validateEnv } from '../../src/config/env.js';
import { asyncHandler } from '../../src/utils/async-handler.js';
import {
  sessionScopeForUser,
  signAccessToken,
  signToken,
  setAccessCookie,
  setRefreshCookie,
  setAuthCookie,
  clearAuthCookies,
  clearAuthCookie,
  readRefreshToken,
  requireFullSession,
  requireAdmin,
  requireApproved,
  approvedMemberFilter,
  revokeRefreshToken,
} from '../../src/middleware/auth.js';
import { buildUser, buildAdmin } from '../helpers/fixtures.js';
import { User, setFindOneResult } from '../helpers/model-mocks.js';

describe('validateEnv', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('throws when required vars missing', () => {
    delete process.env.MONGODB_URI;
    expect(() => validateEnv()).toThrow(/MONGODB_URI/);
  });

  it('warns on weak jwt in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NODE_ENV = 'development';
    process.env.MONGODB_URI = 'mongodb://localhost/choir';
    process.env.JWT_SECRET = 'change-this-to-a-long-random-string';
    validateEnv();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('errors on weak jwt in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost/choir';
    process.env.JWT_SECRET = 'short';
    process.env.CLIENT_ORIGIN = 'https://example.com';
    expect(() => validateEnv()).toThrow(/JWT_SECRET/);
  });

  it('requires CLIENT_ORIGIN in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost/choir';
    process.env.JWT_SECRET = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';
    delete process.env.CLIENT_ORIGIN;
    expect(() => validateEnv()).toThrow(/CLIENT_ORIGIN/);
  });

  it('warns on default admin password in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost/choir';
    process.env.JWT_SECRET = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';
    process.env.CLIENT_ORIGIN = 'https://example.com';
    process.env.ADMIN_PASSWORD = 'choiradmin';
    validateEnv();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects invalid CLIENT_ORIGIN protocol', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost/choir';
    process.env.JWT_SECRET = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';
    process.env.CLIENT_ORIGIN = 'ftp://example.com';
    expect(() => validateEnv()).toThrow(/CLIENT_ORIGIN/);
  });
});

describe('asyncHandler', () => {
  it('forwards async errors to next', async () => {
    const err = new Error('boom');
    const fn = asyncHandler(async () => {
      throw err;
    });
    const next = vi.fn();
    await fn({}, {}, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('calls handler when successful', async () => {
    const fn = asyncHandler(async (_req, res) => {
      res.status(200).end();
    });
    const res = { status: vi.fn().mockReturnThis(), end: vi.fn() };
    await fn({}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('auth middleware helpers', () => {
  it('resolves session scopes', () => {
    expect(sessionScopeForUser(buildUser({ mustChangePassword: true }))).toBe('must-change-password');
    expect(sessionScopeForUser(buildUser({ approvalStatus: 'pending' }))).toBe('pending');
    expect(sessionScopeForUser(buildUser())).toBe('full');
    expect(sessionScopeForUser(buildAdmin())).toBe('full');
  });

  it('signs tokens', () => {
    const user = buildAdmin();
    expect(signAccessToken(user)).toBeTruthy();
    expect(signToken(user)).toBeTruthy();
  });

  it('manages cookies and refresh token reader', () => {
    const res = { cookie: vi.fn(), clearCookie: vi.fn() };
    setAccessCookie(res, 'a');
    setRefreshCookie(res, 'r');
    setAuthCookie(res, 'a');
    clearAuthCookies(res);
    clearAuthCookie(res);
    expect(res.cookie).toHaveBeenCalled();
    expect(readRefreshToken({ cookies: { refreshToken: 'x' } })).toBe('x');
    expect(readRefreshToken({ body: { refreshToken: 'y' } })).toBe('y');
    expect(readRefreshToken({})).toBeNull();
  });

  it('uses secure cross-site cookies in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const res = { cookie: vi.fn(), clearCookie: vi.fn() };
    setAccessCookie(res, 'token-value');
    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'token-value',
      expect.objectContaining({ secure: true, sameSite: 'none' })
    );
    process.env.NODE_ENV = prev;
  });

  it('enforces role and session guards', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    requireFullSession({ authScope: 'must-change-password' }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);

    requireFullSession({ authScope: 'pending' }, res, vi.fn());
    requireFullSession({ authScope: 'full' }, res, next);
    expect(next).toHaveBeenCalled();

    requireAdmin({ user: buildUser() }, res, vi.fn());
    requireAdmin({ user: buildAdmin() }, res, next);
    expect(next).toHaveBeenCalled();

    requireApproved({ user: buildUser({ approvalStatus: 'pending' }) }, res, vi.fn());
    requireApproved({ user: buildUser() }, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('exports approved member filter', () => {
    expect(approvedMemberFilter).toMatchObject({
      active: true,
      approvalStatus: 'approved',
      $or: [{ role: 'member' }, { role: 'admin', onRoster: true }],
    });
  });

  it('revokes refresh token when user found', async () => {
    const user = buildUser();
    user.save = vi.fn().mockResolvedValue(undefined);
    setFindOneResult(User, user);
    await revokeRefreshToken('refresh-token');
    expect(user.refreshTokenHash).toBeUndefined();
    expect(user.save).toHaveBeenCalled();
  });

  it('no-ops revoke when token missing or user not found', async () => {
    await revokeRefreshToken(null);
    setFindOneResult(User, null);
    await revokeRefreshToken('missing');
    expect(User.findOne).toHaveBeenCalled();
  });
});
