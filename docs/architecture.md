# Architecture

How the choir API starts, how a request is authorized, and how the data is stored. Setup and the route catalogue are in the [README](../README.md). Journeys that cross several routes are in [end-to-end.md](end-to-end.md).

## System

```mermaid
flowchart LR
  subgraph clients [Clients]
    Local["Vite dev server<br/>cookie session"]
    Pages["GitHub Pages app<br/>Bearer session"]
  end

  API["Express on Render<br/>or localhost:4000"]
  DB[("MongoDB<br/>local :27018 or Atlas")]

  Local -->|"POST /api with cookies"| API
  Pages -->|"Authorization Bearer"| API
  API --> DB
```

`createApp()` in `src/app.js` builds the Express app used by both `src/index.js` and the tests. Tests never open a port or a database.

## Boot

```mermaid
flowchart TD
  Env["validateEnv()"] --> App["createApp()"]
  App --> Listen["listen PORT"]
  Listen --> DB["connectDb()"]
  Listen --> Stop["attachGracefulShutdown"]
  DB --> Ready["Choir API listening"]
```

`validateEnv()` refuses to start when `MONGODB_URI` or `JWT_SECRET` is missing. In production it also requires `CLIENT_ORIGIN` and a JWT secret of at least 32 characters, and it rejects a short list of placeholder secrets.

## Request pipeline

```mermaid
flowchart TD
  In["HTTP request"] --> Helmet
  Helmet --> CORS["CORS credentials<br/>CLIENT_ORIGIN"]
  CORS --> JSON["JSON body, 32 KB"]
  JSON --> Cookies["cookie-parser"]
  Cookies --> Down{"Shutting down?"}
  Down -->|yes| S503["503"]
  Down -->|no| Log["request logger"]
  Log --> Router["/api/* router"]
  Router --> Found{"Route matched?"}
  Found -->|no| S404["404"]
  Found -->|yes| Handler
  Handler --> Err{"Thrown?"}
  Err -->|duplicate key| S409["409"]
  Err -->|other| S500["500 generic message"]
```

Health checks are logged less aggressively than other routes. Audit events record the action name, user id, and username. Passwords and tokens are not written to the log.

## Authorization

```mermaid
flowchart TD
  Token["Cookie token or Bearer"] --> Verify["jwt.verify"]
  Verify --> Load["User.findById"]
  Load --> Alive{"active and not rejected?"}
  Alive -->|no| S401["401"]
  Alive -->|yes| Scope["sessionScopeForUser"]
  Scope --> Full{"requireFullSession?"}
  Full -->|must change password| S403a["403 change password"]
  Full -->|pending| S403b["403 waiting for approval"]
  Full -->|full| Next["next middleware"]
  Next --> Admin{"requireAdmin?"}
  Admin -->|not admin| S403c["403"]
  Admin -->|admin| Handler["route handler"]
```

| Scope | Who | What they can call |
| --- | --- | --- |
| `must-change-password` | `mustChangePassword` is true | Auth routes. Admins can also call `/api/members` |
| `pending` | Singer not yet approved | Auth routes |
| `full` | Approved singer or admin who has set a password | Events, attendance, FAQs, and profile reads |

Events, attendance, and FAQs mount `requireAuth`, `requireFullSession`, and `requireApproved` for the whole router. Member routes mount `requireAuth` and `requireAdmin` only.

Access tokens last 15 minutes. Refresh tokens last 7 days, are stored as a SHA-256 hash, and rotate on every refresh. Production cookies are `SameSite=None; Secure` so the Pages origin can send them. Local cookies are `SameSite=Lax`.

Auth routes are limited to 30 requests per 15 minutes per IP.

## Route map

```mermaid
flowchart TB
  API["/api"]
  API --> Health["/health"]
  API --> Auth["/auth"]
  API --> Events["/events"]
  API --> Attendance["/attendance"]
  API --> Members["/members"]
  API --> Faqs["/faqs"]
  API --> Docs["/api/docs and /api/openapi.json"]

  Auth --> Login["register, login, refresh, logout"]
  Auth --> Me["me, my-profile, change-password"]

  Events --> EventRead["GET years, GET list"]
  Events --> EventWrite["POST, PATCH, DELETE<br/>admin"]

  Attendance --> Mine["GET /me, GET /me/export"]
  Attendance --> Mark["GET and PUT /event/:id<br/>admin"]

  Members --> Lists["GET /, GET /roster, GET /roster/export"]
  Members --> Account["POST, PATCH, approval, active, DELETE"]
  Members --> Profile["GET and PATCH /:id/profile"]

  Faqs --> FaqRead["GET published for the role"]
  Faqs --> FaqWrite["POST, PATCH, DELETE<br/>admin"]
```

## Data

```mermaid
erDiagram
  USER ||--o{ ATTENDANCE : marks
  EVENT ||--o{ ATTENDANCE : has
  USER ||--o{ EVENT : creates
  USER ||--o{ FAQ : writes

  USER {
    string username
    string email
    string role
    boolean onRoster
    string voicePart
    string approvalStatus
    boolean mustChangePassword
    boolean active
  }

  EVENT {
    string title
    date date
    string type
    string liturgicalColor
  }

  ATTENDANCE {
    string status
    string notes
  }

  FAQ {
    string question
    string answer
    string audience
    boolean published
  }
```

`Attendance` has a unique index on `(user, event)`.

`onRoster` matters for admins. A member is always on the singing roster. An admin is on it only when `onRoster` is true. Take-attendance and the roster query use that rule. Demoting the last admin is rejected.

Profile history (voice range, choir pathway, feedback text) is stored on the user document. Each update appends an entry with who recorded it and when. Singers read their own history from `GET /api/auth/my-profile`. Admins read and update a singer through `/api/members/:id/profile`.

## Roster and export

```mermaid
flowchart LR
  Query["Filters: search, voice, dates, event, status"] --> Roster["GET /roster<br/>one page"]
  Query --> Export["GET /roster/export<br/>all matching rows"]
  Export --> Pdf["PDFKit"]
  Export --> Xlsx["ExcelJS"]
```

`GET /api/attendance/me/export` uses the same filter rules as `GET /api/attendance/me`, then builds a PDF or workbook for that singer. `format` is `pdf` or `xlsx`. The response is the file, with `Content-Disposition` exposed so the browser can read the filename.

## Deploy

```mermaid
flowchart LR
  GH["GitHub push"] --> Actions["Actions: npm test"]
  Actions --> Render["Render: npm start"]
  Render --> Atlas["MongoDB Atlas<br/>database choir"]
  Pages["GitHub Pages"] -->|"CLIENT_ORIGIN"| Render
```

Render sets `PORT`. The service needs `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_ORIGIN`. Seed the admin once against that URI. The client build needs `VITE_API_URL` pointing at the Render origin.
