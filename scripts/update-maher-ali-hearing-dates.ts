/**
 * تحديث تاريخ المرافعة لمتغيرات ماهر طاهر شوكت + سجلَي علي عباس كريم
 * npx tsx --env-file=.env.local scripts/update-maher-ali-hearing-dates.ts
 */
import { createClient } from '@supabase/supabase-js'
import {
  syncHearingDateInCompletion,
  extractHearingDateFromCompletion,
} from '../lib/hearing-date-from-completion'

const MAHER_DATE = '2026-08-30'
const ALI_DATE = '2026-08-17'
const ALI_IDS = [
  '740f0d12-e10f-4a85-9102-e155c55c8f06',
  '56a8d5f8-1a36-4eae-8e1d-88012c0b4d66',
]

async function updateDebtor(
  admin: ReturnType<typeof createClient>,
  id: string,
  date: string,
  label: string,
) {
  const { data: d, error } = await admin
    .from('debtors')
    .select('id, full_name, first_hearing_date, current_task_id')
    .eq('id', id)
    .single()
  if (error || !d) {
    console.error('فشل جلب:', label, error?.message)
    return
  }
  console.log(`\n${d.full_name}`)
  console.log(`  قديم=${d.first_hearing_date ?? '—'} → ${date}`)

  const { error: dErr } = await admin
    .from('debtors')
    .update({ first_hearing_date: date })
    .eq('id', id)
  if (dErr) {
    console.error('  فشل تحديث المدين:', dErr.message)
    return
  }

  if (d.current_task_id) {
    const { data: t } = await admin
      .from('tasks')
      .select('id, task_type, completion_data, task_definitions(label)')
      .eq('id', d.current_task_id)
      .single()
    if (t) {
      const defLabel = Array.isArray(t.task_definitions)
        ? t.task_definitions[0]?.label
        : (t.task_definitions as { label?: string } | null)?.label
      const prev = (t.completion_data ?? {}) as Record<string, unknown>
      const isPleading =
        t.task_type === 'pleading' || String(defLabel ?? '').includes('مرافع')
      const hadHearing = Boolean(extractHearingDateFromCompletion(prev))
      if (isPleading || hadHearing) {
        const next = syncHearingDateInCompletion(prev, date)
        const { error: tErr } = await admin
          .from('tasks')
          .update({ completion_data: next })
          .eq('id', t.id)
        if (tErr) console.error('  فشل تحديث مهمة:', tErr.message)
        else console.log('  حدّثت completion_data')
      }
    }
  }
  console.log('  ✅ تم')
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // ماهر: كل من يبدأ اسمه بـ ماهر طاهر شوكت وما زال بتاريخ قديم أو أي متغير
  const { data: mahers, error: mErr } = await admin
    .from('debtors')
    .select('id, full_name, first_hearing_date')
    .ilike('full_name', '%ماهر%طاهر%شوكت%')
    .neq('case_status', 'closed')

  if (mErr) throw new Error(mErr.message)
  console.log('=== ماهر طاهر شوكت ومتغيراته ===')
  for (const d of mahers ?? []) {
    console.log(`  ${d.full_name} | ${d.first_hearing_date}`)
  }

  const maherToUpdate = (mahers ?? []).filter(d => d.first_hearing_date !== MAHER_DATE)
  for (const d of maherToUpdate) {
    await updateDebtor(admin, d.id, MAHER_DATE, d.full_name)
  }
  if (!maherToUpdate.length) console.log('لا يوجد ما يُحدَّث لماهر (الكل على التاريخ الجديد)')

  console.log('\n=== علي عباس كريم (الاسمان) ===')
  for (const id of ALI_IDS) {
    await updateDebtor(admin, id, ALI_DATE, id)
  }

  console.log('\nتم.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
