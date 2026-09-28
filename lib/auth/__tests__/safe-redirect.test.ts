import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '../safe-redirect'

describe('safeInternalPath', () => {
  it('accepts a simple internal path', () => {
    expect(safeInternalPath('/me')).toBe('/me')
  })

  it('accepts an internal path with query string', () => {
    const p = '/checkout/review?campaign=abc&qty=2'
    expect(safeInternalPath(p)).toBe(p)
  })

  it('rejects an absolute http(s) URL', () => {
    expect(safeInternalPath('https://example.com')).toBeNull()
    expect(safeInternalPath('http://example.com/path')).toBeNull()
  })

  it('rejects a protocol-relative URL (//host)', () => {
    expect(safeInternalPath('//example.com')).toBeNull()
    expect(safeInternalPath('//example.com/checkout')).toBeNull()
  })

  it('rejects a backslash protocol-relative trick (/\\host)', () => {
    expect(safeInternalPath('/\\example.com')).toBeNull()
  })

  it('rejects paths that do not start with a slash', () => {
    expect(safeInternalPath('me')).toBeNull()
    expect(safeInternalPath('javascript:alert(1)')).toBeNull()
    expect(safeInternalPath('mailto:x@y.com')).toBeNull()
  })

  it('rejects empty / nullish values', () => {
    expect(safeInternalPath('')).toBeNull()
    expect(safeInternalPath(null)).toBeNull()
    expect(safeInternalPath(undefined)).toBeNull()
  })
})
