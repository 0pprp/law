import DebtorAccountArchive from '@/components/DebtorAccountArchive'

export default async function BranchManagerDebtorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <DebtorAccountArchive
      id={id}
      backFallback="/branch-manager/debtors"
      breadcrumbHref="/branch-manager/debtors"
      breadcrumbLabel="مدينو الفرع"
    />
  )
}
