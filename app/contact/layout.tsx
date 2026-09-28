import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: "Contact Us | WTF Giveaways",
  description: "Get help with tickets, your account, or winner payouts. Contact the WTF Giveaways team.",
}

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
