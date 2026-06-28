import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!['admin', 'employee', 'accountant', 'viewer'].includes(profile?.role ?? '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { path } = await request.json().catch(() => ({}))
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.storage.from('lawyer-files').createSignedUrl(path, 3600)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
}