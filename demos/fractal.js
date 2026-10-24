/* Fractal Maker — draw a generator polyline from A=(0,0) to B=(1,0); every segment is
   recursively replaced by a similar copy of it. Math coords are y-up; screen is y-down. */
(function () {
  "use strict";

  const SEG_CAP = 250000;      // max segments for a full render
  const DRAG_CAP = 40000;      // max segments while dragging (keeps it smooth)
  const MAX_PTS = 12;          // max interior corners
  const S3 = Math.sqrt(3);

  // A segment's copy can be: 0 normal, 1 mirrored, 2 reversed, 3 reversed+mirrored.
  // gen = { pts: [[x,y],...] interior corners, flips: [type per segment] }
  const PRESETS = {
    koch:   { pts: [[1 / 3, 0], [0.5, S3 / 6], [2 / 3, 0]], base: "tri" },
    levy:   { pts: [[0.5, 0.5]], base: "line" },
    dragon: { pts: [[0.5, 0.5]], flips: [0, 2], base: "line" },
    mink:   { pts: [[0.25, 0], [0.25, 0.25], [0.5, 0.25], [0.5, 0], [0.5, -0.25], [0.75, -0.25], [0.75, 0]], base: "sq" },
    cesaro: (() => {
      const phi = (47.5 * Math.PI) / 180, r = 1 / (2 + 2 * Math.cos(phi));
      return { pts: [[r, 0], [0.5, -r * Math.sin(phi)], [1 - r, 0]], base: "sq" };
    })(),
    arrow:  { pts: [[0.25, S3 / 4], [0.75, S3 / 4]], flips: [1, 0, 1], base: "line" },
    clear:  { pts: [], base: "line" },
  };

  let gen = { pts: [], flips: [] };
  let base = "tri";
  let level = 4;
  let morph = 1;               // 0..1 morph of the newest level
  let snapMode = 1;            // 0 off, 1 triangle grid, 2 square grid
  let undoStack = [];
  let dragging = false;

  const edCanvas = document.getElementById("editor");
  const viewCanvas = document.getElementById("view");
  const stats = document.getElementById("stats");
  const lvEl = document.getElementById("lv");

  // ---------- geometry ----------
  function allPts() { return [[0, 0], ...gen.pts, [1, 0]]; }
  function nSegs() { return gen.pts.length + 1; }
  function flipOf(i) { return gen.flips[i] || 0; }
  function baseEdges() {
    if (base === "line") return [[[0, 0], [1, 0]]];
    let v;
    if (base === "tri") {
      // clockwise (y-up) so the generator's "up" bumps point outward
      v = [90, -30, 210].map((a) => [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)]);
    } else {
      v = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    }
    return v.map((p, i) => [p, v[(i + 1) % v.length]]);
  }

  function maxLevel(cap) {
    const m = nSegs(), e = baseEdges().length;
    if (m <= 1) return 0;
    let L = 0;
    while (L < 12 && e * Math.pow(m, L + 1) <= cap) L++;
    return L;
  }

  // Map a flat point list (x0,y0,x1,y1,...) from the unit segment onto P→Q with a flip type.
  // Writes into out starting at offset o, skipping the first point if skipFirst. Returns new offset.
  function place(src, P, Q, type, out, o, skipFirst) {
    const n = src.length / 2;
    const rev = type & 2, mir = type & 1;
    const bx = rev ? Q[0] : P[0], by = rev ? Q[1] : P[1];
    const dx = rev ? P[0] - Q[0] : Q[0] - P[0], dy = rev ? P[1] - Q[1] : Q[1] - P[1];
    for (let k = skipFirst ? 1 : 0; k < n; k++) {
      const j = rev ? n - 1 - k : k;
      const x = src[2 * j], y = mir ? -src[2 * j + 1] : src[2 * j + 1];
      out[o++] = bx + dx * x - dy * y;
      out[o++] = by + dx * y + dy * x;
    }
    return o;
  }

  // Curve on the unit segment at level L. The bottom-most substitution uses a generator
  // morphed from "flat" (t=0) to the real shape (t=1), so level L grows out of level L-1.
  function unitCurve(L, t) {
    const P = allPts();
    const m = P.length - 1;
    if (L === 0 || m === 1) return new Float64Array([0, 0, 1, 0]);
    // flat positions: same corners spread along the x-axis by cumulative length
    const lens = [];
    let tot = 0;
    for (let i = 0; i < m; i++) {
      const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      lens.push(l);
      tot += l;
    }
    let cur = new Float64Array(2 * (m + 1));
    let acc = 0;
    for (let i = 0; i <= m; i++) {
      const fx = tot ? acc / tot : i / m;
      cur[2 * i] = fx + (P[i][0] - fx) * t;
      cur[2 * i + 1] = P[i][1] * t;
      if (i < m) acc += lens[i];
    }
    for (let k = 2; k <= L; k++) {
      const n = cur.length / 2;
      const next = new Float64Array(2 * (m * (n - 1) + 1));
      let o = 0;
      for (let i = 0; i < m; i++) o = place(cur, P[i], P[i + 1], flipOf(i), next, o, i > 0);
      cur = next;
    }
    return cur;
  }

  function fullCurve(L, t) {
    const unit = unitCurve(L, t);
    const edges = baseEdges();
    const n = unit.length / 2;
    const out = new Float64Array(2 * (edges.length * (n - 1) + 1));
    let o = 0;
    edges.forEach((e, i) => (o = place(unit, e[0], e[1], 0, out, o, i > 0)));
    return out;
  }

  // Similarity dimension: solve sum r_i^D = 1 by bisection.
  function dimension() {
    const P = allPts();
    const r = [];
    for (let i = 0; i < P.length - 1; i++) r.push(Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]));
    if (r.length < 2) return { D: 1, growth: 1 };
    const growth = r.reduce((a, b) => a + b, 0);
    if (r.some((x) => x >= 0.999)) return { D: null, growth };
    const f = (D) => r.reduce((s, x) => s + (x > 0 ? Math.pow(x, D) : 0), 0) - 1;
    let lo = 0, hi = 20;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    return { D: (lo + hi) / 2, growth };
  }
  MP.fractalDimension = dimension; // for testing

  // ---------- view rendering ----------
  const view = MP.setupCanvas(viewCanvas, () => drawView());

  function drawView() {
    const { ctx, w, h } = view;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const cap = dragging ? DRAG_CAP : SEG_CAP;
    const L = Math.min(level, maxLevel(cap));
    const pts = fullCurve(L, L === 0 ? 1 : morph);
    const n = pts.length / 2;

    // fit to view
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const pad = 36;
    const top = 70; // leave room for the stats box
    const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-6), (h - pad - top) / Math.max(y1 - y0, 1e-6));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ox = w / 2, oy = top + (h - pad - top) / 2;
    const X = (i) => ox + (pts[2 * i] - cx) * s;
    const Y = (i) => oy - (pts[2 * i + 1] - cy) * s;

    // translucent fill for closed shapes
    if (base !== "line") {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      for (let i = 1; i < n; i++) ctx.lineTo(X(i), Y(i));
      ctx.closePath();
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(w, h) / 2);
      g.addColorStop(0, "rgba(76,201,240,0.18)");
      g.addColorStop(1, "rgba(247,37,133,0.10)");
      ctx.fillStyle = g;
      ctx.fill("evenodd");
    }

    // rainbow stroke in chunks
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = n > 20000 ? 1 : n > 2000 ? 1.5 : n > 200 ? 2.5 : 3.5;
    const chunks = Math.min(180, n - 1);
    const per = Math.ceil((n - 1) / chunks);
    for (let c = 0; c * per < n - 1; c++) {
      const a = c * per, b = Math.min(n - 1, a + per);
      ctx.beginPath();
      ctx.moveTo(X(a), Y(a));
      for (let i = a + 1; i <= b; i++) ctx.lineTo(X(i), Y(i));
      ctx.strokeStyle = `hsl(${(200 + (a / n) * 300) % 360},95%,65%)`;
      ctx.stroke();
    }

    // stats
    const { D, growth } = dimension();
    const segs = (n - 1).toLocaleString();
    const limited = L < level ? ` <span style="color:var(--accent)">(capped)</span>` : "";
    let dimTxt;
    if (nSegs() < 2 || gen.pts.every((p) => Math.abs(p[1]) < 1e-9)) dimTxt = "1 (just a line, so add a bump!)";
    else if (D == null) dimTxt = "— (pieces must be shorter than the whole)";
    else dimTxt = D.toFixed(4) + (D > 2 ? " (it overlaps itself!)" : "");
    stats.innerHTML =
      `Level <b>${L}</b>${limited} · <b>${segs}</b> line${n - 1 === 1 ? "" : "s"}<br>` +
      `Length grows <b>×${growth.toFixed(3)}</b> each level<br>` +
      `Fractal dimension ≈ <b>${dimTxt}</b>`;
    lvEl.textContent = level;
  }

  // ---------- generator editor ----------
  const ed = MP.setupCanvas(edCanvas, () => drawEditor());
  function edFrame() {
    const { w, h } = ed;
    const pad = Math.max(28, w * 0.1);
    const unit = w - 2 * pad;
    return { pad, unit, ax: pad, ay: h * 0.58 };
  }
  function toScreen(p) {
    const f = edFrame();
    return [f.ax + p[0] * f.unit, f.ay - p[1] * f.unit];
  }
  function toMath(x, y) {
    const f = edFrame();
    return [(x - f.ax) / f.unit, (f.ay - y) / f.unit];
  }
  function snap(p) {
    if (snapMode === 0) return p;
    if (snapMode === 2) {
      const g = 0.25 / 2;
      return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
    }
    // triangular lattice, spacing 1/6
    const s = 1 / 6, rh = (s * S3) / 2;
    const j = Math.round(p[1] / rh);
    const off = (Math.abs(j) % 2) * (s / 2);
    const i = Math.round((p[0] - off) / s);
    return [i * s + off, j * rh];
  }

  function drawEditor() {
    const { ctx, w, h } = ed;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const f = edFrame();

    // grid dots
    if (snapMode) {
      ctx.fillStyle = "rgba(165,171,214,0.25)";
      const lim = 2;
      if (snapMode === 2) {
        const g = 0.125;
        for (let x = -lim; x <= 1 + lim; x += g)
          for (let y = -lim; y <= lim; y += g) {
            const [sx, sy] = toScreen([x, y]);
            if (sx > -5 && sx < w + 5 && sy > -5 && sy < h + 5) ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
          }
      } else {
        const s = 1 / 6, rh = (s * S3) / 2;
        for (let j = -14; j <= 14; j++)
          for (let i = -8; i <= 14; i++) {
            const [sx, sy] = toScreen([i * s + (Math.abs(j) % 2) * (s / 2), j * rh]);
            if (sx > -5 && sx < w + 5 && sy > -5 && sy < h + 5) ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
          }
      }
    }

    // ghost baseline
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(165,171,214,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.ax, f.ay);
    ctx.lineTo(f.ax + f.unit, f.ay);
    ctx.stroke();
    ctx.setLineDash([]);

    // generator segments + flip markers
    const P = allPts().map(toScreen);
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[i + 1];
      const t = flipOf(i);
      ctx.strokeStyle = t ? "#ffd60a" : "#4cc9f0";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      // small arrow showing which side bumps go (the copy's "up" side) and direction
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      let ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      if (t & 2) { ux = -ux; uy = -uy; }
      let nx = uy, ny = -ux; // screen-space "left" (= math up)
      if (t & 1) { nx = -nx; ny = -ny; }
      ctx.fillStyle = t ? "#ffd60a" : "rgba(76,201,240,0.9)";
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0f1226";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mx - nx * 5, my - ny * 5);
      ctx.lineTo(mx + nx * 5, my + ny * 5);
      ctx.moveTo(mx + nx * 5 - ux * 3, my + ny * 5 - uy * 3);
      ctx.lineTo(mx + nx * 5, my + ny * 5);
      ctx.lineTo(mx + nx * 5 + ux * 3, my + ny * 5 + uy * 3);
      ctx.stroke();
    }

    // anchors and corners
    P.forEach(([x, y], i) => {
      const anchor = i === 0 || i === P.length - 1;
      ctx.beginPath();
      ctx.arc(x, y, anchor ? 10 : 13, 0, Math.PI * 2);
      ctx.fillStyle = anchor ? "#a5abd6" : "#ff8a3d";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    });
    ctx.fillStyle = "#a5abd6";
    ctx.font = "600 14px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("start", P[0][0], P[0][1] + 30);
    ctx.fillText("end", P[P.length - 1][0], P[P.length - 1][1] + 30);
    if (!gen.pts.length) {
      ctx.fillStyle = "#eef0ff";
      ctx.font = "600 17px -apple-system, sans-serif";
      ctx.fillText("Tap above the line to make a bump  _/\\_", w / 2, f.ay - f.unit * 0.42);
    }
    ctx.textAlign = "start";
  }

  function pushUndo() {
    undoStack.push(JSON.stringify(gen));
    if (undoStack.length > 60) undoStack.shift();
  }

  function changed() {
    if (level < 1 && nSegs() > 1) level = 4;
    level = Math.min(level, maxLevel(SEG_CAP));
    morph = 1;
    drawEditor();
    drawView();
  }

  // editor input
  let ptr = null; // {id, idx, sx, sy, moved}
  edCanvas.addEventListener("pointerdown", (e) => {
    if (ptr) return;
    const p = MP.pos(e, edCanvas);
    const S = allPts().map(toScreen);
    // corner hit?
    let idx = -1, best = 26;
    for (let i = 1; i < S.length - 1; i++) {
      const d = Math.hypot(S[i][0] - p.x, S[i][1] - p.y);
      if (d < best) { best = d; idx = i - 1; }
    }
    // flip-marker hit?
    let seg = -1;
    if (idx < 0) {
      for (let i = 0; i < S.length - 1; i++) {
        const mx = (S[i][0] + S[i + 1][0]) / 2, my = (S[i][1] + S[i + 1][1]) / 2;
        if (Math.hypot(mx - p.x, my - p.y) < 18) { seg = i; break; }
      }
    }
    edCanvas.setPointerCapture(e.pointerId);
    ptr = { id: e.pointerId, idx, seg, sx: p.x, sy: p.y, moved: false, pushed: false };
  });

  edCanvas.addEventListener("pointermove", (e) => {
    if (!ptr || e.pointerId !== ptr.id || ptr.idx < 0) return;
    const p = MP.pos(e, edCanvas);
    if (!ptr.moved && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) < 7) return;
    if (!ptr.pushed) { pushUndo(); ptr.pushed = true; }
    ptr.moved = true;
    dragging = true;
    gen.pts[ptr.idx] = snap(toMath(p.x, p.y));
    morph = 1;
    drawEditor();
    drawView();
  });

  function edUp(e) {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = MP.pos(e, edCanvas);
    const q = ptr;
    ptr = null;
    dragging = false;
    if (q.idx >= 0) {
      if (!q.moved) {
        // tap on a corner removes it
        pushUndo();
        gen.pts.splice(q.idx, 1);
        gen.flips.splice(q.idx + 1, 1);
      }
      return changed();
    }
    if (q.seg >= 0) {
      // tap on a segment's marker: cycle normal → flipped → reversed → both
      pushUndo();
      gen.flips[q.seg] = (flipOf(q.seg) + 1) % 4;
      const names = ["normal", "flipped", "reversed", "flipped + reversed"];
      MP.toast(`That piece is now ${names[gen.flips[q.seg]]}`);
      return changed();
    }
    // tap on empty space: insert a corner into the nearest segment
    if (gen.pts.length >= MAX_PTS) return MP.toast(`Max ${MAX_PTS} corners. Tap one to remove it.`);
    const m = snap(toMath(p.x, p.y));
    const P = allPts();
    let bi = 0, bd = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      const d = distToSeg(m, P[i], P[i + 1]);
      if (d < bd) { bd = d; bi = i; }
    }
    pushUndo();
    gen.pts.splice(bi, 0, m);
    gen.flips.splice(bi + 1, 0, flipOf(bi));
    changed();
  }
  edCanvas.addEventListener("pointerup", edUp);
  edCanvas.addEventListener("pointercancel", edUp);

  function distToSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-12;
    const t = MP.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }

  // ---------- level animation ----------
  let anim = 0;
  function animateTo(target, fromZero) {
    const token = ++anim;
    const cap = maxLevel(SEG_CAP);
    target = MP.clamp(target, 0, cap);
    let L = fromZero ? 0 : level;
    if (fromZero) { level = 0; morph = 1; drawView(); }
    const step = () => {
      if (token !== anim) return;
      if (L >= target) { level = target; morph = 1; drawView(); return; }
      L++;
      level = L;
      const t0 = performance.now(), dur = 650;
      (function frame(t) {
        if (token !== anim) return;
        const k = Math.min(1, (t - t0) / dur);
        morph = 1 - Math.pow(1 - k, 3);
        drawView();
        if (k < 1) requestAnimationFrame(frame);
        else setTimeout(step, 220);
      })(t0);
    };
    setTimeout(step, fromZero ? 300 : 0);
  }

  // ---------- controls ----------
  function setPreset(name) {
    const p = PRESETS[name];
    pushUndo();
    gen = { pts: p.pts.map((q) => q.slice()), flips: (p.flips || []).slice() };
    setBase(p.base);
    if (name === "clear") { level = 0; anim++; changed(); return; }
    animateTo(Math.min(maxLevel(SEG_CAP), name === "mink" ? 3 : 5), true);
    drawEditor();
  }
  document.querySelectorAll("#presets .btn").forEach((b) => (b.onclick = () => setPreset(b.dataset.p)));

  function setBase(b) {
    base = b;
    document.querySelectorAll("#base .btn").forEach((x) => x.classList.toggle("on", x.dataset.b === b));
  }
  document.querySelectorAll("#base .btn").forEach((b) => (b.onclick = () => { setBase(b.dataset.b); changed(); }));

  document.getElementById("lvUp").onclick = () => {
    if (level >= maxLevel(SEG_CAP)) return MP.toast("That's as deep as this iPad can draw!");
    anim++;
    animateTo(level + 1);
  };
  document.getElementById("lvDown").onclick = () => { anim++; level = Math.max(0, level - 1); morph = 1; drawView(); };
  document.getElementById("build").onclick = () => animateTo(maxLevel(SEG_CAP) >= 5 ? 5 : maxLevel(SEG_CAP), true);

  const snapBtn = document.getElementById("snap");
  const snapLabels = ["Snap off", "Snap △", "Snap □"];
  snapBtn.onclick = () => {
    snapMode = (snapMode + 1) % 3;
    snapBtn.textContent = snapLabels[snapMode];
    drawEditor();
  };
  document.getElementById("edUndo").onclick = () => {
    if (!undoStack.length) return;
    gen = JSON.parse(undoStack.pop());
    changed();
  };

  // start with the Koch rule on a triangle → snowflake
  gen = { pts: PRESETS.koch.pts.map((q) => q.slice()), flips: [] };
  setBase("tri");
  level = 4;
  drawEditor();
  drawView();
})();
