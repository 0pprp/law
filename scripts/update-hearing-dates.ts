/**
 * تحديث تاريخ المرافعة لأسماء محددة في المرافعات.
 * Dry-run:  npx tsx --env-file=.env.local scripts/update-hearing-dates.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/update-hearing-dates.ts --confirm
 */
import { createClient } from '@supabase/supabase-js'
import {
  syncHearingDateInCompletion,
  extractHearingDateFromCompletion,
} from '../lib/hearing-date-from-completion'

const confirm = process.argv.includes('--confirm')

const UPDATES: { name: string; date: string }[] = [
  { name: 'حسن عباس حسين', date: '2026-08-27' },
  { name: 'علاء حسين عليوي ناصر', date: '2026-08-27' },
  { name: 'مصطفى تاميم عداي', date: '2026-08-27' },
  { name: 'ماهر طاهر شوكت', date: '2026-08-30' },
  { name: 'علي عباس كريم', date: '2026-08-17' },
]

function norm(s: string) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

function nameKey(s: string) {
  return norm(s).replace(/\s+/g, '')
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  for (const row of UPDATES) {
    console.log(`\n=== ${row.name} → ${row.date} ===`)
    const tokens = norm(row.name).split(' ').filter(Boolean)
    const pattern = `%${tokens.join('%')}%`

    const { data: matches, error } = await admin
      .from('debtors')
      .select(`
        id, full_name, first_hearing_date, current_task_id, case_status, branch_id,
        current_task:tasks!debtors_current_task_id_fkey(
          id, task_type, task_status, task_definition_id, completion_data,
          task_definitions(label)
        )
      `)
      .ilike('full_name', pattern)
      .neq('case_status', 'closed')

    if (error) {
      console.error('بحث فشل:', error.message)
      continue
    }

    const want = nameKey(row.name)
    let debtors = (matches ?? []).filter(d => nameKey(d.full_name) === want)
    if (!debtors.length) debtors = matches ?? []

    if (!debtors.length) {
      console.error('لم يُعثر على المدين')
      continue
    }
    if (debtors.length > 1) {
      console.warn('عدة مطابقات:')
      for (const d of debtors) console.warn(' ', d.id, d.full_name, 'hearing=', d.first_hearing_date)
    }

    for (const d of debtors) {
      const task = Array.isArray(d.current_task) ? d.current_task[0] : d.current_task
      const defLabel = Array.isArray(task?.task_definitions)
        ? task?.task_definitions[0]?.label
        : (task?.task_definitions as { label?: string } | null)?.label
      console.log(
        `  ${d.full_name} | قديم=${d.first_hearing_date ?? '—'} | مهمة=${defLabel ?? task?.task_type ?? '—'} (${task?.task_status ?? '—'})`,
      )

      if (!confirm) continue

      const { error: dErr } = await admin
        .from('debtors')
        .update({ first_hearing_date: row.date })
        .eq('id', d.id)
      if (dErr) {
        console.error('  فشل تحديث المدين:', dErr.message)
        continue
      }

      // حدّث completion_data للمهمة الحالية إن وُجد تاريخ جلسة فيها أو إن كانت مرافعات
      if (task?.id) {
        const isPleading =
          task.task_type === 'pleading'
          || String(defLabel ?? '').includes('مرافع')
        const prev = (task.completion_data ?? {}) as Record<string, unknown>
        const hadHearing = Boolean(extractHearingDateFromCompletion(prev))
        if (isPleading || hadHearing) {
          const nextData = syncHearingDateInCompletion(prev, row.date)
          const { error: tErr } = await admin
            .from('tasks')
            .update({ completion_data: nextData })
            .eq('id', task.id)
          if (tErr) console.error('  فشل تحديث مهمة:', tErr.message)
          else console.log('  حدّثت completion_data للمهمة الحالية')
        }
      }

      // أيضاً أي مهمة سابقة لنفس المدين فيها تاريخ جلسة
      const { data: histTasks } = await admin
        .from('tasks')
        .select('id, task_type, completion_data, task_definitions(label)')
        .eq('debtor_id', d.id)
        .neq('id', task?.id ?? '00000000-0000-0000-0000-000000000000')

      for (const t of histTasks ?? []) {
        const label = Array.isArray(t.task_definitions)
          ? t.task_definitions[0]?.label
          : (t.task_definitions as { label?: string } | null)?.label
        const prev = (t.completion_data ?? {}) as Record<string, unknown>
        const isPleading = t.task_type === 'pleading' || String(label ?? '').includes('مرافع')
        const hadHearing = Boolean(extractHearingDateFromCompletion(prev))
        if (!isPleading && !hadHearing) continue
        const nextData = syncHearingDateInCompletion(prev, row.date)
        const { error: tErr } = await admin.from('tasks').update({ completion_data: nextData }).eq('id', t.id)
        if (tErr) console.error('  فشل تحديث مهمة تاريخية:', t.id, tErr.message)
        else console.log('  حدّثت مهمة تاريخية:', label ?? t.task_type)
      }

      console.log(`  ✅ first_hearing_date = ${row.date}`)
    }
  }

  if (!confirm) console.log('\nDry-run فقط. أعد مع --confirm للتطبيق.')
  else console.log('\nتم.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
