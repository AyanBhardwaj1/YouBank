/**
 * Public story addresses: /news/<id>-<words-from-the-headline>. The id finds the story; the words are
 * for people and search engines, so a story whose headline changed (a better outlet joined) still
 * resolves, and the page redirects to the current address. Pure, tested.
 */
export function slugWords(headline: string, maxWords = 10): string {
  return headline
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/\$(\d)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, maxWords).join("-")
    .slice(0, 90).replace(/-+$/, "");
}

export const slugFor = (id: number, headline: string) => { const w = slugWords(headline); return w ? `${id}-${w}` : String(id); };

/** The story id in a slug, or null. "123-acme-buys-widget" and "123" are 123. */
export function idFromSlug(slug: string): number | null {
  const m = /^(\d{1,10})(?:-[a-z0-9-]*)?$/.exec(slug.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
