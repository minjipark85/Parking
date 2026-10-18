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
  const PLATE_FIND = /([가-힣]{2})?\d{2,3}[가-힣]\d{4}/;
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
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && Array.isArray(v.db) && Array.isArray(v.file)) return v; } catch (e) {}
    return { db: [], file: [], syncedAt: 0, fileName: "", fileAt: 0 };
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch (e) { console.error(e); setNet("저장 공간이 부족해 예약을 기기에 저장하지 못했어요.", "bad"); }
  }
  // 행 형식: { d: "2026-10-19", t: "09:00", p: "12가3456", src: "db" | "file" }
  const allRows = () => store.db.concat(store.file);

  // ---------- DB 연결 (Supabase, 선택) ----------
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY");
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const TABLE = "reservations";

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
      store.db = rows; store.syncedAt = Date.now(); lastSyncError = false;
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
    const count = allRows().filter((r) => r.d >= todayStr()).length;
    if (!sb) {
      setNet(store.file.length ? `기기 저장 예약 ${count}건 (파일)` : "예약 파일을 불러오세요", store.file.length ? "ok" : "warn");
      return;
    }
    if (syncing) { setNet("예약 받는 중…", "info"); return; }
    const when = store.syncedAt ? fmtStamp(store.syncedAt) : "없음";
    if (!navigator.onLine) setNet(`오프라인 · 마지막 동기화 ${when} · ${count}건`, "warn");
    else if (lastSyncError) setNet(`동기화 실패 · 마지막 ${when} · ${count}건`, "warn");
    else setNet(`온라인 · ${when} 동기화 · ${count}건`, "ok");
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
    $("camBox").dataset.s = ["ok", "warn", "bad"].includes(state) ? state : "idle";
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
    if (!rows.length) {
      showResult("info", `<div class="verdict"><span class="dot"></span>저장된 예약이 없어요</div><div class="sub">${sb ? "인터넷에 연결해 예약을 한 번 받아 오세요." : "[예약 파일 불러오기]로 예약 파일을 넣어 주세요."}</div>`);
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
      const near = l4 ? rows.filter((r) => r.d === today && last4(r.p) === l4 && r.p !== q).slice(0, 4) : [];
      if (near.length) {
        detail += `<div class="sub">뒷번호 <b>${l4}</b>가 같은 오늘 예약: ` +
          near.map((r) => `<span class="mini-plate" style="font-size:15px">${esc(pretty(r.p))}</span> ${esc(slotLabel(r.t))}`).join(" · ") +
          `<br>인식이 틀렸을 수 있으니 번호를 확인하세요.</div>`;
      }
      if (!PLATE_RE.test(q)) detail += `<div class="sub">번호 형식이 일반적이지 않아요. 다시 확인해 주세요.</div>`;
    }
    if (sb && !navigator.onLine) detail += `<div class="sub">※ 오프라인: ${store.syncedAt ? fmtStamp(store.syncedAt) : "-"}에 받은 예약 기준</div>`;
    showResult("bad", `<div class="verdict"><span class="dot"></span>오늘 예약이 아닙니다</div><div>${label}</div>${detail}`);
  }

  $("checkBtn").addEventListener("click", () => check());
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
  function toOcrCanvas(src, sw, sh, crop) {
    const c0 = crop || { x: 0, y: 0, w: sw, h: sh };
    const scale = Math.min(2.5, 960 / c0.w);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(c0.w * scale));
    c.height = Math.max(1, Math.round(c0.h * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, c0.x, c0.y, c0.w, c0.h, 0, 0, c.width, c.height);
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

  function extractPlate(text) {
    const flat = String(text).replace(/[^가-힣0-9]/g, "");
    const m = flat.match(PLATE_FIND);
    return m ? m[0] : null;
  }

  let workerP = null;
  const getWorker = () => workerP || (workerP = (async () => {
    const w = await Tesseract.createWorker("kor", 1, {
      workerPath: abs("worker.min.js"),
      corePath: abs("./"),
      langPath: abs("./").replace(/\/$/, ""),
      workerBlobURL: false,
    });
    await w.setParameters({ tessedit_pageseg_mode: "6" });   // 글자 덩어리 하나로 읽기 (번호판에 적합)
    return w;
  })().catch((e) => { workerP = null; throw e; }));

  // --- 실시간 카메라 인식 ---
  const video = $("video");
  let stream = null, timer = null, busy = false;
  let recent = [];              // 최근 인식 결과 (흔들림 방지용)
  let lastShown = "", lastShownAt = 0;
  let avgMs = 0;                // 한 번 읽는 데 걸리는 평균 시간

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
      const canvas = toOcrCanvas(video, vw, vh, crop);
      const w = await getWorker();
      const { data } = await w.recognize(canvas);
      const ms = performance.now() - t0;
      avgMs = avgMs ? avgMs * 0.7 + ms * 0.3 : ms;
      const plate = extractPlate(data.text);
      recent.push(plate);
      if (recent.length > 3) recent.shift();
      // 최근 3번 중 2번 이상 같은 번호로 읽혀야 확정
      const hits = plate ? recent.filter((x) => x === plate).length : 0;
      if (plate && hits >= 2) {
        $("camBox").classList.add("found");
        setStatus(`인식: ${pretty(plate)}${speedText()}`);
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
      const canvas = toOcrCanvas(img, img.width, img.height);
      URL.revokeObjectURL(img.src);
      const { data } = await (await getWorker()).recognize(canvas);
      const plate = extractPlate(data.text);
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
  function parseCsv(text) {
    const rows = [], bad = [];
    text.replace(/^﻿/, "").split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const cols = line.split(/[,\t;]/).map((c) => c.replace(/^"|"$/g, "").trim());
      const d = cols.length >= 3 ? parseDate(cols[0]) : null;
      const t = cols.length >= 3 ? parseTime(cols[1]) : null;
      const p = cols.length >= 3 ? norm(cols[2]) : "";
      if (!d || !t || !PLATE_RE.test(p)) { if (i > 0) bad.push(i + 1); return; }   // 첫 줄(제목)은 조용히 건너뜀
      rows.push({ d, t, p, src: "file" });
    });
    return { rows, bad };
  }

  $("csvInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const msg = $("fileMsg");
    try {
      const { rows, bad } = parseCsv(decodeText(await file.arrayBuffer()));
      if (!rows.length) { msg.className = "file-msg err"; msg.textContent = "읽을 수 있는 예약이 없어요. 예약일자,예약시간,차량번호 순서인지 확인하세요."; return; }
      store.file = rows; store.fileName = file.name; store.fileAt = Date.now();
      saveStore();
      msg.className = "file-msg ok";
      msg.textContent = `${file.name}에서 예약 ${rows.length}건을 저장했어요.` + (bad.length ? ` (읽지 못한 줄: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? " 외" : ""})` : "");
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
    store.file = []; store.fileName = ""; store.fileAt = 0; saveStore();
    b.classList.remove("arm"); b.textContent = "파일 예약 지우기";
    $("fileMsg").className = "file-msg"; $("fileMsg").textContent = "파일에서 불러온 예약을 지웠어요.";
    renderFileInfo(); renderLedger(); renderNet();
  });

  function renderFileInfo() {
    $("fileCount").textContent = store.file.length ? `· ${store.file.length}건` : "";
    $("clearFile").hidden = !store.file.length;
    $("fileInfo").textContent = store.file.length ? `불러온 파일: ${store.fileName} · ${store.file.length}건 · ${fmtStamp(store.fileAt)}` : "";
  }

  // ---------- 예약 현황 (보기 전용) ----------
  let view = "today";
  const CHIP = { now: ["now", "진행 중"], before: ["before", "대기"], after: ["after", "종료"], other: ["after", "시간대 밖"] };

  function renderLedger() {
    const box = $("ledger");
    const today = todayStr();
    const f = norm($("filter").value);
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
    renderLedger();
  };
  $("vToday").addEventListener("click", () => setView("today"));
  $("vUp").addEventListener("click", () => setView("up"));
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
