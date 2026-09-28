'use client'

import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { AlertCircle, Loader2, Search, UserPlus } from 'lucide-react'
import {
  ROLE_LABELS,
  TEAM_ROLE_OPTIONS,
  type AdminRole,
} from '@/lib/admin/team-access'
import { addTeamMember, updateTeamMember, type TeamMemberRow } from '@/app/admin/hosts/actions'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLE_FILTERS: ReadonlyArray<{ value: 'all' | AdminRole; label: string }> = [
  { value: 'all', label: 'All roles' },
  { value: 'admin', label: ROLE_LABELS.admin },
  { value: 'operations_admin', label: ROLE_LABELS.operations_admin },
  { value: 'ops', label: ROLE_LABELS.ops },
  { value: 'read_only', label: ROLE_LABELS.read_only },
]

/** Visual style per role badge. Keeps admin visually distinct without new hues. */
function RoleBadge({ role }: { role: AdminRole }) {
  const className =
    role === 'admin'
      ? 'bg-primary text-primary-foreground hover:bg-primary'
      : role === 'operations_admin'
        ? 'bg-blue-600 text-white hover:bg-blue-600'
        : undefined
  return (
    <Badge className={className} variant={className ? 'default' : 'secondary'}>
      {ROLE_LABELS[role]}
    </Badge>
  )
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge className="bg-green-600 text-white hover:bg-green-600">Active</Badge>
  ) : (
    <Badge variant="secondary">Disabled</Badge>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function TeamAccessManager({
  initialMembers,
  currentUserId,
}: {
  initialMembers: TeamMemberRow[]
  currentUserId: string
}) {
  const { toast } = useToast()
  const [members, setMembers] = useState<TeamMemberRow[]>(initialMembers)

  // Filters
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | AdminRole>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')

  // Add dialog
  const [addOpen, setAddOpen] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<AdminRole>('operations_admin')
  const [addError, setAddError] = useState<string | null>(null)
  const [isAdding, startAdd] = useTransition()

  // Edit dialog
  const [editTarget, setEditTarget] = useState<TeamMemberRow | null>(null)
  const [editRole, setEditRole] = useState<AdminRole>('operations_admin')
  const [editEnabled, setEditEnabled] = useState(true)
  const [editError, setEditError] = useState<string | null>(null)
  const [isSaving, startSave] = useTransition()

  // Disable confirmation
  const [disableTarget, setDisableTarget] = useState<TeamMemberRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const enabledAdminCount = useMemo(
    () => members.filter((m) => m.role === 'admin' && m.is_enabled).length,
    [members],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((m) => {
      if (q && !(m.email ?? '').toLowerCase().includes(q)) return false
      if (roleFilter !== 'all' && m.role !== roleFilter) return false
      if (statusFilter === 'active' && !m.is_enabled) return false
      if (statusFilter === 'disabled' && m.is_enabled) return false
      return true
    })
  }, [members, search, roleFilter, statusFilter])

  /** True when demoting/disabling this member would remove the last Super Admin. */
  function isFinalSuperAdmin(m: TeamMemberRow): boolean {
    return m.role === 'admin' && m.is_enabled && enabledAdminCount <= 1
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const value = addEmail.trim()
    setAddError(null)
    if (!EMAIL_RE.test(value)) {
      setAddError('Please enter a valid email address.')
      return
    }
    startAdd(async () => {
      let res: { ok: boolean; error?: string }
      try {
        res = await addTeamMember(value, addRole)
      } catch (err) {
        console.error('[v0] addTeamMember threw:', err)
        res = { ok: false, error: 'Something went wrong. Please try again.' }
      }
      if (res.ok) {
        toast({ title: 'Team member added', description: `${value} now has ${ROLE_LABELS[addRole]} access.` })
        setMembers((prev) => {
          if (prev.some((m) => m.email?.toLowerCase() === value.toLowerCase())) return prev
          return [
            ...prev,
            {
              user_id: `temp-${value}`,
              email: value,
              role: addRole,
              is_enabled: true,
              created_at: new Date().toISOString(),
              created_by_email: null,
            },
          ]
        })
        setAddEmail('')
        setAddRole('operations_admin')
        setAddOpen(false)
      } else {
        setAddError(res.error ?? 'Something went wrong. Please try again.')
      }
    })
  }

  function openEdit(m: TeamMemberRow) {
    setEditTarget(m)
    setEditRole(m.role)
    setEditEnabled(m.is_enabled)
    setEditError(null)
  }

  function handleSaveEdit() {
    if (!editTarget) return
    setEditError(null)
    startSave(async () => {
      let res: { ok: boolean; error?: string }
      try {
        res = await updateTeamMember(editTarget.user_id, { role: editRole, is_enabled: editEnabled })
      } catch (err) {
        console.error('[v0] updateTeamMember threw:', err)
        res = { ok: false, error: 'Something went wrong. Please try again.' }
      }
      if (res.ok) {
        toast({ title: 'Team member updated' })
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === editTarget.user_id ? { ...m, role: editRole, is_enabled: editEnabled } : m,
          ),
        )
        setEditTarget(null)
      } else {
        setEditError(res.error ?? 'Something went wrong. Please try again.')
      }
    })
  }

  /** Enable directly; disabling always routes through the confirm dialog. */
  function handleToggle(m: TeamMemberRow) {
    if (!m.is_enabled) {
      applyEnabled(m, true)
      return
    }
    setDisableTarget(m)
  }

  function applyEnabled(m: TeamMemberRow, enabled: boolean) {
    setPendingId(m.user_id)
    updateTeamMember(m.user_id, { is_enabled: enabled })
      .then((res) => {
        if (res.ok) {
          setMembers((prev) =>
            prev.map((x) => (x.user_id === m.user_id ? { ...x, is_enabled: enabled } : x)),
          )
          toast({ title: enabled ? 'Access enabled' : 'Access disabled' })
        } else {
          toast({ title: 'Update failed', description: res.error, variant: 'destructive' })
        }
      })
      .catch((err) => {
        console.error('[v0] applyEnabled threw:', err)
        toast({ title: 'Update failed', variant: 'destructive' })
      })
      .finally(() => {
        setPendingId(null)
        setDisableTarget(null)
      })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            placeholder="Search by email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search team members by email"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as 'all' | AdminRole)}>
            <SelectTrigger className="w-[160px]" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_FILTERS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'disabled')}>
            <SelectTrigger className="w-[150px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Add team member
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Privileged users</CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {members.length === 0
                ? 'No team members yet. Add one to grant privileged access.'
                : 'No team members match your filters.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead>Added by</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => {
                    const busy = pendingId === m.user_id
                    const isSelf = m.user_id === currentUserId
                    const finalAdmin = isFinalSuperAdmin(m)
                    const disableBlocked = isSelf || finalAdmin
                    return (
                      <TableRow key={m.user_id}>
                        <TableCell className="font-medium">
                          {m.email ?? '—'}
                          {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                        </TableCell>
                        <TableCell>
                          <RoleBadge role={m.role} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge enabled={m.is_enabled} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(m.created_at)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.created_by_email ?? '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(m)} disabled={busy}>
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || (m.is_enabled && disableBlocked)}
                              onClick={() => handleToggle(m)}
                              title={
                                m.is_enabled && isSelf
                                  ? 'You cannot disable your own account'
                                  : m.is_enabled && finalAdmin
                                    ? 'You cannot disable the final Super Admin'
                                    : undefined
                              }
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : m.is_enabled ? (
                                'Disable'
                              ) : (
                                'Enable'
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add team member dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setAddError(null) }}>
        <DialogContent>
          <form onSubmit={handleAdd}>
            <DialogHeader>
              <DialogTitle>Add team member</DialogTitle>
              <DialogDescription>
                The person must already have an account. They will be granted the selected access
                immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="add-email">Email address</Label>
                <Input
                  id="add-email"
                  type="email"
                  placeholder="person@example.com"
                  value={addEmail}
                  onChange={(e) => {
                    setAddEmail(e.target.value)
                    if (addError) setAddError(null)
                  }}
                  disabled={isAdding}
                  aria-invalid={addError ? true : undefined}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add-role">Role</Label>
                <Select value={addRole} onValueChange={(v) => setAddRole(v as AdminRole)}>
                  <SelectTrigger id="add-role" disabled={isAdding}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {addError && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium leading-snug text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{addError}</span>
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={isAdding}>
                Cancel
              </Button>
              <Button type="submit" disabled={isAdding || !addEmail.trim()} className="gap-2">
                {isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
                Add team member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit team member dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit team member</DialogTitle>
            <DialogDescription>{editTarget?.email ?? 'This user'}</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="grid gap-4 py-4">
              {editTarget.user_id === currentUserId && (
                <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  You cannot change your own role or disable your own account.
                </p>
              )}
              <div className="grid gap-2">
                <Label htmlFor="edit-role">Role</Label>
                <Select
                  value={editRole}
                  onValueChange={(v) => setEditRole(v as AdminRole)}
                >
                  <SelectTrigger
                    id="edit-role"
                    disabled={isSaving || editTarget.user_id === currentUserId}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-status">Status</Label>
                <Select
                  value={editEnabled ? 'active' : 'disabled'}
                  onValueChange={(v) => setEditEnabled(v === 'active')}
                >
                  <SelectTrigger
                    id="edit-status"
                    disabled={isSaving || editTarget.user_id === currentUserId}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editError && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium leading-snug text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{editError}</span>
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={isSaving} className="gap-2">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable confirmation */}
      <AlertDialog open={!!disableTarget} onOpenChange={(open) => !open && setDisableTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable access?</AlertDialogTitle>
            <AlertDialogDescription>
              {disableTarget?.email ?? 'This user'} will immediately lose all privileged access. You
              can re-enable them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disableTarget && applyEnabled(disableTarget, false)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disable access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
