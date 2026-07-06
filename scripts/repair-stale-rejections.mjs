/**
 * Repair stale assignment rejections (assigned_to still set after give_up_reason).
 * Run: node --env-file=.env.local scripts/repair-stale-rejections.mjs
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data: stale, error } = await sb
  .from('tasks')
  .select('id, assigned_to, assignment_rejected_by, give_up_reason')
  .eq('task_status', 'waiting_assignment')
  .not('give_up_reason', 'is', null)
  .not('assigned_to', 'is', null)

if (error) {
  console.error(error.message)
  process.exit(1)
}

if (!stale?.length) {
  console.log('No stale rejection tasks.')
  process.exit(0)
}

for (const task of stale) {
  const lawyerId = task.assigned_to
  const payload = {
    assigned_to: null,
    assigned_at: null,
    assignment_expires_at: null,
    assignment_rejected_by: task.assignment_rejected_by ?? lawyerId,
  }
  const { error: upErr } = await sb.from('tasks').update(payload).eq('id', task.id)
  if (upErr) {
    console.error(`Failed ${task.id}:`, upErr.message)
    process.exit(1)
  }
  console.log(`Repaired task ${task.id}`)
}

console.log(`Done. Repaired ${stale.length} task(s).`)
