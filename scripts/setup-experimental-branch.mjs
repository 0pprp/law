/**
 * تجهيز فرع «تجريبي»: إنشاء الفرع + نسخ تعريفات المهام من فرع مرجعي + ربط يوزرات demo_*
 *
 *   node --env-file=.env.local scripts/setup-experimental-branch.mjs
 *
 * لاحقاً للمسح:
 *   node --env-file=.env.local scripts/purge-experimental-branch.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

const BRANCH_NAME = 'تجريبي'
const SOURCE_BRANCH = 'بغداد الرصافة'
const DEMO_PREFIX = 'demo_'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function ensureBranch() {
  const { data: existing } = await admin
    .from('branches')
    .select('id, name, is_active')
    .eq('name', BRANCH_NAME)
    .maybeSingle()

  if (existing) {
    if (!existing.is_active) {
      await admin.from('branches').update({ is_active: true }).eq('id', existing.id)
    }
    console.log(`branch exists: ${existing.id}`)
    return existing.id
  }

  const { data, error } = await admin
    .from('branches')
    .insert({ name: BRANCH_NAME, is_active: true })
    .select('id, name')
    .single()
  if (error) throw new Error(`create branch: ${error.message}`)
  console.log(`branch created: ${data.id}`)
  return data.id
}

async function cloneTaskDefinitions(sourceBranchId, targetBranchId) {
  const { count } = await admin
    .from('task_definitions')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', targetBranchId)
  if ((count ?? 0) > 0) {
    console.log(`task_definitions already present: ${count}`)
    return
  }

  const { data: defs, error } = await admin
    .from('task_definitions')
    .select(
      'task_type, label, fee_amount, sort_order, is_active, case_type, allows_expenses, is_hybrid, task_required_fields(field_key, field_type, field_label, is_required, sort_order), task_definition_expenses(name, max_amount, sort_order)',
    )
    .eq('branch_id', sourceBranchId)
    .eq('is_active', true)
  if (error) throw new Error(`load source defs: ${error.message}`)

  let created = 0
  for (const def of defs ?? []) {
    const {
      task_required_fields: fields,
      task_definition_expenses: expenses,
      ...row
    } = def
    const { data: inserted, error: insErr } = await admin
      .from('task_definitions')
      .insert({ ...row, branch_id: targetBranchId })
      .select('id')
      .single()
    if (insErr) {
      console.warn(`  skip ${row.label}: ${insErr.message}`)
      continue
    }
    if (fields?.length) {
      await admin.from('task_required_fields').insert(
        fields.map(f => ({ ...f, task_definition_id: inserted.id })),
      )
    }
    if (expenses?.length) {
      await admin.from('task_definition_expenses').insert(
        expenses.map(e => ({ ...e, task_definition_id: inserted.id })),
      )
    }
    created++
  }
  console.log(`cloned task_definitions: ${created}`)
}

async function attachDemoUsers(branchId) {
  const { data: users, error } = await admin
    .from('profiles')
    .select('id, username, role')
    .ilike('username', `${DEMO_PREFIX}%`)
  if (error) throw new Error(error.message)

  if (!users?.length) {
    console.warn('no demo_* users — run scripts/seed-demo-all-roles.mjs first')
    return
  }

  for (const u of users) {
    const { error: updErr } = await admin
      .from('profiles')
      .update({ branch_id: branchId, governorate: BRANCH_NAME, is_active: true })
      .eq('id', u.id)
    if (updErr) {
      console.warn(`  ${u.username}: ${updErr.message}`)
      continue
    }
    if (u.role === 'chief_accountant') {
      await admin.from('chief_accountant_branches').delete().eq('profile_id', u.id)
      await admin.from('chief_accountant_branches').insert({
        profile_id: u.id,
        branch_id: branchId,
      })
    }
    console.log(`  linked ${u.username} (${u.role})`)
  }
}

const { data: source } = await admin
  .from('branches')
  .select('id, name')
  .eq('name', SOURCE_BRANCH)
  .maybeSingle()
if (!source) throw new Error(`source branch missing: ${SOURCE_BRANCH}`)

const branchId = await ensureBranch()
await cloneTaskDefinitions(source.id, branchId)
console.log('\nAttaching demo users...')
await attachDemoUsers(branchId)
console.log(`\nDone. Branch «${BRANCH_NAME}» ready (${branchId})`)
