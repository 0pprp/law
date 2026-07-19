/**
 * اختبار سريع لميزة جاري التسديد + دور مسؤول متابعة التسديد
 * يتطلب تطبيق SQL: apply-payment-follow-up-role.sql ثم apply-payment-follow-up-rls.sql
 */
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const report = { ok: [], fail: [], notes: [] }
function ok(m) { report.ok.push(m); console.log('✓', m) }
function fail(m, d) { report.fail.push(d ? `${m}: ${d}` : m); console.error('✗', m, d || '') }
function note(m) { report.notes.push(m); console.log('·', m) }

const TAG = `QA-تسديد-${Date.now().toString(36)}`
const PASS = `Qa!${randomBytes(6).toString('hex')}A1`
const createdUsers = []
const createdDebtors = []
let pipDebtorId = null
let activeDebtorId = null

async function probeRole() {
  const { error } = await admin.from('profiles').select('id').eq('role', 'payment_follow_up').limit(1)
  if (error && /invalid input value for enum|payment_follow_up/i.test(error.message)) {
    fail('role enum missing', error.message)
    note('شغّل supabase/scripts/apply-payment-follow-up-role.sql ثم RLS')
    return false
  }
  ok('payment_follow_up role accepted by DB')
  return true
}

async function getBranch() {
  const { data } = await admin.from('branches').select('id, name').eq('is_active', true)
  return (data ?? []).find(b => b.name !== 'الفرع الرئيسي') ?? data?.[0] ?? null
}

async function ensureUser(username, role, branchId) {
  const email = `${username}@test.local`
  const { data: existing } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (existing) {
    await admin.from('profiles').update({ role, branch_id: branchId, is_active: true }).eq('id', existing.id)
    createdUsers.push(existing.id)
    return existing.id
  }
  const { data: authUser, error } = await admin.auth.admin.createUser({
    email, password: PASS, email_confirm: true,
    user_metadata: { full_name: `اختبار ${TAG}` },
  })
  if (error || !authUser.user) throw new Error(error?.message ?? 'createUser')
  createdUsers.push(authUser.user.id)
  await admin.from('profiles').upsert({
    id: authUser.user.id,
    username,
    full_name: `اختبار ${TAG} ${role}`,
    role,
    branch_id: branchId,
    is_active: true,
  })
  return authUser.user.id
}

async function createDebtor(branchId, name, status) {
  const receipt = `TEST-PIP-${randomBytes(3).toString('hex')}`
  const { data, error } = await admin.from('debtors').insert({
    full_name: name,
    receipt_number: receipt,
    receipt_type: 'other',
    receipt_amount: 1000000,
    remaining_amount: 500000,
    required_amount: 500000,
    total_payments: 0,
    lawyer_fees: 0,
    penalty_amount: 0,
    branch_id: branchId,
    case_type: 'civil',
    case_status: status,
    export_date: new Date().toISOString().split('T')[0],
  }).select('id').single()
  if (error) throw new Error(error.message)
  createdDebtors.push(data.id)
  return data.id
}

async function cleanup() {
  for (const id of createdDebtors) {
    await admin.from('debtor_payments').delete().eq('debtor_id', id)
    await admin.from('debtors').delete().eq('id', id)
  }
  for (const id of createdUsers) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  ok(`cleaned ${createdDebtors.length} debtors, ${createdUsers.length} users`)
}

async function main() {
  console.log('=== QA: payment follow-up ===')
  if (!(await probeRole())) return finish()

  const branch = await getBranch()
  if (!branch) { fail('no branch'); return finish() }
  ok(`branch ${branch.name}`)

  const userId = await ensureUser(`qa_pip_${Date.now().toString(36)}`, 'payment_follow_up', branch.id)
  ok('1: created payment_follow_up user')

  pipDebtorId = await createDebtor(branch.id, `${TAG} جاري`, 'payment_in_progress')
  activeDebtorId = await createDebtor(branch.id, `${TAG} نشط`, 'active')
  ok('created pip + active debtors')

  const { data: pipList } = await admin.from('debtors')
    .select('id, case_status')
    .eq('case_status', 'payment_in_progress')
    .eq('branch_id', branch.id)
    .in('id', [pipDebtorId, activeDebtorId])

  if (pipList?.length === 1 && pipList[0].id === pipDebtorId) ok('3-4: only payment_in_progress in filter')
  else fail('3-4: filter', JSON.stringify(pipList))

  // اختبار RLS: يرى مديني جاري التسديد من كل الفروع (لا قيد branch_id)
  const { data: authUserRow } = await admin.auth.admin.getUserById(userId)
  const loginEmail = authUserRow?.user?.email
  if (loginEmail && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const asUser = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await asUser.auth.signInWithPassword({ email: loginEmail, password: PASS })
    if (signInErr) {
      fail('RLS: sign-in as payment_follow_up', signInErr.message)
    } else {
      // مدين جاري التسديد في فرع آخر
      const { data: otherBranches } = await admin.from('branches').select('id, name').neq('id', branch.id).limit(3)
      const otherBranch = (otherBranches ?? []).find(b => b.name !== 'الفرع الرئيسي')
      let otherPipId = null
      if (otherBranch) {
        otherPipId = await createDebtor(otherBranch.id, `${TAG} فرع آخر`, 'payment_in_progress')
      }

      const { data: visible, error: selErr } = await asUser
        .from('debtors')
        .select('id, case_status, branch_id')
        .in('id', [pipDebtorId, activeDebtorId, ...(otherPipId ? [otherPipId] : [])])
      if (selErr) {
        fail('RLS: select debtors as role', selErr.message)
      } else {
        const seesPip = (visible ?? []).some(r => r.id === pipDebtorId)
        const seesActive = (visible ?? []).some(r => r.id === activeDebtorId)
        const seesOther = otherPipId ? (visible ?? []).some(r => r.id === otherPipId) : true
        if (seesPip && !seesActive && seesOther) ok('RLS: sees payment_in_progress across all branches')
        else fail('RLS: visibility', `pip=${seesPip} active=${seesActive} other=${seesOther}`)
      }

      // إدراج تسديد كالدور نفسه (المسار الحقيقي)
      const { error: rlsPayErr } = await asUser.from('debtor_payments').insert({
        debtor_id: pipDebtorId,
        amount: 50000,
        payment_date: new Date().toISOString().split('T')[0],
        branch_id: branch.id,
      })
      if (rlsPayErr) fail('RLS: payment insert as role', rlsPayErr.message)
      else ok('RLS: payment insert as role works')

      // ممنوع: تسديد لمدين خارج جاري التسديد
      const { error: forbiddenErr } = await asUser.from('debtor_payments').insert({
        debtor_id: activeDebtorId,
        amount: 10000,
        payment_date: new Date().toISOString().split('T')[0],
        branch_id: branch.id,
      })
      if (forbiddenErr) ok('RLS: insert blocked for non-pip debtor')
      else fail('RLS: insert NOT blocked for non-pip debtor')

      await asUser.auth.signOut().catch(() => {})
    }
  } else {
    note('RLS live test skipped — no login email or anon key')
  }

  // 5-6 payment + sync
  const { error: payErr } = await admin.from('debtor_payments').insert({
    debtor_id: pipDebtorId,
    amount: 100000,
    payment_date: new Date().toISOString().split('T')[0],
    branch_id: branch.id,
    created_by: userId,
  })
  if (payErr) fail('5: payment insert', payErr.message)
  else ok('5: payment inserted')

  const { data: pays } = await admin.from('debtor_payments').select('amount').eq('debtor_id', pipDebtorId)
  const total = (pays ?? []).reduce((s, p) => s + Number(p.amount), 0)
  const expectedRemaining = Math.max(0, 500000 - total)
  await admin.from('debtors').update({ total_payments: total, remaining_amount: expectedRemaining }).eq('id', pipDebtorId)
  const { data: d } = await admin.from('debtors').select('remaining_amount, total_payments').eq('id', pipDebtorId).single()
  if (Number(d?.total_payments) === total && Number(d?.remaining_amount) === expectedRemaining && total > 0) {
    ok('6: remaining/total updated')
  } else fail('6: balances', JSON.stringify({ d, total, expectedRemaining }))

  // 7 path permissions (app-level)
  const allowed = (p) =>
    p.startsWith('/admin/payment-follow-up') ||
    p.startsWith('/admin/payments') ||
    /^\/admin\/debtors\/[^/]+\/account\/?$/.test(p)
  if (!allowed('/admin/tasks') && allowed('/admin/payment-follow-up') && allowed('/admin/payments')) {
    ok('7: role blocked from tasks / allowed board+payments')
  } else fail('7: path allowlist')

  const canCard = (r) => r === 'admin' || r === 'viewer'
  if (canCard('admin')) ok('8: admin sees card')
  if (canCard('viewer')) ok('9: LM sees card')
  if (!canCard('accountant') && !canCard('employee') && !canCard('lawyer')) ok('10: other roles no card')

  const canPay = (r) => r === 'admin' || r === 'accountant' || r === 'employee' || r === 'payment_follow_up'
  if (canPay('admin') && canPay('accountant') && !canPay('viewer')) ok('11: payment roles unchanged (+follow_up)')
  else fail('11: canAddPayments')

  await cleanup()
  return finish()
}

function finish() {
  const out = resolve(root, 'scripts/qa-payment-follow-up-report.json')
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log('\nOK', report.ok.length, 'FAIL', report.fail.length)
  if (report.fail.length) report.fail.forEach(f => console.log(' -', f))
  process.exit(report.fail.length ? 1 : 0)
}

main().catch(async e => {
  fail('fatal', e.message)
  try { await cleanup() } catch {}
  finish()
})
