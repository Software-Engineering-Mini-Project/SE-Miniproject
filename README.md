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

Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env.local` if you need to override the defaults. Do not commit local `.env` files or real credentials. The API requires a valid MongoDB connection string to start.

By default the web app runs against an in-browser mock API seeded from `apps/web/fixtures/` (`NEXT_PUBLIC_API_MODE=mock`), so the UI works without the API. Set `NEXT_PUBLIC_API_MODE=http` to call the real API at `NEXT_PUBLIC_API_BASE_URL`. See [docs/backend-api-contract.md](docs/backend-api-contract.md).

## Run locally

Start both applications from the root:

```bash
npm run dev
```

- Web app: <http://localhost:3000> (use the demo account buttons to sign in to the mock API)
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

- **Web:** sign-in/register, dashboard, projects and members, Kanban board, task details and comments, my tasks with filters, notifications, profile, and CSV export, all running on the mock API.
- **API:** Express/Mongoose foundation, health endpoint, configuration, safe errors/logging, and fixture seeding. Authentication and task/project endpoints remain in scope for upcoming backend work, following [docs/backend-api-contract.md](docs/backend-api-contract.md).
