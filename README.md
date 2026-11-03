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


Vercel is the primary deployment, using `taskmanager-se` and the repository root. The API runs through Next.js at `/api`. Configure `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `JWT_EXPIRES_IN` (7200), `CORS_ORIGIN`, `NEXT_PUBLIC_API_MODE=http`, and `NEXT_PUBLIC_API_BASE_URL=/api` for each Vercel environment. `CORS_ORIGIN` is a comma-separated list of exact origins, for example `https://taskmanager-se.vercel.app,http://localhost:3000`; wildcards and trailing slashes are invalid. NEXT_PUBLIC values are embedded during build, so redeploy after changing them.

The Render staging configuration is an optional single-service alternative.

Vercel functions are configured for Mumbai (`bom1`). Place the MongoDB Atlas cluster in the same region (AWS `ap-south-1`, Mumbai) to avoid cross-region database latency. Production disables automatic index creation on cold starts; run `npm run db:indexes` once after deployment with the target database environment configured. This synchronizes indexes and can remove indexes absent from the model schemas; review the target database before running it.
