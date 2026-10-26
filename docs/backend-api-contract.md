# Backend handoff: API contract for the Task Manager frontend

**For:** Akash (backend / API integration)
**From:** Vismay (frontend, test data, CI)
**Branch:** `feature/frontend-shell`
**Sources:** SRS v1.0 §3.2, §4, §5, §10 · SAD v1.0 §3–§6 · STP v1.0 §5–§7

---

## 1. Where things stand

- **The frontend is built** (Next.js 15, React 19) in `apps/web/`. It has every v1.0 screen: auth, dashboard, projects, the Kanban board, task details, comments, notifications, search, profile and CSV export.
- **The API contract is implemented** in `apps/api/`, including auth, projects/members, tasks, comments, notifications, summaries, CSV export, access control, validation, and audit logging. The web app uses the real HTTP API by default via [`apps/web/src/lib/api/client.js`](../apps/web/src/lib/api/client.js).
- The browser mock at [`apps/web/src/lib/api/mock/server.js`](../apps/web/src/lib/api/mock/server.js) remains available for frontend-only work (`NEXT_PUBLIC_API_MODE=mock`). It has no database and no real password hashing, and its tokens are not real JWTs.
- **The mock is your reference.** It implements the contract below: paths, status codes, the error envelope, roles, membership checks, validation and notifications. 19 contract tests check it, each named after an STP test ID ([`apps/web/tests/mock-api.test.mjs`](../apps/web/tests/mock-api.test.mjs)). If your API returns the same thing for the same request, the frontend works unchanged.
- **For local use:** configure MongoDB and `JWT_SECRET`, seed a local/test database, then run both apps. The automated suite checks the API and mock against this contract; follow §12 for a browser smoke test against a live local database.

Wherever this document and the SRS/SAD disagree, the SRS wins. Tell me and I'll update this file and the frontend.

---

## 2. Quick start

```bash
# install dependencies from the repository root
npm ci                 # once, after cloning
copy apps/api/.env.example to apps/api/.env
# set MONGODB_URI and a strong JWT_SECRET in apps/api/.env
copy apps/web/.env.example to apps/web/.env.local
# set NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api in apps/web/.env.local
npm run seed --workspace @task-manager/api  # clears selected collections; local/test DB only
npm run dev
```

The web app defaults to HTTP mode. To use the browser mock without starting MongoDB, set `NEXT_PUBLIC_API_MODE=mock` in `apps/web/.env.local` and run `npm run dev:web`.

Demo users from the fixtures (all use password `Password123!`, synthetic only):

| Email | Role | Projects |
|---|---|---|
| `admin@example.test` | Admin | owns Beta |
| `lead@example.test` | Lead | owns Alpha, member of Beta |
| `member@example.test` | Member | Alpha |
| `member.two.with.a.long.address@example.test` | Member | Alpha (long name on purpose) |
| `outsider@example.test` | Member | none: use it for negative access tests |

Seed your **test** database from `apps/web/fixtures/*.json`. Hash `Password123!` with bcrypt when seeding.

---

## 3. Decisions we need to agree on

The frontend currently assumes the values below. Each is marked `DECISION` in [`apps/web/src/lib/api/client.js`](../apps/web/src/lib/api/client.js). Tell me which ones you change. Most need a one-line change on my side.

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

#### `POST /auth/login` (public)
- Body: `{ email, password }`
- `200 { token, expiresIn }`. `expiresIn` is in **seconds**. The frontend then calls `/auth/me`.
- `401 INVALID_CREDENTIALS`. Use the same message for an unknown email and a wrong password.
- `429 RATE_LIMITED` after **5 failed attempts per email within 60 seconds**. The mock counts per email; per IP as well is fine.

#### `GET /auth/me`
- Returns `200 User`.

#### `PATCH /users/me`
- Body: any of `{ name }`, or `{ currentPassword, newPassword }`.
- Changing the password requires the correct `currentPassword`; otherwise `400` with `fields.currentPassword`.
- Returns `200 User`. The new password must work on the next login.

### 6.2 Projects and members (TM-F-020, TM-F-021)

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /projects` | any signed-in user | | `200 Project[]`: projects where the user is in `memberIds` (Admin: all) | |
| `POST /projects` | Lead, Admin | `{ name, description? }` | `201 Project`. `ownerId` = caller, `memberIds` = [caller] | `403` for Member, `400` |
| `GET /projects/:projectId` | member | | `200 Project` | `403` non-member, `404` |
| `PATCH /projects/:projectId` | project Lead (a member), Admin | `{ name?, description? }` | `200 Project` | `403`, `404`, `400` |
| `DELETE /projects/:projectId` | project Lead, Admin | | `204`, cascades per D11 | `403`, `404` |
| `GET /projects/:projectId/members` | member | | `200 Member[]` | `403`, `404` |
| `POST /projects/:projectId/members` | project Lead, Admin | `{ email }` (D4) | `200 Member[]` (full updated list). Adding an existing member is a no-op. | `404` with `fields.email` if not registered, `403` |
| `DELETE /projects/:projectId/members/:userId` | project Lead, Admin | | `200 Member[]`. **Also remove that user from `assigneeIds` of every task in the project.** | `400` if removing the owner, `404` if not a member, `403` |

"Project Lead" means role `Lead` **and** listed in that project's `memberIds`. A Lead who isn't in the project gets 403.

### 6.3 Tasks (TM-F-010..012, TM-F-022, TM-F-023, TM-F-040)

| Method and path | Who | Body or query | Success | Errors |
|---|---|---|---|---|
| `GET /projects/:projectId/tasks` | member | query `q, status, priority, assigneeId` (all optional) | `200 Task[]` | `400` bad filter, `403`, `404` |
| `POST /projects/:projectId/tasks` | project Lead, Admin | `{ title, description?, status?, priority?, dueDate?, assigneeIds? }` | `201 Task`. Defaults: `status "To Do"`, `priority "Medium"`, `assigneeIds []`. Creates assignment notifications (§7.1). | `400`, `403` |
| `GET /tasks` | any signed-in user | query `q, status, priority, assigneeId, projectId` | `200 Task[]` from **every project the caller can access** | `400` |
| `GET /tasks/:taskId` | member of the task's project | | `200 Task` | `403`, `404` |
| `PATCH /tasks/:taskId` | project Lead, Admin | any of the create fields; `dueDate: null` clears it | `200 Task`. Notify only **newly added** assignees. | `400`, `403`, `404` |
| `DELETE /tasks/:taskId` | project Lead, Admin | | `204`, cascades comments and notifications (D11) | `403`, `404` |
| `PATCH /tasks/:taskId/status` | **any member** (D12) | `{ status }` | `200 { taskId, status, updatedAt }` | `400` invalid status (`"Doing"`, `"DONE"`, `"$ne"` and objects), `403`, `404` |

**Filter semantics** (identical for both list endpoints and the CSV export):
- `q`: case-insensitive substring match on `title` **or** `description`, trimmed, max 200 chars. Escape regex special characters if you use `$regex`.
- `status` and `priority` must be valid enum values (else 400).
- `assigneeId`: the task's `assigneeIds` contains it.
- All filters combine with AND. An empty result is `200 []`, not 404.

**Board behaviour:** the board moves a card on screen immediately, then calls `PATCH /tasks/:id/status`. If that call fails it moves the card back and shows your `message` in a toast, so return a clear message.

### 6.4 Comments (TM-F-032)

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /tasks/:taskId/comments` | member | | `200 Comment[]`, **oldest first**, each with `author` (D6) | `403`, `404` |
| `POST /tasks/:taskId/comments` | member | `{ text }` | `201 Comment` with `author` | `400` empty or over 1000 chars, `403`, `404` |

Store comment text **as typed**, e.g. `<script>alert('x')</script>`. Don't strip or HTML-encode it on the way in. The frontend renders it as plain text, so it can't run. The fixture comment `comment-004` covers this case.

### 6.5 Notifications (TM-F-030, TM-F-031)

| Method and path | Who | Success | Errors |
|---|---|---|---|
| `GET /notifications?page=1&pageSize=50` | signed-in user | `200 { items, page, pageSize, total, unreadCount }` (D7). **Only the caller's own notifications**, newest first. `pageSize` defaults to 50, max 100. Each item includes `projectId`. | |
| `PATCH /notifications/:notificationId/read` | the recipient only | `200 Notification` with `read: true` | `404` if missing **or belongs to someone else** |

There is no "mark all read" endpoint in the SRS, so the frontend calls the read endpoint once per notification. Add `PATCH /notifications/read-all` if you want; tell me and I'll use it.

### 6.6 Summary and export (TM-F-041, TM-F-042)

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
- Reference implementation (18 lines): [`apps/web/src/lib/api/mock/csv.js`](../apps/web/src/lib/api/mock/csv.js). Fixture `task-007` has a formula-like title. Its expected cell is `"'=HYPERLINK(""https://example.test"",""Export check"")"`.

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

| Action | Admin | Project Lead | Project Member | Non-member |
|---|---|---|---|---|
| List or view project, tasks, members, summary, export | ✅ | ✅ | ✅ | 403 |
| Create project | ✅ | ✅ (any Lead) | 403 | 403 |
| Edit or delete project, add or remove members | ✅ | ✅ | 403 | 403 |
| Create, edit, delete task; change assignees | ✅ | ✅ | 403 | 403 |
| Change task status | ✅ | ✅ | ✅ (D12) | 403 |
| Read or post comments | ✅ | ✅ | ✅ | 403 |
| Read or mark notifications | own only | own only | own only | own only (others' → 404) |

---

## 8. Security checklist (SRS §5, PRJ-SR-001..006)

- [ ] Passwords hashed with **bcrypt** (cost ≥ 10). Never logged, never returned.
- [ ] JWT signed with a secret from env (`JWT_SECRET`), with `exp` set. Reject missing, malformed, tampered and expired tokens with 401.
- [ ] Login rate limit → 429 (e.g. `express-rate-limit`).
- [ ] Strict type checks on every input. Reject objects where strings are expected (or use `express-mongo-sanitize` as well). No `$where`, no unescaped `$regex`.
- [ ] `express.json({ limit: '100kb' })` body size limit. Paginate lists.
- [ ] Central error middleware: map known errors to the envelope, return `500 INTERNAL_ERROR` with a generic message for everything else. **No stack traces in responses.**
- [ ] Logs carry route, status, request id and user id. **No passwords, tokens, connection strings or full bodies.**
- [ ] `helmet()`. HTTPS in deployment (TLS 1.2+, PRJ-SR-004).
- [ ] CORS: allow origin `http://localhost:3000` (plus the deployed frontend URL), methods `GET, POST, PATCH, DELETE`, headers `Authorization, Content-Type`. Credentials are only needed if D2 switches to cookies.
- [ ] Secrets only in `.env` (gitignored) and GitHub Actions secrets. Commit a `.env.example`.

---

## 9. Suggested backend layout (SAD §3 layered modular monolith)

```
apps/api/
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

- **Port the contract tests.** [`apps/web/tests/mock-api.test.mjs`](../apps/web/tests/mock-api.test.mjs) has 19 tests named after STP IDs: TC-AUTH-01/02/03, TC-SEC-02/03/06, TC-PROJ-01/02, TC-TASK-01/02/03, TC-BOARD-01, TC-NOTIF-01/02, TC-COMM-01, TC-SEARCH-01, TC-REPORT-01/02. Each one is `request → expected status + errorCode`. Rewrite them with Supertest against `app.js` and they become your API integration suite (STP §5.1).
- **Seed** a dedicated test database from `apps/web/fixtures/*.json` before each run. Never use production data (STP §5.4).
- **Expected numbers with the fixtures:**
  - Alpha summary is `{ "To Do": 3, "In Progress": 2, "Done": 2 }`, `total` 7, `overdue` 1 on 2026-10-16.
  - Filtering as member@ with `status=In Progress&priority=High&assigneeId=user-member-002` returns only `task-004`.
  - Alpha CSV export is 8 lines (header + 7).
- `apps/web/fixtures/negative-inputs.json` lists hostile inputs to throw at every endpoint: invalid statuses, a NoSQL operator, an XSS comment, CSV formulas, a non-member assignee and bad tokens.

---

## 11. Things that need fixing now

1. **CI and workspaces:** the root `package.json` and lockfile manage both apps. GitHub Actions runs API and Web checks on Node 22 and 24; keep those workspace commands aligned with the package names in each app's `package.json`.
2. **Settle the decisions in §3**, especially D1 (base path) and D2 (token transport), before you write the auth middleware.
3. **Keep SAD §4 in sync** with whatever we decide here (SRS §3.2 asks for the final contract to live in the repo). This file can be that contract.
4. **Check `id` vs `_id` and `dueDate` format first.** They're the two most likely sources of "the screen is blank" bugs when you switch the frontend over.

---

## 12. Using the frontend with the API

1. Run your API on `http://localhost:4000` with CORS allowing `http://localhost:3000`.
2. Configure `apps/web/.env.local`:
   ```
   NEXT_PUBLIC_API_MODE=http
   NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
   ```
3. Seed a local/test database with `npm run seed --workspace @task-manager/api`, then start both apps with `npm run dev`. In HTTP mode, sign in using a seeded account or register a new user. Seeded fixture users share password `Password123!`.
4. Smoke test in this order:
   - register → sign in → dashboard
   - as lead@: open Alpha → create a task with an assignee → drag it across columns → reload (it must stay) → comment → export CSV
   - as member@: the notification badge shows the assignment
   - as outsider@: opening `/projects/project-alpha` shows "You are not a member of this project"
5. If something breaks, the browser DevTools Network tab shows the exact request. Compare it with the matching section of this document.

The only file in the web app that knows about URLs is [`apps/web/src/lib/api/client.js`](../apps/web/src/lib/api/client.js). If you change a path or shape, tell me and I'll update that file alone.

---

## 13. Where to find things

| What | Where |
|---|---|
| Reference behaviour (mock API) | `apps/web/src/lib/api/mock/server.js` |
| CSV escaping reference | `apps/web/src/lib/api/mock/csv.js` |
| Frontend API client: every endpoint the UI calls | `apps/web/src/lib/api/client.js` |
| Enums and limits | `apps/web/src/lib/constants.js` |
| Contract tests (STP IDs) | `apps/web/tests/mock-api.test.mjs` |
| Synthetic seed data | `apps/web/fixtures/*.json` |
| Requirements and design | `Templates/SRS_*.pdf`, `Templates/SAD_*.pdf`, `Templates/STP_*.pdf` (on the `Templates` branch) |

Questions or disagreements: message me. If a requirement is genuinely ambiguous, open a GitHub issue and label it `decision` so the whole team can see it.
