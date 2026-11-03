# Vercel staging setup

This guide prepares the Task Manager monorepo for an opt-in Vercel staging deployment. It does not create provider resources, set secrets, or replace the existing Render staging deployment.

## Architecture

The root `vercel.json` declares two Vercel Services:

- `src`: Next.js app serving the site at `/`.
- `server`: Express API serving `/api/*`.

Both services share one deployment origin. The web client should use the relative API base `/api`, so browser requests remain same-origin. The API establishes and reuses its MongoDB connection when Vercel invokes the Express app. The existing `npm run start --workspace @task-manager/api` startup path remains responsible for connecting when running on Render or locally.

## Required Vercel environment variables

Configure these under the Vercel project for **Preview** and **Production** only after a staging environment is agreed:

| Variable | Scope | Value |
| --- | --- | --- |
| `MONGODB_URI` | API runtime | Staging-only Atlas connection string with a least-privilege database user |
| `JWT_SECRET` | API runtime | Random secret of at least 32 characters |
| `JWT_EXPIRES_IN` | API runtime | `7200` |
| `CORS_ORIGIN` | API runtime | Exact Vercel deployment/custom origin; do not use a wildcard |
| `NEXT_PUBLIC_API_BASE_URL` | Web build | `/api` |
| `NEXT_PUBLIC_API_MODE` | Web build | `http` |
| `NEXT_TELEMETRY_DISABLED` | Web build | `1` (optional) |

Use the Vercel dashboard's secret-value fields. Never put real values in Git, issue comments, PR descriptions, or chat. For a local setup, copy the existing API and web example files and use a disposable database.

## MongoDB Atlas network prerequisite

Do not add `0.0.0.0/0` to Atlas. Vercel Functions use dynamic egress addresses by default, which cannot be safely represented as a narrow Atlas IP access-list entry. Confirm a supported private connectivity or approved fixed-egress option for the selected plan before enabling a live API deployment. Fixed egress may require a paid Vercel plan; do not upgrade without the project owner's approval. Keep Render online while this is unresolved.

## Import and rollout

1. In Vercel, import the existing organization repository `Software-Engineering-Mini-Project/SE-Miniproject`; keep the project name `taskmanager`.
2. Set the project framework to **Services** and keep the repository root as the project root. The checked-in configuration declares each service root.
3. Configure the variables above only with values intended for staging. Do not copy production credentials into Preview deployments.
4. Resolve the Atlas network prerequisite before using real MongoDB credentials or enabling API requests.
5. Deploy a preview first. Confirm `/api/health`, registration/login with a synthetic account, project/task CRUD, browser console/network, and the relevant Vercel runtime logs.
6. Test the production/staging domain and rollback process. Leave Render unchanged until the Vercel deployment passes acceptance and the team agrees to cut over.
7. When the cutover is accepted, update the project deployment decision and retire Render separately with explicit owner authorization.

## Teammate local setup

- Install Node.js 22+ and npm 10+.
- Run `npm ci` from the repository root.
- Copy `server/.env.example` to `server/.env` and `.env.example` to `.env.local`.
- For Vercel-like same-origin local routing, use `NEXT_PUBLIC_API_BASE_URL=/api` with a local proxy; otherwise retain the documented local API origin.
- Never share personal Vercel accounts or credentials. Invite teammates through the organization’s normal access controls.

## Verification status

A successful configuration commit or CI run does not prove a live deployment. Record a deployment URL, health-check result, database connectivity, and browser acceptance separately before considering this setup complete.
