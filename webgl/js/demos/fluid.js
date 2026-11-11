/* Fluid Simulation — incompressible Navier–Stokes ("stable fluids") on the GPU:
 * advection, vorticity confinement, divergence, Jacobi pressure solve and
 * gradient subtraction, all in half-float render targets. */
(function () {
  const S = window.Sandbox;

  const H = `in vec2 v_uv; out vec4 o; uniform vec2 u_texel;`;
  const ADVECT = H + `
uniform sampler2D u_vel; uniform sampler2D u_src; uniform float u_dt; uniform float u_diss;
void main() {
  vec2 coord = v_uv - u_dt * texture(u_vel, v_uv).xy * u_texel;
  o = texture(u_src, coord) / (1.0 + u_diss * u_dt);
}`;
  const DIVERGENCE = H + `
uniform sampler2D u_vel;
void main() {
  float L = texture(u_vel, v_uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_vel, v_uv + vec2(u_texel.x, 0.0)).x;
  float B = texture(u_vel, v_uv - vec2(0.0, u_texel.y)).y;
  float T = texture(u_vel, v_uv + vec2(0.0, u_texel.y)).y;
  vec2 C = texture(u_vel, v_uv).xy;
  if (v_uv.x - u_texel.x < 0.0) L = -C.x;
  if (v_uv.x + u_texel.x > 1.0) R = -C.x;
  if (v_uv.y - u_texel.y < 0.0) B = -C.y;
  if (v_uv.y + u_texel.y > 1.0) T = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;
  const CURL = H + `
uniform sampler2D u_vel;
void main() {
  float L = texture(u_vel, v_uv - vec2(u_texel.x, 0.0)).y;
  float R = texture(u_vel, v_uv + vec2(u_texel.x, 0.0)).y;
  float B = texture(u_vel, v_uv - vec2(0.0, u_texel.y)).x;
  float T = texture(u_vel, v_uv + vec2(0.0, u_texel.y)).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;
  const VORTICITY = H + `
uniform sampler2D u_vel; uniform sampler2D u_curl; uniform float u_curlAmt; uniform float u_dt;
void main() {
  float L = texture(u_curl, v_uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_curl, v_uv + vec2(u_texel.x, 0.0)).x;
  float B = texture(u_curl, v_uv - vec2(0.0, u_texel.y)).x;
  float T = texture(u_curl, v_uv + vec2(0.0, u_texel.y)).x;
  float C = texture(u_curl, v_uv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 1e-4;
  force *= u_curlAmt * C * vec2(1.0, -1.0);
  vec2 v = texture(u_vel, v_uv).xy + force * u_dt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`;
  const PRESSURE = H + `
uniform sampler2D u_p; uniform sampler2D u_div;
void main() {
  float L = texture(u_p, v_uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_p, v_uv + vec2(u_texel.x, 0.0)).x;
  float B = texture(u_p, v_uv - vec2(0.0, u_texel.y)).x;
  float T = texture(u_p, v_uv + vec2(0.0, u_texel.y)).x;
  float d = texture(u_div, v_uv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`;
  const GRADIENT = H + `
uniform sampler2D u_p; uniform sampler2D u_vel;
void main() {
  float L = texture(u_p, v_uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_p, v_uv + vec2(u_texel.x, 0.0)).x;
  float B = texture(u_p, v_uv - vec2(0.0, u_texel.y)).x;
  float T = texture(u_p, v_uv + vec2(0.0, u_texel.y)).x;
  vec2 v = texture(u_vel, v_uv).xy - vec2(R - L, T - B);
  o = vec4(v, 0.0, 1.0);
}`;
  const SCALE = H + `uniform sampler2D u_src; uniform float u_value; void main() { o = u_value * texture(u_src, v_uv); }`;
  const SPLAT = H + `
uniform sampler2D u_target; uniform float u_aspect; uniform vec3 u_color; uniform vec2 u_point; uniform float u_radius;
void main() {
  vec2 p = v_uv - u_point; p.x *= u_aspect;
  vec3 s = exp(-dot(p, p) / u_radius) * u_color;
  o = vec4(texture(u_target, v_uv).xyz + s, 1.0);
}`;
  const DISPLAY = S.GLSL.colors + H + `
uniform sampler2D u_dye; uniform bool u_shade;
void main() {
  vec3 c = texture(u_dye, v_uv).rgb;
  if (u_shade) {
    vec3 l = texture(u_dye, v_uv - vec2(u_texel.x, 0.0)).rgb, r = texture(u_dye, v_uv + vec2(u_texel.x, 0.0)).rgb;
    vec3 b = texture(u_dye, v_uv - vec2(0.0, u_texel.y)).rgb, t = texture(u_dye, v_uv + vec2(0.0, u_texel.y)).rgb;
    float dx = length(r) - length(l), dy = length(t) - length(b);
    vec3 n = normalize(vec3(dx, dy, length(u_texel) * 3.0));
    float diff = clamp(dot(n, normalize(vec3(-0.4, 0.6, 1.0))) + 0.7, 0.7, 1.0);
    c *= diff;
  }
  float a = max(c.r, max(c.g, c.b));
  c = c / (1.0 + a * 0.35);
  c += INK * (1.0 - clamp(a * 3.0, 0.0, 1.0));
  o = vec4(c, 1.0);
}`;

  function makeTarget(ctx, w, h, internal, format) {
    const { gl, util } = ctx;
    const tex = util.texture({ width: w, height: h, internal, format, type: gl.HALF_FLOAT });
    return { tex, fb: util.framebuffer([tex]), w, h };
  }
  function makeDouble(ctx, w, h, internal, format) {
    const d = { a: makeTarget(ctx, w, h, internal, format), b: makeTarget(ctx, w, h, internal, format) };
    d.read = () => d.a; d.write = () => d.b; d.swap = () => { const t = d.a; d.a = d.b; d.b = t; };
    return d;
  }
  const RES = [64, 128, 256];

  function targets(ctx, s) {
    const { gl, util } = ctx;
    if (s.all) util.release(...s.all);
    const sim = RES[ctx.params.quality], dye = sim * 4;
    const sz = (r) => (ctx.aspect >= 1 ? [Math.round(r * ctx.aspect), r] : [r, Math.round(r / ctx.aspect)]);
    const [sw, sh] = sz(sim), [dw, dh] = sz(dye);
    s.vel = makeDouble(ctx, sw, sh, gl.RG16F, gl.RG);
    s.dye = makeDouble(ctx, dw, dh, gl.RGBA16F, gl.RGBA);
    s.p = makeDouble(ctx, sw, sh, gl.R16F, gl.RED);
    s.div = makeTarget(ctx, sw, sh, gl.R16F, gl.RED);
    s.curl = makeTarget(ctx, sw, sh, gl.R16F, gl.RED);
    s.all = [s.vel.a, s.vel.b, s.dye.a, s.dye.b, s.p.a, s.p.b, s.div, s.curl].flatMap((t) => [t.tex, t.fb]);
  }

  S.register({
    id: 'fluid',
    title: 'Fluid Simulation',
    category: 'Simulation',
    hint: 'drag to push ink · several fingers at once',
    description: 'Real-time incompressible fluid dynamics, the "stable fluids" method from computer graphics. Each frame the GPU advects velocity and dye, adds vorticity confinement to keep swirls alive, solves for pressure with Jacobi iterations, and subtracts the pressure gradient so the flow stays divergence-free. Every pointer injects both force and colour.',
    interact: [['Drag', 'Push the fluid and inject ink'], ['Hover', 'Gentle stirring with the mouse'], ['Multi-touch', 'Every finger is its own jet'], ['Splash', 'Random bursts of red and blue']],
    features: ['RG16F / R16F / RGBA16F render targets', 'Semi-Lagrangian advection', 'Jacobi pressure solve', 'Vorticity confinement', '~30 passes per frame'],
    params: [
      { key: 'quality', label: 'Simulation grid', type: 'select', options: ['64', '128', '256'], value: 1, restart: true },
      { key: 'curl', label: 'Vorticity', type: 'range', min: 0, max: 50, step: 1, value: 25 },
      { key: 'dyeDiss', label: 'Ink fade', type: 'range', min: 0, max: 4, step: 0.05, value: 0.8 },
      { key: 'velDiss', label: 'Velocity fade', type: 'range', min: 0, max: 4, step: 0.05, value: 0.2 },
      { key: 'iters', label: 'Pressure iterations', type: 'range', min: 4, max: 50, step: 1, value: 20 },
      { key: 'radius', label: 'Splat radius', type: 'range', min: 0.05, max: 1, step: 0.01, value: 0.25 },
      { key: 'shade', label: 'Surface shading', type: 'toggle', value: true },
      { key: 'splash', label: 'Splash', type: 'button' },
      { key: 'clear', label: 'Clear', type: 'button' },
    ],
    init(ctx) {
      if (!ctx.caps.floatRT) throw new Error('This device lacks EXT_color_buffer_float, which the half-float fluid solver needs.');
      const P = (fs) => ctx.util.program(S.GLSL.fullscreenVS, fs);
      const s = {
        advect: P(ADVECT), divergence: P(DIVERGENCE), curlP: P(CURL), vorticity: P(VORTICITY),
        pressure: P(PRESSURE), gradient: P(GRADIENT), scale: P(SCALE), splatP: P(SPLAT), display: P(DISPLAY),
        queue: [], idle: 0, last: new Map(), hoverLast: null,
      };
      targets(ctx, s);
      for (let i = 0; i < 6; i++) randomSplat(s, i);
      return s;
    },
    resize(ctx, s) { targets(ctx, s); },
    action(ctx, s, key) {
      if (key === 'splash') for (let i = 0; i < 8; i++) randomSplat(s, i);
      if (key === 'clear') targets(ctx, s);
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      dt = Math.min(dt, 1 / 60);
      const run = (prog, target, uniforms) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
        gl.viewport(0, 0, target.w, target.h);
        prog.use().set(uniforms);
        ctx.util.drawFullscreen();
      };
      const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit; };

      // ---- input → splats
      for (const p of input.pointers.values()) {
        const dx = p.uvx - p.puvx, dy = p.uvy - p.puvy;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          const c = p.index % 2 ? S.BLUE : S.RED;
          s.queue.push({ x: p.uvx, y: p.uvy, dx: dx * 6000, dy: dy * 6000, color: c.map((v) => v * 0.35) });
        }
      }
      if (!input.down && input.hover) {
        const cur = [input.uvx, input.uvy], prev = s.hoverLast || cur;
        const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
        if (Math.abs(dx) + Math.abs(dy) > 0.0005) {
          const mixc = 0.5 + 0.5 * Math.sin(t * 0.8);
          const c = S.RED.map((r, i) => r + (S.BLUE[i] - r) * mixc);
          s.queue.push({ x: cur[0], y: cur[1], dx: dx * 2500, dy: dy * 2500, color: c.map((v) => v * 0.12) });
        }
        s.hoverLast = cur;
      } else s.hoverLast = null;
      s.idle = input.down || input.hover ? 0 : s.idle + dt;
      if (s.idle > 2.5) { randomSplat(s, Math.floor(t)); s.idle = 1.2; }

      const vT = [1 / s.vel.a.w, 1 / s.vel.a.h];
      // splats
      for (const q of s.queue.splice(0, 16)) {
        run(s.splatP, s.vel.write(), { u_target: bind(0, s.vel.read().tex), u_texel: vT, u_aspect: ctx.aspect, u_point: [q.x, q.y], u_color: [q.dx, q.dy, 0], u_radius: params.radius / 100 });
        s.vel.swap();
        run(s.splatP, s.dye.write(), { u_target: bind(0, s.dye.read().tex), u_texel: vT, u_aspect: ctx.aspect, u_point: [q.x, q.y], u_color: q.color, u_radius: params.radius / 100 });
        s.dye.swap();
      }
      // curl + vorticity
      run(s.curlP, s.curl, { u_vel: bind(0, s.vel.read().tex), u_texel: vT });
      run(s.vorticity, s.vel.write(), { u_vel: bind(0, s.vel.read().tex), u_curl: bind(1, s.curl.tex), u_curlAmt: params.curl, u_dt: dt, u_texel: vT });
      s.vel.swap();
      // divergence
      run(s.divergence, s.div, { u_vel: bind(0, s.vel.read().tex), u_texel: vT });
      // pressure: decay the previous solution as a warm start, then Jacobi iterate
      run(s.scale, s.p.write(), { u_src: bind(0, s.p.read().tex), u_value: 0.8, u_texel: vT });
      s.p.swap();
      bind(1, s.div.tex);
      for (let i = 0; i < params.iters; i++) {
        run(s.pressure, s.p.write(), { u_p: bind(0, s.p.read().tex), u_div: 1, u_texel: vT });
        s.p.swap();
      }
      // project
      run(s.gradient, s.vel.write(), { u_p: bind(0, s.p.read().tex), u_vel: bind(1, s.vel.read().tex), u_texel: vT });
      s.vel.swap();
      // advect velocity, then dye
      run(s.advect, s.vel.write(), { u_vel: bind(0, s.vel.read().tex), u_src: 0, u_dt: dt, u_diss: params.velDiss, u_texel: vT });
      s.vel.swap();
      run(s.advect, s.dye.write(), { u_vel: bind(0, s.vel.read().tex), u_src: bind(1, s.dye.read().tex), u_dt: dt, u_diss: params.dyeDiss, u_texel: vT });
      s.dye.swap();
      // display
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.display.use().set({ u_dye: bind(0, s.dye.read().tex), u_texel: [1 / s.dye.a.w, 1 / s.dye.a.h], u_shade: params.shade });
      ctx.util.drawFullscreen();
      gl.activeTexture(gl.TEXTURE0);
    },
  });

  function randomSplat(s, i) {
    const c = i % 2 ? S.BLUE : S.RED;
    const a = Math.random() * Math.PI * 2;
    s.queue.push({ x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7, dx: Math.cos(a) * 900, dy: Math.sin(a) * 900, color: c.map((v) => v * 1.4) });
  }
})();
