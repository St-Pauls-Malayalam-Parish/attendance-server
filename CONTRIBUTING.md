# Contributing to the choir API

This repository is the Express API. The web app is [attendance-application](https://github.com/St-Pauls-Malayalam-Parish/attendance-application).

The project is licensed under the Apache License 2.0. By submitting a change you agree that your contribution is licensed under the same terms. See [LICENSE](LICENSE).

## What to read first

| Document | Use it when |
| --- | --- |
| [README.md](README.md) | You need to run the API, seed data, or look up a route |
| [docs/architecture.md](docs/architecture.md) | You need the request pipeline, models, or deploy shape |
| [docs/end-to-end.md](docs/end-to-end.md) | You are changing a journey that spans several routes |
| Client README | The screen that calls the route is changing too |

## Setup

```bash
cd server
npm install
cp .env.example .env
npm run mongo:up
npm run seed
npm run dev
```

Set `JWT_SECRET` to a random string of at least 16 characters before the process will boot. Tests do not need MongoDB.

Do not commit `.env`, `data/members.json`, passwords, or a hosted connection string.

## Making a change

1. Branch from `main`.
2. Keep the change small enough to review on its own.
3. Add the route in `src/routes/` and mount it from `src/app.js`.
4. Wrap async handlers with `asyncHandler`.
5. Choose the middleware on purpose: `requireAuth`, `requireFullSession`, `requireApproved`, `requireAdmin`.
6. Return users with `toSafeJSON()`. Validate ObjectIds before querying.
7. Call `audit()` on admin writes. Do not log passwords or tokens.
8. Update `src/openapi/openapi.json` when the route, body, or status codes change. The path list in `tests/routes/openapi.test.js` must match.
9. Add a route test under `tests/routes/` and run `npm test`.

### Commit messages

Use a conventional commit:

```
feat: export a member's attendance history
fix: keep the last admin from being demoted
docs: describe FAQ audiences
```

Prefer `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`. The subject should say why the change exists.

### Pull requests

- Say which role can call the route, and what status code a rejected call gets.
- Note a matching client change when the JSON shape moves.
- `npm test` is the same command GitHub Actions runs, including coverage thresholds.

## Tests

```bash
npm test           # coverage and thresholds
npm run test:fast  # no coverage, while you are iterating
```

Tests mock Mongoose. They do not need `npm run mongo:up`. Use `buildUser`, `buildAdmin`, and `authHeader()` from `tests/helpers/fixtures.js`. Reset mocks with `resetModelMocks()` in `beforeEach`.

Multi-step stories (login, then a blocked call, then a password change) belong in `tests/workflows/`.

Coverage thresholds live in `vitest.config.js`. A pull request that drops below them fails in Actions.

## Data and scripts

| Command | When |
| --- | --- |
| `npm run seed` | Create the first admin if one does not exist |
| `npm run import-members` | Load `data/members.json` |
| `npm run migrate` | One-off fixes after an upgrade |

Preview an import with `npm run import-members -- --dry-run`.

## License

Apache License 2.0. See [LICENSE](LICENSE).
