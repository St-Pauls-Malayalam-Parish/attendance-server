import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { vi } from 'vitest';

export const userId = () => new mongoose.Types.ObjectId();
export const eventId = () => new mongoose.Types.ObjectId();

export function buildUser(overrides = {}) {
  const _id = overrides._id || userId();
  const user = {
    _id,
    name: 'Evan Thomas',
    username: 'evan.thomas',
    email: 'evan@stpauls.parish',
    passwordHash: '$2a$12$hashedpasswordvalue',
    role: 'member',
    voicePart: 'tenor',
    active: true,
    approvalStatus: 'approved',
    mustChangePassword: false,
    voiceRange: '',
    choirPathway: '',
    voiceRangeHistory: [],
    feedbackHistory: [],
    pathwayHistory: [],
    refreshTokenHash: undefined,
    refreshTokenExpiresAt: undefined,
    save: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    toSafeJSON() {
      return {
        id: _id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        voicePart: user.voicePart,
        active: user.active,
        approvalStatus: user.approvalStatus,
        mustChangePassword: user.mustChangePassword,
      };
    },
    ...overrides,
  };
  return user;
}

export function buildAdmin(overrides = {}) {
  return buildUser({
    username: 'admin',
    email: 'admin@stpauls.parish',
    role: 'admin',
    approvalStatus: 'approved',
    ...overrides,
  });
}

export function buildEvent(overrides = {}) {
  const _id = overrides._id || eventId();
  return {
    _id,
    title: 'Friday practice',
    date: new Date('2026-01-10T18:30:00.000Z'),
    type: 'practice',
    notes: '',
    liturgicalColor: 'green',
    createdBy: userId(),
    ...overrides,
  };
}

export function sessionScopeForUser(user) {
  if (user.mustChangePassword) {
    return 'must-change-password';
  }
  if (user.role === 'admin' || user.approvalStatus === 'approved') {
    return 'full';
  }
  return 'pending';
}

export function signTestToken(user, scope = sessionScopeForUser(user)) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      type: 'access',
      scope,
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

export function authHeader(user, scope = sessionScopeForUser(user)) {
  return { Authorization: `Bearer ${signTestToken(user, scope)}` };
}

/** Seeded admin or imported member with a shared default password. */
export function buildDefaultPasswordUser(overrides = {}) {
  return buildUser({ mustChangePassword: true, ...overrides });
}

export function buildDefaultPasswordAdmin(overrides = {}) {
  return buildAdmin({ mustChangePassword: true, ...overrides });
}
