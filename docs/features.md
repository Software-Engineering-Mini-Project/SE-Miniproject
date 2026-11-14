# Feature guide

What the app does today, by area, and where each part lives. For setup and commands see the [README](../README.md); for the HTTP details see the [API contract](backend-api-contract.md).

Demo data (`npm run seed`): accounts `admin@`, `lead@`, `member@`, `viewer@`, `outsider@example.test`, all with password `Password123!`, in the organisation **Acme Labs** (invite code `ACMELABS`); plus `northwind-admin@example.test` in **Northwind Studio** (`NORTHWIND`). These are synthetic and for disposable databases only.

## 1. Accounts and organisations

- **One sign-in page** for everyone. The email identifies the account, and the account belongs to one organisation.
- **Create account** either joins an organisation with its invite code (as a Member) or starts a new organisation (you become its Admin and land on its page).
- **Organisation page** (sidebar): people, projects, open and overdue work, progress per project, and for Admins the invite code, rename and a shortcut to *Manage people*. Members see the projects they are in and open ones with a *Join* button.
- Another organisation's data is never visible, even to Admins. Details: [organisations.md](organisations.md).
- **Profile**: change your name or password. Changing the password signs out every other session.

## 2. Roles and permissions

Two layers, defined once in [`src/lib/permissions.js`](../src/lib/permissions.js) and used by the API, the mock API and the UI, so a button only shows when the server would accept the request.

**Organisation role** (per account): **Admin** (all projects in the organisation, the Users page, settings, invite code), **Lead** (can always create projects) and **Member** (creates projects unless an Admin limits that to leads, joins open projects). The last active Admin cannot be demoted.

**Project role** (per project): Owner, Manager, Member, Viewer.

| | Owner | Manager | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| View, export, comment | ✓ | ✓ | ✓ | ✓ |
| Create, edit, assign and move tasks; edit checklists | ✓ | ✓ | ✓ | |
| Delete tasks and anyone's comments | ✓ | ✓ | | |
| Edit the project; add, remove and change Members and Viewers | ✓ | ✓ | | |
| Grant or revoke Manager, transfer ownership, delete the project | ✓ | | | |

Anyone except the Owner can leave a project. The full matrix is [§7.5 of the API contract](backend-api-contract.md).

## 3. Projects

- **Anyone can start a project** and becomes its Owner. An Admin can switch **Who can create projects** (Users page) to *Leads and admins only*.
- **Private** projects are invite-only: the owner or a manager adds people by email (only people in the same organisation). **Open** projects are listed under *Open projects* and on the Organisation page, and anyone in the organisation can join as a Member. A shared link to an open project offers *Join project* instead of an error.
- A new account with no projects sees a **Get started** screen: create a project, join an open one, or send their email to a project owner.
- Owners and managers edit the project (including Private/Open), manage members and roles, and transfer ownership; the Owner deletes it.

## 3b. Admin: Users page

Admins search accounts of their organisation, change roles, **deactivate** an account (signs it out everywhere and blocks sign-in; its work is kept) and reactivate it, and set *Who can create projects*. Role changes and settings are audit-logged.

## 4. Tasks

- **Board** (drag between To Do, In Progress and Done, with a keyboard alternative) and **list** views, filters, search, and CSV export of a project's tasks.
- **Task sheet**: title, description, status, priority, due date, assignees (project members who are not Viewers), comments, checklist.
- **Quick add**: type a task on one line, for example `Draft the release notes fri !high @mina`. `!high`/`!medium`/`!low` (or `!1` to `!3`) set the priority; `@name` assigns a member (`@me` is you); `today`, `tomorrow`, `fri`, `next week`, `in 3 days`, `nov 20` or `2026-11-20` set the due date. A preview shows what was understood before anything is created, and ✕ on a piece keeps that word as plain text. Parser: [`src/lib/quick-add.js`](../src/lib/quick-add.js).
- **Work-item keys**: every task has a short name such as `ALPHA-12`, shown on cards, list rows, the task sheet and the dashboard. A project's key is suggested from its name when it is created (or typed, 2 to 10 letters); only the Owner or an Admin can change it later, and old keys keep working. Search for a key (`alpha-12`) to find that task, open `/browse/ALPHA-12` to jump to it, or copy the link from the task sheet. Notifications and the CSV export include the key. Numbers are never reused, even after a task is deleted. Rules: [`src/lib/work-items.js`](../src/lib/work-items.js); API: [§7.7 of the contract](backend-api-contract.md).
- **Types, story points, labels and epics**: every work item is a Task, Bug, Story or Epic, each with its own icon. Estimate it in story points (1, 2, 3, 5, 8, 13 or 21) and tag it with labels such as `frontend` or `urgent`; labels belong to the project, and the label box suggests the ones it already uses. Stories, tasks and bugs can belong to an epic: the epic's card and sheet show a progress bar from its items, and each item shows its epic. An epic never sits inside another one. Filter the board and list by type and label. Quick add reads `#bug` (or `#story`, `#epic`, `#task`), any other `#word` as a label, and `3pts` as story points. Rules: [§7.8 of the contract](backend-api-contract.md).
- **Backlog and sprints**: the project's **Backlog** view lists the active sprint, planned sprints and the backlog, each in ranked order. Drag a task by its handle (or use the keyboard: Space, arrows, Space) to rank it or move it into a sprint; each row's **Plan** menu does the same without dragging. Owners and Managers create sprints (name, dates, goal), start one at a time and complete it: finished work stays as the sprint's record, unfinished work goes back to the backlog or into the next sprint. Completed sprints are listed underneath with what they finished. On the board and in the list, **Active sprint** shows only the running sprint's work. Rules: [§7.10 of the contract](backend-api-contract.md).
- **Burndown, sprint report and velocity**: **Insights** has a sprint report for the active sprint or any completed one. It shows what was committed, completed, added during the sprint and carried over, and a burndown of the work left each day against an ideal line. Read the chart with the arrow keys or switch it to a table. Velocity compares each completed sprint's committed and completed points, and the forecast uses the recent average to say how many sprints the open work needs. Rules: [§7.11 of the contract](backend-api-contract.md).
- **Dark mode**: the app follows the system's light or dark setting. Every colour, including the charts, has a dark version that keeps text and chart marks readable.
- **Consistent design** (issue #80): one set of colour, type, spacing and motion tokens across every page; the project toolbar puts the view switcher above a single compact row of filters (scrolling sideways on phones); views and the task sheet animate briefly and respect reduced motion. Details: [design.md](design.md).
- **Personal invitation links**: on the Organisation page an Admin can make a link for one email address under **Invite by link**, copy it, and send it to that person. The link opens *Join &lt;organisation&gt;* with the address filled in; it works once, only for that address, for 7 days, and an Admin can revoke it. The list shows which links are waiting, used, revoked or expired. Rules: [§7.12 of the contract](backend-api-contract.md).
- **Activity history**: the task sheet's **Activity** tab (next to Comments) lists who changed what, newest first, as sentences: "Mina Member moved ALPHA-12 from To Do to In Progress · 5 min ago". It covers creation, status, assignees, priority, due date, type, story points, labels, epic, title, description, checklist changes and comments. Everyone who can open the task can read it. A deleted comment's text is removed from the history too. Rules: [§7.9 of the contract](backend-api-contract.md).
- **Checklists**: break a task into steps. Members tick steps off; owners and managers add and remove them. Cards show progress (`2/5`). Each change is one atomic update, so two people on the same list don't overwrite each other.

## 5. Seeing what is coming

- **Dashboard**: your open work, due in 7 days, overdue and completed, with per-project progress.
- **My tasks**, with an **Upcoming** agenda: open tasks grouped into Overdue, Today, Tomorrow, each of the next five days, Later and No due date.
- **Insights** (per project): tasks per member by status, due-date buckets, and the **delivery forecast**.
- **Delivery forecast**: when will this be done, and which due dates are in trouble? From the team's own pace over the last six weeks of completions, a Monte Carlo simulation (4,000 runs, seeded, in the browser) gives finish dates at 50%, 85% and 95% confidence and, for each dated open task, the chance it finishes in time. Tasks below 85% are flagged **Tight**, below 50% **At risk**. It says plainly when there are fewer than three completions to learn from. [`src/lib/forecast.js`](../src/lib/forecast.js).

## 6. Notifications

In-app: an assignment notification when someone adds you to a task, and a due-date reminder for your open tasks due within 24 hours (one per task and due date). Mark one or all as read; the sidebar badge shows the unread count.

## 7. Quality

- **Accessibility**: automated axe WCAG 2.1 A/AA scans at phone, tablet and desktop widths for every core page, keyboard checks (skip link, navigation drawer), visible focus, reduced-motion respected. Manual evidence: [issue-23-accessibility-evidence.md](issue-23-accessibility-evidence.md).
- **Security**: server-side authorization on every route, hashed passwords, login and registration throttling, session revocation on password change and deactivation, audit records for admin writes, no secrets in logs. Review: [issue-22-security-review.md](issue-22-security-review.md).
- **Performance**: measured results in [performance-evidence.md](performance-evidence.md).
- **Tests**: `npm test` (API and web logic, UI components) and `npm run test:e2e` (Playwright in mock mode and against the real API and MongoDB; CI runs both).

## 8. Not built yet

Sending invitations by email, one person in several organisations, deleting an organisation, and a redesign of the interface are planned or open; see [organisations.md](organisations.md#not-built-decisions-for-the-team) and the team's backlog.
