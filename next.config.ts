import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";
/** Vercel's preview deployments (and local builds) load Vercel's toolbar, which the policy must allow. */
const preview = process.env.VERCEL_ENV !== "production";

/**
 * Content Security Policy for every page except the Office add-in's two (Excel and PowerPoint frame
 * those and load Microsoft's office.js into them).
 *
 * What it buys without breaking the app: scripts only from YouBank itself (no injected third-party
 * script can load), no plugins, no <base> hijack, forms post only to YouBank, nobody may frame us, and
 * plain-http subresources are upgraded. What it allows on purpose:
 * - inline scripts: Next.js streams its payload in inline scripts; a nonce would need a proxy on every
 *   page (see docs/production.md, "Hardening later");
 * - inline styles: React style attributes, MapLibre and motion;
 * - 'wasm-unsafe-eval': WebAssembly, without allowing eval;
 * - workers from blob: and 'self': MapLibre and deck.gl build workers from blobs, pdf.js ships its own;
 * - images, media and fetches over https: map tiles and styles (OpenFreeMap, terrain on S3), company
 *   logos, stored files on presigned URLs, wallet and chain endpoints, and the voice analyst's realtime
 *   session; wss: for live sockets.
 * Stripe Checkout and the billing portal are full-page redirects, so they need no entry.
 */
export function contentSecurityPolicy(opts: { dev?: boolean; preview?: boolean; https?: boolean } = {}): string {
  const live = opts.preview ? " https://vercel.live" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${opts.dev ? " 'unsafe-eval'" : ""}${live}`,
    `style-src 'self' 'unsafe-inline'${live}`,
    "img-src 'self' data: blob: https:",
    `font-src 'self' data:${opts.preview ? " https://vercel.live https://assets.vercel.com" : ""}`,
    `connect-src 'self' https: wss: data: blob:${opts.dev ? " ws: http://localhost:*" : ""}`,
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    `frame-src 'self'${live}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only where the site is served over HTTPS (a local `next start` on http://localhost would break).
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Browser features a page may use. The microphone only inside the workspace (the Voice Analyst). */
export const permissionsPolicy = (microphone: boolean) =>
  `camera=(), microphone=(${microphone ? "self" : ""}), geolocation=(), payment=(), usb=(), browsing-topics=()`;

/** Sent with every response. */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: permissionsPolicy(false) },
];

/**
 * No other site may frame YouBank, so nobody can overlay a page (the Office pairing approval, say) to
 * trick a signed-in person into clicking. The two add-in pages are the exception: Excel and PowerPoint
 * show them inside their own frames. CSP_REPORT_ONLY=1 (then redeploy) turns the policy into a report-only
 * one, the quick way out if it ever blocks something real.
 */
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: contentSecurityPolicy({ dev, preview, https: !!process.env.VERCEL }) },
];

const nextConfig: NextConfig = {
  // Lets a second instance run alongside the first with its own build output, which is how the
  // multi-user collaboration flows get tested locally.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // After a deploy, a tab still running the previous build reloads on its next navigation instead of
  // asking for scripts that are gone. Vercel sets NEXT_DEPLOYMENT_ID itself when Skew Protection is on
  // (a paid feature); otherwise the deployment's own id is used.
  ...(!process.env.NEXT_DEPLOYMENT_ID && process.env.VERCEL_DEPLOYMENT_ID ? { deploymentId: process.env.VERCEL_DEPLOYMENT_ID } : {}),
  poweredByHeader: false,
  // laz-perf (lidar decompression, WebAssembly) is loaded from node_modules at run time, and its .wasm
  // must travel with the point cloud route. The files are named by their real place in pnpm's store:
  // node_modules/laz-perf is a symlink, and Vercel refuses a function whose files sit in a symlinked folder.
  serverExternalPackages: ["laz-perf"],
  outputFileTracingIncludes: { "/api/edge/lidar": ["./node_modules/.pnpm/laz-perf@*/node_modules/laz-perf/package.json", "./node_modules/.pnpm/laz-perf@*/node_modules/laz-perf/lib/node/**/*"] },
  experimental: {
    // `motion` ships a large barrel; lucide-react and the rest of our deps are optimized by default.
    optimizePackageImports: ["motion"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/((?!office/taskpane|office/commands).*)", headers: NO_FRAMING },
      // The workspace is one client-side app: a page's Permissions-Policy stays with the document across
      // client navigations, so the microphone (the Voice Analyst's hold-to-talk on Edge) is allowed on
      // every workspace page, or reaching Edge from another page would leave it blocked. Later rules win.
      { source: "/app", headers: [{ key: "Permissions-Policy", value: permissionsPolicy(true) }] },
      { source: "/app/:path*", headers: [{ key: "Permissions-Policy", value: permissionsPolicy(true) }] },
    ];
  },
};

export default nextConfig;
