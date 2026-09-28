import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ReleaseRule, ReleaseRuleType, InstantWinTier } from "@/lib/types/instantWins"

interface ReleaseRulesEditorProps {
  rules: ReleaseRule[]
}

function getRuleTypeBadge(type: ReleaseRuleType): string {
  switch (type) {
    case 'tickets_sold_percent':
      return 'Tickets %'
    case 'time':
      return 'Time'
  }
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

export default function ReleaseRulesEditor({ rules }: ReleaseRulesEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pacing rules</CardTitle>
        <p className="text-sm text-muted-foreground">
          Control when tiers can be won (hold back big prizes until later).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <Badge variant="secondary">
                  {getRuleTypeBadge(rule.type)}
                </Badge>
                <span className="font-medium">{rule.thresholdLabel}</span>
                <span className="text-sm text-muted-foreground">→</span>
                <div className="flex items-center gap-1.5">
                  {rule.eligibleTiers.map((tier) => (
                    <Badge key={tier} variant={getTierBadgeVariant(tier)}>
                      {tier}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hold-back-toggle"
              className="size-4 rounded border-input"
            />
            <label htmlFor="hold-back-toggle" className="text-sm font-medium">
              Hold back big prizes until late stage
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <Button disabled>Save rules</Button>
        </div>
      </CardContent>
    </Card>
  )
}
