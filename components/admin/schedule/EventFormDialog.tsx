'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  EVENT_STATUSES,
  EVENT_STATUS_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
  isCalendarDate,
  isClockTime,
  type ScheduleEvent,
  type ScheduleEventStatus,
  type ScheduleEventType,
} from '@/lib/types/schedule'

/** The payload the container sends to the API. */
export interface ScheduleEventPayload {
  title: string
  eventType: ScheduleEventType
  scheduledDate: string
  scheduledTime: string | null
  allDay: boolean
  status: ScheduleEventStatus
  notes: string | null
}

export type FormMode = 'create' | 'edit' | 'duplicate'

interface EventFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: FormMode
  /** Seed values. For duplicate this is the source event (spec s16). */
  initial: ScheduleEvent | null
  /** Pre-selected date used when creating from a day cell. */
  defaultDate: string
  saving: boolean
  onSubmit: (payload: ScheduleEventPayload) => void
}

interface FormState {
  title: string
  eventType: ScheduleEventType
  scheduledDate: string
  scheduledTime: string
  allDay: boolean
  status: ScheduleEventStatus
  notes: string
}

const DEFAULT_TIME = '20:00'

/**
 * Add / Edit / Duplicate form (spec s14 / s15 / s16).
 *
 * There is deliberately NO campaign selector and NO host selector: a planned
 * event may involve a competition or presenter that does not exist yet
 * (spec s4 / s5). To record a possible host, type it into Notes.
 */
export function EventFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  defaultDate,
  saving,
  onSubmit,
}: EventFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => seed(initial, defaultDate))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  // Re-seed whenever the dialog opens so a previous edit never leaks into the
  // next one. Keyed on open so typing is not clobbered mid-edit.
  useEffect(() => {
    if (open) {
      setForm(seed(initial, defaultDate))
      setErrors({})
    }
  }, [open, initial, defaultDate])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    // Mirror of the server rules (spec s36) so the admin gets inline feedback.
    const next: Partial<Record<keyof FormState, string>> = {}
    const title = form.title.trim()
    if (title.length === 0) next.title = 'Please enter a title.'
    else if (title.length > MAX_TITLE_LENGTH) {
      next.title = `Titles must be ${MAX_TITLE_LENGTH} characters or fewer.`
    }
    if (!isCalendarDate(form.scheduledDate)) next.scheduledDate = 'Please choose a valid date.'
    if (!form.allDay && !isClockTime(form.scheduledTime)) {
      next.scheduledTime = 'Please set a time, or mark this as All Day.'
    }
    if (form.notes.trim().length > MAX_NOTES_LENGTH) {
      next.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`
    }

    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }

    onSubmit({
      title,
      eventType: form.eventType,
      scheduledDate: form.scheduledDate,
      // All Day clears the time rather than sending a stale value.
      scheduledTime: form.allDay ? null : form.scheduledTime,
      allDay: form.allDay,
      status: form.status,
      notes: form.notes.trim() || null,
    })
  }

  const heading =
    mode === 'edit' ? 'Edit event' : mode === 'duplicate' ? 'Duplicate event' : 'Add event'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + overflow keeps the form usable on a short phone viewport, and
          the dialog is portalled so it cannot sit behind admin navigation. */}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            {mode === 'duplicate'
              ? 'Creates a new independent copy. The original event is left untouched.'
              : 'Planning only. This never creates or changes a live competition.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="schedule-title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. New Host Balloon Pop"
              maxLength={MAX_TITLE_LENGTH}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'schedule-title-error' : undefined}
              autoFocus
            />
            {errors.title ? (
              <p id="schedule-title-error" className="text-xs text-destructive">
                {errors.title}
              </p>
            ) : null}
          </div>

          {/* Event type */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-type">
              Event type <span className="text-destructive">*</span>
            </Label>
            <Select
              value={form.eventType}
              onValueChange={(v) => set('eventType', v as ScheduleEventType)}
            >
              <SelectTrigger id="schedule-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {EVENT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-date">
              Date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="schedule-date"
              type="date"
              value={form.scheduledDate}
              onChange={(e) => set('scheduledDate', e.target.value)}
              aria-invalid={!!errors.scheduledDate}
              aria-describedby={errors.scheduledDate ? 'schedule-date-error' : undefined}
            />
            {errors.scheduledDate ? (
              <p id="schedule-date-error" className="text-xs text-destructive">
                {errors.scheduledDate}
              </p>
            ) : null}
          </div>

          {/* All day + time */}
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="schedule-all-day" className="cursor-pointer font-normal">
                All day
              </Label>
              <Switch
                id="schedule-all-day"
                checked={form.allDay}
                onCheckedChange={(checked) => set('allDay', checked)}
              />
            </div>

            {!form.allDay ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-time">
                  Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={form.scheduledTime}
                  onChange={(e) => set('scheduledTime', e.target.value)}
                  aria-invalid={!!errors.scheduledTime}
                  aria-describedby={errors.scheduledTime ? 'schedule-time-error' : undefined}
                />
                {errors.scheduledTime ? (
                  <p id="schedule-time-error" className="text-xs text-destructive">
                    {errors.scheduledTime}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-status">
              Status <span className="text-destructive">*</span>
            </Label>
            <Select
              value={form.status}
              onValueChange={(v) => set('status', v as ScheduleEventStatus)}
            >
              <SelectTrigger id="schedule-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {EVENT_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Planning status only &mdash; this never triggers anything.
            </p>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-notes">Notes</Label>
            <Textarea
              id="schedule-notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="e.g. Potential new host — Amy"
              rows={3}
              maxLength={MAX_NOTES_LENGTH}
              aria-invalid={!!errors.notes}
              aria-describedby={errors.notes ? 'schedule-notes-error' : undefined}
            />
            {errors.notes ? (
              <p id="schedule-notes-error" className="text-xs text-destructive">
                {errors.notes}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {mode === 'edit' ? 'Save changes' : 'Create event'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function seed(initial: ScheduleEvent | null, defaultDate: string): FormState {
  if (initial) {
    return {
      title: initial.title,
      eventType: initial.eventType,
      scheduledDate: initial.scheduledDate,
      scheduledTime: initial.scheduledTime ?? DEFAULT_TIME,
      allDay: initial.allDay,
      status: initial.status,
      notes: initial.notes ?? '',
    }
  }
  return {
    title: '',
    eventType: 'balloon_pop',
    scheduledDate: defaultDate,
    scheduledTime: DEFAULT_TIME,
    allDay: false,
    status: 'idea',
    notes: '',
  }
}
