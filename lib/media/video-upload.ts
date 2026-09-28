/**
 * Shared promotional-video validation for the campaign admin (Video Phase 1).
 *
 * Two layers, both required before an upload is allowed:
 *   1. `validateVideoFile` — synchronous, cheap file-level checks (existence,
 *      MIME, extension, non-empty, size). Safe on the server too (no DOM).
 *   2. `validateVideoMetadata` — browser-only. Loads the file locally through a
 *      temporary <video> + object URL to read genuine duration/resolution and
 *      reject clips that are too long or exceed the 720p envelope.
 *
 * HONEST CODEC LIMITATION: MIME + extension cannot prove the container is
 * H.264. We require MP4, tell admins to export H.264, and rely on the mandatory
 * artwork fallback if a specific clip fails to decode in a viewer's browser.
 * We deliberately add NO heavy codec-inspection library and NO server ffmpeg.
 */

/** Hard maximum file size: 4 MB. */
export const VIDEO_MAX_BYTES = 4 * 1024 * 1024
/** Hard maximum duration: 15 seconds (preferred 6–10s). */
export const VIDEO_MAX_DURATION_S = 15
/** 720p envelope: long edge ≤ 1280, short edge ≤ 720 (landscape or portrait). */
export const VIDEO_MAX_LONG_EDGE = 1280
export const VIDEO_MAX_SHORT_EDGE = 720
/** File picker accept attribute. */
export const VIDEO_ACCEPT_ATTR = 'video/mp4,.mp4'

export type VideoFileCheck = { ok: true } | { ok: false; error: string }

export interface VideoMetadata {
  durationS: number
  width: number
  height: number
}

export type VideoMetaCheck =
  | { ok: true; metadata: VideoMetadata }
  | { ok: false; error: string }

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Synchronous file-level validation. No DOM access, so this is safe to call
 * from either the browser or a server route as a first gate.
 */
export function validateVideoFile(file: File | null | undefined): VideoFileCheck {
  if (!file) return { ok: false, error: 'No file selected.' }

  const name = typeof file.name === 'string' ? file.name : ''
  const isMp4Ext = /\.mp4$/i.test(name)
  const isMp4Mime = file.type === 'video/mp4'

  // Require BOTH an mp4 extension and an mp4 MIME. Anything else (MOV, WebM,
  // GIF-as-video, arbitrary blobs) is rejected up front.
  if (!isMp4Mime || !isMp4Ext) {
    return {
      ok: false,
      error: 'Video must be an MP4 (.mp4, video/mp4). Export as H.264 MP4 and try again.',
    }
  }

  if (file.size <= 0) {
    return { ok: false, error: 'The selected file is empty.' }
  }

  if (file.size > VIDEO_MAX_BYTES) {
    return {
      ok: false,
      error: `Video is ${formatMb(file.size)} — the maximum is ${formatMb(VIDEO_MAX_BYTES)}. Compress it or shorten it and try again.`,
    }
  }

  return { ok: true }
}

/** True when (w,h) fits the accepted 720p envelope in either orientation. */
export function isWithin720pEnvelope(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    // Unknown dimensions: do not hard-reject here (some browsers omit them);
    // the file/duration gates plus admin preview still apply.
    return true
  }
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  // Small tolerance so a nominal 1280×720 export that reports 1281 still passes.
  return longEdge <= VIDEO_MAX_LONG_EDGE + 2 && shortEdge <= VIDEO_MAX_SHORT_EDGE + 2
}

/**
 * Browser-only metadata validation. Loads the file locally (never uploads) via
 * an object URL and a detached <video> element, reads duration + intrinsic
 * dimensions, and always revokes the object URL before resolving.
 */
export function validateVideoMetadata(file: File): Promise<VideoMetaCheck> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      // No DOM (server) — skip metadata gate; callers still run validateVideoFile.
      resolve({ ok: false, error: 'Video metadata can only be validated in the browser.' })
      return
    }

    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false

    const cleanup = () => {
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        /* no-op */
      }
      URL.revokeObjectURL(url)
    }

    const finish = (result: VideoMetaCheck) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    // Guard against a file that never fires loadedmetadata (corrupt/unsupported).
    const timeout = setTimeout(() => {
      finish({
        ok: false,
        error: 'Could not read this video. Make sure it is a standard H.264 MP4.',
      })
    }, 15000)

    video.preload = 'metadata'
    video.muted = true

    video.onloadedmetadata = () => {
      clearTimeout(timeout)
      const durationS = Number(video.duration)
      const width = Number(video.videoWidth)
      const height = Number(video.videoHeight)

      if (!Number.isFinite(durationS) || durationS <= 0) {
        finish({ ok: false, error: 'Could not read the video duration. Re-export as MP4 and try again.' })
        return
      }

      if (durationS > VIDEO_MAX_DURATION_S) {
        finish({
          ok: false,
          error: `Video is ${durationS.toFixed(1)}s — the maximum is ${VIDEO_MAX_DURATION_S}s (aim for 6–10s).`,
        })
        return
      }

      if (!isWithin720pEnvelope(width, height)) {
        finish({
          ok: false,
          error: `Video is ${width}×${height} — the maximum is 720p (1280×720 landscape or 720×1280 portrait). Re-export at 720p.`,
        })
        return
      }

      finish({ ok: true, metadata: { durationS, width, height } })
    }

    video.onerror = () => {
      clearTimeout(timeout)
      finish({
        ok: false,
        error: 'This file could not be decoded as MP4/H.264. Re-export as H.264 MP4 and try again.',
      })
    }

    video.src = url
  })
}
