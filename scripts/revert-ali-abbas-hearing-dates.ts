/**
 * إرجاع تاريخ المرافعة لسجلَي علي عباس كريم إلى 2026-07-28
 * npx tsx --env-file=.env.local scripts/revert-ali-abbas-hearing-dates.ts
 */
import { createClient } from '@supabase/supabase-js'
import { syncHearingDateInCompletion } from '../lib/hearing-date-from-completion'

const IDS = [
  '740f0d12-e10f-4a85-9102-e155c55c8f06',
  '56a8d5f8-1a36-4eae-8e1d-88012c0b4d66',
]
const OLD = '2026-07-28'

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  for (const id of IDS) {
    const { data: d, error } = await admin
      .from('debtors')
      .select('id, full_name, first_hearing_date, current_task_id')
      .eq('id', id)
      .single()
    if (error || !d) {
      console.error(id, error?.message)
      continue
    }
    console.log('قبل:', d.full_name, d.first_hearing_date, id)

    const { error: dErr } = await admin
      .from('debtors')
      .update({ first_hearing_date: OLD })
      .eq('id', id)
    if (dErr) {
      console.error('debtor', dErr.message)
      continue
    }

    if (d.current_task_id) {
      const { data: t } = await admin
        .from('tasks')
        .select('id, completion_data')
        .eq('id', d.current_task_id)
        .single()
      if (t) {
        const next = syncHearingDateInCompletion(
          (t.completion_data ?? {}) as Record<string, unknown>,
          OLD,
        )
        const { error: tErr } = await admin
          .from('tasks')
          .update({ completion_data: next })
          .eq('id', t.id)
        if (tErr) console.error('task', tErr.message)
        else console.log('رجّعت completion_data للمهمة')
      }
    }
    console.log('✅ first_hearing_date =', OLD)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
