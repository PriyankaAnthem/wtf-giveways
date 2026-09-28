'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronLeft, ChevronRight, Check, X, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { AdminInstantWinAward } from '@/lib/types/instantWins'

const PAID_STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
]

const ALL_CAMPAIGNS_VALUE = '__all__'

type CampaignOption = { id: string; title: string; slug: string }

// Friendly messages for the server's validation error codes.
const SEARCH_ERROR_MESSAGES: Record<string, string> = {
  query_too_short: 'Please enter at least 3 characters (or a ticket number).',
  query_too_long: 'That search is too long. Please shorten it.',
  invalid_query: 'That search contains characters we can’t use. Please try again.',
  invalid_campaign: 'The selected campaign is invalid.',
  complete_email_required: 'Please enter the full email address.',
}

function friendlyError(code: string | undefined): string {
  if (!code) return 'Failed to load awards'
  return SEARCH_ERROR_MESSAGES[code] ?? code
}

function formatPence(pence: number | null): string {
  if (pence === null || pence === undefined) return ''
  return (pence / 100).toFixed(2)
}

function parsePounds(pounds: string): number | null {
  const cleaned = pounds.replace(/[£,\s]/g, '')
  if (cleaned === '') return null
  const num = parseFloat(cleaned)
  if (isNaN(num) || num < 0) return null
  return Math.round(num * 100)
}

export default function InstantWinsPage() {
  const [awards, setAwards] = useState<AdminInstantWinAward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [outstandingAmountPence, setOutstandingAmountPence] = useState(0)

  // Filters
  const [paidStatus, setPaidStatus] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [campaignId, setCampaignId] = useState('')

  // Campaign dropdown options (all campaigns, incl. historical).
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])

  // Editing state - keyed by award_id
  const [editingPayout, setEditingPayout] = useState<Record<string, string>>({})
  const [savingAwards, setSavingAwards] = useState<Record<string, boolean>>({})
  // Track inline errors for Mark Paid validation
  const [markPaidErrors, setMarkPaidErrors] = useState<Record<string, string>>({})

  const fetchAwards = useCallback(async () => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set('page', page.toString())
    params.set('limit', '25')
    if (paidStatus !== 'all') params.set('paidStatus', paidStatus)
    if (search) params.set('q', search)
    if (campaignId) params.set('campaignId', campaignId)

    try {
      const res = await fetch(`/api/admin/instant-winners?${params.toString()}`)
      const json = await res.json()

      if (!json.ok) {
        setError(friendlyError(json.error))
        setAwards([])
        setHasNext(false)
        setOutstandingAmountPence(0)
      } else {
        setAwards(json.awards)
        setHasNext(json.hasNext ?? false)
        setOutstandingAmountPence(json.outstandingAmountPence ?? 0)
        // Initialize editing state from server data
        const payoutState: Record<string, string> = {}
        for (const a of json.awards) {
          payoutState[a.award_id] = formatPence(a.payout_amount_pence)
        }
        setEditingPayout(payoutState)
        // Clear any mark paid errors
        setMarkPaidErrors({})
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
      setAwards([])
      setHasNext(false)
      setOutstandingAmountPence(0)
    } finally {
      setLoading(false)
    }
  }, [page, paidStatus, search, campaignId])

  useEffect(() => {
    fetchAwards()
  }, [fetchAwards])

  // Load the campaign dropdown options once on mount (all campaigns).
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/instant-winners/campaigns')
        const json = await res.json()
        if (active && json.ok && Array.isArray(json.campaigns)) {
          setCampaigns(json.campaigns)
        }
      } catch {
        // Non-fatal: the dropdown simply falls back to "All campaigns".
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Apply the typed search term. Resets to page 1 and preserves the input.
  const handleSearch = () => {
    setSearch(searchInput.trim())
    setPage(1)
  }

  // Clear every active filter back to defaults.
  const handleClearFilters = () => {
    setSearchInput('')
    setSearch('')
    setCampaignId('')
    setPaidStatus('all')
    setPage(1)
  }

  const filtersActive = search !== '' || searchInput !== '' || campaignId !== '' || paidStatus !== 'all'

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Respect IME composition so CJK input isn't submitted mid-composition.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e as any).keyCode !== 229) {
      handleSearch()
    }
  }

  // Helper to update a single award in local state from PATCH response
  const updateAwardLocally = useCallback((updated: {
    award_id: string
    payout_amount_pence: number | null
    is_paid: boolean
    paid_at: string | null
    paid_by_user_id: string | null
    payout_notes: string | null
  }, newOutstanding: number) => {
    setAwards((prev) =>
      prev.map((a) =>
        a.award_id === updated.award_id
          ? {
              ...a,
              payout_amount_pence: updated.payout_amount_pence,
              is_paid: updated.is_paid,
              paid_at: updated.paid_at,
              payout_notes: updated.payout_notes,
            }
          : a
      )
    )
    setOutstandingAmountPence(newOutstanding)
  }, [])

  // Save Amount: PATCHes only payout_amount_pence (and payout_notes if included)
  const handleSaveAmount = async (awardId: string) => {
    const inputValue = editingPayout[awardId] ?? ''
    const newPence = parsePounds(inputValue)

    setSavingAwards((prev) => ({ ...prev, [awardId]: true }))
    setMarkPaidErrors((prev) => ({ ...prev, [awardId]: '' }))

    try {
      const res = await fetch('/api/admin/instant-winners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ award_id: awardId, payout_amount_pence: newPence }),
      })
      const json = await res.json()
      if (json.ok && json.updated) {
        // Update only this row locally, update outstanding from response
        updateAwardLocally(json.updated, json.outstandingAmountPence ?? 0)
        // Keep the input synced with the new saved value
        setEditingPayout((prev) => ({
          ...prev,
          [awardId]: formatPence(json.updated.payout_amount_pence),
        }))
      } else {
        alert(json.error || 'Failed to save amount')
      }
    } catch (err: any) {
      alert(err.message || 'Network error')
    } finally {
      setSavingAwards((prev) => ({ ...prev, [awardId]: false }))
    }
  }

  // Mark Paid: PATCHes is_paid=true AND payout_amount_pence from current input
  const handleMarkPaid = async (award: AdminInstantWinAward) => {
    const inputValue = editingPayout[award.award_id] ?? ''
    const payoutPence = parsePounds(inputValue)

    // Validation: must have a valid payout amount > 0
    if (payoutPence === null || payoutPence <= 0) {
      setMarkPaidErrors((prev) => ({
        ...prev,
        [award.award_id]: 'Enter payout amount before marking paid.',
      }))
      return
    }

    setSavingAwards((prev) => ({ ...prev, [award.award_id]: true }))
    setMarkPaidErrors((prev) => ({ ...prev, [award.award_id]: '' }))

    try {
      const res = await fetch('/api/admin/instant-winners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          award_id: award.award_id,
          is_paid: true,
          payout_amount_pence: payoutPence,
        }),
      })
      const json = await res.json()
      if (json.ok && json.updated) {
        // Update only this row locally, update outstanding from response
        updateAwardLocally(json.updated, json.outstandingAmountPence ?? 0)
        // Keep the input synced with the new saved value
        setEditingPayout((prev) => ({
          ...prev,
          [award.award_id]: formatPence(json.updated.payout_amount_pence),
        }))
      } else {
        alert(json.error || 'Failed to mark paid')
      }
    } catch (err: any) {
      alert(err.message || 'Network error')
    } finally {
      setSavingAwards((prev) => ({ ...prev, [award.award_id]: false }))
    }
  }

  // Unpay: PATCHes only is_paid=false (preserves payout_amount_pence)
  const handleUnpay = async (award: AdminInstantWinAward) => {
    setSavingAwards((prev) => ({ ...prev, [award.award_id]: true }))
    setMarkPaidErrors((prev) => ({ ...prev, [award.award_id]: '' }))

    try {
      const res = await fetch('/api/admin/instant-winners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          award_id: award.award_id,
          is_paid: false,
        }),
      })
      const json = await res.json()
      if (json.ok && json.updated) {
        // Update only this row locally, update outstanding from response
        // Note: payout_amount_pence is preserved by the API, so json.updated has the existing value
        updateAwardLocally(json.updated, json.outstandingAmountPence ?? 0)
      } else {
        alert(json.error || 'Failed to unpay')
      }
    } catch (err: any) {
      alert(err.message || 'Network error')
    } finally {
      setSavingAwards((prev) => ({ ...prev, [award.award_id]: false }))
    }
  }

  const formatTicketRange = (start: number | null, end: number | null) => {
    if (start === null || end === null) return '-'
    if (start === end) return `#${start}`
    return `#${start}-${end}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Instant Winners</h2>
        <p className="text-muted-foreground">
          Track and manage instant win payouts.
        </p>
      </div>

      {/* Outstanding Amount Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Outstanding Unpaid</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-primary">
            £{formatPence(outstandingAmountPence)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Sum of unpaid awards with a saved payout amount.
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="space-y-3">
        {/* Primary row: winner search */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label htmlFor="winner-search" className="text-sm font-medium mb-1 block">
              Search winner
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                id="winner-search"
                type="text"
                placeholder="Name, email, mobile, ticket or checkout reference"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pl-9 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          <Button onClick={handleSearch}>
            <Search className="size-4 mr-1" />
            Search
          </Button>

          {filtersActive && (
            <Button variant="ghost" onClick={handleClearFilters}>
              <X className="size-4 mr-1" />
              Clear filters
            </Button>
          )}
        </div>

        {/* Secondary row: campaign + paid status */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[260px] max-w-full">
            <label className="text-sm font-medium mb-1 block">Campaign</label>
            <Select
              value={campaignId === '' ? ALL_CAMPAIGNS_VALUE : campaignId}
              onValueChange={(val) => {
                setCampaignId(val === ALL_CAMPAIGNS_VALUE ? '' : val)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CAMPAIGNS_VALUE}>All campaigns</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                    {c.slug ? (
                      <span className="text-muted-foreground"> · {c.slug}</span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-[140px]">
            <label className="text-sm font-medium mb-1 block">Paid Status</label>
            <Select
              value={paidStatus}
              onValueChange={(val) => {
                setPaidStatus(val)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAID_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Won At</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Prize</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Checkout Ref</TableHead>
                  <TableHead>Payout (£)</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {awards.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No instant win awards found.
                    </TableCell>
                  </TableRow>
                ) : (
                  awards.map((award) => {
                    const isSaving = savingAwards[award.award_id] ?? false
                    const inputValue = editingPayout[award.award_id] ?? ''
                    const inputPence = parsePounds(inputValue)
                    // Check if the input differs from the saved DB value
                    const hasUnsavedChanges = inputPence !== award.payout_amount_pence
                    const markPaidError = markPaidErrors[award.award_id] || ''

                    // Determine payout status message
                    let payoutStatusMsg = ''
                    let payoutStatusColor = ''
                    if (award.is_paid && award.payout_amount_pence === null) {
                      payoutStatusMsg = 'Paid but amount missing'
                      payoutStatusColor = 'text-red-600'
                    } else if (!award.is_paid && award.payout_amount_pence === null) {
                      payoutStatusMsg = 'Needs amount'
                      payoutStatusColor = 'text-amber-600'
                    }

                    return (
                      <TableRow key={award.award_id} className={award.is_paid ? 'bg-muted/30' : ''}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(award.awarded_at).toLocaleString('en-GB', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </TableCell>
                        <TableCell
                          className="max-w-[160px] truncate text-sm"
                          title={award.campaign_title ?? award.campaign_slug ?? ''}
                        >
                          {award.campaign_title ?? award.campaign_slug ?? '-'}
                        </TableCell>
                        <TableCell className="max-w-[160px] text-sm">
                          <div className="truncate font-medium" title={award.customer_name}>
                            {award.customer_name}
                          </div>
                          {award.display_name && (
                            <div
                              className="truncate text-xs text-muted-foreground"
                              title={award.display_name}
                            >
                              {award.display_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs" title={award.customer_email}>
                          {award.customer_email}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {award.customer_mobile}
                        </TableCell>
                        <TableCell className="max-w-[120px] truncate text-sm" title={award.prize_title}>
                          {award.prize_title}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {award.winning_ticket != null
                            ? `#${award.winning_ticket}`
                            : formatTicketRange(award.start_ticket, award.end_ticket)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {award.checkout_ref}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              value={inputValue}
                              onChange={(e) => {
                                setEditingPayout((prev) => ({
                                  ...prev,
                                  [award.award_id]: e.target.value,
                                }))
                                // Clear mark paid error when user types
                                if (markPaidErrors[award.award_id]) {
                                  setMarkPaidErrors((prev) => ({ ...prev, [award.award_id]: '' }))
                                }
                              }}
                              placeholder="0.00"
                              className="w-20 h-8 text-sm"
                              disabled={isSaving}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2"
                              onClick={() => handleSaveAmount(award.award_id)}
                              disabled={isSaving || !hasUnsavedChanges}
                              title="Save amount"
                            >
                              {isSaving ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Save className="size-4" />
                              )}
                            </Button>
                          </div>
                          {payoutStatusMsg && (
                            <span className={`text-xs ${payoutStatusColor}`}>{payoutStatusMsg}</span>
                          )}
                          {markPaidError && (
                            <span className="text-xs text-red-600 block">{markPaidError}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {award.is_paid ? (
                            <Badge variant="secondary" className="bg-green-100 text-green-800">
                              Paid
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-400">
                              Unpaid
                            </Badge>
                          )}
                          {award.paid_at && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {new Date(award.paid_at).toLocaleDateString('en-GB')}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {award.is_paid ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleUnpay(award)}
                              disabled={isSaving}
                              className="h-8"
                            >
                              {isSaving ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <>
                                  <X className="size-3 mr-1" />
                                  Unpay
                                </>
                              )}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleMarkPaid(award)}
                              disabled={isSaving}
                              className="h-8"
                            >
                              {isSaving ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <>
                                  <Check className="size-3 mr-1" />
                                  Mark Paid
                                </>
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {awards.length} awards (Page {page})
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
