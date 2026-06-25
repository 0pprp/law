'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { REQUIRED_FIELD_LABELS } from '@/lib/types'
import type { RequiredField } from '@/lib/types'
import { filterSelectableBranches } from '@/lib/branch-constants'

// ── Shared styles ──────────────────────────────────────────────
const INP = 'w-full px-3 py-2 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 focus:border-[#2C8780] transition-all'
const SEL = INP + ' cursor-pointer'
type Tab = 'courts' | 'exec-depts' | 'task-defs' | 'expense-types'

// ── Shared Modal Wrapper ───────────────────────────────────────
function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void
  children: React.ReactNode; footer: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <h2 className="font-bold text-[#231F20] text-sm">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 flex items-center justify-center text-xl leading-none transition-colors">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">{children}</div>
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] flex gap-3 bg-[#F8F7F8] shrink-0">{footer}</div>
      </div>
    </div>
  )
}

function ConfirmDelete({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => void }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
        <h2 className="font-bold text-[#231F20] text-sm">تأكيد الحذف</h2>
        <p className="text-sm text-[#767676]">هل تريد حذف <span className="font-bold text-[#231F20]">"{name}"</span>؟ لا يمكن التراجع.</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors">إلغاء</button>
          <button onClick={async () => { setDeleting(true); await onConfirm() }} disabled={deleting}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 transition-colors">
            {deleting ? 'جارٍ الحذف...' : 'حذف'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SaveBtn({ saving, label = 'حفظ', onClick }: { saving: boolean; label?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-opacity"
      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
      {saving ? 'جارٍ الحفظ...' : label}
    </button>
  )
}

function CancelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors">
      إلغاء
    </button>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity"
      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
      {label}
    </button>
  )
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-12 h-12 rounded-full bg-[#F3F1F2] flex items-center justify-center mb-3 text-[#767676]">{icon}</div>
      <p className="text-sm font-semibold text-[#231F20]">{title}</p>
      <p className="text-xs text-[#767676] mt-1">{subtitle}</p>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-14 gap-2">
      <svg className="w-5 h-5 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm text-[#767676]">جارٍ التحميل...</span>
    </div>
  )
}

function ErrMsg({ msg }: { msg: string }) {
  if (!msg) return null
  return <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{msg}</p>
}

// ══════════════════════════════════════════════════════════════
// TAB 1 — COURTS
// ══════════════════════════════════════════════════════════════
interface Branch { id: string; name: string; city: string | null }
interface Court { id: string; name: string; branch_id: string | null; is_active: boolean }

function CourtsTab({ branches }: { branches: Branch[] }) {
  const branchId = useBranchId()
  const [courts, setCourts] = useState<Court[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<{ name: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState<Court | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = createClient().from('courts').select('*').order('name')
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q
    setCourts(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  function openAdd() { setForm({ name: '' }); setEditingId(null); setErr('') }
  function openEdit(c: Court) { setForm({ name: c.name }); setEditingId(c.id); setErr('') }

  async function save() {
    if (!form?.name.trim()) { setErr('اسم المحكمة مطلوب'); return }
    setSaving(true); setErr('')
    // branch_id is always the current branch from context — no manual selection
    const payload = { name: form.name.trim(), branch_id: branchId || null }
    const sb = createClient()
    const { error } = editingId
      ? await sb.from('courts').update(payload).eq('id', editingId)
      : await sb.from('courts').insert({ ...payload, is_active: true })
    if (error) { setErr(error.message); setSaving(false); return }
    setForm(null); load()
    setSaving(false)
  }

  async function toggle(c: Court) {
    await createClient().from('courts').update({ is_active: !c.is_active }).eq('id', c.id)
    setCourts(cs => cs.map(x => x.id === c.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function del(c: Court) {
    await createClient().from('courts').delete().eq('id', c.id)
    setDeleting(null); load()
  }

  const getBranch = (id: string | null) => branches.find(b => b.id === id)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#767676]">المحاكم المرتبطة بالفرع</p>
        <AddBtn label="إضافة محكمة" onClick={openAdd} />
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] overflow-hidden">
        {loading ? <Spinner /> : courts.length === 0 ? (
          <EmptyState icon={<svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/></svg>} title="لا توجد محاكم" subtitle="أضف أول محكمة" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.08)]">
              <tr>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">المحكمة</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">الفرع</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">الحالة</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
              {courts.map(c => {
                const b = getBranch(c.branch_id ?? null)
                return (
                  <tr key={c.id} className={`hover:bg-[#F8F7F8] transition-colors ${!c.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-semibold text-[#231F20]">{c.name}</td>
                    <td className="px-4 py-3 text-[#767676] text-xs">{b ? `${b.name}${b.city ? ` (${b.city})` : ''}` : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {c.is_active ? 'مفعّل' : 'موقوف'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => openEdit(c)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[rgba(118,118,118,0.2)] text-[#231F20] hover:border-[#2C8780]/40 hover:text-[#2C8780] transition-colors">تعديل</button>
                        <button onClick={() => toggle(c)} className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${c.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                          {c.is_active ? 'إيقاف' : 'تفعيل'}
                        </button>
                        <button onClick={() => setDeleting(c)} className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">حذف</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {form !== null && (
        <Modal title={editingId ? 'تعديل المحكمة' : 'إضافة محكمة'} onClose={() => setForm(null)}
          footer={<><CancelBtn onClick={() => setForm(null)} /><SaveBtn saving={saving} label={editingId ? 'حفظ' : 'إضافة'} onClick={save} /></>}>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم المحكمة <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(f => f ? { ...f, name: e.target.value } : f)} className={INP} placeholder="مثال: محكمة بداءة البصرة" autoFocus />
          </div>
          <ErrMsg msg={err} />
        </Modal>
      )}

      {deleting && <ConfirmDelete name={deleting.name} onClose={() => setDeleting(null)} onConfirm={() => del(deleting)} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// TAB 2 — EXECUTION DEPARTMENTS
// ══════════════════════════════════════════════════════════════
interface ExecDept { id: string; name: string; court_id: string | null; branch_id: string | null; is_active: boolean }

function ExecDeptsTab({ branches }: { branches: Branch[] }) {
  const branchId = useBranchId()
  const [depts, setDepts] = useState<ExecDept[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<{ name: string; court_id: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState<ExecDept | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const sb = createClient()

    // Load courts for current branch first
    let cq = sb.from('courts').select('*').order('name')
    if (branchId) cq = (cq as any).eq('branch_id', branchId)
    const { data: c } = await cq
    setCourts(c ?? [])

    // Filter exec depts by court_id membership (handles old records where branch_id may be null)
    let dq = sb.from('execution_departments').select('*').order('name')
    if (branchId) {
      const courtIds = (c ?? []).map((ct: any) => ct.id)
      if (courtIds.length > 0) {
        dq = (dq as any).in('court_id', courtIds)
      } else {
        setDepts([])
        setLoading(false)
        return
      }
    }
    const { data: d } = await dq
    setDepts(d ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  function openAdd() { setForm({ name: '', court_id: '' }); setEditingId(null); setErr('') }
  function openEdit(d: ExecDept) { setForm({ name: d.name, court_id: d.court_id ?? '' }); setEditingId(d.id); setErr('') }

  async function save() {
    if (!form?.name.trim()) { setErr('اسم الدائرة مطلوب'); return }
    setSaving(true); setErr('')
    // Always save branch_id so the dept stays visible in the current branch
    const payload = { name: form.name.trim(), court_id: form.court_id || null, branch_id: branchId || null }
    const sb = createClient()
    const { error } = editingId
      ? await sb.from('execution_departments').update(payload).eq('id', editingId)
      : await sb.from('execution_departments').insert({ ...payload, is_active: true })
    if (error) { setErr(error.message); setSaving(false); return }
    setForm(null); load(); setSaving(false)
  }

  async function toggle(d: ExecDept) {
    await createClient().from('execution_departments').update({ is_active: !d.is_active }).eq('id', d.id)
    setDepts(ds => ds.map(x => x.id === d.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function del(d: ExecDept) {
    await createClient().from('execution_departments').delete().eq('id', d.id)
    setDeleting(null); load()
  }

  const getCourtName = (id: string | null) => courts.find(c => c.id === id)?.name ?? '—'
  const getBranchForCourt = (courtId: string | null) => {
    const c = courts.find(x => x.id === courtId)
    return c ? branches.find(b => b.id === c.branch_id) ?? null : null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#767676]">دوائر التنفيذ المرتبطة بالمحاكم</p>
        <AddBtn label="إضافة دائرة" onClick={openAdd} />
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] overflow-hidden">
        {loading ? <Spinner /> : depts.length === 0 ? (
          <EmptyState icon={<svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>} title="لا توجد دوائر تنفيذ" subtitle="أضف أول دائرة تنفيذ" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.08)]">
              <tr>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">الدائرة</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">المحكمة</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">الفرع</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">الحالة</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
              {depts.map(d => {
                const branch = getBranchForCourt(d.court_id ?? null)
                return (
                  <tr key={d.id} className={`hover:bg-[#F8F7F8] transition-colors ${!d.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-semibold text-[#231F20]">{d.name}</td>
                    <td className="px-4 py-3 text-[#767676] text-xs">{getCourtName(d.court_id ?? null)}</td>
                    <td className="px-4 py-3 text-[#767676] text-xs">{branch ? `${branch.name}${branch.city ? ` (${branch.city})` : ''}` : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {d.is_active ? 'مفعّل' : 'موقوف'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => openEdit(d)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[rgba(118,118,118,0.2)] text-[#231F20] hover:border-[#2C8780]/40 hover:text-[#2C8780] transition-colors">تعديل</button>
                        <button onClick={() => toggle(d)} className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${d.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                          {d.is_active ? 'إيقاف' : 'تفعيل'}
                        </button>
                        <button onClick={() => setDeleting(d)} className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">حذف</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {form !== null && (
        <Modal title={editingId ? 'تعديل الدائرة' : 'إضافة دائرة تنفيذ'} onClose={() => setForm(null)}
          footer={<><CancelBtn onClick={() => setForm(null)} /><SaveBtn saving={saving} label={editingId ? 'حفظ' : 'إضافة'} onClick={save} /></>}>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم الدائرة <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(f => f ? { ...f, name: e.target.value } : f)} className={INP} placeholder="مثال: دائرة تنفيذ الرصافة" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">المحكمة المرتبطة</label>
            <select value={form.court_id} onChange={e => setForm(f => f ? { ...f, court_id: e.target.value } : f)} className={SEL}>
              <option value="">— اختر محكمة —</option>
              {courts.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <ErrMsg msg={err} />
        </Modal>
      )}

      {deleting && <ConfirmDelete name={deleting.name} onClose={() => setDeleting(null)} onConfirm={() => del(deleting)} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// TAB 3 — TASK DEFINITIONS
// ══════════════════════════════════════════════════════════════
const ALL_FIELDS: RequiredField[] = [
  'note', 'image', 'pdf', 'decision_number', 'case_number',
  'date', 'gps', 'receipt', 'legal_result',
]

const FIELD_TYPE_OPTIONS = [
  { value: 'text',            label: 'نص قصير' },
  { value: 'note',            label: 'ملاحظة / نص طويل' },
  { value: 'number',          label: 'رقم' },
  { value: 'date',            label: 'تاريخ' },
  { value: 'image',           label: 'صورة' },
  { value: 'pdf',             label: 'ملف PDF' },
  { value: 'gps',             label: 'موقع GPS' },
  { value: 'receipt',         label: 'وصل / إيصال' },
  { value: 'decision_number', label: 'رقم قرار' },
  { value: 'case_number',     label: 'رقم دعوى' },
  { value: 'legal_result',    label: 'نتيجة قانونية' },
]

interface TaskDef {
  id: string; label: string; fee_amount: number
  sort_order: number; is_active: boolean
}

interface ReqField {
  id: string; task_definition_id: string; field_key: string
  field_type: string; field_label: string | null; is_required: boolean; sort_order: number
}

interface DynField { field_label: string; field_type: string; is_required: boolean }

interface EditForm { label: string; fee: string; isActive: boolean; dynFields: DynField[] }

function TaskDefsTab() {
  const branchId = useBranchId()
  const [defs, setDefs] = useState<TaskDef[]>([])
  const [reqFields, setReqFields] = useState<ReqField[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TaskDef | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ label: '', fee: '', isActive: true, dynFields: [] })
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState({ label: '', fee: '0', dynFields: [] as DynField[] })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const sb = createClient()
    let dq = (sb as any).from('task_definitions').select('*').order('sort_order')
    if (branchId) dq = dq.eq('branch_id', branchId)
    const [{ data: d }, { data: f }] = await Promise.all([
      dq,
      (sb as any).from('task_required_fields').select('*').order('sort_order'),
    ])
    setDefs(d ?? [])
    setReqFields(f ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  function openEdit(def: TaskDef) {
    const existing = (reqFields as ReqField[]).filter(f => f.task_definition_id === def.id)
    setEditing(def)
    setEditForm({
      label: def.label,
      fee: String(def.fee_amount),
      isActive: def.is_active,
      dynFields: existing.map(f => ({
        field_label: f.field_label || f.field_key,
        field_type: f.field_type,
        is_required: f.is_required,
      })),
    })
    setErr('')
  }

  function addEditField() {
    setEditForm(f => ({ ...f, dynFields: [...f.dynFields, { field_label: '', field_type: 'text', is_required: true }] }))
  }
  function removeEditField(i: number) {
    setEditForm(f => ({ ...f, dynFields: f.dynFields.filter((_, idx) => idx !== i) }))
  }
  function setEditDynField(i: number, key: keyof DynField, val: string | boolean) {
    setEditForm(f => ({ ...f, dynFields: f.dynFields.map((d, idx) => idx === i ? { ...d, [key]: val } : d) }))
  }

  async function saveEdit() {
    if (!editing) return
    if (!editForm.label.trim()) { setErr('الاسم مطلوب'); return }
    const badField = editForm.dynFields.find(f => !f.field_label.trim())
    if (badField !== undefined) { setErr('تحقق من أسماء الحقول'); return }
    setSaving(true); setErr('')
    const sb = createClient()

    const { error: e1 } = await (sb as any).from('task_definitions')
      .update({ label: editForm.label.trim(), fee_amount: Number(editForm.fee) || 0, is_active: editForm.isActive })
      .eq('id', editing.id)
    if (e1) { setErr(e1.message); setSaving(false); return }

    await (sb as any).from('task_required_fields').delete().eq('task_definition_id', editing.id)

    if (editForm.dynFields.length > 0) {
      await (sb as any).from('task_required_fields').insert(
        editForm.dynFields.map((f, i) => ({
          task_definition_id: editing.id,
          field_key: `field_${i}_${f.field_type}`,
          field_type: f.field_type,
          field_label: f.field_label.trim(),
          is_required: f.is_required,
          sort_order: i,
        }))
      )
    }

    setEditing(null); load(); setSaving(false)
  }

  function openAdd() {
    setAddForm({ label: '', fee: '0', dynFields: [] })
    setAdding(true); setErr('')
  }

  function addDynField() {
    setAddForm(f => ({ ...f, dynFields: [...f.dynFields, { field_label: '', field_type: 'text', is_required: true }] }))
  }

  function removeDynField(i: number) {
    setAddForm(f => ({ ...f, dynFields: f.dynFields.filter((_, idx) => idx !== i) }))
  }

  function setDynField(i: number, key: keyof DynField, val: string | boolean) {
    setAddForm(f => ({ ...f, dynFields: f.dynFields.map((d, idx) => idx === i ? { ...d, [key]: val } : d) }))
  }

  async function saveAdd() {
    if (!addForm.label.trim()) { setErr('اسم المهمة مطلوب'); return }
    const invalidField = addForm.dynFields.find(f => !f.field_label.trim())
    if (invalidField !== undefined) { setErr('تحقق من أسماء الحقول'); return }
    setSaving(true); setErr('')
    const sb = createClient()

    const maxOrder = defs.length > 0 ? Math.max(...defs.map(d => d.sort_order)) + 1 : 0
    const { data: newDef, error } = await (sb as any).from('task_definitions').insert({
      label: addForm.label.trim(),
      fee_amount: Number(addForm.fee) || 0,
      is_active: true,
      sort_order: maxOrder,
      branch_id: branchId,
    }).select('id').single()

    if (error || !newDef) { setErr(error?.message ?? 'فشل الإنشاء'); setSaving(false); return }

    if (addForm.dynFields.length > 0) {
      const fieldsToInsert = addForm.dynFields.map((f, i) => ({
        task_definition_id: newDef.id,
        field_key: `field_${i}_${f.field_type}`,
        field_type: f.field_type,
        field_label: f.field_label.trim(),
        is_required: f.is_required,
        sort_order: i,
      }))
      await (sb as any).from('task_required_fields').insert(fieldsToInsert)
    }

    setAdding(false); load(); setSaving(false)
  }

  async function toggle(def: TaskDef) {
    await (createClient() as any).from('task_definitions').update({ is_active: !def.is_active }).eq('id', def.id)
    setDefs(ds => ds.map(d => d.id === def.id ? { ...d, is_active: !d.is_active } : d))
  }

  const defFields = (def: TaskDef) => (reqFields as ReqField[]).filter(f => f.task_definition_id === def.id)
  const fieldDisplay = (f: ReqField) => f.field_label || REQUIRED_FIELD_LABELS[f.field_type as RequiredField] || f.field_type

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="bg-[#2C8780]/8 border border-[#2C8780]/20 rounded-xl px-4 py-2.5 text-xs text-[#231F20] flex-1 ml-4">
          الحقول المحددة هنا تظهر للمحامي إجباريًا عند تسليم المهمة.
        </div>
        <AddBtn label="إضافة نوع مهمة" onClick={openAdd} />
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] overflow-hidden">
        {loading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.08)]">
              <tr>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">نوع المهمة</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#767676]">الأتعاب (د.ع)</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">الحقول</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">الحالة</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
              {defs.map(def => (
                <tr key={def.id} className={`hover:bg-[#F8F7F8] transition-colors ${!def.is_active ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3 font-semibold text-[#231F20]">{def.label}</td>
                  <td className="px-4 py-3 text-[#2C8780] font-black tabular-nums text-left" dir="ltr">
                    {Number(def.fee_amount).toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {defFields(def).length === 0 ? (
                      <span className="text-[11px] text-[#767676] italic">—</span>
                    ) : (
                      <span className="text-[11px] font-bold bg-[#2C8780]/10 text-[#2C8780] px-2.5 py-1 rounded-full">
                        {defFields(def).length} حقل
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${def.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {def.is_active ? 'مفعّل' : 'موقوف'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => openEdit(def)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[rgba(118,118,118,0.2)] text-[#231F20] hover:border-[#2C8780]/40 hover:text-[#2C8780] transition-colors">تعديل</button>
                      <button onClick={() => toggle(def)} className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${def.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                        {def.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Modal */}
      {editing && (
        <Modal title={`تعديل: ${editing.label}`} onClose={() => setEditing(null)}
          footer={<><CancelBtn onClick={() => setEditing(null)} /><SaveBtn saving={saving} onClick={saveEdit} /></>}>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم المهمة <span className="text-red-500">*</span></label>
            <input value={editForm.label} onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))} className={INP} />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">الأتعاب (د.ع)</label>
            <input type="number" value={editForm.fee} onChange={e => setEditForm(f => ({ ...f, fee: e.target.value }))} className={INP} dir="ltr" min="0" />
          </div>
          <div className="flex items-center justify-between py-2.5 border-t border-b border-[rgba(118,118,118,0.08)]">
            <span className="text-xs font-bold text-[#231F20]">الحالة</span>
            <div
              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${editForm.isActive ? 'bg-[#2C8780]' : 'bg-[rgba(118,118,118,0.3)]'}`}
              onClick={() => setEditForm(f => ({ ...f, isActive: !f.isActive }))}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${editForm.isActive ? 'right-0.5' : 'left-0.5'}`} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[#231F20]">الحقول الإلزامية</label>
              <button type="button" onClick={addEditField}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-[#2C8780]/40 text-[#2C8780] hover:bg-[#2C8780]/8 transition-colors font-semibold">
                + إضافة حقل
              </button>
            </div>
            {editForm.dynFields.length === 0 ? (
              <p className="text-xs text-[#767676] italic py-2">لا توجد حقول — الملاحظات العامة تظهر دائماً للمحامي</p>
            ) : (
              <div className="space-y-2.5">
                {editForm.dynFields.map((f, i) => (
                  <div key={i} className="bg-[#F8F7F8] rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={f.field_label}
                        onChange={e => setEditDynField(i, 'field_label', e.target.value)}
                        className={`${INP} flex-1`}
                        placeholder="اسم الحقل (بالعربية)"
                      />
                      <button type="button" onClick={() => removeEditField(i)}
                        className="w-7 h-7 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 flex items-center justify-center text-lg leading-none shrink-0">
                        ×
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={f.field_type}
                        onChange={e => setEditDynField(i, 'field_type', e.target.value)}
                        className={`${SEL} flex-1`}
                      >
                        {FIELD_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-[#231F20] cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={f.is_required}
                          onChange={e => setEditDynField(i, 'is_required', e.target.checked)}
                          className="accent-[#2C8780] w-3.5 h-3.5"
                        />
                        إلزامي
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <ErrMsg msg={err} />
        </Modal>
      )}

      {/* Add Modal */}
      {adding && (
        <Modal title="إضافة نوع مهمة جديد" onClose={() => setAdding(false)}
          footer={<><CancelBtn onClick={() => setAdding(false)} /><SaveBtn saving={saving} label="إنشاء المهمة" onClick={saveAdd} /></>}>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم المهمة <span className="text-red-500">*</span></label>
            <input
              value={addForm.label}
              onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
              className={INP} placeholder="مثال: كتاب استحقاق" autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">الأتعاب (د.ع)</label>
            <input type="number" value={addForm.fee} onChange={e => setAddForm(f => ({ ...f, fee: e.target.value }))} className={INP} dir="ltr" min="0" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[#231F20]">الحقول الإلزامية</label>
              <button
                type="button"
                onClick={addDynField}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-[#2C8780]/40 text-[#2C8780] hover:bg-[#2C8780]/8 transition-colors font-semibold"
              >
                + إضافة حقل
              </button>
            </div>
            {addForm.dynFields.length === 0 ? (
              <p className="text-xs text-[#767676] italic py-2">لا توجد حقول — اضغط "إضافة حقل" لإضافة حقل مطلوب</p>
            ) : (
              <div className="space-y-2.5">
                {addForm.dynFields.map((f, i) => (
                  <div key={i} className="bg-[#F8F7F8] rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={f.field_label}
                        onChange={e => setDynField(i, 'field_label', e.target.value)}
                        className={`${INP} flex-1`}
                        placeholder="اسم الحقل (بالعربية)"
                      />
                      <button type="button" onClick={() => removeDynField(i)}
                        className="w-7 h-7 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 flex items-center justify-center text-lg leading-none shrink-0">
                        ×
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={f.field_type}
                        onChange={e => setDynField(i, 'field_type', e.target.value)}
                        className={`${SEL} flex-1`}
                      >
                        {FIELD_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-[#231F20] cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={f.is_required}
                          onChange={e => setDynField(i, 'is_required', e.target.checked)}
                          className="accent-[#2C8780] w-3.5 h-3.5"
                        />
                        إلزامي
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <ErrMsg msg={err} />
        </Modal>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// TAB 4 — EXPENSE TYPES
// ══════════════════════════════════════════════════════════════
interface ExpenseType {
  id: string; name: string; default_amount: number
  requires_approval: boolean; requires_receipt: boolean; is_active: boolean
  requires_attachment: boolean; requires_note: boolean; requires_gps: boolean
}

function ExpenseTypesTab() {
  const branchId = useBranchId()
  const [types, setTypes] = useState<ExpenseType[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<{
    name: string; default_amount: string
    requires_approval: boolean; requires_receipt: boolean
    requires_attachment: boolean; requires_note: boolean; requires_gps: boolean
  } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState<ExpenseType | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = createClient().from('expense_types').select('*').order('name')
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q
    setTypes(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setForm({ name: '', default_amount: '0', requires_approval: true, requires_receipt: false, requires_attachment: false, requires_note: false, requires_gps: false })
    setEditingId(null); setErr('')
  }

  function openEdit(t: ExpenseType) {
    setForm({
      name: t.name, default_amount: String(t.default_amount),
      requires_approval: t.requires_approval, requires_receipt: t.requires_receipt,
      requires_attachment: t.requires_attachment ?? false,
      requires_note: t.requires_note ?? false,
      requires_gps: t.requires_gps ?? false,
    })
    setEditingId(t.id); setErr('')
  }

  async function save() {
    if (!form?.name.trim()) { setErr('اسم نوع الصرفية مطلوب'); return }
    setSaving(true); setErr('')
    const payload = {
      name: form.name.trim(),
      default_amount: Number(form.default_amount) || 0,
      requires_approval: form.requires_approval,
      requires_receipt: form.requires_receipt,
      requires_attachment: form.requires_attachment,
      requires_note: form.requires_note,
      requires_gps: form.requires_gps,
    }
    const sb = createClient()
    const { error } = editingId
      ? await sb.from('expense_types').update(payload).eq('id', editingId)
      : await sb.from('expense_types').insert({ ...payload, is_active: true })
    if (error) { setErr(error.message); setSaving(false); return }
    setForm(null); load(); setSaving(false)
  }

  async function toggle(t: ExpenseType) {
    await createClient().from('expense_types').update({ is_active: !t.is_active }).eq('id', t.id)
    setTypes(ts => ts.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function del(t: ExpenseType) {
    await createClient().from('expense_types').delete().eq('id', t.id)
    setDeleting(null); load()
  }

  function Toggle({ val, onChange }: { val: boolean; onChange: (v: boolean) => void }) {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <div className={`w-9 h-5 rounded-full transition-colors relative ${val ? 'bg-[#2C8780]' : 'bg-[rgba(118,118,118,0.3)]'}`}
          onClick={() => onChange(!val)}>
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${val ? 'right-0.5' : 'left-0.5'}`} />
        </div>
      </label>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#767676]">أنواع الصرفيات المسموح للمحامي اختيارها فقط</p>
        <AddBtn label="إضافة نوع" onClick={openAdd} />
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] overflow-hidden">
        {loading ? <Spinner /> : types.length === 0 ? (
          <EmptyState icon={<svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>} title="لا توجد أنواع صرفيات" subtitle="أضف أول نوع صرفية" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.08)]">
              <tr>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">النوع</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#767676]">المبلغ</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">مرفق</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">ملاحظة</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">GPS</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">الحالة</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676]">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
              {types.map(t => (
                <tr key={t.id} className={`hover:bg-[#F8F7F8] transition-colors ${!t.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-semibold text-[#231F20]">{t.name}</td>
                  <td className="px-4 py-3 text-[#767676] tabular-nums text-left font-bold" dir="ltr">
                    {t.default_amount > 0 ? `${Number(t.default_amount).toLocaleString('en-US')} د.ع` : '—'}
                  </td>
                  {(['requires_attachment', 'requires_note', 'requires_gps'] as const).map(field => (
                    <td key={field} className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(t as any)[field] ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                        {(t as any)[field] ? '✓' : '—'}
                      </span>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {t.is_active ? 'مفعّل' : 'موقوف'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => openEdit(t)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[rgba(118,118,118,0.2)] text-[#231F20] hover:border-[#2C8780]/40 hover:text-[#2C8780] transition-colors">تعديل</button>
                      <button onClick={() => toggle(t)} className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${t.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                        {t.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button onClick={() => setDeleting(t)} className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form !== null && (
        <Modal title={editingId ? 'تعديل النوع' : 'إضافة نوع صرفية'} onClose={() => setForm(null)}
          footer={<><CancelBtn onClick={() => setForm(null)} /><SaveBtn saving={saving} label={editingId ? 'حفظ' : 'إضافة'} onClick={save} /></>}>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم نوع الصرفية <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(f => f ? { ...f, name: e.target.value } : f)} className={INP} placeholder="مثال: رسوم قضائية" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">المبلغ الافتراضي (0 = يدخله المحامي)</label>
            <input type="number" value={form.default_amount} onChange={e => setForm(f => f ? { ...f, default_amount: e.target.value } : f)} className={INP} dir="ltr" min="0" />
          </div>
          {([
            { key: 'requires_attachment', label: 'يتطلب مرفق (صورة / PDF)' },
            { key: 'requires_note',       label: 'يتطلب ملاحظة نصية' },
            { key: 'requires_gps',        label: 'يتطلب موقع GPS' },
          ] as const).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-2 border-t border-[rgba(118,118,118,0.08)]">
              <span className="text-xs font-semibold text-[#231F20]">{label}</span>
              <div
                className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${form[key] ? 'bg-[#2C8780]' : 'bg-[rgba(118,118,118,0.3)]'}`}
                onClick={() => setForm(f => f ? { ...f, [key]: !f[key] } : f)}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form[key] ? 'right-0.5' : 'left-0.5'}`} />
              </div>
            </div>
          ))}
          <ErrMsg msg={err} />
        </Modal>
      )}

      {deleting && <ConfirmDelete name={deleting.name} onClose={() => setDeleting(null)} onConfirm={() => del(deleting)} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
const TABS: { id: Tab; label: string }[] = [
  { id: 'courts',        label: 'المحاكم' },
  { id: 'exec-depts',    label: 'دوائر التنفيذ' },
  { id: 'task-defs',     label: 'أنواع المهام' },
  { id: 'expense-types', label: 'أنواع الصرفيات' },
]

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('courts')
  const [branches, setBranches] = useState<Branch[]>([])

  useEffect(() => {
    createClient().from('branches').select('id, name, city').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(filterSelectableBranches(data ?? [])))
  }, [])

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-black text-[#231F20]">إعدادات الفرع</h1>
        <p className="text-sm text-[#767676] mt-0.5">إدارة المحاكم والمهام والصرفيات</p>
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] p-1.5 flex gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${
              tab === t.id
                ? 'text-white shadow-sm'
                : 'text-[#767676] hover:text-[#231F20] hover:bg-[#F3F1F2]'
            }`}
            style={tab === t.id ? { background: 'linear-gradient(135deg,#2C8780,#1D6365)' } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'courts'        && <CourtsTab branches={branches} />}
      {tab === 'exec-depts'    && <ExecDeptsTab branches={branches} />}
      {tab === 'task-defs'     && <TaskDefsTab />}
      {tab === 'expense-types' && <ExpenseTypesTab />}
    </div>
  )
}
