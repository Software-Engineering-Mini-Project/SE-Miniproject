# Organisations

Status: implemented on branch `feat/quick-add-subtasks` (PR #64), 2026-11-08. This is the design note: what an organisation is, how people get into one, what is isolated, how existing data was migrated, and what is deliberately not built. The endpoint details are in [backend-api-contract.md §6.8](backend-api-contract.md); the user-facing description is in the [README](../README.md#organisations) and the [feature guide](features.md).

## Why

The team asked (Akash, 2026-11-08) that **admin and member sign in on the same page, but the organisation page differs**: an organisation has many projects working in it. Before this, the whole deployment was one shared workspace, so two teams using one deployment would see each other's accounts and could not be kept apart.

## The model

| Thing | Belongs to | Notes |
|---|---|---|
| **Organisation** | | `name`, `joinCode`, `projectCreation` (who may create projects), `createdById`. The `settings` that used to be one global document now live here. |
| **Account** (`User`) | exactly one organisation | `organisationId`. Role (`Admin`, `Lead`, `Member`) is the role *inside* that organisation. |
| **Project** | exactly one organisation | `organisationId`, set from the creator. |
| Task, comment, notification | the organisation of its project | No field of their own: they are only reachable through a project. |

An account has one organisation for life. There is no multi-organisation membership and no moving an account between organisations.

## Getting in

One *Create account* page, two choices:

1. **Join** with an invite code: the account becomes a **Member** of that organisation. Any `role` in the request is ignored.
2. **Create** an organisation: the account becomes its **Admin**, and the founder lands on the Organisation page where the invite code is shown.

Or a **personal invitation link** (issue #78): an Admin makes a link for one email address on the Organisation page. Opening it shows *Join &lt;organisation&gt;* with the address filled in and fixed, and the account joins as a **Member**. The link works once, for that address, for 7 days, unless the Admin revokes it. Details: [§7.12 of the contract](backend-api-contract.md).

Sign-in does not ask for an organisation: the email identifies the account, and the account knows its organisation. That is what keeps admin and member on the same page.

The founder is the organisation's first Admin; from then on Admins promote others on the **Users** page. `npm run user:role` still exists for repairing a deployment that has no Admin, and is now scoped to the user's organisation.

## What the Organisation page shows

- Everyone: the organisation's name, active people, projects they can see, open and overdue tasks, and a row per project with progress, owner, member count and their own role. Open projects they are not in show a **Join** button.
- Admins also: every project (private ones included), the **invite code** with *Copy* and *Create a new code*, **Invite by link** (make, copy and revoke personal links, and see which were used), **rename**, and *Manage people* (the Users page).

## What is isolated

Everything that could reach across accounts is scoped by the caller's organisation, which the server reads from the database on every request (never from the token or the body):

- project routes (`GET/PATCH/DELETE /projects/:id`, members, tasks, summary, export): another organisation's project answers `404`, so its existence is not revealed, and this includes Admins;
- project list, open-project directory, join, "all my tasks", dashboard, organisation overview;
- adding a member by email (an email registered elsewhere looks unregistered), assignee validation (assignees must already be project members);
- the Users admin routes (list, change role, deactivate) and the **last-Admin guard**, which counts Admins per organisation;
- settings (`GET/PATCH /settings`), now per organisation.

Tests that pin this: `server/tests/organisations.test.mjs` (API), `tests/mock-api.test.mjs` (mock mirror) and `e2e/organisation.spec.mjs` (browser, both modes).

## Invite codes

- 10 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`), from `crypto.getRandomValues`, about 50 bits. Stored upper-case, shown as `ABCDE-FGHJK`; entry ignores case, spaces and dashes.
- Treat it like a shared password for joining: **only Admins receive it from the API**, it is never written to logs (rotation is audited as `previous → rotated`), and registration is limited to 5 attempts per client IP per 10 minutes, so guessing is impractical.
- An Admin can **replace** it at any time; the old code stops working immediately and nobody already in is affected.
- It does not expire by itself and is not single-use. If you need to close the door, rotate it.
- The demo codes (`ACMELABS`, `NORTHWIND`) are short and public on purpose. They exist only in the synthetic seed.

## Migrating existing data

A database from before organisations has accounts and projects with no `organisationId`. On the first connection after upgrading (and with `npm run db:migrate`), `migrateOrganisations` in [`server/utils/migrations.js`](../server/utils/migrations.js):

1. creates one organisation, `_id: org-default`, named **My organisation**, with a fresh invite code (an upsert, so two instances starting together agree on one);
2. carries over the old global workspace setting (`settings` collection) as that organisation's `projectCreation`;
3. assigns every account and project without an organisation to it.

It does nothing once nothing is orphaned, so it is safe on every start. After upgrading, an Admin should rename the organisation and, if the code was ever shared, rotate it. The old `settings` collection is left in place and is no longer read.

## Not built (decisions for the team)

- **Sending invitations by email.** Personal invitation links exist (above), but the Admin copies and shares them by hand; sending them needs a decision on a mail provider.
- **One person in several organisations**, and moving between them.
- **Deleting an organisation**, or exporting its data.
- **Per-organisation audit log screen.** Audit records exist in the server log (`audit: true`, with `change`), but there is no page for them.
- **Organisation-level billing, quotas or branding.**
- **Terminology:** the code and some screens still say "workspace" for the organisation's rules (for example *Workspace settings* on the Users page). It means the same thing; renaming it everywhere is a separate, mechanical change.
- **Production onboarding owners** (who approves the first Admin of a real deployment) are still open, see [admin-onboarding-proposal.md](admin-onboarding-proposal.md).
