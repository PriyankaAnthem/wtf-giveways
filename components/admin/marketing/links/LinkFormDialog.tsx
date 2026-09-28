"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown, Copy, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/hooks/use-toast"
import { normalizeCampaignSlug, type Channel, type Source } from "@/lib/marketing/attribution"
import {
  PLACEMENTS,
  competitionPath,
  getPlacement,
  placementNeedsPlatform,
  resolvePlacement,
  wtfUrlToInternalPath,
  type DestinationKind,
} from "@/lib/marketing/linkDestinations"
import {
  channelLabel,
  friendlyError,
  shortLinkUrl,
  sourceLabel,
  type TrackingLink,
} from "@/lib/marketing/linkDisplay"
import { formatCommissionRate, type Affiliate } from "@/lib/marketing/affiliateDisplay"

/** The payload POST/PUT expect (camelCase). */
export interface LinkPayload {
  id?: string
  label: string
  channel: Channel
  source: string
  campaign: string
  destinationPath: string
  content: string | null
  ref: string | null
  providerId: string | null
  /**
   * Affiliate id chosen on CREATE only (null = None). Deliberately omitted from
   * the payload on edit: affiliate assignment is immutable after creation.
   */
  affiliateId?: string | null
}

/** Result of a persist attempt, so the dialog can show the success panel. */
export type SubmitResult = { ok: true; item: TrackingLink } | { ok: false; error: string }

export interface Competition {
  slug: string
  title: string
}

interface FormState {
  label: string
  placement: string
  platform: string
  campaign: string
  destKind: DestinationKind
  competitionSlug: string
  customUrl: string
  /** Selected affiliate id, or "" for None. Create-only. */
  affiliateId: string
}

function emptyState(): FormState {
  return {
    label: "",
    placement: PLACEMENTS[0].value,
    platform: PLACEMENTS[0].platforms?.[0].value ?? "",
    campaign: "",
    destKind: "home",
    competitionSlug: "",
    customUrl: "",
    affiliateId: "",
  }
}

/** Derive an editable form state from an existing link (edit mode). */
function stateFromLink(link: TrackingLink): FormState {
  const path = link.destinationPath
  let destKind: DestinationKind = "custom"
  let competitionSlug = ""
  let customUrl = ""
  if (path === "/") {
    destKind = "home"
  } else {
    const m = /^\/giveaways\/([^/?#]+)/.exec(path)
    if (m) {
      destKind = "competition"
      competitionSlug = m[1]
    } else {
      destKind = "custom"
      customUrl = path
    }
  }
  return {
    label: link.label,
    // Attribution is immutable on edit; placement/platform are unused there.
    placement: PLACEMENTS[0].value,
    platform: "",
    campaign: link.campaign,
    destKind,
    competitionSlug,
    customUrl,
    // Affiliate is immutable on edit; carried only so it can be shown read-only.
    affiliateId: link.affiliateId ?? "",
  }
}

interface LinkFormDialogProps {
  open: boolean
  editing: TrackingLink | null
  origin: string
  competitions: Competition[]
  /** Active affiliates offered in the create picker (None is always available). */
  affiliates: Affiliate[]
  onClose: () => void
  onSubmit: (payload: LinkPayload) => Promise<SubmitResult>
}

/**
 * Simplified create / edit dialog for a tracking link.
 *
 * Staff choose WHAT they promote (label + campaign), WHERE it is used (a plain-
 * language placement that derives channel/source/medium) and WHERE customers
 * land (homepage / a live competition / a pasted WTF URL). The technical
 * taxonomy and `/t/<code>` short link are derived and shown only in the success
 * panel. On EDIT, attribution is immutable and shown read-only; only the label
 * and destination can change.
 */
export function LinkFormDialog({
  open,
  editing,
  origin,
  competitions,
  affiliates,
  onClose,
  onSubmit,
}: LinkFormDialogProps) {
  const [state, setState] = useState<FormState>(emptyState)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<TrackingLink | null>(null)
  const [compOpen, setCompOpen] = useState(false)
  const [affOpen, setAffOpen] = useState(false)
  const inFlight = useRef(false)
  const isEditing = editing !== null

  const selectedAffiliate = useMemo(
    () => affiliates.find((a) => a.id === state.affiliateId) ?? null,
    [affiliates, state.affiliateId],
  )

  useEffect(() => {
    if (open) {
      setState(editing ? stateFromLink(editing) : emptyState())
      setError(null)
      setCreated(null)
    }
  }, [open, editing])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  const placement = useMemo(() => getPlacement(state.placement), [state.placement])
  const needsPlatform = placementNeedsPlatform(placement)
  const slugPreview = useMemo(() => normalizeCampaignSlug(state.campaign), [state.campaign])

  // Hosts we accept for a pasted "Custom WTF page" URL (plus WTF apex, handled
  // inside the helper). Adding the current origin lets preview/staging URLs work.
  const extraHosts = useMemo(() => {
    try {
      return origin ? [new URL(origin).hostname] : []
    } catch {
      return []
    }
  }, [origin])

  // The resolved internal destination path for the current selection, or null.
  const destinationPath = useMemo(() => {
    if (state.destKind === "home") return "/"
    if (state.destKind === "competition") {
      return state.competitionSlug ? competitionPath(state.competitionSlug) : null
    }
    return wtfUrlToInternalPath(state.customUrl, extraHosts)
  }, [state.destKind, state.competitionSlug, state.customUrl, extraHosts])

  const selectedCompetitionTitle = useMemo(() => {
    if (state.destKind !== "competition" || !state.competitionSlug) return ""
    return competitions.find((c) => c.slug === state.competitionSlug)?.title ?? state.competitionSlug
  }, [state.destKind, state.competitionSlug, competitions])

  const clientError = useMemo(
    () => validateClient(state, slugPreview, destinationPath, needsPlatform, isEditing),
    [state, slugPreview, destinationPath, needsPlatform, isEditing],
  )

  function onPlacementChange(value: string) {
    const p = getPlacement(value)
    setState((s) => ({ ...s, placement: value, platform: p?.platforms?.[0].value ?? "" }))
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return
    if (!next) {
      setError(null)
      onClose()
    }
  }

  async function handleSubmit() {
    if (inFlight.current) return
    if (clientError) {
      setError(clientError)
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setError(null)

    let channel: Channel
    let source: string
    let campaign: string
    let content: string | null
    let ref: string | null
    let providerId: string | null

    if (isEditing && editing) {
      // Attribution is immutable — pass the existing values straight through so
      // optional fields (content/ref/provider) are preserved, not wiped.
      channel = editing.channel as Channel
      source = editing.source
      campaign = editing.campaign
      content = editing.content
      ref = editing.ref
      providerId = editing.providerId
    } else {
      const resolved = resolvePlacement(state.placement, state.platform)
      if (!resolved) {
        inFlight.current = false
        setSubmitting(false)
        setError(friendlyError("invalid_source"))
        return
      }
      channel = resolved.channel
      source = resolved.source
      campaign = state.campaign.trim()
      content = null
      ref = null
      providerId = null
    }

    const payload: LinkPayload = {
      ...(editing ? { id: editing.id } : {}),
      label: state.label.trim(),
      channel,
      source,
      campaign,
      destinationPath: destinationPath ?? "",
      content,
      ref,
      providerId,
      // Affiliate is set ONLY on create; on edit we omit it entirely so it can
      // never be changed (the API + DB trigger also refuse it).
      ...(isEditing ? {} : { affiliateId: state.affiliateId || null }),
    }

    const result = await onSubmit(payload)
    inFlight.current = false
    setSubmitting(false)
    if (!result.ok) {
      setError(friendlyError(result.error))
      return
    }
    // On create, show the success panel; on edit, the parent closes the dialog.
    if (!isEditing) setCreated(result.item)
  }

  // -------------------------------------------------------------------------
  // Success panel (after create)
  // -------------------------------------------------------------------------
  if (created) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <SuccessPanel
            link={created}
            origin={origin}
            destinationTitle={destinationTitleFor(created.destinationPath, competitions)}
            onDone={onClose}
          />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit tracking link" : "Create tracking link"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "You can update the internal label and where customers land. How this link is attributed cannot be changed."
              : "Choose what you're promoting, where it will be used, and where customers should land."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Internal label */}
          <div className="space-y-2">
            <Label htmlFor="tl-label">Internal label</Label>
            <Input
              id="tl-label"
              value={state.label}
              maxLength={120}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Brevo – Saturday £15k Push"
            />
            <p className="text-xs text-muted-foreground">
              Only your team sees this. Example: Brevo – Saturday £15k Push
            </p>
          </div>

          {isEditing ? (
            /* On edit, attribution AND affiliate are fixed — read-only, not inputs. */
            <>
              <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-foreground">How this link is attributed</p>
                <p className="text-muted-foreground">
                  {channelLabel(editing!.channel)} · {sourceLabel(editing!.channel, editing!.source)} · campaign{" "}
                  <span className="font-mono">{editing!.campaign}</span>
                </p>
                <p className="text-xs text-muted-foreground">This is fixed once a link is created.</p>
              </div>
              <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-foreground">Affiliate / Partner</p>
                <p className="text-muted-foreground">
                  {editing!.affiliateName
                    ? `${editing!.affiliateName}${editing!.affiliateActive === false ? " (inactive)" : ""}`
                    : "None"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Affiliate assignment cannot be changed after the tracking link is created.
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Where will this link be used? */}
              <div className="space-y-2">
                <Label htmlFor="tl-placement">Where will this link be used?</Label>
                <Select value={state.placement} onValueChange={onPlacementChange}>
                  <SelectTrigger id="tl-placement">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLACEMENTS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Secondary platform question (Email / Paid social only) */}
              {needsPlatform && placement && (
                <div className="space-y-2">
                  <Label htmlFor="tl-platform">{placement.platformLabel}</Label>
                  <Select value={state.platform} onValueChange={(v) => set("platform", v)}>
                    <SelectTrigger id="tl-platform">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {placement.platforms!.map((pl) => (
                        <SelectItem key={pl.value} value={pl.value}>
                          {pl.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Campaign name */}
              <div className="space-y-2">
                <Label htmlFor="tl-campaign">Campaign name</Label>
                <Input
                  id="tl-campaign"
                  value={state.campaign}
                  maxLength={100}
                  onChange={(e) => set("campaign", e.target.value)}
                  placeholder="Saturday £15k Push"
                />
                {slugPreview && (
                  <p className="text-xs text-muted-foreground">
                    Saved internally as <span className="font-mono">{slugPreview}</span>.
                  </p>
                )}
              </div>

              {/* Affiliate / Partner — optional, independent of the taxonomy. */}
              <div className="space-y-2">
                <Label htmlFor="tl-affiliate">Affiliate / Partner</Label>
                <Popover open={affOpen} onOpenChange={setAffOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="tl-affiliate"
                      variant="outline"
                      role="combobox"
                      aria-expanded={affOpen}
                      className="w-full justify-between bg-transparent font-normal"
                    >
                      <span className="truncate">
                        {selectedAffiliate ? selectedAffiliate.name : "None"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search affiliates…" />
                      <CommandList>
                        <CommandEmpty>No affiliates found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="None"
                            onSelect={() => {
                              set("affiliateId", "")
                              setAffOpen(false)
                            }}
                          >
                            <Check
                              className={"mr-2 h-4 w-4 " + (state.affiliateId === "" ? "opacity-100" : "opacity-0")}
                            />
                            None
                          </CommandItem>
                          {affiliates.map((a) => (
                            <CommandItem
                              key={a.id}
                              value={`${a.name} ${a.slug}`}
                              onSelect={() => {
                                set("affiliateId", a.id)
                                setAffOpen(false)
                              }}
                            >
                              <Check
                                className={
                                  "mr-2 h-4 w-4 " + (state.affiliateId === a.id ? "opacity-100" : "opacity-0")
                                }
                              />
                              <span className="truncate">{a.name}</span>
                              <span className="ml-auto pl-2 text-xs text-muted-foreground">
                                {formatCommissionRate(a.commissionBps)}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  Optional. This cannot be changed after the link is created.
                </p>
              </div>
            </>
          )}

          {/* Destination */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Destination</Label>
              <p className="text-xs text-muted-foreground">
                Choose the WTF page customers should see after they click your tracking link.
              </p>
            </div>

            <RadioGroup
              value={state.destKind}
              onValueChange={(v) => set("destKind", v as DestinationKind)}
              className="gap-2"
            >
              <DestinationOption
                id="dest-home"
                value="home"
                title="Homepage"
                description="Send customers to the WTF homepage."
                checked={state.destKind === "home"}
              />
              <DestinationOption
                id="dest-competition"
                value="competition"
                title="Live competition"
                description="Send customers straight to a specific competition."
                checked={state.destKind === "competition"}
              />
              <DestinationOption
                id="dest-custom"
                value="custom"
                title="Custom WTF page"
                description="Paste any wtf-giveaways.co.uk page URL."
                checked={state.destKind === "custom"}
              />
            </RadioGroup>

            {/* Live competition searchable selector */}
            {state.destKind === "competition" && (
              <div className="space-y-2 pl-1">
                <Popover open={compOpen} onOpenChange={setCompOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={compOpen}
                      className="w-full justify-between bg-transparent font-normal"
                    >
                      <span className="truncate">
                        {selectedCompetitionTitle || "Search competitions…"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search competitions…" />
                      <CommandList>
                        <CommandEmpty>No live competitions found.</CommandEmpty>
                        <CommandGroup>
                          {competitions.map((c) => (
                            <CommandItem
                              key={c.slug}
                              value={`${c.title} ${c.slug}`}
                              onSelect={() => {
                                set("competitionSlug", c.slug)
                                setCompOpen(false)
                              }}
                            >
                              <Check
                                className={
                                  "mr-2 h-4 w-4 " +
                                  (state.competitionSlug === c.slug ? "opacity-100" : "opacity-0")
                                }
                              />
                              <span className="truncate">{c.title}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {competitions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No live competitions right now — use Homepage or a custom page.
                  </p>
                )}
              </div>
            )}

            {/* Custom WTF URL */}
            {state.destKind === "custom" && (
              <div className="space-y-2 pl-1">
                <Input
                  value={state.customUrl}
                  maxLength={512}
                  onChange={(e) => set("customUrl", e.target.value)}
                  placeholder="https://www.wtf-giveaways.co.uk/giveaways/15kinstant"
                />
                <p className="text-xs text-muted-foreground">
                  Only wtf-giveaways.co.uk pages are allowed. External sites are rejected.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting} className="bg-transparent">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create tracking link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DestinationOption({
  id,
  value,
  title,
  description,
  checked,
}: {
  id: string
  value: string
  title: string
  description: string
  checked: boolean
}) {
  return (
    <Label
      htmlFor={id}
      className={
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors " +
        (checked ? "border-primary bg-primary/5" : "hover:bg-muted/50")
      }
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </Label>
  )
}

function SuccessPanel({
  link,
  origin,
  destinationTitle,
  onDone,
}: {
  link: TrackingLink
  origin: string
  destinationTitle: string
  onDone: () => void
}) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const url = shortLinkUrl(link.code, origin)

  async function copy() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        const ta = document.createElement("textarea")
        ta.value = url
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      setCopied(true)
      toast({ title: "Tracking link copied", description: url })
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast({ variant: "destructive", title: "Could not copy", description: "Copy the link manually." })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Your tracking link</DialogTitle>
        <DialogDescription>Share this link — nothing else needs configuring.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="break-all text-center font-mono text-lg font-semibold text-foreground">{url}</p>
        </div>

        <Button size="lg" className="w-full gap-2" onClick={copy}>
          {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
          Copy Tracking Link
        </Button>

        <p className="text-sm text-muted-foreground">
          Use this link in your email, SMS, social post or campaign. Customers will automatically be sent to{" "}
          <span className="font-medium text-foreground">{destinationTitle}</span> and their purchases will be
          attributed to this campaign.
        </p>

        <div className="rounded-lg border p-3 text-sm">
          <span className="text-muted-foreground">Customer destination: </span>
          <span className="font-medium text-foreground">{destinationTitle}</span>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone} className="bg-transparent">
          Done
        </Button>
      </DialogFooter>
    </>
  )
}

/** Human title for the just-created link's destination, for the success panel. */
function destinationTitleFor(path: string, competitions: Competition[]): string {
  if (path === "/") return "the WTF homepage"
  const m = /^\/giveaways\/([^/?#]+)/.exec(path)
  if (m) {
    const found = competitions.find((c) => c.slug === m[1])
    if (found) return found.title
  }
  if (path === "/giveaways") return "the live competitions page"
  return path
}

/** Fast client-side feedback; the server remains the source of truth. */
function validateClient(
  state: FormState,
  slugPreview: string | null,
  destinationPath: string | null,
  needsPlatform: boolean,
  isEditing: boolean,
): string | null {
  if (state.label.trim().length < 1 || state.label.trim().length > 120) {
    return "Enter an internal label between 1 and 120 characters."
  }
  if (!isEditing) {
    if (!getPlacement(state.placement)) return "Choose where this link will be used."
    if (needsPlatform && !state.platform) return "Choose the platform for this link."
    if (!slugPreview) return "Enter a campaign name using letters and numbers."
  }
  if (state.destKind === "competition" && !state.competitionSlug) {
    return "Choose the live competition customers should land on."
  }
  if (state.destKind === "custom" && !destinationPath) {
    return "Paste a valid wtf-giveaways.co.uk page URL."
  }
  if (!destinationPath) return "Choose where customers should land."
  return null
}
