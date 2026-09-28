import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-webhook-secret')
  const expected = process.env.WEBHOOK_SECRET

  if (!expected || secret !== expected) {
    console.error('[webhooks/provider] unauthorized request')
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[webhooks/provider] received valid webhook')

  return NextResponse.json({ ok: true })
}
