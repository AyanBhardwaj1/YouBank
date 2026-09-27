import { manifestXml } from "@/lib/office/manifest";

export const dynamic = "force-dynamic";

/** The add-in manifest for this deployment. ?download=1 saves it as a file for Upload My Add-in. */
export function GET(req: Request) {
  const url = new URL(req.url);
  const headers: Record<string, string> = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" };
  if (url.searchParams.get("download")) headers["Content-Disposition"] = 'attachment; filename="youbank-office-addin.xml"';
  return new Response(manifestXml(url.origin), { headers });
}
