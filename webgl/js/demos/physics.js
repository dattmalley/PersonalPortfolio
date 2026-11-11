/* Physics Playground — rigid spheres with impulse collisions, friction and
 * rolling. Grab and fling balls, hold empty space to charge a shot, tilt your
 * phone to steer gravity, shake it to scatter, and feel impacts through the
 * Vibration API. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Q, Ray, damp } = S.math;
  const MAXB = 180, HALF = 6.5, WALL_H = 0.6;

  const BALL_VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_pr;    // position, radius
layout(location = 3) in vec4 a_q;     // orientation quaternion
layout(location = 4) in vec2 a_cf;    // colour index, impact flash
uniform mat4 u_vp;
out vec3 v_n; out vec3 v_w; out vec3 v_l; out vec2 v_cf;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 w = a_pr.xyz + qrot(a_q, a_pos) * a_pr.w;
  v_n = qrot(a_q, a_nrm); v_w = w; v_l = a_pos; v_cf = a_cf;
  gl_Position = u_vp * vec4(w, 1.0);
}`;
  const BALL_FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in vec3 v_l; in vec2 v_cf; out vec4 o; uniform vec3 u_eye;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w), L = normalize(vec3(0.3, 0.9, 0.4));
  int ci = int(v_cf.x);
  vec3 base = ci == 0 ? RED : ci == 1 ? BLUE : vec3(0.9, 0.88, 0.84);
  float stripe = smoothstep(0.18, 0.14, abs(v_l.y));          // a band so rolling is visible
  vec3 alb = mix(base, ci == 2 ? RED : vec3(0.95, 0.93, 0.9), stripe * 0.85);
  float d = max(dot(n, L), 0.0), sp = pow(max(dot(reflect(-L, n), V), 0.0), 50.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  o = vec4(alb * (0.18 + 0.82 * d) + sp * 0.5 + fres * 0.15 + v_cf.y * 0.6, 1.0);
}`;
  const SHADOW_VS = `
layout(location = 0) in vec2 a_c; layout(location = 2) in vec4 a_pr;
uniform mat4 u_vp; out vec2 v_c; out float v_a;
void main() { float r = a_pr.w * (1.3 + a_pr.y * 0.25); v_c = a_c; v_a = clamp(1.0 - (a_pr.y - a_pr.w) * 0.35, 0.0, 1.0); gl_Position = u_vp * vec4(a_pr.x + a_c.x * r, 0.002, a_pr.z + a_c.y * r, 1.0); }`;
  const SHADOW_FS = `in vec2 v_c; in float v_a; out vec4 o; void main() { float a = smoothstep(1.0, 0.0, length(v_c)) * 0.55 * v_a; o = vec4(0.0, 0.0, 0.0, a); }`;
  const ENV_VS = `layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm; uniform mat4 u_vp; uniform mat4 u_model; out vec3 v_w; out vec3 v_n; void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_model) * a_nrm; gl_Position = u_vp * w; }`;
  const ENV_FS = S.GLSL.colors + `in vec3 v_w; in vec3 v_n; out vec4 o; uniform int u_kind;
void main() {
  if (u_kind == 0) { vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz); float line = 1.0 - min(min(g.x, g.y), 1.0); o = vec4(vec3(0.06, 0.062, 0.072) + line * 0.035, 1.0); return; }
  float d = 0.4 + 0.6 * max(dot(normalize(v_n), normalize(vec3(0.3, 0.9, 0.4))), 0.0);
  o = vec4(vec3(0.12, 0.12, 0.14) * d + RED * 0.06, 1.0);
}`;

  S.register({
    id: 'physics',
    title: 'Physics Playground',
    category: 'Simulation',
    thumb: 'wide',
    hint: 'grab & fling balls · hold empty space to charge a shot',
    description: 'A rigid-body sandbox. Spheres collide through impulses with restitution and friction, and they roll, with orientation integrated from angular velocity so the stripes turn. Grab a ball and fling it. Hold empty space to charge a shot, then release. On a phone, tilt to steer gravity, shake to scatter, and impacts buzz through the Vibration API.',
    interact: [['Press a ball + drag', 'Grab and fling (release velocity is kept)'], ['Hold empty space', 'Charge a shot; release to fire'], ['Tilt (phone)', 'Gravity follows the device'], ['Shake (phone)', 'Scatter everything'], ['Right-drag / two fingers', 'Orbit'], ['Space / G', 'Spawn a burst / flip gravity']],
    features: ['Impulse-based collisions', 'Rolling via angular velocity', 'DeviceOrientation gravity', 'DeviceMotion shake detection', 'Vibration API haptics', 'Instanced balls + blob shadows'],
    params: [
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 30, step: 0.5, value: 12 },
      { key: 'rest', label: 'Bounciness', type: 'range', min: 0, max: 0.98, step: 0.01, value: 0.55 },
      { key: 'friction', label: 'Friction', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35 },
      { key: 'tilt', label: 'Tilt controls gravity', type: 'toggle', value: false },
      { key: 'haptics', label: 'Haptics', type: 'toggle', value: true },
      { key: 'spawn', label: 'Spawn 20', type: 'button' },
      { key: 'explode', label: 'Explode', type: 'button' },
      { key: 'perm', label: 'Enable motion sensors', type: 'button' },
      { key: 'clear', label: 'Clear', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const sph = S.geo.sphere(32, 16, 1);
      const inst = new Float32Array(MAXB * 10);
      const instBuf = util.buffer(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
      const sphVao = util.vao([
        { buffer: util.buffer(gl.ARRAY_BUFFER, sph.pos), loc: 0, size: 3 }, { buffer: util.buffer(gl.ARRAY_BUFFER, sph.nrm), loc: 1, size: 3 },
        { buffer: instBuf, loc: 2, size: 4, stride: 40, divisor: 1 }, { buffer: instBuf, loc: 3, size: 4, stride: 40, offset: 16, divisor: 1 }, { buffer: instBuf, loc: 4, size: 2, stride: 40, offset: 32, divisor: 1 },
      ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, sph.idx));
      const quad = util.buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
      const shVao = util.vao([{ buffer: quad, loc: 0, size: 2 }, { buffer: instBuf, loc: 2, size: 4, stride: 40, divisor: 1 }]);
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const s = {
        ballP: util.program(BALL_VS, BALL_FS), shP: util.program(SHADOW_VS, SHADOW_FS), envP: util.program(ENV_VS, ENV_FS),
        sphVao, shVao, sphCount: sph.count, inst, instBuf, cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        balls: [], g: [0, -1, 0], grab: null, charge: null, lastBuzz: 0,
        cam: new S.OrbitCam({ dist: 17, pitch: 0.75, yaw: 0.6, minDist: 8, maxDist: 34, target: [0, 0.5, 0] }),
      };
      for (let i = 0; i < 40; i++) spawn(s, [(Math.random() - 0.5) * 8, 1 + Math.random() * 6, (Math.random() - 0.5) * 8]);
      s.onOrient = (e) => { if (e.beta == null) return; const b = e.beta * Math.PI / 180, gm = e.gamma * Math.PI / 180; s.tiltG = V3.norm([Math.sin(gm), -Math.cos(b) * Math.cos(gm) - 0.3, -Math.sin(b) * 0.9]); };
      s.onMotion = (e) => { const a = e.acceleration || {}; const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0); if (m > 14 && performance.now() - (s.lastShake || 0) > 400) { s.lastShake = performance.now(); scatter(s, 6); } };
      window.addEventListener('deviceorientation', s.onOrient);
      window.addEventListener('devicemotion', s.onMotion);
      ctx.overlay.innerHTML = '<div id="ph-charge" style="position:absolute;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;display:none;pointer-events:none"></div>';
      s.chargeEl = ctx.overlay.querySelector('#ph-charge');
      return s;
    },
    dispose(ctx, s) { window.removeEventListener('deviceorientation', s.onOrient); window.removeEventListener('devicemotion', s.onMotion); },
    action(ctx, s, key) {
      if (key === 'spawn') for (let i = 0; i < 20; i++) spawn(s, [(Math.random() - 0.5) * 4, 6 + Math.random() * 4, (Math.random() - 0.5) * 4]);
      if (key === 'explode') scatter(s, 14);
      if (key === 'clear') s.balls.length = 0;
      if (key === 'perm') {
        const asks = [window.DeviceOrientationEvent, window.DeviceMotionEvent].filter((E) => E && typeof E.requestPermission === 'function').map((E) => E.requestPermission().catch(() => 'denied'));
        if (!asks.length) { ctx.message('Motion sensors need no permission here, or this device has none. Tilt your phone with "Tilt controls gravity" on.'); setTimeout(() => ctx.message(''), 2600); }
        Promise.all(asks).then(() => ctx.syncParam('tilt', true));
      }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const orbit = input.button === 2 || input.pointers.size >= 2;
      s.cam.update(orbit ? input : Object.assign({}, input, { dragging: false }), dt);
      if (input.pressed.has('Space')) for (let i = 0; i < 12; i++) spawn(s, [(Math.random() - 0.5) * 3, 7, (Math.random() - 0.5) * 3]);
      if (input.pressed.has('KeyG')) s.flip = !s.flip;
      const gdir = params.tilt && s.tiltG ? s.tiltG : [0, s.flip ? 1 : -1, 0];
      for (let i = 0; i < 3; i++) s.g[i] += (gdir[i] - s.g[i]) * damp(6, dt);
      const ray = s.cam.ray(input.nx, input.ny, ctx.aspect);
      // ---- press: grab a ball, or start charging a shot
      if (input.down && !orbit && !s.grab && !s.charge) {
        let best = null, bd = 1e9;
        s.balls.forEach((b) => { const tt = Ray.sphere(ray.origin, ray.dir, b.p, b.r * 1.15); if (tt && tt < bd) { bd = tt; best = b; } });
        if (best) { s.grab = { b: best, depth: V3.dot(V3.sub(best.p, ray.origin), s.cam.basis().fwd) }; }
        else s.charge = { t0: t };
      }
      if (s.grab) {
        const fwd = s.cam.basis().fwd;
        const k = s.grab.depth / V3.dot(ray.dir, fwd);
        const target = V3.add(ray.origin, V3.scale(ray.dir, k));
        target[1] = Math.max(target[1], s.grab.b.r);
        const b = s.grab.b;
        b.v = V3.scale(V3.sub(target, b.p), 14);  // critically-damped follow; release keeps this velocity (fling)
        if (!input.down) s.grab = null;
      }
      if (s.charge) {
        const c = Math.min(1, (t - s.charge.t0) / 1.2);
        s.chargeEl.style.display = 'block'; s.chargeEl.style.left = input.x + 'px'; s.chargeEl.style.top = input.y + 'px';
        s.chargeEl.style.background = `conic-gradient(#ff3b4e ${c * 360}deg, rgba(236,233,226,.15) 0)`;
        s.chargeEl.style.webkitMask = s.chargeEl.style.mask = 'radial-gradient(circle, transparent 22px, #000 23px)';
        if (!input.down) {
          const eye = s.cam.eye();
          const b = spawn(s, V3.add(eye, V3.scale(ray.dir, 1.5)), 0.35 + c * 0.25);
          b.v = V3.scale(ray.dir, 8 + c * 30);
          s.charge = null; s.chargeEl.style.display = 'none';
        }
      }
      // ---- simulate (substeps)
      const SUB = 4, h = Math.min(dt, 1 / 30) / SUB;
      const e = params.rest, mu = params.friction;
      let maxImpact = 0;
      for (let st = 0; st < SUB; st++) {
        for (const b of s.balls) {
          if (b !== (s.grab && s.grab.b)) for (let i = 0; i < 3; i++) b.v[i] += s.g[i] * params.gravity * h;
          for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * h;
          // floor / ceiling / walls
          const bound = (axis, lim, sign) => {
            const pen = sign > 0 ? b.p[axis] + b.r - lim : lim - (b.p[axis] - b.r);
            if (pen > 0) {
              b.p[axis] -= sign * pen;
              const vn = b.v[axis] * sign;
              if (vn > 0) { maxImpact = Math.max(maxImpact, vn); b.v[axis] = -vn * e * sign; b.flash = Math.min(1, vn * 0.06);
                for (let i = 0; i < 3; i++) if (i !== axis) b.v[i] *= 1 - mu * 0.08; }
            }
          };
          bound(1, 0, -1); bound(1, 14, 1); bound(0, -HALF, -1); bound(0, HALF, 1); bound(2, -HALF, -1); bound(2, HALF, 1);
        }
        const B = s.balls;
        for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
          const a = B[i], c = B[j];
          const dx = c.p[0] - a.p[0], dy = c.p[1] - a.p[1], dz = c.p[2] - a.p[2], rr = a.r + c.r;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 === 0) continue;
          const d = Math.sqrt(d2), n = [dx / d, dy / d, dz / d], pen = rr - d;
          const ima = 1 / a.m, imc = 1 / c.m, sum = ima + imc;
          for (let k = 0; k < 3; k++) { a.p[k] -= n[k] * pen * ima / sum; c.p[k] += n[k] * pen * imc / sum; }
          const rv = [c.v[0] - a.v[0], c.v[1] - a.v[1], c.v[2] - a.v[2]];
          const vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
          if (vn < 0) {
            const jn = -(1 + e) * vn / sum;
            for (let k = 0; k < 3; k++) { a.v[k] -= jn * n[k] * ima; c.v[k] += jn * n[k] * imc; }
            const tv = rv.map((v, k) => v - vn * n[k]), tl = Math.hypot(...tv);
            if (tl > 1e-4) { const jt = Math.min(mu * jn, tl / sum); for (let k = 0; k < 3; k++) { a.v[k] += jt * tv[k] / tl * ima; c.v[k] -= jt * tv[k] / tl * imc; } }
            if (-vn > 2) { a.flash = c.flash = Math.min(1, -vn * 0.05); maxImpact = Math.max(maxImpact, -vn); }
          }
        }
      }
      // rolling: ω from contact (n × v) / r for balls on the floor; integrate orientation
      for (const b of s.balls) {
        const onFloor = b.p[1] - b.r < 0.02;
        if (onFloor) { b.w = [b.v[2] / b.r, 0, -b.v[0] / b.r]; b.v[0] *= 1 - mu * 0.6 * dt; b.v[2] *= 1 - mu * 0.6 * dt; }
        const wl = Math.hypot(...b.w);
        if (wl > 1e-4) b.q = Q.norm(Q.mul(Q.axisAngle(b.w, wl * dt), b.q));
        b.flash = Math.max(0, (b.flash || 0) - dt * 3);
      }
      if (params.haptics && maxImpact > 6 && navigator.vibrate && performance.now() - s.lastBuzz > 90) { navigator.vibrate(Math.min(35, Math.round(maxImpact * 2))); s.lastBuzz = performance.now(); }
      s.balls.forEach((b, i) => s.inst.set([b.p[0], b.p[1], b.p[2], b.r, b.q[0], b.q[1], b.q[2], b.q[3], b.c, b.flash || 0], i * 10));
      gl.bindBuffer(gl.ARRAY_BUFFER, s.instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.inst, 0, s.balls.length * 10);

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 100), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.036, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.envP.use().set({ u_vp: vp, u_kind: 0, u_model: M4.mul(M4.translate(0, -0.05, 0), M4.scale(HALF * 2 + 0.6, 0.1, HALF * 2 + 0.6)) });
      gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
      s.envP.set({ u_kind: 1 });
      for (const [x, z, sx, sz] of [[0, -HALF - 0.15, HALF * 2 + 0.6, 0.3], [0, HALF + 0.15, HALF * 2 + 0.6, 0.3], [-HALF - 0.15, 0, 0.3, HALF * 2], [HALF + 0.15, 0, 0.3, HALF * 2]]) {
        s.envP.set({ u_model: M4.mul(M4.translate(x, WALL_H / 2, z), M4.scale(sx, WALL_H, sz)) }); gl.drawArrays(gl.TRIANGLES, 0, 36);
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      s.shP.use().set({ u_vp: vp }); gl.bindVertexArray(s.shVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.balls.length);
      gl.depthMask(true); gl.disable(gl.BLEND);
      s.ballP.use().set({ u_vp: vp, u_eye: s.cam.eye() });
      gl.bindVertexArray(s.sphVao); gl.drawElementsInstanced(gl.TRIANGLES, s.sphCount, gl.UNSIGNED_SHORT, 0, s.balls.length);
      gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = s.grab ? 'grabbing' : 'crosshair';
    },
  });

  function spawn(s, p, r) {
    if (s.balls.length >= MAXB) s.balls.shift();
    const rad = r || 0.25 + Math.random() * 0.35;
    const b = { p: p.slice(), v: [(Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2], r: rad, m: rad * rad * rad, q: Q.axisAngle([Math.random(), Math.random(), Math.random()], Math.random() * 6), w: [0, 0, 0], c: s.balls.length % 3, flash: 0 };
    s.balls.push(b);
    return b;
  }
  function scatter(s, k) { for (const b of s.balls) { b.v[0] += (Math.random() - 0.5) * k; b.v[1] += Math.random() * k; b.v[2] += (Math.random() - 0.5) * k; } }
})();
