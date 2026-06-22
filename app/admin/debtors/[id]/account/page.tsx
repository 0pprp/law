import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { TASK_TYPE_LABELS, RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { TaskType, ReceiptType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { fmtMoney, fmtDate } from '@/lib/utils'
import DebtorTasksPanel from '@/components/DebtorTasksPanel'
import DebtorNotesPanel from '@/components/DebtorNotesPanel'

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

  const [{ data: debtor }, { data: payments }, { data: expenses }, { data: files }] = await Promise.all([
    supabase.from('debtors').select('*').eq('id', id).single(),
    supabase.from('debtor_payments').select('*, lawyer:profiles!debtor_payments_lawyer_id_fkey(full_name)').eq('debtor_id', id).order('payment_date', { ascending: false }),
    supabase.from('expenses').select('*, task:tasks!expenses_task_id_fkey(task_type)').eq('debtor_id', id).order('expense_date', { ascending: false }),
    supabase.from('debtor_attachments').select('id, file_name, file_size, mime_type, created_at').eq('debtor_id', id).order('created_at', { ascending: false }),
  ])

  if (!debtor) notFound()

  const totalPaymentsSum = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0)
  const totalExpensesSum = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const collectionRate = Number(debtor.required_amount) > 0 ? Math.round((totalPaymentsSum / Number(debtor.required_amount)) * 100) : 0

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Hero header */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #231F20 0%, #1a1617 100%)' }}>
        <div className="absolute top-0 left-0 w-40 h-40 bg-white/[0.03] rounded-full -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-8 w-32 h-32 bg-[#2C8780]/10 rounded-full translate-y-1/2" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link href="/admin/accounts" className="text-white/40 hover:text-white/70 text-sm transition-colors">الحسابات</Link>
              <span className="text-white/20">/</span>
              <span className="text-white/50 text-sm">كشف الحساب</span>
            </div>
            <h1 className="text-2xl font-black text-white leading-tight">{debtor.full_name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {debtor.governorate && <span className="text-xs text-white/50">📍 {debtor.governorate}</span>}
              {debtor.phone_number && <span className="text-xs text-white/50 font-mono" dir="ltr">{debtor.phone_number}</span>}
              <Badge variant="default">{RECEIPT_TYPE_LABELS[debtor.receipt_type as ReceiptType] ?? debtor.receipt_type}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link href={`/admin/debtors/${id}/edit`} className="text-xs text-white/70 border border-white/20 hover:border-white/40 px-3 py-1.5 rounded-lg transition-colors">تعديل البيانات</Link>
            <Link href="/admin/payments" className="text-xs text-white px-3 py-1.5 rounded-lg transition-colors font-semibold hover:opacity-90" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>+ تسجيل تسديد</Link>
          </div>
        </div>
      </div>

      {/* Financial KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] p-4 shadow-sm">
          <p className="text-[10px] text-[#767676] mb-1.5">المبلغ المطلوب</p>
          <p className="text-xl font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(debtor.required_amount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-sm">
          <p className="text-[10px] text-[#767676] mb-1.5">إجمالي التسديدات</p>
          <p className="text-xl font-black text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(totalPaymentsSum)}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4 shadow-sm">
          <p className="text-[10px] text-[#767676] mb-1.5">المتبقي</p>
          <p className={`text-xl font-black tabular-nums ${Number(debtor.remaining_amount) > 0 ? 'text-red-600' : 'text-emerald-600'}`} dir="ltr">{fmtMoney(debtor.remaining_amount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] p-4 shadow-sm">
          <p className="text-[10px] text-[#767676] mb-1.5">نسبة التحصيل</p>
          <p className="text-xl font-black text-[#231F20] tabular-nums">{collectionRate}%</p>
          <div className="mt-1.5 h-1 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden">
            <div className="h-1 bg-emerald-500 rounded-full" style={{ width: `${Math.min(collectionRate, 100)}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Debtor info */}
        <Card className="lg:col-span-1">
          <CardHeader title="معلومات المدين" />
          <div className="p-4">
            <InfoRow label="رقم الهوية" value={debtor.id_number} mono />
            <InfoRow label="نوع الصك" value={RECEIPT_TYPE_LABELS[debtor.receipt_type as ReceiptType]} />
            <InfoRow label="رقم الصك" value={debtor.receipt_number} mono />
            <InfoRow label="مبلغ الصك" value={fmtMoney(debtor.receipt_amount)} />
            <InfoRow label="الشرط الجزائي" value={fmtMoney(debtor.penalty_amount)} />
            <InfoRow label="الصرفيات" value={fmtMoney(totalExpensesSum)} />
            <InfoRow label="أتعاب المحامين" value={fmtMoney(debtor.lawyer_fees)} />
            {debtor.address && <InfoRow label="العنوان" value={debtor.address} />}
            {debtor.employer && <InfoRow label="جهة العمل" value={debtor.employer} />}
            {debtor.export_date && <InfoRow label="تاريخ الإصدار" value={fmtDate(debtor.export_date)} mono />}
            <InfoRow label="تاريخ الإضافة" value={fmtDate(debtor.created_at)} mono />
          </div>
        </Card>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-5">

          {/* Payments */}
          <Card>
            <CardHeader
              title={`التسديدات (${payments?.length ?? 0})`}
              action={<span className="text-sm font-black text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(totalPaymentsSum)}</span>}
            />
            {!(payments?.length) ? (
              <div className="py-8 text-center text-[#767676] text-sm">لا توجد تسديدات</div>
            ) : (
              <div className="divide-y divide-[rgba(118,118,118,0.08)]">
                {payments!.map((p: any) => (
                  <div key={p.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(Number(p.amount))}</p>
                      <p className="text-xs text-[#767676] mt-0.5">
                        {[p.lawyer?.full_name ?? 'بدون محامي', p.payment_method, p.receipt_number ? `وصل: ${p.receipt_number}` : null, p.notes].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">{fmtDate(p.payment_date)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Expenses */}
          <Card>
            <CardHeader
              title={`الصرفيات (${expenses?.length ?? 0})`}
              action={<span className="text-sm font-black text-red-600 tabular-nums" dir="ltr">{fmtMoney(totalExpensesSum)}</span>}
            />
            {!(expenses?.length) ? (
              <div className="py-8 text-center text-[#767676] text-sm">لا توجد صرفيات</div>
            ) : (
              <div className="divide-y divide-[rgba(118,118,118,0.08)]">
                {expenses!.map((e: any) => (
                  <div key={e.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-600 tabular-nums" dir="ltr">{fmtMoney(Number(e.amount))}</p>
                      <p className="text-xs text-[#767676] mt-0.5">
                        {[e.expense_type, e.description, e.task?.task_type ? TASK_TYPE_LABELS[e.task.task_type as TaskType] : null].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">{fmtDate(e.expense_date)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Tasks — managed by client component */}
          <DebtorTasksPanel debtorId={id} />

          {/* Notes */}
          <DebtorNotesPanel debtorId={id} />

          {/* Files */}
          {files && files.length > 0 && (
            <Card>
              <CardHeader title={`المستمسكات (${files.length})`} />
              <div className="divide-y divide-[rgba(118,118,118,0.08)]">
                {files.map((f: any) => (
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
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}