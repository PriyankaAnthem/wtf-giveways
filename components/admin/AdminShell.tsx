'use client'

import React, { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AdminSidebarNav, AdminNavLinks } from "./AdminSidebarNav"
import { HostBottomNav } from "./host/HostBottomNav"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { LogOut, Menu } from "lucide-react"
import type { User } from "@supabase/supabase-js"
import type { AdminRole } from "@/lib/admin/permissions"
import { resolveSectionLabel } from "@/lib/admin/navigation"

export function AdminShell({
  children,
  user,
  role,
}: {
  children: React.ReactNode
  user: User
  role: AdminRole
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [navOpen, setNavOpen] = useState(false)

  // Compact header context derived from the active nav route (longest-prefix
  // match, safe "Admin" fallback). Presentation only — no business logic.
  const sectionLabel = resolveSectionLabel(pathname)

  // Hosts get a fixed mobile bottom nav; reserve space so content never hides
  // behind it. Staff roles are completely unaffected.
  const isHost = role === "ops"

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <div className="flex h-screen">
      {/* Desktop fixed sidebar (hidden on mobile) */}
      <AdminSidebarNav role={role} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile admin header — compact, sticky, admin-only chrome */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4 md:hidden">
          <div className="flex min-w-0 items-center gap-1">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="-ml-2" aria-label="Open admin menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
                <SheetHeader className="shrink-0 border-b border-border px-6 py-0">
                  <SheetTitle className="flex h-16 items-center gap-3 text-left">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold tracking-tight text-primary-foreground"
                    >
                      WTF
                    </span>
                    <span className="leading-tight">
                      <span className="block text-sm font-semibold text-foreground">Admin Portal</span>
                      <span className="block text-xs font-normal text-muted-foreground">WTF Giveaways</span>
                    </span>
                  </SheetTitle>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <AdminNavLinks role={role} onNavigate={() => setNavOpen(false)} />
                </div>

                <div className="shrink-0 border-t border-border p-3">
                  <p className="truncate px-3 pb-2 text-xs text-muted-foreground" title={user.email ?? undefined}>
                    {user.email}
                  </p>
                  <Link
                    href="/"
                    onClick={() => setNavOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    View site
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <LogOut aria-hidden="true" className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              </SheetContent>
            </Sheet>

            <span className="truncate text-base font-semibold">{sectionLabel}</span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            aria-label="Log out"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </header>

        {/* Desktop header (hidden on mobile) */}
        <header className="hidden h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-6 md:flex xl:px-8">
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-lg font-semibold text-foreground">{sectionLabel}</h1>
            <p className="text-xs text-muted-foreground">WTF Giveaways Admin</p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="max-w-[220px] truncate text-sm text-muted-foreground" title={user.email ?? undefined}>
              {user.email}
            </span>
            <Link
              href="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View site
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-muted/30">
          <div
            className={cn(
              "mx-auto w-full min-w-0 max-w-[1440px] px-4 py-5 md:px-6 md:py-7 xl:px-8",
              // Clear the fixed host bottom nav on mobile (h-16 + safe area).
              isHost && "pb-24 md:pb-7",
            )}
          >
            {children}
          </div>
        </main>
      </div>

      {isHost && <HostBottomNav />}
    </div>
  )
}
