/** Shared by the load-test scripts: argument parsing and the guard that keeps them off production. */

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  }
  return out;
}

/**
 * Load tests run against a local build (localhost) or, with LOADTEST_ALLOW_PREVIEW=1, a Vercel preview
 * deployment that has its own database. Never the production site.
 */
export function guardTarget(raw) {
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const production = /^(youbank-nu\.vercel\.app|youbank\.vercel\.app)$/i.test(url.hostname) || !url.hostname.endsWith(".vercel.app") && !local;
  if (local) return url.origin;
  if (!production && process.env.LOADTEST_ALLOW_PREVIEW === "1") return url.origin;
  throw new Error(`Refusing to load-test ${url.hostname}: only localhost, or a preview deployment with LOADTEST_ALLOW_PREVIEW=1 (never production).`);
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
