/**
 * Safe, reusable deletion of OUR managed Supabase Storage objects.
 *
 * The audit found that replacing media leaves the previous object behind as a
 * permanent orphan. This helper lets a replacement flow remove the old object
 * — but ONLY after positively proving the URL belongs to one of our own
 * managed public buckets on this project's Supabase host. Anything it cannot
 * positively identify (external/legacy/malformed URL) is left untouched.
 *
 * It NEVER throws: deletion is best-effort cleanup and must never break the
 * surrounding save flow. Callers should delete the old object only AFTER the
 * new URL has been successfully persisted (read-your-writes), so a failed
 * persist can never strand the still-referenced working image.
 *
 * IMPORTANT: images that are propagated through `giveaway_snapshots`
 * (campaign hero, instant-win prize photos) must NOT be deleted immediately on
 * replace — cached snapshots keep referencing the old object until the next
 * refresh. Only call this for surfaces that read live from the source table
 * (e.g. Big Wins on the dynamic /winners page).
 */

/** Public buckets this app owns and is therefore allowed to delete from. */
export const MANAGED_BUCKETS = ["campaign-hero", "instant-win-prizes", "big-wins", "campaign-video"] as const
export type ManagedBucket = (typeof MANAGED_BUCKETS)[number]

/** Structural type covering the browser Supabase client's storage remove API. */
type StorageRemoveClient = {
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>
    }
  }
}

/**
 * Parse a Supabase public Storage URL into { bucket, path }, returning null
 * unless it is unmistakably one of our managed objects on this project's host.
 */
export function parseManagedStorageUrl(
  url: string | null | undefined,
): { bucket: ManagedBucket; path: string } | null {
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== "https:") return null

  // Confine deletion to THIS project's Supabase host. Fall back to the
  // *.supabase.co family only when the env host cannot be resolved.
  let expectedHost: string | null = null
  try {
    expectedHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null
  } catch {
    expectedHost = null
  }
  if (expectedHost) {
    if (parsed.hostname !== expectedHost) return null
  } else if (!parsed.hostname.endsWith(".supabase.co")) {
    return null
  }

  const prefix = "/storage/v1/object/public/"
  if (!parsed.pathname.startsWith(prefix)) return null

  const rest = parsed.pathname.slice(prefix.length)
  const slash = rest.indexOf("/")
  if (slash <= 0) return null

  const bucket = decodeURIComponent(rest.slice(0, slash))
  const path = decodeURIComponent(rest.slice(slash + 1))
  if (!path) return null
  if (!MANAGED_BUCKETS.includes(bucket as ManagedBucket)) return null

  return { bucket: bucket as ManagedBucket, path }
}

export type CleanupResult = { removed: boolean; reason?: string }

/**
 * Best-effort delete of the object referenced by `url`. No-op (never throws)
 * for anything that is not a positively-identified managed object, or that is
 * not in `allowedBuckets` when that guard is provided.
 */
export async function deleteManagedObjectByUrl(
  supabase: StorageRemoveClient,
  url: string | null | undefined,
  opts?: { allowedBuckets?: readonly ManagedBucket[] },
): Promise<CleanupResult> {
  const parsed = parseManagedStorageUrl(url)
  if (!parsed) return { removed: false, reason: "not-managed" }

  if (opts?.allowedBuckets && !opts.allowedBuckets.includes(parsed.bucket)) {
    return { removed: false, reason: "bucket-not-allowed" }
  }

  try {
    const { error } = await supabase.storage.from(parsed.bucket).remove([parsed.path])
    if (error) return { removed: false, reason: error.message }
    return { removed: true }
  } catch (err) {
    return { removed: false, reason: err instanceof Error ? err.message : "remove-failed" }
  }
}
