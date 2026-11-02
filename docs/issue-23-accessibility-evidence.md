# Issue #23: accessibility and responsive evidence

Status: automated Chromium evidence is recorded. Manual browser, screen-reader, zoom, and narrow-viewport checks remain outstanding and are assigned in [Issue #23](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/23); this report is not a manual accessibility sign-off.

## Automated coverage

The `TC-UX-01` suite in `apps/web/e2e/accessibility.spec.js` scans sign-in, registration, dashboard, projects, task board, My Tasks, notifications, profile, and the New Task dialog. It runs at 390x844, 768x1024, and 1280x800 using Chromium. Each page is checked for horizontal overflow and axe WCAG 2.1 A/AA violations. Keyboard coverage verifies the desktop skip link and the mobile navigation drawer's open, close, focus restoration, and navigation behavior.

The automated run recorded in PR #24 found and fixed four issues: horizontal board overflow at phone/tablet widths, secondary text contrast of 4.27:1, accessible-name mismatches on Account and Members controls, and invalid dashboard definition-list markup. The TC-E2E-01 critical journey also moves a card with Space/Arrow/Space; it does not verify spoken announcements.

## Manual checks still needed

| Check | Status | Evidence needed |
|---|---|---|
| Firefox and Edge core flows | Not run | Browser/version, viewport, flows, and any reproduction steps |
| NVDA or Narrator on login, board, task sheet, and notifications | Not run | Screen reader/version, keyboard path, announcements, and issues |
| 200% zoom and 320 px width on core flows | Not run | Pages checked and any clipping/overlap findings |
| Spoken announcements while moving a task by keyboard | Not verified | Screen reader announcement result during the keyboard drag flow |

Use synthetic data only. Record confirmed defects with severity and reproduction steps in Issue #23 or linked remediation tickets; do not mark a manual check passed based on axe or mocked Playwright coverage.

## Baseline limits

The test file identifies `TM-NF-004` and `TC-UX-01`. The repository traceability note says the candidate SRS/STP v1.0 documents are approval-pending while other issues cite SRS v1.3. No other requirement IDs are assigned here. Issue #23 should stay open until the manual checklist has owner-recorded results and all blocking findings are resolved or explicitly deferred.
