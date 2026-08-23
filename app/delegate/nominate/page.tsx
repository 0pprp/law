import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canNominateInstantCase } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import InstantCaseNominationForm from '@/components/InstantCaseNominationForm'

export default async function DelegateNominatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, accountant_type, branch_id, governorate')
    .eq('id', user.id)
    .single()

  if (!canNominateInstantCase(profile?.role, profile?.accountant_type)) {
    redirect('/delegate')
  }
  if (!profile?.branch_id) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        حسابك غير مربوط بفرع — تواصل مع الإدارة.
      </div>
    )
  }

  let governorateLabel = (profile.governorate ?? '').trim()
  if (!governorateLabel) {
    const { data: branch } = await supabase
      .from('branches')
      .select('name')
      .eq('id', profile.branch_id)
      .maybeSingle()
    governorateLabel = branch?.name ?? '—'
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="ترشيح اسم"
        subtitle="إرسال اسم دعوى فورية لموافقة مدير الفرع"
      />
      <InstantCaseNominationForm
        branchId={profile.branch_id}
        governorateLabel={governorateLabel}
      />
    </div>
  )
}
