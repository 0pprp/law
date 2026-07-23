/**
 * Restores criminal task definition fees to 25,000 IQD.
 * Visibility for non-admin remains in app layer (lib/visible-task-fee.ts).
 *
 * Run: npx tsx scripts/restore-criminal-task-fees-25000.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

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

const LABELS = [
  'تقديم طلب دعوى جزائية',
  'تدوين أقوال في مركز الشرطة',
  'تدوين أقوال في المحكمة',
  'تدوين أقوال الشهود',
] as const

const TASK_TYPES = [
  'criminal_lawsuit_request',
  'police_station_statement',
  'court_statement',
  'witness_statement',
] as const

const FEE = 25000

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(url, key)

  const { data: before, error: beforeErr } = await supabase
    .from('task_definitions')
    .select('id, label, task_type, case_type, fee_amount, branch_id')
    .eq('case_type', 'criminal')
    .or(`label.in.(${LABELS.map(l => `"${l}"`).join(',')}),task_type.in.(${TASK_TYPES.join(',')})`)

  if (beforeErr) {
    // Fallback: fetch all criminal defs and filter in JS
    const { data: all, error } = await supabase
      .from('task_definitions')
      .select('id, label, task_type, case_type, fee_amount, branch_id')
      .eq('case_type', 'criminal')
    if (error) throw new Error(error.message)
    const targets = (all ?? []).filter(
      d => LABELS.includes(d.label as (typeof LABELS)[number])
        || TASK_TYPES.includes(d.task_type as (typeof TASK_TYPES)[number]),
    )
    await updateRows(supabase, targets)
    return
  }

  await updateRows(supabase, before ?? [])
}

async function updateRows(
  supabase: any,
  rows: { id: string; label: string; task_type: string | null; fee_amount: number; branch_id: string | null }[],
) {
  if (!rows.length) {
    console.log('No matching criminal task definitions found.')
    return
  }

  console.log(`Found ${rows.length} definition(s):`)
  for (const r of rows) {
    console.log(`  - ${r.label} (${r.task_type}) fee=${r.fee_amount} id=${r.id}`)
  }

  const ids = rows.map(r => r.id)
  const { error: updErr } = await supabase
    .from('task_definitions')
    .update({ fee_amount: FEE })
    .in('id', ids)

  if (updErr) throw new Error(updErr.message)

  const { data: after, error: afterErr } = await supabase
    .from('task_definitions')
    .select('id, label, fee_amount')
    .in('id', ids)

  if (afterErr) throw new Error(afterErr.message)

  console.log('\nUpdated:')
  for (const r of after ?? []) {
    console.log(`  ✓ ${r.label} → ${r.fee_amount}`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
