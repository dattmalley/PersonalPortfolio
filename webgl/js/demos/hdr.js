/* HDR & Eye Adaptation — the scene renders into a packed R11F_G11F_B10F float
 * target with light values far above 1.0. Average (or spot) luminance comes
 * from the mip chain, and exposure adapts over time in a 1×1 float texture
 * that ping-pongs entirely on the GPU. Floor albedo is an sRGB texture. */
(function () {
  const S = window.Sandbox;
  const { M4 } = S.math;
  const TONEMAPS = ['Clamp', 'Reinhard', 'ACES', 'Filmic'];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_w; out vec3 v_n;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_model) * a_nrm; gl_Position = u_vp * w; }`;
  const FS = `
in vec3 v_w; in vec3 v_n; out vec4 o;
uniform int u_kind; uniform vec3 u_emit; uniform sampler2D u_floor; uniform vec3 u_lp[4]; uniform vec3 u_lc[4]; uniform vec3 u_eye;
void main() {
  if (u_kind == 1) { o = vec4(u_emit, 1.0); return; }          // emissive: values up to ~60
  vec3 n = normalize(v_n);
  vec3 alb = u_kind == 0 ? texture(u_floor, v_w.xz * 0.25).rgb : vec3(0.7);  // sRGB texture → linear on sample
  vec3 V = normalize(u_eye - v_w);
  vec3 c = alb * 0.004;
  for (int i = 0; i < 4; i++) {
    vec3 d = u_lp[i] - v_w; float r2 = dot(d, d); vec3 L = d * inversesqrt(r2);
    float dif = max(dot(n, L), 0.0);
    float sp = pow(max(dot(n, normalize(L + V)), 0.0), 64.0);
    c += (alb * dif + sp * 0.4) * u_lc[i] / (1.0 + r2);
  }
  o = vec4(c, 1.0);
}`;
  const ADAPT = `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_hdr; uniform sampler2D u_prev; uniform float u_top; uniform float u_dt; uniform float u_speed;
uniform bool u_spot; uniform vec2 u_spotUV; uniform float u_flash;
void main() {
  vec3 avg = u_spot ? textureLod(u_hdr, u_spotUV, max(u_top - 4.0, 0.0)).rgb : textureLod(u_hdr, vec2(0.5), u_top).rgb;
  float lum = max(dot(avg, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  float target = 0.18 / lum;                                  // middle-grey key
  float prev = texture(u_prev, vec2(0.5)).r;
  if (prev <= 0.0 || u_flash > 0.5) prev = prev <= 0.0 ? target : prev;
  float e = prev + (target - prev) * (1.0 - exp(-u_dt * u_speed));
  o = vec4(clamp(e, 0.001, 200.0), lum, 0.0, 1.0);
}`;
  const COMPOSE = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_hdr; uniform sampler2D u_exp; uniform float u_ev; uniform int u_tm; uniform float u_bloom;
uniform bool u_compare; uniform float u_split; uniform vec2 u_res;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 hable(vec3 x) { const float A = 0.15, B = 0.5, C = 0.1, D = 0.2, E = 0.02, F = 0.3; return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F; }
vec3 tonemap(vec3 c, int m) {
  if (m == 0) return clamp(c, 0.0, 1.0);
  if (m == 1) return c / (1.0 + c);
  if (m == 2) return aces(c);
  return hable(c * 2.0) / hable(vec3(11.2));
}
void main() {
  vec3 c = texture(u_hdr, v_uv).rgb;
  vec3 g = textureLod(u_hdr, v_uv, 2.0).rgb * 0.3 + textureLod(u_hdr, v_uv, 4.0).rgb * 0.4 + textureLod(u_hdr, v_uv, 6.0).rgb * 0.5;
  c += g * u_bloom * 0.25;
  float e = texture(u_exp, vec2(0.5)).r * exp2(u_ev);
  int m = (u_compare && v_uv.x < u_split) ? 0 : u_tm;
  vec3 t = tonemap(c * e, m);
  t = pow(t, vec3(1.0 / 2.2));                                  // linear → display
  if (u_compare && abs(v_uv.x - u_split) < 1.0 / u_res.x) t = vec3(0.93, 0.91, 0.87);
  o = vec4(t, 1.0);
}`;

  function floorTexture(ctx) {
    const { gl, util } = ctx;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#6b6a6e'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 96 + ((x * 3 + y * 5) % 7) * 10;
      g.fillStyle = `rgb(${v},${v - 4},${v + 4})`;
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
    const tex = util.rawTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, c);  // decoded to linear by the sampler
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  function targets(ctx, s) {
    const { gl, util } = ctx;
    if (s.hdrTex) util.release(s.hdrTex, s.hdrFb, s.depth);
    const w = ctx.width, h = ctx.height;
    s.levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    s.hdrTex = util.rawTexture();
    gl.bindTexture(gl.TEXTURE_2D, s.hdrTex);
    gl.texStorage2D(gl.TEXTURE_2D, s.levels, gl.R11F_G11F_B10F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    s.depth = util.renderbuffer(gl.DEPTH_COMPONENT24, w, h);
    s.hdrFb = util.framebuffer([s.hdrTex], s.depth);
  }

  S.register({
    id: 'hdr',
    title: 'HDR & Eye Adaptation',
    category: 'Rendering',
    hint: 'click for a flash · watch the exposure adapt',
    description: 'Lighting is computed in high dynamic range: neon rings shine about 60× brighter than white and land in a packed R11F_G11F_B10F float buffer. Mipmapping that buffer to 1×1 gives scene luminance, and a GPU-only feedback loop in a 1×1 float texture eases exposure toward it the way your eyes adjust. Tone-mapping operators then compress it for display.',
    interact: [['Click / tap', 'Flash the lights 10× and watch the eye adapt'], ['Spot metering', 'Expose for whatever is under the pointer'], ['Compare', 'Clamped (left) against the chosen tone map'], ['Drag / wheel', 'Orbit and zoom']],
    features: ['R11F_G11F_B10F render target', 'SRGB8_ALPHA8 textures', 'Mip-chain luminance', 'GPU-only eye adaptation (1×1 ping-pong)', 'ACES / Reinhard / Filmic tone mapping'],
    params: [
      { key: 'tm', label: 'Tone mapping', type: 'select', options: TONEMAPS, value: 2 },
      { key: 'intensity', label: 'Light intensity', type: 'range', min: 1, max: 120, step: 1, value: 40 },
      { key: 'ev', label: 'Exposure bias (EV)', type: 'range', min: -4, max: 4, step: 0.1, value: 0 },
      { key: 'speed', label: 'Adaptation speed', type: 'range', min: 0.2, max: 8, step: 0.1, value: 1.5 },
      { key: 'bloom', label: 'Bloom', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'spot', label: 'Spot metering at pointer', type: 'toggle', value: false },
      { key: 'compare', label: 'Compare with clamp', type: 'toggle', value: false },
      { key: 'flash', label: 'Flash', type: 'button' },
    ],
    init(ctx) {
      if (!ctx.caps.floatRT) throw new Error('This device lacks EXT_color_buffer_float, required to render into R11F_G11F_B10F / RGBA16F targets.');
      const { gl, util } = ctx;
      const ex = [0, 1].map(() => util.texture({ width: 1, height: 1, internal: gl.RGBA16F, type: gl.HALF_FLOAT, filter: gl.NEAREST }));
      const s = {
        scene: util.program(VS, FS), adapt: util.program(S.GLSL.fullscreenVS, ADAPT), compose: util.program(S.GLSL.fullscreenVS, COMPOSE),
        cube: (() => { const c = S.geo.cube(); const b = util.buffer(gl.ARRAY_BUFFER, c.data); return util.vao([{ buffer: b, loc: 0, size: 3, stride: 24 }, { buffer: b, loc: 1, size: 3, stride: 24, offset: 12 }]); })(),
        ring: S.geo.upload(util, S.geo.torus(160, 20, 1, 0.06)), ball: S.geo.upload(util, S.geo.sphere(32, 16, 0.18)),
        floor: floorTexture(ctx), ex, exFb: ex.map((t) => util.framebuffer([t])), exSrc: 0, flash: 0,
        cam: new S.OrbitCam({ dist: 11, pitch: 0.32, minDist: 4, maxDist: 24, target: [0, 1.4, 0], auto: 0.07 }),
      };
      for (const fb of s.exFb) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      targets(ctx, s);
      return s;
    },
    resize(ctx, s) { targets(ctx, s); },
    action(ctx, s, key) { if (key === 'flash') s.flash = 1; },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      if (input.clicks.length) s.flash = 1;
      s.flash = Math.max(0, s.flash - dt * 0.9);
      const boost = 1 + 9 * Math.pow(s.flash, 2);
      const I = params.intensity * boost;
      const lp = [], lc = [];
      for (let i = 0; i < 4; i++) {
        const a = t * 0.5 + (i * Math.PI) / 2, r = 3.2;
        lp.push(Math.cos(a) * r, 0.9 + Math.sin(t * 1.3 + i) * 0.4, Math.sin(a) * r);
        const c = i % 2 ? S.BLUE : S.RED;
        lc.push(c[0] * I * 0.6, c[1] * I * 0.6, c[2] * I * 0.6);
      }
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 80), s.cam.view());

      // 1. HDR scene
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.hdrFb);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.0005, 0.0005, 0.001, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.floor);
      s.scene.use().set({ u_vp: vp, u_floor: 0, u_lp: new Float32Array(lp), u_lc: new Float32Array(lc), u_eye: s.cam.eye() });
      gl.bindVertexArray(s.cube);
      s.scene.set({ u_kind: 0, u_model: M4.mul(M4.translate(0, -0.1, 0), M4.scale(40, 0.2, 40)) }); gl.drawArrays(gl.TRIANGLES, 0, 36);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        s.scene.set({ u_kind: 2, u_model: M4.mul(M4.translate(Math.cos(a) * 5.5, 1.2, Math.sin(a) * 5.5), M4.scale(0.8, 2.4, 0.8)) }); gl.drawArrays(gl.TRIANGLES, 0, 36);
      }
      const e = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
      s.scene.set({ u_kind: 1, u_emit: e(S.RED, I * 1.5), u_model: M4.mul(M4.translate(0, 2.4, 0), M4.mul(M4.rotX(Math.PI / 2 + Math.sin(t * 0.5) * 0.3), M4.scale(2.2))) }); s.ring.draw();
      s.scene.set({ u_emit: e(S.BLUE, I * 1.5), u_model: M4.mul(M4.translate(0, 2.4, 0), M4.mul(M4.rotZ(Math.PI / 2 + Math.cos(t * 0.4) * 0.3), M4.scale(1.6))) }); s.ring.draw();
      for (let i = 0; i < 4; i++) { s.scene.set({ u_emit: [lc[i * 3] * 0.5, lc[i * 3 + 1] * 0.5, lc[i * 3 + 2] * 0.5], u_model: M4.translate(lp[i * 3], lp[i * 3 + 1], lp[i * 3 + 2]) }); s.ball.draw(); }
      gl.disable(gl.DEPTH_TEST);
      // 2. mip chain → luminance at the smallest level
      gl.bindTexture(gl.TEXTURE_2D, s.hdrTex);
      gl.generateMipmap(gl.TEXTURE_2D);
      // 3. adaptation (1×1 ping-pong, never leaves the GPU)
      const dst = 1 - s.exSrc;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.exFb[dst]);
      gl.viewport(0, 0, 1, 1);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.ex[s.exSrc]);
      s.adapt.use().set({ u_hdr: 0, u_prev: 1, u_top: s.levels - 1, u_dt: dt, u_speed: params.speed, u_spot: params.spot, u_spotUV: [input.uvx, input.uvy], u_flash: 0 });
      ctx.util.drawFullscreen();
      s.exSrc = dst;
      // 4. compose
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.bindTexture(gl.TEXTURE_2D, s.ex[s.exSrc]);
      s.compose.use().set({ u_hdr: 0, u_exp: 1, u_ev: params.ev, u_tm: params.tm, u_bloom: params.bloom, u_compare: params.compare, u_split: input.hover ? input.uvx : 0.5, u_res: [ctx.width, ctx.height] });
      ctx.util.drawFullscreen();
      gl.activeTexture(gl.TEXTURE0);
    },
  });
})();
