import Link from "next/link"
import Image from "next/image"
import { Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { MobileAuthMenu } from "@/components/mobile-auth-menu"

// Format an integer pence amount as GBP (e.g. 2000 -> "£20.00").
// Clamps malformed/negative values to 0 so the balance can never render negative
// and never exposes raw pence.
function formatGBP(pence: number) {
  const safe = Number.isFinite(pence) ? Math.max(pence, 0) : 0
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(safe / 100)
}

/**
 * True ONLY for the two expected stale-refresh-token conditions:
 *   - refresh_token_not_found    ("Invalid Refresh Token: Refresh Token Not Found")
 *   - refresh_token_already_used ("Invalid Refresh Token: Already Used")
 * Every other auth error (network, config, invalid key, outage, DB, unexpected
 * auth failure) is intentionally excluded and must NOT be suppressed here.
 */
function isStaleRefreshTokenError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const code = (err as { code?: string }).code
  if (code === "refresh_token_not_found" || code === "refresh_token_already_used") {
    return true
  }
  const message = String((err as { message?: string }).message ?? "")
  return /refresh token not found/i.test(message) || /invalid refresh token: already used/i.test(message)
}

export async function SiteHeader({ variant = "default" }: { variant?: "default" | "casino" }) {
  const isCasino = variant === "casino"
  const supabase = await createClient()

  // Keep the SINGLE existing getUser() call. We now capture its result so a
  // stale refresh-token cookie (rotated/expired after a deploy or duplicate
  // refresh) is treated as a normal logged-out visitor instead of surfacing an
  // error. We do NOT clear cookies from this Server Component, retry, redirect,
  // or call getUser again.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      // A stale-session error is expected and handled silently (no throw, no
      // console.error). Any other returned error also falls back to the
      // logged-out header, preserving the prior behaviour where a null user
      // simply renders the signed-out state. `isStaleRefreshTokenError` is
      // referenced so unexpected errors remain distinguishable from the
      // expected stale-session case in the catch branch below.
      void isStaleRefreshTokenError(error)
      user = null
    } else {
      user = data.user
    }
  } catch (err) {
    // getUser() can reject on a stale refresh token depending on client
    // internals. Swallow ONLY that expected condition; re-throw anything else
    // so genuine failures are not masked.
    if (!isStaleRefreshTokenError(err)) {
      throw err
    }
    user = null
  }

  // WTF Credit balance for the header control. This query runs ONLY for an
  // authenticated user — anonymous visitors never touch wallet_accounts. It uses
  // the existing RLS-scoped server client (never service role), reads a single
  // row and exactly two columns, and degrades to £0.00 on a missing row or any
  // read error so the header can never break. No transactions/reservations are
  // queried, and raw pence is never rendered.
  let walletAvailablePence = 0
  if (user) {
    const { data: walletRow, error: walletErr } = await supabase
      .from("wallet_accounts")
      .select("balance_pence, reserved_pence")
      .eq("user_id", user.id)
      .maybeSingle()

    if (walletErr) {
      console.error("[site-header] wallet_accounts lookup failed:", walletErr.message)
    } else if (walletRow) {
      const balancePence = typeof walletRow.balance_pence === "number" ? walletRow.balance_pence : 0
      const reservedPence = typeof walletRow.reserved_pence === "number" ? walletRow.reserved_pence : 0
      walletAvailablePence = Math.max(balancePence - reservedPence, 0)
    }
  }

  return (
    <header
      className={
        isCasino
          ? // Dark integrated gaming shell — near-black purple, faint gold lower
            // seam so header + promo read as one casino surface. Behaviour and
            // layout identical to default; only the skin changes.
            "sticky top-0 z-50 border-b border-[#6d2a70]/45 bg-[#050008]/[0.985] shadow-[0_1px_0_rgba(182,67,255,0.16),0_6px_24px_rgba(0,0,0,0.32)] backdrop-blur-md supports-[backdrop-filter]:bg-[#050008]/95"
          : "sticky top-0 z-50 border-b bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60"
      }
    >
      <div className="container flex h-16 items-center justify-between">
        <Link
          href="/"
          prefetch={false}
          className={
            isCasino
              ? "relative flex items-center transition-opacity hover:opacity-90"
              : "flex items-center transition-opacity hover:opacity-80"
          }
        >
          {isCasino && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-5 -inset-y-4 -z-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,186,0,0.15)_0%,rgba(112,0,190,0.08)_48%,transparent_72%)] blur-[10px]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-1 left-[8%] right-[8%] h-px bg-[linear-gradient(90deg,transparent,#F6B91A_35%,#FFF0A0_50%,#F6B91A_65%,transparent)] opacity-60 blur-[0.4px]"
              />
            </>
          )}
          <Image
            src="/images/wtf-logo-main.png"
            alt="WTF Giveaways"
            width={140}
            height={50}
            className={
              isCasino
                ? "h-auto w-[120px] [filter:drop-shadow(0_0_3px_rgba(255,232,160,0.36))_drop-shadow(0_0_9px_rgba(168,82,255,0.18))] sm:w-[140px]"
                : "h-auto w-[120px] sm:w-[140px]"
            }
            priority
          />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <Link
            href="/giveaways"
            prefetch={false}
            className={`text-sm font-medium transition-colors ${isCasino ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            Giveaways
          </Link>
          <Link
            href="/winners"
            prefetch={false}
            className={`text-sm font-medium transition-colors ${isCasino ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            Winners
          </Link>
          <Link
            href="/contact"
            prefetch={false}
            className={`text-sm font-medium transition-colors ${isCasino ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            Contact
          </Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* WTF Credit balance control. Visible ONLY for authenticated users
              (hidden entirely for anonymous visitors), on both mobile and
              desktop. Compact icon + balance that links to /me. No spending or
              checkout controls, no client-side polling. */}
          {user && (
            <Link
              href="/me"
              prefetch={false}
              aria-label={`Available WTF Credit ${formatGBP(walletAvailablePence)}. View account.`}
              className={
                isCasino
                  ? "relative flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-[16px] border border-[#E6B52A] bg-[linear-gradient(145deg,#1A0D00_0%,#0B0500_48%,#0A0013_100%)] px-4 py-2 text-sm font-black text-[#FFF1B0] shadow-[inset_0_1px_0_rgba(255,249,214,0.18),0_0_3px_rgba(255,245,196,0.55),0_0_10px_rgba(245,182,26,0.34),0_0_24px_-7px_rgba(255,149,0,0.62)] transition-[border-color,box-shadow,background-color] hover:border-[#FFD863] hover:shadow-[inset_0_1px_0_rgba(255,249,214,0.22),0_0_4px_rgba(255,247,208,0.65),0_0_14px_rgba(245,182,26,0.42),0_0_28px_-7px_rgba(255,149,0,0.72)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050008]"
                  : "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-yellow-400/50 bg-[#2E1065] px-3 py-1.5 text-sm font-semibold text-yellow-100 shadow-[0_0_14px_rgba(247,166,0,0.18)] transition-colors hover:border-yellow-300/70 hover:bg-[#3B0F73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              }
            >
              <Wallet
                className={
                  isCasino
                    ? "h-[18px] w-[18px] shrink-0 text-[#FFD84A] [filter:drop-shadow(0_0_4px_rgba(255,201,42,0.38))]"
                    : "h-4 w-4 shrink-0 text-yellow-400"
                }
                aria-hidden="true"
              />
              <span className="tabular-nums">{formatGBP(walletAvailablePence)}</span>
            </Link>
          )}

          {/* Mobile-only: burger menu for both signed-in and signed-out users.
              The signed-in state opens a polished account menu with a Sign out
              action; signed-out keeps Create account / Log in. */}
          {isCasino ? (
            <div className="relative rounded-[16px] shadow-[0_0_3px_rgba(255,246,210,0.45),0_0_9px_rgba(245,182,26,0.30),0_0_22px_-6px_rgba(174,80,255,0.58)]">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-[1px] rounded-[17px] border border-[#D9A71D]/70"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[18%] right-[18%] top-[-1px] h-px bg-[linear-gradient(90deg,transparent,#FFE175_38%,#FFF9DB_50%,#FFE175_62%,transparent)] blur-[0.4px]"
              />
              <MobileAuthMenu isSignedIn={!!user} variant={variant} />
            </div>
          ) : (
            <MobileAuthMenu isSignedIn={!!user} variant={variant} />
          )}

          {/* Desktop buttons */}
          {user ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className={`hidden sm:inline-flex ${isCasino ? "text-white/80 hover:bg-white/10 hover:text-white" : "hover:bg-accent"}`}
              >
                <Link href="/me" prefetch={false}>My Account</Link>
              </Button>
              <Button size="sm" asChild className="hidden sm:inline-flex bg-primary text-primary-foreground shadow-sm hover:bg-[#5B21B6]">
                <Link href="/giveaways" prefetch={false}>Browse</Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex border-white/20 bg-black/50 text-white hover:bg-black/70">
                <Link href="/auth/login" prefetch={false}>Log in</Link>
              </Button>
              <Button size="sm" asChild className="hidden sm:inline-flex bg-red-600 text-white shadow-sm hover:bg-red-700">
                <Link href="/auth/sign-up" prefetch={false}>Create account</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}