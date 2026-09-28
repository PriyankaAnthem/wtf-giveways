'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import AuditLogTable from "./AuditLogTable"
import AuditLogDetailsDrawer from "./AuditLogDetailsDrawer"
import type { AuditLogEntry } from "@/lib/types/auditLog"
import { Search } from 'lucide-react'

type AuditLogsPanelProps = {
  logs: AuditLogEntry[]
}

export default function AuditLogsPanel({ logs }: AuditLogsPanelProps) {
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const handleSelect = (log: AuditLogEntry) => {
    setSelectedLog(log)
    setIsDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
    setTimeout(() => setSelectedLog(null), 300)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search summary / actor"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pl-9 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <Select defaultValue="all">
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="entry_created">Entry Created</SelectItem>
                <SelectItem value="entry_flagged">Entry Flagged</SelectItem>
                <SelectItem value="entry_refunded">Entry Refunded</SelectItem>
                <SelectItem value="instant_win_attempt">Instant Win Attempt</SelectItem>
                <SelectItem value="instant_win_won">Instant Win Won</SelectItem>
                <SelectItem value="campaign_status_changed">Campaign Status Changed</SelectItem>
                <SelectItem value="admin_action">Admin Action</SelectItem>
              </SelectContent>
            </Select>

            <Select defaultValue="all">
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Actor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actors</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>

            <Select defaultValue="all">
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Campaigns</SelectItem>
                <SelectItem value="macbook">Win a MacBook Pro</SelectItem>
                <SelectItem value="ps5">PlayStation 5 Giveaway</SelectItem>
                <SelectItem value="iphone">iPhone 15 Pro Competition</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <AuditLogTable logs={logs} onSelect={handleSelect} />

      <AuditLogDetailsDrawer
        log={selectedLog}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
      />
    </>
  )
}
