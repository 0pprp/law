import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fetchLawyerWalletBalance } from '../lib/lawyer-wallet'

function loadEnv() {
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
}

async function main() {
  loadEnv()
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: lawyers, error: lErr } = await sb
    .from('profiles')
    .select('id, full_name, case_type, is_active')
    .eq('role', 'lawyer')
    .limit(30)
  console.log('lawyer fetch err', lErr?.message)
  console.log(
    'lawyers',
    (lawyers ?? []).map(l => ({ name: l.full_name, ct: l.case_type, active: l.is_active })),
  )

  const { data: crimDebtors } = await sb.from('debtors').select('id').eq('case_type', 'criminal').limit(100)
  console.log('criminal debtors', crimDebtors?.length ?? 0)
  const ids = (crimDebtors ?? []).map(d => d.id)
  if (ids.length) {
    const { data: tasks, error } = await sb
      .from('tasks')
      .select('id, reward_amount, assigned_to, task_status, task_definition_id')
      .in('debtor_id', ids)
      .limit(30)
    console.log('criminal tasks err', error?.message)
    console.log('criminal tasks', tasks?.length, tasks?.slice(0, 5))
  }

  const { data: feeTx } = await sb
    .from('lawyer_wallet_transactions')
    .select('lawyer_id, amount, reference_id')
    .eq('type', 'approved_task_payment')
    .limit(80)
  const lawyerIds = [...new Set((feeTx ?? []).map(t => t.lawyer_id).filter(Boolean))]
  console.log('lawyers with fee credits', lawyerIds.length)

  for (const id of lawyerIds.slice(0, 3)) {
    const { data: p } = await sb.from('profiles').select('full_name, case_type').eq('id', id).single()
    const admin = await fetchLawyerWalletBalance(sb, id, 'fees', { viewerRole: 'admin' })
    const lawyer = await fetchLawyerWalletBalance(sb, id, 'fees', { viewerRole: 'lawyer' })
    const savA = await fetchLawyerWalletBalance(sb, id, 'savings', { viewerRole: 'admin' })
    const savL = await fetchLawyerWalletBalance(sb, id, 'savings', { viewerRole: 'lawyer' })
    console.log({
      name: p?.full_name,
      case_type: p?.case_type,
      feesAdmin: admin,
      feesLawyer: lawyer,
      delta: admin - lawyer,
      savingsAdmin: savA,
      savingsLawyer: savL,
      savingsSame: savA === savL,
    })
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
