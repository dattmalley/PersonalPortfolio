/* Terrain Flight — keyboard + mouse-look fly-through over infinite procedural
 * terrain displaced in the vertex shader. The CPU evaluates the identical
 * integer-hash noise to keep the camera above the ground. */
(function () {
  const S = window.Sandbox;
  const { M4, clamp, damp } = S.math;
  const GRID = 256, CELL = 0.5, FREQ = 0.045;

  const VS = S.GLSL.noise + `
layout(location = 0) in vec2 a_xz;
uniform mat4 u_vp; uniform vec2 u_offset; uniform float u_height;
out vec3 v_w; out vec3 v_n;
float height(vec2 p) { float h = fbm(p * ${FREQ.toFixed(3)}); return pow(h, 2.2) * u_height * 2.4; }
void main() {
  vec2 xz = a_xz + u_offset;
  float h = height(xz);
  float e = ${CELL.toFixed(2)};
  vec3 n = normalize(vec3(height(xz - vec2(e, 0.0)) - height(xz + vec2(e, 0.0)), 2.0 * e, height(xz - vec2(0.0, e)) - height(xz + vec2(0.0, e))));
  v_w = vec3(xz.x, h, xz.y); v_n = n;
  gl_Position = u_vp * vec4(v_w, 1.0);
}`;
  const FS = S.GLSL.colors + `
in vec3 v_w; in vec3 v_n; out vec4 o;
uniform vec3 u_eye; uniform float u_height; uniform float u_time;
void main() {
  vec2 g = v_w.xz;
  vec2 a = abs(fract(g - 0.5) - 0.5) / fwidth(g);
  float line = 1.0 - min(min(a.x, a.y), 1.0);
  float hn = clamp(v_w.y / (u_height * 1.2 + 1e-3), 0.0, 1.0);
  vec3 lineCol = mix(BLUE, RED, smoothstep(0.15, 0.75, hn));
  float diff = max(dot(normalize(v_n), normalize(vec3(0.3, 0.8, -0.5))), 0.0);
  vec3 c = INK * 1.5 + vec3(0.03, 0.035, 0.06) * diff + line * lineCol * (0.6 + 0.4 * diff);
  float dist = length(v_w - u_eye);
  float fog = 1.0 - exp(-dist * 0.028);
  vec3 fogCol = mix(vec3(0.08, 0.02, 0.05), vec3(0.02, 0.03, 0.08), 0.5);
  o = vec4(mix(c, fogCol, fog), 1.0);
}`;
  const SKY = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform float u_yaw; uniform float u_pitch; uniform vec2 u_res; uniform float u_time;
void main() {
  float horizon = 0.5 - u_pitch * 0.9;
  float y = v_uv.y - horizon;
  vec3 c = mix(vec3(0.08, 0.02, 0.05), vec3(0.01, 0.015, 0.04), smoothstep(0.0, 0.6, y));
  // sun fixed in world yaw
  float sx = fract((u_yaw / 6.2831853) + 0.5) - 0.5;
  vec2 sp = vec2(0.5 - sx * 3.0, horizon + 0.16);
  vec2 d = (v_uv - sp) * vec2(u_res.x / u_res.y, 1.0);
  float r = length(d);
  float stripes = step(0.5, fract((v_uv.y - horizon) * 40.0 - u_time * 0.3)) + step(0.2, v_uv.y - horizon);
  float sun = smoothstep(0.2, 0.195, r) * clamp(stripes, 0.0, 1.0);
  c += sun * mix(RED, vec3(1.0, 0.55, 0.4), smoothstep(-0.2, 0.2, d.y));
  c += exp(-r * 5.0) * RED * 0.35;
  // stars
  vec2 st = floor(v_uv * u_res / 3.0);
  float h = fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
  c += step(0.997, h) * smoothstep(0.05, 0.4, y) * vec3(0.7, 0.8, 1.0);
  o = vec4(c, 1.0);
}`;

  function heightCPU(x, z, hs) { const h = S.noise.fbm(x * FREQ, z * FREQ); return Math.pow(h, 2.2) * hs * 2.4; }

  S.register({
    id: 'terrain',
    title: 'Terrain Flight',
    category: 'Camera & Navigation',
    hint: 'WASD / arrows · Q/E altitude · drag to look',
    description: 'A first-person fly-through over endless terrain. A 257×257 grid (66k vertices, so it needs 32-bit indices, which WebGL2 supports natively) follows the camera, and the vertex shader displaces it with integer-hash noise. The CPU runs the identical hash to keep you above the ground.',
    interact: [['W A S D / arrows', 'Fly and strafe'], ['Q / E (or Space / Shift)', 'Climb / descend'], ['Drag', 'Mouse-look (touch: drag to steer)'], ['Autopilot', 'Cruise forward hands-free']],
    features: ['Uint32 index buffers', 'Vertex-shader displacement', 'uint bitwise hashing', 'Exponential fog', 'Keyboard input'],
    params: [
      { key: 'speed', label: 'Speed', type: 'range', min: 2, max: 40, step: 1, value: 12 },
      { key: 'height', label: 'Terrain height', type: 'range', min: 1, max: 12, step: 0.5, value: 6 },
      { key: 'auto', label: 'Autopilot', type: 'toggle', value: true },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const N = GRID + 1;
      const xz = new Float32Array(N * N * 2);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        xz[(j * N + i) * 2] = (i - GRID / 2) * CELL;
        xz[(j * N + i) * 2 + 1] = (j - GRID / 2) * CELL;
      }
      const idx = new Uint32Array(GRID * GRID * 6);
      let t = 0;
      for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
      }
      return {
        prog: util.program(VS, FS),
        sky: util.program(S.GLSL.fullscreenVS, SKY),
        vao: util.vao([{ buffer: util.buffer(gl.ARRAY_BUFFER, xz), loc: 0, size: 2 }], util.buffer(gl.ELEMENT_ARRAY_BUFFER, idx)),
        count: idx.length,
        pos: [0, 8, 0], yaw: 0, pitch: -0.12, vel: [0, 0, 0], yawV: 0,
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const k = input.keys;
      const key = (...c) => c.some((x) => k.has(x));
      if (input.dragging) {
        s.yaw += input.dragDX * 0.004;
        s.pitch = clamp(s.pitch - input.dragDY * 0.004, -1.2, 1.0);
      }
      if (key('ArrowLeft')) s.yaw -= dt * 1.5;
      if (key('ArrowRight')) s.yaw += dt * 1.5;
      const fwd = [Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch)];
      const right = [Math.cos(s.yaw), 0, Math.sin(s.yaw)];
      let mf = (key('KeyW', 'ArrowUp') ? 1 : 0) - (key('KeyS', 'ArrowDown') ? 1 : 0);
      const ms = (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0);
      const mu = (key('KeyE', 'Space') ? 1 : 0) - (key('KeyQ', 'ShiftLeft', 'ShiftRight') ? 1 : 0);
      if (params.auto && mf === 0) mf = 0.6;
      const target = [
        (fwd[0] * mf + right[0] * ms) * params.speed,
        (fwd[1] * mf + mu) * params.speed,
        (fwd[2] * mf + right[2] * ms) * params.speed,
      ];
      const a = damp(4, dt);
      for (let i = 0; i < 3; i++) { s.vel[i] += (target[i] - s.vel[i]) * a; s.pos[i] += s.vel[i] * dt; }
      const ground = heightCPU(s.pos[0], s.pos[2], params.height) + 1.2;
      if (s.pos[1] < ground) { s.pos[1] += (ground - s.pos[1]) * damp(12, dt); s.vel[1] = Math.max(s.vel[1], 0); }
      s.pos[1] = Math.min(s.pos[1], 60);

      const look = [s.pos[0] + fwd[0], s.pos[1] + fwd[1], s.pos[2] + fwd[2]];
      const roll = clamp(-ms * 0.08 + (input.dragging ? -input.dragDX * 0.002 : 0), -0.3, 0.3);
      const view = M4.mul(M4.rotZ(roll), M4.lookAt(s.pos, look));
      const vp = M4.mul(M4.persp(1.0, ctx.aspect, 0.1, 140), view);
      const offset = [Math.floor(s.pos[0] / CELL) * CELL, Math.floor(s.pos[2] / CELL) * CELL];

      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      s.sky.use().set({ u_yaw: s.yaw, u_pitch: s.pitch, u_res: [ctx.width, ctx.height], u_time: t });
      ctx.util.drawFullscreen();
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_offset: offset, u_height: params.height, u_eye: s.pos, u_time: t });
      gl.bindVertexArray(s.vao);
      gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_INT, 0);
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
