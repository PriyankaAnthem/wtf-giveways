"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { HOST_NAV_ITEMS, isHostNavItemActive } from "@/lib/admin/navigation"

/**
 * Fixed bottom navigation for the Host (ops) area — mobile only.
 *
 * Renders the same tiny HOST_NAV_ITEMS registry as the sidebar/drawer so the
 * three surfaces can never drift. Hidden on md+ where the sidebar takes over.
 * Purely presentational; route access is enforced server-side.
 */
export function HostBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Host"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
    >
      <ul
        className="mx-auto flex max-w-lg items-stretch justify-around"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {HOST_NAV_ITEMS.map((item) => {
          const isActive = isHostNavItemActive(pathname, item.href)
          const Icon = item.icon
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" strokeWidth={2} className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
