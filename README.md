# Task Manager

Task Manager is a single-app monolith: Next.js serves the web interface and Express serves the MongoDB-backed API under `/api` from the same Node process and port.

## Structure

```text
src/       Next.js app, UI features, API client
server/    Express routes, MongoDB models, middleware, and tests
fixtures/  Synthetic data
tests/     Web tests
e2e/       Playwright browser tests
scripts/   Database seed and staging deployment
docs/      API contract and handoff notes
```

## Setup

Use Node.js 22+ and npm 10+. Copy `.env.example` to `.env`, set a strong `JWT_SECRET`, and point `MONGODB_URI` at a local or test database. Install dependencies with `npm install`.

Run `npm run dev` to serve the website and API on port 3000. The API health check is `/api/health`; the web app is at `/login`. Set `NEXT_PUBLIC_API_MODE=mock` to use synthetic browser fixtures without MongoDB-backed API calls.

## Commands

`npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, and `npm run seed` are available from the repository root. Seeding clears selected collections; use a disposable local/test database only.

Render staging uses one web service. See `docs/staging-deployment.md` for setup and rollout notes.
