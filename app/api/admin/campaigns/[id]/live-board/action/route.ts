import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeAdminApi } from '@/lib/admin/auth'
import {
  NO_STORE,
  getServiceSupabase,
  normalizeStoredItems,
  type LiveBoardItem,
} from '@/lib/admin/live-board'

type ActionBody =
  | { action: 'enable' }
  | { action: 'disable' }
  | { action: 'decrement'; itemId: string }
  | { action: 'increment'; itemId: string }
  | { action: 'undo' }

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, ...NO_STORE })
}

/**
 * POST /api/admin/campaigns/[campaignId]/live-board/action
 *
 * Admin-only. Mutates the live board for a Balloon Pop campaign and writes an
 * immutable audit event for every change. Supports enable/disable, decrement
 * (popped), increment (correction), and undo (reverses the last +/- via a NEW
 * event — never mutates/deletes the original).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  // Hosts (ops) must be able to pop balloons / correct / undo during a live,
  // so this mutating route allows both full admins and Hosts.
  const { user, error: authError } = await authorizeAdminApi(supabase, { roles: ['admin', 'ops'] })
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError },
      { status: authError === 'Not authenticated' ? 401 : 403, ...NO_STORE },
    )
  }

  const { id: campaignId } = await params
  if (!campaignId) return jsonError('campaign_not_found', 400)

  let body: ActionBody
  try {
    body = (await request.json()) as ActionBody
  } catch {
    return jsonError('invalid_action', 400)
  }

  const action = body?.action
  if (action !== 'enable' && action !== 'disable' && action !== 'decrement' && action !== 'increment' && action !== 'undo') {
    return jsonError('invalid_action', 400)
  }

  try {
    const svc = getServiceSupabase()

    // Campaign must exist and be Balloon Pop.
    const { data: campaign, error: campaignErr } = await svc
      .from('campaigns')
      .select('id, presentation_type')
      .eq('id', campaignId)
      .maybeSingle()
    if (campaignErr) {
      console.error('[admin/live-board/action] campaign query error:', campaignErr.message)
      return jsonError('live_board_action_failed', 500)
    }
    if (!campaign) return jsonError('campaign_not_found', 404)
    if (campaign.presentation_type !== 'balloon_pop') return jsonError('not_balloon_pop', 400)

    // Board must exist.
    const { data: boardRow, error: boardErr } = await svc
      .from('campaign_live_boards')
      .select('id, enabled, items')
      .eq('campaign_id', campaignId)
      .maybeSingle()
    if (boardErr) {
      console.error('[admin/live-board/action] board query error:', boardErr.message)
      return jsonError('live_board_action_failed', 500)
    }
    if (!boardRow) return jsonError('board_not_found', 404)

    const boardId = boardRow.id as string
    const nowIso = new Date().toISOString()
    const items = normalizeStoredItems(boardRow.items)

    // ----- enable / disable -----
    if (action === 'enable' || action === 'disable') {
      const enabled = action === 'enable'
      const label = enabled ? 'Board enabled' : 'Board disabled'

      const { error: updErr } = await svc
        .from('campaign_live_boards')
        .update({ enabled, last_event_label: label, last_event_at: nowIso, updated_at: nowIso, updated_by: user.id })
        .eq('id', boardId)
      if (updErr) {
        console.error('[admin/live-board/action] enable/disable update error:', updErr.message)
        return jsonError('live_board_action_failed', 500)
      }

      await svc.from('campaign_live_board_events').insert({
        campaign_id: campaignId,
        board_id: boardId,
        action_type: action,
        label,
        note: label,
        created_by: user.id,
      })

      return NextResponse.json({ ok: true, action, enabled }, NO_STORE)
    }

    // ----- decrement / increment -----
    if (action === 'decrement' || action === 'increment') {
      const itemId = typeof (body as any).itemId === 'string' ? (body as any).itemId : ''
      if (!itemId) return jsonError('item_not_found', 400)

      const idx = items.findIndex((i) => i.id === itemId)
      if (idx === -1) return jsonError('item_not_found', 404)

      const item = items[idx]
      const before = item.remaining

      if (action === 'decrement') {
        if (before <= 0) return jsonError('item_already_zero', 409)
      } else {
        if (before >= item.starting) return jsonError('item_already_at_starting', 409)
      }

      const delta = action === 'decrement' ? -1 : 1
      const after = before + delta
      const updatedItems = items.map((i, n) => (n === idx ? { ...i, remaining: after } : i))
      const eventLabel = action === 'decrement' ? `${item.label} popped` : `${item.label} corrected`

      const { error: updErr } = await svc
        .from('campaign_live_boards')
        .update({
          items: updatedItems,
          last_event_label: eventLabel,
          last_event_at: nowIso,
          updated_at: nowIso,
          updated_by: user.id,
        })
        .eq('id', boardId)
      if (updErr) {
        console.error('[admin/live-board/action] item update error:', updErr.message)
        return jsonError('live_board_action_failed', 500)
      }

      await svc.from('campaign_live_board_events').insert({
        campaign_id: campaignId,
        board_id: boardId,
        action_type: action,
        item_id: item.id,
        label: item.label,
        delta,
        before_remaining: before,
        after_remaining: after,
        created_by: user.id,
      })

      return NextResponse.json(
        { ok: true, action, itemId: item.id, beforeRemaining: before, afterRemaining: after },
        NO_STORE,
      )
    }

    // ----- undo -----
    // Find the latest decrement/increment event for this board that has not
    // already been undone, reverse it, and record a NEW undo audit event.
    const { data: undoneRows, error: undoneErr } = await svc
      .from('campaign_live_board_events')
      .select('undone_event_id')
      .eq('board_id', boardId)
      .eq('action_type', 'undo')
      .not('undone_event_id', 'is', null)
    if (undoneErr) {
      console.error('[admin/live-board/action] undone-set query error:', undoneErr.message)
      return jsonError('live_board_action_failed', 500)
    }
    const undoneSet = new Set<string>((undoneRows ?? []).map((r: any) => r.undone_event_id))

    const { data: candidates, error: candidatesErr } = await svc
      .from('campaign_live_board_events')
      .select('id, action_type, item_id, label, delta, created_at')
      .eq('board_id', boardId)
      .in('action_type', ['decrement', 'increment'])
      .order('created_at', { ascending: false })
      .limit(200)
    if (candidatesErr) {
      console.error('[admin/live-board/action] undo candidates query error:', candidatesErr.message)
      return jsonError('live_board_action_failed', 500)
    }

    const original = (candidates ?? []).find((e: any) => !undoneSet.has(e.id))
    if (!original) return jsonError('nothing_to_undo', 409)

    const targetItemId = original.item_id as string | null
    if (!targetItemId) return jsonError('nothing_to_undo', 409)

    const idx = items.findIndex((i) => i.id === targetItemId)
    if (idx === -1) return jsonError('item_not_found', 404)

    const item: LiveBoardItem = items[idx]
    const before = item.remaining

    // Reverse the original delta: decrement(-1) -> +1, increment(+1) -> -1.
    const reverseDelta = original.action_type === 'decrement' ? 1 : -1
    const after = before + reverseDelta

    if (after < 0) return jsonError('item_already_zero', 409)
    if (after > item.starting) return jsonError('item_already_at_starting', 409)

    const updatedItems = items.map((i, n) => (n === idx ? { ...i, remaining: after } : i))
    const eventLabel = `Undo: ${item.label}`

    const { error: updErr } = await svc
      .from('campaign_live_boards')
      .update({
        items: updatedItems,
        last_event_label: eventLabel,
        last_event_at: nowIso,
        updated_at: nowIso,
        updated_by: user.id,
      })
      .eq('id', boardId)
    if (updErr) {
      console.error('[admin/live-board/action] undo board update error:', updErr.message)
      return jsonError('live_board_action_failed', 500)
    }

    // New audit event — never mutate/delete the original.
    const { error: undoEventErr } = await svc.from('campaign_live_board_events').insert({
      campaign_id: campaignId,
      board_id: boardId,
      action_type: 'undo',
      item_id: item.id,
      label: item.label,
      delta: reverseDelta,
      before_remaining: before,
      after_remaining: after,
      undone_event_id: original.id,
      created_by: user.id,
    })
    if (undoEventErr) {
      console.error('[admin/live-board/action] undo event insert error:', undoEventErr.message)
      return jsonError('live_board_action_failed', 500)
    }

    return NextResponse.json(
      {
        ok: true,
        action: 'undo',
        undoneEventId: original.id,
        itemId: item.id,
        beforeRemaining: before,
        afterRemaining: after,
      },
      NO_STORE,
    )
  } catch (err: any) {
    console.error('[admin/live-board/action] unexpected error:', err?.message)
    return jsonError('live_board_action_failed', 500)
  }
}
