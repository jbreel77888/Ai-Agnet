# Phase 6 (Admin Dashboard) + Phase 7 (Resilience) — Implementation Record

**Task ID**: phase-6-7-admin-resilience
**Agent**: main (Z.ai Code)
**Date**: 2026-06-21

## Summary

Created 11 production-ready files implementing the admin dashboard (users, costs, logs)
and resilience features (cost budgets with enforcement actions). All files follow the
project's existing patterns: Drizzle ORM, JWT-based admin auth, shadcn/ui components,
and the Next.js 16 App Router conventions (`params: Promise<...>`, correct relative
import depths).

## Files Created

### API Routes (8 files)

| # | Path | Methods | Purpose |
|---|------|---------|---------|
| 1 | `src/app/api/users/route.ts` | GET, POST | List users (excludes `password_hash`), create user with hashed password + role assignment |
| 2 | `src/app/api/users/[id]/route.ts` | GET, PATCH, DELETE | User CRUD; soft-delete (status='deleted'); self-deletion guard |
| 3 | `src/app/api/costs/route.ts` | GET | Cost summary (totalCost, totalTokens, requestCount) + daily aggregation for charts |
| 4 | `src/app/api/costs/breakdown/route.ts` | GET | Cost breakdown by model, provider, and user (admin only for by-user) |
| 5 | `src/app/api/costs/budgets/route.ts` | GET, POST | List/create budgets with scope, period, action, limit |
| 6 | `src/app/api/costs/budgets/[id]/route.ts` | PATCH, DELETE | Update limit/spent/enabled, delete budget |
| 7 | `src/app/api/logs/route.ts` | GET | Paginated traces from `traces` table with filters (name, status, traceId, date range) |
| 8 | `src/app/api/audit/route.ts` | GET | Paginated audit logs (admin only) with filters + user email join |

### UI Pages (3 files)

| # | Path | Purpose |
|---|------|---------|
| 9  | `src/app/admin/users/page.tsx` | Users management — list, search, add, edit, suspend/activate, delete with role assignment |
| 10 | `src/app/admin/costs/page.tsx` | Cost dashboard — 4 summary cards, daily bar chart (recharts), by-model/by-provider/by-user tables, budget CRUD with utilization progress bars |
| 11 | `src/app/admin/logs/page.tsx` | Logs viewer — tabbed UI: Traces (expandable rows + detail dialog) and Audit logs (searchable, detail dialog with before/after JSON diff) |

## Design Decisions

### Auth Pattern
All admin routes use `requireAdmin(req)` which:
1. Extracts `Bearer` token from `Authorization` header
2. Verifies via `createJWTService().verifyAccessToken(token)`
3. Checks `payload.roles?.includes('admin')`
4. Returns `null` on any failure (caller returns 403)

Non-admin routes (costs summary, breakdown, budgets list) use a lighter `getUser(req)`
that only verifies the token (non-admins are scoped to their own data).

### Security
- `password_hash` is **never** returned in any API response (all users sanitized via `sanitizeUser`)
- Passwords hashed with `hashPassword` (scrypt-based, from `src/utils/crypto.ts`)
- Soft-delete for users (status='deleted') preserves audit trail
- Self-deletion prevented (admin can't delete their own account)
- Non-admin users can only see their own cost data; only admins see `byUser` breakdown

### Resilience (Phase 7)
- Cost budgets support 3 enforcement actions: `warn`, `block`, `notify`
- 4 scopes: `user`, `session`, `agent`, `global`
- 4 periods: `daily`, `weekly`, `monthly`, `total`
- `utilization` computed server-side for the UI progress bars
- Audit logging on all budget mutations (create/update/delete)

### Drizzle ORM Usage
- Used `sql` template literals for aggregations (`SUM`, `COUNT`, `COALESCE`, `date_trunc`)
- `to_char(date_trunc('day', ...), 'YYYY-MM-DD')` for daily grouping (returns clean date strings for charts)
- `leftJoin` for breakdown by model/provider/user (handles NULL FK gracefully)
- `and()` for composable filter conditions
- `ilike` for case-insensitive name search
- `count()` for pagination totals

### UI/UX
- All 3 pages share the existing admin layout: sticky header with back button, gradient background
- `localStorage.getItem('accessToken')` for auth, redirect to `/login` if missing/403
- Responsive: tables hide non-essential columns on mobile (`hidden sm:table-cell`, `hidden md:table-cell`)
- Loading states with `RefreshCw` spinner
- Cost dashboard uses recharts `BarChart` with multi-color bars and currency formatting
- Logs viewer uses tabs (`Tabs` from shadcn/ui) to switch between Traces and Audit logs
- Expandable trace rows show attributes/resource inline; full JSON in dialog
- Audit log dialog shows `before`/`after` JSON diff with color-coded labels
- Pagination controls on both tabs

## Import Path Depths (per Next.js 16 rules)
- `api/X/route.ts` → `../../../` (3 levels) ✓
- `api/X/[id]/route.ts` → `../../../../` (4 levels) ✓
- `api/X/[id]/sub/route.ts` → `../../../../../` (5 levels) ✓ (used in budgets/[id])

## Validation

- `bun run lint` — **no errors in any of the 11 new files** (existing pre-existing errors
  in `_instrumentation-node.ts`, `embedded-postgres.ts`, etc. are unchanged and out of scope)
- Dev server log shows healthy state (35 tables, all migrations applied, seed complete)

## Patterns Reused from Existing Code

- `requireAdmin` helper — modeled after `src/app/api/providers/route.ts`
- `sanitizeUser` pattern — modeled after `sanitizeProvider` in providers routes
- Audit logging via `createAuditLogger()` from `src/observability/logger/audit.ts`
- Admin page layout — matches `src/app/admin/providers/page.tsx` and `agents/page.tsx`
- Dialog forms — matches existing AddProvider/AddModel dialog patterns

## Notes for Downstream Agents

- The audit logger is currently a no-op (disabled in `src/observability/logger/audit.ts`
  due to inet column issues with comma-separated IPs). The code still calls `audit.record()`
  so when it's re-enabled, all events will be captured.
- The new admin pages are NOT linked from the admin dashboard (`/admin`) yet. To make them
  discoverable, add cards to `src/app/admin/page.tsx`'s `adminCards` array pointing to
  `/admin/users`, `/admin/costs`, and `/admin/logs`.
- Cost budgets track `spentUsd` but there is no automatic increment mechanism in this phase.
  The spent amount must be updated via PATCH (e.g. by a cost-tracking background job).
