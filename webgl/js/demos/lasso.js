/* Marquee & Lasso — select thousands of points entirely on the GPU. The drawn
 * shape (even concave, self-crossing lassos) is filled into a mask with the
 * stencil INVERT trick (even-odd rule); then a transform-feedback pass projects
 * every point, samples the mask and writes its new selection flag into a buffer. */
(function () {
  const S = window.Sandbox;
  const { M4 } = S.math;
  const N = 8000, MAXPOLY = 2048;

  const SEL_VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in float a_sel;
uniform mat4 u_vp; uniform sampler2D u_mask; uniform int u_mode;
out float v_sel;
void main() {
  vec4 c = u_vp * vec4(a_pos, 1.0);
  float m = 0.0;
  if (c.w > 0.0) { vec2 uv = c.xy / c.w * 0.5 + 0.5; if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) m = textureLod(u_mask, uv, 0.0).r; }
  m = step(0.5, m);
  v_sel = u_mode == 0 ? m : u_mode == 1 ? max(a_sel, m) : u_mode == 2 ? a_sel * (1.0 - m) : abs(a_sel - m);
}`;
  const NOP_FS = `out vec4 o; void main() { o = vec4(0.0); }`;
  const POLY_VS = `layout(location = 0) in vec2 a_p; uniform vec2 u_res; void main() { vec2 c = a_p / u_res * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }`;
  const ONE_FS = `out vec4 o; uniform vec4 u_col; void main() { o = u_col; }`;
  const PT_VS = S.GLSL.colors + `
layout(location = 0) in vec3 a_pos; layout(location = 1) in float a_sel; layout(location = 2) in float a_cl;
uniform mat4 u_vp; uniform float u_dpr; uniform float u_time;
out vec3 v_c; out float v_s;
void main() {
  vec4 c = u_vp * vec4(a_pos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp((a_sel > 0.5 ? 9.0 : 6.0) * u_dpr / c.w * 6.0, 1.5, 24.0);
  vec3 base = mix(vec3(0.28, 0.3, 0.38), BLUE, a_cl);
  v_c = a_sel > 0.5 ? mix(RED, vec3(1.0, 0.8, 0.8), 0.15 + 0.15 * sin(u_time * 4.0 + a_pos.x)) : base;
  v_s = a_sel;
}`;
  const PT_FS = `in vec3 v_c; in float v_s; out vec4 o;
void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.35, r); o = vec4(v_c * a * (v_s > 0.5 ? 1.2 : 0.75), a); }`;

  S.register({
    id: 'lasso',
    title: 'Marquee & Lasso',
    category: 'Selection',
    thumb: 'tall',
    hint: 'drag to select · Shift adds · Alt subtracts · right-drag orbits',
    description: 'Select 8,000 points in 3D the way design and data tools do, entirely on the GPU. Your lasso, even a concave or self-crossing one, is filled into a mask by drawing it as a triangle fan with stencil INVERT, which gives the even-odd fill rule for free. A transform-feedback pass then projects every point, samples the mask, and writes replace, add, subtract or toggle results into the selection buffer.',
    interact: [['Drag', 'Lasso (or marquee) select'], ['Shift / Alt + drag', 'Add to / subtract from the selection'], ['Right-drag / Orbit tool', 'Orbit the cloud'], ['Wheel / pinch', 'Zoom'], ['Esc', 'Clear selection']],
    features: ['Stencil INVERT even-odd fill', 'Transform feedback selection pass', 'Vertex texture fetch of a mask', 'Async count readback (fence)', 'gl.POINTS sprites'],
    params: [
      { key: 'tool', label: 'Tool', type: 'select', options: ['Lasso', 'Marquee', 'Orbit'], value: 0 },
      { key: 'mode', label: 'Mode', type: 'select', options: ['Replace', 'Add', 'Subtract', 'Toggle'], value: 0 },
      { key: 'invert', label: 'Invert selection', type: 'button' },
      { key: 'clear', label: 'Clear selection', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const pos = new Float32Array(N * 3), cl = new Float32Array(N);
      const centers = Array.from({ length: 7 }, (_, i) => [Math.cos(i * 0.9) * 3.2, Math.sin(i * 1.7) * 1.6, Math.sin(i * 0.9) * 3.2]);
      for (let i = 0; i < N; i++) {
        const c = centers[i % 7], r = Math.pow(Math.random(), 0.6) * 1.4;
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
        pos.set([c[0] + q * Math.cos(a) * r, c[1] + u * r * 0.7, c[2] + q * Math.sin(a) * r], i * 3);
        cl[i] = (i % 7) / 6;
      }
      const posBuf = util.buffer(gl.ARRAY_BUFFER, pos), clBuf = util.buffer(gl.ARRAY_BUFFER, cl);
      const sel = [0, 1].map(() => util.buffer(gl.ARRAY_BUFFER, N * 4, gl.DYNAMIC_COPY));
      const vaos = sel.map((b) => util.vao([{ buffer: posBuf, loc: 0, size: 3 }, { buffer: b, loc: 1, size: 1 }, { buffer: clBuf, loc: 2, size: 1 }]));
      const tfs = sel.map((b) => { const tf = util.transformFeedback(); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, b); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null); return tf; });
      const polyBuf = util.buffer(gl.ARRAY_BUFFER, MAXPOLY * 8, gl.DYNAMIC_DRAW);
      const s = {
        selP: util.program(SEL_VS, NOP_FS, { tf: ['v_sel'] }), polyP: util.program(POLY_VS, ONE_FS), ptP: util.program(PT_VS, PT_FS),
        sel, vaos, tfs, src: 0, polyBuf, polyVao: util.vao([{ buffer: polyBuf, loc: 0, size: 2 }]),
        poly: [], dragging: false, count: 0, countBuf: new Float32Array(N), sync: null, vp: null,
        cam: new S.OrbitCam({ dist: 13, pitch: 0.45, minDist: 5, maxDist: 30, auto: 0.04 }),
      };
      maskTarget(ctx, s);
      ctx.overlay.innerHTML = '<div class="ov-label" id="ls-read" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      s.read = ctx.overlay.querySelector('#ls-read');
      s.demoT = 0;
      return s;
    },
    resize(ctx, s) { maskTarget(ctx, s); },
    action(ctx, s, key) {
      if (key === 'clear') applyAll(ctx, s, 0);
      if (key === 'invert') applyAll(ctx, s, 1);
    },
    dispose(ctx, s) { if (s.sync) ctx.gl.deleteSync(s.sync); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const orbitMode = params.tool === 2 || input.button === 2 || input.pointers.size >= 2;
      s.cam.update(orbitMode ? input : Object.assign({}, input, { dragging: false }), dt);
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 80), s.cam.view());
      if (input.pressed.has('Escape')) applyAll(ctx, s, 0);
      // gather the shape while dragging
      if (input.dragging && !orbitMode) {
        if (!s.dragging) { s.dragging = true; s.poly = [[input.x, input.y]]; s.start = [input.x, input.y]; }
        if (params.tool === 1) { const a = s.start, b = [input.x, input.y]; s.poly = [a, [b[0], a[1]], b, [a[0], b[1]]]; }
        else { const l = s.poly[s.poly.length - 1]; if (Math.hypot(input.x - l[0], input.y - l[1]) > 3 && s.poly.length < MAXPOLY) s.poly.push([input.x, input.y]); }
      } else if (s.dragging) {
        s.dragging = false;
        if (s.poly.length >= 3) {
          const keys = input.keys;
          let mode = params.mode;
          if (input.shift) mode = 1; else if (keys.has('AltLeft') || keys.has('AltRight') || keys.has('ControlLeft') || keys.has('MetaLeft')) mode = 2;
          select(ctx, s, s.poly, mode, vp);
        }
        s.poly = [];
      }
      // idle demo lasso so the study reads at a glance
      s.demoT = input.hover || input.down ? 0 : s.demoT + dt;
      if (s.demoT > 2 && Math.floor(s.demoT) % 5 === 0 && !s.demoDone) {
        const cx = ctx.cssWidth * 0.5, cy = ctx.cssHeight * 0.5, R = Math.min(cx, cy) * 0.45, ph = s.demoT;
        const shape = Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2; const r = R * (0.75 + 0.25 * Math.sin(a * 3 + ph)); return [cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r]; });
        select(ctx, s, shape, 0, vp); s.demoDone = true;
      } else if (Math.floor(s.demoT) % 5 !== 0) s.demoDone = false;
      // collect the async count
      if (s.sync) {
        const st = gl.clientWaitSync(s.sync, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
          gl.bindBuffer(gl.ARRAY_BUFFER, s.sel[s.src]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, s.countBuf); gl.bindBuffer(gl.ARRAY_BUFFER, null);
          let c = 0; for (let i = 0; i < N; i++) if (s.countBuf[i] > 0.5) c++;
          s.count = c; gl.deleteSync(s.sync); s.sync = null;
        }
      }
      // draw
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.038, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.ptP.use().set({ u_vp: vp, u_dpr: ctx.dpr, u_time: t });
      gl.bindVertexArray(s.vaos[s.src]);
      gl.drawArrays(gl.POINTS, 0, N);
      if (s.poly.length >= 2) {
        const arr = new Float32Array(s.poly.length * 2); s.poly.forEach((p, i) => arr.set(p, i * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, s.polyBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
        s.polyP.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_col: [0.1, 0.03, 0.04, 0.1] });
        gl.bindVertexArray(s.polyVao);
        s.polyP.set({ u_col: [0.93, 0.91, 0.87, 1] });
        gl.drawArrays(gl.LINE_LOOP, 0, s.poly.length);
      }
      gl.disable(gl.BLEND);
      s.read.textContent = `${s.count.toLocaleString()} of ${N.toLocaleString()} selected · ${['lasso', 'marquee', 'orbit'][params.tool]} · ${['replace', 'add', 'subtract', 'toggle'][params.mode]}`;
    },
  });

  function maskTarget(ctx, s) {
    const { gl, util } = ctx;
    if (s.maskFb) util.release(s.maskFb, s.maskTex, s.maskDS);
    s.mw = Math.max(1, Math.round(ctx.cssWidth)); s.mh = Math.max(1, Math.round(ctx.cssHeight));
    s.maskTex = util.texture({ width: s.mw, height: s.mh, internal: gl.R8, format: gl.RED, filter: gl.NEAREST });
    s.maskDS = util.renderbuffer(gl.DEPTH24_STENCIL8, s.mw, s.mh);
    s.maskFb = util.framebuffer([s.maskTex], s.maskDS, { stencil: true });
  }

  function select(ctx, s, poly, mode, vp) {
    const { gl } = ctx;
    // 1. even-odd fill: triangle fan from vertex 0 with stencil INVERT
    const arr = new Float32Array(Math.min(poly.length, MAXPOLY) * 2); poly.slice(0, MAXPOLY).forEach((p, i) => arr.set(p, i * 2));
    gl.bindBuffer(gl.ARRAY_BUFFER, s.polyBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.maskFb);
    gl.viewport(0, 0, s.mw, s.mh);
    gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.colorMask(false, false, false, false);
    s.polyP.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_col: [1, 1, 1, 1] });
    gl.bindVertexArray(s.polyVao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, arr.length / 2);
    // 2. wherever stencil is odd (non-zero), write 1 into the mask
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    s.polyP.set({ u_res: [1, 1] });
    // one oversized triangle covering the viewport (u_res = 1 maps 0..1 → clip space)
    gl.bindBuffer(gl.ARRAY_BUFFER, s.polyBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([0, 1, 2, 1, 0, -1]));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.STENCIL_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // 3. transform-feedback pass: every point samples the mask
    runSelect(ctx, s, mode, vp);
  }

  function runSelect(ctx, s, mode, vp, constant) {
    const { gl } = ctx;
    const dst = 1 - s.src;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.maskTex);
    s.selP.use().set({ u_vp: vp || M4.ident(), u_mask: 0, u_mode: mode });
    gl.bindVertexArray(s.vaos[s.src]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, s.tfs[dst]);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.endTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.disable(gl.RASTERIZER_DISCARD);
    s.src = dst;
    if (s.sync) gl.deleteSync(s.sync);
    s.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }

  // Clear (all 0) or invert: clear the mask fully then run replace / toggle with a full mask.
  function applyAll(ctx, s, invert) {
    const { gl } = ctx;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.maskFb);
    gl.clearColor(invert ? 1 : 0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    runSelect(ctx, s, invert ? 3 : 0, M4.mul(s.cam.proj(ctx.aspect, 0.1, 80), s.cam.view()));
  }
})();
