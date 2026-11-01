# Staging hosting target (Issue #17)

**Status:** Proposed for team review. Do not provision services until this proposal is accepted.

## Recommendation

Use **Render** for the Next.js web service and Express API, and **MongoDB Atlas Free** for MongoDB. Keep all three resources in the Singapore region where available, and use each Render service's assigned `onrender.com` hostname with managed TLS. Do not buy a custom domain for this staging release.

This fits the existing Node.js/npm-workspaces application and avoids a repository ownership limitation in Vercel Hobby: Vercel documents Hobby as personal, non-commercial use and says Hobby projects cannot connect to Git repositories owned by Git organizations. Render supports Next.js and Express web services, GitHub Actions deploy hooks, and the Singapore region. Atlas supplies the MongoDB service already required by the application.

| Component | Recommended target | Staging routing |
| --- | --- | --- |
| Web | Render Free Node.js web service, Singapore | `https://<web-service>.onrender.com` |
| API | Render Free Node.js web service, Singapore | `https://<api-service>.onrender.com/api` |
| MongoDB | Atlas Free cluster, AWS Singapore if offered for Free at provisioning time | MongoDB URI stored only in the Render API environment |

The API health endpoint is `GET /api/health`. Set the API's `CORS_ORIGIN` to the exact web origin, and build the web service with `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_BASE_URL` set to the API origin plus `/api`.

## Cost and operating limits

This proposal uses free compute and does not require a paid custom domain or dedicated egress IP. Do not add a payment method for the staging workspace. If free usage limits are reached, accept service suspension instead of enabling paid overages.

- Render Free web services spin down after 15 minutes without traffic and can take about a minute to start again. The workspace receives 750 free instance hours each month across its free web services. Free filesystems are ephemeral, so application state must stay in Atlas.
- Atlas Free clusters provide 0.5 GB storage, limit throughput to 100 operations per second, and pause after 30 days without connections. They are suitable for synthetic staging data, not production or durable user data.
- Render and Atlas free-tier limits can change. Recheck both providers' current plan details before provisioning. Do not enable Atlas backups without explicit cost approval; the optional Free-cluster backup add-on is paid.

## Network and security

- Create a dedicated Atlas database user for staging and store its connection string only as the Render API service's `MONGODB_URI` secret.
- Configure a strong, unique `JWT_SECRET` in the Render API service. Do not reuse a local, CI, or production secret.
- Restrict the Atlas project IP access list to the Render API service's outbound CIDR ranges for its selected region. Do not use `0.0.0.0/0` as a shortcut. Render's default ranges are shared and may change; recheck the service's outbound ranges if database connectivity stops working.
- Set `CORS_ORIGIN` to only the assigned HTTPS web origin. Keep `NEXT_PUBLIC_API_BASE_URL` pointed at the assigned HTTPS API URL.
- Use synthetic accounts and data only. Do not connect production databases or real user data.
- Use GitHub's `staging` environment for deployment secrets and URLs. The deploy job must run only after successful CI on a push to `main`.

## Setup ownership and rollback

The team must connect the organization repository to Render and create the Atlas cluster in organization-owned accounts. The actual service hostnames and provider credentials cannot be recorded in this repository until those resources exist. Use secret names only in repository documentation and workflow files.

Render's Free service tier supports rollback to the two most recent successful deploys. To roll back, select the last known-good deploy for the affected service in its Render dashboard, trigger the redeploy, then verify `GET /api/health` and the web `/login` route. Keep the Git commit SHA from the deploy event with the release evidence.

## Provisioning checklist after team approval

- [ ] Confirm the team accepts Render + Atlas Free and the stated cold-start/data-retention limits.
- [ ] Create Render web and API services from `render.yaml` in Singapore; record the assigned URLs in the GitHub `staging` environment variables `STAGING_WEB_URL` and `STAGING_API_URL`.
- [ ] Create an Atlas Free cluster in the nearest region Atlas currently offers at no cost; create a staging-only database user and allowlist Render's current Singapore outbound CIDRs.
- [ ] Configure Render API variables `MONGODB_URI`, `JWT_SECRET`, and `CORS_ORIGIN`; configure web variables `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_BASE_URL`.
- [ ] Create Render deploy hooks and save their URLs as GitHub environment secrets `RENDER_API_DEPLOY_HOOK_URL` and `RENDER_WEB_DEPLOY_HOOK_URL`.
- [ ] Run the first staged deployment and attach the Actions run plus health-check evidence to Issue #18.

## Provider references

- [Render free service limits](https://render.com/docs/free)
- [Render regions](https://render.com/docs/regions)
- [Render outbound IP ranges](https://render.com/docs/outbound-ip-addresses)
- [Render deploy hooks from GitHub Actions](https://render.com/docs/deploy-hooks)
- [MongoDB Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel Git repository limitations](https://vercel.com/docs/limits)
