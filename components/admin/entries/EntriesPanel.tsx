'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import EntriesTable from "./EntriesTable"
import EntryDetailsDrawer from "./EntryDetailsDrawer"
import type { AdminEntry } from "@/lib/types/entry"
import { Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

const CHECKOUT_STATES = [
  { value: 'all', label: 'All States' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'failed', label: 'Failed' },
]

export default function EntriesPanel() {
  const [entries, setEntries] = useState<AdminEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [limit] = useState(25)

  // Filters
  const [campaignId, setCampaignId] = useState('')
  const [state, setState] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Drawer
  const [selectedEntry, setSelectedEntry] = useState<AdminEntry | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(limit))
      if (campaignId) params.set('campaignId', campaignId)
      if (state !== 'all') params.set('state', state)
      if (searchQuery) params.set('search', searchQuery)

      const res = await fetch(`/api/admin/entries?${params.toString()}`)
      const json = await res.json()

      if (!json.ok) {
        setError(json.error || 'Failed to load entries')
        setEntries([])
        setHasNext(false)
      } else {
        setEntries(json.entries)
        setHasNext(json.hasNext ?? false)
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
      setEntries([])
      setHasNext(false)
    } finally {
      setLoading(false)
    }
  }, [page, limit, campaignId, state, searchQuery])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const handleView = (entry: AdminEntry) => {
    setSelectedEntry(entry)
    setIsDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
    setTimeout(() => setSelectedEntry(null), 300)
  }

  const handleSearch = () => {
    setSearchQuery(searchInput)
    setPage(1)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleFilterChange = (type: 'campaign' | 'state', value: string) => {
    if (type === 'campaign') {
      setCampaignId(value)
    } else {
      setState(value)
    }
    setPage(1)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search checkout ref..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pl-9 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Search checks recent checkout refs only.</p>
            </div>

            <input
              type="text"
              placeholder="Campaign ID"
              value={campaignId}
              onChange={(e) => handleFilterChange('campaign', e.target.value)}
              className="flex h-9 w-[200px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
            />

            <Select value={state} onValueChange={(v) => handleFilterChange('state', v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Checkout State" />
              </SelectTrigger>
              <SelectContent>
                {CHECKOUT_STATES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" onClick={handleSearch}>
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-12 text-center text-destructive">
            {error}
          </CardContent>
        </Card>
      ) : (
        <>
          <EntriesTable entries={entries} onView={handleView} />

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {entries.length} entries (Page {page})
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

      <EntryDetailsDrawer
        entry={selectedEntry}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
      />
    </>
  )
}
