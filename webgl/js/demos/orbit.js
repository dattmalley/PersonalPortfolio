/* Orbit Camera — inertial orbit / zoom / pan around a lit torus knot.
 * Camera matrices live in a Uniform Buffer Object shared by two programs. */
(function () {
  const S = window.Sandbox;
  const { V3 } = S.math;

  const BLOCK = `
layout(std140) uniform Camera {
  mat4 u_view;
  mat4 u_proj;
  vec4 u_eye;     // xyz eye, w time
  vec4 u_light;   // x intensity
};`;

  const KNOT_VS = BLOCK + `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec2 a_uv;
out vec3 v_n; out vec3 v_w; out vec2 v_uv;
void main() {
  float t = u_eye.w;
  vec3 p = a_pos + a_nrm * 0.03 * sin(a_uv.x * 60.0 - t * 3.0);
  v_n = a_nrm; v_w = p; v_uv = a_uv;
  gl_Position = u_proj * u_view * vec4(p, 1.0);
}`;
  const KNOT_FS = BLOCK + S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in vec2 v_uv; out vec4 o;
void main() {
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(u_eye.xyz - v_w);
  vec3 L1 = normalize(vec3(-3.0, 2.0, 1.5)), L2 = normalize(vec3(3.0, 1.0, -1.5));
  float d1 = max(dot(n, L1), 0.0), d2 = max(dot(n, L2), 0.0);
  float s1 = pow(max(dot(reflect(-L1, n), V), 0.0), 48.0), s2 = pow(max(dot(reflect(-L2, n), V), 0.0), 48.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  float band = smoothstep(0.45, 0.5, abs(fract(v_uv.x * 24.0 - u_eye.w * 0.4) - 0.5));
  vec3 base = vec3(0.07, 0.08, 0.11);
  vec3 c = base * 0.6 + (RED * d1 + BLUE * d2) * 0.55 * u_light.x;
  c += (s1 * RED + s2 * BLUE + (s1 + s2) * 0.4) * u_light.x;
  c += fres * mix(BLUE, RED, 0.5 + 0.5 * n.y) * 0.9;
  c += band * 0.06;
  o = vec4(c, 1.0);
}`;

  const FLOOR_VS = BLOCK + `
out vec3 v_w;
void main() {
  vec2 q = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; // big triangle
  vec3 p = vec3(q.x * 80.0, -1.9, q.y * 80.0);
  v_w = p;
  gl_Position = u_proj * u_view * vec4(p, 1.0);
}`;
  const FLOOR_FS = BLOCK + S.GLSL.colors + `
in vec3 v_w; out vec4 o;
void main() {
  vec2 g = v_w.xz;
  vec2 a = abs(fract(g - 0.5) - 0.5) / fwidth(g);
  float line = 1.0 - min(min(a.x, a.y), 1.0);
  vec2 a2 = abs(fract(g / 5.0 - 0.5) - 0.5) / fwidth(g / 5.0);
  float major = 1.0 - min(min(a2.x, a2.y), 1.0);
  float dist = length(v_w.xz);
  float fade = exp(-dist * 0.08);
  vec3 c = INK + (line * 0.12 + major * 0.35) * mix(BLUE, RED, smoothstep(-8.0, 8.0, v_w.x)) * fade;
  c += exp(-dist * 0.5) * vec3(0.05, 0.04, 0.08);
  o = vec4(c, 1.0);
}`;

  function knot(u, v) {
    const P = 2, Q = 3, R = 1.25, r = 0.55, tube = 0.28;
    const C = (t) => {
      const ph = Q * t;
      return [(R + r * Math.cos(ph)) * Math.cos(P * t), r * Math.sin(ph), (R + r * Math.cos(ph)) * Math.sin(P * t)];
    };
    const t = u * Math.PI * 2, e = 1e-3;
    const c = C(t), cp = C(t + e), cm = C(t - e);
    const T = V3.norm(V3.sub(cp, cm));
    const N = V3.norm(V3.sub(V3.add(cp, cm), V3.scale(c, 2)));
    const B = V3.cross(T, N);
    const a = v * Math.PI * 2;
    const n = V3.add(V3.scale(N, Math.cos(a)), V3.scale(B, Math.sin(a)));
    return { p: V3.add(c, V3.scale(n, tube)), n };
  }

  S.register({
    id: 'orbit',
    title: 'Orbit Camera',
    category: 'Camera & Navigation',
    hint: 'drag · wheel / pinch · shift- or right-drag to pan',
    description: 'A classic inspection camera with momentum: drag to orbit and release to coast, zoom with the wheel or a pinch, and pan with shift-drag or right-drag. Both the knot and the floor read the camera from a single Uniform Buffer Object, so the matrices are uploaded once per frame and shared by every program.',
    interact: [['Drag', 'Orbit; release to coast on inertia'], ['Wheel / pinch', 'Dolly zoom'], ['Shift-drag / right-drag', 'Pan the target'], ['Reset view', 'Return to the home pose']],
    features: ['Uniform Buffer Objects (std140)', 'Vertex Array Objects', 'layout(location) qualifiers', 'gl_FrontFacing', 'Depth testing'],
    params: [
      { key: 'damping', label: 'Inertia', type: 'range', min: 0.5, max: 0.98, step: 0.01, value: 0.9 },
      { key: 'auto', label: 'Auto-rotate', type: 'range', min: -1, max: 1, step: 0.05, value: 0.15 },
      { key: 'light', label: 'Light intensity', type: 'range', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'reset', label: 'Reset view', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const g = S.geo.surface(400, 48, knot);
      const knotP = util.program(KNOT_VS, KNOT_FS).bindBlock('Camera', 0);
      const floorP = util.program(FLOOR_VS, FLOOR_FS).bindBlock('Camera', 0);
      const vao = util.vao([
        { buffer: util.buffer(gl.ARRAY_BUFFER, g.pos), loc: 0, size: 3 },
        { buffer: util.buffer(gl.ARRAY_BUFFER, g.nrm), loc: 1, size: 3 },
        { buffer: util.buffer(gl.ARRAY_BUFFER, g.uv), loc: 2, size: 2 },
      ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, g.idx));
      const ubo = util.buffer(gl.UNIFORM_BUFFER, 160, gl.DYNAMIC_DRAW);
      const cam = new S.OrbitCam({ dist: 6.5, pitch: 0.4, minDist: 2.5, maxDist: 20 });
      return { knotP, floorP, vao, ubo, g, cam, block: new Float32Array(40) };
    },
    action(ctx, s, key) { if (key === 'reset') s.cam.reset(); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.damping = params.damping;
      s.cam.auto = params.auto;
      s.cam.update(input, dt);
      const eye = s.cam.eye();
      s.block.set(s.cam.view(), 0);
      s.block.set(s.cam.proj(ctx.aspect), 16);
      s.block.set([eye[0], eye[1], eye[2], t], 32);
      s.block.set([params.light, 0, 0, 0], 36);
      gl.bindBuffer(gl.UNIFORM_BUFFER, s.ubo);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, s.block);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, s.ubo);

      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.floorP.use();
      ctx.util.drawFullscreen();
      s.knotP.use();
      gl.bindVertexArray(s.vao);
      gl.drawElements(gl.TRIANGLES, s.g.count, s.g.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
