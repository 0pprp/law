/**
 * إنشاء حسابات مندوبي فرع بابل + تصدير Excel (اسم / يوزر / باسوورد).
 *
 *   node --env-file=.env.local scripts/create-babil-delegates.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import XLSX from 'xlsx'

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

const DELEGATES = [
  { full_name: 'علي صلاح', username: 'ali.salah' },
  { full_name: 'سرمد قاسم', username: 'sarmad.qasim' },
  { full_name: 'علي احمد', username: 'ali.ahmed' },
  { full_name: 'زيد حسين', username: 'zaid.hussein' },
  { full_name: 'يوسف فلاح', username: 'yousef.falah' },
  { full_name: 'منتظر غالب', username: 'muntadhar.ghalib' },
]

function usernameToInternalEmail(username) {
  return `${username.trim().toLowerCase()}@internal.qalat.local`
}

async function main() {
  const { data: branch, error: branchErr } = await admin
    .from('branches')
    .select('id, name, is_active')
    .eq('name', 'بابل')
    .maybeSingle()

  if (branchErr) throw new Error(branchErr.message)
  if (!branch) {
    console.error('فرع بابل غير موجود في قاعدة البيانات')
    process.exit(1)
  }
  if (branch.is_active === false) {
    await admin.from('branches').update({ is_active: true }).eq('id', branch.id)
  }

  console.log(`Branch: ${branch.name} (${branch.id})`)

  const results = []

  for (let i = 0; i < DELEGATES.length; i++) {
    const row = DELEGATES[i]
    const username = row.username.toLowerCase()
    const password = username // كلمة المرور مطابقة لليوزر لسهولة الدخول
    const phone = `0780${String(1000000 + i).slice(-7)}`

    const { data: existing } = await admin
      .from('profiles')
      .select('id, username, full_name, role, branch_id')
      .eq('username', username)
      .maybeSingle()

    if (existing) {
      console.log(`  [skip] ${username} already exists (${existing.full_name})`)
      results.push({
        full_name: row.full_name,
        username,
        password: '(موجود مسبقاً — لم تُغيَّر كلمة المرور)',
        status: 'skipped',
      })
      continue
    }

    const email = usernameToInternalEmail(username)
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: row.full_name, role: 'delegate' },
    })

    if (authError || !authData?.user) {
      console.error(`  [fail] ${username}: ${authError?.message ?? 'auth failed'}`)
      results.push({
        full_name: row.full_name,
        username,
        password,
        status: `failed: ${authError?.message ?? 'auth'}`,
      })
      continue
    }

    const profile = {
      username,
      full_name: row.full_name,
      phone,
      role: 'delegate',
      is_active: true,
      governorate: branch.name,
      branch_id: branch.id,
      identity_type: null,
      identity_number: null,
      identity_category: null,
      lawyer_type: 'normal',
      accountant_type: 'branch',
      branch_list_id: null,
    }

    let { error: profileError } = await admin
      .from('profiles')
      .update(profile)
      .eq('id', authData.user.id)

    if (profileError) {
      ;({ error: profileError } = await admin
        .from('profiles')
        .upsert({ id: authData.user.id, ...profile }))
    }

    if (profileError) {
      console.error(`  [fail profile] ${username}: ${profileError.message}`)
      await admin.auth.admin.deleteUser(authData.user.id)
      results.push({
        full_name: row.full_name,
        username,
        password,
        status: `failed: ${profileError.message}`,
      })
      continue
    }

    await admin.from('delegate_wallets').upsert(
      { delegate_id: authData.user.id },
      { onConflict: 'delegate_id', ignoreDuplicates: true },
    )

    console.log(`  [ok] ${row.full_name} → ${username}`)
    results.push({
      full_name: row.full_name,
      username,
      password,
      status: 'created',
    })
  }

  const sheetRows = results.map(r => ({
    'اسم المندوب': r.full_name,
    'اسم المستخدم': r.username,
    'كلمة المرور': r.password,
  }))

  const ws = XLSX.utils.json_to_sheet(sheetRows)
  ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'مندوبو بابل')

  const outPath = join(homedir(), 'Desktop', 'حسابات-مندوبي-بابل.xlsx')
  writeFileSync(outPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  console.log('\nResults:')
  for (const r of results) {
    console.log(`  ${r.status.padEnd(10)} ${r.full_name} | ${r.username} | ${r.password}`)
  }
  console.log(`\nExcel saved: ${outPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
