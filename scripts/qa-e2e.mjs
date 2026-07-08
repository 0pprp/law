/**
 * QA E2E — run: node --env-file=.env.local scripts/qa-e2e.mjs
 * Requires: dev server on BASE_URL, qa-seed-users.mjs run first.
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = process.env.QA_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.QA_PASSWORD ?? 'QaTest12'

const USERS = {
  admin: 'qa_admin',
  legal: 'qa_legal',
  lawyer: 'qa_lawyer',
  lawyerGen: 'qa_lawyer_gen',
  acctBranch: 'qa_acct_branch',
  acctGen: 'qa_acct_gen',
  delegate: 'qa_delegate',
}

const ADMIN_ROUTES = [
  '/admin/dashboard',
  '/admin/debtors',
  '/admin/debtors/new',
  '/admin/tasks',
  '/admin/tasks/new',
  '/admin/tasks/review',
  '/admin/task-files',
  '/admin/lawyers',
  '/admin/lawyers/new',
  '/admin/delegates',
  '/admin/delegates/new',
  '/admin/delegates/wallets',
  '/admin/delegates/report',
  '/admin/payments',
  '/admin/expenses',
  '/admin/finance',
  '/admin/reports',
  '/admin/accounts',
  '/admin/activity',
  '/admin/settings',
  '/admin/settings/task-definitions',
  '/admin/settings/task-fees',
  '/admin/branches',
  '/admin/closed-cases',
  '/admin/legal-manager-wallet',
]

const LAWYER_ROUTES = ['/lawyer', '/lawyer/tasks', '/lawyer/profile', '/lawyer/account']
const DELEGATE_ROUTES = ['/delegate', '/delegate/tasks', '/delegate/profile']

const ACCOUNTANT_ALLOWED = new Set([
  '/admin/dashboard', '/admin/debtors', '/admin/debtors/new', '/admin/payments',
  '/admin/finance', '/admin/expenses', '/admin/reports', '/admin/accounts',
  '/admin/activity', '/admin/settings',
])

const ACCOUNTANT_DENIED = [
  '/admin/tasks', '/admin/lawyers', '/admin/delegates', '/admin/task-files',
  '/admin/branches', '/admin/closed-cases', '/admin/legal-manager-wallet',
]

const stats = {
  pagesTested: 0,
  routesTested: 0,
  scenariosTested: 0,
  errorsFound: 0,
  errorsFixed: 0,
  bugsRemaining: [],
  consoleErrors: [],
  networkErrors: [],
}

function logScenario(name) {
  stats.scenariosTested++
  console.log(`  [scenario] ${name}`)
}

function recordError(msg, context = '') {
  stats.errorsFound++
  const full = context ? `${msg} (${context})` : msg
  stats.bugsRemaining.push(full)
  console.error(`  [FAIL] ${full}`)
}

function pass(msg) {
  console.log(`  [OK] ${msg}`)
}

async function login(page, username) {
  await page.context().clearCookies()
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.getByPlaceholder('jafar').fill(username)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 })
}

async function logout(page) {
  await page.context().clearCookies()
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
}

function isPermissionDeniedHtml(body) {
  return body.includes('صلاحية غير كافية')
    || body.includes('لا يمكنك الوصول')
    || body.includes('صلاحيات المحاسب')
    || body.includes(PERMISSION_DENIED_MSG)
}

const PERMISSION_DENIED_MSG = 'ليس لديك صلاحية'

async function visitRoute(page, route, expectDenied = false) {
  stats.routesTested++
  const res = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  stats.pagesTested++
  const status = res?.status() ?? 0
  const body = await page.content()
  const denied = isPermissionDeniedHtml(body) || status === 403
  if (expectDenied) {
    if (!denied && !page.url().includes('/login') && status < 400) {
      recordError(`Expected denied for ${route}`, `got status ${status}`)
      return false
    }
    pass(`denied as expected: ${route}`)
    return true
  }
  if (status >= 500) {
    recordError(`HTTP ${status} on ${route}`)
    return false
  }
  if (denied) {
    recordError(`Unexpected permission denied on ${route}`)
    return false
  }
  if (body.includes('Application error') || body.includes('Unhandled Runtime Error')) {
    recordError(`React error on ${route}`)
    return false
  }
  pass(route)
  return true
}

async function testRoleRoutes(page, roleKey, routes, deniedRoutes = []) {
  console.log(`\n=== Role: ${roleKey} ===`)
  logScenario(`login ${roleKey}`)
  await login(page, USERS[roleKey])
  for (const route of routes) {
    logScenario(`${roleKey} visits ${route}`)
    await visitRoute(page, route, false)
  }
  for (const route of deniedRoutes) {
    logScenario(`${roleKey} denied ${route}`)
    await visitRoute(page, route, true)
  }
  await logout(page)
}

async function verifyDbIntegrity() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  logScenario('DB: duplicate wallet transactions per task')
  const { data: txs } = await db
    .from('lawyer_wallet_transactions')
    .select('reference_id, type, lawyer_id')
    .eq('type', 'approved_task_payment')
    .not('reference_id', 'is', null)
    .limit(5000)
  const seen = new Map()
  for (const t of txs ?? []) {
    const k = `${t.lawyer_id}:${t.reference_id}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const dups = [...seen.entries()].filter(([, c]) => c > 1)
  if (dups.length) recordError(`Duplicate fee credits: ${dups.length}`)
  else pass('No duplicate approved_task_payment per task')

  logScenario('DB: qa_lawyer savings wallet >= 500000')
  const { data: profile } = await db.from('profiles').select('id').eq('username', USERS.lawyer).maybeSingle()
  if (profile?.id) {
    const { data: txs } = await db.from('lawyer_wallet_transactions').select('amount, wallet, type').eq('lawyer_id', profile.id)
    const DISB = new Set(['accountant_transfer', 'transfer_from_savings', 'savings_withdrawal', 'task_expense_deduction'])
    const bal = (txs ?? []).reduce((s, r) => {
      if (r.wallet === 'savings' || (!r.wallet && DISB.has(r.type))) return s + Number(r.amount ?? 0)
      return s
    }, 0)
    if (bal < 500000) recordError(`qa_lawyer savings ${bal} < 500000`)
    else pass(`qa_lawyer savings wallet: ${bal}`)
  }
}

async function testCrossRoleIsolation(page) {
  logScenario('lawyer cannot access /admin/dashboard')
  await login(page, USERS.lawyer)
  await page.goto(`${BASE_URL}/admin/dashboard`, { waitUntil: 'domcontentloaded' })
  if (page.url().includes('/admin/dashboard') && !page.url().includes('/lawyer')) {
    recordError('Lawyer accessed admin dashboard without redirect')
  } else pass('Lawyer blocked from admin')
  await logout(page)

  logScenario('delegate cannot access /lawyer')
  await login(page, USERS.delegate)
  await page.goto(`${BASE_URL}/lawyer/tasks`, { waitUntil: 'domcontentloaded' })
  if (page.url().includes('/lawyer/')) recordError('Delegate accessed lawyer routes')
  else pass('Delegate blocked from lawyer')
  await logout(page)
}

async function testAppDialogs(page) {
  logScenario('custom confirm dialog (not native)')
  await login(page, USERS.admin)
  await page.goto(`${BASE_URL}/admin/lawyers`, { waitUntil: 'domcontentloaded' })
  const deleteBtn = page.locator('button').filter({ hasText: 'حذف' }).first()
  if (await deleteBtn.count()) {
    await deleteBtn.click()
    const nativeDialog = false
    page.once('dialog', async d => {
      recordError('Native browser dialog appeared instead of app dialog')
      await d.dismiss()
    })
    await page.waitForTimeout(500)
    const modal = page.locator('#app-dialog-title, h2').filter({ hasText: /تأكيد/ })
    if (await modal.count()) {
      pass('Custom confirm modal shown')
      await page.locator('button').filter({ hasText: 'إلغاء' }).first().click()
    } else if (!nativeDialog) {
      pass('No delete target or dialog skipped')
    }
  }
  await logout(page)
}

async function main() {
  console.log(`QA E2E against ${BASE_URL}`)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'ar-IQ' })
  const page = await context.newPage()

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text()
      if (!t.includes('favicon') && !t.includes('DevTools')) {
        stats.consoleErrors.push(t)
      }
    }
  })
  page.on('response', res => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      stats.networkErrors.push(`${res.status()} ${res.url()}`)
    }
  })

  try {
    await fetch(BASE_URL).then(r => { if (!r.ok) throw new Error(`Server ${r.status}`) })
  } catch (e) {
    console.error('Dev server not reachable:', e.message)
    process.exit(1)
  }

  await testRoleRoutes(page, 'admin', ADMIN_ROUTES)
  await testRoleRoutes(page, 'legal', ADMIN_ROUTES.filter(r => r !== '/admin/legal-manager-wallet'))
  await testRoleRoutes(
    page,
    'acctBranch',
    [...ACCOUNTANT_ALLOWED],
    ACCOUNTANT_DENIED,
  )
  await testRoleRoutes(page, 'acctGen', [...ACCOUNTANT_ALLOWED], ACCOUNTANT_DENIED)
  await testRoleRoutes(page, 'lawyer', LAWYER_ROUTES)
  await testRoleRoutes(page, 'lawyerGen', LAWYER_ROUTES)
  await testRoleRoutes(page, 'delegate', DELEGATE_ROUTES)

  await testCrossRoleIsolation(page)
  await testAppDialogs(page)
  await verifyDbIntegrity()

  const uniqueApiErrors = [...new Set(stats.networkErrors)].filter(e => !e.includes('401') && !e.includes('403'))
  if (uniqueApiErrors.length) {
    for (const e of uniqueApiErrors.slice(0, 10)) recordError(`API error: ${e}`)
  }

  const uniqueConsole = [...new Set(stats.consoleErrors)].slice(0, 10)
  if (uniqueConsole.length) {
    for (const e of uniqueConsole) recordError(`Console: ${e.slice(0, 120)}`)
  }

  await browser.close()

  const report = {
    pagesTested: stats.pagesTested,
    routesTested: stats.routesTested,
    scenariosTested: stats.scenariosTested,
    errorsFound: stats.errorsFound,
    errorsFixed: stats.errorsFixed,
    bugsRemaining: stats.bugsRemaining,
    productionReady: stats.bugsRemaining.length === 0,
  }
  console.log('\n========== QA REPORT ==========')
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.productionReady ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
