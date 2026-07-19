/**
 * اختبار طلب عدم الالتزام على المدين الحقيقي:
 * حسن عبدالوهاب حسن (جاري التسديد — فرع الناصرية)
 *
 * لا يحذف المدين. ينظّف فقط طلبات الاختبار إن وُجدت.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  const path = resolve(root, '.env.local')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
}

const env = { ...loadEnv(), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('FAIL: missing Supabase env')
  process.exit(1)
}

const admin = createClient(url, key)
let passed = 0
let failed = 0

function ok(msg) { passed++; console.log('OK ', msg) }
function fail(msg) { failed++; console.log('FAIL', msg) }

async function tableReady() {
  const { error } = await admin.from('payment_noncompliance_requests').select('id').limit(1)
  return !error
}

async function main() {
  console.log('=== QA payment noncompliance — حسن عبدالوهاب حسن ===\n')

  if (!(await tableReady())) {
    fail('جدول payment_noncompliance_requests غير موجود')
    console.log('\nشغّل في Supabase SQL Editor:')
    console.log('  supabase/scripts/apply-payment-noncompliance-requests.sql')
    process.exit(1)
  }
  ok('الجدول موجود')

  const { data: debtor, error: dErr } = await admin
    .from('debtors')
    .select('id, full_name, case_status, branch_id, last_task_id, current_task_id, payment_type, payment_location')
    .ilike('full_name', '%حسن عبدالوهاب حسن%')
    .eq('case_status', 'payment_in_progress')
    .maybeSingle()

  if (dErr || !debtor) {
    // جرّب بدون فلتر الحالة
    const { data: anyHassan } = await admin
      .from('debtors')
      .select('id, full_name, case_status, branch_id, last_task_id, current_task_id')
      .ilike('full_name', '%حسن عبدالوهاب حسن%')
      .limit(3)
    fail(`لم يُعثر على حسن في جاري التسديد. الموجود: ${JSON.stringify(anyHassan)}`)
    process.exit(1)
  }
  ok(`وجد المدين: ${debtor.full_name} (${debtor.id})`)
  console.log('   case_status=', debtor.case_status, 'last_task_id=', debtor.last_task_id)

  const { data: fu } = await admin.from('profiles').select('id, full_name').eq('role', 'payment_follow_up').limit(1).maybeSingle()
  const { data: adm } = await admin.from('profiles').select('id, full_name').eq('role', 'admin').limit(1).maybeSingle()
  if (!fu || !adm) {
    fail('لا يوجد مستخدم payment_follow_up أو admin')
    process.exit(1)
  }
  ok(`مستخدم المتابعة: ${fu.full_name} · المدير: ${adm.full_name}`)

  // نظّف أي طلب معلّق سابق لهذا المدين (اختبار)
  await admin.from('payment_noncompliance_requests').delete().eq('debtor_id', debtor.id).eq('status', 'pending')

  // 1) إنشاء طلب
  const { data: req, error: insErr } = await admin
    .from('payment_noncompliance_requests')
    .insert({
      debtor_id: debtor.id,
      branch_id: debtor.branch_id,
      source_task_id: debtor.last_task_id,
      requested_by: fu.id,
      note: 'اختبار QA — عدم التزام',
      status: 'pending',
    })
    .select('id, status')
    .single()

  if (insErr || !req) {
    fail(`إنشاء الطلب: ${insErr?.message}`)
    process.exit(1)
  }
  ok(`أُنشئ طلب pending: ${req.id}`)

  // 2) المدين ما زال في جاري التسديد
  const { data: still } = await admin.from('debtors').select('case_status').eq('id', debtor.id).single()
  if (still?.case_status === 'payment_in_progress') ok('المدين بقي في جاري التسديد بعد إرسال الطلب')
  else fail(`حالة المدين تغيّرت إلى ${still?.case_status}`)

  // 3) منع طلب pending ثانٍ
  const { error: dupErr } = await admin
    .from('payment_noncompliance_requests')
    .insert({
      debtor_id: debtor.id,
      branch_id: debtor.branch_id,
      source_task_id: debtor.last_task_id,
      requested_by: fu.id,
      note: 'مكرر',
      status: 'pending',
    })
  if (dupErr?.code === '23505') ok('منع طلب pending مكرر (unique index)')
  else fail(`توقّعنا unique violation، حصل: ${dupErr?.message ?? 'نجاح خاطئ'}`)

  // 4) رفض أولاً (يبقى في جاري التسديد) ثم طلب جديد ثم موافقة
  const { data: rej } = await admin.rpc('reject_payment_noncompliance_request', {
    p_request_id: req.id,
    p_reviewer_id: adm.id,
    p_rejection_reason: 'اختبار رفض',
  })
  if (rej?.ok) ok('الرفض نجح')
  else fail(`الرفض: ${JSON.stringify(rej)}`)

  const { data: afterRej } = await admin.from('debtors').select('case_status').eq('id', debtor.id).single()
  if (afterRej?.case_status === 'payment_in_progress') ok('بعد الرفض: المدين ما زال في جاري التسديد')
  else fail(`بعد الرفض الحالة: ${afterRej?.case_status}`)

  // طلب جديد بعد الرفض
  const { data: req2, error: ins2 } = await admin
    .from('payment_noncompliance_requests')
    .insert({
      debtor_id: debtor.id,
      branch_id: debtor.branch_id,
      source_task_id: debtor.last_task_id,
      requested_by: fu.id,
      note: 'اختبار QA — موافقة',
      status: 'pending',
    })
    .select('id')
    .single()
  if (ins2 || !req2) {
    fail(`طلب بعد الرفض: ${ins2?.message}`)
  } else {
    ok('بعد الرفض يمكن إرسال طلب جديد')
  }

  if (!req2) {
    console.log(`\n=== النتيجة: ${passed} نجح / ${failed} فشل ===`)
    process.exit(failed ? 1 : 0)
  }

  if (!debtor.last_task_id) {
    fail('لا يوجد last_task_id — الموافقة ستفشل كما هو متوقع')
    const { data: noTask } = await admin.rpc('approve_payment_noncompliance_request', {
      p_request_id: req2.id,
      p_reviewer_id: adm.id,
    })
    if (!noTask?.ok && noTask?.code === 'no_last_task') ok('حالة لا مهمة سابقة: رسالة صحيحة')
    else fail(`توقّعنا no_last_task: ${JSON.stringify(noTask)}`)
  } else {
    const { data: srcTask } = await admin
      .from('tasks')
      .select('id, assigned_to, task_status, task_definition_id')
      .eq('id', debtor.last_task_id)
      .maybeSingle()
    if (!srcTask) fail('المهمة السابقة غير موجودة في tasks')
    else ok(`المهمة السابقة موجودة: ${srcTask.id}`)

    const { data: appr } = await admin.rpc('approve_payment_noncompliance_request', {
      p_request_id: req2.id,
      p_reviewer_id: adm.id,
    })
    if (appr?.ok && appr.new_task_id) ok(`الموافقة نجحت — مهمة جديدة: ${appr.new_task_id}`)
    else fail(`الموافقة: ${JSON.stringify(appr)}`)

    if (appr?.ok && appr.new_task_id) {
      const { data: d2 } = await admin
        .from('debtors')
        .select('case_status, current_task_id, payment_type, payment_location')
        .eq('id', debtor.id)
        .single()
      if (d2?.case_status === 'active') ok('المدين خرج من جاري التسديد (active)')
      else fail(`حالة بعد الموافقة: ${d2?.case_status}`)
      if (d2?.current_task_id === appr.new_task_id) ok('current_task_id يشير للمهمة الجديدة')
      else fail('current_task_id لا يطابق المهمة الجديدة')
      if (!d2?.payment_type && !d2?.payment_location) ok('فُرغت payment_type/location')
      else fail('حقول التسديد لم تُفرَّغ')

      const { data: nt } = await admin
        .from('tasks')
        .select('id, assigned_to, task_status')
        .eq('id', appr.new_task_id)
        .single()
      if (nt?.assigned_to == null) ok('المهمة الجديدة بدون assigned_to (غير مكلفة)')
      else fail(`assigned_to = ${nt?.assigned_to}`)
      if (nt?.task_status === 'waiting_assignment') ok('task_status = waiting_assignment')
      else fail(`task_status = ${nt?.task_status}`)

      // موافقة مزدوجة
      const { data: appr2 } = await admin.rpc('approve_payment_noncompliance_request', {
        p_request_id: req2.id,
        p_reviewer_id: adm.id,
      })
      if (!appr2?.ok && appr2?.code === 'already_processed') ok('الموافقة الثانية: تمت المعالجة مسبقاً')
      else fail(`توقّعنا already_processed: ${JSON.stringify(appr2)}`)
    }
  }

  console.log(`\n=== النتيجة: ${passed} نجح / ${failed} فشل ===`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
