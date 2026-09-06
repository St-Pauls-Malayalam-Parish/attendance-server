import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import {
  clearAuthCookies,
  issueAuthSession,
  readRefreshToken,
  requireAuth,
  requireFullSession,
  revokeRefreshToken,
} from '../middleware/auth.js';
import { hashRefreshToken } from '../utils/tokens.js';
import { normalizeUsername, validateEmail, validateUsername } from '../utils/user-fields.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../logger.js';
import { serializeMemberProfile } from '../utils/member-profile.js';

import { isChoirVoicePart } from '../utils/voice-parts.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait and try again.' },
});

function validateRegister({ name, username, email, password, voicePart }) {
  if (!name || name.trim().length < 2) {
    return 'Please enter your full name';
  }
  const usernameError = validateUsername(username);
  if (usernameError) return usernameError;
  const emailError = validateEmail(email);
  if (emailError) return emailError;
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!voicePart || !isChoirVoicePart(voicePart)) {
    return 'Please choose a voice part';
  }
  return null;
}

function wantsBearerTokens(req) {
  return req.headers['x-auth-client'] === 'bearer';
}

function sendAuthResponse(res, statusCode, session, req) {
  const body = { user: session.user };
  if (wantsBearerTokens(req)) {
    body.token = session.accessToken;
    body.refreshToken = session.refreshToken;
  }
  return res.status(statusCode).json(body);
}

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { name, username, email, password, voicePart } = req.body;
  const error = validateRegister({ name, username, email, password, voicePart });
  if (error) return res.status(400).json({ error });

  const normalizedUsername = normalizeUsername(username);
  const normalizedEmail = email.toLowerCase();

  const existingUsername = await User.findOne({ username: normalizedUsername });
  if (existingUsername) {
    return res.status(409).json({ error: 'This username is already taken' });
  }

  const existingEmail = await User.findOne({ email: normalizedEmail });
  if (existingEmail) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    name: name.trim(),
    username: normalizedUsername,
    email: normalizedEmail,
    passwordHash,
    voicePart,
    role: 'member',
    approvalStatus: 'pending',
  });

  const session = await issueAuthSession(res, user);
  audit('auth.register', req, {
    targetUserId: user._id.toString(),
    targetUsername: user.username,
  });
  return sendAuthResponse(res, 201, session, req);
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ error: usernameError });
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const normalizedUsername = normalizeUsername(username);
  const user = await User.findOne({ username: normalizedUsername });
  if (!user || !user.active) {
    audit('auth.login.failed', req, { username: normalizedUsername, reason: 'invalid_credentials' });
    return res.status(401).json({ error: 'Username or password is incorrect' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    audit('auth.login.failed', req, { username: normalizedUsername, reason: 'invalid_credentials' });
    return res.status(401).json({ error: 'Username or password is incorrect' });
  }

  if (user.approvalStatus === 'rejected') {
    audit('auth.login.failed', req, { username: normalizedUsername, reason: 'rejected' });
    return res.status(403).json({
      error: 'This registration was not approved. Please contact a choir admin.',
    });
  }

  const session = await issueAuthSession(res, user);
  req.user = user;
  audit('auth.login.success', req, {
    targetUserId: user._id.toString(),
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  return sendAuthResponse(res, 200, session, req);
}));

router.post('/refresh', authLimiter, asyncHandler(async (req, res) => {
  const refreshToken = readRefreshToken(req);
  if (!refreshToken) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  const hash = hashRefreshToken(refreshToken);
  const user = await User.findOne({ refreshTokenHash: hash }).select(
    '+refreshTokenHash +refreshTokenExpiresAt'
  );

  if (
    !user ||
    !user.active ||
    user.approvalStatus === 'rejected' ||
    !user.refreshTokenExpiresAt ||
    user.refreshTokenExpiresAt < new Date()
  ) {
    audit('auth.refresh.failed', req, { reason: 'invalid_or_expired' });
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const session = await issueAuthSession(res, user);
  req.user = user;
  audit('auth.refresh.success', req, { targetUserId: user._id.toString() });
  return sendAuthResponse(res, 200, session, req);
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const refreshToken = readRefreshToken(req);
  let logoutUser;
  if (refreshToken) {
    const hash = hashRefreshToken(refreshToken);
    logoutUser = await User.findOne({ refreshTokenHash: hash }).select('username');
  }

  await revokeRefreshToken(refreshToken);
  clearAuthCookies(res);
  audit('auth.logout', req, {
    targetUsername: logoutUser?.username,
  });
  res.json({ ok: true });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  if (req.tokenScope !== req.authScope) {
    const session = await issueAuthSession(res, req.user);
    const body = { user: session.user };
    if (wantsBearerTokens(req)) {
      body.token = session.accessToken;
      body.refreshToken = session.refreshToken;
    }
    return res.json(body);
  }

  res.json({ user: req.user.toSafeJSON() });
}));

router.get('/my-profile', requireAuth, requireFullSession, asyncHandler(async (req, res) => {
  if (req.user.role !== 'member') {
    return res.status(403).json({ error: 'Only choir members can view this profile' });
  }

  res.json({ profile: serializeMemberProfile(req.user) });
}));

router.post('/change-password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!ok) {
    audit('auth.password.change_failed', req, { reason: 'invalid_current_password' });
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'Choose a different password than your current one' });
  }

  req.user.passwordHash = await bcrypt.hash(newPassword, 12);
  req.user.mustChangePassword = false;
  await req.user.save();

  const session = await issueAuthSession(res, req.user);
  audit('auth.password.changed', req);
  const body = { ok: true, user: session.user };
  if (wantsBearerTokens(req)) {
    body.token = session.accessToken;
    body.refreshToken = session.refreshToken;
  }
  return res.json(body);
}));

export default router;
