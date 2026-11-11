/* Transform Feedback Particles — up to 1M particles simulated in a vertex
 * shader whose outputs are captured back into a buffer (no CPU round-trip). */
(function () {
  const S = window.Sandbox;

  const UPDATE_VS = S.GLSL.noise + `
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_vel;
out vec2 v_pos; out vec2 v_vel;
uniform vec2 u_mouse; uniform float u_dt; uniform float u_time; uniform float u_aspect;
uniform float u_attract; uniform float u_drag; uniform float u_flow; uniform float u_burst;
void main() {
  vec2 p = a_pos, v = a_vel;
  vec2 d = u_mouse - p; d.x *= u_aspect;
  float r2 = dot(d, d) + 0.004;
  vec2 f = d / r2 * u_attract * 0.06;
  // swirl around the pointer for orbiting motion
  f += vec2(-d.y, d.x) / r2 * abs(u_attract) * 0.025;
  // curl-ish flow field from value noise
  vec2 q = p * vec2(u_aspect, 1.0) * 1.6 + u_time * 0.05;
  float e = 0.01;
  float n1 = fbm(q + vec2(0.0, e)), n2 = fbm(q - vec2(0.0, e)), n3 = fbm(q + vec2(e, 0.0)), n4 = fbm(q - vec2(e, 0.0));
  f += vec2(n1 - n2, -(n3 - n4)) / (2.0 * e) * u_flow * 0.35;
  f -= normalize(d + 1e-5) * u_burst * 6.0 / (1.0 + dot(d, d) * 20.0);
  f.x /= u_aspect;
  v += f * u_dt;
  v *= pow(u_drag, u_dt * 60.0);
  p += v * u_dt;
  if (p.x < -1.0) p.x += 2.0; else if (p.x > 1.0) p.x -= 2.0;
  if (p.y < -1.0) p.y += 2.0; else if (p.y > 1.0) p.y -= 2.0;
  v_pos = p; v_vel = v;
}`;
  const UPDATE_FS = `out vec4 o; void main() { o = vec4(0.0); }`;

  const DRAW_VS = S.GLSL.colors + `
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_vel;
uniform float u_size;
out vec3 v_col;
void main() {
  float sp = clamp(length(a_vel) * 1.4, 0.0, 1.0);
  v_col = mix(BLUE * 0.6, RED, sp) + sp * sp * 0.4;
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_size;
}`;
  const DRAW_FS = `
in vec3 v_col; out vec4 o; uniform float u_alpha;
void main() { o = vec4(v_col * u_alpha, 1.0); }`;

  S.register({
    id: 'particles',
    title: 'Transform Feedback Particles',
    category: 'GPU Motion',
    hint: 'hold to attract · shift / right-hold to repel · space to burst',
    description: 'Hundreds of thousands of particles live entirely in GPU buffers. A vertex shader advances position and velocity with forces from the pointer, a noise flow field and drag, and transform feedback writes the results into a second buffer. The two buffers swap each frame, and the simulation pass runs with RASTERIZER_DISCARD, so it never touches pixels.',
    interact: [['Hold', 'Attract and orbit the pointer'], ['Shift-hold / right-hold', 'Repel'], ['Space / Burst button', 'Shockwave outward from the pointer'], ['Release', 'Particles drift on the flow field']],
    features: ['Transform feedback', 'RASTERIZER_DISCARD', 'Interleaved varyings capture', 'Buffer ping-pong', 'Additive blending'],
    params: [
      { key: 'count', label: 'Particles', type: 'range', min: 20000, max: 1000000, step: 10000, value: 300000, restart: true },
      { key: 'strength', label: 'Pointer strength', type: 'range', min: 0.1, max: 4, step: 0.05, value: 1.2 },
      { key: 'drag', label: 'Drag', type: 'range', min: 0.9, max: 0.999, step: 0.001, value: 0.975 },
      { key: 'flow', label: 'Flow field', type: 'range', min: 0, max: 2, step: 0.05, value: 0.6 },
      { key: 'size', label: 'Point size', type: 'range', min: 1, max: 4, step: 0.5, value: 1 },
      { key: 'burst', label: 'Burst', type: 'button' },
      { key: 'scatter', label: 'Scatter', type: 'button' },
    ],
    init(ctx) {
      const { gl, util, params } = ctx;
      const n = params.count;
      const data = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { data[i * 4] = Math.random() * 2 - 1; data[i * 4 + 1] = Math.random() * 2 - 1; }
      const bufs = [0, 1].map(() => util.buffer(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY));
      const vaos = bufs.map((b) => util.vao([{ buffer: b, loc: 0, size: 2, stride: 16 }, { buffer: b, loc: 1, size: 2, stride: 16, offset: 8 }]));
      const tfs = bufs.map((b) => {
        const tf = util.transformFeedback();
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, b);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
        return tf;
      });
      return {
        n, bufs, vaos, tfs, src: 0, burst: 0, data,
        update: util.program(UPDATE_VS, UPDATE_FS, { tf: ['v_pos', 'v_vel'] }),
        draw: util.program(DRAW_VS, DRAW_FS),
        mouse: [0, 0],
      };
    },
    action(ctx, s, key) {
      if (key === 'burst') s.burst = 1;
      if (key === 'scatter') {
        const { gl } = ctx;
        for (let i = 0; i < s.n; i++) { s.data[i * 4] = Math.random() * 2 - 1; s.data[i * 4 + 1] = Math.random() * 2 - 1; s.data[i * 4 + 2] = s.data[i * 4 + 3] = 0; }
        gl.bindBuffer(gl.ARRAY_BUFFER, s.bufs[s.src]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data);
      }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      if (input.pressed.has('Space')) s.burst = 1;
      let attract = 0;
      if (input.down) attract = (input.shift || input.button === 2 ? -1 : 1) * params.strength;
      let mx = input.nx, my = input.ny;
      if (!input.hover && !input.down) { mx = Math.sin(t * 0.6) * 0.5; my = Math.sin(t * 0.9) * 0.4; attract = 0.35 * params.strength; }
      s.mouse = [mx, my];
      const dst = 1 - s.src;
      // --- simulate ---
      s.update.use().set({
        u_mouse: s.mouse, u_dt: Math.max(dt, 1 / 240), u_time: t, u_aspect: ctx.aspect, u_attract: attract,
        u_drag: params.drag, u_flow: params.flow, u_burst: s.burst,
      });
      s.burst = 0;
      gl.bindVertexArray(s.vaos[s.src]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, s.tfs[dst]);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, s.n);
      gl.endTransformFeedback();
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.disable(gl.RASTERIZER_DISCARD);
      s.src = dst;
      // --- draw ---
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.02, 0.022, 0.035, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const alpha = Math.min(0.6, 110000 / s.n) * (params.size > 1.5 ? 0.6 : 1);
      s.draw.use().set({ u_size: params.size * ctx.dpr * 0.75, u_alpha: alpha });
      gl.bindVertexArray(s.vaos[s.src]);
      gl.drawArrays(gl.POINTS, 0, s.n);
      gl.disable(gl.BLEND);
    },
  });
})();
