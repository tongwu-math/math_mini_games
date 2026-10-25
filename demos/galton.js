/* Galton Board — balls bounce left/right through a peg triangle and pile up into a binomial histogram. */

/* ---------- pure logic (no DOM; also loadable from node for testing) ---------- */
var GaltonLogic = (function () {
  "use strict";

  // n choose k as a float (exact for the small n used here)
  function choose(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  }

  // Binomial probability of exactly k rights in n rows
  function binomPmf(n, k, p) {
    return choose(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
  }

  function normalPdf(x, mu, sigma) {
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
  }

  // Simulate one ball's bin index (number of right bounces)
  function dropBall(rows, p, rng) {
    rng = rng || Math.random;
    let k = 0;
    for (let i = 0; i < rows; i++) if (rng() < p) k++;
    return k;
  }

  return { choose, binomPmf, normalPdf, dropBall };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GaltonLogic;

/* ---------- UI ---------- */
if (typeof document !== "undefined") (function () {
  "use strict";
  const G = GaltonLogic;

  const canvas = document.getElementById("c");
  const totalEl = document.getElementById("total");
  const meanEl = document.getElementById("mean");
  const expMeanEl = document.getElementById("expMean");
  const legend = document.getElementById("legend");
  const streamBtn = document.getElementById("stream");
  const curveBtn = document.getElementById("curveBtn");

  const PALETTE = ["#ff8a3d", "#4cc9f0", "#5be37d", "#ff5d9e", "#ffd23f", "#b388ff"];
  const MAX_IN_FLIGHT = 900;
  const GRAVITY = 2600; // px/s² for the final drop into a bin

  let rows = 12;
  let p = 0.5;
  let counts = [];
  let total = 0;
  let balls = [];
  let queue = 0;
  let spawnAcc = 0;
  let streaming = false;
  let showCurve = false;
  let unit = 0; // px of stack height per ball (smoothed)
  let pegGlow = [];
  let geo = null;
  let staticCv = null;
  let needLayout = true;
  let dirty = true;
  let statsDirty = true;

  const cv = MP.setupCanvas(canvas, () => {
    needLayout = true;
    dirty = true;
  });
  const ctx = cv.ctx;

  // ---------- geometry ----------
  function computeLayout() {
    const W = cv.w, H = cv.h;
    const R = rows;
    const short = H < 420; // phone landscape
    const top = short ? 10 : 14;
    const floor = H - (short ? 24 : 30);
    const minBinH = H * (short ? 0.28 : 0.32);
    let dx = Math.min((W * 0.92) / (R + 1), 74);
    // the hopper sits ~1.85 rows above the first peg, so solve for the row height that fits
    const dyFit = (floor - minBinH - top - Math.min(9, dx * 0.2)) / (R + 1.45);
    const dy = Math.max(10, Math.min(dx * 0.87, dyFit));
    // on wide, short screens narrow the triangle instead of squashing it flat
    dx = Math.min(dx, dy / 0.62);
    const ballR = MP.clamp(Math.min(dx * 0.2, dy * 0.3), 2.5, 9);
    const pegR = MP.clamp(Math.min(dx, dy) * 0.085, 2, 5);
    const y0 = top + dy * 1.85 + ballR;
    const binTop = y0 + (R - 1) * dy + dy * 0.75;
    const old = geo;
    geo = { W, H, R, cx: W / 2, y0, dx, dy, floor, binTop, binH: floor - binTop, ballR, pegR };
    // resize / rotation mid-flight: move balls with the board instead of letting them fly off
    if (old && old.R === R) {
      const kx = dx / old.dx, ky = dy / old.dy;
      const mx = (x) => geo.cx + (x - old.cx) * kx;
      const my = (y) => y0 + (y - old.y0) * ky;
      balls.forEach((b) => {
        b.x = mx(b.x); b.x0 = mx(b.x0); b.x1 = mx(b.x1);
        b.y = my(b.y); b.y0 = my(b.y0); b.y1 = my(b.y1);
        b.hop *= ky;
        b.vy *= ky;
      });
    }
    pegGlow = new Float32Array((R * (R + 1)) / 2);
    let maxC = 1;
    for (let k = 0; k < counts.length; k++) maxC = Math.max(maxC, counts[k]);
    unit = Math.min(ballR * 2 * 0.92, (floor - binTop - 18) / maxC);
    buildStatic();
    needLayout = false;
  }

  function pegX(j, k) { return geo.cx + (k - j / 2) * geo.dx; }
  function pegY(j) { return geo.y0 + j * geo.dy; }
  function binX(k) { return geo.cx + (k - geo.R / 2) * geo.dx; }
  function restY(j) { return pegY(j) - geo.pegR - geo.ballR; }
  function pegIndex(j, k) { return (j * (j + 1)) / 2 + k; }
  function binColor(k, l) { return MP.hsl(190 + (k / Math.max(1, geo.R)) * 150, 85, l || 60); }

  function buildStatic() {
    const dpr = cv.dpr;
    staticCv = staticCv || document.createElement("canvas");
    staticCv.width = Math.round(geo.W * dpr);
    staticCv.height = Math.round(geo.H * dpr);
    const s = staticCv.getContext("2d");
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.clearRect(0, 0, geo.W, geo.H);
    const { R, dx, dy, pegR, binTop, floor, cx, y0 } = geo;

    // hopper funnel
    const fy = y0 - dy * 1.25 - geo.ballR;
    s.strokeStyle = "rgba(165,171,214,0.55)";
    s.lineWidth = 3;
    s.lineCap = "round";
    s.beginPath();
    s.moveTo(cx - dx * 0.9, fy - dy * 0.5);
    s.lineTo(cx - geo.ballR * 1.6, fy + dy * 0.3);
    s.moveTo(cx + dx * 0.9, fy - dy * 0.5);
    s.lineTo(cx + geo.ballR * 1.6, fy + dy * 0.3);
    s.stroke();

    // bin backgrounds + dividers
    for (let k = 0; k <= R; k++) {
      s.fillStyle = k % 2 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.05)";
      s.fillRect(binX(k) - dx / 2, binTop, dx, floor - binTop);
    }
    s.strokeStyle = "rgba(165,171,214,0.45)";
    s.lineWidth = 2;
    s.beginPath();
    for (let k = 0; k <= R + 1; k++) {
      const x = binX(k - 0.5);
      s.moveTo(x, binTop);
      s.lineTo(x, floor);
    }
    s.moveTo(binX(-0.5) - 4, floor + 1);
    s.lineTo(binX(R + 0.5) + 4, floor + 1);
    s.stroke();

    // bin labels
    s.fillStyle = "#a5abd6";
    s.font = `600 ${Math.round(MP.clamp(dx * 0.4, 10, 15))}px -apple-system, sans-serif`;
    s.textAlign = "center";
    s.textBaseline = "top";
    for (let k = 0; k <= R; k++) s.fillText(String(k), binX(k), floor + 7);

    // pegs
    for (let j = 0; j < R; j++) {
      for (let k = 0; k <= j; k++) {
        const x = pegX(j, k), y = pegY(j);
        const g = s.createRadialGradient(x - pegR * 0.35, y - pegR * 0.35, pegR * 0.1, x, y, pegR);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#8a91c9");
        s.fillStyle = g;
        s.beginPath();
        s.arc(x, y, pegR, 0, Math.PI * 2);
        s.fill();
      }
    }
  }

  // ---------- balls ----------
  function spawnBall() {
    if (balls.length >= MAX_IN_FLIGHT) return false;
    const x = geo.cx + (Math.random() - 0.5) * geo.ballR * 0.6;
    const y = geo.y0 - geo.dy * 1.25 - geo.ballR;
    balls.push({
      phase: 0, // 0 = drop to first peg, 1 = hopping, 2 = falling into bin
      j: 0, k: 0,
      x, y,
      x0: x, y0: y, x1: pegX(0, 0), y1: restY(0),
      t: 0, dur: 0.16, hop: 0, vy: 0,
      color: PALETTE[(Math.random() * PALETTE.length) | 0],
    });
    return true;
  }

  function hopDur() { return MP.clamp(0.16 * Math.sqrt(geo.dy / 40), 0.09, 0.22); }

  // Ball has just reached peg (b.j, b.k): flip the coin and aim at the next target.
  function bounce(b) {
    pegGlow[pegIndex(b.j, b.k)] = 1;
    const right = Math.random() < p;
    const nk = b.k + (right ? 1 : 0);
    const nj = b.j + 1;
    b.x0 = b.x1;
    b.y0 = b.y1;
    b.t = 0;
    b.dur = hopDur();
    b.hop = geo.dy * 0.38;
    if (nj < geo.R) {
      b.x1 = pegX(nj, nk);
      b.y1 = restY(nj);
    } else {
      b.x1 = binX(nk);
      b.y1 = geo.binTop - geo.ballR * 0.5;
    }
    b.j = nj;
    b.k = nk;
    b.phase = 1;
  }

  function stackTop(k) { return geo.floor - counts[k] * unit; }

  function update(dt) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.phase === 2) {
        b.vy += GRAVITY * dt;
        b.y += b.vy * dt;
        const target = Math.max(geo.binTop, stackTop(b.k)) - geo.ballR;
        if (b.y >= target) {
          counts[b.k]++;
          total++;
          statsDirty = true;
          balls[i] = balls[balls.length - 1];
          balls.pop();
        }
        continue;
      }
      b.t += dt / b.dur;
      if (b.t >= 1) {
        b.x = b.x1;
        b.y = b.y1;
        if (b.phase === 0 || b.j < geo.R) {
          if (b.phase === 0) b.phase = 1;
          bounce(b);
        } else {
          b.phase = 2;
          b.vy = 120;
        }
        continue;
      }
      const t = b.t;
      if (b.phase === 0) {
        b.x = MP.lerp(b.x0, b.x1, t);
        b.y = MP.lerp(b.y0, b.y1, t * t); // accelerate down
      } else {
        b.x = MP.lerp(b.x0, b.x1, t);
        b.y = MP.lerp(b.y0, b.y1, t) - b.hop * 4 * t * (1 - t);
      }
    }
    for (let i = 0; i < pegGlow.length; i++) if (pegGlow[i] > 0) pegGlow[i] = Math.max(0, pegGlow[i] - dt * 5);

    // smooth histogram scale
    let maxC = 1;
    for (let k = 0; k <= geo.R; k++) maxC = Math.max(maxC, counts[k]);
    if (showCurve && total > 0) {
      let maxE = 0;
      for (let k = 0; k <= geo.R; k++) maxE = Math.max(maxE, total * G.binomPmf(geo.R, k, p));
      const mu = geo.R * p, sig = Math.sqrt(geo.R * p * (1 - p));
      maxE = Math.max(maxE, total * G.normalPdf(mu, mu, sig));
      maxC = Math.max(maxC, maxE);
    }
    const target = Math.min(geo.ballR * 2 * 0.92, (geo.binH - 18) / maxC);
    const prev = unit;
    unit += (target - unit) * Math.min(1, dt * 6);
    // never let the pile poke out of the top of the bins
    unit = Math.min(unit, (geo.binH - 4) / maxC);
    return Math.abs(prev - unit) > 0.001;
  }

  // ---------- drawing ----------
  function draw() {
    const { W, H, R, dx, floor, ballR } = geo;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(staticCv, 0, 0, W, H);

    // peg glows
    ctx.fillStyle = "rgba(255,210,63,1)";
    for (let j = 0; j < R; j++) {
      for (let k = 0; k <= j; k++) {
        const g = pegGlow[pegIndex(j, k)];
        if (g <= 0.02) continue;
        ctx.globalAlpha = g * 0.85;
        ctx.beginPath();
        ctx.arc(pegX(j, k), pegY(j), geo.pegR * (1.3 + g * 0.9), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // histogram
    const stacked = unit >= ballR * 1.5;
    const showNums = dx >= 22;
    ctx.font = `700 ${Math.round(MP.clamp(dx * 0.34, 10, 15))}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let k = 0; k <= R; k++) {
      const c = counts[k];
      if (!c) continue;
      const x = binX(k);
      if (stacked) {
        const r = Math.min(ballR, unit / 2);
        ctx.fillStyle = binColor(k);
        ctx.beginPath();
        for (let i = 0; i < c; i++) {
          const y = floor - unit * (i + 0.5);
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      } else {
        const h = c * unit;
        const bw = dx * 0.78;
        const g = ctx.createLinearGradient(0, floor - h, 0, floor);
        g.addColorStop(0, binColor(k, 68));
        g.addColorStop(1, binColor(k, 45));
        ctx.fillStyle = g;
        roundRectTop(x - bw / 2, floor - h, bw, h, Math.min(6, bw / 3));
        ctx.fill();
      }
      if (showNums && total >= 1) {
        ctx.fillStyle = "#eef0ff";
        ctx.fillText(String(c), x, Math.max(geo.binTop + 14, floor - c * unit - 3));
      }
    }

    // balls in flight
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, ballR, 0, Math.PI * 2);
      ctx.fill();
    }
    // tiny highlight pass (one path, cheap)
    if (ballR >= 4) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        const hx = b.x - ballR * 0.35, hy = b.y - ballR * 0.35;
        ctx.moveTo(hx + ballR * 0.3, hy);
        ctx.arc(hx, hy, ballR * 0.3, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    if (showCurve && total > 0) drawCurve();
  }

  function roundRectTop(x, y, w, h, r) {
    r = Math.min(r, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function drawCurve() {
    const R = geo.R, floor = geo.floor;
    const mu = R * p, sig = Math.sqrt(R * p * (1 - p));
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // smooth normal approximation
    ctx.beginPath();
    for (let u = -0.5, first = true; u <= R + 0.5 + 1e-9; u += 0.05, first = false) {
      const y = floor - total * G.normalPdf(u, mu, sig) * unit;
      if (first) ctx.moveTo(binX(u), y);
      else ctx.lineTo(binX(u), y);
    }
    ctx.strokeStyle = "rgba(255,93,158,0.45)";
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();
    // exact binomial expectations as dashes
    ctx.strokeStyle = "#ff5d9e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let k = 0; k <= R; k++) {
      const y = floor - total * G.binomPmf(R, k, p) * unit;
      ctx.moveTo(binX(k) - geo.dx * 0.3, y);
      ctx.lineTo(binX(k) + geo.dx * 0.3, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function updateStats() {
    totalEl.textContent = total.toLocaleString();
    if (total) {
      let s = 0;
      for (let k = 0; k <= rows; k++) s += k * counts[k];
      meanEl.textContent = (s / total).toFixed(2);
    } else meanEl.textContent = "–";
    expMeanEl.textContent = `(expected ${(rows * p).toFixed(2)})`;
    statsDirty = false;
  }

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (needLayout && cv.w > 1) { computeLayout(); dirty = true; }
    if (!geo) { requestAnimationFrame(frame); return; }

    if (streaming && queue < 3) queue += 1;
    if (queue > 0) {
      spawnAcc += dt;
      const interval = streaming && queue <= 3 ? 0.075 : 0.03;
      while (spawnAcc >= interval && queue > 0) {
        spawnAcc -= interval;
        if (!spawnBall()) break;
        queue--;
      }
    } else spawnAcc = 0;

    let glowing = false;
    for (let i = 0; i < pegGlow.length && !glowing; i++) if (pegGlow[i] > 0) glowing = true;
    const scaleMoving = update(dt);
    if (balls.length || queue || glowing || scaleMoving || dirty) {
      draw();
      dirty = false;
    }
    if (statsDirty) updateStats();
    requestAnimationFrame(frame);
  }

  // ---------- controls ----------
  function clearAll() {
    balls = [];
    queue = 0;
    total = 0;
    counts = new Array(rows + 1).fill(0);
    if (geo) unit = geo.ballR * 2 * 0.92;
    statsDirty = true;
    dirty = true;
  }

  function drop(nBalls) {
    queue += nBalls; // spawned by the frame loop once the layout exists
  }

  // click (not pointerdown) so starting a scroll of the side controls on a phone doesn't drop balls
  document.getElementById("drop1").onclick = () => drop(1);
  document.getElementById("drop100").onclick = () => drop(100);
  canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); drop(1); });

  streamBtn.onclick = () => {
    streaming = !streaming;
    streamBtn.classList.toggle("on", streaming);
    streamBtn.textContent = streaming ? "⏸ Stop" : "▶ Pour";
  };

  curveBtn.onclick = () => {
    showCurve = !showCurve;
    curveBtn.classList.toggle("on", showCurve);
    curveBtn.textContent = showCurve ? "🔔 Hide bell curve" : "🔔 Show bell curve";
    legend.classList.toggle("show", showCurve);
    dirty = true;
  };

  document.getElementById("clearBtn").onclick = clearAll;

  MP.slider("rows", (v) => {
    if (v === rows && geo) return;
    rows = v;
    clearAll();
    needLayout = true;
  });

  const leanFmt = (v) => {
    const pct = Math.round(v * 100);
    if (pct === 50) return "50/50";
    return pct > 50 ? `${pct}% →` : `← ${100 - pct}%`;
  };
  const leanInput = MP.slider("lean", (v) => {
    p = v;
    statsDirty = true;
    dirty = true;
  }, leanFmt);
  // A new lean is a new experiment: start a fresh pile when the finger lifts.
  leanInput.addEventListener("change", () => {
    if (total || balls.length) {
      clearAll();
      MP.toast(p === 0.5 ? "Fair pegs: 50% left, 50% right" : `New lean: ${Math.round(p * 100)}% chance to bounce right`);
    }
  });

  counts = new Array(rows + 1).fill(0);
  requestAnimationFrame(frame);
})();
