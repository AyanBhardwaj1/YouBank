// The meeting pill. Three faces, from the app's meeting state:
// - offer: a call was noticed ("Zoom call detected. Start the meeting copilot?");
// - consent: before recording, the reminder that some places require everyone's consent, with the
//   notice to paste in the meeting chat;
// - recording: the red dot, the time, the copilot window and Stop (with "stop and delete").
import { h, invoke, listen, toast } from "./app.js";

const root = document.getElementById("pill");
let st = null; // meeting_state
let step = null; // "consent" once Start was chosen on an offer, "stopping" while confirming Stop
let copied = false;
let tick = null;

const LABEL = { zoom: "Zoom", teams: "Microsoft Teams", meet: "Google Meet", webex: "Webex", slack: "Slack huddle" };
const appName = (a) => LABEL[a] ?? "Meeting";

function elapsed(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh ? `${hh}:` : ""}${String(mm).padStart(hh ? 2 : 1, "0")}:${String(ss).padStart(2, "0")}`;
}

async function load() {
  st = await invoke("meeting_state");
  if (!st.session && step === "stopping") step = null;
  render();
}

async function start() {
  const p = st.prompt ?? { app: "other", title: "" };
  const s = await invoke("meeting_start", { args: { platform: p.app, appTitle: p.title, noticeCopied: copied, auto: false } }).catch((e) => { toast(String(e), true); return null; });
  if (s) { step = null; copied = false; await load(); }
}

async function copyNotice() {
  const text = st.server?.settings?.noticeText || "Heads up: I'm using YouBank to take notes on this call. It records audio to make a transcript and notes for me. Tell me if you'd rather I didn't.";
  try { await navigator.clipboard.writeText(text); copied = true; toast("Copied. Paste it in the meeting chat."); } catch { toast("Could not copy. The notice is in the desktop agent's Meetings section.", true); }
  render();
}

function recording(s) {
  clearInterval(tick);
  const time = h("span", { class: "time" }, elapsed(s.startedAt));
  tick = setInterval(() => { time.textContent = elapsed(s.startedAt); }, 1000);
  const note = s.problem || s.systemNote;
  if (step === "stopping") {
    return [
      h("p", null, h("strong", null, "Stop recording?"), " The notes are written once the rest of the audio is sent."),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => invoke("meeting_stop", { discard: false }).then(load) }, "Stop"),
        h("button", { class: "btn danger", onclick: () => invoke("meeting_stop", { discard: true }).then(load) }, "Stop and delete"),
        h("button", { class: "btn link", onclick: () => { step = null; render(); } }, "Keep recording")),
    ];
  }
  return [
    h("div", { class: "row", "data-tauri-drag-region": true },
      h("span", { class: "rec", title: "Recording" }), h("strong", null, "Recording"), time,
      h("span", { class: "grow small muted", "data-tauri-drag-region": true }, s.title || appName(s.platform)),
      h("button", { class: "btn", onclick: () => invoke("open_copilot") }, "Copilot"),
      h("button", { class: "btn danger", onclick: () => { step = "stopping"; render(); } }, "Stop")),
    note ? h("p", { class: "small note", title: note }, note.length > 110 ? `${note.slice(0, 108)}…` : note) : h("p", { class: "small muted" }, `${s.sent} sent${s.waiting ? ` · ${s.waiting} waiting` : ""} · ${s.mic}`),
  ];
}

function render() {
  if (!st) return;
  const p = st.prompt;
  let body;
  if (st.session) body = recording(st.session);
  else if (p && p.kind === "offer" && step !== "consent") {
    body = [
      h("p", null, h("strong", null, `${appName(p.app)} call detected.`), " Start the meeting copilot?"),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => { step = "consent"; render(); } }, "Start…"),
        h("button", { class: "btn", onclick: () => invoke("meeting_dismiss", { never: false }).then(load) }, "Not now"),
        h("button", { class: "btn link small", onclick: () => invoke("meeting_dismiss", { never: true }).then(() => toast(`YouBank will not offer to record ${appName(p.app)} meetings. Change it in the desktop agent.`)).then(load) }, `Never for ${appName(p.app)}`)),
    ];
  } else if (p || step === "consent") {
    body = [
      h("p", null, h("strong", null, "Record this meeting?"), " Some places require everyone's consent before a call is recorded. Let the others know, for example in the chat."),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: start }, "Start recording"),
        h("button", { class: "btn", onclick: copyNotice }, copied ? "Notice copied" : "Copy notice"),
        h("button", { class: "btn link", onclick: () => { step = null; invoke("meeting_dismiss", { never: false }).then(load); } }, "Cancel")),
    ];
  } else {
    clearInterval(tick);
    void invoke("hide_pill");
    body = [];
  }
  if (!st.session) clearInterval(tick);
  root.replaceChildren(...body.flat().filter(Boolean));
}

listen("meeting://changed", load);
listen("state://changed", load);
void load();
