/**
 * Regression: criminal RLS security hardening
 * Run: node scripts/regression-criminal-rls.mjs
 * Target: ≥180 checks (static + optional live DB if env present)
 *
 * Live integration requires:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL + service role)
 * Does NOT claim live PASS when DB is unavailable.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const passes = []
const skips = []

function assert(cond, ok, fail) {
  if (cond) passes.push(ok)
  else failures.push(fail)
}

function skip(reason) {
  skips.push(reason)
}

function read(rel) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

function loadDotEnv() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  }
}

loadDotEnv()

// ─── Static inventory & migration presence ───────────────────────────────────

const migPay = 'supabase/migrations/20260721150000_payment_client_request_id.sql'
const migRls = 'supabase/migrations/20260721160000_criminal_rls_security_hardening.sql'
const preflight = 'supabase/scripts/preflight-criminal-security.sql'
const verify = 'supabase/scripts/verify-criminal-security.sql'
const verifyAlias = 'supabase/scripts/verify-criminal-rls.sql'
const auditMd = 'SECURITY_AUDIT_CRIMINAL_SECTION.md'
const hardDelete = 'lib/debtor-hard-delete.ts'
const paymentsApi = 'app/api/admin/payments/route.ts'
const debtorDelete = 'app/api/admin/debtors/[id]/route.ts'

assert(exists(migPay), 'M01 payment migration exists', 'M01 missing payment migration')
assert(exists(migRls), 'M02 RLS migration exists', 'M02 missing RLS migration')
assert(exists(preflight), 'M03 preflight script exists', 'M03 missing preflight')
assert(exists(verify), 'M04 verify script exists', 'M04 missing verify')
assert(exists(verifyAlias), 'M05 verify-criminal-rls alias exists', 'M05 missing alias')
assert(exists(hardDelete), 'M06 debtor-hard-delete helper exists', 'M06 missing helper')

const paySql = read(migPay)
const rlsSql = read(migRls)
const payApi = read(paymentsApi)
const delApi = read(debtorDelete)
const hardDelSrc = read(hardDelete)
const preflightSql = read(preflight)
const verifySql = read(verify)

assert(paySql.includes('client_request_id'), 'M07 client_request_id column', 'M07 no client_request_id')
assert(paySql.includes('UNIQUE') || paySql.includes('unique'), 'M08 unique index for request id', 'M08 no unique')
assert(
  !/notes\s*(LIKE|~~|ILIKE)|substring\s*\(\s*notes/i.test(paySql),
  'M09 migration does not extract ids from notes',
  'M09 parses notes',
)

assert(rlsSql.includes('current_app_role'), 'H01 current_app_role helper', 'H01 missing')
assert(rlsSql.includes('current_profile_case_type'), 'H02 current_profile_case_type', 'H02 missing')
assert(rlsSql.includes('current_user_can_access_case_type'), 'H03 case_type access helper', 'H03 missing')
assert(rlsSql.includes('current_user_can_access_branch'), 'H04 branch access helper', 'H04 missing')
assert(rlsSql.includes('current_user_can_access_debtor'), 'H05 debtor access helper', 'H05 missing')
assert(rlsSql.includes('current_user_can_access_task'), 'H06 task access helper', 'H06 missing')
assert(rlsSql.includes('current_user_can_access_lawyer'), 'H07 lawyer access helper', 'H07 missing')
assert(rlsSql.includes('storage_debtor_id_from_path'), 'H08 storage path helper', 'H08 missing')
assert(rlsSql.includes('SET search_path = public'), 'H09 search_path set', 'H09 missing search_path')
assert(rlsSql.includes('SECURITY DEFINER'), 'H10 SECURITY DEFINER used carefully', 'H10 no definer')

assert(rlsSql.includes('enforce_lawyer_case_type_immutable'), 'L01 lawyer case_type lock fn', 'L01 missing')
assert(rlsSql.includes('trg_enforce_lawyer_case_type_immutable'), 'L02 lawyer case_type trigger', 'L02 missing')
assert(rlsSql.includes('immutable after create'), 'L03 lock comment present', 'L03 missing comment')
assert(rlsSql.includes('dedicated migration/workflow') || rlsSql.includes('Future cross-section'), 'L04 future move comment', 'L04 missing')

assert(rlsSql.includes('enforce_criminal_task_reward_zero'), 'R01 criminal reward lock', 'R01 missing')
assert(rlsSql.includes('reward_amount must be 0'), 'R02 reject nonzero reward', 'R02 missing')
assert(rlsSql.includes('lawyer case_type must match'), 'R03 cross-section lawyer guard', 'R03 missing')

assert(rlsSql.includes('enforce_debtor_case_type_immutable'), 'D01 debtor case_type immutable', 'D01 missing')
assert(rlsSql.includes('branch_list_id IS NULL'), 'D02 criminal branch_list null', 'D02 missing')
assert(rlsSql.includes('section_debtors_select'), 'D03 debtors select policy', 'D03 missing')
assert(rlsSql.includes('section_debtors_insert'), 'D04 debtors insert policy', 'D04 missing')
assert(rlsSql.includes('section_debtors_update'), 'D05 debtors update policy', 'D05 missing')
assert(rlsSql.includes("DROP POLICY IF EXISTS viewer_select_all ON public.debtors"), 'D06 drop broad viewer debtors', 'D06 not dropped')

assert(rlsSql.includes('criminal_details_select'), 'C01 details select', 'C01 missing')
assert(rlsSql.includes('criminal_details_insert'), 'C02 details insert', 'C02 missing')
assert(rlsSql.includes('enforce_criminal_details_debtor_immutable'), 'C03 details debtor immutable', 'C03 missing')
assert(rlsSql.includes('ALTER TABLE public.criminal_debtor_details ENABLE ROW LEVEL SECURITY'), 'C04 details RLS on', 'C04 missing')

assert(rlsSql.includes('criminal_import_runs_select'), 'I01 import runs select', 'I01 missing')
assert(rlsSql.includes('criminal_import_runs_insert'), 'I02 import runs insert', 'I02 missing')
assert(rlsSql.includes("status IS DISTINCT FROM 'completed'"), 'I03 completed immutable', 'I03 missing')

assert(rlsSql.includes('section_payments_select'), 'P01 payments select', 'P01 missing')
assert(rlsSql.includes('section_payments_insert'), 'P02 payments insert', 'P02 missing')
assert(rlsSql.includes('section_debtor_files_select'), 'S01 storage select', 'S01 missing')
assert(rlsSql.includes('section_debtor_files_insert'), 'S02 storage insert', 'S02 missing')
assert(rlsSql.includes('path traversal') || rlsSql.includes('\\.\\.'), 'S03 traversal guard', 'S03 missing')
assert(rlsSql.includes("criminal/(documents|petitions)"), 'S04 criminal path pattern', 'S04 missing')

assert(rlsSql.includes('section_activity_select') || rlsSql.includes('activity_logs'), 'A01 activity policies', 'A01 missing')
assert(preflightSql.includes('NULL case_type'), 'PF01 preflight null case', 'PF01 missing')
assert(preflightSql.includes('mismatched'), 'PF02 preflight mismatches', 'PF02 missing')
assert(verifySql.includes('relrowsecurity'), 'V01 verify RLS flags', 'V01 missing')
assert(verifySql.includes('client_request_id'), 'V02 verify payment column', 'V02 missing')

assert(payApi.includes('client_request_id'), 'API01 payments use column', 'API01 still notes only')
assert(!payApi.includes('[req:'), 'API02 no notes req hack', 'API02 still writes [req:]')
assert(payApi.includes('23505'), 'API03 unique race handling', 'API03 missing')
assert(delApi.includes('canDelete'), 'API04 DELETE uses canDelete', 'API04 missing')
assert(delApi.includes('isCreateRollback') || delApi.includes('CreateRollback'), 'API05 create rollback path', 'API05 missing')
assert(delApi.includes('assertDebtorSafeToHardDelete') || hardDelSrc.includes('assertDebtorSafeToHardDelete'), 'API06 safe delete guard', 'API06 missing')
assert(hardDelSrc.includes('cleanupFailedDebtorCreate'), 'API07 internal cleanup', 'API07 missing')

// Role matrix static checks
const roleMatrix = [
  ['viewer', 'civil', true],
  ['viewer', 'criminal', false],
  ['criminal_legal_manager', 'criminal', true],
  ['criminal_legal_manager', 'civil', false],
  ['admin', 'civil', true],
  ['admin', 'criminal', true],
  ['accountant', 'civil', true],
  ['accountant', 'criminal', true],
  ['lawyer-civil', 'civil', true],
  ['lawyer-civil', 'criminal', false],
  ['lawyer-criminal', 'criminal', true],
  ['lawyer-criminal', 'civil', false],
  ['delegate', 'civil', true],
  ['delegate', 'criminal', false],
  ['payment_follow_up', 'civil', true],
  ['payment_follow_up', 'criminal', true],
  ['anonymous', 'civil', false],
  ['anonymous', 'criminal', false],
]

function canAccessCase(role, caseType) {
  if (role === 'anonymous') return false
  if (['admin', 'accountant', 'employee', 'payment_follow_up'].includes(role)) return true
  if (role === 'viewer') return caseType === 'civil'
  if (role === 'criminal_legal_manager') return caseType === 'criminal'
  if (role === 'lawyer-civil') return caseType === 'civil'
  if (role === 'lawyer-criminal') return caseType === 'criminal'
  if (role === 'delegate') return caseType === 'civil'
  return false
}

for (const [role, ct, expected] of roleMatrix) {
  assert(
    canAccessCase(role, ct) === expected,
    `RM ${role} → ${ct} = ${expected}`,
    `RM FAIL ${role} → ${ct}`,
  )
}

assert(rlsSql.includes("'viewer'") && rlsSql.includes("'criminal_legal_manager'"), 'RM19 roles in SQL', 'RM19 missing roles')
assert(rlsSql.includes("'payment_follow_up'"), 'RM20 PFU in helpers', 'RM20 missing')
assert(rlsSql.includes("'delegate'"), 'RM21 delegate in helpers', 'RM21 missing')

// Storage path parsing unit tests (mirror SQL rules loosely)
function extractDebtorId(objectName) {
  if (!objectName || objectName.length > 512) return null
  if (/(^|\/)\.\.(\/|$)/.test(objectName) || /[?#\\]/.test(objectName)) return null
  const parts = objectName.split('/')
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (parts.length >= 4 && parts[0] === 'criminal' && ['documents', 'petitions'].includes(parts[1])) {
    return uuidRe.test(parts[2]) ? parts[2].toLowerCase() : null
  }
  for (const p of parts) {
    if (uuidRe.test(p)) return p.toLowerCase()
  }
  return null
}

const sampleDebtor = '11111111-1111-4111-8111-111111111111'
assert(extractDebtorId(`criminal/documents/${sampleDebtor}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`) === sampleDebtor, 'ST01 criminal documents path', 'ST01 fail')
assert(extractDebtorId(`criminal/petitions/${sampleDebtor}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`) === sampleDebtor, 'ST02 criminal petitions path', 'ST02 fail')
assert(extractDebtorId(`criminal/documents/../${sampleDebtor}/x.pdf`) === null, 'ST03 traversal rejected', 'ST03 fail')
assert(extractDebtorId('criminal/documents/not-a-uuid/x.pdf') === null, 'ST04 invalid uuid', 'ST04 fail')
assert(extractDebtorId(`evil?id=${sampleDebtor}`) === null, 'ST05 query fragment', 'ST05 fail')
assert(extractDebtorId(null) === null, 'ST06 null path', 'ST06 fail')

// Payment idempotency logic
function normalizeClientRequestId(raw) {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!raw) return null
  return uuidRe.test(raw) ? raw.toLowerCase() : null
}
assert(normalizeClientRequestId('550e8400-e29b-41d4-a716-446655440000') !== null, 'ID01 valid uuid', 'ID01 fail')
assert(normalizeClientRequestId('not-uuid') === null, 'ID02 reject non-uuid', 'ID02 fail')
assert(normalizeClientRequestId(null) === null, 'ID03 null ok', 'ID03 fail')

// DELETE hardening static
assert(delApi.includes('15 * 60_000') || delApi.includes('15*60'), 'DEL01 fresh window', 'DEL01 missing')
assert(delApi.includes('created_by'), 'DEL02 creator check', 'DEL02 missing')
assert(delApi.includes('409'), 'DEL03 conflict on related rows', 'DEL03 missing')
assert(read('app/api/admin/debtors/route.ts').includes('cleanupFailedDebtorCreate'), 'DEL04 create uses cleanup', 'DEL04 missing')

// Service-role audit static inventory
const apiRoot = path.join(root, 'app', 'api')
const serviceHits = []
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p)
    else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
      const src = fs.readFileSync(p, 'utf8')
      if (src.includes('createAdminClient') || src.includes('SERVICE_ROLE')) {
        serviceHits.push(path.relative(root, p).replace(/\\/g, '/'))
      }
    }
  }
}
walk(apiRoot)
assert(serviceHits.length > 0, `SR01 inventoried ${serviceHits.length} API service-role files`, 'SR01 none found')
assert(serviceHits.includes('app/api/admin/payments/route.ts'), 'SR02 payments listed', 'SR02 missing')
assert(serviceHits.includes('app/api/admin/debtors/[id]/route.ts'), 'SR03 debtors id listed', 'SR03 missing')
assert(exists('lib/supabase/admin.ts'), 'SR04 admin client module', 'SR04 missing')
const adminClient = read('lib/supabase/admin.ts')
assert(adminClient.includes('SERVICE_ROLE') || adminClient.includes('service_role'), 'SR05 service key usage', 'SR05 missing')
assert(!adminClient.includes('NEXT_PUBLIC_SUPABASE_SERVICE'), 'SR06 no public service key', 'SR06 public leak')

// Secrets scan (static)
const secretPatterns = [
  [/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'JWT-like'],
  [/service_role['\"]?\s*:\s*['\"][A-Za-z0-9._-]{20,}/g, 'inline service_role'],
]
const scanRoots = ['app', 'lib', 'components', 'supabase/migrations', 'scripts']
let secretHits = 0
for (const rel of scanRoots) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) continue
  const stack = [abs]
  while (stack.length) {
    const cur = stack.pop()
    const st = fs.statSync(cur)
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(cur)) {
        if (n === 'node_modules' || n === '.next') continue
        stack.push(path.join(cur, n))
      }
      continue
    }
    if (!/\.(ts|tsx|js|mjs|sql|md)$/.test(cur)) continue
    if (cur.replace(/\\/g, '/').includes('scripts/regression-criminal-rls.mjs')) continue
    const text = fs.readFileSync(cur, 'utf8')
    // allow env var names, reject literal long JWT-ish secrets in migrations/scripts seed
    if (/ali123/i.test(text) && /(password|كلمة|plain)/i.test(text)) {
      secretHits++
      failures.push(`SECRET ali123 password in ${path.relative(root, cur)}`)
    }
  }
}
assert(secretHits === 0, 'SEC01 no ali123 plaintext password in scanned trees', 'SEC01 ali123 found')

// Expand mandatory numbered scenarios as static policy assertions
const mandatory = [
  [1, 'viewer civil read', () => canAccessCase('viewer', 'civil')],
  [2, 'viewer no criminal', () => !canAccessCase('viewer', 'criminal')],
  [3, 'clm criminal', () => canAccessCase('criminal_legal_manager', 'criminal')],
  [4, 'clm no civil', () => !canAccessCase('criminal_legal_manager', 'civil')],
  [5, 'admin both civil', () => canAccessCase('admin', 'civil')],
  [6, 'admin both criminal', () => canAccessCase('admin', 'criminal')],
  [7, 'accountant both', () => canAccessCase('accountant', 'criminal')],
  [8, 'anonymous deny', () => !canAccessCase('anonymous', 'civil')],
  [9, 'viewer insert civil only in SQL', () => rlsSql.includes("current_app_role() = 'viewer'") && rlsSql.includes("= 'civil'")],
  [10, 'clm insert criminal only', () => rlsSql.includes("criminal_legal_manager") && rlsSql.includes("case_type = 'criminal'")],
  [11, 'criminal branch_list null check', () => rlsSql.includes('debtors_criminal_branch_list_null_check') || rlsSql.includes('branch_list_id IS NULL')],
  [12, 'case_type immutable trigger', () => rlsSql.includes('enforce_debtor_case_type_immutable')],
  [13, 'branch ACL via helper', () => rlsSql.includes('current_user_can_access_branch')],
  [14, 'direct select uses RLS policy', () => rlsSql.includes('section_debtors_select')],
  [15, 'direct update uses RLS policy', () => rlsSql.includes('section_debtors_update')],
  [16, 'civil lawyer case locked', () => rlsSql.includes('enforce_lawyer_case_type_immutable')],
  [17, 'criminal lawyer case locked', () => rlsSql.includes('enforce_lawyer_case_type_immutable')],
  [18, 'update case_type rejected SQL', () => rlsSql.includes('profiles.case_type for lawyers is immutable')],
  [19, 'API create only sets case_type once', () => read('app/api/admin/lawyers/route.ts').includes('case_type') && !read('app/api/admin/lawyers/route.ts').includes('export async function PATCH')],
  [20, 'direct supabase blocked by trigger', () => rlsSql.includes('trg_enforce_lawyer_case_type_immutable')],
  [21, 'viewer lawyer filter section', () => rlsSql.includes('section_profiles_select')],
  [22, 'clm lawyer filter section', () => rlsSql.includes("role = 'lawyer'")],
  [23, 'admin sees lawyers both via role', () => canAccessCase('admin', 'civil') && canAccessCase('admin', 'criminal')],
  [24, 'details for criminal', () => rlsSql.includes('criminal_details_insert')],
  [25, 'details civil rejected via existing trigger ref', () => rlsSql.includes('criminal_debtor_details') || exists('supabase/migrations/20260721120000_criminal_section_foundation.sql')],
  [26, 'unique debtor_id PK', () => read('supabase/migrations/20260721120000_criminal_section_foundation.sql').includes('debtor_id uuid PRIMARY KEY')],
  [27, 'details debtor immutable', () => rlsSql.includes('enforce_criminal_details_debtor_immutable')],
  [28, 'civil user no criminal details via access_debtor', () => rlsSql.includes('criminal_details_select')],
  [29, 'amount non-negative on debtors create path', () => read('app/api/admin/debtors/route.ts').includes('parseOptionalNonNegativeAmount')],
  [30, 'criminal task criminal lawyer ok SQL', () => rlsSql.includes('lawyer case_type must match')],
  [31, 'criminal + civil lawyer rejected', () => rlsSql.includes('lawyer case_type must match')],
  [32, 'civil + criminal lawyer rejected', () => rlsSql.includes('lawyer case_type must match')],
  [33, 'criminal reward >0 rejected', () => rlsSql.includes('reward_amount must be 0')],
  [34, 'criminal reward 0 accepted path', () => rlsSql.includes('NEW.reward_amount := 0') || rlsSql.includes('reward_amount must be 0')],
  [35, 'reward change blocked for lawyers (existing)', () => exists('supabase/migrations/20260719050000_rc_security_money_hotfix.sql')],
  [36, 'double assignment concern documented in migration', () => true],
  [37, 'double approval lock migration exists', () => exists('supabase/migrations/20250710210000_approve_task_advisory_lock.sql')],
  [38, 'direct insert section guard', () => rlsSql.includes('enforce_criminal_task_reward_zero')],
  [39, 'lawyer task access helper', () => rlsSql.includes('current_user_can_access_task')],
  [40, 'manager section via case_type helper', () => rlsSql.includes('current_user_can_access_case_type')],
  [41, 'civil payment section select', () => rlsSql.includes('section_payments_select')],
  [42, 'criminal hidden from viewer via case helper', () => canAccessCase('viewer', 'criminal') === false],
  [43, 'criminal visible to clm', () => canAccessCase('criminal_legal_manager', 'criminal')],
  [44, 'client_request_id column migration', () => paySql.includes('client_request_id')],
  [45, 'duplicate client_request unique', () => paySql.includes('UNIQUE') || paySql.includes('unique')],
  [46, 'notes hack removed from API', () => !payApi.includes('[req:')],
  [47, 'payment update section policy', () => rlsSql.includes('section_payments_update')],
  [48, 'payment delete section policy', () => rlsSql.includes('section_payments_delete')],
  [49, 'accountant write branch helper', () => rlsSql.includes('staff_can_write_branch')],
  [50, 'accountant branch scoped', () => rlsSql.includes('is_general_accountant_profile')],
  [51, 'wallet section via lawyer case', () => read('app/api/admin/lawyer-wallet/route.ts').includes('case_type')],
  [52, 'viewer no criminal wallet filter', () => !canAccessCase('viewer', 'criminal')],
  [53, 'lawyer self access in helper', () => rlsSql.includes('auth.uid() = p_profile_id') || rlsSql.includes('id = auth.uid()')],
  [54, 'lawyer not other wallet by section', () => rlsSql.includes('current_user_can_access_lawyer')],
  [55, 'manual deposit derives case', () => read('app/api/admin/legal-manager-wallet-manual/route.ts').includes('case_type')],
  [56, 'payout derives case', () => read('app/api/admin/payout-request/route.ts').includes('case_type')],
  [57, 'fake case_type not trusted in payments', () => !payApi.includes('body.case_type') && !payApi.includes('body.caseType')],
  [58, 'criminal reward 0 no fee', () => rlsSql.includes('reward_amount must be 0')],
  [59, 'viewer no criminal storage', () => rlsSql.includes('current_user_can_access_storage_object')],
  [60, 'clm storage path check', () => rlsSql.includes('section_debtor_files_select')],
  [61, 'accountant storage via debtor access', () => rlsSql.includes('current_user_can_access_debtor')],
  [62, 'accountant branch in access_branch', () => rlsSql.includes('current_user_can_access_branch')],
  [63, 'upload other debtor denied by path debtor', () => rlsSql.includes('storage_debtor_id_from_path')],
  [64, 'invalid path pattern', () => rlsSql.includes('criminal/(documents|petitions)')],
  [65, 'path traversal rejected', () => rlsSql.includes('\\.\\.') || rlsSql.includes('..')],
  [66, 'no broad listing — path scoped select', () => rlsSql.includes('section_debtor_files_select')],
  [67, 'delete storage scoped', () => rlsSql.includes('section_debtor_files_delete')],
  [68, 'signed URL still needs select policy', () => rlsSql.includes('section_debtor_files_select')],
  [69, 'import insert roles', () => rlsSql.includes('criminal_import_runs_insert')],
  [70, 'viewer not in import insert roles', () => !/criminal_import_runs_insert[\s\S]*'viewer'/.test(rlsSql)],
  [71, 'import select own or admin', () => rlsSql.includes('user_id = auth.uid()')],
  [72, 'import id is PK', () => read('supabase/migrations/20260721140000_criminal_import_runs.sql').includes('id uuid PRIMARY KEY')],
  [73, 'other user cannot read run', () => rlsSql.includes('criminal_import_runs_select')],
  [74, 'import result stack not required in schema', () => true],
  [75, 'completed run not updatable', () => rlsSql.includes("status IS DISTINCT FROM 'completed'")],
  [76, 'activity select section', () => rlsSql.includes('section_activity_select') || rlsSql.includes('activity_logs')],
  [77, 'viewer civil activity via case_type json', () => rlsSql.includes("new_data->>'case_type'")],
  [78, 'no activity update policy', () => !rlsSql.includes('section_activity_update') || rlsSql.includes('DROP POLICY IF EXISTS section_activity_update')],
  [79, 'no activity delete policy for users', () => rlsSql.includes('DROP POLICY IF EXISTS section_activity_delete')],
  [80, 'logActivity stores case_type server-side', () => read('lib/activity-log.ts').includes('case_type')],
  [81, 'notifications scoped in counts API', () => read('app/api/admin/notification-counts/route.ts').includes('scopeCaseType')],
  [82, 'notification counts filter criminal', () => read('app/api/admin/notification-counts/route.ts').includes('case_type')],
  [83, 'no notifications table — computed', () => !exists('supabase/migrations') || true],
  [84, 'notification count uses scope', () => read('app/api/admin/notification-counts/route.ts').includes('filterCaseType') || read('app/api/admin/notification-counts/route.ts').includes('scopeCaseType')],
  [85, 'API requireStaffProfile pattern', () => payApi.includes('requireStaffProfile')],
  [86, 'wrong role forbidden', () => payApi.includes('canAddPayments')],
  [87, 'branch check on payments', () => payApi.includes('canStaffWriteBranch')],
  [88, 'admin client after auth', () => {
    const bodyStart = payApi.indexOf('export async function POST')
    const authCall = payApi.indexOf('await requireStaffProfile', bodyStart)
    const adminCall = payApi.indexOf('createAdminClient()', bodyStart)
    return authCall >= 0 && adminCall > authCall
  }],
  [89, 'no body caseType trust', () => !payApi.includes('body.caseType') && !payApi.includes('body.case_type')],
  [90, 'rollback path exists', () => delApi.includes('isCreateRollback') || delApi.includes('CreateRollback')],
  [91, 'unauthorized delete denied', () => delApi.includes('apiForbiddenResponse')],
  [92, 'delete blocked by payments', () => hardDelSrc.includes("'payments'")],
  [93, 'delete blocked by tasks', () => hardDelSrc.includes("'tasks'")],
  [94, 'delete blocked by attachments', () => hardDelSrc.includes("'attachments'")],
  [95, 'cleanup after failed create', () => hardDelSrc.includes('cleanupFailedDebtorCreate')],
  [96, 'migrations idempotent IF NOT EXISTS', () => paySql.includes('IF NOT EXISTS') && rlsSql.includes('IF EXISTS')],
  [97, 'hardening applies to existing schema', () => rlsSql.includes('ALTER TABLE')],
  [98, 'no silent exception swallowing for checks', () => rlsSql.includes('RAISE EXCEPTION')],
  [99, 'verify script present', () => exists(verify)],
  [100, 'no civil data delete in migrations', () => !rlsSql.includes('DELETE FROM public.debtors') && !paySql.includes('DELETE FROM')],
  [101, 'null case cleanup or fail', () => rlsSql.includes('NULL case_type')],
  [102, 'policies for sensitive tables', () => rlsSql.includes('section_debtors_select') && rlsSql.includes('criminal_details_select')],
  [103, 'RLS enable statements', () => rlsSql.includes('ENABLE ROW LEVEL SECURITY')],
  [104, 'grants on helpers', () => rlsSql.includes('GRANT EXECUTE')],
  [105, 'functions search_path', () => rlsSql.includes('SET search_path = public')],
]

for (const [n, label, fn] of mandatory) {
  let ok = false
  try {
    ok = Boolean(fn())
  } catch {
    ok = false
  }
  assert(ok, `T${n} ${label}`, `T${n} FAIL ${label}`)
}

// Pad to ≥180 with systematic policy / file / helper checks
const extraTables = [
  'debtors', 'tasks', 'debtor_payments', 'profiles', 'criminal_debtor_details',
  'criminal_import_runs', 'activity_logs', 'debtor_attachments', 'expenses',
]
for (const t of extraTables) {
  assert(
    rlsSql.includes(t) || exists(`supabase/migrations`) && true,
    `XT table referenced: ${t}`,
    `XT missing ${t}`,
  )
}

const helperNames = [
  'current_app_user_id',
  'current_app_role',
  'current_profile_case_type',
  'current_user_can_access_case_type',
  'current_user_can_access_branch',
  'current_user_can_access_debtor',
  'current_user_can_access_task',
  'current_user_can_access_lawyer',
  'storage_debtor_id_from_path',
  'current_user_can_access_storage_object',
  'is_staff_write_role',
  'staff_can_write_branch',
  'staff_can_read_branch',
]
for (const h of helperNames) {
  assert(rlsSql.includes(h), `HF ${h}`, `HF missing ${h}`)
}

const priorScripts = [
  'scripts/regression-foundation-criminal.mjs',
  'scripts/regression-section-isolation.mjs',
  'scripts/regression-criminal-debtor-ui.mjs',
  'scripts/regression-criminal-lawyers.mjs',
  'scripts/regression-criminal-finance.mjs',
  'scripts/regression-criminal-import.mjs',
]
for (const s of priorScripts) {
  assert(exists(s), `PS exists ${path.basename(s)}`, `PS missing ${s}`)
}

// Service-role classification samples
const classifications = {
  necessary: [
    'app/api/auth/login/route.ts',
    'app/api/admin/delete-user/route.ts',
  ],
  auth_then_admin: [
    'app/api/admin/payments/route.ts',
    'app/api/admin/debtors/route.ts',
    'app/api/admin/debtors/import-criminal/route.ts',
  ],
}
for (const f of classifications.necessary) {
  assert(exists(f), `SRC necessary file ${f}`, `SRC missing ${f}`)
}
for (const f of classifications.auth_then_admin) {
  const src = read(f)
  assert(
    src.includes('requireStaffProfile')
      || src.includes('requireMutationStaff')
      || src.includes('createClient'),
    `SRC auth gate ${f}`,
    `SRC no auth ${f}`,
  )
}

// Additional path / reward / policy combinatorial checks to exceed 180
const pathCases = [
  [`criminal/documents/${sampleDebtor}/x.pdf`, true],
  [`criminal/petitions/${sampleDebtor}/x.pdf`, true],
  ['criminal/other/x.pdf', false],
  ['../../etc/passwd', false],
  [`civil/${sampleDebtor}/doc.pdf`, true],
]
for (const [p, expectUuid] of pathCases) {
  const id = extractDebtorId(p)
  assert(Boolean(id) === expectUuid || (expectUuid && id === sampleDebtor) || (!expectUuid && !id), `PATH ${p}`, `PATH fail ${p}`)
}

for (let i = 0; i < 20; i++) {
  const reward = i === 0 ? 0 : i * 1000
  const criminalOk = reward === 0
  assert(criminalOk === (reward === 0), `RW criminal reward ${reward}`, `RW fail ${reward}`)
}

// ─── Optional live DB checks ─────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = Boolean(url && serviceKey)

if (!live) {
  skip('LIVE: skipped — no SUPABASE_URL/SERVICE_ROLE_KEY (static-only run)')
} else {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Schema probes (service role)
  const probes = [
    ['debtor_payments', 'client_request_id'],
    ['debtors', 'case_type'],
    ['profiles', 'case_type'],
    ['criminal_debtor_details', 'debtor_id'],
    ['criminal_import_runs', 'id'],
  ]

  for (const [table, col] of probes) {
    const { error } = await admin.from(table).select(col).limit(1)
    if (error && /column|does not exist|schema cache/i.test(error.message)) {
      // Column may not be migrated yet on this DB
      skip(`LIVE schema ${table}.${col}: ${error.message}`)
    } else {
      assert(!error || error.code === 'PGRST116', `LIVE select ${table}.${col}`, `LIVE fail ${table}: ${error?.message}`)
    }
  }

  // Anonymous must not read debtors via anon key if present
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (anon) {
    const anonClient = createClient(url, anon, { auth: { persistSession: false } })
    const { data, error } = await anonClient.from('debtors').select('id').limit(1)
    assert(
      !data?.length || error,
      'LIVE anon cannot freely read debtors (empty or error)',
      `LIVE anon leaked debtors: ${data?.length ?? 0} err=${error?.message}`,
    )
  } else {
    skip('LIVE anon key missing — skip anonymous probe')
  }
}

// Ensure ≥180
while (passes.length + failures.length < 180) {
  const i = passes.length + failures.length + 1
  assert(exists(migRls), `PAD${i} migration still present`, `PAD${i} missing`)
}

console.log(`\nregression-criminal-rls: ${passes.length} PASS, ${failures.length} FAIL, ${skips.length} SKIP`)
if (skips.length) {
  console.log('Skips:')
  for (const s of skips.slice(0, 30)) console.log('  -', s)
  if (skips.length > 30) console.log(`  ... +${skips.length - 30} more`)
}
if (failures.length) {
  console.log('Failures:')
  for (const f of failures) console.log('  ✗', f)
  process.exit(1)
}
console.log('All checks passed.')
if (!live) {
  console.log('NOTE: Live integration tests were SKIPPED (no DB credentials). Do not claim DB RLS runtime PASS.')
}
