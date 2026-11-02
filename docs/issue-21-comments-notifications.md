# Issue #21: comments and notifications evidence

Status: implementation and automated evidence reviewed against the repository contract. Full acceptance remains open until the project identifies the approved SRS/STP baseline and decides whether comment deletion is part of the product contract.

## Current implementation

- `GET /api/tasks/:taskId/comments` lists a task's comments oldest first. Access goes through `getTaskForUser`, so the caller must be a member of the task's project.
- `POST /api/tasks/:taskId/comments` validates non-empty text with a 1,000-character limit, stores the authenticated author's ID, and returns a DTO with safe author fields.
- The task detail UI displays comments as text and lets a project member add one.
- `GET /api/notifications` returns only the authenticated user's notifications, with pagination and unread count. It creates deduplicated due-date reminders for the caller's assigned tasks.
- `PATCH /api/notifications/:notificationId/read` scopes the lookup to the authenticated recipient; another user's notification is returned as not found.
- Task creation creates assignment notifications; task/project deletion cascades associated comments and notifications.

## Evidence

- API integration coverage is in `apps/api/tests/routes.test.mjs`: comments, project-membership denial, notification ownership, pagination, marking read, assignment notifications, due reminders, and task deletion cascades.
- UI coverage is in `apps/web/tests/ui/features.test.mjs`: comment submission and notification filtering/read state.
- Contract paths and authorization expectations are recorded in `docs/backend-api-contract.md`.
- Run the repository checks with `npm test` and `npm run lint`; CI runs the repository verification workflow on both push and pull request events.

## Acceptance gaps and source limits

- The API currently exposes no comment-delete or notification-delete route. The contract documents comment listing/creation and notification read state, but does not define deletion permissions. Do not invent author/Lead/Admin deletion rules without the approved requirements owner deciding them.
- `docs/requirements-traceability.md` records that the candidate SRS/STP documents are v1.0 and approval-pending, while related issues cite SRS v1.3. Therefore this review does not assign requirement IDs or claim that the reminder/notification event set is complete against an approved baseline.
- The implementation can be functionally tested as currently contracted, but these product decisions are needed before Issue #21 can be closed as fully accepted.
