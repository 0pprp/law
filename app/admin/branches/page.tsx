'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Branch, Court, ExecutionDepartment } from '@/lib/types'
import { filterSelectableBranches, isMainBranchName } from '@/lib/branch-constants'
import { PremiumSelect } from '@/components/ui/premium-select'

// ─── shared styles ────────────────────────────────────────────────────────────
const INP = 'w-full bg-[#F3F1F2] border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'
const SEL = INP
const BTN_PRIMARY = 'px-4 py-2 rounded-xl text-sm font-bold text-white shadow-sm hover:opacity-90 transition-opacity'
const BTN_GHOST = 'px-3 py-1.5 text-xs rounded-lg border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-[#F3F1F2] transition-colors font-semibold'

function Spinner() {
  return <div className="w-5 h-5 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
}

function SectionHeader({ title, sub, onAdd }: { title: string; sub: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-base font-black text-[#231F20]">{title}</h2>
        <p className="text-xs text-[#767676] mt-0.5">{sub}</p>
      </div>
      {onAdd && (
        <button onClick={onAdd} className={BTN_PRIMARY} style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
          + إضافة
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Branches
// ═══════════════════════════════════════════════════════════
function BranchesSection() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [form, setForm] = useState({ name: '', city: '', address: '', phone: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase.from('branches').select('*').order('created_at')
    setBranches(filterSelectableBranches(data ?? []))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', city: '', address: '', phone: '' })
    setModal(true)
  }
  function openEdit(b: Branch) {
    setEditing(b)
    setForm({ name: b.name, city: b.city ?? '', address: b.address ?? '', phone: b.phone ?? '' })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) return
    if (isMainBranchName(form.name.trim())) return
    setSaving(true)
    const supabase = createClient()
    const payload = {
      name: form.name.trim(),
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
    }
    if (editing) {
      await supabase.from('branches').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('branches').insert(payload)
    }
    setSaving(false)
    setModal(false)
    load()
  }

  async function toggleActive(b: Branch) {
    const supabase = createClient()
    await supabase.from('branches').update({ is_active: !b.is_active }).eq('id', b.id)
    setBranches(bs => bs.map(x => x.id === b.id ? { ...x, is_active: !x.is_active } : x))
  }

  return (
    <section>
      <SectionHeader title="الفروع" sub={`${branches.length} فرع مسجّل`} onAdd={openCreate} />
      <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !branches.length ? (
          <p className="text-center py-10 text-sm text-[#767676]">لا توجد فروع</p>
        ) : (
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {branches.map(b => (
              <div key={b.id} className="px-5 py-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold text-white"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  {b.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-[#231F20] text-sm">{b.name}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                      {b.is_active ? 'نشط' : 'معطل'}
                    </span>
                  </div>
                  <p className="text-xs text-[#767676] mt-0.5">
                    {[b.city, b.address, b.phone].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(b)} className={BTN_GHOST}>تعديل</button>
                  <button onClick={() => toggleActive(b)} className={BTN_GHOST}>
                    {b.is_active ? 'تعطيل' : 'تفعيل'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <Modal title={editing ? 'تعديل الفرع' : 'فرع جديد'} onClose={() => setModal(false)}>
          <div className="p-5 space-y-4">
            {([
              { key: 'name' as const, label: 'اسم الفرع *', placeholder: 'بغداد الكرخ' },
              { key: 'city' as const, label: 'المدينة / المحافظة', placeholder: 'بغداد' },
              { key: 'address' as const, label: 'العنوان', placeholder: 'الشارع والمنطقة' },
              { key: 'phone' as const, label: 'الهاتف', placeholder: '07xxxxxxxxx' },
            ]).map(f => (
              <div key={f.key}>
                <label className="block text-xs text-[#767676] mb-1.5 font-semibold">{f.label}</label>
                <input type="text" value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder} className={INP} />
              </div>
            ))}
          </div>
          <ModalFooter onCancel={() => setModal(false)} onSave={save} saving={saving} disabled={!form.name.trim()} />
        </Modal>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════
// Courts
// ═══════════════════════════════════════════════════════════
function CourtsSection({ branches }: { branches: Branch[] }) {
  const [courts, setCourts] = useState<(Court & { branch_name?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Court | null>(null)
  const [form, setForm] = useState({ name: '', branch_id: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await (supabase as any).from('courts')
      .select('*, branches(name)')
      .order('created_at')
    setCourts((data ?? []).map((c: any) => ({ ...c, branch_name: c.branches?.name })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', branch_id: branches[0]?.id ?? '' })
    setModal(true)
  }
  function openEdit(c: Court) {
    setEditing(c)
    setForm({ name: c.name, branch_id: c.branch_id ?? '' })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    const supabase = createClient()
    const payload = { name: form.name.trim(), branch_id: form.branch_id || null }
    if (editing) {
      await (supabase as any).from('courts').update(payload).eq('id', editing.id)
    } else {
      await (supabase as any).from('courts').insert(payload)
    }
    setSaving(false)
    setModal(false)
    load()
  }

  async function toggleActive(c: Court) {
    const supabase = createClient()
    await (supabase as any).from('courts').update({ is_active: !c.is_active }).eq('id', c.id)
    setCourts(cs => cs.map(x => x.id === c.id ? { ...x, is_active: !x.is_active } : x))
  }

  return (
    <section>
      <SectionHeader title="المحاكم" sub={`${courts.length} محكمة مسجّلة`} onAdd={openCreate} />
      <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !courts.length ? (
          <p className="text-center py-10 text-sm text-[#767676]">لا توجد محاكم</p>
        ) : (
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {courts.map(c => (
              <div key={c.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold text-[#2C8780] bg-[#2C8780]/10">
                  م
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#231F20] text-sm">{c.name}</p>
                  <p className="text-xs text-[#767676] mt-0.5">{c.branch_name ?? 'بدون فرع'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                    {c.is_active ? 'نشطة' : 'معطلة'}
                  </span>
                  <button onClick={() => openEdit(c)} className={BTN_GHOST}>تعديل</button>
                  <button onClick={() => toggleActive(c)} className={BTN_GHOST}>
                    {c.is_active ? 'تعطيل' : 'تفعيل'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <Modal title={editing ? 'تعديل المحكمة' : 'محكمة جديدة'} onClose={() => setModal(false)}>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-[#767676] mb-1.5 font-semibold">اسم المحكمة *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="مثال: محكمة الكرخ الابتدائية" className={INP} />
            </div>
            <div>
              <PremiumSelect
                value={form.branch_id}
                onChange={v => setForm(p => ({ ...p, branch_id: v }))}
                options={[
                  { value: '', label: '— بدون فرع —' },
                  ...branches.filter(b => b.is_active).map(b => ({ value: b.id, label: b.name })),
                ]}
                fieldLabel="الفرع"
                placeholder="— بدون فرع —"
                headerTitle="اختر الفرع"
                searchPlaceholder="بحث في الفروع..."
                searchable
              />
            </div>
          </div>
          <ModalFooter onCancel={() => setModal(false)} onSave={save} saving={saving} disabled={!form.name.trim()} />
        </Modal>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════
// Execution Departments
// ═══════════════════════════════════════════════════════════
function ExecDeptsSection({ courts }: { courts: Court[] }) {
  const [depts, setDepts] = useState<(ExecutionDepartment & { court_name?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<ExecutionDepartment | null>(null)
  const [form, setForm] = useState({ name: '', court_id: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await (supabase as any).from('execution_departments')
      .select('*, courts(name)')
      .order('created_at')
    setDepts((data ?? []).map((d: any) => ({ ...d, court_name: d.courts?.name })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', court_id: courts[0]?.id ?? '' })
    setModal(true)
  }
  function openEdit(d: ExecutionDepartment) {
    setEditing(d)
    setForm({ name: d.name, court_id: d.court_id ?? '' })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    const supabase = createClient()
    const payload = { name: form.name.trim(), court_id: form.court_id || null }
    if (editing) {
      await (supabase as any).from('execution_departments').update(payload).eq('id', editing.id)
    } else {
      await (supabase as any).from('execution_departments').insert(payload)
    }
    setSaving(false)
    setModal(false)
    load()
  }

  async function toggleActive(d: ExecutionDepartment) {
    const supabase = createClient()
    await (supabase as any).from('execution_departments').update({ is_active: !d.is_active }).eq('id', d.id)
    setDepts(ds => ds.map(x => x.id === d.id ? { ...x, is_active: !x.is_active } : x))
  }

  return (
    <section>
      <SectionHeader title="دوائر التنفيذ" sub={`${depts.length} دائرة مسجّلة`} onAdd={openCreate} />
      <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !depts.length ? (
          <p className="text-center py-10 text-sm text-[#767676]">لا توجد دوائر تنفيذ</p>
        ) : (
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {depts.map(d => (
              <div key={d.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold text-[#1D6365] bg-[#1D6365]/10">
                  د
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#231F20] text-sm">{d.name}</p>
                  <p className="text-xs text-[#767676] mt-0.5">{d.court_name ?? 'بدون محكمة'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${d.is_active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                    {d.is_active ? 'نشطة' : 'معطلة'}
                  </span>
                  <button onClick={() => openEdit(d)} className={BTN_GHOST}>تعديل</button>
                  <button onClick={() => toggleActive(d)} className={BTN_GHOST}>
                    {d.is_active ? 'تعطيل' : 'تفعيل'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <Modal title={editing ? 'تعديل دائرة التنفيذ' : 'دائرة تنفيذ جديدة'} onClose={() => setModal(false)}>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-[#767676] mb-1.5 font-semibold">اسم الدائرة *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="مثال: دائرة تنفيذ الكرخ" className={INP} />
            </div>
            <div>
              <PremiumSelect
                value={form.court_id}
                onChange={v => setForm(p => ({ ...p, court_id: v }))}
                options={[
                  { value: '', label: '— بدون محكمة —' },
                  ...courts.filter(c => c.is_active).map(c => ({ value: c.id, label: c.name })),
                ]}
                fieldLabel="المحكمة"
                placeholder="— بدون محكمة —"
                headerTitle="اختر المحكمة"
                searchPlaceholder="بحث في المحاكم..."
                searchable={courts.filter(c => c.is_active).length > 4}
              />
            </div>
          </div>
          <ModalFooter onCancel={() => setModal(false)} onSave={save} saving={saving} disabled={!form.name.trim()} />
        </Modal>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════
// Shared Modal wrapper
// ═══════════════════════════════════════════════════════════
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(118,118,118,0.1)]">
          <h3 className="font-bold text-[#231F20] text-sm">{title}</h3>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 flex items-center justify-center text-lg leading-none transition-colors">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalFooter({ onCancel, onSave, saving, disabled }: {
  onCancel: () => void; onSave: () => void; saving: boolean; disabled?: boolean
}) {
  return (
    <div className="flex gap-3 px-5 py-4 bg-[#F3F1F2]/50 border-t border-[rgba(118,118,118,0.1)]">
      <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors">
        إلغاء
      </button>
      <button onClick={onSave} disabled={saving || disabled}
        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-opacity"
        style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
        {saving ? 'جارٍ الحفظ...' : 'حفظ'}
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════
export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [tab, setTab] = useState<'branches' | 'courts' | 'execution'>('branches')

  // Load shared data for dropdowns
  useEffect(() => {
    const supabase = createClient()
    supabase.from('branches').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(filterSelectableBranches(data ?? [])))
    ;(supabase as any).from('courts').select('*').order('name').then(({ data }: any) => setCourts(data ?? []))
  }, [])

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'branches', label: 'الفروع' },
    { key: 'courts', label: 'المحاكم' },
    { key: 'execution', label: 'دوائر التنفيذ' },
  ]

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-black text-[#231F20]">الفروع والمحاكم</h1>
        <p className="text-sm text-[#767676] mt-0.5">إدارة الفروع والمحاكم ودوائر التنفيذ</p>
      </div>

      {/* Tab bar */}
      <div className="flex bg-[#F3F1F2] rounded-xl p-1 gap-1 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${tab === t.key ? 'bg-white text-[#231F20] shadow-sm' : 'text-[#767676] hover:text-[#231F20]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'branches' && <BranchesSection />}
      {tab === 'courts' && <CourtsSection branches={branches} />}
      {tab === 'execution' && <ExecDeptsSection courts={courts} />}
    </div>
  )
}
