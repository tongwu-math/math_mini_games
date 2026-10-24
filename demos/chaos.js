/* Chaos Game — a random rule that draws an orderly fractal. */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const COLORS = [[255, 138, 61], [76, 201, 240], [255, 93, 158], [91, 227, 125], [255, 214, 10], [180, 120, 255]];
  const CSS_COLORS = COLORS.map((c) => "rgb(" + c.join(",") + ")");
  const FERN_COLORS = [[160, 120, 70], [90, 220, 110], [60, 190, 95], [130, 240, 150]];
  const MAX_V = 6;
  const HIT = 36; // px radius for grabbing a vertex
  const CAP = 4e6; // auto-pause after this many dots
  const INTRO_STEPS = 20;

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
  const dctx = dotsCv.getContext("2d");

  // ---------- canvases ----------
  function allocate() {
    const r = dotsCv.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cx = W / 2;
    cy = H / 2;
    S = Math.min(W, H) / 2;
    // keep vertices on screen after a rotate / resize
    const lx = (W / 2 - 24) / S, ly = (H / 2 - 24) / S;
    verts.forEach((v) => {
      v.x = MP.clamp(v.x, -lx, lx);
      v.y = MP.clamp(v.y, -ly, ly);
    });
    if (!img || img.width !== dotsCv.width || img.height !== dotsCv.height) {
      img = dctx.createImageData(dotsCv.width, dotsCv.height);
      data = img.data;
      DW = img.width;
      DH = img.height;
      count = 0;
      warm = 30;
      intro = null;
      minX = DW; minY = DH; maxX = -1; maxY = -1;
    }
    const ddpr = DW / W;
    sx = S * ddpr;
    ox = cx * ddpr;
    oy = cy * ddpr;
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
      for (let k = 0; k < n; k++) {
        const r = Math.random();
        let nx, ny, c;
        if (r < 0.01) { nx = 0; ny = 0.16 * y; c = 0; }
        else if (r < 0.86) { nx = 0.85 * x + 0.04 * y; ny = -0.04 * x + 0.85 * y + 1.6; c = 1; }
        else if (r < 0.93) { nx = 0.2 * x - 0.26 * y; ny = 0.23 * x + 0.22 * y + 1.6; c = 2; }
        else { nx = -0.15 * x + 0.28 * y; ny = 0.26 * x + 0.24 * y + 0.44; c = 3; }
        x = nx; y = ny;
        if (warm > 0) { warm--; continue; }
        // fern lives in x in [-2.2, 2.7], y in [0, 10]; map into the screen
        plot((x - 0.24) * 0.18, (5 - y) * 0.18, FERN_COLORS[c]);
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
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    verts.forEach((v) => {
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    });
    px = MP.lerp(x0, x1, 0.15 + Math.random() * 0.7);
    py = MP.lerp(y0, y1, 0.15 + Math.random() * 0.7);
    lastV = -1;
    intro = { i: 0, cur: null, dots: [{ x: px, y: py }] };
    introFade = null;
  }

  function stopIntro(now) {
    if (!intro) return;
    introFade = { dots: intro.dots, t0: now || performance.now() };
    intro = null;
    warm = 0;
  }

  function stepIntro(now) {
    if (!intro.cur) {
      const j = pickVertex();
      intro.cur = {
        v: j,
        p: { x: px, y: py },
        q: { x: px + (verts[j].x - px) * ratio, y: py + (verts[j].y - py) * ratio },
        t0: now,
        dur: Math.max(90, 650 * Math.pow(0.83, intro.i)),
      };
    }
    const c = intro.cur;
    if (now - c.t0 >= c.dur) {
      px = c.q.x;
      py = c.q.y;
      plot(px, py, COLORS[c.v]);
      flush();
      intro.dots.push(c.q);
      intro.cur = null;
      if (++intro.i >= INTRO_STEPS) stopIntro(now);
    }
  }

  // ---------- UI layer ----------
  const sxp = (x) => cx + x * S;
  const syp = (y) => cy + y * S;

  function drawUI(now) {
    const ctx = uctx;
    ctx.clearRect(0, 0, ui.w, ui.h);
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
    if (mode === "fern") return !playing && count === 0 ? "Press ▶ Play to grow a fern" : "";
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
    if (needClear) doClear();
    if (playing) {
      if (intro) stepIntro(now);
      else runDots(perFrame);
      if (count >= CAP) {
        setPlaying(false);
        MP.toast("Paused at 4 million dots ✨");
      }
    }
    drawUI(now);
    updateText();
    requestAnimationFrame(frame);
  }

  // ---------- controls ----------
  function setPlaying(on) {
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
    if (needClear) doClear();
    if (count === 0) {
      if (mode === "vertex") startIntro();
      else { px = 0; py = 0; warm = 20; }
    }
    setPlaying(true);
  }

  playBtn.addEventListener("click", () => (playing ? setPlaying(false) : play()));

  $("clearDots").addEventListener("click", () => {
    stopIntro();
    introFade = null;
    needClear = true;
  });

  $("clearPts").addEventListener("click", () => {
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
  }

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
    verts[drag.idx] = toNorm(MP.pos(e, uiCv));
    changed();
  });
  const endDrag = (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  uiCv.addEventListener("pointerup", endDrag);
  uiCv.addEventListener("pointercancel", endDrag);

  setMode("vertex");
  requestAnimationFrame(frame);
})();
