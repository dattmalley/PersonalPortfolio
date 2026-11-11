/* X-Ray Lens — the stencil buffer masks the screen into two worlds. Lenses
 * (pointer, every touch, and pinned lenses) write 1 into the stencil; the outer
 * casing draws where stencil == 0 and the inner mechanism where stencil == 1. */
(function () {
  const S = window.Sandbox;
  const { M4, damp } = S.math;
  const MAXL = 16;

  const LENS_VS = `
layout(location = 0) in vec3 a_c;   // cx, cy (css px), radius
uniform vec2 u_res; uniform float u_ring;
out vec2 v_local; out float v_r;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float r = a_c.z + u_ring * 12.0;
  vec2 p = a_c.xy + corner * r;
  v_local = corner * r; v_r = a_c.z;
  vec2 c = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
  const LENS_FS = S.GLSL.colors + `
in vec2 v_local; in float v_r; out vec4 o; uniform float u_ring; uniform float u_time;
void main() {
  float d = length(v_local);
  if (u_ring < 0.5) { if (d > v_r) discard; o = vec4(0.0); return; }
  float ring = smoothstep(1.6, 0.0, abs(d - v_r));
  float ang = atan(v_local.y, v_local.x);
  float ticks = step(0.75, fract(ang * 18.0 / 6.2831853 + u_time * 0.05)) * smoothstep(9.0, 0.0, abs(d - v_r - 6.0)) * step(d, v_r + 8.0) * step(v_r + 4.0, d);
  vec3 c = mix(RED, BLUE, 0.5 + 0.5 * sin(ang + u_time));
  float a = max(ring, ticks * 0.8);
  if (a < 0.01) discard;
  o = vec4(c * a, a);
}`;

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm; layout(location = 2) in vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_w; out vec3 v_n; out vec2 v_uv; out vec3 v_o;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_model) * a_nrm; v_uv = a_uv; v_o = a_pos; gl_Position = u_vp * w; }`;
  const FS = S.GLSL.colors + `
in vec3 v_w; in vec3 v_n; in vec2 v_uv; in vec3 v_o; out vec4 o;
uniform int u_mode; uniform vec3 u_eye; uniform vec3 u_tint; uniform float u_time;
void main() {
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(u_eye - v_w), L = normalize(vec3(0.4, 0.8, 0.5));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  if (u_mode == 0) {            // outer casing: panelled ceramic
    vec2 q = v_uv * vec2(24.0, 12.0);
    vec2 g = abs(fract(q) - 0.5) / fwidth(q);
    float seam = 1.0 - min(min(g.x, g.y), 1.0);
    float dif = max(dot(n, L), 0.0);
    float sp = pow(max(dot(reflect(-L, n), V), 0.0), 40.0);
    vec3 alb = mix(vec3(0.16, 0.16, 0.18), u_tint, 0.18);
    vec3 c = alb * (0.15 + 0.85 * dif) + sp * 0.5 - seam * 0.06 + fres * u_tint * 0.4;
    o = vec4(c, 1.0);
  } else if (u_mode == 1) {     // x-ray blueprint
    vec3 q = v_o * 6.0;
    vec3 g = abs(fract(q) - 0.5) / fwidth(q);
    float line = 1.0 - min(min(g.x, min(g.y, g.z)), 1.0);
    vec3 c = u_tint * (0.15 + fres * 1.2) + line * u_tint * 0.6;
    o = vec4(c, 1.0);
  } else if (u_mode == 2) {     // emissive core
    float pulse = 0.6 + 0.4 * sin(u_time * 4.0);
    o = vec4(mix(RED, vec3(1.0, 0.85, 0.8), fres) * (1.2 + pulse), 1.0);
  } else {                      // ghost shell (additive)
    o = vec4(BLUE * fres * 0.5, 1.0);
  }
}`;
  const BG = S.GLSL.colors + `
in vec2 v_uv; out vec4 o; uniform int u_mode; uniform vec2 u_res;
void main() {
  if (u_mode == 0) { o = vec4(mix(vec3(0.035, 0.035, 0.045), vec3(0.06, 0.04, 0.05), v_uv.y), 1.0); return; }
  vec2 p = gl_FragCoord.xy / 24.0;
  vec2 g = abs(fract(p) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  vec2 p2 = gl_FragCoord.xy / 120.0;
  vec2 g2 = abs(fract(p2) - 0.5) / fwidth(p2);
  float major = 1.0 - min(min(g2.x, g2.y), 1.0);
  o = vec4(vec3(0.02, 0.04, 0.09) + BLUE * (line * 0.08 + major * 0.18), 1.0);
}`;

  S.register({
    id: 'stencil',
    title: 'X-Ray Lens',
    category: 'Pointer & Touch',
    hint: 'move the lens · click to pin · wheel to resize',
    description: 'The pointer becomes a lens that sees through the machine casing to the gyroscope inside. Lens discs are drawn into the stencil buffer with colour writes off. The casing then renders only where the stencil is 0 and the blueprint interior only where it is 1, with no render targets and no compositing. Every touch is its own lens.',
    interact: [['Move', 'Look through the casing'], ['Click / tap', 'Pin a lens in place (up to 8)'], ['Wheel / pinch', 'Resize the lens'], ['Multi-touch', 'One lens per finger'], ['Drag', 'Orbit the machine']],
    features: ['Stencil buffer', 'stencilFunc / stencilOp', 'colorMask masking pass', 'Multi-pass compositing', 'Instanced lens quads'],
    params: [
      { key: 'radius', label: 'Lens radius', type: 'range', min: 40, max: 260, step: 1, value: 120 },
      { key: 'spin', label: 'Mechanism speed', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'invert', label: 'Invert (x-ray outside the lens)', type: 'toggle', value: false },
      { key: 'unpin', label: 'Clear pinned lenses', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const lensBuf = util.buffer(gl.ARRAY_BUFFER, MAXL * 12, gl.DYNAMIC_DRAW);
      return {
        lensP: util.program(LENS_VS, LENS_FS), sceneP: util.program(VS, FS), bgP: util.program(S.GLSL.fullscreenVS, BG),
        lensBuf, lensVao: util.vao([{ buffer: lensBuf, loc: 0, size: 3, divisor: 1 }]), lensData: new Float32Array(MAXL * 3),
        shell: S.geo.upload(util, S.geo.sphere(96, 48, 2.2)), sat: S.geo.upload(util, S.geo.sphere(32, 16, 0.32)),
        ring: S.geo.upload(util, S.geo.torus(128, 16, 1, 0.05)), core: S.geo.upload(util, S.geo.sphere(48, 24, 0.5)),
        pins: [], lr: ctx.params.radius,
        cam: new S.OrbitCam({ dist: 7.5, pitch: 0.3, minDist: 4, maxDist: 14, auto: 0.1 }),
      };
    },
    action(ctx, s, key) { if (key === 'unpin') s.pins.length = 0; },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(Object.assign({}, input, { wheel: 0, pinch: 1 }), dt, false); // wheel/pinch resize the lens instead
      if (input.wheel) ctx.syncParam('radius', Math.max(40, Math.min(260, params.radius - input.wheel * 0.15)));
      if (input.pinch !== 1 && input.pointers.size === 2) ctx.syncParam('radius', Math.max(40, Math.min(260, params.radius * input.pinch)));
      s.lr += (params.radius - s.lr) * damp(14, dt);
      for (const c of input.clicks) { if (s.pins.length >= 8) s.pins.shift(); s.pins.push([c.x, c.y]); }
      // lens list
      const lenses = s.pins.map((p) => [p[0], p[1], s.lr * 0.8]);
      if (input.pointers.size) for (const p of input.pointers.values()) lenses.push([p.x, p.y, s.lr]);
      else if (input.hover) lenses.push([input.x, input.y, s.lr]);
      else lenses.push([ctx.cssWidth * (0.5 + 0.28 * Math.sin(t * 0.5)), ctx.cssHeight * (0.5 + 0.2 * Math.sin(t * 0.8)), s.lr]);
      const n = Math.min(lenses.length, MAXL);
      lenses.slice(0, n).forEach((l, i) => s.lensData.set(l, i * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, s.lensBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.lensData);

      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.STENCIL_TEST);
      // 1. lens discs → stencil = 1, no colour, no depth
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.colorMask(false, false, false, false); gl.depthMask(false);
      s.lensP.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_ring: 0, u_time: t });
      gl.bindVertexArray(s.lensVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.colorMask(true, true, true, true); gl.depthMask(true);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      const outside = params.invert ? 1 : 0, inside = params.invert ? 0 : 1;

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 60), s.cam.view());
      const eye = s.cam.eye();
      const sp = t * params.spin;
      // 2. outer world (casing) where stencil == outside
      gl.stencilFunc(gl.EQUAL, outside, 0xff);
      s.bgP.use().set({ u_mode: 0, u_res: [ctx.width, ctx.height] }); ctx.util.drawFullscreen();
      gl.enable(gl.DEPTH_TEST);
      s.sceneP.use().set({ u_vp: vp, u_eye: eye, u_time: t, u_mode: 0, u_tint: S.RED, u_model: M4.rotY(sp * 0.1) });
      s.shell.draw();
      for (let i = 0; i < 6; i++) {
        const a = sp * 0.4 + i * Math.PI / 3, r = 3.2;
        s.sceneP.set({ u_tint: i % 2 ? S.BLUE : S.RED, u_model: M4.translate(Math.cos(a) * r, Math.sin(a * 2 + i) * 0.6, Math.sin(a) * r) });
        s.sat.draw();
      }
      gl.disable(gl.DEPTH_TEST);
      // 3. inner world (mechanism) where stencil == inside
      gl.stencilFunc(gl.EQUAL, inside, 0xff);
      s.bgP.use().set({ u_mode: 1, u_res: [ctx.width, ctx.height] }); ctx.util.drawFullscreen();
      gl.enable(gl.DEPTH_TEST);
      s.sceneP.use().set({ u_vp: vp, u_eye: eye, u_time: t, u_mode: 1, u_tint: S.BLUE });
      const rings = [[1.75, M4.mul(M4.rotY(sp * 0.7), M4.rotX(sp * 0.9))], [1.35, M4.mul(M4.rotZ(sp * 1.1), M4.rotX(Math.PI / 2))], [0.95, M4.mul(M4.rotX(-sp * 1.4), M4.rotZ(sp * 0.6))]];
      rings.forEach(([r, m], i) => { s.sceneP.set({ u_tint: i === 1 ? S.RED : S.BLUE, u_model: M4.mul(m, M4.scale(r)) }); s.ring.draw(); });
      for (let i = 0; i < 6; i++) {
        const a = sp * 0.4 + i * Math.PI / 3, r = 3.2;
        s.sceneP.set({ u_tint: i % 2 ? S.BLUE : S.RED, u_model: M4.translate(Math.cos(a) * r, Math.sin(a * 2 + i) * 0.6, Math.sin(a) * r) });
        s.sat.draw();
      }
      s.sceneP.set({ u_mode: 2, u_model: M4.scale(1 + 0.08 * Math.sin(t * 4)) }); s.core.draw();
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      s.sceneP.set({ u_mode: 3, u_model: M4.rotY(sp * 0.1) }); s.shell.draw();
      gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      // 4. lens rims, no stencil
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.lensP.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_ring: 1, u_time: t });
      gl.bindVertexArray(s.lensVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
    },
  });
})();
