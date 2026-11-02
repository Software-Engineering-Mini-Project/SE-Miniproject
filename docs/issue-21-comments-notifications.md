# Issue #21: comments and notifications evidence

Status: implementation and automated evidence reviewed against the repository contract. Full acceptance remains open until the project identifies the approved SRS/STP baseline and decides whether comment deletion is part of the product contract.

## Current implementation

- `GET /api/tasks/:taskId/comments` lists a task's comments oldest first. Access goes through `getTaskForUser`, so the caller must be a member of the task's project.
- `POST /api/tasks/:taskId/comments` validates non-empty text with a 1,000-character limit, stores the authenticated author's ID, and returns a DTO with safe author fields.
- `DELETE /api/tasks/:taskId/comments/:commentId` permits the author or a project Lead/Admin to remove a comment, after verifying project membership and task ownership. Cross-task IDs return not found.
- The task detail UI displays comments as text and lets a project member add one.
- Eligible authors and project managers can remove a comment after confirming in the UI; unrelated project members do not receive the delete control.
- `GET /api/notifications` returns only the authenticated user's notifications, with pagination and unread count. It creates deduplicated due-date reminders for the caller's assigned tasks.
- `PATCH /api/notifications/:notificationId/read` scopes the lookup to the authenticated recipient; another user's notification is returned as not found.
- Task creation creates assignment notifications; task/project deletion cascades associated comments and notifications.

## Evidence

- API integration coverage is in `apps/api/tests/routes.test.mjs`: comments, project-membership denial, notification ownership, pagination, marking read, assignment notifications, due reminders, and task deletion cascades.
- API and mock contract coverage is in `apps/api/tests/routes.test.mjs` and `apps/web/tests/mock-api.test.mjs`: comment delete authorization, missing/cross-task handling, own-comment deletion, and Lead moderation are covered along with comment/notification flows.
- UI coverage is in `apps/web/tests/ui/features.test.mjs`: comment submission/deletion and notification filtering/read state.
- Contract paths and authorization expectations are recorded in `docs/backend-api-contract.md`.
- Run the repository checks with `npm test` and `npm run lint`; CI runs the repository verification workflow on both push and pull request events.

## Verification from this branch

- `npm run lint`: passed.
- API suite: 32/32 passed.
- Web unit/contract suite: 26/26 passed.
- The full `npm test` command did not complete locally because `vitest` is missing from the existing `node_modules`; the component suite, including the new confirmation-flow test, must be run by CI after lockfile installation.
- The first sandboxed attempt also could not bind localhost/start its temporary MongoDB; the API suite passed on retry with local process access.

## Acceptance gaps and source limits

- Notification deletion is not exposed; the current contract defines recipient-only read state, not notification removal.
- `docs/requirements-traceability.md` records that the candidate SRS/STP documents are v1.0 and approval-pending, while related issues cite SRS v1.3. Therefore this review does not assign requirement IDs or claim that the reminder/notification event set is complete against an approved baseline.
- The comments/notifications paths and permissions now have implementation and test coverage. Final acceptance against the approved requirement and test baselines remains pending.
