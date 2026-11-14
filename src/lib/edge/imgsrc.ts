/**
 * Satellite and aerial pictures (Sentinel-2 crops, NAIP, Planetary Computer previews) through YouBank's
 * own image route, which keeps each one in Cloudflare R2 the first time it is seen (src/app/api/edge/img):
 * a crop of a past scene never changes, so later views cost the source nothing and leave R2 free (R2 has
 * no egress fees). Safe in the browser: it only rewrites addresses on the allowed hosts. Pure.
 */
export const IMAGE_HOSTS = ["planetarycomputer.microsoft.com"] as const;

/** Whether an address may go through the image route: https, an allowed host, a data path. Pure. */
export function cacheableImage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (IMAGE_HOSTS as readonly string[]).includes(u.hostname) && u.pathname.startsWith("/api/data/");
  } catch { return false; }
}

/** The address to put in an <img>: through the cache when allowed, else unchanged. Pure. */
export const edgeImageSrc = (url: string | null | undefined): string => (url && cacheableImage(url) ? `/api/edge/img?u=${encodeURIComponent(url)}` : url ?? "");
