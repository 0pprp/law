/**
 * QA شامل: محفظة القرطاسية + خصم إقامة دعوى + تنظيف كامل.
 * التشغيل: npx tsx scripts/qa-stationery-wallet.ts
 */
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  depositStationery,
  withdrawStationery,
  fetchStationeryBalances,
  deductStationeryOnLawsuitApproval,
  reverseStationeryLawsuitDeduction,
  LAWSUIT_STATIONERY_DEDUCT,
} from '../lib/lawyer-stationery-wallet'
import { approveTaskCompletion, finalizeTaskApproval, FEE_STATUS_AWAITING_NEXT_TASK } from '../lib/task-approval'

const root = process.cwd()
const MARKER = `QA_STATIONERY_${Date.now()}`

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
    if (!process.env[k]) {
      process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
}

type Check = { ok: boolean; msg: string; detail?: unknown }
const checks: Check[] = []
let failures = 0

function check(msg: string, cond: boolean, detail?: unknown) {
  checks.push({ ok: cond, msg, detail })
  if (cond) console.log('  PASS:', msg)
  else {
    failures++
    console.error('  FAIL:', msg, detail ?? '')
  }
}

async function ensureSchema(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from('lawyer_stationery_wallets').select('lawyer_id').limit(1)
  if (!error) return true

  console.log('الجداول غير موجودة — محاولة تطبيق الـ migration...')
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL / SUPABASE_DB_URL غير موجود — لا يمكن تطبيق SQL تلقائياً')
    console.error(error.message)
    return false
  }

  const sqlPath = resolve(root, 'supabase/migrations/20260806190000_lawyer_stationery_wallet.sql')
  const sql = readFileSync(sqlPath, 'utf8')
  const pg = await import('pg')
  const client = new pg.default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }

  // PostgREST schema cache
  await new Promise(r => setTimeout(r, 1500))
  const probe = await supabase.from('lawyer_stationery_wallets').select('lawyer_id').limit(1)
  if (probe.error) {
    console.error('فشل بعد التطبيق:', probe.error.message)
    return false
  }
  console.log('تم تطبيق schema محفظة القرطاسية')
  return true
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing Supabase env')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    marker: MARKER,
    phases: [] as string[],
  }

  if (!(await ensureSchema(supabase))) {
    process.exit(1)
  }
  ;(report.phases as string[]).push('schema_ok')

  // محامٍ موجود + مراجع إداري
  const { data: lawyer } = await supabase
    .from('profiles')
    .select('id, branch_id, full_name, case_type')
    .eq('role', 'lawyer')
    .eq('is_active', true)
    .not('branch_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (!lawyer?.branch_id) {
    console.error('لا يوجد محامٍ نشط بفرع للاختبار')
    process.exit(1)
  }

  const { data: adminUser } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'employee', 'accountant'])
    .limit(1)
    .maybeSingle()

  const actorId = adminUser?.id ?? lawyer.id
  console.log('محامي الاختبار:', lawyer.full_name, lawyer.id)

  // حفظ رصيد القرطاسية الأصلي لاستعادته
  const originalBal = await fetchStationeryBalances(supabase, lawyer.id)
  console.log('رصيد أصلي:', originalBal)

  const cleanupTaskIds: string[] = []
  let debtorId: string | null = null
  const stationeryTxIds: string[] = []
  let createdWallet = false

  async function cleanup() {
    console.log('\n--- تنظيف بيانات الاختبار ---')
    // حذف حركات الاختبار عبر notes/reference
    if (cleanupTaskIds.length) {
      await supabase
        .from('lawyer_stationery_transactions')
        .delete()
        .in('reference_id', cleanupTaskIds)
      await supabase
        .from('lawyer_wallet_transactions')
        .delete()
        .in('reference_id', cleanupTaskIds)
    }
    // حركات الإيداع/السحب اليدوية للاختبار
    await supabase
      .from('lawyer_stationery_transactions')
      .delete()
      .eq('lawyer_id', lawyer!.id)
      .like('notes', `%${MARKER}%`)

    if (stationeryTxIds.length) {
      await supabase.from('lawyer_stationery_transactions').delete().in('id', stationeryTxIds)
    }

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
      console.log('حُذف المدين والمهام:', debtorId)
    }

    // استعادة الرصيد الأصلي بدقة
    await supabase.from('lawyer_stationery_wallets').upsert({
      lawyer_id: lawyer!.id,
      files_balance: originalBal.files,
      stamps_balance: originalBal.stamps,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lawyer_id' })

    // إن لم يكن للمحامي محفظة أصلاً وكان الرصيد 0 — احذف الصف إن أُنشئ للاختبار فقط
    if (createdWallet && originalBal.files === 0 && originalBal.stamps === 0) {
      const { count } = await supabase
        .from('lawyer_stationery_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('lawyer_id', lawyer!.id)
      if (!count) {
        await supabase.from('lawyer_stationery_wallets').delete().eq('lawyer_id', lawyer!.id)
        console.log('حُذفت محفظة فارغة أُنشئت للاختبار')
      }
    }

    const restored = await fetchStationeryBalances(supabase, lawyer!.id)
    console.log('رصيد بعد الاستعادة:', restored)
    check('استعادة الرصيد الأصلي', restored.files === originalBal.files && restored.stamps === originalBal.stamps, { restored, originalBal })
  }

  try {
    // --- 1) إيداع فايلات ---
    console.log('\n[1] إيداع فايلات')
    const before1 = await fetchStationeryBalances(supabase, lawyer.id)
    if (before1.files === 0 && before1.stamps === 0) {
      const { data: existing } = await supabase
        .from('lawyer_stationery_wallets')
        .select('lawyer_id')
        .eq('lawyer_id', lawyer.id)
        .maybeSingle()
      createdWallet = !existing
    }

    const depFiles = await depositStationery(supabase, {
      lawyerId: lawyer.id,
      item: 'files',
      amount: 5,
      notes: `${MARKER} deposit files`,
      createdBy: actorId,
      referenceId: crypto.randomUUID(),
    })
    check('إيداع 5 فايلات', depFiles.ok, depFiles.error)
    const afterDepFiles = await fetchStationeryBalances(supabase, lawyer.id)
    check('رصيد الفايلات +5', afterDepFiles.files === before1.files + 5, afterDepFiles)

    // --- 2) إيداع طوابع ---
    console.log('\n[2] إيداع طوابع')
    const depStamps = await depositStationery(supabase, {
      lawyerId: lawyer.id,
      item: 'stamps',
      amount: 3,
      notes: `${MARKER} deposit stamps`,
      createdBy: actorId,
      referenceId: crypto.randomUUID(),
    })
    check('إيداع 3 طوابع', depStamps.ok, depStamps.error)
    const afterDepStamps = await fetchStationeryBalances(supabase, lawyer.id)
    check('رصيد الطوابع +3', afterDepStamps.stamps === before1.stamps + 3, afterDepStamps)

    // --- 3) سحب منفصل ---
    console.log('\n[3] سحب فايل واحد')
    const wd = await withdrawStationery(supabase, {
      lawyerId: lawyer.id,
      item: 'files',
      amount: 1,
      notes: `${MARKER} withdraw files`,
      createdBy: actorId,
      referenceId: crypto.randomUUID(),
    })
    check('سحب فايل', wd.ok, wd.error)
    const afterWd = await fetchStationeryBalances(supabase, lawyer.id)
    check('رصيد الفايلات بعد السحب', afterWd.files === afterDepFiles.files - 1, afterWd)

    // --- 4) رفض سحب أكبر من الرصيد ---
    console.log('\n[4] سحب أكبر من الرصيد')
    const over = await withdrawStationery(supabase, {
      lawyerId: lawyer.id,
      item: 'stamps',
      amount: afterWd.stamps + 100,
      notes: `${MARKER} overdraw`,
      createdBy: actorId,
    })
    check('رفض السحب الزائد', !over.ok)
    const afterOver = await fetchStationeryBalances(supabase, lawyer.id)
    check('الرصيد لم يتغير بعد الرفض', afterOver.stamps === afterWd.stamps, afterOver)

    // --- 5) رفض إيداع كمية غير صالحة ---
    console.log('\n[5] إيداع غير صالح')
    const bad = await depositStationery(supabase, {
      lawyerId: lawyer.id,
      item: 'files',
      amount: 0,
      notes: `${MARKER} bad`,
      createdBy: actorId,
    })
    check('رفض كمية صفر', !bad.ok)

    // --- 6) خصم إقامة دعوى مباشرة (مكتبة) ---
    console.log('\n[6] خصم إقامة دعوى (مكتبة مباشرة)')
    const fakeTaskId = crypto.randomUUID()
    cleanupTaskIds.push(fakeTaskId)
    const balBeforeDeduct = await fetchStationeryBalances(supabase, lawyer.id)
    const deduct1 = await deductStationeryOnLawsuitApproval(supabase, {
      lawyerId: lawyer.id,
      taskId: fakeTaskId,
      reviewedBy: actorId,
    })
    check('خصم إقامة دعوى نجح', deduct1.ok, deduct1.error)
    const balAfterDeduct = await fetchStationeryBalances(supabase, lawyer.id)
    check(
      'نقص فايل + طابع',
      balAfterDeduct.files === balBeforeDeduct.files - LAWSUIT_STATIONERY_DEDUCT.files
        && balAfterDeduct.stamps === balBeforeDeduct.stamps - LAWSUIT_STATIONERY_DEDUCT.stamps,
      { balBeforeDeduct, balAfterDeduct },
    )

    // --- 7) idempotent ---
    console.log('\n[7] تكرار الخصم لنفس المهمة')
    const deduct2 = await deductStationeryOnLawsuitApproval(supabase, {
      lawyerId: lawyer.id,
      taskId: fakeTaskId,
      reviewedBy: actorId,
    })
    check('التكرار skipped/ok', deduct2.ok && Boolean(deduct2.skipped), deduct2)
    const balAfterIdem = await fetchStationeryBalances(supabase, lawyer.id)
    check('الرصيد ثابت بعد التكرار', balAfterIdem.files === balAfterDeduct.files && balAfterIdem.stamps === balAfterDeduct.stamps)

    // --- 8) reverse ---
    console.log('\n[8] إلغاء الخصم')
    const rev = await reverseStationeryLawsuitDeduction(supabase, fakeTaskId, actorId)
    check('الإلغاء نجح', rev.ok, rev.error)
    const balAfterRev = await fetchStationeryBalances(supabase, lawyer.id)
    check(
      'استعادة بعد الإلغاء',
      balAfterRev.files === balBeforeDeduct.files && balAfterRev.stamps === balBeforeDeduct.stamps,
      balAfterRev,
    )

    // --- 9) مسار اعتماد نهائي لمهمة file_lawsuit حقيقية ---
    console.log('\n[9] مسار اعتماد نهائي لإقامة دعوى')
    const { data: lawsuitDef } = await supabase
      .from('task_definitions')
      .select('id, label, fee_amount, task_type, case_type, branch_id')
      .eq('task_type', 'file_lawsuit')
      .eq('is_active', true)
      .or(`branch_id.eq.${lawyer.branch_id},branch_id.is.null`)
      .limit(5)

    const civilLawsuit = (lawsuitDef ?? []).find(d => (d.case_type ?? 'civil') !== 'criminal')
      ?? (lawsuitDef ?? [])[0]

    if (!civilLawsuit) {
      check('وجود تعريف إقامة دعوى', false, 'لا يوجد task_definition لـ file_lawsuit')
    } else {
      const { data: nextDefs } = await supabase
        .from('task_definitions')
        .select('id, task_type, case_type, fee_amount')
        .eq('is_active', true)
        .neq('id', civilLawsuit.id)
        .or(`branch_id.eq.${lawyer.branch_id},branch_id.is.null`)
        .limit(20)

      const nextDef = (nextDefs ?? []).find(d => (d.case_type ?? 'civil') === (civilLawsuit.case_type ?? 'civil'))
        ?? (nextDefs ?? [])[0]

      const { data: debtor, error: dErr } = await supabase.from('debtors').insert({
        full_name: MARKER,
        branch_id: lawyer.branch_id,
        case_status: 'active',
        case_type: civilLawsuit.case_type === 'criminal' ? 'criminal' : 'civil',
      } as any).select('id').single()

      check('إنشاء مدين اختبار', !dErr && Boolean(debtor), dErr?.message)
      if (debtor) {
        debtorId = debtor.id
        const FEE = Math.max(1000, Number(civilLawsuit.fee_amount ?? 5000))
        const { data: task, error: tErr } = await supabase.from('tasks').insert({
          debtor_id: debtorId,
          branch_id: lawyer.branch_id,
          task_definition_id: civilLawsuit.id,
          task_type: 'file_lawsuit',
          task_status: 'submitted',
          assigned_to: lawyer.id,
          reward_amount: FEE,
          created_by: actorId,
        } as any).select('id').single()

        check('إنشاء مهمة إقامة دعوى', !tErr && Boolean(task), tErr?.message)
        if (task) {
          cleanupTaskIds.push(task.id)
          await supabase.from('debtors').update({ current_task_id: task.id } as any).eq('id', debtorId)

          // تأكد من رصيد كافٍ قبل الاعتماد النهائي
          const need = await fetchStationeryBalances(supabase, lawyer.id)
          if (need.files < 1) {
            await depositStationery(supabase, {
              lawyerId: lawyer.id, item: 'files', amount: 2,
              notes: `${MARKER} topup files`, createdBy: actorId, referenceId: crypto.randomUUID(),
            })
          }
          if (need.stamps < 1) {
            await depositStationery(supabase, {
              lawyerId: lawyer.id, item: 'stamps', amount: 2,
              notes: `${MARKER} topup stamps`, createdBy: actorId, referenceId: crypto.randomUUID(),
            })
          }

          const approve = await approveTaskCompletion(supabase, task.id, actorId)
          check('اعتماد الإنجاز (مرحلة 1)', approve.ok, approve.error)

          const balPreFinalize = await fetchStationeryBalances(supabase, lawyer.id)
          // اعتماد نهائي
          const fin = await finalizeTaskApproval(supabase, task.id, actorId)
          check('الاعتماد النهائي نجح', fin.ok, fin.error)

          const balPostFinalize = await fetchStationeryBalances(supabase, lawyer.id)
          check(
            'خصم قرطاسية بعد الاعتماد النهائي',
            balPostFinalize.files === balPreFinalize.files - 1
              && balPostFinalize.stamps === balPreFinalize.stamps - 1,
            { balPreFinalize, balPostFinalize, fin },
          )

          const { data: dedTx } = await supabase
            .from('lawyer_stationery_transactions')
            .select('id, item, amount, type')
            .eq('reference_id', task.id)
            .eq('type', 'lawsuit_deduction')

          check('سجل خصم فايل+طابع', (dedTx ?? []).length === 2, dedTx)

          // تكرار الاعتماد النهائي — لا خصم إضافي
          const fin2 = await finalizeTaskApproval(supabase, task.id, actorId)
          check('تكرار الاعتماد النهائي idempotent', fin2.ok && Boolean(fin2.alreadyFinalized || fin2.ok), fin2)
          const balPostFin2 = await fetchStationeryBalances(supabase, lawyer.id)
          check('لا خصم مكرر', balPostFin2.files === balPostFinalize.files && balPostFin2.stamps === balPostFinalize.stamps)

          // --- 10) فشل الاعتماد عند رصيد صفر ---
          console.log('\n[10] فشل الاعتماد النهائي برصيد غير كافٍ')
          // صفّر الرصيد مؤقتاً
          await supabase.from('lawyer_stationery_wallets').update({
            files_balance: 0,
            stamps_balance: 0,
            updated_at: new Date().toISOString(),
          }).eq('lawyer_id', lawyer.id)

          const { data: task2, error: t2Err } = await supabase.from('tasks').insert({
            debtor_id: debtorId,
            branch_id: lawyer.branch_id,
            task_definition_id: civilLawsuit.id,
            task_type: 'file_lawsuit',
            task_status: 'submitted',
            assigned_to: lawyer.id,
            reward_amount: FEE,
            created_by: actorId,
          } as any).select('id').single()

          check('مهمة ثانية للاختبار السلبي', !t2Err && Boolean(task2), t2Err?.message)
          if (task2) {
            cleanupTaskIds.push(task2.id)
            const ap2 = await approveTaskCompletion(supabase, task2.id, actorId)
            check('اعتماد إنجاز المهمة الثانية', ap2.ok, ap2.error)
            const finFail = await finalizeTaskApproval(supabase, task2.id, actorId)
            check('فشل الاعتماد النهائي لنقص القرطاسية', !finFail.ok, finFail)
            check('رسالة نقص واضحة', Boolean(finFail.error && /فايل|طابع|قرطاس/i.test(finFail.error)), finFail.error)

            const { data: t2state } = await supabase
              .from('tasks')
              .select('fee_status')
              .eq('id', task2.id)
              .single()
            check(
              'fee_status بقي awaiting بعد الفشل',
              t2state?.fee_status === FEE_STATUS_AWAITING_NEXT_TASK,
              t2state,
            )

            // أعد رصيداً بسيطاً لباقي التنظيف
            await depositStationery(supabase, {
              lawyerId: lawyer.id, item: 'files', amount: 1,
              notes: `${MARKER} restore after fail test`, createdBy: actorId, referenceId: crypto.randomUUID(),
            })
            await depositStationery(supabase, {
              lawyerId: lawyer.id, item: 'stamps', amount: 1,
              notes: `${MARKER} restore after fail test`, createdBy: actorId, referenceId: crypto.randomUUID(),
            })
          }

          void nextDef
        }
      }
    }

    // --- 11) UI surface smoke (ملفات موجودة) ---
    console.log('\n[11] التحقق من وجود واجهات العرض')
    const surfaces = [
      'components/AdminStationeryWalletPanel.tsx',
      'components/LawyerStationerySummary.tsx',
      'app/lawyer/page.tsx',
      'app/lawyer/profile/page.tsx',
      'app/lawyer/tasks/page.tsx',
      'app/admin/expenses/page.tsx',
      'lib/lawyer-stationery-wallet.ts',
      'lib/task-approval.ts',
    ]
    for (const rel of surfaces) {
      const p = resolve(root, rel)
      const exists = existsSync(p)
      check(`ملف موجود: ${rel}`, exists)
      if (exists && (rel.includes('lawyer/page') || rel.includes('expenses') || rel.includes('profile') || rel.includes('tasks'))) {
        const src = readFileSync(p, 'utf8')
        check(`${rel} يستورد/يعرض القرطاسية`, /Stationery|stationery|قرطاس/.test(src))
      }
    }

    // تحقق أن الخصم مربوط في finalize
    const approvalSrc = readFileSync(resolve(root, 'lib/task-approval.ts'), 'utf8')
    check('finalize يستدعي خصم القرطاسية', /deductStationeryOnLawsuitApproval/.test(approvalSrc))
    check('finalize يتحقق من file_lawsuit', /file_lawsuit/.test(approvalSrc) && /deductStationery/.test(approvalSrc))

  } catch (e) {
    console.error('خطأ غير متوقع:', e)
    failures++
    checks.push({ ok: false, msg: 'unexpected', detail: String(e) })
  } finally {
    await cleanup()
  }

  report.endedAt = new Date().toISOString()
  report.failures = failures
  report.passed = failures === 0
  report.checks = checks
  report.total = checks.length

  const outPath = resolve(root, 'scripts/qa-stationery-wallet-report.json')
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n==============================')
  console.log(`النتيجة: ${failures === 0 ? 'PASS' : 'FAIL'} — ${checks.filter(c => c.ok).length}/${checks.length}`)
  console.log('التقرير:', outPath)
  console.log('==============================')

  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
