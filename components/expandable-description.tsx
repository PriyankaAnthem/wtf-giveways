'use client'

import { useState } from 'react'

interface ExpandableDescriptionProps {
  text: string
}

export function ExpandableDescription({ text }: ExpandableDescriptionProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2">
      <p
        className={`whitespace-pre-line text-pretty text-lg text-purple-300 ${
          expanded ? '' : 'line-clamp-3 md:line-clamp-none'
        }`}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-1 text-sm font-medium text-brand hover:underline md:hidden"
      >
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </div>
  )
}
