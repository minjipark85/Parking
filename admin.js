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
  function showAdmin(email) {
    $("loginView").hidden = true; $("adminView").hidden = false; $("who").hidden = false;
    $("whoEmail").textContent = email;
    loadMonth(); loadSummary();
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
  var days = {};                                   // "YYYY-MM-DD" → {is_open, opens_at, booked}
  var selected = {};                               // 고른 날짜

  function loadMonth() {
    var first = new Date(cur.getFullYear(), cur.getMonth(), 1), last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    $("calTitle").textContent = cur.getFullYear() + "년 " + (cur.getMonth() + 1) + "월";
    $("calGrid").setAttribute("aria-busy", "true");
    return sb.rpc("admin_list_dates", { p_from: ymd(first), p_to: ymd(last) }).then(function (r) {
      if (r.error) throw r.error;
      days = {};
      r.data.forEach(function (x) { days[String(x.day).slice(0, 10)] = x; });
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
        '<span class="n">' + d + '</span><span class="st"><span class="lg">' + label + '</span><span class="sh">' + (st === "open" ? "열림" : st === "sched" ? "예정" : "") + '</span></span>' + (x && x.booked ? '<span class="bk">예약 ' + x.booked + '</span>' : "") + '</button>';
    }
    $("calGrid").innerHTML = html;
    renderSelection();
  }
  $("calGrid").addEventListener("click", function (e) {
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
    $("actError").textContent = "";
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="when"]'), function (r) {
    r.addEventListener("change", function () {
      var later = document.querySelector('input[name="when"]:checked').value === "later";
      $("opensAt").disabled = !later;
      if (later && !$("opensAt").value) {           // 기본값: 내일 오전 10시
        var d = new Date(); d.setDate(d.getDate() + 1);
        $("opensAt").value = ymd(d) + "T10:00";
      }
    });
  });
  function toast(t) { $("toast").textContent = t; setTimeout(function () { if ($("toast").textContent === t) $("toast").textContent = ""; }, 5000); }
  function afterChange(msg) { selected = {}; toast(msg); loadMonth(); loadSummary(); }

  $("openBtn").addEventListener("click", function () {
    var s = selDates(); if (!s.length) return;
    var later = document.querySelector('input[name="when"]:checked').value === "later", at = null;
    if (later) {
      if (!$("opensAt").value) { $("actError").textContent = "공개 일시를 정해 주세요."; return; }
      at = new Date($("opensAt").value);
      if (isNaN(at)) { $("actError").textContent = "공개 일시를 다시 확인해 주세요."; return; }
    }
    var btn = this; btn.disabled = true;
    sb.rpc("admin_open_dates", { p_dates: s, p_opens_at: at ? at.toISOString() : null }).then(function (r) {
      if (r.error) throw r.error;
      afterChange(s.length + "일을 열었어요" + (at ? " · " + stamp(at.toISOString()) + "에 공개돼요." : " · 지금부터 신청 페이지에 보여요."));
    }).catch(function (e) { console.error(e); $("actError").textContent = "열지 못했어요. 관리자 계정인지, 인터넷 연결을 확인하세요."; })
      .then(function () { btn.disabled = !selDates().length; });
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
      var list = r.data.filter(function (x) { return x.is_open; });
      if (!list.length) { $("summary").innerHTML = '<p class="muted">열려 있는 날짜가 없어요. 신청 페이지에는 "예약 가능한 날짜가 없어요"가 보여요.</p>'; return; }
      $("summary").innerHTML = list.map(function (x) {
        var v = String(x.day).slice(0, 10), st = dayState(x);
        return '<div class="sum-row"><span>' + md(v) + '</span><span class="when2 ' + st + '">' + (st === "open" ? "예약 받는 중" : stamp(x.opens_at) + " 공개 예정") + '</span>' +
          '<span class="meta">예약 ' + (x.booked || 0) + '건</span></div>';
      }).join("");
    }).catch(function (e) { console.error(e); $("summary").innerHTML = '<p class="muted">불러오지 못했어요.</p>'; });
  }

  start();
})();
