import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { InstantWinsOverviewStats } from "@/lib/types/instantWins"

interface InstantWinsOverviewProps {
  stats: InstantWinsOverviewStats
}

export default function InstantWinsOverview({ stats }: InstantWinsOverviewProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Inventory Remaining</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.inventoryRemaining}</div>
          <p className="text-xs text-muted-foreground">Total unclaimed prizes</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Top Tier Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant={stats.topTierStatus === 'eligible' ? 'default' : 'secondary'}>
            {stats.topTierStatus === 'eligible' ? 'Eligible' : 'Locked'}
          </Badge>
          <p className="text-xs text-muted-foreground mt-2">
            {stats.topTierStatus === 'eligible' ? 'Big prizes available' : 'Waiting to unlock'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Next Unlock</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.nextUnlock}</div>
          <p className="text-xs text-muted-foreground">Until next tier unlocks</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Main Prize Draw</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.mainPrizeDrawAt}</div>
          <p className="text-xs text-muted-foreground">Campaign end date</p>
        </CardContent>
      </Card>
    </div>
  )
}
