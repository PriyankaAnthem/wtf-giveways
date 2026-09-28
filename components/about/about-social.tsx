import { Play } from "lucide-react"

const videos = [
  { id: 1, label: "Winner announcement" },
  { id: 2, label: "Behind the scenes" },
  { id: 3, label: "Live draw" },
]

export function AboutSocial() {
  return (
    <section className="bg-secondary/50 py-16 md:py-24">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            See It For Yourself
          </h2>
          <p className="mt-2 text-pretty text-muted-foreground">
            {"We don\u2019t hide behind a logo. We show up."}
          </p>
        </div>

        {/* Video placeholders */}
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {videos.map((video) => (
            <div
              key={video.id}
              className="group relative aspect-[9/16] overflow-hidden rounded-2xl border border-border/60 bg-foreground/5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
            >
              {/* Gradient overlay */}
              <div
                className="absolute inset-0 z-[1]"
                aria-hidden="true"
                style={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)",
                }}
              />
              {/* Play button */}
              <div className="absolute inset-0 z-[2] flex items-center justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-pink-500 shadow-lg backdrop-blur-sm transition-transform duration-300 group-hover:scale-110">
                  <Play className="ml-1 h-7 w-7 fill-current" aria-hidden="true" />
                </div>
              </div>
              {/* Label */}
              <div className="absolute inset-x-0 bottom-0 z-[2] p-4">
                <span className="text-sm font-medium text-white">{video.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
