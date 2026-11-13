/* A · Pipeline & Geometry — primitive modes, point sprites, indexed drawing,
 * vertex attributes, streaming buffers, viewports + scissor, winding + culling. */
(function () {
  const S = window.Sandbox;
  const { M4, clamp, damp } = S.math;
  const G = S.GLSL;
  const CAT = 'Pipeline & Geometry';

  /* ---------------------------------------------------------------- */
  /* 1. Primitive modes                                                */
  /* ---------------------------------------------------------------- */
  const MODES = ['POINTS', 'LINES', 'LINE_STRIP', 'LINE_LOOP', 'TRIANGLES', 'TRIANGLE_STRIP', 'TRIANGLE_FAN'];
  S.register({
    id: 'primitives',
    title: 'Primitive Modes',
    category: CAT,
    thumb: 'wide',
    hint: 'drag a vertex · pick a mode',
    description: 'One array of twelve vertices drawn with each of the seven primitive modes WebGL 1.0 offers. The same data becomes dots, separate segments, a strip, a loop, separate triangles, a strip of triangles or a fan. Drag any vertex and watch every interpretation update at once; the mode you pick is drawn large.',
    interact: [['Drag', 'move the nearest vertex'], ['Mode', 'choose which interpretation is drawn large'], ['Line width', 'requests gl.lineWidth; most platforms clamp to 1']],
    features: ['gl.drawArrays(mode, first, count)', 'POINTS · LINES · LINE_STRIP · LINE_LOOP', 'TRIANGLES · TRIANGLE_STRIP · TRIANGLE_FAN', 'gl.lineWidth + ALIASED_LINE_WIDTH_RANGE', 'bufferSubData for edited vertices'],
    params: [
      { key: 'mode', label: 'Featured mode', type: 'select', options: ['Points', 'Lines', 'Strip', 'Loop', 'Tris', 'T-strip', 'Fan'], value: 5 },
      { key: 'lw', label: 'Line width (requested)', type: 'range', min: 1, max: 8, step: 1, value: 1 },
      { key: 'wobble', label: 'Idle motion', type: 'toggle', value: true },
    ],
    code: `// one buffer, seven readings
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 12);
gl.drawArrays(gl.LINE_LOOP, 0, 12);
gl.drawArrays(gl.POINTS, 0, 12);`,
    init(ctx) {
      const { gl, util } = ctx;
      const prog = util.program(`
attribute vec2 a_pos; attribute float a_idx;
uniform mat3 u_m; uniform float u_ps; uniform float u_n;
varying float v_t;
void main() { vec3 p = u_m * vec3(a_pos, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); gl_PointSize = u_ps; v_t = a_idx / u_n; }`, G.colors + `
uniform vec4 u_col; uniform float u_grad; uniform float u_round;
varying float v_t;
void main() {
  if (u_round > 0.5) { vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; }
  vec3 c = mix(u_col.rgb, mix(A1, A2, v_t), u_grad);
  gl_FragColor = vec4(c * u_col.a, u_col.a);
}`, { attribs: { a_idx: 3 } });
      const N = 12;
      const base = [];
      for (let i = 0; i < N; i++) { const col = i >> 1, top = i % 2 === 0; base.push([-0.8 + col * 0.32 + (top ? 0 : 0.08), top ? 0.45 : -0.45]); }
      const pts = base.map((p) => p.slice());
      const data = new Float32Array(N * 2);
      const buf = util.buffer(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      const idx = util.buffer(gl.ARRAY_BUFFER, new Float32Array([...Array(N).keys()]));
      const mesh = util.mesh([{ buffer: buf, loc: 0, size: 2 }, { buffer: idx, loc: 3, size: 1 }], null, { count: N });
      const lwr = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
      const labels = MODES.map((m) => { const el = document.createElement('div'); el.className = 'ov-label'; el.textContent = m; ctx.overlay.appendChild(el); return el; });
      const info = document.createElement('div'); info.className = 'ov-panel ov-tr';
      info.innerHTML = `ALIASED_LINE_WIDTH_RANGE <b>${lwr[0]}–${lwr[1]}</b>`;
      ctx.overlay.appendChild(info);
      return { prog, pts, base, data, buf, mesh, drag: -1, labels, N };
    },
    frame(ctx, s, t) {
      const { gl, input } = ctx;
      const W = ctx.width, H = ctx.height;
      // layout: featured panel left 60%, small multiples right 40% in a 2-column grid
      const bigW = Math.floor(W * 0.58);
      const cells = [];
      const cols = 2, rows = 4, cw = Math.floor((W - bigW) / cols), ch = Math.floor(H / rows);
      let k = 0;
      for (let m = 0; m < 7; m++) { if (m === ctx.params.mode) continue; cells.push({ m, x: bigW + (k % cols) * cw, y: H - ch * (1 + Math.floor(k / cols)), w: cw, h: ch }); k++; }
      const big = { m: ctx.params.mode, x: 0, y: 0, w: bigW, h: H };
      // pointer → featured panel space
      const px = input.x * ctx.dpr, py = H - input.y * ctx.dpr;
      const asp = big.w / big.h;
      const toLocal = (x, y) => [((x - big.x) / big.w * 2 - 1) * asp / 1.15, ((y - big.y) / big.h * 2 - 1) / 1.15];
      const [lx, ly] = toLocal(px, py);
      if (input.down && s.drag < 0 && px < bigW) {
        let best = 0.12, bi = -1;
        s.pts.forEach((p, i) => { const d = Math.hypot(p[0] - lx, p[1] - ly); if (d < best) { best = d; bi = i; } });
        s.drag = bi;
      }
      if (!input.down) s.drag = -1;
      if (s.drag >= 0) { s.pts[s.drag][0] = clamp(lx, -1.3, 1.3); s.pts[s.drag][1] = clamp(ly, -0.85, 0.85); s.base[s.drag] = s.pts[s.drag].slice(); }
      for (let i = 0; i < s.N; i++) {
        const w = ctx.params.wobble && i !== s.drag ? 0.025 : 0;
        s.data[i * 2] = s.base[i][0] + Math.sin(t * 1.3 + i * 1.7) * w;
        s.data[i * 2 + 1] = s.base[i][1] + Math.cos(t * 1.1 + i * 2.3) * w;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.SCISSOR_TEST);
      s.prog.use();
      const all = [big, ...cells];
      all.forEach((c, ci) => {
        gl.viewport(c.x, c.y, c.w, c.h); gl.scissor(c.x, c.y, c.w, c.h);
        gl.clearColor(ci ? 0.04 : 0.03, ci ? 0.043 : 0.034, ci ? 0.055 : 0.048, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        const a = c.w / c.h, sc = 1 / 1.15;
        const m = new Float32Array([sc / a, 0, 0, 0, sc, 0, 0, 0, 1]);
        const mode = gl[MODES[c.m]];
        const isTri = c.m >= 4, isLine = c.m >= 1 && c.m <= 3;
        gl.lineWidth(ci === 0 ? ctx.params.lw : 1);
        if (isTri) {
          s.prog.set({ u_m: m, u_col: [1, 1, 1, 0.55], u_grad: 1, u_round: 0, u_n: s.N - 1 });
          s.mesh.draw(mode);
          s.prog.set({ u_col: [0.93, 0.91, 0.88, 0.35], u_grad: 0 });
          // outline each triangle so the decomposition is visible
          s.mesh.draw(gl.LINE_STRIP);
        } else if (isLine) {
          s.prog.set({ u_m: m, u_col: [1, 1, 1, 1], u_grad: 1, u_round: 0, u_n: s.N - 1 });
          s.mesh.draw(mode);
        }
        s.prog.set({ u_m: m, u_col: [0.93, 0.91, 0.88, 1], u_grad: c.m === 0 ? 1 : 0, u_round: 1, u_ps: (c.m === 0 ? 16 : 7) * ctx.dpr * (ci ? 0.7 : 1), u_n: s.N - 1 });
        s.mesh.draw(gl.POINTS);
        const L = s.labels[c.m];
        L.style.left = c.x / ctx.dpr + 12 + 'px'; L.style.top = (H - c.y - c.h) / ctx.dpr + (c.y + c.h >= H - 1 ? 50 : 12) + 'px';
        L.style.color = ci === 0 ? 'var(--acc1)' : '';
        L.style.fontSize = ci === 0 ? '13px' : '';
      });
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
      ctx.canvas.style.cursor = s.drag >= 0 ? 'grabbing' : 'grab';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Point sprites                                                  */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'point-sprites',
    title: 'Point Sprites',
    category: CAT,
    thumb: 'tall',
    hint: 'move to swell · click to scatter',
    description: 'Sixty thousand vertices drawn as POINTS. The vertex shader writes gl_PointSize from the distance to the pointer, and the fragment shader shapes each square sprite with gl_PointCoord into discs, rings, stars or soft glows. Points are the cheapest particles WebGL 1.0 has: one vertex each, no geometry shader needed.',
    interact: [['Move', 'points near the pointer grow'], ['Click', 'send a scatter pulse'], ['Shape', 'gl_PointCoord decides the sprite shape']],
    features: ['gl_PointSize (vertex shader)', 'gl_PointCoord (fragment shader)', 'ALIASED_POINT_SIZE_RANGE', 'screen blending ONE, ONE_MINUS_SRC_COLOR', 'discard for shaped sprites'],
    params: [
      { key: 'shape', label: 'Sprite shape', type: 'select', options: ['Disc', 'Ring', 'Star', 'Glow', 'Square'], value: 3 },
      { key: 'size', label: 'Base size', type: 'range', min: 1, max: 12, step: 0.5, value: 3 },
      { key: 'swell', label: 'Swell near pointer', type: 'range', min: 0, max: 60, step: 1, value: 16 },
    ],
    code: `// vertex
gl_PointSize = u_size + u_swell * exp(-d * d * 18.0);
// fragment
vec2 q = gl_PointCoord * 2.0 - 1.0;
float r = length(q);
if (r > 1.0) discard;`,
    init(ctx) {
      const { gl, util } = ctx;
      const N = 60000;
      const seed = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); seed[i * 3] = Math.cos(a) * r; seed[i * 3 + 1] = Math.sin(a) * r; seed[i * 3 + 2] = Math.random(); }
      const prog = util.program(`
attribute vec3 a_pos;
uniform vec2 u_m; uniform float u_t; uniform float u_size; uniform float u_swell; uniform float u_asp; uniform float u_dpr; uniform vec3 u_pulse; uniform float u_max;
varying float v_k; varying float v_near;
void main() {
  float a = atan(a_pos.y, a_pos.x), r = length(a_pos.xy);
  a += u_t * (0.05 + 0.25 * (1.0 - r)) + sin(u_t * 0.7 + a_pos.z * 6.28) * 0.02;
  vec2 p = vec2(cos(a), sin(a)) * r * vec2(1.0, 1.0) * 0.92;
  float age = u_t - u_pulse.z;
  vec2 dp = p - u_pulse.xy;
  float ring = exp(-pow((length(dp) - age * 0.9) * 9.0, 2.0)) * exp(-age * 1.4);
  p += normalize(dp + 1e-4) * ring * 0.09;
  vec2 sp = vec2(p.x / u_asp, p.y);
  float d = length(p - u_m);
  v_near = exp(-d * d * 18.0);
  v_k = a_pos.z;
  gl_Position = vec4(sp, 0.0, 1.0);
  gl_PointSize = min(u_max, (u_size + u_swell * v_near + ring * 18.0) * u_dpr);
}`, G.colors + `
uniform int u_shape;
varying float v_k; varying float v_near;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q), a = 0.0;
  if (u_shape == 0) { if (r > 1.0) discard; a = 1.0 - smoothstep(0.8, 1.0, r); }
  else if (u_shape == 1) { a = smoothstep(0.55, 0.7, r) * (1.0 - smoothstep(0.85, 1.0, r)); if (a <= 0.0) discard; }
  else if (u_shape == 2) { float th = atan(q.y, q.x); float st = 0.45 + 0.4 * cos(th * 5.0); if (r > st) discard; a = 1.0 - smoothstep(st - 0.1, st, r); }
  else if (u_shape == 3) { a = exp(-r * r * 4.0); }
  else { a = 1.0; }
  vec3 c = mix(A1, A2, v_k) * (0.35 + 0.9 * v_near) + BONE * v_near * 0.35;
  gl_FragColor = vec4(c * a * mix(0.6, 0.16, v_near), 0.0);
}`);
      const mesh = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, seed), loc: 0, size: 3 }], null, { count: N });
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      const info = document.createElement('div'); info.className = 'ov-panel ov-tr';
      info.innerHTML = `ALIASED_POINT_SIZE_RANGE <b>${range[0]}–${range[1]}</b><br>${N.toLocaleString()} vertices, 1 draw call`;
      ctx.overlay.appendChild(info);
      return { prog, mesh, m: [0, 0], pulse: [0, 0, -9], range };
    },
    frame(ctx, s, t, dt) {
      const { gl, input } = ctx;
      const asp = ctx.width / ctx.height;
      const tx = input.hover || ctx.capture ? input.nx * asp : Math.cos(t * 0.5) * 0.4, ty = input.hover || ctx.capture ? input.ny : Math.sin(t * 0.7) * 0.3;
      const k = damp(8, dt);
      s.m[0] += ((ctx.capture ? 0.15 : tx) - s.m[0]) * k; s.m[1] += ((ctx.capture ? 0.1 : ty) - s.m[1]) * k;
      for (const c of input.clicks) s.pulse = [c.nx * asp, c.ny, t];
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.02, 0.022, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      // screen-style blend: ONE, ONE_MINUS_SRC_COLOR saturates softly instead of clipping to white
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      s.prog.use().set({ u_m: s.m, u_t: t, u_size: ctx.params.size, u_swell: ctx.params.swell, u_asp: asp, u_dpr: ctx.dpr, u_pulse: s.pulse, u_shape: ctx.params.shape, u_max: s.range[1] });
      s.mesh.draw(gl.POINTS);
      gl.disable(gl.BLEND);
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Indexed drawing                                                */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'indexed',
    title: 'Indexed Drawing',
    category: CAT,
    thumb: 'square',
    hint: 'drag to orbit · move to ripple',
    description: 'A height-field grid drawn with drawElements. Shared vertices are stored once and referenced by an index buffer, so a 256 × 256 grid needs 66,049 vertices instead of 393,216. Above 65,535 vertices a 16-bit index cannot reach, so the large grid needs OES_element_index_uint and UNSIGNED_INT indices. A second index buffer reuses the same vertices as a wireframe with gl.LINES.',
    interact: [['Drag', 'orbit'], ['Hover', 'the ripple follows the pointer on the surface plane'], ['Index type', 'UNSIGNED_BYTE, UNSIGNED_SHORT or UNSIGNED_INT']],
    features: ['gl.drawElements(mode, count, type, offset)', 'ELEMENT_ARRAY_BUFFER', 'UNSIGNED_BYTE · UNSIGNED_SHORT', 'OES_element_index_uint → UNSIGNED_INT', 'shared vertices, two index buffers'],
    params: [
      { key: 'type', label: 'Index type', type: 'select', options: ['BYTE (15²)', 'SHORT (180²)', 'INT (256²)'], value: 1, restart: true },
      { key: 'wire', label: 'Wireframe (LINES)', type: 'toggle', value: true },
      { key: 'solid', label: 'Solid (TRIANGLES)', type: 'toggle', value: true },
    ],
    code: `const ext = gl.getExtension('OES_element_index_uint');
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);`,
    init(ctx) {
      const { gl, util } = ctx;
      const t = ctx.params.type;
      if (t === 2 && !util.ext('OES_element_index_uint')) { ctx.message('OES_element_index_uint is not supported here.\nPick BYTE or SHORT.'); }
      const n = t === 0 ? 15 : t === 1 ? 180 : util.ext('OES_element_index_uint') ? 256 : 180;
      const vc = (n + 1) * (n + 1);
      const pos = new Float32Array(vc * 2);
      for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++, k++) { pos[k * 2] = i / n * 2 - 1; pos[k * 2 + 1] = j / n * 2 - 1; }
      const Arr = n === 15 ? Uint8Array : vc > 65535 ? Uint32Array : Uint16Array;
      const itype = n === 15 ? gl.UNSIGNED_BYTE : vc > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      const tri = new Arr(n * n * 6), lin = new Arr(n * (n + 1) * 4);
      let a = 0, b = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = j * (n + 1) + i; tri.set([v, v + 1, v + n + 1, v + 1, v + n + 2, v + n + 1], a); a += 6; }
      for (let j = 0; j <= n; j++) for (let i = 0; i < n; i++) { const v = j * (n + 1) + i; lin.set([v, v + 1], b); b += 2; const u = i * (n + 1) + j; lin.set([u, u + n + 1], b); b += 2; }
      const vb = util.buffer(gl.ARRAY_BUFFER, pos);
      const solid = util.mesh([{ buffer: vb, loc: 0, size: 2 }], util.buffer(gl.ELEMENT_ARRAY_BUFFER, tri), { count: tri.length, indexType: itype });
      const wire = util.mesh([{ buffer: vb, loc: 0, size: 2 }], util.buffer(gl.ELEMENT_ARRAY_BUFFER, lin), { count: b, indexType: itype });
      const prog = util.program(`
attribute vec2 a_pos;
uniform mat4 u_vp; uniform float u_t; uniform vec2 u_hit; uniform float u_lift;
varying float v_h; varying vec3 v_p;
float H(vec2 p) {
  float d = length(p - u_hit);
  return 0.18 * sin(d * 14.0 - u_t * 4.0) * exp(-d * 2.2) + 0.06 * sin(p.x * 3.0 + u_t) * cos(p.y * 2.0 - u_t * 0.7);
}
void main() { float h = H(a_pos); v_h = h; vec3 p = vec3(a_pos.x, h + u_lift, a_pos.y); v_p = p; gl_Position = u_vp * vec4(p, 1.0); }`, '#extension GL_OES_standard_derivatives : enable\n' + G.colors + `
uniform vec4 u_col; uniform float u_shade;
varying float v_h; varying vec3 v_p;
void main() {
  vec3 c = u_col.rgb;
  if (u_shade > 0.5) {
    vec3 n = normalize(cross(dFdx(v_p), dFdy(v_p)));
    float l = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 1.0, 0.3))), 0.0);
    c = mix(INK * 2.0, mix(A1, A2, clamp(v_h * 3.0 + 0.5, 0.0, 1.0)), 0.55) * l;
  }
  gl_FragColor = vec4(c * u_col.a, u_col.a);
}`);
      const info = document.createElement('div'); info.className = 'ov-panel ov-tr';
      const bytes = tri.byteLength + pos.byteLength;
      info.innerHTML = `grid <b>${n} × ${n}</b><br>vertices <b>${vc.toLocaleString()}</b><br>triangle indices <b>${tri.length.toLocaleString()}</b><br>type <b>${['UNSIGNED_BYTE', 'UNSIGNED_SHORT', 'UNSIGNED_INT'][Arr === Uint8Array ? 0 : Arr === Uint16Array ? 1 : 2]}</b><br>vs unindexed <b>${((n * n * 6 * 8) / bytes).toFixed(1)}×</b> smaller`;
      ctx.overlay.appendChild(info);
      return { prog, solid, wire, cam: new S.OrbitCam({ dist: 3.2, pitch: 0.7, yaw: 0.5, auto: 0.06 }), hit: [0, 0] };
    },
    frame(ctx, s, t, dt) {
      const { gl, input } = ctx;
      s.cam.update(input, dt, false);
      const vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view());
      if (input.hover && !input.down) {
        const r = s.cam.ray(input.nx, input.ny, ctx.aspect);
        const hp = S.math.Ray.plane(r.origin, r.dir, [0, 0, 0], [0, 1, 0]);
        if (hp) { s.hit[0] += (clamp(hp[0], -1, 1) - s.hit[0]) * damp(6, dt); s.hit[1] += (clamp(hp[2], -1, 1) - s.hit[1]) * damp(6, dt); }
      }
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_t: t, u_hit: s.hit });
      if (ctx.params.solid) { s.prog.set({ u_col: [1, 1, 1, 1], u_shade: 1, u_lift: 0 }); s.solid.draw(gl.TRIANGLES); }
      if (ctx.params.wire) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        s.prog.set({ u_col: [0.22, 0.84, 0.91, ctx.params.solid ? 0.35 : 0.8], u_shade: 0, u_lift: 0.002 });
        s.wire.draw(gl.LINES);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.disable(gl.DEPTH_TEST);
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Vertex attributes                                              */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'attributes',
    title: 'Vertex Attributes',
    category: CAT,
    thumb: 'portrait',
    hint: 'hover to tint · switch layouts',
    description: 'The same triangles fed three ways. Interleaved puts position, colour and size side by side in one buffer with a stride; separate uses one buffer per attribute; packed stores colours as four normalized UNSIGNED_BYTEs, a quarter of the memory. Turn the colour array off and the attribute falls back to its constant value, set with gl.vertexAttrib4f. Here that colour follows the pointer.',
    interact: [['Layout', 'interleaved, separate, or packed bytes'], ['Colour array', 'off = constant attribute from vertexAttrib4f'], ['Move', 'drives the constant colour']],
    features: ['vertexAttribPointer(loc, size, type, normalized, stride, offset)', 'interleaved stride / offset', 'UNSIGNED_BYTE normalized = true', 'disableVertexAttribArray + vertexAttrib4f', 'bindAttribLocation before link'],
    params: [
      { key: 'layout', label: 'Buffer layout', type: 'select', options: ['Interleaved', 'Separate', 'Packed bytes'], value: 0 },
      { key: 'colors', label: 'Colour array enabled', type: 'toggle', value: true },
    ],
    code: `// interleaved: [x y z | r g b a(byte) | size]
const STRIDE = 20;
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE, 12);
gl.vertexAttribPointer(4, 1, gl.FLOAT, false, STRIDE, 16);
// array off → constant value
gl.disableVertexAttribArray(3);
gl.vertexAttrib4f(3, r, g, b, 1);`,
    init(ctx) {
      const { gl, util } = ctx;
      const N = 900; // triangles
      const V = N * 3;
      const pos = new Float32Array(V * 3), colF = new Float32Array(V * 4), colB = new Uint8Array(V * 4), size = new Float32Array(V);
      const inter = new ArrayBuffer(V * 20), fv = new Float32Array(inter), bv = new Uint8Array(inter);
      for (let i = 0; i < N; i++) {
        const cx = (Math.random() * 2 - 1) * 1.6, cy = Math.random() * 2 - 1, r = 0.03 + Math.random() * 0.07, a0 = Math.random() * 6.28;
        const k = Math.random(), c = [S.A1[0] + (S.A2[0] - S.A1[0]) * k, S.A1[1] + (S.A2[1] - S.A1[1]) * k, S.A1[2] + (S.A2[2] - S.A1[2]) * k];
        for (let v = 0; v < 3; v++) {
          const j = i * 3 + v, a = a0 + v * 2.094;
          const p = [cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.random()];
          pos.set(p, j * 3); colF.set([...c, 1], j * 4); colB.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], j * 4); size[j] = 0.5 + Math.random();
          fv.set(p, j * 5); bv.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], j * 20 + 12); fv[j * 5 + 4] = size[j];
        }
      }
      const B = gl.ARRAY_BUFFER;
      const bInter = util.buffer(B, inter), bPos = util.buffer(B, pos), bColF = util.buffer(B, colF), bColB = util.buffer(B, colB), bSize = util.buffer(B, size);
      const layouts = [
        [{ buffer: bInter, loc: 0, size: 3, stride: 20, offset: 0 }, { buffer: bInter, loc: 3, size: 4, type: gl.UNSIGNED_BYTE, normalized: true, stride: 20, offset: 12 }, { buffer: bInter, loc: 4, size: 1, stride: 20, offset: 16 }],
        [{ buffer: bPos, loc: 0, size: 3 }, { buffer: bColF, loc: 3, size: 4 }, { buffer: bSize, loc: 4, size: 1 }],
        [{ buffer: bPos, loc: 0, size: 3 }, { buffer: bColB, loc: 3, size: 4, type: gl.UNSIGNED_BYTE, normalized: true }, { buffer: bSize, loc: 4, size: 1 }],
      ];
      const bytes = [V * 20, V * (12 + 16 + 4), V * (12 + 4 + 4)];
      const prog = util.program(`
attribute vec3 a_pos; attribute vec4 a_col; attribute float a_i0;
uniform float u_asp; uniform float u_t; uniform vec2 u_m;
varying vec4 v_col;
void main() {
  vec2 p = a_pos.xy;
  vec2 d = p - u_m; float f = exp(-dot(d, d) * 6.0);
  p += normalize(d + 1e-4) * f * 0.12 * a_i0;
  p.y += sin(u_t * 0.8 + a_pos.z * 6.28) * 0.01;
  v_col = a_col * (0.55 + 0.9 * f);
  gl_Position = vec4(p.x / u_asp, p.y, 0.0, 1.0);
}`, `varying vec4 v_col; void main() { gl_FragColor = v_col; }`);
      const info = document.createElement('div'); info.className = 'ov-panel ov-tr';
      ctx.overlay.appendChild(info);
      return { prog, layouts, bytes, info, V, m: [0, 0], col: [1, 1, 1] };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const asp = ctx.aspect;
      const tx = input.hover ? input.nx * asp : Math.sin(t * 0.4) * 0.8, ty = input.hover ? input.ny : Math.cos(t * 0.53) * 0.5;
      s.m[0] += (tx - s.m[0]) * damp(6, dt); s.m[1] += (ty - s.m[1]) * damp(6, dt);
      const h = (s.m[0] / asp * 0.5 + 0.5);
      s.col = [S.A1[0] + (S.A2[0] - S.A1[0]) * h, S.A1[1] + (S.A2[1] - S.A1[1]) * h, S.A1[2] + (S.A2[2] - S.A1[2]) * h];
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      s.prog.use().set({ u_asp: asp, u_t: t, u_m: s.m });
      const L = s.layouts[params.layout];
      ctx.util.bindAttribs(params.colors ? L : L.filter((a) => a.loc !== 3));
      if (!params.colors) gl.vertexAttrib4f(3, s.col[0], s.col[1], s.col[2], 1);
      gl.drawArrays(gl.TRIANGLES, 0, s.V);
      const name = ['interleaved, 1 buffer, stride 20', 'separate, 3 buffers, float colour', 'separate, 3 buffers, byte colour'][params.layout];
      s.info.innerHTML = `<b>${name}</b><br>${s.bytes[params.layout].toLocaleString()} bytes for ${s.V.toLocaleString()} vertices<br>a_col: ${params.colors ? '<span class="on">array</span>' : `<span class="off">constant</span> vertexAttrib4f(${s.col.map((v) => v.toFixed(2)).join(', ')}, 1)`}`;
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Streaming buffers                                              */
  /* ---------------------------------------------------------------- */
  const USAGES = ['STATIC_DRAW', 'DYNAMIC_DRAW', 'STREAM_DRAW'];
  S.register({
    id: 'streaming',
    title: 'Streaming Buffers',
    category: CAT,
    thumb: 'wide',
    hint: 'draw a ribbon with the pointer',
    description: 'Ribbons simulated on the CPU and re-uploaded every frame. bufferData reallocates storage each frame; bufferSubData writes into storage that already exists. The usage hint (STATIC, DYNAMIC or STREAM) tells the driver how often the data will change. Each trail is a TRIANGLE_STRIP whose points ease after the one ahead, chasing the pointer.',
    interact: [['Move', 'the ribbon head follows'], ['Upload', 'bufferData each frame or bufferSubData into existing storage'], ['Usage', 'the hint given at allocation']],
    features: ['gl.bufferData(target, data, usage)', 'gl.bufferSubData(target, offset, data)', 'STATIC_DRAW · DYNAMIC_DRAW · STREAM_DRAW', 'CPU follow-the-leader simulation per frame', 'TRIANGLE_STRIP ribbon'],
    params: [
      { key: 'upload', label: 'Upload method', type: 'select', options: ['bufferSubData', 'bufferData'], value: 0 },
      { key: 'usage', label: 'Usage hint', type: 'select', options: ['STATIC', 'DYNAMIC', 'STREAM'], value: 1, restart: true },
      { key: 'ribbons', label: 'Ribbons', type: 'range', min: 1, max: 24, step: 1, value: 12, restart: true },
      { key: 'len', label: 'Segments each', type: 'range', min: 20, max: 400, step: 10, value: 160, restart: true },
    ],
    code: `// allocate once
gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
// every frame: overwrite in place
gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);`,
    init(ctx) {
      const { gl, util, params } = ctx;
      const R = params.ribbons, L = params.len;
      const usage = gl[USAGES[params.usage]];
      const ribs = [];
      for (let r = 0; r < R; r++) {
        const pts = new Float32Array(L * 2), vel = new Float32Array(L * 2);
        const verts = new Float32Array(L * 2 * 4); // x, y, side, t
        ribs.push({ pts, vel, verts, buf: util.buffer(gl.ARRAY_BUFFER, verts.byteLength, usage), k: r / Math.max(1, R - 1), phase: Math.random() * 6.28 });
      }
      const prog = util.program(`
attribute vec4 a_pos;
uniform float u_asp;
varying float v_t; varying float v_s;
void main() { v_t = a_pos.w; v_s = a_pos.z; gl_Position = vec4(a_pos.x / u_asp, a_pos.y, 0.0, 1.0); }`, G.colors + `
uniform float u_k;
varying float v_t; varying float v_s;
void main() {
  float a = (1.0 - v_t) * (1.0 - abs(v_s));
  vec3 c = mix(A1, A2, u_k) * (0.4 + 0.8 * (1.0 - v_t)) + BONE * pow(1.0 - v_t, 8.0) * 0.6;
  gl_FragColor = vec4(c * a, a);
}`);
      const info = document.createElement('div'); info.className = 'ov-panel ov-tr';
      ctx.overlay.appendChild(info);
      return { prog, ribs, L, R, usage, info, head: [0, 0], bytes: 0, ms: 0 };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const asp = ctx.aspect;
      const target = input.hover ? [input.nx * asp, input.ny] : [Math.sin(t * 0.9) * 0.62 * asp, Math.sin(t * 1.7) * 0.5];
      s.head[0] += (target[0] - s.head[0]) * damp(10, dt); s.head[1] += (target[1] - s.head[1]) * damp(10, dt);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.024, 0.027, 0.035, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.prog.use().set({ u_asp: asp });
      const t0 = performance.now();
      let bytes = 0;
      const w = 0.035;
      for (const r of s.ribs) {
        const { pts, vel, verts } = r, L = s.L;
        // follow-the-leader chain: each point eases toward the one ahead, giving smooth trailing curves
        const rad = 0.05 + 0.16 * r.k, ang = r.phase + t * (1.2 + r.k);
        pts[0] = s.head[0] + Math.cos(ang) * rad; pts[1] = s.head[1] + Math.sin(ang) * rad;
        const steps = 4, rate = 1 - Math.exp(-(70 - r.k * 30) * dt / steps);
        for (let st = 0; st < steps; st++) for (let i = 1; i < L; i++) {
          pts[i * 2] += (pts[(i - 1) * 2] - pts[i * 2]) * rate;
          pts[i * 2 + 1] += (pts[(i - 1) * 2 + 1] - pts[i * 2 + 1]) * rate - vel[i * 2 + 1] * 0;
        }
        for (let i = 0; i < L; i++) {
          const a = Math.max(0, i - 1), b = Math.min(L - 1, i + 1);
          let tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1];
          const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
          const ww = w * (1 - i / L) * (0.6 + r.k * 0.6);
          const u = i / (L - 1);
          verts.set([pts[i * 2] - ty * ww, pts[i * 2 + 1] + tx * ww, -1, u, pts[i * 2] + ty * ww, pts[i * 2 + 1] - tx * ww, 1, u], i * 8);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, r.buf);
        if (params.upload === 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        else gl.bufferData(gl.ARRAY_BUFFER, verts, s.usage);
        bytes += verts.byteLength;
        ctx.util.bindAttribs([{ buffer: r.buf, loc: 0, size: 4 }]);
        s.prog.set({ u_k: r.k });
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, L * 2);
      }
      s.ms += (performance.now() - t0 - s.ms) * 0.05;
      gl.disable(gl.BLEND);
      if (Math.floor(t * 4) !== s.tick) { s.tick = Math.floor(t * 4); s.info.innerHTML = `${params.upload ? 'bufferData' : 'bufferSubData'} · ${USAGES[params.usage]}<br><b>${(bytes / 1024).toFixed(1)} KB</b> per frame<br><b>${(bytes * 60 / 1048576).toFixed(2)} MB/s</b> at 60 fps<br>CPU sim + upload <b>${s.ms.toFixed(2)} ms</b>`; }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 6. Viewport & scissor                                             */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'viewport-scissor',
    title: 'Viewport & Scissor',
    category: CAT,
    thumb: 'square',
    hint: 'drag the split · hover for the scissor lens',
    description: 'One scene, four cameras, one canvas. gl.viewport maps clip space onto a sub-rectangle for each view: top, front, side and perspective. gl.scissor clips clears and draws to a rectangle, used here twice: to keep each view inside its quadrant, and as a lens around the pointer that redraws the scene in X-ray.',
    interact: [['Drag', 'move the split point between the four views'], ['Hover', 'the scissor lens follows the pointer'], ['Lens size', 'size of the scissor rectangle']],
    features: ['gl.viewport(x, y, w, h)', 'gl.scissor + SCISSOR_TEST', 'scissored gl.clear', 'orthographic + perspective views', 'MAX_VIEWPORT_DIMS'],
    params: [
      { key: 'lens', label: 'Lens size', type: 'range', min: 0, max: 400, step: 10, value: 180 },
      { key: 'ortho', label: 'Orthographic side views', type: 'toggle', value: true },
    ],
    code: `gl.enable(gl.SCISSOR_TEST);
for (const v of views) {
  gl.viewport(v.x, v.y, v.w, v.h);
  gl.scissor(v.x, v.y, v.w, v.h);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  draw(v.viewProj);
}`,
    init(ctx) {
      const { gl, util } = ctx;
      const knot = S.geo.upload(util, S.geo.torusKnot(260, 28, 0.22, 1.0, 0.45));
      const cube = S.geo.uploadFlat(util, S.geo.cube());
      const prog = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_m;
varying vec3 v_n; varying vec3 v_w;
void main() { vec4 w = u_m * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_m) * a_nrm; gl_Position = u_vp * w; }`, G.colors + `
uniform vec3 u_col; uniform float u_xray;
varying vec3 v_n; varying vec3 v_w;
void main() {
  vec3 n = normalize(v_n);
  float l = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.5, 0.9, 0.4))), 0.0);
  vec3 c = u_col * l;
  if (u_xray > 0.5) { float f = pow(1.0 - abs(n.z), 2.0); c = mix(A1, A2, f) * (0.2 + f) ; }
  gl_FragColor = vec4(c, 1.0);
}`);
      const views = ['TOP', 'FRONT', 'SIDE', 'PERSPECTIVE'].map((n) => { const el = document.createElement('div'); el.className = 'ov-label'; el.textContent = n; ctx.overlay.appendChild(el); return el; });
      return { prog, knot, cube, split: [0.5, 0.5], views, cam: new S.OrbitCam({ dist: 5, auto: 0.2 }) };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const W = ctx.width, H = ctx.height;
      if (input.down) { s.split[0] = clamp(input.uvx, 0.2, 0.8); s.split[1] = clamp(input.uvy, 0.2, 0.8); }
      const sx = Math.round(W * s.split[0]), sy = Math.round(H * s.split[1]);
      const vs = [
        { x: 0, y: sy, w: sx, h: H - sy, eye: [0, 6, 0.001] },
        { x: sx, y: sy, w: W - sx, h: H - sy, eye: [0, 0, 6] },
        { x: 0, y: 0, w: sx, h: sy, eye: [6, 0, 0] },
        { x: sx, y: 0, w: W - sx, h: sy, persp: true },
      ];
      s.cam.update({ ...input, dragging: false, wheel: 0, pinch: 1 }, dt);
      gl.enable(gl.SCISSOR_TEST); gl.enable(gl.DEPTH_TEST);
      const scene = (vp, xray) => {
        s.prog.use().set({ u_vp: vp, u_xray: xray ? 1 : 0 });
        s.prog.set({ u_m: M4.mul(M4.rotY(t * 0.4), M4.rotX(t * 0.25)), u_col: S.A1 }); s.knot.draw();
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2 + t * 0.3;
          s.prog.set({ u_m: M4.mul(M4.translate(Math.cos(a) * 2.1, Math.sin(a * 2 + t) * 0.4, Math.sin(a) * 2.1), M4.mul(M4.rotY(t + i), M4.scale(0.4))), u_col: i % 2 ? S.A2 : [0.93, 0.91, 0.88] });
          s.cube.draw();
        }
      };
      vs.forEach((v, i) => {
        if (v.w < 2 || v.h < 2) return;
        gl.viewport(v.x, v.y, v.w, v.h); gl.scissor(v.x, v.y, v.w, v.h);
        const g = 0.03 + (i % 2) * 0.008;
        gl.clearColor(g, g + 0.004, g + 0.014, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const a = v.w / v.h;
        let vp;
        if (v.persp || !params.ortho) vp = M4.mul(M4.persp(0.8, a, 0.1, 50), v.persp ? s.cam.view() : M4.lookAt(v.eye, [0, 0, 0], i === 0 ? [0, 0, -1] : [0, 1, 0]));
        else vp = M4.mul(M4.ortho(-3 * a, 3 * a, -3, 3, 0.1, 50), M4.lookAt(v.eye, [0, 0, 0], i === 0 ? [0, 0, -1] : [0, 1, 0]));
        v.vp = vp;
        scene(vp, false);
        const L = s.views[i]; L.style.left = v.x / ctx.dpr + 12 + 'px'; L.style.top = (H - v.y - v.h) / ctx.dpr + (v.y + v.h >= H - 1 ? 50 : 12) + 'px';
      });
      // scissor lens: redraw whichever view sits under the pointer, inside a rectangle around it
      const ls = params.lens * ctx.dpr;
      if (ls > 0 && (input.hover || ctx.capture) && !input.down) {
        const px = ctx.capture ? W * 0.72 : input.x * ctx.dpr, py = ctx.capture ? H * 0.3 : H - input.y * ctx.dpr;
        const v = vs.find((q) => px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h);
        if (v && v.vp) {
          const x0 = Math.max(v.x, px - ls / 2), y0 = Math.max(v.y, py - ls / 2), x1 = Math.min(v.x + v.w, px + ls / 2), y1 = Math.min(v.y + v.h, py + ls / 2);
          if (x1 > x0 && y1 > y0) {
            gl.viewport(v.x, v.y, v.w, v.h); gl.scissor(x0, y0, x1 - x0, y1 - y0);
            gl.clearColor(0.01, 0.01, 0.015, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            scene(v.vp, true);
            // frame the lens with four thin scissored clears
            gl.clearColor(0.22, 0.84, 0.91, 1);
            const b = Math.max(1, ctx.dpr);
            [[x0, y0, x1 - x0, b], [x0, y1 - b, x1 - x0, b], [x0, y0, b, y1 - y0], [x1 - b, y0, b, y1 - y0]].forEach((r) => { gl.scissor(r[0], r[1], r[2], r[3]); gl.clear(gl.COLOR_BUFFER_BIT); });
          }
        }
      }
      // split cross-hair, also drawn with scissored clears
      gl.clearColor(0.93, 0.91, 0.88, 0.25);
      gl.scissor(sx, 0, Math.max(1, ctx.dpr), H); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.scissor(0, sy, W, Math.max(1, ctx.dpr)); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 7. Winding & culling                                              */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'winding-culling',
    title: 'Winding & Culling',
    category: CAT,
    thumb: 'tall',
    hint: 'drag to orbit · open the shell',
    description: 'Every triangle has a winding: its vertices go clockwise or counter-clockwise on screen. gl.frontFace decides which winding counts as the front, and gl.cullFace with CULL_FACE discards the front, the back or both before rasterisation. The fragment shader reads gl_FrontFacing to colour front faces cyan and back faces magenta. Open the shell to see inside.',
    interact: [['Drag', 'orbit'], ['Opening', 'cut the shell to expose back faces'], ['Cull / front face', 'change what gets discarded']],
    features: ['gl.enable(gl.CULL_FACE)', 'gl.cullFace(BACK | FRONT | FRONT_AND_BACK)', 'gl.frontFace(CCW | CW)', 'gl_FrontFacing', 'discard to cut geometry'],
    params: [
      { key: 'cull', label: 'Cull', type: 'select', options: ['Off', 'BACK', 'FRONT', 'BOTH'], value: 0 },
      { key: 'front', label: 'Front face', type: 'select', options: ['CCW', 'CW'], value: 0 },
      { key: 'open', label: 'Opening', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45 },
    ],
    code: `gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.frontFace(gl.CCW);
// fragment shader
vec3 c = gl_FrontFacing ? FRONT : BACK;`,
    init(ctx) {
      const { util } = ctx;
      // S.geo.sphere winds inward; reverse u so the outside is counter-clockwise (front-facing)
      const shell = S.geo.upload(util, S.geo.surface(72, 36, (u, v) => { const a = -u * Math.PI * 2, b = v * Math.PI; const d = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; return { p: d, n: d }; }));
      const tor = S.geo.upload(util, S.geo.torus(96, 24, 1.55, 0.12));
      const prog = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm; attribute vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_m;
varying vec3 v_n; varying vec3 v_o; varying vec2 v_uv;
void main() { v_o = a_pos; v_uv = a_uv; v_n = mat3(u_m) * a_nrm; gl_Position = u_vp * u_m * vec4(a_pos, 1.0); }`, G.colors + `
uniform float u_open; uniform float u_t; uniform float u_cut;
varying vec3 v_n; varying vec3 v_o; varying vec2 v_uv;
void main() {
  if (u_cut > 0.5) {
    float band = sin(v_uv.x * 6.2832 * 6.0 + u_t) * 0.5 + 0.5;
    if (v_o.y > 1.0 - u_open * 2.0 + band * 0.12 * u_open) discard;
  }
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  float l = 0.25 + 0.75 * max(dot(n, normalize(vec3(0.3, 1.0, 0.5))), 0.0);
  vec3 c = gl_FrontFacing ? A1 : A2;
  float grid = step(0.96, fract(v_uv.x * 36.0)) + step(0.94, fract(v_uv.y * 18.0));
  c = c * l + grid * 0.12;
  gl_FragColor = vec4(c, 1.0);
}`);
      const info = document.createElement('div'); info.className = 'ov-panel ov-tr'; ctx.overlay.appendChild(info);
      return { prog, shell, tor, info, cam: new S.OrbitCam({ dist: 4.2, pitch: 0.5, auto: 0.15 }) };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      if (params.cull) { gl.enable(gl.CULL_FACE); gl.cullFace([0, gl.BACK, gl.FRONT, gl.FRONT_AND_BACK][params.cull]); } else gl.disable(gl.CULL_FACE);
      gl.frontFace(params.front ? gl.CW : gl.CCW);
      const vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view());
      s.prog.use().set({ u_vp: vp, u_open: params.open, u_t: t, u_m: M4.ident(), u_cut: 1 });
      s.shell.draw();
      s.prog.set({ u_m: M4.mul(M4.rotX(0.9 + Math.sin(t * 0.5) * 0.2), M4.rotZ(t * 0.3)), u_cut: 0 });
      s.tor.draw();
      gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST); gl.frontFace(gl.CCW);
      s.info.innerHTML = `CULL_FACE <b>${params.cull ? 'on · ' + ['', 'BACK', 'FRONT', 'FRONT_AND_BACK'][params.cull] : 'off'}</b><br>frontFace <b>${params.front ? 'CW' : 'CCW'}</b><br><span class="on">■</span> front-facing &nbsp; <span class="off">■</span> back-facing`;
    },
  });
})();
