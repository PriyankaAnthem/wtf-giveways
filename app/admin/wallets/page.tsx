import { requireAdmin } from "@/lib/admin/auth"
import { WalletSearch } from "@/components/admin/wallets/WalletSearch"

export default async function WalletsPage() {
  await requireAdmin({ roles: ['admin', 'operations_admin'] })

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">WTF Credit</h2>
        <p className="text-muted-foreground">
          Search customers and manage their WTF Credit balances
        </p>
      </div>

      <WalletSearch />
    </div>
  )
}
