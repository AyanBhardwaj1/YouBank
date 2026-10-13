/**
 * Crypto publishers for the Newsroom: headlines and links only, like every other feed (articles are
 * never republished). Tagged with the "crypto" lens, so NI CRYPTO finds them, plus the lenses that
 * already route them to markets and venture desks. Pure data; src/lib/news/desks.ts spreads it into
 * FEEDS.
 *
 * Unlike the rest of FEEDS, these were added without a live check (the build environment had no
 * outbound network); a feed that fails backs off on its own in the Newsroom pass.
 */
import type { Feed } from "@/lib/news/desks";

export const CRYPTO_FEEDS: Feed[] = [
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", tags: ["crypto", "markets"], tier: 2, kind: "article", everyMin: 20 },
  { id: "theblock", name: "The Block", url: "https://www.theblock.co/rss.xml", tags: ["crypto", "markets", "vc"], tier: 2, kind: "article", everyMin: 20 },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", tags: ["crypto", "markets"], tier: 3, kind: "article", everyMin: 30 },
  { id: "blockworks", name: "Blockworks", url: "https://blockworks.co/feed", tags: ["crypto", "markets", "vc"], tier: 2, kind: "article", everyMin: 30 },
];
