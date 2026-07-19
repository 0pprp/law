/**
 * QA: فصل اعتماد الإنجاز عن الاعتماد النهائي واحتساب الأتعاب.
 *
 * يُنشئ مديناً ومهمة مؤقتة ثم يتحقق:
 *  1) اعتماد الإنجاز → approved + awaiting_next_task، بلا أي حركة مالية.
 *  2) تكرار الاعتماد → idempotent.
 *  3) فشل إنشاء المهمة التالية → لا أتعاب ولا اعتماد نهائي.
 *  4) إنشاء المهمة التالية → اعتماد نهائي + حركة أتعاب واحدة فقط.
 *  5) تكرار الإجراء اللاحق → مرفوض، لا مهمة مكررة ولا أتعاب مكررة.
 * ثم يحذف كل السجلات المؤقتة.
 *
 * التشغيل: npx tsx scripts/qa-two-stage-approval.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { approveTaskCompletion, finalizeTaskApproval } from '../lib/task-approval'
import { applyTaskTransition } from '../lib/task-operations-api'

function loadEnv() {
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim()
  }
}

let failures = 0
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  PASS:', label)
  } else {
    failures++
    console.error('  FAIL:', label, extra ?? '')
  }
}

async function main() {
  loadEnv()
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // محامٍ + تعريفا مهمة مدنيان من نفس الفرع
  const { data: lawyer } = await supabase
    .from('profiles').select('id, branch_id, full_name').eq('role', 'lawyer').not('branch_id', 'is', null).limit(1).maybeSingle()
  if (!lawyer) { console.error('لا يوجد محامٍ للاختبار'); process.exit(1) }

  const { data: defs } = await supabase
    .from('task_definitions')
    .select('id, label, fee_amount, task_type, case_type, branch_id')
    .eq('is_active', true)
    .gt('fee_amount', 0)
    .or(`branch_id.eq.${lawyer.branch_id},branch_id.is.null`)
    .limit(10)
  const civilDefs = (defs ?? []).filter(d => (d.case_type ?? 'civil') !== 'criminal')
  if (civilDefs.length < 2) { console.error('لا توجد تعريفات مهام كافية'); process.exit(1) }
  const [defA, defB] = civilDefs

  const cleanupTaskIds: string[] = []
  let debtorId: string | null = null

  async function cleanup() {
    if (cleanupTaskIds.length) {
      await supabase.from('lawyer_wallet_transactions').delete().in('reference_id', cleanupTaskIds)
      if (debtorId) await supabase.from('debtors').update({ current_task_id: null, last_task_id: null } as any).eq('id', debtorId)
      await supabase.from('tasks').delete().in('id', cleanupTaskIds)
      // أي مهمة لاحقة أنشأها الاختبار لهذا المدين
      if (debtorId) {
        const { data: rest } = await supabase.from('tasks').select('id').eq('debtor_id', debtorId)
        const restIds = (rest ?? []).map(t => t.id)
        if (restIds.length) {
          await supabase.from('lawyer_wallet_transactions').delete().in('reference_id', restIds)
          await supabase.from('tasks').delete().in('id', restIds)
        }
      }
    }
    if (debtorId) await supabase.from('debtors').delete().eq('id', debtorId)
  }

  try {
    const { data: debtor, error: dErr } = await supabase.from('debtors').insert({
      full_name: 'QA_TWO_STAGE_TEST',
      branch_id: lawyer.branch_id,
      case_status: 'active',
      case_type: 'civil',
    } as any).select('id').single()
    if (dErr || !debtor) { console.error('فشل إنشاء مدين الاختبار:', dErr?.message); process.exit(1) }
    debtorId = debtor.id

    const FEE = 7000
    const { data: task, error: tErr } = await supabase.from('tasks').insert({
      debtor_id: debtorId,
      branch_id: lawyer.branch_id,
      task_definition_id: defA.id,
      task_type: defA.task_type ?? null,
      task_status: 'submitted',
      assigned_to: lawyer.id,
      reward_amount: FEE,
      created_by: lawyer.id,
    } as any).select('id').single()
    if (tErr || !task) { console.error('فشل إنشاء مهمة الاختبار:', tErr?.message); await cleanup(); process.exit(1) }
    cleanupTaskIds.push(task.id)
    await supabase.from('debtors').update({ current_task_id: task.id } as any).eq('id', debtorId)

    const feeTxCount = async (id: string) => {
      const { count } = await supabase.from('lawyer_wallet_transactions')
        .select('id', { count: 'exact', head: true }).eq('reference_id', id).gt('amount', 0)
      return count ?? 0
    }
    const taskState = async (id: string) => {
      const { data } = await supabase.from('tasks').select('task_status, fee_status').eq('id', id).single()
      return data as { task_status: string; fee_status: string | null }
    }

    console.log('\n[1] اعتماد الإنجاز (المرحلة الأولى)')
    const approve1 = await approveTaskCompletion(supabase, task.id, lawyer.id)
    check('الاعتماد نجح', approve1.ok, approve1.error)
    let st = await taskState(task.id)
    check('task_status = approved', st.task_status === 'approved', st)
    check('fee_status = approved_pending_next', st.fee_status === 'approved_pending_next', st)
    check('لا حركة أتعاب بعد المرحلة الأولى', (await feeTxCount(task.id)) === 0)

    console.log('\n[2] تكرار اعتماد الإنجاز (idempotent)')
    const approve2 = await approveTaskCompletion(supabase, task.id, lawyer.id)
    check('التكرار لا يفشل', approve2.ok, approve2.error)
    check('ما زال بلا حركة مالية', (await feeTxCount(task.id)) === 0)

    console.log('\n[3] فشل إنشاء المهمة التالية → لا آثار مالية')
    const badTransition = await applyTaskTransition(supabase, {
      taskId: task.id, action: 'next',
      nextTaskDefId: '00000000-0000-0000-0000-000000000000',
      userId: lawyer.id,
    })
    check('الفشل مرصود', !badTransition.ok, badTransition)
    st = await taskState(task.id)
    check('تبقى بانتظار المهمة التالية', st.fee_status === 'approved_pending_next', st)
    check('لا أتعاب بعد الفشل', (await feeTxCount(task.id)) === 0)

    console.log('\n[4] إنشاء المهمة التالية بنجاح → اعتماد نهائي وأتعاب مرة واحدة')
    const transition = await applyTaskTransition(supabase, {
      taskId: task.id, action: 'next', nextTaskDefId: defB.id, userId: lawyer.id,
    })
    check('الانتقال نجح', transition.ok, transition.error)
    st = await taskState(task.id)
    check('fee_status = payable', st.fee_status === 'payable', st)
    const txAfter = await feeTxCount(task.id)
    check('حركة أتعاب واحدة على الأقل ولمرة واحدة (محامٍ + مكافأة إن وجدت)', txAfter >= 1, txAfter)
    const { count: lawyerFeeTx } = await supabase.from('lawyer_wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('reference_id', task.id).eq('wallet', 'fees').eq('lawyer_id', lawyer.id).gt('amount', 0)
    check('حركة أتعاب المحامي = 1 بالضبط', (lawyerFeeTx ?? 0) === 1, lawyerFeeTx)
    const { data: debtorAfter } = await supabase.from('debtors')
      .select('current_task_id, last_task_id, lawyer_fees').eq('id', debtorId!).single()
    check('المهمة التالية أُنشئت ورُبطت', !!debtorAfter?.current_task_id && debtorAfter.current_task_id !== task.id, debtorAfter)
    check('أتعاب المحامين في كشف المدين = ' + FEE, Number(debtorAfter?.lawyer_fees ?? 0) === FEE, debtorAfter?.lawyer_fees)

    console.log('\n[5] تكرار الإجراء اللاحق → مرفوض بلا تكرار مالي')
    const dupTransition = await applyTaskTransition(supabase, {
      taskId: task.id, action: 'next', nextTaskDefId: defB.id, userId: lawyer.id,
    })
    check('التكرار مرفوض أو بلا أثر', !dupTransition.ok, dupTransition)
    check('حركة أتعاب المحامي ما زالت 1', (await supabase.from('lawyer_wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('reference_id', task.id).eq('wallet', 'fees').eq('lawyer_id', lawyer.id).gt('amount', 0)).count === 1)
    const { count: nextCount } = await supabase.from('tasks')
      .select('id', { count: 'exact', head: true }).eq('debtor_id', debtorId!).neq('id', task.id)
    check('مهمة تالية واحدة فقط', (nextCount ?? 0) === 1, nextCount)

    console.log('\n[6] finalizeTaskApproval مباشرة بعد الاعتماد النهائي → idempotent')
    const fin = await finalizeTaskApproval(supabase, task.id, lawyer.id)
    check('لا احتساب مكرر', fin.ok && fin.alreadyFinalized === true && fin.feeAmount === 0, fin)
  } finally {
    await cleanup()
    console.log('\nتم تنظيف سجلات الاختبار.')
  }

  if (failures > 0) {
    console.error(`\n${failures} فحص فشل`)
    process.exit(1)
  }
  console.log('\nALL PASS')
}

main().catch(async e => { console.error(e); process.exit(1) })
