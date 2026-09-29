/* YouBank Newsroom: shows alerts and the morning brief as notifications, and opens the story on click. */
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "YouBank", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "YouBank", {
    body: d.body || "", tag: d.tag || undefined, data: { url: d.url || "/app/news" }, icon: "/icon.svg", badge: "/icon.svg", requireInteraction: !!d.urgent,
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/news";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes("/app") && "focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
