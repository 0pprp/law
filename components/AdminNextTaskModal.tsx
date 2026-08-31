'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import { extractGpsFromCompletion, parseGps } from '@/lib/task-approval'
import { taskTransitionViaApi, isNextActionAlreadyDoneError } from '@/lib/task-operations-api'
import { isFileLawsuitTask, pickPleadingDefinition } from '@/lib/default-next-task'
import { fetchActiveTaskDefinitions } from '@/lib/task-definitions'
import { useAdminRole } from '@/context/admin-role'
import { canMoveToPaymentInProgress } from '@/lib/permissions'
import { normalizeCaseType } from '@/lib/case-type'
import { PremiumSelect } from '@/components/ui/premium-select'
import MoveToPaymentInProgressModal from '@/components/MoveToPaymentInProgressModal'
import { visibleTaskFeeAmount } from '@/lib/visible-task-fee'
import { appAlert } from '@/lib/app-dialog'

type TaskDef = {
  id: string
  label: string
  sort_order?: number
  fee_amount: number
  branch_id?: string | null
  case_type?: string | null
  task_type?: string | null
}

function unwrapDef(raw: unknown): { label?: string | null } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as { label?: string | null }) ?? null
  return raw as { label?: string | null }
}

function gpsKeysFromCompletion(data: Record<string, string> | null | undefined): string[] {
  if (!data) return []
  return Object.keys(data).filter(k => parseGps(String(data[k] ?? '')))
}

export default function AdminNextTaskModal({
  task,
  onClose,
  onDone,
}: {
  task: Record<string, any>
  onClose: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const role = useAdminRole()
  const allowPaymentInProgress = canMoveToPaymentInProgress(role)
  const [defs, setDefs] = useState<TaskDef[]>([])
  const [loadingDefs, setLoadingDefs] = useState(true)
  const [nextTaskId, setNextTaskId] = useState('')
  const [updateGps, setUpdateGps] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const autoLawsuitRef = useRef(false)

  const def = unwrapDef(task.task_definitions)
  const taskLabel = def?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)
  const debtor = task.debtors as any
  const gpsKeys = gpsKeysFromCompletion(task.completion_data as Record<string, string> | null)
  const newGps = extractGpsFromCompletion(task.completion_data as Record<string, string>, gpsKeys)
  const hasExistingGps = debtor?.latitude != null && debtor?.longitude != null
  const showGpsUpdate = hasExistingGps && newGps != null
  const debtorCaseType = normalizeCaseType(debtor?.case_type)
  const scopedDefs = defs.filter(d => {
    if (task.branch_id && d.branch_id && d.branch_id !== task.branch_id) return false
    return normalizeCaseType(d.case_type) === debtorCaseType
  })
  const defaultPleading = isFileLawsuitTask({ ...task, task_definitions: def, label: def?.label })
    ? pickPleadingDefinition(scopedDefs, { branchId: task.branch_id, caseType: debtorCaseType })
    : null

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingDefs(true)
      const data = await fetchActiveTaskDefinitions(
        createClient(),
        task.branch_id ?? null,
        'id, label, sort_order, fee_amount, branch_id, case_type, task_type',
      )
      if (cancelled) return
      setDefs((data ?? []) as TaskDef[])
      setLoadingDefs(false)
    })()
    return () => { cancelled = true }
  }, [task.branch_id])

  async function proceedWithTransition(action: 'next' | 'close', forcedNextId?: string) {
    const chosenNext = forcedNextId || nextTaskId
    if (action === 'next' && !chosenNext) {
      setError('يجب اختيار المهمة اللاحقة')
      return
    }
    setSaving(true)
    setError('')

    const result = await taskTransitionViaApi({
      taskId: task.id,
      action,
      nextTaskDefId: action === 'next' ? chosenNext : undefined,
      updateGps: showGpsUpdate ? updateGps : false,
    })

    if (!result.ok) {
      if (isNextActionAlreadyDoneError(result.error)) {
        setSaving(false)
        onDone()
        onClose()
        return
      }
      setError(result.error ?? 'فشل تحديث المرحلة')
      setSaving(false)
      return
    }

    const nextDef = defs.find(d => d.id === chosenNext)
    if (action === 'close') {
      void logActivity({
        action: 'close_case',
        entity_type: 'debtor',
        entity_id: task.debtor_id,
        description: `إغلاق قضية ${debtor?.full_name ?? '—'} — آخر مهمة: ${taskLabel}`,
        case_type: normalizeCaseType(debtor?.case_type),
      }, supabase)
    } else {
      void logActivity({
        action: 'approve_task_transition',
        entity_type: 'task',
        entity_id: task.id,
        description: `اعتماد "${taskLabel}" للمدين ${debtor?.full_name ?? '—'} والانتقال إلى "${nextDef?.label}"`,
        case_type: normalizeCaseType(debtor?.case_type),
      }, supabase)
    }

    setSaving(false)
    onDone()
    onClose()
  }

  useEffect(() => {
    const currentId = debtor?.current_task_id ?? null
    const lastId = debtor?.last_task_id ?? null
    const status = debtor?.case_status ?? null
    const already =
      (currentId != null && currentId !== task.id)
      || lastId === task.id
      || status === 'closed'
      || status === 'payment_in_progress'
    if (already) {
      onDone()
      onClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  useEffect(() => {
    if (autoLawsuitRef.current) return
    if (!defaultPleading) return
    autoLawsuitRef.current = true
    setNextTaskId(defaultPleading.id)
    void proceedWithTransition('next', defaultPleading.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPleading?.id])

  async function handlePaymentSuccess() {
    setShowPaymentModal(false)
    await appAlert({
      title: 'تم التحويل',
      message: `تم نقل «${debtor?.full_name ?? 'المدين'}» إلى جاري التسديد بنجاح.`,
      variant: 'success',
    })
    onDone()
    onClose()
  }

  if (defaultPleading && !error) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}>
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center" dir="rtl">
          <p className="text-sm font-bold text-[#231F20]">جارٍ إنشاء مهمة المرافعات تلقائياً...</p>
          <p className="text-xs text-[#767676] mt-2">{debtor?.full_name ?? '—'} · {defaultPleading.label}</p>
          {saving && (
            <svg className="w-6 h-6 animate-spin text-[#2C8780] mx-auto mt-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}>
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]" dir="rtl">
          <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)]">
            <h2 className="font-black text-[#231F20] text-base">اختر المهمة التالية</h2>
            <p className="text-xs text-[#767676] mt-0.5">
              أُنجزت واعتُمدت: <span className="font-bold text-[#2C8780]">{taskLabel}</span>
              {' · '}{debtor?.full_name ?? '—'}
            </p>
          </div>

          <div className="overflow-y-auto flex-1 p-4 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-[#767676]">أ) اختيار مهمة لاحقة</p>
              <PremiumSelect
                value={nextTaskId}
                onChange={v => { setNextTaskId(v); setError('') }}
                options={scopedDefs.map(d => {
                  const visibleFee = visibleTaskFeeAmount(d.fee_amount, debtorCaseType, role)
                  return {
                    value: d.id,
                    label: d.label,
                    hint: visibleFee ? `${visibleFee.toLocaleString('en-US')} د.ع أتعاب` : undefined,
                  }
                })}
                placeholder={loadingDefs ? 'جارٍ تحميل المهام...' : '— اختر المهمة التالية —'}
                headerTitle="المهمة اللاحقة"
                headerSubtitle={`${scopedDefs.length} مهمة متاحة`}
                searchPlaceholder="بحث في المهام..."
                disabled={loadingDefs || saving}
              />
              <button
                onClick={() => proceedWithTransition('next')}
                disabled={saving || !nextTaskId}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
              >
                {saving ? 'جارٍ الحفظ...' : 'تأكيد المهمة اللاحقة'}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
              <span className="text-[10px] text-[#767676] font-bold">أو</span>
              <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold text-[#767676]">ب) نقل إلى القضايا المحسومة</p>
              <button
                onClick={() => proceedWithTransition('close')}
                disabled={saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'جارٍ الحفظ...' : 'القضية محسومة'}
              </button>
            </div>

            {allowPaymentInProgress && (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
                  <span className="text-[10px] text-[#767676] font-bold">أو</span>
                  <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-[#767676]">ج) التحويل إلى جاري التسديد</p>
                  <button
                    type="button"
                    onClick={() => { setError(''); setShowPaymentModal(true) }}
                    disabled={saving}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#0f766e,#115e59)' }}
                  >
                    جاري التسديد
                  </button>
                </div>
              </>
            )}

            {showGpsUpdate && (
              <label className="flex items-start gap-3 p-3 rounded-xl border border-[#2C8780]/30 bg-[#2C8780]/5 cursor-pointer">
                <input type="checkbox" checked={updateGps} onChange={e => setUpdateGps(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-[#2C8780] shrink-0" />
                <div>
                  <span className="text-sm font-bold text-[#231F20]">تحديث موقع المدين</span>
                  <p className="text-[10px] text-[#767676] mt-0.5">
                    الموقع الجديد: <span dir="ltr" className="font-mono">{newGps!.lat.toFixed(6)}, {newGps!.lng.toFixed(6)}</span>
                  </p>
                </div>
              </label>
            )}
          </div>

          {error && <p className="px-5 pb-2 text-xs text-red-500">{error}</p>}

          <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.08)]">
            <button onClick={onClose} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-[#767676] border border-[rgba(118,118,118,0.2)] hover:bg-slate-50">
              إغلاق
            </button>
          </div>
        </div>
      </div>

      {showPaymentModal && (
        <MoveToPaymentInProgressModal
          open
          debtorId={task.debtor_id}
          debtorName={debtor?.full_name ?? '—'}
          taskId={task.id}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => void handlePaymentSuccess()}
        />
      )}
    </>
  )
}
