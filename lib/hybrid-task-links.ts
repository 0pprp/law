/** روابط المهمة الهجينة — آمن حتى لو الجداول غير مطبّقة بعد */

export type HybridLinkInfo = {
  linked_definition_id: string
  label: string
  fee_amount: number
  is_optional: boolean
  sort_order: number
  task_type?: string | null
}

export type HybridLinksFetchResult = {
  isHybrid: boolean
  links: HybridLinkInfo[]
  schemaReady: boolean
}

export function isMissingHybridSchema(message: string | undefined | null): boolean {
  const m = String(message ?? '').toLowerCase()
  return (
    m.includes('task_definition_links')
    || m.includes('is_hybrid')
    || m.includes('hybrid_parent_task_id')
    || m.includes('does not exist')
    || m.includes('could not find')
    || m.includes('schema cache')
    || m.includes('pgrst205')
    || m.includes('pgrst204')
    || m.includes('42703')
    || m.includes('42p01')
  )
}

export function hybridFieldKey(definitionId: string, fieldKey: string): string {
  return `${definitionId}_${fieldKey}`
}

export function splitHybridFieldKey(
  prefixed: string,
  definitionIds: string[],
): { definitionId: string; fieldKey: string } | null {
  for (const id of definitionIds) {
    const prefix = `${id}_`
    if (prefixed.startsWith(prefix)) {
      return { definitionId: id, fieldKey: prefixed.slice(prefix.length) }
    }
  }
  return null
}

export function partitionCompletionDataByDefinition(
  completionData: Record<string, string>,
  definitionIds: string[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const id of definitionIds) out[id] = {}

  for (const [key, value] of Object.entries(completionData)) {
    const split = splitHybridFieldKey(key, definitionIds)
    if (split) {
      out[split.definitionId][split.fieldKey] = value
      continue
    }
    // مفاتيح بلا بادئة (مثل general_notes) تُنسب للأساسية إن وُجدت
    if (definitionIds[0]) {
      out[definitionIds[0]][key] = value
    }
  }
  return out
}

/** جلب روابط الهجين عبر API (مدير أو محامي بعد توسيع الصلاحية) */
export async function fetchHybridTaskLinks(parentDefinitionId: string): Promise<HybridLinksFetchResult> {
  if (!parentDefinitionId) {
    return { isHybrid: false, links: [], schemaReady: true }
  }

  try {
    const res = await fetch(
      `/api/admin/task-definition-links?parent_id=${encodeURIComponent(parentDefinitionId)}`,
    )
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      // 401/403 أو خطأ — سلوك عادي
      return { isHybrid: false, links: [], schemaReady: json.schemaReady !== false }
    }

    if (json.schemaReady === false) {
      return { isHybrid: false, links: [], schemaReady: false }
    }

    const raw = Array.isArray(json.links) ? json.links : []
    const links: HybridLinkInfo[] = raw
      .map((row: Record<string, unknown>): HybridLinkInfo => ({
        linked_definition_id: String(row.linked_definition_id ?? ''),
        label: String(row.label ?? ''),
        fee_amount: Number(row.fee_amount ?? 0),
        is_optional: row.is_optional !== false,
        sort_order: Number(row.sort_order ?? 0),
        task_type: typeof row.task_type === 'string' ? row.task_type : null,
      }))
      .filter((l: HybridLinkInfo) => Boolean(l.linked_definition_id))
      .sort((a: HybridLinkInfo, b: HybridLinkInfo) => a.sort_order - b.sort_order)

    return {
      isHybrid: links.length > 0,
      links,
      schemaReady: true,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMissingHybridSchema(msg)) {
      return { isHybrid: false, links: [], schemaReady: false }
    }
    return { isHybrid: false, links: [], schemaReady: true }
  }
}
