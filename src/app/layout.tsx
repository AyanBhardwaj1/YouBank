import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { DialogHost } from "@/components/ui/Dialog";
import { MobileViewport } from "@/components/ui/MobileViewport";
import { MotionPrefs } from "@/components/motion/MotionPrefs";
import { THEME_COOKIE, themeById } from "@/lib/themes";
import { currentUser } from "@/lib/auth/user";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "YouBank · The AI deal desk that learns how you work", template: "%s · YouBank" },
  description: "Cited analysis from SEC filings, and an email agent that tracks every thread, asks you what it cannot answer, remembers, and earns the right to send on its own. For boutique advisors, emerging managers, founders and students.",
  metadataBase: new URL("https://youbank-nu.vercel.app"),
  applicationName: "YouBank",
  openGraph: {
    title: "YouBank · The AI deal desk that learns how you work",
    description: "Cited analysis from SEC filings, and an email agent that earns autonomy from your own decisions.",
    type: "website",
    url: "https://youbank-nu.vercel.app",
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
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en" data-theme={theme.id} className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider initial={theme.id} signedIn={!!user}><MotionPrefs>{children}<DialogHost /></MotionPrefs></ThemeProvider>
        <MobileViewport />
      </body>
    </html>
  );
}
