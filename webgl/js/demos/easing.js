/* Easing Lab — eight motion curves side by side, all drawn with one instanced
 * SDF-shape batch. Click anywhere to retarget every lane mid-flight. */
(function () {
  const S = window.Sandbox;

  // Generic 2D shape batch: one quad per instance, SDF circle or rounded rect.
  const VS = `
layout(location = 0) in vec4 a_rect;   // cx, cy, w, h (px, origin top-left)
layout(location = 1) in vec4 a_col;
layout(location = 2) in float a_shape; // 0 circle, 1 rounded rect
uniform vec2 u_res;
out vec2 v_local; out vec2 v_size; out vec4 v_col; out float v_shape;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 half_ = a_rect.zw * 0.5 + 1.5;
  vec2 p = a_rect.xy + corner * half_;
  v_local = corner * half_; v_size = a_rect.zw * 0.5; v_col = a_col; v_shape = a_shape;
  vec2 c = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
  const FS = `
in vec2 v_local; in vec2 v_size; in vec4 v_col; in float v_shape; out vec4 o;
void main() {
  float d;
  if (v_shape < 0.5) d = length(v_local) - v_size.x;
  else { float r = min(v_size.x, v_size.y); vec2 q = abs(v_local) - v_size + r; d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float a = clamp(0.5 - d, 0.0, 1.0) * v_col.a;
  o = vec4(v_col.rgb * a, a);
}`;

  const E = {
    'linear': (t) => t,
    'easeInOutSine': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    'easeInOutCubic': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    'easeOutExpo': (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    'easeOutBack': (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    'easeOutElastic': (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
    'easeOutBounce': (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    'spring (physics)': null,
  };
  const NAMES = Object.keys(E);
  const TRAIL = 22;
  const MAX_INST = NAMES.length * (TRAIL + 4) + 8;

  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function layout(ctx, s) {
    const W = ctx.cssWidth, H = ctx.cssHeight;
    s.x0 = Math.max(150, W * 0.2); s.x1 = W - Math.max(40, W * 0.06);
    const top = H * 0.14, bottom = H * 0.84;
    s.laneY = NAMES.map((_, i) => top + (bottom - top) * (i / (NAMES.length - 1)));
    ctx.overlay.innerHTML = NAMES.map((n, i) => `<div class="ov-label" style="left:16px;top:${s.laneY[i]}px">${n}</div>`).join('');
    s.lanes.forEach((l) => { l.x = Math.min(Math.max(l.x, s.x0), s.x1); l.from = l.x; l.to = l.to == null ? s.x0 : Math.min(Math.max(l.to, s.x0), s.x1); });
  }

  S.register({
    id: 'easing',
    title: 'Easing Lab',
    category: 'Animation',
    hint: 'click anywhere to retarget · space to toggle ends',
    description: 'Eight timing functions run side by side: linear, sine, cubic, expo, back (overshoot), elastic, bounce, and a physical spring. Tweens restart from wherever the dot is when retargeted; the spring carries its velocity into the new target. Every track, dot and trail is drawn with one instanced call over a signed-distance quad.',
    interact: [['Click / tap', 'All lanes tween to the pointer\'s X'], ['Space', 'Send every lane to the opposite end'], ['Auto loop', 'Ping-pong automatically']],
    features: ['Instanced SDF quads', 'gl_VertexID quad corners', 'Dynamic instance buffer', 'Premultiplied alpha blending'],
    params: [
      { key: 'duration', label: 'Duration (s)', type: 'range', min: 0.3, max: 3, step: 0.05, value: 1.2 },
      { key: 'stiff', label: 'Spring stiffness', type: 'range', min: 20, max: 400, step: 5, value: 120 },
      { key: 'damp', label: 'Spring damping', type: 'range', min: 2, max: 40, step: 0.5, value: 10 },
      { key: 'loop', label: 'Auto loop', type: 'toggle', value: true },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const inst = new Float32Array(MAX_INST * 9);
      const buf = util.buffer(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
      const s = {
        prog: util.program(VS, FS), inst, buf,
        vao: util.vao([
          { buffer: buf, loc: 0, size: 4, stride: 36, offset: 0, divisor: 1 },
          { buffer: buf, loc: 1, size: 4, stride: 36, offset: 16, divisor: 1 },
          { buffer: buf, loc: 2, size: 1, stride: 36, offset: 32, divisor: 1 },
        ]),
        lanes: NAMES.map(() => ({ x: 0, from: 0, to: null, t0: 0, v: 0, trail: [] })),
        lastSwitch: 0, side: 0,
      };
      layout(ctx, s);
      return s;
    },
    resize(ctx, s) { layout(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const retarget = (x) => s.lanes.forEach((l) => { l.from = l.x; l.to = Math.min(Math.max(x, s.x0), s.x1); l.t0 = t; });
      for (const c of input.clicks) { retarget(c.x); s.lastSwitch = t; }
      if (input.pressed.has('Space') || (params.loop && t - s.lastSwitch > params.duration + 0.6)) {
        s.side = 1 - s.side; retarget(s.side ? s.x1 : s.x0); s.lastSwitch = t;
      }
      let n = 0;
      const push = (cx, cy, w, h, col, a, shape) => { if (n < MAX_INST) { s.inst.set([cx, cy, w, h, col[0] * 1, col[1], col[2], a, shape], n * 9); n++; } };
      const W = s.x1 - s.x0;
      NAMES.forEach((name, i) => {
        const l = s.lanes[i];
        const y = s.laneY[i];
        const f = E[name];
        if (f) {
          const p = Math.min((t - l.t0) / params.duration, 1);
          l.x = l.from + (l.to - l.from) * f(p);
        } else {
          const h = Math.min(dt, 1 / 30);
          l.v += ((l.to - l.x) * params.stiff - l.v * params.damp) * h;
          l.x += l.v * h;
        }
        l.trail.unshift(l.x); if (l.trail.length > TRAIL) l.trail.pop();
        const col = mix(S.BLUE, S.RED, i / (NAMES.length - 1));
        push(s.x0 + W / 2, y, W + 18, 4, [0.18, 0.2, 0.28], 1, 1);
        push(s.x0, y, 8, 8, [0.3, 0.33, 0.45], 1, 0);
        push(s.x1, y, 8, 8, [0.3, 0.33, 0.45], 1, 0);
        for (let k = l.trail.length - 1; k >= 1; k--) {
          const a = (1 - k / TRAIL) * 0.35;
          push(l.trail[k], y, 14 * (1 - k / TRAIL * 0.6), 14 * (1 - k / TRAIL * 0.6), col, a, 0);
        }
        push(l.x, y, 20, 20, mix(col, [1, 1, 1], 0.15), 1, 0);
      });
      // pointer guide
      if (input.hover) push(Math.min(Math.max(input.x, s.x0), s.x1), ctx.cssHeight / 2, 2, ctx.cssHeight * 0.8, [1, 1, 1], 0.12, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.inst, 0, n * 9);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.prog.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight] });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
    },
  });
})();
