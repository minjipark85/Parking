(function () {
  "use strict";

  // ---------- 공통 ----------
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  // 예약 가능한 날짜는 관리자 페이지(admin-7k2q.html)에서 열고 닫음 → DB에서 받아 옴
  var SLOTS = [{ s: "09:00", e: "12:00" }, { s: "12:00", e: "15:00" }, { s: "15:00", e: "18:00" }];
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
  var dateLabel = function (s) { var p = s.split("-").map(Number), d = new Date(p[0], p[1] - 1, p[2]); return p[1] + "월 " + p[2] + "일 (" + DOW[d.getDay()] + ")"; };
  var slotLabel = function (t) { var s = String(t).slice(0, 5); for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].s === s) return SLOTS[i].s + " ~ " + SLOTS[i].e; return s; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  // ---------- DB ----------
  var cfg = window.APP_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") < 0 && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-ANON-KEY") < 0;
  var sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  if (!sb) {
    $("setupNotice").hidden = false;
    $("setupNotice").textContent = "지금은 예약 신청을 받을 수 없어요. (관리자: config.js에 Supabase 연결 정보를 넣어 주세요)";
  }

  var ERR = {
    full: "방금 이 시간대가 마감됐어요. 다른 시간대를 골라 주세요.",
    duplicate: "이 차량은 같은 날짜·시간대에 이미 예약돼 있어요. [내 예약 확인]에서 볼 수 있어요.",
    dup_day: "이 차량은 이 날짜에 이미 예약돼 있어요. 같은 차량은 하루에 한 번만 예약할 수 있어요. 시간을 바꾸려면 [내 예약 확인]에서 취소한 뒤 다시 신청해 주세요.",
    regular: "정기 등록 차량이에요. 예약 없이 출입할 수 있어요.",
    slot_over: "이미 지난 시간대예요. 다른 시간대를 골라 주세요.",
    bad_date: "이 날짜는 지금 예약을 받지 않아요. 다른 날짜를 골라 주세요.",
    bad_slot: "시간대를 골라 주세요.",
    bad_plate: "차량번호 형식을 확인해 주세요. 예: 12가3456",
    bad_name: "이름을 입력해 주세요.",
    bad_phone: "휴대폰 번호를 확인해 주세요. 예: 010-1234-5678",
  };

  // ---------- 화면 전환 ----------
  function show(view) {
    $("applyView").hidden = view !== "apply";
    $("doneView").hidden = view !== "done";
    $("mineView").hidden = view !== "mine";
    $("tabApply").setAttribute("aria-pressed", String(view !== "mine"));
    $("tabMine").setAttribute("aria-pressed", String(view === "mine"));
    window.scrollTo(0, 0);
  }
  $("tabApply").addEventListener("click", function () { show("apply"); loadSlots(); });
  $("tabMine").addEventListener("click", function () { show("mine"); });
  $("againBtn").addEventListener("click", function () { show("apply"); loadDates(); });
  // 실시간 예약확인증 — 차량번호·연락처를 이 휴대폰에 저장하고 확인증 페이지로
  function openPass(plate, phone) {
    try { localStorage.setItem("plate-pass-v1", JSON.stringify({ plate: norm(plate), phone: digits(phone) })); } catch (e) {}
    location.href = "pass.html";
  }
  $("passBtn").addEventListener("click", function () { if (lastDone.plate) openPass(lastDone.plate, lastDone.phone); });
  $("toMineBtn").addEventListener("click", function () {
    $("mPlate").value = lastDone.plate || ""; $("mPhone").value = lastDone.phone || "";
    show("mine"); if (lastDone.plate) loadMine();
  });

  // ---------- 1. 날짜 ----------
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var parseD = function (s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var OPEN_LIST = [];                      // 지금 신청할 수 있는 날짜 (DB의 apply_open_dates)
  var datesLoaded = false;
  var dateOpen = function (v) { return OPEN_LIST.indexOf(v) >= 0; };
  var selDate = "", selSlot = "", avail = {};

  function loadDates() {
    if (!sb) { renderDates(); return Promise.resolve(); }
    return sb.rpc("apply_open_dates").then(function (res) {
      if (res.error) throw res.error;
      OPEN_LIST = (res.data || []).map(function (r) { return String(r && typeof r === "object" ? r.open_date : r).slice(0, 10); });
      datesLoaded = true;
      if (!dateOpen(selDate)) { selDate = OPEN_LIST[0] || ""; selSlot = ""; }
      renderDates();
      loadSlots();
    }).catch(function (e) {
      console.error(e);
      $("dateStrip").innerHTML = '<p class="muted">예약 가능한 날짜를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.</p>';
    });
  }
  function renderDates() {
    var html = "", t = ymd(today), t1 = new Date(today); t1.setDate(t1.getDate() + 1); t1 = ymd(t1);
    OPEN_LIST.forEach(function (v) {
      var d = parseD(v), cls = d.getDay() === 0 ? " sun" : d.getDay() === 6 ? " sat" : "";
      html += '<button type="button" class="date-chip' + cls + '" role="radio" data-date="' + v + '" aria-checked="' + (v === selDate) + '">' +
        '<span class="dw">' + (v === t ? "오늘" : v === t1 ? "내일" : DOW[d.getDay()]) + '</span>' +
        '<span class="dd">' + d.getDate() + '</span><span class="dl">' + (d.getMonth() + 1) + '월</span></button>';
    });
    $("dateStrip").innerHTML = html;
    var none = datesLoaded && !OPEN_LIST.length;      // 열린 날짜가 하나도 없으면 안내만 보여 줌
    $("applyForm").hidden = none;
    $("closedNote").hidden = !none;
    updateSummary();
  }
  $("dateStrip").addEventListener("click", function (e) {
    var b = e.target.closest(".date-chip"); if (!b || b.disabled) return;
    pickDate(b.dataset.date);
  });
  function pickDate(v) {
    if (!dateOpen(v)) { setError(ERR.bad_date); return; }
    selDate = v; selSlot = "";
    Array.prototype.forEach.call(document.querySelectorAll(".date-chip"), function (c) { c.setAttribute("aria-checked", String(c.dataset.date === v)); });
    setError(""); loadSlots();
  }

  // ---------- 2. 시간대 (남은 자리) ----------
  var slotsReq = 0;
  function loadSlots() {
    if (!selDate) return;
    if (!sb) { renderSlots(null); return; }
    var my = ++slotsReq;
    $("slotList").setAttribute("aria-busy", "true");
    sb.rpc("slot_availability", { p_date: selDate }).then(function (res) {
      if (my !== slotsReq) return;
      if (res.error) throw res.error;
      avail = {};
      res.data.forEach(function (r) { avail[String(r.slot).slice(0, 5)] = { cap: r.capacity, booked: r.booked }; });
      renderSlots(avail);
    }).catch(function (e) {
      console.error(e);
      $("slotList").innerHTML = '<p class="muted">남은 자리를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.</p>';
    }).then(function () { $("slotList").removeAttribute("aria-busy"); });
  }
  function slotPast(s) {
    if (selDate !== ymd(new Date())) return false;
    var n = new Date(), e = SLOTS.filter(function (x) { return x.s === s; })[0].e.split(":");
    return n.getHours() * 60 + n.getMinutes() >= (+e[0]) * 60 + (+e[1]);
  }
  function renderSlots(a) {
    if (!a) { $("slotList").innerHTML = '<p class="muted">지금은 남은 자리를 볼 수 없어요.</p>'; return; }
    var html = "";
    SLOTS.forEach(function (x) {
      var info = a[x.s] || { cap: 0, booked: 0 };
      var left = Math.max(0, info.cap - info.booked);
      var past = slotPast(x.s), closed = info.cap === 0;
      var disabled = past || left === 0;
      if (disabled && selSlot === x.s) selSlot = "";
      var label = past ? "지난 시간" : closed ? "신청 안 받음" : left === 0 ? "마감" : "남은 자리 " + left + " / " + info.cap;
      var pct = info.cap ? Math.min(100, Math.round((info.booked / info.cap) * 100)) : 100;
      var few = !disabled && left <= Math.max(2, Math.ceil(info.cap * 0.2));
      html += '<button type="button" class="slot' + (few ? " few" : "") + '" role="radio" data-slot="' + x.s + '" aria-checked="' + (selSlot === x.s) + '"' + (disabled ? " disabled" : "") + '>' +
        '<span class="time">' + x.s + ' ~ ' + x.e + '</span><span class="left">' + label + '</span>' +
        '<span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></button>';
    });
    $("slotList").innerHTML = html;
    updateSummary();
  }
  $("slotList").addEventListener("click", function (e) {
    var b = e.target.closest(".slot"); if (!b || b.disabled) return;
    selSlot = b.dataset.slot;
    Array.prototype.forEach.call(document.querySelectorAll(".slot"), function (s) { s.setAttribute("aria-checked", String(s.dataset.slot === selSlot)); });
    setError(""); updateSummary();
  });

  // ---------- 3. 입력 ----------
  $("fPhone").addEventListener("input", function () { this.value = fmtPhone(this.value); });
  $("mPhone").addEventListener("input", function () { this.value = fmtPhone(this.value); });
  $("fPlate").addEventListener("blur", function () {
    var p = norm(this.value);
    if (!p) return;
    var ok = PLATE_RE.test(p);
    if (ok) this.value = pretty(p);
    $("plateHint").textContent = ok ? "예: 12가3456, 123가4567, 서울12가3456" : "형식을 확인해 주세요. 예: 12가3456";
    $("plateHint").className = "hint" + (ok ? "" : " err");
    updateSummary();
  });
  ["fPlate", "fName", "fPhone"].forEach(function (id) { $(id).addEventListener("input", updateSummary); });

  function updateSummary() {
    var s = $("summary");
    if (!selDate) { s.textContent = datesLoaded ? "예약 가능한 날짜가 없어요." : "예약 가능한 날짜를 불러오는 중…"; return; }
    if (!selSlot) { s.innerHTML = "<b>" + dateLabel(selDate) + "</b> · 시간대를 골라 주세요."; return; }
    var p = norm($("fPlate").value);
    s.innerHTML = "<b>" + dateLabel(selDate) + " " + slotLabel(selSlot) + "</b>" + (PLATE_RE.test(p) ? " · " + esc(pretty(p)) : "");
  }
  function setError(t) { $("formError").textContent = t; }

  // ---------- 4. 신청 ----------
  var lastDone = {};
  $("applyForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var plate = norm($("fPlate").value), name = $("fName").value.trim(), phone = digits($("fPhone").value);
    if (!sb) return setError("지금은 예약 신청을 받을 수 없어요.");
    if (!dateOpen(selDate)) return setError(ERR.bad_date);
    if (!selSlot) return setError(ERR.bad_slot);
    if (!PLATE_RE.test(plate)) { $("fPlate").focus(); return setError(ERR.bad_plate); }
    if (!name) { $("fName").focus(); return setError(ERR.bad_name); }
    if (!/^01\d{8,9}$/.test(phone)) { $("fPhone").focus(); return setError(ERR.bad_phone); }
    if (!$("fAgree").checked) return setError("개인정보 수집·이용에 동의해 주세요.");
    setError("");
    var btn = $("submitBtn"); btn.disabled = true; btn.textContent = "신청하는 중…";
    sb.rpc("request_reservation", { p_date: selDate, p_slot: selSlot, p_plate: plate, p_name: name, p_phone: phone })
      .then(function (res) {
        if (res.error) throw res.error;
        var r = res.data || {};
        if (!r.ok) {
          setError(ERR[r.error] || "신청하지 못했어요. 잠시 후 다시 시도해 주세요.");
          if (r.error === "full" || r.error === "slot_over") loadSlots();
          if (r.error === "bad_date") loadDates();
          return;
        }
        lastDone = { plate: r.plate, phone: fmtPhone(phone) };
        $("dCode").textContent = r.code;
        $("dDate").textContent = dateLabel(String(r.date));
        $("dSlot").textContent = slotLabel(r.slot);
        $("dPlate").textContent = r.plate;
        $("fPlate").value = ""; selSlot = ""; $("fAgree").checked = false;
        show("done");
      })
      .catch(function (err) { console.error(err); setError("신청하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."); })
      .then(function () { btn.disabled = false; btn.textContent = "예약 신청"; });
  });

  // ---------- 내 예약 확인·취소 ----------
  function loadMine() {
    var plate = norm($("mPlate").value), phone = digits($("mPhone").value);
    $("mineError").textContent = "";
    if (!sb) { $("mineError").textContent = "지금은 조회할 수 없어요."; return; }
    if (!PLATE_RE.test(plate)) { $("mineError").textContent = ERR.bad_plate; return; }
    if (!/^01\d{8,9}$/.test(phone)) { $("mineError").textContent = ERR.bad_phone; return; }
    $("mineBtn").disabled = true;
    sb.rpc("my_reservations", { p_plate: plate, p_phone: phone }).then(function (res) {
      if (res.error) throw res.error;
      if (!res.data.length) { $("mineList").innerHTML = '<p class="muted">앞으로 예정된 예약이 없어요. 차량번호와 연락처가 신청할 때와 같은지 확인해 주세요.</p>'; return; }
      $("mineList").innerHTML = res.data.map(function (r) {
        return '<div class="my-item" data-id="' + esc(r.id) + '"><span class="when">' + dateLabel(String(r.reserve_date)) + ' · ' + slotLabel(r.reserve_time) + '</span>' +
          '<span class="acts"><button type="button" class="to-pass">확인증</button><button type="button" class="cancel">취소</button></span>' +
          '<span class="meta"><span class="mini-plate" style="font-size:15px">' + esc(r.plate) + '</span> · 예약번호 <span class="mono">' + esc(r.code) + '</span></span></div>';
      }).join("");
    }).catch(function (e) { console.error(e); $("mineError").textContent = "조회하지 못했어요. 잠시 후 다시 시도해 주세요."; })
      .then(function () { $("mineBtn").disabled = false; });
  }
  $("mineForm").addEventListener("submit", function (e) { e.preventDefault(); loadMine(); });
  $("mineList").addEventListener("click", function (e) {
    if (e.target.closest(".to-pass")) { openPass($("mPlate").value, $("mPhone").value); return; }
    var b = e.target.closest(".cancel"); if (!b) return;
    if (!b.classList.contains("arm")) {          // 한 번 더 눌러야 취소 (실수 방지)
      b.classList.add("arm"); b.textContent = "정말 취소";
      setTimeout(function () { if (b.isConnected && b.classList.contains("arm")) { b.classList.remove("arm"); b.textContent = "취소"; } }, 4000);
      return;
    }
    var item = b.closest(".my-item");
    b.disabled = true; b.textContent = "취소 중…";
    sb.rpc("cancel_reservation", { p_id: item.dataset.id, p_phone: digits($("mPhone").value) }).then(function (res) {
      if (res.error || !res.data || !res.data.ok) throw res.error || new Error("not cancelled");
      item.classList.add("gone"); b.textContent = "취소됨";
    }).catch(function (e) { console.error(e); b.disabled = false; b.classList.remove("arm"); b.textContent = "취소"; $("mineError").textContent = "취소하지 못했어요. 지난 예약은 취소할 수 없어요."; });
  });

  // ---------- 시작 ----------
  updateSummary();
  loadDates();
  // 남은 자리 30초마다, 열린 날짜(관리자가 새로 열거나 공개 시각이 된 날)는 1분마다 새로 불러옴
  setInterval(function () { if (!$("applyView").hidden && !document.hidden) loadSlots(); }, 30000);
  setInterval(function () { if (!$("applyView").hidden && !document.hidden) loadDates(); }, 60000);
})();
