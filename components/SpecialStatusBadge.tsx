import { specialStatusColorOption } from '@/lib/special-statuses'

export default function SpecialStatusBadge({
  name,
  color,
  className = '',
}: {
  name: string
  color?: string | null
  className?: string
}) {
  const label = name.trim()
  if (!label) return null
  const opt = specialStatusColorOption(color)
  return (
    <span
      className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${opt.badge} ${className}`}
    >
      {label}
    </span>
  )
}
