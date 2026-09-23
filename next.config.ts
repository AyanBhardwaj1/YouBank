import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second instance run alongside the first with its own build output, which is how the
  // multi-user collaboration flows get tested locally.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  experimental: {
    // `motion` ships a large barrel; lucide-react and the rest of our deps are optimized by default.
    optimizePackageImports: ["motion"],
  },
};

export default nextConfig;
