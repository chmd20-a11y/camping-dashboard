/* 캠핑캐치 서비스워커 — 네트워크 우선(항상 최신), 오프라인 시 캐시 폴백.
   ※ 자주 배포하므로 캐시 우선은 안 씀(옛 버전 노출 방지). */
var CACHE = "campcatch-v1";
var SHELL = [
  "./", "./index.html", "./css/styles.css",
  "./js/config.js", "./js/sites.js", "./js/links.js", "./js/logic.js", "./js/app.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 날씨 등 외부 요청은 그대로 네트워크
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req); })  // 오프라인이면 캐시
  );
});
