/**
 * MCP Apps (the "io.modelcontextprotocol/ui" extension, spec 2026-01-26): a small card the AI app shows in
 * the conversation when it proposes a position, instead of raw JSON. The tool declares the card with
 * `_meta.ui.resourceUri`; the host reads it with resources/read and renders it in a sandboxed iframe with no
 * network access. The card talks to the host over postMessage JSON-RPC:
 * - it sends `ui/initialize`, then `ui/notifications/initialized` once answered;
 * - it reads the proposal from `ui/notifications/tool-input` and the outcome from `ui/notifications/tool-result`;
 * - "Review in YouBank" asks the host to open the link (`ui/open-link`).
 * It cannot approve anything: the person reviews the proposal in YouBank. Hosts without MCP Apps ignore
 * `_meta` and show the tool's text result, which says the same. Tested in scripts/test-mcp.ts.
 */
export const UI_MIME = "text/html;profile=mcp-app";
export const PROPOSAL_CARD_URI = "ui://youbank/proposal-card";

const METRIC_LABELS: Record<string, string> = {
  revenue_growth: "Revenue growth", gross_margin: "Gross margin", operating_margin: "Operating margin", fcf_margin: "FCF margin",
  rule_of_40: "Rule of 40", revenue: "Revenue ($M)", net_debt: "Net debt ($M)", ev_revenue: "EV / revenue", pe: "P/E", price: "Share price",
  insider_selling: "Insider selling ($M)", return_since_entry: "Return since entry",
};

/** The card: one self-contained HTML5 document (inline style and script, no outside requests). */
export const PROPOSAL_CARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>YouBank proposal</title>
<style>
:root{--bg:#ffffff;--fg:#14171c;--muted:#5f6670;--line:#e3e6ea;--accent:#b8730a;--pos:#167a3d;--neg:#b42318;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#101318;--fg:#e7e9ec;--muted:#9aa1ab;--line:#262b33;--accent:#f5a524;--pos:#3fb767;--neg:#f0605a}}
:root[data-theme=dark]{--bg:#101318;--fg:#e7e9ec;--muted:#9aa1ab;--line:#262b33;--accent:#f5a524;--pos:#3fb767;--neg:#f0605a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;max-width:560px}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.tk{font-weight:700;font-size:15px}
.pill{border-radius:6px;padding:1px 7px;font-size:11px;font-weight:600;text-transform:uppercase}
.long{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.short{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}
.state{margin-left:auto;font-size:11.5px;color:var(--muted)}.thesis{margin:6px 0 4px;font-size:13.5px}
h2{margin:10px 0 3px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
ul{margin:0;padding-left:18px}li{margin:1px 0}.muted{color:var(--muted)}.fail{color:var(--neg);font-weight:600}.near{color:var(--accent);font-weight:600}.pass{color:var(--pos);font-weight:600}
button{margin-top:10px;border:0;border-radius:7px;background:var(--accent);color:#111;font-weight:600;padding:7px 12px;cursor:pointer;font:inherit;font-weight:600}
button:disabled{opacity:.5;cursor:default}.note{margin-top:8px;font-size:11.5px;color:var(--muted)}
</style></head>
<body><div class="card" id="card"><div class="muted">Waiting for the proposal…</div></div>
<script>
(function(){
  var METRICS = ${JSON.stringify(METRIC_LABELS)};
  var nextId = 1, pending = {}, args = null, result = null, cancelled = false;
  function send(msg){ window.parent.postMessage(msg, "*"); }
  function request(method, params){ var id = nextId++; send({ jsonrpc: "2.0", id: id, method: method, params: params || {} }); return new Promise(function(res, rej){ pending[id] = { res: res, rej: rej }; }); }
  function notify(method, params){ send({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function data(){
    if (!result) return null;
    var sc = result.structuredContent;
    // YouBank's tools answer { result, sources }; take the result.
    if (sc && typeof sc === "object") return sc.result && typeof sc.result === "object" ? sc.result : sc;
    try { var t = (result.content || []).filter(function(c){ return c.type === "text"; })[0]; return t ? JSON.parse(t.text.split("\\n\\nSources")[0]) : null; } catch (e) { return null; }
  }
  function render(){
    var card = document.getElementById("card"); card.textContent = "";
    if (!args) { card.appendChild(el("div", "muted", "Waiting for the proposal…")); return size(); }
    var top = el("div", "top");
    top.appendChild(el("span", "tk", String(args.ticker || "").toUpperCase().slice(0, 12)));
    if (args.direction === "long" || args.direction === "short") top.appendChild(el("span", "pill " + args.direction, args.direction));
    if (typeof args.weight_pct_nav === "number") top.appendChild(el("span", "muted", args.weight_pct_nav + "% of NAV"));
    if (typeof args.conviction_pct === "number") top.appendChild(el("span", "muted", Math.round(args.conviction_pct) + "% conviction" + (args.review_by ? " to " + args.review_by : "")));
    var d = data();
    top.appendChild(el("span", "state", !result ? (cancelled ? "Cancelled" : "Proposing…") : (d && d.proposed) ? "Waiting for your review" : "Not proposed"));
    card.appendChild(top);
    if (args.thesis) card.appendChild(el("p", "thesis", args.thesis));
    var checks = d && d.today && Array.isArray(d.today.criteria) ? d.today.criteria : null;
    var crit = Array.isArray(args.kill_criteria) ? args.kill_criteria : [];
    if (crit.length || checks) {
      card.appendChild(el("h2", null, "Kill criteria" + (checks ? ", checked now" : "")));
      var ul = el("ul");
      if (checks) checks.forEach(function(c){ var li = el("li"); li.appendChild(el("span", null, c.criterion + ": " + c.now + " ")); li.appendChild(el("span", c.state === "fail" ? "fail" : c.state === "near" ? "near" : c.state === "pass" ? "pass" : "muted", c.state === "fail" ? "failed" : c.state === "near" ? "close" : c.state === "pass" ? "holds" : "no data")); ul.appendChild(li); });
      else crit.forEach(function(c){ ul.appendChild(el("li", null, (METRICS[c.metric] || c.metric) + " " + (c.op === ">=" ? "at least " : "at most ") + c.value)); });
      card.appendChild(ul);
    }
    if (Array.isArray(args.pillars) && args.pillars.length) { card.appendChild(el("h2", null, "Pillars")); var pl = el("ul"); args.pillars.slice(0, 6).forEach(function(p){ pl.appendChild(el("li", null, p)); }); card.appendChild(pl); }
    if (d && d.error) card.appendChild(el("p", "fail", d.error));
    if (d && d.proposed && typeof d.link === "string" && /^https:\\/\\//.test(d.link)) {
      var b = el("button", null, "Review in YouBank");
      b.type = "button";
      b.onclick = function(){ b.disabled = true; request("ui/open-link", { url: d.link }).catch(function(){}).then(function(){ b.disabled = false; }); };
      card.appendChild(b);
    }
    card.appendChild(el("p", "note", "Nothing is added to your Book until you review this proposal in YouBank and add it."));
    size();
  }
  function size(){ var r = document.documentElement.getBoundingClientRect(); notify("ui/notifications/size-changed", { width: Math.ceil(r.width), height: Math.ceil(document.body.scrollHeight) }); }
  window.addEventListener("message", function(ev){
    if (ev.source !== window.parent) return;
    var m = ev.data; if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id] && !m.method) { var p = pending[m.id]; delete pending[m.id]; if (m.error) p.rej(m.error); else p.res(m.result); return; }
    if (m.method === "ui/notifications/tool-input" && m.params) { args = m.params.arguments || {}; render(); }
    else if (m.method === "ui/notifications/tool-result" && m.params) { result = m.params; render(); }
    else if (m.method === "ui/notifications/host-context-changed" && m.params) theme(m.params);
    else if (m.method === "ui/notifications/tool-cancelled") { cancelled = true; render(); }
    else if (m.method === "ui/resource-teardown" && m.id != null) send({ jsonrpc: "2.0", id: m.id, result: {} });
  });
  function theme(ctx){ if (ctx && (ctx.theme === "light" || ctx.theme === "dark")) document.documentElement.setAttribute("data-theme", ctx.theme); }
  request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "YouBank proposal card", version: "1.0.0" }, appCapabilities: {} })
    .then(function(r){ theme(r && r.hostContext); notify("ui/notifications/initialized", {}); size(); })
    .catch(function(){});
})();
</script></body></html>`;

export type McpResource = { uri: string; name: string; title: string; description: string; mimeType: string; text: string; _meta?: Record<string, unknown> };

export const PROPOSAL_CARD: McpResource = {
  uri: PROPOSAL_CARD_URI, name: "proposal-card", title: "Position proposal", mimeType: UI_MIME, text: PROPOSAL_CARD_HTML,
  description: "Shows a position an AI app proposed for the Book, its kill criteria checked now, and a link to review it in YouBank.",
  _meta: { ui: { prefersBorder: false } },
};
