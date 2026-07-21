export interface LogParams {
  action: string
  entity_type?: string
  entity_id?: string
  description?: string
  /** يُدمج في new_data — استخدم case_type لتوثيق القسم */
  metadata?: Record<string, unknown>
  case_type?: 'civil' | 'criminal' | null
}

export async function logActivity(params: LogParams, supabaseClient?: any) {
  try {
    let client = supabaseClient
    if (!client) {
      const { createClient } = await import('./supabase/client')
      client = createClient()
    }
    const newData: Record<string, unknown> = {}
    if (params.description) newData.description = params.description
    if (params.metadata) Object.assign(newData, params.metadata)
    if (params.case_type === 'civil' || params.case_type === 'criminal') {
      newData.case_type = params.case_type
    }

    await client.from('activity_logs').insert({
      action: params.action,
      entity_type: params.entity_type ?? null,
      entity_id: params.entity_id ?? null,
      new_data: Object.keys(newData).length > 0 ? newData : null,
    })
  } catch {
    // Non-blocking — never let logging failure break the main operation
  }
}