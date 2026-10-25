/* Lights Out — tap a light to toggle it and its 4 neighbors. Hints come from a GF(2) linear solver. */

/* ---------- pure logic (no DOM; also loadable from node for testing) ---------- */
var LightsLogic = (function () {
  "use strict";

  // Toggle cell i and its orthogonal neighbors on an n×n board (Uint8Array of 0/1). Mutates board.
  function press(board, n, i) {
    const r = Math.floor(i / n), c = i % n;
    board[i] ^= 1;
    if (r > 0) board[i - n] ^= 1;
    if (r < n - 1) board[i + n] ^= 1;
    if (c > 0) board[i - 1] ^= 1;
    if (c < n - 1) board[i + 1] ^= 1;
    return board;
  }

  // Indices affected by pressing i (including i).
  function affected(n, i) {
    const r = Math.floor(i / n), c = i % n, out = [i];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }

  function isSolved(board) {
    for (let i = 0; i < board.length; i++) if (board[i]) return false;
    return true;
  }

  function countOn(board) {
    let k = 0;
    for (let i = 0; i < board.length; i++) k += board[i];
    return k;
  }

  // Solve A·x = b over GF(2), where A[i][j] = 1 if pressing j toggles light i, and b = board.
  // Returns the minimum-press solution as a Uint8Array (1 = press), or null if unsolvable.
  // Singular cases (e.g. 4×4 nullity 4, 5×5 nullity 2) are handled by trying every
  // combination of null-space vectors and keeping the solution with the fewest presses.
  function solve(board, n) {
    const N = n * n;
    const M = [];
    for (let i = 0; i < N; i++) {
      const row = new Uint8Array(N + 1);
      const aff = affected(n, i); // A is symmetric, so row i lists who toggles i
      for (let k = 0; k < aff.length; k++) row[aff[k]] = 1;
      row[N] = board[i] ? 1 : 0;
      M.push(row);
    }
    const pivotCols = [];
    let r = 0;
    for (let col = 0; col < N && r < N; col++) {
      let p = r;
      while (p < N && !M[p][col]) p++;
      if (p === N) continue; // free column
      if (p !== r) { const t = M[p]; M[p] = M[r]; M[r] = t; }
      const pr = M[r];
      for (let i = 0; i < N; i++) {
        if (i !== r && M[i][col]) {
          const row = M[i];
          for (let j = col; j <= N; j++) row[j] ^= pr[j];
        }
      }
      pivotCols.push(col);
      r++;
    }
    // inconsistent row 0 = 1 → unsolvable
    for (let i = r; i < N; i++) if (M[i][N]) return null;

    const isPivot = new Uint8Array(N);
    pivotCols.forEach((c) => (isPivot[c] = 1));
    const free = [];
    for (let c = 0; c < N; c++) if (!isPivot[c]) free.push(c);

    const base = new Uint8Array(N);
    for (let i = 0; i < pivotCols.length; i++) base[pivotCols[i]] = M[i][N];

    const nullBasis = free.map((f) => {
      const v = new Uint8Array(N);
      v[f] = 1;
      for (let i = 0; i < pivotCols.length; i++) v[pivotCols[i]] = M[i][f];
      return v;
    });

    let best = base, bestW = countOn(base);
    const combos = 1 << free.length;
    for (let mask = 1; mask < combos; mask++) {
      const x = base.slice();
      for (let b = 0; b < free.length; b++) {
        if (mask & (1 << b)) {
          const v = nullBasis[b];
          for (let j = 0; j < N; j++) x[j] ^= v[j];
        }
      }
      const w = countOn(x);
      if (w < bestW) { best = x; bestW = w; }
    }
    return best;
  }

  // Random solvable puzzle: press random buttons on an all-off board.
  // Ensures the board isn't already solved and needs at least minPresses presses.
  function randomBoard(n, rng, minPresses) {
    rng = rng || Math.random;
    const want = minPresses == null ? Math.min(n + 1, 6) : minPresses;
    for (let tries = 0; tries < 200; tries++) {
      const b = new Uint8Array(n * n);
      // press n..2n distinct random buttons: keeps big boards fun, not brutal
      const cells = [];
      for (let i = 0; i < n * n; i++) cells.push(i);
      const m = n + Math.floor(rng() * (n + 1));
      for (let i = 0; i < m; i++) {
        const j = i + Math.floor(rng() * (cells.length - i));
        const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
        press(b, n, cells[i]);
      }
      if (isSolved(b)) continue;
      const sol = solve(b, n);
      if (sol && countOn(sol) >= want) return b;
    }
    // fallback: press two far-apart corners (always valid and unsolved)
    const b = new Uint8Array(n * n);
    press(b, n, 0);
    press(b, n, n * n - 1);
    return b;
  }

  return { press, affected, isSolved, countOn, solve, randomBoard };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LightsLogic;

/* ---------- UI ---------- */
if (typeof document !== "undefined") (function () {
  "use strict";
  const L = LightsLogic;

  const stage = document.getElementById("stage");
  const boardWrap = document.getElementById("board");
  const grid = document.getElementById("grid");
  const movesEl = document.getElementById("moves");
  const litEl = document.getElementById("lit");
  const bestEl = document.getElementById("best");
  const hintText = document.getElementById("hintText");
  const solBtn = document.getElementById("solBtn");
  const sizeBtns = Array.from(document.querySelectorAll("#sizes .btn"));

  let n = 5;
  let board, start, cells = [];
  let moves = 0, hintsUsed = 0;
  let showSol = false;
  let hintIdx = -1;
  let won = false;
  let winTimer = 0;
  let solution = null;
  const HELP = "Tap a light to flip it <i>and</i> its 4 neighbors. Turn them all off!";

  // Bottom help line for the current state (a Hint sets its own text until the next press).
  function setHelp() {
    if (won) hintText.innerHTML = "Solved! Tap <b>✨ New puzzle</b> to play again.";
    else if (showSol) hintText.textContent = "Press every ringed light once, in any order!";
    else hintText.innerHTML = HELP;
  }

  function layout() {
    const cs = getComputedStyle(boardWrap);
    const availW = boardWrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = boardWrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const side = Math.max(160, Math.min(availW, availH, 640));
    const gap = Math.max(5, Math.round(side * 0.022));
    grid.style.gap = gap + "px";
    grid.style.padding = gap * 1.6 + "px";
    grid.style.width = side + "px";
    grid.style.height = side + "px";
    grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  }

  function build() {
    grid.innerHTML = "";
    grid.classList.remove("won");
    cells = [];
    for (let i = 0; i < n * n; i++) {
      const b = document.createElement("button");
      b.className = "cell";
      b.dataset.i = i;
      b.setAttribute("aria-label", "light " + (i + 1));
      grid.appendChild(b);
      cells.push(b);
    }
    layout();
  }

  function render() {
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.toggle("on", !!board[i]);
    }
    solution = L.solve(board, n);
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.toggle("sol", showSol && !!solution && !!solution[i]);
      cells[i].classList.toggle("hint", i === hintIdx);
    }
    movesEl.textContent = moves;
    litEl.textContent = L.countOn(board);
  }

  function animate(el, cls) {
    el.classList.remove("pop", "pop2");
    void el.offsetWidth; // restart animation
    el.classList.add(cls);
  }

  function newPuzzle() {
    start = L.randomBoard(n);
    restart();
  }

  function restart() {
    clearTimeout(winTimer); // a pending win modal must not pop up over the new board
    board = start.slice();
    moves = 0;
    hintsUsed = 0;
    hintIdx = -1;
    won = false;
    build();
    const sol = L.solve(board, n);
    bestEl.textContent = sol ? L.countOn(sol) : "?";
    render();
    setHelp();
  }

  function doPress(i) {
    if (won) {
      // the win modal can be dismissed by tapping the backdrop, so say what to do next
      MP.toast("Solved! Tap ✨ New puzzle or ⟲ Restart");
      return;
    }
    L.press(board, n, i);
    moves++;
    L.affected(n, i).forEach((j) => animate(cells[j], j === i ? "pop" : "pop2"));
    if (hintIdx !== -1) {
      hintIdx = -1;
      setHelp(); // drop the stale "Press the pulsing light!" text
    }
    render();
    if (L.isSolved(board)) win();
  }

  function win() {
    won = true;
    setHelp();
    const best = bestEl.textContent;
    clearTimeout(winTimer);
    winTimer = setTimeout(() => {
      grid.classList.add("won");
      cells.forEach((c, i) => (c.style.animationDelay = ((i % n) + Math.floor(i / n)) * 40 + "ms"));
      MP.confetti();
      const fewest = moves <= +best ? "That's the fewest possible. Perfect! 🏆" : `The fewest possible was ${best}. Can you match it?`;
      MP.modal({
        title: "Lights out! 🎉",
        html: `Lights out in <b>${moves}</b> move${moves === 1 ? "" : "s"}.<br>${fewest}` +
          (hintsUsed ? `<br><span style="color:var(--muted)">Hints used: ${hintsUsed}</span>` : ""),
        buttons: [
          { label: "✨ New puzzle", primary: true, onClick: newPuzzle },
          { label: "Try again", onClick: restart },
        ],
      });
    }, 350);
  }

  // ---------- input ----------
  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || !e.isPrimary) return;
    e.preventDefault();
    doPress(+cell.dataset.i);
  });

  function setSize(k) {
    n = k;
    sizeBtns.forEach((b) => b.classList.toggle("on", +b.dataset.n === n));
    newPuzzle();
  }
  sizeBtns.forEach((b) => (b.onclick = () => setSize(+b.dataset.n)));

  document.getElementById("newBtn").onclick = newPuzzle;
  document.getElementById("restartBtn").onclick = restart;

  document.getElementById("hintBtn").onclick = () => {
    if (won) return;
    if (!solution) { MP.toast("Hmm, this board can't be solved!"); return; }
    const presses = [];
    solution.forEach((v, i) => v && presses.push(i));
    if (!presses.length) return;
    // prefer a lit cell so the hint feels natural; otherwise any cell in the solution
    const lit = presses.filter((i) => board[i]);
    const pool = lit.length ? lit : presses;
    hintIdx = pool[Math.floor(Math.random() * pool.length)];
    hintsUsed++;
    render();
    hintText.textContent = `Press the pulsing light! ${presses.length} press${presses.length === 1 ? "" : "es"} to go.`;
  };

  solBtn.onclick = () => {
    showSol = !showSol;
    solBtn.classList.toggle("on", showSol);
    solBtn.textContent = showSol ? "Hide solution" : "Show solution";
    if (hintIdx === -1) setHelp();
    render();
  };

  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
  window.addEventListener("resize", layout);

  setSize(5);
})();
