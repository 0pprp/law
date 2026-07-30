/**
 * Phase 4 — cleanup all [TEST]* data. Does NOT delete @test.local accounts.
 */
import { serviceClient } from './lib.mjs'
import fs from 'fs'

const svc = serviceClient()
let state = null
try { state = JSON.parse(fs.readFileSync('scripts/e2e-full-audit/state.json', 'utf8')) } catch {}

// restore hybrid flag/link if we mutated production defs
if (state?.defs?.hybridParent) {
  await svc.from('task_definition_links').delete().eq('parent_definition_id', state.defs.hybridParent)
  await svc.from('task_definitions').update({ is_hybrid: false }).eq('id', state.defs.hybridParent)
  console.log('restored hybrid parent def to non-hybrid')
}

const { data: debtors } = await svc.from('debtors').select('id, full_name').ilike('full_name', '%[TEST]%')
const ids = (debtors ?? []).map(d => d.id)
console.log('[TEST] debtors:', ids.length)

if (ids.length) {
  const { data: tasks } = await svc.from('tasks').select('id').in('debtor_id', ids)
  const taskIds = (tasks ?? []).map(t => t.id)
  if (taskIds.length) {
    await svc.from('task_attachments').delete().in('task_id', taskIds)
    await svc.from('expenses').delete().in('task_id', taskIds)
    // wallet txs that reference these tasks — keep ledger history or delete test notes?
    // leave wallet txs (financial audit trail) but clear TEST notes if any
    await svc.from('tasks').delete().in('id', taskIds)
    console.log('deleted tasks:', taskIds.length)
  }
  await svc.from('expenses').delete().in('debtor_id', ids)
  await svc.from('debtor_attachments').delete().in('debtor_id', ids)
  await svc.from('debtor_notes').delete().in('debtor_id', ids)
  // clear FK pointers first
  await svc.from('debtors').update({ current_task_id: null, last_task_id: null, special_status_id: null }).in('id', ids)
  const { error } = await svc.from('debtors').delete().in('id', ids)
  if (error) console.error('debtor delete error:', error.message)
  else console.log('deleted debtors:', ids.length)
}

const { data: statuses } = await svc.from('special_statuses').select('id, name').ilike('name', '[TEST]%')
if (statuses?.length) {
  await svc.from('special_statuses').delete().in('id', statuses.map(s => s.id))
  console.log('deleted statuses:', statuses.map(s => s.name).join(', '))
}

// leftover [TEST] attachments by filename
const { data: leftoverAtt } = await svc.from('task_attachments').select('id').ilike('file_name', '%[TEST]%')
if (leftoverAtt?.length) {
  await svc.from('task_attachments').delete().in('id', leftoverAtt.map(a => a.id))
  console.log('deleted leftover attachments:', leftoverAtt.length)
}

const { count: leftDebtors } = await svc.from('debtors').select('id', { count: 'exact', head: true }).ilike('full_name', '%[TEST]%')
const { count: leftStatuses } = await svc.from('special_statuses').select('id', { count: 'exact', head: true }).ilike('name', '[TEST]%')
const { data: accounts } = await svc.from('profiles').select('username, role').in('username', [
  'test.admin', 'test.lawyer', 'test.viewer', 'test.accountant', 'test.delegate', 'test.criminal_legal_manager',
])
console.log('remaining [TEST] debtors:', leftDebtors ?? 0)
console.log('remaining [TEST] statuses:', leftStatuses ?? 0)
console.log('accounts kept:', (accounts ?? []).map(a => `${a.username}:${a.role}`).join(', '))
