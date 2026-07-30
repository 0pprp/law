import { sessionFor, serviceClient } from './lib.mjs'
import fs from 'fs'
const state = JSON.parse(fs.readFileSync('scripts/e2e-full-audit/state.json', 'utf8'))
const svc = serviceClient()

// reset debtor to point at approved cycle task, delete orphan next tasks
const { data: orphans } = await svc.from('tasks')
  .select('id, task_status, created_at')
  .eq('debtor_id', state.cycle.debtorId)
  .neq('id', state.cycle.taskId)
console.log('orphans', orphans)
for (const t of orphans ?? []) {
  await svc.from('tasks').delete().eq('id', t.id)
}
await svc.from('debtors').update({
  current_task_id: state.cycle.taskId,
  last_task_id: null,
  case_status: 'active',
}).eq('id', state.cycle.debtorId)

// ensure fee still awaiting
await svc.from('tasks').update({ fee_status: 'approved_pending_next', task_status: 'approved' }).eq('id', state.cycle.taskId)

const admin = await sessionFor('admin')
const res = await admin.fetch('/api/admin/task-transition', {
  method: 'POST',
  body: JSON.stringify({
    taskId: state.cycle.taskId,
    action: 'next',
    nextTaskDefId: state.defs.hybridChild,
  }),
})
console.log('transition', res.status, await res.text())

const { data: wallet } = await svc.from('lawyer_wallet_transactions')
  .select('amount, wallet, type, reference_id, notes, created_at')
  .eq('lawyer_id', state.lawyerId)
  .order('created_at', { ascending: false })
  .limit(10)
console.log('wallet', JSON.stringify(wallet, null, 2))
const { data: task } = await svc.from('tasks').select('fee_status, task_status, reward_amount').eq('id', state.cycle.taskId).single()
console.log('task', task)
