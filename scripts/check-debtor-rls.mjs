import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

function usernameToInternalEmail(username) {
  return `${username.trim().toLowerCase()}@internal.qalat.local`
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: accountants } = await admin
  .from('profiles')
  .select('id, full_name, username, role, branch_id, accountant_type')
  .eq('role', 'accountant')

console.log('Accountants:', JSON.stringify(accountants, null, 2))

// Test insert as service role (bypasses RLS) - just verify branch exists
const acc = accountants?.[0]
if (acc?.branch_id) {
  const testId = crypto.randomUUID()
  const { error: insErr } = await admin.from('debtors').insert({
    id: testId,
    full_name: '__rls_test__',
    branch_id: acc.branch_id,
    created_by: acc.id,
    export_date: '2026-07-10',
    receipt_type: 'other',
    receipt_number: `TEST-${Date.now()}`,
  })
  console.log('Service role insert:', insErr?.message ?? 'OK')
  if (!insErr) await admin.from('debtors').delete().eq('id', testId)
}

// Sign in as first accountant if we have credentials - check common usernames
for (const a of accountants ?? []) {
  if (!a.username) continue
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const internalEmail = usernameToInternalEmail(a.username)
  const { data: authUser } = await admin.auth.admin.getUserById(a.id)
  const emails = [internalEmail, authUser?.user?.email].filter(Boolean)
  let session = null
  for (const email of [...new Set(emails)]) {
    for (const pwd of ['noor', a.username, '123456', 'admin12']) {
      const { data, error } = await anon.auth.signInWithPassword({ email, password: pwd })
      if (!error && data.session) {
        session = data.session
        console.log(`Logged in as ${a.username} via ${email}`)
        break
      }
    }
    if (session) break
  }
  if (!session) {
    // impersonate via admin generateLink
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: internalEmail,
    })
    if (linkErr) {
      console.log(`Login failed for ${a.username}:`, linkErr.message)
      continue
    }
    const token = linkData?.properties?.hashed_token
    if (token) {
      const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({
        token_hash: token,
        type: 'magiclink',
      })
      if (otpErr) {
        console.log(`OTP failed for ${a.username}:`, otpErr.message)
        continue
      }
      session = otpData.session
    }
  }
  if (!session) {
    console.log(`Could not get session for ${a.username}`)
    continue
  }
  const auth = { session }
  const userClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth.session?.access_token}` } },
  })
  const { error: dErr } = await userClient.from('debtors').insert({
    full_name: '__rls_test_accountant__',
    branch_id: a.branch_id,
    created_by: a.id,
    export_date: '2026-07-10',
    receipt_type: 'other',
    receipt_number: `ACCT-TEST-${Date.now()}`,
  })
  console.log(`Accountant ${a.full_name} (${a.username}) insert own branch:`, dErr?.code, dErr?.message ?? 'OK')

  const { data: otherBranches } = await admin.from('branches').select('id, name').neq('id', a.branch_id).limit(1)
  const otherBranch = otherBranches?.[0]
  if (otherBranch) {
    const { error: crossErr } = await userClient.from('debtors').insert({
      full_name: '__rls_test_cross_branch__',
      branch_id: otherBranch.id,
      created_by: a.id,
      export_date: '2026-07-10',
      receipt_type: 'other',
      receipt_number: `CROSS-${Date.now()}`,
    })
    console.log(`Cross-branch insert (${otherBranch.name}):`, crossErr?.code, crossErr?.message ?? 'OK')

    const { data: taskDef } = await admin.from('task_definitions').select('id').eq('branch_id', a.branch_id).limit(1).maybeSingle()
    if (taskDef) {
      const { data: debtor } = await userClient.from('debtors').insert({
        full_name: '__task_test__',
        branch_id: a.branch_id,
        created_by: a.id,
        export_date: '2026-07-10',
        receipt_type: 'other',
        receipt_number: `TASK-${Date.now()}`,
      }).select('id').single()
      if (debtor) {
        const { error: tErr } = await userClient.from('tasks').insert({
          debtor_id: debtor.id,
          task_definition_id: taskDef.id,
          task_status: 'waiting_assignment',
          reward_amount: 0,
          created_by: a.id,
          branch_id: a.branch_id,
        })
        console.log('Task insert:', tErr?.code, tErr?.message ?? 'OK')
        await admin.from('tasks').delete().eq('debtor_id', debtor.id)
        await admin.from('debtors').delete().eq('id', debtor.id)
      }
    }
  }

  await admin.from('debtors').delete().ilike('full_name', '__rls_test%')
  await admin.from('debtors').delete().ilike('full_name', '__task_test%')
  await anon.auth.signOut()
  break
}
