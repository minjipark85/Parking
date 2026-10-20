// 서비스 워커: 앱 파일을 기기에 저장해 두고 인터넷 없이도 열리게 한다.
// 앱 파일을 고쳐서 올릴 때는 아래 VERSION 숫자를 하나 올리세요. (예: v7 → v8)
const VERSION = "v17";
const APP_CACHE = `plate-app-${VERSION}`;
const FONT_CACHE = "plate-fonts";

const FILES = [
  "check-7k2q.html",
  "style.css?v=15",
  "app.js?v=17",
  "config.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "supabase.js",
  "591.supabase.js",
  "tesseract.min.js",
  "worker.min.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "kor.traineddata.gz",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("plate-app-") && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 예약 DB(Supabase)는 항상 인터넷으로 — 끊기면 앱이 기기에 저장된 예약을 씀
  if (url.hostname.endsWith(".supabase.co")) return;

  // 글꼴: 한 번 받으면 저장해 두고 재사용
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); c.put(req, res.clone()); return res; } catch (err) { return Response.error(); }
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // DB 연결 정보: 인터넷이 되면 최신 것, 안 되면 저장된 것
  if (url.pathname.endsWith("/config.js")) {
    e.respondWith(
      fetch(req).then((res) => { caches.open(APP_CACHE).then((c) => c.put("config.js", res.clone())); return res; })
        .catch(() => caches.match("config.js", { ignoreSearch: true }))
    );
    return;
  }

  // 페이지 열기: 인터넷이 되면 최신 화면, 안 되면 저장된 화면
  // (확인 앱 check-7k2q.html 과 신청 페이지 apply.html 을 각자 자기 이름으로 저장)
  if (req.mode === "navigate") {
    const key = url.pathname.endsWith("/") ? "index.html" : url.pathname.split("/").pop();
    e.respondWith(
      fetch(req).then((res) => { if (res.ok) caches.open(APP_CACHE).then((c) => c.put(key, res.clone())); return res; })
        .catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || caches.match("check-7k2q.html")))
    );
    return;
  }

  // 나머지 앱 파일: 저장된 것을 먼저 쓰고, 없으면 받아서 저장
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(APP_CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }))
  );
});
