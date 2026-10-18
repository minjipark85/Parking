(() => {
  "use strict";

  // ---------- 공통 도구 ----------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const fmtDate = (s) => { const [y, m, d] = s.split("-").map(Number); const dt = new Date(y, m - 1, d); return `${y}.${pad(m)}.${pad(d)} (${DOW[dt.getDay()]})`; };
  const hhmm = (t) => String(t || "").slice(0, 5);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // 차량번호 정리: 공백·하이픈 제거
  const norm = (s) => String(s || "").replace(/[\s\-·.]/g, "").toUpperCase();
  const last4 = (s) => { const m = norm(s).match(/(\d{4})$/); return m ? m[1] : null; };
  // 12가3456 / 123가4567 / 서울12가3456
  const PLATE_RE = /^([가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;
  const PLATE_FIND = /([가-힣]{2})?\d{2,3}[가-힣]\d{4}/;
  const pretty = (s) => { const n = norm(s); const m = n.match(/^(.*?[가-힣])(\d{4})$/); return m ? `${m[1]} ${m[2]}` : n; };

  const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  // ---------- 예약 시간대 ----------
  // DB의 reserve_time에는 시간대 시작 시각(09:00 / 12:00 / 15:00)을 넣는다
  const SLOTS = [
    { s: "09:00", e: "12:00" },
    { s: "12:00", e: "15:00" },
    { s: "15:00", e: "18:00" },
  ];
  const slotOf = (t) => { const m = toMin(t); return SLOTS.find((x) => m >= toMin(x.s) && m < toMin(x.e)) || null; };
  const slotLabel = (t) => { const s = slotOf(t); return s ? `${s.s}~${s.e}` : hhmm(t); };
  const span = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; return ((h ? `${h}시간 ` : "") + (m ? `${m}분` : "")).trim() || "1분 미만"; };
  // 오늘 예약 한 건이 지금 기준으로 어떤 상태인지
  function slotState(t) {
    const s = slotOf(t);
    if (!s) return { state: "other", text: "시간대 밖 예약" };
    const n = nowMin(), a = toMin(s.s), b = toMin(s.e);
    if (n < a) return { state: "before", text: `${span(a - n)} 후 시작` };
    if (n >= b) return { state: "after", text: "시간대 종료" };
    return { state: "now", text: `종료까지 ${span(b - n)}` };
  }

  const tickClock = () => { $("today").textContent = `오늘 ${fmtDate(todayStr())} · ${nowHHMM()}`; };
  tickClock();
  let lastQuery = "";
  setInterval(() => { tickClock(); renderLedger(); if (lastQuery) check(true); }, 30000);

  // ---------- DB 연결 (Supabase) ----------
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY");
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const TABLE = "reservations";

  if (!sb) {
    $("setupNotice").hidden = false;
    $("setupNotice").textContent = "DB가 아직 연결되지 않았어요. config.js에 Supabase 주소와 anon 키를 넣으세요. (README의 설정 순서 참고)";
  }

  // ---------- 조회 ----------
  function showResult(state, html) {
    const r = $("result");
    r.dataset.s = state;
    r.innerHTML = html;
    r.hidden = false;
  }

  async function check(silent) {
    const q = norm($("plateInput").value);
    if (!q) {
      lastQuery = "";
      if (silent === true) return;
      showResult("info", `<div class="verdict"><span class="dot"></span>차량번호를 입력하세요</div><div class="sub">예: 12가3456, 123가4567, 서울12가3456</div>`);
      $("plateInput").focus();
      return;
    }
    if (!sb) {
      showResult("info", `<div class="verdict"><span class="dot"></span>DB가 연결되지 않았어요</div><div class="sub">config.js 설정 후 다시 시도하세요.</div>`);
      return;
    }
    lastQuery = q;

    $("checkBtn").disabled = true;
    try {
      const today = todayStr();
      // 정확히 일치 + "서울12가3456"처럼 지역명이 붙은 번호도 찾기
      const { data, error } = await sb.from(TABLE)
        .select("*")
        .or(`plate_key.eq.${q},plate_key.like.*${q}`)
        .order("reserve_date").order("reserve_time");
      if (error) throw error;

      const label = `<span class="mini-plate">${esc(pretty(q))}</span>`;
      const now = `<div class="sub">현재 시각 ${nowHHMM()}</div>`;
      const todays = data.filter((r) => r.reserve_date === today);

      // 🟢 오늘 + 지금 시간대
      const live = todays.find((r) => slotState(r.reserve_time).state === "now");
      if (live) {
        showResult("ok", `<div class="verdict"><span class="dot"></span>입차 가능 · 예약 시간대입니다</div><div>${label}</div>` +
          `<ul class="sub"><li><b style="font-family:var(--mono)">${esc(slotLabel(live.reserve_time))}</b><span>${slotState(live.reserve_time).text}</span></li></ul>${now}`);
        return;
      }
      // 🟡 오늘 예약이지만 시간대가 아님
      if (todays.length) {
        const items = todays.map((r) => `<li><b style="font-family:var(--mono)">${esc(slotLabel(r.reserve_time))}</b><span>${slotState(r.reserve_time).text}</span></li>`).join("");
        showResult("warn", `<div class="verdict"><span class="dot"></span>오늘 예약 · 시간대가 아니에요</div><div>${label}</div><ul class="sub">${items}</ul>${now}`);
        return;
      }
      // 🔴 날짜가 맞지 않음
      const future = data.filter((r) => r.reserve_date > today);
      const past = data.filter((r) => r.reserve_date < today).reverse();
      let detail = "";
      if (future.length) {
        detail = `<div class="sub">예약일: <b>${fmtDate(future[0].reserve_date)} ${esc(slotLabel(future[0].reserve_time))}</b>${future.length > 1 ? ` 외 ${future.length - 1}건` : ""}</div>`;
      } else if (past.length) {
        detail = `<div class="sub">지난 예약: ${fmtDate(past[0].reserve_date)} ${esc(slotLabel(past[0].reserve_time))}</div>`;
      } else {
        detail = `<div class="sub">이 번호로 등록된 예약이 없어요.</div>`;
        // 뒷번호 4자리가 같은 오늘 예약 안내 (인식 오류 대비)
        const l4 = last4(q);
        if (l4) {
          const { data: near } = await sb.from(TABLE).select("*").like("plate_key", `%${l4}`).eq("reserve_date", today).order("reserve_time").limit(4);
          if (near && near.length) {
            detail += `<div class="sub">뒷번호 <b>${l4}</b>가 같은 오늘 예약: ` +
              near.map((r) => `<span class="mini-plate" style="font-size:15px">${esc(pretty(r.plate_key))}</span> ${esc(slotLabel(r.reserve_time))}`).join(" · ") +
              `<br>인식이 틀렸을 수 있으니 번호를 확인하세요.</div>`;
          }
        }
        if (!PLATE_RE.test(q)) detail += `<div class="sub">번호 형식이 일반적이지 않아요. 다시 확인해 주세요.</div>`;
      }
      showResult("bad", `<div class="verdict"><span class="dot"></span>오늘 예약이 아닙니다</div><div>${label}</div>${detail}`);
    } catch (err) {
      console.error(err);
      showResult("bad", `<div class="verdict"><span class="dot"></span>조회하지 못했어요</div><div class="sub">인터넷 연결과 config.js 설정을 확인하세요.</div>`);
    } finally {
      $("checkBtn").disabled = false;
    }
  }

  $("checkBtn").addEventListener("click", () => check());
  $("plateInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } });

  // ---------- 번호판 인식 (Tesseract.js OCR) ----------
  // 이미지를 키우고 흑백·대비를 높여 글자를 읽기 쉽게 만든다
  function toOcrCanvas(src, sw, sh, crop) {
    const c0 = crop || { x: 0, y: 0, w: sw, h: sh };
    const scale = Math.min(3, Math.max(1, 1400 / c0.w));
    const c = document.createElement("canvas");
    c.width = Math.round(c0.w * scale);
    c.height = Math.round(c0.h * scale);
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
  const getWorker = () => (workerP ||= Tesseract.createWorker("kor", 1));

  // --- 실시간 카메라 인식 ---
  const video = $("video");
  let stream = null, timer = null, busy = false;
  let recent = [];              // 최근 인식 결과 (흔들림 방지용)
  let lastShown = "", lastShownAt = 0;

  function setStatus(t) { $("camStatus").hidden = false; $("camStatus").textContent = t; }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showResult("bad", `<div class="verdict"><span class="dot"></span>이 브라우저는 카메라를 쓸 수 없어요</div><div class="sub">https 주소(GitHub Pages)에서 열었는지 확인하거나 [사진으로 인식]을 쓰세요.</div>`);
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
    // CSS가 예전 것으로 남아 있어도 안내 화면이 영상을 덮지 않도록 직접 숨긴다
    $("camIdle").hidden = true;
    $("camIdle").style.display = "none";
    try { await video.play(); } catch (err) { console.error(err); }
    // 영상이 실제로 들어오는지 확인
    setTimeout(() => {
      if (stream && (!video.videoWidth || video.paused)) {
        setStatus("영상이 표시되지 않으면 화면을 한 번 탭하세요");
        $("camBox").addEventListener("click", () => video.play().catch(() => {}), { once: true });
      }
    }, 1500);
    $("stopCam").hidden = false;
    setStatus("인식 준비 중…(처음 한 번은 몇 초 걸려요)");
    await getWorker();
    setStatus("번호판을 네모 안에 맞춰 주세요");
    timer = setInterval(scanFrame, 700);
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
  }

  async function scanFrame() {
    if (busy || !stream || video.readyState < 2 || document.hidden) return;
    busy = true;
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      // 화면에 보이는 가이드 네모(가로 80%, 세로 30%, 가운데)와 정확히 같은 영역만 읽는다.
      // 영상은 박스를 꽉 채우도록(cover) 잘려 보이므로, 화면 좌표를 영상 좌표로 바꿔 계산한다.
      const box = $("camBox");
      const bw = box.clientWidth, bh = box.clientHeight;
      const scale = Math.max(bw / vw, bh / vh);
      const ox = (vw * scale - bw) / 2, oy = (vh * scale - bh) / 2;
      const crop = {
        x: (bw * 0.1 + ox) / scale,
        y: (bh * 0.35 + oy) / scale,
        w: (bw * 0.8) / scale,
        h: (bh * 0.3) / scale,
      };
      const canvas = toOcrCanvas(video, vw, vh, crop);
      const w = await getWorker();
      const { data } = await w.recognize(canvas);
      const plate = extractPlate(data.text);
      recent.push(plate);
      if (recent.length > 3) recent.shift();
      // 최근 3번 중 2번 이상 같은 번호로 읽혀야 확정
      const hits = plate ? recent.filter((x) => x === plate).length : 0;
      if (plate && hits >= 2) {
        $("camBox").classList.add("found");
        setStatus(`인식: ${pretty(plate)}`);
        const now = Date.now();
        if (plate !== lastShown || now - lastShownAt > 15000) {
          lastShown = plate; lastShownAt = now;
          $("plateInput").value = pretty(plate);
          check();
          if (navigator.vibrate) navigator.vibrate(80);
        }
      } else if (!plate) {
        $("camBox").classList.remove("found");
        setStatus("번호판을 네모 안에 맞춰 주세요");
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

  // --- 사진 파일로 인식 (카메라를 쓸 수 없을 때) ---
  $("camInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("camLabel").textContent = "읽는 중…";
    showResult("info", `<div class="verdict"><span class="dot"></span>번호판을 읽고 있어요</div><div class="sub">처음 한 번은 인식 데이터를 내려받느라 조금 더 걸립니다.</div>`);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      const canvas = toOcrCanvas(img, img.width, img.height);
      URL.revokeObjectURL(img.src);
      const { data } = await (await getWorker()).recognize(canvas);
      const plate = extractPlate(data.text);
      if (plate) {
        $("plateInput").value = pretty(plate);
        await check();
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
  let view = "up";
  let rows = [];
  const CHIP = { now: ["now", "진행 중"], before: ["before", "대기"], after: ["after", "종료"], other: ["after", "시간대 밖"] };

  async function loadLedger() {
    if (!sb) { $("ledger").innerHTML = `<p class="empty">DB를 연결하면 예약 현황이 보입니다.</p>`; return; }
    let q = sb.from(TABLE).select("*").order("reserve_date").order("reserve_time").limit(1000);
    if (view === "up") q = q.gte("reserve_date", todayStr());
    const { data, error } = await q;
    if (error) { console.error(error); $("ledger").innerHTML = `<p class="empty">예약 현황을 불러오지 못했어요. config.js 설정과 supabase.sql 실행 여부를 확인하세요.</p>`; return; }
    rows = data;
    renderLedger();
  }

  function renderLedger() {
    const box = $("ledger");
    if (!sb) return;
    const today = todayStr();
    const f = norm($("filter").value);
    const list = f ? rows.filter((r) => r.plate_key.includes(f)) : rows;
    if (!list.length) {
      box.innerHTML = `<p class="empty">${rows.length ? "조건에 맞는 예약이 없어요." : "아직 등록된 예약이 없어요. DB에 예약이 들어오면 여기에 시간대별로 표시됩니다."}</p>`;
      return;
    }
    const byDay = new Map();
    list.forEach((r) => { if (!byDay.has(r.reserve_date)) byDay.set(r.reserve_date, []); byDay.get(r.reserve_date).push(r); });
    let html = "";
    for (const [d, rs] of byDay) {
      html += `<div class="day"><div class="day-label">${fmtDate(d)}${d === today ? '<span class="tag">오늘</span>' : ""}<span>· ${rs.length}대</span></div>`;
      for (const r of rs) {
        let chip = "<span></span>";
        if (d === today) { const [cls, txt] = CHIP[slotState(r.reserve_time).state]; chip = `<span class="chip ${cls}">${txt}</span>`; }
        html += `<div class="row"><span class="t">${esc(slotLabel(r.reserve_time))}</span><span><span class="mini-plate">${esc(pretty(r.plate_key))}</span></span>${chip}</div>`;
      }
      html += `</div>`;
    }
    box.innerHTML = html;
  }

  $("vUp").addEventListener("click", () => { view = "up"; $("vUp").setAttribute("aria-pressed", "true"); $("vAll").setAttribute("aria-pressed", "false"); loadLedger(); });
  $("vAll").addEventListener("click", () => { view = "all"; $("vAll").setAttribute("aria-pressed", "true"); $("vUp").setAttribute("aria-pressed", "false"); loadLedger(); });
  $("filter").addEventListener("input", renderLedger);

  // 다른 곳에서 DB에 예약이 추가돼도 1분마다 새로 불러온다
  loadLedger();
  setInterval(loadLedger, 60000);
})();
