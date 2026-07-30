/**
 * Seeds [TEST] fixtures for phase 3 scenarios. Idempotent cleanup of prior [TEST] first.
 * Run: node --env-file=.env.local scripts/e2e-full-audit/30-setup.mjs
 */
import fs from 'fs'
import path from 'path'
import { serviceClient, BRANCH_ID, BRANCH_LIST_ID, ACCOUNTS } from './lib.mjs'

const svc = serviceClient()
const stamp = Date.now().toString().slice(-8)
const STATE_PATH = path.join(process.cwd(), 'scripts/e2e-full-audit/state.json')

const { data: adminProf } = await svc.from('profiles').select('id').eq('username', 'test.admin').single()
const { data: lawyerProf } = await svc.from('profiles').select('id').eq('username', 'test.lawyer').single()
if (!adminProf || !lawyerProf) throw new Error('missing test profiles')

// cleanup previous [TEST] debtors + their tasks
const { data: oldDebtors } = await svc.from('debtors').select('id').ilike('full_name', '%[TEST]%')
const oldIds = (oldDebtors ?? []).map(d => d.id)
if (oldIds.length) {
  await svc.from('tasks').delete().in('debtor_id', oldIds)
  await svc.from('expenses').delete().in('debtor_id', oldIds)
  await svc.from('debtor_attachments').delete().in('debtor_id', oldIds)
  await svc.from('debtor_notes').delete().in('debtor_id', oldIds)
  await svc.from('debtors').delete().in('id', oldIds)
  console.log('cleaned old [TEST] debtors:', oldIds.length)
}
await svc.from('special_statuses').delete().ilike('name', '[TEST]%')

// task defs
const DEF_CYCLE = '563c09b9-429b-4d4c-b9f8-43a2309bb6c9' // إقامة دعوى (has expenses + required fields)
const DEF_HYBRID_PARENT = 'f9787f4f-a0b6-494f-ae32-52cbe023fb56' // مرافعات
const DEF_HYBRID_CHILD = 'fc9cc6f4-b256-461a-969f-d555e0994cbc' // تصديق قرار

// make parent hybrid + link child
await svc.from('task_definitions').update({ is_hybrid: true }).eq('id', DEF_HYBRID_PARENT)
await svc.from('task_definition_links').delete().eq('parent_definition_id', DEF_HYBRID_PARENT)
const { data: link, error: linkErr } = await svc.from('task_definition_links').insert({
  parent_definition_id: DEF_HYBRID_PARENT,
  linked_definition_id: DEF_HYBRID_CHILD,
  is_optional: false,
  sort_order: 1,
}).select('*').single()
if (linkErr) throw new Error('hybrid link: ' + linkErr.message)
console.log('hybrid link:', link.id)

function debtorPayload(name, receipt) {
  return {
    full_name: name,
    phone: `077${stamp}${String(Math.floor(Math.random() * 90 + 10))}`,
    governorate: 'بغداد الرصافة',
    address: '[TEST] عنوان اختبار',
    id_number: `199${stamp}${Math.floor(Math.random() * 900 + 100)}`,
    export_date: '2026-07-01',
    receipt_type: 'trust',
    receipt_number: receipt,
    receipt_amount: 1_000_000,
    remaining_amount: 1_000_000,
    required_amount: 1_000_000,
    penalty_amount: 1_000_000,
    case_status: 'active',
    case_type: 'civil',
    branch_id: BRANCH_ID,
    branch_list_id: BRANCH_LIST_ID,
    created_by: adminProf.id,
  }
}

const cycleDebtor = debtorPayload(`[TEST] دورة مهمة ${stamp}`, `TCYC${stamp}`)
const hybridDebtor = debtorPayload(`[TEST] مهمة هجينة ${stamp}`, `THYB${stamp}`)
const monitorDebtors = [1, 2, 3].map(i => debtorPayload(`[TEST] مراقبة ${i} ${stamp}`, `TMON${i}${stamp}`))
const awaitingDebtors = [1, 2, 3].map(i => debtorPayload(`[TEST] تحت إسناد ${i} ${stamp}`, `TAWT${i}${stamp}`))

const { data: createdDebtors, error: dErr } = await svc
  .from('debtors')
  .insert([cycleDebtor, hybridDebtor, ...monitorDebtors, ...awaitingDebtors])
  .select('id, full_name, receipt_number')
if (dErr) throw new Error('debtors: ' + dErr.message)

const byReceipt = Object.fromEntries(createdDebtors.map(d => [d.receipt_number, d]))
const cycleD = byReceipt[`TCYC${stamp}`]
const hybridD = byReceipt[`THYB${stamp}`]
const monitorDs = [1, 2, 3].map(i => byReceipt[`TMON${i}${stamp}`])
const awaitingDs = [1, 2, 3].map(i => byReceipt[`TAWT${i}${stamp}`])

async function createWaitingTask(debtorId, defId) {
  const { data: def } = await svc.from('task_definitions').select('fee_amount, task_type').eq('id', defId).single()
  const { data: task, error } = await svc.from('tasks').insert({
    debtor_id: debtorId,
    task_definition_id: defId,
    task_type: def.task_type,
    task_status: 'waiting_assignment',
    reward_amount: def.fee_amount ?? 0,
    created_by: adminProf.id,
    branch_id: BRANCH_ID,
  }).select('id').single()
  if (error) throw new Error('task: ' + error.message)
  await svc.from('debtors').update({ current_task_id: task.id }).eq('id', debtorId)
  return task.id
}

const cycleTaskId = await createWaitingTask(cycleD.id, DEF_CYCLE)
const hybridTaskId = await createWaitingTask(hybridD.id, DEF_HYBRID_PARENT)
const awaitingTaskIds = []
for (const d of awaitingDs) awaitingTaskIds.push(await createWaitingTask(d.id, DEF_CYCLE))

// special statuses for scenario 4
const { data: statusA, error: sErr } = await svc.from('special_statuses').insert({
  branch_id: BRANCH_ID, name: '[TEST] صفة اختبار', color: 'red', sort_order: 900, is_active: true,
}).select('id, name, color').single()
if (sErr) throw new Error('statusA: ' + sErr.message)

const { data: statusB } = await svc.from('special_statuses').insert({
  branch_id: BRANCH_ID, name: '[TEST] صفة ثانية', color: 'blue', sort_order: 901, is_active: true,
}).select('id, name, color').single()

const state = {
  stamp,
  adminId: adminProf.id,
  lawyerId: lawyerProf.id,
  branchId: BRANCH_ID,
  defs: { cycle: DEF_CYCLE, hybridParent: DEF_HYBRID_PARENT, hybridChild: DEF_HYBRID_CHILD },
  hybridLinkId: link.id,
  cycle: { debtorId: cycleD.id, taskId: cycleTaskId, name: cycleD.full_name },
  hybrid: { debtorId: hybridD.id, taskId: hybridTaskId, name: hybridD.full_name },
  monitor: { debtorIds: monitorDs.map(d => d.id), names: monitorDs.map(d => d.full_name) },
  awaiting: { debtorIds: awaitingDs.map(d => d.id), taskIds: awaitingTaskIds, names: awaitingDs.map(d => d.full_name) },
  statuses: { a: statusA, b: statusB },
  accounts: ACCOUNTS,
}
fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
console.log('state saved:', STATE_PATH)
console.log(JSON.stringify(state, null, 2))
