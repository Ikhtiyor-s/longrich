# T-G0-5 — RBAC skeleton: roles/permissions guard, resource ownership pattern, admin MFA scaffold

**Requirement refs:** TZ §02 ("RBAC + resource ownership + seller_id isolation; never rely on UI hiding for authorization"), §19 ("AuthZ test matrix"), §34 (security/RBAC matrix — full matrix populated later as resources exist, but the *mechanism* must exist now). Requirement ID: `ADM-007` (Admin RBAC). Milestone: G0.

## Goal
Build the reusable authorization mechanism (guard/decorator in the NestJS app) that every future endpoint will use to check role + permission + resource-ownership, backed by the `admin_roles`/`admin_permissions`/`admin_role_permissions`/`admin_members` tables from T-G0-3, plus a scaffold (not full implementation) for admin MFA since production admin auth needs it per TZ §02.

## Files likely touched
- `apps/api/src/common/guards/permission.guard.ts`
- `apps/api/src/common/decorators/require-permission.decorator.ts`
- `apps/api/src/common/decorators/require-ownership.decorator.ts` (resource-ownership check hook, e.g. seller_id match — generic pattern, no seller tables exist yet so this is interface-only with a unit test using a fake resource)
- `apps/api/src/modules/identity/admin-mfa.service.ts` (TOTP enrollment/verify scaffold — stores secret reference, does not need to be wired to a real admin UI yet)
- Unit tests under `apps/api/src/common/guards/*.spec.ts`

## How we'll know it's done
- A protected test endpoint decorated with `@RequirePermission('test:read')` returns `403` for a session whose role lacks that permission, and `200` for one that has it — proven by an integration test using two seeded admin members with different roles (from T-G0-3's seed).
- Resource-ownership decorator, exercised against a fake "owned resource" fixture, rejects a request where the caller's `seller_id`/`user_id` doesn't match the resource owner, even if the caller otherwise has the right permission — demonstrating TZ §02's "never rely on UI hiding" principle is enforced server-side.
- Admin MFA scaffold: enrollment generates a secret reference (not stored in plaintext logs), verify endpoint accepts/rejects a TOTP code; full enforcement on every admin login is explicitly out of scope for this ticket (no admin UI/login flow exists yet) — ticket must say so in its completion note rather than claim full MFA is "done."
- No endpoint in the repo at the end of this ticket is reachable without an explicit permission check (lint rule or code review checklist item, author's choice, documented in the PR).

## Owner role
`backend-dev`

## Depends on
T-G0-3
