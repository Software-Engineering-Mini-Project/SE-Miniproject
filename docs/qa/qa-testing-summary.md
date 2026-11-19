# Consolidated QA and testing summary

Repository baseline: [`efd89fc0195a`](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/efd89fc0195a4ea03d8bade50985b0bd95930bbc). Prepared from existing repository evidence; no new functional execution or production changes were performed for this documentation update.

## Recorded disposition

- [Issue #72](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72): **closed**, 2026-11-15 09:41:05 UTC; [assisted browser/API result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892285836) plus personally recorded Safari checks.
- [Issue #81](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81): **closed**, 2026-11-17 16:20:44 UTC; [final sign-off](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6953892335) explicitly records expired-invitation rejection as **not manually tested, covered by automated tests**.
- Known bugs [#84](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/84) and [#85](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/85): **closed through PR #86**, merged 16 November 2026. The supplied 15 November handoff describes an older pending-fix state.
- Latest main Actions result: [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/44026258285) at `efd89fc0195a4ea03d8bade50985b0bd95930bbc`. This is separate evidence from the live-site Safari checks and does not prove deployment.

## Evidence categories

| Category | What it establishes | Limits |
|---|---|---|
| Personally recorded manual QA | Safari issue comments explicitly describing actions, observations and screenshots | Covers the recorded scenarios only; do not relabel all API checks as personal manual tests |
| Assisted live browser/API checks | Initial #72/#81 comments distinguish Chromium automation and direct live API checks | Sampled permissions/fields, not every matrix combination; no multi-day chart evolution |
| CI execution | GitHub run/attempt/job results and available annotations | Authenticated logs recovered for 11 diagnostic jobs after initial HTTP 403; unresolved root-cause limits remain in CI report |
| Team-provided local automation | Supplied qa-precheck-for-trisha.md and taskline-feature-check.pdf | Historical author-reported results; not rerun for this report and not live-site evidence |
| Existing repository reports | Acceptance, security, accessibility, performance and traceability documents | Scoped to their stated commit/environment; some status prose is stale |

## Sprint 4 — issue #72

| Flow | Recorded result and mode | Evidence |
|---|---|---|
| Organisation creation/join and code rotation | PASS reported in assisted live browser/API checks; old code denied, new code accepted | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892285836) |
| Admin/Member organisation views | PASS reported in assisted browser/API checks; admin-only controls hidden from Member | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892285836) |
| Cross-organisation isolation | PASS reported in assisted checks; project/task/report access denied across organisations | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892285836) |
| Quick add | PASS personally recorded in Safari: tomorrow, !high and @me saved and survived refresh | [Screenshot/result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892427763) |
| Checklists | PASS personally recorded in Safari: unchecked and checked states persisted after refresh | [Screenshot/result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892422175) |
| Upcoming | PASS personally recorded: Overdue/Today/Tomorrow and Later/No due date | [First buckets](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892445766), [remaining buckets](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892473289) |
| Open/private projects | PASS reported in assisted API/browser checks; open join succeeds and private non-member access fails | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892285836) |
| Roles/ownership/deactivation | PASS for sampled permissions in assisted checks; transfer/back, deactivation and reactivation exercised | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892285836) |
| Delivery forecast | PASS for manual display check: insufficient-history guidance and confidence dates/risk flags when sufficient history exists | [Screenshot/result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/72#issuecomment-6892542505) |

Manual forecast display verification does not independently validate the statistical model. The initial report explicitly says not every permission combination was tested. Closure is a recorded team disposition, not proof of universal correctness.

## Sprint 5 — issue #81

| Flow | Recorded result and mode | Evidence |
|---|---|---|
| Work-item keys | PASS manually recorded in Safari: upper/lower-case search returns only QAT-13. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892747964) |
| Types, points and labels | PASS manually recorded: Task changed to Bug, 5 points and manualqa saved; label filter isolates the task; assisted API checks separately cover supported point values and invalid 4. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892878144) |
| Type filter | PASS manually recorded: Bug filter returns QAT-2, QAT-6 and QAT-13 with Bug icons. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892967864) |
| Epic membership/progress | PASS manually recorded: QAT-13 added under QAT-4; progress moved from 1/2, 3/8 points to 2/2, 8/8 points. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6893067256) |
| Status history | PASS manually recorded: actor and To Do → In Progress transition persist after refresh. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892770565) |
| Priority history | PASS manually recorded: High → Low with correct actor and values. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892802567) |
| Sprint report/velocity | PASS manually recorded for displayed totals: 7 committed, 5 completed, one carried item; average completed velocity 4 from 3 and 5. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892551415) |
| Burndown chart/table | PASS manually recorded for chart/table consistency: 0 remaining and ideal 7 → 0; multi-day changes not tested. | [Recorded result](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892588602) |
| Nested Epic prevention | PASS in assisted live API report; no separate personal manual result recorded | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892289658) |
| Backlog/sprint lifecycle | PASS reported for assisted API and separate browser lifecycle: create, plan, start, complete, carry-over, preserved records | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892289658) |
| Invite links: creation/acceptance/reuse, wrong email and revocation | PASS reported in assisted live browser/API results; no separate personal Safari execution recorded | [Initial results](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6892289658) |
| Expired invite | NOT MANUALLY TESTED; accepted automated-test coverage exception, not a manual PASS | [Final sign-off](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/81#issuecomment-6953892335) |

The first #81 comment marked expiry BLOCKED and advised keeping the issue open. The later 17 November sign-off supersedes that blocker: it documents the team-provided exception and refers to `server/tests/invitations.test.mjs` (410 INVITATION_EXPIRED, no account created). No expired link was manufactured in production.

## Team-provided automated pre-checks

- `qa-precheck-for-trisha.md` reports a 13 November pre-check on feat/work-items: 50/50 browser E2E checks against the real server/database, changed mock specs repeated five times, and 85 + 111 unit/component checks. These are reported historical results, not tests run by this documentation change.
- `taskline-feature-check.pdf` describes 81/81 script-driven Chromium checks with 75 screenshots on a locally seeded database on 15 November. It explicitly says it is not manual sign-off. Demo accounts in it do not exist on the live site.
- The handoff specifically exempts manual expired-link checking because expiry requires waiting seven days or changing the production database. It permits closure of #81 if the assignee is satisfied with the remaining results.
- The PDF states limits: wrong-email registration, expired links, renamed-key old links, mouse backlog dragging, generation of a new reminder, live deployment, screen readers and other browsers were not all covered by that particular run. Do not turn the 81/81 result into complete product coverage.

## Defect and remediation register

| Reference | Trigger and impact | Cause / change | Current recorded status | Evidence limit |
|---|---|---|---|---|
| [#84](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/84) | Drop at the top of a long Done column, or keyboard transfer, returns card to the old column | closestCorners favored the adjacent shorter column; collision selection changed in ca27cc5 | Closed; [PR #86](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/86) merged | PR reports regression component tests and manual local mouse/keyboard checks; no new deployed retest here |
| [#85](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/85) | Backlog and report differ by one day between midnight and 05:30 IST | Local day versus UTC; 718de49 aligns Backlog days-left with report UTC day | Closed; [PR #86](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/86) merged | PR says unit/component coverage, not browser retest |
| [PR #83](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/83), 64fefee | Admin updates role/deactivation while search is loading; Users page crashes | Avoid mutating an unloaded list, then reload; regression component coverage | Merged | Product race identified in PR, separate from test-only flake |
| [PR #83](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/83), 00f3a1f | Burndown keyboard test is affected by pointer hover | Park pointer off the chart before keyboard navigation | Merged | Test reliability correction; not an app defect |
| [PR #87](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/87), 484df8a | Next.js security patch and auth showcase contrast | Next/eslint-config-next 16.4.6; theme-aware foregrounds | Merged | PR author reports zero production audit vulnerabilities, seven moderate full-tree findings and no local tests/build; subsequent Actions run is separate evidence |

The CI report separately classifies workflow/configuration defects, test mock errors and unexplained failing attempts. Missing artifacts and Node action deprecation warnings are not automatically the root cause of an exit-1 job.

## Broader issue and requirement traceability

The companion [issue inventory](issue-inventory.csv) lists all 40 non-PR issues and their current recorded state. All were closed in this snapshot. Relevant evidence chains:

| Area | Issues / delivery PRs | Existing evidence |
|---|---|---|
| Setup, API and frontend | #1–#3; PRs #11–#13, #15 | README, API contract, tests |
| Automated checks and traceability | #4/#6; PRs #14/#16, #26, #28–#34, #39 | requirements-traceability.md, CI workflow, E2E suite; #14/#27/#33 closed without merge |
| Task creation/auth/task changes/projects/reporting | #5/#7–#10; PRs #25/#29–#32 | API integration, UI components, real/mock E2E |
| Staging and initial acceptance | #17–#19; PRs #35–#37/#40/#49/#51–#53 | staging docs, release-acceptance-19.md |
| Security/accessibility/comments | #20–#23/#42/#46; PRs #38/#41/#43–#45/#47/#55 | onboarding proposal, security/accessibility evidence, throttling review |
| Sprint 4 | #65–#72; PRs #59–#64 | features.md, organisations.md, #72 comments |
| Sprint 5 | #73–#81; PRs #82/#83 | features.md, API contract, #81 comments, redesign evidence |
| Follow-up fixes | #84/#85; PRs #86/#87 | regression tests, PR validation statements, main CI |

Some older checked-in reports still say issues or PRs are open/unmerged. Their historical findings remain useful, but current PR/issue API status takes precedence for disposition. In particular, `release-acceptance-19.md` is explicitly a limited 1 November local pass, and `issue-23-accessibility-evidence.md` retains screen-reader/cross-browser/zoom gaps. Closed issue status alone does not prove those missing checks were subsequently executed.

## Limits and handoff

- This report adds no new live-site, load, security, accessibility, screen-reader or cross-browser test claim.
- The approved baseline SRS/STP discrepancy remains as described in `docs/requirements-traceability.md`; no new requirement IDs or unrecorded approvals are invented.
- Production Vercel configuration, secrets, database index execution and actual deployment smoke results were not inspected. They are outside this documentation request.
- No duplicate bug issues are needed for #84/#85. Follow the existing issue/PR evidence and explicitly preserve any unverified areas.
- Submit these two reports and the four CSV evidence registers in a documentation PR. New CI on that PR validates repository checks but does not retroactively re-run or certify all historical manual scenarios.

## Sources

- Linked GitHub issue comments, PR descriptions, commit diffs, Actions APIs and annotations cited above.
- Repository files at the baseline SHA: `README.md`, `.github/workflows/ci.yml`, `docs/features.md`, `docs/backend-api-contract.md`, `docs/requirements-traceability.md`, `docs/release-acceptance-19.md`, `docs/issue-22-security-review.md`, `docs/issue-23-accessibility-evidence.md`, `docs/performance-evidence.md`.
- User-supplied `qa-precheck-for-trisha.md` and `taskline-feature-check.pdf`. These are third-party historical evidence, not new instructions to rerun or modify production. Their reported outcomes are attributed above.
