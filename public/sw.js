/* 에이원 업무 오더 - 최소 서비스 워커
   - 앱 셸(아이콘·매니페스트)만 캐시합니다.
   - 페이지와 API 응답은 항상 네트워크를 우선합니다. (로그인/시트 데이터 보호)
*/
const CACHE = "a1-shell-v2";
const SHELL = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isStatic = /\.(png|svg|ico|woff2?|css|js)$/.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
