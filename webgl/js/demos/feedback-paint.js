/* Feedback Paint — multi-touch brush strokes painted into a ping-pong
 * render-target pair; each frame the previous image is warped and decayed. */
(function () {
  const S = window.Sandbox;
  const MAXB = 10;

  const STEP = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_prev;
uniform vec2 u_res; uniform float u_time;
uniform float u_decay, u_swirl, u_zoom, u_flow;
uniform vec4 u_a[${MAXB}];   // segment start (uv), radius, active
uniform vec4 u_b[${MAXB}];   // segment end (uv), color mix, strength
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  float asp = u_res.x / u_res.y;
  vec2 c = v_uv - 0.5; c.x *= asp;
  float ang = u_swirl * 0.004 * (1.0 + length(c));
  c = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c;
  c *= 1.0 - u_zoom * 0.002;
  c += u_flow * 0.0012 * vec2(sin(c.y * 9.0 + u_time), cos(c.x * 9.0 - u_time * 1.3));
  c.x /= asp;
  vec4 prev = texture(u_prev, c + 0.5);
  vec3 col = max(prev.rgb * u_decay - 1.5 / 255.0, 0.0);
  vec2 p = v_uv; p.x *= asp;
  for (int i = 0; i < ${MAXB}; i++) {
    if (u_a[i].w < 0.5) continue;
    vec2 a = u_a[i].xy; a.x *= asp; vec2 b = u_b[i].xy; b.x *= asp;
    float d = segDist(p, a, b);
    float m = smoothstep(u_a[i].z, u_a[i].z * 0.2, d) * u_b[i].w;
    col += mix(RED, BLUE, u_b[i].z) * m;
  }
  o = vec4(min(col, vec3(1.6)), 1.0);
}`;

  const SHOW = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  c = c / (1.0 + c * 0.35);
  c += INK * (1.0 - length(c));
  o = vec4(c, 1.0);
}`;

  function targets(ctx, s) {
    const { gl, util } = ctx;
    if (s.tex) util.release(...s.tex, ...s.fb);
    const w = Math.max(2, Math.round(ctx.width * 0.75)), h = Math.max(2, Math.round(ctx.height * 0.75));
    const internal = ctx.caps.floatRT ? gl.RGBA16F : gl.RGBA8;
    const type = ctx.caps.floatRT ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    s.tex = [0, 1].map(() => util.texture({ width: w, height: h, internal, type }));
    s.fb = s.tex.map((t) => util.framebuffer([t]));
    s.w = w; s.h = h; s.src = 0;
    for (const fb of s.fb) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  S.register({
    id: 'feedback-paint',
    title: 'Feedback Paint',
    category: 'Pointer & Touch',
    hint: 'draw · use several fingers on touch',
    description: 'Every active pointer (mouse, pen, or each finger in a multi-touch gesture) paints a line segment from its last position to its current one. The canvas lives in two textures that swap roles each frame (ping-pong), so the previous image can be swirled, zoomed and faded on the GPU to make living trails.',
    interact: [['Hover', 'Leave a thin trail'], ['Press + drag', 'Paint a wide stroke'], ['Multi-touch', 'Up to 10 fingers paint at once, alternating red / blue']],
    features: ['Render-to-texture', 'Ping-pong framebuffers', 'RGBA16F targets (EXT_color_buffer_float)', 'Pointer Events multi-touch'],
    params: [
      { key: 'decay', label: 'Persistence', type: 'range', min: 0.9, max: 0.999, step: 0.001, value: 0.985 },
      { key: 'swirl', label: 'Swirl', type: 'range', min: -3, max: 3, step: 0.05, value: 1 },
      { key: 'zoom', label: 'Zoom drift', type: 'range', min: -3, max: 3, step: 0.05, value: 1 },
      { key: 'flow', label: 'Flow noise', type: 'range', min: 0, max: 3, step: 0.05, value: 0.8 },
      { key: 'size', label: 'Brush size', type: 'range', min: 0.005, max: 0.08, step: 0.001, value: 0.03 },
      { key: 'clear', label: 'Clear canvas', type: 'button' },
    ],
    init(ctx) {
      const s = {
        step: ctx.util.program(S.GLSL.fullscreenVS, STEP),
        show: ctx.util.program(S.GLSL.fullscreenVS, SHOW),
        a: new Float32Array(MAXB * 4), b: new Float32Array(MAXB * 4),
        last: null, auto: 0,
      };
      targets(ctx, s);
      return s;
    },
    resize(ctx, s) { targets(ctx, s); },
    action(ctx, s, key) { if (key === 'clear') targets(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.a.fill(0); s.b.fill(0);
      let n = 0;
      for (const p of input.pointers.values()) {
        if (n >= MAXB) break;
        const hueShift = (p.index % 2) * 0.85 + 0.15 * Math.sin(t * 2 + p.index);
        s.a.set([p.puvx, p.puvy, params.size, 1], n * 4);
        s.b.set([p.uvx, p.uvy, Math.min(Math.max(hueShift, 0), 1), 0.55], n * 4);
        n++;
      }
      if (!input.down && input.hover) {
        const cur = [input.uvx, input.uvy];
        const prev = s.last || cur;
        s.a.set([prev[0], prev[1], params.size * 0.35, 1], 0);
        s.b.set([cur[0], cur[1], 0.5 + 0.5 * Math.sin(t * 1.5), 0.45], 0);
        s.last = cur;
      } else if (!input.down) {
        // Idle: a ghost brush paints so the stage is never empty.
        s.auto += dt;
        const p = (q) => [0.5 + 0.3 * Math.sin(q * 1.1) * Math.cos(q * 0.37), 0.5 + 0.3 * Math.sin(q * 0.83)];
        const a = p(s.auto - dt), b = p(s.auto);
        s.a.set([a[0], a[1], params.size * 0.6, 1], 0);
        s.b.set([b[0], b[1], 0.5 + 0.5 * Math.sin(s.auto), 0.5], 0);
        s.last = null;
      } else s.last = null;

      const dst = 1 - s.src;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb[dst]);
      gl.viewport(0, 0, s.w, s.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.tex[s.src]);
      s.step.use().set({
        u_prev: 0, u_res: [s.w, s.h], u_time: t, u_decay: params.decay, u_swirl: params.swirl,
        u_zoom: params.zoom, u_flow: params.flow, u_a: s.a, u_b: s.b,
      });
      ctx.util.drawFullscreen();
      s.src = dst;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.bindTexture(gl.TEXTURE_2D, s.tex[s.src]);
      s.show.use().set({ u_tex: 0 });
      ctx.util.drawFullscreen();
    },
  });
})();
