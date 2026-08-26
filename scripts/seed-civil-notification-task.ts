/**
 * إضافة مهمة مدنية «التبليغ» لكل الفروع التي فيها مهام مدنية:
 *   - ملاحظة إلزامية، صورة التبليغ اختيارية
 *   - صرفة: صرفيات تبليغ (حد أقصى 10000)
 *
 * Usage: npx tsx scripts/seed-civil-notification-task.ts
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

const TASK = {
  task_type: 'notification' as const,
  label: 'التبليغ',
  fee_amount: 25000,
  sort_order: 105,
}

const EXPENSES = [{ name: 'صرفيات تبليغ', max_amount: 10000, sort_order: 0 }]

const REQUIRED_FIELDS = [
  {
    field_key: 'note',
    field_type: 'note',
    field_label: 'ملاحظة',
    is_required: true,
    sort_order: 0,
  },
  {
    field_key: 'image',
    field_type: 'image',
    field_label: 'صورة التبليغ',
    is_required: false,
    sort_order: 1,
  },
]

async function syncChildren(
  supabase: ReturnType<typeof createClient>,
  taskDefinitionId: string,
) {
  await supabase.from('task_required_fields').delete().eq('task_definition_id', taskDefinitionId)
  await supabase.from('task_definition_expenses').delete().eq('task_definition_id', taskDefinitionId)

  const { error: fErr } = await supabase.from('task_required_fields').insert(
    REQUIRED_FIELDS.map(f => ({ ...f, task_definition_id: taskDefinitionId })),
  )
  if (fErr) throw new Error(`fields: ${fErr.message}`)

  const { error: eErr } = await supabase.from('task_definition_expenses').insert(
    EXPENSES.map(e => ({ ...e, task_definition_id: taskDefinitionId })),
  )
  if (eErr) throw new Error(`expenses: ${eErr.message}`)
}

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
    const { data: byLabel } = await supabase
      .from('task_definitions')
      .select('id')
      .eq('branch_id', branch.id)
      .eq('case_type', 'civil')
      .eq('label', TASK.label)
      .maybeSingle()

    const { data: byType } = !byLabel
      ? await supabase
          .from('task_definitions')
          .select('id')
          .eq('branch_id', branch.id)
          .eq('case_type', 'civil')
          .eq('task_type', TASK.task_type)
          .maybeSingle()
      : { data: null }

    const existing = byLabel ?? byType

    if (existing) {
      const { error: updErr } = await supabase
        .from('task_definitions')
        .update({
          label: TASK.label,
          task_type: TASK.task_type,
          fee_amount: TASK.fee_amount,
          is_active: true,
          case_type: 'civil',
          sort_order: TASK.sort_order,
          allows_expenses: true,
        })
        .eq('id', existing.id)
      if (updErr) {
        console.error(`[${branch.name}] update:`, updErr.message)
        process.exitCode = 1
        continue
      }
      try {
        await syncChildren(supabase, existing.id)
      } catch (e) {
        console.error(`[${branch.name}] children:`, e instanceof Error ? e.message : e)
        process.exitCode = 1
        continue
      }
      updated++
      console.log(`= ${branch.name} / ${TASK.label}`)
      continue
    }

    const { data: inserted, error } = await supabase
      .from('task_definitions')
      .insert({
        branch_id: branch.id,
        task_type: TASK.task_type,
        label: TASK.label,
        fee_amount: TASK.fee_amount,
        sort_order: TASK.sort_order,
        is_active: true,
        case_type: 'civil',
        allows_expenses: true,
      })
      .select('id')
      .single()

    if (error) {
      console.error(`[${branch.name}] insert:`, error.message)
      process.exitCode = 1
      continue
    }

    try {
      await syncChildren(supabase, inserted.id)
    } catch (e) {
      console.error(`[${branch.name}] children:`, e instanceof Error ? e.message : e)
      process.exitCode = 1
      continue
    }

    created++
    console.log(`+ ${branch.name} / ${TASK.label} (${inserted.id})`)
  }

  console.log(`\nDone. created=${created} updated=${updated}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
