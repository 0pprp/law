/**
 * إنشاء 5 حسابات محاسب رئيسي وربط كل واحد بفرع.
 *
 *   node --env-file=.env.local scripts/create-chief-accountants.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const confirm = process.argv.includes('--confirm')

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!confirm) {
  console.error('Use --confirm to create accounts')
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ACCOUNTS = [
  { username: 'kxm947', password: 'kxm947', governorate: 'البصرة' },
  { username: 'bnr263', password: 'bnr263', governorate: 'النجف الأشرف' },
  { username: 'qvt581', password: 'qvt581', governorate: 'بغداد الكرخ' },
  { username: 'rzp714', password: 'rzp714', governorate: 'كربلاء' },
  { username: 'wdj052', password: 'wdj052', governorate: 'ديالى' },
]

function authEmail(username) {
  return `${username.trim().toLowerCase()}@qalatlaw.com`
}

async function resolveBranch(governorate) {
  const { data: exact } = await admin
    .from('branches')
    .select('id, name, is_active')
    .eq('name', governorate)
    .maybeSingle()
  if (exact) return exact

  const { data: fuzzy, error } = await admin
    .from('branches')
    .select('id, name, is_active')
    .ilike('name', `%${governorate}%`)
    .limit(5)

  if (error) throw new Error(`branch lookup failed for ${governorate}: ${error.message}`)
  if (!fuzzy?.length) return null
  if (fuzzy.length > 1) {
    const preferred = fuzzy.find(b => b.name.trim() === governorate.trim())
    if (preferred) return preferred
    console.warn(`  [warn] عدة فروع تطابق «${governorate}»: ${fuzzy.map(b => b.name).join(', ')} — استخدام الأول`)
  }
  return fuzzy[0]
}

async function ensureChiefLink(profileId, branchId) {
  const { data: existing } = await admin
    .from('chief_accountant_branches')
    .select('profile_id, branch_id')
    .eq('profile_id', profileId)
    .eq('branch_id', branchId)
    .maybeSingle()

  if (existing) return { ok: true, created: false }

  const { error } = await admin.from('chief_accountant_branches').insert({
    profile_id: profileId,
    branch_id: branchId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, created: true }
}

async function upsertProfile(userId, row, branch) {
  const profile = {
    id: userId,
    username: row.username,
    full_name: `محاسب رئيسي — ${row.governorate}`,
    phone: '07000000000',
    role: 'chief_accountant',
    is_active: true,
    governorate: branch.name,
    branch_id: branch.id,
    identity_type: null,
    identity_number: null,
    identity_category: null,
    lawyer_type: 'normal',
    accountant_type: 'branch',
    case_type: 'civil',
  }

  let { error } = await admin.from('profiles').update(profile).eq('id', userId)
  if (error && String(error.message ?? '').includes('case_type')) {
    const { case_type: _c, ...rest } = profile
    ;({ error } = await admin.from('profiles').update(rest).eq('id', userId))
  }
  if (error) {
    ;({ error } = await admin.from('profiles').upsert(profile))
  }
  return error
}

async function main() {
  console.log('Creating chief_accountant accounts...\n')
  const results = []

  for (let i = 0; i < ACCOUNTS.length; i++) {
    const row = ACCOUNTS[i]
    const username = row.username.toLowerCase()
    const email = authEmail(username)
    console.log(`→ ${username} / ${row.governorate}`)

    const branch = await resolveBranch(row.governorate)
    if (!branch) {
      console.error(`  [fail] لم يُعثر على فرع لـ «${row.governorate}»`)
      results.push({
        username,
        password: row.password,
        email,
        id: null,
        branch: row.governorate,
        branch_id: null,
        status: 'failed: branch not found',
      })
      continue
    }
    if (branch.is_active === false) {
      await admin.from('branches').update({ is_active: true }).eq('id', branch.id)
    }
    console.log(`  branch: ${branch.name} (${branch.id})`)

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, username, role, branch_id')
      .eq('username', username)
      .maybeSingle()

    let userId = existingProfile?.id ?? null

    if (existingProfile) {
      console.log(`  [exists] profile ${existingProfile.id} — تحديث الدور والربط`)
      const pe = await upsertProfile(existingProfile.id, { ...row, username }, branch)
      if (pe) {
        results.push({
          username,
          password: row.password,
          email,
          id: existingProfile.id,
          branch: branch.name,
          branch_id: branch.id,
          status: `failed profile: ${pe.message}`,
        })
        continue
      }
      await admin.auth.admin.updateUserById(existingProfile.id, {
        password: row.password,
        email_confirm: true,
        user_metadata: { full_name: `محاسب رئيسي — ${row.governorate}`, role: 'chief_accountant' },
      }).catch(() => {})
    } else {
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email,
        password: row.password,
        email_confirm: true,
        user_metadata: {
          full_name: `محاسب رئيسي — ${row.governorate}`,
          role: 'chief_accountant',
        },
      })

      if (authError || !authData?.user) {
        // ربما الإيميل موجود بدون profile
        console.error(`  [fail] createUser: ${authError?.message ?? 'unknown'}`)
        results.push({
          username,
          password: row.password,
          email,
          id: null,
          branch: branch.name,
          branch_id: branch.id,
          status: `failed auth: ${authError?.message ?? 'createUser'}`,
        })
        continue
      }

      userId = authData.user.id
      const pe = await upsertProfile(userId, { ...row, username }, branch)
      if (pe) {
        console.error(`  [fail] profile: ${pe.message}`)
        results.push({
          username,
          password: row.password,
          email,
          id: userId,
          branch: branch.name,
          branch_id: branch.id,
          status: `failed profile: ${pe.message}`,
        })
        continue
      }
    }

    const link = await ensureChiefLink(userId, branch.id)
    if (!link.ok) {
      console.error(`  [fail] chief_accountant_branches: ${link.error}`)
      results.push({
        username,
        password: row.password,
        email,
        id: userId,
        branch: branch.name,
        branch_id: branch.id,
        status: `failed link: ${link.error}`,
      })
      continue
    }

    console.log(`  [ok] id=${userId} link=${link.created ? 'inserted' : 'already'}`)
    results.push({
      username,
      password: row.password,
      email,
      id: userId,
      branch: branch.name,
      branch_id: branch.id,
      status: existingProfile ? 'updated' : 'created',
    })
  }

  console.log('\n========== النتائج ==========')
  console.log(
    '| اسم المستخدم | كلمة المرور | ID | الفرع المرتبط | الحالة |',
  )
  console.log('|---|---|---|---|---|')
  for (const r of results) {
    console.log(
      `| ${r.username} | ${r.password} | ${r.id ?? '—'} | ${r.branch}${r.branch_id ? ` (${r.branch_id})` : ''} | ${r.status} |`,
    )
  }
  console.log('\nJSON:')
  console.log(JSON.stringify(results, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
