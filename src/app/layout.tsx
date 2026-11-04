import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { DialogHost } from "@/components/ui/Dialog";
import { MobileViewport } from "@/components/ui/MobileViewport";
import { Connectivity } from "@/components/ui/Connectivity";
import { MotionPrefs } from "@/components/motion/MotionPrefs";
import { THEME_COOKIE, themeById } from "@/lib/themes";
import { LOOK_COOKIE, lookAttrs, readLookCookie } from "@/lib/desk/desk";
import { currentUser } from "@/lib/auth/user";
import { siteUrl } from "@/lib/site";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "YouBank · The AI deal desk that learns how you work", template: "%s · YouBank" },
  description: "Cited analysis from SEC filings, and an email agent that tracks every thread, asks you what it cannot answer, remembers, and sends on its own only what you allow. For boutique advisors, emerging managers, founders and students.",
  metadataBase: new URL(siteUrl()),
  applicationName: "YouBank",
  // Installed to a phone's home screen, it opens full screen with the status bar over the theme (manifest.ts).
  appleWebApp: { capable: true, title: "YouBank", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "YouBank · The AI deal desk that learns how you work",
    description: "Cited analysis from SEC filings, and an email agent that earns autonomy from your own decisions.",
    type: "website",
    url: siteUrl(),
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "YouBank" }],
  },
  twitter: { card: "summary_large_image", title: "YouBank", description: "The AI deal desk that learns how you work.", images: ["/brand/og.png"] },
};

/**
 * Phones: draw edge to edge (`viewport-fit=cover`, with the notch and home bar kept clear by the
 * safe-area insets in CSS), and on Android let the keyboard shrink the page instead of covering it
 * (iOS ignores that and is handled by MobileViewport). Pinch-zoom stays allowed. The browser bar takes
 * the theme's background, which ThemeProvider keeps in step when the style changes.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = themeById((await cookies()).get(THEME_COOKIE)?.value);
  return { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: theme.vars.bg };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = themeById(jar.get(THEME_COOKIE)?.value);
  // The look (Settings → Style) is on <html> in the first HTML, from its cookie, so nothing flashes.
  const look = lookAttrs(readLookCookie(jar.get(LOOK_COOKIE)?.value));
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en" data-theme={theme.id} {...look.attrs} style={Object.keys(look.vars).length ? (look.vars as React.CSSProperties) : undefined} className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider initial={theme.id} signedIn={!!user}><MotionPrefs>{children}<DialogHost /></MotionPrefs></ThemeProvider>
        <MobileViewport />
        <Connectivity />
      </body>
    </html>
  );
}
