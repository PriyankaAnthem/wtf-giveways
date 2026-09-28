'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SignOutButton } from './sign-out-button'
import { MarketingEmailPreference } from './marketing-email-preference'
import { createClient } from '@/lib/supabase/client'
import { Ticket } from 'lucide-react'

interface UserPreferences {
  instant_win_notifications: boolean
  marketing_emails: boolean
  partner_emails: boolean
}

type EntryRow = {
  id: string
  campaign_id: string
  qty: number
  created_at: string
  checkout_intent_id: string | null
}

type AllocationInfo = { start_ticket: number; end_ticket: number }
type CampaignInfo = { title: string; status: string; slug: string | null }
type WinInfo = { awardId: string; prizeTitle: string; awardedAt: string }

interface AccountTabsProps {
  email: string
  entries: EntryRow[]
  entriesError: string | null
  allocationMap: Record<string, AllocationInfo>
  campaignMap: Record<string, CampaignInfo>
  winsMap: Record<string, WinInfo[]>
}

function formatDateUK(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function TicketDisplay({ start, end }: { start?: number | null; end?: number | null }) {
  if (typeof start !== 'number' || typeof end !== 'number') {
    return <span className="text-white/50">Tickets: pending</span>
  }
  if (start === end) {
    return <span className="font-mono font-semibold text-white">{'Ticket #' + start}</span>
  }
  const count = end - start + 1
  return (
    <span className="font-mono font-semibold text-white">
      {'Tickets #' + start + '\u2013#' + end}
      <span className="ml-1 text-xs font-normal text-white/60">
        {'(' + count + ' ticket' + (count === 1 ? '' : 's') + ')'}
      </span>
    </span>
  )
}

function resolveCampaignTitle(campaign: CampaignInfo | undefined, entryId?: string, campaignId?: string): string {
  if (campaign?.title && campaign.title.trim().length > 0) {
    return campaign.title
  }
  // Debug log only for missing campaigns
  if (!campaign && entryId && campaignId) {
    console.log('[me-debug] missing campaign for entry', entryId, campaignId)
  }
  return 'Competition'
}

// A campaign is a "past draw" only once it has ended. Everything else
// (live/paused/sold_out/draft) is a current entry, never labelled ENDED.
function isEndedStatus(status: string | undefined): boolean {
  return status === 'ended'
}

// Accurate, non-misleading status badge for each entry.
function getStatusBadge(status: string): { label: string; live: boolean } {
  switch (status) {
    case 'live':
      return { label: 'LIVE', live: true }
    case 'paused':
      return { label: 'PAUSED', live: false }
    case 'sold_out':
      return { label: 'DRAW PENDING', live: false }
    case 'ended':
      return { label: 'ENDED', live: false }
    default:
      return { label: 'ACTIVE', live: false }
  }
}

export function AccountTabs({ email, entries, entriesError, allocationMap, campaignMap, winsMap }: AccountTabsProps) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null)
  // Past draws collapse: default collapsed when there are current entries,
  // open when every entry is a past (ended) draw.
  const [pastOpen, setPastOpen] = useState<boolean>(() => {
    const hasCurrent = entries.some((e) => !isEndedStatus(campaignMap[e.campaign_id]?.status))
    return !hasCurrent
  })
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [prefsError, setPrefsError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const loadPrefs = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setPrefsLoading(false)
        return
      }

      // Try to fetch existing preferences
      const { data, error } = await supabase
        .from('user_preferences')
        .select('instant_win_notifications, marketing_emails, partner_emails')
        .eq('user_id', user.id)
        .single()

      if (error && error.code === 'PGRST116') {
        // No row exists - create one with defaults
        const defaults: UserPreferences = {
          instant_win_notifications: true,
          marketing_emails: true,
          partner_emails: false,
        }
        const { error: insertError } = await supabase
          .from('user_preferences')
          .insert({ user_id: user.id, ...defaults })

        if (insertError) {
          setPrefsError('Failed to initialize preferences')
        } else {
          setPrefs(defaults)
        }
      } else if (error) {
        setPrefsError('Failed to load preferences')
      } else {
        setPrefs(data)
      }
      setPrefsLoading(false)
    }
    loadPrefs()
  }, [])

  const updatePref = async (key: keyof UserPreferences, value: boolean) => {
    if (!prefs) return
    const oldPrefs = { ...prefs }
    setPrefs({ ...prefs, [key]: value })
    setSaving(true)
    setPrefsError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setPrefs(oldPrefs)
      setPrefsError('Not authenticated')
      setSaving(false)
      return
    }

    const { error } = await supabase
      .from('user_preferences')
      .update({ [key]: value, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    if (error) {
      setPrefs(oldPrefs)
      setPrefsError('Failed to save preference')
    }
    setSaving(false)
  }

  return (
    <Tabs defaultValue="tickets" className="w-full">
      <TabsList className="flex w-full gap-2 overflow-x-auto rounded-xl bg-white/5 p-1 backdrop-blur-md border border-white/10">
        <TabsTrigger value="tickets" className="flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium text-white/70 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-400 data-[state=active]:to-yellow-600 data-[state=active]:text-black data-[state=active]:shadow-md">My Tickets</TabsTrigger>
        <TabsTrigger value="profile" className="flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium text-white/70 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-400 data-[state=active]:to-yellow-600 data-[state=active]:text-black data-[state=active]:shadow-md">Profile</TabsTrigger>
        <TabsTrigger value="settings" className="flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium text-white/70 transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-400 data-[state=active]:to-yellow-600 data-[state=active]:text-black data-[state=active]:shadow-md">Settings</TabsTrigger>
      </TabsList>

      {/* My Tickets */}
      <TabsContent value="tickets">
        <div className="rounded-2xl border border-white/10 bg-[#1f0033]/70 backdrop-blur-md shadow-[0_0_30px_rgba(255,215,0,0.06)] p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">My Entries</h2>
            <p className="text-sm text-white/70">Your active and past giveaway entries</p>
          </div>
          
          {entriesError ? (
            <p className="py-4 text-sm text-red-400">
              {'Failed to load entries: ' + entriesError}
            </p>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <p className="text-sm text-white/60">No entries yet.</p>
              <Button asChild size="sm" className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-black font-semibold hover:from-yellow-500 hover:to-yellow-700">
                <a href="/giveaways">Browse Giveaways</a>
              </Button>
            </div>
          ) : (
            (() => {
              // Current = not ended (live/paused/sold_out/draft).
              // Past draws = ended only. No bogus 'active' status is used.
              const currentEntries = entries.filter(
                (e) => !isEndedStatus(campaignMap[e.campaign_id]?.status),
              )
              const endedEntries = entries.filter((e) =>
                isEndedStatus(campaignMap[e.campaign_id]?.status),
              )

              const renderEntryCard = (entry: EntryRow) => {
                const campaign = campaignMap[entry.campaign_id]
                const allocation = allocationMap[entry.id]
                // Instant wins are attributed to the exact checkout that won.
                // Only show a badge when this entry's checkout_intent_id has a
                // matching award — never by campaign.
                const wins: WinInfo[] = entry.checkout_intent_id
                  ? winsMap[entry.checkout_intent_id] || []
                  : []
                const status = campaign?.status || 'unknown'
                const badge = getStatusBadge(status)
                const title = resolveCampaignTitle(campaign, entry.id, entry.campaign_id)

                return (
                  <div
                    key={entry.id}
                    className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition-all duration-300 hover:bg-white/[0.07]"
                  >
                    {/* Lightweight CSS icon tile — no remote images are loaded. */}
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-purple-500/20 to-yellow-500/10">
                      <Ticket className="h-7 w-7 text-yellow-400/80" aria-hidden="true" />
                    </div>

                    {/* Content */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {/* Title + Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="truncate text-sm font-semibold text-white leading-tight">
                          {title}
                        </h3>
                        <span
                          className={
                            badge.live
                              ? 'shrink-0 rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-xs font-medium text-green-300'
                              : 'shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/60'
                          }
                        >
                          {badge.label}
                        </span>
                      </div>

                      {/* Tickets */}
                      <div className="text-sm">
                        <TicketDisplay
                          start={allocation?.start_ticket}
                          end={allocation?.end_ticket}
                        />
                      </div>

                      {/* Date */}
                      <p className="text-xs text-white/50">
                        Bought {formatDateUK(entry.created_at)}
                      </p>

                      {/* Win status — safe, non-misleading wording.
                          Only claims a win when a checkout-level award exists;
                          otherwise shows neutral status, never implying loss. */}
                      {wins.length > 0 ? (
                        <div className="mt-1 rounded-md bg-yellow-500/15 px-2 py-1 text-xs font-medium text-yellow-300">
                          <span className="font-semibold">
                            {wins.length > 1 ? `Instant Winner \u2014 ${wins.length} prizes` : 'Instant Winner'}
                          </span>
                          {/* Each award is listed on its own line so two prizes
                              with the same title still show as two wins. */}
                          <ul className="mt-1 space-y-0.5">
                            {wins.map((w, i) => (
                              <li key={w.awardId ?? `${w.prizeTitle}-${i}`} className="flex items-center gap-1.5">
                                <span aria-hidden="true">{'\u{1F381}'}</span>
                                <span>{w.prizeTitle}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-white/40">
                          {status === 'ended'
                            ? 'Draw complete \u2014 see Winners'
                            : status === 'sold_out'
                              ? 'Draw pending'
                              : status === 'paused'
                                ? 'Entry active \u2014 draw paused'
                                : 'Entry active'}
                        </p>
                      )}
                    </div>
                  </div>
                )
              }

              return (
                <div className="space-y-6">
                  {/* Current Entries Section */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-green-400">
                      Current entries ({currentEntries.length})
                    </h3>
                    {currentEntries.length === 0 ? (
                      <p className="py-4 text-sm text-white/50">No current entries right now.</p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {currentEntries.map(renderEntryCard)}
                      </div>
                    )}
                  </div>

                  {/* Past Draws Section (collapsible) */}
                  {endedEntries.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setPastOpen((v) => !v)}
                        aria-expanded={pastOpen}
                        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.08]"
                      >
                        <span>Past draws ({endedEntries.length})</span>
                        <svg
                          className={
                            'h-4 w-4 shrink-0 transition-transform duration-200 ' +
                            (pastOpen ? 'rotate-180' : '')
                          }
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {pastOpen && (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {endedEntries.map(renderEntryCard)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()
          )}
        </div>
      </TabsContent>

      {/* Profile */}
      <TabsContent value="profile">
        <div className="rounded-2xl border border-white/10 bg-[#1f0033]/70 backdrop-blur-md shadow-[0_0_30px_rgba(255,215,0,0.06)] p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Profile</h2>
            <p className="text-sm text-white/70">Your account information</p>
          </div>
          
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-white/60">Email</p>
              <p className="text-sm text-white">{email}</p>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </TabsContent>

      {/* Settings */}
      <TabsContent value="settings">
        <div className="rounded-2xl border border-white/10 bg-[#1f0033]/70 backdrop-blur-md shadow-[0_0_30px_rgba(255,215,0,0.06)] p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <p className="text-sm text-white/70">Manage your preferences</p>
          </div>
          
          {prefsLoading ? (
            <p className="text-sm text-white/60">Loading preferences...</p>
          ) : prefsError && !prefs ? (
            <p className="text-sm text-red-400">{prefsError}</p>
          ) : prefs ? (
            <div className="space-y-4">
              {prefsError && (
                <p className="text-sm text-red-400">{prefsError}</p>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Instant Win Notifications</p>
                  <p className="text-sm text-white/60">Receive emails when you win instant prizes</p>
                </div>
                <Switch
                  checked={prefs.instant_win_notifications}
                  onCheckedChange={(v) => updatePref('instant_win_notifications', v)}
                  disabled={saving}
                  className="data-[state=checked]:bg-yellow-500"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Partner Emails</p>
                  <p className="text-sm text-white/60">Receive offers from our trusted partners</p>
                </div>
                <Switch
                  checked={prefs.partner_emails}
                  onCheckedChange={(v) => updatePref('partner_emails', v)}
                  disabled={saving}
                  className="data-[state=checked]:bg-yellow-500"
                />
              </div>

              {/* Email preferences — gated marketing consent (Stage 0).
                  Backed by the authenticated /api/account/marketing-preferences
                  API, NOT the legacy user_preferences table. The browser never
                  writes the marketing_* tables directly. */}
              <div className="space-y-2 pt-2">
                <p className="text-sm font-semibold text-white/80">Email preferences</p>
                <MarketingEmailPreference />
              </div>

              {/* Email Delivery Reminder */}
              <div className="mt-6 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
                <p className="text-sm font-medium text-yellow-300">Email Delivery Reminder</p>
                <p className="mt-1 text-sm text-white/70">
                  If you do not receive our emails, please check your junk or spam folder and mark{' '}
                  <span className="font-medium text-white">info@wtf-giveaways.co.uk</span> as safe.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </TabsContent>
    </Tabs>
  )
}
