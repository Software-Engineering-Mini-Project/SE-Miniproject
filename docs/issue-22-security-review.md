# Issue #22: staging security review

Status: review evidence recorded; application findings are addressed by the proposed [login-throttling PR #45](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/45) and [dependency remediation PR #47](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/47). Both remain unmerged. Provider-side settings and the approved SRS/STP baseline still require owner verification, so this is not a security sign-off.

## Control review

| Area | Evidence reviewed | Result / limit |
|---|---|---|
| Password storage | `server/routes/auth.js`, `server/models/user.js`, `server/tests/routes.test.mjs` | Passwords are hashed with bcryptjs cost 12; hashes are excluded from normal model selection/DTOs. Tests verify a registered password against its hash and confirm the hash is not returned. |
| Login responses and tokens | `server/routes/auth.js`, `server/middleware/authenticate.js` | Unknown users use a bcrypt timing-equalizer hash; invalid login responses are generic. JWT verification pins HS256. Default token lifetime is two hours; configured lifetime is bounded to 24 hours. No refresh or immediate revocation mechanism was found. |
| Authorization | `server/services/access.js`, `server/routes/*.js`, `server/tests/routes.test.mjs` | API routes enforce project membership/role checks server-side. Notification reads/updates are scoped to the authenticated recipient. Existing integration coverage exercises outsider and role denials. |
| Input, errors, logs | `server/utils/validation.js`, `server/middleware/error-handler.js`, `server/middleware/request-logger.js`, `server/tests/app.test.mjs` | JSON bodies are limited to 100 KB; validation is server-side; 500 responses omit exception messages; request logs omit bodies, credentials and tokens. The database startup failure log is a generic event. |
| CORS, headers, transport | `server/app.js`, `server/config/env.js`, `render.yaml` | Helmet and an exact-origin CORS allowlist are configured; the API config parser rejects paths and non-HTTP(S) origins. Render provides HTTPS at the service edge. Provider-side origin and TLS configuration were not independently inspected in this review. |
| CSV output | `server/utils/csv.js`, `server/tests/routes.test.mjs` | CSV cells neutralize spreadsheet formula prefixes; test coverage includes formula-like values. |
| Login abuse controls | `server/routes/auth.js`, `server/app.js`, `server/tests/routes.test.mjs` | PR #45 replaces process-local state with MongoDB counters shared across instances, HMAC-keyed email/IP buckets, fixed 60-second expiry, fail-closed generic errors, and Express proxy trust limited to loopback/link-local/private peers. The proposed thresholds are five failures per email+IP and 60 per IP per window. Verify the Render proxy peer range matches these trust rules after deployment. |
| Dependencies | `package-lock.json` on PR #47 | The original lockfile had a high-severity PostCSS advisory through Next.js 15.5.28. PR #47 updates Next.js to 16.4.4 and resolves nested PostCSS to 8.5.23. On that candidate lockfile, `npm audit --omit=dev --audit-level=high` reports zero production vulnerabilities. The full-tree scan reports 16 moderate development-tool findings, primarily ESLint/minimatch; npm's suggested automatic fixes downgrade ESLint packages to incompatible majors and were not applied. CI must validate the candidate lockfile before merge. |
| Deployment secrets | `render.yaml`, `.env.example` files, `docs/staging-deployment.md` | Source contains variable names/placeholders only. Secret values and the live Render/GitHub environment settings were not read into this report. Confirm secret rotation and environment access directly in the provider before broader exposure. |

## Requirement mapping and acceptance limits

The approved SRS v1.3 and governing STP are not present in the repository; `docs/requirements-traceability.md` records that available SRS/STP documents are approval-pending v1.0 candidates. This report maps evidence to the explicit controls in Issue #22 and does not invent SRS requirement IDs.

Issue #22 remains open until PRs #45 and #47 are reviewed and merged, provider-side staging secrets/CORS/proxy settings are verified, and the product/security owners accept remaining token-revocation and operational limits against the approved requirements. The current candidate production dependency audit is clean at the high severity threshold; moderate dev-tool findings are disclosed above. No production rollout is authorized by this review.
