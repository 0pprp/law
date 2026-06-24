'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { REQUIRED_FIELD_LABELS } from '@/lib/types'
import type { RequiredField, Task } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'

interface Attachment {
  id: string
  file_name: string
  signedUrl: string | null
}

interface ReqField {
  id: string
  field_key: string
  field_type: string
  field_label: string | null
  is_required: boolean
  sort_order: number
}

interface Props {
  task: Task & Record<string, any>
  taskAttachments: Attachment[]
}

const INP = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

// ─── Completion Modal (dynamic) ────────────────────────────────────────────────
function CompletionModal({ task, reqFields, fee, onClose, onSubmitted }: {
  task: Task & Record<string, any>
  reqFields: ReqField[]
  fee: number
  onClose: () => void
  onSubmitted: () => void
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, File>>({})
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [generalNotes, setGeneralNotes] = useState('')

  function set(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  function validate(): string | null {
    for (const f of reqFields) {
      if (!f.is_required) continue
      const label = f.field_label ?? REQUIRED_FIELD_LABELS[f.field_type as RequiredField] ?? f.field_type
      if (['image', 'pdf', 'receipt'].includes(f.field_type)) {
        if (!files[f.field_key]) return `يجب رفع: ${label}`
      } else if (f.field_type === 'gps') {
        if (!values[f.field_key]) return `يجب تحديد موقع GPS`
      } else {
        if (!values[f.field_key]?.trim()) return `يجب إدخال: ${label}`
      }
    }
    return null
  }

  async function uploadFile(file: File, key: string): Promise<void> {
    const supabase = createClient()
    const ext = file.name.split('.').pop() ?? 'bin'
    const filePath = `${task.id}/${key}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('task-files').upload(filePath, file, { upsert: false })
    if (error) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('task_attachments').insert({
      task_id: task.id,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type,
      description: key,
      uploaded_by: user?.id,
    })
  }

  async function submit() {
    const err = validate()
    if (err) { setError(err); return }

    setSaving(true)
    setError('')

    // Upload files
    setUploading(true)
    for (const [key, file] of Object.entries(files)) {
      await uploadFile(file, key)
    }
    setUploading(false)

    // Build completion_data
    const completionData: Record<string, string> = { ...values }
    for (const [key, file] of Object.entries(files)) {
      completionData[key] = file.name
    }
    if (generalNotes.trim()) completionData['general_notes'] = generalNotes.trim()

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { error: updateErr } = await supabase.from('tasks').update({
      task_status: 'submitted',
      lawyer_notes: values['note'] || task.lawyer_notes || null,
      legal_result: values['legal_result'] || null,
      completion_data: completionData,
      completed_at: new Date().toISOString(),
    } as any).eq('id', task.id)

    if (updateErr) { setError(updateErr.message); setSaving(false); return }

    // Create fee receipt if fee > 0
    if (fee > 0 && user) {
      await (supabase as any).from('task_payment_receipts').insert({
        task_id: task.id,
        lawyer_id: user.id,
        amount: fee,
        notes: `أتعاب مهمة: ${task.task_type}`,
        status: 'pending',
      })
    }

    await logActivity({
      action: 'submit_task',
      entity_type: 'task',
      entity_id: task.id,
      description: `إرسال المهمة للاعتماد — أتعاب: ${fee.toLocaleString('en-US')} د.ع`,
    }, supabase)

    onSubmitted()
    onClose()
    router.refresh()
  }

  function getGPS(key: string) {
    if (!navigator.geolocation) { setError('المتصفح لا يدعم تحديد الموقع'); return }
    navigator.geolocation.getCurrentPosition(
      pos => set(key, `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
      () => setError('تعذر تحديد الموقع')
    )
  }

  function renderField(f: ReqField) {
    const label = f.field_label ?? REQUIRED_FIELD_LABELS[f.field_type as RequiredField] ?? f.field_type
    const req = f.is_required

    switch (f.field_type) {
      case 'note':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <textarea rows={3} value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP + ' resize-none'} placeholder="اكتب ملاحظاتك..." />
          </div>
        )

      case 'legal_result':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <textarea rows={2} value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP + ' resize-none'} placeholder="النتيجة القانونية للمهمة..." />
          </div>
        )

      case 'decision_number':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder="أدخل رقم القرار..." dir="ltr" />
          </div>
        )

      case 'case_number':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder="أدخل رقم الدعوى..." dir="ltr" />
          </div>
        )

      case 'date':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="date" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} dir="ltr" />
          </div>
        )

      case 'gps':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <div className="flex gap-2">
              <input type="text" value={values[f.field_key] ?? ''} readOnly
                className={INP + ' flex-1'} placeholder="latitude, longitude" dir="ltr" />
              <button type="button" onClick={() => getGPS(f.field_key)}
                className="shrink-0 px-3 py-2 text-xs font-bold text-white rounded-lg"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                📍 تحديد
              </button>
            </div>
          </div>
        )

      case 'image':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="file" accept="image/*"
              onChange={e => { const file = e.target.files?.[0]; if (file) setFiles(p => ({ ...p, [f.field_key]: file })) }}
              className="w-full text-sm text-slate-600 file:ml-3 file:mr-0 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:text-white file:cursor-pointer"
              style={{ '--file-bg': 'linear-gradient(135deg,#2C8780,#1D6365)' } as any} />
            {files[f.field_key] && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ {files[f.field_key].name}</p>}
          </div>
        )

      case 'pdf':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="file" accept=".pdf"
              onChange={e => { const file = e.target.files?.[0]; if (file) setFiles(p => ({ ...p, [f.field_key]: file })) }}
              className="w-full text-sm text-slate-600 file:ml-3 file:mr-0 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:text-white file:cursor-pointer" />
            {files[f.field_key] && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ {files[f.field_key].name}</p>}
          </div>
        )

      case 'receipt':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="file" accept="image/*,.pdf"
              onChange={e => { const file = e.target.files?.[0]; if (file) setFiles(p => ({ ...p, [f.field_key]: file })) }}
              className="w-full text-sm text-slate-600 file:ml-3 file:mr-0 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:text-white file:cursor-pointer" />
            {files[f.field_key] && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ {files[f.field_key].name}</p>}
          </div>
        )

      case 'text':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder={`أدخل ${label}...`} />
          </div>
        )

      case 'number':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="number" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder="0" dir="ltr" />
          </div>
        )

      default:
        // Fallback for unknown types: render as text input
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder={`أدخل ${label}...`} />
          </div>
        )
    }
  }

  const sortedFields = [...reqFields].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(35,31,32,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full max-w-lg rounded-t-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-black text-[#231F20] text-base">تأكيد الإنجاز</h2>
            {fee > 0 && (
              <p className="text-xs text-[#2C8780] font-bold mt-1">
                الأتعاب: {fee.toLocaleString('en-US')} د.ع — بانتظار اعتماد الإدارة
              </p>
            )}
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 transition-colors shrink-0">
            ×
          </button>
        </div>

        {/* Fields */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Always-visible general notes */}
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">
              ملاحظات عامة <span className="text-[#767676] font-normal text-[11px]">(اختياري)</span>
            </label>
            <textarea rows={2} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)}
              className={INP + ' resize-none'} placeholder="أضف أي ملاحظات إضافية..." />
          </div>

          {sortedFields.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800 font-semibold">
              الحقول الإلزامية قبل الإرسال:
              {' '}{sortedFields.filter(f => f.is_required).map(f => f.field_label ?? REQUIRED_FIELD_LABELS[f.field_type as RequiredField]).join(' — ')}
            </div>
          )}

          {sortedFields.map(f => renderField(f))}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-bold">
              {error}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] shrink-0">
          <button onClick={submit} disabled={saving}
            className="w-full py-3.5 rounded-xl text-white font-black text-sm disabled:opacity-60 transition-opacity"
            style={{ background: saving ? '#767676' : 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {uploading ? 'جارٍ رفع الملفات...' : saving ? 'جارٍ الإرسال...' : 'إرسال للاعتماد'}
          </button>
          <p className="text-center text-[10px] text-[#767676] mt-2">
            ستظهر المهمة بحالة "بانتظار الاعتماد" حتى تراجعها الإدارة
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Main Form ─────────────────────────────────────────────────────────────────
export default function TaskUpdateForm({ task, taskAttachments }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [lawyerNotes, setLawyerNotes] = useState(task.lawyer_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showCompletion, setShowCompletion] = useState(false)
  const [reqFields, setReqFields] = useState<ReqField[]>([])
  const [fee, setFee] = useState(0)

  const canSubmit = ['assigned', 'in_progress', 'new', 'rejected'].includes(task.task_status)
  const isSubmitted = task.task_status === 'submitted'
  const isApproved = ['approved', 'completed'].includes(task.task_status)
  const isRejected = task.task_status === 'rejected'

  useEffect(() => {
    const supabase = createClient()
    let q: any = supabase.from('task_definitions').select('id, fee_amount, task_required_fields(*)')
    // Prefer task_definition_id (new tasks), fallback to task_type enum (old tasks)
    if ((task as any).task_definition_id) {
      q = q.eq('id', (task as any).task_definition_id)
    } else if (task.task_type) {
      q = q.eq('task_type', task.task_type)
    } else {
      return
    }
    q.maybeSingle().then(({ data }: any) => {
      if (data) {
        setFee(Number(data.fee_amount) ?? 0)
        setReqFields(
          (data.task_required_fields ?? []).sort((a: ReqField, b: ReqField) => a.sort_order - b.sort_order)
        )
      }
    })
  }, [(task as any).task_definition_id, task.task_type])

  async function handleSaveNotes(e: { preventDefault(): void }) {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    await supabase.from('tasks').update({
      lawyer_notes: lawyerNotes || null,
      task_status: task.task_status === 'assigned' ? 'in_progress' : task.task_status,
    } as any).eq('id', task.id)
    await logActivity({ action: 'update_task', entity_type: 'task', entity_id: task.id, description: 'تحديث ملاحظات المحامي' }, supabase)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    router.refresh()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setUploadError('يرجى تسجيل الدخول'); setUploading(false); return }
    const ext = file.name.split('.').pop() ?? 'bin'
    const filePath = `${task.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error: storageErr } = await supabase.storage.from('task-files').upload(filePath, file, { upsert: false })
    if (storageErr) { setUploadError(storageErr.message); setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; return }
    await supabase.from('task_attachments').insert({
      task_id: task.id, file_name: file.name, file_path: filePath,
      file_size: file.size, mime_type: file.type,
      description: 'مرفق من المحامي', uploaded_by: user.id,
    })
    await logActivity({ action: 'upload_task_file', entity_type: 'task', entity_id: task.id, description: `رفع ملف: ${file.name}` }, supabase)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    router.refresh()
  }

  return (
    <div className="space-y-4">

      {/* Status banners */}
      {isSubmitted && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3.5 text-sm text-purple-800 font-bold text-center">
          ⏳ المهمة بانتظار اعتماد الإدارة
        </div>
      )}
      {isApproved && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3.5 text-sm text-green-800 font-bold text-center">
          ✓ تمت الموافقة على المهمة
        </div>
      )}
      {isRejected && task.admin_notes && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3.5 space-y-1">
          <p className="text-sm text-red-800 font-bold">✗ تم رفض المهمة</p>
          <p className="text-xs text-red-700">{task.admin_notes}</p>
        </div>
      )}
      {isRejected && !task.admin_notes && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3.5 text-sm text-red-800 font-bold text-center">
          ✗ تم رفض المهمة — يرجى المراجعة وإعادة الإرسال
        </div>
      )}

      {/* File attachments */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-700 text-sm">مرفقات المهمة</h2>
          <label className="cursor-pointer">
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx"
              onChange={handleFileChange} disabled={uploading} className="hidden" />
            <span className={`inline-flex text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
              uploading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'text-white cursor-pointer'
            }`} style={uploading ? undefined : { background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
              {uploading ? 'جارٍ الرفع...' : '+ رفع ملف'}
            </span>
          </label>
        </div>
        {uploadError && <p className="text-red-600 text-xs mb-2">{uploadError}</p>}
        {taskAttachments.length === 0 ? (
          <p className="text-slate-400 text-xs text-center py-3">لا توجد مرفقات بعد</p>
        ) : (
          <div className="space-y-2">
            {taskAttachments.map(att => (
              <div key={att.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-sm text-slate-700 truncate flex-1 min-w-0">{att.file_name}</span>
                {att.signedUrl
                  ? <a href={att.signedUrl} target="_blank" rel="noreferrer" className="text-xs text-[#2C8780] font-bold shrink-0">فتح</a>
                  : <span className="text-xs text-slate-400 shrink-0">غير متاح</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      {!isApproved && (
        <form onSubmit={handleSaveNotes} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="font-semibold text-slate-700 text-sm">ملاحظاتي</h2>
          <textarea value={lawyerNotes} onChange={e => setLawyerNotes(e.target.value)}
            rows={3} className={INP + ' resize-none'} placeholder="أضف ملاحظاتك هنا..." />
          <button type="submit" disabled={saving}
            className={`w-full font-bold py-2.5 rounded-lg transition-colors text-sm ${
              saved ? 'bg-green-600 text-white' : 'text-white disabled:opacity-60'
            }`}
            style={saved ? undefined : { background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ الحفظ...' : saved ? '✓ تم الحفظ' : 'حفظ الملاحظات'}
          </button>
        </form>
      )}

      {/* Complete button */}
      {canSubmit && (
        <button onClick={() => setShowCompletion(true)}
          className="w-full py-4 rounded-2xl text-white font-black text-base shadow-lg active:scale-[0.99] transition-all"
          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
          تم الإنجاز — إرسال للاعتماد
        </button>
      )}

      {showCompletion && (
        <CompletionModal
          task={task}
          reqFields={reqFields}
          fee={fee}
          onClose={() => setShowCompletion(false)}
          onSubmitted={() => router.refresh()}
        />
      )}
    </div>
  )
}
