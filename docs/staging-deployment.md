# Optional Render staging

Vercel is the primary deployment. The optional Render staging workflow deploys the single web service defined in `render.yaml`. Set `STAGING_DEPLOY_ENABLED`, `RENDER_DEPLOY_HOOK_URL`, `RENDER_API_TOKEN`, `STAGING_URL`, and `GITHUB_SHA` as described by the deployment workflow. Use an HTTPS origin for `STAGING_URL`, and configure the MongoDB and JWT secrets on the service. The script checks `/api/health` and `/login` after deployment.
