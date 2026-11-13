/* WebGL 1.0 Interaction Lab — core helpers shared by every study.
 * No dependencies: raw WebGL 1.0 + GLSL ES 1.00, a tiny math library, geometry
 * builders, a GL utility with resource tracking (switching studies frees every
 * GPU object), extension access, an orbit camera, and a unified pointer /
 * touch / wheel / keyboard input model. */
(function () {
  'use strict';

  const A1 = [0.22, 0.839, 0.91];   // cyan    #38d6e8
  const A2 = [1.0, 0.31, 0.639];    // magenta #ff4fa3
  const Sandbox = (window.Sandbox = { demos: [], A1, A2, CSS: { A1: '#38d6e8', A2: '#ff4fa3', BONE: '#ece9e2', INK: '#0b0c0e' } });
  Sandbox.register = (demo) => Sandbox.demos.push(demo);

  /* ------------------------------------------------------------------ */
  /* Shared GLSL ES 1.00 snippets                                        */
  /* ------------------------------------------------------------------ */
  Sandbox.GLSL = {
    colors: `
const vec3 A1   = vec3(0.22, 0.839, 0.91);
const vec3 A2   = vec3(1.0, 0.31, 0.639);
const vec3 INK  = vec3(0.027, 0.031, 0.047);
const vec3 BONE = vec3(0.925, 0.914, 0.886);
`,
    // Fullscreen triangle: one shared 3-vertex buffer at attribute 0 (WebGL 1 has no gl_VertexID).
    fullscreenVS: `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`,
    // Float-only hash (GLSL ES 1.00 has no unsigned integers or bit operations).
    noise: `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = p - i; vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return s;
}
`,
    // Packs a float in [0,1) into RGBA8 and back: depth / data without float textures.
    pack: `
vec4 packFloat(float v) {
  vec4 e = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0));
  e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  return e;
}
float unpackFloat(vec4 e) { return dot(e, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
`,
  };

  /* ------------------------------------------------------------------ */
  /* Math                                                                */
  /* ------------------------------------------------------------------ */
  const V3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };

  const M4 = {
    ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    persp(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
      return m;
    },
    lookAt(eye, target, up = [0, 1, 0]) {
      const z = V3.norm(V3.sub(eye, target));
      const x = V3.norm(V3.cross(up, z));
      const y = V3.cross(z, x);
      return new Float32Array([
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1,
      ]);
    },
    ortho(l, r, b, t, n, f) {
      const m = new Float32Array(16);
      m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
      m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
      return m;
    },
    translate(x, y, z) { const m = M4.ident(); m[12] = x; m[13] = y; m[14] = z; return m; },
    scale(x, y = x, z = x) { const m = M4.ident(); m[0] = x; m[5] = y; m[10] = z; return m; },
    rotX(a) { const m = M4.ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    rotY(a) { const m = M4.ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    rotZ(a) { const m = M4.ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // Frame-rate independent exponential smoothing factor.
  const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
  // Quaternions [x, y, z, w]
  const Q = {
    ident: () => [0, 0, 0, 1],
    axisAngle(ax, a) { const n = V3.norm(ax), s = Math.sin(a / 2); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(a / 2)]; },
    mul(a, b) {
      return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
      ];
    },
    norm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((v) => v / l); },
    slerp(a, b, t) {
      let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
      if (d < 0) { b = b.map((v) => -v); d = -d; }
      if (d > 0.9995) return Q.norm(a.map((v, i) => v + (b[i] - v) * t));
      const th = Math.acos(d), s = Math.sin(th);
      const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
      return a.map((v, i) => v * wa + b[i] * wb);
    },
    rotate(q, v) { const p = Q.mul(Q.mul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]); return [p[0], p[1], p[2]]; },
    toMat4(q) {
      const [x, y, z, w] = q;
      return new Float32Array([
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
      ]);
    },
  };
  // Ray helpers
  const Ray = {
    plane(o, d, p0, n) { const den = V3.dot(d, n); if (Math.abs(den) < 1e-6) return null; const t = V3.dot(V3.sub(p0, o), n) / den; return t > 0 ? V3.add(o, V3.scale(d, t)) : null; },
    sphere(o, d, c, r) {
      const oc = V3.sub(o, c), b = V3.dot(oc, d), cc = V3.dot(oc, oc) - r * r, h = b * b - cc;
      if (h < 0) return null; const t = -b - Math.sqrt(h); return t > 0 ? t : null;
    },
  };
  Sandbox.math = { V3, M4, Q, Ray, clamp, lerp, damp };

  /* ------------------------------------------------------------------ */
  /* Geometry                                                            */
  /* ------------------------------------------------------------------ */
  const geo = {};

  // Non-indexed flat-shaded unit cube (-0.5..0.5): 36 verts, interleaved pos/normal.
  geo.cube = function () {
    const faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const out = [];
    for (const [n, u, v] of faces) {
      const c = (su, sv) => [
        n[0] * 0.5 + u[0] * su * 0.5 + v[0] * sv * 0.5,
        n[1] * 0.5 + u[1] * su * 0.5 + v[1] * sv * 0.5,
        n[2] * 0.5 + u[2] * su * 0.5 + v[2] * sv * 0.5,
      ];
      const q = [c(-1, -1), c(1, -1), c(1, 1), c(-1, -1), c(1, 1), c(-1, 1)];
      for (const p of q) out.push(p[0], p[1], p[2], n[0], n[1], n[2]);
    }
    return { data: new Float32Array(out), count: 36, stride: 24 };
  };

  // Flat-shaded octahedron: 24 verts, interleaved pos/normal.
  geo.octa = function () {
    const P = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    const out = [];
    for (const f of F) {
      const a = P[f[0]], b = P[f[1]], c = P[f[2]];
      const n = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));
      for (const p of [a, b, c]) out.push(p[0], p[1], p[2], n[0], n[1], n[2]);
    }
    return { data: new Float32Array(out), count: 24, stride: 24 };
  };

  // Parametric surface over u,v in [0,1]. fn returns {p:[x,y,z], n?:[x,y,z]}.
  geo.surface = function (nu, nv, fn) {
    const vc = (nu + 1) * (nv + 1);
    const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
    const e = 1e-3;
    let k = 0;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
      const u = i / nu, v = j / nv;
      const s = fn(u, v);
      let n = s.n;
      if (!n) {
        const du = V3.sub(fn(Math.min(u + e, 1), v).p, fn(Math.max(u - e, 0), v).p);
        const dv = V3.sub(fn(u, Math.min(v + e, 1)).p, fn(u, Math.max(v - e, 0)).p);
        n = V3.norm(V3.cross(du, dv));
        if (!isFinite(n[0]) || V3.len(n) < 0.5) n = V3.norm(s.p);
        if (V3.dot(n, s.p) < 0) n = V3.scale(n, -1);
      }
      pos.set(s.p, k * 3); nrm.set(n, k * 3); uv[k * 2] = u; uv[k * 2 + 1] = v;
    }
    const idx = vc > 65535 ? new Uint32Array(nu * nv * 6) : new Uint16Array(nu * nv * 6);
    let t = 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
    return { pos, nrm, uv, idx, count: idx.length, vertexCount: vc };
  };
  // Torus knot tube (p=2, q=3) with analytic normals; u runs along the knot, v around the tube.
  geo.torusKnot = function (nu = 400, nv = 48, tube = 0.28, R = 1.25, r = 0.55) {
    const C = (t) => [(R + r * Math.cos(3 * t)) * Math.cos(2 * t), r * Math.sin(3 * t), (R + r * Math.cos(3 * t)) * Math.sin(2 * t)];
    return geo.surface(nu, nv, (u, v) => {
      const t = u * Math.PI * 2, e = 1e-3;
      const c = C(t), cp = C(t + e), cm = C(t - e);
      const T = V3.norm(V3.sub(cp, cm));
      const N = V3.norm(V3.sub(V3.add(cp, cm), V3.scale(c, 2)));
      const B = V3.cross(T, N);
      const a = v * Math.PI * 2;
      const n = V3.add(V3.scale(N, Math.cos(a)), V3.scale(B, Math.sin(a)));
      return { p: V3.add(c, V3.scale(n, tube)), n };
    });
  };
  geo.sphere = function (nu = 48, nv = 24, rad = 1) {
    return geo.surface(nu, nv, (u, v) => {
      const a = u * Math.PI * 2, b = v * Math.PI;
      const d = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
      return { p: d.map((x) => x * rad), n: d };
    });
  };
  geo.torus = function (nu = 96, nv = 24, R = 1, r = 0.25) {
    return geo.surface(nu, nv, (u, v) => {
      const a = u * Math.PI * 2, b = v * Math.PI * 2;
      return { p: [Math.cos(a) * (R + r * Math.cos(b)), r * Math.sin(b), Math.sin(a) * (R + r * Math.cos(b))], n: [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)] };
    });
  };
  /** Upload a surface (pos/nrm/uv/idx) as a mesh at attribute locations 0/1/2. */
  geo.upload = function (util, g) {
    const gl = util.gl;
    const wide = g.idx instanceof Uint32Array;
    if (wide && !util.ext('OES_element_index_uint')) throw new Error('OES_element_index_uint is required for this mesh size');
    return util.mesh([
      { buffer: util.buffer(gl.ARRAY_BUFFER, g.pos), loc: 0, size: 3 },
      { buffer: util.buffer(gl.ARRAY_BUFFER, g.nrm), loc: 1, size: 3 },
      { buffer: util.buffer(gl.ARRAY_BUFFER, g.uv), loc: 2, size: 2 },
    ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, g.idx), { count: g.count, indexType: wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT });
  };
  /** Flat interleaved pos/normal data (cube, octa) as a mesh at locations 0/1. */
  geo.uploadFlat = function (util, g) {
    const gl = util.gl;
    const b = util.buffer(gl.ARRAY_BUFFER, g.data);
    return util.mesh([{ buffer: b, loc: 0, size: 3, stride: 24, offset: 0 }, { buffer: b, loc: 1, size: 3, stride: 24, offset: 12 }], null, { count: g.count });
  };
  Sandbox.geo = geo;

  /* ------------------------------------------------------------------ */
  /* GL utility (WebGL 1.0) with automatic resource tracking              */
  /* ------------------------------------------------------------------ */
  // Attribute naming convention → location, bound before every link so meshes are program-independent.
  const ATTRIB_LOCS = { a_pos: 0, a_nrm: 1, a_uv: 2, a_col: 3, a_i0: 4, a_i1: 5, a_i2: 6, a_i3: 7 };
  Sandbox.ATTRIB_LOCS = ATTRIB_LOCS;

  Sandbox.createUtil = function (gl) {
    const tracked = [];
    const extCache = {};
    const ext = (name) => (name in extCache ? extCache[name] : (extCache[name] = gl.getExtension(name)));
    const track = (kind, obj) => { tracked.push([kind, obj]); return obj; };
    const del = (kind, obj) => {
      if (!obj) return;
      switch (kind) {
        case 'program': gl.deleteProgram(obj); break;
        case 'buffer': gl.deleteBuffer(obj); break;
        case 'texture': gl.deleteTexture(obj); break;
        case 'framebuffer': gl.deleteFramebuffer(obj); break;
        case 'renderbuffer': gl.deleteRenderbuffer(obj); break;
        case 'vao': { const e = ext('OES_vertex_array_object'); if (e) e.deleteVertexArrayOES(obj); break; }
        case 'query': { const e = ext('EXT_disjoint_timer_query'); if (e) e.deleteQueryEXT(obj); break; }
      }
    };
    const fsHigh = (() => { const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT); return !!(f && f.precision > 0); })();

    // #extension directives must precede every other token, so they are hoisted above the prelude.
    function prepare(type, src) {
      const exts = [], body = [];
      for (const line of src.split('\n')) (/^\s*#extension\b/.test(line) ? exts : body).push(line);
      // A GLSL #extension only works once JavaScript has enabled the matching WebGL extension.
      const MAP = { GL_OES_standard_derivatives: 'OES_standard_derivatives', GL_EXT_frag_depth: 'EXT_frag_depth', GL_EXT_draw_buffers: 'WEBGL_draw_buffers', GL_EXT_shader_texture_lod: 'EXT_shader_texture_lod' };
      for (const l of exts) { const m = l.match(/#extension\s+(\w+)/); if (m && MAP[m[1]]) ext(MAP[m[1]]); }
      const prec = type === gl.VERTEX_SHADER ? 'precision highp float;\n' : fsHigh ? 'precision highp float;\n' : 'precision mediump float;\n';
      return exts.join('\n') + (exts.length ? '\n' : '') + prec + body.join('\n');
    }
    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, prepare(type, src));
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        const err = new Error((type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment') + ' shader error:\n' + log);
        err.shaderLog = log;
        throw err;
      }
      return sh;
    }

    function makeSetter(info, loc) {
      const arr = info.size > 1;
      switch (info.type) {
        case gl.FLOAT: return (v) => (typeof v === 'number' ? gl.uniform1f(loc, v) : gl.uniform1fv(loc, v));
        case gl.FLOAT_VEC2: return (v) => gl.uniform2fv(loc, v);
        case gl.FLOAT_VEC3: return (v) => gl.uniform3fv(loc, v);
        case gl.FLOAT_VEC4: return (v) => gl.uniform4fv(loc, v);
        case gl.FLOAT_MAT2: return (v) => gl.uniformMatrix2fv(loc, false, v);
        case gl.FLOAT_MAT3: return (v) => gl.uniformMatrix3fv(loc, false, v);
        case gl.FLOAT_MAT4: return (v) => gl.uniformMatrix4fv(loc, false, v);
        case gl.INT_VEC2: case gl.BOOL_VEC2: return (v) => gl.uniform2iv(loc, v);
        case gl.INT_VEC3: case gl.BOOL_VEC3: return (v) => gl.uniform3iv(loc, v);
        case gl.INT_VEC4: case gl.BOOL_VEC4: return (v) => gl.uniform4iv(loc, v);
        default: return (v) => (!arr || typeof v === 'number' || typeof v === 'boolean' ? gl.uniform1i(loc, +v) : gl.uniform1iv(loc, v));
      }
    }

    let enabled = new Set();          // attribute arrays currently enabled
    let divisors = new Set();         // attribute locations with a non-zero instancing divisor
    let fsBuf = null;

    const util = {
      gl,
      ext,
      fsHigh,
      /** Compile + link. Attributes are bound to ATTRIB_LOCS (others get 8+, or opts.attribs). */
      program(vs, fs, opts = {}) {
        const p = gl.createProgram();
        const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(p, v); gl.attachShader(p, f);
        const locs = Object.assign({}, ATTRIB_LOCS, opts.attribs || {});
        let next = 8;
        const re = /attribute\s+\w+\s+(\w+)\s*;/g; let m;
        const max = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        while ((m = re.exec(vs))) {
          let l = locs[m[1]];
          if (l === undefined) { l = next++; locs[m[1]] = l; }
          if (l < max) gl.bindAttribLocation(p, l, m[1]);
        }
        gl.linkProgram(p);
        gl.detachShader(p, v); gl.detachShader(p, f);
        gl.deleteShader(v); gl.deleteShader(f);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
          const log = gl.getProgramInfoLog(p);
          gl.deleteProgram(p);
          throw new Error('Program link error:\n' + log);
        }
        track('program', p);
        const setters = {}, uniforms = [];
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
        for (let i = 0; i < n; i++) {
          const info = gl.getActiveUniform(p, i);
          const loc = gl.getUniformLocation(p, info.name);
          if (!loc) continue;
          const key = info.name.replace(/\[0\]$/, '');
          setters[key] = makeSetter(info, loc);
          uniforms.push({ name: key, type: info.type, size: info.size });
        }
        const attribs = [];
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES) || 0;
        for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); attribs.push({ name: a.name, type: a.type, size: a.size, loc: gl.getAttribLocation(p, a.name) }); }
        return {
          prog: p, uniforms, attribs,
          loc: (name) => locs[name],
          use() { gl.useProgram(p); return this; },
          set(obj) { for (const k in obj) if (setters[k]) setters[k](obj[k]); return this; },
          has: (name) => !!setters[name],
        };
      },
      buffer(target, data, usage = gl.STATIC_DRAW) {
        const b = track('buffer', gl.createBuffer());
        if (target === gl.ELEMENT_ARRAY_BUFFER) { const e = ext('OES_vertex_array_object'); if (e) e.bindVertexArrayOES(null); }
        gl.bindBuffer(target, b);
        if (typeof data === 'number' || data) gl.bufferData(target, data, usage);
        return b;
      },
      /** Point attribute arrays at buffers. attribs: [{buffer, loc, size, type?, normalized?, stride?, offset?, divisor?}]
       *  Arrays not listed are disabled, and stale instancing divisors are reset. */
      bindAttribs(attribs) {
        const inst = ext('ANGLE_instanced_arrays');
        const want = new Set();
        for (const a of attribs) {
          gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
          gl.enableVertexAttribArray(a.loc);
          gl.vertexAttribPointer(a.loc, a.size, a.type || gl.FLOAT, !!a.normalized, a.stride || 0, a.offset || 0);
          want.add(a.loc);
          if (a.divisor) { inst.vertexAttribDivisorANGLE(a.loc, a.divisor); divisors.add(a.loc); }
          else if (divisors.has(a.loc)) { inst.vertexAttribDivisorANGLE(a.loc, 0); divisors.delete(a.loc); }
        }
        for (const l of enabled) if (!want.has(l)) gl.disableVertexAttribArray(l);
        for (const l of divisors) if (!want.has(l)) { inst.vertexAttribDivisorANGLE(l, 0); divisors.delete(l); }
        enabled = want;
      },
      /** A drawable: attribute layout + optional index buffer. opts: {count, indexType, mode} */
      mesh(attribs, indexBuffer = null, opts = {}) {
        const self = this;
        return {
          attribs, indexBuffer, count: opts.count || 0, indexType: opts.indexType || gl.UNSIGNED_SHORT,
          bind() {
            self.bindAttribs(this.attribs);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            return this;
          },
          draw(mode = opts.mode ?? gl.TRIANGLES, count = this.count, first = 0) {
            this.bind();
            if (this.indexBuffer) gl.drawElements(mode, count, this.indexType, first * (this.indexType === gl.UNSIGNED_INT ? 4 : this.indexType === gl.UNSIGNED_BYTE ? 1 : 2));
            else gl.drawArrays(mode, first, count);
          },
          drawInstanced(instances, mode = opts.mode ?? gl.TRIANGLES, count = this.count) {
            const inst = ext('ANGLE_instanced_arrays');
            this.bind();
            if (this.indexBuffer) inst.drawElementsInstancedANGLE(mode, count, this.indexType, 0, instances);
            else inst.drawArraysInstancedANGLE(mode, 0, count, instances);
          },
        };
      },
      /** Shared big-triangle at attribute 0 for full-screen passes. */
      drawFullscreen() {
        if (!fsBuf) fsBuf = this.buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]));
        this.bindAttribs([{ buffer: fsBuf, loc: 0, size: 2 }]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      /** 2D or cube texture. o: {width,height,data|source,format,type,filter,minFilter,wrap,wrapS,wrapT,mipmap,target}
       *  For cube maps pass o.faces = [6 sources or typed arrays]. */
      texture(o = {}) {
        const t = track('texture', gl.createTexture());
        const target = o.target || (o.faces ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D);
        gl.bindTexture(target, t);
        const format = o.format || gl.RGBA, type = o.type || gl.UNSIGNED_BYTE;
        if (o.flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        const up = (tg, src) => {
          if (src && !(ArrayBuffer.isView(src))) gl.texImage2D(tg, 0, format, format, type, src);
          else gl.texImage2D(tg, 0, format, o.width, o.height, 0, format, type, src || null);
        };
        if (target === gl.TEXTURE_CUBE_MAP) for (let i = 0; i < 6; i++) up(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, o.faces ? o.faces[i] : null);
        else up(gl.TEXTURE_2D, o.source || o.data);
        if (o.flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        const filter = o.filter || gl.LINEAR;
        if (o.mipmap) gl.generateMipmap(target);
        gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, o.minFilter || (o.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filter));
        gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(target, gl.TEXTURE_WRAP_S, o.wrapS || o.wrap || gl.CLAMP_TO_EDGE);
        gl.texParameteri(target, gl.TEXTURE_WRAP_T, o.wrapT || o.wrap || gl.CLAMP_TO_EDGE);
        gl.bindTexture(target, null);
        return t;
      },
      rawTexture() { return track('texture', gl.createTexture()); },
      renderbuffer(internal, w, h) {
        const rb = track('renderbuffer', gl.createRenderbuffer());
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, internal, w, h);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        return rb;
      },
      /** colors: textures (more than one needs WEBGL_draw_buffers); depth: renderbuffer, {tex}, or null.
       *  opts.stencil attaches as DEPTH_STENCIL; opts.attach overrides the attachment point. opts.cubeFace targets a cube face. */
      framebuffer(colors = [], depth = null, opts = {}) {
        const fb = track('framebuffer', gl.createFramebuffer());
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        const db = colors.length > 1 ? ext('WEBGL_draw_buffers') : null;
        if (colors.length > 1 && !db) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); throw new Error('WEBGL_draw_buffers is not supported'); }
        colors.forEach((c, i) => {
          const att = i === 0 ? gl.COLOR_ATTACHMENT0 : db.COLOR_ATTACHMENT0_WEBGL + i;
          if (c && c.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, att, gl.RENDERBUFFER, c.rb);
          else gl.framebufferTexture2D(gl.FRAMEBUFFER, att, opts.cubeFace ?? gl.TEXTURE_2D, c, 0);
        });
        if (db) db.drawBuffersWEBGL(colors.map((_, i) => db.COLOR_ATTACHMENT0_WEBGL + i));
        const dAttach = opts.attach || (opts.stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT);
        if (depth && depth.tex) gl.framebufferTexture2D(gl.FRAMEBUFFER, dAttach, gl.TEXTURE_2D, depth.tex, 0);
        else if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, dAttach, gl.RENDERBUFFER, depth);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost() && !opts.allowIncomplete) {
          gl.deleteFramebuffer(fb); tracked.pop();
          throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
        }
        fb.status = status;
        return fb;
      },
      /** Render target: color texture (+ optional depth renderbuffer). opts: {type, filter, wrap, depth, format}
       *  type may be gl.FLOAT ('float') or the OES half-float constant ('half'). */
      target(w, h, opts = {}) {
        let type = opts.type || gl.UNSIGNED_BYTE;
        if (type === 'float') { if (!ext('OES_texture_float')) throw new Error('OES_texture_float is not supported'); ext('WEBGL_color_buffer_float'); type = gl.FLOAT; }
        if (type === 'half') { const hf = ext('OES_texture_half_float'); if (!hf) throw new Error('OES_texture_half_float is not supported'); ext('EXT_color_buffer_half_float'); type = hf.HALF_FLOAT_OES; }
        let filter = opts.filter || gl.LINEAR;
        if (type === gl.FLOAT && filter === gl.LINEAR && !ext('OES_texture_float_linear')) filter = gl.NEAREST;
        if (type !== gl.FLOAT && type !== gl.UNSIGNED_BYTE && filter === gl.LINEAR && !ext('OES_texture_half_float_linear')) filter = gl.NEAREST;
        const tex = this.texture({ width: w, height: h, type, format: opts.format, filter, wrap: opts.wrap });
        const depth = opts.depth ? this.renderbuffer(opts.stencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT16, w, h) : null;
        const fb = this.framebuffer([tex], depth, { stencil: opts.stencil });
        return { fb, tex, depth, w, h, type };
      },
      /** Two targets that swap roles each step (read ← previous, write ← next). */
      pingpong(w, h, opts = {}) {
        const a = this.target(w, h, opts), b = this.target(w, h, opts);
        return { read: a, write: b, w, h, swap() { const t = this.read; this.read = this.write; this.write = t; } };
      },
      /** Bind a texture to a unit: tex(unit, texture, target?) */
      tex(unit, t, target = gl.TEXTURE_2D) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); gl.activeTexture(gl.TEXTURE0); },
      /** Bind a framebuffer (or null) and set a matching viewport. */
      bindTarget(t, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, t ? t.w : w, t ? t.h : h); },
      vao() { const e = ext('OES_vertex_array_object'); if (!e) throw new Error('OES_vertex_array_object is not supported'); return track('vao', e.createVertexArrayOES()); },
      query() { const e = ext('EXT_disjoint_timer_query'); if (!e) throw new Error('EXT_disjoint_timer_query is not supported'); return track('query', e.createQueryEXT()); },
      /** Bookkeeping hook for attribute state changed outside bindAttribs (e.g. inside a VAO). */
      forgetAttribs() { enabled = new Set(); divisors = new Set(); },
      release(...objs) {
        for (const o of objs) {
          const i = tracked.findIndex((t) => t[1] === o);
          if (i >= 0) { del(tracked[i][0], o); tracked.splice(i, 1); }
          if (o === fsBuf) fsBuf = null;
        }
      },
      disposeAll() {
        for (let i = tracked.length - 1; i >= 0; i--) del(tracked[i][0], tracked[i][1]);
        tracked.length = 0;
        fsBuf = null;
      },
      get trackedCount() { return tracked.length; },
    };
    return util;
  };

  /* Reset GL state between studies so nothing leaks from one to the next. */
  Sandbox.resetGLState = function (gl, w, h) {
    const vaoExt = gl.getExtension('OES_vertex_array_object');
    if (vaoExt) vaoExt.bindVertexArrayOES(null);
    const inst = gl.getExtension('ANGLE_instanced_arrays');
    const maxA = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    for (let i = 0; i < maxA; i++) {
      gl.disableVertexAttribArray(i);
      gl.vertexAttrib4f(i, 0, 0, 0, 1);
      if (inst) inst.vertexAttribDivisorANGLE(i, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.useProgram(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    for (const cap of [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.POLYGON_OFFSET_FILL, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE]) gl.disable(cap);
    gl.enable(gl.DITHER);
    gl.depthMask(true); gl.depthFunc(gl.LESS); gl.depthRange(0, 1); gl.clearDepth(1);
    gl.colorMask(true, true, true, true);
    gl.blendFunc(gl.ONE, gl.ZERO); gl.blendEquation(gl.FUNC_ADD); gl.blendColor(0, 0, 0, 0);
    gl.stencilMask(0xff); gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP); gl.clearStencil(0);
    gl.frontFace(gl.CCW); gl.cullFace(gl.BACK);
    gl.polygonOffset(0, 0); gl.lineWidth(1); gl.sampleCoverage(1, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.hint(gl.GENERATE_MIPMAP_HINT, gl.DONT_CARE);
    const units = Math.min(16, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS));
    for (let i = 0; i < units; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); gl.bindTexture(gl.TEXTURE_CUBE_MAP, null); }
    gl.activeTexture(gl.TEXTURE0);
    gl.viewport(0, 0, w, h); gl.scissor(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
  };

  /* ------------------------------------------------------------------ */
  /* Orbit camera with inertia, zoom, pinch and pan                       */
  /* ------------------------------------------------------------------ */
  class OrbitCam {
    constructor(o = {}) {
      this.home = { yaw: o.yaw ?? 0.6, pitch: o.pitch ?? 0.35, dist: o.dist ?? 6, target: o.target ? o.target.slice() : [0, 0, 0] };
      this.minDist = o.minDist ?? 1.5; this.maxDist = o.maxDist ?? 30;
      this.minPitch = o.minPitch ?? -1.45; this.maxPitch = o.maxPitch ?? 1.45;
      this.damping = o.damping ?? 0.9;
      this.auto = o.auto ?? 0;
      this.fov = o.fov ?? 0.85;
      this.reset();
    }
    reset() {
      this.yaw = this.home.yaw; this.pitch = this.home.pitch; this.dist = this.home.dist;
      this.target = this.home.target.slice(); this.vy = 0; this.vp = 0;
    }
    update(input, dt, allowPan = true) {
      if (input.dragging) {
        if (allowPan && (input.shift || input.button === 2)) {
          const b = this.basis();
          const s = this.dist * 0.0016;
          this.target = V3.add(this.target, V3.add(V3.scale(b.right, -input.dragDX * s), V3.scale(b.up, input.dragDY * s)));
        } else {
          this.vy = -input.dragDX * 0.006;
          this.vp = input.dragDY * 0.006;
        }
      }
      const gp = input.gamepad;
      if (gp) {
        this.yaw -= (gp.axes[2] || 0) * dt * 2.2;
        this.pitch += (gp.axes[3] || 0) * dt * 1.6;
        this.dist *= 1 + ((gp.buttons[6] || 0) - (gp.buttons[7] || 0)) * dt * 1.5;
      }
      this.yaw += this.vy; this.pitch += this.vp;
      const d = Math.pow(this.damping, dt * 60);
      if (!input.dragging) { this.vy *= d; this.vp *= d; }
      this.yaw += this.auto * dt;
      this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);
      this.dist = clamp(this.dist * Math.exp(input.wheel * 0.0012) / input.pinch, this.minDist, this.maxDist);
    }
    eye() {
      const cp = Math.cos(this.pitch);
      return [
        this.target[0] + this.dist * cp * Math.sin(this.yaw),
        this.target[1] + this.dist * Math.sin(this.pitch),
        this.target[2] + this.dist * cp * Math.cos(this.yaw),
      ];
    }
    view() { return M4.lookAt(this.eye(), this.target); }
    proj(aspect, near = 0.1, far = 200) { return M4.persp(this.fov, aspect, near, far); }
    basis() {
      const fwd = V3.norm(V3.sub(this.target, this.eye()));
      const right = V3.norm(V3.cross(fwd, [0, 1, 0]));
      const up = V3.cross(right, fwd);
      return { fwd, right, up };
    }
    /** World-space ray through normalized device coords (nx, ny in -1..1). */
    ray(nx, ny, aspect) {
      const b = this.basis(), t = Math.tan(this.fov / 2);
      const dir = V3.norm(V3.add(b.fwd, V3.add(V3.scale(b.right, nx * t * aspect), V3.scale(b.up, ny * t))));
      return { origin: this.eye(), dir };
    }
  }
  Sandbox.OrbitCam = OrbitCam;

  /* ------------------------------------------------------------------ */
  /* Poster artwork: editorial compositions drawn with Canvas 2D          */
  /* ------------------------------------------------------------------ */
  Sandbox.POSTER_TITLES = ['Field', 'Signal', 'Orbit', 'Grain', 'Tide', 'Prism'];
  /** Draw poster i into a fresh canvas (W×H). */
  Sandbox.posterCanvas = function (i, W = 512, H = 640) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const { A1: C1, A2: C2, BONE, INK } = Sandbox.CSS;
    const rng = (seed) => () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296;
    const r = rng(i * 7919 + 13);
    const k6 = i % 6, sx = W / 640, sy = H / 800;
    g.fillStyle = i % 3 === 0 ? INK : i % 3 === 1 ? '#121318' : '#14111a'; g.fillRect(0, 0, W, H);
    g.save(); g.scale(sx, sy);
    const w = 640;
    if (k6 === 0) { for (let k = 0; k < 18; k++) { g.fillStyle = k % 2 ? C1 : C2; g.globalAlpha = 0.85; g.fillRect(0, 120 + k * 26, w * (0.2 + r() * 0.8), 10); } }
    if (k6 === 1) { g.strokeStyle = C2; g.lineWidth = 3; for (let k = 0; k < 14; k++) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, 330 + Math.sin(x * 0.02 + k * 0.5) * (20 + k * 9) + k * 6); g.stroke(); } g.fillStyle = C1; g.beginPath(); g.arc(w * 0.72, 220, 70, 0, 7); g.fill(); }
    if (k6 === 2) { for (let k = 6; k > 0; k--) { g.strokeStyle = k % 2 ? C1 : C2; g.lineWidth = 2 + k; g.beginPath(); g.ellipse(w / 2, 360, 40 + k * 42, 18 + k * 16, -0.4, 0, 7); g.stroke(); } g.fillStyle = BONE; g.beginPath(); g.arc(w / 2, 360, 34, 0, 7); g.fill(); }
    if (k6 === 3) { for (let k = 0; k < 5200; k++) { const x = r() * w, y = 100 + r() * 480; g.fillStyle = r() < 0.5 ? C1 : C2; g.globalAlpha = r() * 0.8; g.fillRect(x, y, 2, 2); } g.globalAlpha = 1; g.fillStyle = BONE; g.fillRect(w * 0.1, 300, w * 0.8, 3); }
    if (k6 === 4) { for (let k = 0; k < 9; k++) { const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, C2); grd.addColorStop(1, C1); g.fillStyle = grd; g.globalAlpha = 0.12 + k * 0.08; g.beginPath(); g.moveTo(0, 560 - k * 40); for (let x = 0; x <= w; x += 10) g.lineTo(x, 560 - k * 40 + Math.sin(x * 0.012 + k) * 30); g.lineTo(w, 800); g.lineTo(0, 800); g.fill(); } }
    if (k6 === 5) { g.globalCompositeOperation = 'lighter'; const pts = [[w * 0.5, 160], [w * 0.15, 560], [w * 0.85, 560]]; [C1, C2, BONE].forEach((col, k) => { g.fillStyle = col; g.globalAlpha = 0.55; g.beginPath(); g.moveTo(pts[k][0], pts[k][1]); g.lineTo(pts[(k + 1) % 3][0] + (k - 1) * 40, pts[(k + 1) % 3][1]); g.lineTo(w / 2, 400); g.fill(); }); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = BONE; g.font = 'italic 150px "Instrument Serif", Georgia, serif'; g.textBaseline = 'alphabetic';
    g.fillText(String(i + 1).padStart(2, '0'), 36, 710);
    g.font = '500 15px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(236,233,226,0.7)';
    g.fillText(('STUDY ' + String(i + 1).padStart(2, '0') + ' / ' + Sandbox.POSTER_TITLES[k6]).toUpperCase(), 40, 60);
    g.fillText('WEBGL 1.0', w - 140, 60);
    g.fillStyle = i % 2 ? C2 : C1; g.fillRect(40, 740, 60, 4);
    g.restore();
    return c;
  };
  /** A procedural texture-test canvas: checker + gradient + labelled grid (useful for filtering / wrap studies). */
  Sandbox.testCanvas = function (S = 256, label = '') {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const { A1: C1, A2: C2, BONE, INK } = Sandbox.CSS;
    const n = 8, q = S / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#15171c' : '#23262e'; g.fillRect(x * q, y * q, q, q); }
    const grd = g.createLinearGradient(0, 0, S, S); grd.addColorStop(0, C1); grd.addColorStop(1, C2);
    g.strokeStyle = grd; g.lineWidth = Math.max(2, S / 64);
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.32, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(S, S); g.moveTo(S, 0); g.lineTo(0, S); g.stroke();
    g.fillStyle = BONE; g.font = `italic ${Math.round(S * 0.28)}px "Instrument Serif", Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label || 'Aa', S / 2, S / 2 + S * 0.02);
    g.fillStyle = C1; g.fillRect(0, 0, S * 0.12, S * 0.12);
    g.fillStyle = C2; g.fillRect(S * 0.88, S * 0.88, S * 0.12, S * 0.12);
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(0.5, 0.5, S - 1, S - 1);
    return c;
  };
  /** Six labelled faces for cube-map studies (+X −X +Y −Y +Z −Z). */
  Sandbox.cubeFaces = function (S = 256) {
    const names = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'];
    const { A1: C1, A2: C2, BONE } = Sandbox.CSS;
    return names.map((nm, i) => {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 0, S);
      const top = i === 2, bot = i === 3;
      grd.addColorStop(0, top ? '#1b2a40' : bot ? '#0a0b0e' : '#16233a');
      grd.addColorStop(1, top ? '#24304a' : bot ? '#050607' : '#0b0c10');
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
      if (!top && !bot) {
        g.fillStyle = i % 2 ? C2 : C1; g.globalAlpha = 0.85;
        for (let k = 0; k < 9; k++) { const x = (k / 9) * S, h = S * (0.08 + ((k * 37 + i * 11) % 9) / 30); g.fillRect(x, S * 0.62 - h, S / 11, h); }
        g.globalAlpha = 1; g.fillStyle = '#07080a'; g.fillRect(0, S * 0.62, S, S * 0.38);
        g.strokeStyle = i % 2 ? C2 : C1; g.globalAlpha = 0.4; for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(0, S * 0.62 + k * k * 3); g.lineTo(S, S * 0.62 + k * k * 3); g.stroke(); }
        g.globalAlpha = 1;
      }
      if (top) { g.fillStyle = BONE; for (let k = 0; k < 60; k++) { g.globalAlpha = 0.3 + ((k * 13) % 7) / 10; g.fillRect((k * 97) % S, (k * 61) % S, 2, 2); } g.globalAlpha = 1; }
      g.fillStyle = 'rgba(236,233,226,0.75)'; g.font = `500 ${Math.round(S / 12)}px "JetBrains Mono", monospace`; g.textAlign = 'center';
      g.fillText(nm, S / 2, S * 0.2);
      return c;
    });
  };

  /* ------------------------------------------------------------------ */
  /* Input: pointer (mouse/pen/touch), multi-touch, pinch, wheel, keys    */
  /* ------------------------------------------------------------------ */
  Sandbox.createInput = function (canvas) {
    const input = {
      x: 0, y: 0, uvx: 0.5, uvy: 0.5, nx: 0, ny: 0,
      hover: false, down: false, button: 0, shift: false, pointerType: 'mouse',
      dragging: false, dragDX: 0, dragDY: 0, wheel: 0, pinch: 1,
      clicks: [], pointers: new Map(), keys: new Set(), pressed: new Set(),
      width: 1, height: 1,
    };
    let primary = null, pinchDist = 0;

    function loc(e) {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      input.width = r.width || 1; input.height = r.height || 1;
      return { x, y, uvx: x / input.width, uvy: 1 - y / input.height };
    }
    function setMain(p) {
      input.x = p.x; input.y = p.y; input.uvx = p.uvx; input.uvy = p.uvy;
      input.nx = p.uvx * 2 - 1; input.ny = p.uvy * 2 - 1;
    }
    function pinchUpdate() {
      const ps = [...input.pointers.values()];
      if (ps.length === 2) {
        const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
        if (pinchDist > 0 && d > 0) input.pinch *= d / pinchDist;
        pinchDist = d;
      } else pinchDist = 0;
    }

    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const l = loc(e);
      const p = { id: e.pointerId, ...l, px: l.x, py: l.y, puvx: l.uvx, puvy: l.uvy, moved: 0, button: e.button, index: input.pointers.size, born: performance.now() };
      input.pointers.set(e.pointerId, p);
      if (primary === null) { primary = e.pointerId; setMain(l); input.button = e.button; }
      input.down = true; input.shift = e.shiftKey; input.pointerType = e.pointerType;
      pinchDist = 0; pinchUpdate();
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener('pointermove', (e) => {
      const l = loc(e);
      input.hover = true; input.shift = e.shiftKey; input.pointerType = e.pointerType;
      const p = input.pointers.get(e.pointerId);
      if (p) {
        const dx = l.x - p.x, dy = l.y - p.y;
        Object.assign(p, l);
        p.moved += Math.abs(dx) + Math.abs(dy);
        if (e.pointerId === primary && input.pointers.size === 1) { input.dragDX += dx; input.dragDY += dy; }
        if (input.pointers.size === 2) pinchUpdate();
      }
      if (primary === null || e.pointerId === primary) setMain(l);
    });
    const end = (e) => {
      const p = input.pointers.get(e.pointerId);
      if (!p) return;
      if (p.moved < 6 && e.type === 'pointerup') input.clicks.push({ x: p.x, y: p.y, uvx: p.uvx, uvy: p.uvy, nx: p.uvx * 2 - 1, ny: p.uvy * 2 - 1, button: p.button });
      input.pointers.delete(e.pointerId);
      if (e.pointerId === primary) {
        const next = input.pointers.keys().next();
        primary = next.done ? null : next.value;
      }
      input.down = input.pointers.size > 0;
      pinchDist = 0; pinchUpdate();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerenter', () => { input.hover = true; });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') input.hover = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      input.wheel += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    }, { passive: false });

    const isField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    window.addEventListener('keydown', (e) => {
      if (isField(e.target) || e.metaKey || e.ctrlKey) return;
      if (!input.keys.has(e.code)) input.pressed.add(e.code);
      input.keys.add(e.code);
      input.shift = e.shiftKey;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { input.keys.delete(e.code); input.shift = e.shiftKey; });
    window.addEventListener('blur', () => { input.keys.clear(); });

    /** Called once per frame after the demo has consumed this frame's events. */
    input.endFrame = function () {
      input.dragDX = input.dragDY = input.wheel = 0;
      input.pinch = 1;
      input.clicks.length = 0;
      input.pressed.clear();
      for (const p of input.pointers.values()) { p.px = p.x; p.py = p.y; p.puvx = p.uvx; p.puvy = p.uvy; }
    };
    input.gamepad = null;
    input.update = function () {
      input.dragging = input.down && input.pointers.size === 1;
      // Gamepad API: first connected pad, with a small dead zone on the sticks.
      let gp = null;
      try { for (const p of (navigator.getGamepads ? navigator.getGamepads() : [])) if (p && p.connected) { gp = p; break; } } catch (_) { /* blocked by policy */ }
      input.gamepad = gp ? { id: gp.id, axes: gp.axes.map((a) => (Math.abs(a) < 0.12 ? 0 : a)), buttons: gp.buttons.map((b) => b.value) } : null;
    };
    return input;
  };
})();
