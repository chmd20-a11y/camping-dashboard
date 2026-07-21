/* 캠핑캐치 서비스워커 — '항상 최신' 우선.
   온라인이면 HTTP 캐시를 우회(no-store)해 무조건 서버 최신본을 받고,
   오프라인일 때만 캐시로 폴백한다. (배포가 잦아 옛 버전 노출 방지) */
var CACHE = "campcatch-v2";
var SHELL = [
  "./", "./index.html", "./css/styles.css",
  "./js/config.js", "./js/sites.js", "./js/links.js", "./js/board-config.js",
  "./js/logic.js", "./js/app.js", "./js/board.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return fetch(new Request(u, { cache: "reload" })).then(function (r) { return c.put(u, r); }).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
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
    fetch(req, { cache: "no-store" }).then(function (res) {   // HTTP 캐시 우회 → 항상 최신
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req); })        // 오프라인이면 캐시
  );
});
