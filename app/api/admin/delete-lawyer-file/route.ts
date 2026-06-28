import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'
import { isAccountant, isViewer, apiForbiddenResponse } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (isAccountant(profile?.role) || isViewer(profile?.role)) return apiForbiddenResponse()
  if (!['admin', 'employee'].includes(profile?.role ?? '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { fileId, filePath, fileName } = await request.json().catch(() => ({}))
  if (!fileId || !filePath) return NextResponse.json({ error: 'fileId and filePath required' }, { status: 400 })

  const admin = createAdminClient()

  const { error: storageErr } = await admin.storage.from('lawyer-files').remove([filePath])
  if (storageErr) return NextResponse.json({ error: storageErr.message }, { status: 500 })

  const { error: dbErr } = await admin.from('lawyer_attachments').delete().eq('id', fileId)
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  await logActivity({
    action: 'delete_lawyer_file',
    entity_type: 'file',
    entity_id: fileId,
    description: `حذف مستمسك محامي: ${fileName ?? filePath}`,
  }, supabase)

  return NextResponse.json({ ok: true })
}