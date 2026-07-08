/**
 * تصفير بيانات التشغيل + حذف مستخدمي الاختبار فقط.
 *
 * يُبقي: الفروع، تعريفات المهام، الحقول، صرفيات التعريف، أنواع الصرف، المحاكم،
 *         المستخدمون الحقيقيون (haider, admin12, المحامون، إلخ).
 *
 * يُحذف: المدينون، المهام، المحافظ، سجل النشاط، الصرفيات، التسديدات،
 *         مستخدمي QA (e2eadmin*, lawqa*, acctqa*, test, …).
 *
 * Run:
 *   node --env-file=.env.local scripts/reset-production-data.mjs --dry-run
 *   node --env-file=.env.local scripts/reset-production-data.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!dryRun && !confirm) {
  console.error('Use --dry-run to preview or --confirm to execute.')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

function isTestUser(p) {
  const u = String(p.username ?? '').toLowerCase()
  const name = String(p.full_name ?? '')
  if (u.startsWith('qa_')) return true
  if (u.startsWith('e2eadmin')) return true
  if (u.startsWith('lawqa')) return true
  if (u.startsWith('acctqa')) return true
  if (u === 'test') return true
  if (/^محامي qa\b/i.test(name) || /^محاسب qa\b/i.test(name)) return true
  if (/^e2e admin\b/i.test(name) || name === 'dbg') return true
  return false
}

async function count(table) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
  if (error) return { error: error.message }
  return { count: count ?? 0 }
}

async function del(table, filter) {
  if (dryRun) return { error: null }
  let q = sb.from(table).delete()
  if (filter) q = filter(q)
  const { error } = await q.neq('id', '00000000-0000-0000-0000-000000000000')
  return { error: error?.message ?? null }
}

async function runStep(label, fn) {
  const res = await fn()
  if (res.error) {
    console.error(`FAIL ${label}:`, res.error)
    process.exit(1)
  }
  if (res.count !== undefined) console.log(`  ${label}: ${res.count}`)
  else console.log(`  ${label}: OK`)
}

async function main() {
  console.log(dryRun ? '\n=== DRY RUN (no changes) ===\n' : '\n=== RESET OPERATIONAL DATA ===\n')

  const { data: profiles, error: profErr } = await sb
    .from('profiles')
    .select('id, username, full_name, role, is_active')
    .order('username')
  if (profErr) throw new Error(profErr.message)

  const keep = (profiles ?? []).filter(p => !isTestUser(p))
  const remove = (profiles ?? []).filter(p => isTestUser(p))

  console.log(`Users to KEEP (${keep.length}):`)
  for (const p of keep) console.log(`  + ${p.role}\t${p.username}\t${p.full_name}`)
  console.log(`\nUsers to DELETE (${remove.length}):`)
  for (const p of remove) console.log(`  - ${p.role}\t${p.username}\t${p.full_name}`)

  const metrics = [
    'debtors', 'tasks', 'debtor_payments', 'expenses', 'activity_logs',
    'lawyer_wallet_transactions', 'lawyer_payout_requests', 'task_payment_receipts',
    'task_attachments', 'debtor_attachments', 'debtor_notes',
  ]
  console.log('\nCounts before:')
  for (const t of metrics) {
    const c = await count(t)
    console.log(`  ${t}: ${c.error ?? c.count}`)
  }

  if (dryRun) {
    console.log('\nDry run complete. Re-run with --confirm to apply.')
    return
  }

  console.log('\nApplying...')

  await runStep('detach debtor task pointers', async () => {
    const { error } = await sb.from('debtors').update({ current_task_id: null, last_task_id: null }).neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message ?? null }
  })

  for (const table of [
    'lawyer_wallet_transactions',
    'lawyer_payout_requests',
    'task_payment_receipts',
    'task_attachments',
    'debtor_attachments',
    'debtor_notes',
    'debtor_payments',
    'expenses',
    'activity_logs',
  ]) {
    await runStep(`delete ${table}`, () => del(table))
  }

  await runStep('delete lawyer_attachments (test users only)', async () => {
    const ids = remove.map(p => p.id)
    if (!ids.length) return { error: null }
    const { error } = await sb.from('lawyer_attachments').delete().in('lawyer_id', ids)
    return { error: error?.message ?? null }
  })

  await runStep('delete tasks', () => del('tasks'))
  await runStep('delete debtors', () => del('debtors'))

  for (const p of remove) {
    await runStep(`delete profile ${p.username}`, async () => {
      const { error } = await sb.from('profiles').delete().eq('id', p.id)
      return { error: error?.message ?? null }
    })
    await runStep(`delete auth ${p.username}`, async () => {
      const { error } = await sb.auth.admin.deleteUser(p.id)
      return { error: error?.message ?? null }
    })
  }

  console.log('\nCounts after:')
  for (const t of metrics) {
    const c = await count(t)
    console.log(`  ${t}: ${c.error ?? c.count}`)
  }

  const { data: left } = await sb.from('profiles').select('username, role, full_name').order('role')
  console.log(`\nRemaining users (${left?.length ?? 0}):`)
  for (const p of left ?? []) console.log(`  ${p.role}\t${p.username}\t${p.full_name}`)

  const cfg = ['branches', 'task_definitions', 'task_required_fields', 'task_definition_expenses', 'expense_types']
  console.log('\nConfig preserved:')
  for (const t of cfg) {
    const c = await count(t)
    console.log(`  ${t}: ${c.error ?? c.count}`)
  }

  console.log('\nDone. Run: node --env-file=.env.local scripts/empty-storage-buckets.mjs')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
