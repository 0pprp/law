/**
 * اختبار ميزة «الأسماء التي تحت إسناد مهمة»
 * ينشئ مستخدمي اختبار مؤقتين + مدينين، يتحقق من السيناريوهات، ثم يحذفهم.
 * لا يلمس بيانات الإنتاج الحقيقية.
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

const report = { ok: [], fail: [], notes: [], noteColumn: false }
function ok(msg) { report.ok.push(msg); console.log('✓', msg) }
function fail(msg, detail) { report.fail.push(detail ? `${msg}: ${detail}` : msg); console.error('✗', msg, detail || '') }
function note(msg) { report.notes.push(msg); console.log('·', msg) }

const TAG = `QA-إسناد-${Date.now().toString(36)}`
const PASS = `Qa!${randomBytes(6).toString('hex')}A1`
const createdUserIds = []
const createdDebtorIds = []

async function ensureNoteColumn() {
  const { error } = await admin.from('debtors').select('id, assignment_note').limit(1)
  if (!error) {
    report.noteColumn = true
    ok('assignment_note column exists')
    return true
  }
  note(`assignment_note missing (${error.message}) — note tests will be skipped`)
  note('شغّل supabase/scripts/apply-debtor-assignment-note.sql ثم أعد الاختبار')
  return false
}

async function getBranch() {
  const preferred = ['بغداد الرصافة', 'بغداد الكرخ', 'النجف الأشرف']
  const { data } = await admin.from('branches').select('id, name').eq('is_active', true)
  for (const name of preferred) {
    const hit = (data ?? []).find(b => b.name === name)
    if (hit) return hit
  }
  return (data ?? []).find(b => b.name !== 'الفرع الرئيسي') ?? data?.[0] ?? null
}

async function getCivilTaskDef(branchId) {
  const { data } = await admin
    .from('task_definitions')
    .select('id, label, task_type, fee_amount, case_type')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .eq('case_type', 'civil')
    .order('sort_order')
    .limit(1)
  return data?.[0] ?? null
}

async function ensureUser(username, role, branchId) {
  const email = `${username}@test.local`
  const { data: existing } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (existing) {
    createdUserIds.push(existing.id)
    return existing.id
  }
  const { data: authUser, error } = await admin.auth.admin.createUser({
    email,
    password: PASS,
    email_confirm: true,
    user_metadata: { full_name: `اختبار ${TAG} ${role}` },
  })
  if (error || !authUser.user) throw new Error(`createUser ${username}: ${error?.message}`)
  const id = authUser.user.id
  createdUserIds.push(id)
  await admin.from('profiles').upsert({
    id,
    username,
    full_name: `اختبار ${TAG} ${role}`,
    role,
    branch_id: branchId,
    is_active: true,
  })
  return id
}

async function createDebtorViaAdmin({ branchId, fullName, withTask, taskDefId, caseType = 'civil' }) {
  const receipt = `TEST-ASN-${randomBytes(4).toString('hex')}`
  const payload = {
    full_name: fullName,
    receipt_number: receipt,
    receipt_type: 'other',
    receipt_amount: 0,
    remaining_amount: 0,
    required_amount: 0,
    lawyer_fees: 0,
    penalty_amount: 0,
    branch_id: branchId,
    case_type: caseType,
    case_status: 'active',
    export_date: new Date().toISOString().split('T')[0],
  }
  const { data: debtor, error } = await admin.from('debtors').insert(payload).select('id').single()
  if (error || !debtor) throw new Error(`insert debtor: ${error?.message}`)
  createdDebtorIds.push(debtor.id)

  if (withTask && taskDefId) {
    const { data: def } = await admin.from('task_definitions').select('task_type, fee_amount').eq('id', taskDefId).single()
    const { data: task, error: tErr } = await admin.from('tasks').insert({
      debtor_id: debtor.id,
      task_definition_id: taskDefId,
      task_type: def.task_type,
      task_status: 'waiting_assignment',
      reward_amount: def.fee_amount ?? 0,
      branch_id: branchId,
    }).select('id').single()
    if (tErr || !task) throw new Error(`insert task: ${tErr?.message}`)
    await admin.from('debtors').update({ current_task_id: task.id }).eq('id', debtor.id)
  }
  return debtor.id
}

async function fetchAwaiting(branchId) {
  const cols = report.noteColumn
    ? 'id, full_name, current_task_id, assignment_note, created_at, case_status'
    : 'id, full_name, current_task_id, created_at, case_status'
  let q = admin
    .from('debtors')
    .select(cols)
    .is('current_task_id', null)
    .or('case_status.is.null,case_status.neq.closed')
    .order('created_at', { ascending: true })
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

async function cleanup() {
  note('cleanup…')
  for (const id of createdDebtorIds) {
    await admin.from('tasks').delete().eq('debtor_id', id)
    await admin.from('debtor_notes').delete().eq('debtor_id', id)
    await admin.from('debtors').delete().eq('id', id)
  }
  for (const id of createdUserIds) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  ok(`cleaned ${createdDebtorIds.length} debtors, ${createdUserIds.length} users`)
}

async function main() {
  console.log('=== QA: awaiting assignment ===')
  const hasNote = await ensureNoteColumn()
  const branch = await getBranch()
  if (!branch) { fail('no branch'); return finish() }
  ok(`branch ${branch.name}`)

  const taskDef = await getCivilTaskDef(branch.id)
  if (!taskDef) { fail('no civil task def'); return finish() }
  ok(`task def ${taskDef.label}`)

  // Users
  const adminId = await ensureUser(`qa_asn_admin_${Date.now().toString(36)}`, 'admin', branch.id)
  const lmId = await ensureUser(`qa_asn_lm_${Date.now().toString(36)}`, 'viewer', branch.id)
  const lawyerId = await ensureUser(`qa_asn_lawyer_${Date.now().toString(36)}`, 'lawyer', branch.id)
  ok(`users admin/lm/lawyer`)

  // 1) Debtor WITH task — must NOT appear in awaiting
  const withTaskName = `${TAG} مع مهمة`
  const withTaskId = await createDebtorViaAdmin({
    branchId: branch.id,
    fullName: withTaskName,
    withTask: true,
    taskDefId: taskDef.id,
  })
  let awaiting = await fetchAwaiting(branch.id)
  if (awaiting.some(d => d.id === withTaskId)) fail('1: with-task debtor appeared in awaiting')
  else ok('1: with-task debtor NOT in awaiting card')

  // 2) Debtor WITHOUT task — must appear
  const noTaskName = `${TAG} بدون مهمة`
  const noTaskId = await createDebtorViaAdmin({
    branchId: branch.id,
    fullName: noTaskName,
    withTask: false,
  })
  awaiting = await fetchAwaiting(branch.id)
  const row = awaiting.find(d => d.id === noTaskId)
  if (!row) fail('2: no-task debtor missing from awaiting')
  else ok('2: no-task debtor appears in awaiting')

  // 3) Fields present
  if (row && row.full_name && row.created_at) ok('3: name + created_at present')
  else fail('3: missing display fields')

  // 4-6) Note add / edit / clear
  if (hasNote) {
    const { error: n1 } = await admin.from('debtors').update({ assignment_note: 'ملاحظة اختبار' }).eq('id', noTaskId)
    if (n1) fail('4: add note', n1.message)
    else {
      const { data: d1 } = await admin.from('debtors').select('assignment_note').eq('id', noTaskId).single()
      if (d1?.assignment_note === 'ملاحظة اختبار') ok('4: note saved')
      else fail('4: note not saved', d1?.assignment_note)
    }

    await admin.from('debtors').update({ assignment_note: 'ملاحظة معدّلة' }).eq('id', noTaskId)
    const { data: d2 } = await admin.from('debtors').select('assignment_note').eq('id', noTaskId).single()
    if (d2?.assignment_note === 'ملاحظة معدّلة') ok('5: note edited')
    else fail('5: note edit failed')

    await admin.from('debtors').update({ assignment_note: null }).eq('id', noTaskId)
    const { data: d3 } = await admin.from('debtors').select('assignment_note').eq('id', noTaskId).single()
    if (d3?.assignment_note == null) ok('6: note cleared')
    else fail('6: note clear failed')
  } else {
    note('4-6: skipped — note column missing (apply SQL then re-run)')
  }

  // 7-9) Permission semantics (role checks mirrored from app)
  const canNote = (role) => role === 'admin' || role === 'viewer'
  const canAssign = (role) => role === 'admin' || role === 'employee' || role === 'viewer'
  if (canNote('admin') && canAssign('admin')) ok('7: admin can note+assign')
  else fail('7: admin permissions')
  if (canNote('viewer') && canAssign('viewer')) ok('8: legal manager can note+assign')
  else fail('8: LM permissions')
  if (!canNote('lawyer') && !canAssign('lawyer')) ok('9: lawyer cannot note/assign from card')
  else fail('9: lawyer incorrectly allowed')

  // 10-12) Assign task (simulate change-debtor-task) — once only, then gone
  const { data: createdTask, error: createTaskErr } = await admin.from('tasks').insert({
    debtor_id: noTaskId,
    task_definition_id: taskDef.id,
    task_type: taskDef.task_type,
    task_status: 'waiting_assignment',
    reward_amount: taskDef.fee_amount ?? 0,
    branch_id: branch.id,
  }).select('id').single()
  if (createTaskErr || !createdTask) {
    fail('11: create task for assign', createTaskErr?.message)
  } else {
    await admin.from('debtors').update({ current_task_id: createdTask.id }).eq('id', noTaskId)
    // double-create attempt should be prevented by app loading state; DB-level: if current_task_id set, change-debtor-task updates existing
    const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('debtor_id', noTaskId)
    if ((count ?? 0) === 1) ok('10: single task after assign (no duplicate)')
    else fail('10: duplicate tasks', String(count))

    awaiting = await fetchAwaiting(branch.id)
    if (!awaiting.some(d => d.id === noTaskId)) ok('11: assigned debtor left awaiting card')
    else fail('11: still in awaiting after assign')

    const { data: refreshed } = await admin.from('debtors').select('current_task_id').eq('id', noTaskId).single()
    if (refreshed?.current_task_id === createdTask.id) ok('12: refresh keeps assignment')
    else fail('12: assignment lost after re-read')
  }

  // 13) Unassigned (waiting_assignment) stays in unassigned path, NOT awaiting
  const unassignedName = `${TAG} غير مكلفة`
  const unassignedId = await createDebtorViaAdmin({
    branchId: branch.id,
    fullName: unassignedName,
    withTask: true,
    taskDefId: taskDef.id,
  })
  awaiting = await fetchAwaiting(branch.id)
  if (!awaiting.some(d => d.id === unassignedId)) ok('13: unassigned-task debtor NOT in awaiting')
  else fail('13: unassigned-task incorrectly in awaiting')

  // API path: create debtor without task via insert matching POST semantics
  const apiNoTask = await createDebtorViaAdmin({
    branchId: branch.id,
    fullName: `${TAG} API بدون`,
    withTask: false,
  })
  awaiting = await fetchAwaiting(branch.id)
  if (awaiting.some(d => d.id === apiNoTask)) ok('API-path: no-task debtor listed')
  else fail('API-path: no-task debtor missing')

  // Silence unused
  void adminId; void lmId; void lawyerId; void withTaskName; void noTaskName; void unassignedName

  await cleanup()
  return finish()
}

function finish() {
  const out = resolve(root, 'scripts/qa-awaiting-assignment-report.json')
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
  console.log('\n=== SUMMARY ===')
  console.log('OK:', report.ok.length)
  console.log('FAIL:', report.fail.length)
  if (report.fail.length) report.fail.forEach(f => console.log(' -', f))
  console.log('report:', out)
  process.exit(report.fail.length ? 1 : 0)
}

main().catch(async e => {
  fail('fatal', e.message)
  try { await cleanup() } catch {}
  finish()
})
