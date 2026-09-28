'use client'

import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatPenceCompact } from '@/lib/admin/reporting/format'
import type { ChartPoint } from '@/lib/admin/reporting/types'

const chartConfig = {
  external_pence: { label: 'External revenue', color: 'var(--chart-1)' },
  gross_pence: { label: 'Gross sales', color: 'var(--chart-2)' },
  credit_pence: { label: 'Credit redeemed', color: 'var(--chart-3)' },
} satisfies ChartConfig

function formatTick(t: string, unit: string): string {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return t
  if (unit === 'hour') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  }
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Europe/London' })
}

export function RevenueChart({ points, unit }: { points: ChartPoint[]; unit: string }) {
  const data = useMemo(
    () =>
      points.map((p) => ({
        t: p.t,
        external_pence: p.external_pence,
        gross_pence: p.gross_pence,
        credit_pence: p.credit_pence,
      })),
    [points],
  )

  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        No sales in this period
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <h2 className="mb-3 px-1 text-sm font-semibold text-foreground">Revenue over time</h2>
      <ChartContainer config={chartConfig} className="aspect-[16/9] max-h-[280px] w-full">
        <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(t) => formatTick(t as string, unit)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v) => formatPenceCompact(v as number)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const t = payload?.[0]?.payload?.t as string | undefined
                  return t ? formatTick(t, unit) : ''
                }}
                formatter={(value, name) => [
                  formatPenceCompact(value as number),
                  chartConfig[name as keyof typeof chartConfig]?.label ?? String(name),
                ]}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {(['external_pence', 'gross_pence', 'credit_pence'] as const).map((key) => (
            <Area
              key={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              fill={`var(--color-${key})`}
              fillOpacity={0.15}
              strokeWidth={2}
              stackId={undefined}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </div>
  )
}
