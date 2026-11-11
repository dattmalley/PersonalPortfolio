/* Raymarched SDF — smooth-blended metaball spheres over a floor, with soft
 * shadows and AO. The pointer is ray-cast onto the floor in-shader and becomes
 * a blob that merges with the others. */
(function () {
  const S = window.Sandbox;

  const FS = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform vec2 u_res; uniform float u_time; uniform vec3 u_eye; uniform vec3 u_target;
uniform vec2 u_mouse; uniform float u_k; uniform float u_hover; uniform int u_steps; uniform float u_speed;
uniform vec4 u_pulse; // xyz pos, w age

vec3 camRay(vec2 uv, out vec3 ro) {
  ro = u_eye;
  vec3 f = normalize(u_target - u_eye), r = normalize(cross(f, vec3(0, 1, 0))), u = cross(r, f);
  vec2 p = (uv * 2.0 - 1.0) * vec2(u_res.x / u_res.y, 1.0);
  return normalize(f * 1.6 + r * p.x + u * p.y);
}
vec2 smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  float m = h * h * 0.5;
  float s = m * k * 0.5;
  return a < b ? vec2(a - s, m) : vec2(b - s, 1.0 - m);
}
vec3 g_mouse;
// returns distance, material mix (0 red .. 1 blue)
vec2 map(vec3 p) {
  float t = u_time * u_speed;
  vec2 res = vec2(1e5, 0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec3 c = vec3(sin(t * 0.7 + fi * 1.9) * 1.6, 0.9 + sin(t * 1.1 + fi * 2.3) * 0.55, cos(t * 0.5 + fi * 1.3) * 1.6);
    float d = length(p - c) - (0.45 + 0.12 * sin(fi * 3.1));
    vec2 m = smin(res.x, d, u_k);
    res = vec2(m.x, mix(res.y, mod(fi, 2.0), m.y));
  }
  float dm = length(p - g_mouse) - 0.55 * u_hover;
  vec2 m = smin(res.x, dm, u_k);
  res = vec2(m.x, mix(res.y, 0.5, m.y));
  float fl = p.y + 0.02 * sin(p.x * 3.0 + t) * sin(p.z * 3.0);
  if (u_pulse.w < 2.5) {
    float L = length(p.xz - u_pulse.xz);
    fl -= 0.18 * exp(-pow((L - u_pulse.w * 2.5) * 3.0, 2.0)) * exp(-u_pulse.w * 1.4);
  }
  if (fl < res.x) res = vec2(fl, -1.0);
  return res;
}
vec3 normal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x));
}
float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 32; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.02, 0.3);
    if (res < 0.01 || t > 8.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
float ao(vec3 p, vec3 n) {
  float a = 0.0, s = 1.0;
  for (int i = 1; i <= 5; i++) { float h = 0.04 * float(i); a += (h - map(p + n * h).x) * s; s *= 0.7; }
  return clamp(1.0 - 2.5 * a, 0.0, 1.0);
}
void main() {
  vec3 ro, mro;
  vec3 rd = camRay(v_uv, ro);
  vec3 md = camRay(u_mouse, mro);
  float tm = md.y < -0.01 ? -mro.y / md.y : 50.0;
  g_mouse = mro + md * min(tm, 50.0); g_mouse.y = 0.35;

  float t = 0.0; vec2 h = vec2(0.0); bool hit = false;
  for (int i = 0; i < 160; i++) {
    if (i >= u_steps) break;
    h = map(ro + rd * t);
    if (h.x < 0.001 * t) { hit = true; break; }
    t += h.x;
    if (t > 40.0) break;
  }
  vec3 sky = mix(vec3(0.02, 0.025, 0.045), vec3(0.06, 0.02, 0.04), pow(1.0 - max(rd.y, 0.0), 4.0));
  vec3 col = sky;
  if (hit) {
    vec3 p = ro + rd * t, n = normal(p);
    vec3 L = normalize(vec3(0.6, 0.8, 0.3));
    float dif = max(dot(n, L), 0.0) * shadow(p + n * 0.01, L);
    float occ = ao(p, n);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    vec3 alb;
    if (h.y < 0.0) {
      vec2 g = abs(fract(p.xz) - 0.5);
      float line = smoothstep(0.48, 0.5, max(g.x, g.y));
      alb = vec3(0.04, 0.045, 0.06) + line * mix(BLUE, RED, smoothstep(-4.0, 4.0, p.x)) * 0.35;
    } else alb = mix(RED, BLUE, h.y);
    float sp = pow(max(dot(reflect(-L, n), -rd), 0.0), 32.0);
    col = alb * (0.15 + 0.85 * dif) * occ + sp * dif * 0.7 + fres * mix(BLUE, RED, 0.5 + 0.5 * n.x) * 0.35 * (h.y < 0.0 ? 0.2 : 1.0);
    col = mix(col, sky, 1.0 - exp(-0.004 * t * t));
  }
  col = pow(col, vec3(0.9));
  o = vec4(col, 1.0);
}`;

  S.register({
    id: 'raymarch',
    title: 'Raymarched SDF',
    category: 'Rendering',
    hint: 'hover to add a blob · click to pulse · drag to orbit',
    description: 'There are no triangles here. Every pixel sphere-traces a signed distance field of smoothly blended blobs, with soft shadows, ambient occlusion and fog. The pointer ray is intersected with the floor inside the shader, and that point becomes a blob that merges with the rest. Clicking sends a ripple across the floor.',
    interact: [['Hover', 'Your cursor becomes a merging blob'], ['Click / tap', 'Send a ripple through the floor'], ['Drag', 'Orbit'], ['Wheel / pinch', 'Zoom']],
    features: ['Per-pixel ray marching', 'Signed distance fields', 'Dynamic loops with int uniforms', 'Soft shadows + AO'],
    params: [
      { key: 'k', label: 'Blend smoothness', type: 'range', min: 0.05, max: 1.5, step: 0.01, value: 0.6 },
      { key: 'speed', label: 'Animation speed', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'steps', label: 'March steps (quality)', type: 'range', min: 32, max: 160, step: 1, value: 96 },
      { key: 'res', label: 'Render scale', type: 'range', min: 0.35, max: 1, step: 0.05, value: 0.75 },
    ],
    init(ctx) {
      return {
        prog: ctx.util.program(S.GLSL.fullscreenVS, FS),
        cam: new S.OrbitCam({ dist: 7, pitch: 0.38, minDist: 3, maxDist: 16, auto: 0.06, target: [0, 0.6, 0], minPitch: 0.05 }),
        hover: 0, pulse: [0, 0, 0, 10], blit: null,
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt, false);
      s.hover += ((input.hover || input.down ? 1 : 0) - s.hover) * S.math.damp(6, dt);
      for (const c of input.clicks) {
        const r = s.cam.ray(c.uvx * 2 - 1, c.uvy * 2 - 1, ctx.aspect);
        if (r.dir[1] < -0.01) { const k = -r.origin[1] / r.dir[1]; s.pulse = [r.origin[0] + r.dir[0] * k, 0, r.origin[2] + r.dir[2] * k, 0]; }
      }
      s.pulse[3] += dt;
      // Render at reduced resolution via a scaled viewport, then upscale with blitFramebuffer.
      const w = Math.max(1, Math.round(ctx.width * params.res)), h = Math.max(1, Math.round(ctx.height * params.res));
      if (!s.blit || s.bw !== w || s.bh !== h) {
        if (s.blit) ctx.util.release(s.blit, s.rb);
        s.rb = ctx.util.renderbuffer(gl.RGBA8, w, h);
        s.blit = ctx.util.framebuffer([{ rb: s.rb }]);
        s.bw = w; s.bh = h;
      }
      if (!s.present) s.present = presentTarget(ctx, s);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.blit);
      gl.viewport(0, 0, w, h);
      s.prog.use().set({
        u_res: [w, h], u_time: t, u_eye: s.cam.eye(), u_target: s.cam.target, u_mouse: [input.uvx, input.uvy],
        u_k: params.k, u_hover: s.hover, u_steps: params.steps, u_speed: params.speed, u_pulse: s.pulse,
      });
      ctx.util.drawFullscreen();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.blit);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.present);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, ctx.width, ctx.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      // draw the full-size texture to the (possibly multisampled) default framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.bindTexture(gl.TEXTURE_2D, s.presentTex);
      s.copy.use().set({ u_tex: 0 });
      ctx.util.drawFullscreen();
    },
    resize(ctx, s) {
      if (s.present) { ctx.util.release(s.present, s.presentTex); s.present = null; }
    },
  });

  // Full-resolution texture target that the low-res render is blitted (and filtered) into.
  function presentTarget(ctx, s) {
    const { gl, util } = ctx;
    s.presentTex = util.texture({ width: ctx.width, height: ctx.height });
    if (!s.copy) s.copy = util.program(S.GLSL.fullscreenVS, `in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; void main(){ o = texture(u_tex, v_uv); }`);
    return util.framebuffer([s.presentTex]);
  }
})();
