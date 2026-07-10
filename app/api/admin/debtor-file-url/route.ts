import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'

export async function POST(request: Request) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  let path: string | undefined
  let fileId: string | undefined
  try {
    const body = await request.json()
    path = typeof body.path === 'string' ? body.path.trim() : undefined
    fileId = typeof body.fileId === 'string' ? body.fileId.trim() : undefined
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (!path && fileId) {
    const { data: row, error } = await admin
      .from('debtor_attachments')
      .select('file_path')
      .eq('id', fileId)
      .single()
    if (error || !row?.file_path) {
      return NextResponse.json({ error: 'الملف غير موجود' }, { status: 404 })
    }
    path = row.file_path
  }

  if (!path) {
    return NextResponse.json({ error: 'مسار الملف مطلوب' }, { status: 400 })
  }

  const { data, error } = await admin.storage.from('debtor-files').createSignedUrl(path, 3600)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ url: data.signedUrl })
}
