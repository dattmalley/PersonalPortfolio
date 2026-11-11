/* Scroll Morph — the wheel (or a vertical drag / arrow keys) scrubs a timeline
 * that blends four morph targets stored as separate vertex attributes.
 * Scroll velocity feeds a twist deformation, so fast scrolling looks fast. */
(function () {
  const S = window.Sandbox;
  const { M4, damp, clamp } = S.math;
  const NU = 160, NV = 80;
  const STOPS = ['Sphere', 'Cube', 'Torus', 'Bloom'];

  const VS = `
layout(location = 0) in vec3 a_p0; layout(location = 1) in vec3 a_n0;
layout(location = 2) in vec3 a_p1; layout(location = 3) in vec3 a_n1;
layout(location = 4) in vec3 a_p2; layout(location = 5) in vec3 a_n2;
layout(location = 6) in vec3 a_p3; layout(location = 7) in vec3 a_n3;
uniform mat4 u_vp; uniform mat4 u_model; uniform float u_morph; uniform float u_twist; uniform float u_time;
out vec3 v_n; out vec3 v_w; out float v_k;
vec4 weights(float m) {
  return vec4(max(0.0, 1.0 - abs(m - 0.0)), max(0.0, 1.0 - abs(m - 1.0)), max(0.0, 1.0 - abs(m - 2.0)), max(0.0, 1.0 - abs(m - 3.0)));
}
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
void main() {
  vec4 w = weights(u_morph);
  vec3 p = a_p0 * w.x + a_p1 * w.y + a_p2 * w.z + a_p3 * w.w;
  vec3 n = a_n0 * w.x + a_n1 * w.y + a_n2 * w.z + a_n3 * w.w;
  mat3 tw = rotY(p.y * u_twist);
  p = tw * p; n = tw * n;
  p += normalize(p + 1e-5) * 0.015 * sin(p.y * 10.0 + u_time * 2.0); // radial: continuous across hard cube edges
  vec4 wp = u_model * vec4(p, 1.0);
  v_w = wp.xyz; v_n = mat3(u_model) * n; v_k = p.y;
  gl_Position = u_vp * wp;
}`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in float v_k; out vec4 o;
uniform vec3 u_eye; uniform float u_morph;
void main() {
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(u_eye - v_w);
  vec3 L1 = normalize(vec3(-2.0, 1.5, 1.0)), L2 = normalize(vec3(2.0, -0.5, 1.0));
  float d1 = max(dot(n, L1), 0.0), d2 = max(dot(n, L2), 0.0);
  float sp = pow(max(dot(reflect(-L1, n), V), 0.0), 40.0) + pow(max(dot(reflect(-L2, n), V), 0.0), 40.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  vec3 c = vec3(0.05, 0.055, 0.08) + RED * d1 * 0.7 + BLUE * d2 * 0.7 + sp * 0.6 + fres * mix(BLUE, RED, fract(u_morph * 0.5)) * 0.8;
  float stripes = smoothstep(0.42, 0.5, abs(fract(v_k * 8.0) - 0.5));
  c += stripes * 0.04;
  o = vec4(c, 1.0);
}`;

  function targets() {
    const sph = (u, v) => { const a = u * Math.PI * 2, b = v * Math.PI; return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; };
    const shapes = [
      (u, v) => { const d = sph(u, v); return { p: d.map((x) => x * 1.3), n: d }; },
      (u, v) => {
        // Superquadric "rounded cube": a smooth edge the sphere-parameterised grid can follow
        // (a perfectly sharp cube edge would cut across grid triangles and look sawtoothed).
        const d = sph(u, v), e = 10;
        const r = Math.pow(Math.abs(d[0]) ** e + Math.abs(d[1]) ** e + Math.abs(d[2]) ** e, 1 / e) || 1;
        return { p: d.map((x) => (x / r) * 1.05) };
      },
      (u, v) => {
        const a = u * Math.PI * 2, b = v * Math.PI * 2, R = 1.1, r = 0.45;
        return { p: [Math.cos(a) * (R + r * Math.cos(b)), r * Math.sin(b), Math.sin(a) * (R + r * Math.cos(b))], n: [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)] };
      },
      (u, v) => {
        const d = sph(u, v); const a = u * Math.PI * 2, b = v * Math.PI;
        const r = 1.1 + 0.32 * Math.sin(a * 6) * Math.pow(Math.sin(b), 2) + 0.18 * Math.cos(b * 5);
        return { p: d.map((x) => x * r) };
      },
    ];
    return shapes.map((fn) => S.geo.surface(NU, NV, fn));
  }

  S.register({
    id: 'morph',
    title: 'Scroll Morph',
    category: 'Animation',
    hint: 'scroll / drag vertically / arrows to scrub',
    description: 'Scroll-driven animation: the wheel, a vertical drag or the arrow keys scrub a timeline through four keyframed shapes. All four positions and normals sit in eight vertex attributes of one VAO and are blended in the vertex shader. The display position eases toward the scroll position, and scroll velocity twists the mesh.',
    interact: [['Wheel / trackpad', 'Scrub the timeline'], ['Vertical drag', 'Scrub on touch'], ['↑ ↓ / ← →', 'Step between keyframes'], ['Horizontal drag', 'Spin the model']],
    features: ['8 vertex attributes per VAO', 'Morph targets', 'Scroll / wheel input', 'Velocity-driven deformation', 'Uint32 indices'],
    params: [
      { key: 'smooth', label: 'Scroll smoothing', type: 'range', min: 1, max: 20, step: 0.5, value: 6 },
      { key: 'twist', label: 'Velocity twist', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'snap', label: 'Snap to keyframes', type: 'toggle', value: false },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const T = targets();
      const attribs = [];
      T.forEach((g, i) => {
        attribs.push({ buffer: util.buffer(gl.ARRAY_BUFFER, g.pos), loc: i * 2, size: 3 });
        attribs.push({ buffer: util.buffer(gl.ARRAY_BUFFER, g.nrm), loc: i * 2 + 1, size: 3 });
      });
      const vao = util.vao(attribs, util.buffer(gl.ELEMENT_ARRAY_BUFFER, T[0].idx));
      ctx.overlay.innerHTML = `<div class="ov-progress"><div class="track"><div class="fill"></div></div><div class="stops">${STOPS.map((n) => `<span>${n}</span>`).join('')}</div></div>`;
      return {
        prog: util.program(VS, FS), vao, count: T[0].count, type: T[0].idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        target: 0, shown: 0, vel: 0, spin: 0, spinV: 0.2, idle: 0,
        fill: ctx.overlay.querySelector('.fill'), stops: [...ctx.overlay.querySelectorAll('.stops span')],
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      let scrolled = input.wheel * 0.0015;
      if (input.dragging) { scrolled += input.dragDY * 0.006; s.spinV = input.dragDX * 0.01 / Math.max(dt, 1 / 120) * 0.016; }
      if (input.pressed.has('ArrowDown') || input.pressed.has('ArrowRight')) s.target = Math.floor(s.target + 1e-3) + 1;
      if (input.pressed.has('ArrowUp') || input.pressed.has('ArrowLeft')) s.target = Math.ceil(s.target - 1e-3) - 1;
      s.target = clamp(s.target + scrolled, 0, 3);
      if (scrolled !== 0) s.idle = 0; else s.idle += dt;
      if (params.snap && s.idle > 0.25 && !input.down) s.target += (Math.round(s.target) - s.target) * damp(8, dt);
      // idle demo: drift slowly through the timeline after a while
      if (s.idle > 6 && !input.hover) s.target = 1.5 + 1.5 * Math.sin((t - 6) * 0.25);
      const prev = s.shown;
      s.shown += (s.target - s.shown) * damp(params.smooth, dt);
      const v = (s.shown - prev) / Math.max(dt, 1e-3);
      s.vel += (v - s.vel) * damp(10, dt);
      s.spinV *= Math.pow(0.96, dt * 60);
      s.spin += (0.25 + s.spinV) * dt;

      s.fill.style.width = (s.shown / 3) * 100 + '%';
      s.stops.forEach((el, i) => el.classList.toggle('on', Math.abs(s.shown - i) < 0.5));

      const eye = [0, 0.6, 4.6];
      const vp = M4.mul(M4.persp(0.8, ctx.aspect, 0.1, 50), M4.lookAt(eye, [0, 0, 0]));
      const model = M4.mul(M4.rotY(s.spin), M4.rotX(0.45));
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_model: model, u_morph: s.shown, u_twist: clamp(s.vel * params.twist, -4, 4), u_time: t, u_eye: eye });
      gl.bindVertexArray(s.vao);
      gl.drawElements(gl.TRIANGLES, s.count, s.type, 0);
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
