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

/** Run a command, showing its error sentence if it fails. Returns undefined on failure. */
export async function run(cmd, args, okMessage) {
  try {
    const r = await invoke(cmd, args);
    if (okMessage) toast(typeof okMessage === "function" ? okMessage(r) : okMessage);
    return r;
  } catch (e) {
    toast(String(e), true);
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
