'use client'

import { useState } from 'react'
import Link from 'next/link'

interface FieldErrors {
  first_name?: string
  last_name?: string
  tiktok_nickname?: string
  mobile?: string
  email?: string
  consent?: string
}

export function PreRegisterForm() {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    tiktok_nickname: '',
    mobile: '',
    email: '',
    consent: false,
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState<null | { alreadyRegistered: boolean }>(null)

  function validate(): FieldErrors {
    const e: FieldErrors = {}
    if (!form.first_name.trim()) e.first_name = 'Required'
    if (!form.last_name.trim()) e.last_name = 'Required'
    if (!form.tiktok_nickname.trim()) e.tiktok_nickname = 'Required'
    const mobileSanitized = form.mobile.replace(/[^\d]/g, '')
    if (!mobileSanitized) e.mobile = 'Required'
    else if (!/^\d{10,11}$/.test(mobileSanitized)) e.mobile = 'Must be 10–11 digits'
    if (!form.email.trim()) e.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Invalid email'
    if (!form.consent) e.consent = 'You must agree to continue'
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
      const res = await fetch('/api/pre-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setServerError(json.error || 'Something went wrong')
        return
      }
      setSuccess({ alreadyRegistered: !!json.alreadyRegistered })
    } catch {
      setServerError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function updateField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FFD700]/20 text-3xl">
          {success.alreadyRegistered ? '\uD83D\uDC4B' : '\uD83C\uDF89'}
        </div>
        <h3 className="text-xl font-bold text-white">
          {success.alreadyRegistered
            ? "You're already on the list!"
            : "You're IN!"}
        </h3>
        <p className="text-sm text-pink-200/80">
          {success.alreadyRegistered
            ? 'We already have your details. Stay tuned for the drop!'
            : "VIP secured. We'll notify you when it drops."}
        </p>
        <div className="mt-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-[#FFD700]">
          VIP CONFIRMED
        </div>
      </div>
    )
  }

  const inputBase =
    'w-full rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-sm text-white placeholder-pink-200/50 outline-none transition-all duration-200 focus:border-[#FFD700]/60 focus:bg-white/[0.1] focus:ring-2 focus:ring-[#FFD700]/20 focus:shadow-[0_0_15px_rgba(255,215,0,0.1)]'
  const errorClass = 'mt-1 text-[11px] font-medium text-[#FFD700]'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <input
            type="text"
            placeholder="First Name"
            className={inputBase}
            value={form.first_name}
            onChange={(e) => updateField('first_name', e.target.value)}
            aria-label="First Name"
          />
          {errors.first_name && <p className={errorClass}>{errors.first_name}</p>}
        </div>
        <div>
          <input
            type="text"
            placeholder="Last Name"
            className={inputBase}
            value={form.last_name}
            onChange={(e) => updateField('last_name', e.target.value)}
            aria-label="Last Name"
          />
          {errors.last_name && <p className={errorClass}>{errors.last_name}</p>}
        </div>
      </div>

      <div>
        <input
          type="text"
          placeholder="TikTok Nickname"
          className={inputBase}
          value={form.tiktok_nickname}
          onChange={(e) => updateField('tiktok_nickname', e.target.value)}
          aria-label="TikTok Nickname"
        />
        {errors.tiktok_nickname && <p className={errorClass}>{errors.tiktok_nickname}</p>}
      </div>

      <div>
        <input
          type="tel"
          placeholder="Mobile (10–11 digits)"
          className={inputBase}
          value={form.mobile}
          onChange={(e) => updateField('mobile', e.target.value)}
          aria-label="Mobile Number"
        />
        {errors.mobile && <p className={errorClass}>{errors.mobile}</p>}
      </div>

      <div>
        <input
          type="email"
          placeholder="Email Address"
          className={inputBase}
          value={form.email}
          onChange={(e) => updateField('email', e.target.value)}
          aria-label="Email Address"
        />
        {errors.email && <p className={errorClass}>{errors.email}</p>}
      </div>

      <div>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#FFD700] rounded"
            checked={form.consent}
            onChange={(e) => updateField('consent', e.target.checked)}
          />
          <span className="text-[11px] leading-relaxed text-pink-200/70">
            {'I agree to the '}
            <Link href="/terms" className="text-pink-100 underline underline-offset-2 hover:text-white">
              Terms & Conditions
            </Link>
            {' and '}
            <Link href="/privacy" className="text-pink-100 underline underline-offset-2 hover:text-white">
              Privacy Policy
            </Link>
            {' and I consent to marketing.'}
          </span>
        </label>
        {errors.consent && <p className={errorClass}>{errors.consent}</p>}
      </div>

      {serverError && (
        <p className="rounded-xl bg-red-500/20 px-4 py-2 text-center text-xs text-red-200">
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="relative mt-1 w-full overflow-hidden rounded-xl bg-gradient-to-r from-[#FFD700] to-[#FFA500] px-6 py-3.5 text-sm font-extrabold uppercase tracking-wider text-[#1a0a2e] shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(255,215,0,0.4)] active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0"
        style={{ backgroundSize: '200% auto' }}
      >
        {submitting ? 'Registering...' : 'JOIN THE VIP LIST'}
      </button>

      <p className="text-center text-[10px] text-pink-200/50">
        UK & Ireland &bull; 18+ &bull; No spam &bull; Free entry
      </p>
    </form>
  )
}
