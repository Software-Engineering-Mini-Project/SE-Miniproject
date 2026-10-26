# Task Manager project context

Last updated: 2026-10-26

This file gives contributors and coding agents the durable project context they need to continue work. The detailed endpoint contract is in [docs/backend-api-contract.md](docs/backend-api-contract.md); do not duplicate that document here.

## Project and repository

- Repository: `Software-Engineering-Mini-Project/SE-Miniproject`.
- Build a Task Manager web application with an Express/Mongoose API.
- Keep all project work inside this repository. **Do not inspect or modify the separate `TRSystem` project.**
- Use feature branches from the latest `main`; do not commit directly to `main`.
- Pull requests target `main` and require a review approval before merging. A PR author cannot approve their own PR. Never merge on the user's behalf unless they explicitly ask.

## Structure

```text
apps/
  api/       Express API, Mongoose models, seed script, and API tests
  web/       Next.js app, mock API, fixtures, and web tests
docs/        API contract and project handoff notes
.github/     CI workflow
```

This is an npm workspaces monorepo. The root `package.json` owns shared scripts and `package-lock.json`; app workspaces are `@task-manager/api` and `@task-manager/web`. There is no `packages/` workspace yet because no shared package is needed.

## Setup and common commands

Run commands from the repository root:

```bash
npm ci
npm run dev          # API and web app
npm run dev:api
npm run dev:web
npm run lint
npm test
npm run build        # web production build
```

API local configuration: copy `apps/api/.env.example` to `apps/api/.env` and set `MONGODB_URI` and a strong `JWT_SECRET`. Web local configuration: copy `apps/web/.env.example` to `apps/web/.env.local`. Do not commit local environment files, real credentials, or production data.

## Code and test conventions

- Both workspaces use ESM (`"type": "module"`). Existing source modules use `.js` (and the web app also uses `.jsx`).
- All test files use `.test.mjs`; use `.mjs` for new Node test helpers as well. The API uses Node's built-in `node:test`, Supertest, and `mongodb-memory-server`.
- Keep fixture data synthetic (`example.test`). API seeding reads fixtures from `apps/web/fixtures/` and hashes the demo password.
- Use the workspace names in scripts and CI; update root scripts, CI, documentation, imports, and links whenever app paths or workspace names change.
- The user requested unit tests and their execution. Run the relevant tests and fix failures when implementing backend phases.

## Current state

- The web app is a Next.js 15 / React 19 app with auth screens, dashboard, projects, tasks/Kanban, comments, notifications, profile, CSV export, and a browser mock API.
- The API Phase 0 foundation is implemented: Express app, validated environment, MongoDB startup, Mongoose models/indexes, safe JSON error envelopes, request IDs and structured request logging, fixture seeding, and health endpoint.
- Authentication, authorization middleware, and product API routes are not complete. Continue in reviewable phases, starting with authentication, then implement the remaining endpoints to the API contract.
- Phase 0 verification passed locally: clean `npm ci`, root lint, API tests (21), Web tests (26), and the Web production build.
- The `main` workflow runs API and Web jobs on Node 22 and 24, so GitHub shows four CI checks (two workspaces × two Node versions).
- As of this update, PR [#13](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/13) is open from `feature/2-backend-foundation`; it includes the workspace layout and test extension refactor. Check GitHub for the current head commit.

## Confirmed API contract choices

The user accepted the defaults below. Keep them consistent across API, tests, and the web client:

1. Base path `/api`.
2. Bearer JWT in `Authorization`; no cookie transport.
3. JWT lifetime 7200 seconds; no refresh token.
4. Add project member with `{ "email": "..." }`.
5. Project responses include safe member details alongside `memberIds`.
6. Comment responses include the safe author object.
7. Notification lists use `{ items, page, pageSize, total, unreadCount }`.
8. Error `fields` are optional on relevant 400/404/409 errors.
9. Non-member access is 403; unknown resources are 404; another user's notification is 404.
10. Due dates are calendar dates; overdue begins after 23:59:59 UTC on that date.
11. Deleting a task cascades to comments/notifications; deleting a project cascades to its tasks and related data.
12. Any project member may change task status.
13. Generate due reminders while notifications are read/listed, with deduplication.
14. IDs are strings and must remain compatible with current fixtures.
15. Use `node:test`, Supertest, and `mongodb-memory-server` for API tests.

## Audit and admin scope

- Do not build task activity history, a history UI, or a separate task-audit collection/endpoint.
- SRS §2.2 requires Admin actions to be audited. After auth exists, the request logger must mark each authenticated Admin `POST`, `PATCH`, or `DELETE` as `audit: true`, recording timestamp, request ID, actor ID, role, method, route pattern, target IDs from the path, and response status.
- Never log request bodies, passwords, tokens, or connection strings. Add a test for the Admin audit log in the auth phase.
- Admins have full access to project/task endpoints according to the authorization matrix. Do not add user/role management endpoints; that onboarding workflow needs a team decision before deployment. Admin users come from seed data for now.

## Open decisions and next work

- The SRS copy reviewed from the `Templates` branch is v1.0 and marked as a working baseline; Issue #2 cites v1.3. Confirm which SRS version governs later API work before implementing contract-sensitive endpoints.
- The Admin account onboarding and role-management workflow must be agreed before deployment.
- Continue with Phase 1 authentication and authorization; include the Admin-write audit test in that phase. Then implement project/task and other contract endpoints in focused, reviewable phases.
- Keep `context.md`, README, API contract, and CI configuration current when lasting project decisions or structure changes.
