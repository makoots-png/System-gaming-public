// sw.js: network-first cache of the built app so it opens offline at the table after one visit.
// scripts/build.ts fills in __BUILD__ (the build id) and __SHELL__ (every file a page load needs), so a new build
// gets a new cache and the old one is dropped on activate. /api calls are never cached; if the network is down they
// answer 200 {ok:false,offline:true} (so the page's console stays clean and sync.ts can show "Offline: local only").
import { counted, firstCount, installOf } from './core/upgrade.ts';

const CACHE = 'hunter-system-' + __BUILD__;
const SHELL = __SHELL__;

// While it installs it tells every page of the app how many of the files it has cached and how many failed, so an
// update shows a true percentage (src/edge/upgrade.ts follows it, src/views/room-pill.ts says it). The count is
// src/core/upgrade.ts's, the rule the page reads too. A file that fails fails the install: the worker drops its own
// cache and never takes over, so the old worker and its whole cache stay; the browser tries again at the next load.
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE), pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let count = firstCount(SHELL.length);
    const tell = () => { for (const p of pages) p.postMessage({ type: 'caching', ...count }); };
    tell();
    const answers = await Promise.allSettled(SHELL.map(u => c.add(u).then(
      () => { count = counted(count, true); tell(); },
      err => { count = counted(count, false); tell(); throw err; },
    )));
    if (installOf(count) !== 'cached') {
      await caches.delete(CACHE);
      const failed = answers.flatMap((a, i) => (a.status === 'rejected' ? [SHELL[i]] : []));
      throw new Error(`install: ${failed.length} of ${SHELL.length} files did not cache (${failed.join(', ')})`);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hunter-system-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const offlineApi = () => new Response(JSON.stringify({ ok: false, offline: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Hunter-Offline': '1' } });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) { e.respondWith(fetch(req).catch(offlineApi)); return; } // no network: the app reads the offline answer as no answer (sync.ts)
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(err => console.warn('[sw] the offline copy was not kept:', req.url, err)); }
      return res;
    } catch { // no network: the copy cached at install, or the offline page
      const hit = await caches.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await caches.match('index.html') : null);
      return hit || new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});

// A tap on a notification (src/edge/notify.ts: a player used a told thing) shows the app: an open window is focused,
// else a new one opens.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find(c => new URL(c.url).origin === location.origin);
    return open ? open.focus() : self.clients.openWindow('./');
  })());
});
