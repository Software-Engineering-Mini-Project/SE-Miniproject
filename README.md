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
docs/      Feature guide, organisations design, API contract and handoff notes
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
| `npm run user:role -- <email> <Admin\|Lead\|Member>` | Sets a registered user's role inside their organisation, e.g. to repair a deployment that has no Admin. (A new organisation's founder is made Admin automatically.) The last active Admin of an organisation cannot be demoted |

Fixture accounts (`admin@`, `lead@`, `member@`, `viewer@`, `outsider@example.test`) share the password `Password123!`; they are synthetic and for local/test databases only. They belong to the demo organisation **Acme Labs**, whose invite code is `ACMELABS`. A second organisation, **Northwind Studio** (`northwind-admin@example.test`, invite code `NORTHWIND`), exists to show that organisations cannot see each other.

For what the app does, see the [feature guide](docs/features.md); for how organisations work, [docs/organisations.md](docs/organisations.md).

## Organisations

Everyone signs in on the same page. What differs is the **organisation** an account belongs to: every account and every project belongs to exactly one, and nothing crosses between organisations (another organisation's project answers *not found*, even to an Admin).

- **Start one:** on *Create account*, choose *Create an organisation*. You become its Admin and land on its page, which shows the invite code.
- **Join one:** choose *Join an organisation* and enter the invite code an Admin gave you. You join as a Member.
- **Join from a personal link:** an Admin can instead make a link for your email address (*Invite by link* on the Organisation page). It opens *Create account* with your address filled in, works once, and expires after 7 days.
- **The Organisation page** (sidebar) shows the organisation's people, projects, open and overdue work, and each project's progress. Admins see every project, plus the invite code (copy it, or replace it: the old code stops working at once) and can rename the organisation and open *Manage people*. Members see the projects they are in and the open ones, with a *Join* button.

Details, the migration of existing data and the security notes are in [docs/organisations.md](docs/organisations.md).

## Roles

Two layers, defined once in [`src/lib/permissions.js`](src/lib/permissions.js) and enforced by the API (the UI uses the same module, so it never offers an action the API would refuse).

**Organisation role** (per account, inside its organisation):

- **Member**: creates projects (becoming their Owner), joins open projects, and works in the projects they belong to.
- **Lead**: the same, and can always create projects, even when an Admin limits creation to leads.
- **Admin**: everything in every project of their organisation, plus the **Users** page to change roles, deactivate accounts and change the organisation's settings, and the invite code. The last active Admin of an organisation cannot be demoted.

**Open by default.** Like Jira's team-managed projects, anyone can start a project; an Admin can switch **Who can create projects** to *Leads and admins only*. Each project is **Private** (only people who are added can see it) or **Open** (listed under *Open projects* on the Projects page, where anyone in the organisation can join as a Member). A shared link to an open project offers a **Join project** button instead of an error. A new account starts on a getting-started screen: create a project, join an open one, or send their email to a project owner.

**Project role** (per project):

| | Owner | Manager | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| View, export, comment | ✓ | ✓ | ✓ | ✓ |
| Create, edit, assign and move tasks; edit checklists | ✓ | ✓ | ✓ | |
| Delete tasks and anyone's comments | ✓ | ✓ | | |
| Edit the project (including Private/Open); add, remove and change Members and Viewers | ✓ | ✓ | | |
| Grant or revoke Manager, transfer ownership, delete the project | ✓ | | | |

Anyone except the Owner can leave a project. The full matrix is in [docs/backend-api-contract.md §7.5](docs/backend-api-contract.md).

Changing a password signs out every other session for that account; deactivating an account signs it out everywhere and blocks sign-in until an Admin reactivates it.

## Planning features

- **Quick add** (project board and list): type a whole task on one line, e.g. `Draft the release notes fri !high @mina`. `!high`/`!medium`/`!low` (or `!1`–`!3`) set priority, `@name` assigns a member (first name, email name or a unique prefix; `@me` is you), and `today`, `tomorrow`, `fri`, `next week`, `in 3 days`, `nov 20` or `2026-11-20` set the due date. A preview shows what was understood before anything is created; ✕ on a piece keeps that word as plain text. Parser: [`src/lib/quick-add.js`](src/lib/quick-add.js).
- **Checklists**: break a task into steps in the task sheet. Members tick steps off; owners and managers add and remove them. Cards show progress (`2/5`). Each change is one atomic update, so people working through the same list don't overwrite each other.
- **Upcoming** (My tasks): open tasks as an agenda, grouped into Overdue, Today, Tomorrow, each of the next five days, Later and No due date.

Quick-add syntax and the agenda follow [Vikunja](https://github.com/go-vikunja/vikunja) ("Quick Add Magic") and [Planify](https://github.com/alainm23/planify); checklists follow both.

## Delivery forecast

A project's **Insights** view answers "when will this be done, and which due dates are in trouble?" from the team's own pace instead of estimates. [`src/lib/forecast.js`](src/lib/forecast.js) runs a Monte Carlo simulation over the last six weeks of completions (each task's `completedAt`): every simulated day replays a randomly chosen day of real throughput, 4,000 times, giving a finish date at 50%, 85% and 95% confidence and, for every dated open task, the chance it finishes by its due date. Tasks below 85% are flagged **Tight** and below 50% **At risk** on the board, in the list and in the task sheet.

It runs in the browser on data the page already has (no extra request, a few milliseconds for a typical project), is deterministic (seeded), and says plainly when there are fewer than three completions to learn from. Open tasks are assumed to be worked earliest due date first, in-progress before new, then by priority.



Vercel is the primary deployment, using `taskmanager-se` and the repository root. The API runs through Next.js at `/api`. Configure `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `JWT_EXPIRES_IN` (7200), `CORS_ORIGIN`, `NEXT_PUBLIC_API_MODE=http`, and `NEXT_PUBLIC_API_BASE_URL=/api` for each Vercel environment. `CORS_ORIGIN` is a comma-separated list of exact origins, for example `https://taskmanager-se.vercel.app,http://localhost:3000`; wildcards and trailing slashes are invalid. NEXT_PUBLIC values are embedded during build, so redeploy after changing them.


Vercel functions are configured for Mumbai (`bom1`). Place the MongoDB Atlas cluster in AWS `ap-south-1` (Mumbai) to match that region; each extra region hop can add about 20–200 ms per query. Production disables automatic index creation on cold starts; run `npm run db:indexes` once after deployment with the target database environment configured. This synchronizes indexes and can remove indexes absent from the model schemas; review the target database before running it.

Configure separate `MONGODB_URI` values for Vercel Preview and Production. Preview deployments must use a dedicated preview database so test or review activity can never write to production data.
