const CACHE = 'washradar-shell-v7';
const scopeUrl = new URL(self.registration.scope);
const local = (path) => new URL(path, scopeUrl).toString();
const SHELL = [local('./'), local('offline.html'), local('favicon.svg'), local('icon-192.png'), local('icon-512.png')];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scopeUrl.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(local('./'), copy));
      }
      return response;
    }).catch(async () => (await caches.match(local('./'))) || (await caches.match(local('offline.html'))) || Response.error()));
    return;
  }
  if (url.pathname.includes('/assets/') || /\.(?:png|svg|ico|woff2)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title ?? 'WashRadar', {
    body: data.body ?? 'A saved wash has reached your queue target.',
    icon: local('icon-192.png'),
    badge: local('icon-192.png'),
    data: {url: data.url ?? local('alerts')},
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
