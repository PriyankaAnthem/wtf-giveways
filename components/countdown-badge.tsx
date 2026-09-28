"use client"

import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface CountdownBadgeProps {
  endsAt: Date
  status: string
}

export function CountdownBadge({ endsAt, status }: CountdownBadgeProps) {
  const [timeLeft, setTimeLeft] = useState<string>("")

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Date.now()
      const end = endsAt.getTime()
      const diff = end - now

      if (diff <= 0) {
        return "Ended"
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

      if (days > 0) {
        return `${days}d ${hours}h left`
      } else if (hours > 0) {
        return `${hours}h ${minutes}m left`
      } else {
        return `${minutes}m left`
      }
    }

    setTimeLeft(calculateTimeLeft())

    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [endsAt])

  const getStatusColor = () => {
    if (status === "ending-soon") return "destructive"
    if (status === "completed") return "secondary"
    return "default"
  }

  return (
    <Badge variant={getStatusColor()} className="flex w-fit items-center gap-1 text-sm">
      <Clock className="h-3 w-3" aria-hidden="true" />
      <span>{timeLeft || "Loading..."}</span>
    </Badge>
  )
}
