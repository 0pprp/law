/**
 * Phase 2 — RLS + sensitive field exposure.
 * Run: node --env-file=.env.local scripts/e2e-full-audit/20-rls.mjs
 */
import { serviceClient, roleClient, sessionFor, ACCOUNTS, BRANCH_ID, mark } from './lib.mjs'

const svc = serviceClient()
const findings = []
function rec(id, ok, detail) {
  findings.push({ id, ok, detail })
  console.log(`${mark(ok)} ${id} — ${detail}`)
}

// ---------- baseline row counts (service role, bypasses RLS) ----------
const baseline = {}
for (const t of ['criminal_cases', 'criminal_case_task_definitions', 'special_statuses']) {
  const { count } = await svc.from(t).select('id', { count: 'exact', head: true })
  baseline[t] = count ?? 0
}
console.log('baseline (service role):', JSON.stringify(baseline))

// ---------- 2a: criminal tables ----------
console.log('\n--- 2a) جداول الجزائي ---')
for (const role of ['viewer', 'accountant', 'delegate']) {
  const sb = await roleClient(ACCOUNTS[role])
  const { data, error, count } = await sb.from('criminal_cases').select('id', { count: 'exact' }).limit(5)
  const rows = count ?? data?.length ?? 0
  const blocked = !!error || rows === 0
  rec(
    `criminal_cases:${role}`,
    blocked,
    error ? `مرفوض (${error.message})` : `${rows} صف${baseline.criminal_cases === 0 ? ' — تحذير: الجدول فارغ أصلاً (اختبار غير حاسم)' : ''}`,
  )
  await sb.auth.signOut()
}
{
  const sb = await roleClient(ACCOUNTS.criminal_legal_manager)
  const { data, error, count } = await sb.from('criminal_cases').select('id, branch_id', { count: 'exact' }).limit(5)
  rec('criminal_cases:criminal_legal_manager', !error, error ? `خطأ: ${error.message}` : `${count ?? data?.length ?? 0} صف (نطاق قسمه)`)
  await sb.auth.signOut()
}

// criminal task definitions direct table read per role
console.log('\n--- 2a2) criminal_case_task_definitions (قراءة مباشرة) ---')
for (const role of ['admin', 'viewer', 'accountant', 'delegate', 'criminal_legal_manager', 'lawyer']) {
  const sb = await roleClient(ACCOUNTS[role])
  const { data, error, count } = await sb.from('criminal_case_task_definitions').select('id, actual_fee_amount', { count: 'exact' }).limit(3)
  console.log(`   ${role}: rows=${count ?? data?.length ?? 0} err=${error?.message ?? 'none'} sample=${JSON.stringify(data?.[0] ?? null)}`)
  await sb.auth.signOut()
}

// ---------- 2b: actual_fee_amount via API ----------
console.log('\n--- 2b) actual_fee_amount عبر /api/admin/task-management/criminal ---')
for (const role of ['admin', 'viewer', 'criminal_legal_manager', 'accountant']) {
  let status = 0
  let hasField = false
  let sample = null
  try {
    const s = await sessionFor(role)
    const res = await s.fetch(`/api/admin/task-management/criminal?branchId=${BRANCH_ID}`)
    status = res.status
    const text = await res.text()
    hasField = /"actual_fee_amount"/.test(text)
    try { sample = JSON.parse(text) } catch { sample = text.slice(0, 200) }
  } catch (e) {
    rec(`actual_fee_amount:${role}`, false, `فشل: ${e.message}`)
    continue
  }
  const defsCount = Array.isArray(sample?.definitions) ? sample.definitions.length
    : Array.isArray(sample?.tasks) ? sample.tasks.length
      : Array.isArray(sample) ? sample.length : 'n/a'
  if (role === 'admin') {
    rec('actual_fee_amount:admin', status === 200 && hasField, `status=${status} حقل موجود=${hasField} عناصر=${defsCount}`)
  } else {
    rec(`actual_fee_amount:${role}`, !hasField, `status=${status} حقل موجود=${hasField} عناصر=${defsCount}`)
  }
}

// ---------- 2c: special_statuses ----------
console.log('\n--- 2c) special_statuses ---')
// اختر صفة اختبارية مؤقتة للحذف
const { data: tempStatus } = await svc
  .from('special_statuses')
  .insert({ branch_id: BRANCH_ID, name: '[TEST] صفة حذف', color: 'gray', sort_order: 999, is_active: true })
  .select('id, name')
  .single()

// مدين اختباري
const { data: debtor } = await svc
  .from('debtors')
  .select('id, full_name, special_status_id, branch_id')
  .eq('branch_id', BRANCH_ID)
  .eq('case_type', 'civil')
  .is('special_status_id', null)
  .limit(1)
  .maybeSingle()

const { data: realStatus } = await svc
  .from('special_statuses')
  .select('id, name')
  .eq('branch_id', BRANCH_ID)
  .eq('is_active', true)
  .neq('id', tempStatus?.id ?? '')
  .limit(1)
  .maybeSingle()

const viewerSession = await sessionFor('viewer')

{
  const res = await viewerSession.fetch(`/api/admin/special-statuses?branchId=${BRANCH_ID}`)
  const body = await res.json().catch(() => ({}))
  rec('special_statuses:viewer:read', res.status === 200, `status=${res.status} عدد=${body?.statuses?.length ?? 'n/a'}`)
}

if (debtor && realStatus) {
  const res = await viewerSession.fetch('/api/admin/debtors/set-special-status', {
    method: 'POST',
    body: JSON.stringify({ debtorIds: [debtor.id], statusId: realStatus.id }),
  })
  const body = await res.json().catch(() => ({}))
  const ok = res.status === 200
  rec('special_statuses:viewer:assign', ok, `status=${res.status} ${JSON.stringify(body).slice(0, 160)}`)
  if (ok) {
    // rollback
    await viewerSession.fetch('/api/admin/debtors/set-special-status', {
      method: 'POST',
      body: JSON.stringify({ debtorIds: [debtor.id], statusId: null }),
    })
  }
} else {
  rec('special_statuses:viewer:assign', false, 'لا يوجد مدين/صفة صالحة للاختبار')
}

{
  const res = await viewerSession.fetch('/api/admin/special-statuses', {
    method: 'DELETE',
    body: JSON.stringify({ id: tempStatus?.id }),
  })
  rec('special_statuses:viewer:delete_denied', res.status === 403, `status=${res.status} (المتوقع 403)`)
}

{
  const res = await viewerSession.fetch('/api/admin/special-statuses', {
    method: 'POST',
    body: JSON.stringify({ name: '[TEST] صفة من المدني', color: 'red', branchId: BRANCH_ID }),
  })
  rec('special_statuses:viewer:create_allowed', res.status === 200, `status=${res.status}`)
}

{
  const s = await sessionFor('criminal_legal_manager')
  const res = await s.fetch(`/api/admin/special-statuses?branchId=${BRANCH_ID}`)
  rec('special_statuses:criminal_manager_denied', res.status === 403, `status=${res.status} (المتوقع 403)`)
}

// نظّف الصفة المؤقتة
if (tempStatus?.id) await svc.from('special_statuses').delete().eq('id', tempStatus.id)
await svc.from('special_statuses').delete().ilike('name', '[TEST]%')

console.log('\n--- ملخص المرحلة الثانية ---')
console.log(JSON.stringify(findings, null, 2))
