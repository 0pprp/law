/**
 * Role × route matrix smoke (cookie login + fetch).
 * node --env-file=.env.local scripts/qa-role-matrix.mjs
 */
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3000'
const PASS = process.env.QA_PASSWORD ?? 'QaTest12'

const USERS = [
  { u: 'qa_admin', role: 'admin' },
  { u: 'qa_legal', role: 'viewer' },
  { u: 'qa_clm', role: 'criminal_legal_manager' },
  { u: 'qa_acct_branch', role: 'accountant' },
  { u: 'qa_acct_gen', role: 'accountant_general' },
  { u: 'qa_lawyer', role: 'lawyer' },
  { u: 'qa_delegate', role: 'delegate' },
  { u: 'qa_pfu', role: 'payment_follow_up' },
  { u: 'ali123', role: 'criminal_legal_manager', pass: 'QaTest12' },
]

const ROUTES = [
  '/admin/dashboard',
  '/admin/debtors',
  '/admin/tasks',
  '/admin/tasks/review',
  '/admin/payments',
  '/admin/finance',
  '/admin/expenses',
  '/admin/reports',
  '/admin/settings',
  '/admin/activity',
  '/admin/delegates',
  '/admin/legal-manager-wallet',
  '/admin/payment-follow-up',
  '/admin/dashboard/payment-in-progress',
  '/admin/dashboard/noncompliance',
  '/lawyer',
  '/delegate',
]

/** Expected: allow | deny | redirect */
const EXPECT = {
  admin: {
    '/admin/dashboard': 'allow',
    '/admin/debtors': 'allow',
    '/admin/tasks': 'allow',
    '/admin/tasks/review': 'allow',
    '/admin/payments': 'allow',
    '/admin/finance': 'allow',
    '/admin/expenses': 'allow',
    '/admin/reports': 'allow',
    '/admin/settings': 'allow',
    '/admin/activity': 'allow',
    '/admin/delegates': 'allow',
    '/admin/legal-manager-wallet': 'allow',
    '/admin/payment-follow-up': 'allow',
    '/admin/dashboard/payment-in-progress': 'allow',
    '/admin/dashboard/noncompliance': 'allow',
  },
  viewer: {
    '/admin/dashboard': 'allow',
    '/admin/debtors': 'allow',
    '/admin/tasks': 'allow',
    '/admin/tasks/review': 'allow',
    '/admin/payments': 'allow',
    '/admin/finance': 'allow',
    '/admin/expenses': 'allow',
    '/admin/reports': 'allow',
    '/admin/settings': 'allow',
    '/admin/activity': 'allow',
    '/admin/delegates': 'allow',
    '/admin/legal-manager-wallet': 'deny',
    '/admin/dashboard/payment-in-progress': 'allow',
    '/admin/dashboard/noncompliance': 'allow',
  },
  criminal_legal_manager: {
    '/admin/dashboard': 'allow',
    '/admin/debtors': 'allow',
    '/admin/tasks': 'allow',
    '/admin/tasks/review': 'allow',
    '/admin/payments': 'deny',
    '/admin/finance': 'deny',
    '/admin/expenses': 'deny',
    '/admin/reports': 'allow',
    '/admin/settings': 'allow',
    '/admin/activity': 'allow',
    '/admin/delegates': 'deny',
    '/admin/legal-manager-wallet': 'deny',
    '/admin/payment-follow-up': 'deny',
    '/admin/dashboard/payment-in-progress': 'deny',
    '/admin/dashboard/noncompliance': 'deny',
  },
  accountant: {
    '/admin/dashboard': 'allow',
    '/admin/debtors': 'allow',
    '/admin/tasks': 'deny',
    '/admin/tasks/review': 'deny',
    '/admin/payments': 'allow',
    '/admin/finance': 'allow',
    '/admin/expenses': 'allow',
    '/admin/reports': 'allow',
    '/admin/settings': 'allow',
    '/admin/activity': 'allow',
    '/admin/delegates': 'deny',
  },
  accountant_general: {
    '/admin/dashboard': 'allow',
    '/admin/payments': 'allow',
    '/admin/finance': 'allow',
    '/admin/tasks': 'deny',
  },
  payment_follow_up: {
    '/admin/payment-follow-up': 'allow',
    '/admin/payments': 'allow',
    '/admin/dashboard': 'deny',
    '/admin/tasks': 'deny',
    '/admin/finance': 'deny',
  },
  lawyer: {
    '/lawyer': 'allow',
    '/admin/dashboard': 'redirect',
  },
  delegate: {
    '/delegate': 'allow',
    '/admin/dashboard': 'redirect',
  },
}

function parseSetCookie(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
  const jar = []
  for (const c of raw) {
    const part = String(c).split(';')[0]
    if (part) jar.push(part)
  }
  return jar
}

async function login(username, password = PASS) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  })
  const cookies = parseSetCookie(res)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, cookies, json, cookieHeader: cookies.join('; ') }
}

function classify(html, finalUrl, status) {
  const text = html || ''
  if (status >= 500) return 'error'
  if (/لا يمكنك الوصول|غير متاحة|صلاحيات|PermissionDenied|المالية غير متاحة|غير متاحة لقسمك/.test(text)) return 'deny'
  if (finalUrl.includes('/login')) return 'redirect'
  if (finalUrl.includes('/lawyer') && !finalUrl.includes('/admin')) return 'allow'
  if (finalUrl.includes('/delegate') && !finalUrl.includes('/admin')) return 'allow'
  if (status === 200 && finalUrl.includes('/admin')) return 'allow'
  if (status === 200) return 'allow'
  return `other:${status}`
}

async function probe(cookieHeader, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    redirect: 'follow',
  })
  const html = await res.text()
  return {
    status: res.status,
    url: res.url,
    result: classify(html, res.url, res.status),
    deniedMsg: (html.match(/لا يمكنك الوصول[^<]{0,80}|المالية غير متاحة[^<]{0,60}|صلاحيات[^<]{0,80}/)?.[0] || '').slice(0, 100),
    hasFinanceNav: /href="\/admin\/payments"/.test(html) || />التسديدات</.test(html),
    hasReportsNav: /href="\/admin\/reports"/.test(html) || />التقارير</.test(html),
    hasSettingsNav: /href="\/admin\/settings"/.test(html) || />إعدادات الفرع</.test(html),
    hasActivityNav: /href="\/admin\/activity"/.test(html) || />سجل النشاط</.test(html),
    hasDelegatesNav: /href="\/admin\/delegates"/.test(html) || />المندوبون</.test(html),
  }
}

const findings = []
function log(ok, msg) {
  findings.push({ ok, msg })
  console.log(`${ok ? '[OK]' : '[FAIL]'} ${msg}`)
}

async function main() {
  console.log(`=== Role matrix @ ${BASE} ===\n`)
  for (const user of USERS) {
    const roleKey = user.role
    const expectMap = EXPECT[roleKey] || {}
    console.log(`\n--- ${user.u} (${roleKey}) ---`)
    const loginRes = await login(user.u, user.pass || PASS)
    if (loginRes.status !== 200 || !loginRes.cookieHeader) {
      log(false, `${user.u} login failed: ${loginRes.status} ${JSON.stringify(loginRes.json)}`)
      continue
    }
    log(true, `${user.u} login OK → ${loginRes.json?.redirectTo || loginRes.json?.role || 'ok'}`)

    for (const [path, expected] of Object.entries(expectMap)) {
      const p = await probe(loginRes.cookieHeader, path)
      let got = p.result
      // lawyer/delegate redirected away from admin counts as redirect
      if (expected === 'redirect' && (got === 'allow' || got === 'deny') && (p.url.includes('/lawyer') || p.url.includes('/delegate') || p.url.includes('/login'))) {
        got = 'redirect'
      }
      // deny pages may still be 200 with PermissionDenied UI
      const pass = got === expected || (expected === 'deny' && got === 'deny')
      log(pass, `${user.u} ${path}: expected=${expected} got=${got}${p.deniedMsg ? ` (${p.deniedMsg})` : ''}`)
    }

    // Nav smoke for CLM
    if (roleKey === 'criminal_legal_manager') {
      const dash = await probe(loginRes.cookieHeader, '/admin/dashboard')
      log(!dash.hasFinanceNav, `${user.u} dashboard: finance nav hidden (hasPayments=${dash.hasFinanceNav})`)
      log(dash.hasReportsNav, `${user.u} dashboard: reports nav visible`)
      log(dash.hasSettingsNav, `${user.u} dashboard: settings nav visible`)
      log(dash.hasActivityNav, `${user.u} dashboard: activity nav visible`)
      log(!dash.hasDelegatesNav, `${user.u} dashboard: delegates nav hidden`)
    }
  }

  const fails = findings.filter(f => f.ok === false)
  const report = { at: new Date().toISOString(), ok: findings.filter(f => f.ok).length, fail: fails.length, findings }
  writeFileSync(resolve(__dirname, 'qa-role-matrix-report.json'), JSON.stringify(report, null, 2))
  console.log(`\n=== SUMMARY ok=${report.ok} fail=${report.fail} ===`)
  process.exit(fails.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
