/**
 * Shared client-side image upload validation for admin media flows
 * (campaign hero, instant-win prize photos, Big Win winner photos).
 *
 * This is a PRE-UPLOAD gate only: it bounds what an admin can push into
 * Supabase Storage. It does NOT re-encode or compress — the source master is
 * stored as-is and appropriately-sized variants are produced at delivery time
 * by the Next Image optimizer (see next.config.mjs). Keeping a reasonable
 * source cap here protects storage/bandwidth without harming customers, whose
 * delivered bytes are decoupled from the source-file size.
 */

/**
 * Accepted source image formats. Deliberately limited to the three formats
 * that render reliably everywhere AND are handled by the Next optimizer.
 * SVG is intentionally excluded (script-injection risk); HEIC/AVIF/GIF are
 * excluded because they either fail to render or optimize inconsistently.
 */
export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export const ACCEPTED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const

/** `accept` attribute value for the native file picker (UX filter, not a gate). */
export const IMAGE_ACCEPT_ATTR = "image/jpeg,image/png,image/webp"

/**
 * Hard cap on the source file an admin may upload. 8 MB is generous enough to
 * retain a high-quality master for multiple rendered surfaces while blocking
 * unnecessary multi-MB camera originals. Because delivery is now optimized
 * independently of the source, this cap only bounds storage — not customer
 * download size. Adjust here if real WTF creative is evidenced to exceed it.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_UPLOAD_LABEL = "8 MB"

/** Human-readable byte size, e.g. 2.4 MB / 812 KB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type ImageValidation = { ok: true } | { ok: false; error: string }

/**
 * Validate a chosen image file before upload. MIME type is the primary gate;
 * the extension is a secondary sanity check (rejects a renamed non-image).
 */
export function validateImageFile(file: File | null | undefined): ImageValidation {
  if (!file) return { ok: false, error: "No file selected." }

  const type = (file.type || "").toLowerCase()
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : ""

  if (!ACCEPTED_IMAGE_MIME_TYPES.includes(type as (typeof ACCEPTED_IMAGE_MIME_TYPES)[number])) {
    return { ok: false, error: "Unsupported file type. Please upload a JPEG, PNG or WebP image." }
  }

  if (ext && !ACCEPTED_IMAGE_EXTENSIONS.includes(ext as (typeof ACCEPTED_IMAGE_EXTENSIONS)[number])) {
    return { ok: false, error: `Unexpected file extension ".${ext}". Please use a .jpg, .png or .webp image.` }
  }

  if (file.size === 0) {
    return { ok: false, error: "This file appears to be empty." }
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Image is too large (${formatBytes(file.size)}). The maximum is ${MAX_IMAGE_UPLOAD_LABEL}.`,
    }
  }

  return { ok: true }
}
