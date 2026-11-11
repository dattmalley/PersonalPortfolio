/* Sculpt — push, pull, smooth and pinch a clay sphere. Displacement lives in an
 * equirectangular R16F texture edited by fullscreen brush passes (ping-pong);
 * the vertex shader displaces and re-derives normals from it (vertex texture
 * fetch). The brush point comes from a non-blocking position readback. */
(function () {
  const S = window.Sandbox;
  const { M4 } = S.math;
  const DW = 1024, DH = 512, R = 1.6;

  const SPH = `
const float PI = 3.14159265;
vec3 dirOf(vec2 uv) { float a = uv.x * 2.0 * PI, b = uv.y * PI; return vec3(sin(b) * cos(a), cos(b), sin(b) * sin(a)); }`;
  const MESH_VS = SPH + `
layout(location = 2) in vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_model; uniform sampler2D u_disp; uniform float u_r;
out vec3 v_w; out vec3 v_n; out vec3 v_obj; out float v_d;
vec3 P(vec2 uv) { return dirOf(uv) * (u_r + texture(u_disp, uv).r); }
void main() {
  vec2 uv = a_uv;
  vec3 p = P(uv);
  vec2 e = vec2(1.0 / ${DW}.0, 1.0 / ${DH}.0) * 1.5;
  vec3 du = P(uv + vec2(e.x, 0.0)) - P(uv - vec2(e.x, 0.0));
  vec3 dv = P(uv + vec2(0.0, e.y)) - P(uv - vec2(0.0, e.y));
  vec3 n = normalize(cross(dv, du));
  if (dot(n, p) < 0.0) n = -n;
  if (length(du) < 1e-5) n = normalize(p);      // poles
  vec4 w = u_model * vec4(p, 1.0);
  v_w = w.xyz; v_n = mat3(u_model) * n; v_obj = p; v_d = texture(u_disp, uv).r;
  gl_Position = u_vp * w;
}`;
  const MESH_FS = S.GLSL.colors + `
in vec3 v_w; in vec3 v_n; in vec3 v_obj; in float v_d; out vec4 o;
uniform vec3 u_eye; uniform vec4 u_cursor; uniform bool u_pos; uniform bool u_mirror;
void main() {
  if (u_pos) { o = vec4(v_obj, 1.0); return; }
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w);
  // clay "matcap": warm key, cool rim, cavity tint by displacement
  float key = max(dot(n, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 2.2);
  vec3 clay = vec3(0.56, 0.52, 0.5);
  clay = mix(clay, RED * 0.9, smoothstep(0.02, 0.35, v_d) * 0.7);
  clay = mix(clay, BLUE * 0.7, smoothstep(-0.02, -0.3, v_d) * 0.7);
  vec3 c = clay * (0.18 + 0.82 * key) + rim * BLUE * 0.35 + pow(max(dot(reflect(-normalize(vec3(-0.4, 0.7, 0.6)), n), V), 0.0), 30.0) * 0.18;
  if (u_cursor.w > 0.0) {
    float d = length(normalize(v_obj) - u_cursor.xyz);
    if (u_mirror) d = min(d, length(normalize(v_obj) * vec3(-1, 1, 1) - u_cursor.xyz));
    c += smoothstep(0.008, 0.0, abs(d - u_cursor.w)) * 0.6;
  }
  o = vec4(c, 1.0);
}`;
  const BRUSH = SPH + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src; uniform vec3 u_dir; uniform float u_rad; uniform float u_str; uniform int u_mode; uniform bool u_mirror;
float fall(vec3 d) {
  float x = length(d - u_dir);
  if (u_mirror) x = min(x, length(d * vec3(-1, 1, 1) - u_dir));
  float t = clamp(1.0 - x / u_rad, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
void main() {
  float h = texture(u_src, v_uv).r;
  vec3 d = dirOf(v_uv);
  float f = fall(d);
  if (f > 0.0) {
    if (u_mode == 0) h += u_str * f;                     // raise
    else if (u_mode == 1) h -= u_str * f;                // dig
    else {
      vec2 e = vec2(4.0 / ${DW}.0, 4.0 / ${DH}.0);
      float avg = (texture(u_src, v_uv + vec2(e.x, 0)).r + texture(u_src, v_uv - vec2(e.x, 0)).r + texture(u_src, v_uv + vec2(0, e.y)).r + texture(u_src, v_uv - vec2(0, e.y)).r) * 0.25;
      if (u_mode == 2) h = mix(h, avg, clamp(f * u_str * 20.0, 0.0, 1.0));   // smooth
      else h += (h - avg) * f * u_str * 12.0;                                   // pinch / sharpen ridges
    }
  }
  o = vec4(clamp(h, -0.9, 1.4), 0.0, 0.0, 1.0);
}`;

  S.register({
    id: 'sculpt',
    title: 'Sculpt',
    category: 'Pointer & Touch',
    thumb: 'portrait',
    hint: 'press on the clay to sculpt · drag empty space to orbit',
    description: 'Digital clay sculpting. The surface height lives in a 1024×512 half-float texture, and each brush stroke is a fullscreen GPU pass that raises, digs, smooths or pinches it with a soft falloff. The vertex shader rebuilds the shape and its normals every frame from that texture. The point under your brush comes from a non-blocking readback, so the GPU never waits.',
    interact: [['Press on the clay', 'Sculpt with the current brush'], ['Shift + press', 'Invert (raise ↔ dig)'], ['Press off the clay', 'Orbit'], ['Wheel / pinch', 'Zoom'], ['Mirror', 'Symmetric sculpting']],
    features: ['R16F displacement texture', 'Vertex texture fetch', 'Normals from texture derivatives', 'Ping-pong brush passes', 'Async readback (PBO + fence)'],
    params: [
      { key: 'mode', label: 'Brush', type: 'select', options: ['Raise', 'Dig', 'Smooth', 'Pinch'], value: 0 },
      { key: 'radius', label: 'Radius', type: 'range', min: 0.05, max: 0.6, step: 0.005, value: 0.22 },
      { key: 'strength', label: 'Strength', type: 'range', min: 0.001, max: 0.03, step: 0.001, value: 0.008 },
      { key: 'mirror', label: 'Mirror symmetry', type: 'toggle', value: true },
      { key: 'reset', label: 'New clay', type: 'button' },
    ],
    init(ctx) {
      if (!ctx.caps.floatRT) throw new Error('This device lacks EXT_color_buffer_float, needed for the R16F displacement texture.');
      const { gl, util } = ctx;
      const disp = [0, 1].map(() => util.texture({ width: DW, height: DH, internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }));
      disp.forEach((t) => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); });
      const s = {
        mesh: S.geo.upload(util, S.geo.surface(256, 128, (u, v) => ({ p: [u, v, 0], n: [0, 0, 1] }))),
        meshP: util.program(MESH_VS, MESH_FS), brushP: util.program(S.GLSL.fullscreenVS, BRUSH),
        disp, dispFb: disp.map((t) => util.framebuffer([t])), src: 0, pick: new S.AsyncPick(ctx),
        cam: new S.OrbitCam({ dist: 5.6, pitch: 0.2, minDist: 3, maxDist: 12, auto: 0 }), mode: null, angle: 0, hit: null, seeded: 0,
      };
      clear(ctx, s);
      posTarget(ctx, s);
      return s;
    },
    resize(ctx, s) { posTarget(ctx, s); },
    action(ctx, s, key) { if (key === 'reset') { clear(ctx, s); s.seeded = 0; } },
    dispose(ctx, s) { s.pick.dispose(); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const res = s.pick.poll();
      if (res && s.pick.age === 0) {
        s.hit = res[3] > 0.5 ? normalize3(res) : null;
        if (input.down && s.mode === null) s.mode = s.hit ? 'sculpt' : 'orbit';
      }
      if (!input.down) s.mode = null;
      if (!input.hover && !input.down) s.hit = null;
      const camIn = s.mode === 'sculpt' || (input.down && s.mode === null) ? Object.assign({}, input, { dragging: false }) : input;
      s.cam.update(camIn, dt);
      if (s.mode !== 'sculpt' && !input.hover) s.angle += dt * 0.2;
      const model = M4.rotY(s.angle);
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 40), s.cam.view());

      const brush = (dir, mode, strength) => {
        const dst = 1 - s.src;
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.dispFb[dst]);
        gl.viewport(0, 0, DW, DH);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.disp[s.src]);
        s.brushP.use().set({ u_src: 0, u_dir: dir, u_rad: params.radius, u_str: strength, u_mode: mode, u_mirror: params.mirror });
        ctx.util.drawFullscreen();
        s.src = dst;
      };
      if (s.seeded < 70) { // a few procedural strokes so the clay reads as sculpted immediately
        const k = s.seeded++, a = k * 0.18, b = 1.2 + Math.sin(k * 0.21) * 0.5;
        brush([Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)], k % 3 === 2 ? 1 : 0, 0.012);
      }
      if (s.mode === 'sculpt' && s.hit && s.pick.age <= 2) {
        let m = params.mode;
        if (input.shift && m < 2) m = 1 - m;
        brush(s.hit, m, params.strength * (m >= 2 ? 1 : 1.0));
      }
      // position pass for picking (object space)
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.posFb);
      gl.viewport(0, 0, s.pw, s.ph);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.disp[s.src]);
      s.meshP.use().set({ u_vp: vp, u_model: model, u_disp: 0, u_r: R, u_pos: true, u_eye: s.cam.eye(), u_cursor: [0, 0, 0, 0], u_mirror: params.mirror });
      s.mesh.draw();
      if (input.hover || input.down) s.pick.request(Math.floor(input.uvx * s.pw), Math.floor(input.uvy * s.ph));
      // main
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.03, 0.032, 0.042, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      s.meshP.set({ u_pos: false, u_cursor: s.hit ? [...s.hit, params.radius] : [0, 0, 0, 0] });
      s.mesh.draw();
      gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = s.hit ? 'none' : 'crosshair';
    },
  });

  function normalize3(r) { const l = Math.hypot(r[0], r[1], r[2]) || 1; return [r[0] / l, r[1] / l, r[2] / l]; }
  function clear(ctx, s) { const { gl } = ctx; for (const fb of s.dispFb) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); } gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  function posTarget(ctx, s) {
    const { gl, util } = ctx;
    if (s.posFb) util.release(s.posFb, s.posTex, s.posDepth);
    s.pw = Math.max(1, Math.round(ctx.width / 2)); s.ph = Math.max(1, Math.round(ctx.height / 2));
    s.posTex = util.texture({ width: s.pw, height: s.ph, internal: gl.RGBA16F, type: gl.HALF_FLOAT, filter: gl.NEAREST });
    s.posDepth = util.renderbuffer(gl.DEPTH_COMPONENT24, s.pw, s.ph);
    s.posFb = util.framebuffer([s.posTex], s.posDepth);
  }
})();
