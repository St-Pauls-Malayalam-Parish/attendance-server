import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Attendance } from '../models/Attendance.js';
import { requireAuth, requireAdmin, requireFullSession } from '../middleware/auth.js';
import { normalizeUsername, validateEmail, validateUsername } from '../utils/user-fields.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../logger.js';
import { eventDateQuery } from '../utils/dates.js';
import { buildPaginationMeta, parsePagination } from '../utils/event-query.js';
import { aggregateAttendanceByUsers, summaryFromCounts } from '../utils/attendance-stats.js';
import {
  findUserIdsByAttendanceStatus,
  parseRosterAttendanceFilter,
} from '../utils/roster-attendance-filter.js';
import {
  applyProfileUpdate,
  serializeMemberProfile,
  validateProfileUpdate,
} from '../utils/member-profile.js';
import { validatePassword } from '../utils/password.js';

import { isChoirVoicePart } from '../utils/voice-parts.js';

const router = Router();

router.use(requireAuth, requireAdmin);

async function findMember(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ error: 'Invalid member' });
    return null;
  }
  const member = await User.findOne({ _id: id, role: 'member' });
  if (!member) {
    res.status(404).json({ error: 'Member not found' });
    return null;
  }
  return member;
}

function validateMemberBody({ name, username, email, password, voicePart }, { passwordRequired, usernameRequired }) {
  if (!name || name.trim().length < 2) {
    return 'Name is required';
  }
  if (usernameRequired || username) {
    const usernameError = validateUsername(username);
    if (usernameError) return usernameError;
  }
  const emailError = validateEmail(email);
  if (emailError) return emailError;
  const passwordError = validatePassword(password, { required: passwordRequired });
  if (passwordError) return passwordError;
  if (!isChoirVoicePart(voicePart)) {
    return 'Invalid voice part';
  }
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRosterFilter(query) {
  const filter = { role: 'member', approvalStatus: 'approved', active: true };
  const search = typeof query.search === 'string' ? query.search.trim() : '';

  if (search) {
    const term = escapeRegex(search);
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { username: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
    ];
  }

  if (query.voicePart && isChoirVoicePart(query.voicePart)) {
    filter.voicePart = query.voicePart;
  }

  return filter;
}

function serializeMember(member, stats = {}) {
  return {
    id: member._id.toString(),
    name: member.name,
    username: member.username,
    email: member.email,
    voicePart: member.voicePart,
    voiceRange: member.voiceRange || '',
    choirPathway: member.choirPathway || '',
    active: member.active,
    approvalStatus: member.approvalStatus || 'pending',
    createdAt: member.createdAt,
    summary: summaryFromCounts(stats),
  };
}

router.get('/roster', asyncHandler(async (req, res) => {
  const dateQuery = eventDateQuery(req.query.from, req.query.to);
  if (dateQuery.error) {
    return res.status(400).json({ error: dateQuery.error });
  }

  const filter = buildRosterFilter(req.query);
  const attendanceStatus = parseRosterAttendanceFilter(req.query.attendanceStatus);
  if (attendanceStatus) {
    const matchingUserIds = await findUserIdsByAttendanceStatus(attendanceStatus, dateQuery.range);
    filter._id = { $in: matchingUserIds };
  }

  const { page, pageSize, skip } = parsePagination(req.query);

  const [total, totalUnfiltered, members] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments({ role: 'member', approvalStatus: 'approved', active: true }),
    User.find(filter)
      .select(
        'name username email voicePart voiceRange choirPathway active approvalStatus createdAt'
      )
      .sort({ name: 1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
  ]);

  const statsByUser = await aggregateAttendanceByUsers(
    members.map((member) => member._id),
    dateQuery.range
  );

  res.json({
    members: members.map((member) =>
      serializeMember(member, statsByUser.get(member._id.toString()))
    ),
    pagination: buildPaginationMeta({ page, pageSize, total }),
    meta: {
      totalUnfiltered,
      dateFiltered: Boolean(dateQuery.range),
      from: req.query.from || '',
      to: req.query.to || '',
      attendanceStatus,
    },
  });
}));

router.get('/', asyncHandler(async (_req, res) => {
  const members = await User.find({ role: 'member' })
    .select(
      'name username email voicePart voiceRange choirPathway active approvalStatus createdAt'
    )
    .sort({ createdAt: -1 })
    .lean();

  const payload = members.map((member) => serializeMember(member));

  res.json({
    pending: payload.filter((member) => member.approvalStatus === 'pending' && member.active),
    inactive: payload.filter((member) => !member.active),
    declined: payload.filter((member) => member.approvalStatus === 'rejected' && member.active),
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, username, email, password, voicePart } = req.body;
  const error = validateMemberBody(
    { name, username, email, password, voicePart },
    { passwordRequired: true, usernameRequired: true }
  );
  if (error) {
    return res.status(400).json({ error });
  }

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

  const user = await User.create({
    name: name.trim(),
    username: normalizedUsername,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    voicePart,
    role: 'member',
    approvalStatus: 'approved',
  });

  audit('member.created', req, {
    targetUserId: user._id.toString(),
    targetUsername: user.username,
  });
  res.status(201).json({ member: user.toSafeJSON() });
}));

router.get('/:id/profile', asyncHandler(async (req, res) => {
  const member = await findMember(req.params.id, res);
  if (!member) return;

  res.json({
    member: {
      id: member._id.toString(),
      name: member.name,
      username: member.username,
      voicePart: member.voicePart,
    },
    profile: serializeMemberProfile(member),
  });
}));

router.patch('/:id/profile', asyncHandler(async (req, res) => {
  const member = await findMember(req.params.id, res);
  if (!member) return;

  const { voiceRange, feedback, choirPathway } = req.body;
  const error = validateProfileUpdate({ voiceRange, feedback, choirPathway });
  if (error) {
    return res.status(400).json({ error });
  }

  applyProfileUpdate(member, { voiceRange, feedback, choirPathway }, req.user);
  await member.save();

  audit('member.profile.updated', req, {
    targetUserId: member._id.toString(),
    targetUsername: member.username,
    updatedFields: [
      voiceRange !== undefined ? 'voiceRange' : null,
      feedback !== undefined ? 'feedback' : null,
      choirPathway !== undefined ? 'choirPathway' : null,
    ].filter(Boolean),
  });

  res.json({
    member: {
      id: member._id.toString(),
      name: member.name,
      username: member.username,
      voicePart: member.voicePart,
    },
    profile: serializeMemberProfile(member),
  });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, username, email, voicePart, password } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid member' });
  }

  const error = validateMemberBody(
    { name, username, email, password, voicePart },
    { passwordRequired: false, usernameRequired: true }
  );
  if (error) {
    return res.status(400).json({ error });
  }

  const member = await User.findOne({ _id: id, role: 'member' });
  if (!member) {
    return res.status(404).json({ error: 'Member not found' });
  }

  const nextUsername = normalizeUsername(username);
  const nextEmail = email.toLowerCase();

  const usernameClash = await User.findOne({ username: nextUsername, _id: { $ne: member._id } });
  if (usernameClash) {
    return res.status(409).json({ error: 'This username is already taken' });
  }

  const emailClash = await User.findOne({ email: nextEmail, _id: { $ne: member._id } });
  if (emailClash) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  member.name = name.trim();
  member.username = nextUsername;
  member.email = nextEmail;
  member.voicePart = voicePart;
  if (password) {
    member.passwordHash = await bcrypt.hash(password, 12);
    member.mustChangePassword = true;
  }
  await member.save();

  if (password) {
    audit('member.password.reset', req, {
      targetUserId: member._id.toString(),
      targetUsername: member.username,
    });
  }

  res.json({ member: member.toSafeJSON() });
}));

router.patch('/:id/approval', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { approvalStatus } = req.body;

  const member = await findMember(id, res);
  if (!member) return;

  if (!['approved', 'rejected', 'pending'].includes(approvalStatus)) {
    return res.status(400).json({ error: 'Approval must be approved or declined' });
  }

  member.approvalStatus = approvalStatus;
  await member.save();
  audit('member.approval.changed', req, {
    targetUserId: member._id.toString(),
    targetUsername: member.username,
    approvalStatus,
  });
  res.json({ member: member.toSafeJSON() });
}));

router.patch('/:id/active', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Active must be true or false' });
  }

  const member = await findMember(id, res);
  if (!member) return;

  member.active = active;
  await member.save();
  audit('member.active.changed', req, {
    targetUserId: member._id.toString(),
    targetUsername: member.username,
    active,
  });
  res.json({ member: member.toSafeJSON() });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const member = await findMember(id, res);
  if (!member) return;

  await Attendance.deleteMany({ user: member._id });
  await member.deleteOne();
  audit('member.deleted', req, {
    targetUserId: member._id.toString(),
    targetUsername: member.username,
  });
  res.json({ ok: true });
}));

export default router;
