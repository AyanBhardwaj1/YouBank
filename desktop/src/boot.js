// Start-up, first-run welcome and the offline screen of the main window.
import { invoke, keyLabel } from "./app.js";

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const s of ["boot", "welcome", "offline"]) $(s).classList.toggle("hidden", s !== id);
};

let timer;

/** Open the site if it answers, otherwise the offline screen. */
async function go() {
  show("boot");
  const s = await invoke("site_status").catch(() => ({ online: false, site: "" }));
  if (s.online) {
    await invoke("open_site", { path: null });
  } else {
    offline(s.site);
  }
}

function offline(site) {
  show("offline");
  $("site").textContent = site ? `(${new URL(site).host})` : "";
  let wait = 15;
  clearInterval(timer);
  const tick = () => {
    $("countdown").textContent = `in ${wait} second${wait === 1 ? "" : "s"}`;
    if (wait-- <= 0) {
      clearInterval(timer);
      void go();
    }
  };
  tick();
  timer = setInterval(tick, 1000);
}

$("retry").addEventListener("click", () => { clearInterval(timer); void go(); });
$("offline-agent").addEventListener("click", () => invoke("open_agent", { section: "account" }));
$("continue").addEventListener("click", () => void go());
$("setup").addEventListener("click", async () => {
  await invoke("open_agent", { section: "account" });
  void go();
});

(async () => {
  const st = await invoke("get_state");
  $("hotkey").textContent = keyLabel(st.settings.hotkey, st.platform);
  if (location.hash === "#offline") return offline(st.site);
  if (!st.settings.onboarded) return show("welcome");
  void go();
})();
