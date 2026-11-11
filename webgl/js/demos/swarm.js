/* Instancing Swarm — up to 200k instanced octahedra whose positions are
 * computed entirely in the vertex shader from gl_InstanceID. Formations morph
 * smoothly and the pointer carves a repulsion field through the swarm. */
(function () {
  const S = window.Sandbox;
  const { V3, M4, damp } = S.math;

  const VS = S.GLSL.colors + `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform float u_count; uniform float u_time; uniform float u_morph;
uniform vec3 u_mouse; uniform float u_force; uniform float u_scale; uniform float u_wave;
out vec3 v_n; out vec3 v_col; out float v_push;
const float PI = 3.14159265;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 formation(int f, float i, float k) {
  if (f == 0) { // fibonacci sphere
    float y = 1.0 - 2.0 * k; float r = sqrt(1.0 - y * y); float a = i * 2.39996323;
    return vec3(cos(a) * r, y, sin(a) * r) * 3.2;
  } else if (f == 1) { // spiral galaxy
    float arm = mod(i, 3.0); float rr = pow(k, 0.6) * 4.6;
    float a = rr * 1.4 + arm * 2.0943951 + (h1(i) - 0.5) * 0.6;
    return vec3(cos(a) * rr, (h1(i + 7.0) - 0.5) * 0.5 * (1.0 - k), sin(a) * rr);
  } else if (f == 2) { // torus
    float a = k * 2.0 * PI * 23.0, b = i * 2.39996323;
    return vec3(cos(a) * (2.6 + 0.9 * cos(b)), 0.9 * sin(b), sin(a) * (2.6 + 0.9 * cos(b)));
  } else { // cube lattice
    float side = ceil(pow(u_count, 1.0 / 3.0));
    vec3 g = vec3(mod(i, side), mod(floor(i / side), side), floor(i / (side * side)));
    return (g / max(side - 1.0, 1.0) - 0.5) * 5.0;
  }
}
mat3 rot(vec3 ax, float a) {
  ax = normalize(ax); float s = sin(a), c = cos(a), oc = 1.0 - c;
  return mat3(oc*ax.x*ax.x + c, oc*ax.x*ax.y + ax.z*s, oc*ax.z*ax.x - ax.y*s,
              oc*ax.x*ax.y - ax.z*s, oc*ax.y*ax.y + c, oc*ax.y*ax.z + ax.x*s,
              oc*ax.z*ax.x + ax.y*s, oc*ax.y*ax.z - ax.x*s, oc*ax.z*ax.z + c);
}
void main() {
  float i = float(gl_InstanceID);
  float k = (i + 0.5) / u_count;
  int f0 = int(floor(u_morph)); int f1 = int(mod(float(f0) + 1.0, 4.0));
  float m = smoothstep(0.0, 1.0, fract(u_morph));
  float stagger = clamp(m * 1.6 - h1(i) * 0.6, 0.0, 1.0);
  vec3 c = mix(formation(f0, i, k), formation(f1, i, k), stagger);
  c += normalize(c + 1e-4) * sin(length(c) * 2.5 - u_time * 2.0) * 0.12 * u_wave;
  vec3 d = c - u_mouse;
  float push = exp(-dot(d, d) * 1.4);
  c += normalize(d + 1e-4) * push * u_force;
  mat3 R = rot(vec3(h1(i), h1(i + 1.0), h1(i + 2.0)) - 0.5, u_time * (0.5 + h1(i + 3.0) * 2.0));
  float s = u_scale * (0.7 + 0.6 * h1(i + 5.0)) * (1.0 + push * 1.5);
  vec3 p = c + R * a_pos * s;
  v_n = R * a_nrm; v_push = push;
  v_col = mix(BLUE, RED, smoothstep(0.2, 0.8, k + 0.15 * sin(u_time * 0.5 + c.y)));
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  const FS = `
in vec3 v_n; in vec3 v_col; in float v_push; out vec4 o;
void main() {
  vec3 n = normalize(v_n);
  float d = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.5, 0.8, 0.4))), 0.0);
  o = vec4(v_col * d + v_push * 0.5, 1.0);
}`;

  const NAMES = ['Sphere', 'Galaxy', 'Torus', 'Lattice'];

  S.register({
    id: 'swarm',
    title: 'Instancing Swarm',
    category: 'GPU Motion',
    hint: 'move to repel · click to morph · drag to orbit',
    description: 'One drawArraysInstanced call renders up to 200,000 spinning octahedra. The CPU uploads no per-instance data at all: each instance works out its own position, rotation and color from gl_InstanceID. Formations morph with a per-instance stagger, and the pointer is ray-cast into the scene to push the swarm aside.',
    interact: [['Move', 'Carve a repulsion field'], ['Click / tap', 'Morph to the next formation'], ['Drag', 'Orbit'], ['Wheel / pinch', 'Zoom']],
    features: ['drawArraysInstanced', 'gl_InstanceID', 'Procedural vertex animation', 'Staggered morphing'],
    params: [
      { key: 'count', label: 'Instances', type: 'range', min: 1000, max: 200000, step: 1000, value: 40000, restart: false },
      { key: 'formation', label: 'Formation', type: 'select', options: NAMES, value: 0 },
      { key: 'force', label: 'Repulsion', type: 'range', min: 0, max: 3, step: 0.05, value: 1.2 },
      { key: 'scale', label: 'Instance size', type: 'range', min: 0.01, max: 0.12, step: 0.005, value: 0.04 },
      { key: 'wave', label: 'Pulse wave', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const o = S.geo.octa();
      const buf = util.buffer(gl.ARRAY_BUFFER, o.data);
      return {
        prog: util.program(VS, FS),
        vao: util.vao([{ buffer: buf, loc: 0, size: 3, stride: 24 }, { buffer: buf, loc: 1, size: 3, stride: 24, offset: 12 }]),
        cam: new S.OrbitCam({ dist: 11, pitch: 0.35, minDist: 4, maxDist: 30, auto: 0.1 }),
        morph: ctx.params.formation, target: ctx.params.formation, mouse: [0, 0, 0], push: 0,
      };
    },
    onParam(ctx, s, key, v) {
      if (key === 'formation') {
        // always travel forward through the cycle
        let t = v; while (t < s.target) t += 4; s.target = t;
      }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      for (const c of input.clicks) { if (c.button === 0) s.target = Math.floor(s.target) + 1; }
      s.morph += (s.target - s.morph) * damp(2.2, dt);
      if (Math.abs(s.target - s.morph) < 1e-3) s.morph = s.target;
      const shown = ((Math.round(s.target) % 4) + 4) % 4;
      if (ctx.params.formation !== shown) {
        ctx.params.formation = shown;
        const sel = document.getElementById('ctl-formation');
        if (sel) sel.value = shown;
      }
      // pointer ray → plane through origin facing camera
      const r = s.cam.ray(input.nx, input.ny, ctx.aspect);
      const b = s.cam.basis();
      const tt = -V3.dot(r.origin, b.fwd) / V3.dot(r.dir, b.fwd);
      const hit = V3.add(r.origin, V3.scale(r.dir, tt));
      const a = damp(10, dt);
      for (let i = 0; i < 3; i++) s.mouse[i] += (hit[i] - s.mouse[i]) * a;
      s.push += ((input.hover || input.down ? params.force : 0) - s.push) * damp(5, dt);

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 100), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      s.prog.use().set({
        u_vp: vp, u_count: params.count, u_time: t, u_morph: ((s.morph % 4) + 4) % 4, u_mouse: s.mouse,
        u_force: s.push, u_scale: params.scale, u_wave: params.wave,
      });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 24, params.count);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
