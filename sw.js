const CACHE = "trainer-v5";
const FILES = [
  "./",
  "./index.html",
  "./parent.html",
  "./css/app.css",
  "./js/app.js",
  "./js/parent.js",
  "./js/api.js",
  "./js/storage.js",
  "./js/ui.js",
  "./js/keypad.js",
  "./js/facts.js",
  "./js/levels.js",
  "./js/mascot.js",
  "./js/push.js",
  "./js/column-mul.js",
  "./js/long-div.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-180.png",
  "./icon-512.png",
  "./assets/pushin/fallback.svg",
  "./assets/pushin/01-sit.gif",
  "./assets/pushin/02-cookie.gif",
  "./assets/pushin/03-sleep.gif",
  "./assets/pushin/04-donut.gif",
  "./assets/pushin/05-box.gif",
  "./assets/pushin/06-pizza.gif",
  "./assets/pushin/07-write.gif",
  "./assets/pushin/08-cocoa.gif",
  "./assets/pushin/09-party.gif",
  "./assets/pushin/10-cake.gif",
  "./assets/pushin/11-hat.gif",
  "./assets/pushin/12-cupcake.gif",
  "./assets/pushin/13-hero.gif",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "Пушин";
  const body = payload.body || "Пушин ждёт. Семь минут.";
  const icon = new URL("./icon-180.png", self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    data: { url: new URL("./", self.registration.scope).href },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || new URL("./", self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
  );
});
