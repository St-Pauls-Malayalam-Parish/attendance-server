import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDb } from './db.js';
import { User } from './models/User.js';
import { normalizeUsername } from './utils/user-fields.js';

dotenv.config();

async function seed() {
  await connectDb();

  const existingAdmin = await User.findOne({ role: 'admin' });
  if (existingAdmin) {
    console.log(`Admin already exists (${existingAdmin.username}) — nothing to seed.`);
    process.exit(0);
  }

  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || 'admin');
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@stpauls.parish').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'choiradmin';

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await User.create({
    name: "St Paul's Choir Admin",
    username: adminUsername,
    email: adminEmail,
    passwordHash,
    role: 'admin',
    voicePart: 'tenor',
    active: true,
    approvalStatus: 'approved',
    mustChangePassword: true,
  });

  console.log('Admin account created.');
  console.log(`Sign in: ${adminUsername} / ${adminPassword}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('Tip: set ADMIN_PASSWORD in .env and change the password after first login.');
  }
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
