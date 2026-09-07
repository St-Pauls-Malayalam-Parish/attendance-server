import { Router } from 'express';
import mongoose from 'mongoose';
import { Attendance } from '../models/Attendance.js';
import { Event } from '../models/Event.js';
import { User } from '../models/User.js';
import { requireAuth, requireAdmin, requireFullSession, approvedMemberFilter } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../logger.js';
import { buildEventFilter, buildPaginationMeta, parsePagination } from '../utils/event-query.js';
import { summaryFromStatusRows } from '../utils/attendance-stats.js';
import {
  MEMBER_STATUS_FILTERS,
  displayAttendanceStatus,
  isLateArrival,
  normalizeAttendanceInput,
  serializeRosterAttendance,
} from '../utils/attendance-status.js';

const router = Router();

router.use(requireAuth, requireFullSession);

function serializeRecord(record) {
  const user = record.user;
  const event = record.event;
  return {
    id: record._id.toString(),
    status: displayAttendanceStatus(record),
    late: isLateArrival(record),
    attendanceStatus: record.status === 'late' ? 'present' : record.status,
    notes: record.notes || '',
    user: user && typeof user === 'object'
      ? { id: user._id.toString(), name: user.name, voicePart: user.voicePart }
      : { id: String(user) },
    event: event && typeof event === 'object'
      ? {
          id: event._id.toString(),
          title: event.title,
          date: event.date,
          type: event.type,
          liturgicalColor: event.liturgicalColor || '',
        }
      : { id: String(event) },
  };
}

function summaryFromRecords(records) {
  return summaryFromStatusRows(records);
}

function summaryFromHistory(history) {
  return summaryFromStatusRows(history);
}

function parseStatusFilter(value) {
  if (typeof value !== 'string' || !MEMBER_STATUS_FILTERS.includes(value)) {
    return '';
  }
  return value;
}

function resolveAttendanceStatus(event, record) {
  const upcoming = new Date(event.date) > new Date();
  if (!record) {
    return upcoming ? 'upcoming' : 'absent';
  }
  return displayAttendanceStatus(record);
}

function buildAttendanceUpsertOp({ userId, eventId, status, late, notes, markedBy }) {
  const normalized = normalizeAttendanceInput({
    status: status || 'absent',
    late,
  });
  if (!normalized) {
    return null;
  }

  return {
    updateOne: {
      filter: { user: userId, event: eventId },
      update: {
        $set: {
          status: normalized.status,
          late: normalized.late,
          notes: typeof notes === 'string' ? notes.trim().slice(0, 500) : '',
          markedBy,
        },
      },
      upsert: true,
    },
  };
}

function serializeHistoryEvent(event) {
  return {
    id: event._id.toString(),
    title: event.title,
    date: event.date,
    type: event.type,
    notes: event.notes,
    liturgicalColor: event.liturgicalColor || '',
  };
}

router.get('/me', asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.approvalStatus !== 'approved') {
    return res.json({
      user: req.user.toSafeJSON(),
      pending: true,
      summary: { present: 0, absent: 0, late: 0, excused: 0, total: 0, rate: 0 },
      history: [],
    });
  }
  const { filter: eventFilter, error } = buildEventFilter(req.query);
  if (error) {
    return res.status(400).json({ error });
  }

  const statusFilter = parseStatusFilter(req.query.status);
  const { page, pageSize, skip } = parsePagination(req.query);

  const [totalUnfiltered, events, records] = await Promise.all([
    Event.countDocuments({}),
    Event.find(eventFilter).sort({ date: -1 }).lean(),
    Attendance.find({ user: req.user._id })
      .populate({
        path: 'event',
        match: eventFilter,
      })
      .lean(),
  ]);

  const filteredRecords = records.filter((record) => record.event);
  const byEvent = new Map(
    filteredRecords.map((record) => [record.event._id.toString(), record])
  );

  let history = events.map((event) => {
    const record = byEvent.get(event._id.toString());
    return {
      event: serializeHistoryEvent(event),
      status: resolveAttendanceStatus(event, record),
      late: record ? isLateArrival(record) : false,
      notes: record?.notes || '',
    };
  });

  if (statusFilter) {
    history = history.filter((item) => item.status === statusFilter);
  }

  const total = history.length;
  const paginatedHistory = history.slice(skip, skip + pageSize);
  const summary = statusFilter
    ? summaryFromHistory(history)
    : summaryFromRecords(filteredRecords);

  res.json({
    user: req.user.toSafeJSON(),
    summary,
    history: paginatedHistory,
    pagination: buildPaginationMeta({ page, pageSize, total }),
    meta: { totalUnfiltered },
  });
}));

router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.eventId) {
    if (!mongoose.isValidObjectId(req.query.eventId)) {
      return res.status(400).json({ error: 'Invalid event' });
    }
    filter.event = req.query.eventId;
  }
  if (req.query.userId) {
    if (!mongoose.isValidObjectId(req.query.userId)) {
      return res.status(400).json({ error: 'Invalid member' });
    }
    filter.user = req.query.userId;
  }

  const records = await Attendance.find(filter)
    .populate('user', 'name email voicePart')
    .populate('event')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ records: records.map(serializeRecord) });
}));

router.get('/event/:eventId', requireAdmin, asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  if (!mongoose.isValidObjectId(eventId)) {
    return res.status(400).json({ error: 'Invalid event' });
  }

  const event = await Event.findById(eventId).lean();
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const members = await User.find(approvedMemberFilter)
    .select('name email voicePart')
    .sort({ name: 1 })
    .lean();
  const records = await Attendance.find({ event: eventId }).lean();
  const byUser = new Map(
    records.map((record) => [record.user.toString(), serializeRosterAttendance(record)])
  );

  res.json({
    event: {
      id: event._id.toString(),
      title: event.title,
      date: event.date,
      type: event.type,
      notes: event.notes,
      liturgicalColor: event.liturgicalColor || '',
    },
    roster: members.map((member) => {
      const record = byUser.get(member._id.toString());
      return {
        id: member._id.toString(),
        name: member.name,
        email: member.email,
        voicePart: member.voicePart,
        status: record?.status ?? '',
        late: record?.late ?? false,
        notes: record?.notes ?? '',
      };
    }),
  });
}));

router.put('/event/:eventId', requireAdmin, asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const { records } = req.body;

  if (!mongoose.isValidObjectId(eventId)) {
    return res.status(400).json({ error: 'Invalid event' });
  }
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Attendance records are required' });
  }

  const event = await Event.findById(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const ops = [];
  const submittedUserIds = new Set();

  for (const row of records) {
    if (!mongoose.isValidObjectId(row.userId)) {
      return res.status(400).json({ error: 'Each row needs a member and a valid status' });
    }
    const op = buildAttendanceUpsertOp({
      userId: row.userId,
      eventId,
      status: row.status,
      late: row.late,
      notes: row.notes,
      markedBy: req.user._id,
    });
    if (!op) {
      return res.status(400).json({ error: 'Each row needs a member and a valid status' });
    }
    submittedUserIds.add(String(row.userId));
    ops.push(op);
  }

  const members = await User.find(approvedMemberFilter).select('_id').lean();
  for (const member of members) {
    const memberId = String(member._id);
    if (submittedUserIds.has(memberId)) {
      continue;
    }
    ops.push(
      buildAttendanceUpsertOp({
        userId: memberId,
        eventId,
        status: 'absent',
        late: false,
        notes: '',
        markedBy: req.user._id,
      })
    );
  }

  if (ops.length) {
    const allowed = await User.countDocuments({
      ...approvedMemberFilter,
      _id: { $in: records.map((row) => row.userId) },
    });
    if (records.length && allowed !== records.length) {
      return res.status(400).json({ error: 'Attendance can only be marked for approved members' });
    }
    await Attendance.bulkWrite(ops);
  }

  audit('attendance.saved', req, {
    eventId,
    recordCount: ops.length,
    eventTitle: event.title,
  });
  res.json({ ok: true, saved: ops.length });
}));

export default router;
