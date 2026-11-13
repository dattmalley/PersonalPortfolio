/* D · Framebuffers — render to texture, depth/stencil renderbuffers, depth textures,
 * float targets, multiple render targets, colour-ID picking, dynamic cube maps. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, clamp, damp, lerp } = S.math;
  const G = S.GLSL;
  const CAT = 'Framebuffers';
  const INK = [0.027, 0.031, 0.047];
  const BONE = [0.925, 0.914, 0.886];
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /* ---------------------------------------------------------------- */
  /* Shared scene kit                                                  */
  /* ---------------------------------------------------------------- */
  const LIT_VS = `
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_m;
varying vec3 v_n; varying vec3 v_w; varying vec3 v_o; varying vec3 v_on;
void main() {
  vec4 w = u_m * vec4(a_pos, 1.0);
  v_w = w.xyz; v_o = a_pos; v_on = a_nrm; v_n = mat3(u_m) * a_nrm;
  gl_Position = u_vp * w;
}`;
  // u_tex: 0 plain, 1 screen on ±Z faces of a box, 2 texture on every face
  const LIT_FS = G.colors + `
uniform vec3 u_col; uniform vec3 u_eye; uniform float u_fog; uniform vec3 u_fogCol;
uniform float u_tex; uniform sampler2D u_map; uniform float u_glow;
varying vec3 v_n; varying vec3 v_w; varying vec3 v_o; varying vec3 v_on;
void main() {
  vec3 n = normalize(v_n), v = normalize(u_eye - v_w), l = normalize(vec3(0.45, 0.9, 0.35));
  float df = max(dot(n, l), 0.0);
  float sp = pow(max(dot(reflect(-l, n), v), 0.0), 40.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 c = u_col * (0.16 + 0.84 * df) + vec3(sp * 0.35) + rim * 0.2 * A1;
  if (u_tex > 0.5) {
    vec3 an = abs(v_on);
    vec2 uv = vec2(-1.0);
    if (an.z > 0.5) uv = vec2(v_on.z > 0.0 ? v_o.x + 0.5 : 0.5 - v_o.x, v_o.y + 0.5);
    else if (u_tex > 1.5 && an.x > 0.5) uv = vec2(v_on.x > 0.0 ? 0.5 - v_o.z : v_o.z + 0.5, v_o.y + 0.5);
    else if (u_tex > 1.5) uv = vec2(v_o.x + 0.5, v_on.y > 0.0 ? 0.5 - v_o.z : v_o.z + 0.5);
    if (uv.x >= 0.0) {
      vec2 e = min(uv, 1.0 - uv);
      float bezel = step(0.025, min(e.x, e.y));
      vec3 t = texture2D(u_map, clamp((uv - 0.5) * 1.06 + 0.5, 0.0, 1.0)).rgb;
      c = mix(vec3(0.03) + sp * 0.2, t + sp * 0.12, bezel);
    } else c = vec3(0.05, 0.055, 0.065) * (0.4 + df) + sp * 0.2;
  }
  c += u_glow * mix(A1, BONE, 0.3) * (0.25 + rim);
  float f = 1.0 - exp(-length(u_eye - v_w) * u_fog);
  gl_FragColor = vec4(mix(c, u_fogCol, clamp(f, 0.0, 1.0)), 1.0);
}`;
  const FLOOR_VS = `
attribute vec2 a_pos;
uniform mat4 u_vp; uniform float u_size; uniform float u_y;
varying vec3 v_w;
void main() { v_w = vec3(a_pos.x * u_size, u_y, a_pos.y * u_size); gl_Position = u_vp * vec4(v_w, 1.0); }`;
  const FLOOR_FS = '#extension GL_OES_standard_derivatives : enable\n' + G.colors + `
uniform vec3 u_eye; uniform float u_fog; uniform vec3 u_fogCol; uniform vec3 u_line; uniform vec3 u_base;
uniform vec3 u_ring;
varying vec3 v_w;
float grid(vec2 p) { vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), 1e-4); return 1.0 - min(min(g.x, g.y), 1.0); }
void main() {
  float minor = grid(v_w.xz), major = grid(v_w.xz * 0.25);
  vec3 c = u_base + u_line * (minor * 0.12 + major * 0.35);
  if (u_ring.z > 0.0) {
    float d = length(v_w.xz - u_ring.xy);
    c += A2 * (smoothstep(u_ring.z + 0.06, u_ring.z, d) * smoothstep(u_ring.z - 0.12, u_ring.z - 0.02, d)) * 1.2;
  }
  float f = 1.0 - exp(-length(u_eye - v_w) * u_fog);
  gl_FragColor = vec4(mix(c, u_fogCol, clamp(f, 0.0, 1.0)), 1.0);
}`;
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
      begin(vp, eye, fog = 0.05, fogCol = INK) { this.vp = vp; this.eye = eye; this.fog = fog; this.fogCol = fogCol; lit.use().set({ u_vp: vp, u_eye: eye, u_fog: fog, u_fogCol: fogCol, u_tex: 0, u_glow: 0 }); },
      draw(name, m, col, extra) { lit.use().set({ u_m: m, u_col: col, u_tex: 0, u_glow: 0 }); if (extra) lit.set(extra); mesh(name).draw(); },
      drawFloor(size = 30, y = 0, line = S.A1, base = [0.035, 0.04, 0.055], ring = [0, 0, 0]) {
        floor.use().set({ u_vp: this.vp, u_eye: this.eye, u_fog: this.fog, u_fogCol: this.fogCol, u_size: size, u_y: y, u_line: line, u_base: base, u_ring: ring });
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
  const statusName = (gl, s) => ({ [gl.FRAMEBUFFER_COMPLETE]: 'COMPLETE', [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'INCOMPLETE_ATTACHMENT', [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'INCOMPLETE_MISSING_ATTACHMENT', [gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS]: 'INCOMPLETE_DIMENSIONS', [gl.FRAMEBUFFER_UNSUPPORTED]: 'UNSUPPORTED' })[s] || '0x' + s.toString(16);
  /* Asynchronous single-pixel readback. readPixels makes the CPU wait for every GPU command queued before it.
   * So the pixel is copied into a ring of 1×1 targets on the GPU, and at the START of a later frame (before any new
   * work is queued) the entry written a few frames ago is read: its work is long finished and nothing stalls. */
  function makeProbe(ctx, float) {
    const { gl, util } = ctx;
    let type = gl.UNSIGNED_BYTE, ring = null;
    if (float) { try { ring = [0, 1, 2, 3].map(() => util.target(1, 1, { type: 'float', filter: gl.NEAREST })); type = gl.FLOAT; } catch (e) { ring = null; } }
    if (!ring) ring = [0, 1, 2, 3].map(() => util.target(1, 1, { filter: gl.NEAREST }));
    const prog = util.program(G.fullscreenVS, `uniform sampler2D u_tex; uniform vec2 u_uv; void main() { gl_FragColor = texture2D(u_tex, u_uv); }`);
    const out = type === gl.FLOAT ? new Float32Array(4) : new Uint8Array(4);
    return {
      type, n: 0, value: null,
      /** call first thing in frame(): reads the oldest ring entry (null until the ring has filled) */
      read() {
        if (this.n >= ring.length) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, ring[this.n % ring.length].fb);
          const t0 = performance.now();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, type, out);
          this.ms = performance.now() - t0;
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          this.value = type === gl.FLOAT ? [...out] : [...out].map((v) => v / 255);
          this.bytes = type === gl.FLOAT ? null : [...out];
        }
        return this.value;
      },
      /** copy texel (x, y) of a w×h texture into the next ring slot */
      write(tex, x, y, w, h) {
        util.bindTarget(ring[this.n % ring.length]); util.tex(0, tex);
        prog.use().set({ u_tex: 0, u_uv: [(x + 0.5) / w, (y + 0.5) / h] });
        util.drawFullscreen(); util.tex(0, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.n++;
      },
    };
  }
  // A ghost pointer for capture / idle: a slow Lissajous in uv space.
  const ghost = (t, ax = 0.28, ay = 0.2) => ({ uvx: 0.5 + Math.sin(t * 0.7) * ax, uvy: 0.5 + Math.sin(t * 0.43 + 1.2) * ay });

  /* ---------------------------------------------------------------- */
  /* 1. Render to texture                                              */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'render-to-texture',
    title: 'Render to Texture',
    category: CAT,
    thumb: 'wide',
    hint: 'drag to orbit · lower the resolution',
    description: 'A small scene is drawn into a framebuffer whose colour attachment is a texture, then that texture is used on screens and cubes in a second scene. The inner scene also contains a monitor showing the previous frame, so the picture recurses: two targets swap roles each frame because a texture cannot be sampled while it is being rendered into. Lower the resolution to see each texel become a block; switch the filter between NEAREST and LINEAR.',
    interact: [['Drag', 'orbit the outer room'], ['Wheel', 'zoom towards the screen'], ['Resolution', 'size of the offscreen colour texture'], ['Filter', 'how the texture is magnified on screen']],
    features: ['gl.createFramebuffer + framebufferTexture2D', 'COLOR_ATTACHMENT0 texture + DEPTH_COMPONENT16', 'checkFramebufferStatus', 'ping-pong targets (no feedback loop)', 'TEXTURE_MAG_FILTER NEAREST vs LINEAR'],
    params: [
      { key: 'res', label: 'Texture height (px)', type: 'range', min: 8, max: 512, step: 4, value: 72 },
      { key: 'filter', label: 'Magnification filter', type: 'select', options: ['NEAREST', 'LINEAR'], value: 0 },
      { key: 'recurse', label: 'Monitor in the inner scene', type: 'toggle', value: true },
    ],
    code: `const tex = gl.createTexture();
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
drawInnerScene();            // into the texture
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
gl.bindTexture(gl.TEXTURE_2D, tex); drawOuterScene();`,
    init(ctx) {
      const k = kit(ctx.util);
      const info = panel(ctx, 'ov-tr');
      return { k, info, cam: new S.OrbitCam({ dist: 5.0, yaw: 0.35, pitch: 0.14, target: [0, 1.3, 0], auto: 0.08, minDist: 2.2, maxDist: 14 }), pp: null, res: 0, filt: -1 };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params } = ctx;
      const h = params.res | 0, w = Math.max(4, Math.round(h * 1.6));
      if (s.res !== h) {
        if (s.pp) util.release(s.pp.read.fb, s.pp.read.tex, s.pp.read.depth, s.pp.write.fb, s.pp.write.tex, s.pp.write.depth);
        s.pp = util.pingpong(w, h, { depth: true });
        s.res = h; s.filt = -1;
      }
      if (s.filt !== params.filter) {
        const f = params.filter ? gl.LINEAR : gl.NEAREST;
        for (const tg of [s.pp.read, s.pp.write]) { gl.bindTexture(gl.TEXTURE_2D, tg.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); }
        gl.bindTexture(gl.TEXTURE_2D, null);
        s.filt = params.filter;
      }
      const k = s.k;
      gl.enable(gl.DEPTH_TEST);
      // ---- inner scene → write target, sampling last frame's read target on the monitor
      const tw = s.pp.write;
      util.bindTarget(tw);
      gl.clearColor(0.07, 0.06, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const ia = Math.PI * 0.15 + t * 0.35;
      const ieye = [Math.sin(ia) * 5, 2.0, Math.cos(ia) * 5];
      k.begin(M4.mul(M4.persp(0.9, w / h, 0.1, 60), M4.lookAt(ieye, [0, 0.9, 0])), ieye, 0.06, [0.07, 0.06, 0.1]);
      k.drawFloor(20, 0, S.A2, [0.06, 0.05, 0.08]);
      k.draw('knot', TRS([0, 1.3, 0], [t * 0.6, t * 0.4, 0], 0.62), S.A1);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 - t * 0.7;
        k.draw(i % 2 ? 'octa' : 'cube', TRS([Math.cos(a) * 2.1, 0.5 + Math.sin(t * 2 + i) * 0.25, Math.sin(a) * 2.1], [t + i, t * 1.3 + i, 0], 0.5), i % 2 ? S.A2 : BONE);
      }
      if (params.recurse) {
        util.tex(0, s.pp.read.tex);
        const ma = ia + Math.PI; // monitor faces the inner camera from behind the knot
        k.draw('cube', TRS([Math.sin(ma) * 1.6, 1.25, Math.cos(ma) * 1.6], [0, ia, 0], [1.9, 1.2, 0.08]), BONE, { u_tex: 1, u_map: 0 });
      }
      // ---- outer scene → canvas
      s.pp.swap();
      s.cam.update(ctx.input, dt);
      util.bindTarget(null, ctx.width, ctx.height);
      gl.clearColor(INK[0], INK[1], INK[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const eye = s.cam.eye(), vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 100), s.cam.view());
      k.begin(vp, eye, 0.035);
      k.drawFloor(40, 0);
      util.tex(0, s.pp.read.tex);
      const screenM = TRS([0, 1.45, 0], [0, Math.sin(t * 0.2) * 0.12, 0], [3.2, 2.0, 0.12]);
      k.draw('cube', screenM, BONE, { u_tex: 1, u_map: 0 });
      k.draw('cube', TRS([0, 0.22, 0], [0, 0, 0], [0.5, 0.44, 0.3]), [0.12, 0.13, 0.15]);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + t * 0.25 + 0.4;
        k.draw('cube', TRS([Math.cos(a) * 3.3, 0.55 + Math.sin(t + i) * 0.15, Math.sin(a) * 3.3], [t * 0.5 + i, t * 0.4 + i * 2, 0], 0.8), BONE, { u_tex: 2, u_map: 0 });
      }
      gl.disable(gl.DEPTH_TEST);
      // how many screen pixels does one texel cover on the big screen?
      const a = xform(vp, xform(screenM, [0, -0.5, 0.5])), b = xform(vp, xform(screenM, [0, 0.5, 0.5]));
      const pxH = a[3] > 0 && b[3] > 0 ? Math.abs(b[1] / b[3] - a[1] / a[3]) * 0.5 * ctx.height : 0;
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        s.info.innerHTML = `colour texture <b>${w} × ${h}</b> RGBA8<br>depth renderbuffer <b>DEPTH_COMPONENT16</b><br>status <b class="on">FRAMEBUFFER_COMPLETE</b><br>filter <b>${params.filter ? 'LINEAR' : 'NEAREST'}</b><br>1 texel ≈ <b>${(pxH / (h * 0.94)).toFixed(1)}</b> screen px`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Depth & stencil renderbuffers                                  */
  /* ---------------------------------------------------------------- */
  const ATTACH = ['None', 'DEPTH_COMPONENT16', 'STENCIL_INDEX8', 'DEPTH_STENCIL'];
  function statusTable(gl, ext) {
    const made = [];
    const T = (w, h, type = gl.UNSIGNED_BYTE) => { const t = gl.createTexture(); made.push(() => gl.deleteTexture(t)); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null); gl.bindTexture(gl.TEXTURE_2D, null); return t; };
    const R = (fmt, w = 64, h = 64) => { const r = gl.createRenderbuffer(); made.push(() => gl.deleteRenderbuffer(r)); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h); gl.bindRenderbuffer(gl.RENDERBUFFER, null); return r; };
    const FB = gl.FRAMEBUFFER, C0 = gl.COLOR_ATTACHMENT0;
    const tex = (t) => gl.framebufferTexture2D(FB, C0, gl.TEXTURE_2D, t, 0);
    const rb = (att, r) => gl.framebufferRenderbuffer(FB, att, gl.RENDERBUFFER, r);
    const combos = [
      ['RGBA texture', () => tex(T(64, 64))],
      ['RGBA4 renderbuffer', () => rb(C0, R(gl.RGBA4))],
      ['RGB565 rb + DEPTH16', () => { rb(C0, R(gl.RGB565)); rb(gl.DEPTH_ATTACHMENT, R(gl.DEPTH_COMPONENT16)); }],
      ['RGBA + STENCIL_INDEX8', () => { tex(T(64, 64)); rb(gl.STENCIL_ATTACHMENT, R(gl.STENCIL_INDEX8)); }],
      ['RGBA + DEPTH_STENCIL', () => { tex(T(64, 64)); rb(gl.DEPTH_STENCIL_ATTACHMENT, R(gl.DEPTH_STENCIL)); }],
      ['nothing attached', () => {}],
      ['colour 64² + depth 32²', () => { tex(T(64, 64)); rb(gl.DEPTH_ATTACHMENT, R(gl.DEPTH_COMPONENT16, 32, 32)); }],
      ['DEPTH16 at COLOR_ATTACHMENT0', () => rb(C0, R(gl.DEPTH_COMPONENT16))],
      ['0 × 0 texture', () => tex(T(0, 0))],
    ];
    if (ext('OES_texture_float')) { ext('WEBGL_color_buffer_float'); combos.push(['FLOAT RGBA texture', () => tex(T(64, 64, gl.FLOAT))]); }
    const rows = combos.map(([name, fn]) => {
      const f = gl.createFramebuffer(); gl.bindFramebuffer(FB, f);
      fn();
      const st = gl.checkFramebufferStatus(FB);
      gl.bindFramebuffer(FB, null); gl.deleteFramebuffer(f);
      return [name, st];
    });
    made.forEach((d) => d());
    // Separate DEPTH_ATTACHMENT + STENCIL_ATTACHMENT is never complete in WebGL 1 (UNSUPPORTED); it is listed, not tested,
    // because the browser also logs a warning for it.
    rows.push(['DEPTH16 + STENCIL8 separately', gl.FRAMEBUFFER_UNSUPPORTED, true]);
    return rows;
  }
  S.register({
    id: 'renderbuffers',
    title: 'Depth & Stencil Renderbuffers',
    category: CAT,
    thumb: 'square',
    hint: 'move the keyhole · swap attachments',
    description: 'An offscreen framebuffer only has the buffers you attach to it. Without a depth renderbuffer, interlocking shapes are drawn in submission order and the far side shows through. A STENCIL_INDEX8 attachment gives a mask (here a keyhole following the pointer that switches to X-ray shading) and DEPTH_STENCIL gives both. The table lists what checkFramebufferStatus reports for several attachment combinations, including incomplete and unsupported ones.',
    interact: [['Move', 'the stencil keyhole follows the pointer'], ['Drag', 'orbit the scene'], ['Attachment', 'which renderbuffer is attached to the offscreen target']],
    features: ['gl.renderbufferStorage(RENDERBUFFER, fmt, w, h)', 'DEPTH_COMPONENT16 · STENCIL_INDEX8 · DEPTH_STENCIL', 'framebufferRenderbuffer(…_ATTACHMENT)', 'checkFramebufferStatus results', 'DEPTH_BITS / STENCIL_BITS of a bound FBO'],
    params: [
      { key: 'att', label: 'Attachment', type: 'select', options: ['None', 'DEPTH16', 'STENCIL8', 'DEPTH_STENCIL'], value: 3 },
      { key: 'key', label: 'Keyhole radius', type: 'range', min: 0.05, max: 0.45, step: 0.01, value: 0.3 },
    ],
    code: `const rb = gl.createRenderbuffer();
gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER,
  gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
gl.checkFramebufferStatus(gl.FRAMEBUFFER); // COMPLETE`,
    init(ctx) {
      const { gl, util } = ctx;
      const k = kit(util);
      const disc = util.program(`
attribute vec2 a_pos; uniform vec2 u_c; uniform vec2 u_r;
varying vec2 v_q;
void main() { v_q = a_pos; gl_Position = vec4(u_c + a_pos * u_r, 0.0, 1.0); }`, `
varying vec2 v_q; void main() { if (dot(v_q, v_q) > 1.0) discard; gl_FragColor = vec4(1.0); }`);
      const xray = util.program(LIT_VS, G.colors + `
uniform vec3 u_eye; varying vec3 v_n; varying vec3 v_w; varying vec3 v_o;
void main() {
  vec3 n = normalize(v_n), v = normalize(u_eye - v_w);
  float f = pow(1.0 - abs(dot(n, v)), 2.0);
  float bands = step(0.85, fract(v_o.y * 8.0));
  gl_FragColor = vec4(mix(A2 * 0.15, mix(A1, A2, f), f) + bands * 0.15, 1.0);
}`);
      const show = util.program(G.fullscreenVS, G.colors + `
uniform sampler2D u_tex; uniform vec2 u_c; uniform vec2 u_r; uniform float u_ring;
varying vec2 v_uv;
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  vec2 q = (v_uv * 2.0 - 1.0 - u_c) / u_r; float d = length(q);
  float px = 0.012;
  c = mix(c, A1, u_ring * smoothstep(1.0 - px, 1.0, d) * smoothstep(1.0 + px, 1.0, d));
  gl_FragColor = vec4(c, 1.0);
}`);
      const rows = statusTable(gl, ctx.ext);
      panel(ctx, 'ov-tr', '<b>checkFramebufferStatus</b><br>' + rows.map(([n, st, spec]) => `${n} → <span class="${st === gl.FRAMEBUFFER_COMPLETE ? 'on' : 'off'}">${statusName(gl, st)}</span>${spec ? ' (by spec)' : ''}`).join('<br>')).style.fontSize = '10px';
      const info = panel(ctx, 'ov-bl');
      return { k, disc, xray, show, info, cam: new S.OrbitCam({ dist: 5.2, yaw: 0.7, pitch: 0.42, auto: 0.12, target: [0, 0.6, 0] }), tg: null, key: '', c: [0, 0] };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = ctx.width, H = ctx.height, sig = `${W}x${H}:${params.att}`;
      if (s.key !== sig) {
        if (s.tg) util.release(s.tg.fb, s.tg.tex, s.tg.rb);
        const tex = util.texture({ width: W, height: H });
        const fmt = [0, gl.DEPTH_COMPONENT16, gl.STENCIL_INDEX8, gl.DEPTH_STENCIL][params.att];
        const att = [0, gl.DEPTH_ATTACHMENT, gl.STENCIL_ATTACHMENT, gl.DEPTH_STENCIL_ATTACHMENT][params.att];
        let rb = fmt ? util.renderbuffer(fmt, W, H) : null, fb;
        s.note = '';
        try { fb = util.framebuffer([tex], rb, { attach: att || undefined }); }
        catch (e) { s.note = ATTACH[params.att] + ': ' + e.message; if (rb) util.release(rb); rb = null; fb = util.framebuffer([tex], null); }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        const bits = [gl.getParameter(gl.DEPTH_BITS), gl.getParameter(gl.STENCIL_BITS)];
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        s.tg = { fb, tex, rb, w: W, h: H, bits, status: fb.status };
        s.key = sig;
      }
      const hasD = params.att === 1 || params.att === 3, hasS = params.att >= 2;
      s.cam.update(input, dt);
      const g = ghost(t);
      const tx = input.hover ? input.nx : g.uvx * 2 - 1, ty = input.hover ? input.ny : g.uvy * 2 - 1;
      s.c[0] += (tx - s.c[0]) * damp(12, dt); s.c[1] += (ty - s.c[1]) * damp(12, dt);
      const r = [params.key * H / W * 2, params.key * 2];
      util.bindTarget(s.tg);
      gl.clearColor(0.03, 0.034, 0.048, 1); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      if (hasS) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.colorMask(false, false, false, false);
        s.disc.use().set({ u_c: s.c, u_r: r }); s.k.quad.draw();
        gl.colorMask(true, true, true, true);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      }
      if (hasD) gl.enable(gl.DEPTH_TEST);
      const eye = s.cam.eye(), vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view());
      const k = s.k;
      // Submission order is deliberately far-to-near-agnostic: without depth the last drawn wins.
      const objs = [
        ['torus', TRS([0, 0.8, 0], [t * 0.5 + 1.2, t * 0.3, 0], 1.25), S.A2],
        ['sphere', TRS([0, 0.8, 0], [0, 0, 0], 0.75), BONE],
        ['torus', TRS([0, 0.8, 0], [t * 0.5 + 1.2 + Math.PI / 2, t * 0.3, 0.6], 1.1), S.A1],
        ['cube', TRS([1.7, 0.5, -0.6], [0, t * 0.4, 0], [0.5, 1.0, 0.5]), [0.5, 0.52, 0.58]],
        ['cube', TRS([-1.6, 0.5, 0.7], [0, -t * 0.3, 0], [0.5, 1.0, 0.5]), [0.5, 0.52, 0.58]],
      ];
      const pass = (xr) => {
        k.begin(vp, eye, 0.04, [0.03, 0.034, 0.048]);
        k.drawFloor(16, -0.2, S.A1, [0.03, 0.034, 0.048]);
        if (xr) s.xray.use().set({ u_vp: vp, u_eye: eye });
        for (const [m, M, c] of objs) { if (xr) { s.xray.set({ u_m: M }); k.mesh(m).draw(); } else k.draw(m, M, c); }
      };
      if (hasS) {
        gl.stencilFunc(gl.NOTEQUAL, 1, 0xff); pass(false);
        gl.stencilFunc(gl.EQUAL, 1, 0xff); pass(true);
        gl.disable(gl.STENCIL_TEST);
      } else pass(false);
      gl.disable(gl.DEPTH_TEST);
      util.bindTarget(null, W, H);
      util.tex(0, s.tg.tex);
      s.show.use().set({ u_tex: 0, u_c: s.c, u_r: r, u_ring: hasS ? 1 : 0 });
      util.drawFullscreen();
      util.tex(0, null);
      if (Math.floor(t * 3) !== s.tick) {
        s.tick = Math.floor(t * 3);
        s.info.innerHTML = `offscreen target <b>${W} × ${H}</b><br>attachment <b>${ATTACH[params.att]}</b><br>DEPTH_BITS <b>${s.tg.bits[0]}</b> · STENCIL_BITS <b>${s.tg.bits[1]}</b><br>depth test ${hasD ? '<span class="on">works</span>' : '<span class="off">no buffer → wrong order</span>'}<br>stencil keyhole ${hasS ? '<span class="on">works</span>' : '<span class="off">no buffer</span>'}${s.note ? '<br><span class="off">' + s.note + '</span>' : ''}`;
      }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Depth textures                                                 */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'depth-texture',
    title: 'Depth Textures',
    category: CAT,
    thumb: 'tall',
    hint: 'point to focus · switch the view',
    description: 'WEBGL_depth_texture lets a framebuffer use a DEPTH_COMPONENT texture as its depth attachment, so the depth of every pixel can be sampled afterwards. Here it drives a depth-of-field blur that focuses wherever you point: each pixel blurs by how far its linearised depth lies from the depth under the pointer. Without the extension the scene is drawn a second time, writing gl_FragCoord.z packed into the four bytes of an RGBA8 texture.',
    interact: [['Move', 'focus on whatever is under the pointer'], ['View', 'depth of field, linear depth, raw depth or colour'], ['Depth source', 'depth texture or the RGBA8 packing fallback']],
    features: ['WEBGL_depth_texture', 'texImage2D(DEPTH_COMPONENT, UNSIGNED_INT)', 'framebufferTexture2D(DEPTH_ATTACHMENT)', 'linearising gl_FragCoord.z', 'fallback: packFloat into RGBA8'],
    params: [
      { key: 'view', label: 'View', type: 'select', options: ['Depth of field', 'Linear depth', 'Raw depth', 'Colour'], value: 0 },
      { key: 'src', label: 'Depth source', type: 'select', options: ['Depth texture', 'RGBA8 packed'], value: 0 },
      { key: 'ap', label: 'Aperture', type: 'range', min: 0, max: 3, step: 0.05, value: 1.4 },
      { key: 'inset', label: 'Depth inset', type: 'toggle', value: true },
    ],
    code: `const ext = gl.getExtension('WEBGL_depth_texture');
gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, w, h, 0,
  gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
  gl.TEXTURE_2D, depthTex, 0);
// later: float z = texture2D(u_depth, uv).r;
float lin = 2.0*n*f / (f + n - (z*2.0-1.0)*(f - n));`,
    init(ctx) {
      const { util } = ctx;
      const k = kit(util);
      const hasExt = !!ctx.ext('WEBGL_depth_texture');
      const pack = util.program(LIT_VS, G.pack + `
void main() { gl_FragColor = packFloat(min(gl_FragCoord.z, 0.99999)); }`);
      const post = util.program(G.fullscreenVS, G.colors + G.pack + `
uniform sampler2D u_col; uniform sampler2D u_depth; uniform float u_packed;
uniform vec2 u_focus; uniform float u_near; uniform float u_far; uniform vec2 u_px; uniform float u_ap; uniform float u_maxR;
uniform int u_view; uniform vec4 u_rect;
varying vec2 v_uv;
float raw(vec2 uv) { return u_packed > 0.5 ? clamp(unpackFloat(texture2D(u_depth, uv)), 0.0, 1.0) : texture2D(u_depth, uv).r; }
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * u_near * u_far / (u_far + u_near - z * (u_far - u_near)); }
float coc(float L, float F) { return clamp(u_ap * abs(L - F) / max(L, 1e-3) * 1.6, 0.0, 1.0) * u_maxR; }
void main() {
  vec2 uv = u_rect.xy + v_uv * u_rect.zw;
  float d = raw(uv), L = lin(d);
  vec3 c;
  if (u_view == 1) { float x = clamp(L / 34.0, 0.0, 1.0); c = mix(mix(BONE, A1, smoothstep(0.0, 0.45, x)), mix(A2 * 0.6, INK, 0.3), smoothstep(0.45, 1.0, x)); c *= 1.0 - 0.25 * step(0.92, fract(L)); if (d > 0.99999) c = INK * 1.5; }
  else if (u_view == 2) { c = vec3(pow(d, 24.0)); }
  else if (u_view == 3) { c = texture2D(u_col, uv).rgb; }
  else {
    float F = lin(raw(u_focus));
    float r0 = coc(L, F);
    vec3 acc = texture2D(u_col, uv).rgb; float wsum = 1.0;
    for (int i = 1; i < 40; i++) {
      float fi = float(i);
      float rr = sqrt(fi / 40.0) * u_maxR;
      float a = fi * 2.39996;
      vec2 o = vec2(cos(a), sin(a)) * rr * u_px;
      float ds = raw(uv + o), Ls = lin(ds);
      float rs = coc(Ls, F);
      // a sample contributes if its own blur disc reaches this pixel; nearer samples may bleed over us
      float w = clamp(1.0 + (Ls < L ? rs : min(rs, r0)) - rr, 0.0, 1.0);
      acc += texture2D(u_col, uv + o).rgb * w; wsum += w;
    }
    c = acc / wsum;
    vec2 q = (uv - u_focus) / u_px; float dist = length(q);
    c = mix(c, BONE, 0.6 * smoothstep(1.5, 0.0, abs(dist - 14.0)) * step(0.5, fract(atan(q.y, q.x) * 1.273)));
  }
  gl_FragColor = vec4(c, 1.0);
}`);
      const info = panel(ctx, 'ov-tr');
      const lab = label(ctx, 'linear depth');
      if (!hasExt) info.dataset.note = '1';
      // a colonnade receding into the distance with floating shapes along it
      const objs = [];
      for (let i = 0; i < 9; i++) {
        const z = 3 - i * 4;
        objs.push(['cube', [-2.4, 1.5, z], [0, 0, 0], [0.45, 3, 0.45], [0.55, 0.56, 0.6], 0]);
        objs.push(['cube', [2.4, 1.5, z], [0, 0, 0], [0.45, 3, 0.45], [0.55, 0.56, 0.6], 0]);
        objs.push([['knot', 'sphere', 'octa', 'torus'][i % 4], [Math.sin(i * 1.7) * 1.1, 1.1 + Math.sin(i) * 0.4, z - 2], [0, 0, 0], i % 4 === 0 ? 0.42 : 0.55, i % 2 ? S.A2 : S.A1, 1]);
      }
      return { k, pack, post, info, lab, hasExt, objs, focus: [0.5, 0.5], key: '', near: 0.3, far: 60 };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = ctx.width, H = ctx.height;
      const packed = params.src === 1 || !s.hasExt;
      const sig = `${W}x${H}:${packed}`;
      if (s.key !== sig) {
        if (s.res) util.release(...s.res);
        const col = util.texture({ width: W, height: H });
        s.res = [col];
        if (!packed) {
          const dt2 = util.texture({ width: W, height: H, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, filter: gl.NEAREST });
          const fb = util.framebuffer([col], { tex: dt2 });
          s.res.push(dt2, fb); s.main = { fb, w: W, h: H }; s.depthTex = dt2;
        } else {
          const rb = util.renderbuffer(gl.DEPTH_COMPONENT16, W, H);
          const fb = util.framebuffer([col], rb);
          const pt = util.texture({ width: W, height: H, filter: gl.NEAREST });
          const rb2 = util.renderbuffer(gl.DEPTH_COMPONENT16, W, H);
          const fb2 = util.framebuffer([pt], rb2);
          s.res.push(rb, fb, pt, rb2, fb2); s.main = { fb, w: W, h: H }; s.packT = { fb: fb2, w: W, h: H }; s.depthTex = pt;
        }
        s.colTex = col; s.key = sig;
      }
      // camera sways slowly down the colonnade
      const eye = [Math.sin(t * 0.21) * 0.9, 1.25 + Math.sin(t * 0.33) * 0.2, 6.5];
      const vp = M4.mul(M4.persp(0.75, ctx.aspect, s.near, s.far), M4.lookAt(eye, [Math.sin(t * 0.17) * 0.4, 1.1, -10]));
      const scene = (prog) => {
        for (const [m, p, r, sc, c, spin] of s.objs) {
          const M = TRS([p[0], p[1] + (spin ? Math.sin(t + p[2]) * 0.15 : 0), p[2]], spin ? [t * 0.5 + p[2], t * 0.7, 0] : r, sc);
          if (prog) { prog.set({ u_m: M }); s.k.mesh(m).draw(); } else s.k.draw(m, M, c);
        }
      };
      gl.enable(gl.DEPTH_TEST);
      util.bindTarget(s.main);
      gl.clearColor(INK[0], INK[1], INK[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      s.k.begin(vp, eye, 0.025);
      s.k.drawFloor(60, 0);
      scene(null);
      if (packed) {
        util.bindTarget(s.packT);
        gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        // the floor writes depth too: draw it with the pack program as a big flat quad
        s.pack.use().set({ u_vp: vp });
        s.pack.set({ u_m: M4.mul(M4.scale(60, 1, 60), M4.rotX(-Math.PI / 2)) });
        s.k.quad.draw();
        scene(s.pack);
      }
      gl.disable(gl.DEPTH_TEST);
      // focus point
      const g = ghost(t, 0.3, 0.12);
      const fx = input.hover ? input.uvx : g.uvx, fy = input.hover ? input.uvy : g.uvy - 0.05;
      s.focus[0] += (fx - s.focus[0]) * damp(10, dt); s.focus[1] += (fy - s.focus[1]) * damp(10, dt);
      util.bindTarget(null, W, H);
      util.tex(0, s.colTex); util.tex(1, s.depthTex);
      const base = { u_col: 0, u_depth: 1, u_packed: packed ? 1 : 0, u_focus: s.focus, u_near: s.near, u_far: s.far, u_px: [1 / W, 1 / H], u_ap: params.ap, u_maxR: 11 * ctx.dpr };
      s.post.use().set({ ...base, u_view: params.view, u_rect: [0, 0, 1, 1] });
      util.drawFullscreen();
      const showInset = params.inset && params.view !== 1;
      if (showInset) {
        const iw = Math.round(W * 0.26), ih = Math.round(H * 0.26), x0 = W - iw - Math.round(16 * ctx.dpr), y0 = Math.round(72 * ctx.dpr);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(x0 - 1, y0 - 1, iw + 2, ih + 2); gl.clearColor(0.93, 0.91, 0.88, 0.5); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(x0, y0, iw, ih);
        s.post.set({ u_view: 1, u_rect: [0, 0, 1, 1] });
        util.drawFullscreen();
        gl.viewport(0, 0, W, H);
        s.lab.style.display = '';
        s.lab.style.right = '24px'; s.lab.style.bottom = (y0 + ih) / ctx.dpr + 6 + 'px';
      } else s.lab.style.display = 'none';
      util.tex(0, null); util.tex(1, null);
      if (Math.floor(t * 3) !== s.tick) {
        s.tick = Math.floor(t * 3);
        s.info.innerHTML = `WEBGL_depth_texture ${s.hasExt ? '<span class="on">available</span>' : '<span class="off">missing</span>'}<br>depth source <b>${packed ? 'RGBA8 · packFloat (2nd pass)' : 'DEPTH_COMPONENT · UNSIGNED_INT'}</b><br>near <b>${s.near}</b> · far <b>${s.far}</b><br>scene passes <b>${packed ? 2 : 1}</b>`;
      }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Float & half-float targets                                     */
  /* ---------------------------------------------------------------- */
  const TT = ['RGBA8', 'Half float', 'Float'];
  S.register({
    id: 'float-targets',
    title: 'Float & Half-Float Targets',
    category: CAT,
    thumb: 'wide',
    hint: 'move the swarm · drag the split',
    description: 'Hundreds of faint lights are added together with blending, then tone mapped for display. In a float or half-float target the sum keeps going past 1.0 and the faint tails keep their precision, so exposure can be changed after the fact. In RGBA8 every value is rounded to 1/255 and clipped at 1.0: bright cores flatten into white plateaus and the dim gradients break into bands. Half-float rendering needs EXT_color_buffer_half_float; float needs WEBGL_color_buffer_float, and blending into it needs EXT_float_blend.',
    interact: [['Move', 'the light swarm follows the pointer'], ['Drag', 'move the split between the chosen target and RGBA8'], ['Click', 'release a burst of lights'], ['Exposure', 'applied after accumulation, in the tone-mapping pass']],
    features: ['OES_texture_float + WEBGL_color_buffer_float', 'OES_texture_half_float + EXT_color_buffer_half_float', 'EXT_float_blend', 'additive blending ONE, ONE past 1.0', 'readPixels(RGBA, FLOAT) of an HDR value'],
    params: [
      { key: 'type', label: 'Target type', type: 'select', options: TT, value: 1 },
      { key: 'exp', label: 'Exposure', type: 'range', min: 0.02, max: 4, step: 0.01, value: 0.3 },
      { key: 'n', label: 'Lights', type: 'range', min: 20, max: 600, step: 10, value: 260 },
      { key: 'split', label: 'Compare with RGBA8', type: 'toggle', value: true },
      { key: 'clip', label: 'Mark clipped values', type: 'toggle', value: false },
    ],
    code: `gl.getExtension('OES_texture_half_float');
gl.getExtension('EXT_color_buffer_half_float');
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, hf.HALF_FLOAT_OES, null);
gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
drawLights();                      // sums freely past 1.0
// tone map: c = aces(texture2D(u_hdr, uv).rgb * u_exposure);`,
    init(ctx) {
      const { gl, util } = ctx;
      const MAX = 640;
      const light = util.program(`
attribute vec2 a_pos; attribute vec2 a_uv; attribute vec4 a_col;
uniform float u_asp; varying vec2 v_q; varying vec4 v_col;
void main() { v_q = a_uv; v_col = a_col; gl_Position = vec4(a_pos.x / u_asp, a_pos.y, 0.0, 1.0); }`, `
varying vec2 v_q; varying vec4 v_col;
void main() {
  float d2 = dot(v_q, v_q);
  if (d2 > 1.0) discard;
  float f = (1.0 / (1.0 + d2 * 160.0) - 1.0 / 161.0) * (1.0 - d2);
  gl_FragColor = vec4(v_col.rgb * v_col.a * f * 3.0, 1.0);
}`);
      const tone = util.program(G.fullscreenVS, G.colors + `
uniform sampler2D u_a; uniform sampler2D u_b; uniform float u_split; uniform float u_exp; uniform float u_clip; uniform vec2 u_res;
varying vec2 v_uv;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  bool right = v_uv.x > u_split;
  vec3 h = right ? texture2D(u_b, v_uv).rgb : texture2D(u_a, v_uv).rgb;
  vec3 c = pow(aces(h * u_exp), vec3(1.0 / 2.2));
  c += INK * 0.6;
  if (u_clip > 0.5 && max(h.r, max(h.g, h.b)) >= 0.999) {
    float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 8.0));
    c = mix(c, A2, 0.75 * hatch);
  }
  float edge = abs(v_uv.x - u_split) * u_res.x;
  if (u_split > 0.0 && u_split < 1.0) c = mix(c, BONE, smoothstep(1.5, 0.0, edge));
  gl_FragColor = vec4(c, 1.0);
}`);
      const data = new Float32Array(MAX * 6 * 8);
      const buf = util.buffer(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const mesh = util.mesh([
        { buffer: buf, loc: 0, size: 2, stride: 32, offset: 0 },
        { buffer: buf, loc: 2, size: 2, stride: 32, offset: 8 },
        { buffer: buf, loc: 3, size: 4, stride: 32, offset: 16 },
      ], null, { count: 0 });
      const L = [];
      for (let i = 0; i < MAX; i++) {
        const k = Math.random();
        L.push({ ring: Math.pow(Math.random(), 0.7), a: Math.random() * Math.PI * 2, sp: (0.2 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1), r: 0.12 + Math.random() * 0.5, col: k < 0.45 ? S.A1 : k < 0.85 ? S.A2 : [1.0, 0.75, 0.45], k: 0.25 + Math.random() * 0.9, ph: Math.random() * 6.28, x: 0, y: 0 });
      }
      const ext = {
        float: !!ctx.ext('OES_texture_float'), cbf: !!ctx.ext('WEBGL_color_buffer_float'), half: !!ctx.ext('OES_texture_half_float'),
        cbh: !!ctx.ext('EXT_color_buffer_half_float'), blend: !!ctx.ext('EXT_float_blend'),
      };
      const info = panel(ctx, 'ov-tr');
      const la = label(ctx, ''), lb = label(ctx, 'RGBA8');
      return { light, tone, data, buf, mesh, L, ext, info, la, lb, c: [0, 0], split: 0.5, bursts: [], key: '', read: null };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = Math.max(2, Math.round(ctx.width * 0.75)), H = Math.max(2, Math.round(ctx.height * 0.75));
      const sig = `${W}x${H}:${params.type}`;
      if (s.key !== sig) {
        if (s.tA) util.release(s.tA.fb, s.tA.tex);
        if (s.tB) util.release(s.tB.fb, s.tB.tex);
        s.note = '';
        let want = params.type;
        if (want === 2 && !s.ext.blend) { s.note = 'EXT_float_blend missing: blending into FLOAT is not allowed, using half float'; want = 1; }
        s.tA = null;
        for (let ty = want; ty >= 0 && !s.tA; ty--) {
          try { s.tA = util.target(W, H, { type: [gl.UNSIGNED_BYTE, 'half', 'float'][ty], filter: gl.NEAREST }); s.used = ty; } catch (e) { s.note = (s.note ? s.note + '; ' : '') + TT[ty] + ' target unavailable (' + e.message + ')'; }
        }
        s.tB = util.target(W, H, { filter: gl.NEAREST });
        s.key = sig;
        if (!s.probe) s.probe = makeProbe(ctx, true);
      }
      s.read = s.probe.read(); // before any drawing this frame
      const asp = ctx.aspect;
      const g = ghost(t, 0.1, 0.08);
      const tx = (input.hover ? input.nx : g.uvx * 2 - 1) * asp, ty = input.hover ? input.ny : g.uvy * 2 - 1;
      s.c[0] += (tx - s.c[0]) * damp(5, dt); s.c[1] += (ty - s.c[1]) * damp(5, dt);
      if (input.dragging && params.split && s.used !== 0) s.split = clamp(input.uvx, 0.02, 0.98);
      for (const c of input.clicks) s.bursts.push({ x: c.nx * asp, y: c.ny, t0: t });
      if (ctx.capture && !s.capBurst) { s.capBurst = true; s.bursts.push({ x: -0.5 * asp, y: 0.25, t0: -1.2 }); }
      s.bursts = s.bursts.filter((b) => t - b.t0 < 4);
      // build light quads
      const n = Math.min(params.n, s.L.length), d = s.data;
      let o = 0;
      for (let i = 0; i < n; i++) {
        const l = s.L[i];
        l.a += l.sp * dt * (0.6 + (1 - l.ring));
        const rad = 0.08 + l.ring * 0.75 + Math.sin(t * 0.7 + l.ph) * 0.05;
        let x = s.c[0] + Math.cos(l.a) * rad * 1.25, y = s.c[1] + Math.sin(l.a) * rad * 0.8;
        let kk = l.k;
        const b = s.bursts[i % Math.max(1, s.bursts.length)];
        if (b && i % 3 === 0) { const age = t - b.t0, rr = age * 0.55 * (0.5 + l.ring); x = b.x + Math.cos(l.ph * 3 + i) * rr; y = b.y + Math.sin(l.ph * 3 + i) * rr; kk *= 2.2 * Math.exp(-age * 0.8); }
        const r = l.r * (0.7 + 0.3 * Math.sin(t + l.ph));
        const q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
        for (const [u, v] of q) { d.set([x + u * r, y + v * r, u, v, l.col[0], l.col[1], l.col[2], kk], o); o += 8; }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, o));
      s.mesh.count = n * 6;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      s.light.use().set({ u_asp: asp });
      const showSplit = params.split && s.used !== 0;
      for (const tg of showSplit ? [s.tA, s.tB] : [s.tA]) {
        util.bindTarget(tg); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        s.mesh.draw();
      }
      gl.disable(gl.BLEND);
      {
        const px = clamp(Math.floor((input.hover ? input.uvx : (s.c[0] / asp) * 0.5 + 0.5) * W), 0, W - 1), py = clamp(Math.floor((input.hover ? input.uvy : s.c[1] * 0.5 + 0.5) * H), 0, H - 1);
        s.probe.write(showSplit && px / W > s.split ? s.tB.tex : s.tA.tex, px, py, W, H);
      }
      util.bindTarget(null, ctx.width, ctx.height);
      util.tex(0, s.tA.tex); util.tex(1, s.tB.tex);
      s.tone.use().set({ u_a: 0, u_b: 1, u_split: showSplit ? s.split : 2, u_exp: params.exp, u_clip: params.clip ? 1 : 0, u_res: [ctx.width, ctx.height] });
      util.drawFullscreen();
      util.tex(0, null); util.tex(1, null);
      s.la.textContent = TT[s.used] + (s.used ? ' · HDR' : '');
      s.la.style.left = (showSplit ? s.split * ctx.cssWidth - 12 : 24) + 'px'; s.la.style.transform = showSplit ? 'translateX(-100%)' : ''; s.la.style.bottom = '76px';
      s.lb.style.display = showSplit ? '' : 'none'; s.lb.style.left = s.split * ctx.cssWidth + 12 + 'px'; s.lb.style.bottom = '76px';
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        const e = s.ext, yn = (v) => (v ? '<span class="on">yes</span>' : '<span class="off">no</span>');
        s.info.innerHTML = `OES_texture_float ${yn(e.float)} · WEBGL_color_buffer_float ${yn(e.cbf)}<br>OES_texture_half_float ${yn(e.half)} · EXT_color_buffer_half_float ${yn(e.cbh)}<br>EXT_float_blend ${yn(e.blend)}<br>target <b>${TT[s.used]}</b> · ${W} × ${H} · ${[4, 8, 16][s.used]} B/px` +
          (s.read ? `<br>value under pointer <b>${s.read.slice(0, 3).map((v) => v.toFixed(3)).join(' ')}</b>` : '') + (s.note ? `<br><span class="off">${s.note}</span>` : '');
      }
      ctx.canvas.style.cursor = showSplit ? 'ew-resize' : 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Multiple render targets                                        */
  /* ---------------------------------------------------------------- */
  const MAXL = 48;
  S.register({
    id: 'draw-buffers',
    title: 'Multiple Render Targets',
    category: CAT,
    thumb: 'portrait',
    hint: 'move the lights · view each buffer',
    description: 'WEBGL_draw_buffers lets one fragment shader write several colours at once through gl_FragData[n], each into its own colour attachment. The scene is drawn once into a G-buffer of albedo, view-space normal and packed linear depth; a second full-screen pass reconstructs each pixel\'s position and lights it with dozens of point lights that swarm around the pointer. Without the extension the same G-buffer is filled with three separate passes.',
    interact: [['Move', 'the lights gather around the point under the pointer'], ['Drag', 'orbit'], ['View', 'lit result, each attachment, or all four'], ['Path', 'one MRT pass, or three single-target passes']],
    features: ['WEBGL_draw_buffers · drawBuffersWEBGL', 'gl_FragData[0..2] (GL_EXT_draw_buffers)', 'COLOR_ATTACHMENT0..2_WEBGL', 'MAX_DRAW_BUFFERS_WEBGL / MAX_COLOR_ATTACHMENTS_WEBGL', 'deferred shading from packed depth'],
    params: [
      { key: 'view', label: 'View', type: 'select', options: ['Lit', 'Albedo', 'Normal', 'Depth', 'All four'], value: 0 },
      { key: 'path', label: 'Path', type: 'select', options: ['MRT (1 pass)', 'Fallback (3 passes)'], value: 0 },
      { key: 'n', label: 'Point lights', type: 'range', min: 4, max: MAXL, step: 1, value: 28 },
    ],
    code: `#extension GL_EXT_draw_buffers : require
void main() {
  gl_FragData[0] = vec4(albedo, spec);
  gl_FragData[1] = vec4(normal * 0.5 + 0.5, 1.0);
  gl_FragData[2] = packFloat(-viewPos.z / u_far);
}
// JS: ext.drawBuffersWEBGL([ext.COLOR_ATTACHMENT0_WEBGL, …1, …2]);`,
    init(ctx) {
      const { gl, util } = ctx;
      const db = ctx.ext('WEBGL_draw_buffers');
      const maxFUV = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
      const maxL = Math.max(4, Math.min(MAXL, Math.floor((maxFUV - 24) / 2)));
      const gvs = `
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_p; uniform mat4 u_v; uniform mat4 u_m;
varying vec3 v_n; varying vec3 v_vp; varying vec3 v_w;
void main() { vec4 w = u_m * vec4(a_pos, 1.0); v_w = w.xyz; vec4 vp = u_v * w; v_vp = vp.xyz; v_n = mat3(u_v) * (mat3(u_m) * a_nrm); gl_Position = u_p * vp; }`;
      const gbody = G.pack + `
uniform vec3 u_col; uniform float u_spec; uniform float u_far; uniform float u_floor;
varying vec3 v_n; varying vec3 v_vp; varying vec3 v_w;
vec4 albedo() {
  vec3 c = u_col;
  if (u_floor > 0.5) { vec2 g = floor(v_w.xz * 0.5); c = mix(vec3(0.42), vec3(0.62), mod(g.x + g.y, 2.0)); vec2 f = abs(fract(v_w.xz * 0.5) - 0.5); c *= 0.8 + 0.2 * step(0.47, max(f.x, f.y)); }
  return vec4(c, u_spec);
}
vec4 normal() { return vec4(normalize(v_n) * 0.5 + 0.5, 1.0); }
vec4 depth() { return packFloat(clamp(-v_vp.z / u_far, 0.0, 0.99999)); }`;
      const gMRT = db ? util.program(gvs, '#extension GL_EXT_draw_buffers : require\n' + gbody + `
void main() { gl_FragData[0] = albedo(); gl_FragData[1] = normal(); gl_FragData[2] = depth(); }`) : null;
      const gOne = util.program(gvs, gbody + `
uniform int u_out;
void main() { if (u_out == 0) gl_FragColor = albedo(); else if (u_out == 1) gl_FragColor = normal(); else gl_FragColor = depth(); }`);
      const light = util.program(G.fullscreenVS, G.colors + G.pack + `
#define MAXL ${maxL}
uniform sampler2D u_a; uniform sampler2D u_n; uniform sampler2D u_d;
uniform vec3 u_lp[MAXL]; uniform vec3 u_lc[MAXL]; uniform float u_nl;
uniform float u_far; uniform vec2 u_tan; uniform int u_view;
varying vec2 v_uv;
void main() {
  vec4 A = texture2D(u_a, v_uv); vec4 NN = texture2D(u_n, v_uv); vec3 N = NN.xyz; float D = unpackFloat(texture2D(u_d, v_uv));
  bool bg = NN.a < 0.5;
  vec3 c;
  if (u_view == 1) c = A.rgb;
  else if (u_view == 2) c = N;
  else if (u_view == 3) { float x = D * 2.2; c = mix(BONE, mix(A1, INK, smoothstep(0.3, 1.0, x)), smoothstep(0.0, 0.3, x)); if (bg) c = INK; }
  else {
    if (bg) { c = INK; }
    else {
      float z = D * u_far;
      vec3 P = vec3((v_uv * 2.0 - 1.0) * u_tan * z, -z);
      vec3 n = normalize(N * 2.0 - 1.0), V = normalize(-P);
      c = A.rgb * 0.035;
      for (int i = 0; i < MAXL; i++) {
        if (float(i) >= u_nl) break;
        vec3 L = u_lp[i] - P; float d = length(L); L /= d;
        float att = pow(max(1.0 - d / 2.6, 0.0), 2.0);
        float df = max(dot(n, L), 0.0);
        float sp = pow(max(dot(n, normalize(L + V)), 0.0), 48.0) * A.a;
        c += u_lc[i] * att * (A.rgb * df + sp);
      }
      c = c / (1.0 + c * 0.35);
    }
  }
  gl_FragColor = vec4(pow(c, vec3(u_view == 0 ? 0.85 : 1.0)), 1.0);
}`);
      const dots = util.program(`
attribute vec3 a_pos; attribute vec3 a_col; uniform mat4 u_vp; uniform float u_ps; varying vec3 v_c;
void main() { v_c = a_col; gl_Position = u_vp * vec4(a_pos, 1.0); gl_PointSize = u_ps / gl_Position.w; }`, `
varying vec3 v_c; void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard; gl_FragColor = vec4(v_c * (exp(-d * 4.0) * 1.2), 1.0); }`);
      const dotBuf = util.buffer(gl.ARRAY_BUFFER, new Float32Array(MAXL * 6), gl.DYNAMIC_DRAW);
      const dotMesh = util.mesh([{ buffer: dotBuf, loc: 0, size: 3, stride: 24, offset: 0 }, { buffer: dotBuf, loc: 3, size: 3, stride: 24, offset: 12 }], null, { count: 0 });
      const k = kit(util);
      const objs = [];
      for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) {
        if ((x + z) % 2 || (x === 0 && z === 0)) continue;
        const h = 0.4 + ((x * 7 + z * 13 + 50) % 5) * 0.25;
        objs.push(['cube', [x * 1.3, h / 2, z * 1.3], [0.32, h, 0.32], [0.75, 0.75, 0.78], 0.4]);
      }
      objs.push(['knot', [0, 1.0, 0], 0.55, [0.85, 0.83, 0.8], 1]);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; objs.push([i % 2 ? 'sphere' : 'octa', [Math.cos(a) * 2.6, 0.35, Math.sin(a) * 2.6], 0.35, i % 2 ? [0.9, 0.9, 0.92] : [0.6, 0.62, 0.7], 0.9]); }
      const labs = ['LIT', 'ALBEDO · ATTACHMENT0', 'NORMAL · ATTACHMENT1', 'DEPTH · ATTACHMENT2'].map((n) => label(ctx, n));
      const info = panel(ctx, 'ov-tr');
      const lights = [];
      for (let i = 0; i < MAXL; i++) { const kk = i / MAXL; lights.push({ p: [0, 0.5, 0], ph: i * 2.399, r: 0.5 + (i % 7) * 0.33, h: 0.25 + (i % 5) * 0.18, sp: 0.4 + (i % 3) * 0.25, col: i % 3 === 0 ? [1.0, 0.85, 0.65] : kk < 0.5 ? S.A1 : S.A2 }); }
      return { db, gMRT, gOne, light, dots, dotBuf, dotMesh, k, objs, labs, info, lights, maxL, cam: new S.OrbitCam({ dist: 8.5, pitch: 0.62, yaw: 0.6, auto: 0.05, target: [0, 0.4, 0] }), hit: [0, 0, 0], key: '' };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = ctx.width, H = ctx.height;
      const mrt = params.path === 0 && !!s.db;
      const sig = `${W}x${H}:${mrt}`;
      if (s.key !== sig) {
        if (s.res) util.release(...s.res);
        const tex = [0, 1, 2].map(() => util.texture({ width: W, height: H, filter: gl.NEAREST }));
        const rb = util.renderbuffer(gl.DEPTH_COMPONENT16, W, H);
        s.res = [...tex, rb];
        if (mrt) { const fb = util.framebuffer(tex, rb); s.fbs = [fb]; s.res.push(fb); }
        else { s.fbs = tex.map((tx) => util.framebuffer([tx], rb)); s.res.push(...s.fbs); }
        s.tex = tex; s.key = sig;
      }
      s.cam.update(input, dt);
      const far = 30;
      const P = s.cam.proj(ctx.aspect, 0.1, far), V = s.cam.view();
      // pointer → floor point
      let tgt = null;
      if (input.hover) { const r = s.cam.ray(input.nx, input.ny, ctx.aspect); tgt = S.math.Ray.plane(r.origin, r.dir, [0, 0, 0], [0, 1, 0]); }
      if (!tgt) tgt = [Math.sin(t * 0.45) * 2.4, 0, Math.sin(t * 0.31 + 1) * 2.0];
      tgt[0] = clamp(tgt[0], -5, 5); tgt[2] = clamp(tgt[2], -5, 5);
      for (let i = 0; i < 3; i++) s.hit[i] += (tgt[i] - s.hit[i]) * damp(4, dt);
      const n = Math.min(params.n, s.maxL);
      const lp = new Float32Array(s.maxL * 3), lc = new Float32Array(s.maxL * 3), dd = new Float32Array(MAXL * 6);
      for (let i = 0; i < n; i++) {
        const l = s.lights[i];
        const a = l.ph + t * l.sp * (i % 2 ? 1 : -1);
        const want = [s.hit[0] + Math.cos(a) * l.r, l.h + Math.sin(t * 1.3 + l.ph) * 0.08, s.hit[2] + Math.sin(a) * l.r];
        for (let j = 0; j < 3; j++) l.p[j] += (want[j] - l.p[j]) * damp(2 + (i % 4), dt);
        const v = xform(V, l.p);
        lp.set([v[0], v[1], v[2]], i * 3);
        const inten = 1.6;
        lc.set(l.col.map((c) => c * inten), i * 3);
        dd.set([...l.p, ...l.col], i * 6);
      }
      // ---- G-buffer
      gl.enable(gl.DEPTH_TEST);
      const passes = mrt ? [[s.gMRT, 0]] : [[s.gOne, 0], [s.gOne, 1], [s.gOne, 2]];
      passes.forEach(([prog, out], pi) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbs[pi]); gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        prog.use().set({ u_p: P, u_v: V, u_far: far, u_out: out });
        prog.set({ u_m: M4.mul(M4.scale(8, 1, 8), M4.rotX(-Math.PI / 2)), u_col: [0.5, 0.5, 0.5], u_spec: 0.3, u_floor: 1 });
        s.k.quad.bind(); gl.vertexAttrib3f(1, 0, 1, 0); // constant normal for the floor quad
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        prog.set({ u_floor: 0 });
        for (const [m, p, sc, c, spc] of s.objs) {
          const M = m === 'knot' ? TRS(p, [t * 0.3, t * 0.5, 0], sc) : TRS(p, [0, m === 'cube' ? 0 : t * 0.4, 0], sc);
          prog.set({ u_m: M, u_col: c, u_spec: spc });
          s.k.mesh(m).draw();
        }
      });
      gl.disable(gl.DEPTH_TEST);
      // ---- lighting / views
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(INK[0], INK[1], INK[2], 1);
      gl.viewport(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT);
      s.tex.forEach((tx, i) => util.tex(i, tx));
      const tanH = Math.tan(s.cam.fov / 2);
      s.light.use().set({ u_a: 0, u_n: 1, u_d: 2, u_lp: lp, u_lc: lc, u_nl: n, u_far: far, u_tan: [tanH * ctx.aspect, tanH] });
      const all = params.view === 4;
      const cells = all ? [[0, 0, 0], [1, 1, 0], [2, 0, 1], [3, 1, 1]] : [[params.view, 0, 0]];
      // cleared pixels have normal.a = 0 and are treated as background
      cells.forEach(([v, cx, cy]) => {
        const cw = all ? Math.floor(W / 2) : W, ch = all ? Math.floor(H / 2) : H;
        gl.viewport(cx * cw, (all ? 1 - cy : 0) * ch, cw, ch);
        s.light.set({ u_view: v });
        util.drawFullscreen();
        if (v === 0) {
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindBuffer(gl.ARRAY_BUFFER, s.dotBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, dd);
          s.dotMesh.count = n;
          s.dots.use().set({ u_vp: M4.mul(P, V), u_ps: 1.6 * ch / 10 });
          s.dotMesh.draw(gl.POINTS);
          gl.disable(gl.BLEND);
          s.light.use();
        }
        const L = s.labs[v];
        L.style.display = all ? '' : 'none';
        L.style.left = (cx * cw) / ctx.dpr + 14 + 'px'; L.style.top = (cy * ch) / ctx.dpr + (all && cy ? 12 : 66) + 'px';
        L.style.color = v === 0 ? 'var(--acc1)' : '';
      });
      s.labs.forEach((L, i) => { if (!cells.some((c) => c[0] === i)) L.style.display = 'none'; });
      gl.viewport(0, 0, W, H);
      for (let i = 0; i < 3; i++) util.tex(i, null);
      if (Math.floor(t * 3) !== s.tick) {
        s.tick = Math.floor(t * 3);
        const db = s.db;
        s.info.innerHTML = `WEBGL_draw_buffers ${db ? '<span class="on">available</span>' : '<span class="off">missing</span>'}` +
          (db ? `<br>MAX_DRAW_BUFFERS_WEBGL <b>${gl.getParameter(db.MAX_DRAW_BUFFERS_WEBGL)}</b><br>MAX_COLOR_ATTACHMENTS_WEBGL <b>${gl.getParameter(db.MAX_COLOR_ATTACHMENTS_WEBGL)}</b>` : '') +
          `<br>G-buffer <b>3 × RGBA8</b> + DEPTH16<br>geometry passes <b>${mrt ? 1 : 3}</b>${params.path === 0 && !db ? ' <span class="off">(fallback)</span>' : ''}<br>lights <b>${n}</b> in one full-screen pass`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 6. Colour-ID picking                                              */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'readpixels-pick',
    title: 'Colour-ID Picking',
    category: CAT,
    thumb: 'square',
    hint: 'hover · click to select · drag to move',
    description: 'Every object is drawn a second time into an offscreen RGBA8 target with its index encoded as a flat colour. One readPixels call under the pointer returns four bytes that name the object exactly, whatever its shape, with no ray maths. Hovering highlights the object, clicking selects it, and dragging slides the selection across the floor plane. The inset shows the ID target itself.',
    interact: [['Hover', 'highlight the object under the pointer'], ['Click', 'select it'], ['Drag object', 'move the selected object along the floor'], ['Drag empty space', 'orbit']],
    features: ['offscreen RGBA8 ID target', 'gl.readPixels(x, y, 1, 1, RGBA, UNSIGNED_BYTE)', 'id → colour encoding (r + g·256)', 'PACK_ALIGNMENT', 'ray–plane drag after the pick'],
    params: [
      { key: 'inset', label: 'Show ID target inset', type: 'toggle', value: true },
      { key: 'count', label: 'Objects', type: 'range', min: 8, max: 120, step: 1, value: 42, restart: true },
    ],
    code: `// pass 1: ids
gl.bindFramebuffer(gl.FRAMEBUFFER, idFbo);
prog.set({ u_id: [(id & 255) / 255, (id >> 8) / 255, 0, 1] });
// read one pixel under the pointer
const px = new Uint8Array(4);
gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
const hit = px[0] + px[1] * 256 - 1;   // -1 = background`,
    init(ctx) {
      const { util, params } = ctx;
      const k = kit(util);
      const idp = util.program(`
attribute vec3 a_pos; uniform mat4 u_vp; uniform mat4 u_m;
void main() { gl_Position = u_vp * u_m * vec4(a_pos, 1.0); }`, `
uniform vec4 u_id; void main() { gl_FragColor = u_id; }`);
      const view = util.program(G.fullscreenVS, G.colors + G.noise + `
uniform sampler2D u_tex; uniform float u_hl; varying vec2 v_uv;
void main() {
  vec4 p = texture2D(u_tex, v_uv);
  float id = floor(p.r * 255.0 + 0.5) + floor(p.g * 255.0 + 0.5) * 256.0;
  vec3 c = id < 0.5 ? INK : 0.25 + 0.75 * vec3(hash12(vec2(id, 1.7)), hash12(vec2(id, 7.3)), hash12(vec2(id, 3.1)));
  if (abs(id - u_hl) < 0.5) c = BONE;
  gl_FragColor = vec4(c, 1.0);
}`);
      const shapes = ['cube', 'sphere', 'octa', 'torus', 'knot'];
      const objs = [];
      const N = params.count;
      for (let i = 0; i < N; i++) {
        let x, z, tries = 0;
        do { x = (Math.random() * 2 - 1) * 4.6; z = (Math.random() * 2 - 1) * 3.6; tries++; } while (tries < 40 && objs.some((o) => Math.hypot(o.p[0] - x, o.p[2] - z) < 0.9));
        const m = shapes[i % 5], sc = m === 'knot' ? 0.24 : m === 'torus' ? 0.3 : m === 'sphere' ? 0.33 : 0.45;
        const kk = Math.random();
        objs.push({ m, p: [x, m === 'torus' ? 0.12 : sc * (m === 'cube' ? 0.5 : 1), z], sc, ry: Math.random() * 6.28, col: kk < 0.4 ? [0.62, 0.64, 0.68] : kk < 0.7 ? mix3(S.A1, [0.5, 0.5, 0.55], 0.35) : mix3(S.A2, [0.5, 0.5, 0.55], 0.35), name: m + ' #' + (i + 1) });
      }
      const info = panel(ctx, 'ov-tr');
      const lab = label(ctx, 'ID target · RGBA8');
      return { k, idp, view, objs, info, lab, probe: makeProbe(ctx, false), cam: new S.OrbitCam({ dist: 9, pitch: 0.75, yaw: 0.3, auto: 0.03, target: [0, 0, 0] }), hover: -1, sel: ctx.capture ? 3 : -1, drag: null, wasDown: false, px: new Uint8Array(4), key: '', ms: 0 };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const W = ctx.width, H = ctx.height;
      if (s.key !== `${W}x${H}`) { if (s.tg) util.release(s.tg.fb, s.tg.tex, s.tg.depth); s.tg = util.target(W, H, { depth: true, filter: gl.NEAREST }); s.key = `${W}x${H}`; }
      // ghost pointer when there is no real one
      let pu = input.uvx, pv = input.uvy, live = input.hover || input.down;
      if (!live) { pu = 0.5 + Math.sin(t * 0.5) * 0.3; pv = 0.45 + Math.sin(t * 0.37 + 0.6) * 0.2; }
      const pressed = input.down && !s.wasDown, released = !input.down && s.wasDown;
      s.wasDown = input.down;
      const ar = ctx.aspect;
      const vp = M4.mul(s.cam.proj(ar, 0.1, 60), s.cam.view()), eye = s.cam.eye();
      const M = (o, i) => TRS(o.p, [0, o.ry + (i === s.drag?.id ? 0 : t * 0.15), 0], o.sc);
      const x = clamp(Math.floor(pu * W), 0, W - 1), y = clamp(Math.floor(pv * H), 0, H - 1);
      // ---- the pick result: a pixel copied out of the ID target three frames ago
      s.probe.read();
      if (s.probe.bytes) s.px.set(s.probe.bytes);
      s.ms += ((s.probe.ms || 0) - s.ms) * 0.1;
      const hit = s.px[0] + s.px[1] * 256 - 1;
      s.hover = s.drag ? s.drag.id : hit;
      // ---- ID pass
      util.bindTarget(s.tg);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.idp.use().set({ u_vp: vp });
      // the floor occludes too, with id 0
      s.idp.set({ u_m: M4.mul(M4.scale(30, 1, 30), M4.rotX(-Math.PI / 2)), u_id: [0, 0, 0, 1] }); s.k.quad.draw();
      s.objs.forEach((o, i) => { const id = i + 1; s.idp.set({ u_m: M(o, i), u_id: [(id & 255) / 255, (id >> 8) / 255, 0, 1] }); s.k.mesh(o.m).draw(); });
      gl.disable(gl.DEPTH_TEST);
      s.probe.write(s.tg.tex, x, y, W, H);
      gl.enable(gl.DEPTH_TEST);
      // ---- interaction
      const ray = s.cam.ray(pu * 2 - 1, pv * 2 - 1, ar);
      if (pressed && hit >= 0) {
        s.sel = hit;
        const o = s.objs[hit];
        const hp = S.math.Ray.plane(ray.origin, ray.dir, [0, o.p[1], 0], [0, 1, 0]);
        s.drag = hp ? { id: hit, off: [o.p[0] - hp[0], o.p[2] - hp[2]] } : null;
      }
      if (input.clicks.length && hit < 0) s.sel = -1;
      if (s.drag && input.down) {
        const o = s.objs[s.drag.id];
        const hp = S.math.Ray.plane(ray.origin, ray.dir, [0, o.p[1], 0], [0, 1, 0]);
        if (hp) { o.p[0] = clamp(hp[0] + s.drag.off[0], -9, 9); o.p[2] = clamp(hp[2] + s.drag.off[1], -9, 9); }
      }
      if (released) s.drag = null;
      s.cam.update(s.drag ? { ...input, dragging: false } : input, dt);
      // ---- colour pass
      util.bindTarget(null, W, H);
      gl.clearColor(INK[0], INK[1], INK[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      s.k.begin(vp, eye, 0.04);
      const so = s.objs[s.sel];
      s.k.drawFloor(30, 0, S.A1, [0.035, 0.04, 0.055], so ? [so.p[0], so.p[2], so.sc * 1.6 + 0.15] : [0, 0, 0]);
      s.objs.forEach((o, i) => {
        const hov = i === s.hover, sel = i === s.sel;
        s.k.draw(o.m, M(o, i), sel ? mix3(o.col, S.A2, 0.6) : o.col, { u_glow: hov ? 0.55 : sel ? 0.15 : 0 });
      });
      gl.disable(gl.DEPTH_TEST);
      if (params.inset) {
        const iw = Math.round(W * 0.24), ih = Math.round(H * 0.24), x0 = W - iw - Math.round(16 * ctx.dpr), y0 = Math.round(72 * ctx.dpr);
        gl.enable(gl.SCISSOR_TEST); gl.scissor(x0 - 1, y0 - 1, iw + 2, ih + 2); gl.clearColor(0.93, 0.91, 0.88, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
        gl.viewport(x0, y0, iw, ih);
        util.tex(0, s.tg.tex);
        s.view.use().set({ u_tex: 0, u_hl: s.hover >= 0 ? s.hover + 1 : -10 });
        util.drawFullscreen();
        gl.viewport(0, 0, W, H);
        s.lab.style.display = ''; s.lab.style.right = '24px'; s.lab.style.bottom = (y0 + ih) / ctx.dpr + 6 + 'px';
        util.tex(0, null);
      } else s.lab.style.display = 'none';
      if (Math.floor(t * 6) !== s.tick) {
        s.tick = Math.floor(t * 6);
        const px = s.px;
        s.info.innerHTML = `readPixels(${x}, ${y}) → <b>[${px[0]}, ${px[1]}, ${px[2]}, ${px[3]}]</b><br>hover <b>${hit >= 0 ? s.objs[hit].name : '—'}</b><br>selected <b class="off">${so ? so.name : '—'}</b><br>readPixels <b>${s.ms.toFixed(2)} ms</b> (1×1 ring, 3 frames late)`;
      }
      ctx.canvas.style.cursor = s.drag ? 'grabbing' : s.hover >= 0 ? 'pointer' : 'grab';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 7. Dynamic cube map                                               */
  /* ---------------------------------------------------------------- */
  const FACES = [
    [[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]], [[0, 1, 0], [0, 0, 1]],
    [[0, -1, 0], [0, 0, -1]], [[0, 0, 1], [0, -1, 0]], [[0, 0, -1], [0, -1, 0]],
  ];
  const CUBE_RES = [32, 64, 128, 256, 512];
  S.register({
    id: 'dynamic-cubemap',
    title: 'Dynamic Cube Map',
    category: CAT,
    thumb: 'tall',
    hint: 'drag to orbit · change resolution',
    description: 'Each frame the scene is rendered six times from the centre of the mirror, once into each face of a cube-map texture, by attaching TEXTURE_CUBE_MAP_POSITIVE_X + i to a framebuffer with a 90° square camera. The mirror then samples that cube map with its reflection vector, so the moving objects around it appear in it live. Lower the resolution to see the reflection soften; freeze updates to see it go stale.',
    interact: [['Drag', 'orbit'], ['Wheel', 'zoom'], ['Resolution', 'size of each cube face'], ['Blur', 'mip bias on a mipmapped cube map']],
    features: ['framebufferTexture2D(…, TEXTURE_CUBE_MAP_POSITIVE_X + i)', '6 passes with a 90° square projection', 'shared DEPTH_COMPONENT16 renderbuffer', 'textureCube(env, reflect(-V, N), bias)', 'generateMipmap(TEXTURE_CUBE_MAP)'],
    params: [
      { key: 'res', label: 'Face resolution', type: 'select', options: CUBE_RES.map(String), value: 2, restart: true },
      { key: 'shape', label: 'Mirror', type: 'select', options: ['Sphere', 'Knot', 'Torus'], value: 0 },
      { key: 'blur', label: 'Blur (mip bias)', type: 'range', min: 0, max: 6, step: 0.1, value: 0 },
      { key: 'live', label: 'Update every frame', type: 'toggle', value: true },
      { key: 'faces', label: 'Show the six faces', type: 'toggle', value: true },
    ],
    code: `for (let i = 0; i < 6; i++) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, cubeTex, 0);
  gl.viewport(0, 0, size, size);
  drawScene(persp(PI / 2, 1, near, far) * lookAt(c, c + DIR[i], UP[i]));
}
// shader: textureCube(u_env, reflect(-V, N), u_bias)`,
    init(ctx) {
      const { gl, util, params } = ctx;
      const R = CUBE_RES[params.res];
      const k = kit(util);
      const cube = util.texture({ target: gl.TEXTURE_CUBE_MAP, width: R, height: R, filter: gl.LINEAR });
      const depth = util.renderbuffer(gl.DEPTH_COMPONENT16, R, R);
      const fbs = FACES.map((_, i) => util.framebuffer([cube], depth, { cubeFace: gl.TEXTURE_CUBE_MAP_POSITIVE_X + i }));
      const sky = util.program(`
attribute vec3 a_pos; uniform mat4 u_vp; uniform vec3 u_c; varying vec3 v_d;
void main() { v_d = a_pos; gl_Position = u_vp * vec4(u_c + a_pos * 40.0, 1.0); }`, G.colors + G.noise + `
varying vec3 v_d;
void main() {
  vec3 d = normalize(v_d);
  float h = d.y;
  vec3 c = mix(vec3(0.05, 0.055, 0.08), vec3(0.015, 0.018, 0.03), smoothstep(0.0, 0.7, h));
  c += A1 * 0.35 * exp(-abs(h - 0.04) * 22.0) + A2 * 0.25 * exp(-abs(h - 0.12) * 9.0) * (0.6 + 0.4 * sin(atan(d.z, d.x) * 3.0));
  float st = step(0.996, hash12(floor(d.xz / (h + 1.2) * 180.0))) * smoothstep(0.15, 0.5, h);
  gl_FragColor = vec4(c + st * 0.6, 1.0);
}`);
      const mirror = util.program(LIT_VS, G.colors + `
uniform samplerCube u_env; uniform vec3 u_eye; uniform float u_bias;
varying vec3 v_n; varying vec3 v_w;
void main() {
  vec3 n = normalize(v_n), v = normalize(u_eye - v_w);
  vec3 r = reflect(-v, n);
  vec3 c = textureCube(u_env, r, u_bias).rgb;
  float f = 0.25 + 0.75 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
  c = c * mix(vec3(0.85, 0.88, 0.92), vec3(1.0), f) + BONE * 0.02;
  gl_FragColor = vec4(c, 1.0);
}`);
      const cross = util.program(G.fullscreenVS, G.colors + `
uniform samplerCube u_env; uniform int u_face; varying vec2 v_uv;
void main() {
  vec2 q = v_uv * 2.0 - 1.0; vec3 d;   // each face shown as stored (row 0 at the top)
  if (u_face == 0) d = vec3(1.0, q.y, -q.x); else if (u_face == 1) d = vec3(-1.0, q.y, q.x);
  else if (u_face == 2) d = vec3(q.x, 1.0, -q.y); else if (u_face == 3) d = vec3(q.x, -1.0, q.y);
  else if (u_face == 4) d = vec3(q.x, q.y, 1.0); else d = vec3(-q.x, q.y, -1.0);
  vec3 c = textureCube(u_env, d).rgb;
  vec2 e = min(v_uv, 1.0 - v_uv); c = mix(BONE * 0.5, c, step(0.012, min(e.x, e.y)));
  gl_FragColor = vec4(c, 1.0);
}`);
      const skyMesh = k.mesh('sphere');
      const lab = label(ctx, 'cube faces  +X −X +Y −Y +Z −Z');
      const info = panel(ctx, 'ov-tr', `cube map <b>6 × ${R}²</b> RGBA8<br>depth <b>DEPTH_COMPONENT16 ${R}²</b> (shared)<br>scene passes per frame <b>7</b>`);
      return { k, cube, fbs, R, sky, mirror, cross, skyMesh, lab, info, cam: new S.OrbitCam({ dist: 6.2, pitch: 0.22, yaw: 0.4, auto: 0.1, target: [0, 1.2, 0], minDist: 2.5, maxDist: 16 }), first: true };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params, input } = ctx;
      const C = [0, 1.2, 0];
      const k = s.k;
      const env = (vp, eye) => {
        gl.depthMask(false);
        s.sky.use().set({ u_vp: vp, u_c: eye });
        s.skyMesh.draw();
        gl.depthMask(true);
        k.begin(vp, eye, 0.03, [0.03, 0.034, 0.05]);
        k.drawFloor(40, 0, S.A1, [0.03, 0.034, 0.05]);
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2 + t * (i % 2 ? 0.35 : -0.25);
          const r = i % 2 ? 2.4 : 3.3;
          k.draw(['cube', 'knot', 'octa', 'torus'][i % 4], TRS([Math.cos(a) * r, 1.2 + Math.sin(t * 1.2 + i) * 0.7, Math.sin(a) * r], [t + i, t * 0.8 + i, 0], i % 4 === 1 ? 0.3 : 0.45), [S.A1, S.A2, BONE, [1.0, 0.7, 0.35]][i % 4]);
        }
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.draw('cube', TRS([Math.cos(a) * 6, 1.5, Math.sin(a) * 6], [0, -a, 0], [0.4, 3, 0.4]), [0.45, 0.46, 0.5]); }
      };
      gl.enable(gl.DEPTH_TEST);
      if (params.live || s.first) {
        const P = M4.persp(Math.PI / 2, 1, 0.1, 80);
        for (let i = 0; i < 6; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbs[i]); gl.viewport(0, 0, s.R, s.R);
          gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          const [dir, up] = FACES[i];
          env(M4.mul(P, M4.lookAt(C, V3.add(C, dir), up)), C);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        s.first = false;
        s.mipped = false;
      }
      const wantMip = params.blur > 0;
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, s.cube);
      if (wantMip && !s.mipped) { gl.generateMipmap(gl.TEXTURE_CUBE_MAP); s.mipped = true; }
      if (wantMip !== s.mipFilter) { gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, wantMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); s.mipFilter = wantMip; }
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
      s.cam.update(input, dt);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const eye = s.cam.eye(), vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 80), s.cam.view());
      env(vp, eye);
      util.tex(0, s.cube, gl.TEXTURE_CUBE_MAP);
      const m = ['sphere', 'knot', 'torus'][params.shape];
      const M = m === 'sphere' ? TRS(C, [0, 0, 0], 1.0) : m === 'knot' ? TRS(C, [t * 0.3, t * 0.2, 0], 0.62) : TRS(C, [t * 0.4 + 1.1, t * 0.3, 0], 1.0);
      s.mirror.use().set({ u_vp: vp, u_m: M, u_eye: eye, u_env: 0, u_bias: params.blur });
      k.mesh(m).draw();
      gl.disable(gl.DEPTH_TEST);
      if (params.faces) {
        // unfolded cross:      +Y
        //                  −X  +Z  +X  −Z
        //                      −Y
        const fs = Math.round(Math.min(ctx.width * 0.075, ctx.height * 0.1)), x0 = ctx.width - fs * 4 - Math.round(16 * ctx.dpr), y0 = Math.round(72 * ctx.dpr);
        const pos = { 2: [1, 2], 1: [0, 1], 4: [1, 1], 0: [2, 1], 5: [3, 1], 3: [1, 0] };
        s.cross.use().set({ u_env: 0 });
        for (let f = 0; f < 6; f++) { gl.viewport(x0 + pos[f][0] * fs, y0 + pos[f][1] * fs, fs, fs); s.cross.set({ u_face: f }); util.drawFullscreen(); }
        gl.viewport(0, 0, ctx.width, ctx.height);
        s.lab.style.display = ''; s.lab.style.right = '24px'; s.lab.style.bottom = (y0 + fs * 3) / ctx.dpr + 8 + 'px';
      } else s.lab.style.display = 'none';
      util.tex(0, null, gl.TEXTURE_CUBE_MAP);
    },
  });
})();
