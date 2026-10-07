// The copilot window during a meeting: who it is with (picked from Relationships), what YouBank knows
// about them (free, no AI), live suggestions (premium, only while switched on for this meeting, about
// once a minute), asking about the meeting, and the rolling transcript.
import { h, invoke, listen, run, toast, toggle } from "./app.js";

const head = document.getElementById("head");
const view = document.getElementById("view");
let st = null; // meeting_state
let brief = null; // { lines, brief }
let segments = []; // the rolling transcript, newest last
let live = { on: false, busy: false, data: null, timer: null };
let search = { q: "", found: null };
let answer = null;
let lastId = null; // the meeting this window last showed, to ask about after it ends
let notesReady = null;

const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const unlocked = (id) => !!st?.server?.features?.[id];

async function load() {
  st = await invoke("meeting_state");
  const id = st.session?.id ?? null;
  if (id && id !== lastId) {
    lastId = id; segments = []; brief = null; answer = null; notesReady = null;
    live.on = false; clearInterval(live.timer);
    const t = await invoke("meeting_tail", { id }).catch(() => null);
    if (t?.tail) segments = t.tail;
    void loadBrief();
  }
  if (!st.session && live.on) { live.on = false; clearInterval(live.timer); }
  render();
}

async function loadBrief(fresh = false) {
  const id = st?.session?.id ?? lastId;
  if (!id) return;
  brief = await invoke("meeting_brief", { id, fresh }).catch(() => ({ lines: [] }));
  render();
}

async function setLive(on) {
  const r = await run("meeting_live", { on });
  if (!r) return render();
  live.on = !!r.on;
  clearInterval(live.timer);
  if (live.on) {
    void suggest();
    live.timer = setInterval(() => { if (document.visibilityState === "visible") void suggest(); }, 60_000);
  }
  render();
}

async function suggest() {
  if (live.busy || !live.on) return;
  live.busy = true; render();
  try { live.data = await invoke("meeting_suggest"); }
  catch (e) { toast(String(e), true); if (/off for this meeting|ended|plan/i.test(String(e))) { live.on = false; clearInterval(live.timer); } }
  finally { live.busy = false; render(); }
}

async function pick(kind, id) {
  const r = await run("meeting_link", { contactIds: kind === "contact" ? [id] : [], dealIds: kind === "deal" ? [id] : [], title: null }, "Linked.");
  if (r) { search = { q: "", found: null }; await loadBrief(true); }
}

let searchTimer;
function onSearch(q) {
  search.q = q;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => { search.found = q.trim() ? await invoke("meeting_search", { q }).catch(() => null) : null; render(); }, 250);
}

async function ask(q) {
  if (!q.trim()) return;
  answer = { q, busy: true };
  render();
  try { answer = { q, ...(await invoke("meeting_ask", { question: q, id: st?.session?.id ?? lastId })) }; }
  catch (e) { answer = { q, answer: String(e), quotes: [] }; }
  render();
}

function header() {
  const s = st?.session;
  if (!s) {
    return [h("strong", null, "Meeting copilot"),
      h("p", { class: "small muted", style: "margin: 4px 0 0" }, lastId ? "The meeting ended. Its notes are being written; you'll be told when they're ready." : "No meeting is being recorded."),
      notesReady ? h("button", { class: "btn primary", style: "margin-top: 8px", onclick: () => invoke("open_site", { path: `/app/crm?tab=meetings&meeting=${notesReady}` }) }, "Open the notes") : null,
      !lastId ? h("button", { class: "btn primary", style: "margin-top: 8px", onclick: () => run("meeting_prompt", { platform: null, title: null }) }, "Start the copilot") : null];
  }
  return [h("div", { class: "row" }, h("span", { class: "rec" }), h("strong", { class: "grow" }, s.title || "Meeting in progress"),
    h("button", { class: "btn danger", onclick: () => run("meeting_stop", { discard: false }) }, "Stop")),
  s.systemNote ? h("p", { class: "small", style: "margin: 6px 0 0; color: var(--warn)" }, s.systemNote) : null];
}

// The window is built once; each part is redrawn on its own, so typing in a box is never interrupted
// by a transcript update.
const part = {};
const askBox = h("input", { type: "text", placeholder: "Ask about this meeting…", style: "flex: 1", onkeydown: (e) => { if (e.key === "Enter") void ask(askBox.value); } });
const searchBox = h("input", { type: "text", placeholder: "Add a contact or deal…", style: "width: 100%; margin-top: 6px", oninput: (e) => onSearch(e.target.value) });
for (const k of ["with", "found", "brief", "live", "answer", "transcript"]) part[k] = h("div");
part.transcript.id = "transcript";
view.append(
  h("section", null, h("h2", null, "With"), part.with, searchBox, part.found),
  h("section", null, h("h2", null, "What YouBank knows"), part.brief),
  part.live,
  h("section", null, h("h2", null, "Ask about this meeting"), h("div", { class: "row" }, askBox, h("button", { class: "btn", onclick: () => ask(askBox.value) }, "Ask")), part.answer),
  h("section", null, h("h2", null, "Transcript"), part.transcript),
);

const fill = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter(Boolean));

function render() {
  fill(head, header());
  if (!st) return;
  const people = brief?.brief?.people ?? [];
  fill(part.with, people.length ? people.map((p) => h("span", { class: "chip" }, p.name || p.email)) : h("span", { class: "small muted" }, "Pick who this is with to see what YouBank knows about them."));
  searchBox.classList.toggle("hidden", !st.session);
  fill(part.found, search.found ? h("div", { style: "margin-top: 6px" },
    search.found.contacts.map((c) => h("button", { class: "btn", style: "margin: 0 4px 4px 0", onclick: () => pick("contact", c.id) }, c.name || c.email, c.company ? ` · ${c.company}` : "")),
    search.found.deals.map((d) => h("button", { class: "btn", style: "margin: 0 4px 4px 0", onclick: () => pick("deal", d.id) }, `Deal: ${d.name}`))) : null);
  fill(part.brief, brief?.lines?.length ? brief.lines.map((l) => h("p", { class: "line" }, l)) : h("p", { class: "small muted" }, brief ? "Nothing on file yet for the people picked." : st.session || lastId ? "Loading…" : "Start a meeting to see it."),
    brief ? h("button", { class: "btn link small", onclick: () => loadBrief(true) }, "Refresh") : null);

  const locked = !unlocked("meetings.live");
  fill(part.live, st.session ? h("section", null, h("h2", null, "Live suggestions"),
    h("label", { class: "row small" }, toggle(live.on, (v) => setLive(v), { disabled: locked && !live.on, title: locked ? "Part of the Pro plan" : "" }),
      h("span", null, "Suggest questions and facts as the meeting goes ", locked ? h("span", { class: "badge" }, "Pro") : null)),
    h("p", { class: "small muted" }, "Uses AI about once a minute while on, for this meeting only. Off when the meeting ends."),
    live.busy ? h("p", { class: "small muted" }, "Thinking…") : null,
    live.data ? [
      live.data.questions?.length ? [h("h3", null, "Ask"), h("ul", { class: "tight" }, live.data.questions.map((q) => h("li", null, q)))] : null,
      live.data.facts?.length ? [h("h3", null, "Remember"), h("ul", { class: "tight" }, live.data.facts.map((f) => h("li", null, h("strong", null, f.about), ": ", f.text)))] : null,
      live.data.watch?.length ? [h("h3", null, "Careful"), h("ul", { class: "tight" }, live.data.watch.map((w) => h("li", null, w)))] : null,
    ] : null) : null);

  fill(part.answer, answer ? h("div", { style: "margin-top: 8px" }, h("p", { class: "small muted" }, answer.q), answer.busy ? h("p", { class: "small muted" }, "Reading the transcript…") : [h("p", null, answer.answer),
    (answer.quotes ?? []).map((x) => h("p", { class: "small muted" }, `[${x.at}] ${x.speaker}: “${x.text}”`))]) : null);

  const tr = part.transcript;
  const atEnd = tr.scrollHeight - tr.scrollTop - tr.clientHeight < 40;
  fill(tr, segments.length
    ? segments.slice(-200).map((s) => h("p", { class: "seg" }, h("span", { class: "t" }, clock(s.start)), h("span", { class: `who${s.speaker === "You" ? " me" : ""}` }, /^S\d+[A-Z0-9]+$/.test(s.speaker ?? "") ? "Speaker" : s.speaker || "Speaker"), s.text))
    : h("p", { class: "small muted" }, st.session ? "The transcript appears here about every 30 seconds." : "Nothing yet."));
  // Follow the newest line, unless the person scrolled up to read.
  if (atEnd) tr.scrollTop = tr.scrollHeight;
}

listen("meeting://changed", load);
listen("meeting://segments", (p) => {
  if (p.meetingId !== (st?.session?.id ?? lastId)) return;
  segments = [...segments, ...p.segments];
  render();
});
listen("meeting://notes", (id) => { if (id === lastId) { notesReady = id; render(); } });
void load();
