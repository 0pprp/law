# SECURITY_AUDIT_CRIMINAL_SECTION

## Scope

Final hardening phase for civil vs criminal isolation at the database and storage layers for **قلعة الضمان**.

In scope:

- PostgreSQL RLS helpers and policies
- Immutable `debtors.case_type` / lawyer `profiles.case_type`
- Criminal task `reward_amount = 0` at DB level
- Payment `client_request_id` idempotency
- Storage path policies for `debtor-files`
- `criminal_import_runs` policies
- DELETE / create-rollback hardening
- Service-role usage audit
- Preflight / verify SQL + regression suite

Out of scope (explicitly not added):

- Lawsuit petition import
- New PDF reports
- Background job queues
- UX redesign

## Architecture

```
Browser / Next.js UI
  → API routes (session + role + case scope + branch)
    → createAdminClient (service_role) OR user client
      → PostgreSQL RLS + triggers (last line of defense)
      → Storage policies (path → debtor_id → case/branch)
```

Trust boundary: **anything that reaches Supabase with the user JWT must be constrained by RLS**. Service-role bypasses RLS and is only acceptable after explicit API authorization.

## Trust boundaries

| Boundary | Trusted source | Untrusted |
|----------|----------------|-----------|
| Role / case_type | `profiles` row for `auth.uid()` | JWT custom claims, request body `caseType` |
| Debtor section | `debtors.case_type` | Client-provided case_type on mutations |
| Branch | `profiles.branch_id` + accountant type helpers | Arbitrary `branchId` without ACL |
| Storage object | Path-parsed `debtorId` via `storage_debtor_id_from_path` | Client metadata |
| Payment idempotency | `client_request_id` column | Notes `[req:…]` hack (retired for new rows) |

## RLS coverage matrix

| Table | Has case_type? | Derives via | Prior RLS | New requirement |
|-------|----------------|-------------|-----------|-----------------|
| `debtors` | Yes | direct | Branch staff + broad `viewer_select_all` | Section + branch; drop broad viewer |
| `criminal_debtor_details` | No | `debtor_id` | **None** | Full CRUD scoped to criminal debtor |
| `tasks` | via debtor / definition | `debtor_id` | Branch staff + viewer_all | `current_user_can_access_task` |
| `debtor_payments` | via debtor | `debtor_id` | Branch / PFU | Section + branch policies |
| `profiles` | Yes (lawyers) | direct | viewer_all | Lawyer rows section-filtered |
| `criminal_import_runs` | N/A | creator | RLS on, **0 policies** | Own rows + admin; immutable completed |
| `activity_logs` | in `new_data.case_type` | metadata / parent | viewer_all | Section select; no update/delete |
| `debtor_attachments` | via debtor | `debtor_id` | staff/lawyer | Inherit via existing + debtor access (API-gated) |
| `lawyer_wallet_transactions` / payouts | via lawyer profile | `lawyer_id` | wallet RLS | Keep + API case filter |
| `payment_noncompliance_requests` | via debtor | `debtor_id` | existing | API section guard remains |
| `notifications` | N/A | computed in API | no table | Counts API already scopes |

## Storage coverage

Bucket: `debtor-files`

| Path pattern | Policy check |
|--------------|--------------|
| `criminal/documents/{debtorId}/{uuid}.pdf` | Auth + parse debtorId + criminal case access + debtor ACL |
| `criminal/petitions/{debtorId}/{uuid}.pdf` | Same |
| Legacy / civil paths with UUID segment | Debtor ACL via extracted id |
| Path traversal / query / invalid UUID | Denied by `storage_debtor_id_from_path` |
| UPDATE | Not granted (insert/delete preferred) |

## Service-role usage matrix

Classification of `createAdminClient` / `SUPABASE_SERVICE_ROLE_KEY` under `app/api`:

| Class | Meaning | Examples |
|-------|---------|----------|
| 1 Necessary | Auth bootstrap / destructive admin | `app/api/auth/login/route.ts`, `delete-user` |
| 2 Replaceable later | Could move to user client once RLS complete | Many read GETs still use admin after auth |
| 3 Dangerous if unauth | Must never run before session/role checks | Any route missing `requireStaffProfile` |
| 4 Acceptable after auth | Current pattern for multi-table writes | `payments`, `debtors`, `import-criminal`, wallets |

**This phase:** payments, debtors DELETE, and create cleanup were hardened. Broad replacement of all admin clients was **not** done in one shot (risk of locking staff writes). Residual: prefer user-scoped client on read-only routes in a follow-up once RLS is verified live.

## High risks found

| Severity | Item | Location |
|----------|------|----------|
| Critical | Broad `viewer_select_all` allowed civil managers to read all sections via PostgREST | `20250628220000_viewer_read_all_data.sql` → addressed in `20260721160000_…` |
| Critical | `criminal_debtor_details` without RLS | Table from foundation migration |
| Critical | `criminal_import_runs` RLS enabled with zero policies (only service_role worked; client blind but also no user policies) | `20260721140000_…` |
| High | Payment idempotency in `notes` (`[req:…]`) | `app/api/admin/payments/route.ts` (fixed) |
| High | Lawyer `case_type` changeable via direct UPDATE | No DB trigger (fixed) |
| High | Criminal `reward_amount` only app-enforced | `lib/task-operations-api.ts` etc. (DB trigger added) |
| High | Public DELETE debtor usable by add/edit roles | `debtors/[id]/route.ts` (hardened) |
| Medium | Storage staff policies were role-wide, not path-scoped | `debtor_files_*` policies |
| Medium | Widespread service_role after auth | Many `app/api/admin/*` routes |
| Low | Activity `case_type` in JSON blob | `activity_logs.new_data` |

## Fixes implemented

1. `20260721150000_payment_client_request_id.sql` — official idempotency column + unique index
2. `20260721160000_criminal_rls_security_hardening.sql` — helpers, triggers, RLS, storage
3. Payments API writes `client_request_id` (no notes hack)
4. DELETE hardened + `lib/debtor-hard-delete.ts` for create rollback
5. `preflight-criminal-security.sql` / `verify-criminal-security.sql`
6. `scripts/regression-criminal-rls.mjs` (≥180 checks)
7. This audit document

## Risks accepted

- Service-role remains on most admin write APIs after authorization (operational stability).
- `notifications` remain API-computed (no physical table to RLS).
- Legacy payment rows keep `client_request_id = NULL` (no unreliable notes parsing).
- Lawyer section transfer workflow intentionally not implemented.

## Residual risks

| Severity | Residual | Mitigation |
|----------|----------|------------|
| High until live apply | Migrations not applied to Production | Follow deployment order below |
| Medium | OR policies from older migrations may still widen access if not dropped | Hardening drops known `viewer_select_all` on key tables; re-run verify after apply |
| Medium | Storage civil path UUID extraction may be imperfect for exotic legacy paths | Prefer criminal path pattern; audit legacy paths before prod |
| Low | Activity logs without `case_type` in `new_data` default to civil in policy | Backfill optional later |

## Production deployment order

1. Backup DB + storage metadata
2. Run `supabase/scripts/preflight-criminal-security.sql` — fix non-zero anomalies
3. Ensure foundation + import_runs migrations already applied
4. Apply `20260721150000_payment_client_request_id.sql`
5. Apply `20260721160000_criminal_rls_security_hardening.sql`
6. Run `verify-criminal-security.sql`
7. Deploy app build that uses `client_request_id` + DELETE hardening
8. Smoke: viewer / criminal_legal_manager / admin / accountant / civil+criminal lawyers
9. Monitor API 4xx/5xx and Postgres logs for policy violations
10. Rollback plan if isolation false-positives lock civil ops

## Rollback plan

1. Keep previous app release ready (notes-based idempotency if needed)
2. SQL rollback is **not** a simple down migration — restore from backup or selectively:
   - Recreate prior `viewer_select_all` / `staff_debtors_*` only if emergency
   - Drop new triggers if they block legitimate ops
3. Prefer fix-forward on policies rather than disabling RLS globally

## Verification checklist

- [ ] Preflight counts are zero (or accepted)
- [ ] Verify shows RLS on + section policies + helpers + triggers
- [ ] `node scripts/regression-criminal-rls.mjs` ≥180 PASS
- [ ] Prior regression scripts PASS
- [ ] `npx tsc --noEmit` PASS
- [ ] `npm run build` PASS
- [ ] Lint PASS if configured
- [ ] Live role probes: no cross-section debtor/task/lawyer/PDF
- [ ] No service role key in client bundle
- [ ] No plaintext seed passwords in repo migrations
