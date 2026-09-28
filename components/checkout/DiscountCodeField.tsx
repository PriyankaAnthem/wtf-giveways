'use client'

import { useState, type KeyboardEvent } from 'react'
import { Check, ChevronRight, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { discountErrorMessage } from '@/lib/discounts/customerErrorCopy'
import { canApply, type DiscountUiState } from '@/lib/checkout/discountUiState'

/**
 * Presentational discount-code control for the checkout "Ways to save" module.
 * All state transitions live in the pure `discountUiState` reducer (owned by
 * the parent); this component only renders the current state, manages its own
 * collapsed/expanded affordance, and reports intent (change / apply / remove)
 * upward. No checkout logic lives here.
 */
export interface DiscountCodeFieldProps {
  state: DiscountUiState
  /** Pence saved (from the applied discount) for the success message. */
  discountPence: number
  /** Shared GBP formatter so copy matches the rest of checkout. */
  formatGBP: (pence: number) => string
  disabled?: boolean
  onInputChange: (value: string) => void
  onApply: () => void
  onRemove: () => void
}

export function DiscountCodeField({
  state,
  discountPence,
  formatGBP,
  disabled = false,
  onInputChange,
  onApply,
  onRemove,
}: DiscountCodeFieldProps) {
  const [expanded, setExpanded] = useState(false)

  const isValidating = state.status === 'validating'
  const isApplied = state.status === 'applied' && state.applied !== null
  const showError = state.status === 'error' && state.errorCode !== null
  const applyEnabled = !disabled && canApply(state)

  // Show the input form when the shopper has opened it, is mid-validation, has
  // an error to correct, or already has text typed. Otherwise stay collapsed.
  const showForm = !isApplied && (expanded || isValidating || showError || state.input.length > 0)

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter applies the code. Respect IME composition (CJK) and Safari's
    // unreliable final composition event (keyCode 229) to avoid submitting
    // mid-composition.
    if (event.key !== 'Enter') return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    if (applyEnabled) onApply()
  }

  function handleCollapse() {
    if (state.input.length > 0) onInputChange('')
    setExpanded(false)
  }

  function handleRemove() {
    setExpanded(false)
    onRemove()
  }

  // ---- Applied: slim success row ------------------------------------------
  if (isApplied) {
    return (
      <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20">
              <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="truncate tabular-nums">{state.applied?.code}</span>
                <span className="shrink-0 font-bold tabular-nums text-emerald-300">
                  −{formatGBP(discountPence)}
                </span>
              </span>
              <span className="block text-xs font-normal text-emerald-200/80">Discount applied</span>
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
            className="h-8 shrink-0 px-2 text-emerald-100 hover:bg-emerald-500/15 hover:text-white"
          >
            <X className="mr-1 h-4 w-4" aria-hidden="true" />
            Remove
          </Button>
        </div>
        <div aria-live="polite" role="status" className="sr-only">
          {`Discount applied. You're saving ${formatGBP(discountPence)}.`}
        </div>
      </div>
    )
  }

  // ---- Collapsed: compact "Add a discount code" row -----------------------
  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        aria-expanded={false}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-purple-500/25 bg-purple-500/10 px-3 py-2.5 text-left transition-colors hover:border-purple-400/40 hover:bg-purple-500/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
            <Tag className="h-4 w-4 text-purple-200" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-sm font-semibold text-white">
            Discount code
            <span className="block truncate text-xs font-normal text-purple-300">Have a code? Add it here</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-purple-200">
          Add
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
    )
  }

  // ---- Expanded: input + Apply --------------------------------------------
  return (
    <div className="rounded-xl border border-purple-500/25 bg-purple-500/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <Tag className="h-4 w-4 text-purple-200" aria-hidden="true" />
          Discount code
        </span>
        <button
          type="button"
          onClick={handleCollapse}
          disabled={disabled || isValidating}
          aria-label="Close discount code"
          className="rounded-md p-1 text-purple-300 transition-colors hover:bg-purple-500/20 hover:text-white disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="discount-code-input" className="sr-only">
            Enter discount code
          </label>
          <Input
            id="discount-code-input"
            name="discount-code"
            type="text"
            inputMode="text"
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Enter code"
            value={state.input}
            disabled={disabled || isValidating}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-invalid={showError || undefined}
            aria-describedby={showError ? 'discount-code-error' : undefined}
            className={
              'h-10 border-purple-500/40 bg-[#0f0620] uppercase text-white placeholder:text-purple-300/50 focus-visible:border-purple-400 focus-visible:ring-purple-400/40 ' +
              (showError ? 'border-red-400/70 focus-visible:border-red-400 focus-visible:ring-red-400/40' : '')
            }
          />
        </div>
        <Button
          type="button"
          onClick={onApply}
          disabled={!applyEnabled}
          className="h-10 shrink-0 border border-purple-400/30 bg-purple-500/30 px-4 font-semibold text-white hover:bg-purple-500/50 disabled:opacity-40"
        >
          {isValidating ? (
            <>
              <Spinner className="mr-2 h-4 w-4" aria-hidden="true" />
              Checking
            </>
          ) : (
            'Apply'
          )}
        </Button>
      </div>

      {/* Live region so assistive tech announces validation progress. */}
      <div aria-live="polite" role="status" className="sr-only">
        {isValidating ? 'Checking discount code.' : ''}
      </div>

      {showError ? (
        <p id="discount-code-error" className="mt-2 text-sm text-red-300">
          {discountErrorMessage(state.errorCode)}
        </p>
      ) : null}
    </div>
  )
}
