import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/auth"
import { WalletDetail } from "@/components/admin/wallets/WalletDetail"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  const { userId } = await params
  if (!UUID_RE.test(userId)) {
    notFound()
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/wallets"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to search
        </Link>
        <h2 className="text-3xl font-bold tracking-tight">Customer Wallet</h2>
        <p className="text-muted-foreground">
          View balances, transactions and add WTF Credit
        </p>
      </div>

      <WalletDetail userId={userId} />
    </div>
  )
}
