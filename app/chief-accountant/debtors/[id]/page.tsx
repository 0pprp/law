import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { ReceiptType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { fmtMoney, fmtDate } from '@/lib/utils'
import {
  RECEIPT_NUMBER_LABEL,
  RECEIPT_TYPE_LABEL,
  RECEIPT_AMOUNT_LABEL,
} from '@/lib/ui-labels'
import DebtorNotesPanel from '@/components/DebtorNotesPanel'
import DebtorAttachmentsList from '@/components/DebtorAttachmentsList'
import DebtorPetitionButton from '@/components/DebtorPetitionButton'
import { BackButton } from '@/components/ui/back-button'
import { isAssignedToChief } from '@/lib/chief-accountant-access'
import {
  fetchCriminalDebtorDetails,
  displayCriminalAmountText,
} from '@/lib/criminal-debtor-details'
import ChiefAccountantUploadButton from '@/components/ChiefAccountantUploadButton'

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2 py-2.5 border-b border-[rgba(118,118,118,0.08)] last:border-0">
      <span className="text-xs text-[#767676] shrink-0">{label}</span>
      <span className={`text-sm text-[#231F20] font-semibold text-left ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>
        {value ?? '—'}
      </span>
    </div>
  )
}

export default async function ChiefAccountantDebtorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: debtor } = await admin
    .from('debtors')
    .select('*, branch_list:branch_lists(name, court_name, execution_office)')
    .eq('id', id)
    .maybeSingle()

  if (!debtor) notFound()
  if (!isAssignedToChief(user.id, debtor)) notFound()

  const [{ data: files }, { data: branch }] = await Promise.all([
    admin
      .from('debtor_attachments')
      .select('id, file_name, file_path, file_size, mime_type, created_at')
      .eq('debtor_id', id)
      .order('created_at', { ascending: false }),
    debtor.branch_id
      ? admin.from('branches').select('name').eq('id', debtor.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const isCriminal = debtor.case_type === 'criminal'
  const criminalDetails = isCriminal ? await fetchCriminalDebtorDetails(admin, id) : null

  const listEmbed = Array.isArray(debtor.branch_list) ? debtor.branch_list[0] : debtor.branch_list
  const courtName = (debtor.court_name as string | null)?.trim()
    || (listEmbed as { court_name?: string | null } | null)?.court_name
    || '—'

  let lawyerNameForPetition: string | null = null
  if (debtor.current_task_id) {
    const { data: currentTask } = await admin
      .from('tasks')
      .select('assigned_to')
      .eq('id', debtor.current_task_id)
      .maybeSingle()
    if (currentTask?.assigned_to) {
      const { data: lawyer } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', currentTask.assigned_to)
        .maybeSingle()
      lawyerNameForPetition = lawyer?.full_name?.trim() || null
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-10">
      <div className="flex items-center justify-between gap-2">
        <BackButton fallback="/chief-accountant/tasks" />
        <div className="flex flex-wrap items-center gap-2">
          <DebtorPetitionButton
            debtorId={id}
            defaults={{
              courtName: courtName !== '—' ? courtName : '',
              defendantName: debtor.full_name,
              defendantAddress: isCriminal
                ? (criminalDetails?.current_address ?? debtor.address ?? '')
                : (debtor.address ?? ''),
              amount: isCriminal
                ? Number(criminalDetails?.amount_owed ?? debtor.remaining_amount ?? debtor.receipt_amount ?? 0)
                : Number(debtor.remaining_amount ?? debtor.required_amount ?? 0),
              lawyerName: lawyerNameForPetition,
            }}
          />
          <Link
            href={`/chief-accountant/debtors/${id}/edit`}
            className="text-xs font-bold text-white px-3 py-2 rounded-lg"
            style={{ background: 'linear-gradient(135deg,#0369a1,#0c4a6e)' }}
          >
            تعديل البيانات
          </Link>
        </div>
      </div>

      <div
        className="rounded-2xl p-5 text-white shadow-md"
        style={{ background: 'linear-gradient(145deg,#0c4a6e 0%,#0369a1 55%,#231F20 100%)' }}
      >
        <h1 className="text-xl font-black leading-tight">{debtor.full_name}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Badge variant="default">{isCriminal ? 'جزائي' : 'مدني'}</Badge>
          {branch?.name && <span className="text-xs text-white/60">🏢 {branch.name}</span>}
          {debtor.phone && <span className="text-xs text-white/60 font-mono" dir="ltr">{debtor.phone}</span>}
          {debtor.file_preparation_status === 'preparing' && (
            <span className="text-[10px] font-bold bg-amber-400/20 text-amber-100 border border-amber-300/30 px-2 py-0.5 rounded-full">
              قيد التجهيز
            </span>
          )}
          {debtor.file_preparation_status === 'ready' && (
            <span className="text-[10px] font-bold bg-emerald-400/20 text-emerald-100 border border-emerald-300/30 px-2 py-0.5 rounded-full">
              جاهز
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm px-4 py-2">
        {!isCriminal ? (
          <>
            <InfoRow label="العنوان" value={debtor.address} />
            <InfoRow label="رقم الهوية" value={debtor.id_number} mono />
            <InfoRow label={RECEIPT_TYPE_LABEL} value={RECEIPT_TYPE_LABELS[debtor.receipt_type as ReceiptType] ?? debtor.receipt_type} />
            <InfoRow label={RECEIPT_NUMBER_LABEL} value={debtor.receipt_number} mono />
            <InfoRow label={RECEIPT_AMOUNT_LABEL} value={fmtMoney(Number(debtor.receipt_amount ?? 0))} />
            <InfoRow label="المتبقي" value={fmtMoney(Number(debtor.remaining_amount ?? 0))} />
            <InfoRow label="المطلوب" value={fmtMoney(Number(debtor.required_amount ?? 0))} />
            <InfoRow label="المحكمة" value={courtName} />
            <InfoRow label="تاريخ الإضافة" value={fmtDate(debtor.created_at)} />
          </>
        ) : (
          <>
            <InfoRow label="العنوان الحالي" value={criminalDetails?.current_address ?? debtor.address} />
            <InfoRow label="المبلغ" value={displayCriminalAmountText(criminalDetails?.amount_owed, debtor.remaining_amount, debtor.receipt_amount)} />
            <InfoRow label="المحكمة" value={courtName} />
            <InfoRow label="تاريخ الإضافة" value={fmtDate(debtor.created_at)} />
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(118,118,118,0.08)]">
          <h2 className="text-sm font-bold text-[#231F20]">المرفقات ({files?.length ?? 0})</h2>
          <ChiefAccountantUploadButton debtorId={id} />
        </div>
        <div className="p-3">
          <DebtorAttachmentsList files={files ?? []} allowDelete />
        </div>
      </div>

      <DebtorNotesPanel debtorId={id} profileNotes={debtor.notes} />
    </div>
  )
}
