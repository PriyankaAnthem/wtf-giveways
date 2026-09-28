import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { InstantWinPrize, InstantWinTier } from "@/lib/types/instantWins"

interface InstantWinPrizesTableProps {
  prizes: InstantWinPrize[]
}

function getTierBadgeVariant(tier: InstantWinTier): "default" | "secondary" | "outline" {
  switch (tier) {
    case 'big':
      return 'default'
    case 'medium':
      return 'secondary'
    case 'small':
      return 'outline'
  }
}

export default function InstantWinPrizesTable({ prizes }: InstantWinPrizesTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Instant win prizes</CardTitle>
        <Button disabled size="sm">
          Add prize
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prize</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Remaining / Total</TableHead>
              <TableHead>Weight</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prizes.map((prize) => (
              <TableRow key={prize.id}>
                <TableCell className="font-medium">{prize.name}</TableCell>
                <TableCell>
                  <Badge variant={getTierBadgeVariant(prize.tier)}>
                    {prize.tier}
                  </Badge>
                </TableCell>
                <TableCell>{prize.valueLabel}</TableCell>
                <TableCell>
                  {prize.remainingQty} / {prize.totalQty}
                </TableCell>
                <TableCell>{prize.weight}</TableCell>
                <TableCell>
                  <Badge variant={prize.isActive ? "secondary" : "outline"}>
                    {prize.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button disabled variant="outline" size="sm">
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
