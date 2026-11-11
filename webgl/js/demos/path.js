/* Path Follow — draw a path on the ground; it is smoothed into a Catmull-Rom
 * spline, re-parameterised by arc length, and a convoy of travellers rides it
 * at constant speed, banking into the curves. Switch to Ride for a chase cam. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Ray, damp } = S.math;
  const M = 600, K = 14;

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_n; out vec3 v_w;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_n = mat3(u_model) * a_nrm; v_w = w.xyz; gl_Position = u_vp * w; }`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; out vec4 o; uniform vec3 u_col; uniform int u_kind; uniform float u_time;
void main() {
  if (u_kind == 1) {
    vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz); float line = 1.0 - min(min(g.x, g.y), 1.0);
    float f = exp(-length(v_w.xz) * 0.06);
    o = vec4(vec3(0.03, 0.032, 0.042) + line * 0.05 * f, 1.0); return;
  }
  float d = 0.4 + 0.6 * max(dot(normalize(v_n), normalize(vec3(0.3, 0.9, 0.4))), 0.0);
  o = vec4(u_col * d + u_col * 0.25, 1.0);
}`;
  const RIB_VS = `layout(location = 0) in vec3 a_p; layout(location = 1) in float a_s; uniform mat4 u_vp; out float v_s; void main() { v_s = a_s; gl_Position = u_vp * vec4(a_p, 1.0); }`;
  const RIB_FS = S.GLSL.colors + `in float v_s; out vec4 o; uniform float u_time; uniform float u_len;
void main() { float dash = step(0.5, fract(v_s * 1.2 - u_time * 1.5)); vec3 c = mix(BLUE, RED, fract(v_s / u_len)); o = vec4(c * (0.35 + 0.65 * dash), 1.0); }`;

  function catmull(pts, closed, samples) {
    const n = pts.length, out = [];
    const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < samples; k++) {
        const t = k / samples, t2 = t * t, t3 = t2 * t;
        out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
      }
    }
    if (!closed) out.push(pts[n - 1].slice());
    return out;
  }
  function resample(curve, count, closed) { // equal arc-length spacing
    const L = [0];
    for (let i = 1; i < curve.length; i++) L.push(L[i - 1] + V3.len(V3.sub(curve[i], curve[i - 1])));
    const total = L[L.length - 1] + (closed ? V3.len(V3.sub(curve[0], curve[curve.length - 1])) : 0);
    const pts = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const d = (i / (closed ? count : count - 1)) * (closed ? total : L[L.length - 1]);
      while (j < L.length - 2 && L[j + 1] < d) j++;
      const a = curve[j], b = curve[Math.min(j + 1, curve.length - 1)];
      const seg = (L[j + 1] ?? total) - L[j] || 1;
      const t = Math.min(1, Math.max(0, (d - L[j]) / seg));
      pts.push(V3.add(a, V3.scale(V3.sub(b, a), t)));
    }
    return { pts, total };
  }

  S.register({
    id: 'path',
    title: 'Path Follow',
    category: 'Animation',
    thumb: 'portrait',
    hint: 'draw a path on the ground · Ride for a chase camera',
    description: 'Motion along a path you draw. The freehand stroke is smoothed into a Catmull-Rom spline and resampled by arc length, which matters: the curve\'s own parameter crowds points into tight bends, so without resampling the travellers would lurch. Fourteen travellers then glide at a truly constant speed, steer by the tangent and bank by the curvature. Ride mounts a chase camera on the lead traveller, with look-ahead smoothing.',
    interact: [['Press + drag on the ground', 'Draw a new path (closes itself if you return to the start)'], ['View: Ride', 'Chase camera on the lead traveller'], ['Drag (Overview)', 'Orbit'], ['Easing', 'Constant speed or ping-pong ease-in-out']],
    features: ['Catmull-Rom splines', 'Arc-length reparameterisation', 'Tangent / curvature banking', 'Chase camera with look-ahead', 'Animated dashed ribbon'],
    params: [
      { key: 'view', label: 'View', type: 'select', options: ['Overview', 'Ride'], value: 0 },
      { key: 'ease', label: 'Easing', type: 'select', options: ['Constant', 'Ping-pong ease'], value: 0 },
      { key: 'speed', label: 'Speed (units/s)', type: 'range', min: 0.5, max: 12, step: 0.1, value: 4 },
      { key: 'bank', label: 'Banking', type: 'range', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'preset', label: 'Figure-eight', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data), o = S.geo.octa(), ob = util.buffer(gl.ARRAY_BUFFER, o.data);
      const s = {
        prog: util.program(VS, FS), ribP: util.program(RIB_VS, RIB_FS),
        cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        octVao: util.vao([{ buffer: ob, loc: 0, size: 3, stride: 24 }, { buffer: ob, loc: 1, size: 3, stride: 24, offset: 12 }]),
        ribBuf: util.buffer(gl.ARRAY_BUFFER, (M + 1) * 2 * 16, gl.DYNAMIC_DRAW), drawing: null, dist: 0, dir: 1,
        cam: new S.OrbitCam({ dist: 26, pitch: 0.95, yaw: 0.3, minDist: 8, maxDist: 60, auto: 0.03 }), rideEye: null, rideAt: null,
      };
      s.ribVao = util.vao([{ buffer: s.ribBuf, loc: 0, size: 3, stride: 16 }, { buffer: s.ribBuf, loc: 1, size: 1, stride: 16, offset: 12 }]);
      preset(s, ctx);
      return s;
    },
    action(ctx, s, key) { if (key === 'preset') preset(s, ctx); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      // drawing on the ground (plane y = 0)
      const ground = (uvx, uvy) => { const r = s.cam.ray(uvx * 2 - 1, uvy * 2 - 1, ctx.aspect); return Ray.plane(r.origin, r.dir, [0, 0, 0], [0, 1, 0]); };
      if (params.view === 0 && input.dragging && !input.shift && input.button === 0) {
        const p = ground(input.uvx, input.uvy);
        if (p) {
          if (!s.drawing) s.drawing = [p];
          else if (V3.len(V3.sub(p, s.drawing[s.drawing.length - 1])) > 0.4) s.drawing.push(p);
        }
      } else if (s.drawing) {
        if (s.drawing.length >= 4) {
          const closed = V3.len(V3.sub(s.drawing[0], s.drawing[s.drawing.length - 1])) < 2.5;
          setPath(s, ctx, s.drawing, closed);
        }
        s.drawing = null;
      }
      if (params.view === 0 && !s.drawing) s.cam.update(input.shift || input.button === 2 ? input : Object.assign({}, input, { dragging: false }), dt);
      // advance along the arc-length parameterised path
      const L = s.total;
      if (params.ease === 0 || s.closed) s.dist = (s.dist + params.speed * dt) % L;
      else { s.phase = (s.phase || 0) + params.speed * dt / L; const u = 0.5 - 0.5 * Math.cos(s.phase * Math.PI); s.dist = u * L * 0.999; }
      const at = (d) => {
        const n = s.pts.length;
        const f = ((d / L) * (s.closed ? n : n - 1));
        let i = Math.floor(f), k = f - i;
        const A = s.pts[s.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))], B = s.pts[s.closed ? (((i + 1) % n) + n) % n : Math.max(0, Math.min(n - 1, i + 1))];
        return V3.add(A, V3.scale(V3.sub(B, A), k));
      };
      const spacing = Math.min(1.2, L / (K * 1.3));
      const movers = [];
      for (let j = 0; j < K; j++) {
        let d = s.dist - j * spacing; if (s.closed) d = ((d % L) + L) % L; else d = Math.max(0, d);
        const p = at(d), p2 = at(s.closed ? (d + 0.3) % L : Math.min(L, d + 0.3)), p0 = at(s.closed ? (d - 0.3 + L) % L : Math.max(0, d - 0.3));
        const tan = V3.norm(V3.sub(p2, p0));
        const turn = V3.cross(V3.norm(V3.sub(p, p0)), V3.norm(V3.sub(p2, p)))[1];   // signed curvature proxy
        movers.push({ p, tan, bank: Math.max(-0.9, Math.min(0.9, -turn * 6 * params.bank)) });
      }
      // ribbon geometry
      const rib = new Float32Array((s.pts.length + (s.closed ? 1 : 0)) * 2 * 4);
      const cnt = s.pts.length + (s.closed ? 1 : 0);
      for (let i = 0; i < cnt; i++) {
        const a = s.pts[i % s.pts.length], b = s.pts[(i + 1) % s.pts.length] || a, c = s.pts[(i - 1 + s.pts.length) % s.pts.length];
        const tg = V3.norm(V3.sub(s.closed || i < s.pts.length - 1 ? b : a, s.closed || i > 0 ? c : a));
        const nrm = V3.norm(V3.cross(tg, [0, 1, 0]));
        const w = 0.09, dd = (i / (s.closed ? s.pts.length : s.pts.length - 1)) * L;
        rib.set([a[0] + nrm[0] * w, 0.02, a[2] + nrm[2] * w, dd, a[0] - nrm[0] * w, 0.02, a[2] - nrm[2] * w, dd], i * 8);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.ribBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, rib);

      let view;
      if (params.view === 1) {
        const lead = movers[0];
        const eyeT = V3.add(V3.sub(lead.p, V3.scale(lead.tan, 3.2)), [0, 1.4, 0]);
        const atT = V3.add(at(s.closed ? (s.dist + 2.5) % L : Math.min(L, s.dist + 2.5)), [0, 0.3, 0]);
        s.rideEye = s.rideEye ? s.rideEye.map((v, i) => v + (eyeT[i] - v) * damp(5, dt)) : eyeT;
        s.rideAt = s.rideAt ? s.rideAt.map((v, i) => v + (atT[i] - v) * damp(7, dt)) : atT;
        view = M4.mul(M4.rotZ(lead.bank * 0.25), M4.lookAt(s.rideEye, s.rideAt));
      } else { view = s.cam.view(); s.rideEye = null; }
      const vp = M4.mul(M4.persp(params.view === 1 ? 1.1 : 0.8, ctx.aspect, 0.05, 200), view);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.038, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_kind: 1, u_model: M4.mul(M4.translate(0, -0.05, 0), M4.scale(120, 0.1, 120)), u_col: [0, 0, 0], u_time: t });
      gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
      s.ribP.use().set({ u_vp: vp, u_time: t, u_len: L });
      gl.bindVertexArray(s.ribVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, cnt * 2);
      s.prog.use().set({ u_kind: 0 });
      gl.bindVertexArray(s.octVao);
      movers.forEach((m, j) => {
        const f = m.tan, r = V3.norm(V3.cross(f, [0, 1, 0])), u = V3.cross(r, f);
        const cb = Math.cos(m.bank), sb = Math.sin(m.bank);
        const R = V3.add(V3.scale(r, cb), V3.scale(u, sb)), U = V3.add(V3.scale(u, cb), V3.scale(r, -sb));
        const sc = j === 0 ? 1.3 : 1 - j * 0.03;
        const model = new Float32Array([R[0] * 0.28 * sc, R[1] * 0.28 * sc, R[2] * 0.28 * sc, 0, U[0] * 0.14 * sc, U[1] * 0.14 * sc, U[2] * 0.14 * sc, 0, f[0] * 0.55 * sc, f[1] * 0.55 * sc, f[2] * 0.55 * sc, 0, m.p[0], 0.35, m.p[2], 1]);
        s.prog.set({ u_model: model, u_col: j === 0 ? [0.95, 0.93, 0.9] : j % 2 ? S.BLUE : S.RED });
        gl.drawArrays(gl.TRIANGLES, 0, 24);
      });
      if (s.drawing && s.drawing.length > 1) { // live stroke preview: little cubes along the stroke
        gl.bindVertexArray(s.cubeVao);
        for (const p of s.drawing) { s.prog.set({ u_model: M4.mul(M4.translate(p[0], 0.05, p[2]), M4.scale(0.12)), u_col: [0.93, 0.91, 0.87] }); gl.drawArrays(gl.TRIANGLES, 0, 36); }
      }
      gl.disable(gl.DEPTH_TEST);
    },
  });

  function setPath(s, ctx, raw, closed) {
    const curve = catmull(raw, closed, 12);
    const r = resample(curve, M, closed);
    s.pts = r.pts; s.total = r.total; s.closed = closed; s.dist = 0; s.phase = 0;
  }
  function preset(s, ctx) {
    const raw = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; const d = 1 + Math.sin(a) * Math.sin(a); raw.push([9 * Math.cos(a) / d, 0, 6 * Math.sin(a) * Math.cos(a) / d]); }
    setPath(s, ctx, raw, true);
  }
})();
