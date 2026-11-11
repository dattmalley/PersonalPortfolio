/* Pointer Field — a chain of followers easing after the cursor, rendered as a
 * metaball field in a single fragment shader; clicks emit shockwaves. */
(function () {
  const S = window.Sandbox;
  const { damp } = S.math;
  const N = 10;

  const FS = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform vec2 u_res; uniform float u_time; uniform float u_glow; uniform float u_size;
uniform vec2 u_pts[${N}];
uniform vec3 u_rings[6];
void main() {
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = v_uv * asp;
  float f = 0.0; vec3 col = vec3(0.0); vec2 grad = vec2(0.0);
  for (int i = 0; i < ${N}; i++) {
    float k = float(i) / float(${N - 1});
    vec2 d = p - u_pts[i] * asp;
    float r = u_size * (1.0 - k * 0.55);
    float v = r * r / (dot(d, d) + 1e-5);
    f += v; grad += d * v;
    col += mix(RED, BLUE, k) * v;
  }
  col /= max(f, 1e-4);
  // Shockwave rings warp space
  vec2 warp = vec2(0.0); float ringGlow = 0.0;
  for (int i = 0; i < 6; i++) {
    float age = u_time - u_rings[i].z;
    if (age < 0.0 || age > 3.0) continue;
    vec2 d = p - u_rings[i].xy * asp;
    float L = length(d), R = age * 0.9;
    float w = exp(-pow((L - R) * 28.0, 2.0)) * exp(-age * 1.6);
    warp += normalize(d + 1e-5) * w * 0.03;
    ringGlow += w;
  }
  // Background grid bent by the field gradient and the rings
  vec2 gp = (p + warp - grad * 0.004) * 22.0;
  vec2 g = abs(fract(gp) - 0.5) / fwidth(gp);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  vec3 bg = INK + vec3(0.02, 0.025, 0.04) * (1.0 - v_uv.y);
  float near = clamp(f * 0.08, 0.0, 1.0);
  bg += line * (0.05 + 0.35 * near) * mix(BLUE, RED, near);
  float body = smoothstep(0.95, 1.05, f);
  float rim = smoothstep(0.7, 1.0, f) - smoothstep(1.0, 1.3, f);
  vec3 c = bg;
  c += col * clamp(f * 0.12 * u_glow, 0.0, 1.0);
  c = mix(c, col * 0.85 + 0.15, body);
  c += rim * 0.6;
  c += ringGlow * mix(BLUE, RED, 0.5 + 0.5 * sin(u_time * 3.0)) * 0.9;
  c *= 1.0 - 0.35 * dot(v_uv - 0.5, v_uv - 0.5);
  o = vec4(c, 1.0);
}`;

  S.register({
    id: 'pointer-field',
    title: 'Pointer Field',
    category: 'Pointer & Touch',
    hint: 'move · click for shockwaves',
    description: 'A chain of followers chases the pointer using frame-rate-independent easing, and every follower feeds a metaball field evaluated per pixel. The background grid bends along the field gradient, and clicks send shockwaves that warp space.',
    interact: [['Move', 'The chain eases after the pointer'], ['Click / tap', 'Emit a shockwave ring'], ['Idle', 'The chain drifts on a Lissajous path']],
    features: ['gl_VertexID fullscreen triangle', 'Uniform arrays', 'fwidth() antialiasing', 'GLSL ES 3.00'],
    params: [
      { key: 'lag', label: 'Follow stiffness', type: 'range', min: 2, max: 30, step: 0.5, value: 12 },
      { key: 'size', label: 'Blob size', type: 'range', min: 0.02, max: 0.09, step: 0.005, value: 0.05 },
      { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 3, step: 0.05, value: 1.2 },
    ],
    init(ctx) {
      const prog = ctx.util.program(S.GLSL.fullscreenVS, FS);
      const pts = Array.from({ length: N }, () => [0.5, 0.5]);
      const rings = new Float32Array(18).fill(-100);
      return { prog, pts, rings, ringIdx: 0, idle: 0 };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      let tx = input.uvx, ty = input.uvy;
      s.idle = input.hover || input.down ? 0 : s.idle + dt;
      if (s.idle > 1.5 || (!input.hover && !input.down)) {
        tx = 0.5 + 0.32 * Math.sin(t * 0.9); ty = 0.5 + 0.28 * Math.sin(t * 1.3 + 1.0);
      }
      const k = damp(params.lag, dt);
      s.pts[0][0] += (tx - s.pts[0][0]) * k; s.pts[0][1] += (ty - s.pts[0][1]) * k;
      for (let i = 1; i < N; i++) {
        s.pts[i][0] += (s.pts[i - 1][0] - s.pts[i][0]) * k;
        s.pts[i][1] += (s.pts[i - 1][1] - s.pts[i][1]) * k;
      }
      for (const c of input.clicks) {
        s.rings.set([c.uvx, c.uvy, t], s.ringIdx * 3);
        s.ringIdx = (s.ringIdx + 1) % 6;
      }
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.prog.use().set({
        u_res: [ctx.width, ctx.height], u_time: t, u_glow: params.glow, u_size: params.size,
        u_pts: new Float32Array(s.pts.flat()), u_rings: s.rings,
      });
      ctx.util.drawFullscreen();
    },
  });
})();
