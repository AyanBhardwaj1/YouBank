// The desktop agent's settings window. Every part that reaches beyond the window starts with a consent
// screen saying exactly what it does; the Rust side keeps anything without consent switched off,
// whatever this page sends.
import { ago, h, invoke, keyLabel, listen, plural, run, toast, toggle } from "./app.js";

const view = document.getElementById("view");
let st = null; // get_state
let section = "account";
let pairing = null; // { code, approveUrl }
let progress = null; // { done, total, name }
let docs = null; // Studio documents, once loaded
const pending = {}; // per-row inline confirmations and answers

const FREE_TIERS = { "desktop.folders": "Pro", "desktop.background_ai": "Pro", "desktop.office_agent": "Pro", "meetings.live": "Pro", "meetings.bot": "Pro", "meetings.notes": "Pro" };

const unlocked = (id) => !!st?.account?.unlocked?.includes(id);
const premium = (id) => (unlocked(id) ? null : h("span", { class: "badge", title: "Part of a paid plan" }, FREE_TIERS[id] ?? "Pro"));

async function load() {
  st = await invoke("get_state");
  document.getElementById("foot").textContent = `Version ${st.version}${st.connected ? "" : " · not connected"}`;
}

async function save(mutate) {
  const next = structuredClone(st.settings);
  mutate(next);
  const r = await run("save_settings", { settings: next });
  if (r) st.settings = r;
  render();
}

function consent(what, title, bullets, label) {
  return h("div", { class: "panel soft consent" },
    h("h2", null, title),
    h("ul", { class: "tight" }, bullets.map((b) => h("li", null, b))),
    h("div", { class: "row", style: "margin-top: 10px" },
      h("button", { class: "btn primary", onclick: async () => { const r = await run("accept_consent", { what }); if (r) { st.settings = r; render(); } } }, label)));
}

function needConnect() {
  return h("div", { class: "panel" }, h("p", null, "Connect this computer to your YouBank account first."), h("button", { class: "btn primary", onclick: () => go("account") }, "Connect"));
}

/* ---------------- Account ---------------- */

function account() {
  const a = st.account;
  if (st.connected) {
    return [
      h("h1", null, "Account"),
      h("div", { class: "panel" },
        a ? [h("h2", null, a.name || a.email), h("p", { class: "muted" }, `${a.email} · ${a.plan} plan${a.admin ? " · administrator" : ""}`)]
          : h("p", { class: "muted" }, "Connected. Loading your account…"),
        h("div", { class: "row wrap", style: "margin-top: 8px" },
          h("button", { class: "btn", onclick: async () => { await run("refresh_account"); await refresh(); } }, "Refresh"),
          h("button", { class: "btn danger", onclick: async () => { await run("sign_out", undefined, "This computer is disconnected."); await refresh(); } }, "Disconnect this computer"))),
      h("p", { class: "small muted" }, "The connection is kept in this computer's keychain and only works for the desktop app. See or disconnect every connected computer on the site under Settings → Desktop app."),
    ];
  }
  return [
    h("h1", null, "Connect this computer"),
    h("p", { class: "muted" }, "Connecting lets alerts, quick ask, your files and scheduled tasks work as you, even with the YouBank window closed."),
    pairing
      ? h("div", { class: "panel soft" },
        h("p", null, "Approve this code on YouBank:"),
        h("p", { class: "mono", style: "font-size: 22px; letter-spacing: 0.15em" }, pairing.code),
        h("p", { class: "small muted" }, "The YouBank window shows the approval page. Waiting for you to approve…"),
        h("div", { class: "row" },
          h("button", { class: "btn", onclick: () => invoke("open_external", { url: pairing.approveUrl }) }, "Approve in my browser instead"),
          h("button", { class: "btn", onclick: async () => { await invoke("pair_cancel"); pairing = null; render(); } }, "Cancel")))
      : h("div", { class: "row wrap" },
        h("button", { class: "btn primary", onclick: () => startPairing(false) }, "Connect"),
        h("button", { class: "btn", onclick: () => startPairing(true) }, "Connect in my browser")),
    h("p", { class: "small muted" }, "You'll be asked to sign in to YouBank if you are not already, then to approve a short code. Only approve a code this app shows you."),
  ];
}

async function startPairing(inBrowser) {
  const p = await run("pair_start", { inBrowser });
  if (p) { pairing = p; render(); }
}

/* ---------------- Local files ---------------- */

function files() {
  const s = st.settings;
  const out = [h("h1", null, "Local files"), h("p", { class: "muted" }, "Folders of CIMs, models and memos, searchable in your research, Edge and Studio.")];
  if (!st.connected) return [...out, needConnect()];
  if (!s.consents.files) {
    return [...out, consent("files", "Before you turn this on", [
      "Only folders you add, and only the PDF, Word, Excel and PowerPoint files in them (up to 200 MB each).",
      "Each file is fingerprinted on this computer. Only new or changed files are uploaded to YouBank, where they become Edge documents that cited answers and Studio can use.",
      "YouBank gets each file's name and contents, never where it lives on your computer.",
      `Uploads count toward your Edge document quota. The first ${st.account?.filesFree ?? 25} files are free; more need a Pro plan.`,
      "Edge must be on for your account (on the site: Settings → Labs).",
      "Remove a folder to stop; you can delete what it uploaded at the same time.",
    ], "Turn on local files")];
  }
  const a = st.account;
  out.push(h("div", { class: "panel row wrap" },
    h("div", { class: "grow" },
      h("div", null, "Local files ", toggle(s.files.enabled, (v) => save((n) => { n.files.enabled = v; })))),
    a ? h("span", { class: "small muted" }, unlocked("desktop.folders") ? `${a.filesUsed} files indexed · no limit on your plan` : `${a.filesUsed} of ${a.filesFree} free files used `, premium("desktop.folders")) : null));
  if (!s.files.enabled) return out;

  out.push(h("h2", { style: "margin-top: 18px" }, "Folders"));
  const folders = h("div", { class: "panel" });
  if (!s.files.folders.length) folders.append(h("p", { class: "muted" }, "No folders yet."));
  for (const f of s.files.folders) {
    const key = `folder:${f.path}`;
    folders.append(h("div", { class: "item" },
      h("div", { class: "grow" }, h("div", { class: "mono" }, f.path),
        h("label", { class: "row small muted", style: "margin-top: 4px" }, toggle(f.autoUpload, (v) => run("set_folder_auto", { path: f.path, autoUpload: v }).then(refresh)), "Add new and changed files without asking")),
      pending[key]
        ? h("div", { class: "row wrap" },
          h("span", { class: "small" }, "Also delete what it uploaded?"),
          h("button", { class: "btn", onclick: () => removeFolder(f.path, false) }, "Keep documents"),
          h("button", { class: "btn danger", onclick: () => removeFolder(f.path, true) }, "Delete them"),
          h("button", { class: "btn link", onclick: () => { delete pending[key]; render(); } }, "Cancel"))
        : h("div", { class: "row" },
          h("button", { class: "btn", onclick: () => invoke("open_local", { path: f.path, reveal: false }).catch((e) => toast(String(e), true)) }, "Open"),
          h("button", { class: "btn danger", onclick: () => { pending[key] = true; render(); } }, "Remove"))));
  }
  folders.append(h("div", { class: "row", style: "margin-top: 10px" }, h("button", { class: "btn", onclick: addFolder }, "Add a folder…")));
  out.push(folders);

  const list = h("div", null, h("p", { class: "muted" }, "Loading…"));
  out.push(h("h2", { style: "margin-top: 18px" }, "Files"), list);
  void invoke("files_status").then(({ entries }) => {
    const count = (s) => entries.filter((e) => e.status === s).length;
    const waiting = count("pending") + count("failed");
    const blocked = count("needsPlan");
    list.replaceChildren(...[
      h("div", { class: "row wrap", style: "margin-bottom: 8px" },
        h("span", { class: "grow muted" }, `${plural(count("indexed"), "file")} in YouBank · ${waiting} waiting${blocked ? ` · ${blocked} need a plan` : ""}`),
        h("button", { class: "btn", onclick: () => run("scan_files", undefined, (r) => `${plural(r.found, "file")} found, ${r.pending} new or changed.`).then(render) }, "Check folders"),
        h("button", { class: "btn primary", disabled: !(waiting + blocked) || !!progress, onclick: upload }, `Add ${plural(waiting + blocked, "file")}`)),
      progress ? h("div", { style: "margin-bottom: 8px" }, h("div", { class: "progress" }, h("div", { style: `width: ${progress.total ? (100 * progress.done) / progress.total : 0}%` })), h("p", { class: "small muted" }, progress.name ? `Sending ${progress.name}…` : "")) : null,
      entries.length
        ? h("table", null, h("tr", null, h("th", null, "File"), h("th", null, "Status"), h("th")),
          entries.sort((a, b) => (a.status === "indexed") - (b.status === "indexed") || a.name.localeCompare(b.name)).slice(0, 300).map((e) => h("tr", null,
            h("td", null, e.name, h("div", { class: "small muted" }, e.folder)),
            h("td", { class: `status-${e.status}` }, { pending: "Waiting", indexed: `In YouBank${e.uploadedAt ? ` · ${ago(e.uploadedAt)}` : ""}`, failed: e.error || "Failed", needsPlan: "Needs a Pro plan" }[e.status] ?? e.status),
            h("td", null, e.status === "indexed" ? h("button", { class: "btn link small", onclick: () => run("remove_indexed_file", { path: e.path }, "Removed from YouBank.").then(render) }, "Remove from YouBank") : null))))
        : h("p", { class: "muted" }, "Add a folder, then check it."),
    ].filter(Boolean));
  });
  return out;
}

async function addFolder() {
  const path = await run("pick_path", { kind: "folder" });
  if (!path) return;
  const r = await run("add_folder", { path, autoUpload: false }, (r) => `${plural(r.found, "file")} found; ${r.pending} to add.`);
  if (r) await refresh();
}

async function removeFolder(path, removeDocs) {
  delete pending[`folder:${path}`];
  await run("remove_folder", { path, removeDocs }, removeDocs ? "Folder removed, and its documents deleted." : "Folder removed. Its documents stay in YouBank.");
  await refresh();
}

async function upload() {
  const r = await run("upload_files", { paths: null });
  if (r) toast(r.stopped ?? `${plural(r.uploaded, "file")} added${r.failed ? `, ${r.failed} failed` : ""}.`, !!r.stopped);
  progress = null;
  await refresh();
}

/* ---------------- Excel and PowerPoint ---------------- */

function office() {
  const s = st.settings;
  const out = [h("h1", null, "Excel and PowerPoint"), h("p", { class: "muted" }, "Studio models and decks as real files on this computer. Your saved edits go back to Studio as one change you can undo.")];
  if (!st.connected) return [...out, needConnect()];
  if (!s.consents.office) {
    return [...out, consent("office", "Before you turn this on", [
      "You pull a Studio model as a real .xlsx (or a deck as .pptx) into a YouBank folder on this computer, and it opens in Excel or PowerPoint.",
      "When you save a linked workbook, the app notices and sends it back to Studio, or asks first: your choice.",
      "Only files you pull or link yourself. Before anything is written over a file, a copy goes into the folder's .backups.",
      "Decks go one way for now: changes made in PowerPoint are not read back into Studio.",
      "AI edits to a local file are part of the Pro plan; each one is a full Studio agent run.",
    ], "Turn on Excel and PowerPoint")];
  }
  out.push(h("div", { class: "panel" },
    h("div", { class: "row wrap" },
      h("span", { class: "grow" }, "Excel and PowerPoint sync ", toggle(s.office.enabled, (v) => save((n) => { n.office.enabled = v; })))),
    h("div", { class: "row wrap", style: "margin-top: 8px" },
      h("span", { class: "grow small muted" }, "Folder: ", h("span", { class: "mono", id: "office-folder" }, "…")),
      h("button", { class: "btn", onclick: () => invoke("office_status").then((o) => invoke("open_local", { path: o.folder })).catch((e) => toast(String(e), true)) }, "Open folder"),
      h("button", { class: "btn", onclick: async () => { const p = await run("pick_path", { kind: "folder" }); if (p) save((n) => { n.office.folder = p; }); } }, "Change…")),
    h("label", { class: "row small", style: "margin-top: 8px" }, toggle(s.office.autoPush, (v) => save((n) => { n.office.autoPush = v; })), "Send a linked workbook to Studio as soon as I save it")));
  if (!s.office.enabled) return out;

  const links = h("div", { class: "panel" }, h("p", { class: "muted" }, "Loading…"));
  out.push(h("h2", { style: "margin-top: 18px" }, "Linked files"), links);
  void invoke("office_status").then((o) => {
    const f = document.getElementById("office-folder");
    if (f) f.textContent = o.folder;
    links.replaceChildren(...(o.links.length ? o.links.map(linkRow) : [h("p", { class: "muted" }, "Nothing linked yet. Pull a Studio document below, or link a workbook you already have.")]),
      h("div", { class: "row", style: "margin-top: 10px" }, h("button", { class: "btn", onclick: linkWorkbook }, "Link a local workbook…")));
  });

  out.push(h("h2", { style: "margin-top: 18px" }, "Pull from Studio"));
  const list = h("div", { class: "panel" });
  if (!docs) list.append(h("button", { class: "btn", onclick: async () => { docs = (await run("studio_docs")) ?? null; render(); } }, "Show my Studio documents"));
  else if (!docs.length) list.append(h("p", { class: "muted" }, "No Studio documents yet."));
  else for (const d of docs.slice(0, 100)) {
    list.append(h("div", { class: "item" },
      h("div", { class: "grow" }, d.title, h("div", { class: "small muted" }, [d.sheets ? plural(d.sheets, "sheet") : null, d.slides ? plural(d.slides, "slide") : null, d.updatedAt ? `updated ${ago(d.updatedAt)}` : null].filter(Boolean).join(" · "))),
      h("div", { class: "row" },
        d.sheets ? h("button", { class: "btn", onclick: () => pull(d.id, "xlsx") }, "Open in Excel") : null,
        d.slides ? h("button", { class: "btn", onclick: () => pull(d.id, "pptx") }, "Open in PowerPoint") : null)));
  }
  out.push(list);
  return out;
}

function linkRow(l) {
  const key = `link:${l.path}`;
  const p = pending[key] ?? {};
  const name = l.path.split(/[\\/]/).pop();
  const state = l.missing ? h("span", { class: "neg" }, "File missing") : l.changed ? h("span", { class: "warn" }, "Changed here, not in Studio yet") : h("span", { class: "pos" }, "Up to date");
  const set = (v) => { pending[key] = { ...p, ...v }; render(); };
  return h("div", { class: "item", style: "flex-direction: column; align-items: stretch" },
    h("div", { class: "row wrap" },
      h("div", { class: "grow" }, h("strong", null, l.title || name), h("div", { class: "small muted" }, name, " · ", state, l.syncedAt ? ` · synced ${ago(l.syncedAt)}` : "")),
      h("button", { class: "btn", disabled: l.missing, onclick: () => invoke("open_local", { path: l.path }).catch((e) => toast(String(e), true)) }, "Open"),
      l.format === "xlsx" ? h("button", { class: "btn", disabled: l.missing, onclick: () => push(l.path, false) }, "Send to Studio") : null,
      h("button", { class: "btn", onclick: () => pull(l.docId, l.format) }, "Pull fresh copy"),
      h("button", { class: "btn link small", onclick: () => run("studio_unlink", { path: l.path }).then(render) }, "Unlink")),
    p.conflict ? h("div", { class: "panel soft", style: "margin-top: 8px" }, h("p", null, p.conflict),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => { delete pending[key]; void pull(l.docId, l.format); } }, "Pull a fresh copy (yours is backed up)"),
        h("button", { class: "btn danger", onclick: () => { delete pending[key]; void push(l.path, true); } }, "Send mine anyway"))) : null,
    l.format === "xlsx" && !l.missing ? h("div", { class: "row", style: "margin-top: 8px" },
      h("input", { type: "text", class: "grow", placeholder: "Ask the agent to change this file, e.g. “add a WACC sensitivity table”", value: p.instruction ?? "", oninput: (e) => { pending[key] = { ...(pending[key] ?? {}), instruction: e.target.value }; } }),
      premium("desktop.office_agent"),
      h("button", { class: "btn primary", disabled: p.working || !unlocked("desktop.office_agent"), title: unlocked("desktop.office_agent") ? "" : "AI edits to local files are part of the Pro plan", onclick: () => agentEdit(l.path, key) }, p.working ? "Working…" : "Ask the agent")) : null,
    p.summary ? h("p", { class: "small", style: "margin-top: 6px; white-space: pre-wrap" }, p.summary) : null);
}

async function pull(docId, format) {
  const path = await run("studio_pull", { docId, format, open: true }, "Saved and opened.");
  if (path) render();
}

async function push(path, force) {
  const r = await invoke("studio_push", { path, force });
  if (r.conflict) { pending[`link:${path}`] = { conflict: r.message }; render(); return; }
  toast(r.message, !r.ok);
  render();
}

async function linkWorkbook() {
  const path = await run("pick_path", { kind: "workbook" });
  if (!path) return;
  await run("studio_link", { path }, "Linked: it is now a Studio document too.");
  render();
}

async function agentEdit(path, key) {
  const instruction = (pending[key]?.instruction ?? "").trim();
  if (!instruction) return toast("Say what to change first.", true);
  pending[key] = { instruction, working: true };
  render();
  try {
    const summary = await invoke("studio_agent", { path, instruction });
    pending[key] = { summary: `Done. ${summary}\nThe version before is in the folder's .backups.` };
  } catch (e) {
    pending[key] = { instruction, summary: String(e) };
  }
  render();
}

/* ---------------- Alerts ---------------- */

function alerts() {
  const n = st.settings.notifications;
  const out = [h("h1", null, "Alerts"), h("p", { class: "muted" }, "Native notifications for what happens on YouBank, even with the window closed.")];
  if (!st.connected) return [...out, needConnect()];
  if (!st.settings.consents.alerts) {
    return [...out, consent("alerts", "Before you turn this on", [
      "Every few minutes while the app runs, it asks YouBank what is new for you and shows each new item once.",
      "Checking only reads what YouBank already has; it never starts anything that costs money.",
      "You choose which kinds below. Your system's notification settings still apply.",
    ], "Turn on alerts")];
  }
  const row = (label, hint, value, set) => h("div", { class: "item" }, toggle(value, (v) => save((s) => set(s, v))), h("div", { class: "grow" }, h("div", null, label), h("div", { class: "small muted" }, hint)));
  out.push(h("div", { class: "panel" },
    row("Edge findings and other alerts", "Big changes at the companies and places you watch, and the alerts you set up in the Newsroom.", n.alerts, (s, v) => { s.notifications.alerts = v; }),
    row("Questions from your email agent", "When it needs something only you know before it can finish a reply.", n.questions, (s, v) => { s.notifications.questions = v; }),
    row("News about deals in your pipeline", "A finding or filing about a company in a deal you are tracking.", n.deals, (s, v) => { s.notifications.deals = v; }),
    row("Meeting notes ready", "Notes from the notetaker, or from a meeting recorded on another computer. Meetings recorded here always tell you.", n.meetings, (s, v) => { s.notifications.meetings = v; }),
    h("div", { class: "row", style: "margin-top: 10px" },
      h("span", { class: "grow" }, "Check every ",
        h("select", { onchange: (e) => save((s) => { s.notifications.everyMinutes = Number(e.target.value); }) },
          [2, 5, 10, 15, 30, 60].map((m) => h("option", { value: m, selected: m === n.everyMinutes ? "" : null }, `${m} minutes`)))),
      h("button", { class: "btn", onclick: () => run("check_alerts", undefined, (k) => (k ? `${plural(k, "new item")}.` : "Nothing new.")) }, "Check now"))));
  return out;
}

/* ---------------- Scheduled tasks ---------------- */

function tasks() {
  const t = st.settings.tasks;
  const out = [h("h1", null, "Scheduled tasks"), h("p", { class: "muted" }, "Briefs and checks while the app sits in the tray.")];
  if (!st.connected) return [...out, needConnect()];
  if (!st.settings.consents.tasks) {
    return [...out, consent("tasks", "Before you turn this on", [
      "Tasks run on this computer's schedule, only while the app is running (in the tray is enough) and connected.",
      "The morning brief and email agent status only read what YouBank already has. They are free.",
      "The Edge brief and watch checks use AI or satellite checks, which cost money each time. They are part of the Pro plan and never run unless you switch each one on here. YouBank keeps its own copy of these switches and refuses a task that is off.",
      "Each task has a daily limit, and you can run any of them now by hand.",
    ], "Turn on scheduled tasks")];
  }
  const ai = !unlocked("desktop.background_ai");
  const timeInput = (value, set) => h("input", { type: "time", value, onchange: (e) => save((s) => set(s, e.target.value)) });
  const hoursSelect = (value, options, set) => h("select", { onchange: (e) => save((s) => set(s, Number(e.target.value))) }, options.map((n) => h("option", { value: n, selected: n === value ? "" : null }, `every ${n} hours`)));
  const row = (id, label, hint, on, set, schedule, isAi) => h("div", { class: "item" },
    toggle(on, (v) => save((s) => set(s, v)), { disabled: isAi && ai && !on, title: isAi && ai ? "Part of the Pro plan" : "" }),
    h("div", { class: "grow" }, h("div", null, label, " ", isAi ? h("span", { class: "small muted" }, "· uses AI ") : h("span", { class: "small muted" }, "· free "), isAi ? premium("desktop.background_ai") : null), h("div", { class: "small muted" }, hint)),
    schedule,
    h("button", { class: "btn", disabled: isAi && ai, onclick: () => run("run_task", { id }, (r) => r.title) }, "Run now"));
  out.push(h("div", { class: "panel" },
    row("morning-brief", "Morning brief", "Today's brief for your desk.", t.morningBrief.on, (s, v) => { s.tasks.morningBrief.on = v; }, timeInput(t.morningBrief.at, (s, v) => { s.tasks.morningBrief.at = v; }), false),
    row("autopilot-status", "Email agent status", "Drafts to review, sends queued and questions waiting for you. Quiet when there is nothing.", t.autopilotStatus.on, (s, v) => { s.tasks.autopilotStatus.on = v; }, hoursSelect(t.autopilotStatus.hours, [1, 2, 4, 8, 12, 24], (s, v) => { s.tasks.autopilotStatus.hours = v; }), false),
    row("edge-brief", "Edge brief", "What changed at the companies and places you watch, in a few cited lines.", t.edgeBrief.on, (s, v) => { s.tasks.edgeBrief.on = v; }, timeInput(t.edgeBrief.at, (s, v) => { s.tasks.edgeBrief.at = v; }), true),
    row("watch-check", "Watch checks", "Look at your watched sites again between YouBank's daily passes.", t.watchCheck.on, (s, v) => { s.tasks.watchCheck.on = v; }, hoursSelect(t.watchCheck.hours, [6, 12, 24, 48], (s, v) => { s.tasks.watchCheck.hours = v; }), true)));
  if (ai) out.push(h("p", { class: "small muted" }, "The AI tasks are part of the Pro plan. See plans on the site under Settings → Plan."));
  return out;
}

/* ---------------- Meetings ---------------- */

let meet = null; // meeting_state, with the site's copilot settings and recent meetings
let meetDraft = null; // edits to the site's copilot settings, until saved

const APPS = [["zoom", "Zoom"], ["teams", "Microsoft Teams"], ["meet", "Google Meet"], ["webex", "Webex"], ["slack", "Slack huddles"]];
const STATUS = { joining: "Notetaker joining", live: "Recording", processing: "Writing notes", ready: "Notes ready", failed: "Failed", cancelled: "Stopped" };

async function loadMeetings(fresh) {
  if (fresh && st.connected) await invoke("meeting_refresh").catch((e) => toast(String(e), true));
  meet = await invoke("meeting_state");
  if (section === "meetings") render();
}

function meetings() {
  const s = st.settings;
  const out = [h("h1", null, "Meetings"), h("p", { class: "muted" }, "The meeting copilot listens to your calls and files what it learns into Relationships: a summary, decisions, action items, how each person came across, follow-up drafts, and proposed updates to your deals that you accept or reject.")];
  if (!st.connected) return [...out, needConnect()];
  if (!s.consents.meetings) {
    return [...out, consent("meetings", "Before you turn this on", [
      "Nothing is recorded until you start it. When a Zoom, Teams, Meet, Webex or Slack call begins, YouBank can offer to start; you choose.",
      "Before each recording it reminds you that some places require everyone's consent to record a call, and offers a notice you can paste in the meeting chat.",
      "While it records, the tray icon shows a red dot and a small window on top of your screen shows the time and a Stop button.",
      "It records your microphone and, where the system allows, what your computer plays (the other side of the call). Audio goes to YouBank in pieces of about 30 seconds to be transcribed, and is deleted as soon as it is; YouBank never keeps it.",
      "Capture and transcripts are free. Notes for the first few meetings each month are free; more, live suggestions during a call and the notetaker bot are part of the Pro plan.",
      "Apps and words you choose are never recorded. Stop and delete throws a recording away.",
    ], "Turn on the meeting copilot")];
  }
  if (!meet) { void loadMeetings(true); return [...out, h("p", { class: "muted" }, "Loading…")]; }
  const m = s.meetings;
  const server = meet.server ?? {};
  const set = (k, v) => save((n) => { n.meetings[k] = v; });
  out.push(h("div", { class: "panel stack" },
    h("div", { class: "row wrap" }, h("span", { class: "grow" }, "Meeting copilot ", toggle(m.enabled, (v) => set("enabled", v))),
      meet.session ? h("span", { class: "neg" }, "Recording now") : h("button", { class: "btn primary", disabled: !m.enabled, onclick: () => run("meeting_prompt", { platform: null, title: null }) }, "Start the copilot now")),
    h("label", { class: "row" }, toggle(m.detect, (v) => set("detect", v)), "Notice meeting calls and offer to start"),
    h("label", { class: "row" }, toggle(m.systemAudio, (v) => set("systemAudio", v)), "Record what my computer plays, not only my microphone (needed with headphones)"),
    h("label", { class: "row" }, toggle(m.openCopilot, (v) => set("openCopilot", v)), "Open the copilot window when recording starts"),
    h("label", { class: "row" }, toggle(m.keepAudio, (v) => set("keepAudio", v)), "Keep a copy of the audio on this computer (Documents/YouBank/Meetings)"),
    server.capture === false ? h("p", { class: "small neg" }, "Transcription is not set up on this YouBank yet, so recording is not possible.") : null,
    st.platform === "macos" ? h("p", { class: "small muted" }, "On macOS, recording what the computer plays needs macOS 14.2 or later; the first time, allow YouBank under System Settings → Privacy & Security → Screen & System Audio Recording.") : null));

  const d = meetDraft ?? structuredClone(server.settings ?? {});
  meetDraft = d;
  const checks = (key, exclude = []) => h("div", { class: "row wrap" }, APPS.filter(([id]) => !exclude.includes(id)).map(([id, label]) => h("label", { class: "row small" },
    h("input", { type: "checkbox", checked: (d[key] ?? []).includes(id), onchange: (e) => { d[key] = e.target.checked ? [...(d[key] ?? []), id] : (d[key] ?? []).filter((x) => x !== id); render(); } }), label)));
  out.push(h("h2", { style: "margin-top: 18px" }, "Consent and rules"), h("div", { class: "panel stack" },
    h("div", null, h("div", null, "Notice to paste in the meeting chat"), h("textarea", { rows: 3, style: "width: 100%; margin-top: 4px", oninput: (e) => { d.noticeText = e.target.value; } }, d.noticeText ?? "")),
    h("div", null, h("div", null, "Never record"), checks("neverApps")),
    h("div", null, h("div", null, "Never record meetings that mention (separated by commas)"),
      h("input", { type: "text", style: "width: 100%; margin-top: 4px", value: (d.neverKeywords ?? []).join(", "), oninput: (e) => { d.neverKeywords = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); } })),
    h("div", null, h("div", null, "Start without asking for"), h("p", { class: "small muted" }, "Off by default. The red dot and the Stop button still show. Only where you always have consent."), checks("autoStartApps", d.neverApps ?? [])),
    h("div", { class: "row" }, h("button", { class: "btn primary", onclick: async () => { const r = await run("meeting_server_settings", { settings: d }, "Saved for all your computers."); if (r) { meetDraft = null; await loadMeetings(false); } } }, "Save"),
      h("span", { class: "small muted" }, "These apply on every computer. Retention, notes and the notetaker are set on the site, in Relationships → Meetings."))));

  const notes = server.notes;
  out.push(h("h2", { style: "margin-top: 18px" }, "Recent meetings"), h("div", { class: "panel" },
    notes ? h("p", { class: "small muted" }, notes.unlimited ? "Notes for every meeting on your plan." : `${Math.max(0, notes.free - notes.used)} of ${notes.free} free meeting notes left this month. `, notes.unlimited ? null : premium("meetings.notes")) : null,
    (server.meetings ?? []).length
      ? (server.meetings ?? []).slice(0, 12).map((x) => h("div", { class: "item" },
        h("div", { class: "grow" }, h("strong", null, x.title || "Untitled meeting"), h("div", { class: "small muted" }, `${new Date(x.startedAt).toLocaleString()} · ${STATUS[x.status] ?? x.status}`)),
        h("button", { class: "btn", onclick: () => invoke("open_site", { path: `/app/crm?tab=meetings&meeting=${x.id}` }) }, "Open notes")))
      : h("p", { class: "muted" }, "No meetings yet."),
    h("div", { class: "row", style: "margin-top: 8px" }, h("button", { class: "btn", onclick: () => loadMeetings(true) }, "Refresh"), h("button", { class: "btn", onclick: () => invoke("open_copilot") }, "Open the copilot window"))));
  return out;
}

/* ---------------- App ---------------- */

function app() {
  const s = st.settings;
  let site = s.siteUrl, hotkey = s.hotkey;
  return [
    h("h1", null, "App"),
    h("div", { class: "panel stack" },
      h("div", { class: "row wrap" }, h("span", { class: "grow" }, "Quick ask shortcut: ", h("strong", null, keyLabel(s.hotkey, st.platform))),
        h("input", { type: "text", value: s.hotkey, placeholder: "CommandOrControl+Shift+Space", oninput: (e) => { hotkey = e.target.value; } }),
        h("button", { class: "btn", onclick: () => save((n) => { n.hotkey = hotkey.trim(); }) }, "Save"),
        h("button", { class: "btn link", onclick: () => save((n) => { n.hotkey = ""; }) }, "Turn off")),
      h("label", { class: "row" }, toggle(s.launchAtLogin, (v) => save((n) => { n.launchAtLogin = v; })), "Start YouBank when I sign in to this computer (in the tray)"),
      h("label", { class: "row" }, toggle(s.closeToTray, (v) => save((n) => { n.closeToTray = v; })), "Keep running in the tray when I close the window (alerts and tasks need this)")),
    h("h2", { style: "margin-top: 18px" }, "Updates"),
    h("div", { class: "panel row wrap" },
      h("span", { class: "grow" }, `YouBank ${st.version}`, st.updateReady ? h("span", { class: "pos" }, ` · ${st.updateReady} is ready`) : null),
      st.updateReady
        ? h("button", { class: "btn primary", onclick: () => run("install_update") }, "Restart to update")
        : h("button", { class: "btn", onclick: () => run("check_update", undefined, (v) => (v ? `Version ${v} is ready.` : "You have the latest version.")).then(refresh) }, "Check for updates")),
    h("h2", { style: "margin-top: 18px" }, "Site address"),
    h("div", { class: "panel" },
      h("p", { class: "small muted" }, `This app opens ${st.site}${st.customSite ? " (not the usual address)" : ""}. Change it only to test a staging or local copy of YouBank; it takes effect the next time the app starts. The YOUBANK_URL environment variable overrides it.`),
      h("div", { class: "row" },
        h("input", { type: "text", class: "grow", value: s.siteUrl, placeholder: "https://youbank-nu.vercel.app", oninput: (e) => { site = e.target.value; } }),
        h("button", { class: "btn", onclick: () => save((n) => { n.siteUrl = site.trim(); }).then(() => toast("Saved. Quit and reopen YouBank to use it.")) }, "Save"))),
  ];
}

/* ---------------- Shell ---------------- */

const SECTIONS = { account, files, office, alerts, tasks, meetings, app };

function render() {
  if (!st) return;
  for (const b of document.querySelectorAll("nav button")) b.classList.toggle("on", b.dataset.section === section);
  view.replaceChildren(...[SECTIONS[section]()].flat(Infinity).filter(Boolean));
}

function go(s) {
  if (SECTIONS[s]) section = s;
  render();
}

async function refresh() {
  await load();
  render();
}

for (const b of document.querySelectorAll("nav button")) b.addEventListener("click", () => go(b.dataset.section));
listen("agent://section", (s) => go(s));
listen("state://changed", refresh);
listen("files://changed", () => { if (section === "files") render(); });
listen("office://changed", () => { if (section === "office") render(); });
listen("files://progress", (p) => { progress = p.done >= p.total ? null : p; if (section === "files") render(); });
listen("meeting://changed", () => { if (section === "meetings") void loadMeetings(false); });
listen("pair://done", (who) => { pairing = null; toast(`Connected${who ? ` as ${who}` : ""}.`); void refresh(); });
listen("pair://expired", () => { pairing = null; toast("That code expired. Choose Connect for a new one.", true); render(); });
listen("pair://failed", (m) => { pairing = null; toast(m, true); render(); });

(async () => {
  await load();
  if (st.agentSection && SECTIONS[st.agentSection]) section = st.agentSection;
  render();
  if (st.connected) { await invoke("refresh_account").catch(() => null); await refresh(); }
})();
