/* Tower of Hanoi — drag (or tap-tap) disks between pegs; recursive auto-solve from any position. */
(function () {
  "use strict";

  const board = document.getElementById("board");
  const movesEl = document.getElementById("moves");
  const bestEl = document.getElementById("best");
  const nEl = document.getElementById("nDisks");
  const hintEl = document.getElementById("hint");
  const solveBtn = document.getElementById("solve");
  const speedInput = document.getElementById("speed");

  const MIN_N = 3, MAX_N = 8;
  let n = 3;
  let pegs;          // pegs[p] = array of disk sizes, bottom first (size 1 = smallest)
  let diskEls;       // diskEls[size] = element
  let history;       // [{from, to}]
  let moves;
  let usedAuto;
  let solving = false;
  let solveToken = 0;
  let won = false;
  let gameId = 0;    // bumps on every new game (stale win popups check it)
  let geom = null;   // layout numbers

  // ---------- layout ----------
  function layout() {
    const W = board.clientWidth, H = board.clientHeight;
    const colW = W / 3;
    const baseY = H - 70;
    const diskH = Math.max(10, Math.min(46, (H - 170) / (n + 1.5))); // fill short (phone-landscape) boards
    const pegH = diskH * (n + 1.2);
    const maxW = Math.min(colW * 0.92, 340);
    const minW = Math.max(maxW * 0.28, 50);
    geom = { W, H, colW, baseY, diskH, pegH, maxW, minW, liftY: baseY - pegH - diskH * 1.4 };
  }

  function pegX(p) { return geom.colW * (p + 0.5); }
  function diskW(size) { return n === 1 ? geom.maxW : geom.minW + ((geom.maxW - geom.minW) * (size - 1)) / (n - 1); }
  function restXY(size, p, level) {
    return { x: pegX(p) - diskW(size) / 2, y: geom.baseY - (level + 1) * geom.diskH };
  }
  function setXY(el, x, y) {
    el.style.transform = `translate(${x}px, ${y}px)`;
    el._x = x;
    el._y = y;
  }

  function build() {
    board.innerHTML = "";
    layout();
    for (let p = 0; p < 3; p++) {
      const peg = document.createElement("div");
      peg.className = "peg";
      peg.style.left = pegX(p) - 7 + "px";
      peg.style.top = geom.baseY - geom.pegH + "px";
      peg.style.height = geom.pegH + "px";
      board.appendChild(peg);
      const label = document.createElement("div");
      label.className = "peg-label";
      label.style.left = pegX(p) + "px";
      label.style.top = geom.baseY + 24 + "px";
      label.textContent = ["Start", "", ""][p];
      board.appendChild(label);
    }
    const base = document.createElement("div");
    base.className = "base";
    base.style.left = geom.colW * 0.08 + "px";
    base.style.width = geom.W - geom.colW * 0.16 + "px";
    base.style.top = geom.baseY + "px";
    board.appendChild(base);

    diskEls = [];
    for (let s = 1; s <= n; s++) {
      const d = document.createElement("div");
      d.className = "disk";
      const hue = ((s - 1) / n) * 300;
      d.style.background = `linear-gradient(hsl(${hue},90%,68%), hsl(${hue},85%,52%))`;
      d.style.width = diskW(s) + "px";
      d.style.height = geom.diskH - 4 + "px";
      d.style.fontSize = Math.min(22, geom.diskH * 0.5) + "px";
      d.textContent = s;
      board.appendChild(d);
      diskEls[s] = d;
    }
    placeAll();
  }

  function placeAll() {
    for (let p = 0; p < 3; p++) {
      pegs[p].forEach((s, level) => {
        const { x, y } = restXY(s, p, level);
        setXY(diskEls[s], x, y);
      });
    }
  }

  // ---------- game state ----------
  function newGame() {
    solveToken++;
    solving = false;
    won = false;
    gameId++;
    cancelDrag();
    selected = null;
    pegs = [[], [], []];
    for (let s = n; s >= 1; s--) pegs[0].push(s);
    history = [];
    moves = 0;
    usedAuto = false;
    nEl.textContent = n;
    bestEl.textContent = (2 ** n - 1).toLocaleString();
    build();
    updateUI();
  }

  function top(p) { return pegs[p][pegs[p].length - 1]; }
  function legal(from, to) {
    if (from === to || !pegs[from].length) return false;
    return !pegs[to].length || top(to) > top(from);
  }

  function doMove(from, to, record) {
    const s = pegs[from].pop();
    pegs[to].push(s);
    if (record !== false) {
      history.push({ from, to });
      moves++;
    }
    updateUI();
    return s;
  }

  function updateUI() {
    movesEl.textContent = moves.toLocaleString();
    document.getElementById("undo").disabled = solving || !history.length;
    solveBtn.textContent = solving ? "■ Stop" : "▶ Auto-solve";
    solveBtn.classList.toggle("primary", solving);
    solveBtn.classList.toggle("blue", !solving);
  }

  function checkWin() {
    if (won) return;
    if (pegs[1].length === n || pegs[2].length === n) {
      won = true;
      const best = 2 ** n - 1;
      if (usedAuto) {
        MP.toast(`Solved by recursion in ${moves} moves`, 2500);
        return;
      }
      MP.confetti();
      const perfect = moves === best;
      const id = gameId;
      setTimeout(() => {
        if (id !== gameId || !won) return; // restarted or undone meanwhile
        MP.modal({
          title: perfect ? "Perfect! 🏆" : "You did it! 🎉",
          html: perfect
            ? `${n} disks in <b>${moves}</b> moves. That's the fewest possible: 2<sup>${n}</sup> − 1 = ${best}.`
            : `${n} disks in <b>${moves}</b> moves.<br>The fewest possible is <b>${best}</b>. Can you find it?`,
          buttons: [
            { label: "Play again", onClick: newGame },
            ...(n < MAX_N ? [{ label: `Try ${n + 1} disks`, primary: true, onClick: () => { n++; newGame(); } }] : []),
          ],
        });
      }, 600);
    }
  }

  // ---------- animation ----------
  // Lift → slide → drop along a 3-leg path.
  function animateTo(el, tx, ty, ms, token) {
    return new Promise((resolve) => {
      el.classList.remove("snap"); // a CSS transition would fight the per-frame moves
      const sx = el._x, sy = el._y;
      const ly = Math.min(geom.liftY, sy, ty);
      const d1 = Math.abs(sy - ly), d2 = Math.abs(tx - sx), d3 = Math.abs(ty - ly);
      const total = d1 + d2 + d3 || 1;
      const t0 = performance.now();
      (function frame(t) {
        if (token !== solveToken) return resolve(); // stopped / restarted: leave the disk alone
        let k = Math.min(1, (t - t0) / ms);
        k = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
        let dist = k * total, x, y;
        if (dist <= d1) { x = sx; y = sy - (sy - ly) * (dist / (d1 || 1)); }
        else if (dist <= d1 + d2) { x = sx + (tx - sx) * ((dist - d1) / (d2 || 1)); y = ly; }
        else { x = tx; y = ly + (ty - ly) * ((dist - d1 - d2) / (d3 || 1)); }
        setXY(el, x, y);
        if (k < 1) requestAnimationFrame(frame);
        else resolve();
      })(t0);
    });
  }

  function speedMs() {
    const v = parseFloat(speedInput.value); // 1..10
    return 900 / Math.pow(1.55, v - 1);     // ~900ms .. ~20ms
  }

  // ---------- optimal solver from ANY legal position ----------
  // To put disks 1..k on `target`: if disk k is already there, just place 1..k-1 there;
  // otherwise move 1..k-1 to the spare peg, move disk k, then move 1..k-1 onto it.
  function solveMoves(state, target) {
    const pos = [];
    state.forEach((peg, p) => peg.forEach((s) => (pos[s] = p)));
    const out = [];
    (function rec(k, tgt) {
      if (k === 0) return;
      if (pos[k] === tgt) return rec(k - 1, tgt);
      const spare = 3 - pos[k] - tgt;
      rec(k - 1, spare);
      out.push({ from: pos[k], to: tgt });
      pos[k] = tgt;
      rec(k - 1, tgt);
    })(n, target);
    return out;
  }
  MP.hanoiSolve = solveMoves; // exposed for testing

  // Stop auto-solve and drop the disk that was mid-flight back where the state says it is.
  function stopSolve() {
    if (!solving) return;
    solveToken++;
    solving = false;
    for (const el of diskEls) if (el) el.classList.add("snap");
    placeAll();
    updateUI();
  }

  async function autoSolve() {
    if (solving) return stopSolve();
    // Finish on whichever goal peg already holds more of the tower; default to the right peg.
    const target = pegs[1].length > pegs[2].length ? 1 : 2;
    const plan = solveMoves(pegs, target);
    if (!plan.length) return MP.toast("Already solved! Tap Restart to play again.");
    solving = true;
    usedAuto = true;
    const token = ++solveToken;
    updateUI();
    for (const m of plan) {
      if (token !== solveToken) return;
      const s = top(m.from);
      const el = diskEls[s];
      const { x, y } = restXY(s, m.to, pegs[m.to].length);
      await animateTo(el, x, y, speedMs(), token);
      if (token !== solveToken) return;
      doMove(m.from, m.to);
      if (el !== diskEls[s]) placeAll(); // board was rebuilt (resize) mid-move
    }
    solving = false;
    updateUI();
    checkWin();
  }

  // ---------- input: drag a disk, or tap source then tap target ----------
  let drag = null;       // {from, el, dx, dy, startX, startY, moved, id}
  let selected = null;   // peg index picked by tap

  function pegAt(x) { return MP.clamp(Math.floor(x / geom.colW), 0, 2); }

  board.addEventListener("pointerdown", (e) => {
    if (solving || drag) return;
    const p = MP.pos(e, board);
    const peg = pegAt(p.x);

    if (selected !== null) {
      // second tap: drop on this peg
      const from = selected;
      clearSelection();
      tryMove(from, peg);
      return;
    }
    if (!pegs[peg].length) return;
    const s = top(peg);
    const el = diskEls[s];
    el.classList.remove("snap");
    el.classList.add("lifted");
    try { board.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    drag = { from: peg, el, dx: p.x - el._x, dy: p.y - el._y, startX: p.x, startY: p.y, moved: false, id: e.pointerId };
    hintEl.style.opacity = 0;
  });

  board.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = MP.pos(e, board);
    if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 10) drag.moved = true;
    if (drag.moved) setXY(drag.el, p.x - drag.dx, p.y - drag.dy);
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    const p = MP.pos(e, board);
    if (!d.moved) {
      // tap: select this peg and lift its top disk
      selected = d.from;
      const s = top(d.from);
      const { x } = restXY(s, d.from, pegs[d.from].length - 1);
      d.el.classList.add("snap");
      setXY(d.el, x, geom.liftY);
      return;
    }
    d.el.classList.remove("lifted");
    tryMove(d.from, pegAt(p.x));
  }
  board.addEventListener("pointerup", endDrag);
  // Interrupted (system gesture, lost capture): put the disk back, don't treat it as a tap or a drop.
  function abortDrag(e) {
    if (drag && e.pointerId === drag.id) cancelDrag();
  }
  board.addEventListener("pointercancel", abortDrag);
  board.addEventListener("lostpointercapture", abortDrag);

  function cancelDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { board.releasePointerCapture(d.id); } catch (_) { /* already released */ }
    d.el.classList.remove("lifted");
    d.el.classList.add("snap");
    const s = top(d.from);
    if (s && diskEls[s] === d.el) {
      const { x, y } = restXY(s, d.from, pegs[d.from].length - 1);
      setXY(d.el, x, y);
    }
  }

  function clearSelection() {
    if (selected === null) return;
    const s = top(selected);
    if (s) {
      const el = diskEls[s];
      el.classList.remove("lifted");
      el.classList.add("snap");
      const { x, y } = restXY(s, selected, pegs[selected].length - 1);
      setXY(el, x, y);
    }
    selected = null;
  }

  function tryMove(from, to) {
    const s = top(from);
    const el = diskEls[s];
    el.classList.add("snap");
    el.classList.remove("lifted");
    if (from !== to && legal(from, to)) {
      const { x, y } = restXY(s, to, pegs[to].length);
      setXY(el, x, y);
      doMove(from, to);
      setTimeout(checkWin, 200);
    } else {
      const { x, y } = restXY(s, from, pegs[from].length - 1);
      setXY(el, x, y);
      if (from !== to) {
        el.classList.remove("shake");
        void el.offsetWidth;
        // shake the disk's wrapper effect: briefly flash red outline
        el.style.outline = "4px solid var(--bad)";
        setTimeout(() => (el.style.outline = ""), 450);
        MP.toast("Big disks can't go on smaller ones!");
      }
    }
  }

  // ---------- controls ----------
  document.getElementById("fewer").onclick = () => { if (n > MIN_N) { n--; newGame(); } };
  document.getElementById("more").onclick = () => { if (n < MAX_N) { n++; newGame(); } };
  document.getElementById("reset").onclick = newGame;
  document.getElementById("undo").onclick = () => {
    if (solving || !history.length) return;
    cancelDrag();
    clearSelection();
    const m = history.pop();
    doMove(m.to, m.from, false);
    moves--;
    won = false;
    for (const el of diskEls) if (el) el.classList.add("snap");
    placeAll();
    updateUI();
  };
  solveBtn.onclick = () => { cancelDrag(); clearSelection(); autoSolve(); };

  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!pegs) return;
      cancelDrag();
      selected = null;
      build(); // an auto-solve in progress carries on with the new elements
    }, 60);
  }).observe(board);

  newGame();
})();
