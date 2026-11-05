# Backend handoff: API contract for the Task Manager frontend

**For:** Akash (backend / API integration)
**From:** Vismay (frontend, test data, CI)
**Branch:** `feature/frontend-shell`
**Sources:** SRS v1.0 §3.2, §4, §5, §10 · SAD v1.0 §3–§6 · STP v1.0 §5–§7

---

## 1. Where things stand

- **The frontend is built** (Next.js 16, React 19) in `src/`. It has every v1.0 screen: auth, dashboard, projects, the Kanban board, task details, comments, notifications, search, profile and CSV export.
- **The API contract is implemented** in `server/`, including auth, projects/members, tasks, comments, notifications, summaries, CSV export, access control, validation, and audit logging. The web app uses the real HTTP API by default via [`src/lib/api/client.js`](../src/lib/api/client.js).
- The browser mock at [`src/lib/api/mock/server.js`](../src/lib/api/mock/server.js) remains available for frontend-only work (`NEXT_PUBLIC_API_MODE=mock`). It has no database and no real password hashing, and its tokens are not real JWTs.
- **The mock is your reference.** It implements the contract below: paths, status codes, the error envelope, roles, membership checks, validation and notifications. Its contract tests are named after STP test IDs ([`tests/mock-api.test.mjs`](../tests/mock-api.test.mjs)). If your API returns the same thing for the same request, the frontend works unchanged.
- **For local use:** configure MongoDB and `JWT_SECRET`, seed a local/test database, then run the app. The automated suite checks the API and mock against this contract; follow §12 for a browser smoke test against a live local database.

Wherever this document and the SRS/SAD disagree, the SRS wins. Tell me and I'll update this file and the frontend.

---

## 2. Quick start

```bash
# from the repository root
npm ci                 # once, after cloning
cp .env.example .env.local
# set MONGODB_URI (a local/test database) and a JWT_SECRET of 32+ random characters
npm run db:indexes     # creates the unique email and query indexes
npm run seed           # replaces every collection with the fixtures; refuses non-local hosts
npm run dev            # Next.js and the Express API on one port (PORT, default 3000 in .env.example)
```

`npm run seed:demo` loads the same fixtures with their dates moved to today, so the dashboard shows a realistic mix of overdue, due-soon and later work. The E2E suite expects the unshifted `npm run seed`.

The web app defaults to HTTP mode. To use the browser mock without MongoDB, set `NEXT_PUBLIC_API_MODE=mock` in `.env.local` and run `npx next dev`.

**First Admin of a new deployment:** register normally, then run `npm run user:role -- you@example.com Admin` against that database. From then on, Admins change roles on the in-app **Users** page.

Demo users from the fixtures (all use password `Password123!`, synthetic only):

| Email | Workspace role | Project roles |
|---|---|---|
| `admin@example.test` | Admin | Owner of Beta |
| `lead@example.test` | Lead | Owner of Alpha, Manager of Beta |
| `member@example.test` | Member | Member of Alpha |
| `member.two.with.a.long.address@example.test` | Member | Member of Alpha (long name on purpose) |
| `viewer@example.test` | Member | Viewer of Alpha (read-only) |
| `outsider@example.test` | Member | none: use it for negative access tests |

Seed your **test** database from `fixtures/*.json`. Hash `Password123!` with bcrypt when seeding.

---

## 3. Confirmed integration decisions

These values were confirmed by the project owner and are implemented by the frontend client and API. Keep changes synchronized across both sides.

| # | Topic | Frontend assumes now | Notes |
|---|---|---|---|
| D1 | API base path | `/api` (from SAD §4) | My kit used `/api/v1`. Either works; it's one env var. Pick one and we update SAD too. |
| D2 | Session token transport | `Authorization: Bearer <JWT>`, token kept in `sessionStorage` | SRS §3.2 says bearer JWT; SAD §2 prefers an HttpOnly cookie. Cookies need `credentials: 'include'`, CORS with credentials, and CSRF protection. Bearer is simpler for this project. |
| D3 | Token lifetime | Uses whatever `expiresIn` (seconds) you return; the mock uses 2 hours | No refresh token in v1.0. On any 401 the user is signed out with a "session expired" message. |
| D4 | Add member request | `POST /projects/:id/members` with `{ "email": "..." }` | The lead knows emails, not user ids. If you want `{ userId }`, we need a user lookup endpoint (not in the SRS). |
| D5 | Project response shape | Includes `members: [{id,name,email,role}]` alongside `memberIds` | Saves one request per project page. |
| D6 | Comment response shape | Each comment includes `author: {id,name,email,role}` | Lets the thread render names without extra requests. |
| D7 | Notifications list shape | `{ items, page, pageSize, total, unreadCount }` | SAD only says "paginated list". `unreadCount` drives the sidebar badge. |
| D8 | Error `fields` | Optional `fields: { fieldName: "message" }` on 400/409/404 | Additive to the SAD envelope. The frontend shows these inline under the matching input. Without it, it shows only `message`. |
| D9 | Non-member access | **403** `FORBIDDEN` (404 for unknown ids) | SRS allows 403 or 404, as long as it's consistent. One exception: someone else's notification returns **404** (recipient isolation). |
| D10 | Overdue / reminder timezone | Due date is a calendar date; overdue means after 23:59:59 **UTC** on that date | SRS §9 says record the timezone decision. Local time is fine too if documented. |
| D11 | Delete cascade | Deleting a task deletes its comments and notifications; deleting a project deletes all its tasks (cascading) | SAD §3.5 open decision. Archiving instead is fine; just tell me. |
| D12 | Who can change status | **Any project member** (`PATCH /tasks/:id/status`) | SRS §2.2 says "update permitted task status". The alternative is assignees only. |
| D13 | Reminder generation | The mock creates due reminders when a user lists notifications | The real backend should use a scheduled job (e.g. hourly) or the same on-read approach. Either is fine if deduplicated. |

---

## 4. Conventions every endpoint follows

### Requests

- JSON bodies with `Content-Type: application/json`. The frontend sends `Accept: application/json` (or `text/csv` for export).
- Protected routes take `Authorization: Bearer <token>`. Public routes are only `POST /auth/register` and `POST /auth/login`.
- Empty query params are never sent (no `?status=`).

### Responses

- JSON for everything except the CSV export.
- **`204` responses must have an empty body** (both DELETE endpoints).
- **Use `id`, not `_id`.** Every object the frontend reads has a string `id` field. With Mongoose, add a `toJSON` transform: `id = _id.toString()`, delete `_id`, `__v` and **`passwordHash`**.
- All references are string ids too: `ownerId`, `memberIds[]`, `projectId`, `assigneeIds[]`, `taskId`, `authorId`, `userId`.
- Timestamps are ISO-8601 strings: `createdAt` and `updatedAt` from Mongoose `timestamps: true`.
- **`dueDate` is a date-only string `"YYYY-MM-DD"` or `null`.** Not a full timestamp: the date input and the "due in N days" logic depend on it. Store a string, or a Date that you serialize back to `YYYY-MM-DD`.
- Enum values are exact, case-sensitive strings:
  - status: `"To Do"`, `"In Progress"`, `"Done"`
  - priority: `"High"`, `"Medium"`, `"Low"`
  - role: `"Admin"`, `"Lead"`, `"Member"`
  - notification type: `"assignment"`, `"due-date"`

### Error envelope (SRS §3.2, SAD §4.1)

```json
{
  "errorCode": "VALIDATION_ERROR",
  "message": "Title is required.",
  "timestamp": "2026-10-16T10:00:00.000Z",
  "fields": { "title": "Title is required." }
}
```

Never include a stack trace, a password, a token or a database message. `fields` is optional (D8).

| HTTP | `errorCode` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad or missing field, wrong type (e.g. `{"$ne":null}` where a string is expected), bad enum, bad date, malformed id, assignee not a member, wrong current password |
| 401 | `UNAUTHENTICATED` | No token |
| 401 | `INVALID_TOKEN` | Malformed, tampered, or the user no longer exists |
| 401 | `TOKEN_EXPIRED` | Token past its expiry |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password on login |
| 403 | `FORBIDDEN` | Signed in but not allowed (not a member, wrong role) |
| 404 | `NOT_FOUND` | Unknown id, unknown route, someone else's notification, add-member email not registered |
| 405 | `METHOD_NOT_ALLOWED` | Known path, wrong method (optional) |
| 409 | `DUPLICATE_EMAIL` | Registering an existing email (case-insensitive) |
| 429 | `RATE_LIMITED` | Too many login attempts |
| 500 | `INTERNAL_ERROR` | Anything unexpected. Generic message only. |

The frontend relies on `status` and `fields`; the `errorCode` values above are what the tests assert.

---

## 5. Data models

### 5.1 Response shapes the frontend reads

```js
// User (GET /auth/me, PATCH /users/me). Never include passwordHash.
{ id, name, email, role, createdAt, updatedAt }

// Member (inside a project, comment author, members endpoints)
{ id, name, email, role }

// Project
{ id, name, description, ownerId, memberIds: [id], members: [Member], createdAt, updatedAt }

// Task
{ id, title, description, status, priority, dueDate /* "YYYY-MM-DD" | null */,
  projectId, assigneeIds: [id], createdAt, updatedAt }

// Comment
{ id, taskId, authorId, text, createdAt, author: Member | null }

// Notification (projectId is added so the UI can link straight to the task)
{ id, userId, taskId, projectId, type /* "assignment" | "due-date" */, message, read, createdAt }

// Notification page
{ items: [Notification], page, pageSize, total, unreadCount }

// Project summary
{ projectId, total, counts: { "To Do": n, "In Progress": n, "Done": n }, overdue: n }
```

### 5.2 Suggested Mongoose schemas (SRS §10)

| Collection | Fields | Indexes and rules |
|---|---|---|
| User | `name`, `email` (as typed), `emailNormalized` (trim + lowercase), `passwordHash`, `role` enum, timestamps | **unique** `emailNormalized`. Never serialize `passwordHash`. |
| Project | `name`, `description`, `ownerId` → User, `memberIds[]` → User, timestamps | index `memberIds`. Owner is always in `memberIds`. |
| Task | `title`, `description`, `status` enum, `priority` enum, `dueDate`, `projectId` → Project, `assigneeIds[]` → User, timestamps | index `{projectId, status}`, `assigneeIds`, `{dueDate, status}`. Every assignee must be in the project's `memberIds`. |
| Comment | `taskId` → Task, `authorId` → User, `text`, `createdAt` | index `{taskId, createdAt}` |
| Notification | `userId`, `taskId`, `type` enum, `message`, `read`, `createdAt`, plus `dedupeKey` for reminders | index `{userId, read, createdAt}`. **Unique** `{userId, type, dedupeKey}` for due reminders. |

### 5.3 Validation limits (keep identical; the frontend mirrors them in `src/lib/constants.js`)

| Field | Rule |
|---|---|
| `name` (user) | required, trimmed, 1–80 chars |
| `email` | required, ≤254 chars, valid format, stored normalized for uniqueness |
| `password`, `newPassword` | 8–128 chars, at least one letter **and** one digit |
| project `name` | required, 1–80 chars |
| `description` (project or task) | optional, ≤2000 chars, may be empty |
| task `title` | required, 1–200 chars |
| comment `text` | required after trimming, 1–1000 chars |
| ids in path or query | string; reject anything that isn't a valid id with 400 |
| `dueDate` | `null`, empty, or a real calendar date `YYYY-MM-DD` (reject `2026-13-45`) |

**Every string field must be type-checked.** If the body contains an object such as `{"$ne": null}` where a string is expected, return 400. Don't pass it to Mongo (NoSQL injection, PRJ-SR-005).

---

## 6. Endpoints

Base path: `/api` (D1). "Member" below means a member of **that project**. Admin can do everything.

### 6.1 Auth and profile (TM-F-001..003)

#### `POST /auth/register` (public)
- Body: `{ name, email, password }`
- **Always creates role `Member`.** Ignore any `role` sent in the body (SRS §2.2).
- `201 { userId, email }`
- `400 VALIDATION_ERROR` (with `fields`), or `409 DUPLICATE_EMAIL` with `fields.email`. The email check is case-insensitive.
- Limit: **5 registration attempts per client IP per 10 minutes**; excess requests return `429 RATE_LIMITED` before password hashing. Only requests that pass validation count, so typos do not use up the allowance.

#### `POST /auth/login` (public)
- Body: `{ email, password }`
- `200 { token, expiresIn, user }`. `expiresIn` is in **seconds**; `user` is the safe user object also returned by `/auth/me`.
- `401 INVALID_CREDENTIALS`. Use the same message for an unknown email and a wrong password.
- `429 RATE_LIMITED` after **5 failed attempts per email within 60 seconds**. The mock counts per email; per IP as well is fine.

#### `GET /auth/me`
- Returns `200 User`.

#### `PATCH /users/me`
- Body: any of `{ name }`, or `{ currentPassword, newPassword }`.
- Changing the password requires the correct `currentPassword`; otherwise `400` with `fields.currentPassword`.
- Returns `200 User`. The new password must work on the next login.
- **A password change revokes every existing session** (each token carries the user's `tokenVersion` as claim `tv`). The response then also contains `token` and `expiresIn`, which the client must use from then on. Older tokens get `401 TOKEN_REVOKED`.

#### Admin: user accounts and roles (SRS §2.2)

| Method and path | Who | Body or query | Success | Errors |
|---|---|---|---|---|
| `GET /users` | Admin | `q` (name or email, case-insensitive), `role`, `page`, `pageSize` (max 100) | `200 { items, page, pageSize, total, roleCounts }`. Each item is a `User` plus `projectCount`; newest first. | `403` non-Admin, `400` bad role or paging |
| `PATCH /users/:userId/role` | Admin | `{ role: "Admin" \| "Lead" \| "Member" }` | `200 User`. Takes effect on the user's next request (roles are read from the database). Audit-logged with `change: { field, from, to }`. | `409 LAST_ADMIN` when it would leave no Admin, `404`, `400`, `403` |

### 6.2 Projects and members (TM-F-020, TM-F-021)

Who may do what is defined once, in [`src/lib/permissions.js`](../src/lib/permissions.js); the API, the mock API and the UI all import it. See §7.5 for the full matrix.

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /projects` | any signed-in user | optional `page`, `pageSize` | `200 Project[]`: projects where the user is in `memberIds` (Admin: all) | |
| `POST /projects` | workspace Lead, Admin | `{ name, description? }` | `201 Project`. The caller becomes its Owner. | `403` for Member, `400` |
| `GET /projects/:projectId` | any project role | | `200 Project` | `403` non-member, `404` |
| `PATCH /projects/:projectId` | Owner, Manager, Admin | `{ name?, description? }` | `200 Project` | `403`, `404`, `400` |
| `DELETE /projects/:projectId` | Owner, Admin | | `204`, cascades per D11 | `403`, `404` |
| `GET /projects/:projectId/members` | any project role | | `200 Member[]`, each with `projectRole` | `403`, `404` |
| `POST /projects/:projectId/members` | Owner, Manager, Admin | `{ email, role? }`; `role` is `Manager`, `Member` (default) or `Viewer`. Only an Owner or Admin may add a Manager. | `200 Member[]` (full updated list). Adding an existing member is a no-op. | `404` with `fields.email` if not registered, `400` with `fields.email` if the account is deactivated, `400` bad role, `403` |
| `PATCH /projects/:projectId/members/:userId` | Owner, Manager, Admin | `{ role }`: `Owner` (transfer), `Manager`, `Member` or `Viewer` | `200 Member[]`. Transfer: the previous owner becomes a Manager. Changing someone to Viewer unassigns them from the project's tasks. Audited (`change: { field: 'projectRole', from, to }`). | `400` bad role, changing the Owner's role, or transferring to a deactivated account; `403` (only an Owner or Admin grants, revokes or removes Manager, and transfers); `404` not a member |
| `DELETE /projects/:projectId/members/:userId` | Owner, Manager, Admin; **any member for themselves** (leave) | | `200 Member[]`. **Also remove that user from `assigneeIds` of every task in the project** (only tasks they were on change), and delete their notifications for the project. | `400` if removing the Owner, `404` if not a member, `403` |

**Project roles** are stored as `ownerId` plus two subsets of `memberIds`: `managerIds` and `viewerIds`; everyone else in `memberIds` is a Member. The workspace role only decides who may create projects (Lead, Admin) and who manages accounts (Admin); a workspace Lead has no extra rights inside a project they aren't a member of.

**Migration.** Before project roles, any workspace Lead in a project could manage it. Projects without `managerIds` are migrated once (`server/utils/migrations.js`): their non-owner Lead members become Managers, so nobody loses access. The API runs this on its first database connection; `npm run db:migrate` runs it ahead of a deploy. It never re-promotes someone an owner later demoted.

### 6.3 Tasks (TM-F-010..012, TM-F-022, TM-F-023, TM-F-040)

| Method and path | Who | Body or query | Success | Errors |
|---|---|---|---|---|
| `GET /projects/:projectId/tasks` | member | query `q, status, priority, assigneeId, page, pageSize` (all optional) | `200 Task[]` | `400` bad filter, `403`, `404` |
| `POST /projects/:projectId/tasks` | Owner, Manager, Admin | `{ title, description?, status?, priority?, dueDate?, assigneeIds? }` | `201 Task`. Defaults: `status "To Do"`, `priority "Medium"`, `assigneeIds []`. Creates assignment notifications (§7.1). | `400` (including assigning a Viewer), `403` |
| `GET /tasks` | any signed-in user | query `q, status, priority, assigneeId, projectId, page, pageSize` | `200 Task[]` from **every project the caller can access** | `400` |
| `GET /tasks/:taskId` | member of the task's project | | `200 Task` | `403`, `404` |
| `PATCH /tasks/:taskId` | Owner, Manager, Admin | any of the create fields; `dueDate: null` clears it | `200 Task`. Notify only **newly added** assignees. | `400`, `403`, `404` |
| `DELETE /tasks/:taskId` | Owner, Manager, Admin | | `204`, cascades comments and notifications (D11) | `403`, `404` |
| `PATCH /tasks/:taskId/status` | Owner, Manager, Member, Admin (D12); **not Viewer** | `{ status }` | `200 { taskId, status, updatedAt }` | `400` invalid status (`"Doing"`, `"DONE"`, `"$ne"` and objects), `403`, `404` |

**Filter semantics** (identical for both list endpoints and the CSV export):
- `q`: case-insensitive substring match on `title` **or** `description`, trimmed, max 200 chars. Escape regex special characters if you use `$regex`.
- `status` and `priority` must be valid enum values (else 400).
- `assigneeId`: the task's `assigneeIds` contains it.
- All filters combine with AND. An empty result is `200 []`, not 404.

For these three list endpoints, `page` starts at 1 and `pageSize` defaults to 50 with a maximum of 100. Supplying either parameter enables pagination; an omitted `page` defaults to 1. The response remains a plain array for backward compatibility. If neither parameter is supplied, the API returns the first 500 matching records at most. CSV export remains unpaginated and accepts filters only.

**Board behaviour:** the board moves a card on screen immediately, then calls `PATCH /tasks/:id/status`. If that call fails it moves the card back and shows your `message` in a toast, so return a clear message.

### 6.4 Comments (TM-F-032)

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /tasks/:taskId/comments` | member | | `200 Comment[]`, **oldest first**, each with `author` (D6) | `403`, `404` |
| `POST /tasks/:taskId/comments` | any project role, Viewers included | `{ text }` | `201 Comment` with `author` | `400` empty or over 1000 chars, `403`, `404` |
| `DELETE /tasks/:taskId/comments/:commentId` | comment author, Owner, Manager or Admin; project membership is required | | `204`; comment must belong to the specified task | `403` for a different member's comment, `404` for a missing/cross-task comment |

Store comment text **as typed**, e.g. `<script>alert('x')</script>`. Don't strip or HTML-encode it on the way in. The frontend renders it as plain text, so it can't run. The fixture comment `comment-004` covers this case.

### 6.5 Notifications (TM-F-030, TM-F-031)

| Method and path | Who | Success | Errors |
|---|---|---|---|
| `GET /notifications?page=1&pageSize=50` | signed-in user | `200 { items, page, pageSize, total, unreadCount }` (D7). **Only the caller's own notifications**, newest first. `pageSize` defaults to 50, max 100. Each item includes `projectId`. | |
| `PATCH /notifications/:notificationId/read` | the recipient only | `200 Notification` with `read: true` | `404` if missing **or belongs to someone else** |
| `PATCH /notifications/read-all` | signed-in user | | `200 { updated }`: marks all of the caller's unread notifications as read in one operation | |

### 6.6 Dashboard

#### `GET /dashboard` (signed-in user)
- Returns `200 { projects: [{ projectId, total, counts, overdue }], myTasks }`.
- Project summaries include every project the caller can access, including projects with no tasks. `myTasks` contains the caller's assigned tasks from those projects.
- Project totals and overdue counts are aggregated by the API. The existing per-project summary endpoint remains available.

### 6.7 Summary and export (TM-F-041, TM-F-042)

#### `GET /projects/:projectId/summary` (member)
- `200 { projectId, total, counts: { "To Do", "In Progress", "Done" }, overdue }`
- `overdue` counts tasks that are **not Done** and whose `dueDate` is in the past (D10).

#### `GET /projects/:projectId/tasks/export.csv` (member)
- Accepts the same filter query as the task list.
- Response: `200`, `Content-Type: text/csv; charset=utf-8`.
- Columns, in this order:

  ```
  id,title,status,priority,dueDate,assignees,createdAt,updatedAt
  ```

  `assignees` is the assignee **names** joined with `"; "`. Use CRLF line endings, a header row, then one row per task.
- **Formula-injection protection (PRJ-SR-005, TC-REPORT-02):** if a cell starts with `=`, `+`, `-`, `@`, a tab or a CR, prefix it with `'`.
- **Quoting:** if a cell contains `"`, `,`, CR or LF, or has leading or trailing spaces, wrap it in quotes and double the inner quotes.
- Reference implementation (18 lines): [`src/lib/api/mock/csv.js`](../src/lib/api/mock/csv.js). Fixture `task-007` has a formula-like title. Its expected cell is `"'=HYPERLINK(""https://example.test"",""Export check"")"`.

---

## 7. Business rules

### 7.1 Assignment notification (TM-F-030)
When a task is created with assignees, or a `PATCH` **adds** assignees, create one notification per new assignee:
- `type: "assignment"`, `read: false`
- `message: You were assigned to "<task title>".`

Don't notify the person who did the assigning if they assigned themselves. Removing an assignee creates no notification.

### 7.2 Due-date reminder (TM-F-031)
For each assignee of a task that is **not Done** and whose due date falls in the next **24 hours** (the end of the due day is within 24h and not already past), create one notification:
- `type: "due-date"`
- `message: "<title>" is due within 24 hours.`

**Deduplicate** on `(userId, taskId, dueDate)`. Running the job twice must not create a second reminder (TC-NOTIF-02). If the due date changes, a new reminder is allowed.

### 7.3 Membership integrity
- Every id in `assigneeIds` must be in the project's `memberIds` (else 400 with `fields.assigneeIds`).
- Removing a member unassigns them from that project's tasks.
- The project owner can't be removed.
- No list or report query may return dangling references.

### 7.4 Authorization is server-side (PRJ-SR-003)
The frontend hides buttons by role, but **that is not security**. Check role and membership on every read, write and export.
- Derive the caller from the verified token. Never from a `userId` or `role` in the body.
- The outsider fixture user must get 403 on every Alpha or Beta URL.

### 7.5 Authorization matrix

Workspace roles (on the account):

| Workspace role | Can |
|---|---|
| Admin | Everything in every project; list users, change workspace roles, deactivate and reactivate accounts |
| Lead | Create projects (and becomes their Owner) |
| Member | Work in the projects they are added to |

Project roles (per project, from `src/lib/permissions.js`). A workspace Admin can do every action in every project, but can only be assigned tasks where they are a member.

| Action | Owner | Manager | Member | Viewer | Non-member |
|---|---|---|---|---|---|
| View project, tasks, members, summary; export CSV | ✅ | ✅ | ✅ | ✅ | 403 |
| Comment; delete own comment | ✅ | ✅ | ✅ | ✅ | 403 |
| Change task status (D12) | ✅ | ✅ | ✅ | 403 | 403 |
| Be assigned tasks | ✅ | ✅ | ✅ | 400 | 400 |
| Create, edit, delete and assign tasks | ✅ | ✅ | 403 | 403 | 403 |
| Delete anyone's comment | ✅ | ✅ | 403 | 403 | 403 |
| Edit project details | ✅ | ✅ | 403 | 403 | 403 |
| Add, remove, and change Members and Viewers | ✅ | ✅ | 403 | 403 | 403 |
| Grant, revoke or remove Manager | ✅ | 403 | 403 | 403 | 403 |
| Transfer ownership; delete the project | ✅ | 403 | 403 | 403 | 403 |
| Leave the project | 400 (transfer first) | ✅ | ✅ | ✅ | 403 |

Notifications: own only, for everyone (others' → 404).

**Account deactivation** (`PATCH /users/:userId/status` `{ active }`, Admin only). Deactivation bumps the token version, so every session ends at once (`401 ACCOUNT_DEACTIVATED`), and sign-in returns `403 ACCOUNT_DEACTIVATED`, but only after the password matched, so it doesn't reveal which emails exist. The account's projects, tasks and comments stay. An Admin can't deactivate themselves; deactivated Admins don't count toward the last-Admin guard. `GET /users` accepts `status=active|deactivated` and returns `deactivatedCount`; every user DTO has `active`.

---

## 8. Security checklist (SRS §5, PRJ-SR-001..006)

- [x] Passwords hashed with **bcrypt** (cost ≥ 10). Never logged, never returned.
- [x] JWT signed with a secret from env (`JWT_SECRET`), with `exp` set. Reject missing, malformed, tampered and expired tokens with 401.
- [x] Login rate limit → 429 (5 failed attempts per email per 60 seconds).
- [x] Strict type checks on every input. Reject objects where strings are expected; escape regex input.
- [x] `express.json({ limit: '100kb' })` body size limit. Paginate notification lists.
- [x] Central error middleware: map known errors to the envelope, return `500 INTERNAL_ERROR` with a generic message for everything else. **No stack traces in responses.**
- [x] Logs carry route, status, request ID and user ID. **No passwords, tokens, connection strings or full bodies.** Admin writes are audit marked.
- [x] `helmet()` and configured CORS for the frontend origin, methods, and headers.
- [ ] HTTPS in deployment (TLS 1.2+, PRJ-SR-004); this is a deployment configuration item.
- [x] Secrets are read from environment variables; `.env.example` files document local configuration.

---

## 9. Suggested backend layout (SAD §3 layered modular monolith)

```
server/
  package.json            # npm workspace, "type": "module", engines node >= 22
  .env.example            # PORT=4000, MONGODB_URI=, JWT_SECRET=, JWT_EXPIRES_IN=7200, CORS_ORIGIN=http://localhost:3000
  src/
    app.js                # express app: helmet, cors, json limit, routes, error middleware (export for Supertest)
    server.js             # connects to Mongo and listens
    config/env.js
    middleware/           # auth (verify JWT -> req.user), requireRole, validate, rateLimit, errorHandler
    routes/               # auth, users, projects, members, tasks, comments, notifications
    controllers/
    services/             # authService, projectService, taskService, notificationService, reportService (CSV)
    models/               # User, Project, Task, Comment, Notification (with toJSON transform)
    utils/                # HttpError, csv.js, pagination
    jobs/dueReminders.js  # TM-F-031 scheduled job
  tests/                  # node:test + Supertest + mongodb-memory-server (.test.mjs)
```

Suggested packages: `express`, `mongoose`, `bcrypt` (or `bcryptjs`), `jsonwebtoken`, `cors`, `helmet`, `express-rate-limit`, `dotenv`. The API workspace currently uses Node's built-in `node:test` runner with `supertest` and `mongodb-memory-server`.

---

## 10. Testing

- **Contract tests.** [`tests/mock-api.test.mjs`](../tests/mock-api.test.mjs) names its tests after STP IDs: TC-AUTH-01/02/03, TC-SEC-02/03/06, TC-PROJ-01/02, TC-TASK-01/02/03, TC-BOARD-01, TC-NOTIF-01/02, TC-COMM-01, TC-SEARCH-01, TC-REPORT-01/02. Each one is `request → expected status + errorCode`. Rewrite them with Supertest against `app.js` and they become your API integration suite (STP §5.1).
- **Seed** a dedicated test database from `fixtures/*.json` before each run. Never use production data (STP §5.4).
- **Expected numbers with the fixtures:**
  - Alpha summary is `{ "To Do": 3, "In Progress": 2, "Done": 2 }`, `total` 7, `overdue` 1 on 2026-10-16.
  - Filtering as member@ with `status=In Progress&priority=High&assigneeId=user-member-002` returns only `task-004`.
  - Alpha CSV export is 8 lines (header + 7).
- `fixtures/negative-inputs.json` lists hostile inputs to throw at every endpoint: invalid statuses, a NoSQL operator, an XSS comment, CSV formulas, a non-member assignee and bad tokens.

---

## 11. Maintenance notes

1. **CI:** the root `package.json` and lockfile manage the app. GitHub Actions runs one `verify` job on Node 22: lint, API and web tests, a mock-mode build with the full E2E suite, then an HTTP-mode build with the full E2E suite against a MongoDB service.
2. **Keep SAD §4 in sync** with this contract when decisions change (SRS §3.2 asks for the final contract to live in the repo).
3. **Resolve the SRS version question** before later work changes requirements: the reviewed copy is v1.0 while Issue #2 cites v1.3.

---

## 12. Using the frontend with the API

1. The API is served by the same process as the web app (`npm run dev`), under `/api`.
2. Configure `.env.local` from `.env.example` (`NEXT_PUBLIC_API_MODE=http`, `NEXT_PUBLIC_API_BASE_URL=/api`).
3. Seed a local/test database with `npm run seed`, then start the app with `npm run dev`. In HTTP mode, sign in using a seeded account or register a new user. Seeded fixture users share password `Password123!`.
4. Smoke test in this order:
   - register → sign in → dashboard
   - as lead@: open Alpha → create a task with an assignee → drag it across columns → reload (it must stay) → comment → export CSV
   - as member@: the notification badge shows the assignment
   - as outsider@: opening `/projects/project-alpha` shows "You are not a member of this project"
5. If something breaks, the browser DevTools Network tab shows the exact request. Compare it with the matching section of this document.

The only file in the web app that knows about URLs is [`src/lib/api/client.js`](../src/lib/api/client.js). If you change a path or shape, tell me and I'll update that file alone.

---

## 13. Where to find things

| What | Where |
|---|---|
| Reference behaviour (mock API) | `src/lib/api/mock/server.js` |
| CSV escaping reference | `src/lib/api/mock/csv.js` |
| Frontend API client: every endpoint the UI calls | `src/lib/api/client.js` |
| Enums and limits | `src/lib/constants.js` |
| Contract tests (STP IDs) | `tests/mock-api.test.mjs` |
| Synthetic seed data | `fixtures/*.json` |
| Requirements and design | `Templates/SRS_*.pdf`, `Templates/SAD_*.pdf`, `Templates/STP_*.pdf` (on the `Templates` branch) |

Questions or disagreements: message me. If a requirement is genuinely ambiguous, open a GitHub issue and label it `decision` so the whole team can see it.

The dashboard accepts an optional `today=YYYY-MM-DD` query parameter, as does `GET /projects/:projectId/summary`. A valid calendar date within one day of the server's UTC date is used for overdue calculations; otherwise the server uses its UTC date. `GET /dashboard` returns `projects`, up to 500 open assigned `myTasks` ordered with dated tasks first, and uncapped `stats` containing `openAssigned`, `dueIn7Days`, `overdue`, and `completed`.

`GET /notifications/unread-count` returns `{ unreadCount }` for the signed-in user and may generate due reminders, throttled to once per user per 15 minutes. `GET /notifications` generates due reminders at most once per user per 15 minutes.
