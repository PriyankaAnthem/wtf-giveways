/** Inline gold "FREE SPIN" style ticket. No baked text — pure vector. */
export function TicketIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="stw-tk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2c2" />
          <stop offset="0.5" stopColor="#f7d774" />
          <stop offset="1" stopColor="#c8961f" />
        </linearGradient>
      </defs>
      <path
        d="M7 14a3 3 0 0 1 3-3h28a3 3 0 0 1 3 3v4a3 3 0 0 0 0 6v4a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3v-4a3 3 0 0 0 0-6z"
        fill="url(#stw-tk)"
        stroke="#8a6512"
        strokeWidth="1.5"
      />
      <path d="M24 15v18" stroke="#8a6512" strokeWidth="1.5" strokeDasharray="2 3" />
      <path
        d="m17 20 1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z"
        fill="#2a1a04"
      />
    </svg>
  )
}
