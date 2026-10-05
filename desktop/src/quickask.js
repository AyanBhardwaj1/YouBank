// The floating quick ask window. The question goes to the Rust side, which streams the answer from
// /api/desktop/ask and passes each event here; this page never holds the device token.
import { h, invoke, listen, toast } from "./app.js";

const $ = (id) => document.getElementById(id);
const thread = $("thread");
const input = $("input");
/** The conversation so far, for follow-up questions. */
let messages = [];
let answer = null; // { el, text, sourcesEl }
let busy = false;

/** A small, safe Markdown subset: paragraphs, bullet lists, **bold**, `code` and https links. */
function render(md) {
  const frag = document.createDocumentFragment();
  const inline = (text, parent) => {
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      parent.append(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith("**")) parent.append(h("strong", null, t.slice(2, -2)));
      else if (t.startsWith("`")) parent.append(h("code", null, t.slice(1, -1)));
      else {
        const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(t);
        parent.append(h("a", { onclick: () => invoke("open_external", { url }) }, label));
      }
      last = m.index + t.length;
    }
    parent.append(text.slice(last));
  };
  for (const block of md.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
      const ul = h("ul");
      for (const l of lines) { const li = h("li"); inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), li); ul.append(li); }
      frag.append(ul);
    } else {
      const p = h("p");
      lines.forEach((l, i) => { if (i) p.append(h("br")); inline(l.replace(/^#+\s*/, ""), p); });
      frag.append(p);
    }
  }
  return frag;
}

function setBusy(on) {
  busy = on;
  $("stop").classList.toggle("hidden", !on);
  input.disabled = on;
  if (!on) input.focus();
}

async function ask() {
  const q = input.value.trim();
  if (!q || busy) return;
  $("intro").classList.add("hidden");
  $("new").classList.remove("hidden");
  messages.push({ role: "user", content: q });
  input.value = "";
  const el = h("div", { class: "a" }, h("p", { class: "muted" }, "Thinking…"));
  const tool = h("div", { class: "tool" });
  const sourcesEl = h("div", { class: "sources" });
  thread.append(h("div", { class: "q" }, q), tool, el, sourcesEl);
  answer = { el, text: "", tool, sourcesEl };
  setBusy(true);
  try {
    await invoke("ask", { messages });
  } catch (e) {
    el.replaceChildren(h("p", { class: "neg" }, String(e)));
    setBusy(false);
    if (/not connected/i.test(String(e))) $("connect").classList.remove("hidden");
  }
}

listen("ask://event", (ev) => {
  if (!answer) return;
  switch (ev.type) {
    case "text":
      answer.text += ev.text;
      answer.el.replaceChildren(render(answer.text));
      thread.scrollTop = thread.scrollHeight;
      break;
    case "tool":
      answer.tool.textContent = ev.status === "start" ? `Looking up: ${ev.summary || ev.name.replace(/_/g, " ")}…` : "";
      break;
    case "sources":
      answer.sourcesEl.replaceChildren(...(ev.sources ?? []).slice(0, 8).map((s, i) => h("div", null, `[${i + 1}] `, /^https:\/\//.test(s.url) ? h("a", { onclick: () => invoke("open_external", { url: s.url }) }, s.label) : s.label)));
      break;
    case "error":
      answer.el.append(h("p", { class: "neg" }, ev.message));
      break;
    case "end":
      if (answer.text) messages.push({ role: "assistant", content: answer.text });
      else if (!answer.el.querySelector(".neg")) answer.el.replaceChildren(h("p", { class: "muted" }, "Stopped."));
      answer.tool.textContent = "";
      answer = null;
      setBusy(false);
      break;
  }
});

listen("quickask://open", (q) => {
  if (q) input.value = q;
  input.focus();
  input.select();
});

listen("pair://done", () => { $("connect").classList.add("hidden"); toast("Connected. Ask away."); });
listen("state://changed", async () => {
  const st = await invoke("get_state");
  $("connect").classList.toggle("hidden", st.connected);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") void invoke("hide_quick_ask"); });
$("close").addEventListener("click", () => invoke("hide_quick_ask"));
$("stop").addEventListener("click", () => invoke("ask_cancel"));
$("open").addEventListener("click", () => { void invoke("open_site", { path: "/app" }); void invoke("hide_quick_ask"); });
$("connect-btn").addEventListener("click", async () => {
  try {
    const p = await invoke("pair_start", { inBrowser: false });
    toast(`Approve code ${p.code} in the YouBank window.`);
  } catch (e) { toast(String(e), true); }
});
$("new").addEventListener("click", () => {
  if (busy) return;
  messages = [];
  thread.querySelectorAll(".q, .a, .tool, .sources").forEach((n) => n.remove());
  $("intro").classList.remove("hidden");
  $("new").classList.add("hidden");
  input.focus();
});

(async () => {
  const st = await invoke("get_state");
  $("connect").classList.toggle("hidden", st.connected);
  if (st.askDraft) { input.value = st.askDraft; input.focus(); }
})();
