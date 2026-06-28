/**
 * Applies criminal task definitions via Supabase REST (enum values must exist).
 * Run migrations in order: 20250628180000_criminal_task_type_enum.sql then 20250628180001_criminal_task_definitions.sql
 * Usage: npx tsx scripts/seed-criminal-tasks.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
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

const TASKS = [
  {
    task_type: 'criminal_lawsuit_request',
    label: 'تقديم طلب دعوى جزائية',
    fee_amount: 25000,
    sort_order: 200,
    fields: [
      { field_key: 'note', field_type: 'note', field_label: 'ملاحظة', is_required: true, sort_order: 1 },
      { field_key: 'police_station_name', field_type: 'text', field_label: 'اسم مركز الشرطة', is_required: true, sort_order: 2 },
      { field_key: 'image', field_type: 'image', field_label: 'صورة/مرفق', is_required: true, sort_order: 3 },
    ],
  },
  {
    task_type: 'police_station_statement',
    label: 'تدوين أقوال في مركز الشرطة',
    fee_amount: 25000,
    sort_order: 201,
    fields: [
      { field_key: 'note', field_type: 'note', field_label: 'ملاحظة', is_required: true, sort_order: 1 },
    ],
  },
  {
    task_type: 'court_statement',
    label: 'تدوين أقوال في المحكمة',
    fee_amount: 25000,
    sort_order: 202,
    fields: [
      { field_key: 'note', field_type: 'note', field_label: 'ملاحظة', is_required: true, sort_order: 1 },
      { field_key: 'image', field_type: 'image', field_label: 'صورة/مرفق', is_required: false, sort_order: 2 },
    ],
  },
  {
    task_type: 'witness_statement',
    label: 'تدوين أقوال الشهود',
    fee_amount: 25000,
    sort_order: 203,
    fields: [
      { field_key: 'note', field_type: 'note', field_label: 'ملاحظة', is_required: true, sort_order: 1 },
      { field_key: 'image', field_type: 'image', field_label: 'صورة/مرفق', is_required: false, sort_order: 2 },
    ],
  },
] as const

async function main() {
  loadEnv()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: branches, error: bErr } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .in('name', [...APPROVED_BRANCH_NAMES])

  if (bErr) throw new Error(bErr.message)
  console.log('Branches:', branches?.length)

  for (const branch of branches ?? []) {
    for (const task of TASKS) {
      const { data: existing } = await supabase
        .from('task_definitions')
        .select('id')
        .eq('branch_id', branch.id)
        .eq('task_type', task.task_type)
        .maybeSingle()

      let defId = existing?.id
      if (!defId) {
        const { data: inserted, error } = await supabase
          .from('task_definitions')
          .insert({
            branch_id: branch.id,
            task_type: task.task_type,
            label: task.label,
            fee_amount: task.fee_amount,
            sort_order: task.sort_order,
            is_active: true,
          })
          .select('id')
          .single()
        if (error) {
          console.error(`[${branch.name}] ${task.task_type}:`, error.message)
          console.error('Run 20250628180000_criminal_task_type_enum.sql then 20250628180001_criminal_task_definitions.sql in SQL Editor first.')
          continue
        }
        defId = inserted.id
        console.log(`+ def ${branch.name} / ${task.label}`)
      }

      for (const f of task.fields) {
        const { data: hasField } = await supabase
          .from('task_required_fields')
          .select('id')
          .eq('task_definition_id', defId)
          .eq('field_key', f.field_key)
          .maybeSingle()
        if (hasField) continue
        const { error: fErr } = await supabase.from('task_required_fields').insert({
          task_definition_id: defId,
          ...f,
        })
        if (fErr) console.error(`  field ${f.field_key}:`, fErr.message)
      }
    }
  }
  console.log('Done.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
