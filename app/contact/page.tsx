'use client'

import { useState } from 'react'
import { ContactForm } from "@/components/contact/ContactForm"
import { Clock, Gift, HelpCircle, ArrowLeft } from "lucide-react"

export default function ContactPage() {
  const [showPayoutForm, setShowPayoutForm] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a002b] via-[#2d0050] to-[#0a0014]">
      <div className="container px-4 py-6 md:py-10">
        <div className="mx-auto max-w-lg">
          {/* Hero Section */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-white md:text-3xl">Contact Us</h1>
          </div>

          {/* ============ CLAIM WINNINGS SECTION ============ */}
          {!showPayoutForm ? (
            <>
              {/* Primary CTA Card - Claim Winnings */}
              <div className="mb-6 rounded-xl border-2 border-[#FFD700]/40 bg-gradient-to-br from-[#FFD700]/10 via-purple-900/20 to-[#FFD700]/5 p-5 shadow-[0_0_30px_rgba(255,215,0,0.1)]">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#FFD700]/20">
                    <Gift className="h-6 w-6 text-[#FFD700]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold text-white">Claim Winnings!</h2>
                    <p className="mt-1 text-sm text-purple-200/80">
                      Won a prize? Submit your payout details so we can verify and pay you.
                    </p>
                    <button
                      onClick={() => setShowPayoutForm(true)}
                      className="mt-4 w-full rounded-lg bg-gradient-to-r from-[#FFD700] to-[#FFA500] px-4 py-3 text-sm font-bold uppercase tracking-wider text-[#1a0a2e] shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(255,215,0,0.3)] active:scale-[0.98]"
                    >
                      Claim my winnings
                    </button>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-purple-500/20"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-[#2d0050] px-3 text-xs text-purple-300/60">or</span>
                </div>
              </div>

              {/* Secondary Section - General Support */}
              <div className="rounded-xl border border-purple-500/20 bg-purple-900/20 p-5">
                <div className="flex items-start gap-3 mb-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500/20">
                    <HelpCircle className="h-5 w-5 text-purple-300" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Need help with something else?</h2>
                    <p className="mt-0.5 text-sm text-purple-200/70">
                      For tickets, account issues or general support, contact us here.
                    </p>
                  </div>
                </div>
                
                {/* General Contact Form */}
                <ContactForm />
              </div>
            </>
          ) : (
            /* ============ PAYOUT FORM VIEW ============ */
            <div className="rounded-xl border border-purple-500/20 bg-purple-900/20 p-4 md:p-6">
              {/* Back Button */}
              <button
                onClick={() => setShowPayoutForm(false)}
                className="mb-4 flex items-center gap-1.5 text-sm text-purple-200/70 hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to contact options
              </button>

              {/* Payout Form */}
              <ContactForm payoutMode />
            </div>
          )}

          {/* Contact Info Footer */}
          <div className="mt-4 flex flex-col items-center gap-2 text-xs text-purple-200/70">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-purple-300" />
              <span>Response within 24-48 hours</span>
            </div>
            <p className="text-center text-purple-200/60">
              All winnings are paid Monday - Friday 9am - 5pm, please allow 48 hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
