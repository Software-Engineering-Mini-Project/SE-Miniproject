# Issue #22: staging security review

Status: review evidence recorded; a confirmed login-throttling gap is tracked in [Issue #42](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/42). The dependency vulnerability scan and provider-side settings could not be verified in this environment, so this is not a security sign-off.

## Control review

| Area | Evidence reviewed | Result / limit |
|---|---|---|
| Password storage | `apps/api/src/routes/auth.js`, `apps/api/src/models/user.js`, `apps/api/tests/routes.test.mjs` | Passwords are hashed with bcryptjs cost 12; hashes are excluded from normal model selection/DTOs. Tests verify a registered password against its hash and confirm the hash is not returned. |
| Login responses and tokens | `apps/api/src/routes/auth.js`, `apps/api/src/middleware/authenticate.js` | Unknown users use a bcrypt timing-equalizer hash; invalid login responses are generic. JWT verification pins HS256. Default token lifetime is two hours; configured lifetime is bounded to 24 hours. No refresh or immediate revocation mechanism was found. |
| Authorization | `apps/api/src/services/access.js`, `apps/api/src/routes/*.js`, `apps/api/tests/routes.test.mjs` | API routes enforce project membership/role checks server-side. Notification reads/updates are scoped to the authenticated recipient. Existing integration coverage exercises outsider and role denials. |
| Input, errors, logs | `apps/api/src/utils/validation.js`, `apps/api/src/middleware/error-handler.js`, `apps/api/src/middleware/request-logger.js`, `apps/api/tests/app.test.mjs` | JSON bodies are limited to 100 KB; validation is server-side; 500 responses omit exception messages; request logs omit bodies, credentials and tokens. The database startup failure log is a generic event. |
| CORS, headers, transport | `apps/api/src/app.js`, `apps/api/src/config/env.js`, `render.yaml` | Helmet and an exact-origin CORS allowlist are configured; the API config parser rejects paths and non-HTTP(S) origins. Render provides HTTPS at the service edge. Provider-side origin and TLS configuration were not independently inspected in this review. |
| CSV output | `apps/api/src/utils/csv.js`, `apps/api/tests/routes.test.mjs` | CSV cells neutralize spreadsheet formula prefixes; test coverage includes formula-like values. |
| Login abuse controls | `apps/api/src/routes/auth.js`, `apps/api/tests/routes.test.mjs` | **Finding:** the failed-login counter is an in-memory `Map`, keyed only by normalized email. It resets on restart, is not shared across replicas, and permits targeted account lockout. The single-process test does not establish deploy-safe rate limiting. Remediation is tracked in #42. |
| Dependencies | `package-lock.json` | A production dependency scan was attempted with `npm audit --omit=dev --audit-level=high`, but npm could not resolve `registry.npmjs.org` (`ENOTFOUND`). Vulnerability status is therefore unknown, not clean. Rerun when registry access is available. |
| Deployment secrets | `render.yaml`, `.env.example` files, `docs/staging-deployment.md` | Source contains variable names/placeholders only. Secret values and the live Render/GitHub environment settings were not read into this report. Confirm secret rotation and environment access directly in the provider before broader exposure. |

## Requirement mapping and acceptance limits

The approved SRS v1.3 and governing STP are not present in the repository; `docs/requirements-traceability.md` records that available SRS/STP documents are approval-pending v1.0 candidates. This report maps evidence to the explicit controls in Issue #22 and does not invent SRS requirement IDs.

Issue #22 remains open until #42 is addressed, the dependency scan produces a recorded result, provider-side staging settings are verified, and the product/security owners accept any remaining token-revocation and operational limits. No production rollout is authorized by this review.
