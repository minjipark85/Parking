(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var parseD = function (s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var md = function (s) { var d = parseD(s); return (d.getMonth() + 1) + "/" + d.getDate() + "(" + DOW[d.getDay()] + ")"; };
  var stamp = function (iso) { var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  var todayStr = function () { return ymd(new Date()); };

  // ---------- DB ----------
  var cfg = window.APP_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") < 0 && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-ANON-KEY") < 0;
  var sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  if (!sb) {
    $("setupNotice").hidden = false;
    $("setupNotice").textContent = "DB가 연결되지 않았어요. config.js에 Supabase 연결 정보를 넣어 주세요.";
    return;
  }

  // ---------- 로그인 (확인 앱과 같은 계정, 관리자만 통과) ----------
  function showLogin(msg) {
    $("loginView").hidden = false; $("adminView").hidden = true; $("who").hidden = true;
    $("loginError").textContent = msg || "";
  }
  // 편집 권한(날짜 열기·닫기·정원 변경) — 없으면 보기 전용 화면
  //  (supabase-roles.sql 을 아직 실행하지 않은 DB는 예전처럼 관리자 = 편집)
  var canEdit = false;
  function checkEditor() {
    return sb.rpc("is_editor").then(function (r) {
      if (r.error) { if (missingSql(r.error)) return true; throw r.error; }
      return r.data === true;
    }, function () { return false; });
  }
  function showAdmin(email) {
    $("loginView").hidden = true; $("adminView").hidden = false; $("who").hidden = false;
    $("whoEmail").textContent = email;
    canEdit = false; applyRole();
    checkEditor().then(function (ok) { canEdit = ok; applyRole(); });
    loadMonth(); loadSummary(); loadStats();
  }
  function applyRole() {
    document.body.classList.toggle("viewonly", !canEdit);
    $("roleBadge").textContent = canEdit ? "편집" : "보기 전용";
    $("roleBadge").className = "role-badge " + (canEdit ? "edit" : "view");
    $("viewOnlyNote").hidden = canEdit;
    if (!canEdit && Object.keys(selected).length) { selected = {}; renderMonth(); }
  }
  // DB 설정(supabase-opendates.sql)을 아직 안 했으면 함수가 없다는 오류가 옴
  function missingSql(e) {
    var m = (e && (e.message || "")) + " " + (e && e.code || "");
    return /PGRST202|42883|Could not find the function|does not exist/i.test(m);
  }
  var SQL_MSG = "DB에 관리자 기능이 아직 설치되지 않았어요. Supabase SQL Editor에서 supabase-opendates.sql 을 실행해 주세요.";
  function isAdmin() {
    return sb.rpc("is_admin").then(function (r) { if (r.error) throw r.error; return r.data === true; });
  }
  function start() {
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) return showLogin();
      return isAdmin().then(function (ok) {
        if (ok) showAdmin(s.user.email);
        else showLogin("관리자 권한이 없는 계정(" + s.user.email + ")이에요. Supabase Table Editor → staff_emails 에서 이 계정의 is_admin 을 체크하거나, 관리자 계정으로 로그인하세요.");
      });
    }).catch(function (e) { console.error(e); showLogin(missingSql(e) ? SQL_MSG : "인터넷 연결을 확인해 주세요."); });
  }
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("lEmail").value.trim(), pw = $("lPass").value, btn = $("loginBtn");
    if (!email || !pw) { $("loginError").textContent = "이메일과 비밀번호를 입력하세요."; return; }
    btn.disabled = true; $("loginError").textContent = "";
    sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
      if (r.error) { $("loginError").textContent = /invalid/i.test(r.error.message || "") ? "이메일 또는 비밀번호가 맞지 않아요." : "로그인하지 못했어요."; return; }
      return isAdmin().then(function (ok) {
        if (ok) { $("lPass").value = ""; showAdmin(r.data.user.email); }
        else $("loginError").textContent = "관리자 권한이 없는 계정이에요. Supabase Table Editor → staff_emails 에서 이 계정의 is_admin 을 체크해 주세요.";
      });
    }).catch(function (e) { console.error(e); $("loginError").textContent = missingSql(e) ? SQL_MSG : "로그인하지 못했어요. 인터넷 연결을 확인하세요."; })
      .then(function () { btn.disabled = false; });
  });
  $("logoutBtn").addEventListener("click", function () {
    var b = this;
    if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = "정말 로그아웃"; setTimeout(function () { b.classList.remove("arm"); b.textContent = "로그아웃"; }, 4000); return; }
    sb.auth.signOut({ scope: "local" }).catch(function () {}).then(function () { b.classList.remove("arm"); b.textContent = "로그아웃"; showLogin("로그아웃했어요."); });
  });

  // ---------- 달력 ----------
  var cur = new Date(); cur.setDate(1);           // 보고 있는 달
  var days = {};                                   // "YYYY-MM-DD" → {is_open, opens_at, booked, cap_09.., bk_09..}
  var info = {};                                   // 다른 달·요약에서 받은 날짜 정보 (선택한 날의 정원 표시용)
  var SLOTS = ["09", "12", "15"], SLOT_NAME = { "09": "09시", "12": "12시", "15": "15시" };
  var getX = function (v) { return days[v] || info[v]; };
  var selected = {};                               // 고른 날짜

  function loadMonth() {
    var first = new Date(cur.getFullYear(), cur.getMonth(), 1), last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    $("calTitle").textContent = cur.getFullYear() + "년 " + (cur.getMonth() + 1) + "월";
    $("calGrid").setAttribute("aria-busy", "true");
    return sb.rpc("admin_list_dates", { p_from: ymd(first), p_to: ymd(last) }).then(function (r) {
      if (r.error) throw r.error;
      days = {};
      r.data.forEach(function (x) { var v = String(x.day).slice(0, 10); days[v] = x; info[v] = x; });
      renderMonth();
    }).catch(function (e) { console.error(e); $("calGrid").innerHTML = '<p class="muted">달력을 불러오지 못했어요. 다시 시도해 주세요.</p>'; })
      .then(function () { $("calGrid").removeAttribute("aria-busy"); });
  }
  function dayState(x) {
    if (!x || !x.is_open) return "closed";
    return x.opens_at && new Date(x.opens_at) > new Date() ? "sched" : "open";
  }
  function renderMonth() {
    var first = new Date(cur.getFullYear(), cur.getMonth(), 1), n = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    var html = "", t = todayStr();
    for (var i = 0; i < first.getDay(); i++) html += '<span class="day blank"></span>';
    for (var d = 1; d <= n; d++) {
      var v = ymd(new Date(cur.getFullYear(), cur.getMonth(), d)), x = days[v], st = dayState(x), wd = new Date(cur.getFullYear(), cur.getMonth(), d).getDay();
      var past = v < t;
      var label = st === "open" ? "예약 받는 중" : st === "sched" ? stamp(x.opens_at) + " 공개" : "";
      html += '<button type="button" role="gridcell" class="day ' + st + (past ? " past" : "") + (wd === 0 ? " sun" : wd === 6 ? " sat" : "") + '" data-date="' + v + '" aria-selected="' + (!!selected[v]) + '"' + (past ? ' aria-disabled="true"' : "") +
        ' aria-label="' + md(v) + " " + (label || "닫힘") + (x && x.booked ? " 예약 " + x.booked + "건" : "") + '">' +
        '<span class="n">' + d + '</span><span class="st"><span class="lg">' + label + '</span><span class="sh">' + (st === "open" ? "열림" : st === "sched" ? "예정" : "") + '</span></span>' + (x && x.booked ? '<span class="bk">예약 ' + x.booked + '</span>' : "") +
        (x && st !== "closed" && x.cap_09 != null ? '<span class="cp" title="시간대별 정원">' + x.cap_09 + "·" + x.cap_12 + "·" + x.cap_15 + '</span>' : "") + '</button>';
    }
    $("calGrid").innerHTML = html;
    renderSelection();
  }
  $("calGrid").addEventListener("click", function (e) {
    if (!canEdit) return;                                   // 보기 전용: 날짜 선택 안 됨
    var b = e.target.closest(".day"); if (!b || !b.dataset.date || b.classList.contains("past")) return;
    var v = b.dataset.date;
    if (selected[v]) delete selected[v]; else selected[v] = true;
    b.setAttribute("aria-selected", String(!!selected[v]));
    renderSelection();
  });
  $("prevMonth").addEventListener("click", function () { cur.setMonth(cur.getMonth() - 1); loadMonth(); });
  $("nextMonth").addEventListener("click", function () { cur.setMonth(cur.getMonth() + 1); loadMonth(); });
  $("pickWeekend").addEventListener("click", function () {
    var t = todayStr();
    Array.prototype.forEach.call(document.querySelectorAll(".day[data-date]"), function (b) {
      var wd = parseD(b.dataset.date).getDay();
      if ((wd === 0 || wd === 6) && b.dataset.date >= t) selected[b.dataset.date] = true;
    });
    renderMonth();
  });
  $("pickClear").addEventListener("click", function () { selected = {}; renderMonth(); });

  // ---------- 열기·닫기 ----------
  var selDates = function () { return Object.keys(selected).sort(); };
  function renderSelection() {
    var s = selDates();
    $("selCount").textContent = s.length;
    $("selList").textContent = s.length ? s.map(md).join(", ") : "달력에서 날짜를 눌러 고르세요. (지난 날짜는 고를 수 없어요)";
    $("openBtn").disabled = !s.length; $("closeBtn").disabled = !s.length;
    var cb = $("closeBtn"); cb.classList.remove("arm"); cb.textContent = "선택한 날 닫기";
    $("actError").textContent = ""; $("capError").textContent = "";
    $("capBtn").disabled = !s.length;
    fillCaps(s);
    renderWhen();
  }
  // 고른 날들의 정원: 모두 같으면 그 숫자, 다르면 빈칸("날짜마다 다름")
  function fillCaps(s) {
    $("capsBox").disabled = !s.length;
    disarmCap();
    SLOTS.forEach(function (k) {
      var inp = $("cap" + k), vals = [], maxBk = 0, known = true;
      s.forEach(function (v) {
        var x = getX(v);
        if (!x || x["cap_" + k] == null) { known = false; return; }
        vals.push(x["cap_" + k]); maxBk = Math.max(maxBk, x["bk_" + k] || 0);
      });
      var same = known && vals.length && vals.every(function (c) { return c === vals[0]; });
      inp.value = same ? String(vals[0]) : "";
      inp.dataset.orig = inp.value;
      inp.placeholder = !s.length ? "" : same ? "" : known ? "날짜마다 다름" : "그대로";
      inp.classList.remove("chg");
      inp.dataset.bk = String(maxBk);
      var hint = $("bk" + k);
      hint.textContent = !s.length ? "" : maxBk ? (s.length > 1 ? "최대 " : "") + "예약 " + maxBk + "건" : "예약 없음";
      hint.classList.remove("over");
    });
  }
  // 입력한 정원 읽기 — 빈칸은 null(그대로), 잘못된 숫자는 err
  function readCaps() {
    var out = { any: false, changed: false, over: [] }, s = selDates();
    for (var i = 0; i < SLOTS.length; i++) {
      var k = SLOTS[i], raw = $("cap" + k).value.trim();
      if (raw === "") { out[k] = null; continue; }
      if (!/^\d+$/.test(raw) || Number(raw) > 100000) { out.err = SLOT_NAME[k] + " 정원은 0 ~ 100000 사이 숫자로 넣어 주세요."; return out; }
      out[k] = Number(raw); out.any = true;
      if (raw !== $("cap" + k).dataset.orig) out.changed = true;
      s.forEach(function (v) { var x = getX(v); if (x && (x["bk_" + k] || 0) > out[k]) out.over.push(md(v) + " " + SLOT_NAME[k] + "(예약 " + x["bk_" + k] + "건)"); });
    }
    return out;
  }
  function saveCaps(s, c) {
    return sb.rpc("admin_set_caps", { p_dates: s, p_c09: c["09"], p_c12: c["12"], p_c15: c["15"] }).then(function (r) { if (r.error) throw r.error; });
  }
  function disarmCap() { var b = $("capBtn"); b.classList.remove("arm"); b.textContent = "정원 저장"; }
  SLOTS.forEach(function (k) {
    $("cap" + k).addEventListener("input", function () {
      this.classList.toggle("chg", this.value.trim() !== this.dataset.orig);
      var v = this.value.trim(), bk = Number(this.dataset.bk || 0);
      $("bk" + k).classList.toggle("over", v !== "" && /^\d+$/.test(v) && Number(v) < bk);
      disarmCap(); $("capError").textContent = "";
    });
  });
  // ② 정원 저장 — 공개(열기·닫기)와 상관없이 따로 저장. 아직 닫힌 날에도 미리 정해 둘 수 있음
  $("capBtn").addEventListener("click", function () {
    var s = selDates(); if (!s.length) return;
    var c = readCaps(), b = this;
    if (c.err) { $("capError").textContent = c.err; return; }
    if (!c.any) { $("capError").textContent = "저장할 정원 숫자를 넣어 주세요."; return; }
    if (c.over.length && !b.classList.contains("arm")) {   // 이미 받은 예약보다 적으면 한 번 더 확인
      b.classList.add("arm"); b.textContent = "그래도 저장";
      $("capError").textContent = "이미 받은 예약보다 정원이 적어요: " + c.over.slice(0, 4).join(", ") + (c.over.length > 4 ? " 외 " + (c.over.length - 4) + "곳" : "") + ". 기존 예약은 유지되고 추가 신청만 막혀요.";
      return;
    }
    b.disabled = true; $("capError").textContent = "";
    saveCaps(s, c).then(function () {
      afterChange(s.length + "일의 정원을 저장했어요 · " + SLOTS.filter(function (k) { return c[k] != null; }).map(function (k) { return SLOT_NAME[k] + " " + c[k]; }).join(", "), "capToast");
    }).catch(function (e) { console.error(e); $("capError").textContent = "정원을 저장하지 못했어요. 다시 시도해 주세요."; })
      .then(function () { b.disabled = !selDates().length; disarmCap(); });
  });

  // ① 공개 시점 — 날짜·시간 칸을 누르거나 바꾸면 자동으로 "공개 일시 지정"
  var whenLater = function () { return document.querySelector('input[name="when"]:checked').value === "later"; };
  var DOWS = ["일", "월", "화", "수", "목", "금", "토"];
  function pickLater() {
    var r = document.querySelector('input[name="when"][value="later"]');
    if (!r.checked) { r.checked = true; }
    if (!$("opensAt").value) { var d = new Date(); d.setDate(d.getDate() + 1); $("opensAt").value = ymd(d) + "T10:00"; }   // 기본값: 내일 오전 10시
    renderWhen();
  }
  function renderWhen() {
    var h = $("whenHint"), btn = $("openBtn"), n = selDates().length;
    h.className = "when-hint";
    if (!whenLater()) { h.textContent = "선택한 날이 지금 바로 신청 페이지에 열려요."; btn.textContent = n ? n + "일 바로 열기" : "바로 열기"; return; }
    var at = $("opensAt").value ? new Date($("opensAt").value) : null;
    if (!at || isNaN(at)) { h.textContent = "공개할 날짜와 시각을 골라 주세요."; h.classList.add("bad"); btn.textContent = "공개 예약하기"; return; }
    var lbl = (at.getMonth() + 1) + "/" + at.getDate() + "(" + DOWS[at.getDay()] + ") " + pad(at.getHours()) + ":" + pad(at.getMinutes());
    if (at <= new Date()) { h.textContent = lbl + "은 이미 지난 시각이라 바로 열려요."; h.classList.add("bad"); }
    else { h.textContent = lbl + "부터 신청할 수 있어요. 그 전에는 신청 페이지에 보이지 않아요."; h.classList.add("later"); }
    btn.textContent = (at.getMonth() + 1) + "/" + at.getDate() + " " + pad(at.getHours()) + ":" + pad(at.getMinutes()) + " 공개 예약";
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="when"]'), function (r) {
    r.addEventListener("change", function () { if (whenLater()) pickLater(); else renderWhen(); });
  });
  ["focus", "click", "input", "change"].forEach(function (ev) { $("opensAt").addEventListener(ev, pickLater); });
  function toast(t, id) { var el = $(id || "toast"); el.textContent = t; setTimeout(function () { if (el.textContent === t) el.textContent = ""; }, 6000); }
  function afterChange(msg, id) { selected = {}; toast(msg, id); loadMonth(); loadSummary(); }

  $("openBtn").addEventListener("click", function () {
    var s = selDates(); if (!s.length) return;
    var later = whenLater(), at = null;
    if (later) {
      if (!$("opensAt").value) { $("actError").textContent = "공개 일시를 정해 주세요."; return; }
      at = new Date($("opensAt").value);
      if (isNaN(at)) { $("actError").textContent = "공개 일시를 다시 확인해 주세요."; return; }
      if (at <= new Date()) at = null;                               // 지난 시각이면 바로 공개
    }
    var btn = this; btn.disabled = true;
    sb.rpc("admin_open_dates", { p_dates: s, p_opens_at: at ? at.toISOString() : null }).then(function (r) {
      if (r.error) throw r.error;
      afterChange(s.length + "일을 " + (at ? "공개 예약했어요 · " + stamp(at.toISOString()) + "부터 신청할 수 있어요." : "열었어요 · 지금부터 신청 페이지에 보여요."));
    }).catch(function (e) { console.error(e); $("actError").textContent = "열지 못했어요. 관리자 계정인지, 인터넷 연결을 확인하세요."; })
      .then(function () { btn.disabled = !selDates().length; renderWhen(); });
  });

  $("closeBtn").addEventListener("click", function () {
    var s = selDates(); if (!s.length) return;
    var b = this;
    var booked = s.reduce(function (n, v) { return n + ((days[v] && days[v].booked) || 0); }, 0);
    if (!b.classList.contains("arm")) {             // 한 번 더 눌러야 닫힘
      b.classList.add("arm");
      b.textContent = booked ? "정말 닫기 (예약 " + booked + "건은 유지)" : "정말 닫기";
      return;
    }
    b.disabled = true;
    sb.rpc("admin_close_dates", { p_dates: s }).then(function (r) {
      if (r.error) throw r.error;
      afterChange(s.length + "일을 닫았어요. 신청 페이지에서 사라져요." + (booked ? " 이미 받은 예약 " + booked + "건은 그대로예요." : ""));
    }).catch(function (e) { console.error(e); $("actError").textContent = "닫지 못했어요. 다시 시도해 주세요."; })
      .then(function () { b.disabled = !selDates().length; b.classList.remove("arm"); b.textContent = "선택한 날 닫기"; });
  });

  // ---------- 앞으로 열려 있는 날짜 요약 ----------
  function loadSummary() {
    var from = new Date(), to = new Date(); to.setDate(to.getDate() + 365);
    sb.rpc("admin_list_dates", { p_from: ymd(from), p_to: ymd(to) }).then(function (r) {
      if (r.error) throw r.error;
      r.data.forEach(function (x) { info[String(x.day).slice(0, 10)] = x; });
      if (selDates().length) fillCaps(selDates());
      var list = r.data.filter(function (x) { return x.is_open; });
      if (!list.length) { $("summary").innerHTML = '<p class="muted">열려 있는 날짜가 없어요. 신청 페이지에는 "예약 가능한 날짜가 없어요"가 보여요.</p>'; return; }
      $("summary").innerHTML = list.map(function (x) {
        var v = String(x.day).slice(0, 10), st = dayState(x);
        var capLine = x.cap_09 == null ? "" : '<small class="caps-line">' + SLOTS.map(function (k) { var bk = x["bk_" + k] || 0, txt = SLOT_NAME[k] + " " + bk + "/" + x["cap_" + k]; return '<span class="ci">' + (bk > x["cap_" + k] ? '<b class="over" title="정원보다 예약이 많아요">' + txt + '</b>' : txt) + '</span>'; }).join(" · ") + '</small>';
        return '<div class="sum-row"><span>' + md(v) + capLine + '</span><span class="when2 ' + st + '">' + (st === "open" ? "예약 받는 중" : stamp(x.opens_at) + " 공개 예정") + '</span>' +
          '<span class="meta">예약 ' + (x.booked || 0) + '건</span></div>';
      }).join("");
    }).catch(function (e) { console.error(e); $("summary").innerHTML = '<p class="muted">불러오지 못했어요.</p>'; });
  }

  // ---------- 접속 현황 ----------
  var PAGE_NAME = { index: "안내", apply: "신청", pass: "확인증" };
  function loadStats() {
    if ($("adminView").hidden || document.hidden) return;
    sb.rpc("admin_view_stats", { p_days: 7 }).then(function (r) {
      if (r.error) throw r.error;
      var d = r.data || {}, days = d.days || [], hours = d.hours || [], today = days[days.length - 1] || {};
      $("sLive").textContent = d.live || 0;
      var lp = d.live_pages || {};
      $("sLivePages").textContent = Object.keys(lp).length ? Object.keys(lp).map(function (k) { return (PAGE_NAME[k] || k) + " " + lp[k]; }).join(" · ") : "최근 5분";
      $("sViews").textContent = (today.views || 0).toLocaleString();
      $("sViewPages").textContent = "안내 " + (today.v_index || 0) + " · 신청 " + (today.v_apply || 0) + " · 확인증 " + (today.v_pass || 0);
      $("sVisitors").textContent = (today.visitors || 0).toLocaleString();
      var nowH = new Date().getHours(), hmax = Math.max.apply(null, hours.map(function (h) { return h.views || 0; }).concat([1]));
      $("sHours").innerHTML = hours.map(function (h) {
        var pct = Math.round(((h.views || 0) / hmax) * 100);
        return '<div class="hb' + (h.hour === nowH ? " now" : "") + '" title="' + h.hour + '시 · 페이지뷰 ' + (h.views || 0) + ' · 방문자 ' + (h.visitors || 0) + '">' +
          (h.views ? '<em style="bottom:calc(' + pct + '% + 2px)">' + h.views + '</em>' : "") + '<i style="height:' + pct + '%"></i>' + (h.hour % 3 === 0 ? '<span class="' + (h.hour % 6 === 0 ? "l6" : "l3") + '">' + h.hour + '</span>' : "") + '</div>';
      }).join("");
      var dmax = Math.max.apply(null, days.map(function (x) { return x.views || 0; }).concat([1]));
      $("sDays").innerHTML = days.slice().reverse().map(function (x, i) {
        var v = String(x.day).slice(0, 10);
        return '<div class="dayrow' + (i === 0 ? " today" : "") + '"><span>' + md(v) + '</span><span class="bar"><i style="width:' + Math.round(((x.views || 0) / dmax) * 100) + '%"></i></span>' +
          '<span class="dnum">' + (x.views || 0).toLocaleString() + '회 · ' + (x.visitors || 0).toLocaleString() + '명</span></div>';
      }).join("");
      $("statAt").textContent = stamp(new Date().toISOString()) + " 기준 · 1분마다 갱신";
    }).catch(function (e) {
      console.error(e);
      $("statAt").textContent = /PGRST202|Could not find the function|42883/.test((e && (e.message || "")) + (e && e.code || "")) ? "supabase-stats.sql 을 실행하면 보여요" : "불러오지 못했어요";
    });
  }
  setInterval(loadStats, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) loadStats(); });

  start();
})();
