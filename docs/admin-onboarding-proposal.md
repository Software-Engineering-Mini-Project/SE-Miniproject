# Admin onboarding, recovery and offboarding — proposal

Status: **proposed; product and security owner approval required** ([issue #20](https://github.com/Software-Engineering-Mini-Project/SE-Miniproject/issues/20)). This document is not authorization to provision an account or deploy to production. Owners and named backups must be agreed before any production release.

## Current behavior and decision requested

Registration creates a Member regardless of a submitted role. Admin access is broader than project membership, and Admin writes are audit-marked. There is no Admin management or recovery endpoint in the current contract. The existing seed script deletes all application collections and inserts synthetic users with a shared demo password. It is strictly for disposable local/test databases; it is not a safe production bootstrap or recovery mechanism.

**Recommendation:** retain the current seed-only model for disposable local/test environments only. It is not sufficient for production. Before production, product and security owners must approve and verify a separate non-destructive provisioning and recovery procedure, including secure credential delivery and audit evidence. Until then, production Admin onboarding is blocked. Staging should use only synthetic data and restricted access; the demo seed must never target a database containing data worth retaining.

| Option | Benefits | Trade-offs |
| --- | --- | --- |
| Disposable seed (current) | Simple, repeatable synthetic test setup | Destructive reset and shared demo password; no safe operational onboarding or recovery. |
| Controlled non-destructive operator procedure (proposed for a future release) | Restricts provisioning to approved operators without exposing a public role endpoint | Requires an implemented, tested procedure, strong separation of access, secure credential handoff, logging and independent review. |
| Admin management API/UI (future scope) | More convenient account lifecycle | Adds an attack surface and requires explicit authorization, audit, recovery and safeguards against privilege escalation and loss of the last Admin. |

## Proposed controls for owner approval

1. **Authorization:** a designated product owner approves each named person's need for Admin; a separate security owner verifies the request and records approval in the team's access register. Assign named backups and prevent self-approval. Record the request and timestamps without passwords or tokens.
2. **Initial creation:** a designated operator uses a separately developed, reviewed, non-destructive procedure on the intended environment only. Independently verify the environment and account identity; deliver a unique initial credential through an approved secret channel, never an issue, repository, or log. Require a password change and confirm access. No such production procedure is implemented by this document.
3. **Credential ownership:** each Admin uses an individual account, owns its credential, and stores it in an approved password manager. The service owner controls deployment and database access, and security reviews the access register regularly. No shared Admin credential.
4. **Recovery:** verify the requester's identity through an independent channel and obtain product and security approval. A designated operator follows the future tested procedure to reset access without exposing credentials; notify the account owner and record the event. Test recovery in a disposable environment. The current app has no lost-password recovery flow, and changing a password requires the current password.
5. **Offboarding:** product owner promptly initiates removal; the operator removes role/access using the future approved procedure, revokes related deployment/database access and rotates any exposed shared secrets. Verify denial and record completion. Existing JWTs expire after two hours by default; verify the actual deployed configuration and ensure immediate revocation is available before claiming immediate offboarding.

## Future implementation scope

If owners request an endpoint, UI or operator tooling, open a separate implementation issue covering explicit authorization, least privilege, identity verification, auditing without secrets, credential delivery, token/session revocation, last-Admin safeguards, recovery, negative tests and a rollback plan. Do not implement role-management features under #20.

## Approval record

- Product owner and backup: **not assigned**; approval: **pending**.
- Security owner and backup: **not assigned**; approval: **pending**.
- Operator and service owner: **not assigned**.
- Release decision and recovery exercise: **pending**.
