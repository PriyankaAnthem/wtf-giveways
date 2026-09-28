/** @type {import('next').NextConfig} */

const remotePatterns = [
  {
    protocol: "https",
    hostname: "*.supabase.co",
    pathname: "/storage/v1/object/public/**",
  },
  {
    protocol: "https",
    hostname: "*.public.blob.vercel-storage.com",
  },
]

try {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabaseHostname = new URL(
      process.env.NEXT_PUBLIC_SUPABASE_URL
    ).hostname

    if (
      supabaseHostname &&
      !supabaseHostname.endsWith(".supabase.co")
    ) {
      remotePatterns.push({
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      })
    }
  }
} catch {
  // Fall back to the *.supabase.co pattern above.
}

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    unoptimized: true,
    remotePatterns,
  },
}

export default nextConfig