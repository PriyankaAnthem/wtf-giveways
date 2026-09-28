"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Search, Loader2 } from "lucide-react"

type SearchResult = {
  user_id: string
  customer_name: string
  email: string
  balance_pence: number
  reserved_pence: number
  available_pence: number
}

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`
}

// Map fixed API error codes to friendly copy. Raw API/auth errors are never shown.
function mapSearchError(code: unknown): string {
  switch (code) {
    case "complete_email_required":
      return "Enter the customer's full email address, or search by their name."
    case "query_too_long":
      return "Search term is too long."
    case "query_too_short":
      return "Enter at least 3 characters to search."
    case "invalid_query":
      return "That search contains invalid characters. Please try again."
    default:
      return "Search failed. Please try again."
  }
}

export function WalletSearch() {
  const [input, setInput] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const runSearch = useCallback(async () => {
    const q = input.trim()
    if (q.length === 0) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/wallets/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(mapSearchError(json?.error))
        setResults([])
      } else {
        setResults(json.results ?? [])
        setNotice(json.notice ?? null)
      }
    } catch {
      setError("Network error. Please try again.")
      setResults([])
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      runSearch()
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Find a customer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                className="pl-9"
                placeholder="Full email, customer name or user ID"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-label="Search customers"
              />
            </div>
            <Button onClick={runSearch} disabled={loading || input.trim().length === 0}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Returns up to 25 results. Use a full email address, a customer name, or an exact user ID.
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-6 text-center text-destructive">{error}</CardContent>
        </Card>
      )}

      {notice && !error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{notice}</p>
      )}

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : searched && !error && results.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No customers found for that search.
          </CardContent>
        </Card>
      ) : results.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell>
                      <div className="font-medium">{r.customer_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{r.user_id}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.email}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPence(r.balance_pence)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatPence(r.reserved_pence)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatPence(r.available_pence)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/wallets/${r.user_id}`}>View wallet</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
