/* F · Extensions & Performance — instanced arrays, vertex array objects, GPU timer queries,
 * multi-draw, parallel shader compilation and an explorer for every WebGL 1.0 extension. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Ray, clamp, damp } = S.math;
  const G = S.GLSL;
  const CAT = 'Extensions & Performance';

  /* ---- small shared helpers ---- */
  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const fmt = (n) => Math.round(n).toLocaleString();
  const hex = (v) => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
  /** Canvas 2D line graph that lives inside an overlay panel. */
  function makeGraph(parent, w, h) {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const cv = el('canvas', null, null, parent);
    cv.width = w * d; cv.height = h * d;
    cv.style.cssText = `display:block;width:${w}px;height:${h}px;margin-top:8px;border-top:1px solid rgba(236,233,226,.12)`;
    const g = cv.getContext('2d'); g.scale(d, d);
    return {
      cv,
      draw(series, max, opts = {}) {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = 'rgba(236,233,226,0.08)'; g.lineWidth = 1;
        for (let k = 1; k < 4; k++) { const y = Math.round(h * k / 4) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        if (opts.line != null) { const y = Math.round(h - Math.min(opts.line, max) / max * (h - 4) - 2) + 0.5; g.strokeStyle = 'rgba(236,233,226,0.25)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.setLineDash([]); }
        for (const m of opts.marks || []) { g.fillStyle = 'rgba(255,79,163,0.18)'; g.fillRect(m * w - 1, 0, 2, h); }
        for (const s of series) {
          if (s.dots) { g.fillStyle = s.color; for (const [x, y] of s.data) g.fillRect(x * w - 1.5, h - Math.min(y, max) / max * (h - 4) - 3.5, 3, 3); continue; }
          g.strokeStyle = s.color; g.lineWidth = 1.25; g.beginPath();
          const n = s.len || s.data.length;
          s.data.forEach((v, i) => { const x = (i / Math.max(1, n - 1)) * w, y = h - Math.min(v, max) / max * (h - 4) - 2; i ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.stroke();
        }
        g.fillStyle = 'rgba(236,233,226,0.55)'; g.font = '9.5px "JetBrains Mono", monospace';
        g.fillText(opts.label || max.toFixed(1) + ' ms', 3, 10);
      },
    };
  }
  const BG = [0.027, 0.031, 0.047];
  const clearInk = (gl, w, h) => { gl.viewport(0, 0, w, h); gl.clearColor(BG[0], BG[1], BG[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); };

  /* ---------------------------------------------------------------- */
  /* 1. Instanced arrays                                               */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'instancing',
    title: 'Instanced Arrays',
    category: CAT,
    thumb: 'wide',
    hint: 'move to push · click for a shock wave',
    description: 'Twenty thousand small shapes, each with its own base position, phase, colour and displacement, drawn by a single drawElementsInstancedANGLE call. vertexAttribDivisorANGLE(loc, 1) makes an attribute advance once per instance instead of once per vertex. Switch to the per-object loop to issue one drawElements per shape, with the per-instance values set as constant vertex attributes, and compare the CPU time spent submitting work.',
    interact: [['Move', 'push instances away from the pointer'], ['Click', 'send a shock wave'], ['Draw path', 'one instanced call, or one call per object']],
    features: ['ANGLE_instanced_arrays', 'vertexAttribDivisorANGLE(loc, 1)', 'drawElementsInstancedANGLE', 'drawArraysInstancedANGLE', 'gl.vertexAttrib4f (constant attribute)'],
    params: [
      { key: 'count', label: 'Instances', type: 'range', min: 1000, max: 100000, step: 1000, value: 20000 },
      { key: 'path', label: 'Draw path', type: 'select', options: ['Instanced', 'Loop'], value: 0 },
      { key: 'shape', label: 'Shape', type: 'select', options: ['Hex · elements', 'Tri · arrays'], value: 0 },
      { key: 'push', label: 'Push strength', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6 },
    ],
    code: `const ext = gl.getExtension('ANGLE_instanced_arrays');
gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
ext.vertexAttribDivisorANGLE(4, 1);   // per instance
ext.drawElementsInstancedANGLE(gl.TRIANGLES, 18,
  gl.UNSIGNED_SHORT, 0, 20000);
// vs. the loop: 20,000 × (vertexAttrib4f + drawElements)`,
    init(ctx) {
      const { gl, util } = ctx;
      const inst = util.ext('ANGLE_instanced_arrays');
      const MAX = 100000;
      // hexagon: centre + 6 rim vertices (z = rim factor), indexed
      const hv = [0, 0, 0]; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; hv.push(Math.cos(a), Math.sin(a), 1); }
      const hi = []; for (let k = 0; k < 6; k++) hi.push(0, 1 + k, 1 + (k + 1) % 6);
      // triangle: 3 sub-triangles around the centre, non-indexed
      const tv = []; for (let k = 0; k < 3; k++) { const a0 = k / 3 * Math.PI * 2 + Math.PI / 2, a1 = (k + 1) / 3 * Math.PI * 2 + Math.PI / 2; tv.push(0, 0, 0, Math.cos(a0) * 1.2, Math.sin(a0) * 1.2, 1, Math.cos(a1) * 1.2, Math.sin(a1) * 1.2, 1); }
      const hexVB = util.buffer(gl.ARRAY_BUFFER, new Float32Array(hv)), hexIB = util.buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(hi));
      const triVB = util.buffer(gl.ARRAY_BUFFER, new Float32Array(tv));
      const baseBuf = util.buffer(gl.ARRAY_BUFFER, MAX * 16, gl.DYNAMIC_DRAW);
      const dispBuf = util.buffer(gl.ARRAY_BUFFER, MAX * 8, gl.DYNAMIC_DRAW);
      const prog = util.program(G.colors + `
attribute vec3 a_pos; attribute vec4 a_i0; attribute vec2 a_i1;
uniform float u_t; uniform float u_asp; uniform float u_size;
varying vec3 v_c; varying float v_r;
void main() {
  float d = length(a_i1);
  float ang = a_i0.z * 6.2832 + u_t * (0.25 + a_i0.w * 0.5) + d * 9.0;
  float c = cos(ang), s = sin(ang);
  vec2 q = mat2(c, s, -s, c) * a_pos.xy;
  float pulse = 0.82 + 0.18 * sin(u_t * 1.7 + a_i0.z * 31.0);
  vec2 p = a_i0.xy + a_i1 + q * u_size * pulse * (1.0 + min(d * 4.0, 1.0));
  gl_Position = vec4(p.x / u_asp, p.y, 0.0, 1.0);
  float e = clamp(d * 6.0, 0.0, 1.0);
  v_c = mix(mix(A1, A2, a_i0.w), BONE, e * 0.85);
  v_r = a_pos.z;
}`, `
varying vec3 v_c; varying float v_r;
void main() { gl_FragColor = vec4(v_c * (0.28 + 0.72 * v_r * v_r), 1.0); }`);
      const instAttrs = [{ buffer: baseBuf, loc: 4, size: 4, divisor: 1 }, { buffer: dispBuf, loc: 5, size: 2, divisor: 1 }];
      const meshes = inst ? [
        util.mesh([{ buffer: hexVB, loc: 0, size: 3 }, ...instAttrs], hexIB, { count: 18 }),
        util.mesh([{ buffer: triVB, loc: 0, size: 3 }, ...instAttrs], null, { count: 9 }),
      ] : null;
      const info = el('div', 'ov-panel ov-tr', null, ctx.overlay);
      info.style.minWidth = '230px';
      if (!inst) ctx.syncParam('path', 1);
      return {
        inst, prog, meshes, hexVB, hexIB, triVB, baseBuf, dispBuf, info,
        base: new Float32Array(MAX * 4), disp: new Float32Array(MAX * 2), vel: new Float32Array(MAX * 2),
        n: 0, asp: 0, size: 0.01, ms: [0, 0], msSmooth: 0, m: [0, 0], tick: 0,
      };
    },
    layout(ctx, s, n) {
      const asp = ctx.aspect;
      const cols = Math.ceil(Math.sqrt(n * asp)), rows = Math.ceil(n / cols);
      const sx = (2 * asp * 0.97) / cols, sy = 1.94 / rows;
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        const x = (c + 0.5 + (r % 2) * 0.5 - cols / 2) * sx, y = (r + 0.5 - rows / 2) * sy;
        const hue = 0.5 + 0.5 * Math.sin(x * 1.7 + Math.cos(y * 2.3) * 1.4 + y * 0.8);
        s.base.set([x, y, rnd(), clamp(hue * 0.85 + rnd() * 0.15, 0, 1)], i * 4);
      }
      s.disp.fill(0); s.vel.fill(0);
      const gl = ctx.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, s.baseBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.base.subarray(0, n * 4));
      s.n = n; s.asp = asp; s.size = Math.min(sx, sy) * 0.4;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const n = params.count | 0;
      if (n !== s.n || Math.abs(ctx.aspect - s.asp) > 1e-3) this.layout(ctx, s, n);
      const asp = ctx.aspect;
      const live = input.hover && !ctx.capture;
      const tx = live ? input.nx * asp : Math.cos(t * 0.41) * asp * 0.62, ty = live ? input.ny : Math.sin(t * 0.67) * 0.55;
      const k = damp(12, dt); s.m[0] += (tx - s.m[0]) * k; s.m[1] += (ty - s.m[1]) * k;
      // CPU physics on the displacement attribute
      const push = params.push, R = 0.22 + 0.25 * push, R2 = R * R, mx = s.m[0], my = s.m[1];
      const B = s.base, D = s.disp, V = s.vel, kd = Math.exp(-5 * dt), ks = 16 * dt;
      const shocks = input.clicks.map((c) => [c.nx * asp, c.ny]);
      if (ctx.capture && (s.tick++ % 90) === 30) shocks.push([mx, my]);
      for (let i = 0; i < n; i++) {
        const j = i * 2, px = B[i * 4] + D[j] - mx, py = B[i * 4 + 1] + D[j + 1] - my, d2 = px * px + py * py;
        if (d2 < R2 && push > 0) { const d = Math.sqrt(d2) + 1e-4, f = (1 - d / R) * (1 - d / R) * push * 26 * dt; V[j] += (px / d) * f; V[j + 1] += (py / d) * f; }
        for (const sh of shocks) { const qx = B[i * 4] - sh[0], qy = B[i * 4 + 1] - sh[1], d = Math.sqrt(qx * qx + qy * qy) + 1e-3, f = 0.9 * Math.exp(-d * 3.5) * (0.3 + push); V[j] += (qx / d) * f; V[j + 1] += (qy / d) * f; }
        V[j] = (V[j] - D[j] * ks) * kd; V[j + 1] = (V[j + 1] - D[j + 1] * ks) * kd;
        D[j] += V[j] * dt; D[j + 1] += V[j + 1] * dt;
      }
      clearInk(gl, ctx.width, ctx.height);
      s.prog.use().set({ u_t: t, u_asp: asp, u_size: s.size });
      const loop = params.path === 1 || !s.inst;
      if (s.lastLoop !== loop) { s.lastLoop = loop; s.msSmooth = 0; }
      const t0 = performance.now();
      if (!loop) {
        gl.bindBuffer(gl.ARRAY_BUFFER, s.dispBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, D.subarray(0, n * 2));
        s.meshes[params.shape].drawInstanced(n);
      } else {
        const hexMode = params.shape === 0;
        util_bind(ctx, s, hexMode);
        for (let i = 0; i < n; i++) {
          gl.vertexAttrib4f(4, B[i * 4], B[i * 4 + 1], B[i * 4 + 2], B[i * 4 + 3]);
          gl.vertexAttrib2f(5, D[i * 2], D[i * 2 + 1]);
          if (hexMode) gl.drawElements(gl.TRIANGLES, 18, gl.UNSIGNED_SHORT, 0); else gl.drawArrays(gl.TRIANGLES, 0, 9);
        }
      }
      const ms = performance.now() - t0;
      s.msSmooth = s.msSmooth ? s.msSmooth + (ms - s.msSmooth) * 0.15 : ms;
      s.ms[loop ? 1 : 0] = s.msSmooth;
      if (++s.tick % 6 === 0) {
        const mx2 = Math.max(s.ms[0], s.ms[1], 0.01);
        const bar = (v, c) => `<span style="display:inline-block;height:6px;width:${Math.max(2, v / mx2 * 120)}px;background:${c};vertical-align:middle"></span>`;
        s.info.innerHTML = `<b>${loop ? 'LOOP' : 'INSTANCED'}</b> · ${loop ? fmt(n) + ' draw calls' : '1 draw call'}<br>`
          + `${fmt(n)} instances × ${params.shape ? '9 verts (arrays)' : '18 indices (elements)'}<br>`
          + `CPU submit <b>${s.msSmooth.toFixed(2)} ms</b><br>`
          + `<span class="on">instanced</span> ${bar(s.ms[0], '#38d6e8')} ${s.ms[0] ? s.ms[0].toFixed(2) : '–'}<br>`
          + `<span class="off">loop&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> ${bar(s.ms[1], '#ff4fa3')} ${s.ms[1] ? s.ms[1].toFixed(2) : '–'}`
          + (s.inst ? '' : '<br><span class="off">ANGLE_instanced_arrays unavailable: loop only</span>');
      }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });
  // per-vertex attribute only; locations 4 and 5 become constant attributes (arrays disabled)
  function util_bind(ctx, s, hexMode) {
    const { gl, util } = ctx;
    util.bindAttribs([{ buffer: hexMode ? s.hexVB : s.triVB, loc: 0, size: 3 }]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hexMode ? s.hexIB : null);
  }

  /* ---------------------------------------------------------------- */
  /* 2. Vertex array objects                                           */
  /* ---------------------------------------------------------------- */
  const GL_GROUPS = {
    attrib: ['bindBuffer', 'enableVertexAttribArray', 'disableVertexAttribArray', 'vertexAttribPointer', 'bindVertexArrayOES'],
    draw: ['drawElements', 'drawArrays'],
  };
  S.register({
    id: 'vao',
    title: 'Vertex Array Objects',
    category: CAT,
    thumb: 'square',
    hint: 'drag to orbit · hover a mesh · switch path',
    description: 'Ninety-six distinct meshes, each with its own position, normal, UV and colour buffers plus an index buffer. Without OES_vertex_array_object every mesh needs a bindBuffer, enableVertexAttribArray and vertexAttribPointer per attribute before it can be drawn. A vertex array object records that whole layout once, so drawing becomes a single bindVertexArrayOES. Every GL call is wrapped with a counter, so the live tally shows exactly what each path costs.',
    interact: [['Drag', 'orbit the field'], ['Hover', 'lift a mesh and inspect its buffers'], ['Path', 'VAO per mesh, or re-specify every attribute']],
    features: ['OES_vertex_array_object', 'createVertexArrayOES', 'bindVertexArrayOES', 'vertexAttribPointer per attribute', 'GL call counting wrapper'],
    params: [
      { key: 'path', label: 'Attribute path', type: 'select', options: ['VAO', 'Re-specify'], value: 0 },
      { key: 'meshes', label: 'Meshes', type: 'range', min: 16, max: 256, step: 1, value: 96, restart: true },
      { key: 'spin', label: 'Spin', type: 'toggle', value: true },
    ],
    code: `// once, at load
ext.bindVertexArrayOES(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, pos);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
/* … nrm, uv, col, ELEMENT_ARRAY_BUFFER … */
// every frame: one call instead of 13
ext.bindVertexArrayOES(vao); gl.drawElements(…);`,
    init(ctx) {
      const { gl, util } = ctx;
      const vx = util.ext('OES_vertex_array_object');
      const M = ctx.params.meshes;
      const TAU = Math.PI * 2;
      let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const gens = [
        (r) => S.geo.surface(22, 14, (u, v) => { const a = u * TAU, b = v * Math.PI, k = 3 + Math.floor(r * 4), rad = 1 + 0.18 * Math.sin(a * k) * Math.sin(b * 3); return { p: [Math.sin(b) * Math.cos(a) * rad, Math.cos(b) * rad, Math.sin(b) * Math.sin(a) * rad] }; }),
        (r) => S.geo.torus(36, 12, 0.72, 0.16 + r * 0.16),
        (r) => S.geo.torusKnot(90, 10, 0.12 + r * 0.05, 0.55, 0.26),
        (r) => S.geo.surface(30, 10, (u, v) => { const a = u * TAU * 2.2, rr = 0.15 + u * 0.85, b = v * TAU; return { p: [Math.cos(a) * rr * (1 + 0.3 * Math.cos(b)), (u - 0.5) * 1.4 + 0.3 * rr * Math.sin(b), Math.sin(a) * rr * (1 + 0.3 * Math.cos(b))] }; }),
        (r) => S.geo.surface(24, 8, (u, v) => { const a = u * TAU, tw = (v - 0.5) * (2 + r * 4), n = 4 + Math.floor(r * 3), rad = 0.7 + 0.12 * Math.cos(a * n + tw); return { p: [Math.cos(a + tw) * rad, (v - 0.5) * 1.8, Math.sin(a + tw) * rad] }; }),
        (r) => S.geo.surface(28, 10, (u, v) => { const a = u * TAU, rr = v, pet = 5 + Math.floor(r * 4); return { p: [Math.cos(a) * rr, 0.25 * Math.sin(a * pet) * rr * rr + 0.1 * Math.cos(rr * 9), Math.sin(a) * rr] }; }),
      ];
      const cols = Math.ceil(Math.sqrt(M)), sp = 1.75;
      const meshes = [];
      for (let i = 0; i < M; i++) {
        const r = rnd(), g = gens[i % gens.length](r);
        const hue = rnd();
        const col = new Float32Array(g.vertexCount * 3);
        for (let k = 0; k < g.vertexCount; k++) {
          const u = g.uv[k * 2], mixv = clamp(hue * 0.7 + Math.sin(u * 6.283) * 0.3, 0, 1);
          for (let c = 0; c < 3; c++) col[k * 3 + c] = S.A1[c] * (1 - mixv) + S.A2[c] * mixv;
        }
        const cx = i % cols, cz = Math.floor(i / cols);
        meshes.push({
          pos: util.buffer(gl.ARRAY_BUFFER, g.pos), nrm: util.buffer(gl.ARRAY_BUFFER, g.nrm), uv: util.buffer(gl.ARRAY_BUFFER, g.uv), col: util.buffer(gl.ARRAY_BUFFER, col),
          ib: util.buffer(gl.ELEMENT_ARRAY_BUFFER, g.idx), count: g.count, verts: g.vertexCount, kind: ['blob', 'torus', 'knot', 'shell', 'twist', 'petal'][i % 6],
          x: (cx - (cols - 1) / 2) * sp, z: (cz - (Math.ceil(M / cols) - 1) / 2) * sp, spin: 0.3 + r * 0.8, ph: r * 6.28, lift: 0, vao: null,
        });
      }
      const specify = (m) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.uv); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.col); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
      };
      if (vx) {
        for (const m of meshes) { m.vao = util.vao(); vx.bindVertexArrayOES(m.vao); specify(m); }
        vx.bindVertexArrayOES(null);
        util.forgetAttribs();
      } else ctx.syncParam('path', 1);
      const prog = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm; attribute vec2 a_uv; attribute vec3 a_col;
uniform mat4 u_vp; uniform mat4 u_m;
varying vec3 v_n; varying vec3 v_c; varying vec2 v_uv; varying vec3 v_w;
void main() { vec4 w = u_m * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_m) * a_nrm; v_c = a_col; v_uv = a_uv; gl_Position = u_vp * w; }`, G.colors + `
uniform vec3 u_eye; uniform float u_hl;
varying vec3 v_n; varying vec3 v_c; varying vec2 v_uv; varying vec3 v_w;
void main() {
  vec3 n = normalize(v_n); if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(u_eye - v_w);
  float l = 0.2 + 0.8 * max(dot(n, normalize(vec3(0.4, 1.0, 0.3))), 0.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float band = smoothstep(0.92, 1.0, fract(v_uv.y * 8.0)) * 0.25;
  vec3 c = v_c * l + rim * mix(0.25, 0.9, u_hl) * BONE + band;
  float fog = smoothstep(8.0, 34.0, length(u_eye - v_w));
  gl_FragColor = vec4(mix(c, INK, fog), 1.0);
}`);
      const ground = util.program(`
attribute vec2 a_pos; uniform mat4 u_vp; uniform float u_s; varying vec2 v_p;
void main() { v_p = a_pos * u_s; gl_Position = u_vp * vec4(v_p.x, 0.0, v_p.y, 1.0); }`, G.colors + `
#extension GL_OES_standard_derivatives : enable
uniform vec2 u_hit; uniform float u_s; varying vec2 v_p;
void main() {
  vec2 g = abs(fract(v_p / 1.75 + 0.5) - 0.5) / fwidth(v_p / 1.75);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float fade = 1.0 - smoothstep(u_s * 0.35, u_s, length(v_p));
  float spot = exp(-dot(v_p - u_hit, v_p - u_hit) * 0.8);
  vec3 c = INK + line * 0.07 * fade + A1 * spot * 0.12 + A1 * line * spot * 0.3;
  gl_FragColor = vec4(c, 1.0);
}`);
      const quad = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])), loc: 0, size: 2 }], null, { count: 4 });
      // GL call counter: shadow every prototype method on this context instance (removed in dispose)
      const counter = { total: 0, attrib: 0, uniform: 0, draw: 0, other: 0, last: null };
      const wrapped = [];
      const groupOf = {};
      GL_GROUPS.attrib.forEach((n) => (groupOf[n] = 'attrib')); GL_GROUPS.draw.forEach((n) => (groupOf[n] = 'draw'));
      const wrap = (obj, name) => {
        const orig = obj[name];
        const grp = groupOf[name] || (name.startsWith('uniform') ? 'uniform' : 'other');
        obj[name] = function () { counter.total++; counter[grp]++; return orig.apply(this, arguments); };
        wrapped.push([obj, name]);
      };
      for (const name of Object.getOwnPropertyNames(WebGLRenderingContext.prototype)) {
        const d = Object.getOwnPropertyDescriptor(WebGLRenderingContext.prototype, name);
        if (d && typeof d.value === 'function' && name !== 'constructor') wrap(gl, name);
      }
      if (vx) wrap(vx, 'bindVertexArrayOES');
      const info = el('div', 'ov-panel ov-tr', null, ctx.overlay); info.style.minWidth = '250px';
      const cam = new S.OrbitCam({ dist: cols * 1.25 + 4, pitch: 0.62, yaw: 0.5, auto: 0.06, maxDist: 60 });
      return { vx, meshes, specify, prog, ground, quad, counter, wrapped, info, cam, hover: -1, hit: [999, 999], tick: 0, gs: cols * sp + 6 };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const C = s.counter;
      C.total = C.attrib = C.uniform = C.draw = C.other = 0;
      s.cam.update(input, dt);
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 120), s.cam.view());
      const eye = s.cam.eye();
      // hover pick on the ground plane
      let nx = input.nx, ny = input.ny;
      if (ctx.capture || !input.hover) { nx = Math.cos(t * 0.5) * 0.35; ny = Math.sin(t * 0.7) * 0.25 - 0.1; }
      const ray = s.cam.ray(nx, ny, ctx.aspect);
      const hit = Ray.plane(ray.origin, ray.dir, [0, 0.8, 0], [0, 1, 0]);
      s.hover = -1;
      if (hit && !input.dragging) {
        let best = 0.95;
        s.meshes.forEach((m, i) => { const d = Math.hypot(m.x - hit[0], m.z - hit[2]); if (d < best) { best = d; s.hover = i; } });
        s.hit = [hit[0], hit[2]];
      }
      clearInk(gl, ctx.width, ctx.height);
      gl.enable(gl.DEPTH_TEST);
      s.ground.use().set({ u_vp: vp, u_s: s.gs, u_hit: s.hit });
      s.quad.draw(gl.TRIANGLE_STRIP);
      s.prog.use().set({ u_vp: vp, u_eye: eye });
      const useVao = params.path === 0 && s.vx;
      const k = damp(8, dt);
      s.meshes.forEach((m, i) => {
        m.lift += ((i === s.hover ? 0.9 : 0) - m.lift) * k;
        if (params.spin) m.ph += dt * m.spin;
        if (useVao) s.vx.bindVertexArrayOES(m.vao); else s.specify(m);
        const model = M4.mul(M4.translate(m.x, 0.8 + m.lift + Math.sin(t * 1.3 + m.ph) * 0.06, m.z), M4.mul(M4.rotY(m.ph), M4.mul(M4.rotX(Math.sin(m.ph * 0.7) * 0.5), M4.scale(0.55 + m.lift * 0.2))));
        s.prog.set({ u_m: model, u_hl: i === s.hover ? 1 : 0 });
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
      });
      if (useVao) s.vx.bindVertexArrayOES(null);
      else { gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.disableVertexAttribArray(3); }
      util.forgetAttribs();
      gl.disable(gl.DEPTH_TEST);
      if (++s.tick % 5 === 0) {
        const tot = Math.max(C.total, 1);
        const row = (name, v, c) => `${name.padEnd(9, ' ')} <span style="display:inline-block;height:6px;width:${Math.max(2, v / tot * 130)}px;background:${c};vertical-align:middle"></span> ${fmt(v)}<br>`;
        const hm = s.meshes[s.hover];
        s.info.innerHTML = `<b>${useVao ? 'VAO PER MESH' : 'RE-SPECIFY ATTRIBUTES'}</b><br>GL calls this frame <b>${fmt(C.total)}</b><br>`
          + row('attrib', C.attrib, '#ff4fa3') + row('uniform', C.uniform, '#38d6e8') + row('draw', C.draw, '#ece9e2') + row('other', C.other, 'rgba(236,233,226,.35)')
          + `${s.meshes.length} meshes · ${useVao ? '1' : '13'} attrib calls each`
          + (hm ? `<br><span class="on">${hm.kind}</span> · ${fmt(hm.verts)} verts · ${fmt(hm.count / 3)} tris · 5 buffers` : '')
          + (s.vx ? '' : '<br><span class="off">OES_vertex_array_object unavailable</span>');
      }
    },
    dispose(ctx, s) {
      for (const [obj, name] of s.wrapped) delete obj[name];
      if (s.vx) s.vx.bindVertexArrayOES(null);
      ctx.util.forgetAttribs();
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. GPU timer queries                                              */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'timer-query',
    title: 'GPU Timer Queries',
    category: CAT,
    thumb: 'tall',
    hint: 'move to reshape · wheel to zoom · raise iterations',
    description: 'A Julia set whose cost per pixel is the number of iterations before escape, so the GPU time depends on both the iteration cap and the shape under the pointer. EXT_disjoint_timer_query wraps the pass in beginQueryEXT(TIME_ELAPSED_EXT) and reports nanoseconds a few frames later, once QUERY_RESULT_AVAILABLE_EXT is true and GPU_DISJOINT_EXT says the clock was not interrupted. Without the extension the study falls back to CPU timing around gl.finish(), which blocks until the GPU is idle.',
    interact: [['Move', 'choose the Julia constant c'], ['Wheel', 'zoom'], ['Iterations', 'raise the per-pixel cost and watch the graph']],
    features: ['EXT_disjoint_timer_query', 'beginQueryEXT(TIME_ELAPSED_EXT)', 'QUERY_RESULT_AVAILABLE_EXT · QUERY_RESULT_EXT', 'GPU_DISJOINT_EXT', 'queryCounterEXT(TIMESTAMP_EXT)'],
    params: [
      { key: 'iter', label: 'Iterations (max)', type: 'range', min: 8, max: 512, step: 1, value: 72 },
      { key: 'timer', label: 'Timer', type: 'select', options: ['GPU query', 'CPU + finish'], value: 0 },
      { key: 'res', label: 'Resolution', type: 'select', options: ['½', 'Full'], value: 1 },
    ],
    code: `ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, q);
drawJulia();
ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
// a few frames later
if (ext.getQueryObjectEXT(q, ext.QUERY_RESULT_AVAILABLE_EXT)
    && !gl.getParameter(ext.GPU_DISJOINT_EXT))
  ms = ext.getQueryObjectEXT(q, ext.QUERY_RESULT_EXT) / 1e6;`,
    init(ctx) {
      const { gl, util } = ctx;
      const tq = util.ext('EXT_disjoint_timer_query');
      const prog = util.program(G.fullscreenVS, G.colors + `
uniform vec2 u_res; uniform vec2 u_c; uniform float u_iter; uniform float u_zoom; uniform float u_t;
varying vec2 v_uv;
void main() {
  vec2 z = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 2.6 * u_zoom;
  float n = 0.0, esc = 0.0;
  for (int i = 0; i < 512; i++) {
    if (float(i) >= u_iter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + u_c;
    if (dot(z, z) > 256.0) { esc = 1.0; break; }
    n += 1.0;
  }
  vec3 col;
  if (esc > 0.5) {
    float sn = n - log2(log2(dot(z, z))) + 4.0;
    float k = clamp(sqrt(sn / u_iter), 0.0, 1.0);
    vec3 hue = mix(A1, A2, 0.5 + 0.5 * sin(sn * 0.22 + u_t * 0.4));
    col = mix(INK, hue, smoothstep(0.05, 0.75, k)) + BONE * pow(k, 6.0) * 0.7;
  } else {
    float r = length(z);
    col = INK + vec3(0.03, 0.035, 0.05) * (0.5 + 0.5 * sin(r * 14.0));
  }
  vec2 q = v_uv - 0.5; col *= 1.0 - dot(q, q) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`);
      const blit = util.program(G.fullscreenVS, `uniform sampler2D u_tex; varying vec2 v_uv; void main() { gl_FragColor = texture2D(u_tex, v_uv); }`);
      const pool = [];
      if (tq) for (let i = 0; i < 6; i++) pool.push({ q: util.query(), busy: false, iter: 0 });
      let tsBits = 0;
      if (tq) { try { tsBits = tq.getQueryEXT(tq.TIMESTAMP_EXT, tq.QUERY_COUNTER_BITS_EXT) || 0; } catch (_) { tsBits = 0; } }
      const ts = tq && tsBits > 0 ? [{ a: util.query(), b: util.query(), busy: false }, { a: util.query(), b: util.query(), busy: false }, { a: util.query(), b: util.query(), busy: false }] : [];
      if (!tq) ctx.syncParam('timer', 1);
      const info = el('div', 'ov-panel ov-tr', null, ctx.overlay); info.style.minWidth = '268px';
      const txt = el('div', null, null, info);
      const g1 = makeGraph(info, 268, 74);
      const cap2 = el('div', null, '<span style="opacity:.6">ms vs iterations</span>', info); cap2.style.marginTop = '6px';
      const g2 = makeGraph(info, 268, 60);
      return { tq, prog, blit, pool, ts, tsBits, info, txt, g1, g2, rt: null, gpu: [], cpu: [], pts: [], c: [-0.75, 0.15], zoom: 1, disjoint: 0, lastTs: 0, last: 0, tick: 0 };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const tq = s.tq, W = ctx.width, H = ctx.height;
      // 1. collect finished queries
      if (tq) {
        const disjoint = gl.getParameter(tq.GPU_DISJOINT_EXT);
        if (disjoint) s.disjoint++;
        for (const p of s.pool) {
          if (!p.busy) continue;
          if (!tq.getQueryObjectEXT(p.q, tq.QUERY_RESULT_AVAILABLE_EXT)) continue;
          const ns = tq.getQueryObjectEXT(p.q, tq.QUERY_RESULT_EXT);
          p.busy = false;
          if (!disjoint && params.timer === 0) { s.last = ns / 1e6; s.gpu.push(s.last); s.pts.push([p.iter / 512, s.last]); }
        }
        for (const p of s.ts) {
          if (!p.busy || !tq.getQueryObjectEXT(p.b, tq.QUERY_RESULT_AVAILABLE_EXT)) continue;
          const a = tq.getQueryObjectEXT(p.a, tq.QUERY_RESULT_EXT), b = tq.getQueryObjectEXT(p.b, tq.QUERY_RESULT_EXT);
          p.busy = false; if (!disjoint) s.lastTs = (b - a) / 1e6;
        }
      }
      // 2. Julia constant follows the pointer (or orbits on its own)
      const live = input.hover && !ctx.capture;
      // c follows the main cardioid of the Mandelbrot set, where Julia sets are most intricate
      const th = live ? (input.uvx * 2 - 1) * Math.PI : 2.05 + Math.sin(t * 0.13) * 0.45, sc = live ? 0.92 + input.uvy * 0.22 : 1.07 + Math.sin(t * 0.23) * 0.02;
      const tc = [(Math.cos(th) / 2 - Math.cos(2 * th) / 4) * sc - 0.25 * (sc - 1), (Math.sin(th) / 2 - Math.sin(2 * th) / 4) * sc];
      const k = damp(5, dt); s.c[0] += (tc[0] - s.c[0]) * k; s.c[1] += (tc[1] - s.c[1]) * k;
      s.zoom = clamp(s.zoom * Math.exp(input.wheel * 0.001), 0.05, 2);
      const half = params.res === 0;
      const rw = half ? Math.max(1, W >> 1) : W, rh = half ? Math.max(1, H >> 1) : H;
      if (half && (!s.rt || s.rt.w !== rw || s.rt.h !== rh)) { if (s.rt) util.release(s.rt.fb, s.rt.tex); s.rt = util.target(rw, rh); }
      const iter = params.iter;
      const p = tq && params.timer === 0 ? s.pool.find((x) => !x.busy) : null;
      const pair = tq && params.timer === 0 ? s.ts.find((x) => !x.busy) : null;
      // 3. the measured pass
      const t0 = performance.now();
      if (pair) tq.queryCounterEXT(pair.a, tq.TIMESTAMP_EXT);
      if (p) tq.beginQueryEXT(tq.TIME_ELAPSED_EXT, p.q);
      if (half) util.bindTarget(s.rt); else gl.viewport(0, 0, W, H);
      s.prog.use().set({ u_res: [rw, rh], u_c: s.c, u_iter: iter, u_zoom: s.zoom, u_t: t });
      util.drawFullscreen();
      if (p) { tq.endQueryEXT(tq.TIME_ELAPSED_EXT); p.busy = true; p.iter = iter; }
      if (pair) { tq.queryCounterEXT(pair.b, tq.TIMESTAMP_EXT); pair.busy = true; }
      if (params.timer === 1) gl.finish();
      const cpu = performance.now() - t0;
      if (params.timer === 1) { s.last = cpu; s.gpu.push(cpu); s.pts.push([iter / 512, cpu]); }
      s.cpu.push(cpu);
      if (half) { util.bindTarget(null, W, H); s.blit.use(); util.tex(0, s.rt.tex); s.blit.set({ u_tex: 0 }); util.drawFullscreen(); }
      const N = 150;
      while (s.gpu.length > N) s.gpu.shift();
      while (s.cpu.length > N) s.cpu.shift();
      while (s.pts.length > 220) s.pts.shift();
      if (++s.tick % 4 === 0) {
        const mode = params.timer === 0 && tq ? 'GPU · TIME_ELAPSED_EXT' : 'CPU · gl.finish()';
        s.txt.innerHTML = `<b>${mode}</b><br>`
          + `pass <b class="on">${s.last.toFixed(2)} ms</b> · ${iter} iterations · ${rw}×${rh}<br>`
          + `<span class="off">CPU submit ${s.cpu.length ? s.cpu[s.cpu.length - 1].toFixed(2) : '–'} ms</span>${params.timer === 0 ? ' (no wait)' : ' (blocks)'}<br>`
          + (tq ? `GPU_DISJOINT_EXT events <b>${s.disjoint}</b><br>TIMESTAMP_EXT ${s.tsBits ? `<b>${s.tsBits} bits</b> · Δ ${s.lastTs.toFixed(2)} ms` : '<b>0 counter bits</b> (not exposed)'}`
            : '<span class="off">EXT_disjoint_timer_query unavailable:</span><br>CPU time around gl.finish() includes<br>driver overhead and the round trip.');
        const mx = Math.max(2, ...s.gpu, ...s.cpu) * 1.15;
        s.g1.draw([{ data: s.cpu, color: 'rgba(255,79,163,0.85)', len: N }, { data: s.gpu, color: '#38d6e8', len: N }], mx, { label: mx.toFixed(1) + ' ms' });
        const my = Math.max(2, ...s.pts.map((q) => q[1])) * 1.1;
        s.g2.draw([{ data: s.pts, color: '#38d6e8', dots: true }, { data: [[iter / 512, s.last]], color: '#ff4fa3', dots: true }], my, { label: my.toFixed(1) + ' ms · 0–512 it' });
      }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Multi-draw                                                     */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'multi-draw',
    title: 'Multi-Draw',
    category: CAT,
    thumb: 'portrait',
    hint: 'move to unfold · switch the submission path',
    description: 'Hundreds of shapes packed into one vertex buffer and submitted by a single multiDrawArraysWEBGL or multiDrawElementsWEBGL call, each sub-draw with its own first and count. The vertex shader reads gl_DrawID (GL_ANGLE_multi_draw) to place and colour each one, so no uniforms change between draws. The counts are rebuilt on the CPU every frame from the pointer distance, which unfolds the shapes like fans. The fallback loop sets a uniform draw id and issues one drawArrays per shape.',
    interact: [['Move', 'shapes near the pointer unfold (their counts grow)'], ['Path', 'multi-draw arrays, elements, instanced or the plain loop'], ['Draws', 'number of sub-draws']],
    features: ['WEBGL_multi_draw', 'multiDrawArraysWEBGL', 'multiDrawElementsWEBGL', 'gl_DrawID (GL_ANGLE_multi_draw)', 'multiDrawArraysInstancedWEBGL'],
    params: [
      { key: 'path', label: 'Path', type: 'select', options: ['Arrays', 'Elements', 'Instanced', 'Loop'], value: 0 },
      { key: 'draws', label: 'Sub-draws', type: 'range', min: 16, max: 4096, step: 16, value: 432 },
      { key: 'reveal', label: 'Unfold radius', type: 'range', min: 0.1, max: 1.5, step: 0.01, value: 0.55 },
    ],
    code: `#extension GL_ANGLE_multi_draw : require
float id = float(gl_DrawID);   // which sub-draw am I?
// JS — one call, N ranges of one buffer
ext.multiDrawArraysWEBGL(gl.TRIANGLES,
  firsts, 0, counts, 0, N);
ext.multiDrawElementsWEBGL(gl.TRIANGLES,
  counts, 0, gl.UNSIGNED_SHORT, offsets, 0, N);`,
    init(ctx) {
      const { gl, util } = ctx;
      // Core only auto-enables four extensions, so enable this one before compiling GL_ANGLE_multi_draw.
      const md = util.ext('WEBGL_multi_draw');
      const inst = util.ext('ANGLE_instanced_arrays');
      // K shapes, each a fan of triangles. Arrays: expanded triangles. Elements: centre + rim, indexed.
      const shapes = [3, 4, 5, 6, 7, 8, 10, 12].map((n, i) => ({ n, star: i % 3 === 2 }));
      const av = [], ev = [], ei = [];
      const sh = shapes.map((sp) => {
        const segs = sp.star ? sp.n * 2 : sp.n;
        const rim = (k) => { const a = k / segs * Math.PI * 2 + Math.PI / 2, r = sp.star && k % 2 ? 0.45 : 1; return [Math.cos(a) * r, Math.sin(a) * r, k / segs]; };
        const first = av.length / 3;
        for (let k = 0; k < segs; k++) { const p0 = rim(k), p1 = rim(k + 1); av.push(0, 0, k / segs, p0[0], p0[1], p0[2], p1[0], p1[1], (k + 1) / segs); }
        const base = ev.length / 3, efirst = ei.length;
        ev.push(0, 0, 0); for (let k = 0; k <= segs; k++) { const p = rim(k); ev.push(p[0], p[1], p[2]); }
        for (let k = 0; k < segs; k++) ei.push(base, base + 1 + k, base + 2 + k);
        return { first, count: segs * 3, efirst, segs };
      });
      const abuf = util.buffer(gl.ARRAY_BUFFER, new Float32Array(av));
      const ebuf = util.buffer(gl.ARRAY_BUFFER, new Float32Array(ev));
      const ibuf = util.buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ei));
      const echo = util.buffer(gl.ARRAY_BUFFER, new Float32Array([1, 0, 1, 1.45, 0.35, 0.32, 1.95, 0.7, 0.12]));
      const vs = (drawId, instanced) => `${drawId ? '#extension GL_ANGLE_multi_draw : require' : ''}
attribute vec3 a_pos; ${instanced ? 'attribute vec3 a_i0;' : ''}
uniform float u_cols; uniform float u_rows; uniform float u_t; uniform float u_asp; uniform float u_cell; ${drawId ? '' : 'uniform float u_drawId;'}
varying vec3 v_c; varying float v_a; varying float v_k;
void main() {
  float id = ${drawId ? 'float(gl_DrawID)' : 'u_drawId'};
  float cx = mod(id, u_cols), cy = floor(id / u_cols);
  vec2 c = vec2((cx + 0.5) / u_cols * 2.0 - 1.0, 1.0 - (cy + 0.5) / u_rows * 2.0) * vec2(u_asp, 1.0) * 0.94;
  vec3 e = ${instanced ? 'a_i0' : 'vec3(1.0, 0.0, 1.0)'};
  float ang = u_t * (0.3 + fract(id * 0.618) * 0.6) + id * 0.7 + e.y;
  vec2 q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * a_pos.xy * u_cell * 0.42 * e.x;
  gl_Position = vec4((c + q) / vec2(u_asp, 1.0), 0.0, 1.0);
  float h = fract(id * 0.1618 + cy * 0.03);
  v_c = mix(A1, A2, smoothstep(0.2, 0.8, h));
  v_a = e.z; v_k = a_pos.z;
}`;
      const fs = G.colors + `
varying vec3 v_c; varying float v_a; varying float v_k;
void main() { vec3 c = mix(v_c, BONE, smoothstep(0.75, 1.0, v_k) * 0.6) * (0.45 + 0.55 * v_k); gl_FragColor = vec4(c * v_a, v_a); }`;
      const progs = { loop: util.program(G.colors + vs(false, false), fs) };
      if (md) {
        progs.md = util.program(G.colors + vs(true, false), fs);
        if (inst && md.multiDrawArraysInstancedWEBGL) progs.mdi = util.program(G.colors + vs(true, true), fs);
      }
      if (!md) ctx.syncParam('path', 3);
      const info = el('div', 'ov-panel ov-tr', null, ctx.overlay); info.style.minWidth = '230px';
      const MAXD = 4096;
      return {
        md, inst, shapes: sh, abuf, ebuf, ibuf, echo, progs, info,
        firsts: new Int32Array(MAXD), counts: new Int32Array(MAXD), offsets: new Int32Array(MAXD), icounts: new Int32Array(MAXD).fill(3),
        open: new Float32Array(MAXD), m: [0, 0], ms: 0, tick: 0,
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const N = params.draws | 0, asp = ctx.aspect;
      const cols = Math.max(1, Math.round(Math.sqrt(N * asp))), rows = Math.ceil(N / cols);
      const cell = Math.min(2 * asp * 0.94 / cols, 1.88 / rows);
      const live = input.hover && !ctx.capture;
      const tx = live ? input.nx * asp : Math.sin(t * 0.43) * asp * 0.55, ty = live ? input.ny : Math.sin(t * 0.61 + 1) * 0.6;
      const kk = damp(10, dt); s.m[0] += (tx - s.m[0]) * kk; s.m[1] += (ty - s.m[1]) * kk;
      let path = params.path;
      if (!s.md) path = 3;
      if (path === 2 && !s.progs.mdi) path = 0;
      const R = params.reveal, ka = damp(6, dt);
      let tris = 0;
      for (let i = 0; i < N; i++) {
        const cx = i % cols, cy = Math.floor(i / cols);
        const x = ((cx + 0.5) / cols * 2 - 1) * asp * 0.94, y = (1 - (cy + 0.5) / rows * 2) * 0.94;
        const d = Math.hypot(x - s.m[0], y - s.m[1]);
        const target = 0.12 + 0.88 * (1 - clamp((d - R * 0.3) / R, 0, 1));
        s.open[i] += (target - s.open[i]) * ka;
        const shp = s.shapes[(i * 7 + cy) % s.shapes.length];
        const segs = Math.max(1, Math.round(shp.segs * s.open[i]));
        s.firsts[i] = shp.first; s.counts[i] = segs * 3; s.offsets[i] = shp.efirst * 2;
        tris += segs;
      }
      clearInk(gl, ctx.width, ctx.height);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const uni = { u_cols: cols, u_rows: rows, u_t: t, u_asp: asp, u_cell: cell };
      const t0 = performance.now();
      let calls = 1;
      if (path === 0) {
        s.progs.md.use().set(uni);
        util.bindAttribs([{ buffer: s.abuf, loc: 0, size: 3 }]);
        s.md.multiDrawArraysWEBGL(gl.TRIANGLES, s.firsts, 0, s.counts, 0, N);
      } else if (path === 1) {
        s.progs.md.use().set(uni);
        util.bindAttribs([{ buffer: s.ebuf, loc: 0, size: 3 }]);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.ibuf);
        s.md.multiDrawElementsWEBGL(gl.TRIANGLES, s.counts, 0, gl.UNSIGNED_SHORT, s.offsets, 0, N);
      } else if (path === 2) {
        s.progs.mdi.use().set(uni);
        util.bindAttribs([{ buffer: s.abuf, loc: 0, size: 3 }, { buffer: s.echo, loc: 4, size: 3, divisor: 1 }]);
        s.md.multiDrawArraysInstancedWEBGL(gl.TRIANGLES, s.firsts, 0, s.counts, 0, s.icounts, 0, N);
        util.bindAttribs([{ buffer: s.abuf, loc: 0, size: 3 }]); // reset the divisor
      } else {
        const p = s.progs.loop.use().set(uni);
        util.bindAttribs([{ buffer: s.abuf, loc: 0, size: 3 }]);
        for (let i = 0; i < N; i++) { p.set({ u_drawId: i }); gl.drawArrays(gl.TRIANGLES, s.firsts[i], s.counts[i]); }
        calls = N;
      }
      const ms = performance.now() - t0;
      s.ms += (ms - s.ms) * 0.15;
      gl.disable(gl.BLEND);
      if (++s.tick % 6 === 0) {
        const names = ['multiDrawArraysWEBGL', 'multiDrawElementsWEBGL', 'multiDrawArraysInstancedWEBGL', 'drawArrays loop'];
        s.info.innerHTML = `<b>${names[path]}</b><br>${fmt(N)} sub-draws in <b class="${calls === 1 ? 'on' : 'off'}">${fmt(calls)} call${calls === 1 ? '' : 's'}</b><br>`
          + `${fmt(tris * (path === 2 ? 3 : 1))} triangles · id from ${path === 3 ? 'uniform u_drawId' : 'gl_DrawID'}<br>CPU submit <b>${s.ms.toFixed(2)} ms</b>`
          + (path === 2 ? '<br>3 instances per draw (echo rings)' : '')
          + (s.md ? (s.progs.mdi ? '' : '<br><span class="off">instanced variant unavailable</span>') : '<br><span class="off">WEBGL_multi_draw unavailable: loop only</span>');
      }
      ctx.canvas.style.cursor = 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Parallel shader compile                                        */
  /* ---------------------------------------------------------------- */
  const VARIANT_FS = (k, seed) => `precision mediump float;
uniform float u_t; uniform vec2 u_res; uniform vec2 u_org;
const float SEED = ${seed.toFixed(6)};
const vec3 A1 = vec3(0.22, 0.839, 0.91); const vec3 A2 = vec3(1.0, 0.31, 0.639); const vec3 INK = vec3(0.027, 0.031, 0.047);
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + SEED) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
void main() {
  vec2 uv = (gl_FragCoord.xy - u_org) / u_res; vec2 p = uv * 2.0 - 1.0;
  float v = 0.0, a = 0.5; vec2 q = p * ${(2 + (k % 5)).toFixed(1)};
  for (int i = 0; i < ${8 + (k % 4) * 4}; i++) { v += a * n2(q + float(i) * 1.7 + u_t * 0.2 * SEED); q = mat2(1.6, 1.2, -1.2, 1.6) * q; a *= 0.6; }
  float r = length(p), th = atan(p.y, p.x);
  float pat = ${['sin(th * 5.0 + v * 6.0 + u_t)', 'sin(r * 18.0 - u_t * 2.0 + v * 4.0)', 'sin(p.x * 9.0 + v * 7.0) * sin(p.y * 9.0 - u_t)', 'cos(th * 3.0 - r * 10.0 + v * 5.0 + u_t)'][k % 4]};
  vec3 c = mix(INK, mix(A1, A2, v), smoothstep(-0.2, 1.0, pat) * (1.0 - r * 0.45));
  gl_FragColor = vec4(c, 1.0);
}`;
  const VARIANT_VS = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';
  S.register({
    id: 'parallel-compile',
    title: 'Parallel Shader Compile',
    category: CAT,
    thumb: 'wide',
    hint: 'compile a batch · watch the frame graph',
    description: 'Compiling and linking shaders can take tens of milliseconds each, and asking for COMPILE_STATUS or LINK_STATUS straight away forces the page to wait. With KHR_parallel_shader_compile the page can poll COMPLETION_STATUS_KHR instead, keep animating, and only use each program once it reports ready. Blocking mode links every variant and checks LINK_STATUS in one frame; the frame-time graph shows the resulting spike. Without the extension, the non-blocking path falls back to linking one program per frame.',
    interact: [['Compile', 'build a new batch of unique variant programs'], ['Mode', 'poll COMPLETION_STATUS_KHR, or block on LINK_STATUS'], ['Variants', 'batch size']],
    features: ['KHR_parallel_shader_compile', 'COMPLETION_STATUS_KHR', 'gl.getProgramParameter(LINK_STATUS)', 'gl.compileShader / gl.linkProgram', 'frame-time spikes'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Poll (non-blocking)', 'Blocking'], value: 0 },
      { key: 'n', label: 'Variants', type: 'range', min: 4, max: 48, step: 1, value: 16 },
      { key: 'auto', label: 'Recompile every 6 s', type: 'toggle', value: true },
      { key: 'go', label: 'Compile batch', type: 'button' },
    ],
    code: `const ext = gl.getExtension('KHR_parallel_shader_compile');
gl.compileShader(vs); gl.compileShader(fs);
gl.linkProgram(prog);              // returns at once
// each frame, without blocking:
if (gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR))
  ready = gl.getProgramParameter(prog, gl.LINK_STATUS);`,
    init(ctx) {
      const { util } = ctx;
      const pc = util.ext('KHR_parallel_shader_compile');
      const spin = util.program(G.fullscreenVS, G.colors + `
uniform float u_t; uniform vec2 u_res; uniform vec2 u_org;
void main() {
  vec2 p = (gl_FragCoord.xy - u_org) / u_res * 2.0 - 1.0;
  float r = length(p), th = atan(p.y, p.x);
  float arc = smoothstep(0.02, 0.0, abs(r - 0.35)) * step(0.0, sin(th - u_t * 5.0) - 0.3);
  vec3 c = vec3(0.045, 0.05, 0.065) + A1 * arc * 0.8;
  gl_FragColor = vec4(c, 1.0);
}`);
      const ring = util.program(`
attribute vec2 a_pos; uniform float u_t; uniform float u_asp; uniform vec2 u_c; uniform float u_r;
varying float v_k;
void main() { float a = a_pos.x * 6.2832 + u_t * 2.4 * (a_pos.y > 0.5 ? -1.0 : 1.0); float rr = u_r * (1.0 + a_pos.y * 0.25);
  gl_Position = vec4(u_c + vec2(cos(a) / u_asp, sin(a)) * rr, 0.0, 1.0); gl_PointSize = 5.0; v_k = a_pos.x; }`, G.colors + `
varying float v_k; void main() { vec2 q = gl_PointCoord - 0.5; if (dot(q, q) > 0.25) discard; gl_FragColor = vec4(mix(A1, A2, v_k), 1.0); }`);
      const rp = []; for (let i = 0; i < 48; i++) rp.push(i / 48, 0); for (let i = 0; i < 36; i++) rp.push(i / 36, 1);
      const ringBuf = util.buffer(ctx.gl.ARRAY_BUFFER, new Float32Array(rp));
      const info = el('div', 'ov-panel ov-br', null, ctx.overlay);
      const txt = el('div', null, null, info);
      const graph = makeGraph(info, 300, 86);
      const s = { pc, spin, ring, ringBuf, info, txt, graph, progs: [], frames: [], marks: [], batchT: 0, batchStart: 0, batchMs: 0, spike: 0, nextAuto: 6, tick: 0, gen: 0 };
      this.startBatch(ctx, s);
      return s;
    },
    startBatch(ctx, s) {
      const gl = ctx.gl;
      this.freeAll(ctx, s);
      const n = ctx.params.n | 0, blocking = ctx.params.mode === 1;
      s.gen++; s.batchStart = performance.now(); s.batchMs = 0; s.marks.push(s.frames.length);
      s.mode = blocking ? 'block' : s.pc ? 'poll' : 'amortise';
      for (let i = 0; i < n; i++) {
        s.progs.push({ k: i, seed: Math.random() * 100 + s.gen, prog: null, vs: null, fs: null, state: 'queued', locs: null, ms: 0 });
      }
      if (s.mode !== 'amortise') for (const p of s.progs) this.submit(gl, p);
      if (blocking) {
        for (const p of s.progs) this.finish(gl, p);
        s.batchMs = performance.now() - s.batchStart;
      }
    },
    submit(gl, p) {
      const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
      p.vs = mk(gl.VERTEX_SHADER, VARIANT_VS); p.fs = mk(gl.FRAGMENT_SHADER, VARIANT_FS(p.k, p.seed));
      p.prog = gl.createProgram(); gl.attachShader(p.prog, p.vs); gl.attachShader(p.prog, p.fs);
      gl.bindAttribLocation(p.prog, 0, 'a_pos');
      gl.linkProgram(p.prog);
      p.state = 'linking'; p.t0 = performance.now();
    },
    finish(gl, p) {
      const ok = gl.getProgramParameter(p.prog, gl.LINK_STATUS);
      p.state = ok ? 'ready' : 'failed';
      if (ok) p.locs = { t: gl.getUniformLocation(p.prog, 'u_t'), res: gl.getUniformLocation(p.prog, 'u_res'), org: gl.getUniformLocation(p.prog, 'u_org') };
      gl.detachShader(p.prog, p.vs); gl.detachShader(p.prog, p.fs); gl.deleteShader(p.vs); gl.deleteShader(p.fs); p.vs = p.fs = null;
      p.ms = performance.now() - p.t0; p.born = performance.now();
    },
    freeAll(ctx, s) {
      const gl = ctx.gl;
      for (const p of s.progs) { if (p.vs) gl.deleteShader(p.vs); if (p.fs) gl.deleteShader(p.fs); if (p.prog) gl.deleteProgram(p.prog); }
      s.progs = [];
    },
    onParam(ctx, s, key) { if (key === 'mode' || key === 'n') this.startBatch(ctx, s); },
    action(ctx, s, key) { if (key === 'go') { this.startBatch(ctx, s); s.nextAuto = ctx.time + 6; } },
    frame(ctx, s, t, dt) {
      const { gl, util, params } = ctx;
      const W = ctx.width, H = ctx.height;
      s.frames.push(dt * 1000);
      if (s.frames.length > 180) { s.frames.shift(); s.marks = s.marks.map((m) => m - 1).filter((m) => m >= 0); }
      if (params.auto && t > s.nextAuto) { this.startBatch(ctx, s); s.nextAuto = t + 6; }
      // progress the batch
      let pending = 0;
      if (s.mode === 'poll') {
        for (const p of s.progs) if (p.state === 'linking') { if (gl.getProgramParameter(p.prog, s.pc.COMPLETION_STATUS_KHR)) this.finish(gl, p); else pending++; }
      } else if (s.mode === 'amortise') {
        const q = s.progs.find((p) => p.state === 'queued');
        if (q) { this.submit(gl, q); this.finish(gl, q); }
        pending = s.progs.filter((p) => p.state === 'queued').length;
      }
      if (!pending && !s.batchMs && s.progs.length) s.batchMs = performance.now() - s.batchStart;
      const lastF = s.frames[s.frames.length - 1];
      if (lastF > s.spike || t - (s.spikeT || 0) > 6) { s.spike = lastF; s.spikeT = t; }
      clearInk(gl, W, H);
      // tile grid, leaving a band at the top for the motion strip
      const n = s.progs.length, top = Math.round(H * 0.24);
      const asp = W / (H - top);
      const cols = Math.max(1, Math.round(Math.sqrt(n * asp))), rows = Math.ceil(n / cols);
      const pad = Math.max(3, Math.round(4 * ctx.dpr));
      const cw = Math.floor((W - pad) / cols), ch = Math.floor((H - top - pad) / rows);
      gl.enable(gl.SCISSOR_TEST);
      s.progs.forEach((p, i) => {
        const x = pad + (i % cols) * cw, y = pad + (rows - 1 - Math.floor(i / cols)) * ch;
        const w = cw - pad, h = ch - pad;
        if (w < 2 || h < 2) return;
        gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
        if (p.state === 'ready') {
          gl.useProgram(p.prog);
          gl.uniform1f(p.locs.t, t); gl.uniform2f(p.locs.res, w, h); gl.uniform2f(p.locs.org, x, y);
          util.drawFullscreen();
          const age = (performance.now() - p.born) / 400;
          if (age < 1) { gl.enable(gl.BLEND); gl.blendColor(0, 0, 0, 1 - age); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA); s.spin.use().set({ u_t: t, u_res: [w, h], u_org: [x, y] }); util.drawFullscreen(); gl.disable(gl.BLEND); }
        } else {
          s.spin.use().set({ u_t: t + i * 0.3, u_res: [w, h], u_org: [x, y] });
          util.drawFullscreen();
        }
      });
      // motion strip: anything that stutters here is a dropped frame
      gl.viewport(0, H - top, W, top); gl.scissor(0, H - top, W, top);
      gl.clearColor(0.035, 0.038, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      const sasp = W / top;
      s.ring.use();
      util.bindAttribs([{ buffer: s.ringBuf, loc: 0, size: 2 }]);
      for (let k = 0; k < 3; k++) { s.ring.set({ u_t: t * (1 + k * 0.35), u_asp: sasp, u_c: [-0.6 + k * 0.6, 0], u_r: 0.55 }); gl.drawArrays(gl.POINTS, 0, 84); }
      gl.viewport(0, 0, W, H);
      if (++s.tick % 4 === 0) {
        const ready = s.progs.filter((p) => p.state === 'ready').length;
        const modeTxt = { poll: 'POLL · COMPLETION_STATUS_KHR', block: 'BLOCKING · LINK_STATUS', amortise: 'FALLBACK · one link per frame' }[s.mode];
        s.txt.innerHTML = `<b>${modeTxt}</b><br>ready <b class="on">${ready}</b> / ${s.progs.length}${pending ? ` · ${pending} pending` : ''} · batch ${s.batchMs ? '<b>' + s.batchMs.toFixed(0) + ' ms</b>' : '…'}<br>`
          + `worst frame (6 s) <b class="${s.spike > 50 ? 'off' : 'on'}">${s.spike.toFixed(0)} ms</b>`
          + (s.pc ? '' : '<br><span class="off">KHR_parallel_shader_compile unavailable:</span> the<br>non-blocking path spreads links over frames.');
        const mx = Math.max(40, ...s.frames) * 1.1;
        s.graph.draw([{ data: s.frames, color: '#38d6e8', len: 180 }], mx, { line: 16.7, marks: s.marks.map((m) => m / 179), label: 'frame ms · max ' + mx.toFixed(0) });
      }
    },
    dispose(ctx, s) { this.freeAll(ctx, s); },
  });

  /* ---------------------------------------------------------------- */
  /* 6. Extension explorer                                             */
  /* ---------------------------------------------------------------- */
  const KNOWN = {
    ANGLE_instanced_arrays: 'Draw many copies of a mesh in one call; attributes can advance per instance.',
    EXT_blend_minmax: 'Adds MIN_EXT and MAX_EXT blend equations.',
    EXT_clip_control: 'Chooses the clip-space origin (lower or upper left) and depth range (−1..1 or 0..1).',
    EXT_color_buffer_half_float: 'Makes 16-bit float colour attachments renderable.',
    EXT_depth_clamp: 'Clamps depth instead of clipping geometry at the near and far planes.',
    EXT_disjoint_timer_query: 'Measures GPU time of a group of commands with asynchronous queries.',
    EXT_float_blend: 'Allows blending into 32-bit float colour attachments.',
    EXT_frag_depth: 'Lets the fragment shader write gl_FragDepthEXT.',
    EXT_polygon_offset_clamp: 'Polygon offset with an upper bound on the applied depth bias.',
    EXT_shader_texture_lod: 'Explicit LOD and gradient texture lookups in fragment shaders.',
    EXT_sRGB: 'sRGB textures and renderbuffers with automatic linear conversion.',
    EXT_texture_compression_bptc: 'BC6H / BC7 compressed texture formats.',
    EXT_texture_compression_rgtc: 'BC4 / BC5 single- and two-channel compressed formats.',
    EXT_texture_filter_anisotropic: 'Anisotropic filtering for textures viewed at grazing angles.',
    EXT_texture_mirror_clamp_to_edge: 'A wrap mode that mirrors once, then clamps to the edge.',
    KHR_parallel_shader_compile: 'Poll COMPLETION_STATUS_KHR instead of blocking on compile and link.',
    OES_draw_buffers_indexed: 'Per-attachment blend state and colour masks for multiple render targets.',
    OES_element_index_uint: 'Allows UNSIGNED_INT index buffers (more than 65,535 vertices).',
    OES_fbo_render_mipmap: 'Render into mip levels other than 0 of a texture.',
    OES_standard_derivatives: 'dFdx, dFdy and fwidth in fragment shaders.',
    OES_texture_float: '32-bit float textures (FLOAT type).',
    OES_texture_float_linear: 'Linear filtering of 32-bit float textures.',
    OES_texture_half_float: '16-bit float textures (HALF_FLOAT_OES type).',
    OES_texture_half_float_linear: 'Linear filtering of 16-bit float textures.',
    OES_vertex_array_object: 'Vertex array objects that record attribute layouts.',
    WEBGL_blend_func_extended: 'Dual-source blending with a second fragment output.',
    WEBGL_color_buffer_float: 'Makes 32-bit float RGBA colour attachments renderable.',
    WEBGL_compressed_texture_astc: 'ASTC compressed texture formats.',
    WEBGL_compressed_texture_etc: 'ETC2 / EAC compressed texture formats.',
    WEBGL_compressed_texture_etc1: 'ETC1 compressed RGB format.',
    WEBGL_compressed_texture_pvrtc: 'PVRTC compressed formats (PowerVR).',
    WEBGL_compressed_texture_s3tc: 'S3TC / DXT1–5 compressed formats.',
    WEBGL_compressed_texture_s3tc_srgb: 'S3TC compressed formats with sRGB decoding.',
    WEBGL_debug_renderer_info: 'Exposes the unmasked GPU vendor and renderer strings.',
    WEBGL_debug_shaders: 'Returns the shader source after translation for the platform.',
    WEBGL_depth_texture: 'Depth and depth-stencil textures as framebuffer attachments.',
    WEBGL_draw_buffers: 'Multiple render targets via gl_FragData[n].',
    WEBGL_lose_context: 'Simulates context loss and restore for testing.',
    WEBGL_multi_draw: 'Many draws from arrays of firsts and counts in one call, with gl_DrawID.',
    WEBGL_polygon_mode: 'Draws filled polygons as lines (wireframe) or points.',
  };
  const PREFIX_HUE = { ANGLE: 0.1, EXT: 0.0, KHR: 0.55, OES: 0.75, WEBGL: 1.0 };
  S.register({
    id: 'extension-explorer',
    title: 'Extension Explorer',
    category: CAT,
    thumb: 'tall',
    hint: 'hover a tile · click for constants and a preview',
    description: 'Every WebGL 1.0 extension, plus anything else this browser reports, laid out as a field of tiles: lit when getSupportedExtensions lists it, dark when it does not. Click a tile to see its purpose and to enumerate the constants and functions on the extension object\'s prototype. Several small extensions run a live preview in the detail panel, and the summary lists every COMPRESSED_TEXTURE_FORMATS value once the compression extensions are enabled.',
    interact: [['Hover', 'lift a tile'], ['Click', 'open its constants, functions and preview'], ['Click empty space', 'back to the summary']],
    features: ['gl.getSupportedExtensions()', 'gl.getExtension(name)', 'Object.getOwnPropertyNames(prototype)', 'COMPRESSED_TEXTURE_FORMATS', 'live previews of small extensions'],
    params: [
      { key: 'filter', label: 'Show', type: 'select', options: ['All', 'Supported', 'Missing'], value: 0 },
      { key: 'preview', label: 'Live previews', type: 'toggle', value: true },
    ],
    code: `const names = gl.getSupportedExtensions();
const ext = gl.getExtension('EXT_clip_control');
const proto = Object.getPrototypeOf(ext);
for (const k of Object.getOwnPropertyNames(proto))
  console.log(k, ext[k]);   // constants and functions
gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);`,
    init(ctx) {
      const { gl, util } = ctx;
      // A private context for introspection and previews keeps the main context's state untouched.
      const pcv = document.createElement('canvas');
      const pgl = pcv.getContext('webgl', { antialias: true, alpha: false });
      const supported = new Set((pgl || gl).getSupportedExtensions() || []);
      const names = Object.keys(KNOWN);
      for (const n of supported) if (!names.includes(n)) names.push(n);
      names.sort();
      const info = {};
      for (const n of names) {
        const e = supported.has(n) && pgl ? pgl.getExtension(n) : null;
        const consts = [], fns = [];
        if (e) for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(e))) {
          if (k === 'constructor') continue;
          const v = e[k];
          if (typeof v === 'number') consts.push([k, v]); else if (typeof v === 'function') fns.push(k);
        }
        info[n] = { name: n, ok: supported.has(n), ext: e, consts, fns, purpose: KNOWN[n] || 'Reported by this browser; not part of the classic WebGL 1.0 list.' };
      }
      // compressed formats (enabled above on the private context) with names from the extension constants
      const fmtNames = {};
      for (const n of names) if (/compressed_texture|compression/.test(n)) for (const [k, v] of info[n].consts) fmtNames[v] = k;
      const formats = pgl ? Array.from(pgl.getParameter(pgl.COMPRESSED_TEXTURE_FORMATS) || []) : [];
      // label atlas
      const CW = 384, CH = 96, PER = 3;
      const atlas = document.createElement('canvas'); atlas.width = CW * PER; atlas.height = CH * Math.ceil(names.length / PER);
      const g2 = atlas.getContext('2d');
      names.forEach((n, i) => {
        const x = (i % PER) * CW, y = Math.floor(i / PER) * CH;
        const us = n.indexOf('_'), pre = n.slice(0, us), rest = n.slice(us + 1);
        g2.fillStyle = '#fff'; g2.textBaseline = 'alphabetic';
        g2.font = '500 22px "JetBrains Mono", monospace'; g2.globalAlpha = 0.55; g2.fillText(pre, x + 4, y + 38);
        let size = 30; g2.font = `500 ${size}px "JetBrains Mono", monospace`;
        while (g2.measureText(rest).width > CW - 10 && size > 14) { size--; g2.font = `500 ${size}px "JetBrains Mono", monospace`; }
        g2.globalAlpha = 1; g2.fillText(rest, x + 4, y + 76);
      });
      const atlasTex = util.texture({ source: atlas, filter: gl.LINEAR });
      const prog = util.program(`
attribute vec2 a_pos; attribute vec4 a_i0; attribute vec4 a_i1;
uniform vec2 u_res;
varying vec2 v_l; varying vec4 v_s; varying vec2 v_ap; varying vec2 v_cell; varying vec2 v_sz;
const vec2 CELL = vec2(${CW}.0, ${CH}.0);
void main() {
  vec2 px = a_i0.xy + a_pos * a_i0.zw * 0.5 * (1.0 + a_i1.z * 0.06);
  px.y -= a_i1.z * 4.0;
  gl_Position = vec4(px / u_res * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_l = a_pos; v_s = a_i1; v_sz = a_i0.zw;
  float idx = a_i1.x;
  v_cell = vec2(mod(idx, ${PER}.0), floor(idx / ${PER}.0));
  // tile pixels → atlas cell pixels with one uniform scale, text vertically centred
  float pad = a_i0.z * 0.07;
  float k = min((a_i0.z - pad * 1.5) / CELL.x, a_i0.w / CELL.y);
  vec2 local = a_pos * a_i0.zw * 0.5;
  v_ap = vec2((local.x + a_i0.z * 0.5 - pad) / k, local.y / k + CELL.y * 0.5);
}`, G.colors + `
uniform sampler2D u_atlas; uniform float u_t; uniform vec2 u_asz;
varying vec2 v_l; varying vec4 v_s; varying vec2 v_ap; varying vec2 v_cell; varying vec2 v_sz;
// v_s: x atlas index, y supported(0/1)·hue packed as ok + hue*0.5, z hover, w selected
void main() {
  vec2 p = v_l * v_sz * 0.5;
  vec2 b = v_sz * 0.5 - 6.0;
  vec2 q = abs(p) - b;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 6.0;
  float aa = 1.0;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float edge = 1.0 - smoothstep(0.0, 1.5, abs(d + 0.75));
  float ok = floor(v_s.y + 0.001);
  float hue = fract(v_s.y);
  vec3 acc = mix(A1, A2, hue * 2.0);
  float wave = 0.5 + 0.5 * sin(u_t * 1.4 - v_s.x * 0.37);
  vec3 fill = ok > 0.5 ? mix(vec3(0.05, 0.055, 0.07), acc * 0.18, 0.5 + 0.3 * wave + 0.5 * v_s.z) : vec3(0.035, 0.037, 0.045);
  float hatch = ok > 0.5 ? 0.0 : step(0.5, fract((p.x + p.y) * 0.08)) * 0.012;
  vec2 ap = clamp(v_ap, vec2(0.0), vec2(${CW}.0, ${CH}.0));
  float txt = texture2D(u_atlas, (v_cell * vec2(${CW}.0, ${CH}.0) + ap) / u_asz).a;
  txt *= step(v_ap.x, ${CW}.0 - 1.0) * step(0.0, v_ap.y) * step(v_ap.y, ${CH}.0);
  vec3 tcol = ok > 0.5 ? mix(BONE, vec3(1.0), v_s.z) : vec3(0.32, 0.33, 0.36);
  vec3 c = fill + hatch;
  c = mix(c, tcol, txt * 0.95);
  float bar = ok > 0.5 ? step(p.x, -b.x - 2.0) * step(-b.x - 5.0, p.x) * step(abs(p.y), b.y - 4.0) : 0.0;
  c = mix(c, acc, bar);
  vec3 ec = ok > 0.5 ? mix(acc * 0.55, acc, max(v_s.z, v_s.w)) : vec3(0.16, 0.17, 0.2) + v_s.z * 0.2;
  c = mix(c, ec, edge * (0.6 + 0.4 * max(v_s.z, v_s.w)));
  c += v_s.w * acc * 0.12;
  float glow = (1.0 - smoothstep(0.0, 18.0, d)) * (1.0 - inside) * (0.25 * ok * wave + 0.6 * max(v_s.z, v_s.w));
  gl_FragColor = vec4(c * inside + acc * glow * (ok > 0.5 ? 1.0 : 0.3), max(inside, glow));
}`);
      const bg = util.program(G.fullscreenVS, G.colors + `
uniform vec2 u_res; uniform vec2 u_m; uniform float u_t; varying vec2 v_uv;
void main() {
  vec2 px = v_uv * u_res;
  float dd = 1.0 - smoothstep(0.6, 1.6, length(fract(px / 24.0) - 0.5) * 24.0);
  float spot = exp(-dot(v_uv - u_m, v_uv - u_m) * 6.0);
  vec3 c = INK + vec3(0.06) * dd * (0.4 + spot) + A1 * spot * 0.04;
  vec2 q = v_uv - 0.5; c *= 1.0 - dot(q, q) * 0.8;
  gl_FragColor = vec4(c, 1.0);
}`);
      const MAXT = names.length;
      const quadData = new Float32Array(MAXT * 6 * 10);
      const vbuf = util.buffer(gl.ARRAY_BUFFER, quadData.byteLength, gl.DYNAMIC_DRAW);
      const tiles = names.map((n, i) => ({ n, i, x: 0, y: 0, w: 0, h: 0, hov: 0, sel: 0, vis: 1, ok: info[n].ok, hue: PREFIX_HUE[n.split('_')[0]] ?? 0.5 }));
      // detail panel
      const panel = el('div', 'ov-panel ov-tr', null, ctx.overlay);
      panel.style.cssText += ';width:340px;max-width:min(46%,340px);max-height:calc(100% - 130px);overflow:auto';
      pcv.style.cssText = 'display:block;width:100%;height:150px;margin:8px 0 4px;border:1px solid rgba(236,233,226,.14);background:#000';
      const s = { asz: [atlas.width, atlas.height], pgl, pcv, putil: pgl ? S.createUtil(pgl) : null, info, names, tiles, formats, fmtNames, supported, atlasTex, prog, bg, vbuf, quadData, panel, sel: null, hover: -1, m: [0.5, 0.5], tick: 0, pv: null, ghost: 0 };
      if (s.putil) this.buildPreviews(s);
      this.showPanel(ctx, s);
      return s;
    },
    showPanel(ctx, s) {
      const p = s.panel, sel = s.sel;
      if (s.pcv.parentNode) s.pcv.parentNode.removeChild(s.pcv);
      if (!sel) {
        const ok = s.names.filter((n) => s.info[n].ok).length;
        const fl = s.formats.length ? s.formats.map((f) => `${hex(f)} <span style="opacity:.7">${(s.fmtNames[f] || '?').replace(/^COMPRESSED_/, '').toLowerCase()}</span>`).join('<br>') : 'none';
        p.innerHTML = `<b>${ok}</b> of ${s.names.length} extensions supported<br><span style="opacity:.7">${navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] || ''}</span><br><br>`
          + `<b>COMPRESSED_TEXTURE_FORMATS</b> (${s.formats.length})<br>${fl}<br><br><span style="opacity:.7">Click a tile for its constants, functions and purpose.</span>`;
        s.pv = null;
        return;
      }
      const it = s.info[sel];
      const consts = it.consts.map(([k, v]) => `${k} <span style="opacity:.6">${hex(v)}</span>`).join('<br>');
      const fns = it.fns.map((f) => `${f}()`).join('<br>');
      p.innerHTML = `<b style="font-size:12px">${sel}</b><br><span class="${it.ok ? 'on' : 'off'}">${it.ok ? '● supported' : '○ not supported here'}</span><br><span style="color:var(--text)">${it.purpose}</span>`;
      s.pv = it.ok && s.previews && s.previews[sel] && ctx.params.preview ? s.previews[sel] : null;
      if (s.pv) { p.appendChild(s.pcv); el('div', null, `<span style="opacity:.6">live preview · </span><span class="pv-l">${s.pv.label}</span>`, p); }
      const rest = el('div', null, null, p);
      rest.innerHTML = it.ext ? `<br><b>constants</b> (${it.consts.length})<br>${consts || '<span style="opacity:.6">none</span>'}<br><br><b>functions</b> (${it.fns.length})<br>${fns || '<span style="opacity:.6">none</span>'}`
        : '<br><span style="opacity:.7">getExtension() returns null on this device, so there is nothing to enumerate.</span>';
      s.pvLabel = p.querySelector('.pv-l');
    },
    buildPreviews(s) {
      const g = s.pgl, u = s.putil, E = (n) => s.info[n] && s.info[n].ext;
      const p3 = u.program(`
attribute vec3 a_pos; attribute vec3 a_nrm; uniform mat4 u_mvp; uniform mat4 u_m; varying vec3 v_n; varying vec3 v_o;
void main() { v_n = mat3(u_m) * a_nrm; v_o = a_pos; gl_Position = u_mvp * vec4(a_pos, 1.0); }`, G.colors + `
uniform vec3 u_col; varying vec3 v_n; varying vec3 v_o;
void main() { vec3 n = normalize(v_n); float l = 0.25 + 0.75 * max(dot(n, normalize(vec3(0.4, 0.9, 0.6))), 0.0); gl_FragColor = vec4(u_col * l, 1.0); }`);
      const p2 = u.program(`
attribute vec2 a_pos; uniform vec4 u_rect; uniform vec4 u_uv; varying vec2 v_uv;
void main() { v_uv = u_uv.xy + (a_pos * 0.5 + 0.5) * u_uv.zw; gl_Position = vec4(u_rect.xy + a_pos * u_rect.zw, 0.0, 1.0); }`, `
uniform sampler2D u_tex; varying vec2 v_uv; void main() { gl_FragColor = texture2D(u_tex, v_uv); }`);
      const sphere = S.geo.upload(u, S.geo.sphere(24, 14, 1));
      const cube = S.geo.uploadFlat(u, S.geo.cube());
      const quad = u.mesh([{ buffer: u.buffer(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])), loc: 0, size: 2 }], null, { count: 4 });
      const tex = u.texture({ source: S.testCanvas(128, 'Ab'), filter: g.LINEAR, wrap: g.REPEAT });
      const persp = (asp) => M4.persp(0.9, asp, 0.1, 20);
      const view = M4.lookAt([0, 0.6, 3], [0, 0, 0]);
      const phase = (t, n) => Math.floor(t / 1.6) % n;
      const L = {};
      const pv = {};
      if (E('WEBGL_polygon_mode')) pv.WEBGL_polygon_mode = { label: 'FILL ↔ LINE', run(t, w, h) {
        const e = E('WEBGL_polygon_mode'), line = phase(t, 2) === 1;
        g.enable(g.DEPTH_TEST);
        e.polygonModeWEBGL(g.FRONT_AND_BACK, line ? e.LINE_WEBGL : e.FILL_WEBGL);
        const m = M4.mul(M4.rotY(t * 0.6), M4.rotX(0.3));
        p3.use().set({ u_mvp: M4.mul(persp(w / h), M4.mul(view, m)), u_m: m, u_col: S.A1 }); sphere.draw();
        e.polygonModeWEBGL(g.FRONT_AND_BACK, e.FILL_WEBGL);
        g.disable(g.DEPTH_TEST);
        return line ? 'polygonModeWEBGL(FRONT_AND_BACK, LINE_WEBGL)' : 'polygonModeWEBGL(FRONT_AND_BACK, FILL_WEBGL)';
      } };
      if (E('EXT_depth_clamp')) pv.EXT_depth_clamp = { label: '', run(t, w, h) {
        const e = E('EXT_depth_clamp'), on = phase(t, 2) === 1;
        g.enable(g.DEPTH_TEST); if (on) g.enable(e.DEPTH_CLAMP_EXT);
        const m = M4.mul(M4.translate(0, 0, 1.4 + Math.sin(t) * 0.5), M4.mul(M4.rotY(t * 0.7), M4.rotX(t * 0.4)));
        const vw = M4.lookAt([0, 0, 3], [0, 0, 0]);
        p3.use().set({ u_mvp: M4.mul(M4.persp(0.9, w / h, 1.15, 20), M4.mul(vw, m)), u_m: m, u_col: S.A2 }); cube.draw();
        g.disable(e.DEPTH_CLAMP_EXT); g.disable(g.DEPTH_TEST);
        return on ? 'DEPTH_CLAMP_EXT on · near-plane cut filled' : 'DEPTH_CLAMP_EXT off · near plane clips';
      } };
      if (E('EXT_clip_control')) pv.EXT_clip_control = { label: '', run(t, w, h) {
        const e = E('EXT_clip_control'), up = phase(t, 2) === 1;
        e.clipControlEXT(up ? e.UPPER_LEFT_EXT : e.LOWER_LEFT_EXT, e.NEGATIVE_ONE_TO_ONE_EXT);
        u.tex(0, tex); p2.use().set({ u_tex: 0, u_rect: [-0.15, 0, 0.8 * h / w, 0.8], u_uv: [0, 0, 1, 1] });
        quad.draw(g.TRIANGLE_STRIP);
        p3.use().set({ u_mvp: M4.mul(M4.translate(0.75, 0.55, 0), M4.scale(0.18 * h / w, 0.18, 0.18)), u_m: M4.ident(), u_col: S.A2 }); cube.draw();
        e.clipControlEXT(e.LOWER_LEFT_EXT, e.NEGATIVE_ONE_TO_ONE_EXT);
        return up ? 'clipControlEXT(UPPER_LEFT_EXT, …) · image flips' : 'clipControlEXT(LOWER_LEFT_EXT, …) · default';
      } };
      if (E('EXT_polygon_offset_clamp')) pv.EXT_polygon_offset_clamp = { label: '', run(t, w, h) {
        const e = E('EXT_polygon_offset_clamp'), ph = phase(t, 3);
        g.enable(g.DEPTH_TEST);
        const m = M4.mul(M4.rotX(-1.2), M4.rotZ(t * 0.3));
        const mvp = M4.mul(persp(w / h), M4.mul(M4.lookAt([0, 0.3, 2.6], [0, 0, 0]), m));
        p3.use().set({ u_mvp: mvp, u_m: m, u_col: [0.25, 0.27, 0.32] }); cube.draw();
        if (ph > 0) { g.enable(g.POLYGON_OFFSET_FILL); e.polygonOffsetClampEXT(-2, -4, ph === 1 ? 0 : -0.00002); }
        // the +Z face again as a decal, tilted a hair so it crosses the base face
        p3.set({ u_col: S.A1, u_mvp: M4.mul(mvp, M4.mul(M4.translate(0, 0, 0.5), M4.mul(M4.rotX(0.015 * Math.sin(t * 0.7)), M4.translate(0, 0, -0.5)))) });
        cube.draw(g.TRIANGLES, 6, 24); // the +Z face again, as a decal
        g.disable(g.POLYGON_OFFSET_FILL); e.polygonOffsetClampEXT(0, 0, 0); g.disable(g.DEPTH_TEST);
        return ['no offset · the decal z-fights', 'polygonOffsetClampEXT(−2, −4, 0) · unclamped', 'clamp −0.00002 · bias capped, fighting returns'][ph];
      } };
      if (E('EXT_texture_mirror_clamp_to_edge')) pv.EXT_texture_mirror_clamp_to_edge = { label: 'REPEAT · MIRRORED_REPEAT · MIRROR_CLAMP_TO_EDGE_EXT', run(t, w, h) {
        const e = E('EXT_texture_mirror_clamp_to_edge');
        const modes = [g.REPEAT, g.MIRRORED_REPEAT, e.MIRROR_CLAMP_TO_EDGE_EXT];
        u.tex(0, tex); g.bindTexture(g.TEXTURE_2D, tex);
        const sc = 1.5 + Math.sin(t * 0.8) * 0.6;
        modes.forEach((md, i) => {
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, md); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, md);
          p2.use().set({ u_tex: 0, u_rect: [-0.66 + i * 0.66, 0, 0.31, 0.85], u_uv: [0.5 - sc, 0.5 - sc, sc * 2, sc * 2] }); quad.draw(g.TRIANGLE_STRIP);
        });
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.REPEAT);
        return null;
      } };
      if (E('EXT_texture_filter_anisotropic')) {
        const e = E('EXT_texture_filter_anisotropic');
        const at = u.texture({ source: S.testCanvas(256, ''), filter: g.LINEAR, wrap: g.REPEAT, mipmap: true });
        const maxA = g.getParameter(e.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        const pf = u.program(`
attribute vec2 a_pos; uniform mat4 u_mvp; varying vec2 v_uv; void main() { v_uv = a_pos * 6.0; gl_Position = u_mvp * vec4(a_pos.x * 4.0, 0.0, a_pos.y * 8.0, 1.0); }`, `
uniform sampler2D u_tex; varying vec2 v_uv; void main() { gl_FragColor = texture2D(u_tex, v_uv); }`);
        pv.EXT_texture_filter_anisotropic = { label: '', run(t, w, h) {
          g.bindTexture(g.TEXTURE_2D, at);
          g.enable(g.SCISSOR_TEST);
          [1, maxA].forEach((a, i) => {
            g.texParameterf(g.TEXTURE_2D, e.TEXTURE_MAX_ANISOTROPY_EXT, a);
            g.viewport(i * (w >> 1), 0, w >> 1, h); g.scissor(i * (w >> 1), 0, w >> 1, h);
            const mvp = M4.mul(M4.persp(0.9, (w >> 1) / h, 0.05, 30), M4.lookAt([0, 0.5, 2 + Math.sin(t * 0.5) * 0.4], [0, 0.3, -3]));
            pf.use().set({ u_tex: 0, u_mvp: mvp }); quad.draw(g.TRIANGLE_STRIP);
          });
          g.disable(g.SCISSOR_TEST); g.viewport(0, 0, w, h);
          return `TEXTURE_MAX_ANISOTROPY_EXT 1 (left) · ${maxA} (right)`;
        } };
      }
      if (E('EXT_blend_minmax')) {
        const pc = u.program(`
attribute vec2 a_pos; uniform vec3 u_c; uniform float u_asp; varying vec2 v_l; void main() { v_l = a_pos; gl_Position = vec4(u_c.xy + a_pos * vec2(u_c.z / u_asp, u_c.z), 0.0, 1.0); }`, `
uniform vec3 u_col; varying vec2 v_l; void main() { float d = length(v_l); if (d > 1.0) discard; gl_FragColor = vec4(u_col * (1.0 - d * d), 1.0); }`);
        pv.EXT_blend_minmax = { label: '', run(t, w, h) {
          const e = E('EXT_blend_minmax'), mx = phase(t, 2) === 0;
          if (!mx) { g.clearColor(1, 1, 1, 1); g.clear(g.COLOR_BUFFER_BIT); }
          g.enable(g.BLEND); g.blendEquation(mx ? e.MAX_EXT : e.MIN_EXT);
          [[S.A1, 0], [S.A2, 2.1], [[0.93, 0.91, 0.88], 4.2]].forEach(([c, o]) => { pc.use().set({ u_c: [Math.cos(t + o) * 0.35, Math.sin(t + o) * 0.3, 0.6], u_asp: w / h, u_col: mx ? c : c.map((v) => 1 - v * 0.8) }); quad.draw(g.TRIANGLE_STRIP); });
          g.blendEquation(g.FUNC_ADD); g.disable(g.BLEND);
          return mx ? 'blendEquation(MAX_EXT)' : 'blendEquation(MIN_EXT) on white';
        } };
      }
      if (E('OES_standard_derivatives')) {
        const pd = u.program(`attribute vec2 a_pos; varying vec2 v_p; void main() { v_p = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`, G.colors + `
#extension GL_OES_standard_derivatives : enable
uniform float u_t; uniform float u_asp; varying vec2 v_p;
void main() {
  vec2 p = v_p * vec2(u_asp, 1.0) * (3.0 + sin(u_t * 0.5) * 1.5);
  float f = length(p) * 4.0 - u_t;
  float w = fwidth(f);
  float aa = smoothstep(w, -w, abs(fract(f) - 0.5) - 0.25);
  float hard = step(abs(fract(f) - 0.5), 0.25);
  float l = v_p.x < 0.0 ? hard : aa;
  gl_FragColor = vec4(mix(INK, v_p.x < 0.0 ? A2 : A1, l), 1.0);
}`);
        pv.OES_standard_derivatives = { label: 'left: step() · right: fwidth() anti-aliased', run(t, w, h) { pd.use().set({ u_t: t, u_asp: w / h }); quad.draw(g.TRIANGLE_STRIP); return null; } };
      }
      if (E('ANGLE_instanced_arrays')) {
        const e = E('ANGLE_instanced_arrays');
        const off = []; for (let i = 0; i < 400; i++) off.push((i % 20) / 19 * 2 - 1, Math.floor(i / 20) / 19 * 2 - 1);
        const ob = u.buffer(g.ARRAY_BUFFER, new Float32Array(off));
        const tri = u.buffer(g.ARRAY_BUFFER, new Float32Array([0, 1, -0.87, -0.5, 0.87, -0.5]));
        const pi = u.program(`attribute vec2 a_pos; attribute vec2 a_i0; uniform float u_t; uniform float u_asp; varying float v_k;
void main() { float a = u_t + length(a_i0) * 3.0; vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * a_pos * 0.04; v_k = 0.5 + 0.5 * sin(a);
  gl_Position = vec4((a_i0 * 0.85 + q) * vec2(1.0 / u_asp, 1.0), 0.0, 1.0); }`, G.colors + `varying float v_k; void main() { gl_FragColor = vec4(mix(A1, A2, v_k), 1.0); }`);
        pv.ANGLE_instanced_arrays = { label: '400 instances · drawArraysInstancedANGLE', run(t, w, h) {
          pi.use().set({ u_t: t, u_asp: w / h });
          u.bindAttribs([{ buffer: tri, loc: 0, size: 2 }, { buffer: ob, loc: 4, size: 2, divisor: 1 }]);
          e.drawArraysInstancedANGLE(g.TRIANGLES, 0, 3, 400);
          u.bindAttribs([{ buffer: tri, loc: 0, size: 2 }]);
          return null;
        } };
      }
      s.previews = pv; void L;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const W = ctx.width, H = ctx.height, dpr = ctx.dpr;
      const cw = ctx.cssWidth, chh = ctx.cssHeight;
      const panelW = cw > 760 && !ctx.capture ? 370 : 0;
      // layout in css px
      const fx = 18, fy = 50, fw = Math.max(200, cw - panelW - 36), fh = chh - fy - 70;
      const vis = s.tiles.filter((tl) => params.filter === 0 || (params.filter === 1 ? tl.ok : !tl.ok));
      const n = Math.max(1, vis.length);
      // pick the column count that gives the largest label scale
      let cols = 1, best = 0;
      for (let c = 1; c <= 10; c++) {
        const r = Math.ceil(n / c), w = fw / c - 8, h = Math.min(66, fh / r) - 8;
        const sc = Math.min((w * 0.88) / 384, h / 96);
        if (h >= 22 && sc > best) { best = sc; cols = c; }
      }
      const rows = Math.ceil(n / cols);
      const tw = fw / cols, th = Math.min(66, Math.max(30, fh / rows));
      const oy = fy + Math.max(0, (fh - th * rows) / 2);
      s.tiles.forEach((tl) => (tl.vis = 0));
      vis.forEach((tl, k) => {
        tl.vis = 1;
        const x = fx + (k % cols) * tw + tw / 2, y = oy + Math.floor(k / cols) * th + th / 2;
        tl.x = tl.w ? tl.x + (x - tl.x) * damp(10, dt) : x; tl.y = tl.w ? tl.y + (y - tl.y) * damp(10, dt) : y;
        tl.w = tw - 8; tl.h = th - 8;
      });
      // pointer / ghost
      let px = input.x, py = input.y, live = input.hover && !ctx.capture;
      if (!live) { const a = t * 0.35; px = fx + fw * (0.5 + 0.38 * Math.cos(a)); py = oy + th * rows * (0.5 + 0.36 * Math.sin(a * 1.7)); }
      s.hover = -1;
      for (const tl of s.tiles) if (tl.vis && Math.abs(px - tl.x) < tl.w / 2 && Math.abs(py - tl.y) < tl.h / 2) s.hover = tl.i;
      for (const c of input.clicks) {
        const hit = s.tiles.find((tl) => tl.vis && Math.abs(c.x - tl.x) < tl.w / 2 && Math.abs(c.y - tl.y) < tl.h / 2);
        const nsel = hit ? hit.n : null;
        if (nsel !== s.sel) { s.sel = nsel; this.showPanel(ctx, s); }
      }
      if (s.lastPreview !== params.preview) { s.lastPreview = params.preview; this.showPanel(ctx, s); }
      const k = damp(12, dt);
      const D = s.quadData; let o = 0;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const tl of s.tiles) {
        tl.hov += ((tl.i === s.hover ? 1 : 0) - tl.hov) * k;
        tl.sel += ((tl.n === s.sel ? 1 : 0) - tl.sel) * k;
        if (!tl.vis) continue;
        for (const c of corners) {
          D[o++] = c[0]; D[o++] = c[1];
          D[o++] = tl.x * dpr; D[o++] = tl.y * dpr; D[o++] = tl.w * dpr; D[o++] = tl.h * dpr;
          D[o++] = tl.i; D[o++] = (tl.ok ? 1 : 0) + tl.hue * 0.499; D[o++] = tl.hov; D[o++] = tl.sel;
        }
      }
      const verts = o / 10;
      s.m[0] += (px / cw - s.m[0]) * k; s.m[1] += (1 - py / chh - s.m[1]) * k;
      gl.viewport(0, 0, W, H);
      s.bg.use().set({ u_res: [W, H], u_m: s.m, u_t: t });
      util.drawFullscreen();
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.vbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, D.subarray(0, o));
      util.bindAttribs([{ buffer: s.vbuf, loc: 0, size: 2, stride: 40, offset: 0 }, { buffer: s.vbuf, loc: 4, size: 4, stride: 40, offset: 8 }, { buffer: s.vbuf, loc: 5, size: 4, stride: 40, offset: 24 }]);
      util.tex(0, s.atlasTex);
      s.prog.use().set({ u_res: [W, H], u_atlas: 0, u_t: t, u_asz: s.asz });
      gl.drawArrays(gl.TRIANGLES, 0, verts);
      gl.disable(gl.BLEND);
      ctx.canvas.style.cursor = s.hover >= 0 ? 'pointer' : 'default';
      // live preview in the panel (secondary context)
      if (s.pv && s.pgl && !s.pgl.isContextLost()) {
        const pg = s.pgl, r = s.pcv.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (s.pcv.width !== w || s.pcv.height !== h) { s.pcv.width = w; s.pcv.height = h; }
        pg.viewport(0, 0, w, h); pg.clearColor(0.03, 0.033, 0.045, 1); pg.clear(pg.COLOR_BUFFER_BIT | pg.DEPTH_BUFFER_BIT);
        const lab = s.pv.run(t, w, h);
        if (lab && s.pvLabel && s.pvLabel.textContent !== lab) s.pvLabel.textContent = lab;
      }
    },
    dispose(ctx, s) {
      if (s.putil) s.putil.disposeAll();
      if (s.pgl) { const lc = s.pgl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext(); }
    },
  });
})();
