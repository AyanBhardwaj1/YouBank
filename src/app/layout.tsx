import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { THEME_COOKIE, themeById } from "@/lib/themes";
import { currentUser } from "@/lib/auth/user";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "YouBank · The AI data platform for finance", template: "%s · YouBank" },
  description: "The AI data platform for finance. SEC filings, live fundamentals and an assistant that produces the deliverable, tailored to your job.",
  metadataBase: new URL("https://youbank-nu.vercel.app"),
  applicationName: "YouBank",
  openGraph: {
    title: "YouBank · The AI data platform for finance",
    description: "A terminal that does the analyst work, tailored to your job.",
    type: "website",
    url: "https://youbank-nu.vercel.app",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "YouBank" }],
  },
  twitter: { card: "summary_large_image", title: "YouBank", description: "The AI data platform for finance.", images: ["/brand/og.png"] },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = themeById(jar.get(THEME_COOKIE)?.value);
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en" data-theme={theme.id} className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider initial={theme.id} signedIn={!!user}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
