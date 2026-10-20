/* =========================================================
   실시간 예약확인증
   · 서버(pass_status)에서 정기 차량·예약과 "서버 시각"을 받아 옴
   · 매초 서버 시각 기준으로 신호등 색을 다시 계산 (확인 앱과 같은 기준)
   · 30초마다 새로 받아 오고, 끊기면 "실시간 아님" 표시
   ========================================================= */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var norm = function (s) { return String(s || "").replace(/[\s\-·.]/g, "").toUpperCase(); };
  var PLATE_RE = /^([가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;
  var pretty = function (s) { var n = norm(s), m = n.match(/^(.*?[가-힣])(\d{4})$/); return m ? m[1] + " " + m[2] : n; };
  var digits = function (s) { return String(s || "").replace(/\D/g, ""); };
  var fmtPhone = function (s) {
    var d = digits(s).slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return d.slice(0, 3) + "-" + d.slice(3);
    return d.slice(0, 3) + "-" + d.slice(3, d.length - 4) + "-" + d.slice(-4);
  };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var SLOTS = [{ s: "09:00", e: "12:00" }, { s: "12:00", e: "15:00" }, { s: "15:00", e: "18:00" }];
  var toMin = function (t) { var p = String(t).split(":"); return Number(p[0]) * 60 + Number(p[1]); };
  var slotOf = function (t) { var s = String(t).slice(0, 5); for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].s === s) return SLOTS[i]; return { s: s, e: pad(Math.min(23, Number(s.slice(0, 2)) + 3)) + ":" + s.slice(3) }; };
  var dateLabel = function (s) { var p = String(s).slice(0, 10).split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2])); return p[1] + "월 " + p[2] + "일 (" + DOW[d.getUTCDay()] + ")"; };
  var span = function (mins) { var h = Math.floor(mins / 60), m = mins % 60; return ((h ? h + "시간 " : "") + (m ? m + "분" : "")).trim() || "1분 미만"; };

  var KEY = "plate-pass-v1";          // { plate, phone } — 이 휴대폰에만 저장
  var CACHE = "plate-pass-cache-v1";  // 마지막으로 받은 결과 (잠깐 끊겨도 보이게)
  var read = function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  var write = function (k, v) { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) {} };

  // ---------- DB ----------
  var cfg = window.APP_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") < 0 && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-ANON-KEY") < 0;
  var sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var creds = null, data = null, offset = 0, fetchedAt = 0, loading = false;

  // 서버 시각 기준 지금 (한국 시간)
  function seoulNow() {
    var d = new Date(Date.now() + offset + 9 * 3600 * 1000);
    var date = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
    return { date: date, min: d.getUTCHours() * 60 + d.getUTCMinutes(), hms: pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) };
  }
  var parseTs = function (s) { return Date.parse(String(s).replace(/(\.\d{3})\d+/, "$1")); };

  // ---------- 판정 (확인 앱과 같은 기준) ----------
  function judge(now) {
    var reg = data.regular, list = (data.reservations || []).filter(function (r) { return String(r.date).slice(0, 10) >= now.date; });
    var row = function (k, v, cls) { return '<div' + (cls ? ' class="' + cls + '"' : "") + '><dt>' + k + '</dt><dd>' + v + '</dd></div>'; };
    if (reg && reg.active) {
      return { s: "reg", text: "정기 차량 · 출입 가능", info: row("구분", "정기 차량", "hit") + row("등록 기간", reg.until ? dateLabel(reg.until) + "까지" : "기간 제한 없음"), sub: "정기 차량은 예약 없이 출입할 수 있어요." };
    }
    var todays = list.filter(function (r) { return String(r.date).slice(0, 10) === now.date; });
    var stateOf = function (r) {
      var sl = slotOf(r.slot), a = toMin(sl.s), b = toMin(sl.e);
      if (now.min < a) return { k: "before", t: span(a - now.min) + " 후 시작" };
      if (now.min >= b) return { k: "after", t: "시간대 종료" };
      return { k: "now", t: "종료까지 " + span(b - now.min) };
    };
    var slotTxt = function (r) { var sl = slotOf(r.slot); return sl.s + " ~ " + sl.e; };
    var live = todays.filter(function (r) { return stateOf(r).k === "now"; })[0];
    if (live) {
      return { s: "ok", text: "입차 가능 · 예약 시간대", info: row("방문일", dateLabel(live.date) + " · 오늘") + row("시간대", slotTxt(live) + "<small>" + stateOf(live).t + "</small>", "hit") + row("예약번호", '<span class="mono">' + esc(live.code) + "</span>"), sub: "" };
    }
    if (todays.length) {
      var next = todays.filter(function (r) { return stateOf(r).k === "before"; })[0] || todays[todays.length - 1];
      var others = todays.filter(function (r) { return r !== next; }).map(function (r) { return slotTxt(r) + " (" + stateOf(r).t + ")"; });
      return { s: "warn", text: "오늘 예약 · 시간대가 아니에요", info: row("방문일", dateLabel(next.date) + " · 오늘") + row("예약 시간대", slotTxt(next) + "<small>" + stateOf(next).t + "</small>", "hit") + row("예약번호", '<span class="mono">' + esc(next.code) + "</span>"), sub: (others.length ? "오늘 다른 예약: " + others.join(", ") + ". " : "") + "예약한 시간대에 입차해 주세요." };
    }
    var future = list[0];
    var info = future ? row("다음 예약", dateLabel(future.date) + "<small>" + slotTxt(future) + " · 예약번호 " + esc(future.code) + "</small>", "hit") : row("예약", "오늘 이후 예약 없음", "hit");
    var sub = reg && !reg.active ? "정기 차량 등록 기간이 아니에요" + (reg.until ? " (" + dateLabel(reg.until) + "까지였어요)" : "") + ". " : "";
    return { s: "bad", text: "오늘 예약이 없어요", info: info, sub: sub + "예약한 날짜에 방문해 주세요." };
  }

  var COLORS = { ok: "#157a46", warn: "#9a5b00", bad: "#b3261e", reg: "#1f5fd6", idle: "#5d6878" };
  function render() {
    if (!data || $("passView").hidden) return;
    var now = seoulNow(), v = judge(now);
    document.body.dataset.s = v.s;
    $("themeColor").setAttribute("content", COLORS[v.s]);
    $("clock").textContent = now.hms;
    $("clockDate").textContent = dateLabel(now.date);
    if ($("vText").textContent !== v.text) $("vText").textContent = v.text;
    $("vPlate").textContent = pretty(creds.plate);
    if ($("vInfo").innerHTML !== v.info) $("vInfo").innerHTML = v.info;
    $("vSub").textContent = v.sub;
    var age = Date.now() - fetchedAt, stale = age > 90 * 1000;
    $("stale").hidden = !stale;
    if (stale) $("stale").textContent = "⚠ 실시간 정보가 아니에요 · 인터넷 연결을 확인하세요 (" + stampOf(fetchedAt) + " 기준)";
    $("lastAt").textContent = loading ? "확인 중…" : "서버 확인 " + stampOf(fetchedAt) + " · 30초마다 자동 갱신";
  }
  function stampOf(ms) { var d = new Date(ms + offset + 9 * 3600 * 1000); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()); }

  // ---------- 서버에서 받아 오기 ----------
  function fetchStatus(c) {
    var t0 = Date.now();
    return sb.rpc("pass_status", { p_plate: c.plate, p_phone: c.phone || null }).then(function (res) {
      if (res.error) throw res.error;
      var d = res.data || {};
      if (!d.ok) { var er = new Error(d.error || "error"); er.code = d.error; throw er; }
      var t1 = Date.now(), srv = parseTs(d.now);
      return { d: d, offset: isNaN(srv) ? 0 : srv - (t0 + t1) / 2, at: t1 };
    });
  }
  function apply(r) {
    data = r.d; offset = r.offset; fetchedAt = r.at;
    write(CACHE, { plate: creds.plate, phone: creds.phone, data: data, offset: offset, fetchedAt: fetchedAt });
  }
  function refresh() {
    if (!sb || !creds || loading) return;
    loading = true; render();
    fetchStatus(creds).then(apply).catch(function (e) { console.warn(e); })
      .then(function () { loading = false; render(); });
  }

  // ---------- 화면 전환 ----------
  var wakeLock = null;
  function keepAwake() {
    try {
      if (navigator.wakeLock && !wakeLock && document.visibilityState === "visible") {
        navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; l.addEventListener("release", function () { wakeLock = null; }); }).catch(function () {});
      }
    } catch (e) {}
  }
  function showForm(msg) {
    $("formView").hidden = false; $("passView").hidden = true;
    document.body.classList.remove("show-pass"); document.body.dataset.s = "idle";
    $("themeColor").setAttribute("content", "#1d4fb0");
    $("formError").textContent = msg || "";
  }
  function showPass() {
    $("formView").hidden = true; $("passView").hidden = false;
    document.body.classList.add("show-pass");
    render(); keepAwake();
  }

  var ERR = {
    bad_plate: "차량번호 형식을 확인해 주세요. 예: 12가3456",
    bad_phone: "연락처를 확인해 주세요. 예: 010-1234-5678",
    none_phone: "정기 차량이 아니에요. 예약확인증은 예약할 때 쓴 연락처를 함께 넣어 주세요.",
    none: "예약을 찾지 못했어요. 차량번호와 연락처가 예약할 때와 같은지 확인해 주세요."
  };
  $("pPhone").addEventListener("input", function () { this.value = fmtPhone(this.value); });
  $("passForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var plate = norm($("pPlate").value), phone = digits($("pPhone").value);
    if (!sb) return showForm("지금은 확인증을 열 수 없어요.");
    if (!PLATE_RE.test(plate)) { $("pPlate").focus(); return showForm(ERR.bad_plate); }
    if (phone && !/^01\d{8,9}$/.test(phone)) { $("pPhone").focus(); return showForm(ERR.bad_phone); }
    var btn = $("openBtn"); btn.disabled = true; $("formError").textContent = "";
    var c = { plate: plate, phone: phone };
    fetchStatus(c).then(function (r) {
      var d = r.d, has = d.regular || (d.reservations && d.reservations.length);
      if (!has) { showForm(phone ? ERR.none : ERR.none_phone); return; }
      creds = c; write(KEY, c); apply(r); showPass();
    }).catch(function (er) { console.error(er); showForm(ERR[er && er.code] || "확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."); })
      .then(function () { btn.disabled = false; });
  });
  $("refreshBtn").addEventListener("click", refresh);
  $("changeBtn").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = "정말 지우기"; setTimeout(function () { b.classList.remove("arm"); b.textContent = "다른 차량"; }, 4000); return; }
    b.classList.remove("arm"); b.textContent = "다른 차량";
    write(KEY, null); write(CACHE, null); creds = null; data = null;
    $("pPlate").value = ""; $("pPhone").value = "";
    showForm();
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && creds) { refresh(); keepAwake(); } });
  window.addEventListener("online", refresh);

  // ---------- 시작 ----------
  if (!sb) { $("setupNotice").hidden = false; $("setupNotice").textContent = "지금은 확인증을 열 수 없어요. (DB 연결 정보가 없어요)"; }
  var qs = (location.search.match(/[?&]plate=([^&]+)/) || [])[1];
  var qPlate = qs ? norm(decodeURIComponent(qs)) : "";
  creds = read(KEY);
  if (creds && (!creds.plate || (qPlate && qPlate !== creds.plate))) creds = null;
  if (creds) {
    var cache = read(CACHE);
    if (cache && cache.plate === creds.plate && cache.phone === creds.phone && cache.data) {
      data = cache.data; offset = cache.offset || 0; fetchedAt = cache.fetchedAt || 0;
      showPass();
    } else {
      $("formView").hidden = true; $("passView").hidden = true;
    }
    loading = false;
    fetchStatus(creds).then(function (r) { apply(r); showPass(); })
      .catch(function (er) { console.warn(er); if (!data) showForm("확인증을 불러오지 못했어요. 인터넷 연결을 확인해 주세요."); });
  } else {
    if (qPlate) $("pPlate").value = pretty(qPlate);
    showForm();
  }
  setInterval(render, 1000);
  setInterval(function () { if (document.visibilityState === "visible") refresh(); }, 30000);
})();
