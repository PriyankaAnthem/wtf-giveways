'use client'

import { useLayoutEffect } from 'react'

function forceTop() {
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

export function ScrollToTopOnMount() {
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return

    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }

    forceTop()

    const start = Date.now()

    const onScroll = () => {
      if (Date.now() - start < 600 && window.scrollY > 0) {
        forceTop()
      }
    }

    window.addEventListener('scroll', onScroll, { passive: false })

    const t1 = setTimeout(forceTop, 50)
    const t2 = setTimeout(forceTop, 200)

    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return null
}
