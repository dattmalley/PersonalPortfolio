/* Flocking Ribbons — two species of boids (separation / alignment / cohesion)
 * with long motion trails. All trails render in ONE draw call: line strips
 * separated by the primitive-restart index, with integer vertex attributes. */
(function () {
  const S = window.Sandbox;
  const { V3, M4, damp } = S.math;
  const T = 28;            // trail length (vertices per boid)
  const BOUND = 8.5;

  const TRAIL_VS = S.GLSL.colors + `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in uvec2 a_id;    // boid index, trail index (integer attribute)
uniform mat4 u_vp; uniform float u_trail;
out vec3 v_col; out float v_a;
void main() {
  float k = float(a_id.y) / (u_trail - 1.0);
  v_a = pow(1.0 - k, 1.6);
  v_col = (a_id.x % 2u == 0u) ? RED : BLUE;
  gl_Position = u_vp * vec4(a_pos, 1.0);
}`;
  const TRAIL_FS = `in vec3 v_col; in float v_a; out vec4 o; uniform float u_alpha; void main() { o = vec4(v_col * v_a * u_alpha, 1.0); }`;

  const HEAD_VS = S.GLSL.colors + `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec3 a_p; layout(location = 3) in vec3 a_v;
uniform mat4 u_vp;
out vec3 v_n; out vec3 v_col;
void main() {
  vec3 f = normalize(a_v + vec3(0.0, 1e-4, 0.0));
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 u = cross(r, f);
  mat3 B = mat3(r, u, f);
  vec3 lp = a_pos * vec3(0.07, 0.05, 0.22);
  v_n = B * a_nrm;
  v_col = (gl_InstanceID % 2 == 0) ? RED : BLUE;
  gl_Position = u_vp * vec4(a_p + B * lp, 1.0);
}`;
  const HEAD_FS = `in vec3 v_n; in vec3 v_col; out vec4 o;
void main() { float d = 0.45 + 0.55 * max(dot(normalize(v_n), normalize(vec3(0.3, 0.9, 0.4))), 0.0); o = vec4(v_col * d + 0.15, 1.0); }`;

  S.register({
    id: 'flock',
    title: 'Flocking Ribbons',
    category: 'Simulation',
    hint: 'move to lead the flock · hold to scare it',
    description: 'Emergent motion from three local rules: steer away from close neighbours, match their heading, and drift toward their centre. Two species flock independently but avoid each other. The comet trails are one indexed line-strip draw call: a primitive-restart index (0xFFFF) separates each boid\'s strip, and an integer attribute carries boid and trail indices.',
    interact: [['Move', 'The flock is drawn toward the pointer'], ['Hold', 'Become a predator: the flock scatters'], ['Drag', 'Orbit the view'], ['Wheel / pinch', 'Zoom']],
    features: ['Primitive restart (fixed index)', 'drawRangeElements', 'vertexAttribIPointer (uvec2)', 'Streaming bufferSubData', 'Spatial-hash neighbour search'],
    params: [
      { key: 'count', label: 'Boids', type: 'range', min: 100, max: 1500, step: 50, value: 600, restart: true },
      { key: 'sep', label: 'Separation', type: 'range', min: 0, max: 4, step: 0.05, value: 1.6 },
      { key: 'ali', label: 'Alignment', type: 'range', min: 0, max: 4, step: 0.05, value: 1.0 },
      { key: 'coh', label: 'Cohesion', type: 'range', min: 0, max: 4, step: 0.05, value: 0.9 },
      { key: 'pull', label: 'Pointer pull', type: 'range', min: 0, max: 3, step: 0.05, value: 0.8 },
      { key: 'speed', label: 'Speed', type: 'range', min: 1, max: 8, step: 0.1, value: 3.6 },
      { key: 'trails', label: 'Trails', type: 'toggle', value: true },
    ],
    init(ctx) {
      const { gl, util, params } = ctx;
      const n = params.count;
      const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const d = V3.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
        const r = Math.cbrt(Math.random()) * 5;
        pos.set([d[0] * r, d[1] * r, d[2] * r], i * 3);
        vel.set(V3.scale(V3.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), params.speed), i * 3);
      }
      const trail = new Float32Array(n * T * 3);
      for (let i = 0; i < n; i++) for (let k = 0; k < T; k++) trail.set(pos.subarray(i * 3, i * 3 + 3), (i * T + k) * 3);
      const ids = new Uint16Array(n * T * 2);
      for (let i = 0; i < n; i++) for (let k = 0; k < T; k++) { ids[(i * T + k) * 2] = i; ids[(i * T + k) * 2 + 1] = k; }
      const idx = new Uint16Array(n * (T + 1));
      let q = 0;
      for (let i = 0; i < n; i++) { for (let k = 0; k < T; k++) idx[q++] = i * T + k; idx[q++] = 0xffff; } // restart index
      const trailBuf = util.buffer(gl.ARRAY_BUFFER, trail, gl.DYNAMIC_DRAW);
      const trailVao = util.vao([
        { buffer: trailBuf, loc: 0, size: 3 },
        { buffer: util.buffer(gl.ARRAY_BUFFER, ids), loc: 1, size: 2, type: gl.UNSIGNED_SHORT, integer: true },
      ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, idx));
      const o = S.geo.octa();
      const ob = util.buffer(gl.ARRAY_BUFFER, o.data);
      const posBuf = util.buffer(gl.ARRAY_BUFFER, pos.byteLength, gl.DYNAMIC_DRAW);
      const velBuf = util.buffer(gl.ARRAY_BUFFER, vel.byteLength, gl.DYNAMIC_DRAW);
      const headVao = util.vao([
        { buffer: ob, loc: 0, size: 3, stride: 24 }, { buffer: ob, loc: 1, size: 3, stride: 24, offset: 12 },
        { buffer: posBuf, loc: 2, size: 3, divisor: 1 }, { buffer: velBuf, loc: 3, size: 3, divisor: 1 },
      ]);
      return {
        n, pos, vel, acc: new Float32Array(n * 3), trail, trailBuf, trailVao, idxCount: idx.length, posBuf, velBuf, headVao,
        trailP: util.program(TRAIL_VS, TRAIL_FS), headP: util.program(HEAD_VS, HEAD_FS),
        cam: new S.OrbitCam({ dist: 19, pitch: 0.3, minDist: 8, maxDist: 40, auto: 0.06 }),
        target: [0, 0, 0], grid: new Map(),
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      const h = Math.min(dt, 1 / 30);
      // pointer → world target on the plane through the origin facing the camera
      let tgt;
      if (input.hover || input.down) {
        const r = s.cam.ray(input.nx, input.ny, ctx.aspect), b = s.cam.basis();
        const k = -V3.dot(r.origin, b.fwd) / V3.dot(r.dir, b.fwd);
        tgt = V3.add(r.origin, V3.scale(r.dir, k));
      } else tgt = [Math.sin(t * 0.37) * 5, Math.sin(t * 0.53) * 2.5, Math.cos(t * 0.29) * 5];
      const a = damp(6, dt);
      for (let i = 0; i < 3; i++) s.target[i] += (tgt[i] - s.target[i]) * a;
      const flee = input.down;

      // spatial hash
      const cell = 1.6, g = s.grid; g.clear();
      const { n, pos, vel, acc } = s;
      const key = (x, y, z) => (x + 64) * 16384 + (y + 64) * 128 + (z + 64);
      for (let i = 0; i < n; i++) {
        const k = key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), Math.floor(pos[i * 3 + 2] / cell));
        let arr = g.get(k); if (!arr) g.set(k, (arr = [])); arr.push(i);
      }
      const R2 = cell * cell, SEP2 = 0.55 * 0.55;
      for (let i = 0; i < n; i++) {
        const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
        let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, mx = 0, my = 0, mz = 0, cnt = 0;
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          const arr = g.get(key(cx + ox, cy + oy, cz + oz)); if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const dx = pos[j * 3] - px, dy = pos[j * 3 + 1] - py, dz = pos[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > R2) continue;
            if (d2 < SEP2) { const inv = 1 / (d2 + 0.01); sx -= dx * inv; sy -= dy * inv; sz -= dz * inv; }
            if ((i & 1) === (j & 1)) { // same species: align + cohere
              ax += vel[j * 3]; ay += vel[j * 3 + 1]; az += vel[j * 3 + 2];
              mx += dx; my += dy; mz += dz; cnt++;
            }
          }
        }
        let fx = sx * params.sep * 0.12, fy = sy * params.sep * 0.12, fz = sz * params.sep * 0.12;
        if (cnt) {
          fx += (ax / cnt - vel[i * 3]) * params.ali * 0.6 + (mx / cnt) * params.coh * 0.5;
          fy += (ay / cnt - vel[i * 3 + 1]) * params.ali * 0.6 + (my / cnt) * params.coh * 0.5;
          fz += (az / cnt - vel[i * 3 + 2]) * params.ali * 0.6 + (mz / cnt) * params.coh * 0.5;
        }
        const tx = s.target[0] - px, ty = s.target[1] - py, tz = s.target[2] - pz;
        const td = Math.hypot(tx, ty, tz) + 1e-4;
        if (flee && td < 4.5) { const f = (4.5 - td) * 3 / td; fx -= tx * f; fy -= ty * f; fz -= tz * f; }
        else { fx += tx / td * params.pull; fy += ty / td * params.pull; fz += tz / td * params.pull; }
        const pr = Math.hypot(px, py, pz);
        if (pr > BOUND) { const f = (pr - BOUND) * 0.8 / pr; fx -= px * f; fy -= py * f; fz -= pz * f; }
        acc[i * 3] = fx; acc[i * 3 + 1] = fy; acc[i * 3 + 2] = fz;
      }
      const vmax = params.speed * (flee ? 1.8 : 1), vmin = params.speed * 0.45;
      for (let i = 0; i < n; i++) {
        let vx = vel[i * 3] + acc[i * 3] * h * 4, vy = vel[i * 3 + 1] + acc[i * 3 + 1] * h * 4, vz = vel[i * 3 + 2] + acc[i * 3 + 2] * h * 4;
        const sp = Math.hypot(vx, vy, vz) || 1;
        const c = sp > vmax ? vmax / sp : sp < vmin ? vmin / sp : 1;
        vx *= c; vy *= c; vz *= c;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        pos[i * 3] += vx * h; pos[i * 3 + 1] += vy * h; pos[i * 3 + 2] += vz * h;
        // shift this boid's trail back by one sample and write the new head
        const base = i * T * 3;
        s.trail.copyWithin(base + 3, base, base + (T - 1) * 3);
        s.trail[base] = pos[i * 3]; s.trail[base + 1] = pos[i * 3 + 1]; s.trail[base + 2] = pos[i * 3 + 2];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.velBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, vel);

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 100), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.024, 0.027, 0.04, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (params.trails) {
        gl.bindBuffer(gl.ARRAY_BUFFER, s.trailBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.trail);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        s.trailP.use().set({ u_vp: vp, u_trail: T, u_alpha: Math.min(1, 500 / n) * 0.9 });
        gl.bindVertexArray(s.trailVao);
        gl.drawRangeElements(gl.LINE_STRIP, 0, n * T - 1, s.idxCount, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.BLEND);
      }
      gl.enable(gl.DEPTH_TEST);
      s.headP.use().set({ u_vp: vp });
      gl.bindVertexArray(s.headVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 24, n);
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
