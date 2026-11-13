/* I · Rendering Techniques — lighting models, normal mapping, shadow mapping, environment
 * reflection and refraction, bloom and post-processing, toon outlines and ray-marched SDFs. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, clamp, damp } = S.math;
  const G = S.GLSL;
  const CAT = 'Rendering Techniques';

  /* ---------------------------------------------------------------- */
  /* Shared helpers                                                    */
  /* ---------------------------------------------------------------- */
  const panel = (ctx, cls, html) => { const el = document.createElement('div'); el.className = 'ov-panel ' + cls; el.innerHTML = html; ctx.overlay.appendChild(el); return el; };
  const label = (ctx, text) => { const el = document.createElement('div'); el.className = 'ov-label'; el.textContent = text; ctx.overlay.appendChild(el); return el; };
  const freeTarget = (util, t) => { if (t) util.release(t.fb, t.tex, t.depth); };
  function tryTarget(util, w, h, types, opts = {}) {
    for (const type of types) { try { return { t: util.target(w, h, Object.assign({}, opts, { type })), type }; } catch (e) { /* next */ } }
    return null;
  }
  /** World point → CSS pixels (x right, y down) or null when behind the camera. */
  function project(vp, p, ctx) {
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (w <= 0) return null;
    return [(x / w * 0.5 + 0.5) * ctx.cssWidth, (1 - (y / w * 0.5 + 0.5)) * ctx.cssHeight];
  }
  const plane = (size, y = 0) => S.geo.surface(1, 1, (u, v) => ({ p: [(u - 0.5) * size, y, (v - 0.5) * size], n: [0, 1, 0] }));
  const clearInk = (gl) => { gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); };
  const MESH_VS = `
attribute vec3 a_pos; attribute vec3 a_nrm; attribute vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_m;
varying vec3 v_n; varying vec3 v_w; varying vec2 v_uv;
void main() { vec4 w = u_m * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_m) * a_nrm; v_uv = a_uv; gl_Position = u_vp * w; }`;

  /* ---------------------------------------------------------------- */
  /* 1. Lighting models                                                */
  /* ---------------------------------------------------------------- */
  const MODELS = ['Gouraud', 'Phong', 'Blinn-Phong', 'Lambert', 'Toon'];
  const SHADE = G.colors + `
uniform vec3 u_light; uniform vec3 u_eye; uniform float u_shin; uniform vec3 u_col;
vec3 shade(vec3 n, vec3 w, float model) {
  vec3 L = normalize(u_light - w), V = normalize(u_eye - w);
  float nl = dot(n, L), diff = max(nl, 0.0), spec = 0.0, rim = 0.0;
  vec3 amb = mix(vec3(0.05, 0.055, 0.075), vec3(0.1, 0.12, 0.16), n.y * 0.5 + 0.5);
  if (model < 1.5) spec = pow(max(dot(reflect(-L, n), V), 0.0), u_shin);           // Gouraud + Phong: R·V
  else if (model < 2.5) spec = pow(max(dot(n, normalize(L + V)), 0.0), u_shin * 4.0); // Blinn: N·H
  else if (model > 3.5) {                                                           // Toon: bands + hard highlight + rim
    diff = 0.15 + smoothstep(0.0, 0.03, nl) * 0.45 + smoothstep(0.55, 0.58, nl) * 0.4;
    spec = smoothstep(0.55, 0.58, pow(max(dot(n, normalize(L + V)), 0.0), u_shin * 2.0));
    rim = smoothstep(0.68, 0.72, 1.0 - max(dot(n, V), 0.0)) * step(0.0, nl) * 0.35;
  }
  spec *= step(0.0, nl);
  return u_col * (amb + diff * 0.95) + spec * vec3(1.0, 0.97, 0.92) * 0.85 + rim * BONE;
}`;
  S.register({
    id: 'lighting',
    title: 'Lighting Models',
    category: CAT,
    thumb: 'wide',
    hint: 'drag the light · drag elsewhere to orbit',
    description: 'Five classic ways of lighting the same surface, side by side. Gouraud evaluates the lighting at each vertex and interpolates the colour, so highlights smear across triangles; Phong interpolates the normal and lights every fragment; Blinn-Phong swaps the reflection vector for the cheaper half vector; Lambert has no highlight at all; Toon quantises the result into bands. The split view runs one draw per band, clipped with the scissor test.',
    interact: [['Drag the light', 'move the white marker in the view plane'], ['Drag elsewhere', 'orbit the camera'], ['Model', 'split view or one model full screen']],
    features: ['per-vertex (Gouraud) vs per-fragment lighting', 'reflect(-L, N) · V (Phong)', 'N · normalize(L + V) (Blinn-Phong)', 'quantised diffuse (Toon)', 'gl.scissor split screen'],
    params: [
      { key: 'model', label: 'Model', type: 'select', options: ['Split', 'Gouraud', 'Phong', 'Blinn', 'Lambert', 'Toon'], value: 0 },
      { key: 'mesh', label: 'Mesh', type: 'select', options: ['Sphere', 'Knot', 'Torus'], value: 0 },
      { key: 'shin', label: 'Shininess', type: 'range', min: 2, max: 128, step: 1, value: 24 },
      { key: 'orbit', label: 'Light orbit', type: 'toggle', value: true },
    ],
    code: `// Gouraud: in the vertex shader
v_col = shade(normalize(mat3(u_m) * a_nrm), world.xyz);
// Phong: per fragment, reflection vector
spec = pow(max(dot(reflect(-L, N), V), 0.0), u_shin);
// Blinn-Phong: half vector
spec = pow(max(dot(N, normalize(L + V)), 0.0), u_shin * 4.0);`,
    init(ctx) {
      const { util } = ctx;
      const prog = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_m; uniform float u_model;
varying vec3 v_n; varying vec3 v_w; varying vec3 v_g;
` + SHADE + `
void main() {
  vec4 w = u_m * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_m) * a_nrm;
  v_g = u_model < 0.5 ? shade(normalize(v_n), v_w, 0.0) : vec3(0.0);
  gl_Position = u_vp * w;
}`, SHADE + `
uniform float u_model; uniform float u_emit; uniform float u_grid;
varying vec3 v_n; varying vec3 v_w; varying vec3 v_g;
void main() {
  if (u_emit > 0.5) { gl_FragColor = vec4(BONE * 1.2, 1.0); return; }
  vec3 c = u_model < 0.5 ? v_g : shade(normalize(v_n), v_w, u_model);
  if (u_grid > 0.5) {
    vec2 g = abs(fract(v_w.xz * 2.0) - 0.5);
    c += step(0.47, max(g.x, g.y)) * 0.02;
    c *= 1.0 - smoothstep(2.5, 4.0, length(v_w.xz));
  }
  gl_FragColor = vec4(c, 1.0);
}`);
      const meshes = [S.geo.upload(util, S.geo.sphere(28, 14, 1.15)), S.geo.upload(util, S.geo.torusKnot(180, 16, 0.3, 1.0, 0.42)), S.geo.upload(util, S.geo.torus(40, 14, 1.0, 0.4))];
      const marker = S.geo.upload(util, S.geo.sphere(16, 8, 0.07));
      const floor = S.geo.upload(util, plane(16, -1.4));
      const labels = MODELS.map((m) => label(ctx, m));
      return { prog, meshes, marker, floor, labels, light: [1.2, 1.2, 2.6], ang: 0.7, drag: false, cam: new S.OrbitCam({ dist: 5.2, pitch: 0.28, yaw: 0.3 }), bcam: new S.OrbitCam() };
    },
    /** Views: full screen, or five vertical bands each with its own camera distance so the mesh fits. */
    views(ctx, s) {
      const split = ctx.params.model === 0, n = split ? 5 : 1;
      const out = [];
      for (let i = 0; i < n; i++) {
        const x0 = Math.round(i * ctx.width / n), x1 = Math.round((i + 1) * ctx.width / n);
        const asp = (x1 - x0) / ctx.height;
        const c = s.bcam; c.yaw = s.cam.yaw; c.pitch = s.cam.pitch; c.target = s.cam.target; c.dist = s.cam.dist * Math.max(1, 0.6 / asp);
        out.push({ x0, x1, asp, cssX: x0 / ctx.dpr, cssW: (x1 - x0) / ctx.dpr, vp: M4.mul(c.proj(asp), c.view()), eye: c.eye(), model: split ? i : ctx.params.model - 1, dist: c.dist });
      }
      return out;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const W = ctx.width, H = ctx.height;
      let views = this.views(ctx, s);
      const under = views.find((v) => input.x >= v.cssX && input.x < v.cssX + v.cssW) || views[0];
      const near = (v) => { const sp = project(v.vp, s.light, { cssWidth: v.cssW, cssHeight: ctx.cssHeight }); return sp && Math.hypot(sp[0] + v.cssX - input.x, sp[1] - input.y) < 34; };
      if (input.down && !s.wasDown) { s.drag = near(under); s.dragView = under; }
      if (!input.down) s.drag = false;
      s.wasDown = input.down;
      if (s.drag) {
        const v = s.dragView, c = s.bcam;
        c.yaw = s.cam.yaw; c.pitch = s.cam.pitch; c.target = s.cam.target; c.dist = v.dist;
        const r = c.ray(((input.x - v.cssX) / v.cssW) * 2 - 1, input.ny, v.asp);
        const hit = S.math.Ray.plane(r.origin, r.dir, s.light, c.basis().fwd);
        if (hit) s.light = [clamp(hit[0], -4, 4), clamp(hit[1], -1.1, 4), clamp(hit[2], -4, 4)];
      } else if (params.orbit) {
        s.phase = (s.phase || 0) + dt * 0.55;
        const a = s.cam.yaw + Math.sin(s.phase) * 0.85;
        const R = clamp(Math.hypot(s.light[0], s.light[2]), 2.2, 4);
        s.light = [Math.sin(a) * R, s.light[1], Math.cos(a) * R];
      }
      s.cam.update(s.drag ? Object.assign({}, input, { dragging: false }) : input, dt, false);
      views = this.views(ctx, s);
      gl.viewport(0, 0, W, H);
      clearInk(gl);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.SCISSOR_TEST);
      const mesh = s.meshes[params.mesh];
      const m = M4.mul(M4.rotY(t * 0.25), M4.rotX(params.mesh === 2 ? 1.1 : 0.2));
      s.labels.forEach((L) => { L.style.display = 'none'; });
      views.forEach((v, i) => {
        gl.viewport(v.x0, 0, v.x1 - v.x0, H); gl.scissor(v.x0, 0, v.x1 - v.x0, H);
        s.prog.use().set({ u_vp: v.vp, u_light: s.light, u_eye: v.eye, u_shin: params.shin, u_model: v.model, u_emit: 0 });
        s.prog.set({ u_m: m, u_col: [0.24, 0.62, 0.72], u_grid: 0 }); mesh.draw();
        s.prog.set({ u_m: M4.ident(), u_col: [0.16, 0.16, 0.19], u_grid: 1 }); s.floor.draw();
        s.prog.set({ u_m: M4.translate(s.light[0], s.light[1], s.light[2]), u_emit: 1 }); s.marker.draw();
        const L = s.labels[v.model]; L.style.display = ''; L.style.left = v.cssX + (views.length > 1 ? 12 : v.cssW - 140) + 'px'; L.style.top = '54px';
        L.style.color = views.length > 1 ? '' : 'var(--acc1)';
        if (i) { gl.clearColor(0.93, 0.91, 0.88, 0.2); gl.scissor(v.x0, 0, Math.max(1, ctx.dpr), H); gl.clear(gl.COLOR_BUFFER_BIT); }
      });
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
      gl.viewport(0, 0, W, H);
      ctx.canvas.style.cursor = s.drag ? 'grabbing' : input.hover && near(under) ? 'grab' : 'default';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Normal mapping                                                 */
  /* ---------------------------------------------------------------- */
  function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  /** Procedural height + albedo (CPU, 512²), normal map from central differences of the height. */
  function makeMaps(kind, N = 512) {
    const hgt = new Float32Array(N * N), alb = new Uint8Array(N * N * 4), nrm = new Uint8Array(N * N * 4), hb = new Uint8Array(N * N * 4);
    const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const pal = [[0.16, 0.17, 0.2], [0.2, 0.21, 0.24], [0.13, 0.14, 0.17], [0.22, 0.84, 0.91], [1.0, 0.31, 0.64], [0.6, 0.58, 0.55]];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let h = 0, id = 0, edge = 0;
      if (kind === 0) { // bricks: 8 rows, offset every other row
        const rows = 8, cols = 4, ry = v * rows, row = Math.floor(ry), rx = u * cols + (row % 2) * 0.5, col = Math.floor(rx);
        const fx = rx - col, fy = ry - row;
        edge = Math.min(fx, 1 - fx) * 2.2, edge = Math.min(edge, Math.min(fy, 1 - fy) * 1.1 * 2);
        h = sm(0.03, 0.12, edge * 0.5); id = hash2(col % cols, row);
      } else if (kind === 1) { // hexagons
        const sc = 6, px = u * sc, py = v * sc * 1.1547;
        const qx = px - py * 0.5, qy = py;
        let best = 9, bid = 0;
        for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
          const cx = Math.floor(qx) + i, cy = Math.floor(qy) + j;
          const wx = cx + cy * 0.5, wy = cy;
          const dx = px - wx, dy = (py - wy) * 0.866;
          const d = Math.max(Math.abs(dx), Math.abs(dx * 0.5 + dy * 0.866), Math.abs(dx * 0.5 - dy * 0.866));
          if (d < best) { best = d; bid = hash2(((cx % sc) + sc) % sc, ((cy % 7) + 7) % 7); }
        }
        edge = (0.5 - best) * 2; h = sm(0.0, 0.25, edge); id = bid;
      } else { // studs: domes on a grid
        const sc = 8, fx = u * sc - Math.floor(u * sc) - 0.5, fy = v * sc - Math.floor(v * sc) - 0.5;
        const r = Math.hypot(fx, fy);
        h = 0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - (r / 0.36) ** 2)); edge = 1 - r; id = hash2(Math.floor(u * sc), Math.floor(v * sc));
      }
      const n = hash2(x * 0.37, y * 0.71);
      h = h * 0.94 + n * 0.04 + Math.sin(u * 60 + v * 23) * 0.01;
      hgt[y * N + x] = clamp(h, 0, 1);
      const pi = id < 0.08 ? 3 : id < 0.14 ? 4 : id < 0.22 ? 5 : Math.floor(id * 30) % 3;
      const c = pal[pi], k = h < 0.3 ? 0.35 : 0.8 + 0.2 * Math.sin(u * 37 + Math.sin(v * 23) * 2) * Math.cos(v * 29) + n * 0.05;
      alb.set([c[0] * k * 255, c[1] * k * 255, c[2] * k * 255, 255], (y * N + x) * 4);
    }
    const H = (x, y) => hgt[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 6, dy = (H(x, y + 1) - H(x, y - 1)) * 6;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      nrm[o] = (-dx / l * 0.5 + 0.5) * 255; nrm[o + 1] = (-dy / l * 0.5 + 0.5) * 255; nrm[o + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
      const hv = H(x, y) * 255; hb[o] = hb[o + 1] = hb[o + 2] = hv; hb[o + 3] = 255;
    }
    return { alb, nrm, hb, N };
  }
  S.register({
    id: 'normal-mapping',
    title: 'Normal Mapping',
    category: CAT,
    thumb: 'portrait',
    hint: 'move to steer the light · drag to orbit',
    description: 'Fine surface detail without extra triangles. A height map is generated procedurally, turned into a normal map and an albedo map, and uploaded as textures. There is no tangent attribute: the fragment shader builds the tangent frame from screen-space derivatives of position and texture coordinates (OES_standard_derivatives). Parallax occlusion mapping then marches the height map along the view ray so bricks appear to have real depth.',
    interact: [['Move', 'the point light follows the pointer'], ['Drag', 'orbit the camera'], ['Parallax · Strength', 'height marching and normal intensity']],
    features: ['OES_standard_derivatives: dFdx / dFdy', 'cotangent frame without tangents', 'parallax occlusion mapping (constant loop + break)', 'procedural maps uploaded with texImage2D', 'REPEAT wrap + mipmaps'],
    params: [
      { key: 'object', label: 'Object', type: 'select', options: ['Wall', 'Sphere', 'Torus'], value: 0 },
      { key: 'pattern', label: 'Pattern', type: 'select', options: ['Bricks', 'Hexagons', 'Studs'], value: 0, restart: true },
      { key: 'strength', label: 'Map strength', type: 'range', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'pom', label: 'Parallax occlusion', type: 'toggle', value: true },
      { key: 'depth', label: 'Parallax depth', type: 'range', min: 0, max: 0.12, step: 0.005, value: 0.05 },
      { key: 'maps', label: 'Show maps', type: 'toggle', value: true },
    ],
    code: `#extension GL_OES_standard_derivatives : enable
vec3 dp1 = dFdx(v_w), dp2 = dFdy(v_w);
vec2 du1 = dFdx(v_uv), du2 = dFdy(v_uv);
vec3 T = cross(dp2, N) * du1.x + cross(N, dp1) * du2.x;
vec3 B = cross(dp2, N) * du1.y + cross(N, dp1) * du2.y;
mat3 TBN = mat3(T, B, N) * inversesqrt(max(dot(T, T), dot(B, B)));
vec3 n = normalize(TBN * (texture2D(u_nrm, uv).xyz * 2.0 - 1.0));`,
    init(ctx) {
      const { gl, util } = ctx;
      if (!util.ext('OES_standard_derivatives')) { ctx.message('OES_standard_derivatives is not supported here.\nThe tangent frame cannot be built from derivatives.'); return { off: true }; }
      const maps = makeMaps(ctx.params.pattern);
      const T = (data, mip) => util.texture({ width: maps.N, height: maps.N, data, wrap: gl.REPEAT, mipmap: mip });
      const s = { alb: T(maps.alb, true), nrm: T(maps.nrm, true), hgt: T(maps.hb, false) };
      s.prog = util.program(MESH_VS, '#extension GL_OES_standard_derivatives : enable\n' + G.colors + `
uniform sampler2D u_alb; uniform sampler2D u_nrm; uniform sampler2D u_hgt;
uniform vec3 u_light; uniform vec3 u_eye; uniform float u_str; uniform float u_pom; uniform float u_depth; uniform vec2 u_tile;
varying vec3 v_n; varying vec3 v_w; varying vec2 v_uv;
void main() {
  vec3 N = normalize(v_n);
  vec2 uv = v_uv * u_tile;
  vec3 dp1 = dFdx(v_w), dp2 = dFdy(v_w);
  vec2 du1 = dFdx(uv), du2 = dFdy(uv);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x;
  vec3 B = dp2p * du1.y + dp1p * du2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  T *= im; B *= im;
  vec3 V = normalize(u_eye - v_w);
  if (u_pom > 0.5) {
    vec3 vt = normalize(vec3(dot(V, T), dot(V, B), dot(V, N)));
    const float NL = 32.0;
    vec2 duv = vt.xy / max(vt.z, 0.25) * u_depth / NL;
    float layer = 0.0, d = 1.0 - texture2D(u_hgt, uv).r;
    vec2 c = uv;
    for (int i = 0; i < 48; i++) {
      if (layer >= d || float(i) >= NL) break;
      c -= duv; layer += 1.0 / NL; d = 1.0 - texture2D(u_hgt, c).r;
    }
    vec2 pc = c + duv;
    float after = d - layer, before = (1.0 - texture2D(u_hgt, pc).r) - layer + 1.0 / NL;
    uv = mix(c, pc, clamp(after / (after - before + 1e-5), 0.0, 1.0));
  }
  vec3 tn = texture2D(u_nrm, uv).xyz * 2.0 - 1.0;
  tn.xy *= u_str;
  vec3 n = normalize(T * tn.x + B * tn.y + N * tn.z);
  vec3 alb = texture2D(u_alb, uv).rgb;
  vec3 Lv = u_light - v_w; float dist = length(Lv); vec3 L = Lv / dist;
  float att = 1.6 / (1.0 + dist * dist * 0.25);
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + V)), 0.0), 48.0) * step(0.0, dot(N, L));
  vec3 col = alb * (0.07 + diff * att * 1.4) + spec * att * 0.5 * BONE;
  gl_FragColor = vec4(col, 1.0);
}`);
      s.marker = util.program(MESH_VS, G.colors + `varying vec3 v_n; varying vec3 v_w; varying vec2 v_uv; void main() { gl_FragColor = vec4(BONE * 1.3, 1.0); }`);
      s.quad = util.program(G.fullscreenVS, `uniform sampler2D u_t; varying vec2 v_uv; void main() { gl_FragColor = vec4(texture2D(u_t, v_uv * 2.0).rgb, 1.0); }`);
      s.meshes = [
        S.geo.upload(util, S.geo.surface(1, 1, (u, v) => ({ p: [(u - 0.5) * 3.4, (v - 0.5) * 3.4, 0], n: [0, 0, 1] }))),
        S.geo.upload(util, S.geo.sphere(64, 32, 1.3)),
        S.geo.upload(util, S.geo.torus(96, 32, 1.1, 0.45)),
      ];
      s.tiles = [[2, 2], [6, 3], [8, 2]];
      s.ball = S.geo.upload(util, S.geo.sphere(12, 6, 0.05));
      s.cam = new S.OrbitCam({ dist: 5.4, pitch: 0.1, yaw: 0.35, minPitch: -1.2 });
      s.light = [0.6, 0.6, 1.2];
      s.mapLabels = ['ALBEDO', 'NORMAL', 'HEIGHT'].map((n) => label(ctx, n));
      return s;
    },
    frame(ctx, s, t, dt) {
      if (s.off) return;
      const { gl, util, input, params } = ctx;
      s.cam.update(input, dt, false);
      if (!input.dragging && !input.hover) s.cam.yaw += (0.35 + Math.sin(t * 0.3) * 0.35 - s.cam.yaw) * damp(0.8, dt);
      const vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view());
      // light: on a plane facing the camera, slightly in front of the object
      const b = s.cam.basis();
      let target;
      if (input.hover && !input.down) {
        const r = s.cam.ray(input.nx, input.ny, ctx.aspect);
        const pt = S.math.Ray.plane(r.origin, r.dir, V3.scale(b.fwd, -1.1), b.fwd);
        target = pt || s.light;
      } else {
        const a = t * 0.8;
        target = V3.add(V3.add(V3.scale(b.right, Math.cos(a) * 1.2), V3.scale(b.up, Math.sin(a * 1.3) * 0.9)), V3.scale(b.fwd, -1.1));
      }
      for (let i = 0; i < 3; i++) s.light[i] += (target[i] - s.light[i]) * damp(10, dt);
      gl.viewport(0, 0, ctx.width, ctx.height);
      clearInk(gl);
      gl.enable(gl.DEPTH_TEST);
      const obj = params.object;
      const m = obj === 0 ? M4.rotY(Math.sin(t * 0.4) * 0.25) : M4.mul(M4.rotY(t * 0.2), M4.rotX(obj === 2 ? 1.0 : 0.3));
      s.prog.use().set({ u_vp: vp, u_m: m, u_alb: 0, u_nrm: 1, u_hgt: 2, u_light: s.light, u_eye: s.cam.eye(), u_str: params.strength, u_pom: params.pom ? 1 : 0, u_depth: params.depth, u_tile: s.tiles[obj] });
      util.tex(0, s.alb); util.tex(1, s.nrm); util.tex(2, s.hgt);
      s.meshes[obj].draw();
      s.marker.use().set({ u_vp: vp, u_m: M4.translate(s.light[0], s.light[1], s.light[2]) }); s.ball.draw();
      gl.disable(gl.DEPTH_TEST);
      // map thumbnails down the right edge
      const show = params.maps;
      if (show) {
        const sz = Math.round(Math.min(76, ctx.cssHeight * 0.12) * ctx.dpr), pad = Math.round(14 * ctx.dpr);
        [s.alb, s.nrm, s.hgt].forEach((tx, i) => {
          const x = ctx.width - sz - pad, y = ctx.height - Math.round(56 * ctx.dpr) - (i + 1) * (sz + pad);
          gl.viewport(x, y, sz, sz);
          s.quad.use().set({ u_t: 0 }); util.tex(0, tx); util.drawFullscreen();
          const L = s.mapLabels[i]; L.style.display = ''; L.style.left = 'auto'; L.style.right = (pad + sz + 8 * ctx.dpr) / ctx.dpr + 'px'; L.style.top = (ctx.height - y - sz / 2) / ctx.dpr - 5 + 'px';
        });
      } else s.mapLabels.forEach((L) => { L.style.display = 'none'; });
      gl.viewport(0, 0, ctx.width, ctx.height);
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Shadow mapping                                                 */
  /* ---------------------------------------------------------------- */
  const SM_SIZES = [512, 1024, 2048];
  S.register({
    id: 'shadow-map',
    title: 'Shadow Mapping',
    category: CAT,
    thumb: 'square',
    hint: 'drag to orbit · Shift-drag moves the light',
    description: 'Two passes per frame. First the scene is drawn from the light into a depth texture (WEBGL_depth_texture), or, without it, into an RGBA8 texture with depth packed across four bytes. Then the camera pass projects every fragment into light space and compares its depth with the stored one. A small bias avoids shadow acne; percentage-closer filtering averages several comparisons to soften the edge. The shadow map itself is shown in the corner.',
    interact: [['Drag', 'orbit the camera'], ['Shift-drag / second finger', 'move the light'], ['PCF · Bias', 'edge filtering and depth offset']],
    features: ['WEBGL_depth_texture (DEPTH_COMPONENT)', 'RGBA8 packFloat fallback', 'light-space orthographic projection', 'PCF 3×3 · 5×5 · Poisson disk', 'colorMask(false) depth-only pass'],
    params: [
      { key: 'pcf', label: 'Filter', type: 'select', options: ['Hard', 'PCF 3×3', 'PCF 5×5', 'Poisson 16'], value: 2 },
      { key: 'bias', label: 'Depth bias', type: 'range', min: 0, max: 0.01, step: 0.0001, value: 0.0015 },
      { key: 'az', label: 'Light azimuth', type: 'range', min: 0, max: 360, step: 1, value: 40 },
      { key: 'el', label: 'Light elevation', type: 'range', min: 15, max: 80, step: 1, value: 48 },
      { key: 'anim', label: 'Animate light', type: 'toggle', value: true },
      { key: 'size', label: 'Map size', type: 'select', options: ['512', '1024', '2048'], value: 1, restart: true },
    ],
    code: `// pass 1: from the light, depth only
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);   // DEPTH_COMPONENT texture
gl.colorMask(false, false, false, false);
drawScene(lightViewProj);
// pass 2: compare
vec3 p = v_light.xyz / v_light.w * 0.5 + 0.5;
float lit = step(p.z - u_bias, texture2D(u_shadow, p.xy).r);`,
    init(ctx) {
      const { gl, util } = ctx;
      const size = SM_SIZES[ctx.params.size];
      const s = { size };
      const dext = util.ext('WEBGL_depth_texture');
      s.dt = !!dext;
      if (dext) {
        const tex = util.rawTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        try {
          s.fb = util.framebuffer([{ rb: util.renderbuffer(gl.RGBA4, size, size) }], { tex });
          s.smTex = tex;
        } catch (e) { s.dt = false; }
      }
      if (!s.dt) { const t = util.target(size, size, { depth: true, filter: gl.NEAREST }); s.fb = t.fb; s.smTex = t.tex; }
      const DT = s.dt ? 1 : 0;
      s.depthP = util.program(`
attribute vec3 a_pos; uniform mat4 u_vp; uniform mat4 u_m;
void main() { gl_Position = u_vp * u_m * vec4(a_pos, 1.0); }`, G.pack + `
void main() {
#if ${DT}
  gl_FragColor = vec4(1.0);
#else
  gl_FragColor = packFloat(min(gl_FragCoord.z, 0.99999));
#endif
}`);
      s.prog = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_m; uniform mat4 u_lvp;
varying vec3 v_n; varying vec3 v_w; varying vec4 v_l;
void main() { vec4 w = u_m * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_m) * a_nrm; v_l = u_lvp * w; gl_Position = u_vp * w; }`, G.colors + G.pack + G.noise + `
uniform sampler2D u_sm; uniform vec3 u_ldir; uniform vec3 u_col; uniform float u_bias; uniform float u_pcf; uniform float u_texel; uniform float u_floor;
varying vec3 v_n; varying vec3 v_w; varying vec4 v_l;
float D(vec2 uv) {
#if ${DT}
  return texture2D(u_sm, uv).r;
#else
  return unpackFloat(texture2D(u_sm, uv));
#endif
}
float shadow(vec3 p, float bias) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float z = p.z - bias;
  if (u_pcf < 0.5) return step(z, D(p.xy));
  float sum = 0.0, n = 0.0;
  if (u_pcf > 2.5) {
    float rot = hash12(gl_FragCoord.xy) * 6.2832;
    for (int i = 0; i < 16; i++) {
      float r = sqrt((float(i) + 0.5) / 16.0) * 2.5, a = float(i) * 2.39996 + rot;
      sum += step(z, D(p.xy + vec2(cos(a), sin(a)) * r * u_texel)); n += 1.0;
    }
    return sum / n;
  }
  float k = u_pcf > 1.5 ? 2.0 : 1.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    if (abs(float(i)) > k || abs(float(j)) > k) continue;
    sum += step(z, D(p.xy + vec2(float(i), float(j)) * u_texel)); n += 1.0;
  }
  return sum / n;
}
void main() {
  vec3 n = normalize(v_n);
  float nl = dot(n, u_ldir);
  vec3 p = v_l.xyz / v_l.w * 0.5 + 0.5;
  float sh = nl > 0.0 ? shadow(p, u_bias * (1.0 + 4.0 * (1.0 - nl))) : 0.0;
  vec3 base = u_col;
  if (u_floor > 0.5) {
    vec2 g = abs(fract(v_w.xz) - 0.5);
    base += step(0.48, max(g.x, g.y)) * 0.025;
    base *= 1.0 - smoothstep(4.0, 7.0, length(v_w.xz));
  }
  vec3 amb = base * mix(vec3(0.06, 0.07, 0.1), vec3(0.1, 0.12, 0.16), n.y * 0.5 + 0.5);
  vec3 col = amb + base * max(nl, 0.0) * sh * vec3(1.0, 0.96, 0.9) * 1.1;
  gl_FragColor = vec4(col, 1.0);
}`);
      s.thumb = util.program(G.fullscreenVS, G.colors + G.pack + `
uniform sampler2D u_sm; varying vec2 v_uv;
void main() {
#if ${DT}
  float d = texture2D(u_sm, v_uv).r;
#else
  float d = unpackFloat(texture2D(u_sm, v_uv));
#endif
  float k = clamp((d - 0.3) / 0.45, 0.0, 1.0);
  vec3 c = mix(BONE, A1 * 0.25, k);
  if (d > 0.999) c = INK;
  vec2 e = step(v_uv, vec2(0.006)) + step(vec2(0.994), v_uv);
  c = mix(c, A1, clamp(e.x + e.y, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}`);
      s.floor = S.geo.upload(util, plane(16, 0));
      s.knot = S.geo.upload(util, S.geo.torusKnot(220, 22, 0.24, 0.85, 0.36));
      s.cube = S.geo.uploadFlat(util, S.geo.cube());
      s.ball = S.geo.upload(util, S.geo.sphere(32, 16, 0.55));
      s.cam = new S.OrbitCam({ dist: 9, pitch: 0.55, yaw: 0.6, target: [0, 0.8, 0], maxPitch: 1.4, minPitch: 0.05 });
      s.info = panel(ctx, 'ov-br', `shadow map <b>${size}²</b><br>${s.dt ? 'WEBGL_depth_texture · DEPTH_COMPONENT' : '<span class="off">no depth texture</span> · RGBA8 packFloat'}`);
      s.cap = document.createElement('div'); s.cap.className = 'ov-cap'; s.cap.textContent = 'LIGHT DEPTH'; ctx.overlay.appendChild(s.cap);
      return s;
    },
    scene(s, prog, t, setCol) {
      const items = [
        [s.floor, M4.ident(), [0.2, 0.21, 0.24], 1],
        [s.knot, M4.mul(M4.translate(0, 1.7, 0), M4.mul(M4.rotY(t * 0.4), M4.rotX(t * 0.25))), S.A1, 0],
        [s.ball, M4.translate(Math.cos(t * 0.5) * 2.4, 0.55, Math.sin(t * 0.5) * 2.4), S.A2, 0],
      ];
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + 0.4;
        items.push([s.cube, M4.mul(M4.translate(Math.cos(a) * 3.6, 0.9, Math.sin(a) * 3.6), M4.scale(0.5, 1.8, 0.5)), [0.92, 0.9, 0.86], 0]);
      }
      items.push([s.cube, M4.mul(M4.translate(-1.3, 0.3, 1.6), M4.mul(M4.rotY(0.6), M4.scale(0.8, 0.6, 0.8))), [0.92, 0.9, 0.86], 0]);
      for (const [mesh, m, col, fl] of items) { prog.set(setCol ? { u_m: m, u_col: col, u_floor: fl } : { u_m: m }); mesh.draw(); }
    },
    frame(ctx, s, t, dt) {
      const { gl, util, input, params } = ctx;
      // light control: shift-drag or a second pointer
      let ldx = 0, ldy = 0;
      if (input.down && input.shift && input.pointers.size === 1) { ldx = input.dragDX; ldy = input.dragDY; }
      if (input.pointers.size === 2) { const p = [...input.pointers.values()][1]; ldx = p.x - p.px; ldy = p.y - p.py; }
      if (ldx || ldy) { ctx.syncParam('az', (params.az + ldx * 0.4 + 360) % 360); ctx.syncParam('el', clamp(params.el - ldy * 0.25, 15, 80)); }
      else if (params.anim) ctx.params.az = (params.az + dt * 14) % 360;
      if (params.anim && Math.floor(t * 4) !== s.tk) { s.tk = Math.floor(t * 4); ctx.syncParam('az', Math.round(params.az)); }
      s.cam.update(input.shift ? Object.assign({}, input, { dragging: false }) : input, dt, false);
      const az = params.az * Math.PI / 180, el = params.el * Math.PI / 180;
      const ldir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
      const lvp = M4.mul(M4.ortho(-6.5, 6.5, -6.5, 6.5, 1, 24), M4.lookAt(V3.scale(ldir, 12), [0, 0.5, 0]));
      const st = params.anim ? t : 0;
      // pass 1
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb); gl.viewport(0, 0, s.size, s.size);
      gl.enable(gl.DEPTH_TEST);
      if (s.dt) gl.colorMask(false, false, false, false);
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      s.depthP.use().set({ u_vp: lvp });
      this.scene(s, s.depthP, st, false);
      gl.colorMask(true, true, true, true);
      // pass 2
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, ctx.width, ctx.height);
      clearInk(gl);
      const vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view());
      s.prog.use().set({ u_vp: vp, u_lvp: lvp, u_sm: 0, u_ldir: ldir, u_bias: params.bias, u_pcf: params.pcf, u_texel: 1 / s.size });
      util.tex(0, s.smTex);
      this.scene(s, s.prog, st, true);
      gl.disable(gl.DEPTH_TEST);
      // thumbnail top-right
      const sz = Math.round(Math.min(170, ctx.cssWidth * 0.24) * ctx.dpr), pad = Math.round(14 * ctx.dpr);
      gl.viewport(ctx.width - sz - pad, ctx.height - sz - Math.round(48 * ctx.dpr), sz, sz);
      s.thumb.use().set({ u_sm: 0 }); util.tex(0, s.smTex); util.drawFullscreen();
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.cap.style.right = (pad + sz) / ctx.dpr - 0 + 'px'; s.cap.style.right = '14px'; s.cap.style.top = (48 + sz / ctx.dpr + 8) + 'px';
      ctx.canvas.style.cursor = input.shift ? 'move' : 'grab';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Reflection & refraction                                        */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'env-reflect',
    title: 'Reflection & Refraction',
    category: CAT,
    thumb: 'tall',
    hint: 'drag to orbit · change IOR',
    description: 'A cube-map environment drawn as a skybox and sampled by a glass object. reflect() and refract() bend the view vector at the surface; the Schlick approximation of the Fresnel term blends between them, so the object mirrors the city at grazing angles and lets it through head-on. Refracting red, green and blue with slightly different indices of refraction gives chromatic dispersion at the edges.',
    interact: [['Drag', 'orbit the camera'], ['IOR · Dispersion', 'how strongly and how unevenly light bends'], ['Object', 'sphere, torus knot or cube']],
    features: ['TEXTURE_CUBE_MAP from six canvases', 'textureCube + reflect() / refract()', 'Schlick Fresnel term', 'per-channel IOR (dispersion)', 'skybox from a full-screen triangle'],
    params: [
      { key: 'object', label: 'Object', type: 'select', options: ['Sphere', 'Knot', 'Cube'], value: 1 },
      { key: 'mode', label: 'Mode', type: 'select', options: ['Fresnel', 'Reflect', 'Refract'], value: 0 },
      { key: 'ior', label: 'IOR', type: 'range', min: 1, max: 2.4, step: 0.01, value: 1.45 },
      { key: 'disp', label: 'Dispersion', type: 'range', min: 0, max: 0.15, step: 0.005, value: 0.04 },
    ],
    code: `vec3 I = normalize(v_w - u_eye), N = normalize(v_n);
vec3 refl = textureCube(u_env, reflect(I, N)).rgb;
vec3 refr = vec3(textureCube(u_env, refract(I, N, 1.0 / (u_ior - u_disp))).r,
                 textureCube(u_env, refract(I, N, 1.0 / u_ior)).g,
                 textureCube(u_env, refract(I, N, 1.0 / (u_ior + u_disp))).b);
float F = F0 + (1.0 - F0) * pow(1.0 - max(dot(-I, N), 0.0), 5.0);
gl_FragColor = vec4(mix(refr, refl, F), 1.0);`,
    init(ctx) {
      const { util } = ctx;
      const env = util.texture({ faces: S.cubeFaces(512), mipmap: true });
      const sky = util.program(G.fullscreenVS, `
uniform samplerCube u_env; uniform vec3 u_f; uniform vec3 u_r; uniform vec3 u_u; uniform vec2 u_k; varying vec2 v_uv;
void main() {
  vec2 q = v_uv * 2.0 - 1.0;
  vec3 d = normalize(u_f + u_r * q.x * u_k.x + u_u * q.y * u_k.y);
  vec3 c = textureCube(u_env, d).rgb;
  gl_FragColor = vec4(c * (0.9 - 0.25 * dot(q, q)), 1.0);
}`);
      const prog = util.program(MESH_VS, `
uniform samplerCube u_env; uniform vec3 u_eye; uniform float u_ior; uniform float u_disp; uniform float u_mode;
varying vec3 v_n; varying vec3 v_w; varying vec2 v_uv;
void main() {
  vec3 I = normalize(v_w - u_eye), N = normalize(v_n);
  if (!gl_FrontFacing) N = -N;
  vec3 refl = textureCube(u_env, reflect(I, N)).rgb;
  vec3 refr = vec3(textureCube(u_env, refract(I, N, 1.0 / max(u_ior - u_disp, 1.0))).r,
                   textureCube(u_env, refract(I, N, 1.0 / u_ior)).g,
                   textureCube(u_env, refract(I, N, 1.0 / (u_ior + u_disp))).b);
  float f0 = pow((u_ior - 1.0) / (u_ior + 1.0), 2.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - max(dot(-I, N), 0.0), 5.0);
  vec3 c = u_mode < 0.5 ? mix(refr * vec3(0.92, 0.97, 1.0), refl, clamp(F * 1.3, 0.0, 1.0)) : u_mode < 1.5 ? refl : refr;
  c += pow(max(dot(reflect(I, N), normalize(vec3(0.3, 0.8, 0.4))), 0.0), 120.0) * 0.8;
  gl_FragColor = vec4(c * 1.15, 1.0);
}`);
      const meshes = [S.geo.upload(util, S.geo.sphere(96, 48, 1.3)), S.geo.upload(util, S.geo.torusKnot(400, 48, 0.3, 1.0, 0.45)), S.geo.uploadFlat(util, S.geo.cube())];
      return { env, sky, prog, meshes, cam: new S.OrbitCam({ dist: 5, pitch: 0.12, yaw: 0.4, auto: 0.12 }) };
    },
    frame(ctx, s, t, dt) {
      const { gl, util, input, params } = ctx;
      s.cam.update(input, dt, false);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const b = s.cam.basis(), k = Math.tan(s.cam.fov / 2);
      util.tex(0, s.env, gl.TEXTURE_CUBE_MAP);
      s.sky.use().set({ u_env: 0, u_f: b.fwd, u_r: b.right, u_u: b.up, u_k: [k * ctx.aspect, k] });
      util.drawFullscreen();
      gl.enable(gl.DEPTH_TEST);
      const vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view());
      const m = params.object === 2 ? M4.mul(M4.rotY(t * 0.3), M4.mul(M4.rotX(0.6), M4.scale(1.9))) : M4.mul(M4.rotY(t * 0.2), M4.rotX(0.3));
      s.prog.use().set({ u_vp: vp, u_m: m, u_env: 0, u_eye: s.cam.eye(), u_ior: params.ior, u_disp: params.disp, u_mode: params.mode });
      s.meshes[params.object].draw();
      gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = 'grab';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Bloom & post                                                   */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'bloom',
    title: 'Bloom & Post',
    category: CAT,
    thumb: 'wide',
    hint: 'move the light · hold to brighten',
    description: 'A post-processing chain on a high-dynamic-range scene. Emissive rings and orbs are rendered into a half-float target with values far above 1.0; a bright pass keeps what exceeds the threshold, and a separable Gaussian blur runs horizontally and vertically at half, quarter and eighth resolution. The blurred levels are added back, then a filmic tone curve maps the result into displayable range, followed by vignette, chromatic aberration and film grain.',
    interact: [['Move', 'the white light follows the pointer'], ['Hold', 'push its intensity up'], ['Toggles', 'switch each stage of the chain']],
    features: ['half-float HDR render target', 'bright pass + 3-level downsample', 'separable 9-tap Gaussian, ping-pong', 'ACES-style filmic tone map', 'vignette · chromatic aberration · grain'],
    params: [
      { key: 'thr', label: 'Threshold', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'amt', label: 'Bloom intensity', type: 'range', min: 0, max: 2.5, step: 0.05, value: 1 },
      { key: 'bloom', label: 'Bloom', type: 'toggle', value: true },
      { key: 'tone', label: 'Filmic tone map', type: 'toggle', value: true },
      { key: 'vig', label: 'Vignette', type: 'toggle', value: true },
      { key: 'ca', label: 'Chromatic aberration', type: 'toggle', value: true },
      { key: 'grain', label: 'Grain', type: 'toggle', value: true },
    ],
    code: `// separable blur: two passes per level
for (int i = 1; i < 5; i++) {
  vec2 o = u_dir * float(i) * 1.4;
  c += (texture2D(u_t, v_uv + o) + texture2D(u_t, v_uv - o)) * W[i];
}
// composite
vec3 hdr = scene + u_amt * (b1 * 0.5 + b2 * 0.3 + b3 * 0.2);
vec3 ldr = aces(hdr);`,
    init(ctx) {
      const { util } = ctx;
      const s = {};
      s.sceneP = util.program(G.fullscreenVS, G.colors + `
uniform vec2 u_res; uniform float u_t; uniform vec2 u_m; uniform float u_mi; uniform float u_store;
float ring(vec2 p, vec2 c, float r, float tilt, float rot, float w) {
  vec2 q = p - c; float cs = cos(rot), sn = sin(rot); q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y); q.y /= tilt;
  float d = abs(length(q) - r) * tilt;
  return exp(-d * d / (w * w));
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec3 c = mix(vec3(0.01, 0.012, 0.02), vec3(0.03, 0.035, 0.06), gl_FragCoord.y / u_res.y);
  // floor grid lit by the pointer light
  if (p.y < -0.28) {
    float z = 0.12 / (-p.y - 0.2);
    vec2 g = vec2(p.x * z * 3.0, z * 2.0 - u_t * 0.15);
    vec2 gg = abs(fract(g) - 0.5);
    float line = exp(-min(gg.x, gg.y) * 60.0 / z);
    float lit = 0.25 + 3.0 * u_mi / (1.0 + 25.0 * dot(p - u_m, p - u_m));
    c += line * mix(A1, A2, 0.5 + 0.5 * sin(g.y * 0.5)) * lit * 0.35 * smoothstep(-0.28, -0.6, p.y);
  }
  c += ring(p, vec2(0.0, 0.05), 0.32, 0.36, 0.15 * sin(u_t * 0.3), 0.006) * A1 * 4.0;
  c += ring(p, vec2(0.0, 0.05), 0.25, 0.9, u_t * 0.2, 0.004) * A2 * 3.5;
  c += ring(p, vec2(0.0, 0.05), 0.42, 0.18, -0.2, 0.004) * BONE * 1.6;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 o = vec2(cos(u_t * 0.4 + fi * 0.9) * (0.55 + 0.1 * fi), sin(u_t * 0.55 + fi * 1.7) * 0.22 + 0.05);
    float d = length(p - o);
    vec3 col = mod(fi, 2.0) < 0.5 ? A1 : A2;
    c += col * (smoothstep(0.018, 0.01, d) * 6.0 + 0.0012 / (d * d + 0.002));
  }
  float dm = length(p - u_m);
  c += BONE * u_mi * (smoothstep(0.03, 0.018, dm) * 10.0 + 0.002 / (dm * dm + 0.003));
  gl_FragColor = vec4(c * u_store, 1.0);
}`);
      s.bright = util.program(G.fullscreenVS, `
uniform sampler2D u_t; uniform float u_thr; uniform vec2 u_px; uniform float u_load; varying vec2 v_uv;
void main() {
  vec3 c = (texture2D(u_t, v_uv + u_px * vec2(-0.5, -0.5)).rgb + texture2D(u_t, v_uv + u_px * vec2(0.5, -0.5)).rgb
          + texture2D(u_t, v_uv + u_px * vec2(-0.5, 0.5)).rgb + texture2D(u_t, v_uv + u_px * vec2(0.5, 0.5)).rgb) * 0.25 * u_load;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - u_thr, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(c * k / u_load, 1.0);
}`);
      s.down = util.program(G.fullscreenVS, `uniform sampler2D u_t; uniform vec2 u_px; varying vec2 v_uv;
void main() { gl_FragColor = (texture2D(u_t, v_uv + u_px * vec2(-0.5, -0.5)) + texture2D(u_t, v_uv + u_px * vec2(0.5, -0.5)) + texture2D(u_t, v_uv + u_px * vec2(-0.5, 0.5)) + texture2D(u_t, v_uv + u_px * vec2(0.5, 0.5))) * 0.25; }`);
      s.blur = util.program(G.fullscreenVS, `uniform sampler2D u_t; uniform vec2 u_dir; varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_t, v_uv) * 0.227027;
  c += (texture2D(u_t, v_uv + u_dir * 1.4) + texture2D(u_t, v_uv - u_dir * 1.4)) * 0.1945946;
  c += (texture2D(u_t, v_uv + u_dir * 2.8) + texture2D(u_t, v_uv - u_dir * 2.8)) * 0.1216216;
  c += (texture2D(u_t, v_uv + u_dir * 4.2) + texture2D(u_t, v_uv - u_dir * 4.2)) * 0.054054;
  c += (texture2D(u_t, v_uv + u_dir * 5.6) + texture2D(u_t, v_uv - u_dir * 5.6)) * 0.016216;
  gl_FragColor = c;
}`);
      s.comp = util.program(G.fullscreenVS, G.noise + `
uniform sampler2D u_scene; uniform sampler2D u_b1; uniform sampler2D u_b2; uniform sampler2D u_b3;
uniform float u_amt; uniform float u_load; uniform float u_bloom; uniform float u_tone; uniform float u_vig; uniform float u_ca; uniform float u_grain; uniform float u_t; uniform float u_asp;
varying vec2 v_uv;
vec3 hdr(vec2 uv) {
  vec3 c = texture2D(u_scene, uv).rgb;
  if (u_bloom > 0.5) c += u_amt * (texture2D(u_b1, uv).rgb * 0.45 + texture2D(u_b2, uv).rgb * 0.35 + texture2D(u_b3, uv).rgb * 0.35);
  return c * u_load;
}
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec2 d = v_uv - 0.5;
  vec3 c;
  if (u_ca > 0.5) { vec2 o = d * dot(d, d) * 0.035; c = vec3(hdr(v_uv + o).r, hdr(v_uv).g, hdr(v_uv - o).b); }
  else c = hdr(v_uv);
  c = u_tone > 0.5 ? aces(c * 0.8) : clamp(c, 0.0, 1.0);
  if (u_vig > 0.5) c *= 1.0 - smoothstep(0.25, 0.9, length(d * vec2(u_asp, 1.0)) / sqrt(u_asp * u_asp * 0.25 + 0.25) * 0.75);
  c = pow(c, vec3(1.0 / (u_tone > 0.5 ? 1.3 : 1.0)));
  if (u_grain > 0.5) c += (hash12(gl_FragCoord.xy + fract(u_t * 7.13) * 100.0) - 0.5) * 0.05;
  gl_FragColor = vec4(c, 1.0);
}`);
      s.m = [0.3, 0.1]; s.mi = 1;
      this.resize(ctx, s);
      s.info = panel(ctx, 'ov-tr', `HDR target <b>${s.type === 'half' ? 'HALF_FLOAT_OES' : s.type === 'float' ? 'FLOAT' : 'RGBA8 (scaled ×¼)'}</b><br>bloom levels <b>½ · ¼ · ⅛</b><br>${s.type === 'byte' ? 'no float targets: highlights clip at 4.0' : 'scene values up to ~10.0'}`);
      return s;
    },
    resize(ctx, s) {
      const { util } = ctx;
      for (const t of s.all || []) freeTarget(util, t);
      const W = ctx.width, H = ctx.height;
      const r = tryTarget(util, W, H, ['half', 'float']);
      s.type = r ? r.type : 'byte';
      const mk = (w, h) => (s.type === 'byte' ? util.target(w, h) : util.target(w, h, { type: s.type }));
      s.scene = r ? r.t : util.target(W, H);
      s.levels = [2, 4, 8].map((d) => { const w = Math.max(1, Math.floor(W / d)), h = Math.max(1, Math.floor(H / d)); return { a: mk(w, h), b: mk(w, h), w, h }; });
      s.all = [s.scene, ...s.levels.flatMap((l) => [l.a, l.b])];
      s.load = s.type === 'byte' ? 4 : 1;
    },
    frame(ctx, s, t, dt) {
      const { gl, util, input, params } = ctx;
      const live = input.hover || input.down;
      const asp = ctx.aspect;
      const tx = live ? (input.uvx - 0.5) * asp : Math.cos(t * 0.5) * 0.45 * asp, ty = live ? input.uvy - 0.5 : -0.05 + Math.sin(t * 0.8) * 0.25;
      s.m[0] += (tx - s.m[0]) * damp(10, dt); s.m[1] += (ty - s.m[1]) * damp(10, dt);
      s.mi += ((input.down ? 3 : 1) - s.mi) * damp(4, dt);
      run(util, s.sceneP, s.scene, { u_res: [ctx.width, ctx.height], u_t: t, u_m: s.m, u_mi: s.mi, u_store: 1 / s.load });
      if (params.bloom) {
        let src = s.scene, sw = ctx.width, sh = ctx.height;
        s.levels.forEach((L, i) => {
          if (i === 0) run(util, s.bright, L.a, { u_t: 0, u_thr: params.thr, u_px: [1 / sw, 1 / sh], u_load: s.load }, [src.tex]);
          else run(util, s.down, L.a, { u_t: 0, u_px: [1 / sw, 1 / sh] }, [src.tex]);
          run(util, s.blur, L.b, { u_t: 0, u_dir: [1 / L.w, 0] }, [L.a.tex]);
          run(util, s.blur, L.a, { u_t: 0, u_dir: [0, 1 / L.h] }, [L.b.tex]);
          src = L.a; sw = L.w; sh = L.h;
        });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.comp.use().set({ u_scene: 0, u_b1: 1, u_b2: 2, u_b3: 3, u_amt: params.amt, u_load: s.load, u_bloom: params.bloom ? 1 : 0, u_tone: params.tone ? 1 : 0, u_vig: params.vig ? 1 : 0, u_ca: params.ca ? 1 : 0, u_grain: params.grain ? 1 : 0, u_t: t, u_asp: asp });
      util.tex(0, s.scene.tex); s.levels.forEach((L, i) => util.tex(i + 1, L.a.tex));
      util.drawFullscreen();
      ctx.canvas.style.cursor = 'none';
    },
  });
  function run(util, prog, target, uni, texs = []) {
    util.bindTarget(target, util.gl.drawingBufferWidth, util.gl.drawingBufferHeight);
    prog.use().set(uni);
    texs.forEach((tx, i) => util.tex(i, tx));
    util.drawFullscreen();
  }

  /* ---------------------------------------------------------------- */
  /* 6. Toon & outlines                                                */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'toon-outline',
    title: 'Toon & Outlines',
    category: CAT,
    thumb: 'square',
    hint: 'drag to orbit · compare outline methods',
    description: 'Two ways to ink a 3D scene. The inverted hull draws every mesh a second time, pushed out along its normals with front faces culled, so only a thin shell shows behind the silhouette. The screen-space method renders normals and depth into a texture first and runs an edge detector over it, which also finds creases and contact lines that the hull misses. Shading is quantised into a chosen number of cel bands.',
    interact: [['Drag', 'orbit the camera'], ['Hull · Edges', 'switch each outline method'], ['Bands · Width', 'cel bands and hull thickness']],
    features: ['gl.cullFace(gl.FRONT) inverted hull', 'normal extrusion in the vertex shader', 'normal + depth pre-pass (RGBA8, packed depth)', 'Sobel-style edge detection', 'quantised cel shading'],
    params: [
      { key: 'bands', label: 'Cel bands', type: 'range', min: 2, max: 6, step: 1, value: 3 },
      { key: 'width', label: 'Hull width', type: 'range', min: 0, max: 0.08, step: 0.002, value: 0.03 },
      { key: 'hull', label: 'Inverted hull', type: 'toggle', value: true },
      { key: 'edges', label: 'Screen-space edges', type: 'toggle', value: true },
      { key: 'view', label: 'View', type: 'select', options: ['Shaded', 'Normals', 'Edges only'], value: 0 },
    ],
    code: `// inverted hull
gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
gl_Position = u_vp * (w + vec4(normalize(n) * u_width, 0.0));
// screen-space edges from the normal/depth pass
float e = length(nR - nL) + length(nT - nB)
        + abs(dR - dL) * 40.0 + abs(dT - dB) * 40.0;`,
    init(ctx) {
      const { util } = ctx;
      const s = {};
      s.nd = util.program(MESH_VS.replace('void main() {', 'uniform mat4 u_v;\nvarying vec3 v_vn; varying float v_z;\nvoid main() { v_vn = mat3(u_v) * mat3(u_m) * a_nrm; v_z = -(u_v * u_m * vec4(a_pos, 1.0)).z;'), `
varying vec3 v_vn; varying float v_z; varying vec3 v_n; varying vec3 v_w; varying vec2 v_uv;
void main() {
  vec3 n = normalize(v_vn);
  float d = clamp(v_z / 30.0, 0.0, 0.9999);
  float hi = floor(d * 255.0) / 255.0, lo = fract(d * 255.0);
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, hi, lo);
}`);
      s.toon = util.program(MESH_VS, G.colors + `
uniform vec3 u_col; uniform vec3 u_ldir; uniform vec3 u_eye; uniform float u_bands; uniform float u_floor;
varying vec3 v_n; varying vec3 v_w; varying vec2 v_uv;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w);
  float d = max(dot(n, u_ldir), 0.0);
  float q = floor(d * u_bands + 0.5) / u_bands;
  vec3 base = u_col;
  if (u_floor > 0.5) { float r = length(v_w.xz); base *= 1.0 - smoothstep(3.0, 5.5, r) * 0.6; }
  vec3 c = mix(base * 0.28 + vec3(0.02, 0.025, 0.07), base, q);
  float sp = step(0.93, pow(max(dot(n, normalize(u_ldir + V)), 0.0), 8.0));
  c += sp * 0.35 * (1.0 - u_floor);
  gl_FragColor = vec4(c, 1.0);
}`);
      s.hullP = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_m; uniform float u_w;
void main() { vec4 w = u_m * vec4(a_pos, 1.0); vec3 n = normalize(mat3(u_m) * a_nrm); gl_Position = u_vp * (w + vec4(n * u_w, 0.0)); }`, `void main() { gl_FragColor = vec4(0.02, 0.022, 0.035, 1.0); }`);
      s.bg = util.program(G.fullscreenVS, G.colors + `uniform vec2 u_res; varying vec2 v_uv;
void main() {
  vec3 c = mix(vec3(0.06, 0.07, 0.1), vec3(0.13, 0.14, 0.18), v_uv.y);
  vec2 g = fract(gl_FragCoord.xy / 7.0) - 0.5;
  c += (1.0 - smoothstep(0.15, 0.25, length(g))) * 0.02 * v_uv.y;
  gl_FragColor = vec4(c, 1.0);
}`);
      s.edge = util.program(G.fullscreenVS, `uniform sampler2D u_nd; uniform vec2 u_px; uniform float u_mode; varying vec2 v_uv;
vec3 S(vec2 o) { vec4 t = texture2D(u_nd, v_uv + o * u_px); return vec3(t.xy * 2.0 - 1.0, t.z + t.w / 255.0); }
void main() {
  vec3 c = S(vec2(0.0)), l = S(vec2(-1.0, 0.0)), r = S(vec2(1.0, 0.0)), b = S(vec2(0.0, -1.0)), t = S(vec2(0.0, 1.0));
  vec3 lb = S(vec2(-1.0, -1.0)), rt = S(vec2(1.0, 1.0)), lt = S(vec2(-1.0, 1.0)), rb = S(vec2(1.0, -1.0));
  vec2 gn = vec2(length((r.xy - l.xy) * 2.0 + (rt.xy - lt.xy) + (rb.xy - lb.xy)), length((t.xy - b.xy) * 2.0 + (rt.xy - rb.xy) + (lt.xy - lb.xy)));
  float dz = max(c.z, 1e-3);
  float gd = (abs(r.z - l.z) + abs(t.z - b.z) + abs(rt.z - lb.z) + abs(lt.z - rb.z)) / dz;
  float e = smoothstep(0.55, 0.9, max(gn.x, gn.y)) + smoothstep(0.06, 0.12, gd);
  e = clamp(e, 0.0, 1.0);
  if (u_mode > 0.5) { gl_FragColor = vec4(c.xy * 0.5 + 0.5, 0.6, 1.0); return; }
  gl_FragColor = vec4(0.02, 0.022, 0.035, e);
}`);
      s.knot = S.geo.upload(util, S.geo.torusKnot(260, 28, 0.26, 0.9, 0.38));
      s.ball = S.geo.upload(util, S.geo.sphere(48, 24, 0.6));
      s.tor = S.geo.upload(util, S.geo.torus(64, 20, 0.55, 0.2));
      s.cube = S.geo.uploadFlat(util, S.geo.cube());
      s.floor = S.geo.upload(util, plane(12, 0));
      s.cam = new S.OrbitCam({ dist: 7, pitch: 0.45, yaw: 0.5, target: [0, 0.9, 0], auto: 0.1, minPitch: 0.05 });
      this.resize(ctx, s);
      return s;
    },
    resize(ctx, s) { freeTarget(ctx.util, s.ndT); s.ndT = ctx.util.target(ctx.width, ctx.height, { depth: true, filter: ctx.gl.NEAREST }); },
    items(s, t) {
      return [
        [s.knot, M4.mul(M4.translate(0, 1.5, 0), M4.mul(M4.rotY(t * 0.3), M4.rotX(0.4))), S.A1, 0],
        [s.ball, M4.translate(-2.1, 0.6, 0.8), S.A2, 0],
        [s.tor, M4.mul(M4.translate(2.0, 0.2, 1.0), M4.rotZ(0.0)), [0.93, 0.91, 0.88], 0],
        [s.cube, M4.mul(M4.translate(1.4, 0.45, -1.7), M4.mul(M4.rotY(0.7 + t * 0.2), M4.scale(0.9))), [0.93, 0.91, 0.88], 0],
        [s.cube, M4.mul(M4.translate(-1.2, 0.3, -1.6), M4.mul(M4.rotY(-0.4), M4.scale(0.6))), S.A1, 0],
        [s.floor, M4.ident(), [0.34, 0.36, 0.42], 1],
      ];
    },
    frame(ctx, s, t, dt) {
      const { gl, util, input, params } = ctx;
      s.cam.update(input, dt, false);
      const vp = M4.mul(s.cam.proj(ctx.aspect), s.cam.view()), v = s.cam.view();
      const items = this.items(s, t);
      gl.enable(gl.DEPTH_TEST);
      // pass 1: normals + depth
      util.bindTarget(s.ndT);
      gl.clearColor(0.5, 0.5, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      s.nd.use().set({ u_vp: vp, u_v: v });
      for (const [mesh, m] of items) { s.nd.set({ u_m: m }); mesh.draw(); }
      // pass 2: background, toon shading
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      s.bg.use().set({ u_res: [ctx.width, ctx.height] }); util.drawFullscreen();
      gl.enable(gl.DEPTH_TEST);
      const ldir = V3.norm([0.5, 0.9, 0.35]);
      if (params.view !== 2) {
        s.toon.use().set({ u_vp: vp, u_ldir: ldir, u_eye: s.cam.eye(), u_bands: params.bands });
        for (const [mesh, m, col, fl] of items) { s.toon.set({ u_m: m, u_col: col, u_floor: fl }); mesh.draw(); }
      }
      // pass 3: inverted hull
      if (params.hull && params.width > 0) {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
        s.hullP.use().set({ u_vp: vp, u_w: params.width });
        for (const [mesh, m, , fl] of items) {
          if (fl || mesh === s.cube) continue;
          gl.frontFace(mesh === s.ball ? gl.CW : gl.CCW); // geo.sphere is wound clockwise from outside
          s.hullP.set({ u_m: m }); mesh.draw();
        }
        gl.frontFace(gl.CCW);
        // flat cubes have split normals: extrude by scale instead
        for (const [mesh, m] of items) { if (mesh !== s.cube) continue; s.hullP.set({ u_m: M4.mul(m, M4.scale(1 + params.width * 2.5)), u_w: 0 }); mesh.draw(); }
        gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE);
      }
      gl.disable(gl.DEPTH_TEST);
      // pass 4: edges from the normal/depth buffer
      if (params.edges || params.view === 1) {
        if (params.view !== 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        s.edge.use().set({ u_nd: 0, u_px: [1 / ctx.width, 1 / ctx.height], u_mode: params.view === 1 ? 1 : 0 });
        util.tex(0, s.ndT.tex); util.drawFullscreen();
        gl.disable(gl.BLEND);
      }
      ctx.canvas.style.cursor = 'grab';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 7. Ray-marched SDF                                                */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'raymarch',
    title: 'Ray-Marched SDF',
    category: CAT,
    thumb: 'tall',
    hint: 'move to lead the blobs · drag to orbit',
    description: 'No geometry at all: one full-screen triangle whose fragment shader marches a ray through a signed distance field. Five spheres are merged with a smooth minimum, so they melt into each other as they follow the pointer. Each hit is lit with soft shadows (a second march towards the light), ambient occlusion from a few distance samples along the normal, and exponential fog. GLSL ES 1.00 needs constant loop bounds, so the step count is a uniform tested inside the loop with break.',
    interact: [['Move', 'the lead blob follows the pointer on a plane'], ['Drag', 'orbit the camera'], ['Steps', 'maximum march iterations per pixel']],
    features: ['sphere tracing in a fragment shader', 'smooth-union (polynomial smin)', 'soft shadows + ambient occlusion', 'constant loop bound with break', 'uniform vec4 array of blobs'],
    params: [
      { key: 'steps', label: 'Max steps', type: 'range', min: 8, max: 200, step: 1, value: 96 },
      { key: 'k', label: 'Smoothness', type: 'range', min: 0.01, max: 1.2, step: 0.01, value: 0.45 },
      { key: 'shadows', label: 'Soft shadows', type: 'toggle', value: true },
      { key: 'ao', label: 'Ambient occlusion', type: 'toggle', value: true },
      { key: 'scale', label: 'Resolution', type: 'select', options: ['Full', '¾', '½'], value: 0 },
    ],
    code: `float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
for (int i = 0; i < 256; i++) {
  if (float(i) >= u_steps) break;
  float d = map(ro + rd * t); if (d < 0.001 * t) break;
  t += d;
}`,
    init(ctx) {
      const { util } = ctx;
      const s = {};
      s.prog = util.program(G.fullscreenVS, G.colors + `
uniform vec3 u_eye; uniform vec3 u_f; uniform vec3 u_r; uniform vec3 u_u; uniform vec2 u_k; uniform vec4 u_b[5];
uniform float u_steps; uniform float u_sk; uniform float u_sh; uniform float u_ao; uniform float u_t;
varying vec2 v_uv;
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float blobs(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < 5; i++) d = smin(d, length(p - u_b[i].xyz) - u_b[i].w, u_sk);
  return d;
}
vec2 map(vec3 p) {
  float b = blobs(p);
  float f = p.y;
  return b < f ? vec2(b, 1.0) : vec2(f, 0.0);
}
vec3 normal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x));
}
float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 40; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.02, 0.3);
    if (res < 0.002 || t > 8.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
float ambOcc(vec3 p, vec3 n) {
  float o = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) { float h = 0.04 * float(i) * float(i) * 0.5 + 0.02; o += (h - map(p + n * h).x) * w; w *= 0.7; }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}
void main() {
  vec2 q = v_uv * 2.0 - 1.0;
  vec3 ro = u_eye, rd = normalize(u_f + u_r * q.x * u_k.x + u_u * q.y * u_k.y);
  float t = 0.0; vec2 h = vec2(1e5, -1.0);
  for (int i = 0; i < 256; i++) {
    if (float(i) >= u_steps) break;
    h = map(ro + rd * t);
    if (h.x < 0.0008 * t || t > 40.0) break;
    t += h.x;
  }
  vec3 sky = mix(vec3(0.03, 0.035, 0.055), vec3(0.08, 0.1, 0.15), clamp(rd.y * 2.0 + 0.4, 0.0, 1.0));
  vec3 col = sky;
  if (t < 40.0 && h.x < 0.02) {
    vec3 p = ro + rd * t, n = normal(p);
    vec3 L = normalize(vec3(0.6, 0.8, 0.35));
    float dif = max(dot(n, L), 0.0);
    float sh = u_sh > 0.5 && dif > 0.0 ? softShadow(p + n * 0.01, L) : 1.0;
    float ao = u_ao > 0.5 ? ambOcc(p, n) : 1.0;
    vec3 base;
    if (h.y > 0.5) {
      float k = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
      base = mix(A2, A1, smoothstep(0.2, 0.9, k + 0.15 * sin(p.x * 3.0 + u_t)));
      float fr = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
      float sp = pow(max(dot(reflect(rd, n), L), 0.0), 40.0);
      col = base * (0.12 + 0.9 * dif * sh) * ao + sp * sh * BONE + fr * vec3(0.3, 0.35, 0.45) * ao;
    } else {
      vec2 g = abs(fract(p.xz) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.02 * (1.0 + t * 0.15), 0.5 - max(g.x, g.y));
      base = vec3(0.07, 0.075, 0.09) + line * 0.05;
      col = base * (0.35 + 1.2 * dif * sh) * ao;
    }
    col = mix(col, sky, 1.0 - exp(-0.0025 * t * t));
  }
  col *= 1.0 - 0.3 * dot(q, q) * 0.5;
  gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
}`);
      s.blit = util.program(G.fullscreenVS, `uniform sampler2D u_t; varying vec2 v_uv; void main() { gl_FragColor = texture2D(u_t, v_uv); }`);
      s.cam = new S.OrbitCam({ dist: 6.5, pitch: 0.32, yaw: 0.4, target: [0, 0.7, 0], minPitch: 0.03, maxPitch: 1.3 });
      s.blobs = [0, 1, 2, 3, 4].map((i) => ({ p: [Math.cos(i) * 1.2, 0.8, Math.sin(i) * 1.2], v: [0, 0, 0], r: [0.62, 0.5, 0.42, 0.36, 0.3][i] }));
      s.lead = [0, 0.9, 0];
      s.info = panel(ctx, 'ov-tr', '');
      return s;
    },
    frame(ctx, s, t, dt) {
      const { gl, util, input, params } = ctx;
      s.cam.update(input, dt, false);
      if (!input.hover && !input.down) s.cam.yaw += dt * 0.08;
      // lead target: pointer ray hits the plane y = 0.9
      let tgt;
      if (input.hover && !input.down) {
        const r = s.cam.ray(input.nx, input.ny, ctx.aspect);
        const hp = S.math.Ray.plane(r.origin, r.dir, [0, 0.9, 0], [0, 1, 0]);
        tgt = hp ? [clamp(hp[0], -3, 3), 0.9 + Math.sin(t * 2) * 0.1, clamp(hp[2], -3, 3)] : s.lead;
      } else tgt = [Math.cos(t * 0.7) * 1.6, 0.9 + Math.sin(t * 1.3) * 0.3, Math.sin(t * 0.9) * 1.2];
      for (let i = 0; i < 3; i++) s.lead[i] += (tgt[i] - s.lead[i]) * damp(5, dt);
      // a chain of springs: each blob follows the previous one
      const h = Math.min(dt, 1 / 30);
      s.blobs.forEach((b, i) => {
        const goal = i === 0 ? s.lead : V3.add(s.blobs[i - 1].p, [Math.cos(t * 0.7 + i * 2.1) * 0.75, -0.1 + Math.sin(t * 1.3 + i) * 0.25, Math.sin(t * 0.6 + i * 2.1) * 0.75]);
        for (let k = 0; k < 3; k++) { b.v[k] = (b.v[k] + (goal[k] - b.p[k]) * (i === 0 ? 30 : 9) * h) * Math.pow(0.04, h); b.p[k] += b.v[k] * h; }
        b.p[1] = Math.max(b.p[1], b.r * 0.6);
      });
      const sc = [1, 0.75, 0.5][params.scale];
      let target = null;
      if (sc < 1) {
        const w = Math.max(1, Math.round(ctx.width * sc)), hh = Math.max(1, Math.round(ctx.height * sc));
        if (!s.rt || s.rt.w !== w || s.rt.h !== hh) { freeTarget(util, s.rt); s.rt = util.target(w, hh); }
        target = s.rt;
      }
      util.bindTarget(target, ctx.width, ctx.height);
      const b = s.cam.basis(), k = Math.tan(s.cam.fov / 2);
      const arr = new Float32Array(20);
      s.blobs.forEach((bl, i) => arr.set([bl.p[0], bl.p[1], bl.p[2], bl.r], i * 4));
      s.prog.use().set({ u_eye: s.cam.eye(), u_f: b.fwd, u_r: b.right, u_u: b.up, u_k: [k * ctx.aspect, k], u_b: arr, u_steps: params.steps, u_sk: params.k, u_sh: params.shadows ? 1 : 0, u_ao: params.ao ? 1 : 0, u_t: t });
      util.drawFullscreen();
      if (target) { util.bindTarget(null, ctx.width, ctx.height); s.blit.use().set({ u_t: 0 }); util.tex(0, target.tex); util.drawFullscreen(); }
      if ((s.tick = (s.tick || 0) + 1) % 20 === 1) s.info.innerHTML = `<b>${Math.round(ctx.width * sc)} × ${Math.round(ctx.height * sc)}</b> rays<br>≤ <b>${params.steps}</b> steps each · 5 blobs<br>1 draw call, 3 vertices`;
      ctx.canvas.style.cursor = 'grab';
    },
  });
})();
