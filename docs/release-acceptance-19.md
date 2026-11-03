# Release acceptance evidence — issue #19

Status: **in progress**, not a release sign-off. Evaluated local `origin/main` commit `1f1c0b2f10958b607141f5293fd706e734249b5c` on Windows, Node 24.21.0 and npm 11.19.0. The working tree was clean before installation; this was an existing checkout, not a fresh clone. Results were obtained on 2026-11-01 with synthetic fixtures.

| Check | Outcome | Evidence and limits |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | Pass | Installed from lockfile with network access; npm warned about unapproved optional install scripts. |
| `npm run lint` | Pass | API and web lint. |
| `npm test` | Pass | API 29/29 and web 26/26. API integration tests use a seeded temporary MongoDB. Includes Admin and membership access checks. |
| `NEXT_PUBLIC_API_MODE=mock npm run build` | Pass | Production web build; network access required for Google Fonts. |
| `NEXT_PUBLIC_API_MODE=mock npm run test:e2e` | Pass | Chromium TC-E2E-01, 1/1; browser mock, not a live API/MongoDB journey. |
| Live HTTP browser journey with seeded local MongoDB | Not run | A separately configured local MongoDB was not established for this pass. |
| Responsive/accessibility manual checks | Not run | Requires browser/device and assistive technology checks. PR #24 has separate proposed automated evidence; it is not included in this main commit. |

The initial sandboxed test failed when local server/MongoDB processes could not start, and the sandboxed build could not resolve Google Fonts. Both were rerun successfully with the necessary local process and network access; those failures alone do not establish product defects.

## Backlog review and remaining work

- #2 is closed; the API suite above provides current automated evidence but does not replace a full acceptance review.
- #4 and #6 have pending PRs #34 and #26; CI/QA sign-off and complete traceability remain to be reviewed.
- #5 has PR #25; #7, #8, #9 and #10 have PRs #29, #30, #31 and #32, respectively. Their added tests are not included in the tested main commit. Review each issue against its acceptance criteria after the relevant PR is reviewed.
- #17 and #18 have draft/proposed staging work in PRs #35 and #36. Hosting approval, provisioning, and an actual staging deployment/smoke run remain outstanding.
- #20 requires an approved Admin onboarding and recovery decision. #21–#23 also require their own acceptance evidence.

No issue is closed by this report. No new product defect was confirmed in this limited pass. Complete a fresh-checkout live integration run, accessibility review, remaining issue-by-issue acceptance, and staging setup before recommending staging acceptance. Retain CI run links and sanitized evidence with the final report.
