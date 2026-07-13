// Minimal service worker — no offline caching yet, just enough
// for browsers to consider this an installable app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {
  // pass-through, no caching for now
});
