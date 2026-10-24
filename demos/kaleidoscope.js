/* Kaleidoscope — finger painting with n-fold rotational (and mirror) symmetry. */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const BG_IN = "#151a3a";
  const BG_OUT = "#05060f";
  const $ = (id) => document.getElementById(id);
  const cv = $("art");
  const gcv = $("guides");
  const hint = $("hint");
  const groupEl = $("group");
  const mirrorBtn = $("mirror");
  const guidesBtn = $("guidesBtn");

  // ---------- state ----------
  let cx = 0, cy = 0, S = 1, dpr = 1, W = 0, H = 0;
  let n = 6;
  let mirror = true;
  let brush = 8;
  let rainbow = true;
  let swatch = { h: 330, s: 100 };
  let showGuides = true;
  let hue = Math.random() * 360;
  let strokes = []; // finished strokes
  let backup = null; // strokes saved by Clear (Undo restores)
  const active = new Map(); // pointerId -> stroke being drawn
  const matCache = {};
  const ctx = cv.getContext("2d");
  const gctx = gcv.getContext("2d");

  // Stroke: { n, mirror, size (units of S), sat, rb (rainbow?), hue (current), pts: [x, y, hue, ...] (units of S, rel. centre) }

  function geom() {
    const r = cv.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cx = W / 2;
    cy = H / 2;
    S = Math.min(W, H) / 2;
    dpr = cv.width / W;
  }
  function onArtResize() {
    geom();
    redrawAll();
  }
  MP.setupCanvas(cv, onArtResize);
  MP.setupCanvas(gcv, drawGuides);
  onArtResize();

  // ---------- symmetry group elements as 2x2 matrices [a, b, c, d]: x' = a x + c y, y' = b x + d y ----------
  function mats(k, mir) {
    const key = k + (mir ? "m" : "r");
    if (matCache[key]) return matCache[key];
    const out = [];
    for (let i = 0; i < k; i++) {
      const t = (TAU * i) / k, c = Math.cos(t), s = Math.sin(t);
      out.push([c, s, -s, c]); // rotation
      if (mir) out.push([c, s, s, -c]); // reflection, then rotation
    }
    return (matCache[key] = out);
  }

  // ---------- drawing one piece of a stroke in every symmetric copy ----------
  // g = { t: "line"|"quad"|"dot", pts in S units, hue }
  function addPath(g, M) {
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      const tx = (x, y) => cx + (m[0] * x + m[2] * y) * S;
      const ty = (x, y) => cy + (m[1] * x + m[3] * y) * S;
      if (g.t === "dot") {
        const X = tx(g.x, g.y), Y = ty(g.x, g.y);
        ctx.moveTo(X + g.r, Y);
        ctx.arc(X, Y, g.r, 0, TAU);
      } else if (g.t === "line") {
        ctx.moveTo(tx(g.ax, g.ay), ty(g.ax, g.ay));
        ctx.lineTo(tx(g.bx, g.by), ty(g.bx, g.by));
      } else {
        ctx.moveTo(tx(g.ax, g.ay), ty(g.ax, g.ay));
        ctx.quadraticCurveTo(tx(g.qx, g.qy), ty(g.qx, g.qy), tx(g.bx, g.by), ty(g.bx, g.by));
      }
    }
  }

  function drawPiece(st, g) {
    const M = mats(st.n, st.mirror);
    const lw = st.size * S;
    const sat = st.sat;
    ctx.lineCap = ctx.lineJoin = "round";
    // pass 1: soft additive glow
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    if (g.t === "dot") {
      g.r = lw * 1.4;
      addPath(g, M);
      ctx.fillStyle = MP.hsl(g.h | 0, sat, sat ? 60 : 85, 0.14);
      ctx.fill();
    } else {
      addPath(g, M);
      ctx.lineWidth = lw * 2.8;
      ctx.strokeStyle = MP.hsl(g.h | 0, sat, sat ? 60 : 85, 0.14);
      ctx.stroke();
    }
    // pass 2: bright core
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    if (g.t === "dot") {
      g.r = lw / 2;
      addPath(g, M);
      ctx.fillStyle = MP.hsl(g.h | 0, sat, sat ? 64 : 96);
      ctx.fill();
    } else {
      addPath(g, M);
      ctx.lineWidth = lw;
      ctx.strokeStyle = MP.hsl(g.h | 0, sat, sat ? 64 : 96);
      ctx.stroke();
    }
  }

  // Smooth stroke = quadratic curves through midpoints. Piece k is completed when point k arrives.
  function piece(st, k) {
    const p = st.pts;
    const x1 = p[3 * k - 3], y1 = p[3 * k - 2], h1 = p[3 * k - 1];
    const x2 = p[3 * k], y2 = p[3 * k + 1];
    if (k === 1) return { t: "line", ax: x1, ay: y1, bx: (x1 + x2) / 2, by: (y1 + y2) / 2, h: h1 };
    const x0 = p[3 * k - 6], y0 = p[3 * k - 5];
    return { t: "quad", ax: (x0 + x1) / 2, ay: (y0 + y1) / 2, qx: x1, qy: y1, bx: (x1 + x2) / 2, by: (y1 + y2) / 2, h: h1 };
  }
  function tail(st) {
    const p = st.pts, k = p.length / 3 - 1;
    if (k === 0) return { t: "dot", x: p[0], y: p[1], h: p[2] };
    return { t: "line", ax: (p[3 * k - 3] + p[3 * k]) / 2, ay: (p[3 * k - 2] + p[3 * k + 1]) / 2, bx: p[3 * k], by: p[3 * k + 1], h: p[3 * k + 2] };
  }

  function renderStroke(st, finished) {
    const np = st.pts.length / 3;
    for (let k = 1; k < np; k++) drawPiece(st, piece(st, k));
    if (finished) drawPiece(st, tail(st));
  }

  function redrawAll() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    strokes.forEach((st) => renderStroke(st, true));
    active.forEach((st) => renderStroke(st, false));
  }

  // ---------- guides + group label ----------
  function drawGuides() {
    const r = gcv.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    const gd = gcv.width / Math.max(1, w);
    gctx.setTransform(gd, 0, 0, gd, 0, 0);
    gctx.clearRect(0, 0, w, h);
    if (!showGuides) return;
    const gx = w / 2, gy = h / 2, R = Math.hypot(w, h);
    const rays = mirror ? 2 * n : n;
    const step = TAU / rays;
    gctx.lineWidth = 1.5;
    gctx.setLineDash(mirror ? [] : [8, 8]);
    gctx.strokeStyle = mirror ? "rgba(76,201,240,0.22)" : "rgba(255,255,255,0.16)";
    gctx.beginPath();
    for (let i = 0; i < rays; i++) {
      gctx.moveTo(gx, gy);
      gctx.lineTo(gx + R * Math.cos(i * step), gy + R * Math.sin(i * step));
    }
    gctx.stroke();
    gctx.setLineDash([]);
    gctx.fillStyle = "rgba(255,255,255,0.35)";
    gctx.beginPath();
    gctx.arc(gx, gy, 4, 0, TAU);
    gctx.fill();
  }

  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  const sub = (k) => String(k).replace(/\d/g, (d) => SUB[d]);
  function updateGroup() {
    groupEl.innerHTML = mirror
      ? "Symmetry group <b>D" + sub(n) + "</b> · " + 2 * n + " moves"
      : "Symmetry group <b>C" + sub(n) + "</b> · " + n + " moves";
  }

  // ---------- pointer drawing (multi-touch) ----------
  function norm(p) {
    return { x: (p.x - cx) / S, y: (p.y - cy) / S };
  }

  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const q = norm(MP.pos(e, cv));
    const h = rainbow ? hue : swatch.h;
    const st = { n, mirror, size: brush / S, sat: rainbow ? 100 : swatch.s, rb: rainbow, hue: h, pts: [q.x, q.y, h] };
    if (rainbow) hue = (hue + 47) % 360; // next finger / stroke starts on a new colour
    active.set(e.pointerId, st);
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (!hint.hidden) hint.hidden = true;
  });

  function addPoint(st, p) {
    const q = norm(p);
    const k = st.pts.length / 3;
    const lx = st.pts[3 * k - 3], ly = st.pts[3 * k - 2];
    const d = Math.hypot(q.x - lx, q.y - ly) * S;
    if (d < 2) return;
    if (st.rb) st.hue = (st.hue + d * 0.45) % 360;
    st.pts.push(q.x, q.y, st.hue);
    drawPiece(st, piece(st, k));
  }

  cv.addEventListener("pointermove", (e) => {
    const st = active.get(e.pointerId);
    if (!st) return;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    (list && list.length ? list : [e]).forEach((ev) => addPoint(st, MP.pos(ev, cv)));
  });

  function endStroke(e) {
    const st = active.get(e.pointerId);
    if (!st) return;
    active.delete(e.pointerId);
    drawPiece(st, tail(st));
    strokes.push(st);
  }
  cv.addEventListener("pointerup", endStroke);
  cv.addEventListener("pointercancel", endStroke);

  // ---------- controls ----------
  MP.slider("sym", (v) => {
    n = v;
    drawGuides();
    updateGroup();
  });
  MP.slider("brush", (v) => (brush = v));

  mirrorBtn.addEventListener("click", () => {
    mirror = !mirror;
    mirrorBtn.classList.toggle("on", mirror);
    drawGuides();
    updateGroup();
  });

  guidesBtn.addEventListener("click", () => {
    showGuides = !showGuides;
    guidesBtn.classList.toggle("on", showGuides);
    drawGuides();
  });

  const swatches = document.querySelectorAll(".sw");
  swatches.forEach((b) =>
    b.addEventListener("click", () => {
      swatches.forEach((o) => o.classList.toggle("sel", o === b));
      if (b.dataset.c === "rainbow") rainbow = true;
      else {
        rainbow = false;
        swatch = { h: +b.dataset.h, s: +b.dataset.s };
      }
    })
  );

  $("undo").addEventListener("click", () => {
    if (strokes.length) strokes.pop();
    else if (backup) {
      strokes = backup;
      backup = null;
      MP.toast("Drawing restored");
    } else {
      MP.toast("Nothing to undo");
      return;
    }
    redrawAll();
  });

  $("clear").addEventListener("click", () => {
    if (!strokes.length) return;
    backup = strokes;
    strokes = [];
    redrawAll();
    MP.toast("Cleared. Undo brings it back");
  });

  $("save").addEventListener("click", () => {
    if (!strokes.length) {
      MP.toast("Draw something first!");
      return;
    }
    const out = document.createElement("canvas");
    out.width = cv.width;
    out.height = cv.height;
    const o = out.getContext("2d");
    const g = o.createRadialGradient(out.width / 2, out.height / 2, 0, out.width / 2, out.height / 2, Math.hypot(out.width, out.height) / 2 * 0.75);
    g.addColorStop(0, BG_IN);
    g.addColorStop(1, BG_OUT);
    o.fillStyle = g;
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(cv, 0, 0);
    const url = out.toDataURL("image/png");
    MP.modal({
      title: "Your kaleidoscope",
      html:
        '<img class="allow-callout snap" src="' + url + '" alt="Your kaleidoscope drawing">' +
        '<p class="save-tip">Press and hold the picture, then tap <b>Save to Photos</b>.</p>',
      buttons: [{ label: "Done", primary: true }],
    });
  });

  updateGroup();
})();
