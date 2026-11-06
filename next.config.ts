import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The old lobby URL (already printed on QR codes) goes straight to the ballot.
  async redirects() {
    return [{ source: '/queue', destination: '/', permanent: false }]
  },
};

export default nextConfig;
