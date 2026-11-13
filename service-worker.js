// Меняй версию при каждом обновлении игры, чтобы у игроков обновился кэш
const CACHE = 'star-orbit-v3';
const CORE = ['./', 'index.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
// Тяжёлые файлы: кэшируем при установке, но если не вышло — установка не ломается
const EXTRA = ['Textures/zelmir-company.mp4'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE).then(() => Promise.all(EXTRA.map(u => c.add(u).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// <video> просит файл кусками (Range) — отдаём нужный кусок из кэша
async function rangeResponse(req, res) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return res;
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (!m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1)
    }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase (аккаунты, мультиплеер, realtime) никогда не кэшируем
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  // Страница: сначала сеть (свежая версия), если офлайн — из кэша
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r;
    }).catch(() => caches.match('index.html')));
    return;
  }

  // Запросы кусками (видео, музыка): из кэша с поддержкой Range, иначе напрямую из сети
  if (req.headers.has('range')) {
    e.respondWith(caches.match(req.url).then(hit => hit ? rangeResponse(req, hit) : fetch(req)));
    return;
  }

  // Скины, звуки, музыка, скрипты: из кэша, а если нет — грузим и запоминаем
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.status === 200 && (url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net')) {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return r;
  })));
});

/* ---------- Пуш-уведомления ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Звезды с Орбиты', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    tag: d.tag || 'orbit',
    renotify: !!d.tag,
    data: { room: d.room || null, url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const target = new URL(d.url || './', self.registration.scope);
  if (d.room) target.hash = d.room;
  e.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin === target.origin) {
        try { await c.focus(); } catch (_) {}
        c.postMessage({ type: 'push-click', room: d.room || null });
        return;
      }
    }
    await clients.openWindow(target.href);
  })());
});
