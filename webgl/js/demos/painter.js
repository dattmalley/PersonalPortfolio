/* Mesh Painter — paint directly onto a 3D model. The surface position under the
 * pointer is fetched with a non-blocking readback (readPixels into a
 * PIXEL_PACK_BUFFER + fenceSync, collected frames later with getBufferSubData),
 * then strokes are rasterised into the model's UV space. */
(function () {
  const S = window.Sandbox;
  const { M4, damp } = S.math;
  const PAINT = 1024;

  const POS_VS = `
layout(location = 0) in vec3 a_pos;
uniform mat4 u_mvp;
out vec3 v_obj;
void main() { v_obj = a_pos; gl_Position = u_mvp * vec4(a_pos, 1.0); }`;
  const POS_FS = `in vec3 v_obj; out vec4 o; void main() { o = vec4(v_obj, 1.0); }`;

  const BRUSH_VS = `
layout(location = 0) in vec3 a_pos; layout(location = 2) in vec2 a_uv;
out vec3 v_obj;
void main() { v_obj = a_pos; gl_Position = vec4(a_uv * 2.0 - 1.0, 0.0, 1.0); }  // rasterise in texture space
`;
  const BRUSH_FS = `
in vec3 v_obj; out vec4 o;
uniform vec3 u_a; uniform vec3 u_b; uniform float u_r; uniform vec3 u_col; uniform bool u_mirror;
float seg(vec3 p, vec3 a, vec3 b) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  float d = seg(v_obj, u_a, u_b);
  if (u_mirror) d = min(d, seg(v_obj * vec3(-1.0, 1.0, 1.0), u_a, u_b));
  float a = smoothstep(u_r, u_r * 0.55, d);
  if (a <= 0.0) discard;
  o = vec4(u_col, a);
}`;

  const MAIN_VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm; layout(location = 2) in vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_w; out vec3 v_n; out vec2 v_uv; out vec3 v_obj;
void main() {
  vec4 w = u_model * vec4(a_pos, 1.0);
  v_w = w.xyz; v_n = mat3(u_model) * a_nrm; v_uv = a_uv; v_obj = a_pos;
  gl_Position = u_vp * w;
}`;
  const MAIN_FS = S.GLSL.colors + `
in vec3 v_w; in vec3 v_n; in vec2 v_uv; in vec3 v_obj; out vec4 o;
uniform sampler2D u_paint; uniform vec3 u_eye; uniform vec4 u_cursor; uniform vec3 u_ccol; uniform bool u_mirror;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w);
  vec3 L = normalize(vec3(0.5, 0.8, 0.4));
  vec4 p = texture(u_paint, v_uv);
  vec3 base = vec3(0.13, 0.135, 0.15);
  // faint UV grid so the surface reads as a canvas
  vec2 g = abs(fract(v_uv * vec2(80.0, 8.0)) - 0.5) / fwidth(v_uv * vec2(80.0, 8.0));
  base += (1.0 - min(min(g.x, g.y), 1.0)) * 0.025;
  vec3 alb = mix(base, p.rgb, p.a);
  float dif = max(dot(n, L), 0.0);
  float sp = pow(max(dot(reflect(-L, n), V), 0.0), mix(24.0, 60.0, p.a)) * mix(0.25, 0.6, p.a);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 c = alb * (0.18 + 0.82 * dif) + sp + fres * 0.18;
  if (u_cursor.w > 0.0) {
    float d = length(v_obj - u_cursor.xyz);
    if (u_mirror) d = min(d, length(v_obj * vec3(-1.0, 1.0, 1.0) - u_cursor.xyz));
    float ring = smoothstep(0.012, 0.0, abs(d - u_cursor.w));
    c = mix(c, u_ccol + 0.3, ring);
  }
  o = vec4(c, 1.0);
}`;

  const COLORS = [S.RED, S.BLUE, [0.93, 0.91, 0.87], null];

  function posTarget(ctx, s) {
    const { gl, util } = ctx;
    if (s.posFb) util.release(s.posFb, s.posTex, s.posDepth);
    s.pw = Math.max(1, Math.round(ctx.width / 2)); s.ph = Math.max(1, Math.round(ctx.height / 2));
    s.posTex = util.texture({ width: s.pw, height: s.ph, internal: gl.RGBA16F, type: gl.HALF_FLOAT, filter: gl.NEAREST });
    s.posDepth = util.renderbuffer(gl.DEPTH_COMPONENT24, s.pw, s.ph);
    s.posFb = util.framebuffer([s.posTex], s.posDepth);
  }

  S.register({
    id: 'painter',
    title: 'Mesh Painter',
    category: 'Pointer & Touch',
    hint: 'paint on the knot · drag empty space to orbit',
    description: 'Paint straight onto a 3D surface. Each frame the model\'s object-space positions go into a float buffer. The pixel under the pointer is copied into a pixel-pack buffer guarded by a fence, so the CPU collects it a frame later instead of stalling the GPU. Strokes are then rasterised in UV space, so paint sticks to the model as it turns.',
    interact: [['Press on the model', 'Paint a stroke'], ['Press off the model', 'Orbit the camera'], ['Wheel / pinch', 'Zoom'], ['Mirror', 'Paint symmetrically across the model']],
    features: ['PIXEL_PACK_BUFFER readPixels', 'fenceSync / clientWaitSync', 'getBufferSubData (async readback)', 'RGBA16F position buffer', 'UV-space rendering'],
    params: [
      { key: 'color', label: 'Brush', type: 'select', options: ['Red', 'Blue', 'Bone', 'Erase'], value: 0 },
      { key: 'size', label: 'Brush size', type: 'range', min: 0.03, max: 0.4, step: 0.005, value: 0.12 },
      { key: 'mirror', label: 'Mirror symmetry', type: 'toggle', value: false },
      { key: 'spin', label: 'Auto-rotate model', type: 'toggle', value: true },
      { key: 'clear', label: 'Clear paint', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const g = S.geo.torusKnot(480, 56, 0.34);
      const mesh = S.geo.upload(util, g);
      const paintTex = util.texture({ width: PAINT, height: PAINT });
      const paintFb = util.framebuffer([paintTex]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, paintFb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const s = {
        mesh, paintTex, paintFb,
        posP: util.program(POS_VS, POS_FS), brushP: util.program(BRUSH_VS, BRUSH_FS), mainP: util.program(MAIN_VS, MAIN_FS),
        pbo: util.buffer(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ), px: new Float32Array(4), sync: null,
        hit: null, hitAge: 99, mode: null, last: null, angle: 0, frames: 0, stalls: 0, latency: 0, reqFrame: 0,
        cam: new S.OrbitCam({ dist: 6.2, pitch: 0.35, minDist: 3, maxDist: 14 }),
      };
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      posTarget(ctx, s);
      ctx.overlay.innerHTML = '<div class="ov-label" style="left:34px;bottom:64px;top:auto;transform:none" id="pt-stat"></div>';
      s.stat = ctx.overlay.querySelector('#pt-stat');
      // seed with a little paint so the idea is immediately visible
      s.seed = 40;
      return s;
    },
    resize(ctx, s) { posTarget(ctx, s); },
    action(ctx, s, key) {
      if (key === 'clear') { const { gl } = ctx; gl.bindFramebuffer(gl.FRAMEBUFFER, s.paintFb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    },
    dispose(ctx, s) { if (s.sync) ctx.gl.deleteSync(s.sync); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.frames++;
      // ---- 1. collect a finished readback (never blocks: timeout 0)
      if (s.sync) {
        const st = gl.clientWaitSync(s.sync, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pbo);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, s.px);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          gl.deleteSync(s.sync); s.sync = null;
          s.latency = s.frames - s.reqFrame;
          s.hit = s.px[3] > 0.5 ? [s.px[0], s.px[1], s.px[2]] : null;
          s.hitAge = 0;
          if (input.down && s.mode === null) s.mode = s.hit ? 'paint' : 'orbit';
        } else if (st === gl.WAIT_FAILED) { gl.deleteSync(s.sync); s.sync = null; }
      }
      s.hitAge++;
      if (!input.down) { s.mode = null; s.last = null; }

      // ---- 2. camera: orbit only when the press began off the model
      const camInput = s.mode === 'paint' || (input.down && s.mode === null) ? Object.assign({}, input, { dragging: false }) : input;
      s.cam.update(camInput, dt);
      if (params.spin && s.mode !== 'paint') s.angle += dt * 0.25;
      const model = M4.rotY(s.angle);
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 50), s.cam.view());
      const mvp = M4.mul(vp, model);

      // ---- 3. paint
      const col = COLORS[params.color];
      const brush = (a, b, r, c) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.paintFb);
        gl.viewport(0, 0, PAINT, PAINT);
        gl.enable(gl.BLEND);
        if (c) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); // eraser
        s.brushP.use().set({ u_a: a, u_b: b, u_r: r, u_col: c || [0, 0, 0], u_mirror: params.mirror });
        s.mesh.draw();
        gl.disable(gl.BLEND);
      };
      if (s.seed > 0) { // a short procedural stroke on first load
        const k = 40 - s.seed, f = (q) => { const a = q * 0.16; return [Math.cos(a * 2) * (1.25 + 0.55 * Math.cos(3 * a)), 0.55 * Math.sin(3 * a), Math.sin(a * 2) * (1.25 + 0.55 * Math.cos(3 * a))]; };
        brush(f(k), f(k + 1), 0.42, k < 20 ? S.RED : S.BLUE); s.seed--;
      }
      if (s.mode === 'paint' && s.hit && s.hitAge <= 2) {
        brush(s.last || s.hit, s.hit, params.size, col);
        s.last = s.hit;
      }

      // ---- 4. position pass (object-space xyz, alpha = coverage)
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.posFb);
      gl.viewport(0, 0, s.pw, s.ph);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.posP.use().set({ u_mvp: mvp });
      s.mesh.draw();
      // ---- 5. request the pixel under the pointer asynchronously
      if (!s.sync && (input.hover || input.down)) {
        const x = Math.floor(input.uvx * s.pw), y = Math.floor(input.uvy * s.ph);
        if (x >= 0 && y >= 0 && x < s.pw && y < s.ph) {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pbo);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, 0);   // writes into the PBO, returns immediately
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          s.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          s.reqFrame = s.frames;
          gl.flush();
        }
      }
      if (!input.hover && !input.down) s.hit = null;

      // ---- 6. main render
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.03, 0.033, 0.045, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.paintTex);
      s.mainP.use().set({
        u_vp: vp, u_model: model, u_paint: 0, u_eye: s.cam.eye(), u_mirror: params.mirror,
        u_cursor: s.hit ? [...s.hit, params.size] : [0, 0, 0, 0], u_ccol: col || [0.6, 0.6, 0.6],
      });
      s.mesh.draw();
      gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = s.hit ? 'none' : (s.mode === 'orbit' ? 'grabbing' : 'crosshair');
      if (s.frames % 10 === 0) s.stat.textContent = `async readback · latency ${s.latency} frame${s.latency === 1 ? '' : 's'} · 0 pipeline stalls`;
    },
  });
})();
