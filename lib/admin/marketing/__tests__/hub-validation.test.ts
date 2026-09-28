import { describe, it, expect } from 'vitest'
import {
  AUTOMATION_KEYS,
  PROMOTION_TYPES,
  ADMIN_PROMOTION_STATUSES,
  validateAutomationUpdate,
  validateTemplateInput,
  templateContentChanged,
  validatePromotionCreate,
  validatePromotionUpdate,
  validateControlUpdate,
} from '@/lib/admin/marketing/hub-validation'

const UUID = '11111111-1111-1111-1111-111111111111'
const UUID2 = '22222222-2222-2222-2222-222222222222'

describe('automation update validation', () => {
  const base = {
    automationKey: 'abandoned_checkout',
    enabled: false,
    templateId: null,
    firstDelayMinutes: 45,
    followUpDelayMinutes: 1200,
    cooldownHours: 168,
    minimumWalletPence: null,
    discountCodeId: null,
    maximumRecipientsPerRun: 200,
  }

  it('accepts a valid disabled update with no template', () => {
    const r = validateAutomationUpdate({ ...base })
    expect(r.ok).toBe(true)
  })

  it('rejects enabling without a template (safety rule)', () => {
    const r = validateAutomationUpdate({ ...base, enabled: true, templateId: null })
    expect(r).toEqual({ ok: false, error: 'template_required_to_enable' })
  })

  it('allows enabling when a template is assigned', () => {
    const r = validateAutomationUpdate({ ...base, enabled: true, templateId: UUID })
    expect(r.ok).toBe(true)
  })

  it('rejects an unknown automation key', () => {
    const r = validateAutomationUpdate({ ...base, automationKey: 'nope' })
    expect(r).toEqual({ ok: false, error: 'invalid_automation_key' })
  })

  it('rejects out-of-range maximum recipients', () => {
    expect(validateAutomationUpdate({ ...base, maximumRecipientsPerRun: 0 }).ok).toBe(false)
    expect(validateAutomationUpdate({ ...base, maximumRecipientsPerRun: 100001 }).ok).toBe(false)
  })

  it('rejects negative delays', () => {
    expect(validateAutomationUpdate({ ...base, firstDelayMinutes: -1 }).ok).toBe(false)
  })

  it('covers all six known keys', () => {
    expect(AUTOMATION_KEYS).toHaveLength(6)
  })
})

describe('template validation', () => {
  const base = {
    templateKey: 'welcome_v1',
    name: 'Welcome',
    subject: 'Hi {{first_name}}',
    previewText: '',
    heading: 'Welcome {{first_name}}',
    bodyText: 'Your code is {{discount_code}}.',
    ctaLabel: 'Shop now',
    defaultUrl: 'https://example.com',
    discountCodeId: null,
    isActive: true,
  }

  it('accepts a valid template', () => {
    expect(validateTemplateInput({ ...base }).ok).toBe(true)
  })

  it('rejects raw HTML in a content field', () => {
    expect(validateTemplateInput({ ...base, bodyText: 'Hello <b>x</b>' }).ok).toBe(false)
  })

  it('rejects an unknown placeholder anywhere', () => {
    const r = validateTemplateInput({ ...base, subject: 'Hi {{sneaky}}' })
    expect(r).toEqual({ ok: false, error: 'unknown_placeholder' })
  })

  it('rejects a bad template key', () => {
    expect(validateTemplateInput({ ...base, templateKey: 'Bad Key!' }).ok).toBe(false)
  })

  it('rejects a non-http default url', () => {
    expect(validateTemplateInput({ ...base, defaultUrl: 'javascript:alert(1)' }).ok).toBe(false)
  })

  it('detects content changes for version bump but ignores metadata-only edits', () => {
    const existing = {
      subject: 'Hi {{first_name}}',
      preview_text: null,
      heading: 'Welcome {{first_name}}',
      body_text: 'Your code is {{discount_code}}.',
      cta_label: 'Shop now',
      default_url: 'https://example.com',
      discount_code_id: null,
    }
    const validated = validateTemplateInput({ ...base })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    // Same content => no bump.
    expect(templateContentChanged(existing, validated.value)).toBe(false)
    // Metadata-only change (name) => still no content change.
    const renamed = validateTemplateInput({ ...base, name: 'Renamed' })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) expect(templateContentChanged(existing, renamed.value)).toBe(false)
    // Content change => bump.
    const changed = validateTemplateInput({ ...base, subject: 'New subject' })
    expect(changed.ok).toBe(true)
    if (changed.ok) expect(templateContentChanged(existing, changed.value)).toBe(true)
  })
})

describe('promotion validation', () => {
  const base = {
    campaignId: UUID,
    promotionType: 'vip_early_access',
    templateId: UUID2,
    scheduledAt: null,
    rolloutLimit: 0,
    status: 'draft',
  }

  it('accepts a valid draft create', () => {
    expect(validatePromotionCreate({ ...base }).ok).toBe(true)
  })

  it('rejects an invalid campaign id', () => {
    expect(validatePromotionCreate({ ...base, campaignId: 'x' }).ok).toBe(false)
  })

  it('rejects an unknown promotion type', () => {
    expect(validatePromotionCreate({ ...base, promotionType: 'spam' }).ok).toBe(false)
  })

  it('rejects create with a cancelled status', () => {
    expect(validatePromotionCreate({ ...base, status: 'cancelled' }).ok).toBe(false)
  })

  it('requires a schedule time when status is scheduled', () => {
    expect(validatePromotionCreate({ ...base, status: 'scheduled', scheduledAt: null })).toEqual({
      ok: false,
      error: 'schedule_time_required',
    })
    expect(
      validatePromotionCreate({
        ...base,
        status: 'scheduled',
        scheduledAt: '2030-01-01T00:00:00.000Z',
      }).ok,
    ).toBe(true)
  })

  it('update allows cancelled and validates schedule coherence', () => {
    expect(validatePromotionUpdate({ status: 'cancelled', templateId: null, scheduledAt: null, rolloutLimit: 0 }).ok).toBe(true)
    expect(
      validatePromotionUpdate({ status: 'scheduled', templateId: null, scheduledAt: null, rolloutLimit: 0 }),
    ).toEqual({ ok: false, error: 'schedule_time_required' })
  })

  it('exposes exactly the admin-settable statuses and promotion types', () => {
    expect([...ADMIN_PROMOTION_STATUSES]).toEqual(['draft', 'scheduled', 'cancelled'])
    expect([...PROMOTION_TYPES]).toEqual(['regular_buyer_campaign_alert', 'vip_early_access'])
  })
})

describe('control state validation', () => {
  const base = {
    sendingEnabled: false,
    discoveryEnabled: false,
    rolloutLimit: 0,
    maximumBatchSize: 50,
    maximumDailyPerContact: 1,
    maximumWeeklyPerContact: 3,
  }

  it('accepts a valid fully-paused control state', () => {
    expect(validateControlUpdate({ ...base }).ok).toBe(true)
  })

  it('rejects a weekly cap below the daily cap', () => {
    expect(validateControlUpdate({ ...base, maximumDailyPerContact: 5, maximumWeeklyPerContact: 2 })).toEqual({
      ok: false,
      error: 'weekly_below_daily',
    })
  })

  it('rejects batch size outside 1..100', () => {
    expect(validateControlUpdate({ ...base, maximumBatchSize: 0 }).ok).toBe(false)
    expect(validateControlUpdate({ ...base, maximumBatchSize: 101 }).ok).toBe(false)
  })

  it('rejects a non-boolean sending flag', () => {
    expect(validateControlUpdate({ ...base, sendingEnabled: 'yes' as unknown as boolean }).ok).toBe(false)
  })
})
