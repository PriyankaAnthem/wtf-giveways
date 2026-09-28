'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle, ShieldAlert } from 'lucide-react'

interface FieldErrors {
  enquiry_type?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  tiktok_username?: string
  amount_claimed?: string
  message?: string
  payout_account_holder_name?: string
  payout_sort_code?: string
  payout_account_number?: string
  giveaway_name?: string
  order_reference?: string
}

const ENQUIRY_TYPES = [
  { value: 'general', label: 'General enquiry' },
  { value: 'ticket_order_problem', label: 'Problem with tickets/order' },
  { value: 'account_login_issue', label: 'Account/login issue' },
  { value: 'other', label: 'Other' },
] as const

interface ContactFormProps {
  /** If true, the form starts in winner_payout mode without showing the dropdown */
  payoutMode?: boolean
}

export function ContactForm({ payoutMode = false }: ContactFormProps) {
  const [form, setForm] = useState({
    enquiry_type: payoutMode ? 'winner_payout' : '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    giveaway_name: '',
    order_reference: '',
    tiktok_username: '',
    amount_claimed: '',
    payout_account_holder_name: '',
    payout_sort_code: '',
    payout_account_number: '',
    message: '',
    company_website: '', // honeypot
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)

  const isPayoutMode = form.enquiry_type === 'winner_payout'

  function validate(): FieldErrors {
    const e: FieldErrors = {}
    
    if (!form.enquiry_type) e.enquiry_type = 'Please select an enquiry type'
    if (!form.first_name.trim()) e.first_name = 'First name is required'
    if (!form.last_name.trim()) e.last_name = 'Last name is required'
    if (!form.email.trim()) e.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Invalid email'
    if (!form.phone.trim()) e.phone = 'Mobile number is required'

    if (isPayoutMode) {
      // Winner payout validation - bank transfer only
      if (!form.tiktok_username.trim()) e.tiktok_username = 'TikTok username is required'
      if (!form.amount_claimed.trim()) {
        e.amount_claimed = 'Amount is required'
      } else {
        const amount = parseFloat(form.amount_claimed)
        if (isNaN(amount) || amount <= 0) {
          e.amount_claimed = 'Please enter a valid amount'
        }
      }
      if (!form.payout_account_holder_name.trim()) e.payout_account_holder_name = 'Account holder name is required'
      if (!form.payout_sort_code.trim()) e.payout_sort_code = 'Sort code is required'
      if (!form.payout_account_number.trim()) e.payout_account_number = 'Account number is required'
      // Message is optional for payout
    } else {
      // General contact form validation
      if (!form.message.trim() || form.message.trim().length < 10) e.message = 'Please provide more details (min 10 characters)'
      if (form.message.length > 2000) e.message = 'Message too long (max 2000 characters)'
    }

    return e
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setServerError('')
    const fieldErrors = validate()
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    setSubmitting(true)
    try {
      const submitData = {
        ...form,
        full_name: `${form.first_name.trim()} ${form.last_name.trim()}`.trim(),
        tiktok_username: form.tiktok_username.trim() || null,
        order_reference: form.tiktok_username.trim() || form.order_reference.trim() || null,
        amount_claimed: form.amount_claimed.trim() ? parseFloat(form.amount_claimed) : null,
        // For winner_payout, always set preferred_payout_method to bank_transfer
        preferred_payout_method: isPayoutMode ? 'bank_transfer' : null,
      }
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setServerError(json.error || 'Something went wrong')
        return
      }
      setSuccess(true)
    } catch {
      setServerError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function handleEnquiryTypeChange(value: string) {
    // Reset form fields when changing type
    setForm(prev => ({
      ...prev,
      enquiry_type: value,
      tiktok_username: '',
      amount_claimed: '',
      payout_account_holder_name: '',
      payout_sort_code: '',
      payout_account_number: '',
      giveaway_name: '',
      order_reference: '',
      message: '',
    }))
    setErrors({})
  }

  if (success) {
    const firstName = form.first_name.trim()

    return (
      <div className="flex flex-col items-center gap-5 py-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20 ring-1 ring-green-400/30">
          <CheckCircle className="h-8 w-8 text-green-400" />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-balance text-2xl font-bold tracking-tight text-white md:text-3xl">
            {isPayoutMode ? 'Payout details received ✅' : 'Message received! 🎉'}
          </h3>

          {isPayoutMode ? (
            <p className="max-w-sm text-pretty text-sm leading-relaxed text-purple-100">
              {firstName ? `Thanks, ${firstName}.` : 'Thanks.'} Your payout details have been
              securely submitted to the WTF team.
            </p>
          ) : (
            <p className="max-w-sm text-pretty text-sm leading-relaxed text-purple-100">
              {firstName ? `Thanks, ${firstName} — your` : 'Your'} message is safely with the WTF
              team.
              <br />
              We&apos;ll get back to you as soon as we can.
            </p>
          )}
        </div>

        {isPayoutMode && (
          <>
            <p className="w-full max-w-sm rounded-lg border border-[#FFD700]/40 bg-[#FFD700]/10 px-4 py-3 text-balance text-base font-bold text-[#FFD700]">
              Payouts are processed within 48 hours of submission.
            </p>
            <p className="max-w-sm text-pretty text-sm leading-relaxed text-purple-200/80">
              We&apos;ll verify your win and process your payout using the details you&apos;ve
              provided.
            </p>
          </>
        )}

        <div className="mt-1 flex w-full max-w-sm flex-col items-center gap-3 border-t border-white/10 pt-5">
          <p className="text-pretty text-sm font-semibold text-purple-100">
            {isPayoutMode ? 'Feeling lucky again? 👀' : 'Fancy another shot at winning while you wait? 👀'}
          </p>
          <Link
            href="/giveaways"
            prefetch={false}
            className="flex w-full items-center justify-center rounded-lg bg-[#FFD700] px-5 py-3 text-sm font-bold text-[#2A0A4A] transition-colors duration-200 hover:bg-[#FFE44D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD700]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            See What&apos;s Live
          </Link>
          <Link
            href="/"
            prefetch={false}
            className="text-xs font-medium text-purple-200/70 underline decoration-purple-200/30 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60"
          >
            Back to Home
          </Link>
        </div>
      </div>
    )
  }

  const inputBase =
    'w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 py-3 text-sm text-white placeholder-purple-300/50 outline-none transition-all duration-200 focus:border-[#FFD700]/60 focus:bg-white/[0.1] focus:ring-2 focus:ring-[#FFD700]/20'
  const selectBase =
    'w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 py-3 text-sm text-white outline-none transition-all duration-200 focus:border-[#FFD700]/60 focus:bg-white/[0.1] focus:ring-2 focus:ring-[#FFD700]/20 appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22%23a78bfa%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%222%22%20d%3D%22M19%209l-7%207-7-7%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.25rem] bg-[right_0.5rem_center] bg-no-repeat pr-10'
  const errorClass = 'mt-1 text-xs font-medium text-[#FFD700]'
  const labelClass = 'block text-sm font-medium text-purple-100 mb-1.5'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Honeypot - hidden from users */}
      <input
        type="text"
        name="company_website"
        value={form.company_website}
        onChange={(e) => updateField('company_website', e.target.value)}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      {/* ============ WINNER PAYOUT FORM (Direct payout mode) ============ */}
      {isPayoutMode && (
        <>
          {/* Payout Header */}
          <div className="rounded-lg border border-[#FFD700]/30 bg-[#FFD700]/5 p-4">
            <h3 className="text-base font-bold text-white">Submit your payout details</h3>
            <p className="mt-1 text-sm text-purple-200/80">
              Send us your details so we can verify your win and pay you.
            </p>
          </div>

          {/* First Name and Last Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>First name *</label>
              <input
                type="text"
                placeholder="First name"
                className={inputBase}
                value={form.first_name}
                onChange={(e) => updateField('first_name', e.target.value)}
              />
              {errors.first_name && <p className={errorClass}>{errors.first_name}</p>}
            </div>
            <div>
              <label className={labelClass}>Last name *</label>
              <input
                type="text"
                placeholder="Last name"
                className={inputBase}
                value={form.last_name}
                onChange={(e) => updateField('last_name', e.target.value)}
              />
              {errors.last_name && <p className={errorClass}>{errors.last_name}</p>}
            </div>
          </div>

          {/* Email */}
          <div>
            <label className={labelClass}>Email *</label>
            <input
              type="email"
              placeholder="you@example.com"
              className={inputBase}
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
            />
            {errors.email && <p className={errorClass}>{errors.email}</p>}
          </div>

          {/* Mobile */}
          <div>
            <label className={labelClass}>Mobile number *</label>
            <input
              type="tel"
              placeholder="Your mobile number"
              className={inputBase}
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
            />
            {errors.phone && <p className={errorClass}>{errors.phone}</p>}
          </div>

          {/* TikTok Username */}
          <div>
            <label className={labelClass}>TikTok username *</label>
            <input
              type="text"
              placeholder="@yourtiktok"
              className={inputBase}
              value={form.tiktok_username}
              onChange={(e) => updateField('tiktok_username', e.target.value)}
            />
            {errors.tiktok_username && <p className={errorClass}>{errors.tiktok_username}</p>}
          </div>

          {/* Amount Claimed */}
          <div>
            <label className={labelClass}>Amount you are claiming (£) *</label>
            <input
              type="number"
              placeholder="e.g. 50"
              min="0"
              step="0.01"
              className={inputBase}
              value={form.amount_claimed}
              onChange={(e) => updateField('amount_claimed', e.target.value)}
            />
            <p className="mt-1 text-xs text-purple-200/60">
              For live balloon wins, enter the amount you believe you won. We verify before payout.
            </p>
            {errors.amount_claimed && <p className={errorClass}>{errors.amount_claimed}</p>}
          </div>

          {/* Bank Details Section */}
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Account holder name *</label>
              <input
                type="text"
                placeholder="Name on the bank account"
                className={inputBase}
                value={form.payout_account_holder_name}
                onChange={(e) => updateField('payout_account_holder_name', e.target.value)}
              />
              {errors.payout_account_holder_name && <p className={errorClass}>{errors.payout_account_holder_name}</p>}
            </div>
            <div>
              <label className={labelClass}>Sort code *</label>
              <input
                type="text"
                placeholder="00-00-00"
                className={inputBase}
                value={form.payout_sort_code}
                onChange={(e) => updateField('payout_sort_code', e.target.value)}
              />
              {errors.payout_sort_code && <p className={errorClass}>{errors.payout_sort_code}</p>}
            </div>
            <div>
              <label className={labelClass}>Account number *</label>
              <input
                type="text"
                placeholder="12345678"
                className={inputBase}
                value={form.payout_account_number}
                onChange={(e) => updateField('payout_account_number', e.target.value)}
              />
              {errors.payout_account_number && <p className={errorClass}>{errors.payout_account_number}</p>}
            </div>
          </div>

          {/* Bank Warning */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-200/90">
              We only use these details to pay your prize. Never share passwords, PINs or card numbers.
            </p>
          </div>
        </>
      )}

      {/* ============ GENERAL CONTACT FORM ============ */}
      {!isPayoutMode && (
        <>
          {/* Enquiry Type - Dropdown (only for general contact) */}
          <div>
            <label className={labelClass}>What do you need help with? *</label>
            <select
              value={form.enquiry_type}
              onChange={(e) => handleEnquiryTypeChange(e.target.value)}
              className={selectBase}
            >
              <option value="" disabled className="bg-white text-slate-900">Select an option</option>
              {ENQUIRY_TYPES.map((type) => (
                <option key={type.value} value={type.value} className="bg-white text-slate-900">
                  {type.label}
                </option>
              ))}
            </select>
            {errors.enquiry_type && <p className={errorClass}>{errors.enquiry_type}</p>}
          </div>

          {/* Show fields only after enquiry type selected */}
          {form.enquiry_type && (
            <>
              {/* First Name and Last Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>First name *</label>
                  <input
                    type="text"
                    placeholder="First name"
                    className={inputBase}
                    value={form.first_name}
                    onChange={(e) => updateField('first_name', e.target.value)}
                  />
                  {errors.first_name && <p className={errorClass}>{errors.first_name}</p>}
                </div>
                <div>
                  <label className={labelClass}>Last name *</label>
                  <input
                    type="text"
                    placeholder="Last name"
                    className={inputBase}
                    value={form.last_name}
                    onChange={(e) => updateField('last_name', e.target.value)}
                  />
                  {errors.last_name && <p className={errorClass}>{errors.last_name}</p>}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className={labelClass}>Email address *</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  className={inputBase}
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                />
                {errors.email && <p className={errorClass}>{errors.email}</p>}
              </div>

              {/* Phone */}
              <div>
                <label className={labelClass}>Phone *</label>
                <input
                  type="tel"
                  placeholder="Your phone number"
                  className={inputBase}
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                />
                {errors.phone && <p className={errorClass}>{errors.phone}</p>}
              </div>

              {/* Giveaway Name - Optional */}
              <div>
                <label className={labelClass}>Giveaway name (optional)</label>
                <input
                  type="text"
                  placeholder="Which giveaway is this about?"
                  className={inputBase}
                  value={form.giveaway_name}
                  onChange={(e) => updateField('giveaway_name', e.target.value)}
                />
              </div>

              {/* TikTok / Order Reference - Optional */}
              <div>
                <label className={labelClass}>TikTok name or order reference (optional)</label>
                <input
                  type="text"
                  placeholder="Your TikTok username or order reference"
                  className={inputBase}
                  value={form.order_reference}
                  onChange={(e) => updateField('order_reference', e.target.value)}
                />
              </div>

              {/* Message - Required */}
              <div>
                <label className={labelClass}>Message *</label>
                <textarea
                  placeholder="Please describe your enquiry..."
                  rows={3}
                  className={`${inputBase} resize-none`}
                  value={form.message}
                  onChange={(e) => updateField('message', e.target.value)}
                  maxLength={2000}
                />
                <div className="mt-1 flex justify-between">
                  {errors.message ? (
                    <p className={errorClass}>{errors.message}</p>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-purple-300/50">{form.message.length}/2000</span>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {serverError && (
        <p className="rounded-lg bg-red-500/20 px-3 py-2 text-center text-sm text-red-200">
          {serverError}
        </p>
      )}

      {/* Submit Button */}
      {(isPayoutMode || form.enquiry_type) && (
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 w-full rounded-lg bg-gradient-to-r from-[#FFD700] to-[#FFA500] px-4 py-3.5 text-sm font-bold uppercase tracking-wider text-[#1a0a2e] shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(255,215,0,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {submitting ? 'Sending...' : (isPayoutMode ? 'Submit payout details' : 'Send Message')}
        </button>
      )}
    </form>
  )
}
