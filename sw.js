const CACHE = "trainer-v3";
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
