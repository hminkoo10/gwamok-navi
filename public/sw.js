// 오프라인용 서비스 워커. 화면 파일은 네트워크를 먼저 보고, 해시가 붙은 정적 파일은 캐시를 먼저 본다.
// /api 요청은 캐시하지 않는다. 오류 화면이 오프라인 화면으로 남지 않게 제대로 받은 HTML만 캐시한다.
// (v3: 예전 판이 캐시했을 수 있는 오류 화면을 버린다)
const CACHE = 'gwamok-v3'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const html = (res.headers.get('content-type') || '').includes('text/html')
          if (res.ok && res.status === 200 && !res.redirected && html) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              void caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
