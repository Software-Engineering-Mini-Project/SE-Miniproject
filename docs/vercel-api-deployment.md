# Deploy the Express API to Vercel

The web app currently runs in the `taskmanager-se` Vercel project. The API is a separate Express service and needs its own Vercel project. Keep the existing Render API online until the Vercel API has a verified MongoDB connection and the web app's authentication and task flows have been checked against it.

## Create the API project

1. In Vercel, import `Software-Engineering-Mini-Project/SE-Miniproject` as a new project named `taskmanager-api`.
2. Set **Root Directory** to `server`. Keep **Include source files outside of the Root Directory in the Build Step** enabled so the project can use the monorepo's root `package-lock.json` and workspace package metadata.
3. Use the Express framework preset and the repository's default install command. The API entry point at `src/index.js` exports the Express app for Vercel Functions.
4. Add the API environment variables below to Preview and Production. Add real secrets through Vercel's environment editor only; never commit or post them.

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | A staging-only Atlas connection string and least-privilege database user |
| `JWT_SECRET` | A unique, randomly generated secret of at least 32 characters |
| `JWT_EXPIRES_IN` | `7200` |
| `CORS_ORIGIN` | Exact web origin, initially `https://taskmanager-se.vercel.app` |

## Connect Atlas safely

Atlas must allow connections from the API project's outbound network. Vercel Hobby uses dynamic outbound IP ranges; it does not provide static egress IPs. Do **not** set Atlas access to `0.0.0.0/0` to work around this. Use Vercel Static IPs on an eligible plan and allowlist the assigned IPs, or keep the API on a host whose outbound IPs Atlas can safely allowlist. Do not retire Render until the database connection works with the chosen network configuration.

## Connect the web project

1. In the `taskmanager-se` Vercel project, set `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_BASE_URL=https://<actual-api-project-domain>/api` in Preview and Production.
2. Redeploy the web project after changing these variables; `NEXT_PUBLIC_` settings are included in the browser bundle at build time.
3. Verify `GET https://<actual-api-project-domain>/api/health` returns `{"status":"ok"}` and test registration, sign-in, project/task operations, and sign-out on the production web domain.
4. Confirm the API's Vercel runtime logs and Atlas connection before switching production traffic away from Render.

## Retire Render only after cutover

Once the Vercel API, Atlas access, CORS, and real user flows have all been verified, update the staging deployment workflow and hosting decision to the final Vercel setup. Keep a rollback window before removing the Render services. Deleting the Render API before then causes an outage because the current web app depends on an HTTP API.

## Local `.env` files

For local development, copy `server/.env.example` to `server/.env` and `.env.example` to `.env.local`. The actual local files are intentionally ignored by Git; the example templates are safe to share because they contain placeholders only.
