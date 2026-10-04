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
import {
  isPlaceholderParishEmail,
  normalizeUsername,
  validateEmail,
  validateUsername,
} from '../utils/user-fields.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../logger.js';
import { serializeMemberProfile } from '../utils/member-profile.js';
import { validatePassword } from '../utils/password.js';

import { isChoirVoicePart, voicePartNeedsUpdate } from '../utils/voice-parts.js';

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
  const passwordError = validatePassword(password, { required: true });
  if (passwordError) return passwordError;
  if (!voicePart || !isChoirVoicePart(voicePart)) {
    return 'Please choose a voice part';
  }
  return null;
}

function wantsBearerTokens(req) {
  return req.headers['x-auth-client'] === 'bearer';
}

async function applyEmailUpdate(user, email) {
  const emailError = validateEmail(email);
  if (emailError) {
    return { error: emailError, status: 400 };
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (isPlaceholderParishEmail(normalizedEmail)) {
    return { error: 'Please enter your personal email address', status: 400 };
  }

  if (normalizedEmail === user.email) {
    return { changed: false };
  }

  const existingEmail = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
  if (existingEmail) {
    return { error: 'An account with this email already exists', status: 409 };
  }

  user.email = normalizedEmail;
  return { changed: true };
}

function authUserResponse(res, req, user) {
  return issueAuthSession(res, user).then((session) => {
    const body = { ok: true, user: session.user };
    if (wantsBearerTokens(req)) {
      body.token = session.accessToken;
      body.refreshToken = session.refreshToken;
    }
    return body;
  });
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
    onRoster: true,
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
  if (/\s/.test(String(password))) {
    return res.status(400).json({ error: 'Password cannot contain spaces' });
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

router.patch('/account', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const result = await applyEmailUpdate(req.user, email);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  if (result.changed) {
    await req.user.save();
    audit('auth.email.updated', req);
  }

  const body = await authUserResponse(res, req, req.user);
  return res.json(body);
}));

router.post('/change-password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, email, voicePart } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  const passwordError = validatePassword(newPassword, { required: true, fieldLabel: 'New password' });
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!ok) {
    audit('auth.password.change_failed', req, { reason: 'invalid_current_password' });
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'Choose a different password than your current one' });
  }

  if (isPlaceholderParishEmail(req.user.email)) {
    if (!email) {
      return res.status(400).json({ error: 'Please enter your email address' });
    }
    const emailResult = await applyEmailUpdate(req.user, email);
    if (emailResult.error) {
      return res.status(emailResult.status).json({ error: emailResult.error });
    }
  } else if (email) {
    const emailResult = await applyEmailUpdate(req.user, email);
    if (emailResult.error) {
      return res.status(emailResult.status).json({ error: emailResult.error });
    }
  }

  if (req.user.mustChangePassword && voicePartNeedsUpdate(req.user.voicePart)) {
    if (!voicePart || !isChoirVoicePart(voicePart)) {
      return res.status(400).json({ error: 'Please select your voice part' });
    }
    req.user.voicePart = voicePart;
  }

  req.user.passwordHash = await bcrypt.hash(newPassword, 12);
  req.user.mustChangePassword = false;
  await req.user.save();

  audit('auth.password.changed', req);
  const body = await authUserResponse(res, req, req.user);
  return res.json(body);
}));

export default router;
