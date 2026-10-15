// Shared by the app's own screens. Talks to the Rust side only through the commands this window is
// allowed (capabilities/local.json); the device token never reaches a page.

const T = window.__TAURI__;
export const invoke = (cmd, args) => T.core.invoke(cmd, args);
export const listen = (event, fn) => T.event.listen(event, (e) => fn(e.payload));

/** Build an element: h("div", { class: "x", onclick }, "text", child). Text is always text, never HTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "value") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** A labelled on/off switch. */
export function toggle(checked, onchange, opts = {}) {
  const input = h("input", { type: "checkbox", checked, disabled: opts.disabled, onchange: (e) => onchange(e.target.checked) });
  return h("label", { class: "switch", title: opts.title }, input, h("span"));
}

let toastTimer;
/** A short message at the bottom of the window. */
export function toast(message, isError = false) {
  document.querySelector(".toast")?.remove();
  const t = h("div", { class: `toast${isError ? " err" : ""}`, role: "status" }, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), isError ? 7000 : 3500);
}

const OUR_SIDE = "Something went wrong in the app. Try again; if it keeps happening, restart YouBank.";
// What a sentence must not show: the system's own error text ("Permission denied (os error 13)"), a
// Rust or HTTP library's ("error sending request for url (…)", "task 12 panicked"), paths into code,
// links, dumped JSON, stack lines. The server already words its own errors; this is for the rest.
const INTERNAL = [
  /\(os error \d+\)|\bos error \d+\b|\berrno\b/i,
  /panicked|JoinError|RecvError|SendError|\bthread '|backtrace|RUST_BACKTRACE/i,
  /error sending request|error decoding|error trying to connect|hyper::|reqwest::|tauri::|serde_json::|\w+::\w+::/i,
  /\b[a-z][a-z0-9+.-]{1,15}:\/\//i,
  /^\s*[[{]/,
  /\bat \S+:\d+:\d+|\.rs:\d+/,
  /\b[A-Z][A-Za-z0-9]*(?:Error|Exception)\b:\s/,
];
const internal = (m) => !m.trim() || m.length > 400 || INTERNAL.some((r) => r.test(m));

/**
 * What to show for a failed command or event: its sentence as written when it reads as meant for
 * people; when the sentence ends in the system's own detail ("Could not save settings: Access is
 * denied. (os error 5)"), only the part before it; otherwise a plain line. The detail stays in the log.
 */
export function errorText(e) {
  const m = typeof e === "string" ? e : e instanceof Error ? e.message : typeof e?.message === "string" ? e.message : "";
  if (!internal(m)) return m;
  if (m) console.warn(m);
  const head = m.split(/: | \(/)[0].trim();
  return head.length >= 12 && head !== m && !internal(head) ? `${head.replace(/[.:]$/, "")}.` : OUR_SIDE;
}

/** Run a command, showing its error sentence if it fails. Returns undefined on failure. */
export async function run(cmd, args, okMessage) {
  try {
    const r = await invoke(cmd, args);
    if (okMessage) toast(typeof okMessage === "function" ? okMessage(r) : okMessage);
    return r;
  } catch (e) {
    toast(errorText(e), true);
    return undefined;
  }
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** The quick ask shortcut as the person would press it on this system. */
export function keyLabel(hotkey, platform) {
  if (!hotkey) return "off";
  const mac = platform === "macos";
  return hotkey
    .replace(/CommandOrControl|CmdOrCtrl/g, mac ? "⌘" : "Ctrl")
    .replace(/Shift/g, mac ? "⇧" : "Shift")
    .replace(/Alt|Option/g, mac ? "⌥" : "Alt")
    .replace(/\+/g, mac ? "" : "+");
}
