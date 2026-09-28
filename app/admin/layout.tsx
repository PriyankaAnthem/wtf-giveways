import React from "react"
import { AdminShell } from "@/components/admin/AdminShell"
import { Toaster } from "@/components/ui/toaster"
import { requireAdmin } from "@/lib/admin/auth"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Allow enabled Super Admins, Operations Admins, and Hosts (ops) into the
  // admin shell. read_only / unknown roles are redirected to /auth/unauthorized.
  // The layout only grants entry to the shell — each child page still enforces
  // its own role guard, so this does NOT grant blanket access to every page.
  const { user, role } = await requireAdmin({ roles: ['admin', 'operations_admin', 'ops'] })

  return (
    <AdminShell user={user} role={role}>
      {children}
      <Toaster />
    </AdminShell>
  )
}
