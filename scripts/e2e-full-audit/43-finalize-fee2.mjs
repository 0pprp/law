import { sessionFor, serviceClient } from './lib.mjs'
import fs from 'fs'
const state = JSON.parse(fs.readFileSync('scripts/e2e-full-audit/state.json', 'utf8'))
const svc = serviceClient()

async function fees(lawyerId) {
  const { data } = await svc.from('lawyer_wallet_transactions').select('amount, wallet, type, reference_id, notes, created_at').eq('lawyer_id', lawyerId).order('created_at', { ascending: false }).limit(20)
  const sum = (data ?? []).reduce((s, r) => (r.wallet === 'fees' || r.type === 'approved_task_payment' ? s + Number(r.amount ?? 0) : s), 0)
  return { sum, recent: data ?? [] }
}

const before = await fees(state.lawyerId)
console.log('before sum', before.sum)

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

const after = await fees(state.lawyerId)
console.log('after sum', after.sum)
console.log('recent', JSON.stringify(after.recent.slice(0, 5), null, 2))
const { data: task } = await svc.from('tasks').select('id, task_status, fee_status, reward_amount').eq('id', state.cycle.taskId).single()
console.log('cycle task', task)
