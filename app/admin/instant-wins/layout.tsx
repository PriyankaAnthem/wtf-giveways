import React from "react"
import { requireAdmin } from "@/lib/admin/auth"

export default async function InstantWinsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Super Admins and Operations Admins only. Hosts (ops) / read_only / unknown
  // roles are redirected to /auth/unauthorized.
  await requireAdmin({ roles: ['admin', 'operations_admin'] })
  return <>{children}</>
}
