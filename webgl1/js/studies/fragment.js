/* E · Fragment Operations — blending, min/max blending, depth test and range, polygon offset,
 * stencil, colour mask, alpha to coverage / sample coverage. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, clamp, damp, lerp } = S.math;
  const G = S.GLSL;
  const CAT = 'Fragment Operations';
  const INK = [0.027, 0.031, 0.047];
  const BONE = [0.925, 0.914, 0.886];
  const AMBER = [1.0, 0.74, 0.34];

  /* ---------------------------------------------------------------- */
  /* Shared helpers                                                    */
  /* ---------------------------------------------------------------- */
  const LIT_VS = `
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_m; uniform float u_inflate; uniform float u_scale;
varying vec3 v_n; varying vec3 v_w; varying vec3 v_o;
void main() {
  vec3 p = a_pos * (u_scale == 0.0 ? 1.0 : u_scale) + a_nrm * u_inflate;
  vec4 w = u_m * vec4(p, 1.0);
  v_w = w.xyz; v_o = a_pos; v_n = mat3(u_m) * a_nrm;
  gl_Position = u_vp * w;
}`;
  // u_mode: 0 lit, 1 flat colour, 2 shade by gl_FragCoord.z, 3 lit + clip plane (two-sided, interior tinted)
  const LIT_FS = G.colors + `
uniform vec3 u_col; uniform vec3 u_eye; uniform float u_fog; uniform vec3 u_fogCol; uniform int u_mode; uniform float u_clipY; uniform float u_alpha;
varying vec3 v_n; varying vec3 v_w; varying vec3 v_o;
void main() {
  if (u_mode == 3 && v_w.y > u_clipY) discard;
  if (u_mode == 1) { gl_FragColor = vec4(u_col, u_alpha); return; }
  if (u_mode == 2) {
    float z = gl_FragCoord.z;
    float v = clamp(log2(max(1.0 - z, 1e-7)) / -18.0, 0.0, 1.0);
    vec3 c = mix(mix(BONE, A2, smoothstep(0.0, 0.3, v)), mix(A1, INK * 2.0, smoothstep(0.55, 1.0, v)), smoothstep(0.2, 0.6, v));
    gl_FragColor = vec4(c * (0.85 + 0.15 * step(0.5, fract(z * 400.0))), 1.0); return;
  }
  vec3 n = normalize(v_n), v = normalize(u_eye - v_w), l = normalize(vec3(0.45, 0.9, 0.35));
  vec3 col = u_col;
  if (!gl_FrontFacing) { n = -n; if (u_mode == 3) col = A2 * 0.35; }
  float df = max(dot(n, l), 0.0);
  float sp = pow(max(dot(reflect(-l, n), v), 0.0), 40.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 c = col * (0.16 + 0.84 * df) + vec3(sp * 0.35) + rim * 0.2 * A1;
  float f = 1.0 - exp(-length(u_eye - v_w) * u_fog);
  gl_FragColor = vec4(mix(c, u_fogCol, clamp(f, 0.0, 1.0)), u_alpha);
}`;
  const FLOOR_VS = `
attribute vec2 a_pos;
uniform mat4 u_vp; uniform float u_size; uniform float u_y;
varying vec3 v_w;
void main() { v_w = vec3(a_pos.x * u_size, u_y, a_pos.y * u_size); gl_Position = u_vp * vec4(v_w, 1.0); }`;
  const FLOOR_FS = '#extension GL_OES_standard_derivatives : enable\n' + G.colors + `
uniform vec3 u_eye; uniform float u_fog; uniform vec3 u_fogCol; uniform vec3 u_line; uniform vec3 u_base; uniform int u_mode;
varying vec3 v_w;
float grid(vec2 p) { vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), 1e-4); return 1.0 - min(min(g.x, g.y), 1.0); }
void main() {
  vec3 c;
  if (u_mode == 2) {
    float z = gl_FragCoord.z; float v = clamp(log2(max(1.0 - z, 1e-7)) / -18.0, 0.0, 1.0);
    c = mix(mix(BONE, A2, smoothstep(0.0, 0.3, v)), mix(A1, INK * 2.0, smoothstep(0.55, 1.0, v)), smoothstep(0.2, 0.6, v));
  } else if (u_mode == 1) {
    // a second, slightly raised layer: magenta rings and a disc, for z-fighting
    float d = length(v_w.xz);
    float a = step(0.5, fract(d * 0.9)) * step(d, 9.0);
    if (a < 0.5) discard;
    c = mix(A2, AMBER_(), step(0.5, fract(atan(v_w.z, v_w.x) * 1.9))) * 0.5;
  } else {
    float minor = grid(v_w.xz), major = grid(v_w.xz * 0.25);
    c = u_base + u_line * (minor * 0.12 + major * 0.35);
  }
  float f = 1.0 - exp(-length(u_eye - v_w) * u_fog);
  gl_FragColor = vec4(mix(c, u_fogCol, clamp(f, 0.0, 1.0)), 1.0);
}`.replace('AMBER_()', 'vec3(1.0, 0.74, 0.34)');
  function kit(util) {
    const gl = util.gl;
    const lit = util.program(LIT_VS, LIT_FS);
    const floor = util.program(FLOOR_VS, FLOOR_FS);
    const qb = util.buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    const quad = util.mesh([{ buffer: qb, loc: 0, size: 2 }], null, { count: 6 });
    const cache = {};
    const mesh = (name) => cache[name] || (cache[name] = ({
      knot: () => S.geo.upload(util, S.geo.torusKnot(220, 24, 0.26, 1.0, 0.45)),
      cube: () => S.geo.uploadFlat(util, S.geo.cube()),
      octa: () => S.geo.uploadFlat(util, S.geo.octa()),
      sphere: () => S.geo.upload(util, S.geo.sphere(48, 24, 1)),
      torus: () => S.geo.upload(util, S.geo.torus(64, 20, 1, 0.3)),
    })[name]());
    return {
      lit, floor, quad, mesh,
      begin(vp, eye, fog = 0.05, fogCol = INK) { this.vp = vp; this.eye = eye; this.fog = fog; this.fogCol = fogCol; lit.use().set({ u_vp: vp, u_eye: eye, u_fog: fog, u_fogCol: fogCol, u_mode: 0, u_alpha: 1, u_inflate: 0, u_scale: 1 }); },
      draw(name, m, col, extra) { lit.use().set({ u_m: m, u_col: col, u_mode: 0, u_alpha: 1, u_inflate: 0, u_scale: 1 }); if (extra) lit.set(extra); mesh(name).draw(); },
      drawFloor(size = 30, y = 0, line = S.A1, base = [0.035, 0.04, 0.055], mode = 0) {
        floor.use().set({ u_vp: this.vp, u_eye: this.eye, u_fog: this.fog, u_fogCol: this.fogCol, u_size: size, u_y: y, u_line: line, u_base: base, u_mode: mode });
        quad.draw();
      },
    };
  }
  const TRS = (p, r = [0, 0, 0], s = 1) => {
    let m = M4.translate(p[0], p[1], p[2]);
    if (r[1]) m = M4.mul(m, M4.rotY(r[1]));
    if (r[0]) m = M4.mul(m, M4.rotX(r[0]));
    if (r[2]) m = M4.mul(m, M4.rotZ(r[2]));
    return M4.mul(m, Array.isArray(s) ? M4.scale(s[0], s[1], s[2]) : M4.scale(s));
  };
  const panel = (ctx, cls, html = '') => { const el = document.createElement('div'); el.className = 'ov-panel ' + cls; el.innerHTML = html; ctx.overlay.appendChild(el); return el; };
  const label = (ctx, text) => { const el = document.createElement('div'); el.className = 'ov-label'; el.textContent = text; ctx.overlay.appendChild(el); return el; };
  const xform = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]];
  const ghost = (t, ax = 0.28, ay = 0.2) => ({ uvx: 0.5 + Math.sin(t * 0.7) * ax, uvy: 0.5 + Math.sin(t * 0.43 + 1.2) * ay });
  // screen-space disc / ring / star drawn on a quad (ndc centre + radii)
  const DISC_VS = `
attribute vec2 a_pos; uniform vec2 u_c; uniform vec2 u_r; uniform float u_rot;
varying vec2 v_q;
void main() { v_q = a_pos; float c = cos(u_rot), s = sin(u_rot); gl_Position = vec4(u_c + vec2(c * a_pos.x - s * a_pos.y, s * a_pos.x + c * a_pos.y) * u_r, 0.0, 1.0); }`;
  const DISC_FS = `
uniform vec4 u_col; uniform float u_inner; uniform int u_kind;
varying vec2 v_q;
void main() {
  float d = length(v_q);
  if (u_kind == 1) { float th = atan(v_q.y, v_q.x); d /= 0.62 + 0.38 * cos(th * 5.0) ; }
  if (d > 1.0 || d < u_inner) discard;
  gl_FragColor = u_col;
}`;

  /* ---------------------------------------------------------------- */
  /* 1. Blending lab                                                   */
  /* ---------------------------------------------------------------- */
  const F = ['ZERO', 'ONE', 'SRC_COLOR', 'ONE_MINUS_SRC_COLOR', 'DST_COLOR', 'ONE_MINUS_DST_COLOR', 'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'DST_ALPHA', 'ONE_MINUS_DST_ALPHA', 'CONSTANT_COLOR', 'ONE_MINUS_CONSTANT_COLOR', 'CONSTANT_ALPHA', 'ONE_MINUS_CONSTANT_ALPHA', 'SRC_ALPHA_SATURATE'];
  const FS_ = ['0', '1', 'SC', '1−SC', 'DC', '1−DC', 'SA', '1−SA', 'DA', '1−DA', 'CC', '1−CC', 'CA', '1−CA', 'SAT'];
  const EQ = ['FUNC_ADD', 'FUNC_SUBTRACT', 'FUNC_REVERSE_SUBTRACT'];
  const ALPHA_MODES = ['Same as RGB', '1, 1−SA · ADD', '0, 1 · keep dst', '1, 1 · REV_SUB'];
  const PRESETS = { alpha: [6, 7, 0], premul: [1, 7, 0], add: [1, 1, 0], multiply: [4, 0, 0], screen: [1, 3, 0], subtract: [1, 1, 2], constant: [12, 13, 0] };
  S.register({
    id: 'blend-lab',
    title: 'Blending Lab',
    category: CAT,
    thumb: 'wide',
    hint: 'drag the shapes · pick factors',
    description: 'Blending combines each new fragment (source) with the pixel already in the framebuffer (destination): result = src × srcFactor ⊕ dst × dstFactor, where ⊕ is chosen by blendEquation. Every one of the fifteen factors is available for the source and fourteen for the destination (SRC_ALPHA_SATURATE is source-only), along with the constant colour set by blendColor. The background carries alpha that rises from left to right, so DST_ALPHA factors vary across the screen; blendFuncSeparate gives the alpha channel its own rule, which the Alpha view shows.',
    interact: [['Drag', 'move a shape'], ['Source / destination', 'blendFunc factors'], ['Equation', 'add, subtract or reverse subtract'], ['Presets', 'common blend modes']],
    features: ['gl.blendFunc(src, dst) — all 15 factors', 'gl.blendEquation(ADD | SUBTRACT | REVERSE_SUBTRACT)', 'gl.blendColor + CONSTANT_COLOR / CONSTANT_ALPHA', 'blendFuncSeparate + blendEquationSeparate', 'constant colour/alpha conflict (INVALID_OPERATION)'],
    params: [
      { key: 'src', label: 'Source factor', type: 'select', options: FS_, value: 6 },
      { key: 'dst', label: 'Destination factor', type: 'select', options: FS_.slice(0, 14), value: 7 },
      { key: 'eq', label: 'Equation', type: 'select', options: ['ADD', 'SUBTRACT', 'REV_SUB'], value: 0 },
      { key: 'amode', label: 'Alpha channel', type: 'select', options: ALPHA_MODES, value: 0 },
      { key: 'view', label: 'Show', type: 'select', options: ['RGB', 'Alpha'], value: 0 },
      { key: 'op', label: 'Shape alpha', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7 },
      { key: 'ca', label: 'blendColor alpha', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'alpha', label: 'Alpha', type: 'button' }, { key: 'premul', label: 'Premultiplied', type: 'button' }, { key: 'add', label: 'Additive', type: 'button' },
      { key: 'multiply', label: 'Multiply', type: 'button' }, { key: 'screen', label: 'Screen', type: 'button' }, { key: 'subtract', label: 'Subtract', type: 'button' }, { key: 'constant', label: 'Constant', type: 'button' },
    ],
    code: `gl.enable(gl.BLEND);
gl.blendEquation(gl.FUNC_ADD);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
// separate rule for alpha
gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
gl.blendColor(0.22, 0.84, 0.91, 0.5); // for CONSTANT_*`,
    init(ctx) {
      const { util } = ctx;
      const bg = util.program(G.fullscreenVS, G.colors + `
varying vec2 v_uv;
void main() {
  vec2 c = floor(v_uv * vec2(24.0, 14.0));
  vec3 col = mix(vec3(0.16, 0.17, 0.2), vec3(0.3, 0.31, 0.34), mod(c.x + c.y, 2.0));
  if (v_uv.y > 0.8) col = vec3(v_uv.x);
  else if (v_uv.y < 0.2) { float k = floor(v_uv.x * 8.0); col = k < 2.0 ? A1 : k < 4.0 ? A2 : k < 6.0 ? vec3(1.0, 0.74, 0.34) : BONE; col *= 0.5 + 0.5 * fract(v_uv.x * 4.0); }
  gl_FragColor = vec4(col, v_uv.x);
}`);
      const shape = util.program(`
attribute vec2 a_pos; uniform vec2 u_c; uniform float u_s; uniform vec2 u_res; uniform float u_rot;
varying vec2 v_q;
void main() { v_q = a_pos; gl_Position = vec4((u_c + a_pos * u_s) / u_res * 2.0 - 1.0, 0.0, 1.0); }`, `
uniform int u_kind; uniform vec3 u_col; uniform float u_op; uniform float u_rot;
varying vec2 v_q;
void main() {
  float c = cos(u_rot), s = sin(u_rot);
  vec2 q = vec2(c * v_q.x - s * v_q.y, s * v_q.x + c * v_q.y);
  float d;
  if (u_kind == 0) d = length(q) - 0.92;
  else if (u_kind == 1) { vec2 b = abs(q) - vec2(0.62); d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - 0.2; }
  else { const float k = 1.7320508; vec2 p = q * 1.15; p.y += 0.25; p.x = abs(p.x) - 1.0; p.y = p.y + 1.0 / k; if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0; p.x -= clamp(p.x, -2.0, 0.0); d = -length(p) * sign(p.y) / 1.15; }
  if (d > 0.0) discard;
  float edge = smoothstep(0.0, -0.025, d);
  gl_FragColor = vec4(u_col * (0.85 + 0.15 * v_q.y), u_op * edge);
}`);
      const show = util.program(G.fullscreenVS, `uniform sampler2D u_tex; uniform int u_view; varying vec2 v_uv;
void main() { vec4 c = texture2D(u_tex, v_uv); gl_FragColor = vec4(u_view == 1 ? vec3(c.a) : c.rgb, 1.0); }`);
      const k = kit(util);
      const info = panel(ctx, 'ov-tr');
      const shapes = [
        { kind: 0, col: S.A1, off: [-0.14, 0.05], p: null },
        { kind: 1, col: S.A2, off: [0.14, 0.05], p: null },
        { kind: 2, col: AMBER, off: [0, -0.13], p: null },
      ];
      return { bg, shape, show, k, info, shapes, drag: -1, key: '' };
    },
    action(ctx, s, key) {
      const p = PRESETS[key]; if (!p) return;
      ctx.syncParam('src', p[0]); ctx.syncParam('dst', p[1]); ctx.syncParam('eq', p[2]);
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = ctx.width, H = ctx.height, m = Math.min(W, H);
      if (s.key !== `${W}x${H}`) { if (s.tg) util.release(s.tg.fb, s.tg.tex); s.tg = util.target(W, H); s.key = `${W}x${H}`; s.shapes.forEach((sh) => { sh.p = null; }); }
      const size = m * 0.2;
      const px = input.x * ctx.dpr, py = H - input.y * ctx.dpr;
      s.shapes.forEach((sh, i) => {
        if (!sh.p) sh.p = [W * 0.5 + sh.off[0] * m * 1.3, H * 0.5 + sh.off[1] * m * 1.3];
        sh.d = [Math.sin(t * 0.6 + i * 2.1) * m * 0.025, Math.cos(t * 0.5 + i * 1.3) * m * 0.02];
      });
      if (input.down && s.drag < 0 && !s.wasDown) {
        for (let i = s.shapes.length - 1; i >= 0; i--) { const sh = s.shapes[i]; if (Math.hypot(px - sh.p[0] - sh.d[0], py - sh.p[1] - sh.d[1]) < size) { s.drag = i; s.grab = [sh.p[0] - px, sh.p[1] - py]; break; } }
      }
      s.wasDown = input.down;
      if (!input.down) s.drag = -1;
      if (s.drag >= 0) { const sh = s.shapes[s.drag]; sh.p = [clamp(px + s.grab[0], 0, W), clamp(py + s.grab[1], 0, H)]; }
      const src = params.src, dst = params.dst;
      const isCC = (f) => f === 10 || f === 11, isCA = (f) => f === 12 || f === 13;
      const conflict = (isCC(src) && isCA(dst)) || (isCA(src) && isCC(dst));
      util.bindTarget(s.tg);
      s.bg.use(); util.drawFullscreen();
      if (!conflict) {
        gl.enable(gl.BLEND);
        gl.blendColor(0.22, 0.84, 0.91, params.ca);
        const e = gl[EQ[params.eq]];
        if (params.amode === 0) { gl.blendEquation(e); gl.blendFunc(gl[F[src]], gl[F[dst]]); }
        else {
          const A = [null, [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.FUNC_ADD], [gl.ZERO, gl.ONE, gl.FUNC_ADD], [gl.ONE, gl.ONE, gl.FUNC_REVERSE_SUBTRACT]][params.amode];
          gl.blendEquationSeparate(e, A[2]); gl.blendFuncSeparate(gl[F[src]], gl[F[dst]], A[0], A[1]);
        }
        s.shape.use().set({ u_s: size, u_res: [W, H], u_op: params.op });
        s.shapes.forEach((sh, i) => {
          s.shape.set({ u_c: [sh.p[0] + sh.d[0], sh.p[1] + sh.d[1]], u_kind: sh.kind, u_col: sh.col, u_rot: sh.kind ? t * 0.15 * (i % 2 ? 1 : -1) : 0 });
          s.k.quad.draw();
        });
        gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ZERO);
      }
      util.bindTarget(null, W, H);
      util.tex(0, s.tg.tex);
      s.show.use().set({ u_tex: 0, u_view: params.view }); util.drawFullscreen();
      util.tex(0, null);
      const sig = [src, dst, params.eq, params.amode, conflict].join();
      if (sig !== s.sig) {
        s.sig = sig;
        const fs = `src·<b>${F[src]}</b>`, fd = `dst·<b>${F[dst]}</b>`;
        const rgb = params.eq === 0 ? `${fs}<br>&nbsp;&nbsp;+ ${fd}` : params.eq === 1 ? `${fs}<br>&nbsp;&nbsp;− ${fd}` : `${fd}<br>&nbsp;&nbsp;− ${fs}`;
        const alpha = ['same factors and equation', 'src·ONE + dst·ONE_MINUS_SRC_ALPHA', 'src·ZERO + dst·ONE (unchanged)', 'dst·ONE − src·ONE'][params.amode];
        s.info.innerHTML = conflict ? `<span class="off">CONSTANT_COLOR and CONSTANT_ALPHA cannot be paired as source and destination factors: blendFunc would raise INVALID_OPERATION, so nothing is blended.</span>`
          : `<b>${params.amode ? 'blendFuncSeparate' : 'blendFunc'}</b> · ${EQ[params.eq]}<br>RGB = ${rgb}<br>A = ${alpha}<br>blendColor <b>(0.22, 0.84, 0.91, ${params.ca.toFixed(2)})</b>`;
      }
      ctx.canvas.style.cursor = s.drag >= 0 ? 'grabbing' : 'grab';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Min & max blending                                             */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'blend-minmax',
    title: 'Min & Max Blending',
    category: CAT,
    thumb: 'tall',
    hint: 'drag to orbit · hover to inject',
    description: 'EXT_blend_minmax adds MIN_EXT and MAX_EXT to blendEquation: the framebuffer keeps the smaller or larger of source and destination, ignoring the blend factors. Drawing a cloud of ninety thousand particles with MAX gives a maximum-intensity projection, the technique used to read CT angiograms: the brightest structure along each ray survives, however much faint haze lies in front. Additive blending sums everything and drowns the structure in haze; MIN on a light background keeps the darkest sample instead.',
    interact: [['Drag', 'orbit the volume'], ['Hover', 'a bright tracer follows the pointer through the volume'], ['Mode', 'ADD, MAX, MIN or ADD and MAX side by side']],
    features: ['EXT_blend_minmax', 'blendEquation(MAX_EXT) → maximum-intensity projection', 'blendEquation(MIN_EXT) → darkest wins', 'factors are ignored by MIN / MAX', 'FUNC_ADD for comparison'],
    params: [
      { key: 'mode', label: 'Equation', type: 'select', options: ['ADD', 'MAX', 'MIN', 'ADD | MAX'], value: 3 },
      { key: 'gain', label: 'Additive gain', type: 'range', min: 0.01, max: 0.4, step: 0.005, value: 0.07 },
      { key: 'ps', label: 'Point size', type: 'range', min: 1, max: 6, step: 0.5, value: 2.5 },
      { key: 'haze', label: 'Haze density', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6 },
    ],
    code: `const ext = gl.getExtension('EXT_blend_minmax');
gl.enable(gl.BLEND);
gl.blendEquation(ext.MAX_EXT);   // keeps max(src, dst) per channel
drawParticles();
gl.blendEquation(ext.MIN_EXT);   // darkest wins (clear to white first)`,
    init(ctx) {
      const { gl, util } = ctx;
      const ext = ctx.ext('EXT_blend_minmax');
      const N = 90000;
      const data = new Float32Array(N * 5);
      const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(Math.random() * 6.2832);
      const blobs = [[0.45, 0.3, 0.1], [-0.4, -0.35, 0.3], [0.1, -0.6, -0.4], [-0.25, 0.55, -0.35]];
      for (let i = 0; i < N; i++) {
        const r = Math.random();
        let p, I, h;
        if (r < 0.32) { const tt = Math.random() * Math.PI * 4; p = [Math.cos(tt) * 0.7 + gauss() * 0.035, (tt / (Math.PI * 4)) * 2.0 - 1.0 + gauss() * 0.035, Math.sin(tt) * 0.7 + gauss() * 0.035]; I = 0.7 + Math.random() * 0.3; h = 0; }
        else if (r < 0.36) { const tt = Math.random() * Math.PI * 4; p = [Math.cos(tt + Math.PI) * 0.7 + gauss() * 0.02, (tt / (Math.PI * 4)) * 2.0 - 1.0, Math.sin(tt + Math.PI) * 0.7 + gauss() * 0.02]; I = 0.55; h = 0.2; }
        else if (r < 0.55) { const b = blobs[i % 4]; const g = [gauss(), gauss(), gauss()]; p = b.map((v, j) => v + g[j] * 0.13); I = Math.exp(-(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) * 0.35); h = 1; }
        else { let q; do { q = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]; } while (V3.len(q) > 1); p = q.map((v) => v * 1.25); I = 0.06 + Math.random() * 0.2; h = 0.5 + Math.random() * 0.3; }
        data.set([p[0], p[1], p[2], I, h], i * 5);
      }
      const buf = util.buffer(gl.ARRAY_BUFFER, data);
      const mesh = util.mesh([{ buffer: buf, loc: 0, size: 4, stride: 20, offset: 0 }, { buffer: buf, loc: 3, size: 1, stride: 20, offset: 16 }], null, { count: N });
      const prog = util.program(`
attribute vec4 a_pos; attribute float a_col;
uniform mat4 u_vp; uniform float u_ps; uniform vec3 u_probe; uniform float u_t; uniform float u_haze;
varying float v_i; varying float v_h;
void main() {
  vec3 p = a_pos.xyz;
  float d = length(p - u_probe);
  float boost = exp(-d * d * 30.0);
  v_i = a_pos.w * (a_col > 0.45 && a_col < 0.85 ? u_haze : 1.0) + boost * 0.9;
  v_h = boost > 0.3 ? 2.0 : a_col;
  gl_Position = u_vp * vec4(p, 1.0);
  gl_PointSize = u_ps * (1.0 + boost);
}`, G.colors + `
uniform int u_mode; uniform float u_gain;
varying float v_i; varying float v_h;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q);
  if (r > 1.0) discard;
  float soft = 1.0 - r;
  vec3 hue = v_h > 1.5 ? vec3(1.0, 0.74, 0.34) : v_h > 0.9 ? A2 : v_h > 0.4 ? mix(A1, A2, 0.5) * 0.7 : A1;
  float i = v_i * soft;
  vec3 c = mix(hue * i, BONE, smoothstep(0.75, 1.1, i));
  if (u_mode == 0) gl_FragColor = vec4(c * u_gain, 1.0);
  else if (u_mode == 1) gl_FragColor = vec4(c, 1.0);
  else gl_FragColor = vec4(mix(vec3(0.95, 0.94, 0.91), mix(hue, INK, 0.55), clamp(i * 1.1, 0.0, 1.0)), 1.0);
}`);
      const info = panel(ctx, 'ov-tr', `EXT_blend_minmax ${ext ? '<span class="on">available</span>' : '<span class="off">missing: only ADD is possible</span>'}<br>${N.toLocaleString()} particles · helix, four blobs, haze`);
      const la = label(ctx, 'FUNC_ADD'), lb = label(ctx, 'MAX_EXT');
      return { ext, mesh, prog, info, la, lb, cam: new S.OrbitCam({ dist: 3.6, pitch: 0.25, yaw: 0.3, auto: 0.18 }), probe: [0, 0, 0] };
    },
    frame(ctx, s, t, dt) {
      const { gl, params, input } = ctx;
      const W = ctx.width, H = ctx.height;
      s.cam.update(input, dt);
      const vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view());
      const g = ghost(t, 0.18, 0.22);
      const r = s.cam.ray(input.hover ? input.nx : g.uvx * 2 - 1, input.hover ? input.ny : g.uvy * 2 - 1, ctx.aspect);
      const hp = S.math.Ray.plane(r.origin, r.dir, [0, 0, 0], s.cam.basis().fwd) || [0, 0, 0];
      for (let i = 0; i < 3; i++) s.probe[i] += (clamp(hp[i], -1.3, 1.3) - s.probe[i]) * damp(6, dt);
      let mode = params.mode;
      if (!s.ext) mode = 0;
      gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      s.prog.use().set({ u_vp: vp, u_ps: params.ps * ctx.dpr, u_probe: s.probe, u_t: t, u_gain: params.gain, u_haze: params.haze });
      const pass = (m, x0, x1) => {
        gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, 0, x1 - x0, H);
        if (m === 2) gl.clearColor(0.95, 0.94, 0.91, 1); else gl.clearColor(0.012, 0.014, 0.022, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendEquation(m === 0 ? gl.FUNC_ADD : m === 1 ? s.ext.MAX_EXT : s.ext.MIN_EXT);
        s.prog.set({ u_mode: m });
        s.mesh.draw(gl.POINTS);
        gl.disable(gl.SCISSOR_TEST);
      };
      if (mode === 3) { pass(0, 0, W >> 1); pass(1, W >> 1, W); gl.enable(gl.SCISSOR_TEST); gl.scissor((W >> 1) - Math.round(ctx.dpr / 2), 0, Math.max(1, Math.round(ctx.dpr)), H); gl.clearColor(0.93, 0.91, 0.88, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST); }
      else pass(mode, 0, W);
      gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);
      const names = ['FUNC_ADD', 'MAX_EXT', 'MIN_EXT'];
      s.la.textContent = mode === 3 ? 'FUNC_ADD' : names[mode];
      s.la.style.left = '24px'; s.la.style.bottom = '78px'; s.la.style.color = mode === 2 ? '#111' : '';
      s.lb.style.display = mode === 3 ? '' : 'none'; s.lb.style.left = ctx.cssWidth / 2 + 14 + 'px'; s.lb.style.bottom = '78px';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Depth test & range                                             */
  /* ---------------------------------------------------------------- */
  const DF = ['NEVER', 'LESS', 'EQUAL', 'LEQUAL', 'GREATER', 'NOTEQUAL', 'GEQUAL', 'ALWAYS'];
  S.register({
    id: 'depth-lab',
    title: 'Depth Test & Range',
    category: CAT,
    thumb: 'square',
    hint: 'move the held object · lower the near plane',
    description: 'depthFunc decides which comparison against the stored depth lets a fragment through; depthMask decides whether it writes its own depth; clearDepth is the value the buffer starts from, so GREATER only draws anything once it is below 1. depthRange maps clip depth onto a slice of the buffer: giving the scene 0.1–1 and the held object 0–0.1 keeps the object in front even when it passes through walls. The floor carries a second layer only 2 mm above it; pull the near plane in and the depth buffer runs out of precision there, so the two layers fight.',
    interact: [['Move', 'the held object follows the pointer'], ['Drag', 'orbit'], ['Near plane', 'log scale: closer means less precision far away'], ['Depth colours', 'shade by gl_FragCoord.z to see depthRange']],
    features: ['gl.depthFunc — all 8 comparisons', 'gl.depthMask(false)', 'gl.depthRange(near, far) split', 'gl.clearDepth', 'depth precision vs near plane (z-fighting)'],
    params: [
      { key: 'func', label: 'depthFunc', type: 'select', options: ['NEVER', 'LESS', 'EQUAL', 'LEQUAL', 'GREATER', 'NOTEQ', 'GEQUAL', 'ALWAYS'], value: 1 },
      { key: 'mask', label: 'depthMask (write depth)', type: 'toggle', value: true },
      { key: 'split', label: 'Split depthRange for held object', type: 'toggle', value: true },
      { key: 'clear', label: 'clearDepth', type: 'range', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'near', label: 'Near plane (log10)', type: 'range', min: -6, max: 0, step: 0.05, value: -3.6 },
      { key: 'zvis', label: 'Depth colours', type: 'toggle', value: false },
    ],
    code: `gl.clearDepth(1.0); gl.clear(gl.DEPTH_BUFFER_BIT);
gl.depthFunc(gl.LESS); gl.depthMask(true);
gl.depthRange(0.1, 1.0); drawScene();
gl.depthRange(0.0, 0.1); drawHeldObject();  // always in front
gl.depthRange(0.0, 1.0);`,
    init(ctx) {
      const { gl } = ctx;
      const k = kit(ctx.util);
      // the raised layer is a triangle fan: different triangles from the floor quad, so rounding differs → speckled fighting
      const fan = [0, 0];
      for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; fan.push(Math.cos(a), Math.sin(a)); }
      const fanMesh = ctx.util.mesh([{ buffer: ctx.util.buffer(gl.ARRAY_BUFFER, new Float32Array(fan)), loc: 0, size: 2 }], null, { count: 98 });
      const info = panel(ctx, 'ov-tr');
      return { k, fanMesh, info, bits: gl.getParameter(gl.DEPTH_BITS), cam: new S.OrbitCam({ dist: 4.2, pitch: 0.42, yaw: 0.3, auto: 0.07, target: [0, 0.6, 0], minDist: 2, maxDist: 12 }), h: [0.2, -0.1] };
    },
    frame(ctx, s, t, dt) {
      const { gl, params, input } = ctx;
      const near = Math.pow(10, params.near), far = 200;
      s.cam.update(input, dt);
      const P = M4.persp(s.cam.fov, ctx.aspect, near, far), V = s.cam.view(), vp = M4.mul(P, V), eye = s.cam.eye();
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(INK[0], INK[1], INK[2], 1); gl.clearDepth(params.clear);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl[DF[params.func]]); gl.depthMask(params.mask);
      if (params.split) gl.depthRange(0.1, 1);
      const zm = params.zvis ? 2 : 0;
      const k = s.k;
      k.begin(vp, eye, 0.04);
      k.drawFloor(14, 0, S.A1, [0.035, 0.04, 0.055], zm);
      if (!params.zvis) { k.floor.use().set({ u_size: 9, u_y: 0.002, u_mode: 1 }); s.fanMesh.draw(gl.TRIANGLE_FAN); }
      const objs = [];
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + t * 0.25; objs.push([['cube', 'sphere', 'octa', 'torus', 'knot', 'cube'][i], TRS([Math.cos(a) * 1.5, 0.55, Math.sin(a) * 1.5], [t * 0.4 + i, t * 0.5 + i, 0], i === 4 ? 0.3 : 0.45), [S.A1, BONE, S.A2, AMBER, S.A1, BONE][i]]); }
      objs.push(['cube', TRS([0, 1.0, 0], [0, 0.3, 0], [0.3, 2.0, 0.3]), [0.5, 0.52, 0.58]]);
      for (const [m, M, c] of objs) k.draw(m, M, c, { u_mode: zm });
      // held object, placed in view space in front of the camera
      const g = ghost(t, 0.25, 0.2);
      const tx = input.hover ? input.nx : g.uvx * 2 - 1, ty = input.hover ? input.ny : g.uvy * 2 - 1;
      s.h[0] += (tx - s.h[0]) * damp(8, dt); s.h[1] += (ty - s.h[1]) * damp(8, dt);
      const b = s.cam.basis(), tf = Math.tan(s.cam.fov / 2), dist = 2.4;
      const pos = V3.add(eye, V3.add(V3.scale(b.fwd, dist), V3.add(V3.scale(b.right, s.h[0] * tf * ctx.aspect * dist), V3.scale(b.up, s.h[1] * tf * dist))));
      if (params.split) gl.depthRange(0, 0.1);
      k.draw('knot', TRS(pos, [t * 0.8, t * 0.6, 0], 0.32), BONE, { u_mode: zm });
      gl.depthRange(0, 1); gl.depthMask(true); gl.depthFunc(gl.LESS); gl.clearDepth(1);
      gl.disable(gl.DEPTH_TEST);
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        const dz = (d) => (d * d) / (near * Math.pow(2, s.bits)) * (params.split ? 1 / 0.9 : 1);
        const fmt = (v) => (v < 0.001 ? (v * 1e6).toFixed(1) + ' µm' : v < 1 ? (v * 1000).toFixed(2) + ' mm' : v.toFixed(2) + ' m');
        const r = gl.getParameter(gl.DEPTH_RANGE);
        const nothing = (params.func === 4 || params.func === 6) && params.clear >= 1 ? '<br><span class="off">GREATER/GEQUAL against clearDepth 1 never passes</span>' : params.func === 0 ? '<br><span class="off">NEVER: nothing is drawn</span>' : params.func === 2 ? '<br><span class="off">EQUAL only passes where depth already matches</span>' : '';
        s.info.innerHTML = `DEPTH_BITS <b>${s.bits}</b> · depthFunc <b>${DF[params.func]}</b><br>depthMask <b>${params.mask}</b> · clearDepth <b>${params.clear.toFixed(2)}</b><br>DEPTH_RANGE now <b>${r[0]}–${r[1]}</b> · split <b>${params.split ? 'scene 0.1–1, held 0–0.1' : 'off'}</b><br>near <b>${near < 0.01 ? near.toExponential(1) : near.toFixed(3)}</b> · far <b>${far}</b><br>depth step at 3 m <b>${fmt(dz(3))}</b> · at 8 m <b>${fmt(dz(8))}</b><br>floor layer gap <b>2 mm</b> → may fight beyond <b class="off">${Math.sqrt(0.002 * near * Math.pow(2, s.bits)).toFixed(1)} m</b>${nothing}`;
      }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Polygon offset                                                 */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'polygon-offset',
    title: 'Polygon Offset',
    category: CAT,
    thumb: 'portrait',
    hint: 'click to stamp a decal · tune the offset',
    description: 'Two surfaces in the same plane produce the same depth, give or take rounding, so decals and wireframe overlays flicker through the surface beneath them: z-fighting. POLYGON_OFFSET_FILL pushes the depth of filled polygons by factor × slope + units × the smallest resolvable step. Here the offset is applied to the solid geometry, nudging it away so the coplanar decals and the LINES wireframe win cleanly. Lines and points are never offset in WebGL, which is why the solid is moved rather than the wire.',
    interact: [['Click', 'stamp a decal on the floor'], ['Drag', 'orbit'], ['Offset', 'toggle POLYGON_OFFSET_FILL'], ['Factor / units', 'slope-scaled and constant parts']],
    features: ['gl.enable(gl.POLYGON_OFFSET_FILL)', 'gl.polygonOffset(factor, units)', 'coplanar decals', 'wireframe LINES over a solid', 'POLYGON_OFFSET_FACTOR / _UNITS queries'],
    params: [
      { key: 'on', label: 'POLYGON_OFFSET_FILL', type: 'toggle', value: true },
      { key: 'mode', label: 'Overlay', type: 'select', options: ['Decals', 'Wireframe', 'Both'], value: 2 },
      { key: 'factor', label: 'Factor', type: 'range', min: -2, max: 4, step: 0.1, value: 1 },
      { key: 'units', label: 'Units', type: 'range', min: -4, max: 8, step: 0.5, value: 2 },
      { key: 'clear', label: 'Clear decals', type: 'button' },
    ],
    code: `gl.enable(gl.POLYGON_OFFSET_FILL);
gl.polygonOffset(1.0, 2.0);   // push the solid back
drawSolid();
gl.disable(gl.POLYGON_OFFSET_FILL);
drawDecals();                  // same plane, now wins
wire.draw(gl.LINES);           // lines are never offset`,
    init(ctx) {
      const { gl, util } = ctx;
      const k = kit(util);
      const g = S.geo.torusKnot(180, 20, 0.26, 1.0, 0.45);
      const knot = S.geo.upload(util, g);
      const lines = [];
      for (let q = 0; q < g.idx.length / 6; q++) { const a = g.idx[q * 6], c = g.idx[q * 6 + 1], b = g.idx[q * 6 + 2]; lines.push(a, b, a, c); }
      const wire = util.mesh(knot.attribs, util.buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lines)), { count: lines.length });
      const decal = util.program(`
attribute vec2 a_pos; uniform mat4 u_vp; uniform mat4 u_m; varying vec2 v_q;
void main() { v_q = a_pos; gl_Position = u_vp * u_m * vec4(a_pos, 0.0, 1.0); }`, G.colors + `
uniform int u_kind; uniform vec3 u_col; uniform float u_a; varying vec2 v_q;
void main() {
  float d = length(v_q), a = 0.0;
  if (u_kind == 0) a = step(d, 1.0) * (step(0.78, d) + step(d, 0.5) * step(0.25, d));
  else if (u_kind == 1) a = step(max(abs(v_q.x), abs(v_q.y)), 0.95) * step(0.5, fract((v_q.x + v_q.y) * 2.5));
  else { float th = atan(v_q.y, v_q.x); a = step(d, 0.55 + 0.4 * cos(th * 5.0)); }
  if (a < 0.5) discard;
  gl_FragColor = vec4(u_col * u_a, 1.0);
}`);
      const decals = [];
      for (let i = 0; i < 9; i++) { const a = i * 2.39996, r = 1.6 + (i % 3) * 0.9; decals.push({ p: [Math.cos(a) * r, Math.sin(a) * r], s: 0.35 + (i % 3) * 0.12, kind: i % 3, rot: a }); }
      const info = panel(ctx, 'ov-tr');
      return { k, knot, wire, decal, decals, info, cam: new S.OrbitCam({ dist: 7.5, pitch: 0.55, yaw: 0.5, auto: 0.06, target: [0, 0.8, 0], maxDist: 40 }), prev: null };
    },
    action(ctx, s, key) { if (key === 'clear') s.decals.length = 0; },
    frame(ctx, s, t, dt) {
      const { gl, params, input } = ctx;
      s.cam.update(input, dt);
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 100), s.cam.view()), eye = s.cam.eye();
      const floorHit = (nx, ny) => { const r = s.cam.ray(nx, ny, ctx.aspect); return S.math.Ray.plane(r.origin, r.dir, [0, 0, 0], [0, 1, 0]); };
      for (const c of input.clicks) { const h = floorHit(c.nx, c.ny); if (h) { s.decals.push({ p: [h[0], h[2]], s: 0.3 + Math.random() * 0.3, kind: s.decals.length % 3, rot: Math.random() * 6.28 }); if (s.decals.length > 40) s.decals.shift(); } }
      s.prev = input.hover ? floorHit(input.nx, input.ny) : null;
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(INK[0], INK[1], INK[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const k = s.k;
      if (params.on) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(params.factor, params.units); }
      k.begin(vp, eye, 0.03);
      k.drawFloor(30, 0, S.A1, [0.05, 0.055, 0.07]);
      const boxes = [[-2.2, 0.6, -1.0, 1.2, 0.4], [2.3, 0.5, -0.6, 1.0, -0.5], [0.4, 0.45, 2.2, 0.9, 1.1]].map(([x, y, z, sz, r]) => ({ M: TRS([x, y, z], [0, r, 0], sz), sz }));
      boxes.forEach((b) => k.draw('cube', b.M, [0.55, 0.57, 0.62]));
      const knotM = TRS([0, 1.4, 0], [t * 0.25, t * 0.35, 0], 0.75);
      k.lit.use().set({ u_m: knotM, u_col: [0.2, 0.22, 0.27], u_mode: 0, u_alpha: 1, u_inflate: 0, u_scale: 1 }); s.knot.draw();
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(0, 0);
      const showDecals = params.mode !== 1, showWire = params.mode !== 0;
      if (showDecals) {
        s.decal.use().set({ u_vp: vp, u_a: 1 });
        const flat = (x, z, sc, rot) => M4.mul(M4.translate(x, 0, z), M4.mul(M4.rotY(rot), M4.mul(M4.rotX(-Math.PI / 2), M4.scale(sc))));
        const cols = [S.A2, S.A1, AMBER];
        s.decals.forEach((d) => { s.decal.set({ u_m: flat(d.p[0], d.p[1], d.s, d.rot), u_kind: d.kind, u_col: cols[d.kind] }); k.quad.draw(); });
        if (s.prev) { s.decal.set({ u_m: flat(s.prev[0], s.prev[2], 0.4, t), u_kind: 0, u_col: BONE, u_a: 0.6 }); k.quad.draw(); s.decal.set({ u_a: 1 }); }
        // decals on the box faces, exactly in the face planes (+Z and +Y faces of the unit cube)
        boxes.forEach((b, i) => {
          s.decal.set({ u_m: M4.mul(b.M, M4.mul(M4.translate(0, 0, 0.5), M4.scale(0.36))), u_kind: i % 3, u_col: cols[(i + 1) % 3] }); k.quad.draw();
          s.decal.set({ u_m: M4.mul(b.M, M4.mul(M4.translate(0, 0.5, 0), M4.mul(M4.rotX(-Math.PI / 2), M4.scale(0.36)))), u_kind: (i + 2) % 3, u_col: cols[i % 3] }); k.quad.draw();
        });
      }
      if (showWire) {
        k.lit.use().set({ u_m: knotM, u_col: S.A1, u_mode: 1, u_alpha: 1 });
        s.wire.draw(gl.LINES);
      }
      gl.disable(gl.DEPTH_TEST);
      if (Math.floor(t * 3) !== s.tick) {
        s.tick = Math.floor(t * 3);
        if (params.on) gl.polygonOffset(params.factor, params.units);
        const f = gl.getParameter(gl.POLYGON_OFFSET_FACTOR), u = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
        gl.polygonOffset(0, 0);
        s.info.innerHTML = `POLYGON_OFFSET_FILL ${params.on ? '<span class="on">on</span>' : '<span class="off">off → z-fighting</span>'}<br>factor <b>${f.toFixed(1)}</b> · units <b>${u.toFixed(1)}</b> (on the solids)<br>decals <b>${s.decals.length + 6}</b> coplanar quads<br>wire <b>${(s.wire.count / 2).toLocaleString()}</b> LINES (not offset)`;
      }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Stencil buffer                                                 */
  /* ---------------------------------------------------------------- */
  const SOPS = ['INCR', 'INCR_WRAP', 'DECR_WRAP', 'INVERT', 'REPLACE'];
  S.register({
    id: 'stencil',
    title: 'Stencil Buffer',
    category: CAT,
    thumb: 'wide',
    hint: 'move the portal · switch modes',
    description: 'The stencil buffer holds an 8-bit value per pixel that drawing can test (stencilFunc) and modify (stencilOp) without touching colour. Portal writes a disc around the pointer and draws a second world only inside it. Outline marks one object and redraws it inflated wherever the mark is absent. Count makes overlapping shapes increment, wrap or invert the value and paints the result, so INVERT on a self-intersecting star gives even-odd filling. Capping uses stencilOpSeparate, counting front faces up and back faces down, to find where a clip plane cuts the inside of a closed mesh.',
    interact: [['Move', 'drives the portal, the outlined object, the shapes or the cut height'], ['Drag', 'orbit (portal, outline, capping)'], ['Mode', 'four classic stencil techniques'], ['Op / mask', 'stencilOp and stencilMask in Count mode']],
    features: ['gl.stencilFunc / stencilOp (REPLACE, INCR, INCR_WRAP, DECR_WRAP, INVERT)', 'gl.stencilMask', 'stencilFuncSeparate + stencilOpSeparate', 'colorMask(false…) mask-only passes', 'clearStencil + STENCIL_BUFFER_BIT'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Portal', 'Outline', 'Count', 'Capping'], value: 0 },
      { key: 'op', label: 'Count: stencilOp', type: 'select', options: ['INCR', 'INCR_WRAP', 'DECR_WRAP', 'INVERT', 'REPLACE'], value: 1 },
      { key: 'smask', label: 'Count: stencilMask', type: 'select', options: ['0xFF', '0x07', '0x01'], value: 0 },
      { key: 'r', label: 'Portal radius', type: 'range', min: 0.1, max: 0.6, step: 0.01, value: 0.32 },
    ],
    code: `gl.enable(gl.STENCIL_TEST);
gl.colorMask(false, false, false, false);
gl.stencilFunc(gl.ALWAYS, 1, 0xff);
gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
drawPortalDisc();
gl.colorMask(true, true, true, true);
gl.stencilFunc(gl.EQUAL, 1, 0xff); drawOtherWorld();
// capping: gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);`,
    init(ctx) {
      const { gl, util } = ctx;
      const k = kit(util);
      const disc = util.program(DISC_VS, DISC_FS);
      const full = util.program(G.fullscreenVS, `uniform vec4 u_col; varying vec2 v_uv; void main() { gl_FragColor = u_col; }`);
      // pentagram as a self-intersecting fan, for even-odd filling with INVERT
      const st = [];
      for (const i of [0, 2, 4, 1, 3]) { const a = Math.PI / 2 + i * Math.PI * 2 / 5; st.push(Math.cos(a), Math.sin(a)); }
      const star = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array(st)), loc: 0, size: 2 }], null, { count: 5 });
      const info = panel(ctx, 'ov-tr');
      const sb = gl.getParameter(gl.STENCIL_BITS);
      if (!sb) ctx.message('This context has no stencil buffer.');
      return { k, disc, full, star, info, sb, cam: new S.OrbitCam({ dist: 6, pitch: 0.45, yaw: 0.5, auto: 0.08, target: [0, 0.7, 0], minPitch: 0.25 }), c: [0, 0], sel: 0 };
    },
    frame(ctx, s, t, dt) {
      const { gl, params, input } = ctx;
      const W = ctx.width, H = ctx.height, ar = ctx.aspect;
      const k = s.k;
      const mode = params.mode;
      if (mode !== 2) s.cam.update(input, dt);
      const vp = M4.mul(s.cam.proj(ar, 0.1, 80), s.cam.view()), eye = s.cam.eye();
      const g = ghost(t, 0.26, 0.2);
      const tx = input.hover ? input.nx : g.uvx * 2 - 1, ty = input.hover ? input.ny : g.uvy * 2 - 1;
      s.c[0] += (tx - s.c[0]) * damp(10, dt); s.c[1] += (ty - s.c[1]) * damp(10, dt);
      gl.viewport(0, 0, W, H);
      gl.clearColor(INK[0], INK[1], INK[2], 1); gl.clearStencil(0); gl.stencilMask(0xff);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.STENCIL_TEST);
      const worldA = (filter) => {
        k.begin(vp, eye, 0.05);
        k.drawFloor(30, 0);
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI * 2 + t * 0.2;
          k.draw(['cube', 'sphere', 'octa', 'torus', 'knot', 'cube', 'sphere'][i], TRS([Math.cos(a) * 2, 0.5, Math.sin(a) * 2], [t * 0.3 + i, t * 0.4 + i, 0], i === 4 ? 0.28 : 0.42), filter ? filter(i) : [0.62, 0.64, 0.7]);
        }
        k.draw('cube', TRS([0, 0.9, 0], [0, t * 0.2, 0], [0.5, 1.8, 0.5]), [0.4, 0.42, 0.48]);
      };
      let infoTxt = '';
      if (mode === 0) {
        const r = [params.r / ar, params.r];
        gl.colorMask(false, false, false, false); gl.depthMask(false);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        s.disc.use().set({ u_c: s.c, u_r: r, u_rot: 0, u_inner: 0, u_kind: 0, u_col: [1, 1, 1, 1] }); k.quad.draw();
        gl.colorMask(true, true, true, true); gl.depthMask(true);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        gl.enable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
        worldA();
        // the other world: own sky, floor and objects, only where stencil == 1
        gl.stencilFunc(gl.EQUAL, 1, 0xff);
        gl.disable(gl.DEPTH_TEST);
        s.full.use().set({ u_col: [0.1, 0.035, 0.075, 1] }); ctx.util.drawFullscreen();
        gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
        const fogB = [0.1, 0.035, 0.075];
        k.begin(vp, eye, 0.06, fogB);
        k.drawFloor(30, 0, S.A2, [0.08, 0.03, 0.06]);
        k.draw('knot', TRS([0, 1.2, 0], [t * 0.5, t * 0.3, 0], 0.8), S.A2);
        for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - t * 0.3; k.draw('octa', TRS([Math.cos(a) * 2.4, 0.6 + Math.sin(t + i) * 0.3, Math.sin(a) * 2.4], [t + i, t, 0], 0.5), AMBER); }
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST);
        s.disc.use().set({ u_inner: 0.965, u_col: [S.A2[0], S.A2[1], S.A2[2], 1] }); k.quad.draw();
        infoTxt = 'disc → stencil 1 (colorMask off)<br>world A: stencilFunc(NOTEQUAL, 1)<br>world B: stencilFunc(EQUAL, 1)';
      } else if (mode === 1) {
        // pick the object nearest the pointer on screen
        let best = 1e9;
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI * 2 + t * 0.2; const c = xform(vp, [Math.cos(a) * 2, 0.5, Math.sin(a) * 2]);
          const d = Math.hypot(c[0] / c[3] - s.c[0], c[1] / c[3] - s.c[1]); if (d < best) { best = d; s.sel = i; }
        }
        gl.enable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        k.begin(vp, eye, 0.05);
        gl.stencilMask(0x00); k.drawFloor(30, 0); k.draw('cube', TRS([0, 0.9, 0], [0, t * 0.2, 0], [0.5, 1.8, 0.5]), [0.4, 0.42, 0.48]);
        const shapes = ['cube', 'sphere', 'octa', 'torus', 'knot', 'cube', 'sphere'];
        const Ms = [];
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI * 2 + t * 0.2;
          Ms.push(TRS([Math.cos(a) * 2, 0.5, Math.sin(a) * 2], [t * 0.3 + i, t * 0.4 + i, 0], i === 4 ? 0.28 : 0.42));
          gl.stencilMask(i === s.sel ? 0xff : 0x00);   // only the chosen object marks the stencil
          k.draw(shapes[i], Ms[i], i === s.sel ? BONE : [0.55, 0.57, 0.63]);
        }
        gl.stencilMask(0xff);
        gl.disable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.NOTEQUAL, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        const flatShape = shapes[s.sel] === 'cube' || shapes[s.sel] === 'octa';
        const sc = shapes[s.sel] === 'knot' ? 0.28 : 0.42;
        k.draw(shapes[s.sel], Ms[s.sel], S.A1, { u_mode: 1, u_scale: flatShape ? 1.18 : 1, u_inflate: flatShape ? 0 : 0.07 / sc });
        gl.disable(gl.STENCIL_TEST);
        infoTxt = 'object drawn with stencilMask(0xFF), others 0x00<br>inflated copy where stencilFunc(NOTEQUAL, 1)<br>depth test off for the outline';
      } else if (mode === 2) {
        const op = gl[SOPS[params.op]], mask = [0xff, 0x07, 0x01][params.smask];
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, op); gl.stencilMask(mask);
        s.disc.use();
        const shapesN = 9, shapes = [];
        for (let i = 0; i < shapesN; i++) {
          const a = i / shapesN * Math.PI * 2 + t * (0.25 + (i % 3) * 0.1), rr = 0.28 + (i % 3) * 0.14;
          const sh = { c: [s.c[0] + Math.cos(a) * rr / ar, s.c[1] + Math.sin(a) * rr], r: [(0.2 + (i % 4) * 0.05) / ar, 0.2 + (i % 4) * 0.05], kind: i % 2, rot: t * 0.4 + i };
          shapes.push(sh);
          s.disc.set({ u_c: sh.c, u_r: sh.r, u_rot: sh.rot, u_inner: 0, u_kind: sh.kind, u_col: [1, 1, 1, 1] }); k.quad.draw();
        }
        // a self-intersecting pentagram as one TRIANGLE_FAN: INVERT gives even-odd filling
        s.starProg = s.starProg || ctx.util.program(`attribute vec2 a_pos; uniform vec2 u_c; uniform vec2 u_r; uniform float u_rot;
void main() { float c = cos(u_rot), s = sin(u_rot); gl_Position = vec4(u_c + vec2(c * a_pos.x - s * a_pos.y, s * a_pos.x + c * a_pos.y) * u_r, 0.0, 1.0); }`, `void main() { gl_FragColor = vec4(1.0); }`);
        s.starProg.use().set({ u_c: s.c, u_r: [0.36 / ar, 0.36], u_rot: -t * 0.2 });
        s.star.draw(gl.TRIANGLE_FAN);
        gl.colorMask(true, true, true, true); gl.stencilMask(0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        // paint each stencil value
        s.full.use();
        const HEAT = [[0.07, 0.26, 0.3], S.A1, [0.62, 0.4, 0.85], S.A2, AMBER, BONE];
        for (let v = 1; v <= 10; v++) { const c = HEAT[Math.min(v, 6) - 1]; gl.stencilFunc(gl.EQUAL, v, 0xff); s.full.set({ u_col: [c[0], c[1], c[2], 1] }); ctx.util.drawFullscreen(); }
        for (let v = 255; v >= 250; v--) { const kk = (255 - v) / 5; gl.stencilFunc(gl.EQUAL, v, 0xff); s.full.set({ u_col: [lerp(0.95, 0.5, kk), lerp(0.93, 0.48, kk), lerp(0.88, 0.46, kk), 1] }); ctx.util.drawFullscreen(); }
        gl.disable(gl.STENCIL_TEST);
        // faint outlines of the shapes
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        s.disc.use();
        shapes.forEach((sh) => { s.disc.set({ u_c: sh.c, u_r: sh.r, u_rot: sh.rot, u_inner: 0.97, u_kind: sh.kind, u_col: [0.12, 0.12, 0.12, 1] }); k.quad.draw(); });
        gl.disable(gl.BLEND);
        infoTxt = `colorMask off · stencilOp(KEEP, KEEP, <b>${SOPS[params.op]}</b>)<br>stencilMask <b>${['0xFF', '0x07', '0x01'][params.smask]}</b><br>then one full-screen pass per value:<br>stencilFunc(EQUAL, v): <span style="color:#38d6e8">1</span>→<span style="color:#ff4fa3">4</span>→<span style="color:#ffbd57">5</span>… · <b>255…250</b> (wrapped) in bone`;
      } else {
        // capping: clip a closed knot with y < h and fill the cut with the stencil parity
        const h = 0.25 + (s.c[1] * 0.5 + 0.5) * 1.5;
        const M = TRS([0, 1.1, 0], [t * 0.2, t * 0.3, 0], 0.85);
        gl.enable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        k.begin(vp, eye, 0.04);
        k.drawFloor(30, 0);
        k.draw('knot', M, S.A1, { u_mode: 3, u_clipY: h });
        // count surfaces behind every pixel: front faces +1, back faces −1, no depth test
        gl.colorMask(false, false, false, false); gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
        gl.stencilFuncSeparate(gl.FRONT, gl.ALWAYS, 0, 0xff);
        gl.stencilFuncSeparate(gl.BACK, gl.ALWAYS, 0, 0xff);
        gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
        gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
        k.draw('knot', M, S.A1, { u_mode: 3, u_clipY: h });
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        gl.colorMask(true, true, true, true); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
        // the cap: a plane at y = h, drawn only where the count is non-zero
        gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
        s.capProg = s.capProg || ctx.util.program(`attribute vec2 a_pos; uniform mat4 u_vp; uniform float u_h; varying vec3 v_w;
void main() { v_w = vec3(a_pos.x * 4.0, u_h, a_pos.y * 4.0); gl_Position = u_vp * vec4(v_w, 1.0); }`, G.colors + `varying vec3 v_w;
void main() { float hatch = step(0.5, fract((v_w.x + v_w.z) * 6.0)); gl_FragColor = vec4(mix(A2 * 0.75, mix(A2, BONE, 0.35), hatch), 1.0); }`);
        s.capProg.use().set({ u_vp: vp, u_h: h }); k.quad.draw();
        gl.disable(gl.STENCIL_TEST); gl.disable(gl.DEPTH_TEST);
        infoTxt = `cut height <b>${h.toFixed(2)}</b><br>stencilOpSeparate(FRONT … INCR_WRAP)<br>stencilOpSeparate(BACK … DECR_WRAP)<br>cap where stencilFunc(NOTEQUAL, 0)`;
      }
      gl.disable(gl.STENCIL_TEST); gl.disable(gl.DEPTH_TEST);
      gl.stencilMask(0xff); gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      if (infoTxt !== s.last) { s.last = infoTxt; s.info.innerHTML = `STENCIL_BITS <b>${s.sb}</b><br>` + infoTxt; }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 6. Colour mask                                                    */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'color-mask',
    title: 'Colour Mask',
    category: CAT,
    thumb: 'square',
    hint: 'red/cyan glasses · drag to orbit',
    description: 'colorMask chooses which channels a draw may write. Anaglyph renders the scene twice from two eye positions, once writing only red and once only green and blue, which red/cyan glasses separate again. Channels draws the scene over a grey background with the selected channels masked, so the untouched channels keep the background\'s value. Depth prepass draws everything first with all colour writes off, filling only depth, and then shades with depthFunc EQUAL; the heat map counts how often each pixel was shaded with and without it.',
    interact: [['Drag', 'orbit (in prepass mode: move the split)'], ['Mode', 'anaglyph, channel masks or depth prepass'], ['Eye separation', 'stereo strength'], ['R / G / B', 'channel writes in Channels mode']],
    features: ['gl.colorMask(r, g, b, a)', 'red/cyan anaglyph from two passes', 'colorMask(false ×4) depth-only prepass', 'depthFunc(EQUAL) + depthMask(false) shading pass', 'overdraw counting with additive blending'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Anaglyph', 'Channels', 'Depth prepass'], value: 0 },
      { key: 'sep', label: 'Eye separation', type: 'range', min: 0, max: 0.4, step: 0.005, value: 0.12 },
      { key: 'r', label: 'Write R', type: 'toggle', value: false },
      { key: 'g', label: 'Write G', type: 'toggle', value: true },
      { key: 'b', label: 'Write B', type: 'toggle', value: true },
    ],
    code: `// left eye
gl.colorMask(true, false, false, true);  drawScene(leftEye);
gl.clear(gl.DEPTH_BUFFER_BIT);
gl.colorMask(false, true, true, true);   drawScene(rightEye);
// depth prepass
gl.colorMask(false, false, false, false); drawScene();
gl.colorMask(true, true, true, true);
gl.depthFunc(gl.EQUAL); gl.depthMask(false); drawScene();`,
    init(ctx) {
      const { util } = ctx;
      const k = kit(util);
      const bg = util.program(G.fullscreenVS, G.colors + `varying vec2 v_uv; uniform float u_light;
void main() { vec3 c = u_light > 0.5 ? mix(vec3(0.52, 0.51, 0.5), vec3(0.36, 0.36, 0.37), v_uv.y) : mix(vec3(0.16), vec3(0.06), v_uv.y); gl_FragColor = vec4(c, 1.0); }`);
      const heat = util.program(G.fullscreenVS, G.colors + `uniform sampler2D u_tex; uniform float u_split; uniform vec2 u_res; varying vec2 v_uv;
vec3 pal(float n) {
  if (n < 0.5) return INK;
  float x = clamp(log2(n) / 4.0, 0.0, 1.0);
  return x < 0.33 ? mix(vec3(0.08, 0.25, 0.32), A1, x / 0.33) : x < 0.66 ? mix(A1, A2, (x - 0.33) / 0.33) : mix(A2, BONE, (x - 0.66) / 0.34);
}
void main() {
  float n = floor(texture2D(u_tex, v_uv).r * 255.0 / 8.0 + 0.5);
  vec3 c = pal(n);
  if (v_uv.y > 0.2 && v_uv.y < 0.215 && v_uv.x > 0.025 && v_uv.x < 0.225) c = pal(floor(pow(2.0, (v_uv.x - 0.025) / 0.2 * 4.0) + 0.5));
  c = mix(c, BONE, smoothstep(1.5, 0.0, abs(v_uv.x - u_split) * u_res.x));
  gl_FragColor = vec4(c, 1.0);
}`);
      const objs = [];
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2;
        objs.push([['knot', 'sphere', 'cube', 'torus', 'octa'][i % 5], a, 1.4 + (i % 3) * 0.6, (i % 4) * 0.35]);
      }
      // a dense crowd for the overdraw view
      const crowd = [];
      for (let z = 0; z < 7; z++) for (let i = 0; i < 9; i++) crowd.push([(i % 3 - 1) * 0.9 + (z % 2) * 0.3, (Math.floor(i / 3) - 1) * 0.8 + (z % 3) * 0.15, -z * 0.7]);
      crowd.sort((a, b) => a[2] - b[2]); // far → near: worst case without a prepass
      const info = panel(ctx, 'ov-tr');
      const la = label(ctx, 'no prepass'), lb = label(ctx, 'depth prepass · colorMask(false)');
      return { k, bg, heat, objs, crowd, info, la, lb, cam: new S.OrbitCam({ dist: 5.5, pitch: 0.3, yaw: 0.2, auto: 0.12, target: [0, 0.6, 0] }), split: 0.5, key: '' };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = ctx.width, H = ctx.height, k = s.k;
      const mode = params.mode;
      s.la.style.display = s.lb.style.display = mode === 2 ? '' : 'none';
      if (mode !== 2) s.cam.update(input, dt); else s.cam.update({ ...input, dragging: false }, dt);
      const P = s.cam.proj(ctx.aspect, 0.1, 60);
      const scene = (V, eye, grey) => {
        k.begin(M4.mul(P, V), eye, 0.04, grey ? [0.1, 0.1, 0.1] : INK);
        k.drawFloor(20, 0, grey ? BONE : S.A1, grey ? [0.1, 0.1, 0.1] : [0.035, 0.04, 0.055]);
        k.draw('knot', TRS([0, 1.1, 0], [t * 0.3, t * 0.4, 0], 0.6), grey ? [0.85, 0.85, 0.85] : S.A1);
        s.objs.forEach(([m, a, r, hh], i) => { const aa = a + t * 0.15; k.draw(m, TRS([Math.cos(aa) * r, 0.4 + hh, Math.sin(aa) * r], [t + i, t * 0.7 + i, 0], m === 'knot' ? 0.22 : 0.33), grey ? [0.7, 0.7, 0.7] : [S.A2, BONE, AMBER][i % 3]); });
      };
      gl.viewport(0, 0, W, H);
      let txt = '';
      if (mode === 0) {
        gl.clearColor(0.1, 0.1, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        const eye = s.cam.eye(), b = s.cam.basis();
        [[-1, [true, false, false, true]], [1, [false, true, true, true]]].forEach(([side, cm]) => {
          const e = V3.add(eye, V3.scale(b.right, side * params.sep));
          gl.colorMask(cm[0], cm[1], cm[2], cm[3]);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          scene(M4.lookAt(e, s.cam.target), e, true);
        });
        gl.colorMask(true, true, true, true);
        gl.disable(gl.DEPTH_TEST);
        txt = `left eye colorMask(<b class="off">R</b>, –, –, A)<br>right eye colorMask(–, <b class="on">G</b>, <b class="on">B</b>, A)<br>eye separation <b>${params.sep.toFixed(3)}</b>`;
      } else if (mode === 1) {
        s.bg.use().set({ u_light: 1 }); util.drawFullscreen();
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.colorMask(params.r, params.g, params.b, true);
        const eye = s.cam.eye();
        scene(s.cam.view(), eye, false);
        gl.colorMask(true, true, true, true);
        gl.disable(gl.DEPTH_TEST);
        const ch = (on, c) => (on ? `<b class="on">${c}</b>` : `<span class="off">${c}</span>`);
        txt = `colorMask(${ch(params.r, 'R')}, ${ch(params.g, 'G')}, ${ch(params.b, 'B')}, A)<br>masked channels keep the grey background`;
      } else {
        if (s.key !== `${W}x${H}`) { if (s.tg) util.release(s.tg.fb, s.tg.tex, s.tg.depth); s.tg = util.target(W, H, { depth: true, filter: gl.NEAREST }); s.key = `${W}x${H}`; }
        if (input.dragging) s.split = clamp(input.uvx, 0.05, 0.95);
        else if (!input.hover) s.split = 0.5 + Math.sin(t * 0.4) * 0.12;
        const sx = Math.round(W * s.split);
        const V = M4.lookAt([Math.sin(t * 0.25) * 1.2, 1.0, 4.2], [0, 0.2, -2]), vp = M4.mul(P, V);
        util.bindTarget(s.tg);
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.enable(gl.SCISSOR_TEST);
        const drawCrowd = () => { k.lit.use().set({ u_vp: vp, u_mode: 1, u_col: [8 / 255, 0, 0], u_alpha: 1, u_inflate: 0, u_scale: 1 }); s.crowd.forEach((p, i) => { k.lit.set({ u_m: TRS(p, [t * 0.2 + i, t * 0.3, 0], 0.42) }); k.mesh(i % 2 ? 'sphere' : 'torus').draw(); }); };
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        // left: shade every fragment that passes LESS, drawn far to near
        gl.scissor(0, 0, sx, H);
        drawCrowd();
        // right: depth-only prepass, then shade with EQUAL
        gl.scissor(sx, 0, W - sx, H);
        gl.colorMask(false, false, false, false);
        drawCrowd();
        gl.colorMask(true, true, true, true);
        gl.depthFunc(gl.EQUAL); gl.depthMask(false);
        drawCrowd();
        gl.depthFunc(gl.LESS); gl.depthMask(true);
        gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
        util.bindTarget(null, W, H);
        util.tex(0, s.tg.tex);
        s.heat.use().set({ u_tex: 0, u_split: s.split, u_res: [W, H] }); util.drawFullscreen();
        util.tex(0, null);
        s.la.style.left = '24px'; s.la.style.bottom = '78px';
        s.lb.style.left = s.split * ctx.cssWidth + 14 + 'px'; s.lb.style.bottom = '78px';
        txt = `${s.crowd.length} objects drawn far → near<br>heat = shading passes per pixel<br>left: <b>LESS</b>, every nearer fragment shades<br>right: prepass, then <b>EQUAL</b> → 1 per pixel<br>legend (lower left): 1 → 16`;
      }
      if (txt !== s.last) { s.last = txt; s.info.innerHTML = txt; }
      ctx.canvas.style.cursor = mode === 2 ? 'ew-resize' : 'grab';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 7. Alpha to coverage                                              */
  /* ---------------------------------------------------------------- */
  const CMODES = ['Side by side', 'Alpha test', 'Blending', 'Alpha to coverage', 'Sample coverage'];
  S.register({
    id: 'coverage',
    title: 'Alpha to Coverage',
    category: CAT,
    thumb: 'tall',
    hint: 'drag to orbit · compare the three',
    description: 'Foliage cards with soft-edged alpha, drawn three ways. Alpha test discards below a threshold: crisp but jagged and shimmering. Alpha blending is smooth but order-dependent, so unsorted cards that write depth hide the leaves behind them. SAMPLE_ALPHA_TO_COVERAGE turns alpha into a mask of multisample coverage, giving soft edges that need no sorting. It only works with an antialiased (multisampled) default framebuffer. Sample coverage applies a fixed coverage value as screen-door transparency, and its invert flag gives two objects complementary masks.',
    interact: [['Drag', 'orbit'], ['Mode', 'three techniques side by side, or one at a time'], ['Coverage value / invert', 'gl.sampleCoverage in Sample coverage mode'], ['DITHER', 'toggle gl.DITHER']],
    features: ['gl.enable(SAMPLE_ALPHA_TO_COVERAGE)', 'alpha test with discard', 'alpha blending without sorting', 'SAMPLE_COVERAGE + sampleCoverage(value, invert)', 'gl.SAMPLES / SAMPLE_BUFFERS · DITHER'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Side by side', 'Alpha test', 'Blend', 'A2C', 'sampleCoverage'], value: 0 },
      { key: 'cut', label: 'Alpha test threshold', type: 'range', min: 0.05, max: 0.95, step: 0.01, value: 0.5 },
      { key: 'cov', label: 'sampleCoverage value', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'inv', label: 'Invert for second object', type: 'toggle', value: true },
      { key: 'dither', label: 'DITHER', type: 'toggle', value: true },
    ],
    code: `// context created with { antialias: true }
gl.getParameter(gl.SAMPLES);            // e.g. 4
gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); // alpha → sample mask
drawFoliage();                          // no sorting, no discard
gl.enable(gl.SAMPLE_COVERAGE);
gl.sampleCoverage(0.5, false); drawA();
gl.sampleCoverage(0.5, true);  drawB(); // the other half of the samples`,
    init(ctx) {
      const { gl, util } = ctx;
      const k = kit(util);
      const N = 520;
      const pos = [], uv = [], seed = [], idx = [];
      for (let i = 0; i < N; i++) {
        let c; do { c = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]; } while (V3.len(c) > 1);
        c = [c[0] * 1.15, 1.25 + c[1] * 0.85, c[2] * 1.15];
        const n = V3.norm([Math.random() * 2 - 1, Math.random() * 1.2 - 0.3, Math.random() * 2 - 1]);
        const u = V3.norm(V3.cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = V3.cross(n, u);
        const sz = 0.16 + Math.random() * 0.14;
        const base = i * 4;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => { pos.push(...V3.add(c, V3.add(V3.scale(u, a * sz), V3.scale(v, b * sz)))); uv.push(a * 0.5 + 0.5, b * 0.5 + 0.5); seed.push(Math.random(), i / N, ...n); });
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const sb = util.buffer(gl.ARRAY_BUFFER, new Float32Array(seed));
      const cards = util.mesh([
        { buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array(pos)), loc: 0, size: 3 },
        { buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array(uv)), loc: 2, size: 2 },
        { buffer: sb, loc: 3, size: 2, stride: 20, offset: 0 },
        { buffer: sb, loc: 1, size: 3, stride: 20, offset: 8 },
      ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx)), { count: idx.length });
      const leaf = util.program(`
attribute vec3 a_pos; attribute vec2 a_uv; attribute vec2 a_col; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform float u_t;
varying vec2 v_uv; varying vec2 v_s; varying vec3 v_n; varying vec3 v_w;
void main() {
  vec3 p = a_pos; p.x += sin(u_t * 1.3 + a_pos.y * 3.0 + a_col.x * 6.0) * 0.02 * a_pos.y;
  v_uv = a_uv; v_s = a_col; v_n = a_nrm; v_w = p;
  gl_Position = u_vp * vec4(p, 1.0);
}`, G.colors + G.noise + `
uniform int u_tech; uniform float u_cut; uniform vec3 u_eye;
varying vec2 v_uv; varying vec2 v_s; varying vec3 v_n; varying vec3 v_w;
float leafA(vec2 q, float r) {
  float c = cos(r), s = sin(r); q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  q.y += 0.45;
  float w = 0.32 * sin(clamp(q.y, 0.0, 1.0) * 3.14159);
  float d = abs(q.x) - w;
  return clamp(0.5 - d / 0.16, 0.0, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
}
void main() {
  vec2 q = v_uv * 2.0 - 1.0;
  float a = max(leafA(q, v_s.x * 0.6), max(leafA(q, 1.9 + v_s.x), leafA(q, -1.9 - v_s.x)));
  a *= 0.75 + 0.25 * vnoise(v_uv * 9.0 + v_s.x * 10.0);
  vec3 n = normalize(v_n); if (dot(n, u_eye - v_w) < 0.0) n = -n;
  float l = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 0.9, 0.3))), 0.0);
  vec3 c = mix(A1 * 0.55, mix(A1, BONE, 0.3), v_s.y) * l;
  c = mix(c, A2 * l, smoothstep(0.75, 1.0, v_s.x) * 0.8);
  if (u_tech == 0) { if (a < u_cut) discard; gl_FragColor = vec4(c, 1.0); }
  else { if (a < 0.01) discard; gl_FragColor = vec4(u_tech == 1 ? c : c, a); }
}`);
      const bg = util.program(G.fullscreenVS, G.colors + `varying vec2 v_uv; void main() { gl_FragColor = vec4(mix(vec3(0.07, 0.075, 0.095), vec3(0.015, 0.017, 0.025), v_uv.y), 1.0); }`);
      const samples = gl.getParameter(gl.SAMPLES), sbuf = gl.getParameter(gl.SAMPLE_BUFFERS);
      const info = panel(ctx, 'ov-tr');
      const labs = ['ALPHA TEST · discard', 'BLEND · unsorted', 'ALPHA TO COVERAGE'].map((n) => label(ctx, n));
      return { k, cards, leaf, bg, info, labs, samples, sbuf, cam: new S.OrbitCam({ dist: 3.6, pitch: 0.2, yaw: 0.3, auto: 0.15, target: [0, 1.15, 0], minDist: 1.2 }) };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = ctx.width, H = ctx.height, k = s.k;
      s.cam.update(input, dt);
      if (params.dither) gl.enable(gl.DITHER); else gl.disable(gl.DITHER);
      gl.viewport(0, 0, W, H);
      s.bg.use(); util.drawFullscreen();
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const mode = params.mode;
      const drawFoliage = (tech, vp, eye) => {
        k.begin(vp, eye, 0.04, [0.05, 0.055, 0.07]);
        k.drawFloor(12, 0, S.A1, [0.045, 0.05, 0.065]);
        k.draw('cube', TRS([0, 0.45, 0], [0, 0.4, 0], [0.12, 0.9, 0.12]), [0.35, 0.3, 0.3]);
        if (tech === 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        if (tech === 2) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        s.leaf.use().set({ u_vp: vp, u_t: t, u_tech: tech, u_cut: params.cut, u_eye: eye });
        s.cards.draw();
        gl.disable(gl.BLEND); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      };
      gl.enable(gl.DEPTH_TEST);
      s.labs.forEach((l) => { l.style.display = 'none'; });
      if (mode === 0) {
        const cw = Math.floor(W / 3);
        gl.enable(gl.SCISSOR_TEST);
        for (let i = 0; i < 3; i++) {
          gl.viewport(i * cw, 0, cw, H); gl.scissor(i * cw, 0, cw, H);
          const P = M4.persp(s.cam.fov, cw / H, 0.05, 50);
          drawFoliage(i, M4.mul(P, s.cam.view()), s.cam.eye());
          const L = s.labs[i]; L.style.display = ''; L.style.left = (i * cw) / ctx.dpr + 14 + 'px'; L.style.bottom = '78px';
        }
        gl.disable(gl.DEPTH_TEST);
        gl.clearColor(0.93, 0.91, 0.88, 0.3);
        for (let i = 1; i < 3; i++) { gl.scissor(i * cw, 0, Math.max(1, Math.round(ctx.dpr)), H); gl.clear(gl.COLOR_BUFFER_BIT); }
        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(0, 0, W, H);
      } else if (mode <= 3) {
        drawFoliage(mode - 1, M4.mul(s.cam.proj(ctx.aspect, 0.05, 50), s.cam.view()), s.cam.eye());
        const L = s.labs[mode - 1]; L.style.display = ''; L.style.left = '24px'; L.style.bottom = '78px';
      } else {
        const vp = M4.mul(s.cam.proj(ctx.aspect, 0.05, 50), s.cam.view()), eye = s.cam.eye();
        k.begin(vp, eye, 0.04, [0.05, 0.055, 0.07]);
        k.drawFloor(12, 0, S.A1, [0.045, 0.05, 0.065]);
        k.draw('cube', TRS([0, 1.0, -1.2], [0, 0.5, 0], [0.4, 2.0, 0.4]), [0.6, 0.62, 0.68]);
        gl.enable(gl.SAMPLE_COVERAGE);
        gl.sampleCoverage(params.cov, false);
        k.draw('sphere', TRS([-0.35, 1.1, 0.2], [0, 0, 0], 0.62), S.A1);
        gl.sampleCoverage(params.cov, params.inv);
        k.draw('knot', TRS([0.35, 1.15, 0.35], [t * 0.3, t * 0.4, 0], 0.42), S.A2);
        gl.sampleCoverage(1, false); gl.disable(gl.SAMPLE_COVERAGE);
      }
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.DITHER);
      const sig = [mode, params.cov, params.inv, params.dither].join();
      if (sig !== s.sig) {
        s.sig = sig;
        s.info.innerHTML = `antialias <b>${ctx.attrs.antialias}</b> · SAMPLES <b>${s.samples}</b> · SAMPLE_BUFFERS <b>${s.sbuf}</b>` +
          (s.samples ? '' : '<br><span class="off">no multisampling: alpha to coverage cannot produce partial coverage</span>') +
          (mode === 4 ? `<br>sampleCoverage(<b>${params.cov.toFixed(2)}</b>, false) sphere<br>sampleCoverage(<b>${params.cov.toFixed(2)}</b>, ${params.inv}) knot<br>${s.samples} samples → ${s.samples + 1} coverage levels` : `<br>${CMODES[mode]}`) +
          `<br>DITHER <b>${params.dither ? 'enabled' : 'disabled'}</b>`;
      }
    },
  });
})();
