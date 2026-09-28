import { describe, it, expect } from 'vitest'
import {
  ALLOWED_PLACEHOLDERS,
  extractPlaceholders,
  findUnknownPlaceholders,
  isAllowedPlaceholder,
  substitutePlaceholders,
  escapeHtml,
  PLACEHOLDER_PREVIEW_SAMPLE,
} from '@/lib/admin/marketing/placeholders'

describe('marketing placeholder engine', () => {
  it('exposes a fixed allowlist and recognises only those tokens', () => {
    expect([...ALLOWED_PLACEHOLDERS].sort()).toEqual(
      ['campaign_title', 'campaign_url', 'credit_balance', 'discount_code', 'first_name', 'unsubscribe_url'].sort(),
    )
    expect(isAllowedPlaceholder('first_name')).toBe(true)
    expect(isAllowedPlaceholder('evil')).toBe(false)
  })

  it('extracts every token in order', () => {
    expect(extractPlaceholders('Hi {{first_name}}, see {{campaign_title}}')).toEqual([
      'first_name',
      'campaign_title',
    ])
    expect(extractPlaceholders('no tokens')).toEqual([])
    expect(extractPlaceholders(null)).toEqual([])
  })

  it('flags unknown and empty tokens, de-duplicated and sorted', () => {
    expect(findUnknownPlaceholders(['{{first_name}} {{oops}} {{oops}} {{}}'])).toEqual([
      '(empty)',
      'oops',
    ])
    expect(findUnknownPlaceholders(['{{first_name}} {{campaign_url}}'])).toEqual([])
  })

  it('substitutes allowed tokens and leaves unknown tokens untouched', () => {
    const out = substitutePlaceholders('Hi {{first_name}} {{oops}}', { first_name: 'Sam' }, false)
    expect(out).toBe('Hi Sam {{oops}}')
  })

  it('HTML-escapes substituted values when escape=true (default)', () => {
    const out = substitutePlaceholders('Hi {{first_name}}', {
      first_name: '<script>alert(1)</script>',
    })
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapeHtml neutralises every dangerous character', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('preview sample provides a value for every allowed placeholder', () => {
    for (const key of ALLOWED_PLACEHOLDERS) {
      expect(PLACEHOLDER_PREVIEW_SAMPLE[key], key).toBeTruthy()
    }
  })
})
