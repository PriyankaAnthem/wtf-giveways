'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { OpsSummaryResponse } from './types'
import { fmtTime } from './ops-ui'
import { refreshSummary } from './ops-client'
import { MasterStatusCard } from './MasterStatusCard'
import { MasterControls } from './MasterControls'
import { AutomationsPanel } from './AutomationsPanel'
import { DefinitionsPanel } from './DefinitionsPanel'
import {
  QueuePanel,
  SuppressionsCard,
  RecentRecipientsPanel,
  RunsPanel,
} from './DeliveryActivityPanel'

/**
 * Marketing Operations Console (admin-only, client shell).
 *
 * Hydrated once from a server-rendered snapshot. There is NO polling or timer:
 * the summary only changes on a deliberate "Refresh status" click or after a
 * successful mutation (which also re-fetches the authoritative snapshot). Every
 * mutation is routed through a protected admin server endpoint — this component
 * never touches Supabase directly and can never invoke the delivery worker.
 */
export function OperationsConsole({ initial }: { initial: OpsSummaryResponse }) {
  const { toast } = useToast()
  const [summary, setSummary] = useState<OpsSummaryResponse>(initial)
  const [isPending, startTransition] = useTransition()

  function refresh() {
    startTransition(async () => {
      const next = await refreshSummary()
      if (next) {
        setSummary(next)
      } else {
        toast({
          title: 'Could not refresh',
          description: 'The status snapshot could not be loaded. Try again.',
          variant: 'destructive',
        })
      }
    })
  }

  const queuedRecipientCount = summary.queue.countsByStatus.queued ?? 0

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Marketing Operations</h1>
          <p className="text-sm text-muted-foreground">
            Control centre for marketing delivery · snapshot {fmtTime(summary.generatedAt)}
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={isPending}>
          <RefreshCw
            className={`mr-1.5 h-4 w-4 ${isPending ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh status
        </Button>
      </header>

      <MasterStatusCard control={summary.control} derived={summary.derived} />

      <MasterControls
        control={summary.control}
        derived={summary.derived}
        queuedRecipientCount={queuedRecipientCount}
        onChanged={refresh}
      />

      <AutomationsPanel automations={summary.automations} onChanged={refresh} />

      <DefinitionsPanel definitions={summary.definitions} onChanged={refresh} />

      <QueuePanel queue={summary.queue} />

      <SuppressionsCard suppressions={summary.suppressions} />

      <RecentRecipientsPanel recipients={summary.recentRecipients} />

      <RunsPanel runs={summary.recentRuns} />
    </div>
  )
}
