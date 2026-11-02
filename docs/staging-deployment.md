# Staging deployment (Issue #18)

This repository contains an opt-in Render staging deployment. It does not provision provider resources or contain credentials. The target is the Render + Atlas Free proposal in [staging-target-decision.md](staging-target-decision.md); get that decision accepted before enabling deployments.

## Flow

1. The `CI` workflow completes for a push to `main`.
2. `Deploy staging` receives the completed workflow event. It skips pull-request runs, feature-branch pushes, and failed/cancelled CI. After the job enters the `staging` environment, its deploy step runs only when the environment variable `STAGING_DEPLOY_ENABLED` is exactly `true`.
3. After configuration, the deployment script asks Render's API and web deploy hooks to deploy the exact tested commit SHA.
4. The script polls Render's deployment API until both requested deploys report `live` for the exact tested commit SHA. Only then does it poll `GET $STAGING_API_URL/api/health` until it returns JSON `{ "status": "ok" }` and `$STAGING_WEB_URL/login` until it returns a successful response. A failed hook, failed/mismatched deployment, timeout, or health check fails the deployment job.

The workflow uses GitHub's `staging` environment so deployment credentials and target URLs are scoped to that environment. It does not deploy from a pull request. Do not configure production values in this environment.

## Required configuration after services exist

Create these GitHub **environment secrets** for the `staging` environment:

| Secret | Value |
| --- | --- |
| `RENDER_API_DEPLOY_HOOK_URL` | API service deploy-hook URL from Render |
| `RENDER_WEB_DEPLOY_HOOK_URL` | Web service deploy-hook URL from Render |
| `RENDER_API_TOKEN` | Render API token with permission to read the two services' deployment status |

Create these GitHub **environment variables**:

| Variable | Value |
| --- | --- |
| `STAGING_DEPLOY_ENABLED` | `true` only after the target is approved and all other settings are complete; otherwise omit it or set `false` |
| `STAGING_API_URL` | API service origin, for example `https://<api-service>.onrender.com` |
| `STAGING_WEB_URL` | Web service origin, for example `https://<web-service>.onrender.com` |

Configure Render service variables from `render.yaml`. Set the Atlas URI and API CORS origin in Render's API environment, and the real API base URL in the web service. GitHub Actions never needs the Atlas URI or JWT secret.

## First setup

1. After team approval of Issue #17, connect the organization repository to a Render Blueprint and review the two Free services in `render.yaml` before applying it.
2. Create the Atlas Free cluster and staging-only database user. Add only the selected Render region's outbound CIDRs to Atlas's IP access list; do not use `0.0.0.0/0`.
3. Record the assigned Render URLs in the GitHub `staging` environment variables. Set Render `CORS_ORIGIN` to the exact web origin and `NEXT_PUBLIC_API_BASE_URL` to the API origin plus `/api`.
4. Create each Render deploy hook and add its URL to the corresponding GitHub environment secret. Create a Render API token with read access to the two services' deploy status and add it as `RENDER_API_TOKEN`. Verify the names and values without pasting secret values into issues or PR comments.
5. Enable deployment by setting `STAGING_DEPLOY_ENABLED=true` last. The next successful CI run for a push to `main` triggers the first deployment.
6. Confirm the `Deploy staging` run is successful and attach its link and the health-check result to Issue #18. Use only synthetic staging accounts and data.

## Rollback

If a deploy or smoke check fails, leave `STAGING_DEPLOY_ENABLED` set to `false` while investigating. Use Render's rollback action to restore the last known-good API or web deploy (Free services retain only the two most recent deploys). Verify `/api/health` and `/login`, then re-enable staging deployment after fixing the cause. Record the failed commit SHA and rollback evidence in the issue.

## Local verification

```bash
npm run test:deploy
npm test
```

The deployment script has injectable fetch, clock, and wait functions so its gating, hook calls, exact SHA, queued/in-progress/live/failed deployment handling, health responses, and failure handling can be tested without contacting Render.
