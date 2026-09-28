import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Staging-only Acquired authentication diagnostic.
 *
 * Verifies that the Acquired Preview/QA environment variables are present and
 * that an API login succeeds, WITHOUT creating or confirming any orders.
 *
 * This route never touches SumUp, ticket allocation, instant wins,
 * checkout_intents, or any confirmation/fulfilment logic. It also never
 * returns the Acquired access token or any secret to the browser.
 */
export async function POST() {
  const noStore = { 'Cache-Control': 'no-store' } as const

  // Staging / Preview only — otherwise pretend the route does not exist.
  const isStaging =
    process.env.VERCEL_ENV === 'preview' ||
    (process.env.NEXT_PUBLIC_SITE_URL ?? '').includes('staging.wtf-giveaways.co.uk')

  if (!isStaging) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: noStore })
  }

  const appId = process.env.ACQUIRED_APP_ID
  const appKey = process.env.ACQUIRED_APP_KEY

  if (!appId || !appKey) {
    return NextResponse.json(
      { ok: false, status: 500, error: 'missing_acquired_credentials' },
      { status: 500, headers: noStore },
    )
  }

  // Env-driven Acquired API host. Falls back to the QA/test host when unset so
  // we never accidentally hit LIVE. Strips trailing slash(es) AND a trailing
  // `/v1` so a value entered with or without `/v1` never yields `/v1/v1` when we
  // append `/v1/login` below. This diagnostic route stays staging/preview-only
  // via the guard above.
  const apiBaseUrl =
    ((process.env.ACQUIRED_API_BASE_URL ?? '').trim() || 'https://test-api.acquired.com')
      .replace(/\/+$/, '')
      .replace(/\/v1$/i, '')
      .replace(/\/+$/, '')

  let res: Response
  try {
    res = await fetch(`${apiBaseUrl}/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_key: appKey }),
    })
  } catch {
    // Network/transport failure — do not leak request details.
    return NextResponse.json(
      { ok: false, status: 502, error: 'acquired_login_request_failed' },
      { status: 502, headers: noStore },
    )
  }

  // Parse safely; Acquired may return a non-JSON body on error.
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    // Surface only Acquired's safe error title/message — never the token,
    // app key, or full request body.
    const safeError =
      (data && (data.error_description || data.title || data.message || data.error)) ||
      'acquired_login_failed'

    return NextResponse.json(
      { ok: false, status: res.status, error: safeError },
      { status: res.status, headers: noStore },
    )
  }

  // Success: return only non-sensitive metadata. Deliberately omit the token.
  return NextResponse.json(
    {
      ok: true,
      token_type: data?.token_type ?? null,
      expires_in: data?.expires_in ?? null,
    },
    { status: 200, headers: noStore },
  )
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
