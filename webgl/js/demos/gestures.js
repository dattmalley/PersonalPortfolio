/* Gesture Lab — a full gesture recogniser driving a 27-piece cube:
 * trackball drag + fling, pinch, two-finger rotate, two-finger pan,
 * double-tap reset, long-press explode. Every gesture is logged live. */
(function () {
  const S = window.Sandbox;
  const { M4, Q, V3, damp, clamp } = S.math;

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec3 a_cell;   // instanced: cell coords -1..1
uniform mat4 u_vp; uniform mat4 u_model; uniform float u_explode; uniform float u_time;
out vec3 v_n; out vec3 v_w; out vec3 v_cell; out vec3 v_local;
void main() {
  vec3 off = a_cell * (1.04 + u_explode * (0.9 + 0.25 * sin(u_time * 2.0 + dot(a_cell, vec3(1.7, 2.3, 3.1)))));
  vec4 w = u_model * vec4(a_pos * 0.96 + off, 1.0);
  v_n = mat3(u_model) * a_nrm; v_w = w.xyz; v_cell = a_cell; v_local = a_pos;
  gl_Position = u_vp * w;
}`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in vec3 v_cell; in vec3 v_local; out vec4 o;
uniform vec3 u_eye; uniform float u_flash;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w), L = normalize(vec3(0.4, 0.8, 0.6));
  // face colour depends on which outer face of the big cube this sticker belongs to
  vec3 a = abs(v_local) * 2.0;
  vec3 face = a.x > 0.99 ? vec3(sign(v_local.x), 0, 0) : a.y > 0.99 ? vec3(0, sign(v_local.y), 0) : vec3(0, 0, sign(v_local.z));
  bool outer = dot(face, v_cell) > 0.5;
  vec3 col = vec3(0.09, 0.095, 0.11);
  if (outer) col = face.x != 0.0 ? RED : face.y != 0.0 ? vec3(0.9, 0.88, 0.84) : BLUE;
  if (outer && (face.x < 0.0 || face.y < 0.0 || face.z < 0.0)) col *= 0.55;
  vec2 st = face.x != 0.0 ? v_local.yz : face.y != 0.0 ? v_local.xz : v_local.xy;
  float sticker = smoothstep(0.47, 0.42, max(abs(st.x), abs(st.y)));
  col = mix(vec3(0.05), col, outer ? sticker : 1.0);
  float dif = max(dot(n, L), 0.0);
  float sp = pow(max(dot(reflect(-L, n), V), 0.0), 60.0);
  o = vec4(col * (0.25 + 0.75 * dif) + sp * 0.35 + u_flash * 0.15, 1.0);
}`;

  S.register({
    id: 'gestures',
    title: 'Gesture Lab',
    category: 'Pointer & Touch',
    thumb: 'square',
    hint: 'drag · fling · pinch · twist · double-tap · long-press',
    description: 'A from-scratch gesture recogniser built on Pointer Events. One finger or the mouse drives a trackball with momentum, so a fling spins the cube. Two fingers pinch to scale, twist to roll and move together to pan. A double-tap springs everything home, and a long press explodes the cube into its 27 pieces. Each recognised gesture is logged live.',
    interact: [['Drag / fling', 'Trackball rotation with momentum'], ['Pinch / wheel', 'Scale'], ['Two-finger twist / Q E', 'Roll around the view axis'], ['Two-finger drag / shift-drag', 'Pan'], ['Double-tap', 'Reset with a spring'], ['Long-press', 'Explode / collapse the pieces']],
    features: ['Pointer Events gesture recognition', 'Quaternion trackball', 'Angular momentum', 'Spring animation', 'Instanced pieces'],
    params: [
      { key: 'friction', label: 'Spin friction', type: 'range', min: 0.5, max: 8, step: 0.1, value: 1.6 },
      { key: 'press', label: 'Long-press time (ms)', type: 'range', min: 250, max: 1200, step: 10, value: 520 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const cells = [];
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) cells.push(x, y, z);
      const vao = util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array(cells)), loc: 2, size: 3, divisor: 1 }]);
      ctx.overlay.innerHTML = '<div id="gx-log" style="position:absolute;left:34px;top:64px;font-family:var(--mono);font-size:11px;line-height:1.9;color:var(--text-2)"></div>';
      return {
        prog: util.program(VS, FS), vao,
        q: Q.norm(Q.mul(Q.axisAngle([1, 0, 0], 0.5), Q.axisAngle([0, 1, 0], -0.6))), w: [0, 0, 0], scale: 1, pan: [0, 0], roll: 0,
        explode: 0, explodeT: 0, ev: 0, flash: 0, log: [], logEl: ctx.overlay.querySelector('#gx-log'),
        two: null, lastTap: null, pressAt: 0, pressFired: false, pressPos: null, resetting: 0,
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const log = (name) => { s.log.unshift({ name, t }); s.log.length = Math.min(s.log.length, 7); s.flash = 1; };
      const ptrs = [...input.pointers.values()];
      // ---- two-finger gestures: pinch, twist, pan from centroid / distance / angle deltas
      if (ptrs.length === 2) {
        const [a, b] = ptrs;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (s.two) {
          const ds = d / s.two.d, da = ang - s.two.ang, dx = cx - s.two.cx, dy = cy - s.two.cy;
          s.scale = clamp(s.scale * ds, 0.4, 2.5);
          s.roll += Math.atan2(Math.sin(da), Math.cos(da));
          s.pan[0] += dx / ctx.cssHeight * 4; s.pan[1] -= dy / ctx.cssHeight * 4;
          s.two.acc.p += Math.abs(Math.log(ds)); s.two.acc.r += Math.abs(da); s.two.acc.m += Math.hypot(dx, dy);
          if (!s.two.named) {
            if (s.two.acc.p > 0.12) { log('pinch'); s.two.named = true; }
            else if (s.two.acc.r > 0.18) { log('two-finger rotate'); s.two.named = true; }
            else if (s.two.acc.m > 30) { log('two-finger pan'); s.two.named = true; }
          }
        }
        s.two = { cx, cy, d, ang, acc: s.two ? s.two.acc : { p: 0, r: 0, m: 0 }, named: s.two ? s.two.named : false };
      } else s.two = null;
      // ---- one pointer: trackball + long-press
      if (ptrs.length === 1) {
        const p = ptrs[0];
        if (!s.pressPos) { s.pressPos = [p.x, p.y]; s.pressAt = performance.now(); s.pressFired = false; s.dragLogged = false; }
        if (!s.pressFired && p.moved < 8 && performance.now() - s.pressAt > params.press) {
          s.pressFired = true; s.explodeT = s.explodeT ? 0 : 1; log(s.explodeT ? 'long-press · explode' : 'long-press · collapse');
          if (navigator.vibrate) navigator.vibrate(18);
        }
        if (input.shift) { s.pan[0] += input.dragDX / ctx.cssHeight * 4; s.pan[1] -= input.dragDY / ctx.cssHeight * 4; }
        else if (input.dragDX || input.dragDY) {
          const k = 0.008;
          const wv = [input.dragDY * k / Math.max(dt, 1 / 120), input.dragDX * k / Math.max(dt, 1 / 120), 0];
          s.w = s.w.map((v, i) => v + (wv[i] - v) * 0.6);
          const ang = Math.hypot(input.dragDX, input.dragDY) * k;
          if (ang > 0) s.q = Q.norm(Q.mul(Q.axisAngle([input.dragDY, input.dragDX, 0], ang), s.q));
          if (!s.dragLogged && p.moved > 10) { log('drag · trackball'); s.dragLogged = true; }
        } else s.w = s.w.map((v) => v * 0.5); // finger held still: kill velocity
      } else if (s.pressPos) {
        // release: classify fling by angular speed
        const sp = Math.hypot(...s.w);
        if (sp > 4) log(`fling · ${sp.toFixed(1)} rad/s`);
        s.pressPos = null;
      }
      // ---- taps (double-tap / double-click → reset)
      for (const c of input.clicks) {
        const now = performance.now();
        if (s.lastTap && now - s.lastTap.t < 320 && Math.hypot(c.x - s.lastTap.x, c.y - s.lastTap.y) < 30) { log('double-tap · reset'); s.resetting = 1; s.lastTap = null; }
        else { s.lastTap = { t: now, x: c.x, y: c.y }; }
      }
      if (input.wheel) { s.scale = clamp(s.scale * Math.exp(-input.wheel * 0.001), 0.4, 2.5); if (!s.wheelLogged) { log('wheel · scale'); s.wheelLogged = true; } } else s.wheelLogged = false;
      if (input.keys.has('KeyQ')) s.roll += dt * 2; if (input.keys.has('KeyE')) s.roll -= dt * 2;
      // ---- free spin with friction (momentum)
      if (!ptrs.length) {
        const sp = Math.hypot(...s.w);
        if (sp > 1e-3) s.q = Q.norm(Q.mul(Q.axisAngle(s.w, sp * dt), s.q));
        const f = Math.exp(-params.friction * dt);
        s.w = s.w.map((v) => v * f);
        if (sp < 0.05 && !s.resetting) s.q = Q.norm(Q.mul(Q.axisAngle([0.3, 1, 0], dt * 0.15), s.q)); // idle drift
      }
      if (s.resetting) {
        const home = Q.norm(Q.mul(Q.axisAngle([1, 0, 0], 0.5), Q.axisAngle([0, 1, 0], -0.6)));
        const k = damp(7, dt);
        s.q = Q.slerp(s.q, home, k); s.scale += (1 - s.scale) * k; s.roll += (0 - s.roll) * k; s.pan = s.pan.map((v) => v * (1 - k)); s.w = [0, 0, 0];
        s.explodeT = 0;
        s.resetting = Math.max(0, s.resetting - dt * 0.9);
      }
      // explode spring
      s.ev += ((s.explodeT - s.explode) * 90 - s.ev * 11) * Math.min(dt, 1 / 30);
      s.explode += s.ev * Math.min(dt, 1 / 30);
      s.flash = Math.max(0, s.flash - dt * 3);

      const model = M4.mul(M4.translate(s.pan[0], s.pan[1], 0), M4.mul(M4.rotZ(s.roll), M4.mul(Q.toMat4(s.q), M4.scale(s.scale * 0.9))));
      const eye = [0, 0, 10];
      const vp = M4.mul(M4.persp(0.7, ctx.aspect, 0.1, 50), M4.lookAt(eye, [0, 0, 0]));
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.028, 0.03, 0.04, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_model: model, u_explode: Math.max(0, s.explode), u_time: t, u_eye: eye, u_flash: s.flash });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, 27);
      gl.disable(gl.DEPTH_TEST);
      if (s.log.length) s.logEl.innerHTML = s.log.map((l, i) => `<div style="opacity:${Math.max(0.15, 1 - (t - l.t) * 0.25 - i * 0.1)}">${i === 0 ? '<span style="color:var(--red)">●</span> ' : '&nbsp;&nbsp;'}${l.name}</div>`).join('');
      else s.logEl.innerHTML = '<div style="opacity:.6">gesture log · try drag, fling, pinch, twist, double-tap, long-press</div>';
    },
  });
})();
