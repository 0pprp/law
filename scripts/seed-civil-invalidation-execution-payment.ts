/**
 * إضافة مهمتين مدنيتين لكل الفروع التي فيها مهام مدنية:
 *   ابطال (file_closure) — أتعاب 0 — بلا حقول مطلوبة
 *   تسديد بالتنفيذ (first_registration) — أتعاب 0 — بلا حقول مطلوبة
 *
 * Usage: npx tsx scripts/seed-civil-invalidation-execution-payment.ts
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

const TASKS = [
  {
    task_type: 'file_closure',
    label: 'ابطال',
    fee_amount: 0,
    sort_order: 118,
  },
  {
    task_type: 'first_registration',
    label: 'تسديد بالتنفيذ',
    fee_amount: 0,
    sort_order: 119,
  },
] as const

async function main() {
  loadEnv()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: civilBranchRows, error: cErr } = await supabase
    .from('task_definitions')
    .select('branch_id')
    .eq('case_type', 'civil')
    .eq('is_active', true)
  if (cErr) throw new Error(cErr.message)

  const branchIds = [...new Set((civilBranchRows ?? []).map(r => r.branch_id).filter(Boolean))] as string[]
  if (!branchIds.length) throw new Error('لا توجد فروع بمهام مدنية')

  const { data: branches, error: bErr } = await supabase
    .from('branches')
    .select('id, name')
    .in('id', branchIds)
    .eq('is_active', true)
  if (bErr) throw new Error(bErr.message)

  console.log('Branches:', branches?.length)

  let created = 0
  let updated = 0

  for (const branch of branches ?? []) {
    for (const task of TASKS) {
      const { data: existing } = await supabase
        .from('task_definitions')
        .select('id')
        .eq('branch_id', branch.id)
        .eq('task_type', task.task_type)
        .maybeSingle()

      if (existing) {
        const { error: updErr } = await supabase
          .from('task_definitions')
          .update({
            label: task.label,
            fee_amount: 0,
            is_active: true,
            case_type: 'civil',
            sort_order: task.sort_order,
          })
          .eq('id', existing.id)
        if (updErr) {
          console.error(`[${branch.name}] update ${task.task_type}:`, updErr.message)
          continue
        }
        await supabase.from('task_required_fields').delete().eq('task_definition_id', existing.id)
        await supabase.from('task_definition_expenses').delete().eq('task_definition_id', existing.id)
        updated++
        console.log(`= ${branch.name} / ${task.label}`)
        continue
      }

      const { data: inserted, error } = await supabase
        .from('task_definitions')
        .insert({
          branch_id: branch.id,
          task_type: task.task_type,
          label: task.label,
          fee_amount: 0,
          sort_order: task.sort_order,
          is_active: true,
          case_type: 'civil',
        })
        .select('id')
        .single()

      if (error) {
        console.error(`[${branch.name}] ${task.task_type}:`, error.message)
        process.exitCode = 1
        return
      }
      created++
      console.log(`+ ${branch.name} / ${task.label} (${inserted.id})`)
    }
  }

  console.log(`\nDone. created=${created} updated=${updated}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
