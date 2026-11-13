/* H · GPGPU & Simulation — cellular automata, reaction–diffusion, texture particles,
 * water ripples and stable fluids. Textures are the memory, full-screen passes are the kernels. */
(function () {
  const S = window.Sandbox;
  const { clamp, damp } = S.math;
  const G = S.GLSL;
  const CAT = 'GPGPU & Simulation';

  /* ---------------------------------------------------------------- */
  /* Shared helpers                                                    */
  /* ---------------------------------------------------------------- */
  const panel = (ctx, cls, html) => { const el = document.createElement('div'); el.className = 'ov-panel ' + cls; el.innerHTML = html; ctx.overlay.appendChild(el); return el; };
  const freeTarget = (util, t) => { if (t) util.release(t.fb, t.tex, t.depth); };
  const freePP = (util, pp) => { if (pp) { freeTarget(util, pp.read); freeTarget(util, pp.write); } };
  /** Ping-pong pair in the first type that is renderable here: ['half','float',…]. Returns {pp, type} or null. */
  function tryPP(util, w, h, types, opts = {}) {
    for (const type of types) {
      try { return { pp: util.pingpong(w, h, Object.assign({}, opts, { type })), type }; } catch (e) { /* try the next format */ }
    }
    return null;
  }
  function tryTarget(util, w, h, types, opts = {}) {
    for (const type of types) {
      try { return { t: util.target(w, h, Object.assign({}, opts, { type })), type }; } catch (e) { /* next */ }
    }
    return null;
  }
  const TYPE_NAME = { float: 'FLOAT (OES_texture_float)', half: 'HALF_FLOAT_OES', byte: 'UNSIGNED_BYTE (packed)' };
  /** Bind inputs, target, draw one full-screen pass. */
  function run(util, prog, target, uni, texs = []) {
    util.bindTarget(target, util.gl.drawingBufferWidth, util.gl.drawingBufferHeight);
    prog.use().set(uni);
    texs.forEach((t, i) => util.tex(i, t));
    util.drawFullscreen();
  }
  // Signed pairs packed into RGBA8 (two bytes per value, range ±R): the no-float fallback.
  const PACK2 = `
vec4 enc2(vec2 v, float R) {
  vec2 u = clamp(v / (2.0 * R) + 0.5, 0.0, 0.99998);
  vec2 hi = floor(u * 255.0) / 255.0;
  vec2 lo = fract(u * 255.0);
  return vec4(hi.x, lo.x, hi.y, lo.y);
}
vec2 dec2(vec4 c, float R) { return ((vec2(c.r, c.b) + vec2(c.g, c.a) / 255.0) - 0.5) * 2.0 * R; }
`;
  /** rd/wr read and write a 2-vector field in float or packed form; rdL is a manual bilinear fetch. */
  const fieldLib = (pk, R) => `
#define PK ${pk ? 1 : 0}
const float FR = ${R.toFixed(1)};
${PACK2}
vec2 rd(sampler2D s, vec2 uv) {
#if PK
  return dec2(texture2D(s, uv), FR);
#else
  return texture2D(s, uv).xy;
#endif
}
vec4 wr(vec2 v) {
#if PK
  return enc2(v, FR);
#else
  return vec4(v, 0.0, 1.0);
#endif
}
vec2 rdL(sampler2D s, vec2 uv, vec2 res) {
  vec2 st = uv * res - 0.5; vec2 i = floor(st); vec2 f = st - i;
  vec2 a = (i + 0.5) / res, b = (i + 1.5) / res;
  return mix(mix(rd(s, a), rd(s, vec2(b.x, a.y)), f.x), mix(rd(s, vec2(a.x, b.y)), rd(s, b), f.x), f.y);
}
float segd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0); return length(pa - ba * h); }
`;
  /** Pointer state in canvas uv (y up) with a ghost pointer when there is no hover. */
  function pointer(ctx, s, t, ghost) {
    const inp = ctx.input;
    const live = inp.hover || inp.down;
    const p = live ? [inp.uvx, inp.uvy] : ghost(t);
    const prev = s.ptr || p;
    s.ptr = p;
    return { p, prev, live, down: inp.down };
  }

  /* ---------------------------------------------------------------- */
  /* 1. Cellular automata                                              */
  /* ---------------------------------------------------------------- */
  const RULES = [
    { name: 'Life', code: 'B3/S23', b: [3], s: [2, 3], dens: 0.22 },
    { name: 'HighLife', code: 'B36/S23', b: [3, 6], s: [2, 3], dens: 0.22 },
    { name: 'Seeds', code: 'B2/S', b: [2], s: [], dens: 0.025 },
    { name: 'Day & Night', code: 'B3678/S34678', b: [3, 6, 7, 8], s: [3, 4, 6, 7, 8], dens: 0.5 },
    { name: "Brian's Brain", code: 'B2 · on→dying→off', b: [2], s: [], dens: 0.18, brain: true },
  ];
  const mask = (list) => { const a = new Float32Array(9); list.forEach((n) => { a[n] = 1; }); return a; };
  S.register({
    id: 'life',
    title: 'Cellular Automata',
    category: CAT,
    thumb: 'wide',
    hint: 'drag to paint · pick a rule',
    description: "Conway's Game of Life and four relatives, computed entirely on the GPU. The grid lives in an RGBA8 texture: a full-screen pass reads each cell's eight neighbours with NEAREST sampling and writes the next generation into a second texture, then the two swap roles. The four channels hold alive, age, a fading trail and the extra dying state of Brian's Brain, so the render pass can colour cells by how long they have lived.",
    interact: [['Drag', 'paint live cells (Shift erases)'], ['Rule', 'birth / survival masks passed as uniform arrays'], ['Speed · Cell size', 'generations per second and zoom']],
    features: ['RGBA8 ping-pong framebuffers', 'NEAREST sampling, toroidal wrap in the shader', 'uniform float arrays for B/S rules', 'gl_FragCoord as the cell index', 'state + age + trail in four channels'],
    params: [
      { key: 'rule', label: 'Rule', type: 'select', options: ['Life', 'HighLife', 'Seeds', 'Day&Night', 'Brain'], value: 0 },
      { key: 'speed', label: 'Generations / second', type: 'range', min: 1, max: 60, step: 1, value: 24 },
      { key: 'cell', label: 'Cell size (px)', type: 'range', min: 2, max: 12, step: 1, value: 4, restart: true },
      { key: 'trails', label: 'Age colours + trails', type: 'toggle', value: true },
      { key: 'run', label: 'Running', type: 'toggle', value: true },
      { key: 'rand', label: 'Randomise', type: 'button' },
      { key: 'clear', label: 'Clear', type: 'button' },
    ],
    code: `// count the eight neighbours (toroidal)
for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
  if (i == 0 && j == 0) continue;
  vec2 p = mod(gl_FragCoord.xy + vec2(i, j), u_res);
  n += step(0.5, texture2D(u_state, p / u_res).r);
}
for (int k = 0; k < 9; k++) if (float(k) == n) { b = u_birth[k]; s = u_surv[k]; }
gl_FragColor = vec4(alive > 0.5 ? s : b, age, trail, dying);`,
    init(ctx) {
      const { util } = ctx;
      const step = util.program(G.fullscreenVS, `
uniform sampler2D u_s; uniform vec2 u_res; uniform float u_birth[9]; uniform float u_surv[9]; uniform float u_brain;
vec4 cell(vec2 o) { return texture2D(u_s, mod(gl_FragCoord.xy + o, u_res) / u_res); }
void main() {
  vec4 c = cell(vec2(0.0));
  float n = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    n += step(0.5, cell(vec2(float(i), float(j))).r);
  }
  float alive = step(0.5, c.r), dying = step(0.5, c.a);
  float b = 0.0, s = 0.0;
  for (int k = 0; k < 9; k++) { if (float(k) == n) { b = u_birth[k]; s = u_surv[k]; } }
  float next, nd = 0.0;
  if (u_brain > 0.5) { next = (alive < 0.5 && dying < 0.5 && n == 2.0) ? 1.0 : 0.0; nd = alive; }
  else next = alive > 0.5 ? s : b;
  float age = next > 0.5 ? (alive > 0.5 ? min(c.g + 1.0 / 96.0, 1.0) : 0.0) : 0.0;
  float trail = (next > 0.5 || nd > 0.5) ? 1.0 : max(c.b - 10.0 / 255.0, 0.0);
  gl_FragColor = vec4(next, age, trail, nd);
}`);
      const paint = util.program(G.fullscreenVS, G.noise + `
uniform sampler2D u_s; uniform vec2 u_a; uniform vec2 u_b; uniform float u_r; uniform float u_mode; uniform float u_seed; uniform float u_dens;
varying vec2 v_uv;
float segd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec4 c = texture2D(u_s, v_uv);
  vec2 p = gl_FragCoord.xy;
  if (u_mode > 1.5) { // reseed
    c = hash12(p * 1.37 + u_seed) < u_dens ? vec4(1.0, 0.0, 1.0, 0.0) : vec4(0.0);
  } else if (segd(p, u_a, u_b) < u_r) {
    if (u_mode > 0.5) { if (hash12(p + u_seed) < 0.45) c = vec4(1.0, 0.0, 1.0, 0.0); }
    else if (u_mode > -0.5) { c = vec4(0.0); }
  }
  gl_FragColor = c;
}`);
      const show = util.program(G.fullscreenVS, G.colors + `
uniform sampler2D u_s; uniform vec2 u_res; uniform float u_cell; uniform float u_trails; uniform vec2 u_view;
varying vec2 v_uv;
void main() {
  vec2 g = gl_FragCoord.xy / u_cell;
  vec4 c = texture2D(u_s, g / u_res);
  vec2 f = fract(g);
  vec3 col = INK + vec3(0.004, 0.006, 0.012);
  if (u_cell >= 6.0) { vec2 q = step(f, vec2(1.0 / u_cell)); col += max(q.x, q.y) * 0.018; }
  float alive = step(0.5, c.r);
  float tr = (1.0 - alive) * c.b * u_trails;
  col = mix(col, mix(A2 * 0.12 + INK, A2 * 0.55, tr * tr * tr), smoothstep(0.0, 0.3, tr) * 0.85);
  vec3 live = u_trails > 0.5 ? mix(BONE, mix(A1, A1 * 0.55 + INK, smoothstep(0.4, 1.0, c.g)), smoothstep(0.0, 0.12, c.g)) : BONE;
  vec3 dying = A2 * 0.9;
  float m = 1.0;
  if (u_cell >= 4.0) { vec2 q = abs(f - 0.5) * 2.0; float e = max(q.x, q.y); m = 1.0 - smoothstep(1.0 - 2.2 / u_cell, 1.0 - 0.6 / u_cell, e); }
  col = mix(col, live, alive * m);
  col = mix(col, dying, step(0.5, c.a) * (1.0 - alive) * m);
  vec2 uv = gl_FragCoord.xy / u_view - 0.5;
  col *= 1.0 - dot(uv, uv) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`);
      const s = { step, paint, show, gen: 0, acc: 0, seed: 1 };
      s.info = panel(ctx, 'ov-tr', '');
      this.build(ctx, s);
      return s;
    },
    build(ctx, s) {
      const { util, gl } = ctx;
      freePP(util, s.pp);
      s.cellPx = ctx.params.cell * ctx.dpr;
      s.gw = Math.ceil(ctx.width / s.cellPx); s.gh = Math.ceil(ctx.height / s.cellPx);
      s.pp = util.pingpong(s.gw, s.gh, { filter: gl.NEAREST });
      this.reseed(ctx, s, RULES[ctx.params.rule].dens);
    },
    reseed(ctx, s, dens) {
      s.seed = (s.seed * 1.618 + 0.37) % 97;
      run(ctx.util, s.paint, s.pp.write, { u_s: 0, u_mode: 2, u_seed: s.seed, u_dens: dens, u_a: [0, 0], u_b: [0, 0], u_r: 0 }, [s.pp.read.tex]);
      s.pp.swap(); s.gen = 0;
    },
    resize(ctx, s) { this.build(ctx, s); },
    action(ctx, s, key) { this.reseed(ctx, s, key === 'clear' ? 0 : RULES[ctx.params.rule].dens); },
    onParam(ctx, s, key, v) { if (key === 'rule' && (RULES[v].brain || v === 2 || v === 3)) this.reseed(ctx, s, RULES[v].dens); },
    frame(ctx, s, t, dt) {
      const { gl, util, input, params } = ctx;
      const rule = RULES[params.rule];
      // painting (live pointer, or a ghost brush while idle so the soup never dies out)
      const P = pointer(ctx, s, t, (tt) => [0.5 + 0.36 * Math.sin(tt * 0.53), 0.5 + 0.3 * Math.sin(tt * 0.91 + 1)]);
      const ghostOn = !P.live && (ctx.capture || Math.sin(t * 0.7) > 0.6);
      if ((P.live && input.down) || ghostOn) {
        const toCell = (p) => [p[0] * ctx.width / s.cellPx, p[1] * ctx.height / s.cellPx];
        s.seed = (s.seed + 0.731) % 113;
        run(util, s.paint, s.pp.write, { u_s: 0, u_a: toCell(P.prev), u_b: toCell(P.p), u_r: Math.max(2.5, 24 / ctx.params.cell), u_mode: input.shift ? 0 : 1, u_seed: s.seed, u_dens: 0 }, [s.pp.read.tex]);
        s.pp.swap();
      }
      if (params.run) {
        s.acc += dt * (ctx.capture ? 30 : params.speed);
        let n = 0;
        s.step.use().set({ u_birth: mask(rule.b), u_surv: mask(rule.s), u_brain: rule.brain ? 1 : 0, u_res: [s.gw, s.gh], u_s: 0 });
        while (s.acc >= 1 && n < 6) {
          util.bindTarget(s.pp.write); util.tex(0, s.pp.read.tex); util.drawFullscreen();
          s.pp.swap(); s.acc -= 1; n++; s.gen++;
        }
        if (s.acc > 1) s.acc = 0;
      }
      util.bindTarget(null, ctx.width, ctx.height);
      run(util, s.show, null, { u_s: 0, u_res: [s.gw, s.gh], u_cell: s.cellPx, u_trails: params.trails ? 1 : 0, u_view: [ctx.width, ctx.height] }, [s.pp.read.tex]);
      gl.viewport(0, 0, ctx.width, ctx.height);
      if ((s.tick = (s.tick || 0) + 1) % 10 === 0) s.info.innerHTML = `rule <b>${rule.name}</b> · ${rule.code}<br>grid <b>${s.gw} × ${s.gh}</b> RGBA8 · NEAREST<br>generation <b>${s.gen.toLocaleString()}</b>`;
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Reaction–diffusion (Gray-Scott)                                */
  /* ---------------------------------------------------------------- */
  const RD_PRESETS = [
    { name: 'Coral', f: 0.0545, k: 0.062 },
    { name: 'Mitosis', f: 0.0367, k: 0.0649 },
    { name: 'Worms', f: 0.078, k: 0.061 },
    { name: 'Spots', f: 0.035, k: 0.065 },
  ];
  S.register({
    id: 'reaction-diffusion',
    title: 'Reaction–Diffusion',
    category: CAT,
    thumb: 'portrait',
    hint: 'drag to seed chemical B · pick a preset',
    description: 'The Gray-Scott model: two chemicals diffuse at different rates while B consumes A and A is fed back in. Two numbers, feed and kill, decide whether the result is coral, dividing cells, worms or spots. Concentrations live in half-float textures and are advanced several times per frame with a 3 × 3 Laplacian; without float render targets each value is split across two bytes of an RGBA8 texel. The render pass reads the gradient of B as a surface normal for a little fake lighting.',
    interact: [['Drag', 'paint chemical B'], ['Preset', 'sets feed and kill'], ['Feed · Kill', 'move through the parameter map']],
    features: ['OES_texture_half_float + EXT_color_buffer_half_float', 'OES_texture_float fallback', 'RGBA8 two-byte packing fallback', '3 × 3 Laplacian in a fragment shader', 'gradient → normal for lighting'],
    params: [
      { key: 'preset', label: 'Preset', type: 'select', options: RD_PRESETS.map((p) => p.name), value: 0 },
      { key: 'feed', label: 'Feed', type: 'range', min: 0.01, max: 0.1, step: 0.0005, value: 0.0545 },
      { key: 'kill', label: 'Kill', type: 'range', min: 0.045, max: 0.07, step: 0.0005, value: 0.062 },
      { key: 'steps', label: 'Steps / frame', type: 'range', min: 1, max: 32, step: 1, value: 12 },
      { key: 'light', label: 'Relief lighting', type: 'toggle', value: true },
      { key: 'reset', label: 'Reseed', type: 'button' },
      { key: 'clear', label: 'Clear', type: 'button' },
    ],
    code: `vec2 c = rd(u_s, uv);   // (A, B)
vec2 lap = -c + 0.2 * (n + s + e + w) + 0.05 * (ne + nw + se + sw);
float abb = c.x * c.y * c.y;
vec2 next = c + vec2(1.0 * lap.x - abb + u_f * (1.0 - c.x),
                     0.5 * lap.y + abb - (u_k + u_f) * c.y);
gl_FragColor = wr(clamp(next, 0.0, 1.0));`,
    init(ctx) {
      const { util, gl } = ctx;
      const s = {};
      s.H = 256; s.W = Math.max(64, Math.round(s.H * ctx.aspect));
      const r = tryPP(util, s.W, s.H, ['half', 'float'], { filter: gl.NEAREST });
      s.pk = !r;
      s.pp = r ? r.pp : util.pingpong(s.W, s.H, { filter: gl.NEAREST });
      s.type = r ? r.type : 'byte';
      const lib = fieldLib(s.pk, 1);
      s.step = util.program(G.fullscreenVS, lib + `
uniform sampler2D u_s; uniform vec2 u_px; uniform float u_f; uniform float u_k; uniform vec2 u_a; uniform vec2 u_b; uniform float u_r; uniform float u_paint; uniform float u_asp;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv, dx = vec2(u_px.x, 0.0), dy = vec2(0.0, u_px.y);
  vec2 c = rd(u_s, uv);
  vec2 lap = -c + 0.2 * (rd(u_s, uv + dx) + rd(u_s, uv - dx) + rd(u_s, uv + dy) + rd(u_s, uv - dy))
           + 0.05 * (rd(u_s, uv + dx + dy) + rd(u_s, uv - dx + dy) + rd(u_s, uv + dx - dy) + rd(u_s, uv - dx - dy));
  float abb = c.x * c.y * c.y;
  vec2 n = c + vec2(1.0 * lap.x - abb + u_f * (1.0 - c.x), 0.5 * lap.y + abb - (u_k + u_f) * c.y);
  if (u_paint > 0.5) {
    vec2 q = vec2(u_asp, 1.0);
    float d = segd(uv * q, u_a * q, u_b * q);
    if (d < u_r) n.y = max(n.y, 0.9 * (1.0 - smoothstep(u_r * 0.6, u_r, d)));
  }
  gl_FragColor = wr(clamp(n, 0.0, 1.0));
}`);
      s.seedP = util.program(G.fullscreenVS, lib + G.noise + `
uniform float u_seed; uniform float u_clear;
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 id = floor(fc / 18.0), h = hash22(id + u_seed);
  vec2 f = fract(fc / 18.0) - 0.5 - (h - 0.5) * 0.5;
  float b = (h.x < 0.42 && length(f) < 0.2) ? 1.0 : 0.0;
  b = max(b, step(0.995, hash12(fc + u_seed * 3.1)));
  gl_FragColor = wr(vec2(1.0, b * (1.0 - u_clear)));
}`);
      s.show = util.program(G.fullscreenVS, lib + G.colors + `
uniform sampler2D u_s; uniform vec2 u_res; uniform float u_light; uniform vec2 u_view;
varying vec2 v_uv;
float B(vec2 uv) { return rdL(u_s, uv, u_res).y; }
void main() {
  vec2 px = 1.0 / u_res;
  float b = B(v_uv);
  float gx = B(v_uv + vec2(px.x, 0.0)) - B(v_uv - vec2(px.x, 0.0));
  float gy = B(v_uv + vec2(0.0, px.y)) - B(v_uv - vec2(0.0, px.y));
  vec3 n = normalize(vec3(-gx * 5.0, -gy * 5.0, 1.0));
  vec3 base = mix(INK * 1.4 + vec3(0.0, 0.01, 0.02), A1 * 0.75, smoothstep(0.06, 0.22, b));
  base = mix(base, A2, smoothstep(0.22, 0.36, b));
  base = mix(base, BONE, smoothstep(0.38, 0.5, b) * 0.6);
  vec3 L = normalize(vec3(-0.5, 0.6, 0.65));
  float dif = 0.55 + 0.45 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  vec3 col = u_light > 0.5 ? base * dif + spec * 0.45 * smoothstep(0.05, 0.2, b) : base;
  vec2 q = gl_FragCoord.xy / u_view - 0.5;
  col *= 1.0 - dot(q, q) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`);
      s.seed = 3.7;
      this.reseed(ctx, s, 0);
      if (s.pk) panel(ctx, 'ov-tr', 'No float render target here.<br>A and B are packed into <b>two bytes each</b> of an RGBA8 texel (16-bit fixed point).');
      s.info = panel(ctx, s.pk ? 'ov-br' : 'ov-tr', '');
      return s;
    },
    reseed(ctx, s, clear) {
      s.seed = (s.seed * 1.3 + 0.7) % 50;
      run(ctx.util, s.seedP, s.pp.write, { u_seed: s.seed, u_clear: clear });
      s.pp.swap();
    },
    action(ctx, s, key) { this.reseed(ctx, s, key === 'clear' ? 1 : 0); },
    onParam(ctx, s, key, v) {
      if (key === 'preset') { const p = RD_PRESETS[v]; ctx.syncParam('feed', p.f); ctx.syncParam('kill', p.k); }
    },
    frame(ctx, s, t, dt) {
      const { util, params, input } = ctx;
      const P = pointer(ctx, s, t, (tt) => [0.5 + 0.3 * Math.cos(tt * 0.6), 0.5 + 0.3 * Math.sin(tt * 0.9)]);
      const paint = (P.live && input.down) || (!P.live && ctx.capture);
      const steps = ctx.capture ? 28 : params.steps;
      s.step.use().set({ u_s: 0, u_px: [1 / s.W, 1 / s.H], u_f: params.feed, u_k: params.kill, u_a: P.prev, u_b: P.p, u_r: 0.025, u_paint: paint ? 1 : 0, u_asp: s.W / s.H });
      for (let i = 0; i < steps; i++) {
        util.bindTarget(s.pp.write); util.tex(0, s.pp.read.tex); util.drawFullscreen(); s.pp.swap();
        if (i === 0) s.step.set({ u_paint: 0 });
      }
      run(util, s.show, null, { u_s: 0, u_res: [s.W, s.H], u_light: params.light ? 1 : 0, u_view: [ctx.width, ctx.height] }, [s.pp.read.tex]);
      ctx.gl.viewport(0, 0, ctx.width, ctx.height);
      if ((s.tick = (s.tick || 0) + 1) % 15 === 1) s.info.innerHTML = `grid <b>${s.W} × ${s.H}</b> · ${TYPE_NAME[s.type]}<br>feed <b>${params.feed.toFixed(4)}</b> · kill <b>${params.kill.toFixed(4)}</b><br>${steps} steps / frame`;
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Texture particles                                              */
  /* ---------------------------------------------------------------- */
  const PSIDES = [256, 384, 512];
  S.register({
    id: 'gpu-particles',
    title: 'Texture Particles',
    category: CAT,
    thumb: 'tall',
    hint: 'hold to attract · Shift to repel',
    description: 'Up to 262,144 particles whose positions and velocities never leave the GPU. Each texel of a float texture holds one particle (x, y, vx, vy); a full-screen pass integrates curl-noise flow and the pointer force into a second texture. The draw call has no per-particle data at all: the vertex shader reads its own texel with texture2D, which needs vertex texture fetch (MAX_VERTEX_TEXTURE_IMAGE_UNITS > 0). Points are blended additively into a slowly fading trail buffer.',
    interact: [['Hold', 'attract particles to the pointer'], ['Shift + hold', 'repel instead'], ['Count', '65k, 147k or 262k texels (restarts)']],
    features: ['OES_texture_float + WEBGL_color_buffer_float', 'vertex texture fetch (texture2D in the vertex shader)', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'curl noise in a fragment shader', 'additive blending + REVERSE_SUBTRACT fade'],
    params: [
      { key: 'count', label: 'Particles', type: 'select', options: ['65k', '147k', '262k'], value: 0, restart: true },
      { key: 'flow', label: 'Curl flow', type: 'range', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'force', label: 'Pointer force', type: 'range', min: 0, max: 3, step: 0.05, value: 1.2 },
      { key: 'size', label: 'Point size', type: 'range', min: 1, max: 4, step: 0.5, value: 1.5 },
      { key: 'trails', label: 'Trails', type: 'toggle', value: true },
      { key: 'scatter', label: 'Scatter', type: 'button' },
    ],
    code: `// vertex shader: one vertex per texel, no attributes but its uv
attribute vec2 a_pos;            // texel centre
uniform sampler2D u_state;       // RGBA32F: x, y, vx, vy
void main() {
  vec4 p = texture2D(u_state, a_pos);
  gl_Position = vec4(p.x / u_asp, p.y, 0.0, 1.0);
  gl_PointSize = u_size;
}`,
    init(ctx) {
      const { gl, util } = ctx;
      const s = { asp: ctx.aspect };
      const vtu = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
      let r = null;
      if (vtu > 0) r = tryPP(util, PSIDES[ctx.params.count], PSIDES[ctx.params.count], ['float', 'half'], { filter: gl.NEAREST });
      s.gpu = !!r;
      s.fade = util.program(G.fullscreenVS, `uniform vec4 u_c; void main() { gl_FragColor = u_c; }`);
      s.blit = util.program(G.fullscreenVS, G.colors + `
uniform sampler2D u_t; uniform vec2 u_view; varying vec2 v_uv;
void main() { vec2 q = gl_FragCoord.xy / u_view - 0.5; vec3 c = INK * (1.1 - dot(q, q)) + texture2D(u_t, v_uv).rgb; gl_FragColor = vec4(c, 1.0); }`);
      const pointFS = G.colors + `
varying float v_sp; varying float v_k; uniform float u_gain;
void main() {
  vec2 q = gl_PointCoord - 0.5; float a = 1.0 - smoothstep(0.2, 0.5, length(q));
  vec3 c = mix(A1, A2, smoothstep(0.15, 1.1, v_sp + v_k * 0.25)) + BONE * smoothstep(0.9, 2.0, v_sp) * 0.5;
  gl_FragColor = vec4(c * a * u_gain, 1.0);
}`;
      if (s.gpu) {
        s.type = r.type;
        s.N = PSIDES[ctx.params.count];
        s.pp = r.pp;
        s.sim = util.program(G.fullscreenVS, G.noise + `
uniform sampler2D u_s; uniform vec2 u_m; uniform float u_force; uniform float u_t; uniform float u_dt; uniform float u_asp; uniform float u_flow; uniform float u_seed; uniform float u_mode;
varying vec2 v_uv;
float psi(vec2 q) { return vnoise(q * 1.1 + vec2(u_t * 0.05, 0.0)) + 0.5 * vnoise(q * 2.3 - vec2(0.0, u_t * 0.08)); }
void main() {
  if (u_mode > 0.5) { // seed / scatter
    vec2 h = hash22(gl_FragCoord.xy * 1.31 + u_seed);
    vec2 h2 = hash22(gl_FragCoord.xy * 0.73 + u_seed + 17.0);
    gl_FragColor = vec4((h * 2.0 - 1.0) * vec2(u_asp, 1.0), (h2 - 0.5) * 0.2);
    return;
  }
  vec4 p = texture2D(u_s, v_uv);
  vec2 pos = p.xy, vel = p.zw;
  vec2 q = pos * 1.4; float e = 0.02;
  vec2 curl = vec2(psi(q + vec2(0.0, e)) - psi(q - vec2(0.0, e)), psi(q - vec2(e, 0.0)) - psi(q + vec2(e, 0.0))) / (2.0 * e);
  float k = fract(sin(dot(v_uv, vec2(12.9898, 78.233))) * 43758.5453);
  vel = mix(vel, curl * 0.22 * u_flow * (0.6 + 0.8 * k), 1.0 - exp(-1.6 * u_dt));
  vec2 d = u_m - pos; float r2 = dot(d, d) + 0.015;
  vel += u_force * (d / r2 * 0.35 + vec2(-d.y, d.x) / r2 * 0.12 * sign(u_force)) * u_dt;
  float sp = length(vel); if (sp > 2.5) vel *= 2.5 / sp;
  pos += vel * u_dt;
  vec2 lim = vec2(u_asp, 1.0) * 1.04;
  pos = mod(pos + lim, 2.0 * lim) - lim;
  gl_FragColor = vec4(pos, vel);
}`);
        s.draw = util.program(`
attribute vec2 a_pos;
uniform sampler2D u_s; uniform float u_asp; uniform float u_size;
varying float v_sp; varying float v_k;
void main() {
  vec4 p = texture2D(u_s, a_pos);
  v_sp = length(p.zw) * 2.0; v_k = fract(a_pos.x * 31.7 + a_pos.y * 17.3);
  gl_Position = vec4(p.x / u_asp, p.y, 0.0, 1.0);
  gl_PointSize = u_size;
}`, pointFS);
        const N = s.N, uv = new Float32Array(N * N * 2);
        for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) { uv[k * 2] = (i + 0.5) / N; uv[k * 2 + 1] = (j + 0.5) / N; }
        s.mesh = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, uv), loc: 0, size: 2 }], null, { count: N * N });
        s.seed = 1;
        this.scatter(ctx, s);
        s.count = N * N;
      } else {
        // CPU fallback: fewer particles, simulated in JavaScript and streamed with bufferSubData
        s.count = 16384;
        s.pos = new Float32Array(s.count * 4);
        for (let i = 0; i < s.count; i++) { s.pos[i * 4] = (Math.random() * 2 - 1) * s.asp; s.pos[i * 4 + 1] = Math.random() * 2 - 1; }
        s.buf = util.buffer(gl.ARRAY_BUFFER, s.pos, gl.DYNAMIC_DRAW);
        s.draw = util.program(`
attribute vec4 a_pos; uniform float u_asp; uniform float u_size; varying float v_sp; varying float v_k;
void main() { v_sp = length(a_pos.zw) * 2.0; v_k = fract(a_pos.x * 13.1); gl_Position = vec4(a_pos.x / u_asp, a_pos.y, 0.0, 1.0); gl_PointSize = u_size; }`, pointFS);
        panel(ctx, 'ov-tr', vtu > 0 ? 'No float render target: particles fall back to the <b>CPU</b> (16k, bufferSubData each frame).' : 'MAX_VERTEX_TEXTURE_IMAGE_UNITS is <b>0</b>: no vertex texture fetch.<br>Falling back to <b>16k CPU particles</b>.');
      }
      s.info = panel(ctx, s.gpu ? 'ov-tr' : 'ov-br', '');
      s.m = [0, 0];
      this.resize(ctx, s);
      return s;
    },
    resize(ctx, s) {
      freeTarget(ctx.util, s.trail);
      s.trail = ctx.util.target(ctx.width, ctx.height);
      ctx.util.bindTarget(s.trail); ctx.gl.clearColor(0, 0, 0, 1); ctx.gl.clear(ctx.gl.COLOR_BUFFER_BIT);
      s.asp = ctx.aspect;
    },
    scatter(ctx, s) {
      if (!s.gpu) { for (let i = 0; i < s.count; i++) { s.pos[i * 4] = (Math.random() * 2 - 1) * s.asp; s.pos[i * 4 + 1] = Math.random() * 2 - 1; } return; }
      s.seed = (s.seed * 1.7 + 0.3) % 61;
      run(ctx.util, s.sim, s.pp.write, { u_mode: 1, u_seed: s.seed, u_asp: s.asp });
      s.pp.swap();
    },
    action(ctx, s) { this.scatter(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, util, input, params } = ctx;
      const asp = s.asp;
      const live = input.hover || input.down;
      const tx = live ? input.nx * asp : Math.sin(t * 0.37) * asp * 0.55, ty = live ? input.ny : Math.sin(t * 0.61) * 0.5;
      s.m[0] += (tx - s.m[0]) * damp(12, dt); s.m[1] += (ty - s.m[1]) * damp(12, dt);
      const hold = input.down || (!live && (ctx.capture || Math.sin(t * 0.45) > -0.2));
      const force = hold ? params.force * (input.shift ? -1 : 1) : 0;
      const h = Math.min(dt, 1 / 30);
      if (s.gpu) {
        run(util, s.sim, s.pp.write, { u_s: 0, u_m: s.m, u_force: force, u_t: t, u_dt: h, u_asp: asp, u_flow: params.flow, u_mode: 0 }, [s.pp.read.tex]);
        s.pp.swap();
      } else {
        const P = s.pos, n = s.count;
        for (let i = 0; i < n; i++) {
          const o = i * 4; let x = P[o], y = P[o + 1], vx = P[o + 2], vy = P[o + 3];
          const cx = Math.cos(y * 2.1 + t * 0.2) * 0.6 + Math.cos(y * 4.3 - t * 0.3) * 0.3, cy = -Math.sin(x * 1.9 - t * 0.15) * 0.6 - Math.sin(x * 3.7 + t * 0.25) * 0.3;
          const kk = 1 - Math.exp(-1.6 * h);
          vx += (cx * 0.22 * params.flow - vx) * kk; vy += (cy * 0.22 * params.flow - vy) * kk;
          const dx = s.m[0] - x, dy = s.m[1] - y, r2 = dx * dx + dy * dy + 0.015, sg = Math.sign(force);
          vx += force * (dx / r2 * 0.35 - dy / r2 * 0.12 * sg) * h; vy += force * (dy / r2 * 0.35 + dx / r2 * 0.12 * sg) * h;
          x += vx * h; y += vy * h;
          const lx = asp * 1.04, ly = 1.04;
          if (x > lx) x -= 2 * lx; else if (x < -lx) x += 2 * lx;
          if (y > ly) y -= 2 * ly; else if (y < -ly) y += 2 * ly;
          P[o] = x; P[o + 1] = y; P[o + 2] = vx; P[o + 3] = vy;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P);
      }
      // trail buffer: fade by REVERSE_SUBTRACT, then add points
      util.bindTarget(params.trails ? s.trail : null, ctx.width, ctx.height);
      gl.enable(gl.BLEND);
      if (params.trails) {
        gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        s.fade.use().set({ u_c: [1.5 / 255, 1.5 / 255, 1.5 / 255, 0.14] }); util.drawFullscreen();
        gl.blendEquation(gl.FUNC_ADD);
      } else { gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.blendFunc(gl.ONE, gl.ONE);
      const gain = 0.32 * Math.sqrt(65536 / s.count) * (params.trails ? 0.55 : 1) / Math.max(1, params.size * 0.6);
      s.draw.use().set({ u_s: 0, u_asp: asp, u_size: params.size * ctx.dpr, u_gain: gain });
      if (s.gpu) { util.tex(0, s.pp.read.tex); s.mesh.draw(gl.POINTS); }
      else { util.bindAttribs([{ buffer: s.buf, loc: 0, size: 4 }]); gl.drawArrays(gl.POINTS, 0, s.count); }
      gl.disable(gl.BLEND);
      if (params.trails) run(util, s.blit, null, { u_t: 0, u_view: [ctx.width, ctx.height] }, [s.trail.tex]);
      gl.viewport(0, 0, ctx.width, ctx.height);
      if ((s.tick = (s.tick || 0) + 1) % 15 === 1) s.info.innerHTML = s.gpu ? `<b>${s.count.toLocaleString()}</b> particles · ${s.N}² texels<br>state ${TYPE_NAME[s.type]}<br>VTF units <b>${gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)}</b> · 1 draw call` : `<b>${s.count.toLocaleString()}</b> CPU particles`;
      ctx.canvas.style.cursor = force < 0 ? 'zoom-out' : 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Water ripples                                                  */
  /* ---------------------------------------------------------------- */
  function poolFloor(asp) {
    const H = 900, W = Math.max(300, Math.round(H * asp));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#0c0e13'; g.fillRect(0, 0, W, H);
    const T = 60;
    for (let y = 0; y < H; y += T) for (let x = 0; x < W; x += T) { if (((x + y) / T) % 2 === 0) { g.fillStyle = 'rgba(56,214,232,0.035)'; g.fillRect(x, y, T, T); } }
    g.strokeStyle = 'rgba(236,233,226,0.09)'; g.lineWidth = 2;
    for (let x = 0; x <= W; x += T) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += T) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const n = asp > 1.25 ? 2 : 1;
    let ph = H * 0.74, pw = ph * 0.8;
    const gap = 50;
    const tot = n * pw + (n - 1) * gap;
    if (tot > W * 0.86) { const k = W * 0.86 / tot; ph *= k; pw *= k; }
    const x0 = (W - (n * pw + (n - 1) * gap)) / 2, y0 = (H - ph) / 2;
    [4, 1].slice(0, n).forEach((pi, i) => {
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x0 + i * (pw + gap) + 10, y0 + 14, pw, ph);
      g.drawImage(S.posterCanvas(pi, Math.round(pw), Math.round(ph)), x0 + i * (pw + gap), y0);
    });
    return c;
  }
  S.register({
    id: 'ripples',
    title: 'Water Ripples',
    category: CAT,
    thumb: 'square',
    hint: 'move to trail · click for a big drop',
    description: 'A height field advanced with the discrete wave equation: every texel stores its current and previous height, and one pass computes the next height from the four neighbours. The render pass turns the height gradient into a normal, refracts a poster lying on the pool floor through it and adds a specular glint. Damping sets how quickly the energy dies away; rain drops random impulses.',
    interact: [['Move', 'drag a trail of small drops'], ['Click', 'a large drop'], ['Damping · Rain', 'energy loss and random drops']],
    features: ['height + previous height in one RG texel', 'half-float ping-pong (RGBA8 packed fallback)', 'texture2D with offset uv for refraction', 'normals from finite differences', 'Canvas 2D poster as the pool floor'],
    params: [
      { key: 'damp', label: 'Damping', type: 'range', min: 0.95, max: 0.999, step: 0.001, value: 0.988 },
      { key: 'refr', label: 'Refraction', type: 'range', min: 0, max: 0.08, step: 0.002, value: 0.04 },
      { key: 'rain', label: 'Rain', type: 'toggle', value: false },
      { key: 'calm', label: 'Calm the water', type: 'button' },
    ],
    code: `vec2 h = rd(u_s, uv);           // (height, previous)
float sum = rd(u_s, uv + dx).x + rd(u_s, uv - dx).x
          + rd(u_s, uv + dy).x + rd(u_s, uv - dy).x;
float next = (sum * 0.5 - h.y) * u_damp;
gl_FragColor = wr(vec2(next, h.x));`,
    init(ctx) {
      const { util, gl } = ctx;
      const s = {};
      this.build(ctx, s);
      return s;
    },
    build(ctx, s) {
      const { util, gl } = ctx;
      freePP(util, s.pp);
      if (s.floor) util.release(s.floor);
      s.floor = util.texture({ source: poolFloor(ctx.aspect), flipY: true });
      s.H = 256; s.W = Math.max(64, Math.round(s.H * ctx.aspect));
      const r = tryPP(util, s.W, s.H, ['half', 'float'], { filter: gl.NEAREST });
      s.pp = r ? r.pp : util.pingpong(s.W, s.H, { filter: gl.NEAREST });
      const pk = !r;
      s.type = r ? r.type : 'byte';
      if (!s.step || s.pk !== pk) {
        s.pk = pk;
        const lib = fieldLib(pk, 4);
        s.step = util.program(G.fullscreenVS, lib + `
uniform sampler2D u_s; uniform vec2 u_px; uniform float u_damp; uniform vec2 u_a; uniform vec2 u_b; uniform float u_ra; uniform float u_sa;
uniform vec4 u_drop0; uniform vec4 u_drop1; uniform float u_asp; uniform float u_clear;
varying vec2 v_uv;
float bump(vec2 p, vec4 d) { if (d.w == 0.0) return 0.0; float r = length((p - d.xy) * vec2(u_asp, 1.0)); return d.w * (1.0 - smoothstep(0.0, d.z, r)); }
void main() {
  vec2 uv = v_uv, dx = vec2(u_px.x, 0.0), dy = vec2(0.0, u_px.y);
  vec2 h = rd(u_s, uv);
  float sum = rd(u_s, uv + dx).x + rd(u_s, uv - dx).x + rd(u_s, uv + dy).x + rd(u_s, uv - dy).x;
  float n = (sum * 0.5 - h.y) * u_damp;
  vec2 q = vec2(u_asp, 1.0);
  if (u_sa != 0.0) n -= u_sa * (1.0 - smoothstep(0.0, u_ra, segd(uv * q, u_a * q, u_b * q)));
  n -= bump(uv, u_drop0) + bump(uv, u_drop1);
  gl_FragColor = wr(clamp(vec2(n, h.x), -3.9, 3.9) * (1.0 - u_clear));
}`);
        s.show = util.program(G.fullscreenVS, lib + G.colors + `
uniform sampler2D u_s; uniform sampler2D u_floor; uniform vec2 u_res; uniform float u_refr; uniform float u_asp; uniform vec2 u_view;
varying vec2 v_uv;
float H(vec2 uv) { return rdL(u_s, uv, u_res).x; }
void main() {
  vec2 px = 1.0 / u_res;
  float h = H(v_uv);
  float hx = H(v_uv + vec2(px.x, 0.0)) - H(v_uv - vec2(px.x, 0.0));
  float hy = H(v_uv + vec2(0.0, px.y)) - H(v_uv - vec2(0.0, px.y));
  vec3 n = normalize(vec3(-hx * 3.0, -hy * 3.0, 1.0));
  vec2 uv = v_uv + n.xy * u_refr;
  vec3 bed = texture2D(u_floor, uv).rgb * 0.85;
  float lap = (hx * hx + hy * hy) * 0.5;
  bed *= 1.0 + clamp(-h * 0.6, -0.3, 0.5);
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 90.0);
  float fres = pow(1.0 - n.z, 1.5);
  vec3 sky = mix(A1 * 0.35, BONE * 0.6, clamp(n.y * 3.0 + 0.5, 0.0, 1.0));
  vec3 col = mix(bed, sky, clamp(fres * 6.0, 0.0, 0.45)) + spec * BONE * 1.2 + lap * A1 * 3.0;
  vec2 q = gl_FragCoord.xy / u_view - 0.5;
  col *= 1.0 - dot(q, q) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`);
      }
      this.calm(ctx, s);
    },
    calm(ctx, s) {
      run(ctx.util, s.step, s.pp.write, { u_s: 0, u_clear: 1, u_px: [1 / s.W, 1 / s.H], u_damp: 0, u_sa: 0, u_drop0: [0, 0, 0, 0], u_drop1: [0, 0, 0, 0], u_asp: 1 }, [s.pp.read.tex]);
      s.pp.swap();
    },
    resize(ctx, s) { this.build(ctx, s); },
    action(ctx, s) { this.calm(ctx, s); },
    frame(ctx, s, t, dt) {
      const { util, input, params } = ctx;
      const P = pointer(ctx, s, t, (tt) => [0.5 + 0.32 * Math.sin(tt * 0.8), 0.5 + 0.28 * Math.sin(tt * 1.3 + 0.4)]);
      const asp = s.W / s.H;
      let drop0 = [0, 0, 0, 0], drop1 = [0, 0, 0, 0];
      for (const c of input.clicks) drop0 = [c.uvx, c.uvy, 0.05, 1.1];
      const idle = !P.live;
      if (idle && (s.nextBig === undefined || t > s.nextBig)) { s.nextBig = t + (ctx.capture ? 0.6 : 1.6); drop0 = [0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.6, 0.05, 1.1]; }
      if (params.rain || ctx.capture) { if (Math.random() < 0.5) drop1 = [Math.random(), Math.random(), 0.012, 0.4]; }
      const moved = Math.hypot((P.p[0] - P.prev[0]) * asp, P.p[1] - P.prev[1]);
      const trail = (P.live || idle) && moved > 0.0005 ? Math.min(0.12, moved * 3) : 0;
      s.step.use().set({ u_s: 0, u_px: [1 / s.W, 1 / s.H], u_damp: params.damp, u_a: P.prev, u_b: P.p, u_ra: 0.02, u_sa: trail, u_drop0: drop0, u_drop1: drop1, u_asp: asp, u_clear: 0 });
      for (let i = 0; i < 2; i++) {
        util.bindTarget(s.pp.write); util.tex(0, s.pp.read.tex); util.drawFullscreen(); s.pp.swap();
        if (i === 0) s.step.set({ u_sa: 0, u_drop0: [0, 0, 0, 0], u_drop1: [0, 0, 0, 0] });
      }
      run(util, s.show, null, { u_s: 0, u_floor: 1, u_res: [s.W, s.H], u_refr: params.refr, u_asp: ctx.aspect, u_view: [ctx.width, ctx.height] }, [s.pp.read.tex, s.floor]);
      ctx.gl.viewport(0, 0, ctx.width, ctx.height);
      if (!s.info) s.info = panel(ctx, 'ov-tr', `height field <b>${s.W} × ${s.H}</b><br>${TYPE_NAME[s.type]}${s.pk ? '<br>no float targets: heights packed 16-bit' : ''}`);
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Stable fluids                                                  */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'fluid',
    title: 'Stable Fluids',
    category: CAT,
    thumb: 'wide',
    hint: 'drag to stir in dye',
    description: "Jos Stam's stable fluids on a half-float grid. Each frame runs a chain of full-screen passes: curl and vorticity confinement, divergence, a number of Jacobi iterations to solve for pressure, subtraction of the pressure gradient so the velocity stays divergence-free, then semi-Lagrangian advection of velocity and dye. Dragging injects force and colour, alternating cyan and magenta. Without float render targets velocity and pressure are packed into RGBA8 at reduced precision.",
    interact: [['Drag', 'push the fluid and inject dye (colour alternates per stroke)'], ['Pressure iterations', 'more Jacobi steps = less compressible'], ['Vorticity', 'restores small swirls lost to numerical damping']],
    features: ['OES_texture_half_float render targets', 'semi-Lagrangian advection (manual bilinear)', 'Jacobi pressure solve, N passes', 'vorticity confinement', 'RGBA8 packed fallback'],
    params: [
      { key: 'iters', label: 'Pressure iterations', type: 'range', min: 1, max: 60, step: 1, value: 20 },
      { key: 'curl', label: 'Vorticity', type: 'range', min: 0, max: 60, step: 1, value: 28 },
      { key: 'diss', label: 'Dye fade', type: 'range', min: 0, max: 3, step: 0.05, value: 0.6 },
      { key: 'radius', label: 'Splat radius', type: 'range', min: 0.005, max: 0.08, step: 0.001, value: 0.025 },
      { key: 'shade', label: 'Shading', type: 'toggle', value: true },
      { key: 'clear', label: 'Clear', type: 'button' },
    ],
    code: `// pressure: Jacobi iteration, N full-screen passes
float L = rd(u_p, uv - dx).x, R = rd(u_p, uv + dx).x;
float B = rd(u_p, uv - dy).x, T = rd(u_p, uv + dy).x;
gl_FragColor = wr(vec2((L + R + B + T - div) * 0.25, 0.0));
// advection: trace back along the velocity
vec2 back = uv - u_dt * rdL(u_vel, uv, u_vres) / u_vres;
gl_FragColor = dyeL(u_src, back, u_res) / (1.0 + u_diss * u_dt);`,
    init(ctx) {
      const { util, gl } = ctx;
      const s = { strokes: 0 };
      s.H = 128; s.W = Math.max(32, Math.round(s.H * ctx.aspect));
      s.DH = 256; s.DW = Math.max(64, Math.round(s.DH * ctx.aspect));
      const N = { filter: gl.NEAREST };
      let types = ['half', 'float'];
      const v = tryPP(util, s.W, s.H, types, N);
      s.pk = !v;
      if (v) { types = [v.type]; s.type = v.type; s.vel = v.pp; s.pre = tryPP(util, s.W, s.H, types, N).pp; s.dye = tryPP(util, s.DW, s.DH, types, N).pp; s.div = tryTarget(util, s.W, s.H, types, N).t; s.curlT = tryTarget(util, s.W, s.H, types, N).t; }
      else {
        s.type = 'byte';
        s.vel = util.pingpong(s.W, s.H, N); s.pre = util.pingpong(s.W, s.H, N); s.dye = util.pingpong(s.DW, s.DH, N);
        s.div = util.target(s.W, s.H, N); s.curlT = util.target(s.W, s.H, N);
      }
      const lib = fieldLib(s.pk, 2048) + `
uniform vec2 u_res; varying vec2 v_uv;
vec4 dyeL(sampler2D s, vec2 uv, vec2 res) {
  vec2 st = uv * res - 0.5; vec2 i = floor(st); vec2 f = st - i;
  vec2 a = (i + 0.5) / res, b = (i + 1.5) / res;
  return mix(mix(texture2D(s, a), texture2D(s, vec2(b.x, a.y)), f.x), mix(texture2D(s, vec2(a.x, b.y)), texture2D(s, b), f.x), f.y);
}
`;
      const P = (fs) => util.program(G.fullscreenVS, lib + fs);
      s.p = {
        curl: P(`uniform sampler2D u_vel;
void main() { vec2 t = 1.0 / u_res;
  float L = rd(u_vel, v_uv - vec2(t.x, 0.0)).y, R = rd(u_vel, v_uv + vec2(t.x, 0.0)).y, T = rd(u_vel, v_uv + vec2(0.0, t.y)).x, B = rd(u_vel, v_uv - vec2(0.0, t.y)).x;
  gl_FragColor = wr(vec2(0.5 * (R - L - T + B), 0.0)); }`),
        vort: P(`uniform sampler2D u_vel; uniform sampler2D u_curl; uniform float u_k; uniform float u_dt;
void main() { vec2 t = 1.0 / u_res;
  float L = rd(u_curl, v_uv - vec2(t.x, 0.0)).x, R = rd(u_curl, v_uv + vec2(t.x, 0.0)).x, T = rd(u_curl, v_uv + vec2(0.0, t.y)).x, B = rd(u_curl, v_uv - vec2(0.0, t.y)).x, C = rd(u_curl, v_uv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f = f / (length(f) + 1e-4) * u_k * C; f.y *= -1.0;
  gl_FragColor = wr(rd(u_vel, v_uv) + f * u_dt); }`),
        div: P(`uniform sampler2D u_vel;
void main() { vec2 t = 1.0 / u_res; vec2 C = rd(u_vel, v_uv);
  float L = rd(u_vel, v_uv - vec2(t.x, 0.0)).x, R = rd(u_vel, v_uv + vec2(t.x, 0.0)).x, T = rd(u_vel, v_uv + vec2(0.0, t.y)).y, B = rd(u_vel, v_uv - vec2(0.0, t.y)).y;
  if (v_uv.x - t.x < 0.0) L = -C.x; if (v_uv.x + t.x > 1.0) R = -C.x; if (v_uv.y + t.y > 1.0) T = -C.y; if (v_uv.y - t.y < 0.0) B = -C.y;
  gl_FragColor = wr(vec2(0.5 * (R - L + T - B), 0.0)); }`),
        scale: P(`uniform sampler2D u_src; uniform float u_k; void main() { gl_FragColor = wr(rd(u_src, v_uv) * u_k); }`),
        jacobi: P(`uniform sampler2D u_p; uniform sampler2D u_div;
void main() { vec2 t = 1.0 / u_res;
  float L = rd(u_p, v_uv - vec2(t.x, 0.0)).x, R = rd(u_p, v_uv + vec2(t.x, 0.0)).x, T = rd(u_p, v_uv + vec2(0.0, t.y)).x, B = rd(u_p, v_uv - vec2(0.0, t.y)).x;
  gl_FragColor = wr(vec2((L + R + B + T - rd(u_div, v_uv).x) * 0.25, 0.0)); }`),
        grad: P(`uniform sampler2D u_p; uniform sampler2D u_vel;
void main() { vec2 t = 1.0 / u_res;
  float L = rd(u_p, v_uv - vec2(t.x, 0.0)).x, R = rd(u_p, v_uv + vec2(t.x, 0.0)).x, T = rd(u_p, v_uv + vec2(0.0, t.y)).x, B = rd(u_p, v_uv - vec2(0.0, t.y)).x;
  gl_FragColor = wr(rd(u_vel, v_uv) - 0.5 * vec2(R - L, T - B)); }`),
        advV: P(`uniform sampler2D u_vel; uniform float u_dt; uniform float u_diss;
void main() { vec2 back = v_uv - u_dt * rd(u_vel, v_uv) / u_res;
  gl_FragColor = wr(rdL(u_vel, back, u_res) / (1.0 + u_diss * u_dt)); }`),
        advD: P(`uniform sampler2D u_vel; uniform sampler2D u_src; uniform vec2 u_vres; uniform float u_dt; uniform float u_diss;
void main() { vec2 back = v_uv - u_dt * rdL(u_vel, v_uv, u_vres) / u_vres;
  vec4 c = dyeL(u_src, back, u_res) / (1.0 + u_diss * u_dt);
#if PK
  c = clamp(c, 0.0, 1.0);
#endif
  gl_FragColor = c; }`),
        splatV: P(`uniform sampler2D u_src; uniform vec2 u_a; uniform vec2 u_b; uniform vec2 u_f; uniform float u_r; uniform float u_asp;
void main() { vec2 q = vec2(u_asp, 1.0); float d = segd(v_uv * q, u_a * q, u_b * q);
  gl_FragColor = wr(rd(u_src, v_uv) + u_f * exp(-d * d / u_r)); }`),
        splatD: P(`uniform sampler2D u_src; uniform vec2 u_a; uniform vec2 u_b; uniform vec3 u_c; uniform float u_r; uniform float u_asp;
void main() { vec2 q = vec2(u_asp, 1.0); float d = segd(v_uv * q, u_a * q, u_b * q);
  vec4 c = texture2D(u_src, v_uv) + vec4(u_c * exp(-d * d / u_r), 0.0);
#if PK
  c = clamp(c, 0.0, 1.0);
#endif
  gl_FragColor = vec4(c.rgb, 1.0); }`),
        clear: P(`void main() { gl_FragColor = wr(vec2(0.0)); }`),
        show: P(G.colors + `uniform sampler2D u_dye; uniform float u_shade; uniform vec2 u_view;
void main() {
  vec3 c = dyeL(u_dye, v_uv, u_res).rgb;
  vec2 t = 1.0 / u_res;
  float l = dot(c, vec3(0.33));
  float dx = dot(dyeL(u_dye, v_uv + vec2(t.x, 0.0), u_res).rgb, vec3(0.33)) - dot(dyeL(u_dye, v_uv - vec2(t.x, 0.0), u_res).rgb, vec3(0.33));
  float dy = dot(dyeL(u_dye, v_uv + vec2(0.0, t.y), u_res).rgb, vec3(0.33)) - dot(dyeL(u_dye, v_uv - vec2(0.0, t.y), u_res).rgb, vec3(0.33));
  vec3 n = normalize(vec3(dx, dy, 0.12));
  float dif = mix(1.0, clamp(dot(n, normalize(vec3(-0.4, 0.5, 1.0))) * 0.6 + 0.55, 0.55, 1.15), u_shade * smoothstep(0.0, 0.08, l));
  vec3 col = (1.0 - exp(-c * 1.5)) * dif;
  vec2 q = gl_FragCoord.xy / u_view - 0.5;
  col += INK * (1.0 - dot(q, q)) * (1.0 - clamp(l * 2.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`),
      };
      for (const pp of [s.vel, s.pre]) { run(util, s.p.clear, pp.read, { u_res: [s.W, s.H] }); run(util, s.p.clear, pp.write, { u_res: [s.W, s.H] }); }
      this.clearDye(ctx, s);
      if (s.pk) panel(ctx, 'ov-tr', 'No float render target here.<br>Velocity and pressure are packed <b>16-bit fixed point</b> into RGBA8; dye is 8-bit. <b>Reduced quality.</b>');
      s.info = panel(ctx, s.pk ? 'ov-br' : 'ov-tr', '');
      s.ghost = [[0.2, 0.5], [0.8, 0.5]];
      for (let i = 0; i < 7; i++) {
        const a = [0.15 + Math.random() * 0.7, 0.15 + Math.random() * 0.7], th = Math.random() * 6.28;
        this.splat(ctx, s, a, a, [Math.cos(th) * 600, Math.sin(th) * 600], (i % 2 ? S.A2 : S.A1).map((x) => x * 0.8), 0.0012);
      }
      return s;
    },
    clearDye(ctx, s) {
      const { gl, util } = ctx;
      for (const t of [s.dye.read, s.dye.write]) { util.bindTarget(t); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    },
    action(ctx, s) {
      this.clearDye(ctx, s);
      for (const pp of [s.vel, s.pre]) { run(ctx.util, s.p.clear, pp.read, { u_res: [s.W, s.H] }); }
    },
    splat(ctx, s, a, b, f, col, r) {
      const { util } = ctx, asp = s.W / s.H;
      run(util, s.p.splatV, s.vel.write, { u_src: 0, u_a: a, u_b: b, u_f: f, u_r: r, u_asp: asp, u_res: [s.W, s.H] }, [s.vel.read.tex]); s.vel.swap();
      run(util, s.p.splatD, s.dye.write, { u_src: 0, u_a: a, u_b: b, u_c: col, u_r: r, u_asp: asp, u_res: [s.DW, s.DH] }, [s.dye.read.tex]); s.dye.swap();
    },
    frame(ctx, s, t, dt) {
      const { util, input, params } = ctx;
      const h = clamp(dt, 1 / 120, 1 / 30);
      const V = [s.W, s.H];
      const C1 = S.A1.map((x) => x * 0.9), C2 = S.A2.map((x) => x * 0.9);
      // pointer splats
      if (input.down && !s.wasDown) s.strokes++;
      s.wasDown = input.down;
      const p = [input.uvx, input.uvy];
      if (input.down && s.last) {
        const dx = (p[0] - s.last[0]) / h * s.W, dy = (p[1] - s.last[1]) / h * s.H;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) {
          const f = [clamp(dx * 0.8, -900, 900), clamp(dy * 0.8, -900, 900)];
          this.splat(ctx, s, s.last, p, f, (s.strokes % 2 ? C1 : C2).map((x) => x * 0.6), params.radius * 0.02);
        }
      }
      s.last = p;
      // ghost emitters while idle (and in capture)
      if (!input.hover && !input.down) {
        const k = Math.min(1, h * 9);
        for (let i = 0; i < 2; i++) {
          const a = t * (0.55 + i * 0.12) + i * Math.PI;
          const q = [0.5 + Math.cos(a) * 0.36, 0.5 + Math.sin(a * 1.3) * 0.34];
          const prev = s.ghost[i];
          const dir = [Math.cos(a + 1.6 + i * 2.4), Math.sin(a * 0.7 + i)];
          this.splat(ctx, s, prev, q, [dir[0] * 260 * k * 3, dir[1] * 260 * k * 3], (i ? C2 : C1).map((x) => x * k), params.radius * 0.024);
          s.ghost[i] = q;
        }
      }
      // curl + vorticity
      run(util, s.p.curl, s.curlT, { u_vel: 0, u_res: V }, [s.vel.read.tex]);
      run(util, s.p.vort, s.vel.write, { u_vel: 0, u_curl: 1, u_k: params.curl, u_dt: h, u_res: V }, [s.vel.read.tex, s.curlT.tex]); s.vel.swap();
      // divergence, pressure (warm start, decayed), Jacobi, gradient subtract
      run(util, s.p.div, s.div, { u_vel: 0, u_res: V }, [s.vel.read.tex]);
      run(util, s.p.scale, s.pre.write, { u_src: 0, u_k: 0.8, u_res: V }, [s.pre.read.tex]); s.pre.swap();
      s.p.jacobi.use().set({ u_p: 0, u_div: 1, u_res: V });
      util.tex(1, s.div.tex);
      for (let i = 0; i < params.iters; i++) { util.bindTarget(s.pre.write); util.tex(0, s.pre.read.tex); util.drawFullscreen(); s.pre.swap(); }
      run(util, s.p.grad, s.vel.write, { u_p: 0, u_vel: 1, u_res: V }, [s.pre.read.tex, s.vel.read.tex]); s.vel.swap();
      // advection
      run(util, s.p.advV, s.vel.write, { u_vel: 0, u_dt: h, u_diss: 0.15, u_res: V }, [s.vel.read.tex]); s.vel.swap();
      run(util, s.p.advD, s.dye.write, { u_vel: 0, u_src: 1, u_vres: V, u_dt: h, u_diss: params.diss, u_res: [s.DW, s.DH] }, [s.vel.read.tex, s.dye.read.tex]); s.dye.swap();
      run(util, s.p.show, null, { u_dye: 0, u_shade: params.shade ? 1 : 0, u_res: [s.DW, s.DH], u_view: [ctx.width, ctx.height] }, [s.dye.read.tex]);
      ctx.gl.viewport(0, 0, ctx.width, ctx.height);
      if ((s.tick = (s.tick || 0) + 1) % 15 === 1) s.info.innerHTML = `velocity <b>${s.W} × ${s.H}</b> · dye <b>${s.DW} × ${s.DH}</b><br>${TYPE_NAME[s.type]}<br><b>${params.iters + 8}</b> passes / frame`;
      ctx.canvas.style.cursor = 'crosshair';
    },
  });
})();
