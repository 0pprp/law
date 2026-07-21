import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { logActivity } from '@/lib/activity-log'
import { requireLawyerInScope } from '@/lib/section-guard'

const MAX_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const callerRole = auth.profile?.role
  if (callerRole !== 'admin' && callerRole !== 'viewer') {
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  const lawyerId = String(formData.get('lawyerId') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null

  if (!lawyerId) {
    return NextResponse.json({ error: 'lawyerId مطلوب' }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'ملف غير صالح' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'حجم الملف يتجاوز 15 ميجابايت' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'نوع الملف غير مدعوم — PDF أو صور فقط' }, { status: 400 })
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireLawyerInScope(admin, scope, lawyerId, 'id, role, case_type, branch_id')
  if (!gate.ok) return gate.error

  const lawyerProfile = gate.data as { id: string; role: string }
  if (lawyerProfile.role !== 'lawyer') {
    return NextResponse.json({ error: 'المستمسكات تُرفع للمحامين فقط' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const rawExt = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^\w]/g, '')
  const mimeExt =
    file.type === 'application/pdf' ? 'pdf'
      : file.type === 'image/png' ? 'png'
        : file.type === 'image/webp' ? 'webp'
          : file.type === 'image/gif' ? 'gif'
            : (file.type === 'image/jpeg' || file.type === 'image/jpg') ? 'jpg'
              : rawExt || 'bin'
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${mimeExt}`
  const filePath = `${lawyerId}/${safeName}`

  const { error: uploadErr } = await admin.storage
    .from('lawyer-files')
    .upload(filePath, buffer, { contentType: file.type, upsert: false })

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  const { data: row, error: insertErr } = await admin
    .from('lawyer_attachments')
    .insert({
      lawyer_id: lawyerId,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type,
      description,
      uploaded_by: auth.user!.id,
    })
    .select('id, file_name, file_path, file_size, mime_type, description, created_at')
    .single()

  if (insertErr) {
    await admin.storage.from('lawyer-files').remove([filePath])
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  await logActivity({
    action: 'upload_lawyer_file',
    entity_type: 'lawyer',
    entity_id: lawyerId,
    description: `رفع مستمسك محامي: ${file.name}`,
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, attachment: row })
}
