/* Offline support: precache every file, then serve from cache and refresh in the background.
   Bump VERSION after changing the file list. */
const VERSION = "mp-v3";
const DEMOS = ["hanoi", "fractal", "fourier", "fluid", "cipher", "kaleidoscope", "chaos", "lightsout", "galton"];
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "shared/style.css",
  "shared/common.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/qr.svg",
  "icons/favicon.svg",
  "icons/favicon-32.png",
  "icons/favicon-48.png",
  ...DEMOS.flatMap((d) => [`demos/${d}.html`, `demos/${d}.js`]),
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  const cached = caches.open(VERSION).then((c) => c.match(e.request, { ignoreSearch: true }));
  // Refresh the cache in the background; keep the worker alive until it's saved.
  const network = fetch(e.request).then(async (res) => {
    if (res.ok) {
      const copy = res.clone();
      await (await caches.open(VERSION)).put(e.request, copy);
    }
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  e.respondWith(cached.then((hit) => hit || network));
});
