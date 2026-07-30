import { serviceClient } from './lib.mjs'
const svc = serviceClient()
for (const t of ['task_required_fields', 'task_definition_expenses', 'task_definition_links', 'task_expenses', 'lawyer_wallet_transactions', 'task_attachments', 'debtor_attachments']) {
  const { data, error } = await svc.from(t).select('*').limit(1)
  console.log(`${t}: err=${error?.message ?? 'none'} cols=${data?.[0] ? Object.keys(data[0]).join(',') : '(empty)'}`)
  if (data?.[0]) console.log('   sample:', JSON.stringify(data[0]).slice(0, 400))
}
