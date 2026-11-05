# Task Manager

Task Manager is a single-app monolith: Next.js serves the web interface and Express serves the MongoDB-backed API under `/api` from the same Node process and port.

## Structure

```text
src/       Next.js app, UI features, API client
server/    Express routes, MongoDB models, middleware, and tests
fixtures/  Synthetic data
tests/     Web tests
e2e/       Playwright browser tests
scripts/   Database seed and index management
docs/      API contract and handoff notes
```

## Setup

Use Node.js 22+ and npm 10+. Copy `.env.example` to `.env`, set a strong `JWT_SECRET`, and point `MONGODB_URI` at a local or test database. Install dependencies with `npm install`.

Run `npm run dev` to serve the website and API on port 3000. The API health check is `/api/health`; the web app is at `/login`. Set `NEXT_PUBLIC_API_MODE=mock` to use synthetic browser fixtures without MongoDB-backed API calls.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Website and API on one port, with reload |
| `npm run lint` / `npm test` | ESLint; API, contract and UI tests |
| `npm run build` / `npm start` | Production build and server |
| `npm run test:e2e` | Playwright browser tests against the production build (see `playwright.config.js`) |
| `npm run db:indexes` | Creates the MongoDB indexes (required once per database in production) |
| `npm run seed` | Replaces every collection with the synthetic fixtures. Refuses non-local or production databases unless `-- --allow-remote-database` is passed |
| `npm run seed:demo` | The same fixtures with dates moved to today, for demos |
| `npm run user:role -- <email> <Admin\|Lead\|Member>` | Sets a registered user's role, e.g. the first Admin of a new deployment |

Fixture accounts (`admin@`, `lead@`, `member@`, `outsider@example.test`) share the password `Password123!`; they are synthetic and for local/test databases only.

## Roles

- **Member**: works on the projects they were added to and moves task status.
- **Lead**: creates projects, manages members and tasks in projects they belong to.
- **Admin**: everything, in every project, plus the **Users** page to change roles. The last Admin cannot be demoted.

Changing a password signs out every other session for that account.



Vercel is the primary deployment, using `taskmanager-se` and the repository root. The API runs through Next.js at `/api`. Configure `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `JWT_EXPIRES_IN` (7200), `CORS_ORIGIN`, `NEXT_PUBLIC_API_MODE=http`, and `NEXT_PUBLIC_API_BASE_URL=/api` for each Vercel environment. `CORS_ORIGIN` is a comma-separated list of exact origins, for example `https://taskmanager-se.vercel.app,http://localhost:3000`; wildcards and trailing slashes are invalid. NEXT_PUBLIC values are embedded during build, so redeploy after changing them.


Vercel functions are configured for Mumbai (`bom1`). Place the MongoDB Atlas cluster in AWS `ap-south-1` (Mumbai) to match that region; each extra region hop can add about 20–200 ms per query. Production disables automatic index creation on cold starts; run `npm run db:indexes` once after deployment with the target database environment configured. This synchronizes indexes and can remove indexes absent from the model schemas; review the target database before running it.

Configure separate `MONGODB_URI` values for Vercel Preview and Production. Preview deployments must use a dedicated preview database so test or review activity can never write to production data.
