import type { NextConfig } from "next";

/** Sent with every response. */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in YouBank uses these; a compromised script or embed cannot either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

/**
 * No other site may frame YouBank, so nobody can overlay a page (the Office pairing approval, say) to
 * trick a signed-in person into clicking. The two add-in pages are the exception: Excel and PowerPoint
 * show them inside their own frames.
 */
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // Lets a second instance run alongside the first with its own build output, which is how the
  // multi-user collaboration flows get tested locally.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  experimental: {
    // `motion` ships a large barrel; lucide-react and the rest of our deps are optimized by default.
    optimizePackageImports: ["motion"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/((?!office/taskpane|office/commands).*)", headers: NO_FRAMING },
    ];
  },
};

export default nextConfig;
