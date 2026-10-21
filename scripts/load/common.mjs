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
 * Load tests run against a local build (localhost) or a Vercel preview deployment that has its own
 * database, named exactly in LOADTEST_ALLOW_PREVIEW (its hostname, typed on purpose: a preview often shares
 * production's database, and a production deployment has a vercel.app address too). Never the production
 * site, its aliases, or the main branch's preview address.
 */
export function guardTarget(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (local) return url.origin;
  const site = (() => { try { return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname.toLowerCase(); } catch { return ""; } })();
  const production = /^youbank(-nu)?\.vercel\.app$/.test(host) || (!!site && host === site) || /-git-(main|master)-/.test(host) || !host.endsWith(".vercel.app");
  if (!production && url.protocol === "https:" && (process.env.LOADTEST_ALLOW_PREVIEW ?? "").toLowerCase() === host) return url.origin;
  throw new Error(`Refusing to load-test ${host}: only localhost, or a preview deployment named exactly in LOADTEST_ALLOW_PREVIEW (never production).`);
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
