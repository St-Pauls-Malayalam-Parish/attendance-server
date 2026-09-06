import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import {
  emailFromUsername,
  normalizeUsername,
  usernameFromName,
  validateEmail,
  validateUsername,
} from '../src/utils/user-fields.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_PARTS = new Set(['soprano', 'alto', 'tenor', 'bass']);
const DEFAULT_DATA_FILE = path.join(__dirname, '../data/members.json');

function printUsage() {
  console.log(`Usage: npm run import-members -- [options] [file]

Options:
  --file <path>           JSON file of members (default: data/members.json)
  --default-password <pw> Default password for members without one
  --dry-run               Validate and print actions without writing
  --help                  Show this help

Environment:
  MEMBER_DEFAULT_PASSWORD   Used when a row has no password field

JSON format (array of objects):
  {
    "name": "Rigin Joseph",          // required
    "username": "rigin",             // optional (derived from name)
    "email": "rigin@stpauls.parish", // optional (derived from username)
    "voicePart": "tenor",            // optional (default: other)
    "password": "Choir@2026"         // optional (uses default password)
  }
`);
}

function parseArgs(argv) {
  const options = {
    file: DEFAULT_DATA_FILE,
    defaultPassword: process.env.MEMBER_DEFAULT_PASSWORD || 'Choir@2026',
    dryRun: false,
    help: false,
  };

  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--file') {
      options.file = path.resolve(argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--file=')) {
      options.file = path.resolve(arg.slice('--file='.length));
    } else if (arg === '--default-password') {
      options.defaultPassword = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--default-password=')) {
      options.defaultPassword = arg.slice('--default-password='.length);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (positional[0]) {
    options.file = path.resolve(positional[0]);
  }

  return options;
}

function loadMembers(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Members file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Members file must be a JSON array');
  }
  return parsed;
}

async function uniqueUsername(base, reserved = new Set()) {
  let username = base;
  let suffix = 2;
  while (reserved.has(username) || (await User.exists({ username }))) {
    username = `${base}${suffix}`;
    suffix += 1;
  }
  reserved.add(username);
  return username;
}

function resolveVoicePart(value) {
  const voicePart = typeof value === 'string' ? value.trim().toLowerCase() : 'tenor';
  return VOICE_PARTS.has(voicePart) ? voicePart : 'tenor';
}

function normalizeRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`Row ${index + 1}: must be an object`);
  }

  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (name.length < 2) {
    throw new Error(`Row ${index + 1}: name is required`);
  }

  const username = row.username
    ? normalizeUsername(row.username)
    : usernameFromName(name);
  const usernameError = validateUsername(username);
  if (usernameError) {
    throw new Error(`Row ${index + 1} (${name}): ${usernameError}`);
  }

  const email = (row.email || emailFromUsername(username)).trim().toLowerCase();
  const emailError = validateEmail(email);
  if (emailError) {
    throw new Error(`Row ${index + 1} (${name}): ${emailError}`);
  }

  const password = typeof row.password === 'string' && row.password ? row.password : null;
  const voicePart = resolveVoicePart(row.voicePart);

  return { name, username, email, password, voicePart };
}

async function importMembers(options) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  if (!options.defaultPassword || options.defaultPassword.length < 8) {
    throw new Error('Default password must be at least 8 characters');
  }

  const rows = loadMembers(options.file);
  if (rows.length === 0) {
    console.log('No members in file — nothing to do.');
    return;
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);

  const reservedUsernames = new Set();
  const summary = { created: 0, skipped: 0, errors: 0 };
  const passwordHash = options.dryRun
    ? null
    : await bcrypt.hash(options.defaultPassword, 12);

  console.log(`Importing ${rows.length} member(s) from ${options.file}`);
  if (options.dryRun) {
    console.log('Dry run — no database changes will be made.\n');
  }

  for (let index = 0; index < rows.length; index += 1) {
    const label = `Row ${index + 1}`;
    try {
      const member = normalizeRow(rows[index], index);
      const username = await uniqueUsername(member.username, reservedUsernames);
      const existing = await User.findOne({
        $or: [{ username }, { email: member.email }],
      });

      if (existing) {
        summary.skipped += 1;
        console.log(`skip  ${member.name} — already exists as ${existing.username}`);
        continue;
      }

      const rowPassword = member.password || options.defaultPassword;
      if (rowPassword.length < 8) {
        throw new Error('password must be at least 8 characters');
      }

      if (options.dryRun) {
        summary.created += 1;
        console.log(
          `create ${member.name} → username=${username}, email=${member.email}, voice=${member.voicePart}`
        );
        continue;
      }

      const rowPasswordHash = member.password
        ? await bcrypt.hash(member.password, 12)
        : passwordHash;

      await User.create({
        name: member.name,
        username,
        email: member.email,
        passwordHash: rowPasswordHash,
        role: 'member',
        voicePart: member.voicePart,
        active: true,
        approvalStatus: 'approved',
        mustChangePassword: !member.password,
      });

      summary.created += 1;
      console.log(`added ${member.name} (${username})`);
    } catch (err) {
      summary.errors += 1;
      console.error(`error ${label}: ${err.message}`);
    }
  }

  console.log('\nSummary');
  console.log(`  created: ${summary.created}`);
  console.log(`  skipped: ${summary.skipped}`);
  console.log(`  errors:  ${summary.errors}`);

  if (!options.dryRun && summary.created > 0) {
    console.log(`\nDefault password for imported members: ${options.defaultPassword}`);
    console.log('Members must set a new password on first sign-in.');
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

importMembers(options)
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
