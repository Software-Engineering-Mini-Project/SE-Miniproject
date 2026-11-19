# Pull request and CI failure analysis

Repository: [SE-Miniproject](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject)
Source snapshot: `efd89fc0195a4ea03d8bade50985b0bd95930bbc` (`origin/main`). This is a retrospective documentation review, not a new application test run.

## Findings and scope

- Reviewed all **47 PR records**, their **177 PR/commit memberships** (**157 distinct SHAs**), and all **222 Actions run records** returned across three pages.
- Expanded reruns into **244 attempts**: **185 successful, 26 failed, 33 cancelled**. Latest conclusions per run are 185 successful, 23 failed, 14 cancelled. The three extra failures were hidden by later successful reruns.
- PR outcomes: **44 merged**, **3 closed without merging**. Shared commits in stacked or replacement PRs are not separate defects.
- Latest observed main run: [run 44026258285](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/44026258285), **success**, SHA `efd89fc0195a4ea03d8bade50985b0bd95930bbc`, created 2026-11-17 05:44:59 UTC.
- Historical window: 2026-10-16 04:18:22 UTC through 2026-11-17 05:44:59 UTC. The appendices preserve all returned metadata, including successful and cancelled attempts.

## Evidence rules and access limits

- Run/job APIs establish outcomes, SHA, job/step and timestamps. Check-run annotations establish only the messages they actually contain. Public run HTML establishes workflow-validation errors.
- Full Actions log ZIP retrieval returned HTTP 403 without working GitHub authentication. Exact test traces unavailable through public annotations remain **unverified**; no raw log contents are invented.
- A failed step completion timestamp is the observable failure endpoint, not necessarily the instant the first assertion failed. For invalid workflow runs with no job, updated_at is used and explicitly labelled. UTC and IST (+05:30) are both recorded.
- PR matching uses exact SHA membership returned by `/pulls/{number}/commits`. A SHA can occur in multiple PRs. This is not a claim that the run was triggered separately by each PR. Empty membership means no exact match, not missing history.
- GitHub latest run records hide older attempts; those were queried separately. Cancelled runs are not counted as failed tests. Statuses are the historical snapshot, not a promise about future runs or deployed behavior.

## Failure families and diagnosis

### F01: Missing dependency lockfile (2 failed attempts)

**Evidence:** Confirmed by Actions annotation.

setup-node cache failed: “Dependencies lock file is not found”. This happened before npm installation or application tests.

PR #11 adds root package-lock.json and the npm workspace scaffold. Fix reference: [2a97f8c27bb2](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/2a97f8c27bb23fc74df2bdb6fe741d7f888db538).

### F02: Invalid workflow-level expression (8 failed attempts)

**Evidence:** Confirmed on all eight public run summaries.

Workflow validation rejected github.event_name inside top-level name: “Unrecognized named-value: github” at line 1, column 7. No jobs were created.

PR #34 replaces the top-level name with CI and moves the event expression into the job name. PR #33 shares the source commits but closed without merging. Fix reference: [2769b0f0c0a7](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/2769b0f0c0a7c75d276b268a1e84d4fa44f566d1).

### F03: Missing comment-deletion test mock (2 failed attempts)

**Evidence:** Confirmed annotation and matching fix.

features.test.mjs:433 tried mockResolvedValue on an undefined mock; the mock API comments object lacked remove.

PR #41 adds comments.remove to the UI test mock. Fix reference: [769169da87e5](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/769169da87e55082054821522e0559e4e370cadf).

### F04: Next.js 16 lint/config migration (2 failed attempts)

**Evidence:** Failed lint step confirmed; cause inferred from follow-up diff.

Lint exited 2 after the Next.js dependency upgrade. Follow-up changes migrate ESLint configuration and adapt components to new lint rules. The exact diagnostic is unavailable without full logs.

PR #47 includes the lint migration. Do not treat the inferred explanation as a recovered log message. Fix reference: [f398b1562d11](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/f398b1562d11c1a683eaac369e34ed291136f8cd).

### F05: Dashboard invalidation test mock (3 failed attempts)

**Evidence:** Confirmed annotation and matching fix.

dashboard-invalidation.test.mjs:15 failed while reading count from undefined. The following commit repairs the dashboard invalidation mock.

Fix on the PR #58 branch; the initial intermediate SHA 6192a052 is not returned in the current PR commit lists. Fix reference: [a3f7188b8bfa](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/a3f7188b8bfa5df0ab3c2df74d234e0af2fcb871).

### F06: Vitest configuration/API-mode mismatch (2 failed attempts)

**Evidence:** Cause reported in fix commit and PR #59; individual raw log unavailable.

Commit 1826269 states that @fixtures alias resolution and HTTP mode for UI tests caused PR #58 CI failure while CI exported mock mode. Public annotations only expose exit code 1.

Fixed in PR #59 while incorporating PR #58. This is an author-documented diagnosis, not an independently recovered failure trace. Fix reference: [1826269b60a0](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/1826269b60a0408bf95e9506959df985469b26cd).

### F07: Organisation integration unit-test failure (3 failed attempts)

**Evidence:** Failed step confirmed; exact cause unverified.

The unit/contract test step exited 1 at 8f8397c3. Later commit 06c967c updates organisation mocks, registration tests and dashboard invalidation expectations, but no public assertion identifies which caused these runs.

PR #64 later passes at its final head. Candidate repair evidence only; exact root cause remains unavailable. Fix reference: [06c967cdf4de](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/06c967cdf4de8b0da771fe231afb002e9f35b034).

### F08: Sprint 5 real-API E2E failure (1 failed attempts)

**Evidence:** Failed step confirmed; two causes reported in PR #83.

PR #83 reports a Users-page race during a pending search and pointer interference with the burndown keyboard test. It identifies fixes 64fefee and 00f3a1f. Public job annotations do not identify the failing test names.

64fefee fixes the product race; 00f3a1f moves the test pointer away. Preserve the distinction between a product bug and a flaky test. Fix reference: [00f3a1f16a6d](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/00f3a1f16a6d77dc722a674a210cce461838eb13).

### F09: E2E attempt failed, unchanged-SHA rerun passed (3 failed attempts)

**Evidence:** Failed step and rerun outcome confirmed; root cause unknown.

The browser step exited 1, but accessible annotations contain no test-level trace. Attempt 2 passed at the identical SHA. This establishes recovery on retry, not the cause of the failure.

No code fix can be attributed. Do not automatically label these as flakiness or product defects.

## Failure register

Every failed attempt is listed below. Full SHAs, branch, job IDs, attempt-start times and timestamp basis are in [ci-failures.csv](ci-failures.csv).

| Run / attempt | PRs containing SHA | Commit | Failure endpoint UTC | Failure endpoint IST | Failed step | Family |
|---|---|---|---|---|---|---|
| [38849935509 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/38849935509/attempts/1) | No exact match | [6548e42558f9](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/6548e42558f9f709982f4020d691ee6d64207fdb) | 2026-10-16 04:18:28 UTC | 2026-10-16 09:48:28 +05:30 | Use Node.js 22.x | F01 |
| [38900174212 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/38900174212/attempts/1) | No exact match | [b561e6749c63](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/b561e6749c63bb68f7cabfc1ea382f7680ec910d) | 2026-10-16 12:23:37 UTC | 2026-10-16 17:53:37 +05:30 | Use Node.js 22.x | F01 |
| [41277661358 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277661358/attempts/1) | [#32](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/32) | [4672f62efb08](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/4672f62efb086a7e8fc599c7e04eb794e420ad4d) | 2026-11-01 05:37:29 UTC | 2026-11-01 11:07:29 +05:30 | Workflow validation | F02 |
| [41277664938 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277664938/attempts/1) | [#31](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/31) | [d6fdd2ea217b](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/d6fdd2ea217bd2d91c998059c6f73e92362d7c76) | 2026-11-01 05:37:32 UTC | 2026-11-01 11:07:32 +05:30 | Workflow validation | F02 |
| [41277668636 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277668636/attempts/1) | [#30](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/30) | [cce124ed6844](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/cce124ed6844529b486ebfb21eac70939ee0f0a2) | 2026-11-01 05:37:36 UTC | 2026-11-01 11:07:36 +05:30 | Workflow validation | F02 |
| [41277671552 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277671552/attempts/1) | [#29](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/29) | [c8f852b402d0](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/c8f852b402d07838010087be2abb33362b50fc65) | 2026-11-01 05:37:39 UTC | 2026-11-01 11:07:39 +05:30 | Workflow validation | F02 |
| [41277675288 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277675288/attempts/1) | [#28](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/28) | [0c8d74ceb995](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/0c8d74ceb9952d9827b9e55722be67c8fe5868db) | 2026-11-01 05:37:43 UTC | 2026-11-01 11:07:43 +05:30 | Workflow validation | F02 |
| [41277678732 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277678732/attempts/1) | [#26](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/26) | [4cc9eab80ab0](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/4cc9eab80ab003c871edc553b0bb4fd85c33b38e) | 2026-11-01 05:37:47 UTC | 2026-11-01 11:07:47 +05:30 | Workflow validation | F02 |
| [41277682515 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277682515/attempts/1) | [#25](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/25) | [89e910794361](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/89e9107943611b250af9ddd38fa5bf670b6c7481) | 2026-11-01 05:37:51 UTC | 2026-11-01 11:07:51 +05:30 | Workflow validation | F02 |
| [41277699313 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277699313/attempts/1) | [#33](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/33), [#34](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/34) | [acfd60595eaf](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/acfd60595eafbdb5fa7de469ca96bf3b6873ea71) | 2026-11-01 05:38:08 UTC | 2026-11-01 11:08:08 +05:30 | Workflow validation | F02 |
| [41497352848 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41497352848/attempts/1) | [#41](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/41) | [844822bfd800](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/844822bfd800aa0f72bc7be43a28283678901cf3) | 2026-11-02 18:08:20 UTC | 2026-11-02 23:38:20 +05:30 | Run API and web unit and contract tests | F03 |
| [41497361478 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41497361478/attempts/1) | [#41](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/41) | [844822bfd800](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/844822bfd800aa0f72bc7be43a28283678901cf3) | 2026-11-02 18:07:30 UTC | 2026-11-02 23:37:30 +05:30 | Run API and web unit and contract tests | F03 |
| [41500670880 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41500670880/attempts/1) | [#47](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/47) | [986b5ccd2ebf](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/986b5ccd2ebfa81e4bed0d55f62442206cf988c1) | 2026-11-02 18:28:12 UTC | 2026-11-02 23:58:12 +05:30 | Lint API and web | F04 |
| [41500706035 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41500706035/attempts/1) | [#47](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/47) | [986b5ccd2ebf](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/986b5ccd2ebfa81e4bed0d55f62442206cf988c1) | 2026-11-02 18:27:55 UTC | 2026-11-02 23:57:55 +05:30 | Lint API and web | F04 |
| [41703058953 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41703058953/attempts/1) | No exact match | [0013a75c764a](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/0013a75c764a0ae963c7e3a4f4e499b079007419) | 2026-11-03 19:29:19 UTC | 2026-11-04 00:59:19 +05:30 | Run real API critical journey | F09 |
| [41870359424 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41870359424/attempts/1) | No exact match | [6192a0521073](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/6192a05210734672e0716b73b8526db43affc549) | 2026-11-04 16:45:59 UTC | 2026-11-04 22:15:59 +05:30 | Run API and web unit and contract tests | F05 |
| [41871033574 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41871033574/attempts/1) | [#58](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/58), [#59](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/59) | [3e6c522956d9](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/3e6c522956d92c534488ff2e9f970b6926bb3b1d) | 2026-11-04 16:49:40 UTC | 2026-11-04 22:19:40 +05:30 | Run API and web unit and contract tests | F05 |
| [41871115905 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41871115905/attempts/1) | [#58](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/58), [#59](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/59) | [3e6c522956d9](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/3e6c522956d92c534488ff2e9f970b6926bb3b1d) | 2026-11-04 16:50:12 UTC | 2026-11-04 22:20:12 +05:30 | Run API and web unit and contract tests | F05 |
| [41878454067 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41878454067/attempts/1) | [#58](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/58), [#59](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/59) | [273cbab8e295](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/273cbab8e2955dcc47c9ceb6eb94a91ada2b50df) | 2026-11-04 17:34:23 UTC | 2026-11-04 23:04:23 +05:30 | Run API and web unit and contract tests | F06 |
| [41878462692 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41878462692/attempts/1) | [#58](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/58), [#59](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/59) | [273cbab8e295](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/273cbab8e2955dcc47c9ceb6eb94a91ada2b50df) | 2026-11-04 17:34:31 UTC | 2026-11-04 23:04:31 +05:30 | Run API and web unit and contract tests | F06 |
| [42180271812 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42180271812/attempts/1) | No exact match | [33ce6f418cee](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/33ce6f418cee95cd31c9ce73a34d2035aca901f4) | 2026-11-06 07:24:12 UTC | 2026-11-06 12:54:12 +05:30 | Run all browser end-to-end tests | F09 |
| [42504451088 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42504451088/attempts/1) | [#64](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/64) | [8f8397c31915](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/8f8397c31915865a8d9c51b9db7e4287cdb9204e) | 2026-11-08 17:22:12 UTC | 2026-11-08 22:52:12 +05:30 | Run API and web unit and contract tests | F07 |
| [42504816168 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42504816168/attempts/1) | [#64](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/64) | [8f8397c31915](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/8f8397c31915865a8d9c51b9db7e4287cdb9204e) | 2026-11-08 17:26:23 UTC | 2026-11-08 22:56:23 +05:30 | Run API and web unit and contract tests | F07 |
| [42504832843 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42504832843/attempts/1) | [#64](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/64) | [8f8397c31915](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/8f8397c31915865a8d9c51b9db7e4287cdb9204e) | 2026-11-08 17:26:22 UTC | 2026-11-08 22:56:22 +05:30 | Run API and web unit and contract tests | F07 |
| [43154904783 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/43154904783/attempts/1) | [#82](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/82) | [95de192509c7](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/95de192509c76a015aeea67e6916afd5acd00ad8) | 2026-11-12 04:33:45 UTC | 2026-11-12 10:03:45 +05:30 | Run all browser end-to-end tests against the real API and MongoDB | F09 |
| [43404334634 / 1](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/43404334634/attempts/1) | [#83](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/83) | [47acbadb967e](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/commit/47acbadb967e22c0fd87e5b465d004345f1f035b) | 2026-11-13 09:57:24 UTC | 2026-11-13 15:27:24 +05:30 | Run all browser end-to-end tests against the real API and MongoDB | F08 |

## PR inventory

The linked commit inventory contains every returned PR commit, its full SHA, subject and timestamps. Failed attempts below count exact member-SHA matches; shared commits can be listed against more than one PR, so do not sum this column to count failures. Runs on merge SHAs or unlisted intermediate SHAs remain in the failure register.

| PR | Outcome | Title | Commit count | Member-SHA failed attempts | Final PR-head CI evidence |
|---|---|---|---|---|---|
| [#11](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/11) | Merged | chore: scaffold task manager application | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/40296682781) |
| [#12](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/12) | Merged | Frontend foundation, synthetic test data and CI (on top of repo skeleton) | 12 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/40297772771) |
| [#13](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/13) | Merged | feat(backend): add API and database foundation | 6 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/40371530454) |
| [#14](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/14) | Closed without merge | E2E smoke test (TC-E2E-01) and CI job for #4 | 3 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/40370686682) |
| [#15](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/15) | Merged | fix(api): review fixes for #13 (login timing, duplicate keys, reminders) | 4 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/40376679293) |
| [#16](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/16) | Merged | E2E smoke test (TC-E2E-01) and CI job for #4 | 3 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/40378103301) |
| [#24](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/24) | Merged | Accessibility and responsive checks (TC-UX-01) with fixes for #23 | 11 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41474208860) |
| [#25](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/25) | Merged | test(api): cover TC-Task-01 task creation | 3 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277833049) |
| [#26](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/26) | Merged | docs: record issue 1-6 traceability evidence | 7 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41475550051) |
| [#27](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/27) | Closed without merge | test(api): cover TC-Task-01 task creation | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41084899596) |
| [#28](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/28) | Merged | test(web): add component coverage for core features | 4 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277829816) |
| [#29](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/29) | Merged | test(auth): verify registration, login, and profile management | 3 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277825110) |
| [#30](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/30) | Merged | test(tasks): verify task editing and status changes | 3 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277821285) |
| [#31](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/31) | Merged | test(projects): verify member management and board access | 3 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277813044) |
| [#32](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/32) | Merged | test(reporting): verify search dashboard and CSV export | 3 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41277812402) |
| [#33](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/33) | Closed without merge | Chore/ci one check per event | 2 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41281497420) |
| [#34](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/34) | Merged | ci: consolidate workflow checks per event | 2 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41281497420) |
| [#35](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/35) | Merged | docs(devops): propose a staging hosting target | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41281701949) |
| [#36](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/36) | Merged | ci(devops): add gated staging deployment workflow | 2 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41477079468) |
| [#37](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/37) | Merged | docs: record initial release acceptance evidence | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41282404705) |
| [#38](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/38) | Merged | docs: propose Admin onboarding and recovery controls | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41282452341) |
| [#39](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/39) | Merged | fix(ci): preserve main checks and align ESLint | 3 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41469178872) |
| [#40](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/40) | Merged | docs: improve staging configuration and teammate setup | 2 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41485429148) |
| [#41](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/41) | Merged | feat: add authorized comment deletion and record acceptance evidence | 3 | 2 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41498686131) |
| [#43](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/43) | Merged | docs: record staging security review findings | 2 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41500945804) |
| [#44](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/44) | Merged | docs: record accessibility acceptance evidence and gaps | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41496540349) |
| [#45](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/45) | Merged | fix: share failed login limits across API instances | 2 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41500835652) |
| [#47](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/47) | Merged | fix: upgrade Next.js to resolve high PostCSS advisory | 2 | 2 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41501472276) |
| [#49](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/49) | Merged | deploy: prepare a safe Vercel staging migration | 5 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41582995215) |
| [#51](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/51) | Merged | feat(api): prepare Express API for Vercel | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41590035125) |
| [#52](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/52) | Merged | refactor: convert to single-app monolith | 5 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41671137164) |
| [#53](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/53) | Merged | Fix same-origin API deployment on Vercel | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41677162062) |
| [#54](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/54) | Merged | Reduce login latency | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41687324721) |
| [#55](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/55) | Merged | Harden authentication and unify API runtime | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41690036688) |
| [#56](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/56) | Merged | feat: register rate limit, paged lists, error states, query cache | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41694547657) |
| [#57](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/57) | Merged | perf: single dashboard call, remove N+1 queries, bulk read-all | 4 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41702407292) |
| [#58](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/58) | Merged | fix: dashboard consistency, unread poll, timing accuracy | 3 | 4 | [failure](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/41878462692) |
| [#59](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/59) | Merged | fix: end-to-end validation fixes, admin user management, insights (includes #58) | 14 | 4 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42168728364) |
| [#60](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/60) | Merged | feat: per-project roles (Owner/Manager/Member/Viewer), ownership transfer, account deactivation | 4 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42167031144) |
| [#61](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/61) | Merged | Delivery forecast: finish dates and due-date risk from the team's own pace | 2 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42111840697) |
| [#62](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/62) | Merged | Quick add, task checklists and an Upcoming agenda | 3 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42173752044) |
| [#63](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/63) | Merged | Open workspace: anyone creates projects, open projects can be joined, members edit tasks | 4 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42178011336) |
| [#64](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/64) | Merged | feat: organisations, quick add, checklists, Upcoming agenda and open workspace | 13 | 3 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/42510247008) |
| [#82](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/82) | Merged | Work-item keys, types, story points, labels and epics (#73, #74) | 6 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/43162738990) |
| [#83](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/83) | Merged | Sprint 5: activity history, backlog and sprints, burndown, invite links, organisation wording, redesign | 15 | 1 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/43426030611) |
| [#86](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/86) | Merged | Fix: card can't be moved into a long board column (#84); days left differs between Backlog and sprint report (#85) | 2 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/43717553523) |
| [#87](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/pull/87) | Merged | Fix Next.js security and auth showcase contrast | 1 | 0 | [success](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs/44024917634) |

## CI versus deployment

The current `.github/workflows/ci.yml` verifies install, lint, API/web tests, mock build/E2E and real-API/MongoDB E2E, with a MongoDB 7 service and 30-minute job timeout. Main pushes use separate concurrency groups; superseded PR/non-main runs may be cancelled. This snapshot has only that workflow file.

History also contains 14 `Deploy staging` runs. Their Actions conclusions do not independently prove a Vercel production deployment or smoke result. Current README documents Vercel Git integration and same-origin API configuration; production provider logs and settings were not available in this review. No database commands or deployments were performed.

## Supporting evidence

- [All PR commits](pr-commit-inventory.csv)
- [All run attempts](ci-run-attempts.csv)
- [Failed attempts](ci-failures.csv)
- [Issue inventory](issue-inventory.csv)
- [QA/testing summary](qa-testing-summary.md)
- Public API entry points: [PRs](https://api.github.com/repos/Software-Engineering-Mini-Project/SE-Miniproject/pulls?state=all&per_page=100), [runs](https://api.github.com/repos/Software-Engineering-Mini-Project/SE-Miniproject/actions/runs?per_page=100), [issues](https://api.github.com/repos/Software-Engineering-Mini-Project/SE-Miniproject/issues?state=all&per_page=100). Run/job/annotation links can be reconstructed from the IDs in the CSVs.

## Review limitations

This report reviews PR descriptions, commit lists/diffs relevant to failure explanations, Actions metadata, annotations and QA evidence. It is not an exhaustive line-by-line code audit of every PR. Missing exact diagnostics in F04/F07/F09 and raw-log confirmation for F06/F08 remain explicit evidence gaps. A same-SHA rerun passing alone does not establish the cause. Historic source documents may describe then-open findings that are now closed; the QA summary reconciles them.
