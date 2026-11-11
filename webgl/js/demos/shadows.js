/* Shadow Studio — real-time shadow mapping. A depth-only pass renders into a
 * DEPTH_COMPONENT24 texture; the main pass samples it through a comparison
 * sampler object (hardware PCF via sampler2DShadow). A second sampler object
 * reads the very same texture raw for the depth-map inset. */
(function () {
  const S = window.Sandbox;
  const { V3, M4, damp } = S.math;
  const MAXP = 64;
  const SIZES = [512, 1024, 2048, 4096];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 3) in vec4 a_inst;   // pillars: x, z, height, phase
uniform mat4 u_vp; uniform mat4 u_model; uniform mat4 u_light; uniform bool u_inst; uniform float u_time;
out vec3 v_w; out vec3 v_n; out vec4 v_ls; out float v_h;
void main() {
  vec4 w; vec3 n;
  if (u_inst) {
    float h = a_inst.z * (0.8 + 0.2 * sin(u_time * 1.4 + a_inst.w));
    float ang = u_time * 0.35 + a_inst.w, c = cos(ang), s = sin(ang);
    vec3 p = a_pos * vec3(0.55, h, 0.55);
    p = vec3(c * p.x - s * p.z, p.y + h * 0.5, s * p.x + c * p.z);
    n = vec3(c * a_nrm.x - s * a_nrm.z, a_nrm.y, s * a_nrm.x + c * a_nrm.z);
    w = vec4(p + vec3(a_inst.x, 0.0, a_inst.y), 1.0);
    v_h = clamp(a_inst.z / 3.0, 0.0, 1.0);
  } else {
    w = u_model * vec4(a_pos, 1.0); n = mat3(u_model) * a_nrm; v_h = -1.0;
  }
  v_w = w.xyz; v_n = n; v_ls = u_light * w;
  gl_Position = u_vp * w;
}`;
  const DEPTH_FS = `void main() {}`;
  const FS = S.GLSL.colors + `
in vec3 v_w; in vec3 v_n; in vec4 v_ls; in float v_h; out vec4 o;
uniform sampler2DShadow u_shadow; uniform vec3 u_ldir; uniform vec3 u_eye; uniform float u_soft; uniform float u_bias;
uniform vec2 u_texel; uniform int u_kind; uniform float u_time;
float shadowAt(vec3 n) {
  vec3 p = v_ls.xyz / v_ls.w * 0.5 + 0.5;
  if (p.z > 1.0 || any(lessThan(p.xy, vec2(0.0))) || any(greaterThan(p.xy, vec2(1.0)))) return 1.0;
  float b = u_bias * (1.0 + 4.0 * (1.0 - max(dot(n, u_ldir), 0.0)));
  float sum = 0.0;
  for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++)
    sum += texture(u_shadow, vec3(p.xy + vec2(x, y) * u_texel * u_soft, p.z - b));  // hardware depth compare + bilinear PCF
  return sum / 25.0;
}
void main() {
  vec3 n = normalize(v_n);
  if (u_kind == 3) { o = vec4(vec3(1.0, 0.92, 0.85) * 1.6, 1.0); return; } // the sun
  float sh = shadowAt(n);
  vec3 V = normalize(u_eye - v_w), H = normalize(u_ldir + V);
  float dif = max(dot(n, u_ldir), 0.0);
  float sp = pow(max(dot(n, H), 0.0), 56.0);
  vec3 alb;
  if (u_kind == 1) {
    vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    alb = vec3(0.16, 0.16, 0.17) + line * 0.05;
  } else if (u_kind == 2) alb = mix(BLUE, vec3(0.8), 0.25);
  else alb = mix(vec3(0.62, 0.6, 0.58), RED, v_h * 0.85);
  vec3 sun = vec3(1.0, 0.94, 0.88) * 1.25;
  vec3 amb = mix(vec3(0.03, 0.035, 0.06), vec3(0.06, 0.07, 0.11), n.y * 0.5 + 0.5);
  vec3 c = alb * (amb + sun * dif * sh) + sp * sh * 0.4;
  float fog = 1.0 - exp(-length(v_w - u_eye) * 0.02);
  o = vec4(mix(c, vec3(0.03, 0.032, 0.045), fog), 1.0);
}`;
  const INSET = `
in vec2 v_uv; out vec4 o; uniform sampler2D u_depth;
void main() {
  float d = texture(u_depth, v_uv).r;     // raw depth through the non-comparison sampler
  float v = pow(1.0 - d, 0.6);
  o = vec4(mix(vec3(0.03), vec3(1.0, 0.23, 0.31), v) + v * 0.2, 1.0);
}`;

  function shadowTarget(ctx, s) {
    const { gl, util } = ctx;
    if (s.depthTex) util.release(s.depthTex, s.depthFb);
    s.size = SIZES[ctx.params.res];
    s.depthTex = util.texture({ width: s.size, height: s.size, internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, filter: gl.NEAREST });
    s.depthFb = util.framebuffer([], { tex: s.depthTex });
  }

  S.register({
    id: 'shadows',
    title: 'Shadow Studio',
    category: 'Rendering',
    hint: 'move to steer the sun · click the floor to raise a pillar',
    description: 'Real-time shadow mapping. The scene is rendered from the sun into a depth texture, and each pixel then asks whether it is farther from the light than what the light saw. Comparison and bilinear filtering run in hardware through a sampler2DShadow whose behaviour lives in a sampler object. A second sampler object reads the same texture raw for the depth-map inset.',
    interact: [['Move', 'The sun follows the pointer (azimuth and elevation)'], ['Click the floor', 'Raise a new pillar there'], ['Drag', 'Orbit the camera'], ['Wheel / pinch', 'Zoom']],
    features: ['Depth textures (DEPTH_COMPONENT24)', 'sampler2DShadow + TEXTURE_COMPARE_MODE', 'Sampler objects (bindSampler)', 'Depth-only framebuffer', 'Orthographic light projection'],
    params: [
      { key: 'res', label: 'Shadow map', type: 'select', options: ['512', '1K', '2K', '4K'], value: 2, restart: true },
      { key: 'soft', label: 'Softness (PCF radius)', type: 'range', min: 0, max: 4, step: 0.05, value: 1.2 },
      { key: 'bias', label: 'Depth bias', type: 'range', min: 0, max: 0.004, step: 0.0001, value: 0.0006 },
      { key: 'inset', label: 'Show depth map', type: 'toggle', value: true },
      { key: 'reset', label: 'Reset pillars', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const inst = new Float32Array(MAXP * 4);
      const instBuf = util.buffer(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
      const s = {
        prog: util.program(VS, FS), depthP: util.program(VS, DEPTH_FS), insetP: util.program(S.GLSL.fullscreenVS, INSET),
        cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: instBuf, loc: 3, size: 4, divisor: 1 }]),
        torus: S.geo.upload(util, S.geo.torusKnot(260, 32, 0.22, 0.9, 0.4)), sun: S.geo.upload(util, S.geo.sphere(24, 12, 0.35)),
        inst, instBuf, pillars: [],
        cmp: util.sampler({ TEXTURE_MIN_FILTER: gl.LINEAR, TEXTURE_MAG_FILTER: gl.LINEAR, TEXTURE_WRAP_S: gl.CLAMP_TO_EDGE, TEXTURE_WRAP_T: gl.CLAMP_TO_EDGE, TEXTURE_COMPARE_MODE: gl.COMPARE_REF_TO_TEXTURE, TEXTURE_COMPARE_FUNC: gl.LEQUAL }),
        raw: util.sampler({ TEXTURE_MIN_FILTER: gl.NEAREST, TEXTURE_MAG_FILTER: gl.NEAREST, TEXTURE_COMPARE_MODE: gl.NONE }),
        az: 0.8, el: 0.7, cam: new S.OrbitCam({ dist: 17, pitch: 0.55, minDist: 7, maxDist: 32, auto: 0.04, minPitch: 0.08 }),
      };
      resetPillars(s);
      shadowTarget(ctx, s);
      return s;
    },
    action(ctx, s, key) { if (key === 'reset') resetPillars(s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      // sun direction from pointer (or a slow arc when idle)
      let az, el;
      if ((input.hover || input.down) && !input.dragging) { az = input.nx * Math.PI; el = 0.12 + input.uvy * 1.3; }
      else if (input.dragging) { az = s.az; el = s.el; }
      else { az = t * 0.25; el = 0.55 + 0.3 * Math.sin(t * 0.4); }
      s.az += (az - s.az) * damp(5, dt); s.el += (el - s.el) * damp(5, dt);
      const ldir = [Math.cos(s.el) * Math.cos(s.az), Math.sin(s.el), Math.cos(s.el) * Math.sin(s.az)];
      // click on floor → new pillar
      for (const c of input.clicks) {
        const r = s.cam.ray(c.uvx * 2 - 1, c.uvy * 2 - 1, ctx.aspect);
        if (r.dir[1] < -0.01) {
          const k = -r.origin[1] / r.dir[1], x = r.origin[0] + r.dir[0] * k, z = r.origin[2] + r.dir[2] * k;
          if (Math.hypot(x, z) < 12) { if (s.pillars.length >= MAXP) s.pillars.shift(); s.pillars.push([x, z, 0.01, Math.random() * 6, 1 + Math.random() * 2.2]); }
        }
      }
      s.pillars.forEach((p, i) => { p[2] += (p[4] - p[2]) * damp(4, dt); s.inst.set(p.slice(0, 4), i * 4); });
      gl.bindBuffer(gl.ARRAY_BUFFER, s.instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.inst);

      const lpos = V3.scale(ldir, 25);
      const up = Math.abs(ldir[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
      const light = M4.mul(M4.ortho(-14, 14, -14, 14, 1, 55), M4.lookAt(lpos, [0, 0, 0], up));
      const knot = M4.mul(M4.translate(0, 2.4 + Math.sin(t) * 0.35, 0), M4.mul(M4.rotY(t * 0.6), M4.rotX(t * 0.4)));
      const ground = M4.mul(M4.translate(0, -0.25, 0), M4.scale(60, 0.5, 60));
      const draw = (prog, withGround) => {
        prog.set({ u_inst: true, u_time: t, u_kind: 0 });
        gl.bindVertexArray(s.cubeVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, s.pillars.length);
        prog.set({ u_inst: false, u_model: knot, u_kind: 2 }); s.torus.draw();
        if (withGround) { prog.set({ u_model: ground, u_kind: 1 }); gl.vertexAttrib4f(3, 0, 0, 0, 0); gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36); }
      };

      // 1. depth pass from the light
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.depthFb);
      gl.viewport(0, 0, s.size, s.size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2.0);
      s.depthP.use().set({ u_vp: light, u_light: light });
      draw(s.depthP, false);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      // 2. main pass: shadow texture on unit 0 through the comparison sampler
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.03, 0.032, 0.045, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.depthTex); gl.bindSampler(0, s.cmp);
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 120), s.cam.view());
      s.prog.use().set({ u_vp: vp, u_light: light, u_shadow: 0, u_ldir: ldir, u_eye: s.cam.eye(), u_soft: params.soft, u_bias: params.bias, u_texel: [1 / s.size, 1 / s.size] });
      draw(s.prog, true);
      s.prog.set({ u_inst: false, u_kind: 3, u_model: M4.mul(M4.translate(...V3.scale(ldir, 14)), M4.scale(1.4)) }); s.sun.draw();
      gl.disable(gl.DEPTH_TEST);

      // 3. inset: same texture on unit 1 through the raw sampler
      if (params.inset) {
        const w = Math.round(Math.min(ctx.width, ctx.height) * 0.26), m = Math.round(28 * ctx.dpr);
        gl.viewport(ctx.width - w - m, m + Math.round(44 * ctx.dpr), w, w);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.depthTex); gl.bindSampler(1, s.raw);
        s.insetP.use().set({ u_depth: 1 });
        ctx.util.drawFullscreen();
        gl.bindSampler(1, null); gl.activeTexture(gl.TEXTURE0);
      }
      gl.bindSampler(0, null);
    },
  });

  function resetPillars(s) {
    s.pillars.length = 0;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = i % 2 ? 6 : 4.2;
      s.pillars.push([Math.cos(a) * r, Math.sin(a) * r, 0.01, i * 0.9, 1 + ((i * 7) % 5) * 0.45]);
    }
  }
})();
