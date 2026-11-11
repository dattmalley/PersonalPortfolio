/* Parallax Depth — layered procedural landscape that shifts with device tilt
 * (DeviceOrientation API) or, on desktop, with the pointer. */
(function () {
  const S = window.Sandbox;
  const { damp, clamp } = S.math;

  const FS = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform vec2 u_res; uniform vec2 u_tilt; uniform float u_time; uniform float u_depth; uniform int u_layers;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float ridge(float x, float seed) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * n1(x + seed * 17.0); x *= 2.03; a *= 0.5; }
  return s;
}
void main() {
  float asp = u_res.x / u_res.y;
  vec2 uv = v_uv;
  // sky
  vec3 c = mix(vec3(0.09, 0.025, 0.05), vec3(0.01, 0.015, 0.04), smoothstep(0.2, 1.0, uv.y));
  vec2 sky = (uv - 0.5 + u_tilt * 0.01 * u_depth) * vec2(asp, 1.0);
  vec2 st = floor(sky * 180.0);
  float star = step(0.996, fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453));
  c += star * (0.5 + 0.5 * sin(u_time * 3.0 + st.x)) * smoothstep(0.35, 0.8, uv.y) * vec3(0.8, 0.85, 1.0);
  // moon
  vec2 mp = vec2(0.72, 0.74) - u_tilt * 0.015 * u_depth;
  float md = length((uv - mp) * vec2(asp, 1.0));
  c += smoothstep(0.085, 0.08, md) * mix(RED, vec3(1.0, 0.7, 0.7), 0.25);
  c += exp(-md * 6.0) * RED * 0.35;
  // layers far → near
  for (int i = 0; i < 8; i++) {
    if (i >= u_layers) break;
    float k = float(i) / float(max(u_layers - 1, 1));       // 0 far .. 1 near
    float z = mix(0.08, 1.0, k * k);                          // parallax factor
    vec2 off = u_tilt * z * 0.08 * u_depth;
    float x = (uv.x - 0.5 + off.x) * asp * mix(1.5, 4.0, k) + float(i) * 13.7 + u_time * 0.01 * z;
    float base = mix(0.62, 0.05, k) + off.y;
    float hgt = base + ridge(x, float(i)) * mix(0.18, 0.42, k);
    float edge = smoothstep(hgt + 0.002, hgt - 0.002, uv.y);
    vec3 layerCol = mix(mix(BLUE * 0.35, vec3(0.05, 0.06, 0.1), 0.5), vec3(0.015, 0.016, 0.025), k);
    float rim = smoothstep(0.012, 0.0, abs(uv.y - hgt)) * (1.0 - k * 0.6);
    vec3 rimCol = mix(BLUE, RED, smoothstep(0.3, 0.9, k));
    // atmospheric haze between layers
    float haze = smoothstep(hgt - 0.25, hgt, uv.y) * (1.0 - k) * 0.35;
    layerCol += haze * mix(RED, BLUE, 0.5) * 0.4;
    c = mix(c, layerCol, edge);
    c += rim * rimCol * 0.8 * edge;
  }
  c *= 1.0 - 0.4 * pow(length(v_uv - 0.5), 2.0);
  o = vec4(c, 1.0);
}`;

  S.register({
    id: 'parallax',
    title: 'Parallax Tilt',
    category: 'Sensors',
    hint: 'move the pointer · tilt your phone',
    description: 'A procedural landscape of up to eight ridge layers, each offset by an amount that grows with its nearness to the viewer. On phones the DeviceOrientation API turns physical tilt into the parallax offset (iOS asks for permission first). On desktop the pointer stands in for tilt. Input is smoothed with critically damped easing.',
    interact: [['Move pointer', 'Shift the depth layers'], ['Tilt device', 'Gyroscope-driven parallax (tap "Enable tilt" on iOS)'], ['Idle', 'Gentle automatic drift']],
    features: ['DeviceOrientation API', 'Single-pass layered compositing', 'Procedural 1D noise', 'Frame-rate independent smoothing'],
    params: [
      { key: 'depth', label: 'Depth strength', type: 'range', min: 0, max: 3, step: 0.05, value: 1.2 },
      { key: 'layers', label: 'Layers', type: 'range', min: 2, max: 8, step: 1, value: 7 },
      { key: 'smooth', label: 'Smoothing', type: 'range', min: 1, max: 20, step: 0.5, value: 5 },
      { key: 'tilt', label: 'Enable tilt', type: 'button' },
    ],
    init(ctx) {
      const s = { prog: ctx.util.program(S.GLSL.fullscreenVS, FS), tilt: [0, 0], gyro: null, onOrient: null };
      s.onOrient = (e) => {
        if (e.gamma == null) return;
        s.gyro = [clamp(e.gamma / 30, -1.5, 1.5), clamp((e.beta - 45) / 30, -1.5, 1.5)];
      };
      window.addEventListener('deviceorientation', s.onOrient);
      return s;
    },
    action(ctx, s, key) {
      if (key !== 'tilt') return;
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        DOE.requestPermission().then((r) => { if (r !== 'granted') ctx.message('Motion permission was declined.'); setTimeout(() => ctx.message(''), 1800); }).catch(() => {});
      } else if (!DOE) {
        ctx.message('This device does not report orientation. Use the pointer instead.');
        setTimeout(() => ctx.message(''), 2200);
      }
    },
    dispose(ctx, s) { window.removeEventListener('deviceorientation', s.onOrient); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      let target;
      if (s.gyro) target = s.gyro;
      else if (input.hover || input.down) target = [input.nx, input.ny];
      else target = [Math.sin(t * 0.4) * 0.6, Math.sin(t * 0.27) * 0.3];
      const k = damp(params.smooth, dt);
      s.tilt[0] += (target[0] - s.tilt[0]) * k;
      s.tilt[1] += (target[1] - s.tilt[1]) * k;
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.prog.use().set({ u_res: [ctx.width, ctx.height], u_tilt: s.tilt, u_time: t, u_depth: params.depth, u_layers: params.layers });
      ctx.util.drawFullscreen();
    },
  });
})();
