import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Attendance } from '../models/Attendance.js';
import { requireAuth, requireAdmin, approvedMemberFilter } from '../middleware/auth.js';
import { normalizeUsername, validateEmail, validateUsername } from '../utils/user-fields.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../logger.js';
import { eventDateQuery } from '../utils/dates.js';
import { buildPaginationMeta, parsePagination } from '../utils/event-query.js';
import { aggregateAttendanceByUsers, summaryFromCounts } from '../utils/attendance-stats.js';
import {
  eventAttendanceMatchesFilter,
  findUserIdsByAttendanceStatus,
  parseRosterAttendanceFilter,
  resolveMemberEventAttendance,
} from '../utils/roster-attendance-filter.js';
import {
  applyProfileUpdate,
  serializeMemberProfile,
  validateProfileUpdate,
} from '../utils/member-profile.js';
import { validatePassword } from '../utils/password.js';
import { applyRoleChange, ensureRoleChangeAllowed, parseAccountRole, resolveOnRoster } from '../utils/account-role.js';
import { buildRosterExportModel, buildRosterPdf, buildRosterWorkbook } from '../utils/roster-export.js';

import { isChoirVoicePart } from '../utils/voice-parts.js';

const router = Router();

router.use(requireAuth, requireAdmin);

async function findAccount(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ error: 'Invalid member' });
    return null;
  }
  const account = await User.findById(id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return null;
  }
  return account;
}

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

/** Members, and admins who also sing, can have a choir profile and attendance history. */
async function findChoirParticipant(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ error: 'Invalid member' });
    return null;
  }
  const member = await User.findOne({
    _id: id,
    $or: [{ role: 'member' }, { role: 'admin', onRoster: true }],
  });
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
  const filter = {
    active: true,
    approvalStatus: 'approved',
    $and: [{ $or: approvedMemberFilter.$or }],
  };
  const search = typeof query.search === 'string' ? query.search.trim() : '';

  if (search) {
    const term = escapeRegex(search);
    filter.$and.push({
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { username: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
      ],
    });
  }

  if (query.voicePart && isChoirVoicePart(query.voicePart)) {
    filter.voicePart = query.voicePart;
  }

  return filter;
}

function serializeAccount(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    onRoster: user.role === 'admin' ? user.onRoster === true : true,
    voicePart: user.voicePart,
    active: user.active,
    approvalStatus: user.approvalStatus || 'pending',
    createdAt: user.createdAt,
  };
}

function serializeMember(member, stats = {}, eventAttendance = null) {
  return {
    ...serializeAccount(member),
    voiceRange: member.voiceRange || '',
    choirPathway: member.choirPathway || '',
    summary: summaryFromCounts(stats),
    ...(eventAttendance ? { eventAttendance } : {}),
  };
}

async function getRoster(query, { all = false } = {}) {
  const eventId = typeof query.eventId === 'string' ? query.eventId.trim() : '';
  const dateQuery = eventId ? { range: null } : eventDateQuery(query.from, query.to);
  if (dateQuery.error) {
    return { error: dateQuery.error, status: 400 };
  }

  const filter = buildRosterFilter(query);
  const attendanceStatus = parseRosterAttendanceFilter(query.attendanceStatus);
  let selectedEvent = null;
  let recordsByUser = new Map();

  if (eventId) {
    if (!mongoose.isValidObjectId(eventId)) {
      return { error: 'Invalid event', status: 400 };
    }
    selectedEvent = await Event.findById(eventId).select('title date type').lean();
    if (!selectedEvent) {
      return { error: 'Event not found', status: 404 };
    }
    const records = await Attendance.find({ event: selectedEvent._id }).select('user status late').lean();
    recordsByUser = new Map(records.map((record) => [String(record.user), record]));

    if (attendanceStatus) {
      const rosterUsers = await User.find(filter).select('_id').lean();
      filter._id = {
        $in: rosterUsers
          .filter((user) =>
            eventAttendanceMatchesFilter(
              resolveMemberEventAttendance(recordsByUser.get(String(user._id)), selectedEvent.date),
              attendanceStatus
            )
          )
          .map((user) => user._id),
      };
    }
  } else if (attendanceStatus) {
    const matchingUserIds = await findUserIdsByAttendanceStatus(attendanceStatus, dateQuery.range);
    filter._id = { $in: matchingUserIds };
  }

  const { page, pageSize, skip } = all
    ? { page: 1, pageSize: 1, skip: 0 }
    : parsePagination(query);

  let membersQuery = User.find(filter)
    .select(
      'name username email role onRoster voicePart voiceRange choirPathway active approvalStatus createdAt'
    )
    .sort({ name: 1 });
  if (!all) {
    membersQuery = membersQuery.skip(skip).limit(pageSize);
  }

  const [total, totalUnfiltered, members] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments(approvedMemberFilter),
    membersQuery.lean(),
  ]);

  const statsByUser = selectedEvent
    ? new Map()
    : await aggregateAttendanceByUsers(
        members.map((member) => member._id),
        dateQuery.range
      );

  const serialized = members.map((member) => {
    if (!selectedEvent) {
      return serializeMember(member, statsByUser.get(member._id.toString()));
    }
    const resolved = resolveMemberEventAttendance(
      recordsByUser.get(member._id.toString()),
      selectedEvent.date
    );
    return serializeMember(member, {}, { status: resolved.status, late: resolved.late });
  });

  return {
    members: serialized,
    pagination: buildPaginationMeta({
      page,
      pageSize: all ? Math.max(total, 1) : pageSize,
      total,
    }),
    meta: {
      totalUnfiltered,
      dateFiltered: Boolean(dateQuery.range),
      from: eventId ? '' : query.from || '',
      to: eventId ? '' : query.to || '',
      attendanceStatus,
      event: selectedEvent
        ? {
            id: selectedEvent._id.toString(),
            title: selectedEvent.title,
            date: selectedEvent.date,
            type: selectedEvent.type,
          }
        : null,
    },
  };
}

router.get('/roster/export', asyncHandler(async (req, res) => {
  const format = String(req.query.format || '').toLowerCase();
  if (format !== 'pdf' && format !== 'xlsx') {
    return res.status(400).json({ error: 'Choose a PDF or Excel export' });
  }

  const result = await getRoster(req.query, { all: true });
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  const model = buildRosterExportModel({
    members: result.members,
    meta: result.meta,
    query: req.query,
  });
  if (model.error) {
    return res.status(400).json({ error: model.error });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `st-pauls-choir-roster-${stamp}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
  const body = format === 'pdf' ? await buildRosterPdf(model) : await buildRosterWorkbook(model);

  res.setHeader(
    'Content-Type',
    format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}));

router.get('/roster', asyncHandler(async (req, res) => {
  const result = await getRoster(req.query);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.json({
    members: result.members,
    pagination: result.pagination,
    meta: result.meta,
  });
}));

router.get('/', asyncHandler(async (_req, res) => {
  const members = await User.find({ role: 'member' })
    .select(
      'name username email role onRoster voicePart voiceRange choirPathway active approvalStatus createdAt'
    )
    .sort({ createdAt: -1 })
    .lean();

  const payload = members.map((member) => serializeMember(member));

  res.json({
    pending: payload.filter((member) => member.approvalStatus === 'pending' && member.active),
    inactive: payload.filter((member) => !member.active),
    declined: payload.filter((member) => member.approvalStatus === 'rejected' && member.active),
    admins: (
      await User.find({ role: 'admin' })
        .select('name username email voicePart active approvalStatus role onRoster createdAt')
        .sort({ name: 1 })
        .lean()
    ).map((admin) => serializeAccount(admin)),
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, username, email, password, voicePart, role: roleInput, onRoster } = req.body;
  const role = parseAccountRole(roleInput) || 'member';
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
    role,
    onRoster: resolveOnRoster(role, onRoster, false),
    approvalStatus: 'approved',
    mustChangePassword: true,
  });

  audit(role === 'admin' ? 'admin.created' : 'member.created', req, {
    targetUserId: user._id.toString(),
    targetUsername: user.username,
    role,
  });
  res.status(201).json({ member: user.toSafeJSON() });
}));

router.get('/:id/profile', asyncHandler(async (req, res) => {
  const member = await findChoirParticipant(req.params.id, res);
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
  const member = await findChoirParticipant(req.params.id, res);
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
  const { name, username, email, voicePart, password, role: roleInput, onRoster } = req.body;

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

  const account = await findAccount(id, res);
  if (!account) return;

  const nextRole = roleInput === undefined ? account.role : parseAccountRole(roleInput);
  if (roleInput !== undefined && !nextRole) {
    return res.status(400).json({ error: 'Role must be member or admin' });
  }

  const roleError = await ensureRoleChangeAllowed(account, nextRole);
  if (roleError) {
    return res.status(400).json({ error: roleError });
  }

  const nextUsername = normalizeUsername(username);
  const nextEmail = email.toLowerCase();

  const usernameClash = await User.findOne({ username: nextUsername, _id: { $ne: account._id } });
  if (usernameClash) {
    return res.status(409).json({ error: 'This username is already taken' });
  }

  const emailClash = await User.findOne({ email: nextEmail, _id: { $ne: account._id } });
  if (emailClash) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  account.name = name.trim();
  account.username = nextUsername;
  account.email = nextEmail;
  account.voicePart = voicePart;
  const previousRole = account.role;
  const previousOnRoster = account.onRoster === true;
  if (nextRole !== previousRole) {
    applyRoleChange(account, nextRole, onRoster);
  } else {
    account.onRoster = resolveOnRoster(nextRole, onRoster, account.onRoster);
  }
  if (password) {
    account.passwordHash = await bcrypt.hash(password, 12);
    account.mustChangePassword = true;
  }
  await account.save();

  if (password) {
    audit('member.password.reset', req, {
      targetUserId: account._id.toString(),
      targetUsername: account.username,
    });
  }
  if (roleInput !== undefined && nextRole !== previousRole) {
    audit('account.role.changed', req, {
      targetUserId: account._id.toString(),
      targetUsername: account.username,
      role: nextRole,
      onRoster: account.onRoster === true,
    });
  } else if (previousOnRoster !== (account.onRoster === true)) {
    audit('account.roster.changed', req, {
      targetUserId: account._id.toString(),
      targetUsername: account.username,
      onRoster: account.onRoster === true,
    });
  }

  res.json({ member: account.toSafeJSON() });
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
