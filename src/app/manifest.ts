import type { MetadataRoute } from "next";

/**
 * The web app manifest: YouBank installs from the browser as an app of its own (Add to Home Screen on a
 * phone, Install on desktop Chrome and Edge), opens signed in on Home in its own window, and offers
 * shortcuts to the terminal, the Newsroom and the inbox from the app icon. The maskable icons keep the
 * mark inside the safe zone Android crops to.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "YouBank",
    short_name: "YouBank",
    description: "Hedge-fund grade, pocket-sized: your book checked against SEC filings, alternative data, calibrated forecasts and a terminal, on any device.",
    start_url: "/app?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0c0f",
    theme_color: "#0a0c0f",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/brand/mark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/mark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Terminal", short_name: "Terminal", description: "Quotes, filings, comps and the AI", url: "/app/terminal?source=pwa", icons: [{ src: "/brand/mark-192.png", sizes: "192x192" }] },
      { name: "Newsroom", short_name: "News", description: "News for your desk and the morning brief", url: "/app/news?source=pwa", icons: [{ src: "/brand/mark-192.png", sizes: "192x192" }] },
      { name: "Relationships", short_name: "Inbox", description: "Your mail, pipeline and what the agent left for you", url: "/app/crm?source=pwa", icons: [{ src: "/brand/mark-192.png", sizes: "192x192" }] },
    ],
  };
}
