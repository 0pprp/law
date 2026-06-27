import { redirect } from 'next/navigation'

export default async function DebtorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/debtors/${id}/account`)
}
