# Admin onboarding, recovery and offboarding — proposal

Status: **in-app role management confirmed by the team (2026-11-06); production onboarding controls below still need named owners** ([issue #20](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/20)). This document is not authorization to provision an account or deploy to production. Owners and named backups must be agreed before any production release.

## Current behavior and decision requested

Registration creates a Member regardless of a submitted role. Admin access is broader than project membership, and Admin writes are audit-marked.

**Update (SRS §2.2 gap closed in code; confirmed by the team on 2026-11-06):** SRS §2.2 requires the Admin to manage user accounts and roles, and without it no registered user could ever become a Lead. The app now has:

- `GET /api/users` and `PATCH /api/users/:userId/role`, Admin only, with the **Users** page in the app. Roles are read from the database on every request, so a change applies at once.
- A last-Admin safeguard (`409 LAST_ADMIN`), checked after the write so concurrent demotions cannot remove every Admin.
- Audit records for each role change (`change: { field: "role", from, to }`), with no request bodies or secrets.
- Session revocation on password change (token version claim), which closes the "existing JWTs stay valid" gap in item 5 for credential compromise.
- `npm run user:role -- <email> <role>`, a non-destructive operator command for the first Admin of a new deployment.
- A guard that makes `npm run seed` refuse non-local or production databases unless `--allow-remote-database` is passed.
- **Account deactivation** (`PATCH /api/users/:userId/status`, Admin only): ends every session at once and blocks sign-in until reactivated; the account's work is kept. An Admin can't deactivate themselves, and deactivated Admins don't count toward the last-Admin guard.
- **Per-project roles** (Owner, Manager, Member, Viewer) on top of the workspace roles, defined in `src/lib/permissions.js` and enforced by the API; see the authorization matrix in `docs/backend-api-contract.md` §7.5.

Still missing: lost-password recovery and forced sign-out on demotion (a demoted user keeps signing in, but with the lower role, which applies on their next request). Product and security owners should review these controls before production. The existing seed script deletes all application collections and inserts synthetic users with a shared demo password. It is strictly for disposable local/test databases; it is not a safe production bootstrap or recovery mechanism.

**Recommendation:** retain the current seed-only model for disposable local/test environments only. It is not sufficient for production. Before production, product and security owners must approve and verify a separate non-destructive provisioning and recovery procedure, including secure credential delivery and audit evidence. Until then, production Admin onboarding is blocked. Staging should use only synthetic data and restricted access; the demo seed must never target a database containing data worth retaining.

| Option | Benefits | Trade-offs |
| --- | --- | --- |
| Disposable seed (current) | Simple, repeatable synthetic test setup | Destructive reset and shared demo password; no safe operational onboarding or recovery. |
| Controlled non-destructive operator procedure (proposed for a future release) | Restricts provisioning to approved operators without exposing a public role endpoint | Requires an implemented, tested procedure, strong separation of access, secure credential handoff, logging and independent review. |
| Admin management API/UI (implemented for role changes; see the update above) | More convenient account lifecycle | Adds an attack surface and requires explicit authorization, audit, recovery and safeguards against privilege escalation and loss of the last Admin. |

## Proposed controls for owner approval

1. **Authorization:** a designated product owner approves each named person's need for Admin; a separate security owner verifies the request and records approval in the team's access register. Assign named backups and prevent self-approval. Record the request and timestamps without passwords or tokens.
2. **Initial creation:** a designated operator uses a separately developed, reviewed, non-destructive procedure on the intended environment only. Independently verify the environment and account identity; deliver a unique initial credential through an approved secret channel, never an issue, repository, or log. Require a password change and confirm access. No such production procedure is implemented by this document.
3. **Credential ownership:** each Admin uses an individual account, owns its credential, and stores it in an approved password manager. The service owner controls deployment and database access, and security reviews the access register regularly. No shared Admin credential.
4. **Recovery:** verify the requester's identity through an independent channel and obtain product and security approval. A designated operator follows the future tested procedure to reset access without exposing credentials; notify the account owner and record the event. Test recovery in a disposable environment. The current app has no lost-password recovery flow, and changing a password requires the current password.
5. **Offboarding:** product owner promptly initiates removal; the operator removes role/access using the future approved procedure, revokes related deployment/database access and rotates any exposed shared secrets. Verify denial and record completion. Deactivating the account in the **Users** page revokes its sessions immediately and blocks sign-in; deployment and database access must still be revoked separately.

## Future implementation scope

Role management, last-Admin protection, auditing and session revocation on password change are implemented (see the update above). For anything further, open a separate implementation issue covering explicit authorization, least privilege, identity verification, auditing without secrets, credential delivery, token/session revocation, last-Admin safeguards, recovery, negative tests and a rollback plan.

## Approval record

- In-app role management, per-project roles and account deactivation: **confirmed by the team through Basawaraj (Scrum lead), 2026-11-06**, as relayed by Vismay.
- Product owner and backup: **not assigned**; approval: **pending**.
- Security owner and backup: **not assigned**; approval: **pending**.
- Operator and service owner: **not assigned**.
- Release decision and recovery exercise: **pending**.
