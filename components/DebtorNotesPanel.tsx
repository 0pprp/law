'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtDateTime } from '@/lib/utils'

interface Note {
  id: string
  message: string | null
  attachment_url: string | null
  attachment_name: string | null
  created_at: string
  user: { full_name: string } | null
}

export default function DebtorNotesPanel({ debtorId }: { debtorId: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function load() {
    const { data } = await (supabase as any)
      .from('debtor_notes')
      .select('*, user:profiles!debtor_notes_user_id_fkey(full_name)')
      .eq('debtor_id', debtorId)
      .order('created_at', { ascending: false })
    setNotes(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [debtorId])

  async function handleAdd() {
    if (!message.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const { data: note } = await (supabase as any).from('debtor_notes').insert({
      debtor_id: debtorId,
      user_id: user.id,
      message: message.trim(),
    }).select('*, user:profiles!debtor_notes_user_id_fkey(full_name)').single()
    if (note) setNotes(prev => [note, ...prev])
    setMessage('')
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(118,118,118,0.08)]">
        <h3 className="text-sm font-bold text-[#231F20]">الملاحظات ({notes.length})</h3>
      </div>

      {/* Add note */}
      <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.08)] bg-[#F3F1F2]/50">
        <div className="flex gap-2">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={2}
            placeholder="اكتب ملاحظة..."
            className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] resize-none"
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd() }}
          />
          <button
            onClick={handleAdd}
            disabled={saving || !message.trim()}
            className="self-end px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {saving ? '...' : 'إضافة'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
        </div>
      ) : !notes.length ? (
        <div className="py-8 text-center text-[#767676] text-sm">لا توجد ملاحظات</div>
      ) : (
        <div className="divide-y divide-[rgba(118,118,118,0.08)]">
          {notes.map(note => (
            <div key={note.id} className="px-5 py-3.5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-full bg-[#2C8780]/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-[#2C8780]">
                    {note.user?.full_name?.charAt(0) ?? 'م'}
                  </span>
                </div>
                <span className="text-xs font-semibold text-[#231F20]">{note.user?.full_name ?? 'مجهول'}</span>
                <span className="text-[10px] text-[#767676] font-mono mr-auto" dir="ltr">{fmtDateTime(note.created_at)}</span>
              </div>
              {note.message && <p className="text-sm text-[#231F20] leading-relaxed pr-8">{note.message}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
