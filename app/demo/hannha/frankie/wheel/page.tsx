import type { Metadata } from "next"
import { WheelDemo } from "./components/wheel-demo"
import { anton, montserrat } from "./lib/fonts"
import "./wheel-demo.css"

// Isolated internal prototype. Explicitly kept out of search indexes and not
// linked from anywhere in the product. No backend, no real prizes, no payments.
export const metadata: Metadata = {
  title: "Spin To Win — Internal Prototype",
  robots: { index: false, follow: false },
}

export default function WheelDemoPage() {
  return (
    <main className={`stw-page ${anton.variable} ${montserrat.variable}`}>
      <WheelDemo />
    </main>
  )
}
