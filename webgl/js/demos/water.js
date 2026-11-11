/* Water Ripples — wave-equation simulation in half-float textures,
 * disturbed by every pointer, rendered with refraction and specular light. */
(function () {
  const S = window.Sandbox;
  const MAXD = 12;

  const SIM = `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_state; uniform vec2 u_texel; uniform float u_damp; uniform float u_aspect;
uniform vec4 u_drops[${MAXD}];
void main() {
  vec4 c = texture(u_state, v_uv);
  float sum = texture(u_state, v_uv + vec2(u_texel.x, 0.0)).r + texture(u_state, v_uv - vec2(u_texel.x, 0.0)).r
            + texture(u_state, v_uv + vec2(0.0, u_texel.y)).r + texture(u_state, v_uv - vec2(0.0, u_texel.y)).r;
  float h = (sum * 0.5 - c.g) * u_damp;
  for (int i = 0; i < ${MAXD}; i++) {
    if (u_drops[i].z <= 0.0) continue;
    vec2 d = (v_uv - u_drops[i].xy) * vec2(u_aspect, 1.0);
    float r = length(d) / u_drops[i].z;
    h += u_drops[i].w * max(0.0, 1.0 - r * r);
  }
  o = vec4(h, c.r, 0.0, 1.0);
}`;

  const RENDER = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_state; uniform vec2 u_texel; uniform float u_time; uniform float u_aspect; uniform float u_refract;
vec3 floorPattern(vec2 uv) {
  vec2 p = uv * vec2(u_aspect, 1.0) * 9.0;
  vec2 g = abs(fract(p) - 0.5);
  float tile = smoothstep(0.47, 0.5, max(g.x, g.y));
  vec2 id = floor(p);
  float chk = mod(id.x + id.y, 2.0);
  vec3 base = mix(vec3(0.03, 0.04, 0.07), vec3(0.05, 0.06, 0.1), chk);
  base += mix(BLUE, RED, smoothstep(0.1, 0.9, uv.x)) * 0.12 * (0.6 + 0.4 * sin(id.y * 0.7 + u_time * 0.5));
  return base + tile * mix(BLUE, RED, uv.y) * 0.35;
}
void main() {
  float hL = texture(u_state, v_uv - vec2(u_texel.x, 0.0)).r, hR = texture(u_state, v_uv + vec2(u_texel.x, 0.0)).r;
  float hD = texture(u_state, v_uv - vec2(0.0, u_texel.y)).r, hU = texture(u_state, v_uv + vec2(0.0, u_texel.y)).r;
  float h = texture(u_state, v_uv).r;
  vec3 n = normalize(vec3(hL - hR, hD - hU, 0.08));
  vec3 col = floorPattern(v_uv + n.xy * u_refract);
  vec3 L = normalize(vec3(-0.4, 0.6, 0.7));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
  col += spec * vec3(1.0);
  col += max(h, 0.0) * RED * 0.5 + max(-h, 0.0) * BLUE * 0.5;
  float fres = pow(1.0 - n.z, 2.0);
  col += fres * mix(BLUE, RED, 0.5 + 0.5 * sin(u_time)) * 0.35;
  o = vec4(col, 1.0);
}`;

  function targets(ctx, s) {
    const { gl, util } = ctx;
    if (s.tex) util.release(...s.tex, ...s.fb);
    const h = 360, w = Math.max(16, Math.round(h * ctx.aspect));
    s.tex = [0, 1].map(() => util.texture({ width: w, height: h, internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }));
    s.fb = s.tex.map((t) => util.framebuffer([t]));
    for (const fb of s.fb) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    s.w = w; s.h = h; s.src = 0;
  }

  S.register({
    id: 'water',
    title: 'Water Ripples',
    category: 'Pointer & Touch',
    hint: 'drag to stir · tap for drops',
    description: 'A height field simulated with the discrete wave equation, stored in half-float textures and stepped twice per frame on the GPU. Surface normals come from the height gradient, and they refract a procedural floor and drive specular highlights.',
    interact: [['Drag', 'Stir the surface (every finger counts)'], ['Click / tap', 'Drop a large droplet'], ['Rain toggle', 'Random droplets']],
    features: ['RGBA16F render targets', 'EXT_color_buffer_float', 'Ping-pong simulation', 'Half-float linear filtering'],
    params: [
      { key: 'damp', label: 'Damping', type: 'range', min: 0.95, max: 0.999, step: 0.001, value: 0.99 },
      { key: 'size', label: 'Drop radius', type: 'range', min: 0.005, max: 0.06, step: 0.001, value: 0.018 },
      { key: 'refract', label: 'Refraction', type: 'range', min: 0, max: 0.2, step: 0.005, value: 0.06 },
      { key: 'rain', label: 'Rain', type: 'toggle', value: true },
      { key: 'calm', label: 'Calm the water', type: 'button' },
    ],
    init(ctx) {
      if (!ctx.caps.floatRT) throw new Error('This device does not expose EXT_color_buffer_float, which the half-float simulation needs.');
      const s = {
        sim: ctx.util.program(S.GLSL.fullscreenVS, SIM),
        render: ctx.util.program(S.GLSL.fullscreenVS, RENDER),
        drops: new Float32Array(MAXD * 4), rainT: 0,
      };
      targets(ctx, s);
      return s;
    },
    resize(ctx, s) { targets(ctx, s); },
    action(ctx, s, key) { if (key === 'calm') targets(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const drops = [];
      for (const p of input.pointers.values()) {
        const moved = Math.hypot(p.x - p.px, p.y - p.py);
        if (moved > 0.5 || performance.now() - p.born < 60) drops.push([p.uvx, p.uvy, params.size, -0.12]);
      }
      for (const c of input.clicks) drops.push([c.uvx, c.uvy, params.size * 1.8, -0.5]);
      if (params.rain) {
        s.rainT -= dt;
        if (s.rainT <= 0) { drops.push([Math.random(), Math.random(), params.size * (0.5 + Math.random() * 0.6), -0.22]); s.rainT = 0.08 + Math.random() * 0.25; }
      }
      s.drops.fill(0);
      drops.slice(0, MAXD).forEach((d, i) => s.drops.set(d, i * 4));

      gl.viewport(0, 0, s.w, s.h);
      gl.activeTexture(gl.TEXTURE0);
      s.sim.use();
      for (let i = 0; i < 2; i++) {
        const dst = 1 - s.src;
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb[dst]);
        gl.bindTexture(gl.TEXTURE_2D, s.tex[s.src]);
        s.sim.set({ u_state: 0, u_texel: [1 / s.w, 1 / s.h], u_damp: params.damp, u_aspect: ctx.aspect, u_drops: i === 0 ? s.drops : new Float32Array(MAXD * 4) });
        ctx.util.drawFullscreen();
        s.src = dst;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.bindTexture(gl.TEXTURE_2D, s.tex[s.src]);
      s.render.use().set({ u_state: 0, u_texel: [1 / s.w, 1 / s.h], u_time: t, u_aspect: ctx.aspect, u_refract: params.refract });
      ctx.util.drawFullscreen();
    },
  });
})();
