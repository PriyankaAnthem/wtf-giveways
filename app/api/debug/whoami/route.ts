import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase.auth.getUser()

    return NextResponse.json({
      ok: true,
      hasUser: !!data?.user,
      userId: data?.user?.id ?? null,
      email: data?.user?.email ?? null,
      authError: error?.message ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'unknown_error' },
      { status: 500 },
    )
  }
}
