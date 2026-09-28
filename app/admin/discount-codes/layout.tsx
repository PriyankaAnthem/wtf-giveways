import React from "react"
import { requireAdmin } from "@/lib/admin/auth"

export default async function DiscountCodesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Super Admins and Operations Admins only. Hosts (ops) / read_only / unknown
  // roles are redirected to /auth/unauthorized. Mutations are further gated to
  // 'admin' at both the page (control visibility) and API layers.
  await requireAdmin({ roles: ["admin", "operations_admin"] })
  return <>{children}</>
}
