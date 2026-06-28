'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function CurrentBranchDisplay() {
  const [branchName, setBranchName] = useState<string | null>(null)

  async function fetchBranch() {
    const id = typeof window !== 'undefined' ? localStorage.getItem('selected_branch_id') : null
    if (!id) { setBranchName(null); return }
    const supabase = createClient()
    const { data } = await supabase.from('branches').select('name').eq('id', id).single()
    setBranchName(data?.name ?? null)
  }

  useEffect(() => {
    fetchBranch()
    window.addEventListener('branch-changed', fetchBranch)
    return () => window.removeEventListener('branch-changed', fetchBranch)
  }, [])

  if (!branchName) return null

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-[#2C8780]/80 font-semibold bg-[#2C8780]/10 px-2.5 py-1 rounded-full mt-1">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
      الفرع الحالي: {branchName}
    </span>
  )
}
