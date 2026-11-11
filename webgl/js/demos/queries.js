/* Occlusion & Timer Queries — GPU occlusion culling. Each frame, every
 * building's bounding box is tested against the wall's depth with an
 * ANY_SAMPLES_PASSED_CONSERVATIVE query (in a low-res offscreen pass). Results
 * arrive asynchronously frames later; hidden buildings are skipped. The god
 * view reveals which ones the street camera culled. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, damp } = S.math;
  const GX = 12, GZ = 12, N = GX * GZ;
  const QW = 256, QH = 144;
  const STREET_EYE = [0, 1.7, 8], STREET_AT = [0, 1.6, -20];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_box;   // x, z, w, h   (instanced)
layout(location = 3) in float a_vis;  // 1 visible, 0 culled (instanced)
uniform mat4 u_vp; uniform mat4 u_model; uniform bool u_inst; uniform bool u_hide;
out vec3 v_n; out vec3 v_w; out float v_vis; out float v_h;
void main() {
  vec4 w;
  if (u_inst) { w = vec4(a_pos * vec3(a_box.z, a_box.w, a_box.z) + vec3(a_box.x, a_box.w * 0.5, a_box.y), 1.0); v_vis = a_vis; v_h = a_box.w; }
  else { w = u_model * vec4(a_pos, 1.0); v_vis = 1.0; v_h = 0.0; }
  v_n = u_inst ? a_nrm : mat3(u_model) * a_nrm; v_w = w.xyz;
  gl_Position = u_vp * w;
  if (u_inst && u_hide && a_vis < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // culled: emitted outside the clip volume, so no fragments
}`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in float v_vis; in float v_h; out vec4 o;
uniform int u_kind; uniform vec3 u_eye;
void main() {
  vec3 n = normalize(v_n);
  float dif = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 0.9, 0.3))), 0.0);
  if (u_kind == 1) { // ground
    vec2 g = abs(fract(v_w.xz * 0.5) - 0.5) / fwidth(v_w.xz * 0.5);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    o = vec4(vec3(0.05, 0.052, 0.06) + line * 0.05, 1.0); return;
  }
  if (u_kind == 2) { // occluder wall
    vec2 q = v_w.xy * vec2(2.0, 2.0);
    float stripe = step(0.5, fract((v_w.x + v_w.y) * 1.5));
    o = vec4(mix(vec3(0.16, 0.05, 0.07), RED * 0.55, stripe * 0.35) * dif, 1.0); return;
  }
  // buildings: windows + visibility colour
  vec2 wq = vec2(v_w.x + v_w.z, v_w.y) * vec2(3.0, 2.5);
  float win = step(0.55, fract(wq.x)) * step(0.45, fract(wq.y)) * step(0.3, abs(n.y - 1.0));
  vec3 col = v_vis > 0.5 ? mix(vec3(0.16, 0.18, 0.24), BLUE, 0.35) : RED * 0.8;
  vec3 c = col * dif + win * (v_vis > 0.5 ? BLUE * 0.35 : RED * 0.3);
  float a = v_vis > 0.5 ? 1.0 : 0.55;
  o = vec4(c * a, a);
}`;
  const QFS = `out vec4 o; void main() { o = vec4(1.0); }`;
  const LINE_VS = `layout(location = 0) in vec3 a_p; uniform mat4 u_vp; void main() { gl_Position = u_vp * vec4(a_p, 1.0); }`;
  const LINE_FS = `out vec4 o; uniform vec3 u_col; void main() { o = vec4(u_col, 1.0); }`;

  S.register({
    id: 'queries',
    title: 'Occlusion & Timer Queries',
    category: 'Performance',
    hint: 'move to slide the wall · toggle god view to see the culling',
    description: 'GPU occlusion culling, a staple optimisation of open-world games. Behind the wall stand 144 buildings. Each frame their bounding boxes are drawn invisibly against the wall\'s depth, wrapped in occlusion queries. The answers come back asynchronously a few frames later, and buildings the street camera cannot see are skipped. If the browser exposes it, a GPU timer query measures the main pass.',
    interact: [['Move', 'Slide the occluding wall left and right'], ['Wheel', 'Rotate the wall'], ['God view (or V)', 'Fly above to see culled buildings in red'], ['Drag (god view)', 'Orbit']],
    features: ['Occlusion queries (ANY_SAMPLES_PASSED_CONSERVATIVE)', 'Async QUERY_RESULT_AVAILABLE polling', 'EXT_disjoint_timer_query_webgl2', 'Low-res depth pre-pass', 'colorMask / depthMask'],
    params: [
      { key: 'god', label: 'God view', type: 'toggle', value: true },
      { key: 'cull', label: 'Occlusion culling', type: 'toggle', value: true },
      { key: 'width', label: 'Wall width', type: 'range', min: 2, max: 16, step: 0.5, value: 9 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const boxes = new Float32Array(N * 4), vis = new Float32Array(N).fill(1);
      let i = 0;
      for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++, i++) {
        const h = 1 + ((x * 7 + z * 13) % 9) * 0.55 + (z > 6 ? 1.5 : 0);
        boxes.set([(x - (GX - 1) / 2) * 2.4 + ((z % 2) * 0.6), -6 - z * 2.6, 1.5, h], i * 4);
      }
      const boxBuf = util.buffer(gl.ARRAY_BUFFER, boxes);
      const visBuf = util.buffer(gl.ARRAY_BUFFER, vis, gl.DYNAMIC_DRAW);
      const vao = util.vao([
        { buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 },
        { buffer: boxBuf, loc: 2, size: 4, divisor: 1 }, { buffer: visBuf, loc: 3, size: 1, divisor: 1 },
      ]);
      const color = util.renderbuffer(gl.RGBA8, QW, QH), depth = util.renderbuffer(gl.DEPTH_COMPONENT24, QW, QH);
      const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const lineBuf = util.buffer(gl.ARRAY_BUFFER, 16 * 12, gl.DYNAMIC_DRAW);
      ctx.overlay.innerHTML = '<div class="ov-label" id="q-stat" style="left:34px;top:auto;bottom:64px;transform:none;line-height:1.7"></div>';
      return {
        prog: util.program(VS, FS), qprog: util.program(VS, QFS), lineP: util.program(LINE_VS, LINE_FS),
        vao, boxes, vis, visBuf, qfb: util.framebuffer([{ rb: color }], depth),
        queries: Array.from({ length: N }, () => util.query()), pending: new Uint8Array(N), visible: new Uint8Array(N).fill(1),
        timer, tq: timer ? util.query() : null, tqPending: false, gpuMs: null,
        lineBuf, lineVao: util.vao([{ buffer: lineBuf, loc: 0, size: 3 }]),
        wallX: 0, wallRot: 0, frames: 0, stat: ctx.overlay.querySelector('#q-stat'),
        cam: new S.OrbitCam({ dist: 42, pitch: 0.9, yaw: 0.5, target: [0, 0, -14], minDist: 15, maxDist: 70 }),
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      if (input.pressed.has('KeyV')) ctx.syncParam('god', !params.god);
      if (params.god) s.cam.update(Object.assign({}, input, { wheel: 0 }), dt);
      s.wallRot += input.wheel * 0.002;
      const tx = input.hover || input.down ? input.nx * 7 : Math.sin(t * 0.5) * 5;
      s.wallX += (tx - s.wallX) * damp(6, dt);
      s.frames++;

      // ---- 1. harvest finished query results (async: never in the frame they were issued)
      let culled = 0, inflight = 0;
      for (let i = 0; i < N; i++) {
        if (s.pending[i]) {
          if (gl.getQueryParameter(s.queries[i], gl.QUERY_RESULT_AVAILABLE)) {
            s.visible[i] = gl.getQueryParameter(s.queries[i], gl.QUERY_RESULT) ? 1 : 0;
            s.pending[i] = 0;
          } else inflight++;
        }
      }
      if (s.timer && s.tqPending && gl.getQueryParameter(s.tq, gl.QUERY_RESULT_AVAILABLE)) {
        const ns = gl.getQueryParameter(s.tq, gl.QUERY_RESULT);
        if (!gl.getParameter(s.timer.GPU_DISJOINT_EXT)) s.gpuMs = ns / 1e6;
        s.tqPending = false;
      }
      for (let i = 0; i < N; i++) { s.vis[i] = params.cull ? s.visible[i] : 1; if (!s.vis[i]) culled++; }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.visBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.vis);

      const wall = M4.mul(M4.translate(s.wallX, 2.5, -3), M4.mul(M4.rotY(s.wallRot), M4.scale(params.width, 5, 0.4)));
      const ground = M4.mul(M4.translate(0, -0.1, -14), M4.scale(70, 0.2, 60));
      const streetVP = M4.mul(M4.persp(0.9, ctx.aspect, 0.1, 120), M4.lookAt(STREET_EYE, STREET_AT));

      // ---- 2. occlusion pass from the street camera (low-res, invisible)
      if (params.cull) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.qfb);
        gl.viewport(0, 0, QW, QH);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.colorMask(false, false, false, false);
        s.qprog.use().set({ u_vp: streetVP, u_inst: false, u_hide: false, u_model: wall });
        gl.bindVertexArray(s.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 36);                      // occluder writes depth
        gl.depthMask(false);                                     // boxes only test depth
        for (let i = 0; i < N; i++) {
          if (s.pending[i]) continue;
          const b = s.boxes.subarray(i * 4, i * 4 + 4);
          s.qprog.set({ u_model: M4.mul(M4.translate(b[0], b[3] / 2, b[1]), M4.scale(b[2], b[3], b[2])) });
          gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, s.queries[i]);
          gl.drawArrays(gl.TRIANGLES, 0, 36);
          gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
          s.pending[i] = 1;
        }
        gl.depthMask(true);
        gl.colorMask(true, true, true, true);
        gl.disable(gl.DEPTH_TEST);
      }

      // ---- 3. main view
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.03, 0.032, 0.045, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const timing = s.timer && !s.tqPending;
      if (timing) gl.beginQuery(s.timer.TIME_ELAPSED_EXT, s.tq);
      const vp = params.god ? M4.mul(s.cam.proj(ctx.aspect, 0.5, 200), s.cam.view()) : streetVP;
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_eye: params.god ? s.cam.eye() : STREET_EYE, u_inst: false });
      gl.bindVertexArray(s.vao);
      s.prog.set({ u_kind: 1, u_model: ground }); gl.drawArrays(gl.TRIANGLES, 0, 36);
      s.prog.set({ u_kind: 2, u_model: wall }); gl.drawArrays(gl.TRIANGLES, 0, 36);
      s.prog.set({ u_kind: 0, u_inst: true, u_hide: !params.god });
      if (params.god) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, N);             // god view: show culled ones as red glass
        gl.disable(gl.BLEND);
      } else {
        // street view: culled buildings produce no fragments (their vertices are moved outside the clip volume)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, N);
      }
      if (params.god) {
        // street camera frustum
        const far = 34, tY = Math.tan(0.45), tX = tY * ctx.aspect;
        const f = V3.norm(V3.sub(STREET_AT, STREET_EYE)), r = V3.norm(V3.cross(f, [0, 1, 0])), u = V3.cross(r, f);
        const c = (sx, sy) => V3.add(STREET_EYE, V3.scale(V3.add(f, V3.add(V3.scale(r, sx * tX), V3.scale(u, sy * tY))), far));
        const k = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
        const L = [];
        k.forEach((p, i) => { L.push(...STREET_EYE, ...p, ...p, ...k[(i + 1) % 4]); });
        gl.bindBuffer(gl.ARRAY_BUFFER, s.lineBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(L));
        s.lineP.use().set({ u_vp: vp, u_col: [0.93, 0.91, 0.87] });
        gl.bindVertexArray(s.lineVao); gl.drawArrays(gl.LINES, 0, 16);
      }
      gl.disable(gl.DEPTH_TEST);
      if (timing) { gl.endQuery(s.timer.TIME_ELAPSED_EXT); s.tqPending = true; }

      if (s.frames % 8 === 0) {
        s.stat.innerHTML = `visible <b style="color:var(--blue);font-weight:500">${N - culled}</b> · culled <b style="color:var(--red);font-weight:500">${culled}</b> / ${N}<br>queries in flight ${inflight} · GPU main pass ${s.gpuMs == null ? 'n/a (timer ext unavailable)' : s.gpuMs.toFixed(2) + ' ms'}`;
      }
    },
  });
})();
