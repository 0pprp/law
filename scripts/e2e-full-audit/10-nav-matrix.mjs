/**
 * Phase 1 — Role navigation matrix (headless).
 * Run: node --env-file=.env.local scripts/e2e-full-audit/10-nav-matrix.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const PASSWORD = 'TestPass123!'

const PAGES = [
  { label: 'لوحة التحكم', href: '/admin/dashboard' },
  { label: 'المدينون', href: '/admin/debtors' },
  { label: 'تكليف المهام', href: '/admin/tasks' },
  { label: 'مراجعة الإنجازات', href: '/admin/tasks/review' },
  { label: 'الأسماء التي تحتاج مراقبة (الحالات الخاصة)', href: '/admin/special-statuses' },
  { label: 'إدارة المهام', href: '/admin/task-management' },
  { label: 'التسديدات', href: '/admin/payments' },
  { label: 'الصرفيات', href: '/admin/expenses' },
  { label: 'أتعاب المحامين', href: '/admin/finance' },
  { label: 'التقارير', href: '/admin/reports' },
  { label: 'إعدادات الفرع', href: '/admin/settings' },
]

// true = link expected visible in sidebar
const EXPECTED = {
  admin: {
    '/admin/dashboard': true, '/admin/debtors': true, '/admin/tasks': true, '/admin/tasks/review': true,
    '/admin/special-statuses': true, '/admin/task-management': true, '/admin/payments': true,
    '/admin/expenses': true, '/admin/finance': true, '/admin/reports': true, '/admin/settings': true,
  },
  viewer: {
    '/admin/dashboard': true, '/admin/debtors': true, '/admin/tasks': true, '/admin/tasks/review': true,
    '/admin/special-statuses': true, '/admin/task-management': false, '/admin/payments': false,
    '/admin/expenses': false, '/admin/finance': false, '/admin/reports': true, '/admin/settings': true,
  },
  criminal_legal_manager: {
    '/admin/dashboard': true, '/admin/debtors': true, '/admin/tasks': true, '/admin/tasks/review': true,
    '/admin/special-statuses': false, '/admin/task-management': false, '/admin/payments': false,
    '/admin/expenses': false, '/admin/finance': false, '/admin/reports': true, '/admin/settings': true,
  },
  accountant: {
    '/admin/dashboard': true, '/admin/debtors': true, '/admin/tasks': false, '/admin/tasks/review': false,
    '/admin/special-statuses': false, '/admin/task-management': true, '/admin/payments': true,
    '/admin/expenses': true, '/admin/finance': true, '/admin/reports': true, '/admin/settings': true,
  },
  delegate: {
    '/admin/dashboard': false, '/admin/debtors': false, '/admin/tasks': false, '/admin/tasks/review': false,
    '/admin/special-statuses': false, '/admin/task-management': false, '/admin/payments': false,
    '/admin/expenses': false, '/admin/finance': false, '/admin/reports': false, '/admin/settings': false,
  },
  lawyer: {
    '/admin/dashboard': false, '/admin/debtors': false, '/admin/tasks': false, '/admin/tasks/review': false,
    '/admin/special-statuses': false, '/admin/task-management': false, '/admin/payments': false,
    '/admin/expenses': false, '/admin/finance': false, '/admin/reports': false, '/admin/settings': false,
  },
}

const ROLES = [
  { role: 'admin', email: 'test.admin@test.local', portal: '/admin/dashboard' },
  { role: 'viewer', email: 'test.viewer@test.local', portal: '/admin/dashboard' },
  { role: 'criminal_legal_manager', email: 'test.criminal_legal_manager@test.local', portal: '/admin/dashboard' },
  { role: 'accountant', email: 'test.accountant@test.local', portal: '/admin/dashboard' },
  { role: 'delegate', email: 'test.delegate@test.local', portal: '/delegate' },
  { role: 'lawyer', email: 'test.lawyer@test.local', portal: '/lawyer' },
]

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  // React hydration can reset controlled inputs — fill until the value sticks
  for (let i = 0; i < 12; i++) {
    await page.fill('input[autocomplete="username"]', email)
    await page.fill('input[autocomplete="current-password"]', PASSWORD)
    await page.waitForTimeout(1000)
    const v = await page.inputValue('input[autocomplete="username"]')
    if (v === email) break
  }
  const finalValue = await page.inputValue('input[autocomplete="username"]')
  if (finalValue !== email) throw new Error(`login input not stable for ${email} (got "${finalValue}")`)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 180000, waitUntil: 'commit' })
  await page.waitForLoadState('domcontentloaded', { timeout: 180000 }).catch(() => {})
}

const results = []
const browser = await chromium.launch({ headless: true })

for (const spec of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  const entry = { role: spec.role, landed: null, links: [], checks: [], portalOk: null, error: null }
  try {
    await login(page, spec.email)
    entry.landed = new URL(page.url()).pathname
    entry.portalOk = entry.landed.startsWith(spec.portal)

    if (entry.landed.startsWith('/admin')) {
      await page.waitForSelector('nav a[href^="/admin/"]', { timeout: 120000 }).catch(() => {})
    }
    const hrefs = await page.$$eval('nav a[href^="/admin/"]', els => els.map(e => e.getAttribute('href')))
    entry.links = [...new Set(hrefs)]

    for (const p of PAGES) {
      const visible = entry.links.includes(p.href)
      const expected = EXPECTED[spec.role][p.href]
      entry.checks.push({ page: p.label, href: p.href, expected, actual: visible, ok: visible === expected })
    }

    // field portals
    if (spec.role === 'lawyer') {
      await page.goto(`${BASE}/lawyer/tasks`, { waitUntil: 'domcontentloaded' })
      entry.lawyerTasksPath = new URL(page.url()).pathname
      entry.lawyerTasksOk = entry.lawyerTasksPath.startsWith('/lawyer')
    }
    if (spec.role === 'delegate') {
      await page.goto(`${BASE}/delegate`, { waitUntil: 'domcontentloaded' })
      entry.delegatePath = new URL(page.url()).pathname
      entry.delegateOk = entry.delegatePath.startsWith('/delegate')
    }
    // guard: admin dashboard for field roles
    if (spec.role === 'lawyer' || spec.role === 'delegate') {
      await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      entry.adminGuardPath = new URL(page.url()).pathname
      entry.adminGuardOk = !entry.adminGuardPath.startsWith('/admin')
    }
  } catch (err) {
    entry.error = err.message
  }
  results.push(entry)
  const pass = entry.checks.filter(c => c.ok).length
  console.log(`\n### ${spec.role} — landed ${entry.landed} — ${pass}/${entry.checks.length}`)
  for (const c of entry.checks) {
    if (!c.ok) console.log(`  MISMATCH ${c.href} expected=${c.expected} actual=${c.actual}`)
  }
  if (entry.error) console.log('  ERROR:', entry.error)
  if (entry.adminGuardPath !== undefined) console.log(`  admin guard -> ${entry.adminGuardPath} ok=${entry.adminGuardOk}`)
  if (entry.lawyerTasksPath) console.log(`  /lawyer/tasks -> ${entry.lawyerTasksPath} ok=${entry.lawyerTasksOk}`)
  if (entry.delegatePath) console.log(`  /delegate -> ${entry.delegatePath} ok=${entry.delegateOk}`)
  console.log('  links:', entry.links.join(' '))
  await ctx.close()
}

await browser.close()
fs.writeFileSync(path.join(process.cwd(), 'scripts/e2e-full-audit/out-nav-matrix.json'), JSON.stringify(results, null, 2))
console.log('\nSaved out-nav-matrix.json')
