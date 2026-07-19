import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { validateTaskCompletionFields } from '../lib/task-completion-validation'

function loadEnv() {
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const value = line.trim()
    if (!value || value.startsWith('#')) continue
    const separator = value.indexOf('=')
    if (separator <= 0) continue
    const key = value.slice(0, separator).trim()
    if (!process.env[key]) process.env[key] = value.slice(separator + 1).trim()
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
  console.log(`PASS: ${message}`)
}

async function main() {
  loadEnv()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // تطبيق فرع بابل بصورة idempotent.
  const { data: existingBabil, error: branchReadError } = await supabase
    .from('branches')
    .select('id, name, is_active')
    .ilike('name', 'بابل')
  if (branchReadError) throw branchReadError

  const exactBabil = (existingBabil ?? []).filter(branch => branch.name.trim() === 'بابل')
  assert(exactBabil.length <= 1, 'لا يوجد سجلان باسم بابل')

  let babil = exactBabil[0]
  let branchWasAdded = false
  if (!babil) {
    const { data, error } = await supabase
      .from('branches')
      .insert({ name: 'بابل', city: 'بابل', is_active: true })
      .select('id, name, is_active')
      .single()
    if (error) throw error
    babil = data
    branchWasAdded = true
  } else if (!babil.is_active) {
    const { data, error } = await supabase
      .from('branches')
      .update({ is_active: true })
      .eq('id', babil.id)
      .select('id, name, is_active')
      .single()
    if (error) throw error
    babil = data
  }

  // كتالوج المهام فرعي؛ انسخه إلى بابل كي يعمل توزيع القضايا والمهام فوراً.
  const { data: sourceBranch, error: sourceBranchError } = await supabase
    .from('branches')
    .select('id')
    .eq('name', 'بغداد الكرخ')
    .single()
  if (sourceBranchError) throw sourceBranchError

  const { data: sourceDefinitions, error: sourceDefinitionsError } = await supabase
    .from('task_definitions')
    .select('id, task_type, label, fee_amount, sort_order, is_active, case_type')
    .eq('branch_id', sourceBranch.id)
  if (sourceDefinitionsError) throw sourceDefinitionsError

  for (const sourceDefinition of sourceDefinitions ?? []) {
    let { data: targetDefinition, error: targetReadError } = await supabase
      .from('task_definitions')
      .select('id')
      .eq('branch_id', babil.id)
      .eq('task_type', sourceDefinition.task_type)
      .maybeSingle()
    if (targetReadError) throw targetReadError

    if (!targetDefinition) {
      const { data, error } = await supabase
        .from('task_definitions')
        .insert({
          branch_id: babil.id,
          task_type: sourceDefinition.task_type,
          label: sourceDefinition.label,
          fee_amount: sourceDefinition.fee_amount,
          sort_order: sourceDefinition.sort_order,
          is_active: sourceDefinition.is_active,
          case_type: sourceDefinition.case_type,
        })
        .select('id')
        .single()
      if (error) throw error
      targetDefinition = data
    }

    const [{ data: sourceFields }, { data: targetFields }, { data: sourceExpenses }, { data: targetExpenses }] =
      await Promise.all([
        supabase.from('task_required_fields').select('field_key, field_type, field_label, is_required, sort_order').eq('task_definition_id', sourceDefinition.id),
        supabase.from('task_required_fields').select('field_key').eq('task_definition_id', targetDefinition.id),
        supabase.from('task_definition_expenses').select('name, max_amount, sort_order').eq('task_definition_id', sourceDefinition.id),
        supabase.from('task_definition_expenses').select('name').eq('task_definition_id', targetDefinition.id),
      ])

    const targetFieldKeys = new Set((targetFields ?? []).map(field => field.field_key))
    const missingFields = (sourceFields ?? [])
      .filter(field => !targetFieldKeys.has(field.field_key))
      .map(field => ({ ...field, task_definition_id: targetDefinition!.id }))
    if (missingFields.length) {
      const { error } = await supabase.from('task_required_fields').insert(missingFields)
      if (error) throw error
    }

    const targetExpenseNames = new Set((targetExpenses ?? []).map(expense => expense.name))
    const missingExpenses = (sourceExpenses ?? [])
      .filter(expense => !targetExpenseNames.has(expense.name))
      .map(expense => ({ ...expense, task_definition_id: targetDefinition!.id }))
    if (missingExpenses.length) {
      const { error } = await supabase.from('task_definition_expenses').insert(missingExpenses)
      if (error) throw error
    }
  }

  // تطبيق الحقل الاختياري على التعريفين فقط.
  const { data: definitions, error: definitionsError } = await supabase
    .from('task_definitions')
    .select('id, label, task_type, branch_id, is_active')
    .in('task_type', ['find_address', 'find_missing_address'])
    .eq('is_active', true)
  if (definitionsError) throw definitionsError
  assert((definitions ?? []).some(def => def.task_type === 'find_address'), 'تعريف إيجاد عنوان المدين موجود')
  assert((definitions ?? []).some(def => def.task_type === 'find_missing_address'), 'تعريف إيجاد عنوان المفقود موجود')

  for (const definition of definitions ?? []) {
    const { data: fields, error: fieldsError } = await supabase
      .from('task_required_fields')
      .select('id, field_key, field_type, field_label, is_required, sort_order')
      .eq('task_definition_id', definition.id)
      .order('sort_order')
    if (fieldsError) throw fieldsError

    const existing = (fields ?? []).find(field => field.field_key === 'mukhtar_name')
    if (existing) {
      const { error } = await supabase
        .from('task_required_fields')
        .update({ field_type: 'text', field_label: 'اسم المختار', is_required: false })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const maxOrder = Math.max(0, ...(fields ?? []).map(field => Number(field.sort_order ?? 0)))
      const { error } = await supabase.from('task_required_fields').insert({
        task_definition_id: definition.id,
        field_key: 'mukhtar_name',
        field_type: 'text',
        field_label: 'اسم المختار',
        is_required: false,
        sort_order: maxOrder + 1,
      })
      if (error) throw error
    }
  }

  const testedTypes = new Set<string>()
  for (const definition of definitions ?? []) {
    if (testedTypes.has(definition.task_type)) continue
    testedTypes.add(definition.task_type)

    const { data: fields, error } = await supabase
      .from('task_required_fields')
      .select('field_key, field_type, field_label, is_required')
      .eq('task_definition_id', definition.id)
    if (error) throw error

    const requiredFields = fields ?? []
    const address = requiredFields.find(field =>
      field.field_key.includes('address') && field.field_type !== 'image')
    const image = requiredFields.find(field => field.field_type === 'image')
    const gps = requiredFields.find(field => field.field_type === 'gps')
    const mukhtar = requiredFields.find(field => field.field_key === 'mukhtar_name')

    assert(address?.is_required === true, `${definition.label}: العنوان التفصيلي بقي إلزامياً`)
    assert(image?.is_required === true, `${definition.label}: الصورة بقيت إلزامية`)
    assert(gps?.is_required === true, `${definition.label}: الموقع بقي إلزامياً`)
    assert(
      mukhtar?.field_type === 'text' && mukhtar.is_required === false,
      `${definition.label}: اسم المختار نصي واختياري`,
    )

    const values: Record<string, string> = {}
    const fileKeys = new Set<string>()
    for (const field of requiredFields) {
      if (!field.is_required) continue
      if (['image', 'pdf', 'receipt'].includes(field.field_type)) fileKeys.add(field.field_key)
      else values[field.field_key] = field.field_type === 'gps' ? '32.000000,44.000000' : 'قيمة اختبار'
    }

    assert(
      validateTaskCompletionFields(requiredFields, values, fileKeys) === null,
      `${definition.label}: ينجح بدون اسم المختار`,
    )
    assert(
      validateTaskCompletionFields(
        requiredFields,
        { ...values, mukhtar_name: 'مختار الاختبار' },
        fileKeys,
      ) === null,
      `${definition.label}: ينجح مع اسم المختار`,
    )

    const withoutAddress = { ...values }
    delete withoutAddress[address!.field_key]
    assert(
      validateTaskCompletionFields(requiredFields, withoutAddress, fileKeys) !== null,
      `${definition.label}: يفشل بدون العنوان`,
    )

    const withoutImage = new Set(fileKeys)
    withoutImage.delete(image!.field_key)
    assert(
      validateTaskCompletionFields(requiredFields, values, withoutImage) !== null,
      `${definition.label}: يفشل بدون الصورة`,
    )

    const withoutGps = { ...values }
    delete withoutGps[gps!.field_key]
    assert(
      validateTaskCompletionFields(requiredFields, withoutGps, fileKeys) !== null,
      `${definition.label}: يفشل بدون الموقع`,
    )
  }

  const { data: finalBabil, error: finalBranchError } = await supabase
    .from('branches')
    .select('id, name, is_active')
    .eq('name', 'بابل')
  if (finalBranchError) throw finalBranchError
  assert(finalBabil?.length === 1, 'فرع بابل موجود مرة واحدة فقط')
  assert(finalBabil[0].is_active === true, 'فرع بابل نشط ويظهر في قوائم الفروع')
  const { count: babilDefinitionCount, error: babilDefinitionsError } = await supabase
    .from('task_definitions')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', finalBabil[0].id)
    .eq('is_active', true)
  if (babilDefinitionsError) throw babilDefinitionsError
  assert(
    babilDefinitionCount === (sourceDefinitions ?? []).filter(definition => definition.is_active).length,
    'فرع بابل يحتوي كتالوج المهام الكامل للتوزيع',
  )

  const { data: oldTasks, error: oldTasksError } = await supabase
    .from('tasks')
    .select('id, completion_data')
    .not('completion_data', 'is', null)
    .limit(100)
  if (oldTasksError) throw oldTasksError
  const oldTaskWithoutMukhtar = (oldTasks ?? []).find(task => {
    const completion = task.completion_data as Record<string, unknown> | null
    return completion && !Object.prototype.hasOwnProperty.call(completion, 'mukhtar_name')
  })
  assert(!!oldTaskWithoutMukhtar, 'مهمة قديمة بلا اسم مختار تُقرأ بدون خطأ')

  let testDebtorId: string | null = null
  try {
    const { data: testDebtor, error: testDebtorError } = await supabase
      .from('debtors')
      .insert({
        full_name: 'QA_BABIL_BRANCH_TEST',
        branch_id: finalBabil[0].id,
        case_status: 'active',
        case_type: 'civil',
      })
      .select('id, branch_id')
      .single()
    if (testDebtorError) throw testDebtorError
    testDebtorId = testDebtor.id
    assert(testDebtor.branch_id === finalBabil[0].id, 'يمكن إنشاء مدين واختيار فرع بابل')
  } finally {
    if (testDebtorId) await supabase.from('debtors').delete().eq('id', testDebtorId)
  }

  console.log(`BRANCH_RESULT: ${branchWasAdded ? 'ADDED' : 'ALREADY_EXISTED'}`)
  console.log(`DEFINITIONS_UPDATED: ${definitions?.length ?? 0}`)
  console.log('ALL PASS')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
