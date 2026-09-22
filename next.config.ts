import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // `motion` ships a large barrel; lucide-react and the rest of our deps are optimized by default.
    optimizePackageImports: ["motion"],
  },
};

export default nextConfig;
