/* Offline support: precache every file, then serve from cache and refresh in the background.
   Bump VERSION after changing the file list. */
const VERSION = "mp-v2";
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
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(e.request, { ignoreSearch: true }).then((hit) => {
        const fresh = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      })
    )
  );
});
