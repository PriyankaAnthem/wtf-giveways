'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    console.log('[signout] clicked')
    const supabase = createClient()
    await supabase.auth.signOut()
    console.log('[signout] complete')
    window.location.href = '/auth/login'
  }

  return (
    <Button variant="outline" size="sm" disabled={loading} onClick={handleSignOut}>
      {loading ? 'Signing out...' : 'Sign Out'}
    </Button>
  )
}
