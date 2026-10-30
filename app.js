(() => {
  "use strict";

  // ---------- 공통 도구 ----------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const fmtDate = (s) => { const [y, m, d] = s.split("-").map(Number); const dt = new Date(y, m - 1, d); return `${y}.${pad(m)}.${pad(d)} (${DOW[dt.getDay()]})`; };
  const fmtStamp = (ms) => { const d = new Date(ms); return (ymd(d) === todayStr() ? "" : `${d.getMonth() + 1}/${d.getDate()} `) + `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const hhmm = (t) => String(t || "").slice(0, 5);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const abs = (p) => new URL(p, location.href).href;

  // 차량번호 정리: 공백·하이픈 제거
  const norm = (s) => String(s || "").replace(/[\s\-·.]/g, "").toUpperCase();
  const last4 = (s) => { const m = norm(s).match(/(\d{4})$/); return m ? m[1] : null; };
  // 12가3456 / 123가4567 / 서울12가3456
  const PLATE_RE = /^([가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;
  // 번호판 가운데 글자로 실제 쓰이는 한글만 허용 (인식 오류 줄이기)
  const PLATE_MID = "가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호";
  const PLATE_REGION = "서울부산대구인천광주대전울산세종경기강원충북남전제";
  const PLATE_FIND = new RegExp(`([${PLATE_REGION}]{2})?\\d{2,3}[${PLATE_MID}]\\d{4}`);
  const pretty = (s) => { const n = norm(s); const m = n.match(/^(.*?[가-힣])(\d{4})$/); return m ? `${m[1]} ${m[2]}` : n; };

  // ---------- 예약 시간대 ----------
  // 예약시간에는 시간대 시작 시각(09:00 / 12:00 / 15:00)을 쓴다
  const SLOTS = [
    { s: "09:00", e: "12:00" },
    { s: "12:00", e: "15:00" },
    { s: "15:00", e: "18:00" },
  ];
  const slotOf = (t) => { const m = toMin(t); return SLOTS.find((x) => m >= toMin(x.s) && m < toMin(x.e)) || null; };
  // 예약 한 건의 입차 가능 시간: 행사(세민전 등) 예약은 DB의 시작~끝(r.e), 명수당은 위 세 시간대
  const winOf = (r) => (typeof r === "string" ? slotOf(r) : r.e ? { s: r.t, e: r.e } : slotOf(r.t));
  const evName = (r) => (r && r.ev ? (store.evNames && store.evNames[r.ev]) || "행사" : "");
  const slotLabel = (r) => { const s = winOf(r), n = evName(r); return (s ? `${s.s}~${s.e}` : hhmm(r.t || r)) + (n ? ` · ${n}` : ""); };
  const span = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; return ((h ? `${h}시간 ` : "") + (m ? `${m}분` : "")).trim() || "1분 미만"; };
  function slotState(r) {
    const s = winOf(r);
    if (!s) return { state: "other", text: "시간대 밖 예약" };
    const n = nowMin(), a = toMin(s.s), b = toMin(s.e);
    if (n < a) return { state: "before", text: `${span(a - n)} 후 시작` };
    if (n >= b) return { state: "after", text: "시간대 종료" };
    return { state: "now", text: `종료까지 ${span(b - n)}` };
  }

  // =========================================================
  //  예약 데이터 — 기기에 저장해 두고, 조회는 항상 기기 안에서
  //  · DB(Supabase)가 연결돼 있으면 온라인일 때 1분마다 받아서 저장
  //  · 예약 일괄 등록(CSV)은 관리자(편집) 페이지에서 DB로 바로 넣음
  //  · 인터넷이 끊겨도 마지막으로 저장한 예약으로 계속 판정
  // =========================================================
  const STORE_KEY = "plate-reservation-store-v1";
  const store = loadStore();
  if (store.file.length || store.regFile.length) {          // 예전 버전에서 기기에 불러온 CSV 예약은 지움 (이제 DB만 기준)
    store.file = []; store.regFile = []; store.fileName = ""; store.fileAt = 0;
    try { localStorage.setItem("plate-reservation-store-v1", JSON.stringify(store)); } catch (e) {}
  }
  function loadStore() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.db) && Array.isArray(v.file)) {
        if (!Array.isArray(v.regDb)) v.regDb = [];       // 예전 버전에서 저장한 데이터 호환
        if (!Array.isArray(v.regFile)) v.regFile = [];
        return v;
      }
    } catch (e) {}
    return { db: [], file: [], regDb: [], regFile: [], syncedAt: 0, fileName: "", fileAt: 0 };
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch (e) { console.error(e); setNet("저장 공간이 부족해 예약을 기기에 저장하지 못했어요.", "bad"); }
  }
  // 행 형식: { d: "2026-10-19", t: "09:00", p: "12가3456", src: "db" | "file" }
  const allRows = () => store.db.concat(store.file);

  // ---------- 정기 차량 ----------
  // 행 형식: { p: "12가3456", memo: "관리사무소", from: "2026-01-01" | "", until: "2026-12-31" | "" }
  // 정기 차량은 사전 예약과 상관없이 등록 기간(비어 있으면 무기한) 동안 항상 출입 가능
  const allRegs = () => store.regDb.concat(store.regFile);
  const regActive = (r, day) => (!r.from || r.from <= day) && (!r.until || r.until >= day);
  // 같은 차량: 완전히 같거나, 한쪽에만 지역명("서울")이 붙은 경우 (예전 번호판은 지역명까지 읽힘)
  //  (끝부분만 같다고 같은 차가 아님: 112가3456 ≠ 12가3456 → 앞의 한글 두 글자(지역명)만 떼고 비교)
  const noRegion = (p) => p.replace(/^[가-힣]{2}(?=\d)/, "");
  const sameCar = (a, b) => a === b || noRegion(a) === noRegion(b);
  const regMatch = (r, q) => sameCar(r.p, q);
  const activeRegs = () => { const t = todayStr(); return allRegs().filter((r) => regActive(r, t)); };
  // 인식 결과를 DB 번호와 맞춰 볼 때 쓰는 번호 모음 — 데이터가 바뀔 때만 새로 만듦 (차량이 많아도 빠르게)
  let knownCache = null, knownStamp = "";
  function knownPlates() {
    const stamp = [store.syncedAt, store.fileAt, store.db.length, store.file.length, store.regDb.length, store.regFile.length].join(":");
    if (!knownCache || stamp !== knownStamp) {
      knownCache = new Set(allRows().map((r) => r.p).concat(allRegs().map((r) => r.p)));
      knownStamp = stamp;
    }
    return knownCache;
  }
  const LIST_MAX = 300;                // 현황 목록은 한 번에 이만큼만 그림 (태블릿이 느려지지 않게)

  // ---------- DB 연결 (Supabase, 선택) ----------
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY");
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const TABLE = "reservations";
  const REG_TABLE = "regular_vehicles";

  let syncing = false, lastSyncError = false, lastQuery = "";
  let unlocked = false;                // 직원 로그인 전에는 예약을 보여주지 않음
  async function sync() {
    if (!sb || syncing || !unlocked) return;
    if (!navigator.onLine) { renderNet(); return; }
    syncing = true; renderNet();
    try {
      // 직원 명단에서 빠졌거나 로그아웃된 계정이면 바로 잠금 (인터넷 오류면 아래 catch로)
      if (!(await checkStaff())) { syncing = false; await signOutAll("로그인이 해제됐어요. 다시 로그인해 주세요. (전체 로그아웃 또는 직원 명단 변경)"); return; }
      const from = new Date(); from.setDate(from.getDate() - 1);   // 어제부터 앞으로의 예약만 저장
      const rows = [];
      // 행사(세민전 등) 예약은 끝 시각(reserve_end)과 행사 코드(event_code)도 받음 — DB 업데이트 전이면 예전 칸만
      let cols = "reserve_date,reserve_time,reserve_end,event_code,plate_key";
      for (let page = 0; page < 20; page++) {                       // 최대 20,000건
        const { data, error } = await sb.from(TABLE)
          .select(cols)
          .gte("reserve_date", ymd(from))
          .order("reserve_date").order("reserve_time")
          .range(page * 1000, page * 1000 + 999);
        if (error && page === 0 && cols.includes("event_code") && /42703|reserve_end|event_code/.test((error.code || "") + (error.message || ""))) {
          cols = "reserve_date,reserve_time,plate_key"; page--; continue;
        }
        if (error) throw error;
        data.forEach((r) => {
          const v = { d: r.reserve_date, t: hhmm(r.reserve_time), p: norm(r.plate_key), src: "db" };
          if (r.event_code) { v.ev = r.event_code; v.e = hhmm(r.reserve_end || r.reserve_time); }
          rows.push(v);
        });
        if (data.length < 1000) break;
      }
      if (rows.some((r) => r.ev)) {                                   // 행사 이름 (예: semin → 세민전)
        const ev = await sb.from("events").select("code,title");
        if (!ev.error && ev.data) { store.evNames = {}; ev.data.forEach((x) => { store.evNames[x.code] = x.title; }); }
      }
      store.db = rows;
      // 정기 차량 목록 (표가 아직 없으면 건너뜀)
      // Supabase는 한 번에 최대 1,000줄만 주므로 1,000줄씩 나눠서 끝까지 받음 (최대 100,000대)
      const regs = []; let regErr = null;
      for (let page = 0; page < 100; page++) {
        const { data, error } = await sb.from(REG_TABLE)
          .select("plate_key,memo,valid_from,valid_until")
          .order("plate_key")
          .range(page * 1000, page * 1000 + 999);
        if (error) { regErr = error; break; }
        data.forEach((r) => {                       // 저장 공간을 아끼려고 빈 칸은 넣지 않음
          const v = { p: norm(r.plate_key) };
          if (r.memo) v.memo = r.memo;
          if (r.valid_from) v.from = r.valid_from;
          if (r.valid_until) v.until = r.valid_until;
          regs.push(v);
        });
        if (data.length < 1000) break;
      }
      if (regErr) console.warn("정기 차량 표를 읽지 못했어요:", regErr.message);   // 일부만 받았으면 이전 목록 유지
      else store.regDb = regs;
      store.syncedAt = Date.now(); lastSyncError = false;
      saveStore();
      renderLedger();
      if (lastQuery) check(true);
    } catch (err) {
      console.error(err); lastSyncError = true;
    } finally {
      syncing = false; renderNet();
    }
  }

  // ---------- 상단 연결 상태 표시 ----------
  function setNet(text, state) { const n = $("netStatus"); n.dataset.s = state; n.querySelector("span").textContent = text; }
  function renderNet() {
    const regN = activeRegs().length;
    const count = allRows().filter((r) => r.d >= todayStr()).length + "건" + (regN ? ` · 정기 ${regN}대` : "");
    if (!sb) {
      const has = store.file.length || store.regFile.length;
      setNet("DB 연결 정보가 없어요 (config.js)", "warn");
      return;
    }
    if (syncing) { setNet("예약 받는 중…", "info"); return; }
    const when = store.syncedAt ? fmtStamp(store.syncedAt) : "없음";
    if (!navigator.onLine) setNet(`오프라인 · 마지막 동기화 ${when} · ${count}`, "warn");
    else if (lastSyncError) setNet(`동기화 실패 · 마지막 ${when} · ${count}`, "warn");
    else setNet(`온라인 · ${when} 동기화 · ${count}`, "ok");
  }
  window.addEventListener("online", () => { renderNet(); sync(); });
  window.addEventListener("offline", renderNet);

  if (!sb) {
    $("setupNotice").hidden = false;
    $("setupNotice").textContent = "DB 연결 정보(config.js)가 없어 예약을 받아 올 수 없어요. 번호판 인식만 시험할 수 있어요.";
  }

  // ---------- 시계 ----------
  const tickClock = () => { $("today").textContent = `${fmtDate(todayStr())} · ${nowHHMM()}`; };
  tickClock();
  setInterval(() => { tickClock(); renderLedger(); renderNet(); if (lastQuery) check(true); }, 30000);

  // ---------- 결과 표시 ----------
  let resultAt = 0;
  function showResult(state, html) {
    const r = $("result");
    r.dataset.s = state;
    r.innerHTML = html;
    r.hidden = false;
    $("camBox").dataset.s = ["ok", "warn", "bad", "reg"].includes(state) ? state : "idle";
    resultAt = Date.now();
  }
  function showIdle(text) {
    showResult("idle", `<div class="verdict"><span class="dot"></span>대기 중</div><div class="sub">${text}</div>`);
  }

  // ---------- 조회 (신호등) — 기기에 저장된 예약으로 즉시 판정 ----------
  function check(silent) {
    if (!unlocked) return;
    const q = norm($("plateInput").value);
    if (!q) {
      lastQuery = "";
      if (silent === true) return;
      showResult("info", `<div class="verdict"><span class="dot"></span>차량번호를 입력하세요</div><div class="sub">예: 12가3456, 123가4567, 서울12가3456</div>`);
      $("plateInput").focus();
      return;
    }
    lastQuery = q;
    const rows = allRows();
    const today0 = todayStr();

    // 🔵 정기 차량: 예약과 상관없이 출입 가능 (가장 먼저 확인)
    const reg = allRegs().find((r) => regMatch(r, q) && regActive(r, today0));
    if (reg) {
      const label0 = `<span class="mini-plate">${esc(pretty(reg.p))}</span>`;
      const info = [reg.memo ? esc(reg.memo) : "", reg.until ? `${fmtDate(reg.until)}까지` : "기간 제한 없음"].filter(Boolean).join(" · ");
      showResult("reg", `<div class="verdict"><span class="dot"></span>정기 차량 · 출입 가능</div><div>${label0}</div>` +
        `<div class="sub">${info}</div><div class="sub">현재 시각 ${nowHHMM()}</div>`);
      return;
    }
    const expiredReg = allRegs().find((r) => regMatch(r, q) && !regActive(r, today0));

    if (!rows.length && !allRegs().length) {
      showResult("info", `<div class="verdict"><span class="dot"></span>저장된 예약·정기 차량이 없어요</div><div class="sub">${sb ? "인터넷에 연결해 예약을 한 번 받아 오세요." : "DB 연결 정보(config.js)를 확인해 주세요."}</div>`);
      return;
    }

    const today = todayStr();
    // 정확히 일치 + "서울12가3456"처럼 지역명이 붙은 번호도 찾기
    const matches = rows.filter((r) => sameCar(r.p, q))
      .sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
    const label = `<span class="mini-plate">${esc(pretty(q))}</span>`;
    const now = `<div class="sub">현재 시각 ${nowHHMM()}</div>`;
    const todays = matches.filter((r) => r.d === today);

    // 🟢 오늘 + 지금 시간대
    const live = todays.find((r) => slotState(r).state === "now");
    if (live) {
      showResult("ok", `<div class="verdict"><span class="dot"></span>입차 가능 · 예약 시간대입니다</div><div>${label}</div>` +
        `<ul class="sub"><li><b style="font-family:var(--mono)">${esc(slotLabel(live))}</b><span>${slotState(live).text}</span></li></ul>${now}`);
      return;
    }
    // 🟡 오늘 예약이지만 시간대가 아님
    if (todays.length) {
      const items = todays.map((r) => `<li><b style="font-family:var(--mono)">${esc(slotLabel(r))}</b><span>${slotState(r).text}</span></li>`).join("");
      showResult("warn", `<div class="verdict"><span class="dot"></span>오늘 예약 · 시간대가 아니에요</div><div>${label}</div><ul class="sub">${items}</ul>${now}`);
      return;
    }
    // 🔴 날짜가 맞지 않음
    const future = matches.filter((r) => r.d > today);
    const past = matches.filter((r) => r.d < today).reverse();
    let detail = "";
    if (future.length) {
      detail = `<div class="sub">예약일: <b>${fmtDate(future[0].d)} ${esc(slotLabel(future[0]))}</b>${future.length > 1 ? ` 외 ${future.length - 1}건` : ""}</div>`;
    } else if (past.length) {
      detail = `<div class="sub">지난 예약: ${fmtDate(past[0].d)} ${esc(slotLabel(past[0]))}</div>`;
    } else {
      detail = `<div class="sub">이 번호로 저장된 예약이 없어요.</div>`;
      const l4 = last4(q);
      // 오늘 예약 중 한 글자만 다르거나 뒷번호 4자리가 같은 번호 → "혹시 이 차량?" 버튼
      const seen = new Set();
      const pool = activeRegs().map((r) => ({ p: r.p, reg: true })).concat(rows.filter((r) => r.d === today));
      const near = pool.filter((r) => r.p !== q && ((l4 && last4(r.p) === l4) || editDistance(r.p, q) <= 1))
        .filter((r) => !seen.has(r.p) && seen.add(r.p)).slice(0, 4);
      if (near.length) {
        detail += `<div class="sub">인식이 틀렸을 수 있어요. 혹시 이 차량인가요?</div><div class="suggest">` +
          near.map((r) => `<button type="button" class="suggest-btn" data-plate="${esc(r.p)}"><span class="mini-plate">${esc(pretty(r.p))}</span><span>${r.reg ? "정기 차량" : esc(slotLabel(r))}</span></button>`).join("") +
          `</div>`;
      }
      if (!PLATE_RE.test(q)) detail += `<div class="sub">번호 형식이 일반적이지 않아요. 다시 확인해 주세요.</div>`;
    }
    if (expiredReg) detail += `<div class="sub">정기 차량이지만 등록 기간이 아니에요 (${[expiredReg.from && fmtDate(expiredReg.from) + "부터", expiredReg.until && fmtDate(expiredReg.until) + "까지"].filter(Boolean).join(" ")})</div>`;
    if (sb && !navigator.onLine) detail += `<div class="sub">※ 오프라인: ${store.syncedAt ? fmtStamp(store.syncedAt) : "-"}에 받은 예약 기준</div>`;
    showResult("bad", `<div class="verdict"><span class="dot"></span>오늘 예약이 아닙니다</div><div>${label}</div>${detail}`);
  }

  $("checkBtn").addEventListener("click", () => check());
  // "혹시 이 차량?" 버튼: 눌러서 확인한 번호로 다시 판정
  $("result").addEventListener("click", (e) => {
    const b = e.target.closest(".suggest-btn");
    if (!b) return;
    $("plateInput").value = pretty(b.dataset.plate);
    lastShown = b.dataset.plate; lastShownAt = Date.now();
    check();
  });
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 9;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  $("plateInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } });

  // ---------- 화면 꺼짐 방지 · 전체 화면 ----------
  let wakeLock = null;
  async function keepAwake() {
    try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) { /* 지원 안 함 */ }
  }
  function releaseAwake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && stream) keepAwake(); });

  const fsBtn = $("fsBtn");
  if (document.fullscreenEnabled) {
    fsBtn.hidden = false;
    fsBtn.addEventListener("click", async () => {
      try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen(); } catch (e) {}
    });
    document.addEventListener("fullscreenchange", () => { fsBtn.querySelector("span").textContent = document.fullscreenElement ? "전체 화면 끄기" : "전체 화면"; });
  }

  // =========================================================
  //  번호판 인식 (Tesseract.js OCR)
  //  모든 인식 파일을 앱과 같은 곳에서 불러오므로 인터넷 없이 동작
  // =========================================================
  // 이미지를 적당한 크기로 맞추고 흑백·대비를 높여 글자를 읽기 쉽게 만든다
  // (갤럭시 탭 A 같은 보급형 기기에서도 빠르도록 가로 최대 960px)
  // ---- 사선 보정 ----
  // 비스듬히 찍힌 번호판은 (1) 가로로 눌려 보이고 (2) 가까운 쪽이 더 크게(사다리꼴) 보이며
  // (3) 기울어져 보입니다. 아래 보정 방법을 프레임마다 돌아가며 적용해 읽고,
  // 번호판이 읽힌 보정 방법을 기억해 다음 프레임부터 우선 사용합니다.
  //   key: 사다리꼴 보정 (+ 왼쪽이 커 보일 때, − 오른쪽이 커 보일 때)
  //   sx : 가로 늘이기 배율,  rot: 회전 각도(도)
  const VARIANTS = [
    { name: "정면", key: 0, sx: 1, rot: 0 },
    { name: "왼쪽 사선", key: 0.22, sx: 1.35, rot: 0 },
    { name: "오른쪽 사선", key: -0.22, sx: 1.35, rot: 0 },
    { name: "기울기 +", key: 0, sx: 1.1, rot: 7 },
    { name: "기울기 −", key: 0, sx: 1.1, rot: -7 },
    { name: "강한 왼쪽 사선", key: 0.35, sx: 1.6, rot: 0 },
    { name: "강한 오른쪽 사선", key: -0.35, sx: 1.6, rot: 0 },
  ];

  function transformCanvas(src, w, h, v) {
    if (!v.key && v.sx === 1 && !v.rot) return src;
    // 1) 사다리꼴 보정: 세로 띠로 잘라 각 띠의 높이를 반대로 맞춰 붙임
    let cur = src;
    if (v.key) {
      const k = document.createElement("canvas"); k.width = w; k.height = h;
      const kx = k.getContext("2d");
      const strip = 4;
      for (let x = 0; x < w; x += strip) {
        const t = (x + strip / 2) / w;                 // 0(왼쪽) ~ 1(오른쪽)
        const apparent = 1 + v.key * (1 - 2 * t);      // 그 위치에서 번호판이 커 보이는 정도
        const f = 1 / apparent;                         // 반대로 맞춤
        const dh = h * f;
        kx.drawImage(cur, x, 0, Math.min(strip, w - x), h, x, (h - dh) / 2, Math.min(strip, w - x), dh);
      }
      cur = k;
    }
    // 2) 가로 늘이기 + 3) 회전 (가로가 넓어진 만큼 캔버스도 넓힘)
    const ow = Math.round(w * v.sx), oh = h;
    const o = document.createElement("canvas"); o.width = ow; o.height = oh;
    const ox = o.getContext("2d");
    ox.fillStyle = "#ffffff"; ox.fillRect(0, 0, ow, oh);
    ox.translate(ow / 2, oh / 2);
    if (v.rot) ox.rotate((v.rot * Math.PI) / 180);
    ox.drawImage(cur, -ow / 2, -oh / 2, ow, oh);
    return o;
  }

  // =========================================================
  //  번호판 찾기 + 원근 보정 (사선 촬영 대응의 핵심)
  //  1) 화면에서 흰 번호판 바탕(밝은 사각형 덩어리)을 찾고
  //  2) 그 네 모서리를 이용해 정면에서 본 직사각형으로 펴서
  //  3) 번호판 부분만 읽습니다. 배경·테두리 잡음이 사라져 정확도가 크게 오릅니다.
  // =========================================================
  function grayOf(d, n) {
    const g = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
    return g;
  }
  function otsu(g) {
    const hist = new Uint32Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, max = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; thr = t; }
    }
    return thr;
  }
  // 밝은 덩어리 중 번호판처럼 생긴 것(가로로 긴 사각형)을 골라 네 모서리를 돌려줌
  function findPlateQuad(src, sw, sh) {
    const W = 320, k = W / sw, H = Math.max(8, Math.round(sh * k));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
    const n = W * H, g = grayOf(cx.getImageData(0, 0, W, H).data, n);
    const thr = Math.max(otsu(g), 90);
    const label = new Int32Array(n), stack = [];
    let best = null, id = 0;
    for (let i = 0; i < n; i++) {
      if (g[i] <= thr || label[i]) continue;
      id++; label[i] = id; stack.push(i);
      let area = 0, minX = W, maxX = 0, minY = H, maxY = 0, edge = false;
      let tl = null, tr = null, br = null, bl = null, sMin = 1e9, sMax = -1e9, dMin = 1e9, dMax = -1e9;
      while (stack.length) {
        const q = stack.pop(), x = q % W, y = (q / W) | 0;
        area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        const sm = x + y, df = x - y;
        if (sm < sMin) { sMin = sm; tl = [x, y]; } if (sm > sMax) { sMax = sm; br = [x, y]; }
        if (df > dMax) { dMax = df; tr = [x, y]; } if (df < dMin) { dMin = df; bl = [x, y]; }
        if (x > 0 && g[q - 1] > thr && !label[q - 1]) { label[q - 1] = id; stack.push(q - 1); }
        if (x < W - 1 && g[q + 1] > thr && !label[q + 1]) { label[q + 1] = id; stack.push(q + 1); }
        if (y > 0 && g[q - W] > thr && !label[q - W]) { label[q - W] = id; stack.push(q - W); }
        if (y < H - 1 && g[q + W] > thr && !label[q + W]) { label[q + W] = id; stack.push(q + W); }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1, ratio = bw / bh;
      if (area < n * 0.03 || ratio < 1.6 || ratio > 9 || bh < 8) continue;
      // 네 모서리로 만든 사각형 넓이 대비 실제 밝은 면적(글자 구멍 포함 감안)
      const quadArea = Math.abs((tl[0] * tr[1] - tr[0] * tl[1]) + (tr[0] * br[1] - br[0] * tr[1]) + (br[0] * bl[1] - bl[0] * br[1]) + (bl[0] * tl[1] - tl[0] * bl[1])) / 2;
      const fill = area / Math.max(1, quadArea);
      if (fill < 0.5 || fill > 1.3) continue;
      const score = area * (edge ? 0.4 : 1);
      if (!best || score > best.score) best = { score, quad: [tl, tr, br, bl] };
    }
    if (!best) return null;
    return best.quad.map(([x, y]) => [(x + 0.5) / k, (y + 0.5) / k]);
  }
  // 직사각형(출력) → 사각형(원본) 원근 변환 계수
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = from[i], [u, v] = to[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {                       // 가우스 소거
      let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      if (Math.abs(A[c][c]) < 1e-9) return null;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    return b.map((v, i) => v / A[i][i]);
  }
  // 찾은 번호판을 정면 직사각형(한국 번호판 비율 약 4.7:1)으로 펴서 돌려줌
  function rectifyPlate(src, sw, sh, quad) {
    // 긴 번호판은 600×128, 짧은·두 줄 번호판(가로:세로 3.3 미만)은 그 비율대로
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const ratio = ((dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2) / Math.max(1, (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2);
    const OW = ratio < 3.3 ? 480 : 600, OH = ratio < 3.3 ? Math.round(480 / Math.min(3.3, Math.max(1.5, ratio))) : 128, PAD = 16;
    const h = homography([[0, 0], [OW, 0], [OW, OH], [0, OH]], quad);
    if (!h) return null;
    const sc = src.getContext("2d", { willReadFrequently: true });
    const sd = sc.getImageData(0, 0, sw, sh).data;
    const g = grayOf(sd, sw * sh);
    const out = document.createElement("canvas"); out.width = OW + PAD * 2; out.height = OH + PAD * 2;
    const ox = out.getContext("2d");
    const od = ox.createImageData(out.width, out.height), o = od.data;
    o.fill(255);
    let lo = 255, hi = 0; const vals = new Uint8Array(OW * OH);
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      const den = h[6] * x + h[7] * y + 1;
      const u = (h[0] * x + h[1] * y + h[2]) / den, v = (h[3] * x + h[4] * y + h[5]) / den;
      const ui = Math.min(sw - 1, Math.max(0, u | 0)), vi = Math.min(sh - 1, Math.max(0, v | 0));
      const val = g[vi * sw + ui]; vals[y * OW + x] = val;
      if (val < lo) lo = val; if (val > hi) hi = val;
    }
    const span = Math.max(1, hi - lo);
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      const val = Math.round(((vals[y * OW + x] - lo) * 255) / span);   // 대비 늘이기
      const j = ((y + PAD) * out.width + (x + PAD)) * 4;
      o[j] = o[j + 1] = o[j + 2] = val; o[j + 3] = 255;
    }
    for (let j = 3; j < o.length; j += 4) o[j] = 255;
    ox.putImageData(od, 0, 0);
    return out;
  }
  // 원본에서 읽을 영역만 잘라 적당한 크기의 캔버스로
  function baseCanvas(src, sw, sh, crop, maxW) {
    const c0 = crop || { x: 0, y: 0, w: sw, h: sh };
    const scale = Math.min(2.5, maxW / c0.w);
    const bw = Math.max(1, Math.round(c0.w * scale)), bh = Math.max(1, Math.round(c0.h * scale));
    const b = document.createElement("canvas"); b.width = bw; b.height = bh;
    b.getContext("2d", { willReadFrequently: true }).drawImage(src, c0.x, c0.y, c0.w, c0.h, 0, 0, bw, bh);
    return b;
  }
  // 번호판을 찾아 펴기 — 못 찾으면 null (예전 방식, 점검용)
  function plateCanvas(src, sw, sh, crop) {
    const cd = findPlateCands(src, sw, sh, crop, 1)[0];
    return cd ? rectifyFrom(src, sw, sh, cd.quad) : null;
  }

  // =========================================================
  //  멀리서 찍어도: 화면 전체에서 번호판 후보 찾기
  //  · 밝기 기준을 여러 개로 바꿔 가며 "밝은 가로 사각형"을 모으고
  //  · 사각형 가운데를 가로로 훑어 글자 줄무늬(밝음↔어두움 반복)가 있는 것만 번호판 후보로
  //  · 화면의 0.06%만 차지하는 작은 번호판도 찾음 (예전에는 3% 이상만)
  //  · 결과 좌표는 원본(영상·사진) 기준 → 원본 해상도에서 확대해 읽음
  // =========================================================
  const boxIoU = (a, b) => {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const i = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
  };
  function findPlateCands(src, sw, sh, crop, maxN, noText) {
    const c0 = crop || { x: 0, y: 0, w: sw, h: sh };
    const W = Math.max(16, Math.min(640, Math.round(c0.w))), k = W / c0.w, H = Math.max(8, Math.round(c0.h * k));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(src, c0.x, c0.y, c0.w, c0.h, 0, 0, W, H);
    const n = W * H, g = grayOf(cx.getImageData(0, 0, W, H).data, n);
    const o = Math.max(50, otsu(g));
    const thrs = [o, Math.max(o, 90), 150, 185, 215].filter((t, i, a) => a.indexOf(t) === i && t < 245);
    const label = new Int32Array(n), stack = [], cands = [];
    let id = 0;
    for (const thr of thrs) {
      label.fill(0);
      for (let i = 0; i < n; i++) {
        if (g[i] <= thr || label[i]) continue;
        id++; label[i] = id; stack.push(i);
        let area = 0, minX = W, maxX = 0, minY = H, maxY = 0, edge = false;
        let tl = null, tr = null, br = null, bl = null, sMin = 1e9, sMax = -1e9, dMin = 1e9, dMax = -1e9;
        while (stack.length) {
          const q = stack.pop(), x = q % W, y = (q / W) | 0;
          area++;
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
          const sm = x + y, df = x - y;
          if (sm < sMin) { sMin = sm; tl = [x, y]; } if (sm > sMax) { sMax = sm; br = [x, y]; }
          if (df > dMax) { dMax = df; tr = [x, y]; } if (df < dMin) { dMin = df; bl = [x, y]; }
          if (x > 0 && g[q - 1] > thr && !label[q - 1]) { label[q - 1] = id; stack.push(q - 1); }
          if (x < W - 1 && g[q + 1] > thr && !label[q + 1]) { label[q + 1] = id; stack.push(q + 1); }
          if (y > 0 && g[q - W] > thr && !label[q - W]) { label[q - W] = id; stack.push(q - W); }
          if (y < H - 1 && g[q + W] > thr && !label[q + W]) { label[q + W] = id; stack.push(q + W); }
        }
        const bw = maxX - minX + 1, bh = maxY - minY + 1, ratio = bw / bh;
        if (area < n * 0.0006 || bh < 5 || bw < 18 || ratio < 1.6 || ratio > 8 || area > n * 0.5) continue;
        const quadArea = Math.abs((tl[0] * tr[1] - tr[0] * tl[1]) + (tr[0] * br[1] - br[0] * tr[1]) + (br[0] * bl[1] - bl[0] * br[1]) + (bl[0] * tl[1] - tl[0] * bl[1])) / 2;
        const fill = area / Math.max(1, quadArea);
        if (fill < 0.45 || fill > 1.3) continue;
        // 글자 줄무늬: 높이 35~65% 사이 몇 줄에서 "번호판 바탕 → 글자" 바뀌는 횟수
        // + 바탕과 글자의 밝기 차이(바닥 얼룩 같은 흐린 무늬는 제외)
        let stripes = 0, sOn = 0, nOn = 0, sOff = 0, nOff = 0;
        for (const fy of [0.38, 0.46, 0.54, 0.62]) {
          const y = Math.min(maxY, Math.round(minY + bh * fy)), row = y * W;
          let first = -1, last = -1;
          for (let x = minX; x <= maxX; x++) if (label[row + x] === id) { if (first < 0) first = x; last = x; }
          if (first < 0) continue;
          let t = 0, prev = true;
          for (let x = first; x <= last; x++) {
            const on = label[row + x] === id;
            if (on) { sOn += g[row + x]; nOn++; } else { sOff += g[row + x]; nOff++; }
            if (prev && !on) t++; prev = on;
          }
          if (t > stripes) stripes = t;
        }
        if (stripes < 4 || stripes > 40 || !nOff) continue;
        const contrast = sOn / Math.max(1, nOn) - sOff / nOff;
        if (contrast < 45) continue;
        const ratioFit = 1 - Math.min(1, Math.abs(Math.log(ratio / 4.4)) / 1.2);   // 한국 번호판 비율 4.4~4.7 (예전 2단 번호판 2:1도 허용)
        const score = (Math.log(area) * 0.6 + Math.min(stripes, 10) * 0.35 + ratioFit * 2 + (1 - Math.abs(1 - fill)) * 1.5) * (edge ? 0.4 : 1);
        cands.push({ score, quad: [tl, tr, br, bl], box: [minX, minY, maxX + 1, maxY + 1] });
      }
    }
    // 글자 줄로 찾기 — 번호판 바탕이 그릴(제네시스 등)·범퍼와 붙어 있어도 찾음
    if (!noText) {
      const W2 = Math.max(16, Math.min(960, Math.round(c0.w))), k2 = W2 / c0.w, H2 = Math.max(8, Math.round(c0.h * k2));
      let g2 = g;
      if (W2 !== W) {
        const c2 = document.createElement("canvas"); c2.width = W2; c2.height = H2;
        const x2 = c2.getContext("2d", { willReadFrequently: true });
        x2.drawImage(src, c0.x, c0.y, c0.w, c0.h, 0, 0, W2, H2);
        g2 = grayOf(x2.getImageData(0, 0, W2, H2).data, W2 * H2);
      }
      const f = k / k2;                                   // 960 기준 좌표 → 640 기준 좌표
      let rowsFound = textRowCands(g2, W2, H2);
      if (!rowsFound.length) {                              // 예전 녹색 번호판(어두운 바탕에 흰 글자)은 밝기를 뒤집어서
        const inv = new Uint8Array(g2.length); for (let i = 0; i < g2.length; i++) inv[i] = 255 - g2[i];
        rowsFound = textRowCands(inv, W2, H2);
      }
      rowsFound.forEach((cd) => cands.push({ text: true, score: cd.score, quad: cd.quad.map(([x, y]) => [(x + 0.5) * f - 0.5, (y + 0.5) * f - 0.5]), box: cd.box.map((v) => v * f) }));
    }
    // 흰 바탕 찾기와 글자 줄 찾기가 같은 곳을 가리키면 번호판일 가능성이 높음 → 가산점
    cands.forEach((a) => {
      if (cands.some((b) => b !== a && !!b.text !== !!a.text && boxIoU(a.box, b.box) > 0.25)) a.score += 1.5;
      if (a.text) a.score -= 2;                            // 글자 줄 후보 점수를 흰 바탕 후보와 같은 눈금으로
      // 직원은 번호판을 화면 가운데에 맞춰 비추므로 가운데에서 멀수록 크게 낮춤
      //  (가운데 ±6%는 그대로, 그 밖은 거리에 비례 · 옆 차 번호판·간판·벽 글씨가 가운데 번호판을 이기지 못하게)
      const cx = (a.box[0] + a.box[2]) / 2 / W - 0.5, cy = ((a.box[1] + a.box[3]) / 2 / H - 0.52) * 0.8;
      const d = Math.hypot(cx, cy), wf = (a.box[2] - a.box[0]) / W;
      a.cw = Math.max(0.1, 1 - Math.max(0, d - 0.06) * 2.4);   // 가운데 정도 1(가운데) ~ 0.1(가장자리)
      a.de = d / Math.max(0.1, wf * 2);                       // 번호판 크기에 견준 가운데와의 거리 (멀리 찍으면 번호판이 작아 더 엄격)
      a.wf = wf;
      a.score -= Math.max(0, d - 0.06) * 12;
    });
    cands.sort((a, b) => b.score - a.score);
    const uniq = [];
    for (const cd of cands) {
      if (uniq.some((x) => boxIoU(x.box, cd.box) > 0.3)) continue;
      uniq.push(cd);
      if (uniq.length >= 8) break;
    }
    // 번호판다운 후보(1등과 점수 차 4 이내, 화면 폭 65% 이하) 중에서는 가운데에 가까운 것부터 읽음
    //  → 멀리서 찍어 옆 차 번호판이 가까이 붙어 보여도 가운데 번호판을 먼저 읽음
    const top = uniq.length ? uniq[0].score : 0;
    const plaus = uniq.filter((c) => c.score >= top - 4 && c.wf <= 0.65).sort((a, b) => a.de - b.de);
    const out = plaus.concat(uniq.filter((c) => plaus.indexOf(c) < 0)).slice(0, maxN || 3);
    // central: 가운데에서 번호판 폭 정도 이내(번호판 크기 기준) — 실시간 확정에 씀
    return out.map((cd) => ({ text: !!cd.text, score: cd.score, cw: cd.cw, central: cd.de <= 0.55, quad: cd.quad.map(([x, y]) => [c0.x + (x + 0.5) / k, c0.y + (y + 0.5) / k]) }));
  }
  // =========================================================
  //  글자 줄로 번호판 찾기
  //  1) 주변보다 어두운 작은 덩어리(글자 후보)를 모으고
  //  2) 높이가 비슷하고 가로로 나란한 것 6~10개를 한 줄로 묶음
  //  3) 그릴 구멍처럼 크기·간격이 똑같이 반복되는 줄, 위아래가 밝은 여백이 아닌 줄은 제외
  //  4) 글자 윗선·아랫선 기울기로 번호판 네 모서리를 계산 (기울기·사선 반영)
  // =========================================================
  function textRowCands(g, W, H) {
    const n = W * H;
    // 주변 21×21 평균보다 12 이상 어두우면 "어두운 점"
    const ii = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += g[y * W + x]; ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + row; } }
    const R = 10, dark = new Uint8Array(n), bright = new Uint8Array(n);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
        const mean = (ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const v = g[y * W + x];
        if (v < mean - 12) dark[y * W + x] = 1; else if (v > mean - 4) bright[y * W + x] = 1;
      }
    }
    // 어두운 덩어리 → 글자처럼 생긴 것만
    const lab = new Int32Array(n), st = [], comps = [];
    let id = 0;
    for (let i = 0; i < n; i++) {
      if (!dark[i] || lab[i]) continue;
      id++; lab[i] = id; st.push(i);
      let area = 0, minX = W, maxX = 0, minY = H, maxY = 0;
      while (st.length) {
        const q = st.pop(), x = q % W, y = (q / W) | 0; area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && dark[q - 1] && !lab[q - 1]) { lab[q - 1] = id; st.push(q - 1); }
        if (x < W - 1 && dark[q + 1] && !lab[q + 1]) { lab[q + 1] = id; st.push(q + 1); }
        if (y > 0 && dark[q - W] && !lab[q - W]) { lab[q - W] = id; st.push(q - W); }
        if (y < H - 1 && dark[q + W] && !lab[q + W]) { lab[q + W] = id; st.push(q + W); }
      }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      if (h < 6 || h > H * 0.15 || w < 1 || h / w > 8 || area < h * 0.6) continue;
      if (w > h * 1.3) {
        // 멀리서 붙어 버린 글자 2~3개는 나눠서 셈 (그보다 넓으면 글자가 아님)
        const parts = Math.round(w / (h * 0.7));
        if (parts < 2 || parts > 3 || w > h * 2.6) continue;
        const pw = w / parts;
        for (let k3 = 0; k3 < parts; k3++) {
          const a0 = minX + pw * k3, a1 = a0 + pw - 1;
          comps.push({ x0: a0, x1: a1, y0: minY, y1: maxY, w: pw, h, cx: (a0 + a1) / 2, cy: (minY + maxY) / 2, split: true });
        }
        continue;
      }
      comps.push({ x0: minX, x1: maxX, y0: minY, y1: maxY, w, h, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
    }
    if (location.hash === "#debug") window.__comps = comps.map((c) => [Math.round(c.x0), Math.round(c.y0), Math.round(c.w), c.h]);
    if (comps.length < 6) return [];
    comps.sort((a, b) => a.x0 - b.x0);
    // 이웃 잇기: 높이 비슷(±35%), 세로 중심 차이 < 0.35h, 가로 틈 < 1.2h
    const parent = comps.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < comps.length; i++) {
      const a = comps[i];
      for (let j = i + 1; j < comps.length; j++) {
        const b = comps[j];
        if (b.x0 > a.x1 + a.h * 1.2) break;
        const hr = b.h / a.h;
        // 높이가 비슷하거나, 한글 윗조각(ㄹ 등)처럼 짧아도 윗선이 숫자와 맞으면 같은 줄
        if (hr < 0.65 || hr > 1.54) continue;
        if (Math.abs(b.cy - a.cy) > Math.max(a.h, b.h) * 0.35) continue;
        if (b.x0 < a.x1 - a.w * 0.5) continue;                     // 겹치면 같은 글자 조각이 아님
        parent[find(j)] = find(i);
      }
    }
    const groups = {};
    comps.forEach((c, i) => { const r = find(i); (groups[r] = groups[r] || []).push(c); });
    // "105" + "2621"처럼 가운데 한글(로·고 등)이 짧게 잡혀 둘로 끊긴 줄을 다시 이음
    //  · 두 줄의 글자 높이·윗선·아랫선이 같고 사이가 글자 2.4개 이내일 때만 (그릴 구멍은 줄을 이루지 못해 해당 없음)
    {
      const med = (arr) => { const v = arr.slice().sort((a, b) => a - b); return v[v.length >> 1]; };
      const gl = Object.keys(groups).map((k) => {
        const m = groups[k];
        return { k, m, minX: Math.min.apply(null, m.map((c) => c.x0)), maxX: Math.max.apply(null, m.map((c) => c.x1)), y0: med(m.map((c) => c.y0)), y1: med(m.map((c) => c.y1)), h: med(m.map((c) => c.h)) };
      }).sort((a, b) => a.minX - b.minX);
      const multi = gl.filter((g0) => g0.m.length >= 2);
      for (let i = 0; i < multi.length; i++) {
        const A = multi[i]; if (A.dead) continue;
        for (let j = 0; j < multi.length; j++) {
          const B = multi[j]; if (B === A || B.dead || B.minX <= A.maxX) continue;
          const gap = B.minX - A.maxX, h = Math.max(A.h, B.h);
          if (gap > h * 2.4 || Math.abs(A.h / B.h - 1) > 0.2 || Math.abs(A.y0 - B.y0) > h * 0.25 || Math.abs(A.y1 - B.y1) > h * 0.25) continue;
          // 사이에 있는 짧은 조각(한글 윗부분 등)도 함께
          gl.forEach((S) => {
            if (S === A || S === B || S.dead || S.m.length !== 1) return;
            const c = S.m[0];
            if (c.cx > A.maxX && c.cx < B.minX && Math.abs(c.y0 - A.y0) < h * 0.3 && c.y1 <= A.y1 + h * 0.3) { A.m.push(c); S.dead = true; delete groups[S.k]; }
          });
          B.m.forEach((c) => A.m.push(c));
          A.maxX = B.maxX; B.dead = true; delete groups[B.k];
          groups[A.k] = A.m;
          j = -1;                                               // 이어 붙인 뒤 다시 확인
        }
      }
    }
    const fit = (pts) => {                                   // 최소제곱 직선 y = a·x + b
      const k0 = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
      const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
      const den = k0 * sxx - sx * sx; const a = den ? (k0 * sxy - sx * sy) / den : 0;
      return { a, b: (sy - a * sx) / k0 };
    };
    const yAt = (L, x) => L.a * x + L.b;
    // 줄 정보: 글자 수, 가운데 높이, 좌우 끝, 윗선·아랫선, 너비 편차
    const rows = [];
    Object.keys(groups).forEach((k) => {
      const m = groups[k];
      if (m.length < 3 || m.length > 11) return;
      m.sort((a, b) => a.cx - b.cx);
      const hs = m.map((c) => c.h).sort((a, b) => a - b), hMed = hs[hs.length >> 1];
      const minX = m[0].x0, maxX = m[m.length - 1].x1, span = maxX - minX + 1;
      const tall = m.filter((c) => c.h >= hMed * 0.85);
      if (tall.length < 2) return;
      const top = fit(tall.map((c) => [c.cx, c.y0])), bot = fit(tall.map((c) => [c.cx, c.y1]));
      if (Math.abs(top.a) > 0.35) return;
      const ws = m.filter((c) => !c.split).map((c) => c.w);
      const wMean = ws.length ? ws.reduce((s, v) => s + v, 0) / ws.length : 0;
      const wCv = ws.length >= 3 ? Math.sqrt(ws.reduce((s, v) => s + (v - wMean) * (v - wMean), 0) / ws.length) / wMean : 0;
      const cx = (minX + maxX) / 2;
      rows.push({ m, n: m.length, hMed, minX, maxX, span, top, bot, wCv, nws: ws.length, cx, yTop: yAt(top, cx), yBot: yAt(bot, cx) });
    });
    if (location.hash === "#debug") window.__rows = rows.map((r) => ({ n: r.n, h: +r.hMed.toFixed(1), x: [Math.round(r.minX), Math.round(r.maxX)], yT: Math.round(r.yTop), yB: Math.round(r.yBot), cv: +r.wCv.toFixed(2) }));
    const out = [];
    const push = (quad, score) => {
      const ys = quad.map((p) => p[1]), xs = quad.map((p) => p[0]);
      const xl = Math.min.apply(null, xs), xr = Math.max.apply(null, xs);
      if (xl < -W * 0.02 || xr > W * 1.02 || Math.min.apply(null, ys) < -H * 0.02 || Math.max.apply(null, ys) > H * 1.02) return;
      out.push({ score, quad, box: [xl, Math.min.apply(null, ys), xr, Math.max.apply(null, ys)] });
    };
    // 줄 위아래(또는 위만·아래만) 여백이 밝은지 (번호판 바탕)
    const marginOk = (r, above, below, off, need) => {
      let ok = 0, tot = 0;
      for (let x = r.minX; x <= r.maxX; x += 2) {
        const hh = yAt(r.bot, x) - yAt(r.top, x), ys = [];
        if (above) ys.push(yAt(r.top, x) - hh * (off || 0.18));
        if (below) ys.push(yAt(r.bot, x) + hh * (off || 0.18));
        for (const yy of ys) { const yi = Math.round(yy); if (yi < 0 || yi >= H) continue; tot++; if (!dark[yi * W + x]) ok++; }
      }
      return tot > 0 && ok / tot >= (need || 0.8);
    };
    // 2) 예전 두 줄 번호판: 작은 윗줄("서울 12") 바로 아래에 큰 아랫줄("가 3456")
    rows.forEach((bt) => {
      if (bt.n < 4 || bt.n > 8 || bt.hMed < 9 || bt.span / bt.hMed < 1.8 || bt.span / bt.hMed > 5.5 || bt.span > W * 0.6) return;
      rows.forEach((tp) => {
        if (tp === bt || tp.n < 2 || tp.n > 8) return;
        const hr = tp.hMed / bt.hMed;
        if (hr < 0.35 || hr > 0.9) return;
        const gap = bt.yTop - tp.yBot;
        if (gap < -bt.hMed * 0.1 || gap > bt.hMed * 0.75) return;
        if (Math.abs(tp.cx - bt.cx) > bt.span * 0.2 || tp.span < bt.span * 0.35 || tp.span > bt.span * 0.9) return;   // 윗줄은 가운데, 아랫줄보다 짧게
        if (!marginOk(bt, false, true, 0.1, 0.6) || !marginOk(tp, true, false, 0.1, 0.6)) return;   // 예전 번호판은 테두리선이 글자에 가까움
        const padX = bt.hMed * 0.35;
        const xl = Math.min(bt.minX, tp.minX) - padX, xr = Math.max(bt.maxX, tp.maxX) + padX;
        // 윗줄 글자가 테두리에 붙어 일부만 잡혀도 윗줄이 다 들어오게: 아랫줄 글자 높이의 0.95배 위까지
        const lift = Math.max(bt.yTop - tp.yTop + tp.hMed * 0.3, bt.hMed * 0.95);
        const upL = yAt(bt.top, xl) - lift, upR = yAt(bt.top, xr) - lift;
        const dnL = yAt(bt.bot, xl) + bt.hMed * 0.18, dnR = yAt(bt.bot, xr) + bt.hMed * 0.18;
        const pr = (xr - xl) / Math.max(1, (dnL + dnR) / 2 - (upL + upR) / 2);
        if (pr < 1.5 || pr > 2.8) return;                         // 예전 번호판 비율(335×170 ≈ 2:1)
        push([[xl, upL], [xr, upR], [xr, dnR], [xl, dnL]], 12.4 + Math.min(bt.n + tp.n, 12) * 0.05);
        bt.paired = true;
      });
    });
    // 1) 한 줄 번호판 (긴 번호판·짧은 흰 번호판): 글자 6~11개
    rows.forEach((r) => {
      if (r.paired) return;                                      // 두 줄 번호판의 아랫줄이면 위에서 처리함
      if (r.hMed < 9) return;                                     // 너무 작은 글자(먼 간판 등)는 제외
      if (r.n < 6 || r.span / r.hMed < 2.5 || r.span / r.hMed > 9 || r.span > W * 0.7) return;
      if (r.nws < 3 || r.wCv < 0.12) return;                      // 그릴 구멍처럼 똑같은 반복은 제외
      if (r.m.filter((c) => c.h >= r.hMed * 0.85).length < 4) return;
      if (!marginOk(r, true, true)) return;
      const padX = r.hMed * 0.45, padY = 0.22;
      const xl = r.minX - padX, xr = r.maxX + padX;
      const hl = yAt(r.bot, xl) - yAt(r.top, xl), hr = yAt(r.bot, xr) - yAt(r.top, xr);
      if (hl <= 2 || hr <= 2) return;
      push([[xl, yAt(r.top, xl) - hl * padY], [xr, yAt(r.top, xr) - hr * padY], [xr, yAt(r.bot, xr) + hr * padY], [xl, yAt(r.bot, xl) + hl * padY]],
        11 + Math.min(r.n, 9) * 0.25 + Math.min(r.wCv, 0.5));
    });
    return out;
  }

  // 후보 부분만 원본 해상도에서 잘라 확대한 뒤 정면으로 펴기
  function rectifyFrom(src, sw, sh, quad0) {
    // 번호판 흰 바탕 가장자리에 붙은 검은 테두리가 글자와 붙지 않게, 가로 3%·세로 12%씩 넉넉히
    const qcx = (quad0[0][0] + quad0[1][0] + quad0[2][0] + quad0[3][0]) / 4, qcy = (quad0[0][1] + quad0[1][1] + quad0[2][1] + quad0[3][1]) / 4;
    const quad = quad0.map(([x, y]) => [qcx + (x - qcx) * 1.03, qcy + (y - qcy) * 1.12]);
    const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
    const qx0 = Math.min.apply(null, xs), qx1 = Math.max.apply(null, xs), qy0 = Math.min.apply(null, ys), qy1 = Math.max.apply(null, ys);
    const m = Math.max(3, (qy1 - qy0) * 0.12);
    const x0 = Math.max(0, Math.floor(qx0 - m)), y0 = Math.max(0, Math.floor(qy0 - m));
    const x1 = Math.min(sw, Math.ceil(qx1 + m)), y1 = Math.min(sh, Math.ceil(qy1 + m));
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    const s = Math.min(5, Math.max(1, 640 / Math.max(1, qx1 - qx0)));
    const rw = Math.round((x1 - x0) * s), rh = Math.round((y1 - y0) * s);
    const r = document.createElement("canvas"); r.width = rw; r.height = rh;
    const rx = r.getContext("2d", { willReadFrequently: true });
    rx.imageSmoothingEnabled = true; rx.imageSmoothingQuality = "high";
    rx.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, rw, rh);
    return rectifyPlate(r, rw, rh, quad.map(([x, y]) => [(x - x0) * s, (y - y0) * s]));
  }
  // 편 번호판 가장자리의 테두리선·바깥 어두운 부분을 바탕색으로 지움
  //  · 흐리게 찍히면 글자가 테두리와 붙어 한 덩어리가 되거나, 왼쪽 테두리가 "1"로 읽혀 "38나"가 "138나"가 됨
  //  · 바깥쪽부터 안으로: 거의 다(85%) 어두운 세로줄(양 끝 4% 안), 60% 넘게 어두운 가로줄(위아래 16% 안)만 — 글자 "1"은 높이의 70% 정도라 남음
  function stripFrame(flat) {
    const W = flat.width, H = flat.height;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(flat, 0, 0);
    const d = x.getImageData(0, 0, W, H), p = d.data, n = W * H, g = grayOf(p, n), thr = otsu(g);
    // 흰 글자 번호판(예전 녹색)은 뒤집어서 판단
    let midDark = 0, midN = 0;
    for (let y = Math.round(H * 0.25); y < H * 0.75; y++) for (let xx = Math.round(W * 0.1); xx < W * 0.9; xx++) { midDark += g[y * W + xx] <= thr ? 1 : 0; midN++; }
    const inv = midN && midDark / midN > 0.5;
    const isDark = (i) => (g[i] <= thr) !== inv;
    // 칠할 색: 가운데 부분에서 밝은 쪽 85% 지점(번호판 바탕색). 흰 글자 번호판이면 어두운 쪽
    const mid = [];
    for (let y = Math.round(H * 0.2); y < H * 0.8; y += 2) for (let xx = Math.round(W * 0.1); xx < W * 0.9; xx += 2) mid.push(g[y * W + xx]);
    mid.sort((a2, b2) => a2 - b2);
    const bg = mid.length ? mid[Math.floor(mid.length * (inv ? 0.15 : 0.85))] : 255;
    const rowDark = (y) => { let k = 0; for (let xx = 0; xx < W; xx++) k += isDark(y * W + xx) ? 1 : 0; return k / W; };
    const paintCol = (xx) => { for (let y = 0; y < H; y++) { const j = (y * W + xx) * 4; p[j] = p[j + 1] = p[j + 2] = bg; } };
    const paintRow = (y) => { for (let xx = 0; xx < W; xx++) { const j = (y * W + xx) * 4; p[j] = p[j + 1] = p[j + 2] = bg; } };
    let changed = false;
    const cw = Math.max(2, Math.round(W * 0.04)), rh = Math.max(2, Math.round(H * 0.16));
    for (let y = 0; y < rh && rowDark(y) > 0.6; y++) { paintRow(y); changed = true; }
    for (let y = H - 1; y >= H - rh && rowDark(y) > 0.6; y--) { paintRow(y); changed = true; }
    // 세로줄은 위아래를 지운 뒤 가운데 부분 기준으로 판단
    const colDarkMid = (xx) => { let k = 0, t = 0; for (let y = Math.round(H * 0.12); y < H * 0.88; y++) { k += isDark(y * W + xx) ? 1 : 0; t++; } return k / Math.max(1, t); };
    for (let xx = 0; xx < cw && colDarkMid(xx) > 0.85; xx++) { paintCol(xx); changed = true; }
    for (let xx = W - 1; xx >= W - cw && colDarkMid(xx) > 0.85; xx--) { paintCol(xx); changed = true; }
    if (!changed) return flat;
    x.putImageData(d, 0, 0);
    return c;
  }
  // 편 번호판을 흑백 두 색으로 또렷하게 (로↔모 같은 한글 혼동이 줄어듦)
  function binarized(flat) {
    const c = document.createElement("canvas"); c.width = flat.width; c.height = flat.height;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(flat, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data, n = c.width * c.height;
    const thr = otsu(grayOf(p, n)), W = c.width, H = c.height;
    const dark = new Uint8Array(n);
    let nd = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) { dark[i] = p[j] <= thr ? 1 : 0; nd += dark[i]; }
    // 가운데 영역이 대부분 어두우면 흰 글자 번호판(예전 녹색) → 뒤집어서 "흰 바탕에 검은 글자"로
    let midDark = 0, midN = 0;
    for (let y = Math.round(H * 0.2); y < H * 0.8; y++) for (let x = Math.round(W * 0.1); x < W * 0.9; x++) { midDark += dark[y * W + x]; midN++; }
    if (midN && midDark / midN > 0.5) for (let i = 0; i < n; i++) dark[i] = dark[i] ? 0 : 1;
    // 맨 가장자리(좌우 3%, 위아래 8%)는 비움 — 흐린 화면에서 테두리선과 글자가 붙어 글자째 지워지는 것 방지
    //  (번호판을 펼 때 여백을 두므로 글자는 이 안쪽에 있음)
    {
      const ex = Math.max(1, Math.round(W * 0.03)), ey = Math.max(1, Math.round(H * 0.08));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < ex || x >= W - ex || y < ey || y >= H - ey) dark[y * W + x] = 0;
    }
    // 가장자리에 닿은 검은 덩어리 중 글자처럼 생기지 않은 것(테두리선·나사·배경)은 지움
    const seen = new Uint8Array(n), st = [];
    for (let i = 0; i < n; i++) {
      if (!dark[i] || seen[i]) continue;
      const x0 = i % W, y0 = (i / W) | 0;
      if (x0 !== 0 && y0 !== 0 && x0 !== W - 1 && y0 !== H - 1) continue;
      const comp = []; seen[i] = 1; st.push(i);
      let minX = W, maxX = 0, minY = H, maxY = 0;
      while (st.length) {
        const q = st.pop(), x = q % W, y = (q / W) | 0; comp.push(q);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && dark[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st.push(q - 1); }
        if (x < W - 1 && dark[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st.push(q + 1); }
        if (y > 0 && dark[q - W] && !seen[q - W]) { seen[q - W] = 1; st.push(q - W); }
        if (y < H - 1 && dark[q + W] && !seen[q + W]) { seen[q + W] = 1; st.push(q + W); }
      }
      const cw = maxX - minX + 1, ch = maxY - minY + 1;
      const charLike = ch > H * 0.45 && ch < H * 0.85 && cw < W * 0.2;   // 가장자리에 걸친 글자는 남김 (높이 85% 넘는 세로선은 테두리)
      if (!charLike) for (const q of comp) dark[q] = 0;
    }
    // 양 끝 5% 안에만 있는 가는 세로선(번호판 테두리·나사)은 "1"로 읽히지 않게 지움
    seen.fill(0);
    for (let i = 0; i < n; i++) {
      if (!dark[i] || seen[i]) continue;
      const comp = []; seen[i] = 1; st.push(i);
      let minX = W, maxX = 0;
      while (st.length) {
        const q = st.pop(), x = q % W, y = (q / W) | 0; comp.push(q);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (x > 0 && dark[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st.push(q - 1); }
        if (x < W - 1 && dark[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st.push(q + 1); }
        if (y > 0 && dark[q - W] && !seen[q - W]) { seen[q - W] = 1; st.push(q - W); }
        if (y < H - 1 && dark[q + W] && !seen[q + W]) { seen[q + W] = 1; st.push(q + W); }
      }
      if ((maxX < W * 0.05 || minX > W * 0.95) && maxX - minX < W * 0.03) for (const q of comp) dark[q] = 0;
      else if (maxX - minX < W * 0.04 && comp.length > 0) {      // 번호판 높이 거의 전체를 차지하는 가는 세로선(테두리)도 지움
        let y0 = H, y1 = 0; for (const q of comp) { const y = (q / W) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (y1 - y0 > H * 0.85) for (const q of comp) dark[q] = 0;
      }
    }
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = dark[i] ? 0 : 255; p[j] = p[j + 1] = p[j + 2] = v; }
    x.putImageData(d, 0, 0);
    return cleanLines(c);
  }
  function scaled(src, k) {
    const c = document.createElement("canvas"); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  const halfSize = (flat) => scaled(flat, 0.5);
  // 편 번호판 읽기
  //  · 실시간(빠르게): 흑백 → 안 되면 원본
  //  · 사진(꼼꼼히): 흑백·원본·절반 크기 세 번 읽어 다수결, 모두 실패하면 덩어리 읽기(예전 2단 번호판 대비)
  // 흑백 이미지에서 글자가 될 수 없는 선 지우기 (번호판 테두리·바깥 배경 조각)
  //  · 가로로 60% 넘게 이어진 선  · 높이 85% 넘게 이어진 가는 세로선  · 양 끝 6% 안의 가는 조각
  function cleanLines(c) {
    const W = c.width, H = c.height, x = c.getContext("2d", { willReadFrequently: true });
    const d = x.getImageData(0, 0, W, H), p = d.data, n = W * H;
    const dark = new Uint8Array(n), seen = new Uint8Array(n), st = [];
    for (let i = 0; i < n; i++) dark[i] = p[i * 4] < 128 ? 1 : 0;
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!dark[i] || seen[i]) continue;
      const comp = []; seen[i] = 1; st.push(i);
      let minX = W, maxX = 0, minY = H, maxY = 0;
      while (st.length) {
        const q = st.pop(), qx = q % W, qy = (q / W) | 0; comp.push(q);
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx; if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
        if (qx > 0 && dark[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st.push(q - 1); }
        if (qx < W - 1 && dark[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st.push(q + 1); }
        if (qy > 0 && dark[q - W] && !seen[q - W]) { seen[q - W] = 1; st.push(q - W); }
        if (qy < H - 1 && dark[q + W] && !seen[q + W]) { seen[q + W] = 1; st.push(q + W); }
      }
      const cw = maxX - minX + 1, ch = maxY - minY + 1;
      const wide = cw > W * 0.6, tallThin = ch > H * 0.85 && cw < W * 0.08, sideBit = (maxX < W * 0.06 || minX > W * 0.94) && cw < W * 0.06;
      if (wide || tallThin || sideBit) { for (const q of comp) { const j = q * 4; p[j] = p[j + 1] = p[j + 2] = 255; } changed = true; }
    }
    if (changed) x.putImageData(d, 0, 0);
    return c;
  }
  // 두 줄 번호판: 줄 사이 빈 줄을 찾아 윗줄·아랫줄로 나눔 (못 찾으면 null)
  function splitLines(bin) {
    const W = bin.width, H = bin.height, d = bin.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const rowDark = new Array(H).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] < 128) rowDark[y]++;
    const max = Math.max.apply(null, rowDark);
    if (!max) return null;
    let best = -1, bestV = Infinity;
    for (let y = Math.round(H * 0.25); y < H * 0.62; y++) if (rowDark[y] < bestV) { bestV = rowDark[y]; best = y; }
    if (best < 0 || bestV > max * 0.12) return null;
    // 위아래 둘 다 글자가 있어야 두 줄
    const sum = (a, b) => rowDark.slice(a, b).reduce((s, v) => s + v, 0);
    if (sum(0, best) < max * 2 || sum(best, H) < max * 2) return null;
    const cut = (y0, y1) => {
      const c = document.createElement("canvas"), pad = 10; c.width = W + pad * 2; c.height = y1 - y0 + pad * 2;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(bin, 0, y0, W, y1 - y0, pad, pad, W, y1 - y0);
      return c;
    };
    return [cleanLines(cut(0, best)), cleanLines(cut(best, H))];
  }
  // 펴 놓은 번호판 조각에서 번호 고르기 — 번호 말고 다른 글자가 4개 넘게 같이 읽히면
  // 번호판이 아니라 간판·안내문 속 번호("…입차 12가3456")로 보고 버림
  function extractFlat(text) {
    const p = extractPlate(text);
    if (!p) return null;
    const all = String(text).replace(/[^가-힣0-9]/g, "");
    return all.length - p.length > 4 ? null : p;
  }
  // 짧은·두 줄 번호판 읽기: 두 줄이면 줄마다 읽어 이어 붙이고, 아니면 한 줄·덩어리로
  async function readTall(w, bin, flat) {
    // 짧은 흰 번호판(한 줄)은 통째로 읽으면 되고, 두 줄 번호판은 통째로는 안 읽히므로 줄을 나눠서
    const one = extractFlat(await recognizeAs(w, bin, "7"));
    if (one) return one;
    const parts = splitLines(bin);
    if (parts) {
      const t = (await recognizeAs(w, parts[0], "7")) + (await recognizeAs(w, parts[1], "7"));
      const p = extractFlat(t.replace(/\s+/g, ""));
      if (p) return p;
    }
    return extractFlat(await recognizeAs(w, bin, "6")) || extractFlat(await recognizeAs(w, flat, "6"));
  }
  // 흑백 그림에 남은 글자 범위(좌우) 바깥의 양 끝을 원본에서 잘라냄 — 흐린 테두리선이 "1"로 읽히는 것 방지
  function cropToText(flat, bin) {
    const W = bin.width, H = bin.height, d = bin.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1, nd = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] < 128) { nd++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (nd < W * H * 0.03 || x1 - x0 < W * 0.5) return flat;          // 흑백이 거의 비었거나 글자가 좁게만 남았으면 그대로
    // 많이 자르지 않음: 양 끝 6%까지만 (흑백에서 글자가 사라졌어도 원본 글자를 자르지 않게)
    const pad = Math.round(W * 0.05), a = Math.min(Math.round(W * 0.06), Math.max(0, x0 - pad)), b = Math.max(W - Math.round(W * 0.06), Math.min(W, x1 + 1 + pad));
    if (a === 0 && b === W) return flat;
    const c = document.createElement("canvas"); c.width = b - a; c.height = flat.height;
    c.getContext("2d").drawImage(flat, a, 0, b - a, flat.height, 0, 0, b - a, flat.height);
    return c;
  }
  async function readFlat(w, flat0, thorough, binK) {
    const flat1 = stripFrame(flat0);
    const bin = binarized(flat1);
    if (flat1.width / flat1.height < 3.6) {                  // 짧은 흰 번호판·예전 두 줄 번호판
      const p = await readTall(w, bin, flat1);
      return thorough ? (p ? { plate: p, weak: false, agree: 2 } : null) : p;
    }
    const flat = cropToText(flat1, bin);
    // 흑백 그림은 60% 크기로 줄여 읽는 편이 정확함(글자가 너무 크면 "84"를 "884"로 겹쳐 읽는 일이 생김)
    //  흔들리거나 흐린 화면은 절반 크기로 줄이면 잡음이 줄어 읽히는 경우가 많음
    const bin6 = scaled(bin, binK || 0.6);
    if (!thorough) {
      return extractFlat(await recognizeAs(w, bin6, "7")) || extractFlat(await recognizeAs(w, flat, "7")) || extractFlat(await recognizeAs(w, halfSize(flat), "7"));
    }
    const reads = [];
    for (const c of [bin6, flat, halfSize(flat)]) { const p = extractFlat(await recognizeAs(w, c, "7")); if (p) reads.push(p); }
    if (!reads.length) { const p = extractFlat(await recognizeAs(w, flat, "6")); return p ? { plate: p, weak: true } : null; }
    const cnt = {}; reads.forEach((p) => { cnt[p] = (cnt[p] || 0) + 1; });
    const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || reads.indexOf(a) - reads.indexOf(b))[0];
    return { plate: best, weak: false, agree: cnt[best] };
  }

  // 인식 방식 설정(번호판을 편 이미지는 한 줄 읽기, 그 외는 덩어리 읽기)
  let psmNow = "6";
  async function recognizeAs(w, canvas, psm) {
    if (psm !== psmNow) { await w.setParameters({ tessedit_pageseg_mode: psm }); psmNow = psm; }
    const { data } = await w.recognize(canvas);
    return data.text;
  }

  function toOcrCanvas(src, sw, sh, crop, variant) {
    const base = baseCanvas(src, sw, sh, crop, 900);
    const t = transformCanvas(base, base.width, base.height, variant || VARIANTS[0]);
    const c = document.createElement("canvas");
    c.width = t.width; c.height = t.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(t, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      g = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
      p[i] = p[i + 1] = p[i + 2] = g;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }

  // 읽은 글자에서 번호판 번호 고르기
  //  · 띄어쓰기 단위로 먼저 찾아 테두리·잡음이 붙은 숫자를 피하고
  //  · "934나5678"처럼 앞자리가 의심되면 "34나5678"도 후보로 두며
  //  · 후보 중 저장된 예약에 있는 번호가 있으면 그것을 우선
  function extractPlate(text) {
    const re = new RegExp(PLATE_FIND.source, "g");
    const found = [];
    const scan = (str) => { re.lastIndex = 0; let m; while ((m = re.exec(str))) found.push(m[0]); };
    String(text).split(/\s+/).forEach((tok) => scan(tok.replace(/[^가-힣0-9]/g, "")));
    scan(String(text).replace(/[^가-힣0-9]/g, ""));
    if (!found.length) return null;
    const cands = [];
    found.forEach((c) => { cands.push(c); const m = c.match(/^\d(\d{2}[가-힣]\d{4})$/); if (m) cands.push(m[1]); });
    const known = knownPlates();
    return cands.find((c) => known.has(c)) || found[0];
  }

  let workerP = null;
  const getWorker = () => workerP || (workerP = (async () => {
    const w = await Tesseract.createWorker("kor", 1, {
      workerPath: abs("worker.min.js"),
      corePath: abs("./"),
      langPath: abs("./").replace(/\/$/, ""),
      workerBlobURL: false,
    });
    await w.setParameters({
      tessedit_pageseg_mode: "6",                                  // 글자 덩어리 하나로 읽기 (번호판에 적합)
      tessedit_char_whitelist: "0123456789" + PLATE_MID + PLATE_REGION,   // 번호판에 쓰이는 글자만 읽기
    });
    return w;
  })().catch((e) => { workerP = null; throw e; }));

  // --- 실시간 카메라 인식 ---
  const video = $("video");
  let stream = null, timer = null, busy = false;
  let lastShown = "", lastShownAt = 0;
  let avgMs = 0;                // 한 번 읽는 데 걸리는 평균 시간
  // 실시간 인식 상태
  //  recent: 최근 5프레임 인식 결과 {p: 번호, cw: 화면 가운데 정도} (흔들림 방지·확정용)
  //  missed: 최근에 못 읽은 후보 자리 → 다음 프레임에 다른 후보부터 · textHit: 최근에 글자 줄 찾기로 읽혔는지
  //  frameNo·tryIdx·bestVariant·missStreak: 가운데 띠 보정 방법 돌리기 · usedFlat: 번호판을 펴서 읽었는지
  const newLive = () => ({ recent: [], missed: [], lastConf: null, textHit: false, frameNo: 0, tryIdx: 0, bestVariant: 0, missStreak: 0, usedFlat: false });
  let live = newLive();

  function setStatus(t) { $("camStatus").hidden = false; $("camStatus").textContent = t; }
  const speedText = () => (avgMs ? ` · ${(avgMs / 1000).toFixed(1)}초/회` : "");

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showResult("bad", `<div class="verdict"><span class="dot"></span>이 브라우저는 카메라를 쓸 수 없어요</div><div class="sub">https 주소(GitHub Pages)에서 Chrome으로 열었는지 확인하거나 [사진으로 인식]을 쓰세요.</div>`);
      return;
    }
    try {
      // 멀리 있는 번호판도 읽히도록 가능한 한 높은 해상도로 (기기가 안 되면 알아서 낮춤)
      const base = { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } };
      try { stream = await navigator.mediaDevices.getUserMedia({ video: Object.assign({ zoom: true }, base), audio: false }); }
      catch (e1) { if (e1 && e1.name === "NotAllowedError") throw e1; stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false }); }
    } catch (err) {
      console.error(err);
      showResult("bad", `<div class="verdict"><span class="dot"></span>카메라를 켜지 못했어요</div><div class="sub">브라우저의 카메라 권한을 허용한 뒤 다시 눌러 주세요.</div>`);
      return;
    }
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute("playsinline", "");
    $("camIdle").hidden = true;
    $("camIdle").style.display = "none";
    try { await video.play(); } catch (err) { console.error(err); }
    setTimeout(() => {
      if (stream && (!video.videoWidth || video.paused)) {
        setStatus("영상이 표시되지 않으면 화면을 한 번 탭하세요");
        $("camBox").addEventListener("click", () => video.play().catch(() => {}), { once: true });
      }
    }, 1500);
    $("stopCam").hidden = false;
    keepAwake();
    setStatus("인식 준비 중…");
    try { await getWorker(); }
    catch (err) {
      console.error(err);
      setStatus("인식 기능을 불러오지 못했어요");
      showResult("bad", `<div class="verdict"><span class="dot"></span>인식 기능을 불러오지 못했어요</div><div class="sub">처음 한 번은 인터넷이 연결된 상태에서 열어야 인식 파일이 기기에 저장됩니다. 번호는 직접 입력해 확인할 수 있어요.</div>`);
      return;
    }
    if (!stream) return;
    setStatus("번호판을 네모 안에 맞춰 주세요");
    showIdle("번호판을 네모 안에 맞추면 바로 예약 여부가 표시됩니다.");
    setupZoom();
    timer = setInterval(scanFrame, 500);
  }

  function stopCamera() {
    clearInterval(timer); timer = null;
    try { $("plateMark").hidden = true; $("plateZoom").hidden = true; } catch (e) {}
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    $("camIdle").hidden = false;
    $("camIdle").style.display = "";
    $("camStatus").hidden = true;
    $("stopCam").hidden = true;
    $("camBox").classList.remove("found", "live");
    $("camBox").dataset.s = "idle";
    $("zoomCtl").hidden = true; $("zoomHint").hidden = true;
    video.style.transform = ""; pinchPts.clear(); pinch = null; zoomTrack = null;
    releaseAwake();
  }

  // =========================================================
  //  카메라 줌 — 두 손가락으로 벌리면 확대, 오므리면 축소 (− / + 버튼, 마우스 휠도 가능)
  //  · 카메라가 줌을 지원하면(대부분 안드로이드 Chrome) 카메라 자체 줌 → 화질 그대로 확대
  //  · 지원하지 않으면(아이패드 등) 화면 확대(디지털 줌)
  //  · 어느 쪽이든 화면의 네모 안에 보이는 부분을 그대로 읽음
  // =========================================================
  const ZOOM_KEY = "plate-zoom-v1";
  let zoom = 1, zoomMin = 1, zoomMax = 4, hwZoom = false, zoomTrack = null, zoomRaf = 0;
  const pinchPts = new Map(); let pinch = null;

  function setupZoom() {
    zoomTrack = stream && stream.getVideoTracks()[0];
    let caps = {};
    try { caps = (zoomTrack && zoomTrack.getCapabilities) ? zoomTrack.getCapabilities() : {}; } catch (e) {}
    if (caps.zoom && caps.zoom.max > caps.zoom.min) { hwZoom = true; zoomMin = caps.zoom.min; zoomMax = Math.min(caps.zoom.max, 10); }
    else { hwZoom = false; zoomMin = 1; zoomMax = 4; }
    let saved = 1; try { saved = parseFloat(localStorage.getItem(ZOOM_KEY)) || 1; } catch (e) {}
    $("camBox").classList.add("live");
    $("zoomCtl").hidden = false;
    let hinted = false; try { hinted = !!localStorage.getItem(ZOOM_KEY + "-hint"); } catch (e) {}
    if (!hinted) { $("zoomHint").hidden = false; setTimeout(() => { $("zoomHint").hidden = true; }, 5000); try { localStorage.setItem(ZOOM_KEY + "-hint", "1"); } catch (e) {} }
    applyZoom(saved);
  }
  function applyZoom(z) {
    zoom = Math.min(zoomMax, Math.max(zoomMin, z));
    $("zoomLabel").textContent = zoom.toFixed(1) + "×";
    if (hwZoom && zoomTrack) {
      video.style.transform = "";
      if (!zoomRaf) zoomRaf = requestAnimationFrame(() => {     // 손가락 움직임마다 보내지 않고 한 프레임에 한 번만
        zoomRaf = 0;
        zoomTrack.applyConstraints({ advanced: [{ zoom: zoom }] }).catch(() => {});
      });
    } else {
      video.style.transform = zoom > 1.001 ? "scale(" + zoom.toFixed(3) + ")" : "";
    }
    live.recent = [];                                            // 확대 비율이 바뀌면 이전 인식 결과는 버림
    try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (e) {}
  }
  const camEl = $("camBox");
  const dist = () => { const p = Array.from(pinchPts.values()); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
  camEl.addEventListener("pointerdown", (e) => {
    if (!stream || e.target.closest("button")) return;
    pinchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPts.size === 2) { pinch = { d: dist(), z: zoom }; $("zoomHint").hidden = true; }
  });
  camEl.addEventListener("pointermove", (e) => {
    if (!pinchPts.has(e.pointerId)) return;
    pinchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pinchPts.size === 2 && pinch.d > 10) { e.preventDefault(); applyZoom(pinch.z * dist() / pinch.d); }
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) => camEl.addEventListener(t, (e) => {
    pinchPts.delete(e.pointerId);
    if (pinchPts.size < 2) pinch = null;
  }));
  camEl.addEventListener("wheel", (e) => {                       // PC: 마우스 휠·트랙패드
    if (!stream) return;
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  camEl.addEventListener("dblclick", () => { if (stream) applyZoom(1); });   // 두 번 탭하면 원래 크기
  $("zoomIn").addEventListener("click", () => applyZoom(zoom * 1.25));
  $("zoomOut").addEventListener("click", () => applyZoom(zoom / 1.25));

  // 찾은 번호판: 화면에 초록 테두리 + 위쪽에 크게 확대해서 보여 줌
  let foundHideTimer = null;
  function showFound(boxQuad, flat, read) {
    const mark = $("plateMark"), zc = $("plateZoom");
    if (!boxQuad) {
      if (!foundHideTimer) foundHideTimer = setTimeout(() => { mark.hidden = true; zc.hidden = true; foundHideTimer = null; }, 1500);
      return;
    }
    clearTimeout(foundHideTimer); foundHideTimer = null;
    const xs = boxQuad.map((p) => p[0]), ys = boxQuad.map((p) => p[1]);
    const x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
    mark.style.left = `${x0 - 4}px`; mark.style.top = `${y0 - 4}px`;
    mark.style.width = `${Math.max.apply(null, xs) - x0 + 8}px`; mark.style.height = `${Math.max.apply(null, ys) - y0 + 8}px`;
    mark.classList.toggle("read", !!read);
    mark.hidden = false;
    if (flat) {
      zc.width = flat.width; zc.height = flat.height;
      // 긴 번호판은 넓게, 짧은·두 줄 번호판은 그 비율대로
      const tallPlate = flat.width / flat.height < 3.6;
      zc.style.aspectRatio = `${flat.width} / ${flat.height}`;
      zc.style.width = tallPlate ? "min(40%, 240px)" : "";
      zc.getContext("2d").drawImage(flat, 0, 0);
      zc.classList.toggle("read", !!read);
      zc.hidden = false;
    }
  }

  // 실시간 한 프레임 처리 — 후보 찾기 → 가운데 후보부터 읽기 → 최근 결과로 확정 여부 판단
  //  (화면 표시와 분리해 두어 시험 영상으로 프레임 단위 점검도 할 수 있음)
  async function liveStep(L, w, src, vw, vh, fullCrop, crop) {
    // 보정 방법 고르기: 네 번째마다 최근에 성공한 방법, 나머지는 다른 방법을 차례로
    L.frameNo++;
    let vi;
    if (L.frameNo % 4 === 0) vi = L.bestVariant;
    else { L.tryIdx = (L.tryIdx + 1) % VARIANTS.length; if (L.tryIdx === L.bestVariant) L.tryIdx = (L.tryIdx + 1) % VARIANTS.length; vi = L.tryIdx; }
    let plate = null, plateCw = 1, cd = null, ci = 0, flat = null;
    // 1순위: 화면 전체에서 번호판을 찾아 확대·정면 보정해 읽기
    // 글자 줄 찾기는 조금 무거워서 두 프레임에 한 번 (최근에 그 방법으로 읽혔으면 매번)
    const useText = L.frameNo % 2 === 0 || L.textHit;
    let cands = fullCrop.w > 8 && fullCrop.h > 8 ? findPlateCands(src, vw, vh, fullCrop, 3, !useText) : [];
    if (!cands.length && !useText && fullCrop.w > 8) cands = findPlateCands(src, vw, vh, fullCrop, 3, false);   // 흰 바탕 후보가 없으면 글자 줄로
    if (cands.length) {
      // 가운데 후보부터 읽되, 바로 전 두 프레임에서 못 읽은 자리는 건너뜀 (모두 못 읽었으면 다시 1순위부터)
      //  · 바닥 선처럼 가운데에 있지만 번호판이 아닌 것에 매달리지 않고, 다음 프레임에 다른 후보를 읽음
      const bbox = (q) => [Math.min(q[0][0], q[3][0]), Math.min(q[0][1], q[1][1]), Math.max(q[1][0], q[2][0]), Math.max(q[2][1], q[3][1])];
      L.missed = L.missed.filter((m) => L.frameNo - m.f <= 2);
      ci = cands.findIndex((c) => !L.missed.some((m) => boxIoU(m.b, bbox(c.quad)) > 0.5));
      if (ci < 0) { ci = 0; L.missed = []; }
      cd = cands[ci];
      flat = rectifyFrom(src, vw, vh, cd.quad);
      if (flat) {
        // 흑백 그림을 읽는 크기를 프레임마다 바꿔 가며(60%·75%·50%) — 한 크기에서 헷갈리는 글자도 다른 크기에서 읽힘
        plate = await readFlat(w, flat, false, [0.6, 0.75, 0.5][L.frameNo % 3]);
        if (plate) L.missed = []; else L.missed.push({ b: bbox(cd.quad), f: L.frameNo });
        L.usedFlat = !!plate;
        // 가운데(번호판 크기 기준) 후보에서 읽힌 번호만 "가운데"로, 나머지는 가장자리처럼 취급(확정에 4번 필요)
        //  · 가운데에 다른 후보가 있는데 가장자리 후보에서 읽힌 번호(옆 차 번호판)는 아예 세지 않음
        plateCw = cd.central !== false ? 1 : cands.some((c) => c !== cd && c.central) ? 0 : 0.45;   // 0.45 = 가장자리
        L.textHit = !!plate && !!cd.text;
      }
    }
    // 2순위: 번호판 후보가 없으면 매번, 후보는 있는데 못 읽었으면 네 프레임에 한 번 — 가운데 띠를 보정 방법을 돌려가며 (무거워서 아껴 씀)
    if (!plate && (!cands.length || L.frameNo % 4 === 3)) {
      plate = extractPlate(await recognizeAs(w, toOcrCanvas(src, vw, vh, crop, VARIANTS[vi]), "6"));
      if (plate) { L.bestVariant = vi; L.missStreak = 0; L.usedFlat = false; plateCw = 0.45; }   // 띠 안 어디서 읽혔는지 몰라 가장자리처럼(4번)
      else if (++L.missStreak > 2 * VARIANTS.length) { L.bestVariant = 0; L.missStreak = 0; }
    }
    L.recent.push(plate ? { p: plate, cw: plateCw } : null);
    if (L.recent.length > 5) L.recent.shift();
    let confirmed = null;
    if (plate && plateCw > 0) {
      const same = L.recent.filter((x) => x && x.cw > 0 && x.p === plate);
      // 최근에 다른 번호(옆 차 번호판, "72구3031"처럼 잘못 읽힌 번호)도 읽히고 있으면 가장 많이 읽힌 번호만 인정
      const cnt = {}; L.recent.forEach((x) => { if (x && x.cw > 0 && x.p !== plate) cnt[x.p] = (cnt[x.p] || 0) + 1; });
      const rival = Math.max.apply(null, [0].concat(Object.keys(cnt).map((k) => cnt[k])));
      // 최근 5번 중 2번 이상 같은 번호로 읽혀야 확정
      //  · 가장자리(옆 차·간판)나 가운데 띠 통째 읽기로만 읽힌 번호는 4번 (직원은 번호판을 가운데에 맞추므로)
      const central = same.some((x) => x.cw >= 0.5), need = central ? 2 : 4;
      // 가운데에서 확정된 차가 있으면 10초 동안은 가장자리에서만 읽힌 다른 번호(옆 차)로 바꾸지 않음
      const hold = L.lastConf && L.lastConf.central && L.lastConf.p !== plate && Date.now() - L.lastConf.at < 10000;
      if (same.length >= need && same.length > rival && (central || !hold)) {
        confirmed = plate;
        L.lastConf = { p: plate, central, at: Date.now() };
      }
    }
    return { read: plateCw > 0 ? plate : null, confirmed, cd, ci, flat, cands: cands.length };
  }

  async function scanFrame() {
    if (busy || !stream || video.readyState < 2 || document.hidden) return;
    busy = true;
    const t0 = performance.now();
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      // 화면에 보이는 가이드 네모(가로 80%, 세로 30%, 가운데)와 정확히 같은 영역만 읽는다.
      const box = $("camBox");
      const bw = box.clientWidth, bh = box.clientHeight;
      const scale = Math.max(bw / vw, bh / vh);
      const ox = (vw * scale - bw) / 2, oy = (vh * scale - bh) / 2;
      // 디지털 줌(화면 확대) 중이면, 화면 가운데를 기준으로 확대된 만큼 원본에서 더 좁은 영역을 읽음
      const dz = hwZoom ? 1 : zoom;
      const toVid = (x, y) => [((bw / 2 + (x - bw / 2) / dz) + ox) / scale, ((bh / 2 + (y - bh / 2) / dz) + oy) / scale];
      const p0 = toVid(bw * 0.1, bh * 0.35), p1 = toVid(bw * 0.9, bh * 0.65);
      const crop = { x: p0[0], y: p0[1], w: p1[0] - p0[0], h: p1[1] - p0[1] };
      // 번호판 찾기는 화면에 보이는 네모 전체(가로 92%, 세로 84%)에서
      const f0 = toVid(bw * 0.04, bh * 0.08), f1 = toVid(bw * 0.96, bh * 0.92);
      const fx0 = Math.max(0, f0[0]), fy0 = Math.max(0, f0[1]), fx1 = Math.min(vw, f1[0]), fy1 = Math.min(vh, f1[1]);
      const fullCrop = { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 };
      const toBox = (x, y) => [((x * scale - ox) - bw / 2) * dz + bw / 2, ((y * scale - oy) - bh / 2) * dz + bh / 2];
      const w = await getWorker();
      const st = await liveStep(live, w, video, vw, vh, fullCrop, crop);
      if (location.hash === "#debug") (window.__frames = window.__frames || []).push({ vw, vh, fullCrop, ci: st.ci, read: st.read, conf: st.confirmed, n: st.cands, q: st.cd && st.cd.quad.map((p) => p.map(Math.round)), text: st.cd && st.cd.text });
      if (st.cd) { if (st.ci === 0 || st.read) showFound(st.cd.quad.map((p) => toBox(p[0], p[1])), st.flat, !!st.read); }
      else if (!st.cands) showFound(null);
      const ms = performance.now() - t0;
      avgMs = avgMs ? avgMs * 0.7 + ms * 0.3 : ms;
      const plate = st.confirmed || st.read;
      if (st.confirmed) {
        $("camBox").classList.add("found");
        setStatus(`인식: ${pretty(plate)}${live.usedFlat ? " · 원근 보정" : live.bestVariant ? " · " + VARIANTS[live.bestVariant].name + " 보정" : ""}${speedText()}`);
        const now = Date.now();
        if (plate !== lastShown || now - lastShownAt > 15000) {
          lastShown = plate; lastShownAt = now;
          $("plateInput").value = pretty(plate);
          check();
          if (navigator.vibrate) navigator.vibrate(80);
        }
      } else if (!plate) {
        $("camBox").classList.remove("found");
        setStatus(`번호판이 네모 안에 보이게 비춰 주세요 · 멀리서도 돼요${speedText()}`);
        // 차량이 지나가고 15초 동안 번호판이 안 보이면 다음 차량을 위해 대기 상태로
        if ($("result").dataset.s !== "idle" && Date.now() - resultAt > 15000 && document.activeElement !== $("plateInput")) {
          lastShown = ""; lastQuery = "";
          showIdle("다음 차량의 번호판이 네모 안에 보이게 비춰 주세요.");
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  }

  // 개발·점검용 (주소 끝에 #debug 를 붙였을 때만)
  if (location.hash === "#debug") window.__plate = { toOcrCanvas, VARIANTS, getWorker, extractPlate, plateCanvas, recognizeAs, findPlateCands, rectifyFrom, readFlat, textRowCands, liveStep, newLive, stripFrame, grayOf, binarized, splitLines };

  $("startCam").addEventListener("click", startCamera);
  $("stopCam").addEventListener("click", stopCamera);
  window.addEventListener("pagehide", stopCamera);

  // --- 사진 파일로 인식 ---
  $("camInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("camLabel").textContent = "읽는 중…";
    showResult("info", `<div class="verdict"><span class="dot"></span>번호판을 읽고 있어요</div><div class="sub">잠시만 기다려 주세요.</div>`);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      URL.revokeObjectURL(img.src);
      // 사진은 모든 보정 방법으로 읽어 보고 가장 많이 나온 번호를 고름
      const w = await getWorker();
      const votes = {};
      // 1) 사진 전체에서 번호판 후보(최대 4개, 가운데에 가까운 순)를 찾아 확대·정면 보정해 읽기
      //    가운데에서 읽힌 번호일수록 표를 많이 줌 → 옆 차 번호판·간판 속 번호보다 가운데 번호판이 이김
      const cands = findPlateCands(img, img.width, img.height, null, 4);
      for (let i = 0; i < cands.length; i++) {
        $("camLabel").textContent = `번호판 확대해서 읽는 중… ${i + 1}/${cands.length}`;
        const flat = rectifyFrom(img, img.width, img.height, cands[i].quad);
        if (!flat) continue;
        const r = await readFlat(w, flat, true);
        const cw = cands[i].cw == null ? 1 : cands[i].cw;
        if (r) votes[r.plate] = (votes[r.plate] || 0) + (knownPlates().has(r.plate) ? 5 : 0) + (r.weak ? 0.5 : 1 + r.agree) * (0.3 + 0.7 * cw) - i * 0.3;
        if (r && !r.weak && r.agree >= 3 && cw >= 0.8) break;          // 가운데에서 세 번 모두 같게 읽혔으면 충분
      }
      // 2) 번호판을 못 찾았거나 못 읽었으면 예전 방식(사진 전체를 여러 보정으로)
      const candHit = Object.keys(votes).length > 0;
      for (let i = 0; i < VARIANTS.length && !candHit; i++) {
        $("camLabel").textContent = `읽는 중… ${i + 1}/${VARIANTS.length}`;
        const p = extractPlate(await recognizeAs(w, toOcrCanvas(img, img.width, img.height, null, VARIANTS[i]), "6"));
        if (p) votes[p] = (votes[p] || 0) + (i === 0 ? 1.1 : 1);
      }
      let plate = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || null;
      // 번호판 위치를 못 찾고 예전 방식으로만 읽은 번호는 두 가지 이상 보정에서 같게 나와야 인정 (지어낸 번호 방지)
      if (plate && !candHit && votes[plate] < 2 && !knownPlates().has(plate)) plate = null;
      if (plate) {
        $("plateInput").value = pretty(plate);
        check();
      } else {
        showResult("bad", `<div class="verdict"><span class="dot"></span>번호판을 찾지 못했어요</div><div class="sub">번호판이 크게 나오도록 다시 찍거나 번호를 직접 입력하세요.</div>`);
      }
    } catch (err) {
      console.error(err);
      showResult("bad", `<div class="verdict"><span class="dot"></span>인식 실패</div><div class="sub">다른 사진을 쓰거나 번호를 직접 입력하세요.</div>`);
    } finally {
      $("camLabel").textContent = "사진으로 인식";
    }
  });

  // ---------- 예약 현황 (보기 전용) ----------
  let view = "today";
  const CHIP = { now: ["now", "진행 중"], before: ["before", "대기"], after: ["after", "종료"], other: ["after", "시간대 밖"] };

  function renderLedger() {
    const box = $("ledger");
    if (!unlocked) { box.innerHTML = ""; return; }
    const today = todayStr();
    const f = norm($("filter").value);
    if (view === "reg") {
      let regs = allRegs().slice().sort((a, b) => a.p.localeCompare(b.p));
      if (f) regs = regs.filter((r) => r.p.includes(f));
      if (!regs.length) {
        box.innerHTML = `<p class="empty">${allRegs().length ? "조건에 맞는 정기 차량이 없어요." : "등록된 정기 차량이 없어요. 관리자(편집) 페이지의 CSV 일괄 등록이나 Supabase의 regular_vehicles 표에 넣으면 여기에 보입니다."}</p>`;
        return;
      }
      const total = regs.length, more = total > LIST_MAX;
      if (more) regs = regs.slice(0, LIST_MAX);
      box.innerHTML = `<div class="day"><div class="day-label">정기 차량<span>· ${total.toLocaleString()}대</span></div>` + regs.map((r) => {
        const on = regActive(r, today);
        const period = r.until ? `~${r.until.slice(2).replace(/-/g, ".")}` : "무기한";
        return `<div class="row"><span class="t reg-memo">${esc(r.memo || "정기")}</span><span><span class="mini-plate">${esc(pretty(r.p))}</span></span>` +
          `<span class="chip ${on ? "reg" : "after"}">${on ? period : "기간 아님"}</span></div>`;
      }).join("") + (more ? `<p class="empty">앞의 ${LIST_MAX}대만 보여요. 위 검색 칸에 번호 일부를 넣어 찾아보세요.</p>` : "") + `</div>`;
      return;
    }
    let list = allRows().filter((r) => (view === "today" ? r.d === today : r.d >= today));
    if (f) list = list.filter((r) => r.p.includes(f));
    list.sort((a, b) => (a.d + a.t + a.p).localeCompare(b.d + b.t + b.p));
    if (!list.length) {
      const none = !allRows().length;
      box.innerHTML = `<p class="empty">${none
        ? "아직 받은 예약이 없어요. 인터넷에 연결되면 자동으로 받아 옵니다."
        : (view === "today" ? "오늘 예약이 없어요." : "조건에 맞는 예약이 없어요.")}</p>`;
      return;
    }
    const dayN = {};                     // 날짜별 건수는 잘라내기 전 전체로 셈
    list.forEach((r) => { dayN[r.d] = (dayN[r.d] || 0) + 1; });
    const totalN = list.length, cut = totalN > LIST_MAX;
    if (cut) list = list.slice(0, LIST_MAX);
    const byDay = new Map();
    list.forEach((r) => { if (!byDay.has(r.d)) byDay.set(r.d, []); byDay.get(r.d).push(r); });
    let html = "";
    for (const [d, rs] of byDay) {
      html += `<div class="day"><div class="day-label">${fmtDate(d)}${d === today ? '<span class="tag">오늘</span>' : ""}<span>· ${dayN[d]}대</span></div>`;
      for (const r of rs) {
        let chip = "<span></span>";
        if (d === today) { const [cls, txt] = CHIP[slotState(r).state]; chip = `<span class="chip ${cls}">${txt}</span>`; }
        const sl = r.e ? null : slotOf(r.t), sc = sl ? " s" + sl.s.slice(0, 2) : r.e ? " sev" : "";   // 시간대별 바탕색 (s09·s12·s15 · 행사 sev)
        const tt = r.ev ? `${esc(r.t)}~${esc(r.e)}<small class="ev">${esc(evName(r))}</small>` : esc(slotLabel(r));
        html += `<div class="row${sc}"><span class="t">${tt}</span><span><span class="mini-plate">${esc(pretty(r.p))}</span></span>${chip}</div>`;
      }
      html += `</div>`;
    }
    if (cut) html += `<p class="empty">전체 ${totalN.toLocaleString()}건 중 앞의 ${LIST_MAX}건만 보여요. 검색 칸에 번호 일부를 넣어 찾아보세요.</p>`;
    box.innerHTML = html;
  }

  const setView = (v) => {
    view = v;
    $("vToday").setAttribute("aria-pressed", String(v === "today"));
    $("vUp").setAttribute("aria-pressed", String(v === "up"));
    $("vReg").setAttribute("aria-pressed", String(v === "reg"));
    renderLedger();
  };
  $("vToday").addEventListener("click", () => setView("today"));
  $("vUp").addEventListener("click", () => setView("up"));
  $("vReg").addEventListener("click", () => setView("reg"));
  $("filter").addEventListener("input", renderLedger);

  // =========================================================
  //  직원 로그인
  //  · 계정은 관리자가 Supabase에서 만들고, 직원 명단(staff_emails)에 올린 사람만 통과
  //  · 한 번 로그인한 기기는 인터넷이 끊겨도 저장된 예약으로 계속 사용
  //  · 로그아웃하면 기기에 저장된 예약도 지움
  // =========================================================
  const AUTH_KEY = "plate-staff-v1";            // { email, at } — 마지막으로 직원 확인된 계정
  const readAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; } };
  const writeAuth = (v) => { try { v ? localStorage.setItem(AUTH_KEY, JSON.stringify(v)) : localStorage.removeItem(AUTH_KEY); } catch (e) {} };

  async function checkStaff() {
    const { data, error } = await sb.rpc("is_staff");
    if (error) throw error;
    return data === true;
  }
  function wipeLocal() {
    store.db = []; store.regDb = []; store.file = []; store.regFile = [];
    store.syncedAt = 0; store.fileName = ""; store.fileAt = 0;
    saveStore();
  }
  function lock(message) {
    unlocked = false;
    try { stopCamera(); } catch (e) {}
    document.body.classList.add("locked");
    $("loginView").hidden = false;
    $("account").hidden = true;
    $("accountEmail").textContent = "";
    $("loginError").textContent = message || "";
    $("plateInput").value = ""; lastQuery = "";
    renderLedger();
    setTimeout(() => $("lEmail").focus(), 50);
  }
  function unlock(email, offline) {
    unlocked = true;
    document.body.classList.remove("locked");
    $("loginView").hidden = true;
    $("account").hidden = !email;
    $("accountEmail").textContent = email ? email + (offline ? " · 오프라인" : "") : "";
    renderLedger(); renderNet();
    showIdle("카메라를 켜거나 번호를 입력하면 여기에 예약 여부가 표시됩니다.");
    sync();
  }
  async function signOutAll(message) {
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
    writeAuth(null); wipeLocal();
    lock(message);
  }

  async function initAuth() {
    if (!sb) {                               // DB 없이(CSV만) 쓰는 경우는 로그인 없음
      unlock("", false);
      return;
    }
    const saved = readAuth();
    let session = null, netErr = false;
    try {
      const r = await sb.auth.getSession();
      session = r.data && r.data.session;
      if (r.error) netErr = true;
    } catch (e) { netErr = true; }

    if (session) {
      try {
        if (await checkStaff()) { writeAuth({ email: session.user.email, at: Date.now() }); unlock(session.user.email, false); }
        else await signOutAll("로그인이 해제됐어요. 다시 로그인해 주세요. (전체 로그아웃 또는 직원 명단 변경)");
      } catch (e) {                          // 인터넷이 안 되면 마지막 확인 기록으로 계속 사용
        if (saved) unlock(saved.email, true); else lock("인터넷에 연결된 상태에서 로그인해 주세요.");
      }
      return;
    }
    if (saved && (netErr || !navigator.onLine)) { unlock(saved.email, true); return; }
    if (saved) { writeAuth(null); wipeLocal(); }   // 로그인이 풀린 기기 → 저장 예약도 지움
    lock();
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("lEmail").value.trim(), password = $("lPass").value;
    const err = $("loginError"), btn = $("loginBtn");
    if (!email || !password) { err.textContent = "이메일과 비밀번호를 입력하세요."; return; }
    if (!navigator.onLine) { err.textContent = "인터넷에 연결된 상태에서 로그인해 주세요."; return; }
    btn.disabled = true; btn.textContent = "확인 중…"; err.textContent = "";
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        err.textContent = /invalid/i.test(error.message || "") ? "이메일 또는 비밀번호가 맞지 않아요." : "로그인하지 못했어요. 잠시 후 다시 시도하세요.";
        return;
      }
      if (!(await checkStaff())) { await signOutAll("직원 명단에 없는 계정이에요. 관리자에게 등록을 요청하세요."); return; }
      writeAuth({ email: data.user.email, at: Date.now() });
      $("lPass").value = "";
      unlock(data.user.email, false);
    } catch (ex) {
      console.error(ex); err.textContent = "로그인하지 못했어요. 인터넷 연결을 확인하세요.";
    } finally { btn.disabled = false; btn.textContent = "로그인"; }
  });

  $("logoutBtn").addEventListener("click", async () => {
    const b = $("logoutBtn");
    if (!b.classList.contains("arm")) {      // 한 번 더 눌러야 로그아웃 (실수 방지)
      b.classList.add("arm"); b.textContent = "정말 로그아웃";
      setTimeout(() => { b.classList.remove("arm"); b.textContent = "로그아웃"; }, 4000);
      return;
    }
    b.classList.remove("arm"); b.textContent = "로그아웃";
    await signOutAll("로그아웃했어요. 기기에 저장된 예약도 지웠어요.");
  });

  // ---------- 시작 ----------
  initAuth();
  setInterval(sync, 60000);           // 온라인이면 1분마다 예약을 새로 받아 저장

  // 오프라인에서도 열리도록 앱 파일을 기기에 저장 (서비스 워커)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e) => console.error(e));
  }
  // 인식 파일을 미리 준비해 두면 카메라를 켤 때 바로 시작됨
  if (window.Tesseract) setTimeout(() => getWorker().catch(() => {}), 1500);
})();
