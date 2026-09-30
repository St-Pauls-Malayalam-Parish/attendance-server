import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
  createRefreshToken,
  hashRefreshToken,
} from '../utils/tokens.js';

const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

export function sessionScopeForUser(user) {
  if (user.mustChangePassword) {
    return 'must-change-password';
  }
  if (user.role === 'admin' || user.approvalStatus === 'approved') {
    return 'full';
  }
  return 'pending';
}

function normalizeTokenScope(scope) {
  if (scope === 'full' || scope === 'must-change-password') {
    return scope;
  }
  return 'pending';
}

export function signAccessToken(user, scope = sessionScopeForUser(user)) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role, type: 'access', scope },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

/** @deprecated Use signAccessToken */
export function signToken(user) {
  return signAccessToken(user);
}

function cookieOptions(maxAgeMs) {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: maxAgeMs,
    path: '/',
  };
}

export function setAccessCookie(res, token) {
  res.cookie('token', token, cookieOptions(ACCESS_COOKIE_MAX_AGE_MS));
}

export function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, cookieOptions(REFRESH_TOKEN_TTL_MS));
}

export function setAuthCookie(res, token) {
  setAccessCookie(res, token);
}

export function clearAuthCookies(res) {
  const options = cookieOptions(0);
  res.clearCookie('token', options);
  res.clearCookie('refreshToken', options);
}

export function clearAuthCookie(res) {
  clearAuthCookies(res);
}

export function readRefreshToken(req) {
  return req.cookies?.refreshToken || req.body?.refreshToken || null;
}

function readAuthToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.cookies?.token;
}

export async function issueAuthSession(res, user) {
  const scope = sessionScopeForUser(user);
  const accessToken = signAccessToken(user, scope);
  const refreshToken = createRefreshToken();

  user.refreshTokenHash = hashRefreshToken(refreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await user.save();

  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);

  return {
    accessToken,
    refreshToken,
    scope,
    user: user.toSafeJSON(),
  };
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) {
    return;
  }

  const hash = hashRefreshToken(refreshToken);
  const user = await User.findOne({ refreshTokenHash: hash }).select('+refreshTokenHash');
  if (!user) {
    return;
  }

  user.refreshTokenHash = undefined;
  user.refreshTokenExpiresAt = undefined;
  await user.save();
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = readAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type && payload.type !== 'access') {
      return res.status(401).json({ error: 'Sign in required' });
    }

    const user = await User.findById(payload.id);
    if (!user || !user.active || user.approvalStatus === 'rejected') {
      return res.status(401).json({ error: 'Sign in required' });
    }

    req.user = user;
    req.tokenScope = normalizeTokenScope(payload.scope);
    req.authScope = sessionScopeForUser(user);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
});

export function requireFullSession(req, res, next) {
  if (req.authScope === 'must-change-password') {
    return res.status(403).json({ error: 'Please set a new password before continuing' });
  }
  if (req.authScope !== 'full') {
    return res.status(403).json({ error: 'Your account is waiting for admin approval' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only choir admins can do this' });
  }
  next();
}

export function requireApproved(req, res, next) {
  if (req.user.role !== 'admin' && req.user.approvalStatus !== 'approved') {
    return res.status(403).json({ error: 'Your account is waiting for admin approval' });
  }
  next();
}

/** Choir singers: every member, plus admins who were kept on the roster. */
export const choirRosterClause = {
  $or: [{ role: 'member' }, { role: 'admin', onRoster: true }],
};

export const approvedMemberFilter = {
  active: true,
  approvalStatus: 'approved',
  ...choirRosterClause,
};
