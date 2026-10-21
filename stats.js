/* =========================================================
   접속 수 세기 (안내·신청·확인증 페이지)
   · 페이지가 열리면 1번, 화면을 열어 두는 동안 2분마다 "보는 중" 신호
   · 저장: 시각, 페이지 이름, 기기마다 만든 무작위 번호 — IP·개인정보는 보내지 않음
   · 실패해도 페이지 동작에는 영향 없음
   ========================================================= */
(function () {
  "use strict";
  try {
    var cfg = window.APP_CONFIG || {};
    var url = cfg.SUPABASE_URL, key = cfg.SUPABASE_ANON_KEY;
    if (!url || !key || url.indexOf("YOUR-PROJECT") >= 0 || !window.fetch) return;
    var page = document.documentElement.getAttribute("data-page");
    if (!page) return;
    var vid = "";
    try { vid = localStorage.getItem("pv-id") || ""; } catch (e) {}
    if (!/^[a-z0-9]{16,32}$/.test(vid)) {
      vid = "";
      for (var i = 0; i < 20; i++) vid += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
      try { localStorage.setItem("pv-id", vid); } catch (e) {}
    }
    var send = function (ping) {
      try {
        fetch(url.replace(/\/$/, "") + "/rest/v1/rpc/log_view", {
          method: "POST", keepalive: true,
          headers: { "Content-Type": "application/json", apikey: key, Authorization: "Bearer " + key },
          body: JSON.stringify({ p_page: page, p_visitor: vid, p_ping: !!ping })
        }).catch(function () {});
      } catch (e) {}
    };
    send(false);
    setInterval(function () { if (document.visibilityState === "visible") send(true); }, 120000);
  } catch (e) {}
})();
