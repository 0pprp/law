import DebtorAccountArchive from '@/components/DebtorAccountArchive'

export default async function DebtorAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DebtorAccountArchive id={id} />
}
