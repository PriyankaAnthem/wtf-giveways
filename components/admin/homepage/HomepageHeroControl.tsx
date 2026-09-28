'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown, Loader2, AlertCircle, Radio, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LiveTakeoverControl,
  type SiteTakeoverValue,
} from '@/components/admin/campaigns/live-board/LiveTakeoverControl'
import { HERO_BADGES, type HeroBadge } from '@/lib/homepage-hero-badges'

/**
 * Homepage Main Banner (hero) admin controller — the single control centre for
 * the homepage banner. Left column: choose the competition + badge (writes the
 * `homepage_hero` singleton via `/api/admin/homepage-hero`) and, for a Balloon
 * Pop selection, manage LIVE inline. Right column: a real preview.
 *
 * LIVE is NOT a second flag: the LIVE section reuses the existing
 * `LiveTakeoverControl`, which calls the existing
 * `PATCH /api/admin/campaigns/[id]/live-board` mutation (with its single-active
 * exclusivity + URL safety). Selection/badge and LIVE are independent saves, so
 * a failure in one never falsely reports the other as saved.
 *
 * The existing rail management below this card is untouched.
 */

const NONE_VALUE = '__none__'

type HeroEligibleItem = {
  id: string
  title: string
  slug: string | null
  category: string
}

export function HomepageHeroControl({
  eligible,
  initialCampaignId,
  initialBadge,
  liveTakeover,
  preview,
}: {
  eligible: HeroEligibleItem[]
  initialCampaignId: string | null
  initialBadge: HeroBadge | null
  /** Existing takeover values for the saved Balloon Pop (null otherwise). */
  liveTakeover: SiteTakeoverValue | null
  /** Server-rendered real hero preview (reflects the saved state). */
  preview: ReactNode
}) {
  const router = useRouter()
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId)
  const [badge, setBadge] = useState<HeroBadge | null>(initialBadge)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const byId = useMemo(() => {
    const m = new Map<string, HeroEligibleItem>()
    for (const item of eligible) m.set(item.id, item)
    return m
  }, [eligible])

  const selected = campaignId ? byId.get(campaignId) ?? null : null
  const selectedIsBalloon = selected?.category === 'live_balloon'
  const selectionChanged = campaignId !== initialCampaignId
  const dirty = campaignId !== initialCampaignId || badge !== initialBadge

  const save = async () => {
    setStatus('saving')
    setError(null)
    try {
      const res = await fetch('/api/admin/homepage-hero', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroCampaignId: campaignId, heroBadge: badge }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Save failed (${res.status})`)
      setStatus('saved')
      // Re-read server props so the LIVE section + preview reflect the newly
      // saved selection.
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
      setStatus('error')
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-xl">Homepage Main Banner</CardTitle>
          <p className="text-sm text-muted-foreground">
            The single control centre for the homepage banner. Pick the competition and badge; for a
            Balloon Pop you can also go LIVE, set the watch URL and edit the live copy here.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status === 'saving' ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Saving…
            </span>
          ) : status === 'error' ? (
            <span className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="size-4" /> {error ?? 'Error'}
            </span>
          ) : status === 'saved' && !dirty ? (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" /> Saved
            </span>
          ) : dirty ? (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          ) : null}
          <Button size="sm" onClick={save} disabled={status === 'saving' || !dirty}>
            {status === 'saving' ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Saving…
              </>
            ) : (
              'Save Banner'
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 pt-6 lg:grid-cols-2">
        {/* ── Controls ─────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Featured competition selector (searchable). */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Featured Competition</label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full justify-between bg-transparent font-normal"
                >
                  <span className="truncate">
                    {selected ? selected.title || 'Untitled competition' : 'None (hide banner)'}
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search live competitions…" />
                  <CommandList>
                    <CommandEmpty>No eligible competitions.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="none"
                        onSelect={() => {
                          setCampaignId(null)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={'size-4 ' + (campaignId === null ? 'opacity-100' : 'opacity-0')}
                        />
                        None (hide banner)
                      </CommandItem>
                      {eligible.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={`${item.title} ${item.slug ?? ''} ${item.id}`}
                          onSelect={() => {
                            setCampaignId(item.id)
                            setOpen(false)
                          }}
                        >
                          <Check
                            className={
                              'size-4 ' + (campaignId === item.id ? 'opacity-100' : 'opacity-0')
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {item.title || 'Untitled competition'}
                            {item.slug ? (
                              <span className="text-muted-foreground"> /{item.slug}</span>
                            ) : null}
                          </span>
                          {item.category === 'live_balloon' ? (
                            <Badge variant="outline" className="ml-2 shrink-0 font-normal">
                              Balloon
                            </Badge>
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Only live, eligible competitions can be featured. If the selected competition ends, the
              banner hides automatically. This never adds, removes or reorders any rail.
            </p>
          </div>

          {/* Badge selector. */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Banner Badge</label>
            <Select
              value={badge ?? NONE_VALUE}
              onValueChange={(v) => setBadge(v === NONE_VALUE ? null : (v as HeroBadge))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No badge" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>No badge</SelectItem>
                {HERO_BADGES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Shown as the small capsule at the top of the Featured banner.
            </p>
          </div>

          {/* ── Balloon Pop LIVE — contextual ────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-pink-500" />
              <span className="text-sm font-medium">Balloon Pop LIVE</span>
            </div>

            {!selected ? (
              <HeroNote>Select a competition to configure the banner.</HeroNote>
            ) : !selectedIsBalloon ? (
              <HeroNote>
                Not a Balloon Pop competition — the banner always uses the Featured design, so there
                are no LIVE controls.
              </HeroNote>
            ) : selectionChanged ? (
              <HeroNote>
                Press <span className="font-medium text-foreground">Save Banner</span> first, then
                manage this competition&apos;s LIVE takeover right here — no other screen needed.
              </HeroNote>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Set the watch URL and live copy, then turn LIVE on. Enabling LIVE here is all
                  that&apos;s required — no separate live-board setup. Turning it on automatically
                  turns off any other competition&apos;s takeover.
                </p>
                <LiveTakeoverControl
                  campaignId={initialCampaignId as string}
                  initial={liveTakeover}
                  onSaved={() => router.refresh()}
                />
              </>
            )}
          </div>
        </div>

        {/* ── Preview ──────────────────────────────────────────────── */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Banner preview</label>
          <div className="overflow-hidden rounded-2xl border bg-[#08000f] p-4">
            <div className="mx-auto w-full max-w-[420px]">{preview}</div>
          </div>
          <p className="text-xs text-muted-foreground">
            Reflects the currently saved banner. Toggling LIVE on/off updates this preview after it
            saves.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function HeroNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
