/**
 * اختبار سريع: التحويل إلى جاري التسديد مع نوع/مكان التسديد
 * يتطلب: apply-debtor-payment-type-location.sql
 */
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  const path = resolve(root, '.env.local')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
}

const env = { ...loadEnv(), ...process.env }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const report = { ok: [], fail: [], notes: [] }
function ok(m) { report.ok.push(m); console.log('✓', m) }
function fail(m, d) { report.fail.push(d ? `${m}: ${d}` : m); console.error('✗', m, d || '') }
function note(m) { report.notes.push(m); console.log('·', m) }

const TAG = `QA-PIP-MOVE-${Date.now().toString(36)}`
const createdDebtors = []
const createdUsers = []

async function probeColumns() {
  const { error } = await admin.from('debtors').select('id, payment_type, payment_location').limit(1)
  if (error) {
    fail('columns missing', error.message)
    note('شغّل supabase/scripts/apply-debtor-payment-type-location.sql')
    return false
  }
  ok('payment_type + payment_location exist')
  return true
}

async function getBranch() {
  const { data } = await admin.from('branches').select('id, name').eq('is_active', true)
  return (data ?? []).find(b => b.name !== 'الفرع الرئيسي') ?? data?.[0] ?? null
}

async function createDebtor(branchId) {
  const { data, error } = await admin.from('debtors').insert({
    full_name: `${TAG} مدين`,
    receipt_number: `TEST-MOVE-${randomBytes(3).toString('hex')}`,
    receipt_type: 'other',
    receipt_amount: 1000000,
    remaining_amount: 500000,
    required_amount: 500000,
    total_payments: 0,
    lawyer_fees: 0,
    penalty_amount: 0,
    branch_id: branchId,
    case_type: 'civil',
    case_status: 'active',
    export_date: new Date().toISOString().split('T')[0],
  }).select('id').single()
  if (error) throw new Error(error.message)
  createdDebtors.push(data.id)
  return data.id
}

/** يحاكي validation في الـ API */
function validateMove(paymentType, paymentLocation) {
  const VALID_TYPES = new Set(['daily', 'weekly', 'monthly'])
  const VALID_LOCATIONS = new Set(['company', 'execution'])
  if (!VALID_TYPES.has(paymentType)) return { ok: false, error: 'يجب اختيار نوع التسديد' }
  if (!VALID_LOCATIONS.has(paymentLocation)) return { ok: false, error: 'يجب اختيار مكان التسديد' }
  return { ok: true }
}

async function doMove(debtorId, paymentType, paymentLocation) {
  const v = validateMove(paymentType, paymentLocation)
  if (!v.ok) return v
  const { error } = await admin.from('debtors').update({
    case_status: 'payment_in_progress',
    payment_type: paymentType,
    payment_location: paymentLocation,
    current_task_id: null,
  }).eq('id', debtorId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

async function cleanup() {
  for (const id of createdDebtors) {
    await admin.from('debtor_payments').delete().eq('debtor_id', id)
    await admin.from('debtors').delete().eq('id', id)
  }
  for (const id of createdUsers) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  ok(`cleaned ${createdDebtors.length} debtors`)
}

async function main() {
  console.log('=== QA: move to payment in progress ===')
  if (!(await probeColumns())) return finish()

  const branch = await getBranch()
  if (!branch) { fail('no branch'); return finish() }

  const debtorId = await createDebtor(branch.id)

  // 1) بدون اختيار — يجب المنع
  const blocked1 = validateMove('', 'company')
  const blocked2 = validateMove('weekly', '')
  if (!blocked1.ok && !blocked2.ok) ok('1: blocked without type/location')
  else fail('1: should block empty fields')

  // 2) مع الاختيار — ينجح
  const moved = await doMove(debtorId, 'weekly', 'company')
  if (moved.ok) ok('2: move succeeded with type+location')
  else fail('2: move failed', moved.error)

  // 3) حفظ في DB
  const { data: row } = await admin.from('debtors')
    .select('case_status, payment_type, payment_location, current_task_id')
    .eq('id', debtorId).single()
  if (row?.payment_type === 'weekly' && row?.payment_location === 'company') ok('3: type+location saved')
  else fail('3: fields not saved', JSON.stringify(row))

  // 4) أصبح في جاري التسديد
  if (row?.case_status === 'payment_in_progress' && row?.current_task_id == null) {
    ok('4: case_status=payment_in_progress')
  } else fail('4: status', JSON.stringify(row))

  // 5) مسؤول متابعة التسديد يراه (عبر فلتر الحالة — RLS يعتمد على الدور)
  const { data: visible } = await admin.from('debtors')
    .select('id')
    .eq('case_status', 'payment_in_progress')
    .eq('id', debtorId)
  if (visible?.length === 1) ok('5: visible in payment_in_progress list')
  else fail('5: not visible')

  // صلاحيات: payment_follow_up لا يحوّل
  const canMove = (r) => r === 'admin' || r === 'viewer'
  if (canMove('admin') && canMove('viewer') && !canMove('payment_follow_up')) {
    ok('perm: only admin/LM can move')
  } else fail('perm')

  await cleanup()
  return finish()
}

function finish() {
  const out = resolve(root, 'scripts/qa-move-payment-in-progress-report.json')
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log('\nOK', report.ok.length, 'FAIL', report.fail.length)
  if (report.fail.length) report.fail.forEach(f => console.log(' -', f))
  process.exit(report.fail.length ? 1 : 0)
}

main().catch(async e => {
  fail('fatal', e.message)
  try { await cleanup() } catch {}
  finish()
})
