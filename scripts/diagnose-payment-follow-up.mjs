/**
 * تشخيص: لماذا لا يرى مسؤول متابعة التسديد المدينين في جاري التسديد؟
 * يفحص: وجود مدينين بالحالة، وجود سياسات RLS، ورؤية الدور فعلياً عبر anon.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

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
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !serviceKey) {
  console.log('FAIL: بيانات Supabase غير موجودة في .env.local')
  process.exit(1)
}

const admin = createClient(url, serviceKey)

// 1) هل يوجد مدينون في جاري التسديد؟ (service role يتجاوز RLS)
const { data: pip, error: pipErr } = await admin
  .from('debtors')
  .select('id, full_name, branch_id, case_status, payment_type, payment_location')
  .eq('case_status', 'payment_in_progress')

console.log('--- 1) المدينون في جاري التسديد (service role) ---')
if (pipErr) console.log('خطأ:', pipErr.message)
else {
  console.log('العدد:', pip.length)
  for (const d of pip) console.log(` - ${d.full_name} | branch=${d.branch_id} | type=${d.payment_type} | loc=${d.payment_location}`)
}

// 2) هل سياسات RLS الخاصة بالدور موجودة؟
console.log('\n--- 2) سياسات RLS payment_follow_up ---')
const { data: pols, error: polErr } = await admin.rpc('exec_sql', {
  sql: "select policyname, tablename from pg_policies where policyname like 'payment_follow_up%'",
}).then(r => r, () => ({ data: null, error: { message: 'rpc exec_sql غير متاح' } }))
if (polErr) {
  // بديل: جرّب قراءة pg_policies مباشرة (غالباً غير متاح عبر PostgREST)
  console.log('لا يمكن فحص pg_policies عبر API:', polErr.message)
} else {
  console.log(pols)
}

// 3) اختبار عملي: تسجيل دخول بمستخدم متابعة التسديد وقراءة الجدول عبر anon (RLS مفعّل)
console.log('\n--- 3) الرؤية الفعلية لمستخدم متابعة التسديد ---')
const { data: fuProfiles } = await admin
  .from('profiles')
  .select('id, full_name, role, username')
  .eq('role', 'payment_follow_up')

if (!fuProfiles?.length) {
  console.log('لا يوجد أي مستخدم بدور payment_follow_up في profiles')
} else {
  console.log('مستخدمو الدور:', fuProfiles.map(p => `${p.full_name} (${p.username ?? p.id})`).join(', '))
  const { data: authUser } = await admin.auth.admin.getUserById(fuProfiles[0].id)
  const email = authUser?.user?.email
  console.log('البريد:', email)

  if (anonKey && email) {
    // إنشاء جلسة عبر رابط سحري وليس كلمة سر (لا نعرفها) — نستخدم توليد access token عبر admin
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (linkErr) {
      console.log('تعذر توليد رابط دخول:', linkErr.message)
    } else {
      const anon = createClient(url, anonKey)
      const { data: verData, error: verErr } = await anon.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: 'magiclink',
      })
      if (verErr || !verData.session) {
        console.log('تعذر تسجيل الدخول:', verErr?.message)
      } else {
        const userClient = createClient(url, anonKey, {
          global: { headers: { Authorization: `Bearer ${verData.session.access_token}` } },
        })
        const { data: seen, error: seenErr } = await userClient
          .from('debtors')
          .select('id, full_name, branch_id')
          .eq('case_status', 'payment_in_progress')
        if (seenErr) console.log('خطأ قراءة عبر RLS:', seenErr.message)
        else console.log(`ما يراه المستخدم عبر RLS: ${seen.length} مدين`, seen.map(s => s.full_name))

        const { data: brSeen, error: brErr } = await userClient.from('branches').select('id, name')
        if (brErr) console.log('خطأ قراءة الفروع عبر RLS:', brErr.message)
        else console.log(`الفروع المرئية: ${brSeen.length}`)
      }
    }
  }
}
console.log('\nDONE')
