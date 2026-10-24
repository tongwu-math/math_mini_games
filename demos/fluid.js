/* Fluid Paint: Jos Stam's "Stable Fluids" running on the GPU.
   WebGL2 (half-float render targets) with a WebGL1 fallback.
   Classic script, no modules, no dependencies. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let canvas = $("fluid");
  const hint = $("hint");
  const msgBox = $("glmsg");
  const msgText = $("glmsgText");

  // ---------- tunables ----------
  const CFG = {
    pressureIters: 20,
    pressureDecay: 0.8, // fraction of last frame's pressure kept as the Jacobi starting guess
    velDissipation: 0.2,
    dyeDissipation: 0.12, // overwritten by the Fade slider
    curl: 30,
    splatRadius: 0.0022, // gaussian "radius²" in screen-height units
    dyeAmount: 0.2,
    forceBoost: 1.25,
  };
  // Quality ladder: sim = velocity/pressure grid (short side), dye = color texture (short side).
  const LEVELS = [
    { sim: 128, dye: 1024 },
    { sim: 128, dye: 768 },
    { sim: 112, dye: 512 },
    { sim: 96, dye: 384 },
  ];
  const MAX_SPLATS = 12; // splats per GPU pass
  const BG = [15 / 255, 18 / 255, 38 / 255];

  // ---------- shaders (GLSL ES 1.00, valid in WebGL1 and WebGL2) ----------
  const VERT = `
attribute vec2 aPosition;
uniform vec2 texelSize;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  const FRAG_HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
// Bilinear sample. Uses hardware filtering when available, else does it by hand.
vec4 bilerp (sampler2D tex, vec2 uv, vec2 ts) {
#ifdef MANUAL_FILTERING
  vec2 st = uv / ts - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec4 a = texture2D(tex, (i + vec2(0.5, 0.5)) * ts);
  vec4 b = texture2D(tex, (i + vec2(1.5, 0.5)) * ts);
  vec4 c = texture2D(tex, (i + vec2(0.5, 1.5)) * ts);
  vec4 d = texture2D(tex, (i + vec2(1.5, 1.5)) * ts);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
#else
  return texture2D(tex, uv);
#endif
}
`;

  const FS = {
    // Copy with a multiplier (used for pressure decay, clearing, and resampling on resize).
    scale: `
uniform sampler2D uTexture;
uniform float uValue;
void main () { gl_FragColor = uValue * texture2D(uTexture, vUv); }`,

    // Add up to MAX_SPLATS gaussian blobs in one pass.
    splat: `
uniform sampler2D uTarget;
uniform float uAspect;
uniform int uCount;
uniform vec4 uPoint[MAX_SPLATS];
uniform vec4 uColor[MAX_SPLATS];
void main () {
  vec3 sum = texture2D(uTarget, vUv).xyz;
  for (int i = 0; i < MAX_SPLATS; i++) {
    if (i >= uCount) break;
    vec2 d = vUv - uPoint[i].xy;
    d.x *= uAspect;
    sum += exp(-dot(d, d) / uPoint[i].z) * uColor[i].xyz;
  }
  gl_FragColor = vec4(sum, 1.0);
}`,

    // Vorticity (scalar curl in 2D): w = dv/dx - du/dy.
    curl: `
uniform sampler2D uVelocity;
void main () {
  float vL_ = texture2D(uVelocity, vL).y;
  float vR_ = texture2D(uVelocity, vR).y;
  float uT_ = texture2D(uVelocity, vT).x;
  float uB_ = texture2D(uVelocity, vB).x;
  float w = 0.5 * ((vR_ - vL_) - (uT_ - uB_));
  gl_FragColor = vec4(w, 0.0, 0.0, 1.0);
}`,

    // Vorticity confinement: f = eps * (N x w), N = grad|w| / |grad|w||.
    vorticity: `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uStrength;
uniform float dt;
void main () {
  float wL = abs(texture2D(uCurl, vL).x);
  float wR = abs(texture2D(uCurl, vR).x);
  float wT = abs(texture2D(uCurl, vT).x);
  float wB = abs(texture2D(uCurl, vB).x);
  float w = texture2D(uCurl, vUv).x;
  vec2 g = 0.5 * vec2(wR - wL, wT - wB);
  vec2 N = g / (length(g) + 1e-5);
  vec2 force = uStrength * w * vec2(N.y, -N.x);
  vec2 vel = texture2D(uVelocity, vUv).xy + force * dt;
  gl_FragColor = vec4(clamp(vel, -3000.0, 3000.0), 0.0, 1.0);
}`,

    // Divergence with solid (no-through-flow) walls.
    divergence: `
uniform sampler2D uVelocity;
void main () {
  vec2 C = texture2D(uVelocity, vUv).xy;
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,

    // One Jacobi sweep for  laplacian(p) = div  (grid spacing 1).
    pressure: `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4(0.25 * (L + R + T + B - div), 0.0, 0.0, 1.0);
}`,

    // Projection: u <- u - grad p  (makes the flow divergence-free).
    gradient: `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 vel = texture2D(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}`,

    // Semi-Lagrangian advection: look backwards along the flow, sample, and fade.
    advect: `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 velTexel;
uniform vec2 srcTexel;
uniform float dt;
uniform float dissipation;
void main () {
  vec2 back = vUv - dt * bilerp(uVelocity, vUv, velTexel).xy * velTexel;
  vec4 q = bilerp(uSource, back, srcTexel);
  gl_FragColor = q / (1.0 + dissipation * dt);
}`,

    // Final image: soft tone-map, fake lighting from the dye "height", and a glossy sheen.
    display: `
uniform sampler2D uTexture;
uniform vec2 dyeTexel;
uniform vec3 uBg;
void main () {
  vec3 c = bilerp(uTexture, vUv, dyeTexel).rgb;
  float l = length(bilerp(uTexture, vL, dyeTexel).rgb);
  float r = length(bilerp(uTexture, vR, dyeTexel).rgb);
  float t = length(bilerp(uTexture, vT, dyeTexel).rgb);
  float b = length(bilerp(uTexture, vB, dyeTexel).rgb);
  vec3 n = normalize(vec3(l - r, b - t, 18.0 * dyeTexel.y));
  vec3 ld = normalize(vec3(-0.35, 0.55, 1.0));
  float diff = max(dot(n, ld), 0.0);
  float spec = pow(max(dot(reflect(-ld, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);

  vec3 col = vec3(1.0) - exp(-c * 1.6);
  float a = clamp(max(col.r, max(col.g, col.b)) * 1.5, 0.0, 1.0);
  col *= 0.68 + 0.4 * diff;
  col += vec3(spec * 0.22 * a);
  // a little glow: brighten the saturated cores
  col += 0.12 * col * col;

  vec2 q = vUv - 0.5;
  vec3 bg = uBg * (1.05 - dot(q, q) * 0.9);
  gl_FragColor = vec4(col + bg * (1.0 - a), 1.0);
}`,
  };

  // ---------- state ----------
  let gl = null;
  let isGL2 = false;
  let fmt = null; // detected texture formats
  let progs = null;
  let quad = null;
  let velocity, dye, pressure, divergence, curl;
  let level = 1;
  let lost = false;
  let needsResize = true;
  let frozen = false;
  let rainbow = false;
  let simTime = 0;
  let hintShown = true;
  let lastInteract = performance.now();
  let lastAttract = 0;
  const splatQueue = [];
  const pointers = new Map();
  let hue = Math.random();

  // ---------- context creation ----------
  const ATTRS = {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  };

  function probe(g, internal, format, type) {
    const tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null);
    const fb = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    const ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.deleteFramebuffer(fb);
    g.deleteTexture(tex);
    while (g.getError() !== g.NO_ERROR && !g.isContextLost()) {
      /* drain errors from unsupported probes */
    }
    return ok ? { internal: internal, format: format, type: type } : null;
  }

  function detectFormats(g, gl2) {
    if (gl2) {
      g.getExtension("EXT_color_buffer_float");
      g.getExtension("EXT_color_buffer_half_float");
      const type = g.HALF_FLOAT;
      const rgba = probe(g, g.RGBA16F, g.RGBA, type);
      if (!rgba) return null;
      const rg = probe(g, g.RG16F, g.RG, type) || rgba;
      const r = probe(g, g.R16F, g.RED, type) || rg;
      // 16-bit float textures are filterable in WebGL2 core.
      return { rgba: rgba, rg: rg, r: r, linear: true, name: "WebGL2 half-float" };
    }
    const hf = g.getExtension("OES_texture_half_float");
    if (hf) {
      g.getExtension("EXT_color_buffer_half_float");
      const f = probe(g, g.RGBA, g.RGBA, hf.HALF_FLOAT_OES);
      if (f) {
        const lin = !!g.getExtension("OES_texture_half_float_linear");
        return { rgba: f, rg: f, r: f, linear: lin, name: "WebGL1 half-float" };
      }
    }
    if (g.getExtension("OES_texture_float")) {
      g.getExtension("WEBGL_color_buffer_float");
      const f = probe(g, g.RGBA, g.RGBA, g.FLOAT);
      if (f) {
        const lin = !!g.getExtension("OES_texture_float_linear");
        return { rgba: f, rg: f, r: f, linear: lin, name: "WebGL1 float" };
      }
    }
    return null;
  }

  function createContext() {
    let g = null;
    try {
      g = canvas.getContext("webgl2", ATTRS);
    } catch (e) {
      g = null;
    }
    if (g) {
      const f = detectFormats(g, true);
      if (f) return { gl: g, gl2: true, fmt: f };
      // WebGL2 exists but can't render to float: swap in a fresh canvas and try WebGL1.
      const fresh = canvas.cloneNode(false);
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
    }
    try {
      g = canvas.getContext("webgl", ATTRS) || canvas.getContext("experimental-webgl", ATTRS);
    } catch (e) {
      g = null;
    }
    if (g) {
      const f = detectFormats(g, false);
      if (f) return { gl: g, gl2: false, fmt: f };
    }
    return null;
  }

  // ---------- GL helpers ----------
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error("Shader compile failed: " + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function makeProgram(vs, fsBody, defines) {
    const fs = compile(gl.FRAGMENT_SHADER, defines + FRAG_HEAD + fsBody);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, "aPosition");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error("Program link failed: " + gl.getProgramInfoLog(p));
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
    }
    return {
      use() {
        gl.useProgram(p);
        return u;
      },
    };
  }

  function createFBO(w, h, f, filter) {
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      tex: tex,
      fbo: fbo,
      w: w,
      h: h,
      attach(unit) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        return unit;
      },
      destroy() {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
      },
    };
  }

  function createDouble(w, h, f, filter) {
    let a = createFBO(w, h, f, filter);
    let b = createFBO(w, h, f, filter);
    return {
      w: w,
      h: h,
      tx: 1 / w,
      ty: 1 / h,
      get read() {
        return a;
      },
      get write() {
        return b;
      },
      swap() {
        const t = a;
        a = b;
        b = t;
      },
      destroy() {
        a.destroy();
        b.destroy();
      },
    };
  }

  function blit(target) {
    if (target) {
      gl.viewport(0, 0, target.w, target.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Resample an existing double buffer into a new size, keeping its picture.
  function resizeDouble(old, w, h, f, filter, valueScale) {
    if (old && old.w === w && old.h === h) return old;
    const next = createDouble(w, h, f, filter);
    if (old) {
      const u = progs.scale.use();
      gl.uniform2f(u.texelSize, 1 / w, 1 / h);
      gl.uniform1i(u.uTexture, old.read.attach(0));
      gl.uniform1f(u.uValue, valueScale == null ? 1 : valueScale);
      blit(next.read);
      old.destroy();
    }
    return next;
  }

  function gridSize(res) {
    let aspect = Math.max(1, canvas.width) / Math.max(1, canvas.height);
    const portrait = aspect < 1;
    if (portrait) aspect = 1 / aspect;
    aspect = Math.min(aspect, 4); // guard against a squashed canvas mid-layout
    const lo = Math.max(16, Math.round(res));
    const hi = Math.max(16, Math.round(res * aspect));
    return portrait ? { w: lo, h: hi } : { w: hi, h: lo };
  }

  function initFramebuffers() {
    const L = LEVELS[level];
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    const shortSide = Math.min(canvas.width, canvas.height);
    const dyeRes = Math.max(128, Math.min(L.dye, shortSide, maxTex / 2));
    const s = gridSize(L.sim);
    const d = gridSize(dyeRes);
    const filter = fmt.linear ? gl.LINEAR : gl.NEAREST;

    const velScale = velocity ? s.w / velocity.w : 1;
    dye = resizeDouble(dye, d.w, d.h, fmt.rgba, filter, 1);
    velocity = resizeDouble(velocity, s.w, s.h, fmt.rg, filter, velScale);
    pressure = resizeDouble(pressure, s.w, s.h, fmt.r, gl.NEAREST, 1);
    if (divergence && divergence.w === s.w && divergence.h === s.h) return;
    if (divergence) divergence.destroy();
    if (curl) curl.destroy();
    divergence = createFBO(s.w, s.h, fmt.r, gl.NEAREST);
    curl = createFBO(s.w, s.h, fmt.r, gl.NEAREST);
  }

  function initResources() {
    fmt = detectFormats(gl, isGL2);
    if (!fmt) return false;
    const defines = "#define MAX_SPLATS " + MAX_SPLATS + "\n" + (fmt.linear ? "" : "#define MANUAL_FILTERING\n");
    const vs = compile(gl.VERTEX_SHADER, VERT);
    progs = {};
    Object.keys(FS).forEach((k) => (progs[k] = makeProgram(vs, FS[k], defines)));

    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // Fresh context: old objects are gone, don't try to delete or resample them.
    velocity = dye = pressure = divergence = curl = null;
    initFramebuffers();
    needsResize = false;
    return true;
  }

  // ---------- simulation step ----------
  function step(dt) {
    const tx = velocity.tx;
    const ty = velocity.ty;
    let u;

    u = progs.curl.use();
    gl.uniform2f(u.texelSize, tx, ty);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    blit(curl);

    u = progs.vorticity.use();
    gl.uniform2f(u.texelSize, tx, ty);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uCurl, curl.attach(1));
    gl.uniform1f(u.uStrength, CFG.curl);
    gl.uniform1f(u.dt, dt);
    blit(velocity.write);
    velocity.swap();

    u = progs.divergence.use();
    gl.uniform2f(u.texelSize, tx, ty);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    blit(divergence);

    u = progs.scale.use();
    gl.uniform2f(u.texelSize, tx, ty);
    gl.uniform1i(u.uTexture, pressure.read.attach(0));
    gl.uniform1f(u.uValue, CFG.pressureDecay);
    blit(pressure.write);
    pressure.swap();

    u = progs.pressure.use();
    gl.uniform2f(u.texelSize, tx, ty);
    gl.uniform1i(u.uDivergence, divergence.attach(1));
    for (let i = 0; i < CFG.pressureIters; i++) {
      gl.uniform1i(u.uPressure, pressure.read.attach(0));
      blit(pressure.write);
      pressure.swap();
    }

    u = progs.gradient.use();
    gl.uniform2f(u.texelSize, tx, ty);
    gl.uniform1i(u.uPressure, pressure.read.attach(0));
    gl.uniform1i(u.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    u = progs.advect.use();
    gl.uniform2f(u.texelSize, tx, ty);
    gl.uniform2f(u.velTexel, tx, ty);
    gl.uniform2f(u.srcTexel, tx, ty);
    gl.uniform1f(u.dt, dt);
    gl.uniform1f(u.dissipation, CFG.velDissipation);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uSource, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    gl.uniform2f(u.texelSize, dye.tx, dye.ty);
    gl.uniform2f(u.srcTexel, dye.tx, dye.ty);
    gl.uniform1f(u.dissipation, CFG.dyeDissipation);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uSource, dye.read.attach(1));
    blit(dye.write);
    dye.swap();
  }

  function render() {
    const u = progs.display.use();
    gl.uniform2f(u.texelSize, dye.tx, dye.ty);
    gl.uniform2f(u.dyeTexel, dye.tx, dye.ty);
    gl.uniform3f(u.uBg, BG[0], BG[1], BG[2]);
    gl.uniform1i(u.uTexture, dye.read.attach(0));
    blit(null);
  }

  // ---------- splats ----------
  const pointArr = new Float32Array(MAX_SPLATS * 4);
  const colorArr = new Float32Array(MAX_SPLATS * 4);

  function splatPass(target, n, aspect) {
    const u = progs.splat.use();
    gl.uniform2f(u.texelSize, target.tx, target.ty);
    gl.uniform1i(u.uTarget, target.read.attach(0));
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform1i(u.uCount, n);
    gl.uniform4fv(u.uPoint, pointArr);
    gl.uniform4fv(u.uColor, colorArr);
    blit(target.write);
    target.swap();
  }

  function flushSplats() {
    if (!splatQueue.length) return;
    if (splatQueue.length > 96) splatQueue.splice(0, splatQueue.length - 96);
    const aspect = canvas.width / canvas.height;
    for (let s = 0; s < splatQueue.length; s += MAX_SPLATS) {
      const n = Math.min(MAX_SPLATS, splatQueue.length - s);
      for (let i = 0; i < n; i++) {
        const q = splatQueue[s + i];
        pointArr[i * 4] = q.x;
        pointArr[i * 4 + 1] = q.y;
        pointArr[i * 4 + 2] = q.rad;
        colorArr[i * 4] = q.vx * velocity.w;
        colorArr[i * 4 + 1] = q.vy * velocity.h;
        colorArr[i * 4 + 2] = 0;
      }
      splatPass(velocity, n, aspect);
      for (let i = 0; i < n; i++) {
        const q = splatQueue[s + i];
        colorArr[i * 4] = q.r;
        colorArr[i * 4 + 1] = q.g;
        colorArr[i * 4 + 2] = q.b;
      }
      splatPass(dye, n, aspect);
    }
    splatQueue.length = 0;
  }

  // vx, vy are in "screen widths/heights per second"; converted to grid cells/s at flush time.
  function addSplat(x, y, vx, vy, rgb, rad) {
    splatQueue.push({ x: x, y: y, vx: vx, vy: vy, r: rgb[0], g: rgb[1], b: rgb[2], rad: rad });
  }

  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }

  function nextHue() {
    hue = (hue + 0.618034) % 1; // golden-ratio steps: neighbors never look alike
    return hue;
  }

  function scaled(rgb, k) {
    return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
  }

  function randomSplats(n) {
    const aspect = canvas.width / canvas.height;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.9 + Math.random() * 1.3; // screen heights per second
      const rgb = scaled(hsv(rainbow ? simTime * 0.1 + i * 0.08 : nextHue(), 0.95, 1), 0.7 + Math.random() * 0.5);
      addSplat(
        0.12 + Math.random() * 0.76,
        0.12 + Math.random() * 0.76,
        (Math.cos(ang) * speed) / aspect,
        Math.sin(ang) * speed,
        rgb,
        0.003 + Math.random() * 0.004
      );
    }
  }

  // ---------- input ----------
  function toUV(e) {
    const p = MP.pos(e, canvas);
    const w = view.w || 1;
    const h = view.h || 1;
    return { x: p.x / w, y: 1 - p.y / h };
  }

  function hideHint() {
    if (!hintShown) return;
    hintShown = false;
    hint.classList.add("gone");
  }

  function onDown(e) {
    if (!gl || lost) return;
    e.preventDefault();
    hideHint();
    lastInteract = performance.now();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    const uv = toUV(e);
    const p = {
      x: uv.x,
      y: uv.y,
      px: uv.x,
      py: uv.y,
      moved: false,
      hue: nextHue(),
      offset: pointers.size * 0.11,
    };
    pointers.set(e.pointerId, p);
    addSplat(p.x, p.y, 0, 0, scaled(pointerColor(p), 0.55), CFG.splatRadius * 1.3);
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const uv = toUV(e);
    p.x = uv.x;
    p.y = uv.y;
    p.moved = true;
    lastInteract = performance.now();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
  }

  function pointerColor(p) {
    return rainbow ? hsv(simTime * 0.12 + p.offset, 1, 1) : hsv(p.hue, 0.95, 1);
  }

  // Turn this frame's pointer motion into a trail of splats.
  function applyPointers(frameDt) {
    if (!pointers.size) return;
    const aspect = canvas.width / canvas.height;
    const sigma = Math.sqrt(CFG.splatRadius);
    pointers.forEach((p) => {
      if (!p.moved) return;
      p.moved = false;
      const dx = p.x - p.px;
      const dy = p.y - p.py;
      const dist = Math.hypot(dx * aspect, dy); // in screen heights
      if (dist < 1e-5) return;
      let vx = (dx / frameDt) * CFG.forceBoost;
      let vy = (dy / frameDt) * CFG.forceBoost;
      // cap at ~6 screen-heights per second
      const sp = Math.hypot(vx * aspect, vy);
      if (sp > 6) {
        vx *= 6 / sp;
        vy *= 6 / sp;
      }
      const n = Math.max(1, Math.min(8, Math.ceil(dist / (sigma * 0.8))));
      const rgb = scaled(pointerColor(p), CFG.dyeAmount);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        addSplat(p.px + dx * t, p.py + dy * t, vx / Math.sqrt(n), vy / Math.sqrt(n), rgb, CFG.splatRadius);
      }
      p.px = p.x;
      p.py = p.y;
    });
  }

  // ---------- actions ----------
  function clearAll() {
    if (!gl || lost) return;
    gl.clearColor(0, 0, 0, 1);
    [dye.read, dye.write, velocity.read, velocity.write, pressure.read, pressure.write].forEach((f) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    splatQueue.length = 0;
  }

  function showMessage(html) {
    msgText.innerHTML = html;
    msgBox.hidden = false;
  }

  function hideMessage() {
    msgBox.hidden = true;
  }

  // ---------- frame loop & adaptive quality ----------
  let last = performance.now();
  let perfFrames = 0;
  let perfTime = 0;
  let perfWarm = 0;
  let slowStreak = 0;
  let drops = 0;

  function monitor(real) {
    if (perfWarm < 90) {
      perfWarm++;
      return;
    }
    perfFrames++;
    perfTime += real;
    if (perfFrames < 60) return;
    const avg = perfTime / perfFrames;
    perfFrames = 0;
    perfTime = 0;
    slowStreak = avg > 0.022 ? slowStreak + 1 : 0;
    // At most two drops, so a 30fps-capped device (Low Power Mode) doesn't end up blurry.
    if (slowStreak >= 2 && level < LEVELS.length - 1 && drops < 2) {
      level++;
      drops++;
      slowStreak = 0;
      perfWarm = 0;
      needsResize = true;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!gl || lost || gl.isContextLost()) {
      last = now;
      return;
    }
    let real = (now - last) / 1000;
    last = now;
    if (!(real > 0) || real > 0.25) {
      real = 1 / 60;
      perfWarm = 0;
    }
    const dt = Math.min(real, 1 / 60);
    monitor(real);

    if (needsResize) {
      needsResize = false;
      initFramebuffers();
    }

    if (!frozen) simTime += dt;
    // Gentle "attract mode" so an idle booth screen never goes dark.
    if (!frozen && now - lastInteract > 15000 && now - lastAttract > 3500) {
      lastAttract = now;
      randomSplats(1);
    }

    applyPointers(Math.min(real, 0.1));
    flushSplats();
    if (!frozen) step(dt);
    render();
  }

  // ---------- boot ----------
  let view = { w: 0, h: 0 };

  function wireControls(enabled) {
    if (!enabled) {
      document.querySelectorAll(".controls .btn, .controls input").forEach((el) => (el.disabled = true));
      return;
    }
    $("clear").addEventListener("click", () => {
      lastInteract = performance.now();
      clearAll();
    });
    const freezeBtn = $("freeze");
    freezeBtn.addEventListener("click", () => {
      frozen = !frozen;
      lastInteract = performance.now();
      freezeBtn.classList.toggle("on", frozen);
      freezeBtn.textContent = frozen ? "▶ Play" : "❄ Freeze";
    });
    MP.slider("swirl", (v) => (CFG.curl = v));
    MP.slider("fade", (v) => (CFG.dyeDissipation = Math.pow(v / 100, 2) * 3));
    const rainbowBtn = $("rainbow");
    rainbowBtn.addEventListener("click", () => {
      rainbow = !rainbow;
      lastInteract = performance.now();
      rainbowBtn.classList.toggle("on", rainbow);
    });
    $("splash").addEventListener("click", () => {
      if (!gl || lost) return;
      lastInteract = performance.now();
      randomSplats(6 + Math.floor(Math.random() * 4));
    });
  }

  function noWebGL() {
    showMessage(
      "<b>Oops, no fluid here</b>This device's browser can't run the GPU fluid simulation (it needs WebGL with floating-point textures). Try another demo, or open this page in an up-to-date Safari or Chrome."
    );
    hint.classList.add("gone");
    wireControls(false);
  }

  function boot() {
    const ctx = createContext();
    if (!ctx) return noWebGL();
    gl = ctx.gl;
    isGL2 = ctx.gl2;

    view = MP.setupCanvas(
      canvas,
      () => {
        needsResize = true;
      },
      { noContext: true, maxDpr: 1.5 }
    );

    // Canvas size is set synchronously by setupCanvas (onResize may be deferred).
    const maxSide = Math.max(canvas.width, canvas.height);
    level = maxSide >= 1500 ? 0 : maxSide >= 1000 ? 1 : 2;

    try {
      if (!initResources()) return noWebGL();
    } catch (err) {
      gl = null;
      if (window.console) console.warn(err);
      return noWebGL();
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("lostpointercapture", onUp);

    canvas.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        lost = true;
        pointers.clear();
        splatQueue.length = 0;
        showMessage("<b>Catching our breath…</b>The graphics chip took a short break. The fluid will be right back.");
      },
      false
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        try {
          if (!initResources()) return noWebGL();
        } catch (err) {
          return noWebGL();
        }
        lost = false;
        hideMessage();
        randomSplats(5);
      },
      false
    );

    wireControls(true);
    canvas.dataset.glPath = fmt.name + (fmt.linear ? " + linear" : " + manual bilinear");
    randomSplats(7);
    requestAnimationFrame((t) => {
      last = t;
      frame(t);
    });
  }

  boot();
})();
