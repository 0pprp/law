/**
 * تعيين مهمة «مرافعات» + تاريخ المرافعة من ملف Excel لمدينَين محددين.
 * التشغيل: npx tsx scripts/set-pleadings-from-xlsx.ts
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const EDITABLE = new Set(['waiting_assignment', 'pending_assignment', 'draft', 'new'])
const HEARING_YMD = '2026-08-18'
const NAMES = ['بهاء حامد حسن', 'علي عبد الحسين حميد']

function loadEnv() {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  let raw = readFileSync(path, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
}

function normalizeName(s: string) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function findPleadingDef(admin: ReturnType<typeof createClient>, branchId: string, caseType: string) {
  const { data: defs } = await admin
    .from('task_definitions')
    .select('id, label, task_type, fee_amount, case_type, branch_id, is_active')
    .eq('branch_id', branchId)
    .eq('is_active', true)

  const want = caseType === 'criminal' ? 'criminal' : 'civil'
  const pool = (defs ?? []).filter(d => {
    const ct = d.case_type === 'criminal' ? 'criminal' : 'civil'
    return ct === want
  })

  return (
    pool.find(d => d.task_type === 'pleading')
    ?? pool.find(d => String(d.label ?? '').includes('مرافع'))
    ?? null
  )
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')
  const admin = createClient(url, key, { auth: { persistSession: false } })

  // تأكيد محتوى الملف
  const xlsxPath = 'C:/Users/Marvel/Downloads/Telegram Desktop/مرافعات.xlsx'
  const wb = XLSX.readFile(xlsxPath)
  const rows = XLSX.utils.sheet_to_json<{ [k: string]: unknown }>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
  console.log('من الملف:')
  for (const r of rows) {
    console.log(' -', r['الاسم الكامل'], '|', r['موعد المرافعة'], '→', HEARING_YMD)
  }

  for (const name of NAMES) {
    console.log(`\n=== ${name} ===`)
    const { data: matches, error } = await admin
      .from('debtors')
      .select('id, full_name, branch_id, case_status, case_type, current_task_id, first_hearing_date')
      .ilike('full_name', name)
      .neq('case_status', 'closed')

    if (error) {
      console.error('بحث فشل:', error.message)
      continue
    }

    let debtors = matches ?? []
    if (!debtors.length) {
      // بحث مرن
      const { data: fuzzy } = await admin
        .from('debtors')
        .select('id, full_name, branch_id, case_status, case_type, current_task_id, first_hearing_date')
        .ilike('full_name', `%${name.split(' ')[0]}%`)
        .neq('case_status', 'closed')
        .limit(20)
      debtors = (fuzzy ?? []).filter(d => normalizeName(d.full_name) === name)
    }

    if (!debtors.length) {
      console.error('لم يُعثر على المدين')
      continue
    }
    if (debtors.length > 1) {
      console.log('عدة مطابقات — نأخذ الكل:')
      for (const d of debtors) console.log(' ', d.id, d.full_name, d.branch_id)
    }

    for (const debtor of debtors) {
      if (!debtor.branch_id) {
        console.error('بدون فرع:', debtor.id)
        continue
      }
      const caseType = debtor.case_type === 'criminal' ? 'criminal' : 'civil'
      const def = await findPleadingDef(admin, debtor.branch_id, caseType)
      if (!def) {
        console.error('لا تعريف مهمة مرافعات لهذا الفرع/النوع', debtor.branch_id, caseType)
        continue
      }
      console.log('تعريف المرافعات:', def.id, def.label, 'fee=', def.fee_amount)

      const fee = Number(def.fee_amount) || 0
      let taskId = debtor.current_task_id

      if (!taskId) {
        const { data: created, error: cErr } = await admin
          .from('tasks')
          .insert({
            debtor_id: debtor.id,
            task_definition_id: def.id,
            task_type: def.task_type ?? 'pleading',
            task_status: 'waiting_assignment',
            reward_amount: fee,
            branch_id: debtor.branch_id,
            assigned_to: null,
            due_date: HEARING_YMD,
          })
          .select('id')
          .single()
        if (cErr || !created) {
          console.error('فشل إنشاء مهمة:', cErr?.message)
          continue
        }
        taskId = created.id
        await admin.from('debtors').update({
          current_task_id: taskId,
          first_hearing_date: HEARING_YMD,
          case_status: 'active',
        } as any).eq('id', debtor.id)
        console.log('أُنشئت مهمة مرافعات:', taskId)
      } else {
        const { data: task } = await admin
          .from('tasks')
          .select('id, task_status, task_definition_id, assigned_to, task_type')
          .eq('id', taskId)
          .maybeSingle()

        if (!task) {
          console.error('المهمة الحالية مفقودة')
          continue
        }

        if (!EDITABLE.has(String(task.task_status ?? ''))) {
          // أنشئ مهمة مرافعات جديدة وربطها كـ current
          const { data: created, error: cErr } = await admin
            .from('tasks')
            .insert({
              debtor_id: debtor.id,
              task_definition_id: def.id,
              task_type: def.task_type ?? 'pleading',
              task_status: 'waiting_assignment',
              reward_amount: fee,
              branch_id: debtor.branch_id,
              assigned_to: null,
              due_date: HEARING_YMD,
            })
            .select('id')
            .single()
          if (cErr || !created) {
            console.error('فشل إنشاء مهمة جديدة (الحالية غير قابلة للتعديل):', cErr?.message, task.task_status)
            continue
          }
          await admin.from('debtors').update({
            current_task_id: created.id,
            last_task_id: taskId,
            first_hearing_date: HEARING_YMD,
            case_status: 'active',
          } as any).eq('id', debtor.id)
          taskId = created.id
          console.log('مهمة سابقة غير قابلة للتعديل — أُنشئت مرافعات جديدة:', taskId, '(السابقة:', task.task_status, ')')
        } else {
          const { error: uErr } = await admin
            .from('tasks')
            .update({
              task_definition_id: def.id,
              task_type: def.task_type ?? 'pleading',
              reward_amount: fee,
              assigned_to: null,
              task_status: 'waiting_assignment',
              due_date: HEARING_YMD,
            })
            .eq('id', taskId)
          if (uErr) {
            console.error('فشل تحديث المهمة:', uErr.message)
            continue
          }
          await admin.from('debtors').update({
            first_hearing_date: HEARING_YMD,
            case_status: 'active',
          } as any).eq('id', debtor.id)
          console.log('حُدّثت المهمة الحالية إلى مرافعات:', taskId)
        }
      }

      // تحقق نهائي
      const { data: verify } = await admin
        .from('debtors')
        .select(`
          id, full_name, first_hearing_date, current_task_id,
          current_task:tasks!debtors_current_task_id_fkey (
            id, task_type, task_status, due_date, task_definition_id
          )
        `)
        .eq('id', debtor.id)
        .single()
      console.log('تحقق:', JSON.stringify(verify, null, 2))
    }
  }

  console.log('\nتم.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
