import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff } from '@/lib/api-auth'
import { logActivity } from '@/lib/activity-log'

const MAX_BYTES = 15 * 1024 * 1024

export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error

  const formData = await request.formData()
  const file = formData.get('file')
  const debtorId = String(formData.get('debtorId') ?? '').trim()

  if (!debtorId) {
    return NextResponse.json({ error: 'معرّف المدين مطلوب' }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'ملف غير صالح' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'حجم الملف يتجاوز 15 ميجابايت' }, { status: 400 })
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'يجب أن يكون الملف بصيغة PDF فقط' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: debtor, error: debtorErr } = await admin
    .from('debtors')
    .select('id, branch_id')
    .eq('id', debtorId)
    .single()

  if (debtorErr || !debtor) {
    return NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 })
  }

  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  const filePath = `${debtorId}/${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await admin.storage
    .from('debtor-files')
    .upload(filePath, buffer, { contentType: 'application/pdf', upsert: false })

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  const { data: row, error: insertErr } = await admin
    .from('debtor_attachments')
    .insert({
      debtor_id: debtorId,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by: auth.user!.id,
    })
    .select('id, file_name, file_path, file_size, mime_type, created_at')
    .single()

  if (insertErr) {
    await admin.storage.from('debtor-files').remove([filePath])
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  await logActivity({
    action: 'upload_debtor_file',
    entity_type: 'debtor',
    entity_id: debtorId,
    description: `رفع ملف مدين: ${file.name}`,
  }, auth.supabase)

  return NextResponse.json({ ok: true, filePath, attachment: row })
}
