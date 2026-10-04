# St Paul's Malayalam Parish — Choir API

Node.js / Express REST API with MongoDB for the parish choir attendance application.

| Resource | URL |
| --- | --- |
| **This repo** | [St-Pauls-Malayalam-Parish/attendance-server](https://github.com/St-Pauls-Malayalam-Parish/attendance-server) |
| **Frontend** | [attendance-application](https://github.com/St-Pauls-Malayalam-Parish/attendance-application) |
| **Live API** | Your Render service URL (e.g. `https://attendance-server.onrender.com`) |
| **Live app** | [GitHub Pages](https://st-pauls-malayalam-parish.github.io/attendance-application/) |
| **Author** | Rigin Oommen \<riginoommen@gmail.com\> |

## Documentation

| Document | What it covers |
| --- | --- |
| This README | Operations, environment, API reference, deploy |
| [docs/architecture.md](docs/architecture.md) | Boot, request pipeline, auth, data model, and deploy diagrams |
| [docs/end-to-end.md](docs/end-to-end.md) | Register, approve, attendance, export, profile, and FAQ as HTTP sequences |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to change the API and open a pull request |
| [LICENSE](LICENSE) | Apache License 2.0 |
| Swagger UI | `http://localhost:4000/api/docs` while the API is running |
| OpenAPI document | `GET /api/openapi.json` |

---

## Table of contents

1. [Overview](#overview)
2. [For choir admins](#for-choir-admins)
3. [Quick start (developers)](#quick-start-developers)
4. [Project structure](#project-structure)
5. [Environment variables](#environment-variables)
6. [npm scripts](#npm-scripts)
7. [Database](#database)
8. [Authentication and authorization](#authentication-and-authorization)
9. [API reference](#api-reference)
10. [Data models](#data-models)
11. [Operational scripts](#operational-scripts)
12. [Logging and monitoring](#logging-and-monitoring)
13. [Graceful shutdown](#graceful-shutdown)
14. [Deployment (Render + Atlas)](#deployment-render--atlas)
15. [Security](#security)
16. [Troubleshooting](#troubleshooting)
17. [Testing](#testing)
18. [Development guide](#development-guide)

---

## Overview

The API powers:

- **Member sign-in** and self-registration (with admin approval)
- **Event management** (practices, services, concerts)
- **Attendance tracking** per event and per member, including PDF and Excel export
- **Roster, account admin, and singer feedback** for choir admins
- **FAQs** for singers and admins

```
┌─────────────────────┐     HTTPS      ┌─────────────────────┐
│  React client       │ ─────────────► │  Express API        │
│  (GitHub Pages)     │   Bearer JWT   │  (Render)           │
└─────────────────────┘                └──────────┬──────────┘
                                                  │
                                                  ▼
                                       ┌─────────────────────┐
                                       │  MongoDB Atlas      │
                                       │  (database: choir)  │
                                       └─────────────────────┘
```

**Stack:** Node.js 22+ (24 recommended), Express 4, Mongoose 8, bcrypt, JWT, Pino logging, Vitest (tests).

**Requirements:** Node.js **22.12+** (or **24** — used in GitHub Actions), Podman or Docker (local MongoDB only). Tests run without a database.

---

## For choir admins

This section is for parish choir admins operating the live system — no coding required.

### Roles

| Role | Who | Can do |
| --- | --- | --- |
| **Admin** | Choir secretary / lead | Everything: events, attendance, members, approvals |
| **Member** | Singer | View own attendance after account is approved |

Sign in with **username** (not email).

### First-time production setup

1. A developer deploys the API to Render and the app to GitHub Pages (see [Deployment](#deployment-render--atlas)).
2. Run the seed script once to create the admin account (developer task).
3. Admin signs in and is **forced to set a new password** on first login.
4. Import the choir roster or approve self-registrations.

### Adding members (three ways)

| Method | When to use |
| --- | --- |
| **Self-registration** | Singer registers on the app → appears under *Waiting for approval* → admin approves |
| **Add member** (admin UI) | Create an approved account with a temporary password |
| **Bulk import** | One-time roster load from `data/members.json` (developer/script) |

### After bulk import

- Default password: `Choir@2026` (unless changed via `MEMBER_DEFAULT_PASSWORD`)
- Each member **must set a personal password** on first sign-in
- Share usernames only — never post the shared password in public channels

### Day-to-day admin tasks

| Task | Where in the app |
| --- | --- |
| Approve / decline sign-ups | Admin → Members → **Manage** → Approvals |
| Add a singer manually | Admin → Members → **Manage** → **Add member** |
| Edit an account, reset a password, deactivate, or delete | Admin → Members → **Manage** → Members → **Manage** on the row |
| Record voice range, pathway, or notes | Admin → Members → **Roster** → **Feedback**, or open the name |
| Give admin access, and choose if they still sing | Admin → Members → **Manage** → edit role |
| Create practice or service | Admin → Events → **Add event** |
| Mark attendance | Admin → Attendance → pick event → save roster |
| Review attendance rates and export | Admin → Members → **Roster** (filters, then **Export**) |

### Attendance rate formula

```
rate = round((present + late) / (present + absent + late) × 100)
```

Excused absences are tracked but **not** included in the percentage denominator.

### Deactivating vs deleting

| Action | Effect |
| --- | --- |
| **Deactivate** | Cannot sign in; hidden from attendance lists; history kept |
| **Delete permanently** | Removes user and **all** their attendance records (irreversible) |

### Password resets

- **Admin resets member password** in Edit member → member must change it on next login
- **Member changes own password** → Account → Change password

---

## Quick start (developers)

```bash
git clone https://github.com/St-Pauls-Malayalam-Parish/attendance-server.git
cd attendance-server
npm install
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET to a random string (16+ chars)

npm run mongo:up      # start MongoDB on port 27018
npm run seed          # create admin (first time only)
npm run dev           # API with auto-reload → http://localhost:4000
```

Pair with the [frontend](https://github.com/St-Pauls-Malayalam-Parish/attendance-application):

```bash
cd ../attendance-application   # or clone separately
npm install
npm run dev                    # http://localhost:5173 (proxies /api to :4000)
```

**Local sign-in:** `admin` / `choiradmin` (or your `ADMIN_PASSWORD`) → forced password change on first login.

**Health check:**

```bash
curl http://localhost:4000/api/health
```

**Run tests** (no MongoDB required):

```bash
npm test
```

---

## Project structure

```
server/
├── .github/
│   └── workflows/
│       └── test.yml          # GitHub Actions — run tests on push/PR
├── src/
│   ├── index.js              # Bootstrap: env, DB, listen, graceful shutdown
│   ├── app.js                # Express app factory (createApp) — used in tests
│   ├── db.js                 # MongoDB connect/disconnect
│   ├── logger.js             # Pino logger + audit helper
│   ├── graceful-shutdown.js  # SIGTERM/SIGINT handling
│   ├── seed.js               # Create initial admin
│   ├── config/
│   │   └── env.js            # Startup env validation
│   ├── middleware/
│   │   ├── auth.js           # JWT, cookies, session scopes
│   │   └── request-logger.js # HTTP request logging
│   ├── models/
│   │   ├── User.js
│   │   ├── Event.js
│   │   ├── Attendance.js
│   │   └── Faq.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── events.js
│   │   ├── attendance.js
│   │   ├── members.js
│   │   ├── faqs.js
│   │   └── health.js
│   ├── openapi/
│   │   ├── openapi.json      # OpenAPI 3 document
│   │   └── docs.js           # Swagger UI and /api/openapi.json
│   └── utils/                # Validation, pagination, stats, exports, profiles
├── tests/
│   ├── setup.js              # Global test env + mongoose/model mocks
│   ├── helpers/              # Fixtures, model mocks, mongoose mock
│   ├── unit/                 # Utils, middleware, infrastructure
│   ├── routes/               # API route integration tests (supertest)
│   └── workflows/            # End-to-end flows (e.g. must-change-password)
├── scripts/
│   ├── import-members.js     # Bulk roster import
│   └── migrate.js            # One-off data migrations
├── data/
│   ├── members.sample.json   # Import template
│   └── members.json          # Your roster (not committed if private)
├── docs/
│   ├── architecture.md       # Diagrams
│   └── end-to-end.md         # Cross-route journeys
├── docker-compose.yml        # Local MongoDB
├── vitest.config.js          # Test runner + coverage thresholds
├── CONTRIBUTING.md
├── LICENSE                   # Apache License 2.0
├── NOTICE
├── .env.example
└── package.json
```

---

## Environment variables

Copy `.env.example` to `.env`. The server **refuses to start** if required variables are missing or unsafe (production is stricter).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | Yes | — | MongoDB connection string |
| `JWT_SECRET` | Yes | — | Signs access/refresh tokens (≥16 chars dev, ≥32 prod) |
| `CLIENT_ORIGIN` | Prod only | `http://localhost:5173` | Frontend URL for CORS and cookies |
| `PORT` | No | `4000` | HTTP port (Render sets this automatically) |
| `NODE_ENV` | No | `development` | `production` enables stricter checks, secure cookies |
| `LOG_LEVEL` | No | `debug` / `info` | Pino log level |
| `SHUTDOWN_TIMEOUT_MS` | No | `10000` | Graceful shutdown timeout (ms) |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_MS` | No | `604800000` | Refresh token lifetime (7 days) |
| `ADMIN_USERNAME` | No | `admin` | Seed script admin username |
| `ADMIN_EMAIL` | No | `admin@stpauls.parish` | Seed script admin email |
| `ADMIN_PASSWORD` | No | `choiradmin` | Seed script admin password |
| `MEMBER_DEFAULT_PASSWORD` | No | `Choir@2026` | Import script default password |

**Generate a production JWT secret:**

```bash
openssl rand -hex 32
```

**Weak JWT placeholders blocked:** `change-this-to-a-long-random-string`, `secret`, `jwt_secret`, `your-secret-here`.

---

## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start API with `node --watch` (auto-reload on file changes) |
| `npm run start` | Start API (production) |
| `npm run seed` | Create admin account if none exists (idempotent) |
| `npm run import-members` | Bulk import from `data/members.json` |
| `npm run migrate` | Run one-off data migrations (after upgrades) |
| `npm run mongo:up` | Start MongoDB container (`podman compose up -d`) |
| `npm run mongo:down` | Stop MongoDB container |
| `npm run mongo:logs` | Tail MongoDB logs |
| `npm test` | Run Vitest with coverage report and thresholds |
| `npm run test:fast` | Run tests only (no coverage — faster locally) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Same as `npm test` |

---

## Database

### Local (development)

MongoDB runs in Podman/Docker on **host port 27018** (avoids conflict with a system `mongod` on 27017).

```bash
npm run mongo:up
```

Default URI: `mongodb://127.0.0.1:27018/choir`

### Production (MongoDB Atlas)

1. Create a free **M0** cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. **Database Access** → create user with read/write on `choir`.
3. **Network Access** → allow `0.0.0.0/0` (or Render egress IPs).
4. **Connect** → Drivers → copy URI, ensure database name is `choir`:

```
mongodb+srv://user:pass@cluster.mongodb.net/choir
```

### Collections

| Collection | Mongoose model | Purpose |
| --- | --- | --- |
| `users` | `User` | Admins and members, including profile history |
| `events` | `Event` | Practices, services, concerts |
| `attendances` | `Attendance` | Per-user per-event status |
| `faqs` | `Faq` | Help articles for singers, admins, or both |

---

## Authentication and authorization

### Password storage

- bcrypt with cost factor **12**
- Plain passwords never stored or logged

### Tokens

| Token | Lifetime | Storage |
| --- | --- | --- |
| **Access** | 15 minutes | httpOnly cookie `token` or `Authorization: Bearer` header |
| **Refresh** | 7 days | httpOnly cookie `refreshToken` or request body; SHA-256 hash in DB |

Refresh tokens **rotate** on every `/api/auth/refresh` call.

### Cookie vs Bearer mode

| Mode | When | How |
| --- | --- | --- |
| **Cookies** | Local dev (Vite proxy, same origin) | httpOnly cookies — tokens never in JavaScript |
| **Bearer** | Production (GitHub Pages → Render) | Client sends `X-Auth-Client: bearer`; API returns `token` + `refreshToken` in JSON |

Production cookies use `SameSite=None; Secure` for cross-origin requests.

### Session scopes

The access JWT includes a `scope` derived from the user's current state:

| Scope | When | API access |
| --- | --- | --- |
| `must-change-password` | `mustChangePassword: true` | Auth endpoints only (change password, me, logout, refresh) |
| `pending` | Member not yet approved | Auth endpoints only |
| `full` | Approved member or admin | All permitted routes |

`GET /api/auth/me` **re-issues** the session when scope changes (e.g. after admin approval or password change).

### Who can access what

| Routes | Pending | Must change password | Member | Admin |
| --- | :---: | :---: | :---: | :---: |
| `POST /api/auth/register`, `login` | — | — | — | — |
| `GET /api/auth/me`, `change-password`, `logout`, `refresh` | ✓ | ✓ | ✓ | ✓ |
| `GET /api/events/*` | ✗ | ✗ | ✓ | ✓ |
| `POST/PATCH/DELETE /api/events` | ✗ | ✗ | ✗ | ✓ |
| `GET /api/attendance/me` and `/me/export` | ✗ | ✗ | ✓ | ✓ |
| `GET/PUT /api/attendance/*` (admin) | ✗ | ✗ | ✗ | ✓ |
| `/api/members/*` | ✗ | ✓* | ✗ | ✓ |
| `GET /api/auth/my-profile` | ✗ | ✗ | ✓ | ✗ |
| `GET /api/faqs` | ✗ | ✗ | ✓ | ✓ |
| `POST/PATCH/DELETE /api/faqs` | ✗ | ✗ | ✗ | ✓ |

\* Admins with `mustChangePassword` can still manage members (member routes skip `requireFullSession`) but cannot take attendance until password is changed.

### Rate limiting

Auth endpoints (`register`, `login`, `refresh`, `change-password`): **30 requests per 15 minutes** per IP.

### First-login password change

| Account source | `mustChangePassword` |
| --- | --- |
| `npm run seed` (admin) | `true` |
| `npm run import-members` (shared default password) | `true` |
| Import with per-row `password` in JSON | `false` |
| Admin creates member via API/UI | `false` (unless admin sets new password later) |
| Self-registration | `false` (user chose their own password) |

### Password-change workflow (API behaviour)

Typical first-login path after seed or bulk import:

1. **Login** → access token scope `must-change-password`; `user.mustChangePassword: true` in response.
2. **Restricted access** → only auth routes work (`/me`, `/change-password`, `/refresh`, `/logout`). Events and attendance return **403** until password is changed.
3. **Admin exception** → `/api/members/*` remains available to admins with `mustChangePassword` (member routes do not use `requireFullSession`), so roster can be managed before the admin changes their own password.
4. **Change password** → `POST /api/auth/change-password` clears the flag and issues a new session with scope `full`.
5. **Stale token** → `GET /api/auth/me` re-issues the session when JWT scope lags behind the user record (e.g. after approval or password change).

---

## API reference

Base URL: `/api`  
All JSON request/response bodies unless noted.  
Errors: `{ "error": "message" }` with appropriate HTTP status.

The same contract is published as OpenAPI 3 and rendered with Swagger UI:

| | URL |
| --- | --- |
| Swagger UI | `http://localhost:4000/api/docs` |
| OpenAPI JSON | `http://localhost:4000/api/openapi.json` |

Both are public (no sign-in). To try a protected route from Swagger, call **Auth / Sign in** with the header `X-Auth-Client: bearer`, copy `token` from the response, and paste it into **Authorize**. Leave that header off when you want the httpOnly cookie session instead. The source file is `src/openapi/openapi.json`.

### Health

#### `GET /api/health`

No authentication.

**200** (database connected) or **503** (database unreachable):

```json
{
  "ok": true,
  "uptimeSeconds": 123,
  "database": { "connected": true, "name": "choir" },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

---

### Auth

Send `X-Auth-Client: bearer` to receive tokens in JSON responses.

#### `POST /api/auth/register`

Create a pending member account.

**Body:**

```json
{
  "name": "Evan Thomas",
  "username": "evan.thomas",
  "email": "evan@stpauls.parish",
  "password": "my-password",
  "voicePart": "tenor"
}
```

| Field | Rules |
| --- | --- |
| `name` | ≥2 characters |
| `username` | 3–32 chars, `a-z`, `0-9`, `.`, `_`, `-` |
| `email` | Valid email |
| `password` | ≥8 characters |
| `voicePart` | Optional: `soprano`, `alto`, `tenor`, `bass`, `other` (default `other`) |

**201:** `{ "user": { ... } }` (+ optional `token`, `refreshToken`)

#### `POST /api/auth/login`

**Body:** `{ "username": "evan.thomas", "password": "..." }`

**200:** `{ "user": { ... } }` (+ optional tokens)  
**401:** Invalid credentials  
**403:** Account rejected

#### `POST /api/auth/refresh`

**Cookie:** `refreshToken` — or **body:** `{ "refreshToken": "..." }`

**200:** New session (+ optional tokens)

#### `POST /api/auth/logout`

Revokes refresh token and clears cookies. **200:** `{ "ok": true }`

#### `GET /api/auth/me`

**Auth required.** Returns current user; upgrades session if approval/password state changed.

**200:** `{ "user": { ... } }`

#### `POST /api/auth/change-password`

**Auth required.**

**Body:** `{ "currentPassword": "...", "newPassword": "..." }` — new password ≥8 chars, must differ from current.

**200:** `{ "ok": true, "user": { ... } }` (+ optional tokens)

---

### User object (`user` / `member`)

```json
{
  "id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "name": "Evan Thomas",
  "username": "evan.thomas",
  "email": "evan@stpauls.parish",
  "role": "member",
  "onRoster": true,
  "voicePart": "tenor",
  "active": true,
  "approvalStatus": "approved",
  "mustChangePassword": false
}
```

`role`: `member` | `admin`  
`onRoster`: always `true` for a member. For an admin, `true` means they still sing and appear in take-attendance.  
`approvalStatus`: `pending` | `approved` | `rejected`

---

### Events

**Read:** full session + approved. **Write:** admin only.

#### `GET /api/events/years`

Distinct event years, descending. **200:** `{ "years": [2026, 2025] }`

#### `GET /api/events`

Paginated list.

| Query param | Description |
| --- | --- |
| `search` | Title/notes text search |
| `type` | `practice`, `service`, `concert`, `other` |
| `liturgicalColor` | `white`, `green`, `purple`, `red`, `black`, or `__none__` |
| `year` | Calendar year |
| `from`, `to` | Date range (`YYYY-MM-DD`) |
| `page`, `limit` | Pagination (default page 1, limit 10; max 100) |

**200:**

```json
{
  "events": [
    {
      "id": "...",
      "title": "Friday practice",
      "date": "2026-01-10T18:30:00.000Z",
      "type": "practice",
      "notes": "",
      "liturgicalColor": "green"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 25,
    "totalPages": 3,
    "rangeStart": 1,
    "rangeEnd": 10,
    "hasPrevious": false,
    "hasNext": true
  },
  "meta": { "totalUnfiltered": 25 }
}
```

#### `POST /api/events`

**Admin.** **Body:**

```json
{
  "title": "Friday practice",
  "date": "2026-01-10T18:30:00.000Z",
  "type": "practice",
  "notes": "Bring folders",
  "liturgicalColor": "green"
}
```

`type`: `practice` | `service` | `concert` | `other`  
`liturgicalColor`: `white` | `green` | `purple` | `red` | `black` | `""`

**201:** `{ "event": { ... } }`

#### `PATCH /api/events/:id`

**Admin.** Same body as create. **200:** `{ "event": { ... } }`

#### `DELETE /api/events/:id`

**Admin.** Deletes event and all attendance records. **200:** `{ "ok": true }`

---

### Attendance

#### `GET /api/attendance/me`

**Member.** Own attendance history with summary.

Supports event filters (`search`, `type`, `liturgicalColor`, `year`, `from`, `to`), `status` filter (`present`, `absent`, `late`, `excused`, `upcoming`, `unmarked`), and `page`/`limit`.

**200:**

```json
{
  "user": { ... },
  "summary": {
    "present": 12,
    "absent": 2,
    "late": 1,
    "excused": 0,
    "total": 15,
    "rate": 87
  },
  "history": [
    {
      "event": { "id", "title", "date", "type", "liturgicalColor" },
      "status": "present",
      "notes": ""
    }
  ],
  "pagination": { ... },
  "meta": { "totalUnfiltered": 20 }
}
```

#### `GET /api/attendance`

**Admin.** Optional `eventId`, `userId` query filters.

**200:** `{ "records": [ { "id", "status", "notes", "user": { ... }, "event": { ... } } ] }`

#### `GET /api/attendance/event/:eventId`

**Admin.** Roster for one event.

**200:**

```json
{
  "event": { "id", "title", "date", "type", "notes", "liturgicalColor" },
  "roster": [
    {
      "id": "userId",
      "name": "Evan Thomas",
      "email": "evan@stpauls.parish",
      "voicePart": "tenor",
      "status": "present",
      "notes": ""
    }
  ]
}
```

Unmarked members have `status: ""`.

#### `PUT /api/attendance/event/:eventId`

**Admin.** Bulk save attendance.

**Body:**

```json
{
  "records": [
    { "userId": "...", "status": "present", "notes": "" },
    { "userId": "...", "status": "late", "notes": "Traffic" }
  ]
}
```

`status`: `present` | `absent` | `late` | `excused`  
`notes`: max 500 characters

**200:** `{ "ok": true, "saved": 41 }`

#### `GET /api/attendance/me/export`

**Member.** Same filters as `GET /api/attendance/me`, including `eventId` (which ignores `from` and `to`).

| Query | Values |
| --- | --- |
| `format` | `pdf` or `xlsx` (required) |
| `fields` | Optional column ids: `date`, `event`, `type`, `color`, `status`, `notes` |

**200:** file download, `Content-Disposition: attachment`. Filename `st-pauls-my-attendance-YYYY-MM-DD.pdf` or `.xlsx`.

---

### Members (admin only)

All routes require `role: admin`.

#### `GET /api/members`

Lists non-roster members.

**200:**

```json
{
  "pending": [ { ...member } ],
  "inactive": [ { ...member } ],
  "declined": [ { ...member } ],
  "admins": [ { ...account, "onRoster": true } ]
}
```

`admins` includes every admin account. `onRoster` is true when that admin still sings.

#### `GET /api/members/roster`

Approved active members with attendance statistics.

| Query param | Description |
| --- | --- |
| `search` | Name, username, or email |
| `voicePart` | Filter by voice |
| `from`, `to` | Date range for stats (`YYYY-MM-DD`). Ignored when `eventId` is set |
| `eventId` | Stats and status for one event |
| `attendanceStatus` | Keep singers with that mark |
| `page`, `limit` | Pagination |

**200:**

```json
{
  "members": [
    {
      "id": "...",
      "name": "Evan Thomas",
      "username": "evan.thomas",
      "email": "evan@stpauls.parish",
      "voicePart": "tenor",
      "active": true,
      "approvalStatus": "approved",
      "createdAt": "...",
      "summary": { "present": 10, "absent": 1, "late": 2, "excused": 0, "total": 13, "rate": 92 }
    }
  ],
  "pagination": { ... },
  "meta": { "totalUnfiltered": 41, "dateFiltered": false, "from": "", "to": "" }
}
```

#### `GET /api/members/roster/export`

**Admin.** Same filters as the roster, without pagination. Returns every matching row.

| Query | Values |
| --- | --- |
| `format` | `pdf` or `xlsx` (required) |
| `fields` | Optional column ids: `name`, `username`, `email`, `voice`, `range`, `pathway`, `role`, plus `rate` and `detail` or `status` |

**200:** file download. Filename `st-pauls-choir-roster-YYYY-MM-DD.pdf` or `.xlsx`.

#### `POST /api/members`

Create an approved member.

**Body:** `{ "name", "username", "email", "password", "voicePart?", "role?", "onRoster?" }`

`role` defaults to `member`. An admin may be created with `onRoster: false` so they do not sing.

**201:** `{ "member": { ... } }`

#### `PATCH /api/members/:id`

Update an account. Fields: `name`, `username`, `email`, `voicePart`, `password`, `role` (`member` or `admin`), `onRoster`.

Optional `password` resets the password and sets `mustChangePassword: true`. Demoting the last admin returns 400. Promoting someone to admin approves and reactivates the account. Omitting `onRoster` keeps the current value.

**200:** `{ "member": { ... } }`

#### `GET /api/members/:id/profile`

**Admin.** Voice range, choir pathway, and feedback history for one choir participant.

**200:** `{ "member": { "id", "name", "username", "voicePart" }, "profile": { ... } }`

#### `PATCH /api/members/:id/profile`

**Admin.** Send any of `voiceRange` (max 200), `feedback` (max 2000), `choirPathway`.

`choirPathway`: `lead-vocalists`, `emerging-vocalists`, `vocal-strengthening`, `vocal-development`, `explore-other-service`.

Each value is appended to that history with the admin's name and the time.

**200:** same shape as GET.

#### `PATCH /api/members/:id/approval`

**Body:** `{ "approvalStatus": "approved" | "rejected" | "pending" }`

#### `PATCH /api/members/:id/active`

**Body:** `{ "active": true | false }`

#### `DELETE /api/members/:id`

Permanently deletes member and all attendance. **200:** `{ "ok": true }`

---

### Singer profile

#### `GET /api/auth/my-profile`

**Approved member** with a full session. Admins receive 403; they use `/api/members/:id/profile`.

**200:** `{ "profile": { "voiceRange", "choirPathway", "voiceRangeHistory", "feedbackHistory", "pathwayHistory" } }`

---

### FAQs

**Read:** full session and approved. **Write:** admin.

Audience is `member`, `admin`, or `both`. A singer sees published `member` and `both`. An admin reading normally sees published `admin` and `both`.

#### `GET /api/faqs`

| Query | Who | Effect |
| --- | --- | --- |
| _(none)_ | Singer or admin | Published FAQs for that role |
| `manage=true` | Admin | Every FAQ, including drafts |
| `audience` | Admin | Narrow the published list |

**200:** `{ "faqs": [ { "id", "question", "answer", "audience", "sortOrder", "published", "createdAt", "updatedAt" } ] }`

#### `POST /api/faqs`

**Admin.** **Body:** `{ "question", "answer", "audience", "sortOrder?", "published?" }`

Question max 300 characters. Answer max 5000. Answers are plain text.

**201:** `{ "faq": { ... } }`

#### `PATCH /api/faqs/:id`

**Admin.** Same fields as create. **200:** `{ "faq": { ... } }`

#### `DELETE /api/faqs/:id`

**Admin.** **200:** `{ "ok": true }`

---

## Data models

### User

| Field | Type | Notes |
| --- | --- | --- |
| `name` | String | Required |
| `username` | String | Unique, lowercase |
| `email` | String | Unique, lowercase |
| `passwordHash` | String | bcrypt; never exposed |
| `role` | String | `member` (default) or `admin` |
| `onRoster` | Boolean | Members are always on the singing roster. Admins only when this is true |
| `voicePart` | String | `soprano`, `alto`, `tenor`, `bass`, `other` |
| `voiceRange` | String | Max 200. Current value; history is `voiceRangeHistory` |
| `choirPathway` | String | One of the five pathway ids, or empty. History is `pathwayHistory` |
| `feedbackHistory` | Array | Append-only notes, max 2000 characters each |
| `active` | Boolean | Default `true` |
| `approvalStatus` | String | `pending`, `approved`, `rejected` |
| `mustChangePassword` | Boolean | Forces password change on login |
| `refreshTokenHash` | String | Internal; not selected by default |
| `refreshTokenExpiresAt` | Date | Internal |

### Event

| Field | Type | Notes |
| --- | --- | --- |
| `title` | String | Required |
| `date` | Date | Required |
| `type` | String | `practice`, `service`, `concert`, `other` |
| `notes` | String | Optional |
| `liturgicalColor` | String | `white`, `green`, `purple`, `red`, `black`, `""` |
| `createdBy` | ObjectId → User | Required |

Index: `{ date: -1 }`

### FAQ

| Field | Type | Notes |
| --- | --- | --- |
| `question` | String | Required, max 300 |
| `answer` | String | Required, max 5000, plain text |
| `audience` | String | `member`, `admin`, `both` |
| `sortOrder` | Number | Default 0 |
| `published` | Boolean | Default true |
| `createdBy` | ObjectId → User | Required |

### Attendance

| Field | Type | Notes |
| --- | --- | --- |
| `user` | ObjectId → User | Required |
| `event` | ObjectId → Event | Required |
| `status` | String | `present`, `absent`, `late`, `excused` |
| `notes` | String | Max 500 chars |
| `markedBy` | ObjectId → User | Admin who saved |

Unique index: `{ user: 1, event: 1 }` (one record per member per event)

---

## Operational scripts

### Seed (`npm run seed`)

Creates the **first admin** if none exists.

| Setting | Env var | Default |
| --- | --- | --- |
| Username | `ADMIN_USERNAME` | `admin` |
| Email | `ADMIN_EMAIL` | `admin@stpauls.parish` |
| Password | `ADMIN_PASSWORD` | `choiradmin` |

Sets `mustChangePassword: true`. **Idempotent** — safe to re-run; skips if admin already exists.

**Production (one time):**

```bash
MONGODB_URI="mongodb+srv://..." npm run seed
```

### Import members (`npm run import-members`)

Bulk create **approved** members from JSON.

```bash
cp data/members.sample.json data/members.json
# Edit data/members.json

npm run import-members -- --dry-run    # preview
npm run import-members                # write to database
```

**Options:**

| Flag | Description |
| --- | --- |
| `--file <path>` | JSON file (default: `data/members.json`) |
| `--default-password <pw>` | Shared password when row has no `password` |
| `--dry-run` | Validate without writing |
| `--help` | Usage |

**Row format:**

```json
{
  "name": "Evan Thomas",
  "username": "evan.thomas",
  "email": "evan@stpauls.parish",
  "voicePart": "tenor",
  "password": "optional-per-row-password"
}
```

| Field | Required | Default |
| --- | --- | --- |
| `name` | Yes | — |
| `username` | No | Derived from name (`evan.thomas`) |
| `email` | No | `username@stpauls.parish` |
| `voicePart` | No | `other` if missing/invalid (singers pick a part on first sign-in) |
| `password` | No | `MEMBER_DEFAULT_PASSWORD` or `Choir@2026` |

- Skips existing username/email (no duplicates)
- `mustChangePassword: true` when using shared default password
- Auto-suffixes username conflicts (`rigin2`, etc.)

### Migrate (`npm run migrate`)

One-off fixes after upgrades. Run once when upgrading an older database:

1. Backfill missing `approvalStatus` → `approved`
2. Rename event type `rehearsal` → `practice`
3. Backfill missing `username` from email or name

```bash
npm run migrate
```

---

## Logging and monitoring

Uses [Pino](https://getpino.io/) structured logging.

| Environment | Output |
| --- | --- |
| Development | Colorized (`pino-pretty`) |
| Production | JSON lines (Render log viewer) |

| What | Details |
| --- | --- |
| HTTP requests | Method, path, status, duration, `X-Request-Id` |
| Health checks | Excluded (noise reduction) |
| Audit events | `audit` field: login, logout, password change, member approval, attendance save, etc. |
| Errors | 500s log request ID, route, user — client sees generic message |

**Audit event examples:** `auth.login.success`, `auth.login.failed`, `auth.password.changed`, `member.approval.changed`, `event.created`, `attendance.saved`

**Never logged:** passwords, tokens, refresh tokens.

Set `LOG_LEVEL=debug` locally; `info` in production.

---

## Graceful shutdown

On `SIGTERM` or `SIGINT` (Render deploy, Ctrl+C):

1. `attachGracefulShutdown` stops accepting new connections and drains in-flight HTTP requests
2. MongoDB disconnects
3. The process exits, or is force-killed after `SHUTDOWN_TIMEOUT_MS` (default 10s)

`createApp({ getIsShuttingDown })` can answer in-flight arrivals with **503** `Server is shutting down`. The current `src/index.js` boot path does not pass that flag, so the drain and disconnect still run and the 503 response does not.

---

## Deployment (Render + Atlas)

### 1. MongoDB Atlas

See [Database → Production](#production-mongodb-atlas).

### 2. Render Web Service

1. [New Web Service](https://dashboard.render.com/) → connect [attendance-server](https://github.com/St-Pauls-Malayalam-Parish/attendance-server).
2. **Build command:** `npm install`
3. **Start command:** `npm start`
4. **Do not set `PORT`** — Render provides it.

**CI:** Pushes and pull requests to `main` / `master` run the test workflow (see [Testing](#testing)) before you merge. A failing test or coverage threshold blocks a green check on GitHub.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` (Render — or rely on `engines` in `package.json`) |
| `MONGODB_URI` | Atlas connection string |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `CLIENT_ORIGIN` | `https://st-pauls-malayalam-parish.github.io` |
| `LOG_LEVEL` | `info` |
| `ADMIN_USERNAME` | `admin` (for seed) |
| `ADMIN_PASSWORD` | Strong password (for seed) |

### 3. Seed production admin

```bash
MONGODB_URI="mongodb+srv://..." ADMIN_PASSWORD="your-strong-password" npm run seed
```

### 4. Import production roster (optional)

```bash
MONGODB_URI="mongodb+srv://..." npm run import-members
```

### 5. Frontend

In [attendance-application](https://github.com/St-Pauls-Malayalam-Parish/attendance-application):

- Set GitHub Actions variable `VITE_API_URL` to your Render URL
- Redeploy the client workflow

### 6. Smoke test

```bash
curl https://<your-service>.onrender.com/api/health
```

Expect `200` with `"database": { "connected": true }`.

Sign in from GitHub Pages with admin credentials → set new password.

---

## Security

| Control | Implementation |
| --- | --- |
| Password hashing | bcrypt (cost 12) |
| Session tokens | JWT access (15m) + rotating refresh (7d, hashed at rest) |
| httpOnly cookies | Local dev — tokens not in JavaScript |
| Rate limiting | 30 req / 15 min on auth endpoints |
| CORS | Single origin (`CLIENT_ORIGIN`), credentials enabled |
| Helmet | Security headers |
| Body size limit | 32 KB JSON |
| Env validation | Weak JWT secrets blocked; `CLIENT_ORIGIN` required in prod |
| Approval workflow | Pending users cannot access roster or attendance |
| Forced password change | Seed/import default passwords |
| Audit logging | Auth and admin actions |
| Error sanitization | Generic 500 messages to clients |
| Trust proxy | Enabled in production (correct IP for rate limits) |

### Recommendations for production

1. Change default `ADMIN_PASSWORD` before or immediately after seed
2. Use unique passwords per imported member (or enforce first-login change — already enabled for shared defaults)
3. Rotate `JWT_SECRET` only with a planned logout (invalidates all sessions)
4. Restrict Atlas network access to known IPs when possible
5. Review Render logs for repeated `auth.login.failed` audit events

---

## Troubleshooting

| Problem | Check |
| --- | --- |
| `Invalid environment` on start | `MONGODB_URI`, `JWT_SECRET` length, `CLIENT_ORIGIN` in production |
| `503` on `/api/health` | MongoDB not running (`npm run mongo:up`) or wrong Atlas URI |
| Login works locally, not on GitHub Pages | `VITE_API_URL` set? `CLIENT_ORIGIN` matches Pages URL? |
| CORS error in browser | `CLIENT_ORIGIN` must exactly match frontend URL (no trailing slash mismatch) |
| `Session expired` immediately | Clock skew rare; check refresh token; clear browser storage |
| Member sees "waiting for approval" | Admin → Members → Approve |
| Forced password screen every login | `mustChangePassword` still true — complete change-password flow |
| Import skips everyone | Username/email already exists — expected on re-run |
| Render cold start slow | Free tier spins down; first request may take ~30s |
| `npm run migrate` fails | Ensure `MONGODB_URI` is set; run against correct database |
| Tests fail locally but app works | Run `npm test` from `server/`; ensure `npm ci` matches lockfile |
| GitHub Actions test job fails | Open Actions → failed run → expand **Run tests with coverage** log |
| Coverage threshold failure | Add tests for uncovered branches or adjust `vitest.config.js` thresholds deliberately |

**Clear stale client tokens (production):** remove `choir_auth_token` and `choir_refresh_token` from browser localStorage.

**Local dev login:**

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
# Leave VITE_API_URL empty — Vite proxies /api to :4000
```

---

## Testing

Automated tests use **Vitest** and **Supertest**. They do **not** connect to MongoDB — Mongoose and all models are mocked in memory (`tests/setup.js`, `tests/helpers/`).

### Commands

| Command | What it does |
| --- | --- |
| `npm test` | Run all tests with coverage report and threshold checks |
| `npm run test:fast` | Run tests only (no coverage — faster for tight feedback) |
| `npm run test:watch` | Watch mode during development |
| `npm run test:coverage` | Same as `npm test` |

```bash
npm test
```

### Coverage

Coverage is collected from `src/**/*.js`, excluding bootstrap/scripts and schema files:

| Excluded | Reason |
| --- | --- |
| `src/index.js` | Server bootstrap only |
| `src/seed.js` | One-off script |
| `src/models/**` | Mongoose schemas; exercised via mocked route tests |

**Minimum thresholds** (configured in `vitest.config.js`):

| Metric | Threshold |
| --- | --- |
| Lines | 95% |
| Statements | 93% |
| Functions | 94% |
| Branches | 85% |

A terminal summary and per-file table are printed after each `npm test`. HTML output is written to `coverage/` (gitignored).

### Test layout

| Path | Purpose |
| --- | --- |
| `tests/setup.js` | Test env vars, rate-limit mock, global mongoose/model mocks |
| `tests/helpers/fixtures.js` | `buildUser`, `buildAdmin`, `authHeader`, session scope helpers |
| `tests/helpers/model-mocks.js` | Mocked `User`, `Event`, `Attendance` with chainable queries |
| `tests/helpers/mongoose-mock.js` | Mocked `mongoose.connect` / health checks |
| `tests/unit/` | Utils, `validateEnv`, auth middleware, logger, shutdown |
| `tests/routes/` | HTTP tests per route module via `createApp()` |
| `tests/workflows/` | Multi-step flows (e.g. must-change-password login → change → unlock) |

`src/app.js` exports `createApp()` so route tests mount the real Express stack without starting the HTTP server or database.

### What is covered

- Auth: register, login, refresh, logout, cookie and bearer modes, session scopes
- **Must-change-password** workflow: restricted routes, admin member management, unlock after change
- Events, attendance, members: validation, pagination, conflicts, admin guards
- Error handling: 404, 409 duplicate key, 500 sanitization (`appErrorHandler`)
- Infrastructure: graceful shutdown, health check, structured logging

### CI (GitHub Actions)

[`.github/workflows/test.yml`](.github/workflows/test.yml) runs on:

- **push** to `main` or `master`
- **pull_request** targeting `main` or `master`
- **workflow_dispatch** (manual run from the Actions tab)

The job uses **Node 24**, `npm ci`, and `npm test`. No MongoDB service container is required.

After pushing, open the repo on GitHub → **Actions** → **Server tests** to view results.

---

## Development guide

### Adding a new route

1. Create or extend a file in `src/routes/`
2. Use `asyncHandler` from `src/utils/async-handler.js`
3. Apply middleware: `requireAuth`, `requireFullSession`, `requireAdmin` as needed
4. Mount the router in `src/app.js` (not `index.js`)
5. Add `audit()` calls for admin writes
6. Add route tests under `tests/routes/` using `createApp()` and model mocks
7. Document the endpoint in this README, in `src/openapi/openapi.json`, and, if the journey changed, in `docs/end-to-end.md`

### Adding tests

1. Import mocks via `tests/helpers/model-mocks.js` (or rely on global `tests/setup.js`)
2. Use `buildUser` / `buildAdmin` and `authHeader()` from `tests/helpers/fixtures.js` — `authHeader` picks the correct JWT scope from user state
3. Reset mocks in `beforeEach` with `resetModelMocks()`
4. For multi-step auth flows, add a workflow test under `tests/workflows/`
5. Run `npm test` before pushing (CI runs the same command)

### Code conventions

- ES modules (`import` / `export`)
- Mongoose `strictQuery: true`
- Usernames normalized to lowercase
- ObjectIds validated before queries
- Public user data via `user.toSafeJSON()` only

### Git remote

```bash
git remote set-url origin https://github.com/St-Pauls-Malayalam-Parish/attendance-server.git
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Copyright 2026 St Paul's Malayalam Parish, Pune.
