/* WebGL2 Interaction Lab — core helpers shared by every demo.
 * No dependencies: raw WebGL 2.0, a tiny math library, geometry builders,
 * a resource tracker (so switching demos frees all GPU objects), an orbit
 * camera, and a unified pointer / touch / wheel / keyboard input model. */
(function () {
  'use strict';

  const RED = [1.0, 0.231, 0.306];
  const BLUE = [0.231, 0.545, 1.0];

  const Sandbox = (window.Sandbox = { demos: [], RED, BLUE });
  Sandbox.register = (demo) => Sandbox.demos.push(demo);

  /* ------------------------------------------------------------------ */
  /* Shared GLSL snippets                                                */
  /* ------------------------------------------------------------------ */
  Sandbox.GLSL = {
    colors: `
const vec3 RED  = vec3(1.0, 0.231, 0.306);
const vec3 BLUE = vec3(0.231, 0.545, 1.0);
const vec3 INK  = vec3(0.027, 0.031, 0.047);
`,
    // Fullscreen triangle generated from gl_VertexID: no vertex buffers at all.
    fullscreenVS: `
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`,
    // Integer hash (uint bit ops are WebGL2/GLSL ES 3.00 only). Mirrored in JS below
    // so the CPU can evaluate the exact same terrain the GPU draws.
    noise: `
uint hashu(ivec2 p) {
  uint x = uint(p.x) * 0x8da6b343u + uint(p.y) * 0xd8163841u;
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
float rnd2(ivec2 p) { return float(hashu(p) & 0xffffffu) / 16777215.0; }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = p - i; vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 ii = ivec2(i);
  float a = rnd2(ii), b = rnd2(ii + ivec2(1, 0)), c = rnd2(ii + ivec2(0, 1)), d = rnd2(ii + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return s;
}
`,
  };

  /* JS mirror of the GLSL noise */
  function hashu(x, y) {
    let h = (Math.imul(x | 0, 0x8da6b343) + Math.imul(y | 0, 0xd8163841)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
  }
  const rnd2 = (x, y) => (hashu(x, y) & 0xffffff) / 16777215;
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = rnd2(ix, iy), b = rnd2(ix + 1, iy), c = rnd2(ix, iy + 1), d = rnd2(ix + 1, iy + 1);
    const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
    return ab + (cd - ab) * uy;
  }
  function fbm(x, y) {
    let s = 0, a = 0.5;
    for (let i = 0; i < 5; i++) { s += a * vnoise(x, y); x *= 2; y *= 2; a *= 0.5; }
    return s;
  }
  Sandbox.noise = { hashu, rnd2, vnoise, fbm };

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
  Sandbox.math = { V3, M4, clamp, lerp, damp };

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
  /** Upload a surface (pos/nrm/uv/idx) into a VAO at locations 0/1/2. */
  geo.upload = function (util, g) {
    const gl = util.gl;
    const vao = util.vao([
      { buffer: util.buffer(gl.ARRAY_BUFFER, g.pos), loc: 0, size: 3 },
      { buffer: util.buffer(gl.ARRAY_BUFFER, g.nrm), loc: 1, size: 3 },
      { buffer: util.buffer(gl.ARRAY_BUFFER, g.uv), loc: 2, size: 2 },
    ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, g.idx));
    return { vao, count: g.count, type: g.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      draw(instances) { gl.bindVertexArray(vao); if (instances) gl.drawElementsInstanced(gl.TRIANGLES, g.count, this.type, 0, instances); else gl.drawElements(gl.TRIANGLES, g.count, this.type, 0); } };
  };
  Sandbox.geo = geo;

  /* ------------------------------------------------------------------ */
  /* GL utility with automatic resource tracking                          */
  /* ------------------------------------------------------------------ */
  const PRELUDE =
    '#version 300 es\n' +
    'precision highp float;\nprecision highp int;\n' +
    'precision highp sampler2D;\nprecision highp sampler3D;\nprecision highp usampler2D;\n' +
    'precision highp sampler2DArray;\nprecision highp sampler2DShadow;\n';

  Sandbox.createUtil = function (gl) {
    const tracked = [];
    const track = (kind, obj) => { tracked.push([kind, obj]); return obj; };
    const del = (kind, obj) => {
      if (!obj) return;
      switch (kind) {
        case 'program': gl.deleteProgram(obj); break;
        case 'buffer': gl.deleteBuffer(obj); break;
        case 'texture': gl.deleteTexture(obj); break;
        case 'framebuffer': gl.deleteFramebuffer(obj); break;
        case 'renderbuffer': gl.deleteRenderbuffer(obj); break;
        case 'vao': gl.deleteVertexArray(obj); break;
        case 'tf': gl.deleteTransformFeedback(obj); break;
        case 'sampler': gl.deleteSampler(obj); break;
        case 'query': gl.deleteQuery(obj); break;
      }
    };

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, PRELUDE + src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error((type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment') + ' shader error:\n' + log);
      }
      return sh;
    }

    function makeSetter(type, loc, size) {
      switch (type) {
        case gl.FLOAT: return (v) => (typeof v === 'number' ? gl.uniform1f(loc, v) : gl.uniform1fv(loc, v));
        case gl.FLOAT_VEC2: return (v) => gl.uniform2fv(loc, v);
        case gl.FLOAT_VEC3: return (v) => gl.uniform3fv(loc, v);
        case gl.FLOAT_VEC4: return (v) => gl.uniform4fv(loc, v);
        case gl.FLOAT_MAT3: return (v) => gl.uniformMatrix3fv(loc, false, v);
        case gl.FLOAT_MAT4: return (v) => gl.uniformMatrix4fv(loc, false, v);
        case gl.UNSIGNED_INT: return (v) => (typeof v === 'number' ? gl.uniform1ui(loc, v) : gl.uniform1uiv(loc, v));
        default: return (v) => (typeof v === 'number' || typeof v === 'boolean' ? gl.uniform1i(loc, +v) : gl.uniform1iv(loc, v));
      }
    }

    const util = {
      gl,
      /** Compile + link. opts.tf = ['v_a','v_b'] enables transform feedback capture. */
      program(vs, fs, opts = {}) {
        const p = gl.createProgram();
        const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(p, v); gl.attachShader(p, f);
        if (opts.tf) gl.transformFeedbackVaryings(p, opts.tf, opts.tfMode || gl.INTERLEAVED_ATTRIBS);
        gl.linkProgram(p);
        gl.deleteShader(v); gl.deleteShader(f);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
          const log = gl.getProgramInfoLog(p);
          gl.deleteProgram(p);
          throw new Error('Program link error:\n' + log);
        }
        track('program', p);
        const setters = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
        for (let i = 0; i < n; i++) {
          const info = gl.getActiveUniform(p, i);
          const loc = gl.getUniformLocation(p, info.name);
          if (!loc) continue; // uniform-block members have no location
          setters[info.name.replace(/\[0\]$/, '')] = makeSetter(info.type, loc, info.size);
        }
        return {
          prog: p,
          use() { gl.useProgram(p); return this; },
          set(obj) { for (const k in obj) if (setters[k]) setters[k](obj[k]); return this; },
          has: (name) => !!setters[name],
          bindBlock(name, binding) {
            const idx = gl.getUniformBlockIndex(p, name);
            if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, idx, binding);
            return this;
          },
        };
      },
      buffer(target, data, usage = gl.STATIC_DRAW) {
        const b = track('buffer', gl.createBuffer());
        // Element-array bindings are VAO state: never let a new index buffer clobber a bound VAO.
        if (target === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(null);
        gl.bindBuffer(target, b);
        if (typeof data === 'number') gl.bufferData(target, data, usage);
        else if (data) gl.bufferData(target, data, usage);
        return b;
      },
      /** Build a VAO. attribs: [{buffer, loc, size, type?, stride?, offset?, divisor?, integer?}] */
      vao(attribs = [], indexBuffer = null) {
        const v = track('vao', gl.createVertexArray());
        gl.bindVertexArray(v);
        for (const a of attribs) {
          gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
          gl.enableVertexAttribArray(a.loc);
          if (a.integer) gl.vertexAttribIPointer(a.loc, a.size, a.type || gl.INT, a.stride || 0, a.offset || 0);
          else gl.vertexAttribPointer(a.loc, a.size, a.type || gl.FLOAT, !!a.normalized, a.stride || 0, a.offset || 0);
          if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
        }
        if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        return v;
      },
      texture(o = {}) {
        const t = track('texture', gl.createTexture());
        const target = o.target || gl.TEXTURE_2D;
        gl.bindTexture(target, t);
        const internal = o.internal || gl.RGBA8, format = o.format || gl.RGBA, type = o.type || gl.UNSIGNED_BYTE;
        if (target === gl.TEXTURE_3D || target === gl.TEXTURE_2D_ARRAY) {
          gl.texImage3D(target, 0, internal, o.width, o.height, o.depth, 0, format, type, o.data || null);
          gl.texParameteri(target, gl.TEXTURE_WRAP_R, o.wrap || gl.CLAMP_TO_EDGE);
        } else {
          gl.texImage2D(target, 0, internal, o.width, o.height, 0, format, type, o.data || null);
        }
        const filter = o.filter || gl.LINEAR;
        gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, o.minFilter || filter);
        gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(target, gl.TEXTURE_WRAP_S, o.wrap || gl.CLAMP_TO_EDGE);
        gl.texParameteri(target, gl.TEXTURE_WRAP_T, o.wrap || gl.CLAMP_TO_EDGE);
        gl.bindTexture(target, null);
        return t;
      },
      rawTexture() { return track('texture', gl.createTexture()); },
      renderbuffer(internal, w, h, samples = 0) {
        const rb = track('renderbuffer', gl.createRenderbuffer());
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, w, h);
        else gl.renderbufferStorage(gl.RENDERBUFFER, internal, w, h);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        return rb;
      },
      /** colors: array of textures or {rb}; depth: renderbuffer, {tex} (depth texture) or null.
       *  opts.stencil attaches the depth renderbuffer as DEPTH_STENCIL. */
      framebuffer(colors = [], depth = null, opts = {}) {
        const fb = track('framebuffer', gl.createFramebuffer());
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        colors.forEach((c, i) => {
          if (c && c.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, c.rb);
          else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c, 0);
        });
        const dAttach = opts.stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
        if (depth && depth.tex) gl.framebufferTexture2D(gl.FRAMEBUFFER, dAttach, gl.TEXTURE_2D, depth.tex, 0);
        else if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, dAttach, gl.RENDERBUFFER, depth);
        if (!colors.length) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
        // A framebuffer with no attachments yet (filled later, e.g. framebufferTextureLayer) can't be complete.
        const status = colors.length || depth ? gl.checkFramebufferStatus(gl.FRAMEBUFFER) : gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
        return fb;
      },
      transformFeedback() { return track('tf', gl.createTransformFeedback()); },
      /** Sampler object: filtering / wrap / compare state decoupled from the texture. */
      sampler(params = {}) {
        const sm = track('sampler', gl.createSampler());
        for (const k in params) {
          const v = params[k];
          if (typeof v === 'number' && !Number.isInteger(v)) gl.samplerParameterf(sm, gl[k] ?? +k, v);
          else gl.samplerParameteri(sm, gl[k] ?? +k, v);
        }
        return sm;
      },
      query() { return track('query', gl.createQuery()); },
      /** Release a set of objects early (e.g. when resizing render targets). */
      release(...objs) {
        for (const o of objs) {
          const i = tracked.findIndex((t) => t[1] === o);
          if (i >= 0) { del(tracked[i][0], o); tracked.splice(i, 1); }
        }
      },
      disposeAll() {
        for (let i = tracked.length - 1; i >= 0; i--) del(tracked[i][0], tracked[i][1]);
        tracked.length = 0;
      },
      // Empty VAO for attribute-less draws (gl_VertexID / gl_InstanceID only).
      get emptyVAO() {
        if (!this._empty) this._empty = this.vao([]);
        return this._empty;
      },
      drawFullscreen() {
        gl.bindVertexArray(this.emptyVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      resetEmpty() { this._empty = null; },
    };
    return util;
  };

  /* Reset GL state between demos so nothing leaks from one to the next. */
  Sandbox.resetGLState = function (gl, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    for (const cap of [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.RASTERIZER_DISCARD, gl.SCISSOR_TEST]) gl.disable(cap);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.blendEquation(gl.FUNC_ADD);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (let i = 0; i < 8; i++) gl.bindSampler(i, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
    gl.viewport(0, 0, w, h);
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
      if (p.moved < 6 && e.type === 'pointerup') input.clicks.push({ x: p.x, y: p.y, uvx: p.uvx, uvy: p.uvy, button: p.button });
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
