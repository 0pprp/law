import type { SupabaseClient } from '@supabase/supabase-js'

/** أقصى طول لنص الملاحظة في الجداول (بعد اسم الكاتب) */
export const LAST_NOTE_PREVIEW_MAX = 60

/** كاتب الملاحظة القديمة المخزّنة في debtors.notes فقط */
export const LEGACY_NOTE_AUTHOR = 'مستورد'

type ProfileEmbed = { full_name?: string | null } | { full_name?: string | null }[] | null | undefined

function resolveAuthorName(user: ProfileEmbed): string | null {
  if (!user) return null
  const row = Array.isArray(user) ? user[0] : user
  const name = row?.full_name?.trim()
  return name || null
}

/**
 * شكل العرض: «الكاتب: نص الملاحظة...» — أو «—» إن لم توجد ملاحظة.
 */
export function formatLastNotePreview(
  authorName: string | null | undefined,
  message: string | null | undefined,
  maxLen = LAST_NOTE_PREVIEW_MAX,
): string {
  const msg = String(message ?? '').trim()
  if (!msg) return '—'
  const author = String(authorName ?? '').trim() || 'مجهول'
  const body = msg.length > maxLen ? `${msg.slice(0, maxLen)}...` : msg
  return `${author}: ${body}`
}

/**
 * آخر ملاحظة لكل مدين بطلب مجمّع (بدون N+1).
 * الأولوية: أحدث صف في debtor_notes؛ وإلا debtors.notes كـ«مستورد».
 */
export async function fetchLastNotePreviewsByDebtorIds(
  supabase: SupabaseClient,
  debtorIds: string[],
  legacyNotesById?: Map<string, string | null | undefined> | Record<string, string | null | undefined>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const ids = [...new Set(debtorIds.filter(Boolean))]
  if (!ids.length) return result

  const latest = new Map<string, { message: string; author: string | null }>()
  const CHUNK = 200

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('debtor_notes')
      .select('debtor_id, message, created_at, user:profiles!debtor_notes_user_id_fkey(full_name)')
      .in('debtor_id', chunk)
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('[debtor-last-notes] fetch failed:', error.message)
      continue
    }

    for (const row of data ?? []) {
      const debtorId = String((row as { debtor_id?: string }).debtor_id ?? '')
      if (!debtorId || latest.has(debtorId)) continue
      const message = String((row as { message?: string | null }).message ?? '').trim()
      if (!message) continue
      latest.set(debtorId, {
        message,
        author: resolveAuthorName((row as { user?: ProfileEmbed }).user),
      })
    }
  }

  const getLegacy = (id: string): string => {
    if (!legacyNotesById) return ''
    if (legacyNotesById instanceof Map) return String(legacyNotesById.get(id) ?? '').trim()
    return String(legacyNotesById[id] ?? '').trim()
  }

  for (const id of ids) {
    const note = latest.get(id)
    if (note) {
      result.set(id, formatLastNotePreview(note.author, note.message))
      continue
    }
    const legacy = getLegacy(id)
    result.set(id, legacy ? formatLastNotePreview(LEGACY_NOTE_AUTHOR, legacy) : '—')
  }

  return result
}

/** يلحق حقل last_note على مصفوفة كائنات فيها id (واختيارياً notes للتوافق القديم) */
export async function attachLastNotes<T extends { id: string; notes?: string | null }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<Array<T & { last_note: string }>> {
  if (!rows.length) return []
  const legacy = new Map(rows.map(r => [r.id, r.notes ?? null]))
  const previews = await fetchLastNotePreviewsByDebtorIds(
    supabase,
    rows.map(r => r.id),
    legacy,
  )
  return rows.map(r => ({
    ...r,
    last_note: previews.get(r.id) ?? '—',
  }))
}
