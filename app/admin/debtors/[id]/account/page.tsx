import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { TASK_TYPE_LABELS, RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { TaskType, ReceiptType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { RECEIPT_NUMBER_LABEL, LEGAL_ISSUE_DATE_LABEL, RECEIPT_TYPE_LABEL, RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'
import DebtorTasksHistory from '@/components/DebtorTasksHistory'
import DebtorNotesPanel from '@/components/DebtorNotesPanel'
import DebtorGPSCard from '@/components/DebtorGPSCard'
import DebtorActivityPanel from '@/components/DebtorActivityPanel'
import DebtorArchiveTabs from '@/components/DebtorArchiveTabs'
import DebtorAccountPaymentButton from '@/components/DebtorAccountPaymentButton'
import DebtorPaymentsPanel from '@/components/DebtorPaymentsPanel'
import DebtorExpensesList from '@/components/DebtorExpensesList'
import { canEditRecords, canReadAdminData, canAddPayments } from '@/lib/permissions'
import type { UserRole } from '@/lib/types'

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2 py-2.5 border-b border-[rgba(118,118,118,0.08)] last:border-0">
      <span className="text-xs text-[#767676] shrink-0">{label}</span>
      <span className={`text-sm text-[#231F20] font-semibold text-left ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>{value ?? '—'}</span>
    </div>
  )
}

export default async function DebtorAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role, branch_id').eq('id', user.id).single()
    : { data: null }

  const userRole = (profile?.role ?? 'employee') as UserRole
  const allowEdit = canEditRecords(userRole)
  const allowPayments = canAddPayments(userRole)

  const [{ data: debtor }, { data: payments }, { data: expenses }, { data: files }, { data: taskRows }] = await Promise.all([
    supabase.from('debtors').select('*, branch_list:branch_lists(name)').eq('id', id).single(),
    supabase.from('debtor_payments').select('*').eq('debtor_id', id).order('payment_date', { ascending: false }),
    supabase.from('expenses').select('*, task:tasks!expenses_task_id_fkey(task_type)').eq('debtor_id', id).order('expense_date', { ascending: false }),
    supabase.from('debtor_attachments').select('id, file_name, file_size, mime_type, created_at').eq('debtor_id', id).order('created_at', { ascending: false }),
    supabase.from('tasks').select('id').eq('debtor_id', id),
  ])

  if (!debtor) notFound()

  if (!canReadAdminData(userRole) && profile?.branch_id && debtor.branch_id !== profile.branch_id) {
    notFound()
  }

  const taskIds = (taskRows ?? []).map(t => t.id)
  const totalPaymentsSum = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0)
  const totalExpensesSum = (expenses ?? []).filter(e => e.status === 'approved' || e.status == null).reduce((s, e) => s + Number(e.amount), 0)
  const totalOwed = Number(debtor.required_amount ?? 0)
  const collectionRate = totalOwed > 0 ? Math.round((totalPaymentsSum / totalOwed) * 100) : 0

  const overviewTab = (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="المبلغ المطلوب" value={fmtMoney(debtor.required_amount)} accent="teal" valueColor="text-[#2C8780]" />
        <StatCard label="إجمالي التسديدات" value={fmtMoney(totalPaymentsSum)} accent="green" valueColor="text-emerald-700" />
        <StatCard
          label="المتبقي"
          value={fmtMoney(debtor.remaining_amount)}
          accent={Number(debtor.remaining_amount) > 0 ? 'red' : 'green'}
          valueColor={Number(debtor.remaining_amount) > 0 ? 'text-red-600' : 'text-emerald-600'}
        />
        <StatCard
          label="نسبة التحصيل"
          value={`${collectionRate}%`}
          footer={
            <div className="h-1.5 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden">
              <div className="h-1.5 bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(collectionRate, 100)}%` }} />
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="معلومات المدين" />
          <div className="p-4">
            <InfoRow label="رقم الهوية" value={debtor.id_number} mono />
            <InfoRow label={RECEIPT_TYPE_LABEL} value={RECEIPT_TYPE_LABELS[debtor.receipt_type as ReceiptType]} />
            <InfoRow label={RECEIPT_NUMBER_LABEL} value={debtor.receipt_number} mono />
            <InfoRow label={RECEIPT_AMOUNT_LABEL} value={fmtMoney(debtor.receipt_amount)} />
            <InfoRow label="الشرط الجزائي" value={fmtMoney(debtor.penalty_amount)} />
            <InfoRow
              label="الوصل موقّع لتحمّل التكاليف القانونية"
              value={debtor.receipt_signed_legal_costs ? 'نعم' : 'لا'}
            />
            <InfoRow label="الصرفيات" value={fmtMoney(totalExpensesSum)} />
            <InfoRow label="أتعاب المحامين" value={fmtMoney(debtor.lawyer_fees)} />
            <InfoRow label="أتعاب مسؤول القانونية" value={fmtMoney(debtor.legal_manager_fees ?? 0)} />
            <InfoRow
              label="القائمة"
              value={(debtor as { branch_list?: { name?: string } | null }).branch_list?.name ?? '—'}
            />
            {debtor.address && <InfoRow label="العنوان" value={debtor.address} />}
            {debtor.export_date && <InfoRow label={LEGAL_ISSUE_DATE_LABEL} value={fmtDate(debtor.export_date)} mono />}
            <InfoRow label="تاريخ الإضافة" value={fmtDate(debtor.created_at)} mono />
          </div>
        </Card>
        <DebtorNotesPanel debtorId={id} />
      </div>
    </div>
  )

  const paymentsTab = (
    <Card>
      <CardHeader title={`التسديدات (${payments?.length ?? 0})`} />
      <DebtorPaymentsPanel
        debtorId={id}
        debtorName={debtor.full_name}
        initialPayments={(payments ?? []).map(p => ({
          id: p.id,
          amount: Number(p.amount),
          notes: p.notes,
          payment_date: p.payment_date,
        }))}
      />
    </Card>
  )

  const expensesTab = (
    <Card>
      <CardHeader
        title={`الصرفيات (${expenses?.length ?? 0})`}
        action={<span className="text-sm font-black text-red-600 tabular-nums" dir="ltr">{fmtMoney(totalExpensesSum)}</span>}
      />
      {!(expenses?.length) ? (
        <div className="py-8 text-center text-[#767676] text-sm">لا توجد صرفيات</div>
      ) : (
        <DebtorExpensesList expenses={expenses as any} />
      )}
    </Card>
  )

  const attachmentsTab = (
    <Card>
      <CardHeader title={`المستمسكات (${files?.length ?? 0})`} />
      {!(files?.length) ? (
        <div className="py-8 text-center text-[#767676] text-sm">لا توجد مرفقات</div>
      ) : (
        <div className="divide-y divide-[rgba(118,118,118,0.08)]">
          {files!.map((f: { id: string; file_name: string; created_at: string }) => (
            <div key={f.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 bg-[rgba(44,135,128,0.08)] rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[#2C8780]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <p className="text-sm text-[#231F20] truncate">{f.file_name}</p>
              </div>
              <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">{fmtDate(f.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  const gpsTab = (
    <DebtorGPSCard
      debtorId={id}
      latitude={debtor.latitude ?? null}
      longitude={debtor.longitude ?? null}
      locationCapturedAt={debtor.location_captured_at ?? null}
      readOnly={!allowEdit}
    />
  )

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #231F20 0%, #1a1617 100%)' }}>
        <div className="absolute top-0 left-0 w-40 h-40 bg-white/[0.03] rounded-full -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-8 w-32 h-32 bg-[#2C8780]/10 rounded-full translate-y-1/2" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link href="/admin/accounts" className="text-white/40 hover:text-white/70 text-sm transition-colors">الحسابات</Link>
              <span className="text-white/20">/</span>
              <span className="text-white/50 text-sm">أرشيف المدين</span>
            </div>
            <h1 className="text-2xl font-black text-white leading-tight">{debtor.full_name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {debtor.governorate && <span className="text-xs text-white/50">📍 {debtor.governorate}</span>}
              {debtor.phone && <span className="text-xs text-white/50 font-mono" dir="ltr">{debtor.phone}</span>}
              <Badge variant="default">{RECEIPT_TYPE_LABELS[debtor.receipt_type as ReceiptType] ?? debtor.receipt_type}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {allowEdit && (
              <Link href={`/admin/debtors/${id}/edit`} className="text-xs text-white/70 border border-white/20 hover:border-white/40 px-3 py-1.5 rounded-lg transition-colors">تعديل البيانات</Link>
            )}
            {allowPayments && (
              <DebtorAccountPaymentButton
                debtorId={id}
                debtorName={debtor.full_name}
                receiptNumber={debtor.receipt_number ?? null}
                remainingAmount={Number(debtor.remaining_amount ?? 0)}
                branchId={debtor.branch_id ?? null}
              />
            )}
          </div>
        </div>
      </div>

      <DebtorArchiveTabs
        overview={overviewTab}
        tasks={<DebtorTasksHistory debtorId={id} fullArchive />}
        attachments={attachmentsTab}
        expenses={expensesTab}
        payments={paymentsTab}
        gps={gpsTab}
        activity={<DebtorActivityPanel debtorId={id} taskIds={taskIds} />}
      />
    </div>
  )
}
