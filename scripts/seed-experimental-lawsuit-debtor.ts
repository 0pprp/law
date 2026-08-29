/**
 * إنشاء مدين تجريبي في فرع «تجريبي» بمهمة إقامة دعوى وكل الحقول مملوءة.
 *
 * Usage: npx tsx --env-file=.env.local scripts/seed-experimental-lawsuit-debtor.ts
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { EXPERIMENTAL_BRANCH_NAME } from '../lib/branch-constants'
import { computeDebtorRequiredAmount, computeRemainingFromRequired } from '../lib/debtor-balances'
import { syncHearingDateInCompletion } from '../lib/hearing-date-from-completion'

function loadEnv() {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  let raw = readFileSync(path, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

function ymdPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function dummyForField(fieldType: string, fieldKey: string, courtName: string): string | null {
  const type = (fieldType || '').toLowerCase()
  const key = (fieldKey || '').toLowerCase()
  if (['image', 'pdf', 'receipt'].includes(type)) return null
  if (type === 'gps' || key.includes('gps')) return '33.315241, 44.366241'
  if (type === 'date' || key.includes('date') || key.includes('hearing')) return ymdPlus(21)
  if (type === 'court_name' || key === 'court_name' || key.includes('court')) return courtName
  if (type === 'case_number' || key.includes('case_number')) return '2026/تجريبي/101'
  if (type === 'decision_number' || key.includes('decision')) return 'ق-تجريبي-77'
  if (type === 'number') return '101'
  if (type === 'legal_result' || key.includes('legal_result')) return 'أُقيمت الدعوى وأُبلغت جلسة المرافعة الأولى'
  if (type === 'court_decision') return 'قُبلت العريضة وحددت جلسة'
  if (type === 'team' || key.includes('team')) return 'فريق الفرع التجريبي'
  if (type === 'note' || type === 'text' || key.includes('note')) {
    return 'ملاحظة تجريبية افتراضية لمهمة إقامة الدعوى'
  }
  return 'قيمة تجريبية افتراضية'
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY مفقودة')

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: branch, error: bErr } = await supabase
    .from('branches')
    .select('id, name')
    .eq('name', EXPERIMENTAL_BRANCH_NAME)
    .eq('is_active', true)
    .maybeSingle()
  if (bErr) throw new Error(bErr.message)
  if (!branch) throw new Error(`فرع «${EXPERIMENTAL_BRANCH_NAME}» غير موجود أو غير نشط`)

  const { data: lawsuitDef, error: dErr } = await supabase
    .from('task_definitions')
    .select('id, label, fee_amount, task_type, case_type')
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .or('task_type.eq.file_lawsuit,label.ilike.%إقامة دعوى%')
    .order('sort_order')
    .limit(1)
    .maybeSingle()
  if (dErr) throw new Error(dErr.message)
  if (!lawsuitDef) throw new Error('لا يوجد تعريف مهمة إقامة دعوى في الفرع التجريبي')

  const { data: fields } = await supabase
    .from('task_required_fields')
    .select('field_key, field_type, field_label, is_required, sort_order')
    .eq('task_definition_id', lawsuitDef.id)
    .order('sort_order')

  const { data: lists } = await supabase
    .from('branch_lists')
    .select('id, name, court_name')
    .eq('branch_id', branch.id)
    .order('name')
    .limit(1)

  const list = lists?.[0] ?? null
  const { data: court } = await supabase
    .from('courts')
    .select('name')
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .order('name')
    .limit(1)
    .maybeSingle()

  const courtName = (court?.name || list?.court_name || 'محكمة البداءة — تجريبي').trim()

  const { data: actor } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['admin', 'employee', 'chief_accountant'])
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (!actor) throw new Error('لا يوجد مستخدم إداري لإنشاء السجل')

  const { data: lawyer } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'lawyer')
    .eq('is_active', true)
    .eq('branch_id', branch.id)
    .limit(1)
    .maybeSingle()

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 12)
  const receiptNumber = `DEMO-EXP-${stamp}`
  const receiptAmount = 6_000_000
  const remainingInput = 5_000_000
  const penalty = 250_000
  const required = computeDebtorRequiredAmount(remainingInput, 0, penalty, receiptAmount)
  const remaining = computeRemainingFromRequired(required, 0)
  const today = new Date().toISOString().slice(0, 10)
  const hearingDate = ymdPlus(21)

  const debtorRow = {
    full_name: 'مدين تجريبي — إقامة دعوى',
    phone: '07701234567',
    id_number: 'A123456789',
    address: 'حي الجامعة، شارع 14 رمضان، دار 12 — فرع تجريبي',
    employer: 'شركة تجريبية للتجارة العامة',
    governorate: branch.name,
    export_date: today,
    receipt_type: 'check',
    receipt_number: receiptNumber,
    receipt_amount: receiptAmount,
    remaining_amount: remaining,
    required_amount: required,
    lawyer_fees: 0,
    penalty_amount: penalty,
    receipt_signed_legal_costs: true,
    notes: 'سجل تجريبي افتراضي — أُنشئ لاختبار مهمة إقامة الدعوى في الفرع التجريبي.',
    assignment_note: 'مدين تجريبي لاختبار إقامة الدعوى',
    created_by: actor.id,
    branch_id: branch.id,
    branch_list_id: list?.id ?? null,
    case_type: lawsuitDef.case_type === 'criminal' ? 'criminal' : 'civil',
    case_status: 'active',
    court_name: courtName,
    latitude: 33.315241,
    longitude: 44.366241,
    location_captured_at: new Date().toISOString(),
  }

  const { data: debtor, error: insErr } = await supabase
    .from('debtors')
    .insert(debtorRow as any)
    .select('id, full_name, receipt_number')
    .single()
  if (insErr || !debtor) throw new Error(insErr?.message ?? 'فشل إنشاء المدين')

  await supabase.from('debtor_notes').insert({
    debtor_id: debtor.id,
    user_id: actor.id,
    message: 'ملاحظة افتراضية: ملف تجريبي كامل الحقول لاختبار إقامة الدعوى.',
  })

  const completion: Record<string, unknown> = {
    hearing_date: hearingDate,
    date: hearingDate,
    court_name: courtName,
    case_number: '2026/تجريبي/101',
    note: 'أُقيمت الدعوى تجريبياً — بيانات افتراضية.',
    legal_result: 'أُقيمت الدعوى وأُبلغت جلسة المرافعة الأولى',
    gps: '33.315241, 44.366241',
  }
  for (const f of fields ?? []) {
    const val = dummyForField(String(f.field_type ?? ''), String(f.field_key ?? ''), courtName)
    if (val != null && f.field_key && completion[f.field_key] == null) {
      completion[f.field_key] = val
    }
  }
  const completionData = syncHearingDateInCompletion(completion, hearingDate)

  const { data: task, error: tErr } = await supabase
    .from('tasks')
    .insert({
      debtor_id: debtor.id,
      task_definition_id: lawsuitDef.id,
      task_type: lawsuitDef.task_type || 'file_lawsuit',
      task_status: 'waiting_assignment',
      reward_amount: Number(lawsuitDef.fee_amount ?? 0),
      created_by: actor.id,
      branch_id: branch.id,
      court_name: courtName,
      due_date: hearingDate,
      admin_notes: 'مهمة تجريبية — إقامة دعوى مع حقول افتراضية',
      lawyer_notes: 'ملاحظة محامي افتراضية للاختبار',
      legal_result: 'أُقيمت الدعوى وأُبلغت جلسة المرافعة الأولى',
      completion_data: completionData,
      governorate: branch.name,
      priority: 'normal',
    } as any)
    .select('id')
    .single()

  if (tErr || !task) {
    await supabase.from('debtors').delete().eq('id', debtor.id)
    throw new Error(tErr?.message ?? 'فشل إنشاء المهمة')
  }

  const { error: linkErr } = await supabase
    .from('debtors')
    .update({ current_task_id: task.id } as any)
    .eq('id', debtor.id)
  if (linkErr) {
    await supabase.from('tasks').delete().eq('id', task.id)
    await supabase.from('debtors').delete().eq('id', debtor.id)
    throw new Error(linkErr.message)
  }

  console.log('تم إنشاء المدين التجريبي:')
  console.log('  الفرع:', branch.name, branch.id)
  console.log('  المدين:', debtor.full_name, debtor.id)
  console.log('  رقم الوصل:', debtor.receipt_number)
  console.log('  المهمة:', lawsuitDef.label, task.id)
  console.log('  المحكمة:', courtName)
  console.log('  تاريخ الجلسة:', hearingDate)
  if (list) console.log('  القائمة:', list.name)
  if (lawyer) console.log('  محامي الفرع (غير مكلّف بعد):', lawyer.full_name)
  console.log(`  الملف: /admin/debtors/${debtor.id}/profile`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
