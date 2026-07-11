/**
 * Najaf permission QA cycle. No production data is touched.
 * Run: node --env-file=.env.local scripts/qa-najaf-cycle.mjs [--cleanup]
 *      node --env-file=.env.local scripts/qa-najaf-cycle.mjs --cleanup-only
 */
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'
import { writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.QA_BASE_URL ?? process.env.BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.QA_PASSWORD ?? 'QaTest12'
const BRANCH_ID = '8fa487e8-f974-419e-9e74-87d333196abc'
const BRANCH_NAME = 'النجف الأشرف'
const FEE = 10_000
const SAVINGS_TARGET = 500_000
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !serviceKey || !anonKey) throw new Error('Missing Supabase URL, service key, or anon key')

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const USERS = {
  admin: { username: 'qa_njf_admin', role: 'admin', full_name: 'مدير تجريبي نجف' },
  acct: { username: 'qa_njf_acct', role: 'accountant', accountant_type: 'branch', full_name: 'محاسب تجريبي نجف' },
  lawyer: { username: 'qa_njf_lawyer', role: 'lawyer', lawyer_type: 'normal', full_name: 'محامي تجريبي نجف' },
  delegate: { username: 'qa_njf_delegate', role: 'delegate', full_name: 'مندوب تجريبي نجف' },
}
const report = { startedAt: new Date().toISOString(), branch: { id: BRANCH_ID, name: BRANCH_NAME }, pass: true, phases: {}, errors: [], data: {} }
const ctx = {}
let browser

function phase(name) {
  return report.phases[name] ||= { status: 'pending', checks: [], errors: [] }
}
function ok(name, message, data) {
  phase(name).checks.push({ pass: true, message, ...(data ? { data } : {}) })
  console.log(`[PASS] ${name}: ${message}`)
}
function fail(name, message, data) {
  phase(name).status = 'fail'
  phase(name).errors.push({ message, ...(data ? { data } : {}) })
  report.errors.push(`${name}: ${message}`)
  report.pass = false
  console.error(`[FAIL] ${name}: ${message}`)
}
function finish(name, data) {
  if (phase(name).status !== 'fail') phase(name).status = 'pass'
  if (data) phase(name).data = data
}
function dateAfter(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function email(username) { return `${username}@internal.qalat.local` }

async function ensureUser(spec) {
  const { data: existing } = await admin.from('profiles').select('id').eq('username', spec.username).maybeSingle()
  let id = existing?.id
  if (!id) {
    const { data: auth, error } = await admin.auth.admin.createUser({
      email: email(spec.username), password: PASSWORD, email_confirm: true,
      user_metadata: { full_name: spec.full_name, role: spec.role },
    })
    if (error || !auth.user) throw new Error(`create ${spec.username}: ${error?.message}`)
    id = auth.user.id
  } else {
    const { error } = await admin.auth.admin.updateUserById(id, { password: PASSWORD, user_metadata: { full_name: spec.full_name, role: spec.role } })
    if (error) throw error
  }
  const { error: profileError } = await admin.from('profiles').upsert({
    id, username: spec.username, full_name: spec.full_name, phone: '07700000001', role: spec.role,
    is_active: true, governorate: BRANCH_NAME, branch_id: BRANCH_ID,
    lawyer_type: spec.lawyer_type ?? 'normal', accountant_type: spec.accountant_type ?? 'branch',
    identity_number: spec.role === 'lawyer' ? '12345678901' : null,
    identity_category: spec.role === 'lawyer' ? 'هوية وطنية' : null,
  })
  if (profileError) throw new Error(`profile ${spec.username}: ${profileError.message}`)
  if (spec.role === 'delegate') {
    const { error } = await admin.from('delegate_wallets').upsert({ delegate_id: id }, { onConflict: 'delegate_id', ignoreDuplicates: true })
    if (error) throw error
  }
  return id
}

async function savings(id) {
  const { data, error } = await admin.from('lawyer_wallet_transactions').select('amount, wallet, type').eq('lawyer_id', id)
  if (error) throw error
  const debit = new Set(['accountant_transfer', 'transfer_from_savings', 'savings_withdrawal', 'task_expense_deduction', 'lawyer_expense_wallet_deduction'])
  return (data ?? []).reduce((sum, row) => sum + ((row.wallet === 'savings' || (!row.wallet && debit.has(row.type))) ? Number(row.amount) : 0), 0)
}
async function seed() {
  const name = 'seed'
  const { data: branch } = await admin.from('branches').select('id, name').eq('id', BRANCH_ID).maybeSingle()
  if (!branch || branch.name !== BRANCH_NAME) throw new Error('Najaf branch id/name validation failed')
  for (const [key, spec] of Object.entries(USERS)) ctx[key] = { ...spec, id: await ensureUser(spec) }
  const current = await savings(ctx.lawyer.id)
  if (current < SAVINGS_TARGET) {
    const { error } = await admin.from('lawyer_wallet_transactions').insert({
      lawyer_id: ctx.lawyer.id, type: 'accountant_transfer', wallet: 'savings', amount: SAVINGS_TARGET - current,
      notes: 'QA Najaf seed savings', created_by: ctx.admin.id,
    })
    if (error) throw error
  }
  const after = await savings(ctx.lawyer.id)
  if (after >= SAVINGS_TARGET) ok(name, `created QA users on ${BRANCH_NAME}; lawyer savings=${after}`)
  else fail(name, `lawyer savings is ${after}, expected at least ${SAVINGS_TARGET}`)
  const { data: defs, error } = await admin.from('task_definitions').select('id, label, task_type, fee_amount').eq('branch_id', BRANCH_ID)
  if (error) throw error
  ctx.findDef = defs?.find(d => d.label === 'إيجاد عنوان المدين والإنذار')
  ctx.lawsuitDef = defs?.find(d => d.label === 'إقامة دعوى')
  if (!ctx.findDef || !ctx.lawsuitDef) fail(name, 'Missing required Najaf task definitions', { defs })
  else ok(name, 'resolved full Najaf task definition IDs', { find: ctx.findDef.id, lawsuit: ctx.lawsuitDef.id })
  finish(name)
}

async function session(username) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email: email(username), password: PASSWORD })
  if (error || !data.session) throw new Error(`signIn ${username}: ${error?.message ?? 'no session'}`)
  return client
}
async function initBrowser() {
  try {
    const { chromium } = require('playwright')
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
    report.browserAuth = 'playwright+chrome'
  } catch {
    try {
      const { chromium } = require('playwright')
      browser = await chromium.launch({ headless: true })
      report.browserAuth = 'playwright+chromium'
    } catch (error) {
      report.browserAuth = `unavailable: ${error.message}`
    }
  }
}
async function browserSession(username, work) {
  if (!browser) throw new Error('Browser unavailable; cookie-authenticated route test could not run')
  const page = await (await browser.newContext()).newPage()
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.getByPlaceholder('jafar').fill(username)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 20_000 })
    return await work(page)
  } finally {
    await page.context().close()
  }
}
async function api(username, path, body) {
  return browserSession(username, async page => {
    const res = await page.request.post(`${BASE_URL}${path}`, { data: body })
    const text = await res.text()
    let json; try { json = JSON.parse(text) } catch { json = { text } }
    return { status: res.status(), json }
  })
}
async function visit(username, path) {
  return browserSession(username, async page => {
    const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForTimeout(500)
    const content = await page.content()
    const url = page.url()
    const denied = res?.status() === 403 || content.includes('صلاحية غير كافية') || content.includes('صلاحيات غير كافية') || content.includes('ليس لديك صلاحية') ||
      (url !== `${BASE_URL}${path}` && (url.includes('/login') || url.includes('/lawyer') || url.includes('/delegate') || url.includes('/admin/dashboard')))
    return { status: res?.status() ?? 0, url, denied }
  })
}

async function accountantPermissions() {
  const name = 'accountant_permissions'
  const allowed = ['/admin/debtors', '/admin/payments', '/admin/finance', '/admin/expenses', '/admin/reports']
  if (browser) {
    for (const path of allowed) {
      const result = await visit(ctx.acct.username, path)
      result.denied || result.status >= 500 ? fail(name, `${path} denied/error`, result) : ok(name, `${path} accessible`)
    }
    const taskPage = await visit(ctx.acct.username, '/admin/tasks')
    taskPage.denied ? ok(name, '/admin/tasks denied') : fail(name, '/admin/tasks should be denied', taskPage)
    const deniedAssign = await api(ctx.acct.username, '/api/admin/assign-tasks', { taskIds: ['00000000-0000-0000-0000-000000000000'], lawyerId: ctx.delegate.id, dueDate: dateAfter(1) })
    deniedAssign.status === 403 ? ok(name, 'accountant assignment API rejected with 403') : fail(name, 'accountant assignment API expected 403', deniedAssign)
  } else {
    fail(name, 'route checks unavailable because BASE_URL server/browser is unavailable')
  }

  const client = await session(ctx.acct.username)
  const stamp = Date.now().toString().slice(-8)
  const receipt = `QA-NJF-${stamp}`
  const { data: debtor, error } = await client.from('debtors').insert({
    full_name: `مدين QA نجف ${stamp}`, phone: '07700009999', export_date: new Date().toISOString().slice(0, 10),
    receipt_type: 'other', receipt_number: receipt, receipt_amount: 100_000, required_amount: 100_000,
    remaining_amount: 100_000, penalty_amount: 0, lawyer_fees: 0, branch_id: BRANCH_ID,
  }).select('id, full_name').single()
  if (error || !debtor) {
    fail(name, 'accountant client debtor insert failed', { error: error?.message })
    finish(name); return
  }
  const { data: task, error: taskError } = await client.from('tasks').insert({
    debtor_id: debtor.id, task_definition_id: ctx.findDef.id, task_type: ctx.findDef.task_type,
    task_status: 'waiting_assignment', reward_amount: ctx.findDef.fee_amount ?? FEE, branch_id: BRANCH_ID,
  }).select('id').single()
  if (taskError || !task) fail(name, 'accountant initial task insert failed', { error: taskError?.message })
  else {
    const { error: linkError } = await client.from('debtors').update({ current_task_id: task.id }).eq('id', debtor.id)
    if (linkError) fail(name, 'accountant task link failed', { error: linkError.message })
    else {
      ctx.debtor = debtor; ctx.findTask = task
      ok(name, 'accountant created debtor and find_address task')
    }
  }
  const { error: paymentError } = await client.from('debtor_payments').insert({
    debtor_id: debtor.id, branch_id: BRANCH_ID, amount: 10_000, payment_date: new Date().toISOString().slice(0, 10), notes: 'QA Najaf payment',
  })
  paymentError ? fail(name, 'accountant payment insert failed', { error: paymentError.message }) : ok(name, 'accountant registered payment')
  finish(name)
}

async function adminDelegateCycle() {
  const name = 'delegate_cycle'
  if (!ctx.findTask || !browser) { fail(name, 'missing created task or browser session'); finish(name); return }
  const assigned = await api(ctx.admin.username, '/api/admin/assign-tasks', { taskIds: [ctx.findTask.id], lawyerId: ctx.delegate.id, dueDate: dateAfter(1) })
  assigned.status < 400 ? ok(name, 'admin assigned find_address to delegate') : fail(name, 'admin assignment failed', assigned)
  const accepted = await api(ctx.delegate.username, '/api/lawyer/task-assignment', { taskId: ctx.findTask.id, action: 'accept' })
  accepted.status < 400 ? ok(name, 'delegate accepted assignment') : fail(name, 'delegate accept failed', accepted)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const upload = await browserSession(ctx.delegate.username, async page => {
    const res = await page.request.post(`${BASE_URL}/api/worker/upload-task-file`, {
      multipart: {
        file: { name: 'qa-najaf-address.png', mimeType: 'image/png', buffer: png },
        taskId: ctx.findTask.id,
        description: 'address_photo',
        kind: 'attachment',
      },
    })
    const text = await res.text()
    let json; try { json = JSON.parse(text) } catch { json = { text } }
    return { status: res.status(), json }
  })
  if (upload.status >= 400 || !upload.json?.filePath) {
    fail(name, 'delegate image upload failed', upload)
  } else {
    ok(name, 'delegate uploaded address image via worker API')
  }
  const delegateClient = await session(ctx.delegate.username)
  const completed = await delegateClient.from('tasks').update({
    task_status: 'submitted', completed_at: new Date().toISOString(), lawyer_notes: 'QA Najaf address',
    completion_data: { full_address: 'النجف الأشرف - عنوان QA', gps: '32.0000,44.3333', address_photo: 'qa-najaf-address.png' },
  }).eq('id', ctx.findTask.id).eq('assigned_to', ctx.delegate.id)
  completed.error ? fail(name, 'delegate completion update failed', { error: completed.error.message })
    : upload.status >= 400 ? fail(name, 'delegate submitted task but required image persistence failed')
      : ok(name, 'delegate submitted address, GPS, image')
  const approved = await api(ctx.admin.username, '/api/admin/approve-task', { taskId: ctx.findTask.id })
  approved.status < 400 ? ok(name, 'admin approved delegate task') : fail(name, 'delegate task approval failed', approved)
  const { data: wallet } = await admin.from('delegate_wallets').select('pending_balance, available_balance').eq('delegate_id', ctx.delegate.id).single()
  Number(wallet?.pending_balance) >= FEE ? ok(name, 'delegate fee is pending') : fail(name, 'delegate pending fee was not credited', wallet)
  const notified = await api(ctx.admin.username, '/api/admin/delegate-notified', { taskId: ctx.findTask.id, status: 'yes' })
  notified.status < 400 ? ok(name, 'admin marked debtor notified') : fail(name, 'notify failed', notified)
  const withdrawn = await api(ctx.admin.username, '/api/admin/delegate-withdraw', { delegateId: ctx.delegate.id, amount: FEE, notes: 'QA Najaf withdrawal' })
  withdrawn.status < 400 ? ok(name, 'admin withdrew delegate fee') : fail(name, 'delegate withdrawal failed', withdrawn)
  finish(name)
}

async function lawyerCycle() {
  const name = 'lawyer_cycle'
  if (!ctx.findTask || !browser) { fail(name, 'missing task or browser'); finish(name); return }
  const transition = await api(ctx.admin.username, '/api/admin/task-transition', { taskId: ctx.findTask.id, action: 'next', nextTaskDefId: ctx.lawsuitDef.id, updateGps: true })
  transition.status < 400 ? ok(name, 'admin transitioned to file_lawsuit') : fail(name, 'transition failed', transition)
  const { data: debtor } = await admin.from('debtors').select('current_task_id').eq('id', ctx.debtor.id).single()
  ctx.lawsuitTaskId = debtor?.current_task_id
  if (!ctx.lawsuitTaskId) { fail(name, 'no file_lawsuit task created'); finish(name); return }
  const assigned = await api(ctx.admin.username, '/api/admin/assign-tasks', { taskIds: [ctx.lawsuitTaskId], lawyerId: ctx.lawyer.id, dueDate: dateAfter(2) })
  assigned.status < 400 ? ok(name, 'admin assigned lawsuit to lawyer') : fail(name, 'lawyer assignment failed', assigned)
  const accepted = await api(ctx.lawyer.username, '/api/lawyer/task-assignment', { taskId: ctx.lawsuitTaskId, action: 'accept' })
  accepted.status < 400 ? ok(name, 'lawyer accepted assignment') : fail(name, 'lawyer accept failed', accepted)
  const lawyerClient = await session(ctx.lawyer.username)
  const completed = await lawyerClient.from('tasks').update({
    task_status: 'submitted', completed_at: new Date().toISOString(),
    completion_data: { case_number: `QA-NJF-${Date.now().toString().slice(-6)}`, court_name: 'محكمة بداءة النجف', hearing_date: dateAfter(14) },
    lawyer_notes: 'QA Najaf lawsuit completion',
  }).eq('id', ctx.lawsuitTaskId).eq('assigned_to', ctx.lawyer.id)
  completed.error ? fail(name, 'lawyer completion update failed', { error: completed.error.message }) : ok(name, 'lawyer submitted case completion')
  const approved = await api(ctx.admin.username, '/api/admin/approve-task', { taskId: ctx.lawsuitTaskId })
  approved.status < 400 ? ok(name, 'admin approved lawyer task') : fail(name, 'lawyer task approval failed', approved)
  const close = await api(ctx.admin.username, '/api/admin/task-transition', { taskId: ctx.lawsuitTaskId, action: 'close' })
  close.status < 400 ? ok(name, 'admin closed case') : fail(name, 'case close failed', close)
  finish(name)
}

async function roleIsolation() {
  const name = 'role_isolation'
  if (!browser) { fail(name, 'route checks unavailable because browser/server is unavailable'); finish(name); return }
  const checks = [
    [ctx.lawyer.username, '/admin/dashboard', true],
    [ctx.delegate.username, '/admin', true],
  ]
  for (const [username, path, expectedDenied] of checks) {
    const result = await visit(username, path)
    result.denied === expectedDenied ? ok(name, `${username} ${expectedDenied ? 'denied' : 'allowed'} ${path}`) : fail(name, `unexpected access for ${username} ${path}`, result)
  }
  finish(name)
}

async function cleanup() {
  const name = 'cleanup'
  const { data: users, error: usersError } = await admin.from('profiles').select('id, username').like('username', 'qa_njf_%')
  if (usersError) throw usersError
  const ids = (users ?? []).map(x => x.id)
  const { data: debtors, error: debtorError } = await admin.from('debtors').select('id').eq('branch_id', BRANCH_ID).ilike('full_name', 'مدين QA نجف%')
  if (debtorError) throw debtorError
  const debtorIds = (debtors ?? []).map(x => x.id)
  const { data: taskRows } = debtorIds.length ? await admin.from('tasks').select('id').in('debtor_id', debtorIds) : { data: [] }
  const taskIds = (taskRows ?? []).map(x => x.id)
  const drop = async (table, col, values) => values.length ? admin.from(table).delete().in(col, values) : { error: null }
  if (debtorIds.length) await admin.from('debtors').update({ current_task_id: null, last_task_id: null }).in('id', debtorIds)
  for (const [table, col, values] of [
    ['task_attachments', 'task_id', taskIds], ['expenses', 'task_id', taskIds], ['debtor_payments', 'debtor_id', debtorIds],
    ['debtor_notes', 'debtor_id', debtorIds], ['debtor_attachments', 'debtor_id', debtorIds], ['delegate_wallet_transactions', 'task_id', taskIds],
    ['lawyer_wallet_transactions', 'reference_id', taskIds], ['task_payment_receipts', 'task_id', taskIds],
    ['activity_logs', 'entity_id', [...taskIds, ...debtorIds]],
  ]) {
    const { error } = await drop(table, col, values); if (error) throw new Error(`${table}: ${error.message}`)
  }
  if (taskIds.length) {
    const { error } = await admin.storage.from('task-files').remove(taskIds.map(id => `${id}/qa-najaf-address.png`))
    if (error) throw new Error(`task-files: ${error.message}`)
  }
  if (taskIds.length) { const { error } = await admin.from('tasks').delete().in('id', taskIds); if (error) throw error }
  if (debtorIds.length) { const { error } = await admin.from('debtors').delete().in('id', debtorIds); if (error) throw error }
  for (const id of ids) {
    for (const [table, col] of [
      ['lawyer_wallet_transactions', 'lawyer_id'], ['lawyer_wallet_transactions', 'created_by'],
      ['delegate_wallet_transactions', 'delegate_id'], ['delegate_wallet_transactions', 'created_by'],
      ['delegate_wallets', 'delegate_id'], ['lawyer_payout_requests', 'lawyer_id'], ['lawyer_attachments', 'lawyer_id'],
      ['activity_logs', 'user_id'],
    ]) {
      const { error } = await admin.from(table).delete().eq(col, id); if (error) throw new Error(`${table}: ${error.message}`)
    }
    const { error: profileError } = await admin.from('profiles').delete().eq('id', id); if (profileError) throw profileError
    const { error: authError } = await admin.auth.admin.deleteUser(id); if (authError && !authError.message.includes('not found')) throw authError
  }
  const [{ count: usersLeft }, { count: debtorsLeft }] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }).like('username', 'qa_njf_%'),
    admin.from('debtors').select('*', { count: 'exact', head: true }).eq('branch_id', BRANCH_ID).ilike('full_name', 'مدين QA نجف%'),
  ])
  report.cleanup = { qa_njf_users_left: usersLeft ?? 0, najaf_qa_debtors_left: debtorsLeft ?? 0 }
  usersLeft || debtorsLeft ? fail(name, 'QA leftovers remain', report.cleanup) : ok(name, 'removed only QA Najaf users and debtors', report.cleanup)
  finish(name)
}

async function main() {
  try {
    if (!process.argv.includes('--cleanup-only')) {
      await seed()
      await initBrowser()
      await accountantPermissions()
      await adminDelegateCycle()
      await lawyerCycle()
      await roleIsolation()
    }
  } catch (error) {
    fail('fatal', error.message ?? String(error))
    finish('fatal')
  } finally {
    if (browser) await browser.close()
    if (process.argv.includes('--cleanup') || process.argv.includes('--cleanup-only')) {
      try { await cleanup() } catch (error) { fail('cleanup', error.message ?? String(error)); finish('cleanup') }
    }
    report.finishedAt = new Date().toISOString()
    report.pass = report.errors.length === 0
    writeFileSync(resolve(__dirname, 'qa-najaf-report.json'), JSON.stringify(report, null, 2))
    console.log(`Report: scripts/qa-najaf-report.json\nPASS=${report.pass}`)
    process.exitCode = report.pass ? 0 : 1
  }
}
main()
