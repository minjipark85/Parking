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
  const slotLabel = (t) => { const s = slotOf(t); return s ? `${s.s}~${s.e}` : hhmm(t); };
  const span = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; return ((h ? `${h}시간 ` : "") + (m ? `${m}분` : "")).trim() || "1분 미만"; };
  function slotState(t) {
    const s = slotOf(t);
    if (!s) return { state: "other", text: "시간대 밖 예약" };
    const n = nowMin(), a = toMin(s.s), b = toMin(s.e);
    if (n < a) return { state: "before", text: `${span(a - n)} 후 시작` };
    if (n >= b) return { state: "after", text: "시간대 종료" };
    return { state: "now", text: `종료까지 ${span(b - n)}` };
  }

  // =========================================================
  //  예약 데이터 — 기기에 저장해 두고, 조회는 항상 기기 안에서
  //  · DB(Supabase)가 연결돼 있으면 온라인일 때 1분마다 받아서 저장
  //  · 예약 파일(CSV)을 불러와 저장할 수도 있음 (완전 오프라인 현장)
  //  · 인터넷이 끊겨도 마지막으로 저장한 예약으로 계속 판정
  // =========================================================
  const STORE_KEY = "plate-reservation-store-v1";
  const store = loadStore();
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
  const regMatch = (r, q) => r.p === q || (q.length >= 7 && r.p.endsWith(q));
  const activeRegs = () => { const t = todayStr(); return allRegs().filter((r) => regActive(r, t)); };

  // ---------- DB 연결 (Supabase, 선택) ----------
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY");
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const TABLE = "reservations";
  const REG_TABLE = "regular_vehicles";

  let syncing = false, lastSyncError = false, lastQuery = "";
  async function sync() {
    if (!sb || syncing) return;
    if (!navigator.onLine) { renderNet(); return; }
    syncing = true; renderNet();
    try {
      const from = new Date(); from.setDate(from.getDate() - 1);   // 어제부터 앞으로의 예약만 저장
      const rows = [];
      for (let page = 0; page < 20; page++) {                       // 최대 20,000건
        const { data, error } = await sb.from(TABLE)
          .select("reserve_date,reserve_time,plate_key")
          .gte("reserve_date", ymd(from))
          .order("reserve_date").order("reserve_time")
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        data.forEach((r) => rows.push({ d: r.reserve_date, t: hhmm(r.reserve_time), p: norm(r.plate_key), src: "db" }));
        if (data.length < 1000) break;
      }
      store.db = rows;
      // 정기 차량 목록 (표가 아직 없으면 건너뜀)
      const reg = await sb.from(REG_TABLE).select("plate_key,memo,valid_from,valid_until").limit(5000);
      if (reg.error) console.warn("정기 차량 표를 읽지 못했어요:", reg.error.message);
      else store.regDb = reg.data.map((r) => ({ p: norm(r.plate_key), memo: r.memo || "", from: r.valid_from || "", until: r.valid_until || "", src: "db" }));
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
      setNet(has ? `기기 저장 예약 ${count} (파일)` : "예약 파일을 불러오세요", has ? "ok" : "warn");
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
    $("setupNotice").textContent = "DB 연결 없이 쓰는 중이에요. 아래 [예약 파일 불러오기]로 CSV 예약 파일을 넣으면 인터넷 없이 확인할 수 있어요.";
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
      showResult("info", `<div class="verdict"><span class="dot"></span>저장된 예약·정기 차량이 없어요</div><div class="sub">${sb ? "인터넷에 연결해 예약을 한 번 받아 오세요." : "[예약 파일 불러오기]로 예약 파일을 넣어 주세요."}</div>`);
      return;
    }

    const today = todayStr();
    // 정확히 일치 + "서울12가3456"처럼 지역명이 붙은 번호도 찾기
    const matches = rows.filter((r) => r.p === q || (q.length >= 7 && r.p.endsWith(q)))
      .sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
    const label = `<span class="mini-plate">${esc(pretty(q))}</span>`;
    const now = `<div class="sub">현재 시각 ${nowHHMM()}</div>`;
    const todays = matches.filter((r) => r.d === today);

    // 🟢 오늘 + 지금 시간대
    const live = todays.find((r) => slotState(r.t).state === "now");
    if (live) {
      showResult("ok", `<div class="verdict"><span class="dot"></span>입차 가능 · 예약 시간대입니다</div><div>${label}</div>` +
        `<ul class="sub"><li><b style="font-family:var(--mono)">${esc(slotLabel(live.t))}</b><span>${slotState(live.t).text}</span></li></ul>${now}`);
      return;
    }
    // 🟡 오늘 예약이지만 시간대가 아님
    if (todays.length) {
      const items = todays.map((r) => `<li><b style="font-family:var(--mono)">${esc(slotLabel(r.t))}</b><span>${slotState(r.t).text}</span></li>`).join("");
      showResult("warn", `<div class="verdict"><span class="dot"></span>오늘 예약 · 시간대가 아니에요</div><div>${label}</div><ul class="sub">${items}</ul>${now}`);
      return;
    }
    // 🔴 날짜가 맞지 않음
    const future = matches.filter((r) => r.d > today);
    const past = matches.filter((r) => r.d < today).reverse();
    let detail = "";
    if (future.length) {
      detail = `<div class="sub">예약일: <b>${fmtDate(future[0].d)} ${esc(slotLabel(future[0].t))}</b>${future.length > 1 ? ` 외 ${future.length - 1}건` : ""}</div>`;
    } else if (past.length) {
      detail = `<div class="sub">지난 예약: ${fmtDate(past[0].d)} ${esc(slotLabel(past[0].t))}</div>`;
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
          near.map((r) => `<button type="button" class="suggest-btn" data-plate="${esc(r.p)}"><span class="mini-plate">${esc(pretty(r.p))}</span><span>${r.reg ? "정기 차량" : esc(slotLabel(r.t))}</span></button>`).join("") +
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
    const OW = 600, OH = 128, PAD = 16;
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
  // 번호판을 찾아 펴기 — 못 찾으면 null
  function plateCanvas(src, sw, sh, crop) {
    const b = baseCanvas(src, sw, sh, crop, 1100);
    const quad = findPlateQuad(b, b.width, b.height);
    return quad ? rectifyPlate(b, b.width, b.height, quad) : null;
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
    const known = new Set(allRows().map((r) => r.p).concat(allRegs().map((r) => r.p)));
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
  let recent = [];              // 최근 인식 결과 (흔들림 방지용)
  let lastShown = "", lastShownAt = 0;
  let avgMs = 0;                // 한 번 읽는 데 걸리는 평균 시간
  let frameNo = 0, tryIdx = 0, bestVariant = 0, missStreak = 0, usedFlat = false;   // 사선 보정 순서

  function setStatus(t) { $("camStatus").hidden = false; $("camStatus").textContent = t; }
  const speedText = () => (avgMs ? ` · ${(avgMs / 1000).toFixed(1)}초/회` : "");

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showResult("bad", `<div class="verdict"><span class="dot"></span>이 브라우저는 카메라를 쓸 수 없어요</div><div class="sub">https 주소(GitHub Pages)에서 Chrome으로 열었는지 확인하거나 [사진으로 인식]을 쓰세요.</div>`);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
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
    timer = setInterval(scanFrame, 500);
  }

  function stopCamera() {
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    $("camIdle").hidden = false;
    $("camIdle").style.display = "";
    $("camStatus").hidden = true;
    $("stopCam").hidden = true;
    $("camBox").classList.remove("found");
    $("camBox").dataset.s = "idle";
    releaseAwake();
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
      const crop = { x: (bw * 0.1 + ox) / scale, y: (bh * 0.35 + oy) / scale, w: (bw * 0.8) / scale, h: (bh * 0.3) / scale };
      // 보정 방법 고르기: 짝수 번째는 최근에 성공한 방법, 홀수 번째는 다른 방법을 차례로
      frameNo++;
      let vi;
      if (frameNo % 4 === 0) vi = bestVariant;
      else { tryIdx = (tryIdx + 1) % VARIANTS.length; if (tryIdx === bestVariant) tryIdx = (tryIdx + 1) % VARIANTS.length; vi = tryIdx; }
      const w = await getWorker();
      let plate = null;
      // 1순위: 번호판을 찾아 정면으로 편 이미지 (짝수 프레임)
      const flat = frameNo % 2 === 0 ? plateCanvas(video, vw, vh, crop) : null;
      if (flat) { plate = extractPlate(await recognizeAs(w, flat, "7")); usedFlat = !!plate; }
      // 2순위: 번호판을 못 찾았거나 못 읽었으면 보정 방법을 돌려가며
      if (!plate) {
        plate = extractPlate(await recognizeAs(w, toOcrCanvas(video, vw, vh, crop, VARIANTS[vi]), "6"));
        if (plate) { bestVariant = vi; missStreak = 0; usedFlat = false; } else if (++missStreak > 2 * VARIANTS.length) { bestVariant = 0; missStreak = 0; }
      }
      const ms = performance.now() - t0;
      avgMs = avgMs ? avgMs * 0.7 + ms * 0.3 : ms;
      recent.push(plate);
      if (recent.length > 5) recent.shift();
      // 최근 5번 중 2번 이상 같은 번호로 읽혀야 확정
      const hits = plate ? recent.filter((x) => x === plate).length : 0;
      if (plate && hits >= 2) {
        $("camBox").classList.add("found");
        setStatus(`인식: ${pretty(plate)}${usedFlat ? " · 원근 보정" : bestVariant ? " · " + VARIANTS[bestVariant].name + " 보정" : ""}${speedText()}`);
        const now = Date.now();
        if (plate !== lastShown || now - lastShownAt > 15000) {
          lastShown = plate; lastShownAt = now;
          $("plateInput").value = pretty(plate);
          check();
          if (navigator.vibrate) navigator.vibrate(80);
        }
      } else if (!plate) {
        $("camBox").classList.remove("found");
        setStatus(`번호판을 네모 안에 맞춰 주세요${speedText()}`);
        // 차량이 지나가고 15초 동안 번호판이 안 보이면 다음 차량을 위해 대기 상태로
        if ($("result").dataset.s !== "idle" && Date.now() - resultAt > 15000 && document.activeElement !== $("plateInput")) {
          lastShown = ""; lastQuery = "";
          showIdle("다음 차량의 번호판을 네모 안에 맞춰 주세요.");
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  }

  // 개발·점검용 (주소 끝에 #debug 를 붙였을 때만)
  if (location.hash === "#debug") window.__plate = { toOcrCanvas, VARIANTS, getWorker, extractPlate, plateCanvas, recognizeAs };

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
      const flat = plateCanvas(img, img.width, img.height, null);
      if (flat) { const p = extractPlate(await recognizeAs(w, flat, "7")); if (p) votes[p] = 2.5; }   // 원근 보정 결과에 가장 큰 가중치
      for (let i = 0; i < VARIANTS.length; i++) {
        $("camLabel").textContent = `읽는 중… ${i + 1}/${VARIANTS.length}`;
        const p = extractPlate(await recognizeAs(w, toOcrCanvas(img, img.width, img.height, null, VARIANTS[i]), "6"));
        if (p) votes[p] = (votes[p] || 0) + (i === 0 ? 1.1 : 1);
      }
      const plate = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || null;
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

  // =========================================================
  //  예약 파일(CSV) 불러오기
  //  형식: 예약일자,예약시간,차량번호  (첫 줄 제목은 있어도 되고 없어도 됨)
  //  예)   2026-10-20,09:00,12가3456
  //        2026.10.20,12:00~15:00,123나 4567
  //  엑셀에서 "CSV(쉼표로 분리)"로 저장한 파일(한글 인코딩)도 읽음
  // =========================================================
  function decodeText(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder("euc-kr").decode(buf); } catch (e2) { return new TextDecoder().decode(buf); } }
  }
  function parseDate(s) {
    const m = String(s).trim().match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  }
  function parseTime(s) {
    const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?/);
    if (!m) return null;
    const slot = slotOf(`${pad(+m[1])}:${m[2] || "00"}`);
    return slot ? slot.s : null;          // 시간대 시작 시각으로 맞춤
  }
  // 정기 차량 줄: 첫 칸에 "정기"  예) 정기,,12가3456,관리사무소   (기간: 정기,2026-12-31,12가3456,관리사무소 → 그날까지)
  function parseCsv(text) {
    const rows = [], regs = [], bad = [];
    text.replace(/^﻿/, "").split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const cols = line.split(/[,\t;]/).map((c) => c.replace(/^"|"$/g, "").trim());
      if (/^정기/.test(cols[0])) {
        const pi = cols.findIndex((c, k) => k > 0 && PLATE_RE.test(norm(c)));
        if (pi < 0) { bad.push(i + 1); return; }
        const until = cols[1] && pi !== 1 ? parseDate(cols[1]) || "" : "";
        regs.push({ p: norm(cols[pi]), memo: cols.slice(pi + 1).filter(Boolean).join(" "), from: "", until, src: "file" });
        return;
      }
      const d = cols.length >= 3 ? parseDate(cols[0]) : null;
      const t = cols.length >= 3 ? parseTime(cols[1]) : null;
      const p = cols.length >= 3 ? norm(cols[2]) : "";
      if (!d || !t || !PLATE_RE.test(p)) { if (i > 0) bad.push(i + 1); return; }   // 첫 줄(제목)은 조용히 건너뜀
      rows.push({ d, t, p, src: "file" });
    });
    return { rows, regs, bad };
  }

  $("csvInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const msg = $("fileMsg");
    try {
      const { rows, regs, bad } = parseCsv(decodeText(await file.arrayBuffer()));
      if (!rows.length && !regs.length) { msg.className = "file-msg err"; msg.textContent = "읽을 수 있는 예약이 없어요. 예약일자,예약시간,차량번호 순서인지 확인하세요."; return; }
      store.file = rows; store.regFile = regs; store.fileName = file.name; store.fileAt = Date.now();
      saveStore();
      msg.className = "file-msg ok";
      msg.textContent = `${file.name}에서 예약 ${rows.length}건${regs.length ? `, 정기 차량 ${regs.length}대를` : "을"} 저장했어요.` + (bad.length ? ` (읽지 못한 줄: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? " 외" : ""})` : "");
      renderFileInfo(); renderLedger(); renderNet();
      if (lastQuery) check(true);
    } catch (err) {
      console.error(err);
      msg.className = "file-msg err"; msg.textContent = "파일을 읽지 못했어요. CSV 파일인지 확인하세요.";
    }
  });

  $("clearFile").addEventListener("click", () => {
    const b = $("clearFile");
    if (!b.classList.contains("arm")) {
      b.classList.add("arm"); b.textContent = "정말 지우기";
      setTimeout(() => { b.classList.remove("arm"); b.textContent = "파일 예약 지우기"; }, 4000);
      return;
    }
    store.file = []; store.regFile = []; store.fileName = ""; store.fileAt = 0; saveStore();
    b.classList.remove("arm"); b.textContent = "파일 예약 지우기";
    $("fileMsg").className = "file-msg"; $("fileMsg").textContent = "파일에서 불러온 예약을 지웠어요.";
    renderFileInfo(); renderLedger(); renderNet();
  });

  function renderFileInfo() {
    const has = store.file.length || store.regFile.length;
    const summary = `${store.file.length}건${store.regFile.length ? ` · 정기 ${store.regFile.length}대` : ""}`;
    $("fileCount").textContent = has ? `· ${summary}` : "";
    $("clearFile").hidden = !has;
    $("fileInfo").textContent = has ? `불러온 파일: ${store.fileName} · ${summary} · ${fmtStamp(store.fileAt)}` : "";
  }

  // ---------- 예약 현황 (보기 전용) ----------
  let view = "today";
  const CHIP = { now: ["now", "진행 중"], before: ["before", "대기"], after: ["after", "종료"], other: ["after", "시간대 밖"] };

  function renderLedger() {
    const box = $("ledger");
    const today = todayStr();
    const f = norm($("filter").value);
    if (view === "reg") {
      let regs = allRegs().slice().sort((a, b) => a.p.localeCompare(b.p));
      if (f) regs = regs.filter((r) => r.p.includes(f));
      if (!regs.length) {
        box.innerHTML = `<p class="empty">${allRegs().length ? "조건에 맞는 정기 차량이 없어요." : (sb ? "등록된 정기 차량이 없어요. Supabase의 regular_vehicles 표에 넣으면 여기에 보입니다." : "정기 차량이 없어요. 예약 파일에 '정기' 줄을 넣어 불러오세요.")}</p>`;
        return;
      }
      box.innerHTML = `<div class="day"><div class="day-label">정기 차량<span>· ${regs.length}대</span></div>` + regs.map((r) => {
        const on = regActive(r, today);
        const period = r.until ? `~${r.until.slice(2).replace(/-/g, ".")}` : "무기한";
        return `<div class="row"><span class="t reg-memo">${esc(r.memo || "정기")}</span><span><span class="mini-plate">${esc(pretty(r.p))}</span></span>` +
          `<span class="chip ${on ? "reg" : "after"}">${on ? period : "기간 아님"}</span></div>`;
      }).join("") + `</div>`;
      return;
    }
    let list = allRows().filter((r) => (view === "today" ? r.d === today : r.d >= today));
    if (f) list = list.filter((r) => r.p.includes(f));
    list.sort((a, b) => (a.d + a.t + a.p).localeCompare(b.d + b.t + b.p));
    if (!list.length) {
      const none = !allRows().length;
      box.innerHTML = `<p class="empty">${none
        ? (sb ? "아직 받은 예약이 없어요. 인터넷에 연결되면 자동으로 받아 옵니다." : "아직 예약이 없어요. [예약 파일 불러오기]로 CSV 파일을 넣어 주세요.")
        : (view === "today" ? "오늘 예약이 없어요." : "조건에 맞는 예약이 없어요.")}</p>`;
      return;
    }
    const byDay = new Map();
    list.forEach((r) => { if (!byDay.has(r.d)) byDay.set(r.d, []); byDay.get(r.d).push(r); });
    let html = "";
    for (const [d, rs] of byDay) {
      html += `<div class="day"><div class="day-label">${fmtDate(d)}${d === today ? '<span class="tag">오늘</span>' : ""}<span>· ${rs.length}대</span></div>`;
      for (const r of rs) {
        let chip = "<span></span>";
        if (d === today) { const [cls, txt] = CHIP[slotState(r.t).state]; chip = `<span class="chip ${cls}">${txt}</span>`; }
        html += `<div class="row"><span class="t">${esc(slotLabel(r.t))}</span><span><span class="mini-plate">${esc(pretty(r.p))}</span></span>${chip}</div>`;
      }
      html += `</div>`;
    }
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

  // ---------- 시작 ----------
  if (!sb && !store.file.length) $("fileBox").open = true;   // DB 없이 처음 쓰면 파일 칸을 펼쳐 둠
  renderFileInfo();
  renderLedger();
  renderNet();
  sync();
  setInterval(sync, 60000);           // 온라인이면 1분마다 예약을 새로 받아 저장

  // 오프라인에서도 열리도록 앱 파일을 기기에 저장 (서비스 워커)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e) => console.error(e));
  }
  // 인식 파일을 미리 준비해 두면 카메라를 켤 때 바로 시작됨
  if (window.Tesseract) setTimeout(() => getWorker().catch(() => {}), 1500);
})();
