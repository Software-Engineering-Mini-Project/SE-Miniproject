# Task Manager project context

Last updated: 2026-10-30

This file gives contributors and coding agents the durable project context they need to continue work. The detailed endpoint contract is in [docs/backend-api-contract.md](docs/backend-api-contract.md); do not duplicate that document here.

## Project and repository

- Repository: `Software-Engineering-Mini-Project/SE-Miniproject`.
- Build a Task Manager web application with an Express/Mongoose API.
- Keep all project work inside this repository.
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
- The Express/Mongoose API implements authentication/profile, projects/members, tasks/search/status, comments, notifications/reminders, project summaries, CSV export, authorization, validation, and Admin write audit logging.
- The web app's centralized API client now defaults to the real HTTP API at `http://localhost:4000/api`; opt into the browser mock with `NEXT_PUBLIC_API_MODE=mock`. All UI API calls go through `apps/web/src/lib/api/client.js`.
- To use the real API locally, configure `apps/api/.env` with `MONGODB_URI` and a strong `JWT_SECRET`; configure `apps/web/.env.local` with `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api`. Seed only a local/test database with `npm run seed --workspace @task-manager/api` (the seed clears selected collections).
- Latest integrated acceptance report: [Issue #19, `main` at `1f1c0b2`](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/19#issuecomment-6521151192). It records API tests (29/29), web tests (26/26), lint, production build, seeded local MongoDB, mock and real-API Playwright journeys, and access-boundary checks as passing.
- The `main` workflow runs API and Web jobs on Node 22 and 24, so GitHub shows four CI checks (two workspaces × two Node versions).
- The CI workflow also runs the E2E Chromium smoke job, for five jobs total. The latest main CI run recorded in Issue #19 is [40378483982](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/40378483982), all five green.
- Issue #4's CI and synthetic test-data work is implemented; its issue discussion requests Trisha's QA verification before closure.
- Issue #5 task creation is implemented on `main`. Focused `TC-Task-01` API coverage is in [PR #25](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/25), which has a successful five-job CI run [41082128680](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41082128680) and is awaiting review.
- The Issues #1–#6 evidence and requirement mapping are recorded in [docs/requirements-traceability.md](docs/requirements-traceability.md). The approved SRS, SAD, STP, and a separate test register are not currently committed in this repository, so unverified formal IDs are not invented.

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
- SRS §2.2 requires Admin actions to be audited. The request logger marks each authenticated Admin `POST`, `PATCH`, or `DELETE` as `audit: true`, recording timestamp, request ID, actor ID, role, method, route pattern, target IDs from the path, and response status.
- Never log request bodies, passwords, tokens, or connection strings. A route integration test checks the Admin audit log for the required fields and ensures secrets are omitted.
- Admins have full access to project/task endpoints according to the authorization matrix. Do not add user/role management endpoints; that onboarding workflow needs a team decision before deployment. Admin users come from seed data for now.

## Open decisions and next work

- The Admin account onboarding and role-management workflow must be agreed before deployment.
- Obtain the approved SRS/RTM/STP documents and reconcile the working traceability register with their exact IDs and wording.
- Have the assigned QA contributor verify Issue #4's evidence and record the sign-off before its owner closes the issue.
- Complete manual accessibility checks listed in Issue #23; automated checks do not replace screen-reader, browser, and zoom verification.
- Keep the browser mock available for frontend-only development; default API mode remains HTTP.
- Keep `context.md`, README, API contract, and CI configuration current when lasting project decisions or structure changes.
