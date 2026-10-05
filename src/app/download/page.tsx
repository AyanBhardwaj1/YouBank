import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { DesktopDownload } from "@/components/desktop/DesktopDownload";
import { latestDesktopRelease, RELEASES_URL } from "@/lib/desktop/release";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Download YouBank for desktop",
  description: "YouBank for Windows, macOS and Linux: quick ask from any app, native alerts, your local files in your research, and Studio models you edit in Excel.",
};

/** Public: the installers for the latest desktop release, picked for the visitor's system. */
export default async function DownloadPage() {
  const release = await latestDesktopRelease();
  return (
    <main className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-2"><Logo size={22} /></Link>
          <Link href="/app" className="text-[12px] text-muted hover:text-fg">Open YouBank →</Link>
        </div>
      </header>
      <DesktopDownload release={release} releasesUrl={RELEASES_URL} />
    </main>
  );
}
