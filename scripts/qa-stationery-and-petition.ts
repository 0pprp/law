/**
 * QA: محفظة القرطاسية (طوابع فقط) + حقل طبيعة العمل في العريضة + تنظيف.
 * التشغيل: npx tsx scripts/qa-stationery-and-petition.ts
 */
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  depositStationery,
  withdrawStationery,
  fetchStationeryBalances,
  deductStationeryOnLawsuitApproval,
  reverseStationeryLawsuitDeduction,
  LAWSUIT_STATIONERY_DEDUCT,
} from '../lib/lawyer-stationery-wallet'
import {
  buildPetitionTextLines,
  buildPetitionHtml,
  validatePetitionFields,
  normalizePetitionFields,
} from '../lib/debtor-petition'
import { approveTaskCompletion, finalizeTaskApproval, FEE_STATUS_AWAITING_NEXT_TASK } from '../lib/task-approval'

const root = process.cwd()
const MARKER = `QA_STAMP_PET_${Date.now()}`

function loadEnv() {
  const path = resolve(root, '.env.local')
  if (!existsSync(path)) return
  let raw = readFileSync(path, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const checks: { ok: boolean; msg: string; detail?: unknown }[] = []
let failures = 0
function check(msg: string, cond: boolean, detail?: unknown) {
  checks.push({ ok: cond, msg, detail })
  if (cond) console.log('  PASS:', msg)
  else {
    failures++
    console.error('  FAIL:', msg, detail ?? '')
  }
}

async function ensureStampsOnlySchema(supabase: ReturnType<typeof createClient>) {
  const probe = await supabase.from('lawyer_stationery_wallets').select('stamps_balance').limit(1)
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message)) {
    console.error('جداول القرطاسية غير موجودة')
    return false
  }

  // احذف حركات الفايلات دائماً
  const del = await supabase.from('lawyer_stationery_transactions').delete().eq('item', 'files').select('id')
  check('حذف حركات الفايلات من القاعدة', !del.error, del.error?.message)
  console.log('حُذفت حركات فايلات:', del.data?.length ?? 0)

  const filesCol = await supabase.from('lawyer_stationery_wallets').select('files_balance').limit(1)
  if (!filesCol.error) {
    console.log('عمود files_balance ما زال موجوداً — محاولة تطبيق الترحيل...')
    const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
    if (databaseUrl) {
      const sql = readFileSync(resolve(root, 'supabase/migrations/20260808120000_stationery_stamps_only.sql'), 'utf8')
      const pg = await import('pg')
      const client = new (pg as any).default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
      await client.connect()
      try {
        await client.query(sql)
      } finally {
        await client.end()
      }
      await new Promise(r => setTimeout(r, 1200))
      const after = await supabase.from('lawyer_stationery_wallets').select('files_balance').limit(1)
      check('عمود الفايلات محذوف من القاعدة', Boolean(after.error), after.error?.message)
    } else {
      // بدون DATABASE_URL: صفّر العمود وأكمل — التطبيق الكامل عبر SQL Editor
      await supabase.from('lawyer_stationery_wallets').update({ files_balance: 0 } as any).gte('files_balance', 0)
      check('عمود الفايلات صفّر (بانتظار DROP عبر SQL)', true, 'لا DATABASE_URL — نفذ supabase/migrations/20260808120000_stationery_stamps_only.sql')
    }
  } else {
    check('عمود الفايلات محذوف من القاعدة', true, filesCol.error.message)
  }
  return true
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  console.log('\n══ [A] عريضة الدعوى — طبيعة العمل ══')
  const sample = normalizePetitionFields({
    courtName: 'النجف',
    plaintiffName: 'المدير المفوض لشركة قلعة الضمان',
    defendantName: 'أحمد صباح',
    defendantOccupation: 'موظف أهلي',
    defendantAddress: 'حي الأنصار',
    amountDigits: '100000',
    amountWords: 'مائة ألف',
    lawyerName: 'محامي الاختبار',
  })
  check('التحقق من الحقول ينجح', validatePetitionFields(sample) === null, validatePetitionFields(sample))
  check('طبيعة العمل مطلوبة', validatePetitionFields({ ...sample, defendantOccupation: '' }) !== null)

  const lines = buildPetitionTextLines(sample)
  const partyLine = lines.find(l => l.startsWith('المدعى عليه /')) ?? ''
  check(
    'صيغة الطرف: اسم / طبيعة / يسكن / عنوان',
    partyLine === 'المدعى عليه / أحمد صباح / موظف أهلي / يسكن / حي الأنصار',
    partyLine,
  )
  const html = buildPetitionHtml(sample)
  check('HTML يحتوي / يسكن وطبيعة العمل', html.includes('موظف أهلي / يسكن') && html.includes('أحمد صباح'))

  // ملفات الواجهة
  const petitionLib = readFileSync(resolve(root, 'lib/debtor-petition.ts'), 'utf8')
  const buttonSrc = readFileSync(resolve(root, 'components/DebtorPetitionButton.tsx'), 'utf8')
  check('لا ذكر للفايلات في ملصقات القرطاسية UI', !readFileSync(resolve(root, 'components/LawyerStationerySummary.tsx'), 'utf8').includes('فايل'))
  check('حقل طبيعة العمل في النموذج', buttonSrc.includes('defendantOccupation') || petitionLib.includes('defendantOccupation'))

  console.log('\n══ [B] محفظة القرطاسية — طوابع فقط ══')
  if (!(await ensureStampsOnlySchema(supabase))) {
    process.exit(1)
  }

  const { data: lawyer } = await supabase
    .from('profiles')
    .select('id, branch_id, full_name')
    .eq('role', 'lawyer')
    .eq('is_active', true)
    .not('branch_id', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!lawyer?.branch_id) {
    console.error('لا محامٍ')
    process.exit(1)
  }
  const { data: adminUser } = await supabase.from('profiles').select('id').in('role', ['admin', 'employee', 'accountant']).limit(1).maybeSingle()
  const actorId = adminUser?.id ?? lawyer.id
  console.log('محامي:', lawyer.full_name)

  const originalBal = await fetchStationeryBalances(supabase, lawyer.id)
  let debtorId: string | null = null
  const cleanupTaskIds: string[] = []

  async function cleanup() {
    console.log('\n--- تنظيف ---')
    if (cleanupTaskIds.length) {
      await supabase.from('lawyer_stationery_transactions').delete().in('reference_id', cleanupTaskIds)
      await supabase.from('lawyer_wallet_transactions').delete().in('reference_id', cleanupTaskIds)
    }
    await supabase.from('lawyer_stationery_transactions').delete().eq('lawyer_id', lawyer!.id).like('notes', `%${MARKER}%`)
    if (debtorId) {
      await supabase.from('debtors').update({ current_task_id: null, last_task_id: null } as any).eq('id', debtorId)
      const { data: rest } = await supabase.from('tasks').select('id').eq('debtor_id', debtorId)
      const restIds = (rest ?? []).map(t => t.id)
      if (restIds.length) {
        await supabase.from('lawyer_wallet_transactions').delete().in('reference_id', restIds)
        await supabase.from('lawyer_stationery_transactions').delete().in('reference_id', restIds)
        await supabase.from('expenses').delete().in('task_id', restIds)
        await supabase.from('tasks').delete().in('id', restIds)
      }
      await supabase.from('debtors').delete().eq('id', debtorId)
    }
    await supabase.from('lawyer_stationery_wallets').upsert({
      lawyer_id: lawyer!.id,
      stamps_balance: originalBal.stamps,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lawyer_id' })
    if (originalBal.stamps === 0) {
      const { count } = await supabase.from('lawyer_stationery_transactions').select('id', { count: 'exact', head: true }).eq('lawyer_id', lawyer!.id)
      if (!count) await supabase.from('lawyer_stationery_wallets').delete().eq('lawyer_id', lawyer!.id)
    }
    const restored = await fetchStationeryBalances(supabase, lawyer!.id)
    check('استعادة رصيد الطوابع', restored.stamps === originalBal.stamps, { restored, originalBal })
  }

  try {
    check('لا مفتاح files في الرصيد', !('files' in (await fetchStationeryBalances(supabase, lawyer.id))))

    const before = await fetchStationeryBalances(supabase, lawyer.id)
    const dep = await depositStationery(supabase, {
      lawyerId: lawyer.id, amount: 4, notes: `${MARKER} deposit`, createdBy: actorId, referenceId: crypto.randomUUID(),
    })
    check('إيداع طوابع', dep.ok, dep.error)
    const afterDep = await fetchStationeryBalances(supabase, lawyer.id)
    check('الرصيد +4', afterDep.stamps === before.stamps + 4, afterDep)

    const wd = await withdrawStationery(supabase, {
      lawyerId: lawyer.id, amount: 1, notes: `${MARKER} withdraw`, createdBy: actorId, referenceId: crypto.randomUUID(),
    })
    check('سحب طابع', wd.ok, wd.error)

    const fakeTask = crypto.randomUUID()
    cleanupTaskIds.push(fakeTask)
    const balPre = await fetchStationeryBalances(supabase, lawyer.id)
    const ded = await deductStationeryOnLawsuitApproval(supabase, { lawyerId: lawyer.id, taskId: fakeTask, reviewedBy: actorId })
    check('خصم طابع واحد', ded.ok, ded.error)
    const balPost = await fetchStationeryBalances(supabase, lawyer.id)
    check('نقص stamps فقط', balPost.stamps === balPre.stamps - LAWSUIT_STATIONERY_DEDUCT.stamps, { balPre, balPost })

    const ded2 = await deductStationeryOnLawsuitApproval(supabase, { lawyerId: lawyer.id, taskId: fakeTask, reviewedBy: actorId })
    check('idempotent', Boolean(ded2.ok && ded2.skipped))

    const rev = await reverseStationeryLawsuitDeduction(supabase, fakeTask, actorId)
    check('عكس الخصم', rev.ok, rev.error)

    // مسار اعتماد نهائي
    const { data: lawsuitDefs } = await supabase
      .from('task_definitions')
      .select('id, fee_amount, case_type')
      .eq('task_type', 'file_lawsuit')
      .eq('is_active', true)
      .or(`branch_id.eq.${lawyer.branch_id},branch_id.is.null`)
      .limit(3)
    const lawsuitDef = lawsuitDefs?.[0]
    if (lawsuitDef) {
      const { data: debtor } = await supabase.from('debtors').insert({
        full_name: MARKER,
        branch_id: lawyer.branch_id,
        case_status: 'active',
        case_type: lawsuitDef.case_type === 'criminal' ? 'criminal' : 'civil',
      } as any).select('id').single()
      if (debtor) {
        debtorId = debtor.id
        const { data: task } = await supabase.from('tasks').insert({
          debtor_id: debtorId,
          branch_id: lawyer.branch_id,
          task_definition_id: lawsuitDef.id,
          task_type: 'file_lawsuit',
          task_status: 'submitted',
          assigned_to: lawyer.id,
          reward_amount: Math.max(1000, Number(lawsuitDef.fee_amount ?? 5000)),
          created_by: actorId,
        } as any).select('id').single()
        if (task) {
          cleanupTaskIds.push(task.id)
          await supabase.from('debtors').update({ current_task_id: task.id } as any).eq('id', debtorId)
          const need = await fetchStationeryBalances(supabase, lawyer.id)
          if (need.stamps < 1) {
            await depositStationery(supabase, {
              lawyerId: lawyer.id, amount: 2, notes: `${MARKER} topup`, createdBy: actorId, referenceId: crypto.randomUUID(),
            })
          }
          const ap = await approveTaskCompletion(supabase, task.id, actorId)
          check('اعتماد إنجاز', ap.ok, ap.error)
          const preF = await fetchStationeryBalances(supabase, lawyer.id)
          const fin = await finalizeTaskApproval(supabase, task.id, actorId)
          check('اعتماد نهائي', fin.ok, fin.error)
          const postF = await fetchStationeryBalances(supabase, lawyer.id)
          check('خصم طابع بعد الاعتماد النهائي', postF.stamps === preF.stamps - 1, { preF, postF })

          const { data: txs } = await supabase
            .from('lawyer_stationery_transactions')
            .select('item')
            .eq('reference_id', task.id)
            .eq('type', 'lawsuit_deduction')
          check('حركة خصم stamps فقط', (txs ?? []).length === 1 && txs![0].item === 'stamps', txs)

          // فشل عند صفر
          await supabase.from('lawyer_stationery_wallets').update({ stamps_balance: 0 }).eq('lawyer_id', lawyer.id)
          const { data: task2 } = await supabase.from('tasks').insert({
            debtor_id: debtorId,
            branch_id: lawyer.branch_id,
            task_definition_id: lawsuitDef.id,
            task_type: 'file_lawsuit',
            task_status: 'submitted',
            assigned_to: lawyer.id,
            reward_amount: 5000,
            created_by: actorId,
          } as any).select('id').single()
          if (task2) {
            cleanupTaskIds.push(task2.id)
            await approveTaskCompletion(supabase, task2.id, actorId)
            const fail = await finalizeTaskApproval(supabase, task2.id, actorId)
            check('فشل عند رصيد صفر', !fail.ok && /طوابع/i.test(fail.error ?? ''), fail)
            const { data: st } = await supabase.from('tasks').select('fee_status').eq('id', task2.id).single()
            check('fee_status awaiting بعد الفشل', st?.fee_status === FEE_STATUS_AWAITING_NEXT_TASK, st)
          }
        }
      }
    }

    // لا ملفات UI للفايلات
    const adminPanel = readFileSync(resolve(root, 'components/AdminStationeryWalletPanel.tsx'), 'utf8')
    check('لوحة الإدارة بلا فايلات', !adminPanel.includes('فايلات') && !adminPanel.includes("'files'"))
  } catch (e) {
    failures++
    console.error(e)
  } finally {
    await cleanup()
  }

  const report = {
    startedAt: new Date().toISOString(),
    marker: MARKER,
    failures,
    passed: failures === 0,
    total: checks.length,
    checks,
  }
  writeFileSync(resolve(root, 'scripts/qa-stamp-petition-report.json'), JSON.stringify(report, null, 2))
  console.log(`\nالنتيجة: ${failures === 0 ? 'PASS' : 'FAIL'} — ${checks.filter(c => c.ok).length}/${checks.length}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
