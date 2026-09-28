"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { SectionHeader } from "@/components/section-header"
import { AvatarPicker } from "@/components/avatar-picker"
import { VisibilityToggleCard } from "@/components/visibility-toggle-card"
import { SaveBar } from "@/components/save-bar"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Profile } from "@/lib/types"

// Mock initial profile data
const mockProfile: Profile = {
  name: "Alex Johnson",
  email: "alex.johnson@example.com",
  avatarUrl: "/professional-portrait.png",
  bio: "Love entering giveaways and trying new products!",
  publicVisible: true,
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(mockProfile)
  const [mobile, setMobile] = useState('')
  const [saveState, setSaveState] = useState<{
    loading: boolean
    success: boolean
    error?: string
  }>({
    loading: false,
    success: false,
  })

  // Load mobile from profiles_private on mount
  useEffect(() => {
    const loadMobile = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('profiles_private')
        .select('mobile')
        .eq('user_id', user.id)
        .single()

      if (data?.mobile) {
        setMobile(data.mobile)
      }
    }
    loadMobile()
  }, [])

  const handleSave = async () => {
    setSaveState({ loading: true, success: false })

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setSaveState({ loading: false, success: false, error: 'Not authenticated' })
        return
      }

      // Save mobile to profiles_private (update only, no insert)
      const { data: updateData, error: mobileError } = await supabase
        .from('profiles_private')
        .update({ mobile: mobile.trim() || null })
        .eq('user_id', user.id)
        .select()

      if (mobileError) {
        console.error('Failed to save mobile:', mobileError)
        setSaveState({ loading: false, success: false, error: 'Failed to save mobile number' })
        return
      }

      if (!updateData || updateData.length === 0) {
        setSaveState({ loading: false, success: false, error: 'Unable to save mobile number' })
        return
      }

      setSaveState({ loading: false, success: true })

      // Reset success state after 3 seconds
      setTimeout(() => {
        setSaveState((prev) => ({ ...prev, success: false }))
      }, 3000)
    } catch (err) {
      console.error('Save error:', err)
      setSaveState({ loading: false, success: false, error: 'An error occurred while saving' })
    }
  }

  const hasName = profile.name.trim().length > 0
  const hasAvatar = Boolean(profile.avatarUrl && profile.avatarUrl.trim().length > 0)
  const isValid = hasName && hasAvatar

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 md:py-12">
      <div className="space-y-8">
        {/* Page Header */}
        <div>
          <SectionHeader
            title="Your Profile"
            subtitle="Your name and photo/avatar are shown when you win. You can control your public visibility below."
          />
        </div>

        {/* Profile Photo / Avatar */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Profile Photo</h3>
          <AvatarPicker
            avatarUrl={profile.avatarUrl}
            name={profile.name || "User"}
            onChange={(url) => setProfile({ ...profile, avatarUrl: url })}
          />
        </section>

        {/* Identity Fields */}
        <section className="space-y-6">
          <h3 className="text-lg font-semibold">Identity</h3>

          <div className="space-y-2">
            <Label htmlFor="name" className="required">
              Real name
            </Label>
            <Input
              id="name"
              type="text"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Enter your full name"
              required
              aria-required="true"
              className="max-w-md"
            />
            <p className="text-xs text-muted-foreground">Your real name is required and will be shown if you win.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              value={profile.email}
              disabled
              className="max-w-md bg-muted"
              aria-readonly="true"
            />
            <p className="text-xs text-muted-foreground">Your email address cannot be changed here.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile number (optional)</Label>
            <Input
              id="mobile"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+44 7700 900000"
              className="max-w-md"
            />
            <p className="text-xs text-muted-foreground">Used to contact you if you win. Never shared publicly.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Short bio (optional)</Label>
            <Textarea
              id="bio"
              value={profile.bio || ""}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
              placeholder="Tell us a bit about yourself..."
              rows={3}
              maxLength={200}
              className="max-w-md resize-none"
            />
            <p className="text-xs text-muted-foreground">{profile.bio?.length || 0}/200 characters</p>
          </div>
        </section>

        {/* Public Visibility Toggle */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Public Visibility</h3>
          <VisibilityToggleCard
            publicVisible={profile.publicVisible}
            onChange={(visible) => setProfile({ ...profile, publicVisible: visible })}
          />
        </section>

        {/* Save Section */}
        <section className="space-y-4 border-t pt-6">
          <SaveBar
            onSave={handleSave}
            disabled={!isValid}
            loading={saveState.loading}
            success={saveState.success}
            error={saveState.error}
          />
        </section>

        {/* Safety / Trust Notes */}
        <section className="rounded-lg border bg-muted/50 p-6">
          <h4 className="font-semibold">Privacy & Data Use</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            We use your profile information to verify winners and display them publicly (unless you opt out). You can
            update your visibility preferences at any time.
          </p>
          <p className="mt-4 text-sm">
            <Link href="/privacy" className="text-primary hover:underline">
              Read our Privacy Policy
            </Link>
          </p>
        </section>
      </div>
    </div>
  )
}
