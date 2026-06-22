import type { TaskType } from './types'

export const TASK_FEE_MAP: Record<TaskType, number> = {
  file_lawsuit: 50000,
  notification: 25000,
  pleading: 30000,
  decision_ratification: 25000,
  open_file: 20000,
  summons: 25000,
  inspection: 30000,
  forced_appearance: 50000,
  arrest_warrant: 50000,
  arrest_warrant_broadcast: 25000,
  imprisonment_in_absentia: 50000,
  imprisonment_broadcast: 25000,
  department_correspondence: 20000,
  newspaper_publication: 30000,
  salary_seizure: 40000,
  first_registration: 50000,
  file_closure: 20000,
}