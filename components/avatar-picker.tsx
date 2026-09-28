"use client"

import { useState } from "react"
import { Camera, Trash2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface AvatarPickerProps {
  avatarUrl?: string
  name: string
  onChange: (url: string | undefined) => void
}

export function AvatarPicker({ avatarUrl, name, onChange }: AvatarPickerProps) {
  const [isGenerating, setIsGenerating] = useState(false)

  // Generate deterministic avatar based on name hash
  const generateAvatar = () => {
    setIsGenerating(true)
    // Simulate generation delay
    setTimeout(() => {
      // Create deterministic color from name
      let hash = 0
      for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
      }
      const hue = hash % 360
      const generatedUrl = `/placeholder.svg?height=200&width=200&query=abstract+geometric+avatar+${hue}`
      onChange(generatedUrl)
      setIsGenerating(false)
    }, 800)
  }

  const handleUpload = () => {
    // UI only - simulate file selection
    const mockUrl = `/placeholder.svg?height=200&width=200&query=profile+photo`
    onChange(mockUrl)
  }

  const handleRemove = () => {
    generateAvatar()
  }

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <Avatar className="h-24 w-24 border-4 border-background shadow-lg">
        <AvatarImage src={avatarUrl || "/placeholder.svg"} alt={name} />
        <AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleUpload} variant="outline" size="sm">
            <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
            Upload photo
          </Button>
          <Button onClick={generateAvatar} variant="outline" size="sm" disabled={isGenerating}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            {isGenerating ? "Generating..." : "Generate avatar"}
          </Button>
          {avatarUrl && (
            <Button onClick={handleRemove} variant="ghost" size="sm">
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Photo or avatar is shown on Winners and your public profile (unless you opt out).
        </p>
      </div>
    </div>
  )
}
