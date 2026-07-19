/**
 * ترحيل المدينين من المهام القديمة ثم حذف تعريفاتها نهائياً.
 *
 * الخريطة:
 *   قيد الدعوى (ناصرية)  ==> إيجاد عنوان المدين والإنذار (نفس الفرع)
 *   ابطال                ==> جاري التسديد (case_status = payment_in_progress)
 *   جاري التنفيذ          ==> تحت إسناد مهمة (بلا مهمة حالية)
 *   اخر تسديد            ==> لا مدينين مرتبطين — حذف التعريفات فقط
 *   محسومة/قيد التنفيذ/قرار حكم ==> تحت إسناد مهمة (بلا مهمة حالية)
 *
 * التشغيل: node scripts/remove-legacy-tasks.mjs
 * يتطلب .env.local فيه NEXT_PUBLIC_SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const fail = (msg) => { console.error('ERROR:', msg); process.exit(1) }

// مدينو «جاري التنفيذ» الذين نُقلوا في تشغيل سابق قبل تصحيح الخريطة.
const PREVIOUSLY_MOVED_EXEC_DEBTOR_IDS = [
  'b3f8b059-5e03-4d1b-841a-7130629f2a6e',
  '10ca4ac0-7102-4099-a2b1-a2f0b815316f',
  'd19c61c1-c94c-4c0b-ab20-ff01357d558b',
]

async function main() {
  const { count: debtorsBefore } = await supabase.from('debtors').select('id', { count: 'exact', head: true })
  console.log('عدد المدينين قبل الترحيل:', debtorsBefore)

  // 1) تحديد التعريفات القديمة
  const { data: allDefs, error: defsErr } = await supabase
    .from('task_definitions')
    .select('id, label, task_type, branch_id, fee_amount')
    .in('label', ['قيد الدعوى', 'ابطال', 'جاري التنفيذ', 'اخر تسديد', 'محسومة', 'قيد التنفيذ', 'قرار حكم'])
  if (defsErr) fail(defsErr.message)

  const lawsuitDefs = allDefs.filter(d => d.label === 'قيد الدعوى' && d.task_type == null)
  const heroesDefs = allDefs.filter(d => d.label === 'ابطال')
  const execDefs = allDefs.filter(d => d.label === 'جاري التنفيذ')
  const lastPayDefs = allDefs.filter(d => d.label === 'اخر تسديد' && String(d.task_type) === 'last_payment')
  const unassignedDefs = allDefs.filter(d => ['محسومة', 'قيد التنفيذ', 'قرار حكم'].includes(d.label))

  const oldDefIds = [...lawsuitDefs, ...heroesDefs, ...execDefs, ...lastPayDefs, ...unassignedDefs].map(d => d.id)
  console.log(`تعريفات قديمة: قيد الدعوى=${lawsuitDefs.length} ابطال=${heroesDefs.length} جاري التنفيذ=${execDefs.length} اخر تسديد=${lastPayDefs.length} إضافية=${unassignedDefs.length}`)

  let movedToFindAddress = 0
  let movedToPaymentInProgress = 0
  let movedToAwaitingAssignment = 0

  // 2) قيد الدعوى ==> إيجاد عنوان (تعديل المهمة الحالية نفسها كما يفعل change-debtor-task)
  for (const oldDef of lawsuitDefs) {
    const { data: target, error: tErr } = await supabase
      .from('task_definitions')
      .select('id, label, task_type, fee_amount')
      .eq('branch_id', oldDef.branch_id)
      .eq('task_type', 'find_address')
      .eq('is_active', true)
      .maybeSingle()
    if (tErr || !target) fail(`لا يوجد تعريف "إيجاد عنوان" في فرع ${oldDef.branch_id}`)

    const { data: tasks } = await supabase
      .from('tasks').select('id, debtor_id').eq('task_definition_id', oldDef.id)

    for (const task of tasks ?? []) {
      const { error } = await supabase.from('tasks').update({
        task_definition_id: target.id,
        task_type: target.task_type,
        reward_amount: Number(target.fee_amount) || 0,
        assigned_to: null,
        task_status: 'waiting_assignment',
        due_date: null,
      }).eq('id', task.id)
      if (error) fail(`فشل تحويل مهمة ${task.id}: ${error.message}`)
      movedToFindAddress++
    }
  }

  // 3) ابطال ==> جاري التسديد
  const pipDefIds = heroesDefs.map(d => d.id)
  if (pipDefIds.length) {
    const { data: tasks } = await supabase
      .from('tasks').select('id, debtor_id').in('task_definition_id', pipDefIds)

    for (const task of tasks ?? []) {
      const { data: debtor } = await supabase
        .from('debtors')
        .select('id, full_name, case_status, current_task_id')
        .eq('id', task.debtor_id)
        .maybeSingle()

      if (debtor && debtor.current_task_id === task.id) {
        const { error } = await supabase.from('debtors').update({
          case_status: 'payment_in_progress',
          current_task_id: null,
          last_task_id: task.id,
        }).eq('id', debtor.id)
        if (error) fail(`فشل تحويل المدين ${debtor.full_name}: ${error.message}`)
        movedToPaymentInProgress++
      }

      // فك ارتباط المهمة القديمة بالتعريف (يبقى السجل التاريخي)
      const { error: unlinkErr } = await supabase
        .from('tasks').update({ task_definition_id: null }).eq('id', task.id)
      if (unlinkErr) fail(`فشل فك ارتباط المهمة ${task.id}: ${unlinkErr.message}`)
    }
  }

  // 4) جاري التنفيذ + التعريفات الإضافية ==> تحت إسناد مهمة
  const awaitingDefIds = [...execDefs, ...unassignedDefs].map(d => d.id)
  if (awaitingDefIds.length) {
    const { data: tasks } = await supabase
      .from('tasks').select('id, debtor_id').in('task_definition_id', awaitingDefIds)

    for (const task of tasks ?? []) {
      const { data: debtor } = await supabase
        .from('debtors')
        .select('id, full_name, current_task_id')
        .eq('id', task.debtor_id)
        .maybeSingle()

      if (debtor?.current_task_id === task.id) {
        const { error } = await supabase.from('debtors').update({
          case_status: 'active',
          current_task_id: null,
          payment_type: null,
          payment_location: null,
        }).eq('id', debtor.id)
        if (error) fail(`فشل نقل المدين ${debtor.full_name} إلى تحت إسناد مهمة: ${error.message}`)
        movedToAwaitingAssignment++
      }

      // نبقي سجل المهمة التاريخي ونفك اعتماده على التعريف المحذوف.
      const { error: unlinkErr } = await supabase
        .from('tasks').update({ task_definition_id: null }).eq('id', task.id)
      if (unlinkErr) fail(`فشل فك ارتباط المهمة ${task.id}: ${unlinkErr.message}`)
    }
  }

  // تصحيح المدينين الثلاثة الذين سبق نقلهم خطأً من «جاري التنفيذ» إلى جاري التسديد.
  for (const debtorId of PREVIOUSLY_MOVED_EXEC_DEBTOR_IDS) {
    const { data: debtor } = await supabase
      .from('debtors').select('id, case_status, current_task_id').eq('id', debtorId).maybeSingle()
    if (!debtor) continue
    if (debtor.case_status !== 'active' || debtor.current_task_id !== null) {
      const { error } = await supabase.from('debtors').update({
        case_status: 'active',
        current_task_id: null,
        payment_type: null,
        payment_location: null,
      }).eq('id', debtor.id)
      if (error) fail(`فشل إعادة المدين ${debtor.id} إلى تحت إسناد مهمة: ${error.message}`)
      movedToAwaitingAssignment++
    }
  }

  // 5) تحقق: لا مهمة مرتبطة بالتعريفات القديمة
  if (oldDefIds.length) {
    const { count: remainingTasks } = await supabase
      .from('tasks').select('id', { count: 'exact', head: true }).in('task_definition_id', oldDefIds)
    if (remainingTasks) fail(`ما زالت ${remainingTasks} مهمة مرتبطة بالتعريفات القديمة — أوقفت الحذف`)
  }

  // 6) حذف الحقول المطلوبة ثم التعريفات نهائياً (نفس نمط merge-legacy-branches)
  if (oldDefIds.length) {
    const { error: rfErr } = await supabase
      .from('task_required_fields').delete().in('task_definition_id', oldDefIds)
    if (rfErr) fail(`فشل حذف الحقول المطلوبة: ${rfErr.message}`)
    const { error: exErr } = await supabase
      .from('task_definition_expenses').delete().in('task_definition_id', oldDefIds)
    if (exErr) fail(`فشل حذف مصاريف التعريفات: ${exErr.message}`)

    const { error: delErr } = await supabase.from('task_definitions').delete().in('id', oldDefIds)
    if (delErr) fail(`فشل حذف التعريفات: ${delErr.message}`)
  }

  // 7) تحقق نهائي
  const defsLeft = oldDefIds.length
    ? (await supabase.from('task_definitions').select('id', { count: 'exact', head: true }).in('id', oldDefIds)).count
    : 0
  const { count: debtorsAfter } = await supabase.from('debtors').select('id', { count: 'exact', head: true })

  console.log('---------- النتيجة ----------')
  console.log('محوّلون إلى إيجاد عنوان:', movedToFindAddress)
  console.log('محوّلون إلى جاري التسديد:', movedToPaymentInProgress)
  console.log('محوّلون إلى تحت إسناد مهمة:', movedToAwaitingAssignment)
  console.log('تعريفات قديمة متبقية:', defsLeft ?? 0)
  console.log('عدد المدينين بعد الترحيل:', debtorsAfter, debtorsAfter === debtorsBefore ? '(لم يُفقد أحد)' : '!!! اختلاف بالعدد')
}

main().catch(e => fail(e.message))
