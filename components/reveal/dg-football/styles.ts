/**
 * DG'S BIG BALLERS — scoped stylesheet for the isolated /dgfootballidea route.
 * Everything is namespaced under `.dgf-page`. Uses the exact brand palette as
 * local CSS variables. No global tokens are modified. Prototype only.
 */

export const DG_FOOTBALL_CSS = String.raw`
.dgf-page {
  --dg-black: #050705;
  --dg-charcoal: #0C100D;
  --dg-panel: #111712;
  --dg-neon: #A8FF19;
  --dg-neon2: #5DFF00;
  --dg-glow: rgba(168, 255, 25, 0.35);
  --dg-white: #F7F7F2;
  --dg-muted: #A7B0A4;
  --dg-gold: #FFD84A;
  --dg-cash: #7CFF67;
  --dg-metal: #1a1e1a;
  --dg-metal2: #2a2f29;
  --dg-font: var(--font-sans, ui-sans-serif, system-ui, sans-serif);

  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: var(--dg-black);
  color: var(--dg-white);
  font-family: var(--dg-font);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.dgf-page *,
.dgf-page *::before,
.dgf-page *::after { box-sizing: border-box; }

/* Desktop backdrop behind the portrait phone frame. */
.dgf-desktop-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(168,255,25,0.10), transparent 60%),
    radial-gradient(900px 600px at 50% 120%, rgba(168,255,25,0.06), transparent 60%),
    var(--dg-black);
}

.dgf-layout {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

/* -------------------------------------------------------------------------- */
/*  Portrait phone viewport                                                   */
/* -------------------------------------------------------------------------- */
.dgf-viewport {
  position: relative;
  height: 100dvh;
  aspect-ratio: 1080 / 1920;
  max-width: 100vw;
  overflow: hidden;
  background: var(--dg-black);
  isolation: isolate;
}
@media (min-width: 1024px) {
  .dgf-layout { padding: 20px; }
  .dgf-viewport {
    height: min(94dvh, 940px);
    border-radius: 30px;
    box-shadow: 0 40px 120px rgba(0,0,0,0.7), 0 0 0 1px rgba(168,255,25,0.14);
  }
}

.dgf-reveal-root { position: absolute; inset: 0; }
.dgf-stage { position: absolute; inset: 0; overflow: hidden; isolation: isolate; }

/* -------------------------------------------------------------------------- */
/*  Environment                                                               */
/* -------------------------------------------------------------------------- */
.dgf-env { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
.dgf-env-pitch {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, #0a1408 0%, #060a06 46%, #040604 100%);
}
.dgf-env-glow {
  position: absolute; inset: 0;
  background:
    radial-gradient(80% 42% at 50% 8%, rgba(210,255,180,0.16), transparent 60%),
    radial-gradient(60% 40% at 50% 60%, rgba(168,255,25,0.10), transparent 70%),
    radial-gradient(40% 22% at 18% 30%, rgba(255,255,255,0.06), transparent 70%),
    radial-gradient(40% 22% at 82% 30%, rgba(255,255,255,0.06), transparent 70%);
}
.dgf-env-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(120% 90% at 50% 42%, transparent 52%, rgba(0,0,0,0.72) 100%);
}

/* -------------------------------------------------------------------------- */
/*  Brand header + hero instruction                                           */
/* -------------------------------------------------------------------------- */
.dgf-brand {
  position: absolute; top: 0; left: 0; right: 0; z-index: 6;
  display: flex; flex-direction: column; align-items: center;
  padding: calc(env(safe-area-inset-top) + clamp(10px, 2.6vh, 22px)) 16px 0;
  transition: opacity 240ms ease;
}
.dgf-brand-hidden { opacity: 0; pointer-events: none; }

.dgf-help-btn {
  position: absolute; top: calc(env(safe-area-inset-top) + 10px); left: 14px;
  width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid rgba(247,247,242,0.35); background: rgba(5,7,5,0.5);
  color: var(--dg-white); font-size: 16px; font-weight: 800;
  display: grid; place-items: center; cursor: pointer;
  backdrop-filter: blur(6px);
  transition: transform 140ms ease, border-color 140ms ease;
}
.dgf-help-btn:hover { transform: scale(1.06); border-color: var(--dg-neon); }

.dgf-brand-lockup {
  display: flex; flex-direction: column; align-items: center; line-height: 0.82;
  filter: drop-shadow(0 4px 18px rgba(168,255,25,0.28));
}
.dgf-brand-kicker {
  font-size: clamp(14px, 3.4vw, 20px); font-weight: 800; letter-spacing: 0.42em;
  color: var(--dg-white); padding-left: 0.42em;
}
.dgf-brand-title {
  font-size: clamp(28px, 8.4vw, 50px); font-weight: 900; letter-spacing: 0.01em;
  font-style: italic;
  background: linear-gradient(180deg, #f3fff0, #b6ff5e 60%, #7dd400);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 2px 0 rgba(0,0,0,0.25);
}

.dgf-instruction {
  margin-top: clamp(6px, 1.8vh, 14px);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  text-align: center;
  animation: dgf-fade-up 320ms ease both;
}
.dgf-instruction-text {
  font-size: clamp(20px, 5.6vw, 32px); font-weight: 900; letter-spacing: 0.02em;
  color: var(--dg-white); text-transform: uppercase;
}
.dgf-instruction-key { color: var(--dg-neon); text-shadow: 0 0 18px rgba(168,255,25,0.6); }
.dgf-instruction-sub {
  font-size: clamp(11px, 3vw, 15px); font-weight: 600; letter-spacing: 0.14em;
  color: var(--dg-muted); text-transform: uppercase; font-style: italic;
}
@keyframes dgf-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

/* -------------------------------------------------------------------------- */
/*  Board area (board + DG share this positioned box)                         */
/* -------------------------------------------------------------------------- */
.dgf-board-area { position: absolute; z-index: 2; }

/* ---- DG character (left of / partly behind the board) ---- */
.dgf-character {
  position: absolute; left: -30%; bottom: -3%; z-index: 1;
  width: 62%; height: 112%;
  display: flex; align-items: flex-end; justify-content: center;
  pointer-events: none;
  transition: opacity 260ms ease, filter 260ms ease, transform 320ms cubic-bezier(0.2,0.9,0.3,1);
  transform-origin: bottom left;
}
.dgf-character-scored { transform: scale(1.04); }
.dgf-character-dim { opacity: 0.62; filter: saturate(0.85) brightness(0.72); }
.dgf-character-inner { position: relative; width: 100%; height: 100%; }
.dgf-rim {
  position: absolute; left: 50%; top: 46%; width: 88%; height: 74%;
  transform: translate(-50%, -50%);
  background:
    radial-gradient(60% 70% at 50% 42%, rgba(168,255,25,0.3), transparent 66%),
    radial-gradient(closest-side, rgba(93,255,0,0.1), transparent 72%);
  filter: blur(14px); pointer-events: none;
}
.dgf-breathe { animation: dgf-breathe 6s ease-in-out infinite; transform-origin: bottom center; }
@keyframes dgf-breathe {
  0%,100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-0.6%) scale(1.012); }
}
.dgf-dg-img {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: contain; object-position: bottom center;
  filter: drop-shadow(0 10px 26px rgba(0,0,0,0.55));
  transition: opacity 200ms ease;
}
.dgf-dg-scored { opacity: 0; }
.dgf-dg-scored-in { opacity: 1; }

.dgf-rays {
  position: absolute; left: 46%; top: 32%; width: 160%; height: 160%;
  transform: translate(-50%, -50%);
  background: conic-gradient(from 0deg,
    rgba(255,216,74,0.22) 0deg, transparent 12deg, transparent 30deg,
    rgba(168,255,25,0.18) 42deg, transparent 54deg, transparent 90deg,
    rgba(255,216,74,0.22) 102deg, transparent 114deg, transparent 150deg,
    rgba(168,255,25,0.18) 162deg, transparent 174deg, transparent 360deg);
  opacity: 0; mix-blend-mode: screen; pointer-events: none;
  animation: dgf-spin 9s linear infinite;
}
.dgf-win-flash {
  position: absolute; left: 48%; top: 34%; width: 100%; height: 80%;
  transform: translate(-50%, -50%) scale(0.5);
  background: radial-gradient(circle, rgba(168,255,25,0.6), rgba(255,216,74,0.28) 46%, transparent 70%);
  opacity: 0; mix-blend-mode: screen; pointer-events: none;
}
.dgf-win-flash-on { animation: dgf-winflash 620ms ease-out forwards; }
.dgf-win-flash-reduced.dgf-win-flash-on { animation: dgf-winflash-reduced 200ms ease-out forwards; }
@keyframes dgf-winflash {
  0% { opacity: 0; transform: translate(-50%,-50%) scale(0.4); }
  30% { opacity: 1; transform: translate(-50%,-50%) scale(1.05); }
  100% { opacity: 0.55; transform: translate(-50%,-50%) scale(1.2); }
}
@keyframes dgf-winflash-reduced { from { opacity: 0; } to { opacity: 0.5; } }
@keyframes dgf-spin { to { transform: translate(-50%,-50%) rotate(360deg); } }

/* Missing-asset placeholder (dev safety if an image 404s). */
.dgf-missing {
  position: absolute; inset: 8%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; text-align: center; padding: 12px;
  background: repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(26,31,26,0.5) 8px, rgba(26,31,26,0.5) 16px);
  border: 1px dashed rgba(168,255,25,0.4); border-radius: 12px;
}
.dgf-missing-badge { font-size: 11px; font-weight: 900; letter-spacing: 0.16em; color: var(--dg-neon); }
.dgf-missing-hint { font-size: 10px; color: var(--dg-muted); }
.dgf-missing-path { font-family: var(--font-mono, monospace); color: var(--dg-white); word-break: break-all; font-size: 10px; }

/* -------------------------------------------------------------------------- */
/*  Target board                                                              */
/* -------------------------------------------------------------------------- */
.dgf-board { position: absolute; inset: 0; z-index: 2; }
.dgf-board-frame {
  position: absolute; left: 4%; right: 4%; top: 2%; bottom: 8%;
  border-radius: 18px;
  background: linear-gradient(180deg, #23281f 0%, #171b15 8%, #0e120d 50%, #171b15 92%, #23281f 100%);
  box-shadow:
    inset 0 2px 0 rgba(255,255,255,0.08),
    inset 0 -3px 8px rgba(0,0,0,0.7),
    0 24px 60px rgba(0,0,0,0.6);
}
.dgf-board-face {
  position: absolute; inset: 8%;
  border-radius: 12px;
  background:
    radial-gradient(circle at 1.5px 1.5px, rgba(255,255,255,0.05) 1px, transparent 1.6px) 0 0 / 12px 12px,
    linear-gradient(180deg, #14180f, #0a0d08);
  box-shadow: inset 0 0 40px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.6);
  overflow: visible;
}

/* Corner bolts */
.dgf-bolt {
  position: absolute; width: 12px; height: 12px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #d7dccf, #6f766a 60%, #333 100%);
  box-shadow: 0 1px 2px rgba(0,0,0,0.8), inset 0 1px 1px rgba(255,255,255,0.4);
  z-index: 4;
}
.dgf-bolt-tl { top: 2.5%; left: 2.5%; }
.dgf-bolt-tr { top: 2.5%; right: 2.5%; }
.dgf-bolt-bl { bottom: 10%; left: 2.5%; }
.dgf-bolt-br { bottom: 10%; right: 2.5%; }

/* Green LED edge strips */
.dgf-led {
  position: absolute; background: var(--dg-neon); border-radius: 3px; z-index: 3;
  box-shadow: 0 0 10px var(--dg-neon), 0 0 22px rgba(168,255,25,0.7); opacity: 0.92;
}
.dgf-led-left  { left: 2.6%; top: 4%; bottom: 12%; width: 4px; }
.dgf-led-right { right: 2.6%; top: 4%; bottom: 12%; width: 4px; }
.dgf-led-top   { top: 2.6%; left: 6%; right: 6%; height: 4px; }
.dgf-led-bottom{ bottom: 10.6%; left: 6%; right: 6%; height: 4px; }

/* ---- Holes ---- */
.dgf-hole {
  position: absolute; width: 27%; aspect-ratio: 1;
  transform: translate(-50%, -50%);
  display: grid; place-items: center;
  transition: opacity 240ms ease, filter 240ms ease;
}
.dgf-hole-throat {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 50% 38%, #0b0e0a 0%, #050705 62%, #000 100%);
  box-shadow: inset 0 6px 14px rgba(0,0,0,0.9), inset 0 -3px 8px rgba(168,255,25,0.05);
  transition: box-shadow 240ms ease, background 240ms ease;
}
.dgf-hole-ring {
  position: absolute; inset: -3%; border-radius: 50%;
  border: 2px solid rgba(168,255,25,0.75);
  box-shadow: 0 0 10px rgba(168,255,25,0.5), inset 0 0 8px rgba(168,255,25,0.35);
  transition: border-color 240ms ease, box-shadow 240ms ease, transform 240ms ease;
}
.dgf-hole-lip {
  position: absolute; inset: -6%; border-radius: 50%;
  border: 3px solid transparent;
  background: linear-gradient(180deg, #3a4034, #12150f) border-box;
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  opacity: 0.8;
}
.dgf-hole-glow {
  position: absolute; inset: -18%; border-radius: 50%;
  background: radial-gradient(circle, rgba(168,255,25,0.28), transparent 68%);
  opacity: 0; transition: opacity 240ms ease;
}
.dgf-hole-plaque {
  position: absolute; top: -22%; left: 50%; transform: translateX(-50%);
  min-width: 30px; padding: 2px 10px;
  clip-path: polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%);
  background: linear-gradient(180deg, #23281f, #0d100b);
  border: 1px solid rgba(168,255,25,0.35);
  color: var(--dg-white); font-size: clamp(11px, 3vw, 15px); font-weight: 900;
  text-align: center; line-height: 1.5; z-index: 2;
}
.dgf-hole-centre {
  position: absolute; left: 50%; top: 50%; width: 2px; height: 2px;
  transform: translate(-50%, -50%);
}

/* Anticipation pulse — sequential 1→5 during flight. */
.dgf-hole-pulse .dgf-hole-ring {
  animation: dgf-hole-pulse 900ms ease-in-out infinite;
  animation-delay: calc(var(--dgf-hole-index) * 90ms);
}
@keyframes dgf-hole-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(168,255,25,0.4), inset 0 0 6px rgba(168,255,25,0.25); }
  50% { box-shadow: 0 0 20px rgba(168,255,25,0.9), inset 0 0 14px rgba(168,255,25,0.5); }
}

/* Focus / dim as the ball nears its hole. */
.dgf-hole-focus .dgf-hole-glow { opacity: 1; }
.dgf-hole-focus .dgf-hole-ring { border-color: var(--dg-white); box-shadow: 0 0 22px rgba(168,255,25,0.9); transform: scale(1.04); }
.dgf-hole-focus .dgf-hole-throat { box-shadow: inset 0 8px 22px rgba(0,0,0,1); }
.dgf-hole-dim { opacity: 0.4; filter: brightness(0.7); }

/* Ball dropped in — throat goes fully black. */
.dgf-hole-entered .dgf-hole-throat { background: #000; box-shadow: inset 0 10px 28px rgba(0,0,0,1); }

/* Result tone on the focus hole. */
.dgf-hole-win .dgf-hole-ring { border-color: var(--dg-gold); box-shadow: 0 0 30px rgba(255,216,74,0.95); }
.dgf-hole-win .dgf-hole-glow { opacity: 1; background: radial-gradient(circle, rgba(255,216,74,0.45), transparent 66%); }
.dgf-hole-nonwin .dgf-hole-ring { border-color: rgba(168,255,25,0.85); box-shadow: 0 0 22px rgba(168,255,25,0.7); }

/* Board base / stand */
.dgf-board-base {
  position: absolute; left: 16%; right: 16%; bottom: 0; height: 7%;
  border-radius: 6px 6px 3px 3px;
  background: linear-gradient(180deg, #23281f, #0b0e08);
  box-shadow: 0 14px 26px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,255,255,0.06);
}

/* -------------------------------------------------------------------------- */
/*  Flight layer (ball + neon trail)                                          */
/* -------------------------------------------------------------------------- */
.dgf-flight { position: absolute; inset: 0; z-index: 9; pointer-events: none; transition: opacity 120ms ease; }
.dgf-flight-trail { position: absolute; inset: 0; overflow: visible; }
.dgf-trail-glow { fill: none; stroke: rgba(168,255,25,0.35); stroke-width: 14; stroke-linecap: round; stroke-linejoin: round; filter: blur(6px); }
.dgf-trail-line { fill: none; stroke: var(--dg-neon); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 6px rgba(168,255,25,0.8)); }
.dgf-trail-streak { fill: none; stroke: #eaffd0; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.dgf-trail-particle { fill: #eaffd0; filter: drop-shadow(0 0 4px rgba(168,255,25,0.9)); }
.dgf-flight-ball { position: absolute; top: 0; left: 0; will-change: transform; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.5)); }

/* -------------------------------------------------------------------------- */
/*  Ball tray + tap CTA                                                       */
/* -------------------------------------------------------------------------- */
.dgf-tray-area {
  position: absolute; left: 0; right: 0; bottom: calc(env(safe-area-inset-bottom) + clamp(12px, 3vh, 26px));
  z-index: 6;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 0 12px;
}
.dgf-tap-cta { display: flex; flex-direction: column; align-items: center; gap: 4px; transition: opacity 200ms ease; }
.dgf-tap-cta-hidden { opacity: 0; }
.dgf-tap-chevrons { display: flex; flex-direction: column; align-items: center; color: var(--dg-neon); line-height: 0.5; }
.dgf-tap-chevrons span {
  width: 14px; height: 14px; border-right: 3px solid currentColor; border-bottom: 3px solid currentColor;
  transform: rotate(-135deg); margin-top: -4px; opacity: 0.4;
  animation: dgf-chevron 1.4s ease-in-out infinite;
}
.dgf-tap-chevrons span:nth-child(2) { animation-delay: 0.18s; }
.dgf-tap-chevrons span:nth-child(3) { animation-delay: 0.36s; }
@keyframes dgf-chevron { 0%,100% { opacity: 0.25; } 50% { opacity: 1; } }
.dgf-tap-label {
  font-size: clamp(13px, 3.6vw, 17px); font-weight: 900; letter-spacing: 0.24em; color: var(--dg-white);
  position: relative; padding: 0 20px;
}
.dgf-tap-label::before, .dgf-tap-label::after {
  content: ""; position: absolute; top: 50%; width: 16px; height: 2px; background: var(--dg-neon);
}
.dgf-tap-label::before { left: -6px; } .dgf-tap-label::after { right: -6px; }

.dgf-tray-platform {
  width: 100%; max-width: 420px;
  padding: 10px 12px; border-radius: 18px;
  background: linear-gradient(180deg, rgba(26,30,24,0.95), rgba(8,11,8,0.95));
  border: 1px solid rgba(168,255,25,0.25);
  box-shadow: 0 -6px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 24px rgba(168,255,25,0.15);
}
.dgf-tray { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.dgf-ball-btn {
  position: relative; flex: 1 1 0; display: grid; place-items: center;
  background: transparent; border: none; padding: 0; cursor: pointer;
  transition: transform 260ms cubic-bezier(0.2,0.9,0.3,1), opacity 220ms ease;
  will-change: transform;
}
.dgf-ball-btn:disabled { cursor: default; }
.dgf-ball-btn:focus-visible { outline: 3px solid var(--dg-neon); outline-offset: 3px; border-radius: 50%; }
.dgf-ball-inner { position: relative; display: grid; place-items: center; }
.dgf-ball-badge {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: clamp(13px, 3.6vw, 18px); font-weight: 900; color: var(--dg-white);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.8);
  -webkit-text-stroke: 0.5px rgba(0,0,0,0.5);
  pointer-events: none;
}
.dgf-ball-idle { animation: dgf-ball-bob 2.6s ease-in-out infinite; }
.dgf-ball-btn:nth-child(2).dgf-ball-idle { animation-delay: 0.2s; }
.dgf-ball-btn:nth-child(3).dgf-ball-idle { animation-delay: 0.4s; }
.dgf-ball-btn:nth-child(4).dgf-ball-idle { animation-delay: 0.6s; }
.dgf-ball-btn:nth-child(5).dgf-ball-idle { animation-delay: 0.8s; }
@keyframes dgf-ball-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.dgf-ball-btn:not(:disabled):hover { transform: translateY(-4px) scale(1.06); }
.dgf-ball-chosen { transform: translateY(-16px) scale(1.24); z-index: 3; filter: drop-shadow(0 0 16px rgba(168,255,25,0.7)); }
.dgf-ball-dim { opacity: 0.32; filter: grayscale(0.4) brightness(0.7); }
.dgf-ball-hidden { opacity: 0; }
.dgf-ball-ring {
  position: absolute; inset: -14%; border-radius: 50%;
  border: 2px solid var(--dg-neon); box-shadow: 0 0 18px rgba(168,255,25,0.8);
  animation: dgf-ring-pulse 700ms ease-out infinite;
}
@keyframes dgf-ring-pulse { 0% { transform: scale(0.9); opacity: 0.9; } 100% { transform: scale(1.35); opacity: 0; } }

/* -------------------------------------------------------------------------- */
/*  Impact camera feedback                                                    */
/* -------------------------------------------------------------------------- */
.dgf-punch { animation: dgf-punch 320ms ease-out; }
.dgf-shake { animation: dgf-punch 320ms ease-out, dgf-shake 320ms ease-out; }
@keyframes dgf-punch { 0% { transform: scale(1); } 30% { transform: scale(1.014); } 100% { transform: scale(1); } }
@keyframes dgf-shake { 0%,100% { translate: 0 0; } 25% { translate: -3px 1px; } 50% { translate: 3px -1px; } 75% { translate: -2px 0; } }

/* -------------------------------------------------------------------------- */
/*  Prize reveal panel                                                        */
/* -------------------------------------------------------------------------- */
.dgf-panel {
  position: absolute; left: 12px; right: 12px; bottom: calc(env(safe-area-inset-bottom) + 14px); z-index: 30;
  padding: 22px 20px 18px; border-radius: 20px;
  background: linear-gradient(180deg, rgba(17,23,18,0.98), rgba(6,9,6,0.99));
  border: 1px solid rgba(168,255,25,0.4);
  border-top: 3px solid var(--dg-neon);
  box-shadow: 0 -20px 60px rgba(0,0,0,0.7), 0 -2px 30px rgba(168,255,25,0.3);
  transform: translateY(120%); opacity: 0;
  transition: transform 460ms cubic-bezier(0.2,0.9,0.3,1), opacity 300ms ease;
  text-align: center;
}
.dgf-panel-in { transform: translateY(0); opacity: 1; }
.dgf-panel-reduced { transition: opacity 200ms ease; transform: none; }
.dgf-panel-edge { position: absolute; inset: 0; border-radius: 20px; pointer-events: none; box-shadow: inset 0 0 40px rgba(168,255,25,0.08); }
.dgf-panel-body { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.dgf-panel-eyebrow { font-size: 14px; font-weight: 900; letter-spacing: 0.2em; text-transform: uppercase; }
.dgf-eyebrow-win { color: var(--dg-gold); text-shadow: 0 0 18px rgba(255,216,74,0.6); }
.dgf-eyebrow-none { color: var(--dg-neon); }
.dgf-panel-amount { display: flex; flex-direction: column; align-items: center; gap: 0; width: 100%; padding: 0 8px; }
.dgf-panel-amount-value {
  font-weight: 900; line-height: 0.9; letter-spacing: -0.02em;
  font-size: clamp(42px, 15vw, 76px); max-width: 100%; white-space: nowrap;
  background: linear-gradient(180deg, #fff7d6, var(--dg-gold) 55%, #e0a800);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 0 30px rgba(255,216,74,0.4);
}
.dgf-panel-amount-unit { font-size: clamp(16px, 4.6vw, 24px); font-weight: 900; letter-spacing: 0.18em; color: var(--dg-white); }
/* Manual / physical prize: the title can be long, so it wraps and uses a
   smaller, balanced size instead of the huge single-line money display. */
.dgf-amount-manual { font-size: clamp(24px, 8vw, 40px); line-height: 1.02; white-space: normal; text-wrap: balance; }
.dgf-panel-img { max-width: min(62%, 200px); max-height: 128px; object-fit: contain; margin: 2px auto 6px; border-radius: 12px; filter: drop-shadow(0 6px 18px rgba(0,0,0,0.5)); }
.dgf-value-pop { animation: dgf-value-pop 460ms cubic-bezier(0.2,1.2,0.4,1) both; }
@keyframes dgf-value-pop { 0% { transform: scale(0.5); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
.dgf-panel-headline { font-size: clamp(20px, 5.4vw, 30px); font-weight: 900; text-transform: uppercase; color: var(--dg-white); }
.dgf-panel-support { font-size: 15px; font-weight: 800; letter-spacing: 0.04em; color: var(--dg-neon); }
.dgf-panel-support2 { margin-top: 2px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; color: var(--dg-muted); }
.dgf-panel-progress { margin-top: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--dg-muted); }

/* Tone accents */
.dgf-panel-big { border-top-color: var(--dg-gold); box-shadow: 0 -20px 60px rgba(0,0,0,0.7), 0 -2px 34px rgba(255,216,74,0.5); }
.dgf-panel-cash .dgf-panel-amount-value { background: linear-gradient(180deg, #eaffe0, var(--dg-cash) 55%, #38c400); -webkit-background-clip: text; background-clip: text; }
.dgf-panel-credit { border-top-color: var(--dg-neon); }
.dgf-panel-credit .dgf-panel-amount-value { background: linear-gradient(180deg, #eaffd6, var(--dg-neon) 55%, #6fb000); -webkit-background-clip: text; background-clip: text; }
.dgf-panel-mystery { border-top-color: var(--dg-gold); }
.dgf-panel-none { border-top-color: rgba(168,255,25,0.6); box-shadow: 0 -20px 60px rgba(0,0,0,0.7); }

.dgf-next-btn {
  margin-top: 14px; width: 100%; padding: 15px 18px; border-radius: 14px; border: none; cursor: pointer;
  background: linear-gradient(180deg, var(--dg-neon), var(--dg-neon2));
  color: #06200a; font-size: 17px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase;
  box-shadow: 0 8px 24px rgba(168,255,25,0.4), inset 0 1px 0 rgba(255,255,255,0.4);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  transition: transform 140ms ease, box-shadow 140ms ease;
}
.dgf-next-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(168,255,25,0.55); }
.dgf-next-btn:active { transform: translateY(0); }
.dgf-next-btn:focus-visible { outline: 3px solid var(--dg-white); outline-offset: 3px; }
.dgf-next-sub { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #0a3311; }

/* -------------------------------------------------------------------------- */
/*  Confetti                                                                  */
/* -------------------------------------------------------------------------- */
.dgf-confetti { position: absolute; inset: 0; z-index: 29; pointer-events: none; overflow: hidden; }
.dgf-confetti-piece { position: absolute; top: -12px; width: 9px; height: 14px; border-radius: 2px; opacity: 0; animation: dgf-confetti-fall linear forwards; }
@keyframes dgf-confetti-fall {
  0% { opacity: 0; transform: translateY(-10px) rotate(0deg); }
  8% { opacity: 1; }
  100% { opacity: 0.9; transform: translateY(120vh) rotate(720deg); }
}

/* -------------------------------------------------------------------------- */
/*  Summary panel                                                             */
/* -------------------------------------------------------------------------- */
.dgf-summary {
  position: absolute; left: 12px; right: 12px; bottom: calc(env(safe-area-inset-bottom) + 14px); z-index: 30;
  padding: 22px 20px; border-radius: 20px;
  background: linear-gradient(180deg, rgba(17,23,18,0.98), rgba(6,9,6,0.99));
  border: 1px solid rgba(168,255,25,0.4); border-top: 3px solid var(--dg-neon);
  box-shadow: 0 -20px 60px rgba(0,0,0,0.7), 0 -2px 30px rgba(168,255,25,0.3);
  transform: translateY(120%); opacity: 0; text-align: center;
  transition: transform 460ms cubic-bezier(0.2,0.9,0.3,1), opacity 300ms ease;
}
.dgf-summary.dgf-panel-in { transform: translateY(0); opacity: 1; }
.dgf-summary-grid { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
.dgf-summary-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: 10px; background: rgba(168,255,25,0.06);
  border: 1px solid rgba(168,255,25,0.16); font-weight: 800;
}

/* -------------------------------------------------------------------------- */
/*  How-it-works overlay                                                      */
/* -------------------------------------------------------------------------- */
.dgf-help-scrim {
  position: absolute; inset: 0; z-index: 50; display: grid; place-items: center;
  padding: 20px; background: rgba(5,7,5,0.82); backdrop-filter: blur(6px);
  animation: dgf-fade 180ms ease both;
}
@keyframes dgf-fade { from { opacity: 0; } to { opacity: 1; } }
.dgf-help-card {
  position: relative; width: 100%; max-width: 360px;
  padding: 24px 22px; border-radius: 20px;
  background: linear-gradient(180deg, var(--dg-panel), #060906);
  border: 1px solid rgba(168,255,25,0.35); box-shadow: 0 30px 80px rgba(0,0,0,0.7);
}
.dgf-help-close {
  position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 50%;
  border: 1px solid rgba(247,247,242,0.3); background: transparent; color: var(--dg-white);
  cursor: pointer; font-size: 13px;
}
.dgf-help-title { font-size: 20px; font-weight: 900; letter-spacing: 0.1em; color: var(--dg-neon); margin: 0 0 16px; text-align: center; }
.dgf-help-steps { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.dgf-help-steps li { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; line-height: 1.5; color: var(--dg-white); }
.dgf-help-steps strong { color: var(--dg-neon); }
.dgf-help-step-n {
  flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  background: var(--dg-neon); color: #06200a; font-weight: 900; font-size: 14px;
}
.dgf-help-results { padding: 14px; border-radius: 12px; background: rgba(168,255,25,0.06); border: 1px solid rgba(168,255,25,0.16); }
.dgf-help-results-title { margin: 0 0 8px; font-size: 12px; font-weight: 900; letter-spacing: 0.14em; color: var(--dg-neon); }
.dgf-help-results ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: var(--dg-muted); }
.dgf-help-foot { margin: 14px 0 0; font-size: 12px; color: var(--dg-muted); text-align: center; }

/* -------------------------------------------------------------------------- */
/*  Sound toggle + rotate prompt                                              */
/* -------------------------------------------------------------------------- */
.dgf-sound-toggle {
  position: absolute; top: calc(env(safe-area-inset-top) + 10px); right: 14px; z-index: 7;
  width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  border: 1px solid rgba(247,247,242,0.35); background: rgba(5,7,5,0.5); color: var(--dg-white);
  cursor: pointer; backdrop-filter: blur(6px); transition: border-color 140ms ease, transform 140ms ease;
}
.dgf-sound-toggle:hover { border-color: var(--dg-neon); transform: scale(1.06); }

.dgf-rotate {
  position: absolute; inset: 0; z-index: 55; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 30px;
  background: rgba(5,7,5,0.94);
}
.dgf-rotate-icon { color: var(--dg-neon); animation: dgf-rotate-tilt 2s ease-in-out infinite; }
@keyframes dgf-rotate-tilt { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-90deg); } }
.dgf-rotate-title { font-size: 22px; font-weight: 900; letter-spacing: 0.1em; margin: 0; }
.dgf-rotate-sub { font-size: 13px; color: var(--dg-muted); max-width: 240px; margin: 0; }

/* -------------------------------------------------------------------------- */
/*  Dev controls (sidebar on desktop, bottom sheet on mobile)                 */
/* -------------------------------------------------------------------------- */
.dgf-side-controls { display: none; }
@media (min-width: 1024px) {
  .dgf-side-controls {
    display: block; width: 320px; max-height: 94dvh; overflow-y: auto;
    padding: 18px; border-radius: 18px;
    background: rgba(12,16,13,0.9); border: 1px solid rgba(168,255,25,0.18);
  }
}
.dgf-controls-trigger {
  position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 40;
  padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(168,255,25,0.4);
  background: rgba(12,16,13,0.92); color: var(--dg-neon); font-size: 11px; font-weight: 800;
  letter-spacing: 0.16em; cursor: pointer; backdrop-filter: blur(6px);
}
@media (min-width: 1024px) { .dgf-controls-trigger { display: none; } }

.dgf-sheet-scrim { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; }
.dgf-sheet {
  position: relative; width: 100%; max-height: 80dvh; overflow-y: auto;
  padding: 20px 18px 30px; border-radius: 20px 20px 0 0;
  background: linear-gradient(180deg, var(--dg-panel), #060906); border-top: 1px solid rgba(168,255,25,0.3);
}
.dgf-sheet-close { position: absolute; top: 12px; right: 14px; width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(247,247,242,0.3); background: transparent; color: var(--dg-white); cursor: pointer; }

.dgf-controls { display: flex; flex-direction: column; gap: 16px; }
.dgf-ctl-title { font-size: 12px; font-weight: 900; letter-spacing: 0.16em; color: var(--dg-neon); margin: 0; }
.dgf-ctl-group { display: flex; flex-direction: column; gap: 8px; }
.dgf-ctl-head { display: flex; align-items: center; justify-content: space-between; }
.dgf-ctl-badge { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; color: var(--dg-muted); text-transform: uppercase; }
.dgf-ctl-note { margin: 2px 0 0; font-size: 11px; line-height: 1.4; color: var(--dg-muted); }
.dgf-ctl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dgf-chip {
  padding: 7px 12px; border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 700;
  border: 1px solid rgba(247,247,242,0.2); background: transparent; color: var(--dg-muted);
  transition: all 140ms ease;
}
.dgf-chip:hover { border-color: rgba(168,255,25,0.5); color: var(--dg-white); }
.dgf-chip-on { background: var(--dg-neon); border-color: var(--dg-neon); color: #06200a; }

.dgf-ctl-toggles { display: flex; flex-direction: column; gap: 8px; }
.dgf-ctl-toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; }
.dgf-ctl-toggle-label { font-size: 13px; color: var(--dg-white); }
.dgf-ctl-track { position: relative; width: 40px; height: 22px; border-radius: 999px; background: rgba(247,247,242,0.18); transition: background 140ms ease; flex: none; }
.dgf-ctl-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.dgf-ctl-thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 140ms ease; }
.dgf-ctl-toggle input:checked + .dgf-ctl-track { background: var(--dg-neon); }
.dgf-ctl-toggle input:checked + .dgf-ctl-track .dgf-ctl-thumb { transform: translateX(18px); }
.dgf-ctl-reset {
  margin-top: 4px; padding: 10px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(247,247,242,0.25); background: transparent; color: var(--dg-white);
  font-weight: 800; letter-spacing: 0.1em; font-size: 12px;
}
.dgf-ctl-reset:hover { border-color: var(--dg-neon); color: var(--dg-neon); }

/* -------------------------------------------------------------------------- */
/*  Dev guide overlays                                                        */
/* -------------------------------------------------------------------------- */
.dgf-state-badge {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 45;
  padding: 4px 10px; border-radius: 6px; background: rgba(0,0,0,0.8); border: 1px solid rgba(168,255,25,0.5);
  color: var(--dg-neon); font-family: var(--font-mono, monospace); font-size: 11px; letter-spacing: 0.08em;
}
.dgf-guide-svg { position: absolute; inset: 0; z-index: 44; pointer-events: none; overflow: visible; }
.dgf-guide-line { stroke: rgba(255,90,90,0.8); stroke-width: 1.5; stroke-dasharray: 5 5; }
.dgf-guide-ctrl { fill: rgba(255,216,74,0.9); }
.dgf-guide-origin { fill: rgba(90,180,255,0.9); }
.dgf-guide-endpoint { fill: rgba(93,255,0,0.9); }
.dgf-hole-bounds { outline: 1px dashed rgba(90,180,255,0.8); }
.dgf-hole-centre-on { background: #ff5a5a; width: 6px; height: 6px; box-shadow: 0 0 6px #ff5a5a; }
.dgf-board-bounds { outline: 2px dashed rgba(255,216,74,0.8); }
.dgf-character-bounds { outline: 2px dashed rgba(90,180,255,0.8); }

/* -------------------------------------------------------------------------- */
/*  Stadium light beams + energy tiers (cosmetic only)                        */
/* -------------------------------------------------------------------------- */
.dgf-env-beams {
  position: absolute; inset: -10% -20% auto -20%; height: 70%;
  background:
    conic-gradient(from 200deg at 22% -6%, transparent 0deg, rgba(210,255,180,0.10) 6deg, transparent 12deg),
    conic-gradient(from 160deg at 78% -6%, transparent 0deg, rgba(210,255,180,0.10) 6deg, transparent 12deg);
  filter: blur(6px); mix-blend-mode: screen; opacity: 0.6;
}
/* Each tier lifts the pitch glow + beams a little; NEVER changes gameplay. */
.dgf-tier-raised    .dgf-env-glow  { filter: brightness(1.06) saturate(1.05); }
.dgf-tier-charged   .dgf-env-glow  { filter: brightness(1.12) saturate(1.12); }
.dgf-tier-charged   .dgf-env-beams { opacity: 0.75; }
.dgf-tier-bigballer .dgf-env-glow  { filter: brightness(1.2) saturate(1.2); }
.dgf-tier-bigballer .dgf-env-beams { opacity: 0.9; animation: dgf-beam-sweep 7s ease-in-out infinite; }
.dgf-tier-bigballer .dgf-brand-title { filter: drop-shadow(0 0 22px rgba(168,255,25,0.5)); }
.dgf-tier-max       .dgf-env-glow  { filter: brightness(1.28) saturate(1.3); }
.dgf-tier-max       .dgf-env-beams { opacity: 1; animation: dgf-beam-sweep 6s ease-in-out infinite; }
.dgf-tier-max       .dgf-brand-title { filter: drop-shadow(0 0 30px rgba(168,255,25,0.65)); }
.dgf-tier-max       .dgf-tray-platform { box-shadow: 0 -6px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 40px rgba(168,255,25,0.32); }
@keyframes dgf-beam-sweep { 0%,100% { transform: translateX(-2%) skewX(-2deg); } 50% { transform: translateX(2%) skewX(2deg); } }

/* -------------------------------------------------------------------------- */
/*  Ticket messaging (LOADED / CHECKED / chances)                             */
/* -------------------------------------------------------------------------- */
.dgf-tickets {
  margin-top: clamp(6px, 1.6vh, 12px);
  display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center;
  transition: opacity 240ms ease;
}
.dgf-tickets-loaded {
  font-size: clamp(13px, 3.4vw, 17px); font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--dg-neon);
  padding: 3px 14px; border-radius: 999px;
  background: rgba(168,255,25,0.1); border: 1px solid rgba(168,255,25,0.3);
  box-shadow: 0 0 18px rgba(168,255,25,0.18);
}
.dgf-tickets-chances {
  font-size: clamp(10px, 2.7vw, 13px); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--dg-muted);
}
.dgf-tickets-range {
  font-size: clamp(9px, 2.4vw, 11px); font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--dg-muted); opacity: 0.8;
}
.dgf-tickets-compact { margin-top: 6px; opacity: 0.9; }
.dgf-tickets-compact .dgf-tickets-loaded { font-size: clamp(11px, 2.8vw, 13px); padding: 2px 10px; }

/* -------------------------------------------------------------------------- */
/*  Staged opening entrance                                                   */
/* -------------------------------------------------------------------------- */
.dgf-run-entrance .dgf-entrance-brand { animation: dgf-enter-pop 620ms cubic-bezier(0.2,0.9,0.3,1) both; }
.dgf-run-entrance .dgf-entrance-tickets { animation: dgf-fade-up 500ms ease both; animation-delay: 240ms; }
.dgf-run-entrance .dgf-entrance-board { animation: dgf-enter-board 720ms cubic-bezier(0.2,0.9,0.3,1) both; animation-delay: 180ms; }
.dgf-run-entrance .dgf-entrance-tray { animation: dgf-enter-tray 620ms cubic-bezier(0.2,0.9,0.3,1) both; animation-delay: 460ms; }
@keyframes dgf-enter-pop { 0% { opacity: 0; transform: scale(0.7) translateY(-12px); } 60% { opacity: 1; transform: scale(1.06); } 100% { transform: scale(1); } }
@keyframes dgf-enter-board { 0% { opacity: 0; transform: translateY(18px) scale(0.9); } 100% { opacity: 1; transform: none; } }
@keyframes dgf-enter-tray { 0% { opacity: 0; transform: translateY(60px); } 100% { opacity: 1; transform: none; } }

/* "BIG BALLER MODE" intro beat (100+ tickets). */
.dgf-bigballer {
  position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; pointer-events: none;
  animation: dgf-bigballer 900ms ease-in forwards;
}
.dgf-bigballer span {
  font-size: clamp(30px, 9vw, 58px); font-weight: 900; font-style: italic; letter-spacing: 0.04em;
  text-transform: uppercase;
  background: linear-gradient(180deg, #fff7d6, var(--dg-gold) 55%, #e0a800);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 30px rgba(255,216,74,0.6));
}
@keyframes dgf-bigballer {
  0% { opacity: 0; transform: scale(1.4); }
  25% { opacity: 1; transform: scale(1); }
  75% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.92); }
}

/* -------------------------------------------------------------------------- */
/*  Board depth details + suspense                                            */
/* -------------------------------------------------------------------------- */
.dgf-board-brushed {
  position: absolute; inset: 0; border-radius: 18px; pointer-events: none; opacity: 0.5;
  background: repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 3px);
}
.dgf-board-scratches {
  position: absolute; inset: 0; border-radius: 18px; pointer-events: none; opacity: 0.4;
  background:
    linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.05) 42%, transparent 44%),
    linear-gradient(75deg, transparent 60%, rgba(0,0,0,0.3) 62%, transparent 64%);
}
.dgf-rivet {
  position: absolute; width: 6px; height: 6px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #aeb4a6, #5a6154 60%, #2a2f29 100%);
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.3), 0 1px 2px rgba(0,0,0,0.7); z-index: 4;
}
.dgf-rivet-t1 { top: 3%; left: 34%; } .dgf-rivet-t2 { top: 3%; right: 34%; }
.dgf-rivet-b1 { bottom: 11%; left: 34%; } .dgf-rivet-b2 { bottom: 11%; right: 34%; }

.dgf-hole-reflection {
  position: absolute; left: 26%; top: 20%; width: 34%; height: 22%; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,0.16), transparent 70%);
  pointer-events: none;
}

/* Suspense: board darkens, LEDs dim, focus hole stays lit. */
.dgf-board-suspense .dgf-board-face { filter: brightness(0.5); transition: filter 220ms ease; }
.dgf-board-suspense .dgf-led { opacity: 0.4; transition: opacity 220ms ease; }
.dgf-board-suspense .dgf-hole-focus { filter: none; }
.dgf-board-win .dgf-led { animation: dgf-led-flare 500ms ease-out; }
@keyframes dgf-led-flare { 0%,100% { opacity: 0.92; } 40% { opacity: 1; box-shadow: 0 0 18px var(--dg-neon), 0 0 40px rgba(168,255,25,0.9); } }

/* Suspense veil over the whole stage. */
.dgf-suspense-veil {
  position: absolute; inset: 0; z-index: 12; pointer-events: none; opacity: 0;
  background: radial-gradient(60% 50% at 50% 42%, transparent 30%, rgba(0,0,0,0.55) 100%);
  transition: opacity 220ms ease;
}
.dgf-suspense-veil-on { opacity: 1; }

/* -------------------------------------------------------------------------- */
/*  Hole-entry mask (front lip occludes the ball as it sinks)                 */
/* -------------------------------------------------------------------------- */
.dgf-entry-mask {
  position: absolute; z-index: 10; transform: translate(-50%, -50%); pointer-events: none;
  border-radius: 50%;
}
.dgf-entry-throat {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 50% 40%, #0a0d08 0%, #000 70%);
  clip-path: inset(48% 0 0 0);
}
.dgf-entry-lip {
  position: absolute; inset: -6%; border-radius: 50%;
  border-bottom: 4px solid rgba(58,64,52,0.9);
  box-shadow: 0 3px 8px rgba(0,0,0,0.7);
  clip-path: inset(50% 0 0 0);
}
.dgf-entry-mask-active .dgf-entry-lip { border-bottom-color: rgba(168,255,25,0.5); }

/* -------------------------------------------------------------------------- */
/*  Winning hole = SOURCE of the celebration                                  */
/* -------------------------------------------------------------------------- */
.dgf-hole-shock {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  border: 3px solid rgba(255,216,74,0.9);
  animation: dgf-shock 620ms ease-out forwards;
}
.dgf-hole-shock-2 { border-color: rgba(168,255,25,0.8); animation-delay: 140ms; }
@keyframes dgf-shock {
  0% { opacity: 0.9; transform: scale(0.6); }
  100% { opacity: 0; transform: scale(2.6); }
}
.dgf-hole-rays {
  position: absolute; left: 50%; top: 50%; width: 320%; height: 320%;
  transform: translate(-50%, -50%); pointer-events: none; mix-blend-mode: screen;
  background: conic-gradient(from 0deg,
    rgba(255,216,74,0.5) 0deg, transparent 8deg, transparent 30deg,
    rgba(168,255,25,0.4) 40deg, transparent 48deg, transparent 82deg,
    rgba(255,216,74,0.5) 92deg, transparent 100deg, transparent 150deg,
    rgba(168,255,25,0.4) 162deg, transparent 170deg, transparent 360deg);
  opacity: 0; animation: dgf-rays-in 640ms ease-out forwards, dgf-spin 8s linear infinite;
}
.dgf-hole-rays-big { width: 480%; height: 480%; }
@keyframes dgf-rays-in { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.4); } 100% { opacity: 0.8; transform: translate(-50%,-50%) scale(1); } }
.dgf-hole-sparks {
  position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; transform: translate(-50%,-50%);
  pointer-events: none;
  background:
    radial-gradient(circle, var(--dg-gold) 40%, transparent 42%);
  box-shadow:
    0 -60px 0 -2px var(--dg-neon), 42px -42px 0 -3px var(--dg-gold), 60px 0 0 -2px var(--dg-neon),
    42px 42px 0 -3px var(--dg-gold), 0 60px 0 -2px var(--dg-neon), -42px 42px 0 -3px var(--dg-gold),
    -60px 0 0 -2px var(--dg-neon), -42px -42px 0 -3px var(--dg-gold);
  animation: dgf-sparks 640ms ease-out forwards;
}
@keyframes dgf-sparks { 0% { opacity: 1; transform: translate(-50%,-50%) scale(0.3); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.8); } }
.dgf-hole-pulseout {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  border: 3px solid rgba(168,255,25,0.8);
  animation: dgf-shock 700ms ease-out forwards;
}
.dgf-hole-bigwin .dgf-hole-ring { border-color: var(--dg-gold); box-shadow: 0 0 40px rgba(255,216,74,1), inset 0 0 16px rgba(255,216,74,0.6); }
.dgf-hole-bigwin .dgf-hole-throat { background: radial-gradient(circle at 50% 40%, rgba(255,216,74,0.35), #000 70%); }

/* Stronger celebration burst behind a big-win DG. */
.dgf-win-flash-big {
  background: radial-gradient(circle, rgba(255,216,74,0.8), rgba(168,255,25,0.4) 46%, transparent 72%);
}
.dgf-win-flash-big.dgf-win-flash-on { animation: dgf-winflash 700ms ease-out forwards; }
.dgf-dg-scored-in { animation: dgf-dg-pop var(--dgf-enter, 320ms) cubic-bezier(0.2,1.1,0.3,1) both; }
@keyframes dgf-dg-pop { 0% { transform: scale(1.08) translateY(6px); } 100% { transform: none; } }

/* -------------------------------------------------------------------------- */
/*  "THERE'S ANOTHER WIN!" interstitial                                       */
/* -------------------------------------------------------------------------- */
.dgf-interstitial {
  position: absolute; inset: 0; z-index: 31; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; pointer-events: none;
  background: radial-gradient(60% 50% at 50% 50%, rgba(5,7,5,0.78), rgba(5,7,5,0.35) 70%, transparent);
}
.dgf-interstitial-wait {
  font-size: clamp(12px, 3.4vw, 16px); font-weight: 800; letter-spacing: 0.3em; text-transform: uppercase;
  color: var(--dg-muted); animation: dgf-fade 200ms ease both;
}
.dgf-interstitial-main {
  font-size: clamp(28px, 8.4vw, 52px); font-weight: 900; font-style: italic; letter-spacing: 0.01em;
  text-transform: uppercase;
  background: linear-gradient(180deg, #f3fff0, var(--dg-neon) 60%, #7dd400);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 24px rgba(168,255,25,0.5));
  animation: dgf-enter-pop 520ms cubic-bezier(0.2,0.9,0.3,1) both;
}
/* Tray reload beat (>5 wins): tighter, "new balls" energy reset. */
.dgf-interstitial-reload .dgf-interstitial-main { font-size: clamp(22px, 6.6vw, 40px); }

/* Green energy reset on the tray when a fresh set of five is loaded. */
.dgf-tray-reloading .dgf-tray { animation: dgf-tray-reload 520ms ease-out both; }
@keyframes dgf-tray-reload {
  0% { opacity: 0.15; transform: translateY(14px) scale(0.9); filter: brightness(2) saturate(1.6) drop-shadow(0 0 18px rgba(168,255,25,0.8)); }
  55% { opacity: 1; filter: brightness(1.5) drop-shadow(0 0 22px rgba(168,255,25,0.7)); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: none; }
}

/* -------------------------------------------------------------------------- */
/*  Prize panel — win counter, value shake + light sweep, big rays            */
/* -------------------------------------------------------------------------- */
.dgf-win-counter {
  display: inline-block; margin-left: 10px; padding: 2px 8px; border-radius: 999px;
  font-size: 10px; letter-spacing: 0.12em; color: var(--dg-white);
  background: rgba(168,255,25,0.16); border: 1px solid rgba(168,255,25,0.4); vertical-align: middle;
}
.dgf-panel-amount-value { position: relative; display: inline-block; overflow: hidden; }
.dgf-value-sweep {
  position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.85), transparent);
  mix-blend-mode: overlay; animation: dgf-sweep 720ms ease-out 120ms both;
}
@keyframes dgf-sweep { 0% { left: -60%; } 100% { left: 130%; } }
.dgf-value-shake { animation: dgf-value-pop 460ms cubic-bezier(0.2,1.2,0.4,1) both, dgf-value-quake 420ms ease-out 460ms; }
@keyframes dgf-value-quake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 50% { transform: translateX(3px); } 75% { transform: translateX(-2px); } }
.dgf-panel .dgf-rays {
  position: absolute; left: 50%; top: 30%; width: 200%; height: 200%;
  transform: translate(-50%, -50%); opacity: 0.6; mix-blend-mode: screen; pointer-events: none;
  animation: dgf-spin 9s linear infinite;
}

/* -------------------------------------------------------------------------- */
/*  Summary panel (LOADED → GAME → CHECKED)                                   */
/* -------------------------------------------------------------------------- */
.dgf-summary-none { border-top-color: rgba(168,255,25,0.7); }
.dgf-summary-win { border-top-color: var(--dg-gold); box-shadow: 0 -20px 60px rgba(0,0,0,0.7), 0 -2px 34px rgba(255,216,74,0.4); }
.dgf-summary-checked { font-size: 13px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--dg-muted); margin: 0; }
.dgf-summary-winline { margin: 8px 0 4px; font-size: clamp(20px, 5.4vw, 28px); font-weight: 900; text-transform: uppercase; color: var(--dg-white); }
.dgf-summary-wincount { color: var(--dg-neon); font-size: 1.3em; }
.dgf-summary-nowin { margin: 8px 0 2px; font-size: clamp(19px, 5vw, 26px); font-weight: 900; text-transform: uppercase; color: var(--dg-white); }

/* Itemised award list (shown BEFORE aggregate totals). */
.dgf-summary-list {
  list-style: none; margin: 10px 0 4px; padding: 0; display: flex; flex-direction: column; gap: 5px;
  max-height: 40vh; overflow-y: auto;
}
.dgf-summary-item {
  display: flex; align-items: baseline; justify-content: center; gap: 8px; padding: 6px 12px;
  border-radius: 11px; background: rgba(168,255,25,0.055); border: 1px solid rgba(168,255,25,0.16);
  animation: dgf-enter-pop 360ms cubic-bezier(0.2,0.9,0.3,1) both;
}
.dgf-summary-item-x { font-size: 13px; font-weight: 800; color: var(--dg-muted); }
.dgf-summary-item-amt { font-size: clamp(20px, 5.4vw, 27px); font-weight: 900; line-height: 1; }
.dgf-summary-item-label { font-size: 11px; font-weight: 800; letter-spacing: 0.14em; color: var(--dg-muted); text-transform: uppercase; }

/* Aggregate totals (shown AFTER the itemised list). */
.dgf-summary-totals {
  display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; margin: 10px 0 2px;
  padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);
}
.dgf-summary-total {
  display: flex; flex-direction: column; align-items: center; min-width: 108px; padding: 8px 14px;
  border-radius: 13px; background: rgba(255,255,255,0.04);
}
.dgf-summary-total-label { font-size: 10px; font-weight: 800; letter-spacing: 0.16em; color: var(--dg-muted); text-transform: uppercase; }
.dgf-summary-total-amt { margin-top: 3px; font-size: clamp(24px, 7vw, 36px); font-weight: 900; line-height: 1; }
.dgf-summary-checked { margin-top: 8px; }
.dgf-summary-draw { margin: 6px 0 0; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: var(--dg-muted); text-transform: uppercase; }
.dgf-summary-draw-strong { color: var(--dg-neon); font-size: 13px; }

/* -------------------------------------------------------------------------- */
/*  Reduced motion                                                            */
/* -------------------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .dgf-page * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; }
}
`
