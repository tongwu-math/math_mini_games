/* Math Playground — shared helpers. Exposes a single global: MP */
(function () {
  "use strict";

  const MP = {};
  window.MP = MP;

  // ---------- block iOS zoom / bounce / callouts ----------
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false })
  );
  // Double-tap zoom is turned off with CSS (touch-action: manipulation in style.css),
  // so quick repeated taps on buttons still fire every click.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) return e.preventDefault();
      if (!e.target.closest(".drawer, .scroll, .controls, input[type=range]")) e.preventDefault();
    },
    { passive: false }
  );
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(".allow-callout")) e.preventDefault();
  });

  // ---------- canvas with devicePixelRatio + auto resize ----------
  // onResize(w, h) is called with CSS-pixel size whenever the canvas changes size
  // (the first call is deferred to a microtask; state.w/h are set immediately).
  // ctx is pre-scaled so you draw in CSS pixels.
  MP.setupCanvas = function (canvas, onResize, opts) {
    opts = opts || {};
    const ctx = opts.noContext ? null : canvas.getContext("2d", opts.ctxOptions);
    const state = { canvas, ctx, w: 0, h: 0, dpr: 1 };
    let first = true;
    function fit() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      if (w === state.w && h === state.h && dpr === state.dpr) return;
      state.w = w;
      state.h = h;
      state.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!onResize) return;
      if (first) {
        // Defer the very first callback so `const s = MP.setupCanvas(c, () => draw(s))` is safe.
        first = false;
        Promise.resolve().then(() => onResize(state.w, state.h));
      } else onResize(w, h);
    }
    if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", () => setTimeout(fit, 250));
    fit();
    state.fit = fit;
    return state;
  };

  // Pointer position relative to an element, in CSS pixels.
  MP.pos = function (e, el) {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  MP.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  MP.lerp = (a, b, t) => a + (b - a) * t;
  MP.hsl = (h, s, l, a) => (a == null ? `hsl(${h},${s}%,${l}%)` : `hsla(${h},${s}%,${l}%,${a})`);

  // Bind a range input to a value label and callback. Returns the input.
  MP.slider = function (id, onChange, fmt) {
    const input = document.getElementById(id);
    const label = document.getElementById(id + "Val");
    const update = () => {
      const v = parseFloat(input.value);
      if (label) label.textContent = fmt ? fmt(v) : v;
      if (onChange) onChange(v);
    };
    input.addEventListener("input", update);
    update();
    return input;
  };

  // ---------- toast ----------
  let toastEl, toastTimer;
  MP.toast = function (msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms || 1800);
  };

  // ---------- modal ----------
  // MP.modal({title, html, buttons:[{label, primary, onClick}]})
  let modalEl;
  MP.modal = function (o) {
    if (!modalEl) {
      modalEl = document.createElement("div");
      modalEl.className = "modal";
      modalEl.innerHTML = '<div class="card"></div>';
      // tapping the dark backdrop (not the card) closes it
      modalEl.addEventListener("click", (e) => e.target === modalEl && MP.closeModal());
      document.body.appendChild(modalEl);
    }
    const card = modalEl.firstChild;
    card.innerHTML = `<h2>${o.title || ""}</h2><div>${o.html || ""}</div><div class="btns"></div>`;
    const btns = card.querySelector(".btns");
    (o.buttons || [{ label: "OK", primary: true }]).forEach((b) => {
      const el = document.createElement("button");
      el.className = "btn" + (b.primary ? " primary" : "");
      el.textContent = b.label;
      el.onclick = () => {
        MP.closeModal();
        if (b.onClick) b.onClick();
      };
      btns.appendChild(el);
    });
    modalEl.classList.add("open");
  };
  MP.closeModal = () => modalEl && modalEl.classList.remove("open");

  // ---------- confetti ----------
  MP.confetti = function (count) {
    const c = document.createElement("canvas");
    c.id = "confetti";
    document.body.appendChild(c);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth,
      H = window.innerHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    const parts = [];
    for (let i = 0; i < (count || 160); i++) {
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * 200,
        y: H * 0.35,
        vx: (Math.random() - 0.5) * 16,
        vy: -Math.random() * 16 - 4,
        s: 6 + Math.random() * 8,
        r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
        c: `hsl(${Math.random() * 360},90%,60%)`,
      });
    }
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.vy += 0.45;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (t - t0 < 3500) requestAnimationFrame(frame);
      else c.remove();
    })(t0);
  };

  // ---------- explainer drawer ----------
  function setupDrawer() {
    const drawer = document.getElementById("drawer");
    const btn = document.getElementById("mathBtn");
    if (!drawer || !btn) return;
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    document.body.appendChild(scrim);
    if (!drawer.querySelector(".close")) {
      const x = document.createElement("button");
      x.className = "btn small close";
      x.textContent = "✕";
      x.setAttribute("aria-label", "Close");
      drawer.prepend(x);
    }
    const open = () => {
      drawer.classList.add("open");
      scrim.classList.add("open");
    };
    const close = () => {
      drawer.classList.remove("open");
      scrim.classList.remove("open");
    };
    btn.addEventListener("click", () => (drawer.classList.contains("open") ? close() : open()));
    scrim.addEventListener("click", close);
    drawer.querySelector(".close").addEventListener("click", close);
    MP.closeDrawer = close;
  }

  // ---------- kiosk idle reset ----------
  // Enable with ?kiosk=1 (remembered), disable with ?kiosk=0.
  function setupKiosk() {
    const q = new URLSearchParams(location.search).get("kiosk");
    try {
      if (q === "1") localStorage.setItem("mp-kiosk", "1");
      if (q === "0") localStorage.removeItem("mp-kiosk");
      if (localStorage.getItem("mp-kiosk") !== "1") return;
    } catch (e) {
      if (q !== "1") return;
    }
    const IDLE_MS = 120000;
    const isHome = !/\/demos\//.test(location.pathname);
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (isHome) location.reload();
        else location.href = "../index.html";
      }, IDLE_MS);
    };
    ["pointerdown", "pointermove", "keydown", "touchstart"].forEach((t) =>
      window.addEventListener(t, reset, { passive: true })
    );
    reset();
  }

  // ---------- service worker (offline) ----------
  function registerSW() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    // Skip on local dev servers (stale caches get confusing) unless ?sw=1 is given.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (local && !/[?&]sw=1/.test(location.search)) return;
    const isDemo = /\/demos\//.test(location.pathname);
    navigator.serviceWorker.register(isDemo ? "../sw.js" : "sw.js").catch(() => {});
  }

  // ---------- "play on your phone" QR (links to the home page) ----------
  // Phones (not tablets) get html.is-phone so CSS can hide the QR there.
  MP.isPhone = /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile.+Firefox/i.test(navigator.userAgent);
  if (MP.isPhone) document.documentElement.classList.add("is-phone");
  const isDemoPage = /\/demos\//.test(location.pathname);
  MP.qrSrc = (isDemoPage ? "../" : "") + "icons/qr.svg";
  MP.showQR = function () {
    MP.modal({
      title: "Play on your phone 📱",
      html:
        `<img class="qr-big" src="${MP.qrSrc}" alt="QR code for the Math Playground website">` +
        `<p>Point your phone's camera at the code.</p>`,
      buttons: [{ label: "Close", primary: true }],
    });
  };
  function setupQR() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const b = document.createElement("button");
    b.className = "qr-badge";
    b.setAttribute("aria-label", "Show QR code to play on your phone");
    b.innerHTML = `<img src="${MP.qrSrc}" alt="">`;
    b.addEventListener("click", MP.showQR);
    bar.appendChild(b);
  }

  // Short labels for the top-bar buttons on small screens (CSS picks .long or .short).
  function setupTopbarLabels() {
    const home = document.querySelector('.topbar a.btn[href$="index.html"]');
    if (home) home.innerHTML = '◀<span class="long">&nbsp;Home</span>';
    const math = document.getElementById("mathBtn");
    if (math) math.innerHTML = '<span class="long">Where\'s the math?</span><span class="short">Math?</span>';
  }

  // Esc closes the explainer and any pop-up (laptops / keyboards).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    MP.closeModal();
    if (MP.closeDrawer) MP.closeDrawer();
  });

  function init() {
    setupTopbarLabels();
    setupDrawer();
    setupQR();
    setupKiosk();
    registerSW();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
