import Image from "next/image"
import { PreRegisterForm } from "@/components/pre-register/PreRegisterForm"

export default function PreRegisterPage() {
  return (
    <>
      <style>{`
        @keyframes float-heart {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          50% { opacity: 0.8; transform: translateY(-120px) scale(1.1) translateX(-8px); }
          100% { opacity: 0; transform: translateY(-260px) scale(0.6) translateX(12px); }
        }
        @keyframes pulse-live {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 30px rgba(255,0,100,0.3), 0 0 60px rgba(255,0,100,0.1); }
          50% { box-shadow: 0 0 50px rgba(255,0,100,0.5), 0 0 100px rgba(255,0,100,0.2); }
        }
      `}</style>

      <div className="relative min-h-screen overflow-hidden bg-black">

        {/* ===== LIVE badge ===== */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 shadow-lg"
            style={{ boxShadow: "0 0 20px rgba(255,0,0,0.4)" }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full bg-white"
              style={{ animation: "pulse-live 1.2s ease-in-out infinite" }}
            />
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              LIVE
            </span>
          </div>
        </div>

        {/* ===== Floating hearts ===== */}
        <div
          className="pointer-events-none absolute right-4 bottom-40 z-30 flex flex-col items-center gap-1 md:right-8 md:bottom-60"
          aria-hidden="true"
        >
          {["#ff2d55", "#ff6b8a", "#FFD700", "#ff4081", "#ff9ec4", "#FFD700", "#ff2d55", "#ff6b8a"].map((color, i) => (
            <span
              key={i}
              className="text-lg"
              style={{
                color,
                animation: `float-heart ${2.5 + i * 0.4}s ease-out ${i * 0.6}s infinite`,
                opacity: 0,
              }}
            >
              {i % 3 === 0 ? "\u2764\uFE0F" : i % 3 === 1 ? "\uD83D\uDC96" : "\u2728"}
            </span>
          ))}
        </div>

        {/* ===== HERO SECTION ===== */}
        <section className="relative flex min-h-screen flex-col">
          {/* Mobile hero image */}
          <div className="absolute inset-0 z-0 md:hidden">
            <Image
              src="/images/pre-register-hero-mobile.png"
              alt="What The Collection Giveaway"
              fill
              priority
              quality={85}
              sizes="100vw"
              style={{ objectFit: "cover" }}
            />
          </div>

          {/* Desktop hero image */}
          <div className="absolute inset-0 z-0 hidden md:block">
            <Image
              src="/images/pre-register-hero-desktop.png"
              alt="What The Collection Giveaway"
              fill
              priority
              quality={85}
              sizes="100vw"
              style={{ objectFit: "cover" }}
            />
          </div>

          {/* Dark gradient overlay */}
          <div
            className="absolute inset-0 z-[1]"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.7) 75%, rgba(0,0,0,0.95) 100%)",
            }}
            aria-hidden="true"
          />

          {/* Hero text content */}
          <div className="relative z-10 mt-auto px-4 pb-8 text-center md:px-8 md:pb-12">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-pink-300/80">
              WTF Giveaways
            </p>
            <h1 className="mt-3 text-4xl font-black uppercase leading-none tracking-tight text-white md:text-5xl lg:text-6xl">
              {"Win the "}
              <span
                className="bg-gradient-to-r from-[#FFD700] via-[#FFC400] to-[#FFA500] bg-clip-text text-transparent"
                style={{
                  backgroundSize: "200% auto",
                  animation: "shimmer 3s linear infinite",
                }}
              >
                {"£59.99"}
              </span>
            </h1>
            <h2
              className="mt-1 text-2xl font-extrabold uppercase tracking-wide text-white md:text-3xl lg:text-4xl"
              style={{ textShadow: "0 2px 20px rgba(0,0,0,0.5)" }}
            >
              What The Collection
            </h2>
            <p
              className="text-xl font-bold uppercase text-[#FFD700] md:text-2xl"
              style={{ textShadow: "0 0 20px rgba(255,215,0,0.3)" }}
            >
              Ultimate Kit
            </p>
            <p className="mx-auto mt-3 max-w-md text-sm text-pink-200/70 md:text-base">
              {"Choleigh is LIVE on TikTok \u2014 join the free VIP drop list."}
            </p>

            {/* Scroll indicator */}
            <a
              href="#form-section"
              className="mt-6 inline-flex animate-bounce items-center gap-1.5 rounded-full bg-white/10 px-5 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <span
                className="inline-block h-2 w-2 rounded-full bg-[#FFD700]"
                style={{ animation: "pulse-live 1.5s ease-in-out infinite" }}
              />
              Join the VIP list
            </a>
          </div>
        </section>

        {/* ===== FORM SECTION ===== */}
        <section
          id="form-section"
          className="relative z-10 px-4 py-12 md:py-20"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.95) 0%, #1a0011 30%, #2d0018 100%)",
          }}
        >
          {/* Glow effect behind form */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div
              className="absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(255,0,100,0.15) 0%, transparent 70%)",
                filter: "blur(80px)",
              }}
            />
          </div>

          <div className="relative mx-auto max-w-md">
            <div
              className="rounded-2xl border border-white/10 p-6 shadow-2xl backdrop-blur-md md:p-8"
              style={{
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
                animation: "glow-pulse 4s ease-in-out infinite",
              }}
            >
              <h3 className="mb-1 text-center text-xl font-bold uppercase tracking-wide text-white">
                Secure your spot
              </h3>
              <p className="mb-5 text-center text-sm text-pink-200/60">
                Be the first to know when it drops
              </p>
              <PreRegisterForm />
            </div>
          </div>
        </section>

        {/* ===== MOBILE STICKY CTA BAR ===== */}
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-black/80 p-3 backdrop-blur-md md:hidden">
          <a
            href="#form-section"
            className="block w-full rounded-xl bg-gradient-to-r from-[#FFD700] to-[#FFA500] px-6 py-3.5 text-center text-base font-extrabold uppercase tracking-wider text-[#1a0a2e] shadow-lg transition-all active:scale-[0.98]"
            style={{ backgroundSize: "200% auto", animation: "shimmer 3s linear infinite" }}
          >
            JOIN FREE VIP LIST
          </a>
        </div>
      </div>
    </>
  )
}
