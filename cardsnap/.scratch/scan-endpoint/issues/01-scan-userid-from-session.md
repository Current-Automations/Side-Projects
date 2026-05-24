# 01 · Scan endpoint must take userId from the authenticated session, not the request body

Status: ready-for-human

## Problem

`POST /api/scan` (`app/api/scan/route.ts`) currently reads `userId` from the JSON
request body. This is a deliberate Session 2 stopgap so the endpoint can be
exercised before auth exists. It violates the project rule "scan rate limiting
enforced server-side by plan tier — never trust the client":

- A caller can submit any UUID and spend that user's daily scan quota.
- Scans are attributed to an arbitrary account in `scan_logs`.
- Rate-limit state returned to the caller reflects a different account's tier.

Severity is low while the endpoint is localhost-only (dev), but it becomes
medium-high the moment the route is publicly reachable. It MUST be closed before
any non-local deployment.

## Fix

Derive `userId` from the authenticated Supabase session (JWT) server-side, and
remove `userId` from the request body schema. This corresponds to the
"validate Supabase JWT" step described in `ISSUES.md` → ISSUE-06.

- Validate the Supabase auth token in the route.
- Map the verified session user → `userId`.
- Drop `userId` from `ScanRouteRequestSchema`; the body becomes `{ image }`
  (i.e. the shared `ScanRequestSchema`).
- Return `401 UNAUTHORIZED` when the session is missing or invalid.

## Acceptance criteria

- [ ] `userId` no longer appears in the `/api/scan` request body or its Zod schema
- [ ] A request with a missing/invalid session returns `401 UNAUTHORIZED`
- [ ] The scan is counted against, and attributed to, the authenticated user only
- [ ] The dev test harness (`app/test-scan/`) is updated or removed accordingly

## References

- `app/api/scan/route.ts` — SECURITY comment at top references this file
- `ISSUES.md` → ISSUE-06 (scan orchestration endpoint, JWT validation)
