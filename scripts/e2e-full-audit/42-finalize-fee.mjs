import { sessionFor, serviceClient } from './lib.mjs'
import fs from 'fs'
const state = JSON.parse(fs.readFileSync('scripts/e2e-full-audit/state.json', 'utf8'))
const svc = serviceClient()

async function fees(lawyerId) {
  const { data } = await svc.from('lawyer_wallet_transactions').select('amount, wallet, type, reference_id, notes').eq('lawyer_id', lawyerId).limit(5000)
  const sum = (data ?? []).reduce((s, r) => (r.wallet === 'fees' || r.type === 'approved_task_payment' ? s + Number(r.amount ?? 0) : s), 0)
  const related = (data ?? []).filter(r => String(r.reference_id) === state.cycle.taskId || String(r.notes ?? '').includes(state.cycle.taskId))
  return { sum, related }
}

const before = await fees(state.lawyerId)
console.log('before', before)

// assign a NEW waiting task on same debtor to trigger finalize of previous approved task
const DEF = state.defs.hybridChild
const { data: def } = await svc.from('task_definitions').select('fee_amount, task_type').eq('id', DEF).single()
const { data: nextTask, error } = await svc.from('tasks').insert({
  debtor_id: state.cycle.debtorId,
  task_definition_id: DEF,
  task_type: def.task_type,
  task_status: 'waiting_assignment',
  reward_amount: def.fee_amount ?? 0,
  created_by: state.adminId,
  branch_id: state.branchId,
}).select('id').single()
if (error) throw new Error(error.message)
await svc.from('debtors').update({ current_task_id: nextTask.id, last_task_id: state.cycle.taskId }).eq('id', state.cycle.debtorId)

const admin = await sessionFor('admin')
// try change-debtor-task / task-transition style finalize
const transition = await admin.fetch('/api/admin/task-transition', {
  method: 'POST',
  body: JSON.stringify({
    debtorId: state.cycle.debtorId,
    taskDefinitionId: DEF,
    previousTaskId: state.cycle.taskId,
  }),
})
console.log('task-transition', transition.status, await transition.text())

// also try assign next which may finalize previous
const assign = await admin.fetch('/api/admin/assign-tasks', {
  method: 'POST',
  body: JSON.stringify({ taskIds: [nextTask.id], lawyerId: state.lawyerId }),
})
console.log('assign next', assign.status, await assign.text())

const after = await fees(state.lawyerId)
console.log('after', after)
const { data: task } = await svc.from('tasks').select('id, task_status, fee_status, reward_amount').eq('id', state.cycle.taskId).single()
console.log('cycle task', task)
