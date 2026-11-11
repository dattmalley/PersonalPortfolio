/* GPU Picking — instanced cubes rendered with Multiple Render Targets: a color
 * buffer and an R32UI object-ID buffer in one pass. Hover reads the ID under
 * the pointer; a composite pass draws outlines by edge-detecting the ID buffer. */
(function () {
  const S = window.Sandbox;
  const { damp } = S.math;
  const G = 13;

  const VS = `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_inst;  // x, z, height, bounce
layout(location = 3) in vec2 a_state; // hover, active
uniform mat4 u_vp;
out vec3 v_n; out vec3 v_w; out vec2 v_state; out float v_h; flat out uint v_id;
void main() {
  float h = 0.35 + a_inst.z * 1.8;
  vec3 p = a_pos * vec3(0.82, h, 0.82);
  p += vec3(a_inst.x, h * 0.5 + a_inst.w, a_inst.y);
  v_n = a_nrm; v_w = p; v_state = a_state; v_h = a_inst.z;
  v_id = uint(gl_InstanceID + 1);
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in vec2 v_state; in float v_h; flat in uint v_id;
layout(location = 0) out vec4 o_col;
layout(location = 1) out uint o_id;
void main() {
  vec3 n = normalize(v_n);
  float d = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 1.0, 0.3))), 0.0);
  vec3 base = mix(vec3(0.11, 0.13, 0.19), RED, v_state.y);
  base = mix(base, BLUE, v_state.x * (1.0 - v_state.y) * 0.7);
  vec3 c = base * d + v_state.x * 0.12;
  c += smoothstep(0.6, 1.0, v_w.y / 2.5) * v_state.y * 0.25;
  o_col = vec4(c, 1.0);
  o_id = v_id;
}`;
  const COMP = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_col; uniform usampler2D u_id; uniform uint u_hover; uniform float u_time;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 col = texelFetch(u_col, c, 0).rgb;
  uint id = texelFetch(u_id, c, 0).r;
  bool edge = false; bool hoverEdge = false;
  for (int i = 0; i < 4; i++) {
    ivec2 off = ivec2(i == 0 ? 2 : i == 1 ? -2 : 0, i == 2 ? 2 : i == 3 ? -2 : 0);
    uint nid = texelFetch(u_id, c + off, 0).r;
    if (nid != id) { edge = true; if (nid == u_hover || id == u_hover) hoverEdge = true; }
  }
  if (id == 0u) col = INK + vec3(0.02, 0.02, 0.04) * (1.0 - v_uv.y);
  if (edge) col = mix(col, vec3(0.0), 0.6);
  if (hoverEdge && u_hover != 0u) col = mix(BLUE, vec3(1.0), 0.35 + 0.25 * sin(u_time * 8.0));
  o = vec4(col, 1.0);
}`;

  function targets(ctx, s) {
    const { gl, util } = ctx;
    if (s.fbo) util.release(s.fbo, s.colTex, s.idTex, s.depth);
    const w = ctx.width, h = ctx.height;
    s.colTex = util.texture({ width: w, height: h, filter: gl.NEAREST });
    s.idTex = util.texture({ width: w, height: h, internal: gl.R32UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_INT, filter: gl.NEAREST });
    s.depth = util.renderbuffer(gl.DEPTH_COMPONENT24, w, h);
    s.fbo = util.framebuffer([s.colTex, s.idTex], s.depth);
  }

  S.register({
    id: 'picking',
    title: 'GPU Picking',
    category: 'Selection',
    hint: 'hover to highlight · click to raise · drag to orbit',
    description: 'Hover and click detection done on the GPU with no ray math. One draw writes color to attachment 0 and each instance\'s integer ID to an R32UI attachment 1 (Multiple Render Targets). readPixels fetches the ID under the pointer, and a composite pass compares neighbouring IDs to draw crisp outlines. Clicking raises a column on a spring and sends a delayed ripple through the grid.',
    interact: [['Hover', 'Outline the cube under the pointer'], ['Click / tap', 'Toggle a column; a wave ripples outward'], ['Drag', 'Orbit the grid'], ['Wheel / pinch', 'Zoom']],
    features: ['Multiple Render Targets (drawBuffers)', 'R32UI integer textures', 'readPixels RGBA_INTEGER', 'usampler2D + texelFetch', 'clearBufferuiv', 'Instanced drawing'],
    params: [
      { key: 'spring', label: 'Spring stiffness', type: 'range', min: 20, max: 400, step: 5, value: 160 },
      { key: 'damping', label: 'Spring damping', type: 'range', min: 2, max: 30, step: 0.5, value: 9 },
      { key: 'wave', label: 'Ripple strength', type: 'range', min: 0, max: 8, step: 0.1, value: 3 },
      { key: 'clear', label: 'Lower all', type: 'button' },
      { key: 'random', label: 'Randomize', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const n = G * G;
      const inst = new Float32Array(n * 4), st = new Float32Array(n * 2);
      const cells = [];
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        cells.push({ x: (i - (G - 1) / 2), z: (j - (G - 1) / 2), h: 0, hv: 0, target: 0, b: 0, bv: 0, hover: 0, kicks: [] });
      }
      const cubeBuf = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const instBuf = util.buffer(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
      const stBuf = util.buffer(gl.ARRAY_BUFFER, st.byteLength, gl.DYNAMIC_DRAW);
      const vao = util.vao([
        { buffer: cubeBuf, loc: 0, size: 3, stride: 24, offset: 0 },
        { buffer: cubeBuf, loc: 1, size: 3, stride: 24, offset: 12 },
        { buffer: instBuf, loc: 2, size: 4, divisor: 1 },
        { buffer: stBuf, loc: 3, size: 2, divisor: 1 },
      ]);
      const s = {
        prog: util.program(VS, FS), comp: util.program(S.GLSL.fullscreenVS, COMP),
        vao, instBuf, stBuf, inst, st, cells, n, hover: 0, px: new Uint32Array(4),
        cam: new S.OrbitCam({ dist: 19, pitch: 0.75, yaw: 0.6, minDist: 8, maxDist: 40, auto: 0.05, minPitch: 0.15 }),
      };
      targets(ctx, s);
      [84, 85, 71, 97].forEach((i) => { if (cells[i]) cells[i].target = 1; });
      return s;
    },
    resize(ctx, s) { targets(ctx, s); },
    action(ctx, s, key) {
      if (key === 'clear') s.cells.forEach((c) => (c.target = 0));
      if (key === 'random') s.cells.forEach((c) => (c.target = Math.random() < 0.25 ? 1 : 0));
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      const vp = M4mul(s.cam.proj(ctx.aspect, 0.5, 100), s.cam.view());

      // clicks → toggle + ripple
      for (const c of input.clicks) {
        if (c.button !== 0) continue;
        const id = readId(ctx, s, c.x, c.y);
        if (id > 0) {
          const hit = s.cells[id - 1];
          hit.target = hit.target ? 0 : 1;
          for (const o of s.cells) {
            const d = Math.hypot(o.x - hit.x, o.z - hit.z);
            if (d > 0) o.kicks.push({ at: t + d * 0.05, v: params.wave / (1 + d * 0.35) });
          }
        }
      }
      // physics
      const k = params.spring, damping = params.damping;
      const h = Math.min(dt, 1 / 30);
      s.cells.forEach((c, i) => {
        c.hv += ((c.target - c.h) * k - c.hv * damping) * h; c.h += c.hv * h;
        for (let q = c.kicks.length - 1; q >= 0; q--) if (t >= c.kicks[q].at) { c.bv += c.kicks[q].v; c.kicks.splice(q, 1); }
        c.bv += (-c.b * k * 0.8 - c.bv * damping) * h; c.b += c.bv * h;
        c.hover += ((s.hover === i + 1 ? 1 : 0) - c.hover) * damp(18, dt);
        s.inst.set([c.x, c.z, c.h, c.b], i * 4);
        s.st.set([c.hover, Math.min(Math.max(c.h, 0), 1)], i * 2);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, s.instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.inst);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.stBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.st);

      // MRT pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      gl.clearBufferuiv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, s.n);
      gl.disable(gl.DEPTH_TEST);

      // hover read-back (pointer only, not while dragging)
      // Synchronous readback stalls the pipeline, so only do it when the pointer or scene moved.
      const moving = input.x !== s.lastX || input.y !== s.lastY || s.cells.some((c) => Math.abs(c.hv) + Math.abs(c.bv) > 0.01) || s.cam.vy || s.cam.auto;
      if (!input.hover || input.dragging) s.hover = 0;
      else if (moving || (s.readT = (s.readT || 0) + 1) % 10 === 0) s.hover = readId(ctx, s, input.x, input.y);
      s.lastX = input.x; s.lastY = input.y;
      ctx.canvas.style.cursor = s.hover ? 'pointer' : 'crosshair';

      // composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.colTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.idTex);
      s.comp.use().set({ u_col: 0, u_id: 1, u_hover: s.hover, u_time: t });
      ctx.util.drawFullscreen();
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(ctx) { ctx.canvas.style.cursor = ''; },
  });

  const M4mul = (a, b) => S.math.M4.mul(a, b);

  function readId(ctx, s, cssX, cssY) {
    const { gl } = ctx;
    const x = Math.floor(cssX * ctx.dpr), y = Math.floor(ctx.height - cssY * ctx.dpr - 1);
    if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) return 0;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(x, y, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, s.px);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return s.px[0] <= s.n ? s.px[0] : 0;
  }
})();
