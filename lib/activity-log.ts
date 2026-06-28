export interface LogParams {
  action: string
  entity_type?: string
  entity_id?: string
  description?: string
  metadata?: Record<string, unknown>
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