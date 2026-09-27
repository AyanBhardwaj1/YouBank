export const dynamic = "force-static";

/** The add-in's function file. The ribbon button only opens the task pane, so this just starts Office.js. */
export function GET() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>YouBank commands</title>
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
<script>Office.onReady(function () {});</script></head><body></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
