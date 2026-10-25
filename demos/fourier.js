/* Fourier Circles — draw a closed loop, rebuild it from spinning circles (complex DFT). */

// ---------- pure math (no DOM; also loadable from node for testing) ----------
(function (root) {
  "use strict";
  const TAU = Math.PI * 2;

  // Close the polyline pts and resample it to n points evenly spaced by arc length.
  function resample(pts, n) {
    const P = pts.slice();
    P.push(pts[0]);
    const cum = [0];
    for (let i = 1; i < P.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
    }
    const L = cum[cum.length - 1];
    const out = [];
    let seg = 1;
    for (let j = 0; j < n; j++) {
      const s = (j * L) / n;
      while (seg < P.length - 1 && cum[seg] < s) seg++;
      const a = P[seg - 1];
      const b = P[seg];
      const len = cum[seg] - cum[seg - 1];
      const u = len > 0 ? (s - cum[seg - 1]) / len : 0;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
    return out;
  }

  // Complex DFT of points z_j = x_j + i y_j:  c_k = (1/N) sum_j z_j e^{-2 pi i k j / N}.
  // Frequencies above N/2 are mapped to negative ones (k - N), which gives the same
  // values at the sample times but much nicer (smaller, smoother) epicycles in between.
  // Returned terms are sorted by amplitude, biggest first.
  function dft(pts) {
    const n = pts.length;
    const out = [];
    for (let k = 0; k < n; k++) {
      let re = 0;
      let im = 0;
      for (let j = 0; j < n; j++) {
        const a = (-TAU * k * j) / n;
        const c = Math.cos(a);
        const s = Math.sin(a);
        re += pts[j].x * c - pts[j].y * s;
        im += pts[j].x * s + pts[j].y * c;
      }
      re /= n;
      im /= n;
      out.push({ f: k <= n / 2 ? k : k - n, re, im, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
    }
    out.sort((a, b) => b.amp - a.amp);
    return out;
  }

  // z(t) = sum over the first `count` terms of c_k e^{2 pi i f t},  t in [0, 1).
  function evalAt(terms, count, t) {
    let x = 0;
    let y = 0;
    const m = Math.min(count, terms.length);
    for (let k = 0; k < m; k++) {
      const T = terms[k];
      const a = TAU * T.f * t + T.phase;
      x += T.amp * Math.cos(a);
      y += T.amp * Math.sin(a);
    }
    return { x, y };
  }

  root.FourierMath = { resample, dft, evalAt };
})(typeof window !== "undefined" ? window : globalThis);

// ---------- the demo ----------
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  const FM = window.FourierMath;
  const N = 256; // samples = number of circles
  const M = 512; // samples of the traced path
  const TAU = Math.PI * 2;

  const canvas = document.getElementById("cv");
  const hint = document.getElementById("hint");
  const tip = document.getElementById("tip");
  const stat = document.getElementById("stat");
  const countEl = document.getElementById("count");
  const countWord = document.getElementById("countWord");

  // state (declared before setupCanvas so callbacks never hit uninitialised vars)
  let cx = 0, cy = 0, S = 1;
  let R = 1; // render scale: S, shrunk if the shape (e.g. drawn before a rotation) wouldn't fit
  let ext = { x: 0, y: 0 }; // shape's max |x|, |y| in normalised units
  let raw = null; // in-progress finger stroke (CSS px)
  let drawId = null;
  let shape = null; // N resampled points, normalised (relative to centre, units of S)
  let terms = null;
  let path = null; // Float32Array, M samples of the current approximation
  let count = N;
  let speed = 4;
  let elapsed = 0; // in loops
  let sliderTouched = false;
  let last = performance.now();
  const jx = new Float32Array(N + 1);
  const jy = new Float32Array(N + 1);

  function geom(w, h) {
    cx = w / 2;
    cy = h / 2;
    S = Math.min(w, h) / 2;
    fitShape();
  }
  // A shape drawn on this screen already fits (R = S); after a resize/rotation shrink it to stay visible.
  function fitShape() {
    R = S;
    if (ext.x * R > cx) R = cx / ext.x;
    if (ext.y * R > cy) R = cy / ext.y;
  }
  const view = MP.setupCanvas(canvas, geom);
  geom(view.w, view.h);
  const ctx = view.ctx;

  // ---------- sliders ----------
  const sliderToCount = (v) => MP.clamp(Math.round(Math.pow(N, v / 100)), 1, N);
  MP.slider(
    "circles",
    (v) => {
      count = sliderToCount(v);
      countEl.textContent = count;
      countWord.textContent = count === 1 ? "circle" : "circles";
      if (terms) {
        computePath();
        if (v < 100 && !sliderTouched) {
          sliderTouched = true;
          tip.hidden = true;
        }
      }
    },
    sliderToCount
  );
  MP.slider("speed", (v) => (speed = v));

  function computePath() {
    path = new Float32Array(M * 2);
    for (let i = 0; i < M; i++) {
      const p = FM.evalAt(terms, count, i / M);
      path[2 * i] = p.x;
      path[2 * i + 1] = p.y;
    }
  }

  function setShape(pts) {
    shape = FM.resample(pts, N);
    terms = FM.dft(shape);
    ext = { x: 0, y: 0 };
    shape.forEach((p) => {
      ext.x = Math.max(ext.x, Math.abs(p.x));
      ext.y = Math.max(ext.y, Math.abs(p.y));
    });
    fitShape();
    elapsed = 0;
    computePath();
    hint.hidden = true;
    stat.hidden = false;
    tip.hidden = sliderTouched;
  }

  function clearShape() {
    shape = terms = path = null;
    hint.hidden = false;
    stat.hidden = true;
    tip.hidden = true;
  }

  // ---------- presets (generated mathematically, normalised to fit) ----------
  function fit(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const k = 1.6 / Math.max(x1 - x0, y1 - y0); // half-extent 0.8
    return pts.map((p) => ({ x: (p.x - mx) * k, y: (p.y - my) * k }));
  }

  function bez(out, p0, p1, p2, p3, steps) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push({ x: a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], y: a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1] });
    }
  }

  const PRESETS = {
    heart() {
      const p = [];
      for (let i = 0; i < 400; i++) {
        const t = (TAU * i) / 400;
        const s = Math.sin(t);
        p.push({
          x: 16 * s * s * s,
          y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
        });
      }
      return p;
    },
    star() {
      const p = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.4 : 1;
        p.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      }
      return p;
    },
    pi() {
      return [
        [-0.9, -0.65], [0.9, -0.65], [0.9, -0.4], [0.4, -0.4], [0.4, 0.45], [0.48, 0.55], [0.62, 0.52],
        [0.66, 0.62], [0.55, 0.72], [0.35, 0.72], [0.2, 0.62], [0.15, 0.45], [0.15, -0.4], [-0.25, -0.4],
        [-0.3, 0.3], [-0.45, 0.6], [-0.7, 0.7], [-0.75, 0.5], [-0.6, 0.35], [-0.5, -0.4], [-0.9, -0.4],
      ].map((q) => ({ x: q[0], y: q[1] }));
    },
    note() {
      // eighth note: stem + flag + tilted oval head, traced as one outline
      const p = [{ x: -0.04, y: 0.3 }, { x: -0.04, y: -0.8 }, { x: 0.04, y: -0.8 }];
      bez(p, [0.04, -0.8], [0.1, -0.55], [0.45, -0.45], [0.32, -0.02], 24);
      bez(p, [0.32, -0.02], [0.36, -0.3], [0.15, -0.4], [0.04, -0.5], 24);
      p.push({ x: 0.04, y: 0.384 });
      const hx = -0.22, hy = 0.48, rx = 0.28, ry = 0.19, cr = Math.cos(-0.35), sr = Math.sin(-0.35);
      for (let i = 0; i <= 60; i++) {
        const th = ((TAU - 0.6) * i) / 60;
        const c = Math.cos(th), s = Math.sin(th);
        p.push({ x: hx + rx * c * cr - ry * s * sr, y: hy + rx * c * sr + ry * s * cr });
      }
      return p;
    },
  };

  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => setShape(fit(PRESETS[b.dataset.preset]())))
  );
  document.getElementById("clear").addEventListener("click", clearShape);

  // ---------- finger drawing ----------
  function addPt(p) {
    const q = raw[raw.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) >= 2) raw.push(p);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (drawId !== null) return;
    e.preventDefault();
    drawId = e.pointerId;
    try { canvas.setPointerCapture(drawId); } catch (_) { /* ignore */ }
    raw = [MP.pos(e, canvas)];
    hint.hidden = true;
    tip.hidden = true;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== drawId || !raw) return;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    (list && list.length ? list : [e]).forEach((ev) => addPt(MP.pos(ev, canvas)));
  });

  function endDraw(e, cancelled) {
    if (e.pointerId !== drawId) return;
    drawId = null;
    const pts = raw;
    raw = null;
    let len = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p, i) => {
      if (i) len += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    if (cancelled || pts.length < 12 || len < 80 || Math.max(x1 - x0, y1 - y0) < 40) {
      if (!cancelled) MP.toast("Too small! Draw a bigger loop ✏️");
      if (!shape) hint.hidden = false;
      else tip.hidden = sliderTouched;
      return;
    }
    setShape(pts.map((p) => ({ x: (p.x - cx) / S, y: (p.y - cy) / S })));
    MP.toast("Rebuilt from " + N + " spinning circles!");
  }
  canvas.addEventListener("pointerup", (e) => endDraw(e, false));
  canvas.addEventListener("pointercancel", (e) => endDraw(e, true));
  canvas.addEventListener("lostpointercapture", (e) => endDraw(e, true)); // no-op after a normal pointerup

  // ---------- rendering ----------
  const X = (x) => cx + x * R;
  const Y = (y) => cy + y * R;

  function drawAxes(w, h) {
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();
  }

  function drawRaw() {
    if (raw.length < 2) return;
    ctx.lineCap = ctx.lineJoin = "round";
    // dashed hint of how the loop will close
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = "rgba(255,138,61,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(raw[raw.length - 1].x, raw[raw.length - 1].y);
    ctx.lineTo(raw[0].x, raw[0].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ff8a3d";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(raw[0].x, raw[0].y);
    for (let i = 1; i < raw.length; i++) ctx.lineTo(raw[i].x, raw[i].y);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(raw[0].x, raw[0].y, 5, 0, TAU);
    ctx.fill();
  }

  function drawShape() {
    const t = elapsed % 1;
    ctx.lineCap = ctx.lineJoin = "round";

    // the original drawing, faint
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = "rgba(165,171,214,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    shape.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // epicycle chain positions
    const ang = TAU * t;
    jx[0] = cx;
    jy[0] = cy;
    for (let k = 0; k < count; k++) {
      const T = terms[k];
      const a = T.f * ang + T.phase;
      jx[k + 1] = jx[k] + T.amp * R * Math.cos(a);
      jy[k + 1] = jy[k] + T.amp * R * Math.sin(a);
    }
    const tipX = jx[count], tipY = jy[count];

    // traced path: a full loop behind the tip, fading with age
    const idx = Math.floor(t * M);
    const span = elapsed >= 1 ? M - 1 : idx;
    const CH = 16;
    ctx.lineCap = "butt";
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? 3 : 9;
      for (let back = 0; back < span; back += CH) {
        const n = Math.min(CH, span - back);
        const alpha = 1 - 0.75 * ((back + n / 2) / M);
        ctx.strokeStyle = pass ? "rgba(255,190,110," + alpha.toFixed(3) + ")" : "rgba(255,93,158," + (alpha * 0.22).toFixed(3) + ")";
        ctx.beginPath();
        for (let s = 0; s <= n; s++) {
          const i = (((idx - back - s) % M) + M) % M;
          const px = X(path[2 * i]), py = Y(path[2 * i + 1]);
          if (s) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = pass ? "rgb(255,190,110)" : "rgba(255,93,158,0.22)";
      ctx.beginPath();
      ctx.moveTo(X(path[2 * idx]), Y(path[2 * idx + 1]));
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.lineCap = "round";

    // faint circle outlines
    ctx.strokeStyle = "rgba(76,201,240,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const r = terms[k].amp * R;
      if (terms[k].f === 0 || r < 0.8) continue;
      ctx.moveTo(jx[k] + r, jy[k]);
      ctx.arc(jx[k], jy[k], r, 0, TAU);
    }
    ctx.stroke();

    // radius arms
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(jx[0], jy[0]);
    for (let k = 1; k <= count; k++) ctx.lineTo(jx[k], jy[k]);
    ctx.stroke();

    // centre pin + pen tip
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff8a3d";
    ctx.beginPath();
    ctx.arc(tipX, tipY, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3.5, 0, TAU);
    ctx.fill();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = view.w, h = view.h;
    ctx.clearRect(0, 0, w, h);
    drawAxes(w, h);
    if (raw) drawRaw();
    else if (shape) {
      elapsed += dt * speed * 0.04;
      drawShape();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
