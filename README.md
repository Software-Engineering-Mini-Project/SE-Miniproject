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
| `npm run db:migrate` | Applies data migrations ahead of a deploy (the API also runs them on startup; safe to repeat) |
| `npm run seed` | Replaces every collection with the synthetic fixtures. Refuses non-local or production databases unless `-- --allow-remote-database` is passed |
| `npm run seed:demo` | The same fixtures with dates moved to today, plus six weeks of completed tasks so the delivery forecast has history, for demos |
| `npm run user:role -- <email> <Admin\|Lead\|Member>` | Sets a registered user's role, e.g. the first Admin of a new deployment |

Fixture accounts (`admin@`, `lead@`, `member@`, `viewer@`, `outsider@example.test`) share the password `Password123!`; they are synthetic and for local/test databases only.

## Roles

Two layers, defined once in [`src/lib/permissions.js`](src/lib/permissions.js) and enforced by the API (the UI uses the same module, so it never offers an action the API would refuse).

**Workspace role** (per account):

- **Member**: works in the projects they were added to.
- **Lead**: can also create projects, and becomes their Owner.
- **Admin**: everything in every project, plus the **Users** page to change roles and deactivate accounts. The last active Admin cannot be demoted.

**Project role** (per project):

| | Owner | Manager | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| View, export, comment | ✓ | ✓ | ✓ | ✓ |
| Move tasks between statuses | ✓ | ✓ | ✓ | |
| Create, edit, assign and delete tasks | ✓ | ✓ | | |
| Edit the project; add, remove and change Members and Viewers | ✓ | ✓ | | |
| Grant or revoke Manager, transfer ownership, delete the project | ✓ | | | |

Anyone except the Owner can leave a project. The full matrix is in [docs/backend-api-contract.md §7.5](docs/backend-api-contract.md).

Changing a password signs out every other session for that account; deactivating an account signs it out everywhere and blocks sign-in until an Admin reactivates it.

## Delivery forecast

A project's **Insights** view answers "when will this be done, and which due dates are in trouble?" from the team's own pace instead of estimates. [`src/lib/forecast.js`](src/lib/forecast.js) runs a Monte Carlo simulation over the last six weeks of completions (each task's `completedAt`): every simulated day replays a randomly chosen day of real throughput, 4,000 times, giving a finish date at 50%, 85% and 95% confidence and, for every dated open task, the chance it finishes by its due date. Tasks below 85% are flagged **Tight** and below 50% **At risk** on the board, in the list and in the task sheet.

It runs in the browser on data the page already has (no extra request, a few milliseconds for a typical project), is deterministic (seeded), and says plainly when there are fewer than three completions to learn from. Open tasks are assumed to be worked earliest due date first, in-progress before new, then by priority.



Vercel is the primary deployment, using `taskmanager-se` and the repository root. The API runs through Next.js at `/api`. Configure `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `JWT_EXPIRES_IN` (7200), `CORS_ORIGIN`, `NEXT_PUBLIC_API_MODE=http`, and `NEXT_PUBLIC_API_BASE_URL=/api` for each Vercel environment. `CORS_ORIGIN` is a comma-separated list of exact origins, for example `https://taskmanager-se.vercel.app,http://localhost:3000`; wildcards and trailing slashes are invalid. NEXT_PUBLIC values are embedded during build, so redeploy after changing them.


Vercel functions are configured for Mumbai (`bom1`). Place the MongoDB Atlas cluster in AWS `ap-south-1` (Mumbai) to match that region; each extra region hop can add about 20–200 ms per query. Production disables automatic index creation on cold starts; run `npm run db:indexes` once after deployment with the target database environment configured. This synchronizes indexes and can remove indexes absent from the model schemas; review the target database before running it.

Configure separate `MONGODB_URI` values for Vercel Preview and Production. Preview deployments must use a dedicated preview database so test or review activity can never write to production data.
