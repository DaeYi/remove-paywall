// Minimal service worker: cache the app shell so the PWA installs and opens offline.
const CACHE = "rp-v1";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // never touch the Worker API
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
