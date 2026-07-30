import { createClient } from '@supabase/supabase-js'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BRANCH = '726654de-9037-471a-bb3e-353e8fb5065b'

const { data: sample } = await admin.from('debtors').select('*').eq('branch_id', BRANCH).limit(1)
console.log('debtor columns:', sample?.[0] ? Object.keys(sample[0]).join(',') : 'none')
console.log('sample:', JSON.stringify(sample?.[0] ?? null).slice(0, 2000))

const { data: lists } = await admin.from('branch_lists').select('id, name, court_name, execution_office').eq('branch_id', BRANCH).limit(5)
console.log('branch_lists:', JSON.stringify(lists))

const { data: defs } = await admin.from('task_definitions').select('*').eq('branch_id', BRANCH).order('sort_order').limit(5)
console.log('task_definitions cols:', defs?.[0] ? Object.keys(defs[0]).join(',') : 'none')
console.log('task defs:', JSON.stringify((defs ?? []).map(d => ({ id: d.id, label: d.label, fee: d.fee_amount, hybrid: d.is_hybrid, active: d.is_active }))))

const { data: ss } = await admin.from('special_statuses').select('id, name, color, branch_id, is_active').eq('branch_id', BRANCH).limit(20)
console.log('special_statuses(branch):', JSON.stringify(ss))

const { data: tasksSample } = await admin.from('tasks').select('*').limit(1)
console.log('tasks cols:', tasksSample?.[0] ? Object.keys(tasksSample[0]).join(',') : 'none')

const { data: existingTest } = await admin.from('debtors').select('id, full_name, branch_id, case_type, special_status_id').ilike('full_name', '%[TEST]%').limit(50)
console.log('existing [TEST] debtors:', JSON.stringify(existingTest))
