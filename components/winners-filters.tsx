"use client"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface WinnersFiltersProps {
  onSearchChange: (query: string) => void
  onTimeFilterChange: (filter: "all" | "week" | "month") => void
  onTypeFilterChange: (filter: "all" | "main" | "instant") => void
  searchQuery: string
  timeFilter: "all" | "week" | "month"
  typeFilter: "all" | "main" | "instant"
}

export function WinnersFilters({ onSearchChange, onTimeFilterChange, onTypeFilterChange, searchQuery, timeFilter, typeFilter }: WinnersFiltersProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="relative flex-1 md:max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          placeholder="Search by name or prize..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
          aria-label="Search winners by name or prize"
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex gap-2" role="group" aria-label="Filter by winner type">
          <Button
            variant={typeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => onTypeFilterChange("all")}
          >
            All Winners
          </Button>
          {/* Main Winners button - TEMPORARILY DISABLED
          <Button
            variant={typeFilter === "main" ? "default" : "outline"}
            size="sm"
            onClick={() => onTypeFilterChange("main")}
          >
            Main Winners
          </Button>
          */}
          <Button
            variant={typeFilter === "instant" ? "default" : "outline"}
            size="sm"
            onClick={() => onTypeFilterChange("instant")}
          >
            Instant Wins
          </Button>
        </div>

        <div className="flex gap-2" role="group" aria-label="Filter by time period">
          <Button
            variant={timeFilter === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => onTimeFilterChange("week")}
          >
            This Week
          </Button>
          <Button
            variant={timeFilter === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => onTimeFilterChange("month")}
          >
            This Month
          </Button>
          <Button
            variant={timeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => onTimeFilterChange("all")}
          >
            All Time
          </Button>
        </div>
      </div>
    </div>
  )
}
