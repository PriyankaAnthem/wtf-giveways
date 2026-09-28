import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const expected = process.env.WEBHOOK_SECRET
  const provided = req.nextUrl.searchParams.get('secret')
  if (expected && provided !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 })

  const token = process.env.SUMUP_ACCESS_TOKEN
  if (!token) return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 500 })

  const url = `https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(id)}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const text = await r.text().catch(() => '')

  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    body: text,
  })
}
