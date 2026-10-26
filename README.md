# SE-Miniproject - Task Manager

Task Manager application built as an npm workspaces monorepo. The web app uses Next.js (App Router); the API uses Node.js, Express, and MongoDB/Mongoose.

## Prerequisites

- Node.js 22 or newer (Node.js 24 LTS is recommended)
- npm 10 or newer (included with supported Node.js releases)

## Repository layout

```text
apps/
  api/         Express API, MongoDB models, seed scripts, and API tests
  web/         Next.js app, synthetic fixtures, and web tests
docs/          API contract and handoff notes
.github/       GitHub Actions workflows
```

See [context.md](context.md) for current architecture, agreed decisions, and next steps.

## Install

From the repository root:

```bash
npm ci
```

## Configure

Copy `apps/api/.env.example` to `apps/api/.env` and set `MONGODB_URI` and a strong `JWT_SECRET`. Copy `apps/web/.env.example` to `apps/web/.env.local`. Do not commit local `.env` files or real credentials. The API requires a valid MongoDB connection string to start.

The web app uses the real API by default (`NEXT_PUBLIC_API_MODE=http`). To load the synthetic demo without a database, set `NEXT_PUBLIC_API_MODE=mock`; the browser mock uses fixtures from `apps/web/fixtures/`. See [docs/backend-api-contract.md](docs/backend-api-contract.md).

## Run locally

Start both applications from the root:

```bash
npm run dev
```

To load the synthetic demo accounts and fixtures into the configured MongoDB during local development, run `npm run seed --workspace @task-manager/api`. **Seeding clears the selected database collections before inserting the demo data; use a local or test database only.** Demo password: `Password123!`.

- Web app: <http://localhost:3000> (in HTTP mode, sign in with a seeded account; in mock mode, use the demo account buttons)
- API health check: <http://localhost:4000/api/health>

You can also start each application separately with `npm run dev:web` or `npm run dev:api`.

## Verify

```bash
npm test
npm run lint
npm run build
```

GitHub Actions (`.github/workflows/node.js.yml`) runs separate **API** and **Web** jobs on Node 22 and 24 for pull requests targeting `main` and pushes to `main`: install from the lockfile, lint, tests, and the web production build. Suites that don't exist yet (E2E smoke) are reported as skipped, not passed.

## Contribution workflow

1. Create a feature branch from the latest `main`.
2. Make focused commits and keep secrets and real personal data out of Git.
3. Open a pull request to `main`, link the related issue, and request review.
4. Resolve review feedback and wait for the required approval and CI checks before merging.

## Current scope

- **Web:** sign-in/register, dashboard, projects and members, Kanban board, task details and comments, my tasks with filters, notifications, profile, and CSV export. HTTP mode is the default; fixture-backed mock mode remains available.
- **API:** Express/Mongoose implementation of the contract endpoints described in [docs/backend-api-contract.md](docs/backend-api-contract.md), connected through the web app's centralized API client.
