/** Visual config for dashboard stage cards — colors cycle by sort_order */

export const STAGE_ACCENTS = ['teal', 'blue', 'orange', 'green', 'navy', 'red'] as const
export type StageAccent = (typeof STAGE_ACCENTS)[number]

export const STAGE_ICON_BGS = [
  'bg-gradient-to-br from-[#2C8780] to-[#1D6365]',
  'bg-gradient-to-br from-sky-500 to-blue-700',
  'bg-gradient-to-br from-amber-500 to-orange-600',
  'bg-gradient-to-br from-emerald-500 to-green-700',
  'bg-gradient-to-br from-slate-700 to-[#231F20]',
  'bg-gradient-to-br from-red-500 to-rose-700',
]

export function stageAccent(index: number): StageAccent {
  return STAGE_ACCENTS[index % STAGE_ACCENTS.length]
}

export function stageIconBg(index: number): string {
  return STAGE_ICON_BGS[index % STAGE_ICON_BGS.length]
}

export const STALLED_STATUSES = ['needs_info', 'rejected', 'postponed', 'failed'] as const
