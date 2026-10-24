/* Code Breaker — crack Caesar, substitution and Vigenère ciphers hiding fun math facts. */

/* ---------- pure logic (no DOM; also loadable from node for testing) ---------- */
var CipherLogic = (function () {
  "use strict";

  const A = 65;
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const isLetter = (ch) => ch >= "A" && ch <= "Z";
  const mod = (a, m) => ((a % m) + m) % m;
  const code = (ch) => ch.charCodeAt(0) - A;

  function shiftChar(ch, k) {
    return isLetter(ch) ? String.fromCharCode(A + mod(code(ch) + k, 26)) : ch;
  }

  // Caesar: secret = (letter + shift) mod 26. Non-letters pass through.
  function caesarEncrypt(text, k) {
    let out = "";
    for (const ch of text) out += shiftChar(ch, k);
    return out;
  }
  function caesarDecrypt(text, k) { return caesarEncrypt(text, -k); }

  // Vigenère: the keyword's letters take turns as Caesar shifts (only letters use up key positions).
  function vigenere(text, key, dir) {
    let out = "", j = 0;
    for (const ch of text) {
      if (isLetter(ch)) {
        out += shiftChar(ch, dir * code(key[j % key.length]));
        j++;
      } else out += ch;
    }
    return out;
  }
  function vigenereEncrypt(text, key) { return vigenere(text, key, 1); }
  function vigenereDecrypt(text, key) { return vigenere(text, key, -1); }

  // Random substitution key with no letter mapped to itself. key[i] = secret letter for plain letter i.
  function randomSubKey(rng) {
    rng = rng || Math.random;
    const a = ALPHA.split("");
    for (;;) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      if (a.every((ch, i) => ch !== ALPHA[i])) return a.join("");
    }
  }
  function subEncrypt(text, key) {
    let out = "";
    for (const ch of text) out += isLetter(ch) ? key[code(ch)] : ch;
    return out;
  }
  // inverse key: inv[i] = plain letter for secret letter i
  function invertKey(key) {
    const inv = new Array(26);
    for (let i = 0; i < 26; i++) inv[code(key[i])] = ALPHA[i];
    return inv.join("");
  }
  function subDecrypt(text, key) { return subEncrypt(text, invertKey(key)); }

  function letterCounts(text) {
    const c = new Array(26).fill(0);
    for (const ch of text) if (isLetter(ch)) c[code(ch)]++;
    return c;
  }

  // Typical English letter frequencies (%)
  const ENGLISH = {
    E: 12.7, T: 9.1, A: 8.2, O: 7.5, I: 7.0, N: 6.7, S: 6.3, H: 6.1, R: 6.0, D: 4.3, L: 4.0, C: 2.8, U: 2.8,
    M: 2.4, W: 2.4, F: 2.2, G: 2.0, Y: 2.0, P: 1.9, B: 1.5, V: 1.0, K: 0.8, J: 0.15, X: 0.15, Q: 0.1, Z: 0.07,
  };
  const ENGLISH_ORDER = Object.keys(ENGLISH).sort((a, b) => ENGLISH[b] - ENGLISH[a]);

  const MESSAGES = [
    "THERE ARE AS MANY EVEN NUMBERS AS WHOLE NUMBERS.",
    "ZERO IS AN EVEN NUMBER.",
    "THERE ARE INFINITELY MANY PRIME NUMBERS.",
    "SOME INFINITIES ARE BIGGER THAN OTHERS.",
    "PI GOES ON FOREVER AND NEVER REPEATS.",
    "IN A ROOM OF 23 PEOPLE, TWO PROBABLY SHARE A BIRTHDAY.",
    "A SHUFFLED DECK IS PROBABLY IN AN ORDER NO ONE HAS EVER SEEN.",
    "EVERY MAP CAN BE COLORED WITH JUST FOUR COLORS.",
    "HEXAGONS LET BEES STORE THE MOST HONEY WITH THE LEAST WAX.",
    "FOLD A PAPER IN HALF 42 TIMES AND IT WOULD REACH THE MOON.",
    "A GOOGOL IS A ONE FOLLOWED BY ONE HUNDRED ZEROS.",
    "FOUR IS THE ONLY NUMBER WITH AS MANY LETTERS AS ITS VALUE.",
    "SUNFLOWER SEEDS SPIRAL IN FIBONACCI NUMBERS.",
    "EVERY ODD NUMBER HAS AN E IN ITS NAME.",
    "A MOBIUS STRIP HAS ONLY ONE SIDE.",
    "ADD ONE THROUGH ONE HUNDRED AND YOU GET 5050.",
    "YOUR PHONE USES PRIME NUMBERS TO KEEP SECRETS.",
    "ONE IS NOT A PRIME NUMBER.",
    "TWELVE PLUS ONE IS AN ANAGRAM OF ELEVEN PLUS TWO.",
    "MATH IS THE SECRET LANGUAGE OF THE UNIVERSE.",
    "A CIRCLE HOLDS THE MOST AREA FOR ITS PERIMETER.",
  ];

  const VIG_KEYS = ["SUM", "ODD", "TEN", "PIE", "CUBE", "ZERO", "AXIS", "MATH", "SINE", "PRIME", "ANGLE", "GRAPH", "RATIO", "PROOF", "DIGIT"];

  return {
    ALPHA, isLetter, mod, shiftChar,
    caesarEncrypt, caesarDecrypt, vigenereEncrypt, vigenereDecrypt,
    randomSubKey, subEncrypt, subDecrypt, invertKey, letterCounts,
    ENGLISH, ENGLISH_ORDER, MESSAGES, VIG_KEYS,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CipherLogic;

/* ---------- UI ---------- */
if (typeof document !== "undefined") (function () {
  "use strict";
  const C = CipherLogic;
  const ALPHA = C.ALPHA;
  const SLOT_COLORS = ["#ff8a3d", "#4cc9f0", "#5be37d", "#ff5d9e", "#ffd23f"];
  const $ = (id) => document.getElementById(id);

  const msgEl = $("msg"), taskEl = $("task"), hintBox = $("hintBox");
  const timerEl = $("timer"), hintsEl = $("hints"), levelNameEl = $("levelName");
  const tools = { 1: $("caesarTools"), 2: $("subTools"), 3: $("vigTools") };
  const levelBtns = Array.from(document.querySelectorAll("#levels .btn"));

  const LEVELS = {
    1: {
      name: "Level 1 · Caesar Shift",
      task: "Julius Caesar hid messages by sliding every letter the <b>same number of steps</b> down the alphabet. Spin the wheel until the blue row turns into real words!",
    },
    2: {
      name: "Level 2 · Letter Swap",
      task: "Every letter was swapped for a different one. <b>Tap a secret letter</b>, then tap the letter you think it really is. Use the bar charts: the most common English letter is <b>E</b>!",
    },
    3: {
      name: "Level 3 · Vigenère (bonus!)",
      task: "A secret <b>keyword</b> gives several Caesar shifts that take turns. Spin each keyword letter until the words make sense. Stuck? A hint reveals the keyword's length.",
    },
  };

  let level = 1;
  let plain = "", cipher = "";
  let lastMsg = -1;
  let solved = false;
  let hints = 0, hintStep = 0;
  let startTime = 0, endTime = 0;

  // level 1
  let trueShift = 0, userShift = 0, wheelS = 0, wheelTarget = 0, wheelAnim = 0, dragging = null;
  // level 2
  let subKey = "", invKey = "", guesses = {}, locked = {}, selected = null, msgLetters = [];
  // level 3
  let vigKey = "", userLen = 3, userKey = [0, 0, 0, 0, 0], lockedSlots = {}, lengthRevealed = false;

  // Tap that ignores scroll gestures, and works for fast repeated taps
  // (common.js suppresses quick double-tap clicks, so we don't rely on "click").
  function onTap(el, fn) {
    let id = null, sx = 0, sy = 0;
    el.addEventListener("pointerdown", (e) => { id = e.pointerId; sx = e.clientX; sy = e.clientY; });
    el.addEventListener("pointerup", (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (Math.abs(e.clientX - sx) < 14 && Math.abs(e.clientY - sy) < 14) fn(e);
    });
    el.addEventListener("pointercancel", () => (id = null));
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  setInterval(() => {
    if (!startTime) return;
    timerEl.textContent = fmtTime((solved ? endTime : performance.now()) - startTime);
  }, 250);

  function showHint(html) {
    hintBox.innerHTML = html;
    hintBox.hidden = false;
  }
  function bumpHints() {
    hints++;
    hintsEl.textContent = hints;
  }

  // ---------- message rendering ----------
  // decodeFn(ch, letterIndex) → {p: decoded letter or "", cls: extra class, style: inline style}
  function renderMsg() {
    let html = "", li = 0;
    const words = cipher.split(" ");
    msgEl.className = "msg lvl" + level + (solved ? " solved" : "");
    words.forEach((w) => {
      html += '<span class="word">';
      for (const ch of w) {
        if (C.isLetter(ch)) {
          const d = decode(ch, li++);
          html += `<span class="ch letter${d.cls || ""}" data-c="${ch}"${d.style ? ` style="${d.style}"` : ""}><span class="c">${ch}</span><span class="p">${d.p}</span></span>`;
        } else {
          html += `<span class="ch punct"><span class="c">${ch}</span><span class="p">${ch}</span></span>`;
        }
      }
      html += "</span>";
    });
    msgEl.innerHTML = html;
  }

  function decode(ch, li) {
    if (level === 1) return { p: C.shiftChar(ch, -userShift) };
    if (level === 2) {
      let cls = "";
      if (ch === selected) cls += " sel";
      if (locked[ch]) cls += " locked";
      return { p: guesses[ch] || "", cls };
    }
    const slot = li % userLen;
    return { p: C.shiftChar(ch, -userKey[slot]), style: `--k:${SLOT_COLORS[slot]}` };
  }

  // ---------- game flow ----------
  function newMessage() {
    let i;
    do i = Math.floor(Math.random() * C.MESSAGES.length); while (i === lastMsg && C.MESSAGES.length > 1);
    lastMsg = i;
    plain = C.MESSAGES[i];
    solved = false;
    hints = 0;
    hintStep = 0;
    hintsEl.textContent = 0;
    hintBox.hidden = true;
    startTime = performance.now();
    timerEl.textContent = "0:00";

    if (level === 1) {
      trueShift = 3 + Math.floor(Math.random() * 21); // 3..23
      cipher = C.caesarEncrypt(plain, trueShift);
      userShift = 0;
      wheelS = wheelTarget = 0;
      updateShiftUI();
      drawWheel();
    } else if (level === 2) {
      subKey = C.randomSubKey();
      invKey = C.invertKey(subKey);
      cipher = C.subEncrypt(plain, subKey);
      guesses = {};
      locked = {};
      const counts = C.letterCounts(cipher);
      msgLetters = ALPHA.split("").filter((ch) => counts[ch.charCodeAt(0) - 65] > 0);
      msgLetters.sort((a, b) => counts[b.charCodeAt(0) - 65] - counts[a.charCodeAt(0) - 65] || (a < b ? -1 : 1));
      selected = msgLetters[0];
      buildKeypad();
    } else {
      vigKey = C.VIG_KEYS[Math.floor(Math.random() * C.VIG_KEYS.length)];
      cipher = C.vigenereEncrypt(plain, vigKey);
      userLen = 3;
      userKey = [0, 0, 0, 0, 0];
      lockedSlots = {};
      lengthRevealed = false;
      buildWheels();
    }
    renderAll();
  }

  function renderAll() {
    renderMsg();
    if (level === 2) renderSubTools();
    if (level === 3) renderWheels();
  }

  function setLevel(l) {
    level = l;
    levelBtns.forEach((b) => b.classList.toggle("on", +b.dataset.level === l));
    Object.keys(tools).forEach((k) => (tools[k].hidden = +k !== l));
    levelNameEl.textContent = LEVELS[l].name;
    taskEl.innerHTML = LEVELS[l].task;
    $("scroller").scrollTop = 0;
    newMessage();
  }

  function isCorrect() {
    if (level === 1) return C.mod(userShift - trueShift, 26) === 0;
    if (level === 2) return msgLetters.every((ch) => guesses[ch] === invKey[ch.charCodeAt(0) - 65]);
    return C.vigenereDecrypt(cipher, userKeyString()) === plain;
  }

  function checkSolved() {
    if (solved || !isCorrect()) return false;
    solved = true;
    endTime = performance.now();
    renderAll();
    MP.confetti();
    const time = fmtTime(endTime - startTime);
    setTimeout(() => {
      const buttons = [{ label: "🎲 Next message", primary: true, onClick: newMessage }];
      if (level < 3) buttons.push({ label: `Try level ${level + 1} ▶`, onClick: () => setLevel(level + 1) });
      else buttons.push({ label: "Close" });
      MP.modal({
        title: "Code cracked! 🔓",
        html: `<p style="font-family:ui-monospace,Menlo,monospace;font-weight:700;color:var(--good);margin:6px 0 12px">${plain}</p>` +
          `⏱ ${time} &nbsp;·&nbsp; 💡 ${hints} hint${hints === 1 ? "" : "s"}` +
          (level === 3 ? `<br>The keyword was <b>${vigKey}</b>.` : level === 1 ? `<br>The shift was <b>${trueShift}</b>.` : ""),
        buttons,
      });
    }, 700);
    return true;
  }

  function reveal() {
    if (solved) return;
    if (level === 1) { setShift(trueShift, true); }
    else if (level === 2) { msgLetters.forEach((ch) => (guesses[ch] = invKey[ch.charCodeAt(0) - 65])); }
    else {
      userLen = vigKey.length;
      for (let i = 0; i < userLen; i++) userKey[i] = vigKey.charCodeAt(i) - 65;
    }
    solved = true;
    endTime = performance.now();
    renderAll();
    if (level === 1) { updateShiftUI(); }
    showHint("Here's the answer" + (level === 3 ? ` (keyword <b>${vigKey}</b>)` : level === 1 ? ` (shift <b>${trueShift}</b>)` : "") + ". Tap <b>New message</b> to try another!");
  }

  // ---------- level 1: Caesar wheel ----------
  const wheelCanvas = $("wheel");
  const wheel = MP.setupCanvas(wheelCanvas, () => drawWheel());
  const STEP = (Math.PI * 2) / 26;

  function drawWheel() {
    const ctx = wheel.ctx, W = wheel.w, H = wheel.h;
    if (W < 20 || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 3;
    const band = R * 0.2;
    const r1 = R, r2 = R - band, r3 = r2 - band;

    // outer ring (real letters, fixed)
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, Math.PI * 2);
    ctx.fillStyle = "#2a3066";
    ctx.fill();
    // inner ring (secret letters, rotates)
    ctx.beginPath();
    ctx.arc(cx, cy, r2, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx, cy, r3, cx, cy, r2);
    g.addColorStop(0, "#ff7a2a");
    g.addColorStop(1, "#ffa45c");
    ctx.fillStyle = g;
    ctx.fill();
    // hub
    ctx.beginPath();
    ctx.arc(cx, cy, r3, 0, Math.PI * 2);
    ctx.fillStyle = "#171b38";
    ctx.fill();

    // highlight window at the top
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r1 + 1, -Math.PI / 2 - STEP / 2, -Math.PI / 2 + STEP / 2);
    ctx.arc(cx, cy, r3, -Math.PI / 2 + STEP / 2, -Math.PI / 2 - STEP / 2, true);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = Math.round(band * 0.62);
    // outer letters
    ctx.font = `800 ${fs}px ui-monospace, Menlo, monospace`;
    for (let i = 0; i < 26; i++) {
      const a = i * STEP - Math.PI / 2;
      const rr = (r1 + r2) / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = "#eef0ff";
      ctx.fillText(ALPHA[i], 0, 0);
      ctx.restore();
    }
    // inner letters (secret alphabet), rotated by the current shift
    for (let j = 0; j < 26; j++) {
      const a = (j - wheelS) * STEP - Math.PI / 2;
      const rr = (r2 + r3) / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = "#2a1200";
      ctx.fillText(ALPHA[j], 0, 0);
      ctx.restore();
    }
    // tick lines on rings
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const a = (i + 0.5) * STEP - Math.PI / 2;
      ctx.moveTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      const b = (i + 0.5 - wheelS) * STEP - Math.PI / 2;
      ctx.moveTo(cx + Math.cos(b) * r3, cy + Math.sin(b) * r3);
      ctx.lineTo(cx + Math.cos(b) * r2, cy + Math.sin(b) * r2);
    }
    ctx.stroke();

    // hub text
    ctx.fillStyle = "#a5abd6";
    ctx.font = `600 ${Math.round(r3 * 0.22)}px -apple-system, sans-serif`;
    ctx.fillText("shift", cx, cy - r3 * 0.32);
    ctx.fillStyle = solved && level === 1 ? "#5be37d" : "#eef0ff";
    ctx.font = `800 ${Math.round(r3 * 0.62)}px -apple-system, sans-serif`;
    ctx.fillText(String(C.mod(Math.round(wheelS), 26)), cx, cy + r3 * 0.18);
  }

  function updateShiftUI() {
    $("shiftVal").textContent = userShift;
    const ex = [0, 1, 2].map((i) => `<i>${ALPHA[i]}</i>→<b>${ALPHA[(i + userShift) % 26]}</b>`).join("&nbsp; ");
    $("shiftMap").innerHTML = ex + " …";
  }

  // Shift value changed (live, while spinning) → refresh decoding
  function liveShift(s) {
    const k = C.mod(Math.round(s), 26);
    if (k !== userShift) {
      userShift = k;
      updateShiftUI();
      renderMsg();
    }
  }

  function animateWheel() {
    if (wheelAnim) return;
    const step = () => {
      const d = wheelTarget - wheelS;
      if (Math.abs(d) < 0.01) {
        wheelS = wheelTarget;
        wheelAnim = 0;
        drawWheel();
        liveShift(wheelS);
        checkSolved();
        return;
      }
      wheelS += d * 0.28;
      liveShift(wheelS);
      drawWheel();
      wheelAnim = requestAnimationFrame(step);
    };
    wheelAnim = requestAnimationFrame(step);
  }

  function setShift(k, absolute) {
    if (absolute) {
      // go to shift k via the shortest way around
      const cur = Math.round(wheelTarget);
      let d = C.mod(k - cur, 26);
      if (d > 13) d -= 26;
      wheelTarget = cur + d;
    } else wheelTarget = Math.round(wheelTarget) + k;
    animateWheel();
  }

  function wheelAngle(e) {
    const p = MP.pos(e, wheelCanvas);
    return Math.atan2(p.y - wheel.h / 2, p.x - wheel.w / 2);
  }
  wheelCanvas.addEventListener("pointerdown", (e) => {
    if (solved || level !== 1) return;
    e.preventDefault();
    wheelCanvas.setPointerCapture(e.pointerId);
    if (wheelAnim) { cancelAnimationFrame(wheelAnim); wheelAnim = 0; }
    dragging = { id: e.pointerId, a: wheelAngle(e) };
  });
  wheelCanvas.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const a = wheelAngle(e);
    let da = a - dragging.a;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    dragging.a = a;
    wheelS -= da / STEP;
    wheelTarget = wheelS;
    liveShift(wheelS);
    drawWheel();
  });
  function endWheelDrag(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    dragging = null;
    wheelTarget = Math.round(wheelS);
    animateWheel();
  }
  wheelCanvas.addEventListener("pointerup", endWheelDrag);
  wheelCanvas.addEventListener("pointercancel", endWheelDrag);

  onTap($("shiftDown"), () => { if (!solved) setShift(-1); });
  onTap($("shiftUp"), () => { if (!solved) setShift(1); });

  // ---------- level 2: substitution ----------
  const keypad = $("keypad");
  function buildKeypad() {
    if (keypad.childElementCount) return;
    let html = "";
    for (const ch of ALPHA) html += `<button class="key" data-k="${ch}">${ch}</button>`;
    html += `<button class="key del" data-k="">⌫ Erase</button>`;
    keypad.innerHTML = html;
  }

  function renderSubTools() {
    const used = {};
    Object.keys(guesses).forEach((c) => (used[guesses[c]] = c));
    const cur = selected ? guesses[selected] : null;
    Array.from(keypad.children).forEach((k) => {
      const ch = k.dataset.k;
      if (!ch) return;
      k.classList.toggle("used", !!used[ch] && ch !== cur);
      k.classList.toggle("cur", !!cur && ch === cur);
    });

    // frequency charts
    const counts = C.letterCounts(cipher);
    const totalLetters = counts.reduce((a, b) => a + b, 0) || 1;
    const nShow = msgLetters.length;
    const engTop = C.ENGLISH_ORDER.slice(0, nShow);
    const maxPct = Math.max((counts[msgLetters[0].charCodeAt(0) - 65] / totalLetters) * 100, C.ENGLISH.E);
    let h = "";
    msgLetters.forEach((ch) => {
      const pct = (counts[ch.charCodeAt(0) - 65] / totalLetters) * 100;
      h += `<div class="bar${ch === selected ? " sel" : ""}" data-c="${ch}"><div class="fill" style="height:${(pct / maxPct) * 78}%"></div><div class="lab">${ch}</div><div class="gs">${guesses[ch] || ""}</div></div>`;
    });
    $("barsMsg").innerHTML = h;
    h = "";
    engTop.forEach((ch) => {
      h += `<div class="bar"><div class="fill" style="height:${(C.ENGLISH[ch] / maxPct) * 80}%"></div><div class="lab">${ch}</div></div>`;
    });
    $("barsEng").innerHTML = h;
  }

  function selectLetter(ch) {
    if (level !== 2 || solved) return;
    selected = ch;
    renderAll();
  }

  function assign(letter) {
    if (level !== 2 || solved) return;
    if (!selected) { MP.toast("Tap a secret letter first"); return; }
    if (locked[selected]) { MP.toast("That letter was revealed by a hint 🔒"); return; }
    if (letter) {
      const owner = Object.keys(guesses).find((c) => guesses[c] === letter && c !== selected);
      if (owner && locked[owner]) {
        MP.toast(`${letter} is already locked in by a hint`);
        keypad.classList.remove("shake");
        void keypad.offsetWidth;
        keypad.classList.add("shake");
        return;
      }
      if (owner) delete guesses[owner];
      guesses[selected] = letter;
      // auto-advance to the next empty letter in the message
      const order = [];
      for (const ch of cipher) if (C.isLetter(ch) && order.indexOf(ch) < 0) order.push(ch);
      const start = order.indexOf(selected);
      for (let i = 1; i <= order.length; i++) {
        const c = order[(start + i) % order.length];
        if (!guesses[c]) { selected = c; break; }
      }
    } else {
      delete guesses[selected];
    }
    renderAll();
    if (!checkSolved() && msgLetters.every((c) => guesses[c])) {
      MP.toast("Every letter is filled in… but something's not right yet 🤔", 2600);
    }
  }

  onTap(keypad, (e) => {
    const k = e.target.closest(".key");
    if (k) assign(k.dataset.k);
  });
  onTap(msgEl, (e) => {
    const ch = e.target.closest(".ch.letter");
    if (ch && level === 2) selectLetter(ch.dataset.c);
  });
  onTap($("barsMsg"), (e) => {
    const b = e.target.closest(".bar");
    if (b) selectLetter(b.dataset.c);
  });

  // ---------- level 3: Vigenère ----------
  const wheelsEl = $("wheels");
  const lenBtns = Array.from(document.querySelectorAll("#vigLen .btn"));

  function userKeyString() {
    let s = "";
    for (let i = 0; i < userLen; i++) s += ALPHA[userKey[i]];
    return s;
  }

  function buildWheels() {
    let html = "";
    for (let i = 0; i < userLen; i++) {
      html += `<div class="kw" data-slot="${i}" style="--k:${SLOT_COLORS[i]}">
        <button class="btn up" aria-label="next letter">▲</button>
        <div class="letter"><span class="L"></span><small></small></div>
        <button class="btn down" aria-label="previous letter">▼</button>
      </div>`;
    }
    wheelsEl.innerHTML = html;
  }

  function renderWheels() {
    lenBtns.forEach((b) => {
      b.classList.toggle("on", +b.dataset.len === userLen);
      b.classList.toggle("dim", lengthRevealed && +b.dataset.len !== userLen);
    });
    if (wheelsEl.childElementCount !== userLen) buildWheels();
    Array.from(wheelsEl.children).forEach((kw, i) => {
      kw.querySelector(".L").textContent = ALPHA[userKey[i]];
      kw.querySelector("small").textContent = "shift " + userKey[i];
      kw.classList.toggle("locked", !!lockedSlots[i]);
      kw.querySelectorAll(".btn").forEach((b) => (b.disabled = !!lockedSlots[i] || solved));
    });
    $("kwWord").textContent = userKeyString();
  }

  function spinSlot(i, d) {
    if (solved || lockedSlots[i]) return;
    userKey[i] = C.mod(userKey[i] + d, 26);
    renderMsg();
    renderWheels();
    checkSolved();
  }

  onTap(wheelsEl, (e) => {
    const b = e.target.closest(".btn");
    if (!b) return;
    const i = +b.closest(".kw").dataset.slot;
    spinSlot(i, b.classList.contains("up") ? 1 : -1);
  });

  // swipe a keyword letter up/down to spin it
  let swipe = null;
  wheelsEl.addEventListener("pointerdown", (e) => {
    const l = e.target.closest(".letter");
    if (!l) return;
    e.preventDefault();
    l.setPointerCapture(e.pointerId);
    swipe = { id: e.pointerId, y: e.clientY, slot: +l.closest(".kw").dataset.slot };
  });
  wheelsEl.addEventListener("pointermove", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dy = e.clientY - swipe.y;
    if (Math.abs(dy) >= 26) {
      spinSlot(swipe.slot, dy < 0 ? 1 : -1);
      swipe.y = e.clientY;
    }
  });
  const endSwipe = (e) => { if (swipe && e.pointerId === swipe.id) swipe = null; };
  wheelsEl.addEventListener("pointerup", endSwipe);
  wheelsEl.addEventListener("pointercancel", endSwipe);

  lenBtns.forEach((b) => {
    b.onclick = () => {
      if (solved) return;
      if (lengthRevealed) { MP.toast(`The keyword has ${vigKey.length} letters`); return; }
      userLen = +b.dataset.len;
      renderAll();
      checkSolved();
    };
  });

  // ---------- hints ----------
  function hint() {
    if (solved) return;
    if (level === 1) {
      const counts = C.letterCounts(cipher);
      const top = ALPHA[counts.indexOf(Math.max.apply(null, counts))];
      if (hintStep === 0) {
        showHint(`The most common secret letter here is <b>${top}</b>. In English, <b>E</b> is the most common letter. What shift turns E into ${top}?`);
      } else if (hintStep === 1) {
        const first = cipher.split("").find(C.isLetter);
        showHint(`The first secret letter <b>${first}</b> really stands for <b>${C.shiftChar(first, -trueShift)}</b>.`);
      } else {
        showHint(`The shift is <b>${trueShift}</b>. Spinning there now!`);
        setShift(trueShift, true);
      }
      hintStep++;
      bumpHints();
    } else if (level === 2) {
      const counts = C.letterCounts(cipher);
      const wrong = msgLetters.filter((ch) => guesses[ch] !== invKey[ch.charCodeAt(0) - 65]);
      if (!wrong.length) return;
      wrong.sort((a, b) => counts[b.charCodeAt(0) - 65] - counts[a.charCodeAt(0) - 65]);
      const c = wrong[0], p = invKey[c.charCodeAt(0) - 65];
      Object.keys(guesses).forEach((k) => { if (guesses[k] === p) delete guesses[k]; });
      guesses[c] = p;
      locked[c] = true;
      selected = c;
      bumpHints();
      showHint(`Secret letter <b>${c}</b> really means <b>${p}</b>. 🔒`);
      renderAll();
      checkSolved();
    } else {
      if (!lengthRevealed) {
        lengthRevealed = true;
        bumpHints();
        if (userLen !== vigKey.length) {
          userLen = vigKey.length;
          showHint(`The keyword has <b>${vigKey.length}</b> letters. Now each color is one simple Caesar shift!`);
          renderAll();
          checkSolved();
          return;
        }
        // length was already right: fall through and also give a letter
      } else bumpHints();
      let slot = -1;
      for (let i = 0; i < userLen; i++) if (userKey[i] !== vigKey.charCodeAt(i) - 65) { slot = i; break; }
      if (slot < 0) return;
      userKey[slot] = vigKey.charCodeAt(slot) - 65;
      lockedSlots[slot] = true;
      showHint(`The keyword has <b>${vigKey.length}</b> letters, and letter #${slot + 1} is <b>${vigKey[slot]}</b>. 🔒`);
      renderAll();
      checkSolved();
    }
  }

  // ---------- controls ----------
  levelBtns.forEach((b) => (b.onclick = () => setLevel(+b.dataset.level)));
  $("newBtn").onclick = newMessage;
  $("hintBtn").onclick = hint;
  $("revealBtn").onclick = reveal;

  setLevel(1);
})();
