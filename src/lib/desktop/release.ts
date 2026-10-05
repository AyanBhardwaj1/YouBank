/**
 * The latest desktop release, for the download page. Installers are built by
 * .github/workflows/desktop.yml and published as GitHub Release assets on tags `desktop-v*`; this reads
 * the newest published (not draft) one and sorts its assets by platform. The answer is cached for ten
 * minutes per instance, and when GitHub cannot be reached the page links to the releases list instead.
 * GITHUB_TOKEN, when set, raises GitHub's anonymous limit of 60 requests an hour; it is never required.
 */
import { memo } from "@/lib/memo";

export const DESKTOP_REPO = process.env.DESKTOP_RELEASE_REPO?.trim() || "AyanBhardwaj1/YouBank";
export const RELEASES_URL = `https://github.com/${DESKTOP_REPO}/releases`;

export type InstallerKind = "msi" | "exe" | "dmg" | "appimage" | "deb" | "rpm";
export type Installer = { kind: InstallerKind; name: string; url: string; bytes: number; arch: "x64" | "arm64" | "universal" };
export type DesktopRelease = {
  version: string; tag: string; url: string; publishedAt: string; notes: string; installers: Installer[];
  /** The signed updater manifest (latest.json) the app's updater reads, when the release has one. */
  updaterJson: string | null;
};

type GhAsset = { name: string; browser_download_url: string; size: number };
type GhRelease = { tag_name: string; html_url: string; draft: boolean; prerelease: boolean; published_at: string | null; body: string | null; assets: GhAsset[] };

/** Which installer an asset is, from Tauri's bundle names (updater archives and signatures are skipped). Pure. */
export function installerOf(a: { name: string; browser_download_url: string; size: number }): Installer | null {
  const n = a.name.toLowerCase();
  if (/\.(sig|tar\.gz|zip|json)$/.test(n)) return null;
  const kind: InstallerKind | null = n.endsWith(".msi") ? "msi" : n.endsWith(".exe") ? "exe" : n.endsWith(".dmg") ? "dmg" : n.endsWith(".appimage") ? "appimage" : n.endsWith(".deb") ? "deb" : n.endsWith(".rpm") ? "rpm" : null;
  if (!kind) return null;
  const arch = /universal/.test(n) ? "universal" : /(aarch64|arm64)/.test(n) ? "arm64" : "x64";
  return { kind, name: a.name, url: a.browser_download_url, bytes: a.size, arch };
}

/** The newest published desktop release in a list from GitHub's API. Pure. */
export function pickRelease(list: GhRelease[]): DesktopRelease | null {
  const r = list.filter((x) => !x.draft && x.tag_name.startsWith("desktop-v")).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
  if (!r) return null;
  return {
    version: r.tag_name.replace(/^desktop-v/, ""), tag: r.tag_name, url: r.html_url, publishedAt: r.published_at ?? "",
    notes: (r.body ?? "").slice(0, 4000), installers: r.assets.map(installerOf).filter((x): x is Installer => !!x),
    updaterJson: r.assets.find((a) => a.name === "latest.json")?.browser_download_url ?? null,
  };
}

/** Null when there is no published release yet, or GitHub could not be reached (not cached, so the next visit tries again). */
export async function latestDesktopRelease(): Promise<DesktopRelease | null> {
  return memo("desktop:release", 600_000, async () => {
    const token = process.env.GITHUB_TOKEN?.trim();
    const res = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases?per_page=20`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "YouBank", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`GitHub releases answered ${res.status}`);
    return pickRelease((await res.json()) as GhRelease[]);
  }).catch(() => null);
}
