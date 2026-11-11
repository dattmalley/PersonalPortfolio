/* Volume Rendering — a 96³ density field stored in a 3D texture (R8) and
 * ray-marched front-to-back through a box, with a draggable clipping plane. */
(function () {
  const S = window.Sandbox;
  const SIZE = 96;

  const FS = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler3D u_vol; uniform vec2 u_res; uniform vec3 u_eye; uniform vec3 u_target;
uniform float u_thresh; uniform float u_density; uniform float u_slice; uniform float u_time; uniform float u_warp;
uniform int u_axis;
vec2 box(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-1.0 - ro) * inv, t1 = (1.0 - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
void main() {
  vec3 f = normalize(u_target - u_eye), r = normalize(cross(f, vec3(0, 1, 0))), u = cross(r, f);
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(u_res.x / u_res.y, 1.0);
  vec3 rd = normalize(f * 1.8 + r * p.x + u * p.y), ro = u_eye;
  vec3 bg = mix(vec3(0.02, 0.025, 0.045), vec3(0.045, 0.02, 0.035), v_uv.y);
  vec2 tb = box(ro, rd);
  if (tb.x > tb.y || tb.y < 0.0) { o = vec4(bg, 1.0); return; }
  float t = max(tb.x, 0.0);
  const int STEPS = 160;
  float dt = (tb.y - t) / float(STEPS);
  vec3 acc = vec3(0.0); float alpha = 0.0;
  // jitter start to hide banding
  t += dt * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < STEPS; i++) {
    vec3 q = ro + rd * t;
    float axisV = u_axis == 0 ? q.x : u_axis == 1 ? q.y : q.z;
    if (axisV < u_slice) {
      vec3 w = q + u_warp * 0.06 * vec3(sin(q.y * 4.0 + u_time), sin(q.z * 4.0 + u_time * 1.3), sin(q.x * 4.0 - u_time));
      float d = texture(u_vol, w * 0.5 + 0.5).r;
      float a = smoothstep(u_thresh, u_thresh + 0.15, d) * u_density * dt * 6.0;
      // cut face highlight
      float cut = smoothstep(0.03, 0.0, abs(axisV - u_slice)) * step(u_thresh, d);
      vec3 c = mix(BLUE, RED, smoothstep(u_thresh, 0.9, d)) * (0.6 + 0.8 * d) + cut * 0.8;
      a = clamp(a + cut * 0.5, 0.0, 1.0);
      acc += (1.0 - alpha) * c * a;
      alpha += (1.0 - alpha) * a;
      if (alpha > 0.97) break;
    }
    t += dt;
  }
  // box edges
  vec3 e = ro + rd * max(tb.x, 0.0);
  vec3 ae = abs(e);
  float edge = 0.0;
  if (tb.x > 0.0) {
    vec3 m = step(vec3(0.985), ae);
    edge = step(1.5, m.x + m.y + m.z);
  }
  vec3 col = acc + bg * (1.0 - alpha) + edge * 0.25 * (1.0 - alpha);
  o = vec4(col, 1.0);
}`;

  function makeVolume() {
    const { vnoise } = S.noise;
    const data = new Uint8Array(SIZE * SIZE * SIZE);
    const balls = [];
    for (let i = 0; i < 7; i++) balls.push([Math.sin(i * 2.1) * 0.5, Math.cos(i * 1.7) * 0.5, Math.sin(i * 3.3 + 1) * 0.5, 0.18 + 0.08 * Math.sin(i * 5.0)]);
    let k = 0;
    for (let z = 0; z < SIZE; z++) for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++, k++) {
      const px = x / (SIZE - 1) * 2 - 1, py = y / (SIZE - 1) * 2 - 1, pz = z / (SIZE - 1) * 2 - 1;
      let f = 0;
      for (const b of balls) { const d2 = (px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2; f += (b[3] * b[3]) / (d2 + 1e-3); }
      const n = vnoise(px * 4 + 11 + pz * 1.3, py * 4 + pz * 3.7) * 0.6 + vnoise(px * 9 + pz * 5.1, py * 9 - pz * 2.2) * 0.4;
      let v = Math.min(f, 1.4) / 1.4 * 0.8 + n * 0.35;
      const edge = Math.max(Math.abs(px), Math.abs(py), Math.abs(pz));
      v *= 1 - Math.pow(Math.max(0, edge - 0.75) / 0.25, 2);
      data[k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    return data;
  }

  S.register({
    id: 'volume',
    title: 'Volume (3D Texture)',
    category: 'Rendering',
    hint: 'drag to orbit · wheel to zoom · move the slice',
    description: 'A 96³ voxel density field (metaballs plus noise) is uploaded once with texImage3D as a single-channel R8 3D texture. Each pixel then marches through the bounding box, samples the volume with hardware trilinear filtering, and composites front to back with early exit. A clipping plane slices the volume to show its interior.',
    interact: [['Drag', 'Orbit the volume'], ['Wheel / pinch', 'Zoom'], ['Slice slider / ← →', 'Sweep the clipping plane'], ['Warp', 'Animate a domain warp through the field']],
    features: ['TEXTURE_3D + texImage3D', 'sampler3D', 'R8 single-channel format', 'TEXTURE_WRAP_R', 'Front-to-back compositing'],
    params: [
      { key: 'thresh', label: 'Iso threshold', type: 'range', min: 0.05, max: 0.9, step: 0.01, value: 0.42 },
      { key: 'density', label: 'Opacity', type: 'range', min: 0.2, max: 6, step: 0.1, value: 2.5 },
      { key: 'slice', label: 'Clip plane', type: 'range', min: -1, max: 1.01, step: 0.01, value: 1.01 },
      { key: 'axis', label: 'Clip axis', type: 'select', options: ['X', 'Y', 'Z'], value: 0 },
      { key: 'warp', label: 'Warp animation', type: 'range', min: 0, max: 2, step: 0.05, value: 0.5 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const tex = util.texture({ target: gl.TEXTURE_3D, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, width: SIZE, height: SIZE, depth: SIZE, data: makeVolume() });
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      return {
        prog: util.program(S.GLSL.fullscreenVS, FS), tex,
        cam: new S.OrbitCam({ dist: 4.6, pitch: 0.45, yaw: 0.8, minDist: 2.2, maxDist: 10, auto: 0.12 }),
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt, false);
      if (input.keys.has('ArrowLeft') || input.keys.has('ArrowRight')) {
        ctx.syncParam('slice', Math.max(-1, Math.min(1.01, params.slice + (input.keys.has('ArrowRight') ? 1 : -1) * dt)));
      }
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, s.tex);
      s.prog.use().set({
        u_vol: 0, u_res: [ctx.width, ctx.height], u_eye: s.cam.eye(), u_target: s.cam.target,
        u_thresh: params.thresh, u_density: params.density, u_slice: params.slice, u_time: t, u_warp: params.warp, u_axis: params.axis,
      });
      ctx.util.drawFullscreen();
    },
  });
})();
