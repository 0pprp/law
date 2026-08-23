'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminRoleState } from '@/context/admin-role'
import { canNominateInstantCase } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import InstantCaseNominationForm from '@/components/InstantCaseNominationForm'
import PermissionDenied from '@/components/PermissionDenied'

export default function AdminNominatePage() {
  const { role, accountantType } = useAdminRoleState()
  const [branchId, setBranchId] = useState<string | null>(null)
  const [governorateLabel, setGovernorateLabel] = useState('—')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) {
        setLoading(false)
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('branch_id, governorate')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      const bid = profile?.branch_id ?? null
      setBranchId(bid)
      let gov = (profile?.governorate ?? '').trim()
      if (!gov && bid) {
        const { data: branch } = await supabase.from('branches').select('name').eq('id', bid).maybeSingle()
        gov = branch?.name ?? '—'
      }
      setGovernorateLabel(gov || '—')
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  if (!canNominateInstantCase(role, accountantType)) {
    return <PermissionDenied message="ترشيح الأسماء للمندوب أو محاسب الفرع فقط." />
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="ترشيح اسم"
        subtitle="إرسال اسم دعوى فورية لموافقة مدير الفرع"
        actions={<BackButton fallback="/admin/dashboard" />}
      />
      {loading ? (
        <p className="text-sm text-slate-500">جاري التحميل…</p>
      ) : !branchId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          حسابك غير مربوط بفرع.
        </div>
      ) : (
        <InstantCaseNominationForm branchId={branchId} governorateLabel={governorateLabel} />
      )}
    </div>
  )
}
