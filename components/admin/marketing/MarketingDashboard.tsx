'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OverviewPanel } from './OverviewPanel'
import { AutomationsPanel } from './AutomationsPanel'
import { TemplatesPanel } from './TemplatesPanel'
import { PromotionsPanel } from './PromotionsPanel'
import { ControlPanel } from './ControlPanel'

/**
 * Client Marketing hub shell.
 *
 * Five tabbed sections: Overview (audience opportunities), Automations,
 * Templates, Promotions and Controls. Each tab owns its own data fetching and
 * mounts lazily, so opening the hub still makes a single request (Overview) and
 * the configuration tabs only fetch when first opened.
 *
 * Nothing in this hub can send email. Every panel edits configuration only; the
 * global control state (Controls tab) stays authoritative and defaults fully
 * paused. This entire route remains a HIDDEN admin route — never linked from
 * the admin navigation.
 */
export function MarketingDashboard() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Marketing</h1>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          Configure marketing automations, email templates and campaign promotions. Sending stays
          paused until the global controls are turned on.
        </p>
      </div>

      <Tabs defaultValue="overview" className="gap-5">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="promotions">Promotions</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewPanel />
        </TabsContent>
        <TabsContent value="automations">
          <AutomationsPanel />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesPanel />
        </TabsContent>
        <TabsContent value="promotions">
          <PromotionsPanel />
        </TabsContent>
        <TabsContent value="controls">
          <ControlPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
