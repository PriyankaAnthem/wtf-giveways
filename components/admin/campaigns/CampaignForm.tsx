"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import type { Campaign } from "@/lib/types/campaign"
import type { InstantWinPrizeRow, InstantWinFulfilmentType } from "@/lib/types/instantWins"
import { validateImageFile, IMAGE_ACCEPT_ATTR } from "@/lib/media/image-upload"
import {
  validateVideoFile,
  validateVideoMetadata,
  VIDEO_ACCEPT_ATTR,
} from "@/lib/media/video-upload"
import { deleteManagedObjectByUrl } from "@/lib/media/storage-cleanup"
import { Trash2, Save, Upload, Plus, Film } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  listAssignableHosts,
  getCampaignHostAssignments,
  saveCampaignHostAssignments,
  type AssignableHost,
  type HostAssignment,
} from "@/app/admin/campaigns/host-actions"

/** A host row in the form. commission_pct is kept as a raw string while editing
 *  (mirrors the amount-input pattern) and parsed to a number only on save. */
interface HostRow {
  host_user_id: string
  commission_pct: string
}

/** Trim trailing zeros for display (7.5 → "7.5", 8 → "8", 15.5 → "15.5"). */
function formatPct(n: number): string {
  if (!Number.isFinite(n)) return ""
  return String(Number(n.toFixed(2)))
}

interface CampaignFormProps {
  campaign: Campaign
  isNew: boolean
  /** True when the admin arrived here right after duplicating a campaign. */
  justDuplicated?: boolean
}

// A publishable slug: non-empty, lowercase/uppercase letters, digits and
// hyphens (no leading/trailing hyphen). Matching is case-insensitive because
// some historic slugs use mixed casing.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i

/** Prefix used by server-side duplication for temporary placeholder slugs. */
const TEMP_SLUG_PREFIX = "draft-copy-"

/** Statuses that make a campaign publicly visible and therefore require a slug. */
const PUBLIC_STATUSES = new Set(["live", "paused", "sold_out", "closed"])

// Format integer pence into an editable GBP string (e.g. 50050 -> "500.50").
function penceToGbpInput(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(pence)) return ""
  return (pence / 100).toFixed(2)
}

// Format integer pence for display (e.g. 50050 -> "£500.00").
function penceToDisplay(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(pence)) return "—"
  return `£${(pence / 100).toFixed(2)}`
}

const FULFILMENT_LABELS: Record<InstantWinFulfilmentType, string> = {
  cash: "Cash",
  wallet_credit: "WTF Credit",
  manual: "Manual",
}

export function CampaignForm({ campaign, isNew, justDuplicated = false }: CampaignFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [formData, setFormData] = useState<Campaign>({
    ...campaign,
    presentation_type: campaign.presentation_type ?? 'instant_cash',
    reveal_type: campaign.reveal_type ?? 'normal',
    is_free_entry: campaign.is_free_entry ?? false,
    free_entry_limit_per_user: campaign.free_entry_limit_per_user ?? 1,
    // Existing campaigns saved before this field existed load as 'automatic',
    // matching the database default and their current behaviour.
    end_draw_mode: campaign.end_draw_mode ?? 'automatic',
  })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Promotional video (Video Phase 1) ---
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null)
  const [videoInfo, setVideoInfo] = useState<
    { name: string; size: number; durationS: number; width: number; height: number } | null
  >(null)
  const [isValidatingVideo, setIsValidatingVideo] = useState(false)
  const [isVideoUploading, setIsVideoUploading] = useState(false)
  const [videoError, setVideoError] = useState<string | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  // The last-PERSISTED managed video URL (used as `previousPromoVideoUrl` so the
  // server can safely clean the old object only AFTER the new state commits).
  const videoBaselineUrlRef = useRef<string | null>(campaign.promoVideoUrl ?? null)
  // A video uploaded THIS session but not yet persisted via Save. Tracked so an
  // unsaved upload can be cleaned immediately if replaced/removed/save-failed,
  // never leaving an orphan in the campaign-video bucket.
  const pendingVideoUrlRef = useRef<string | null>(null)

  // Instant wins state
  const [instantWins, setInstantWins] = useState<InstantWinPrizeRow[]>([])
  const [iwOriginal, setIwOriginal] = useState<Record<string, InstantWinPrizeRow>>({}) // Track original values for dirty checking
  const [iwLoading, setIwLoading] = useState(false)
  const [iwError, setIwError] = useState<string | null>(null)
  const [iwSaving, setIwSaving] = useState<Record<string, boolean>>({})
  const [iwUploadingId, setIwUploadingId] = useState<string | null>(null)

  // Editable GBP amount string per prize (kept separate so the server always
  // parses the raw string into authoritative pence).
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({})
  // Editable quantity string per prize. Quantity is reconciled via a dedicated
  // action/route, NOT the ordinary details Save.
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({})
  const [qtySaving, setQtySaving] = useState<Record<string, boolean>>({})
  // Per-prize quantity error, shown INLINE next to the quantity control that
  // caused it (not in the section-level banner, which can be off-screen).
  const [qtyError, setQtyError] = useState<Record<string, string | null>>({})

  // Host assignments (Phase 2 — attribution only). Options are loaded once;
  // saved assignments are loaded when editing an existing campaign.
  const [hostOptions, setHostOptions] = useState<AssignableHost[]>([])
  const [hostRows, setHostRows] = useState<HostRow[]>([])
  const [hostsLoading, setHostsLoading] = useState(false)
  const [hostsError, setHostsError] = useState<string | null>(null)

  const campaignId = formData.id || campaign.id

  // Details dirty-check EXCLUDES quantity (quantity has its own update action).
  const isPrizeDirty = useCallback((prize: InstantWinPrizeRow): boolean => {
    const orig = iwOriginal[prize.id]
    if (!orig) return true // New row, not in original = dirty
    const amountChanged =
      (amountInputs[prize.id] ?? "") !== penceToGbpInput(orig.prize_value_pence)
    return (
      prize.prize_title !== orig.prize_title ||
      prize.prize_value_text !== orig.prize_value_text ||
      prize.image_url !== orig.image_url ||
      prize.is_high_value !== orig.is_high_value ||
      prize.fulfilment_type !== orig.fulfilment_type ||
      amountChanged
    )
  }, [iwOriginal, amountInputs])

  // Quantity dirty-check is independent of the details dirty state.
  const isQuantityDirty = useCallback((prize: InstantWinPrizeRow): boolean => {
    const raw = qtyInputs[prize.id]
    if (raw === undefined) return false
    const n = Number(raw)
    if (!Number.isInteger(n)) return raw.trim() !== String(prize.quantity)
    return n !== prize.quantity
  }, [qtyInputs])

  // Get all dirty prizes
  const getDirtyPrizes = useCallback((): InstantWinPrizeRow[] => {
    return instantWins.filter(isPrizeDirty)
  }, [instantWins, isPrizeDirty])

  const handleChange = (
    field: keyof Campaign,
    value: string | number | boolean | null
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  // Fetch instant wins when campaign has an id
  const fetchInstantWins = useCallback(async () => {
    if (!campaignId) return
    setIwLoading(true)
    setIwError(null)
    try {
      const res = await fetch(`/api/admin/instant-win-prizes?campaignId=${campaignId}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setIwError(json.error || 'Failed to fetch instant wins')
        return
      }
      const items = json.items || []
      setInstantWins(items)
      // Store original values for dirty checking
      const originals: Record<string, InstantWinPrizeRow> = {}
      const amounts: Record<string, string> = {}
      const qtys: Record<string, string> = {}
      items.forEach((item: InstantWinPrizeRow) => {
        originals[item.id] = { ...item }
        amounts[item.id] = penceToGbpInput(item.prize_value_pence)
        qtys[item.id] = String(item.quantity ?? 1)
      })
      setIwOriginal(originals)
      setAmountInputs(amounts)
      setQtyInputs(qtys)
    } catch (err: any) {
      setIwError(err?.message || 'Failed to fetch instant wins')
    } finally {
      setIwLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    if (campaignId) fetchInstantWins()
  }, [campaignId, fetchInstantWins])

  // Load the assignable host list once (create + edit both need it).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await listAssignableHosts()
        if (cancelled) return
        if (res.ok) setHostOptions(res.hosts ?? [])
        else setHostsError(res.error ?? "Failed to load hosts")
      } catch (err: any) {
        if (!cancelled) setHostsError(err?.message ?? "Failed to load hosts")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // On edit, populate the saved assignments for this campaign.
  useEffect(() => {
    if (isNew || !campaignId) return
    let cancelled = false
    setHostsLoading(true)
    ;(async () => {
      try {
        const res = await getCampaignHostAssignments(campaignId)
        if (cancelled) return
        if (res.ok) {
          setHostRows(
            (res.assignments ?? []).map((a) => ({
              host_user_id: a.host_user_id,
              commission_pct: formatPct(a.commission_pct),
            })),
          )
        } else {
          setHostsError(res.error ?? "Failed to load host assignments")
        }
      } catch (err: any) {
        if (!cancelled) setHostsError(err?.message ?? "Failed to load host assignments")
      } finally {
        if (!cancelled) setHostsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isNew, campaignId])

  // --- Host row handlers ---
  function addHostRow() {
    setHostsError(null)
    setHostRows((prev) => [...prev, { host_user_id: "", commission_pct: "" }])
  }
  function removeHostRow(index: number) {
    setHostsError(null)
    setHostRows((prev) => prev.filter((_, i) => i !== index))
  }
  function setHostRowUser(index: number, userId: string) {
    setHostsError(null)
    setHostRows((prev) => prev.map((r, i) => (i === index ? { ...r, host_user_id: userId } : r)))
  }
  function setHostRowPct(index: number, pct: string) {
    setHostsError(null)
    setHostRows((prev) => prev.map((r, i) => (i === index ? { ...r, commission_pct: pct } : r)))
  }

  /** Validate host rows and build the numeric payload for persistence. */
  function buildHostPayload():
    | { ok: true; payload: HostAssignment[] }
    | { ok: false; error: string } {
    const seen = new Set<string>()
    const payload: HostAssignment[] = []
    for (const r of hostRows) {
      if (!r.host_user_id) {
        return { ok: false, error: "Select a host for every host row, or remove empty rows." }
      }
      if (seen.has(r.host_user_id)) {
        return { ok: false, error: "The same host cannot be assigned twice." }
      }
      seen.add(r.host_user_id)

      const raw = r.commission_pct.trim()
      const pct = Number(raw)
      if (raw === "" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        return { ok: false, error: "Commission for each host must be a number between 0 and 100." }
      }
      payload.push({ host_user_id: r.host_user_id, commission_pct: pct })
    }
    return { ok: true, payload }
  }

  async function handleUpload() {
    if (!selectedFile) return
    const validation = validateImageFile(selectedFile)
    if (!validation.ok) {
      setUploadError(validation.error)
      return
    }
    setIsUploading(true)
    setUploadError(null)

    try {
      const supabase = createClient()
      const folder = isNew && !campaign.id ? 'new' : campaign.id
      const safeName = selectedFile.name.toLowerCase().replace(/\s+/g, '-')
      const path = `campaigns/${folder}/${Date.now()}-${safeName}`

      const { error } = await supabase.storage
        .from('campaign-hero')
        .upload(path, selectedFile, { upsert: true, contentType: selectedFile.type })

      if (error) {
        setUploadError(error.message)
        return
      }

      const { data: publicUrlData } = supabase.storage
        .from('campaign-hero')
        .getPublicUrl(path)

      handleChange('heroImageUrl', publicUrlData.publicUrl)
      setSelectedFile(null)
      setSaveError(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  // Validate a chosen video locally (file-level + metadata) before allowing an
  // upload. Never uploads; loads metadata via a temporary object URL.
  async function handleVideoSelect(file: File | null) {
    setVideoError(null)
    setVideoInfo(null)
    if (!file) {
      setSelectedVideoFile(null)
      return
    }
    const fileCheck = validateVideoFile(file)
    if (!fileCheck.ok) {
      setVideoError(fileCheck.error)
      setSelectedVideoFile(null)
      if (videoInputRef.current) videoInputRef.current.value = ''
      return
    }
    setIsValidatingVideo(true)
    const metaCheck = await validateVideoMetadata(file)
    setIsValidatingVideo(false)
    if (!metaCheck.ok) {
      setVideoError(metaCheck.error)
      setSelectedVideoFile(null)
      if (videoInputRef.current) videoInputRef.current.value = ''
      return
    }
    setSelectedVideoFile(file)
    setVideoInfo({
      name: file.name,
      size: file.size,
      durationS: metaCheck.metadata.durationS,
      width: metaCheck.metadata.width,
      height: metaCheck.metadata.height,
    })
  }

  // Upload the validated video directly to Supabase Storage (browser → Storage,
  // never proxied through our API). Persists the public URL into form state; the
  // old object is cleaned server-side on Save after the new URL is committed.
  async function handleVideoUpload() {
    if (!selectedVideoFile || !videoInfo) return
    const fileCheck = validateVideoFile(selectedVideoFile)
    if (!fileCheck.ok) {
      setVideoError(fileCheck.error)
      return
    }
    setIsVideoUploading(true)
    setVideoError(null)
    try {
      const supabase = createClient()
      const folder = isNew && !campaign.id ? 'new' : campaign.id
      const safeName = selectedVideoFile.name
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
      const path = `campaigns/${folder}/${Date.now()}-${safeName}`

      const { error } = await supabase.storage
        .from('campaign-video')
        .upload(path, selectedVideoFile, { upsert: true, contentType: 'video/mp4' })

      if (error) {
        setVideoError(error.message)
        return
      }

      const { data: publicUrlData } = supabase.storage.from('campaign-video').getPublicUrl(path)
      const newUrl = publicUrlData.publicUrl

      // Clean a previous UNSAVED upload from this session (safe: never persisted).
      const prevPending = pendingVideoUrlRef.current
      if (prevPending && prevPending !== videoBaselineUrlRef.current) {
        await deleteManagedObjectByUrl(supabase, prevPending, { allowedBuckets: ['campaign-video'] })
      }
      pendingVideoUrlRef.current = newUrl

      handleChange('promoVideoUrl', newUrl)
      handleChange('promoVideoDurationS', Math.round(videoInfo.durationS))
      setSelectedVideoFile(null)
      if (videoInputRef.current) videoInputRef.current.value = ''
    } catch (err: any) {
      setVideoError(err?.message || 'Video upload failed')
    } finally {
      setIsVideoUploading(false)
    }
  }

  // Remove the promotional video from the campaign. An unsaved upload is deleted
  // immediately (safe orphan); a previously-persisted video is nulled here and
  // its Storage object is removed server-side on Save after propagation.
  async function handleRemoveVideo() {
    const pending = pendingVideoUrlRef.current
    if (pending && pending !== videoBaselineUrlRef.current) {
      try {
        const supabase = createClient()
        await deleteManagedObjectByUrl(supabase, pending, { allowedBuckets: ['campaign-video'] })
      } catch {
        /* best-effort */
      }
      pendingVideoUrlRef.current = null
    }
    handleChange('promoVideoUrl', '')
    handleChange('promoVideoDurationS', null)
    setVideoInfo(null)
    setSelectedVideoFile(null)
    setVideoError(null)
    if (videoInputRef.current) videoInputRef.current.value = ''
  }

  async function handleSave() {
    if (isUploading) {
      setSaveError('Image is still uploading — please wait')
      return
    }
    if (isVideoUploading) {
      setSaveError('Video is still uploading — please wait')
      return
    }
    if (selectedFile && !formData.heroImageUrl) {
      setSaveError('Click Upload to attach the hero image')
      return
    }
    if (iwUploadingId) {
      setSaveError('An instant win image is still uploading — please wait')
      return
    }
    // Publish safety: a public status requires a valid, non-empty slug. This
    // blocks a blank-slug draft (e.g. a fresh duplicate) from going live.
    setSlugError(null)
    if (PUBLIC_STATUSES.has(formData.status)) {
      const slug = (formData.slug ?? "").trim()
      if (slug.length === 0) {
        setSlugError("Add a slug before publishing. A blank slug cannot go live.")
        setSaveError("This campaign needs a valid slug before it can be published.")
        return
      }
      if (!SLUG_RE.test(slug)) {
        setSlugError("Use only letters, numbers and hyphens (no spaces or symbols).")
        setSaveError("This campaign needs a valid slug before it can be published.")
        return
      }
      // A temporary duplicate placeholder must never be published as-is.
      if (slug.toLowerCase().startsWith(TEMP_SLUG_PREFIX)) {
        setSlugError("Replace the temporary draft slug before publishing.")
        setSaveError("Replace the temporary draft slug before publishing.")
        return
      }
    }

    // Validate host assignments up front so we never save the campaign and
    // then discover the host rows are invalid.
    const hostCheck = buildHostPayload()
    if (!hostCheck.ok) {
      setHostsError(hostCheck.error)
      setSaveError(hostCheck.error)
      return
    }

    setIsSaving(true)
    setSaveError(null)
    setIwError(null)
    setHostsError(null)

    let instantWinsSaved = false

    try {
      // 1. Save all dirty instant win prizes first (in parallel)
      const dirtyPrizes = getDirtyPrizes()
      if (dirtyPrizes.length > 0) {
        // Validate prize details upfront: cash / WTF Credit require a positive amount.
        for (const prize of dirtyPrizes) {
          const amountStr = (amountInputs[prize.id] ?? "").trim()
          if (prize.fulfilment_type === 'cash' || prize.fulfilment_type === 'wallet_credit') {
            const amountNum = Number(amountStr)
            if (amountStr === "" || !Number.isFinite(amountNum) || amountNum <= 0) {
              setSaveError(`"${prize.prize_title}" needs a prize amount greater than £0 for ${FULFILMENT_LABELS[prize.fulfilment_type]} fulfilment`)
              setIsSaving(false)
              return
            }
          }
        }

        // Save all prize DETAILS in parallel (never quantity — that is reconciled separately).
        const saveResults = await Promise.all(
          dirtyPrizes.map(async (prize) => {
            const res = await fetch('/api/admin/instant-win-prizes', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: prize.id,
                campaign_id: prize.campaign_id,
                prize_title: prize.prize_title,
                prize_value_text: prize.prize_value_text,
                fulfilment_type: prize.fulfilment_type,
                prize_value_gbp: amountInputs[prize.id] ?? null,
                image_url:
                  prize.image_url ??
                  iwOriginal[prize.id]?.image_url ??
                  null,
                is_high_value: prize.is_high_value,
              }),
            })
            const json = await res.json()
            return { prize, ok: res.ok && json.ok, error: json.error, updated: json.updated }
          })
        )

        // Check for any failures
        const failed = saveResults.filter((r) => !r.ok)
        if (failed.length > 0) {
          const firstFail = failed[0]
          setSaveError(`Failed to save instant win "${firstFail.prize.prize_title}": ${firstFail.error || 'Unknown error'}`)
          setIsSaving(false)
          return
        }

        // Sync rows + originals + amount inputs from the authoritative server rows.
        const updatedById: Record<string, InstantWinPrizeRow> = {}
        saveResults.forEach((r) => { if (r.updated) updatedById[r.updated.id] = r.updated })
        setInstantWins((prev) => prev.map((p) => updatedById[p.id] ? { ...p, ...updatedById[p.id] } : p))
        setIwOriginal((prev) => {
          const updated = { ...prev }
          dirtyPrizes.forEach((p) => {
            updated[p.id] = updatedById[p.id] ? { ...updatedById[p.id] } : { ...p }
          })
          return updated
        })
        setAmountInputs((prev) => {
          const next = { ...prev }
          Object.values(updatedById).forEach((row) => { next[row.id] = penceToGbpInput(row.prize_value_pence) })
          return next
        })
        instantWinsSaved = true
      }

      // 2. Save campaign. `previousPromoVideoUrl` lets the server clean the old
      //    managed video object AFTER the new state commits and propagates.
      const method = isNew ? 'POST' : 'PUT'
      const res = await fetch('/api/admin/campaigns', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          previousPromoVideoUrl: videoBaselineUrlRef.current,
        }),
      })

      const json = await res.json()

      if (!res.ok || !json.ok) {
        const baseError = json.error || `Request failed (${res.status})`
        // DB persistence failed after a fresh upload: clean the now-unreferenced
        // object so it never becomes an orphan, and revert the form to the last
        // persisted video state.
        const pending = pendingVideoUrlRef.current
        if (pending && pending !== videoBaselineUrlRef.current) {
          try {
            await deleteManagedObjectByUrl(createClient(), pending, {
              allowedBuckets: ['campaign-video'],
            })
          } catch {
            /* best-effort */
          }
          pendingVideoUrlRef.current = null
          handleChange('promoVideoUrl', videoBaselineUrlRef.current ?? '')
          handleChange('promoVideoDurationS', null)
        }
        if (instantWinsSaved) {
          setSaveError(`Instant win changes were saved, but campaign changes failed: ${baseError}`)
        } else {
          setSaveError(baseError)
        }
        return
      }

      // Campaign committed: the current video URL is now the persisted baseline
      // and there is no pending unsaved upload to clean.
      videoBaselineUrlRef.current = formData.promoVideoUrl?.trim() ? formData.promoVideoUrl.trim() : null
      pendingVideoUrlRef.current = null

      // 3. Persist host assignments now that we have a valid campaign id.
      //    A failure here must NOT be reported as a full success.
      const savedCampaignId = json.id || formData.id || campaignId
      const hostRes = await saveCampaignHostAssignments(savedCampaignId, hostCheck.payload)
      if (!hostRes.ok) {
        const hostErr = hostRes.error || 'Unknown error'
        setHostsError(hostErr)
        setSaveError(`Campaign was saved, but host assignments failed to save: ${hostErr}`)
        return
      }

      if (formData.status === 'ended') {
        try {
          const token = process.env.NEXT_PUBLIC_CRON_SECRET
          await fetch(`/api/jobs/refresh-winner-snapshots${token ? `?token=${token}` : ''}`)
        } catch (e) {
          console.error('[winners] refresh snapshot trigger failed', e)
        }
      }

      toast({
        title: "Saved successfully",
        description: "Changes may take a few seconds to appear live.",
      })
      router.push('/admin/campaigns')
      router.refresh()
    } catch (err: any) {
      setSaveError(err?.message || 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  // --- Instant Win handlers ---

  // Track a newly created prize row in local state, including its editable inputs.
  function trackNewPrizes(newItems: InstantWinPrizeRow[]) {
    setInstantWins((prev) => [...prev, ...newItems])
    setIwOriginal((prev) => {
      const updated = { ...prev }
      newItems.forEach((item) => { updated[item.id] = { ...item } })
      return updated
    })
    setAmountInputs((prev) => {
      const next = { ...prev }
      newItems.forEach((item) => { next[item.id] = penceToGbpInput(item.prize_value_pence) })
      return next
    })
    setQtyInputs((prev) => {
      const next = { ...prev }
      newItems.forEach((item) => { next[item.id] = String(item.quantity ?? 1) })
      return next
    })
  }

  async function handleAddPrize() {
    if (!campaignId) return
    setIwError(null)
    try {
      // New prizes default to Manual fulfilment with no amount (always valid).
      // The admin then picks the fulfilment type and amount and saves details.
      const res = await fetch('/api/admin/instant-win-prizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          prize_title: 'New Prize',
          quantity: 1,
          fulfilment_type: 'manual',
          prize_value_gbp: null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setIwError(json.error || 'Failed to add prize')
        return
      }
      trackNewPrizes(json.items || [])
    } catch (err: any) {
      setIwError(err?.message || 'Failed to add prize')
    }
  }

  function handlePrizeFieldChange(id: string, field: keyof InstantWinPrizeRow, value: string | number | boolean | null) {
    setInstantWins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    )
  }

  async function handleSavePrize(prize: InstantWinPrizeRow) {
    const amountStr = (amountInputs[prize.id] ?? "").trim()
    if (prize.fulfilment_type === 'cash' || prize.fulfilment_type === 'wallet_credit') {
      const amountNum = Number(amountStr)
      if (amountStr === "" || !Number.isFinite(amountNum) || amountNum <= 0) {
        setIwError(`"${prize.prize_title}" needs a prize amount greater than £0 for ${FULFILMENT_LABELS[prize.fulfilment_type]} fulfilment`)
        return
      }
    }

    setIwSaving((prev) => ({ ...prev, [prize.id]: true }))
    setIwError(null)
    try {
      // Details save only. Quantity is reconciled via handleUpdateQuantity.
      const res = await fetch('/api/admin/instant-win-prizes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: prize.id,
          campaign_id: prize.campaign_id,
          prize_title: prize.prize_title,
          prize_value_text: prize.prize_value_text,
          fulfilment_type: prize.fulfilment_type,
          prize_value_gbp: amountInputs[prize.id] ?? null,
          image_url: prize.image_url,
          is_high_value: prize.is_high_value,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setIwError(json.error || 'Failed to save prize')
      } else {
        const updated: InstantWinPrizeRow | undefined = json.updated
        if (updated) {
          setInstantWins((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
          setIwOriginal((prev) => ({ ...prev, [updated.id]: { ...updated } }))
          setAmountInputs((prev) => ({ ...prev, [updated.id]: penceToGbpInput(updated.prize_value_pence) }))
        } else {
          setIwOriginal((prev) => ({ ...prev, [prize.id]: { ...prize } }))
        }
      }
    } catch (err: any) {
      setIwError(err?.message || 'Failed to save prize')
    } finally {
      setIwSaving((prev) => ({ ...prev, [prize.id]: false }))
    }
  }

  async function handleUpdateQuantity(prize: InstantWinPrizeRow) {
    // The maximum a prize quantity may take is the campaign's total ticket
    // capacity. A null cap means the campaign is uncapped, so only the
    // positive-integer shape is enforced (no arbitrary ceiling).
    const cap = formData.maxTicketsTotal
    const raw = (qtyInputs[prize.id] ?? "").trim()
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || (cap != null && n > cap)) {
      const limitText =
        cap != null
          ? `a whole number between 1 and ${cap.toLocaleString("en-GB")} (this campaign's ticket capacity)`
          : "a whole number of at least 1"
      setQtyError((prev) => ({ ...prev, [prize.id]: `Quantity must be ${limitText}.` }))
      return
    }

    setQtySaving((prev) => ({ ...prev, [prize.id]: true }))
    setQtyError((prev) => ({ ...prev, [prize.id]: null }))
    try {
      const res = await fetch('/api/admin/instant-win-prizes/quantity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: prize.id, campaign_id: prize.campaign_id, quantity: n }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setQtyError((prev) => ({ ...prev, [prize.id]: json.message || json.error || 'Failed to update quantity' }))
        return
      }
      const confirmed = json.quantity ?? n
      setInstantWins((prev) => prev.map((p) => (p.id === prize.id ? { ...p, quantity: confirmed } : p)))
      setIwOriginal((prev) => prev[prize.id] ? { ...prev, [prize.id]: { ...prev[prize.id], quantity: confirmed } } : prev)
      setQtyInputs((prev) => ({ ...prev, [prize.id]: String(confirmed) }))
      toast({
        title: "Quantity updated",
        description: `${prize.prize_title} now has ${confirmed} slot${confirmed === 1 ? '' : 's'}.`,
      })
    } catch (err: any) {
      setQtyError((prev) => ({ ...prev, [prize.id]: err?.message || 'Failed to update quantity' }))
    } finally {
      setQtySaving((prev) => ({ ...prev, [prize.id]: false }))
    }
  }

  async function handleDeletePrize(prizeId: string) {
    if (!confirm('Delete this instant win prize?')) return
    setIwError(null)
    try {
      const res = await fetch(`/api/admin/instant-win-prizes?id=${prizeId}&campaignId=${campaignId}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setIwError(
          json.error === 'prize_cannot_be_deleted'
            ? 'This prize cannot be deleted because some prize positions are already assigned or won.'
            : json.error || 'Failed to delete prize',
        )
        return
      }
      setInstantWins((prev) => prev.filter((p) => p.id !== prizeId))
      setIwOriginal((prev) => {
        const updated = { ...prev }
        delete updated[prizeId]
        return updated
      })
      setAmountInputs((prev) => {
        const next = { ...prev }
        delete next[prizeId]
        return next
      })
      setQtyInputs((prev) => {
        const next = { ...prev }
        delete next[prizeId]
        return next
      })
    } catch (err: any) {
      setIwError(err?.message || 'Failed to delete prize')
    }
  }

  // NOTE (orphan cleanup): a replaced prize image is NOT deleted here. Prize
  // images are copied into `giveaway_snapshots` payloads read by the public
  // detail page, so the previous object must remain until snapshots refresh.
  // Immediate deletion would break cached public pages. Deferred cleanup of
  // superseded prize objects is a separate audited task.
  async function handlePrizeImageUpload(prize: InstantWinPrizeRow, file: File) {
    const validation = validateImageFile(file)
    if (!validation.ok) {
      setIwError(validation.error)
      return
    }
    setIwUploadingId(prize.id)
    setIwError(null)
    try {
      const supabase = createClient()
      // Sanitize filename: lowercase, remove special chars (£, commas, brackets, etc.), collapse multiple hyphens
      const safeFileName = file.name
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, '-')
        .replace(/-+/g, '-')
      const path = `campaigns/${campaignId}/${prize.id}/${Date.now()}-${safeFileName}`

      const { error } = await supabase.storage
        .from('instant-win-prizes')
        .upload(path, file, { upsert: true, contentType: file.type })

      if (error) {
        setIwError(error.message)
        return
      }

      const { data: publicUrlData } = supabase.storage
        .from('instant-win-prizes')
        .getPublicUrl(path)

      const imageUrl = publicUrlData.publicUrl

      // Persist to DB immediately
      const putBody = {
        id: prize.id,
        campaign_id: prize.campaign_id,
        image_url: imageUrl,
      }

      const res = await fetch('/api/admin/instant-win-prizes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(putBody),
      })
      const json = await res.json()

      if (!res.ok || !json.ok) {
        // PUT failed - show error and stop
        setIwError(json.error || 'Failed to update image URL')
        return
      }

      // Use the returned updated.image_url as the confirmed saved value
      const confirmedImageUrl = json.updated?.image_url ?? imageUrl

      // Update local state with confirmed value from DB
      handlePrizeFieldChange(prize.id, 'image_url', confirmedImageUrl)

      // Update iwOriginal so image state is no longer dirty
      setIwOriginal((prev) => ({
        ...prev,
        [prize.id]: {
          ...prev[prize.id],
          image_url: confirmedImageUrl,
        },
      }))

      toast({
        title: "Image saved",
        description: "Prize image has been uploaded and saved.",
      })
    } catch (err: any) {
      setIwError(err?.message || 'Image upload failed')
    } finally {
      setIwUploadingId(null)
    }
  }

  // Derived host values for the render (kept out of state to stay in sync).
  const selectedHostIds = new Set(hostRows.map((r) => r.host_user_id).filter(Boolean))
  const totalHostCommission = hostRows.reduce((sum, r) => sum + (Number(r.commission_pct) || 0), 0)
  // Disable "Add host" when there is nothing to add: no hosts exist, an unfilled
  // row is already open, or every enabled host is already assigned.
  const addHostDisabled =
    hostOptions.length === 0 ||
    hostRows.some((r) => !r.host_user_id) ||
    selectedHostIds.size >= hostOptions.length

  return (
    <div className="space-y-6">
      {justDuplicated ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              Draft copy created — review before publishing
            </p>
            <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90">
              This is a new draft. Sales, entries, tickets, instant-win positions, winners and payouts
              were <strong>not</strong> copied. This is a{" "}
              <strong>temporary draft slug</strong> — replace it with the final campaign URL before
              publishing.
            </p>
            <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100/90">
              Review before publishing: title, slug, dates, pricing, capacity, artwork, bundles and
              prizes. Instant-win prizes must be added manually.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
        <CardContent className="pt-6">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            <strong>Note:</strong> Instant wins are configured separately and are paced throughout the campaign.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => handleChange("title", e.target.value)}
              placeholder="iPhone 15 Pro Giveaway"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={formData.slug}
              onChange={(e) => {
                setSlugError(null)
                handleChange("slug", e.target.value)
              }}
              placeholder="iphone-15-pro-giveaway"
              aria-invalid={slugError ? true : undefined}
              aria-describedby={slugError ? "slug-error" : undefined}
            />
            {slugError ? (
              <p id="slug-error" className="text-sm font-medium text-destructive" role="alert">
                {slugError}
              </p>
            ) : (formData.slug ?? "").toLowerCase().startsWith(TEMP_SLUG_PREFIX) ? (
              <p className="text-sm font-medium text-amber-600 dark:text-amber-500">
                This is a temporary draft slug. Replace it with the final campaign URL before
                publishing.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => handleChange("status", value)}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="ended">Ended</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="presentation_type">Presentation Type</Label>
            <Select
              value={formData.presentation_type ?? "instant_cash"}
              onValueChange={(value) => handleChange("presentation_type", value)}
            >
              <SelectTrigger id="presentation_type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balloon_pop">Live Balloon Pop</SelectItem>
                <SelectItem value="instant_cash">Instant Cash Wins</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Optional presentation style for the giveaway card
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reveal_type">Ticket reveal style</Label>
            <Select
              value={formData.reveal_type ?? "normal"}
              onValueChange={(value) => handleChange("reveal_type", value)}
            >
              <SelectTrigger id="reveal_type">
                <SelectValue placeholder="Select reveal style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="scratch_card">Scratch Card</SelectItem>
                <SelectItem value="treasure_chest">Treasure Chest</SelectItem>
                <SelectItem value="dg_football">DG Football</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Changes only how customers reveal their confirmed result. It does not affect ticket allocation or winning logic.
            </p>
          </div>

          {/* End-prize draw mode. Controls ONLY the main winner
              (winner_records.placed = 1) - never instant wins. */}
          <div className="space-y-3 pt-4 border-t">
            <Label>End Prize Draw</Label>
            <RadioGroup
              value={formData.end_draw_mode ?? 'automatic'}
              onValueChange={(value) => handleChange('end_draw_mode', value)}
              className="gap-3"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="automatic" id="end_draw_mode_automatic" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="end_draw_mode_automatic" className="font-medium">
                    Automatic Draw
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically select the end-prize winner when the competition finishes or sells
                    out.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="manual" id="end_draw_mode_manual" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="end_draw_mode_manual" className="font-medium">
                    Manual Draw
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Close the competition without selecting the end-prize winner. An admin must draw
                    the winner afterwards.
                  </p>
                </div>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              Applies to the main end prize only. Instant wins are unaffected.
            </p>
          </div>

          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_free_entry"
                checked={formData.is_free_entry ?? false}
                onCheckedChange={(checked) => handleChange("is_free_entry", checked === true ? true : false)}
              />
              <Label htmlFor="is_free_entry" className="font-medium">
                Free Entry Competition
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              When enabled, users can enter without payment (subject to limit below)
            </p>

            {formData.is_free_entry && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="free_entry_limit_per_user">Free Entry Limit Per User</Label>
                <Input
                  id="free_entry_limit_per_user"
                  type="number"
                  min={1}
                  value={formData.free_entry_limit_per_user ?? 1}
                  onChange={(e) => handleChange("free_entry_limit_per_user", Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum free entries each user can claim
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="startAt">Start Date & Time</Label>
            <Input
              id="startAt"
              type="datetime-local"
              value={formData.startAt.slice(0, 16)}
              onChange={(e) => handleChange("startAt", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="endAt">End Date & Time</Label>
            <Input
              id="endAt"
              type="datetime-local"
              value={formData.endAt.slice(0, 16)}
              onChange={(e) => handleChange("endAt", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Main prize draw happens at end date
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Main Prize</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mainPrizeTitle">Prize Title</Label>
            <Input
              id="mainPrizeTitle"
              value={formData.mainPrizeTitle}
              onChange={(e) => handleChange("mainPrizeTitle", e.target.value)}
              placeholder="iPhone 15 Pro 256GB"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mainPrizeDescription">Prize Description</Label>
            <Textarea
              id="mainPrizeDescription"
              value={formData.mainPrizeDescription}
              onChange={(e) =>
                handleChange("mainPrizeDescription", e.target.value)
              }
              placeholder="Latest model in Titanium Blue"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="summary">Summary</Label>
            <Input
              id="summary"
              value={formData.summary}
              onChange={(e) => handleChange("summary", e.target.value)}
              placeholder="Short marketing line"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange("description", e.target.value)}
              placeholder="Longer campaign details"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Hero Image</Label>

            {formData.heroImageUrl && (
              <div className="flex items-start gap-3">
                <Image
                  src={formData.heroImageUrl}
                  alt="Hero preview"
                  width={160}
                  height={100}
                  className="rounded-md border object-cover"
                  unoptimized
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleChange('heroImageUrl', '')}
                >
                  Remove
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                onChange={(e) => {
                  setUploadError(null)
                  const file = e.target.files?.[0] ?? null
                  if (file) {
                    const validation = validateImageFile(file)
                    if (!validation.ok) {
                      setUploadError(validation.error)
                      setSelectedFile(null)
                      e.target.value = ''
                      return
                    }
                  }
                  setSelectedFile(file)
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={!selectedFile || isUploading}
                onClick={handleUpload}
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </Button>
            </div>

            {isUploading && (
              <p className="text-xs text-muted-foreground">Uploading image...</p>
            )}
            {uploadError && (
              <p className="text-xs text-destructive">{uploadError}</p>
            )}
          </div>

          {/* Promotional video (Video Phase 1) — optional enhancement layered
              over the required artwork on the Featured Hero and competition
              page. The artwork above always remains the poster/fallback. */}
          <div className="space-y-2 rounded-lg border border-dashed p-4">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Label className="m-0">Promotional Video</Label>
              <span className="text-xs font-normal text-muted-foreground">Optional</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Short promotional clip for the Featured Hero and competition page.
              The campaign image is always shown first and remains the fallback.
            </p>

            {formData.promoVideoUrl ? (
              <div className="space-y-2">
                <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-md border bg-black">
                  {/* Admin preview only: muted, native controls, no autoplay. */}
                  <video
                    key={formData.promoVideoUrl}
                    src={formData.promoVideoUrl}
                    poster={formData.heroImageUrl || undefined}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                  />
                </div>
                {formData.promoVideoDurationS ? (
                  <p className="text-xs text-muted-foreground">
                    Current video · ~{formData.promoVideoDurationS}s
                  </p>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={isVideoUploading || isValidatingVideo}
                  >
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveVideo}
                    disabled={isVideoUploading}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Input
                ref={videoInputRef}
                type="file"
                accept={VIDEO_ACCEPT_ATTR}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  void handleVideoSelect(file)
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={!selectedVideoFile || isVideoUploading || isValidatingVideo}
                onClick={handleVideoUpload}
              >
                {isVideoUploading ? 'Uploading...' : 'Upload video'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">MP4 · max 4 MB · max 15 sec · 720p</p>

            {isValidatingVideo && (
              <p className="text-xs text-muted-foreground">Checking video…</p>
            )}
            {videoInfo && !isValidatingVideo && (
              <p className="text-xs text-muted-foreground">
                {videoInfo.name} · {(videoInfo.size / (1024 * 1024)).toFixed(1)} MB ·{' '}
                {videoInfo.durationS.toFixed(1)}s · {videoInfo.width}×{videoInfo.height}
              </p>
            )}
            {isVideoUploading && (
              <p className="text-xs text-muted-foreground">Uploading video…</p>
            )}
            {videoError && <p className="text-xs text-destructive">{videoError}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tickets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ticketPricePence">Ticket Price (pence)</Label>
            <Input
              id="ticketPricePence"
              type="number"
              value={formData.ticketPricePence}
              onChange={(e) =>
                handleChange("ticketPricePence", Number(e.target.value))
              }
              placeholder="99"
            />
            <p className="text-xs text-muted-foreground">
              Price in pence (e.g., 99 = £0.99)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wasPricePence">Was price / crossed-out price (pence)</Label>
            <Input
              id="wasPricePence"
              type="number"
              value={formData.wasPricePence ?? ""}
              onChange={(e) =>
                handleChange("wasPricePence", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="Leave empty for no sale display"
            />
            <p className="text-xs text-muted-foreground">
              Display only. Checkout still charges the main ticket price.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxTicketsTotal">Max Tickets Total (optional)</Label>
            <Input
              id="maxTicketsTotal"
              type="number"
              value={formData.maxTicketsTotal ?? ""}
              onChange={(e) =>
                handleChange(
                  "maxTicketsTotal",
                  e.target.value ? Number(e.target.value) : null
                )
              }
              placeholder="Leave empty for unlimited"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxTicketsPerUser">Max Tickets Per User (optional)</Label>
            <Input
              id="maxTicketsPerUser"
              type="number"
              value={formData.maxTicketsPerUser ?? ""}
              onChange={(e) =>
                handleChange(
                  "maxTicketsPerUser",
                  e.target.value ? Number(e.target.value) : null
                )
              }
              placeholder="Leave empty for unlimited"
            />
          </div>
        </CardContent>
      </Card>

      {/* Bundle Offers Section */}
      <Card>
        <CardHeader>
          <CardTitle>Bundle Offers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Optional discounted ticket bundles shown on the raffle page.
          </p>

          {(formData.bundles ?? []).length > 0 && (
            <div className="space-y-3">
              {(formData.bundles ?? []).map((bundle, index) => (
                <div key={index} className="flex flex-wrap items-end gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={bundle.quantity}
                      onChange={(e) => {
                        const newBundles = [...(formData.bundles ?? [])]
                        newBundles[index] = { ...newBundles[index], quantity: Number(e.target.value) }
                        setFormData((prev) => ({ ...prev, bundles: newBundles }))
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Price (pence)</Label>
                    <Input
                      type="number"
                      min={0}
                      className="w-28"
                      value={bundle.price_pence}
                      onChange={(e) => {
                        const newBundles = [...(formData.bundles ?? [])]
                        newBundles[index] = { ...newBundles[index], price_pence: Number(e.target.value) }
                        setFormData((prev) => ({ ...prev, bundles: newBundles }))
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-[120px] space-y-1">
                    <Label className="text-xs">Label (optional)</Label>
                    <Input
                      value={bundle.label ?? ''}
                      placeholder="e.g. Best Value"
                      onChange={(e) => {
                        const newBundles = [...(formData.bundles ?? [])]
                        newBundles[index] = { ...newBundles[index], label: e.target.value || undefined }
                        setFormData((prev) => ({ ...prev, bundles: newBundles }))
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      const newBundles = (formData.bundles ?? []).filter((_, i) => i !== index)
                      setFormData((prev) => ({ ...prev, bundles: newBundles.length > 0 ? newBundles : null }))
                    }}
                    title="Remove bundle"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const newBundle = { quantity: 1, price_pence: 0, label: '' }
              setFormData((prev) => ({
                ...prev,
                bundles: [...(prev.bundles ?? []), newBundle],
              }))
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Bundle
          </Button>
        </CardContent>
      </Card>

      {/* Instant Wins Section */}
      <Card>
        <CardHeader>
          <CardTitle>Instant Wins</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Each prize has an explicit fulfilment type and an authoritative amount. Quantity is the number of
            independent, individually winnable positions and is updated with its own &quot;Update quantity&quot; action.
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400">
            The main &quot;Save Changes&quot; button saves edited prize details automatically. Quantity changes are
            applied separately.
          </p>

          {!campaignId ? (
            <p className="text-sm text-muted-foreground italic">
              Save campaign first to add instant wins.
            </p>
          ) : (
            <>
              {/* Add single */}
              <Button type="button" variant="outline" size="sm" onClick={handleAddPrize}>
                <Plus className="mr-1 h-4 w-4" />
                Add Instant Win
              </Button>

              {iwLoading && <p className="text-sm text-muted-foreground">Loading instant wins...</p>}

              {iwError && <p className="text-sm text-destructive">{iwError}</p>}

              {/* Prize list */}
              {instantWins.length > 0 && (
                <div className="space-y-3">
                  {instantWins.map((prize) => (
                    <div key={prize.id} className={`rounded-md border p-3 space-y-3 ${isPrizeDirty(prize) ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
                      <div className="flex flex-wrap items-start gap-3">
                        {/* Thumbnail with saved indicator */}
                        {prize.image_url && (
                          <div className="flex flex-col items-center gap-1">
                            <Image
                              src={prize.image_url}
                              alt={prize.prize_title}
                              width={48}
                              height={48}
                              className="rounded border object-cover"
                              unoptimized
                            />
                            <span className="text-xs text-green-600 dark:text-green-400 font-medium">Image saved</span>
                            <a
                              href={prize.image_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Open image
                            </a>
                          </div>
                        )}

                        <div className="flex-1 space-y-2 min-w-[200px]">
                          <div className="flex flex-wrap gap-2">
                            <div className="flex-1 min-w-[150px] space-y-1">
                              <Label className="text-xs">Prize Title</Label>
                              <Input
                                value={prize.prize_title}
                                onChange={(e) =>
                                  handlePrizeFieldChange(prize.id, 'prize_title', e.target.value)
                                }
                                placeholder="Prize title"
                              />
                            </div>
                            <div className="w-28 space-y-1">
                              <Label className="text-xs">Prize amount (£)</Label>
                              <Input
                                inputMode="decimal"
                                value={amountInputs[prize.id] ?? ''}
                                onChange={(e) =>
                                  setAmountInputs((prev) => ({ ...prev, [prize.id]: e.target.value }))
                                }
                                placeholder="e.g. 500 or 500.50"
                              />
                            </div>
                            <div className="w-36 space-y-1">
                              <Label className="text-xs">Fulfilment type</Label>
                              <Select
                                value={prize.fulfilment_type}
                                onValueChange={(v) =>
                                  handlePrizeFieldChange(prize.id, 'fulfilment_type', v as InstantWinFulfilmentType)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cash">Cash</SelectItem>
                                  <SelectItem value="wallet_credit">WTF Credit</SelectItem>
                                  <SelectItem value="manual">Manual</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-40 space-y-1">
                              <Label className="text-xs">Optional display text</Label>
                              <Input
                                value={prize.prize_value_text || ''}
                                onChange={(e) =>
                                  handlePrizeFieldChange(prize.id, 'prize_value_text', e.target.value || null)
                                }
                                placeholder="e.g. Added instantly"
                              />
                            </div>
                            <div className="flex items-center gap-2 pt-5">
                              <Checkbox
                                id={`high-value-${prize.id}`}
                                checked={prize.is_high_value}
                                onCheckedChange={(checked) =>
                                  handlePrizeFieldChange(prize.id, 'is_high_value', checked === true)
                                }
                              />
                              <Label htmlFor={`high-value-${prize.id}`} className="text-xs font-medium cursor-pointer">
                                High Value
                              </Label>
                            </div>
                          </div>

                          {/* Summary badges */}
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded bg-muted px-2 py-0.5 font-medium">
                              {penceToDisplay(prize.prize_value_pence)}
                            </span>
                            <span
                              className={`rounded px-2 py-0.5 font-medium ${
                                prize.fulfilment_type === 'wallet_credit'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : prize.fulfilment_type === 'cash'
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                              }`}
                            >
                              {prize.fulfilment_type === 'wallet_credit'
                                ? 'WTF Credit'
                                : prize.fulfilment_type === 'cash'
                                  ? 'Cash'
                                  : 'Manual fulfilment'}
                            </span>
                            <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                              {`Qty ${prize.quantity}`}
                            </span>
                            {prize.is_high_value && (
                              <span className="rounded bg-purple-100 px-2 py-0.5 font-medium text-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                                High value
                              </span>
                            )}
                          </div>

                          {prize.fulfilment_type === 'wallet_credit' && (
                            <p className="text-xs text-emerald-700 dark:text-emerald-400">
                              This amount will be added automatically to the winner&apos;s WTF Credit balance.
                            </p>
                          )}

                          {/* Quantity (reconciled separately from prize details) */}
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="w-24 space-y-1">
                                <Label className="text-xs">Quantity</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={formData.maxTicketsTotal ?? undefined}
                                  value={qtyInputs[prize.id] ?? String(prize.quantity)}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setQtyInputs((prev) => ({ ...prev, [prize.id]: v }))
                                    // Clear any prior inline error as the admin edits.
                                    setQtyError((prev) => (prev[prize.id] ? { ...prev, [prize.id]: null } : prev))
                                  }}
                                  aria-invalid={qtyError[prize.id] ? true : undefined}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!!qtySaving[prize.id] || !isQuantityDirty(prize)}
                                onClick={() => handleUpdateQuantity(prize)}
                              >
                                {qtySaving[prize.id] ? 'Updating…' : 'Update quantity'}
                              </Button>
                              {isQuantityDirty(prize) && !qtyError[prize.id] && (
                                <span className="text-xs text-amber-600 dark:text-amber-400 self-center">
                                  Unsaved quantity
                                </span>
                              )}
                            </div>
                            {formData.maxTicketsTotal != null && (
                              <p className="text-xs text-muted-foreground">
                                Max {formData.maxTicketsTotal.toLocaleString('en-GB')} (campaign ticket capacity)
                              </p>
                            )}
                            {qtyError[prize.id] && (
                              <p className="text-xs font-medium text-destructive" role="alert">
                                {qtyError[prize.id]}
                              </p>
                            )}
                          </div>

                          {/* Image upload */}
                          <div className="flex items-center gap-2">
                            <Input
                              type="file"
                              accept={IMAGE_ACCEPT_ATTR}
                              className="max-w-xs text-xs"
                              disabled={iwUploadingId === prize.id}
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handlePrizeImageUpload(prize, file)
                              }}
                            />
                            {iwUploadingId === prize.id && (
                              <span className="text-xs text-muted-foreground">Uploading...</span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col items-end gap-1 pt-5">
                          {isPrizeDirty(prize) && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Unsaved</span>
                          )}
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={!!iwSaving[prize.id]}
                              onClick={() => handleSavePrize(prize)}
                              title="Save prize"
                            >
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => handleDeletePrize(prize.id)}
                              title="Delete prize"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!iwLoading && instantWins.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                  No instant wins yet. Add one or use Quick Add.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hosts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Assign one or more hosts and their commission percentage of external cash collected
            (excludes site/WTF credit). Optional — a campaign can have no hosts.
          </p>

          {hostsError && <p className="text-sm text-destructive">{hostsError}</p>}

          {hostsLoading ? (
            <p className="text-sm text-muted-foreground">Loading hosts…</p>
          ) : hostOptions.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No enabled hosts available. Add hosts under Team Access first.
            </p>
          ) : (
            <>
              {hostRows.length > 0 && (
                <div className="space-y-3">
                  {hostRows.map((row, index) => {
                    const available = hostOptions.filter(
                      (o) => o.user_id === row.host_user_id || !selectedHostIds.has(o.user_id),
                    )
                    return (
                      <div
                        key={index}
                        className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <Label className="text-xs">Host</Label>
                          <Select
                            value={row.host_user_id}
                            onValueChange={(v) => setHostRowUser(index, v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select host" />
                            </SelectTrigger>
                            <SelectContent>
                              {available.map((o) => (
                                <SelectItem key={o.user_id} value={o.user_id}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-full space-y-1 sm:w-32">
                          <Label className="text-xs">Commission %</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step="0.01"
                            value={row.commission_pct}
                            onChange={(e) => setHostRowPct(index, e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="self-end"
                          onClick={() => removeHostRow(index)}
                          title="Remove host"
                          aria-label="Remove host"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addHostRow}
                  disabled={addHostDisabled}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add host
                </Button>
                {hostRows.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    Total host commission:{" "}
                    <span className="font-medium text-foreground">
                      {formatPct(totalHostCommission)}%
                    </span>
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {saveError && (
        <p className="text-sm text-destructive">{saveError}</p>
      )}

      <div className="flex items-center gap-4">
        <Button disabled={isSaving || isUploading} onClick={handleSave}>
          {isSaving ? 'Saving...' : isNew ? 'Create Campaign' : 'Save Changes'}
        </Button>
        <Button asChild variant="outline" className="bg-transparent">
          <Link href="/admin/campaigns">Cancel</Link>
        </Button>
      </div>
    </div>
  )
}
