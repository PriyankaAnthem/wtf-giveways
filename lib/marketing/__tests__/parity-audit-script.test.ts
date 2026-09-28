import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * STATIC contract for the MANUAL parity-audit script
 * scripts/marketing/audits/001-customer-profile-parity-audit.sql.
 *
 * The audit cannot be executed from vitest (no Postgres), so these tests pin the
 * parts of its contract that MUST hold in the SQL text and in the repository:
 *   - it is read-only (no writes / DDL / settings / locks / temp tables),
 *   - it returns exactly one result row,
 *   - it emits no raw customer identity,
 *   - it uses set-based grouped aggregates over the source tables,
 *   - it is NEVER referenced by any application code,
 *   - and hiding Marketing left the page + API files (and the Stage 2 audience
 *     definitions) fully intact.
 */
const ROOT = process.cwd()
const AUDIT_PATH = 'scripts/marketing/audits/001-customer-profile-parity-audit.sql'
const SQL = readFileSync(join(ROOT, AUDIT_PATH), 'utf8')

// SQL with `-- ...` line comments stripped, so assertions about executable code
// are never satisfied (or tripped) by prose in the header comment.
const CODE = SQL.replace(/--.*$/gm, '')
const FLAT = CODE.replace(/\s+/g, ' ').trim()

describe('parity-audit script — exists and is a manual, non-migration script', () => {
  it('lives under scripts/marketing/audits (not the migrations folder)', () => {
    expect(existsSync(join(ROOT, AUDIT_PATH))).toBe(true)
  })
})

describe('parity-audit script — strictly read-only', () => {
  it('performs no write, DDL, grant, lock, temp table or settings change', () => {
    const FORBIDDEN: RegExp[] = [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\b\s+\w/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /\bMERGE\b/i,
      /\bCREATE\b/i,
      /\bDROP\b/i,
      /\bALTER\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bLOCK\b/i,
      /\bSELECT\s+.*\bFOR\s+UPDATE\b/i,
      /\bTEMP(?:ORARY)?\s+TABLE\b/i,
      /\bset_config\b/i,
      /\bSET\s+(LOCAL\s+)?statement_timeout\b/i,
    ]
    for (const re of FORBIDDEN) {
      expect(re.test(CODE), re.source).toBe(false)
    }
  })

  it('is a single SELECT statement (exactly one terminating semicolon)', () => {
    const statements = CODE.split(';').map((s) => s.trim()).filter((s) => s.length > 0)
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(/^WITH[\s\S]*SELECT jsonb_build_object\(/)
  })
})

describe('parity-audit script — returns exactly one JSON row', () => {
  it('projects a single jsonb_build_object aliased as parity_audit', () => {
    expect(FLAT).toContain('SELECT jsonb_build_object(')
    expect(FLAT).toMatch(/\) AS parity_audit;?$/)
    // Exactly one top-level projection alias — one row, one column.
    expect((CODE.match(/\bAS parity_audit\b/g) ?? []).length).toBe(1)
  })

  it('the final projection has no top-level GROUP BY that would fan out rows', () => {
    // All aggregation is inside CTEs / scalar subqueries; the outer SELECT has
    // no FROM and no GROUP BY, so it always yields exactly one row.
    const outer = CODE.slice(CODE.lastIndexOf(') AS parity_audit'))
    expect(outer).not.toMatch(/GROUP BY/i)
  })
})

describe('parity-audit script — emits no raw customer identity', () => {
  it('builds no identity-bearing JSON output key', () => {
    // Output keys are single-quoted string literals inside jsonb_build_object.
    const keyLiterals = (CODE.match(/'([a-zA-Z0-9_]+)'\s*,/g) ?? []).map((m) =>
      m.replace(/[',\s]/g, '').toLowerCase(),
    )
    const FORBIDDEN_KEYS = [
      'email',
      'email_lc',
      'user_id',
      'userid',
      'user_ids',
      'userids',
      'name',
      'full_name',
      'first_name',
      'last_name',
      'ref',
      'checkout_ref',
      'payment_id',
      'phone',
    ]
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keyLiterals, forbidden).not.toContain(forbidden)
    }
  })

  it('never SELECTs a bare email / name column into the output', () => {
    // Identity columns may appear only in JOIN/GROUP predicates (e.g.
    // s.user_id = a.user_id), never as a projected value or JSON key.
    expect(CODE).not.toMatch(/jsonb_build_object\([^)]*\bemail\b/i)
    expect(FLAT).not.toMatch(/'[^']*[Ee]mail[^']*',\s*[a-z_]+\.email/)
  })
})

describe('parity-audit script — set-based aggregates over the authoritative sources', () => {
  it('reads all five source tables plus the profile table', () => {
    expect(CODE).toMatch(/\bFROM auth\.users\b/)
    expect(CODE).toMatch(/\bFROM public\.checkout_intents\b/)
    expect(CODE).toMatch(/\bFROM public\.wallet_accounts\b/)
    expect(CODE).toMatch(/\bFROM public\.marketing_preferences\b/)
    expect(CODE).toMatch(/\bpublic\.marketing_suppressions\b/)
    expect(CODE).toMatch(/\bpublic\.customer_marketing_profiles\b/)
  })

  it('aggregates with grouped set-based CTEs (GROUP BY + count/SUM), not per-row loops', () => {
    expect(CODE).toMatch(/GROUP BY ci\.user_id/)
    expect(CODE).toMatch(/COUNT\(\*\)::bigint\s+AS confirmed_order_count/)
    expect(CODE).toMatch(/SUM\(/)
  })

  it('uses the canonical eligible confirmed-order scope', () => {
    expect(FLAT).toMatch(/ci\.state = 'confirmed'/)
    expect(FLAT).toMatch(/ci\.provider IS DISTINCT FROM 'debug'/)
    expect(FLAT).toMatch(/ci\.ref IS NULL OR ci\.ref NOT LIKE 'SIM-%'/)
  })

  it('uses the external-revenue fallback identical to migration 003', () => {
    expect(FLAT).toMatch(
      /WHEN ci\.external_payment_pence IS NOT NULL THEN ci\.external_payment_pence ELSE COALESCE\(ci\.total_pence, 0\) - COALESCE\(ci\.wallet_credit_pence, 0\)/,
    )
  })

  it('uses the same deterministic last-campaign tie-break as migration 003', () => {
    expect(FLAT).toMatch(
      /DISTINCT ON \(ci\.user_id\)[\s\S]*ORDER BY ci\.user_id, ci\.confirmed_at DESC, ci\.id DESC/,
    )
  })

  it('computes wallet available with GREATEST(.., 0), never negative', () => {
    expect(FLAT).toMatch(
      /GREATEST\(COALESCE\(w\.balance_pence, 0\) - COALESCE\(w\.reserved_pence, 0\), 0\)/,
    )
  })

  it('reuses the Stage 1 eligibility snapshot rule (active + confirmed + enabled + not suppressed)', () => {
    expect(FLAT).toMatch(
      /a\.account_active AND a\.email_confirmed AND COALESCE\(p\.email_marketing_enabled, false\) AND \(s\.user_id IS NULL\)/,
    )
  })

  it('returns every required aggregate section', () => {
    for (const key of [
      'coverage',
      'purchaseTotals',
      'profileFieldMismatches',
      'walletParity',
      'marketingStateParity',
      'freshness',
    ]) {
      expect(CODE, key).toContain(`'${key}'`)
    }
  })
})

describe('parity-audit script — never referenced by application code', () => {
  // Walk the app surface (routes, components, libs) and assert nothing imports
  // or names the audit script. It must only ever be run by hand in Supabase.
  const walk = (dir: string): string[] => {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) return []
    return readdirSync(abs, { recursive: true, encoding: 'utf8' })
      .map((rel) => join(abs, rel))
      .filter((p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p))
      // Exclude test files: this suite legitimately names the script, and tests
      // are not shipped application code.
      .filter((p) => !p.includes('__tests__') && !/\.test\.[cm]?[jt]sx?$/.test(p))
  }

  it('no source file mentions the audit path or its filename', () => {
    const files = [...walk('app'), ...walk('components'), ...walk('lib')]
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return (
        text.includes('001-customer-profile-parity-audit') ||
        text.includes('audits/001-customer-profile-parity-audit')
      )
    })
    expect(offenders).toEqual([])
  })
})

describe('hiding Marketing left the page + API + audience definitions intact', () => {
  it('keeps the Marketing page, API route and dashboard components present', () => {
    for (const file of [
      'app/admin/marketing/page.tsx',
      'app/api/admin/marketing/audiences/route.ts',
      'lib/admin/marketing/audiences.ts',
      'lib/admin/marketing/audience-queries.ts',
      'components/admin/marketing/MarketingDashboard.tsx',
      'components/admin/marketing/MarketingSections.tsx',
    ]) {
      expect(existsSync(join(ROOT, file)), file).toBe(true)
    }
  })

  it('leaves the Stage 2 audience count RPC (migration 004) defining all 14 audiences', () => {
    const migration = readFileSync(
      join(ROOT, 'scripts/marketing/004-marketing-audience-counts.sql'),
      'utf8',
    )
    for (const key of [
      'recent_buyers_not_today',
      'one_time_buyers',
      'lapsed_7_days',
      'lapsed_14_days',
      'lapsed_30_days',
      'lapsed_60_days',
      'frequent_buyers',
      'vip_buyers',
      'high_value_buyers',
      'customers_with_credit',
      'customers_with_credit_5_plus',
      'new_accounts_without_purchase',
      'all_eligible_buyers',
      'eligible_non_buyers',
    ]) {
      expect(migration, key).toContain(`'${key}'`)
    }
  })
})
