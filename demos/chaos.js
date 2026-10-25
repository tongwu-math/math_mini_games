/* Chaos Game — a random rule that draws an orderly fractal. */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const COLORS = [[255, 138, 61], [76, 201, 240], [255, 93, 158], [91, 227, 125], [255, 214, 10], [180, 120, 255]];
  const CSS_COLORS = COLORS.map((c) => "rgb(" + c.join(",") + ")");
  // Barnsley fern: (x, y) → (a·x + b·y + e, c·x + d·y + f), picked with probability p.
  const FERN = [
    { a: 0, b: 0, c: 0, d: 0.16, e: 0, f: 0, p: 0.01, name: "Stem", col: [255, 176, 70] },
    { a: 0.85, b: 0.04, c: -0.04, d: 0.85, e: 0, f: 1.6, p: 0.85, name: "Main leaf", col: [91, 227, 125] },
    { a: 0.2, b: -0.26, c: 0.23, d: 0.22, e: 0, f: 1.6, p: 0.07, name: "Left leaflet", col: [76, 201, 240] },
    { a: -0.15, b: 0.28, c: 0.26, d: 0.24, e: 0, f: 0.44, p: 0.07, name: "Right leaflet", col: [255, 93, 158] },
  ];
  const FERN_CSS = FERN.map((m) => "rgb(" + m.col.join(",") + ")");
  const FERN_NATURAL = [[160, 120, 70], [90, 220, 110], [60, 190, 95], [130, 240, 150]];
  const FERN_BOX = [[-2.2, 0], [2.7, 0], [2.7, 10], [-2.2, 10]]; // the whole fern fits in here
  const FERN_INTRO_STEPS = 24;
  function fernPick() {
    const r = Math.random();
    return r < 0.01 ? 0 : r < 0.86 ? 1 : r < 0.93 ? 2 : 3;
  }
  // fern lives in x in [-2.2, 2.7], y in [0, 10]; map into the normalised screen units
  const fernNX = (x) => (x - 0.24) * 0.18;
  const fernNY = (y) => (5 - y) * 0.18;
  const MAX_V = 6;
  const HIT = 36; // px radius for grabbing a vertex
  const CAP = 4e6; // auto-pause after this many dots
  const INTRO_STEPS = 20;
  const HINT_ROOM = 56; // px kept clear at the bottom so the hint never covers a preset corner

  const $ = (id) => document.getElementById(id);
  const dotsCv = $("dots");
  const uiCv = $("ui");
  const hintEl = $("hint");
  const countEl = $("count");
  const playBtn = $("play");
  const noRepBtn = $("noRepeat");
  const ratioIn = $("ratio");

  // ---------- state ----------
  let verts = []; // normalised {x, y} relative to centre, units of S
  let mode = "vertex"; // "vertex" | "fern"
  let ratio = 0.5;
  let noRepeat = false;
  let perFrame = 5000;
  let playing = false;
  let count = 0;
  let px = 0, py = 0, lastV = -1, warm = 0;
  let needClear = false;
  let intro = null;
  let introFade = null;
  let drag = null;
  let cx = 0, cy = 0, S = 1, W = 0, H = 0;
  let img = null, data = null, DW = 0, DH = 0, sx = 1, ox = 0, oy = 0;
  let minX = 0, minY = 0, maxX = -1, maxY = -1;
  let shownCount = -1, shownHint = null;
  let pausedAt = 0;
  let fernColored = true; // color each dot by the rule that placed it
  let showCopies = true; // outline where each rule sends the whole fern
  const dctx = dotsCv.getContext("2d");
  const legendEl = $("legend");
  const copiesBtn = $("fernCopies");
  const colorsBtn = $("fernColors");

  // ---------- canvases ----------
  function allocate() {
    const r = dotsCv.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    const hy = Math.max(H / 2, H - HINT_ROOM); // usable height above the hint
    cx = W / 2;
    cy = hy / 2 + 4;
    S = Math.min(W, hy) / 2;
    // keep vertices on screen after a rotate / resize
    let moved = false;
    const lx = (W / 2 - 24) / S, ly0 = (24 - cy) / S, ly1 = (H - 24 - cy) / S;
    verts.forEach((v) => {
      const x = MP.clamp(v.x, -lx, lx), y = MP.clamp(v.y, ly0, ly1);
      if (x !== v.x || y !== v.y) moved = true;
      v.x = x;
      v.y = y;
    });
    const old = img, osx = sx, oox = ox, ooy = oy;
    if (!img || img.width !== dotsCv.width || img.height !== dotsCv.height) {
      img = dctx.createImageData(dotsCv.width, dotsCv.height);
      data = img.data;
      DW = img.width;
      DH = img.height;
      minX = DW; minY = DH; maxX = -1; maxY = -1;
    }
    const ddpr = DW / W;
    sx = S * ddpr;
    ox = cx * ddpr;
    oy = cy * ddpr;
    if (img === old) return;
    // Resizing the canvas wiped it. Redraw the old dots at the new scale (e.g. rotating
    // the iPad while paused); start over only if a corner had to move to stay on screen.
    if (old && count > 0 && !moved) {
      const tmp = document.createElement("canvas");
      tmp.width = old.width;
      tmp.height = old.height;
      tmp.getContext("2d").putImageData(old, 0, 0);
      const k = sx / osx;
      dctx.save();
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      dctx.drawImage(tmp, ox - oox * k, oy - ooy * k, old.width * k, old.height * k);
      dctx.restore();
      img = dctx.getImageData(0, 0, DW, DH);
      data = img.data;
    } else {
      if (count > 0 || moved) {
        count = 0;
        warm = 30;
      }
      if (moved) intro = introFade = null;
    }
  }
  // dot layer capped at 1.5x so full-buffer updates stay fast on iPad
  MP.setupCanvas(dotsCv, allocate, { maxDpr: 1.5 });
  allocate();
  const ui = MP.setupCanvas(uiCv);
  const uctx = ui.ctx;

  // ---------- dot plotting ----------
  function plot(x, y, c) {
    const fx = ox + x * sx, fy = oy + y * sx;
    if (fx < 0 || fy < 0 || fx >= DW || fy >= DH) return;
    const X = fx | 0, Y = fy | 0;
    const i = (Y * DW + X) << 2;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    const a = data[i + 3];
    data[i + 3] = a + (((255 - a) * 9) >> 4); // brighter with every hit
    if (X < minX) minX = X;
    if (X > maxX) maxX = X;
    if (Y < minY) minY = Y;
    if (Y > maxY) maxY = Y;
    count++;
  }

  function flush() {
    if (maxX >= 0) dctx.putImageData(img, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
    minX = DW; minY = DH; maxX = -1; maxY = -1;
  }

  function doClear() {
    data.fill(0);
    dctx.save();
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.clearRect(0, 0, dotsCv.width, dotsCv.height);
    dctx.restore();
    count = 0;
    warm = 30;
    needClear = false;
    minX = DW; minY = DH; maxX = -1; maxY = -1;
  }

  function pickVertex() {
    const n = verts.length;
    let j = (Math.random() * n) | 0;
    if (noRepeat && n > 1) while (j === lastV) j = (Math.random() * n) | 0;
    lastV = j;
    return j;
  }

  function runDots(n) {
    if (mode === "fern") {
      let x = px, y = py;
      const cols = fernColored ? FERN.map((m) => m.col) : FERN_NATURAL;
      for (let k = 0; k < n; k++) {
        const c = fernPick(), m = FERN[c];
        const nx = m.a * x + m.b * y + m.e;
        y = m.c * x + m.d * y + m.f;
        x = nx;
        if (warm > 0) { warm--; continue; }
        plot(fernNX(x), fernNY(y), cols[c]);
      }
      px = x; py = y;
    } else {
      const V = verts, r = ratio;
      for (let k = 0; k < n; k++) {
        const j = pickVertex();
        px += (V[j].x - px) * r;
        py += (V[j].y - py) * r;
        if (warm > 0) { warm--; continue; }
        plot(px, py, COLORS[j]);
      }
    }
    flush();
  }

  // ---------- slow-motion intro: the first 20 jumps, one at a time ----------
  function startIntro() {
    if (mode === "fern") {
      // (0, 0) is already on the fern (the stem rule keeps it there), so no warm-up is needed
      px = 0; py = 0; warm = 0;
      intro = { i: 0, cur: null, last: -1, steps: FERN_INTRO_STEPS, dots: [{ x: fernNX(0), y: fernNY(0) }] };
      introFade = null;
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    verts.forEach((v) => {
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    });
    px = MP.lerp(x0, x1, 0.15 + Math.random() * 0.7);
    py = MP.lerp(y0, y1, 0.15 + Math.random() * 0.7);
    lastV = -1;
    intro = { i: 0, cur: null, last: -1, steps: INTRO_STEPS, dots: [{ x: px, y: py }] };
    introFade = null;
  }

  function stopIntro(now) {
    if (!intro) return;
    introFade = { dots: intro.dots, t0: now || performance.now() };
    intro = null;
    warm = 0;
  }

  function stepIntro(now) {
    const fern = mode === "fern";
    if (!intro.cur) {
      if (fern) {
        const k = fernPick(), m = FERN[k];
        const qx = m.a * px + m.b * py + m.e, qy = m.c * px + m.d * py + m.f;
        intro.cur = {
          v: k,
          p: { x: fernNX(px), y: fernNY(py) },
          q: { x: fernNX(qx), y: fernNY(qy) },
          qm: { x: qx, y: qy },
          t0: now,
          dur: Math.max(110, 1100 * Math.pow(0.86, intro.i)), // slower: there's more to read
        };
      } else {
        const j = pickVertex();
        intro.cur = {
          v: j,
          p: { x: px, y: py },
          q: { x: px + (verts[j].x - px) * ratio, y: py + (verts[j].y - py) * ratio },
          t0: now,
          dur: Math.max(90, 650 * Math.pow(0.83, intro.i)),
        };
      }
      intro.last = intro.cur.v;
    }
    const c = intro.cur;
    if (now - c.t0 >= c.dur) {
      if (fern) {
        px = c.qm.x;
        py = c.qm.y;
        plot(c.q.x, c.q.y, fernColored ? FERN[c.v].col : FERN_NATURAL[c.v]);
      } else {
        px = c.q.x;
        py = c.q.y;
        plot(px, py, COLORS[c.v]);
      }
      flush();
      intro.dots.push(c.q);
      intro.cur = null;
      if (++intro.i >= intro.steps) stopIntro(now);
    }
  }

  // ---------- UI layer ----------
  const sxp = (x) => cx + x * S;
  const syp = (y) => cy + y * S;

  // Fern mode: outline the whole fern, the 4 smaller copies the rules map it onto,
  // and (during the slow intro) each jump in its rule's color.
  function drawFernUI(now) {
    const ctx = uctx;
    ctx.lineCap = ctx.lineJoin = "round";
    const cur = intro && intro.cur ? intro.cur.v : -1;
    const P = (x, y) => [sxp(fernNX(x)), syp(fernNY(y))];
    if (showCopies) {
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      FERN_BOX.forEach(([x, y], i) => (i ? ctx.lineTo(...P(x, y)) : ctx.moveTo(...P(x, y))));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      FERN.forEach((m, k) => {
        const pts = FERN_BOX.map(([x, y]) => P(m.a * x + m.b * y + m.e, m.c * x + m.d * y + m.f));
        const on = k === cur;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(...q) : ctx.moveTo(...q)));
        ctx.closePath();
        ctx.globalAlpha = on ? 0.28 : cur >= 0 ? 0.05 : 0.1;
        ctx.fillStyle = FERN_CSS[k];
        ctx.fill();
        ctx.globalAlpha = on || cur < 0 ? 1 : 0.35;
        ctx.strokeStyle = FERN_CSS[k];
        ctx.lineWidth = k === 0 ? (on ? 7 : 5) : on ? 3.5 : 2; // the stem copy is squashed flat
        ctx.stroke();
        // number tag at the copy's centre
        const mx = pts.reduce((s, q) => s + q[0], 0) / 4, my = pts.reduce((s, q) => s + q[1], 0) / 4;
        const tx = k === 0 ? mx - 16 : mx, ty = my;
        ctx.globalAlpha = on || cur < 0 ? 1 : 0.5;
        ctx.fillStyle = FERN_CSS[k];
        ctx.beginPath();
        ctx.arc(tx, ty, on ? 13 : 10, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#0f1226";
        ctx.font = "800 " + (on ? 15 : 12) + "px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(k + 1), tx, ty + 1);
        ctx.globalAlpha = 1;
      });
    }
    const dots = intro ? intro.dots : introFade ? introFade.dots : null;
    if (dots) {
      const a = intro ? 0.9 : 1 - (now - introFade.t0) / 900;
      if (a <= 0) introFade = null;
      else {
        ctx.fillStyle = "rgba(255,255,255," + (0.9 * a).toFixed(3) + ")";
        dots.forEach((d) => {
          ctx.beginPath();
          ctx.arc(sxp(d.x), syp(d.y), 3.5, 0, TAU);
          ctx.fill();
        });
      }
    }
    if (intro && intro.cur) {
      const c = intro.cur;
      const u = MP.clamp((now - c.t0) / c.dur, 0, 1);
      const a1 = MP.clamp(u / 0.3, 0, 1);
      const a2 = MP.clamp((u - 0.3) / 0.7, 0, 1);
      const e = a2 * a2 * (3 - 2 * a2);
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = "rgba(255,255,255," + (0.7 * a1).toFixed(3) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sxp(c.p.x), syp(c.p.y));
      ctx.lineTo(sxp(c.q.x), syp(c.q.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = FERN_CSS[c.v];
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = a1;
      ctx.beginPath();
      ctx.arc(sxp(c.q.x), syp(c.q.y), 8, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const mx = MP.lerp(c.p.x, c.q.x, e), my = MP.lerp(c.p.y, c.q.y, e);
      ctx.fillStyle = FERN_CSS[c.v];
      ctx.beginPath();
      ctx.arc(sxp(mx), syp(my), 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sxp(mx), syp(my), 4, 0, TAU);
      ctx.fill();
    }
  }

  function updateLegend() {
    const show = mode === "fern";
    legendEl.hidden = !show;
    if (!show) return;
    const cur = intro ? intro.last : -1;
    const key = cur + "|" + fernColored;
    if (legendEl.dataset.key === key) return;
    legendEl.dataset.key = key;
    legendEl.innerHTML = FERN.map(
      (m, k) =>
        `<div class="row${cur >= 0 && k !== cur ? " dim" : ""}"><span class="chip" style="background:${FERN_CSS[k]}">${k + 1}</span>` +
        `${m.name}<span class="pct">${Math.round(m.p * 100)}%</span></div>`
    ).join("");
  }

  function drawUI(now) {
    const ctx = uctx;
    ctx.clearRect(0, 0, ui.w, ui.h);
    if (mode === "fern") return drawFernUI(now);
    if (mode !== "vertex") return;
    ctx.lineCap = ctx.lineJoin = "round";

    if (verts.length >= 2 && count === 0 && !intro) {
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      verts.forEach((v, i) => (i ? ctx.lineTo(sxp(v.x), syp(v.y)) : ctx.moveTo(sxp(v.x), syp(v.y))));
      if (verts.length > 2) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    let highlight = -1, pulse = 0;
    if (intro) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      intro.dots.forEach((d) => {
        ctx.beginPath();
        ctx.arc(sxp(d.x), syp(d.y), 3.5, 0, TAU);
        ctx.fill();
      });
      const c = intro.cur;
      if (c) {
        const u = MP.clamp((now - c.t0) / c.dur, 0, 1);
        const a1 = MP.clamp(u / 0.35, 0, 1);
        const a2 = MP.clamp((u - 0.35) / 0.65, 0, 1);
        const e = a2 * a2 * (3 - 2 * a2);
        const V = verts[c.v];
        highlight = c.v;
        pulse = a1;
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = "rgba(255,255,255," + (0.6 * a1).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sxp(c.p.x), syp(c.p.y));
        ctx.lineTo(sxp(V.x), syp(V.y));
        ctx.stroke();
        ctx.setLineDash([]);
        // landing spot marker
        ctx.strokeStyle = CSS_COLORS[c.v];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sxp(c.q.x), syp(c.q.y), 7, 0, TAU);
        ctx.globalAlpha = a1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        const mx = MP.lerp(c.p.x, c.q.x, e), my = MP.lerp(c.p.y, c.q.y, e);
        ctx.fillStyle = CSS_COLORS[c.v];
        ctx.beginPath();
        ctx.arc(sxp(mx), syp(my), 9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sxp(mx), syp(my), 4, 0, TAU);
        ctx.fill();
      }
    } else if (introFade) {
      const a = 1 - (now - introFade.t0) / 900;
      if (a <= 0) introFade = null;
      else {
        ctx.fillStyle = "rgba(255,255,255," + (0.85 * a).toFixed(3) + ")";
        introFade.dots.forEach((d) => {
          ctx.beginPath();
          ctx.arc(sxp(d.x), syp(d.y), 3.5, 0, TAU);
          ctx.fill();
        });
      }
    }

    verts.forEach((v, i) => {
      const X = sxp(v.x), Y = syp(v.y);
      const big = (drag && drag.idx === i) || i === highlight;
      if (i === highlight) {
        ctx.strokeStyle = CSS_COLORS[i];
        ctx.lineWidth = 3;
        ctx.globalAlpha = 1 - pulse * 0.6;
        ctx.beginPath();
        ctx.arc(X, Y, 18 + pulse * 14, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = CSS_COLORS[i];
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(X, Y, big ? 19 : 15, 0, TAU);
      ctx.fill();
      ctx.stroke();
    });
  }

  // ---------- hint + stats ----------
  function ratioWords() {
    if (Math.abs(ratio - 0.5) < 0.005) return "halfway";
    return Math.round(ratio * 100) + "% of the way";
  }
  function hintText() {
    if (mode === "fern") {
      if (intro && intro.last >= 0) {
        const m = FERN[intro.last];
        return `Rule ${intro.last + 1} · ${m.name} (${Math.round(m.p * 100)}% of picks): move the dot into copy ${intro.last + 1}`;
      }
      return !playing && count === 0 ? "Press ▶ Play to grow a fern" : "";
    }
    if (verts.length < 3) {
      return verts.length ? "Tap to add more corners (need at least 3)" : "Tap anywhere to place 3 to 6 corners";
    }
    if (intro) return "Rule: pick a random corner, jump " + ratioWords() + " there, drop a dot. Repeat!";
    if (!playing && count === 0) return "Press ▶ Play  ·  drag a corner to move it";
    return "";
  }
  function updateText() {
    const t = hintText();
    if (t !== shownHint) {
      shownHint = t;
      hintEl.textContent = t;
      hintEl.hidden = !t;
    }
    if (count !== shownCount) {
      shownCount = count;
      countEl.textContent = count.toLocaleString();
    }
  }

  // ---------- main loop ----------
  function frame(now) {
    requestAnimationFrame(frame); // first, so one bad frame can't stop the loop
    if (needClear) doClear();
    if (playing) {
      if (intro) stepIntro(now);
      else runDots(perFrame);
      if (count >= CAP) {
        setPlaying(false);
        MP.toast("Paused at 4 million dots ✨");
      }
    }
    drawUI(playing || !intro ? now : pausedAt); // a paused intro freezes mid-jump
    updateText();
    updateLegend();
  }

  // ---------- controls ----------
  function setPlaying(on) {
    const now = performance.now();
    if (on && !playing && intro && intro.cur) intro.cur.t0 += now - pausedAt; // resume mid-jump
    if (!on && playing) pausedAt = now;
    playing = on;
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    playBtn.classList.toggle("primary", !on);
    playBtn.classList.toggle("blue", on);
  }

  function play() {
    if (mode === "vertex" && verts.length < 3) {
      MP.toast("Tap at least 3 corners first");
      return;
    }
    if (needClear || count >= CAP) doClear(); // at the 4M cap, Play starts a fresh picture
    if (count === 0) startIntro();
    setPlaying(true);
  }

  playBtn.addEventListener("click", () => (playing ? setPlaying(false) : play()));

  $("clearDots").addEventListener("click", () => {
    stopIntro();
    introFade = null;
    needClear = true;
  });

  $("clearPts").addEventListener("click", () => {
    drag = null; // a finger may still be holding a corner (multi-touch)
    setPlaying(false);
    intro = introFade = null;
    verts = [];
    setMode("vertex");
    needClear = true;
  });

  function setNoRepeat(on) {
    noRepeat = on;
    noRepBtn.classList.toggle("on", on);
  }
  noRepBtn.addEventListener("click", () => {
    setNoRepeat(!noRepeat);
    stopIntro();
    if (count > 0) needClear = true;
  });

  MP.slider(
    "ratio",
    (v) => {
      ratio = v;
      stopIntro();
      if (count > 0) needClear = true;
    },
    (v) => String(+v.toFixed(3))
  );

  MP.slider(
    "speed",
    (v) => (perFrame = Math.round(20 * Math.pow(1000, v / 100))),
    (v) => {
      const n = Math.round(20 * Math.pow(1000, v / 100));
      return n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
    }
  );

  function setMode(m) {
    mode = m;
    ratioIn.disabled = m === "fern";
    noRepBtn.disabled = m === "fern";
    copiesBtn.hidden = colorsBtn.hidden = m !== "fern";
    updateLegend();
  }

  copiesBtn.addEventListener("click", () => {
    showCopies = !showCopies;
    copiesBtn.classList.toggle("on", showCopies);
  });
  colorsBtn.addEventListener("click", () => {
    fernColored = !fernColored;
    colorsBtn.classList.toggle("on", fernColored);
    colorsBtn.textContent = fernColored ? "🎨 Rule colors" : "🌿 Natural";
    legendEl.dataset.key = "";
    if (count > 0) needClear = true; // redraw the dots in the new colors (keeps playing)
  });

  function setRatio(r) {
    ratioIn.value = r;
    ratioIn.dispatchEvent(new Event("input"));
  }

  function polygon(n, rot) {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = rot + (TAU * k) / n;
      pts.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    const k = 1.8 / Math.max(x1 - x0, y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return pts.map((p) => ({ x: (p.x - mx) * k, y: (p.y - my) * k }));
  }

  const PRESETS = {
    sierpinski: { n: 3, rot: -Math.PI / 2, r: 0.5, nr: false },
    square: { n: 4, rot: -Math.PI / 4, r: 0.5, nr: true },
    pentagon: { n: 5, rot: -Math.PI / 2, r: 0.618, nr: false },
    hexagon: { n: 6, rot: -Math.PI / 2, r: 0.667, nr: false },
  };

  function preset(name) {
    drag = null;
    setPlaying(false);
    intro = introFade = null;
    if (name === "fern") {
      verts = [];
      setMode("fern");
      MP.toast("4 rules, picked at random 🌿");
    } else {
      const p = PRESETS[name];
      setMode("vertex");
      verts = polygon(p.n, p.rot);
      setNoRepeat(p.nr);
      setRatio(p.r);
      if (p.nr) MP.toast("New rule: never pick the same corner twice in a row");
    }
    doClear();
    play();
  }
  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => preset(b.dataset.preset))
  );

  // ---------- placing & dragging vertices ----------
  function toNorm(p) {
    const x = MP.clamp(p.x, 16, ui.w - 16), y = MP.clamp(p.y, 16, ui.h - 16);
    return { x: (x - cx) / S, y: (y - cy) / S };
  }
  function hitVertex(p) {
    let best = -1, bd = HIT;
    verts.forEach((v, i) => {
      const d = Math.hypot(sxp(v.x) - p.x, syp(v.y) - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function changed() {
    stopIntro();
    if (count > 0 || playing) needClear = true;
  }

  uiCv.addEventListener("pointerdown", (e) => {
    if (drag) return;
    e.preventDefault();
    if (mode === "fern") {
      MP.toast("Tap “Clear points” to place your own corners");
      return;
    }
    const p = MP.pos(e, uiCv);
    let idx = hitVertex(p);
    if (idx < 0) {
      if (verts.length >= MAX_V) {
        MP.toast("6 corners max. Drag one to move it!");
        return;
      }
      verts.push(toNorm(p));
      idx = verts.length - 1;
      changed();
    }
    drag = { id: e.pointerId, idx };
    try { uiCv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  uiCv.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (mode !== "vertex" || drag.idx >= verts.length) { drag = null; return; }
    verts[drag.idx] = toNorm(MP.pos(e, uiCv));
    changed();
  });
  const endDrag = (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  uiCv.addEventListener("pointerup", endDrag);
  uiCv.addEventListener("pointercancel", endDrag);
  uiCv.addEventListener("lostpointercapture", endDrag);

  setMode("vertex");
  requestAnimationFrame(frame);
})();
