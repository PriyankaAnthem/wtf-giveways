import { describe, it, expect } from 'vitest'
import {
  validateVideoFile,
  isWithin720pEnvelope,
  VIDEO_MAX_BYTES,
} from '@/lib/media/video-upload'

/**
 * Locks the synchronous, DOM-free promo-video gates (file type/extension/size)
 * and the 720p resolution envelope used by the metadata validator. The
 * duration and resolution *metadata* gate itself needs a real <video> element
 * (browser) and is exercised in the admin UI; here we cover every pure branch.
 */

// Minimal structural File stand-in (validateVideoFile only reads name/type/size).
function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as unknown as File
}

const MB = 1024 * 1024

describe('validateVideoFile', () => {
  it('accepts a valid MP4 under 4 MB', () => {
    expect(validateVideoFile(fakeFile('clip.mp4', 'video/mp4', 2 * MB))).toEqual({ ok: true })
  })

  it('accepts a file exactly at the 4 MB limit', () => {
    expect(validateVideoFile(fakeFile('clip.mp4', 'video/mp4', VIDEO_MAX_BYTES))).toEqual({ ok: true })
  })

  it('rejects a file larger than 4 MB', () => {
    const res = validateVideoFile(fakeFile('big.mp4', 'video/mp4', 5 * MB))
    expect(res.ok).toBe(false)
  })

  it('rejects an empty file', () => {
    const res = validateVideoFile(fakeFile('empty.mp4', 'video/mp4', 0))
    expect(res.ok).toBe(false)
  })

  it('rejects a MOV file', () => {
    const res = validateVideoFile(fakeFile('clip.mov', 'video/quicktime', 1 * MB))
    expect(res.ok).toBe(false)
  })

  it('rejects a WebM file', () => {
    const res = validateVideoFile(fakeFile('clip.webm', 'video/webm', 1 * MB))
    expect(res.ok).toBe(false)
  })

  it('rejects an mp4 extension with a non-mp4 MIME type', () => {
    const res = validateVideoFile(fakeFile('clip.mp4', 'video/webm', 1 * MB))
    expect(res.ok).toBe(false)
  })

  it('rejects an mp4 MIME with a non-mp4 extension', () => {
    const res = validateVideoFile(fakeFile('clip.mov', 'video/mp4', 1 * MB))
    expect(res.ok).toBe(false)
  })

  it('rejects an image masquerading by MIME', () => {
    const res = validateVideoFile(fakeFile('pic.png', 'image/png', 1 * MB))
    expect(res.ok).toBe(false)
  })

  it('rejects null / missing file', () => {
    expect(validateVideoFile(null).ok).toBe(false)
    expect(validateVideoFile(undefined).ok).toBe(false)
  })
})

describe('isWithin720pEnvelope', () => {
  it('accepts standard 1280x720 landscape', () => {
    expect(isWithin720pEnvelope(1280, 720)).toBe(true)
  })

  it('accepts 720x1280 portrait', () => {
    expect(isWithin720pEnvelope(720, 1280)).toBe(true)
  })

  it('accepts smaller resolutions', () => {
    expect(isWithin720pEnvelope(640, 360)).toBe(true)
  })

  it('rejects 1080p', () => {
    expect(isWithin720pEnvelope(1920, 1080)).toBe(false)
  })

  it('rejects 4K', () => {
    expect(isWithin720pEnvelope(3840, 2160)).toBe(false)
  })

  it('is permissive when dimensions are unknown (some browsers omit them)', () => {
    expect(isWithin720pEnvelope(0, 0)).toBe(true)
    expect(isWithin720pEnvelope(Number.NaN, Number.NaN)).toBe(true)
  })
})
