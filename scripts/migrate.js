import dotenv from 'dotenv';
import { connectDb, disconnectDb } from '../src/db.js';
import { Attendance } from '../src/models/Attendance.js';
import { Event } from '../src/models/Event.js';
import { User } from '../src/models/User.js';
import { normalizeUsername, usernameFromName } from '../src/utils/user-fields.js';

dotenv.config();

async function backfillApprovalStatus() {
  const result = await User.updateMany(
    { approvalStatus: { $exists: false } },
    { $set: { approvalStatus: 'approved' } }
  );
  console.log(`approvalStatus backfill: ${result.modifiedCount} user(s) updated`);
}

async function renameRehearsalEvents() {
  const result = await Event.updateMany({ type: 'rehearsal' }, { $set: { type: 'practice' } });
  console.log(`rehearsal → practice: ${result.modifiedCount} event(s) updated`);
}

async function backfillUsernames() {
  const users = await User.find({
    $or: [{ username: { $exists: false } }, { username: null }, { username: '' }],
  });

  let updated = 0;
  for (const user of users) {
    let base;
    if (user.role === 'admin') {
      base = normalizeUsername(process.env.ADMIN_USERNAME || 'admin');
    } else if (user.email?.includes('@')) {
      base = normalizeUsername(user.email.split('@')[0]);
    } else {
      base = usernameFromName(user.name);
    }

    let username = base;
    let suffix = 2;
    while (await User.findOne({ username, _id: { $ne: user._id } })) {
      username = `${base}${suffix}`;
      suffix += 1;
    }

    user.username = username;
    await user.save();
    updated += 1;
  }

  console.log(`username backfill: ${updated} user(s) updated`);
}

async function backfillMemberProfileFields() {
  const result = await User.updateMany(
    {
      $or: [
        { voiceRange: { $exists: false } },
        { choirPathway: { $exists: false } },
        { voiceRangeHistory: { $exists: false } },
        { feedbackHistory: { $exists: false } },
        { pathwayHistory: { $exists: false } },
      ],
    },
    {
      $set: {
        voiceRange: '',
        choirPathway: '',
        voiceRangeHistory: [],
        feedbackHistory: [],
        pathwayHistory: [],
      },
    }
  );
  console.log(`profile fields backfill: ${result.modifiedCount} user(s) updated`);
}

async function migrateLegacyVoiceParts() {
  const adminResult = await User.updateMany(
    { voicePart: 'other', role: 'admin' },
    { $set: { voicePart: 'tenor' } }
  );
  console.log(`admin voicePart other → tenor: ${adminResult.modifiedCount} user(s) updated`);

  const remaining = await User.countDocuments({ voicePart: 'other', role: 'member' });
  if (remaining > 0) {
    console.log(
      `${remaining} member(s) still have voicePart "other". Set each member's voice part in Admin → Members → Edit.`
    );
  }
}

async function migrateLegacyLateAttendance() {
  const result = await Attendance.updateMany(
    { status: 'late' },
    { $set: { status: 'present', late: true } }
  );
  console.log(`late status → present + late flag: ${result.modifiedCount} attendance record(s) updated`);

  const backfill = await Attendance.updateMany(
    { late: { $exists: false } },
    { $set: { late: false } }
  );
  console.log(`attendance late flag backfill: ${backfill.modifiedCount} record(s) updated`);
}

async function migrate() {
  await connectDb();
  await backfillApprovalStatus();
  await renameRehearsalEvents();
  await backfillUsernames();
  await backfillMemberProfileFields();
  await migrateLegacyVoiceParts();
  await migrateLegacyLateAttendance();
}

migrate()
  .then(async () => {
    await disconnectDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err.message || err);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
