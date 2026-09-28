"use client"

/**
 * Football — the reusable dimensional association-football (soccer ball)
 * graphic used across the prototype (tray + in-flight ball).
 *
 * It is a lit white sphere with a classic ring of black pentagon panels, a
 * top-left specular highlight, a dark lower-right underside and a faint green
 * reflected light from the pitch. It is NOT a flat disc, golf ball, American
 * football, basketball, emoji or generic circle.
 */

/** Build a regular polygon path centred at (cx,cy). `rot` in degrees. */
function poly(cx: number, cy: number, r: number, sides: number, rot: number): string {
  const pts: string[] = []
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2 + (rot * Math.PI) / 180
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`)
  }
  return pts.join(" ")
}

export function Football({ size, idPrefix }: { size: number; idPrefix: string }) {
  const sphere = `${idPrefix}-sphere`
  const shade = `${idPrefix}-shade`
  const gloss = `${idPrefix}-gloss`
  const greenRef = `${idPrefix}-green`
  const clip = `${idPrefix}-clip`

  const centre = { x: 50, y: 47 }
  const ringR = 33
  const ring = [0, 1, 2, 3, 4].map((i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2
    return { x: centre.x + Math.cos(a) * ringR, y: centre.y + Math.sin(a) * ringR, rot: (360 / 5) * i }
  })

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <radialGradient id={sphere} cx="37%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="48%" stopColor="#f1f4ef" />
          <stop offset="78%" stopColor="#cdd2c9" />
          <stop offset="100%" stopColor="#8f978c" />
        </radialGradient>
        <radialGradient id={shade} cx="66%" cy="80%" r="66%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="70%" stopColor="rgba(0,0,0,0.12)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.52)" />
        </radialGradient>
        <radialGradient id={gloss} cx="33%" cy="24%" r="34%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.98)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id={greenRef} cx="50%" cy="98%" r="52%">
          <stop offset="0%" stopColor="rgba(168,255,25,0.55)" />
          <stop offset="60%" stopColor="rgba(168,255,25,0.12)" />
          <stop offset="100%" stopColor="rgba(168,255,25,0)" />
        </radialGradient>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="49" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clip})`}>
        <circle cx="50" cy="50" r="49" fill={`url(#${sphere})`} />

        {/* Black panels: central pentagon + a ring of five around it */}
        <g fill="#17191a">
          <polygon points={poly(centre.x, centre.y, 15, 5, 0)} />
          {ring.map((p, i) => (
            <polygon key={i} points={poly(p.x, p.y, 12.5, 5, p.rot + 180)} />
          ))}
        </g>

        {/* Seams from the central panel out toward each rim panel */}
        <g stroke="rgba(20,22,20,0.32)" strokeWidth="1.3" fill="none" strokeLinecap="round">
          {ring.map((p, i) => {
            const a = (Math.PI * 2 * i) / 5 - Math.PI / 2
            const sx = centre.x + Math.cos(a) * 15
            const sy = centre.y + Math.sin(a) * 15
            return <line key={i} x1={sx} y1={sy} x2={p.x} y2={p.y} />
          })}
        </g>

        <circle cx="50" cy="50" r="49" fill={`url(#${shade})`} />
        <circle cx="50" cy="50" r="49" fill={`url(#${greenRef})`} />
        <ellipse cx="36" cy="28" rx="24" ry="17" fill={`url(#${gloss})`} />
      </g>

      <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
      <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="0.6" />
    </svg>
  )
}
