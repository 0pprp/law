/**
 * Merge legacy branch aliases into official names, then delete legacy rows.
 * Usage: npx tsx scripts/merge-legacy-branches.ts
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { APPROVED_BRANCH_NAMES } from '../lib/branch-constants'

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

const FK_TABLES = [
  'profiles',
  'debtors',
  'tasks',
  'expenses',
  'debtor_payments',
  'activity_logs',
  'courts',
  'lawyer_payout_requests',
] as const

async function branchId(supabase: SupabaseClient, name: string) {
  const { data, error } = await supabase.from('branches').select('id').eq('name', name).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id ?? null
}

async function mergeAlias(
  supabase: SupabaseClient,
  legacyName: string,
  officialName: string,
) {
  const legacyId = await branchId(supabase, legacyName)
  if (!legacyId) {
    console.log(`skip: ${legacyName} not found`)
    return
  }

  let officialId = await branchId(supabase, officialName)
  if (!officialId) {
    const { error } = await supabase
      .from('branches')
      .update({ name: officialName, is_active: true })
      .eq('id', legacyId)
    if (error) throw new Error(error.message)
    console.log(`renamed: ${legacyName} → ${officialName}`)
    return
  }

  if (legacyId === officialId) {
    console.log(`skip: ${legacyName} same as ${officialName}`)
    return
  }

  const { data: legacyDefs } = await supabase
    .from('task_definitions')
    .select('id, task_type, label, fee_amount, sort_order, is_active')
    .eq('branch_id', legacyId)

  for (const leg of legacyDefs ?? []) {
    const { data: officialDef } = await supabase
      .from('task_definitions')
      .select('id')
      .eq('branch_id', officialId)
      .eq('task_type', leg.task_type)
      .maybeSingle()

    if (officialDef?.id) {
      await supabase
        .from('task_definitions')
        .update({
          label: leg.label,
          fee_amount: leg.fee_amount,
          sort_order: leg.sort_order,
          is_active: leg.is_active,
        })
        .eq('id', officialDef.id)
    }
  }

  await supabase.from('task_definitions').delete().eq('branch_id', legacyId)

  for (const table of FK_TABLES) {
    const { error } = await supabase.from(table).update({ branch_id: officialId }).eq('branch_id', legacyId)
    if (error && !error.message.includes('does not exist')) {
      console.warn(`[${table}]`, error.message)
    }
  }

  const { error: delErr } = await supabase.from('branches').delete().eq('id', legacyId)
  if (delErr) throw new Error(`delete ${legacyName}: ${delErr.message}`)

  console.log(`merged: ${legacyName} → ${officialName}`)
}

async function main() {
  loadEnv()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  await mergeAlias(supabase, 'الكرخ', 'بغداد الكرخ')
  await mergeAlias(supabase, 'الرصافة', 'بغداد الرصافة')

  await supabase.from('branches').update({ is_active: false }).eq('name', 'الفرع الرئيسي')

  for (const name of APPROVED_BRANCH_NAMES) {
    await supabase.from('branches').update({ is_active: true }).eq('name', name)
  }

  const { data: branches } = await supabase.from('branches').select('name,is_active').order('name')
  const active = (branches ?? []).filter(b => b.is_active)
  console.log('\nBranches after merge:')
  for (const b of branches ?? []) console.log(`  ${b.name} ${b.is_active ? '✓' : '(معطّل)'}`)
  console.log(`\nTotal: ${branches?.length} | Active: ${active.length}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
