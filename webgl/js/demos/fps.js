/* Pointer-Lock Walk — first-person controls the way games do them: the
 * Pointer Lock API hides the cursor and streams raw mouse deltas; WASD walks
 * with acceleration, Space jumps under gravity, walls collide with sliding.
 * On touch screens a virtual joystick (left) and look-pad (right) take over. */
(function () {
  const S = window.Sandbox;
  const { M4, clamp, damp } = S.math;
  const MAP = [
    '##################',
    '#........#.......#',
    '#.####...#..##...#',
    '#.#..#.......#...#',
    '#.#..#..###..#.#.#',
    '#....#....#....#.#',
    '###..####.#.####.#',
    '#.........#......#',
    '#..##.....#..##..#',
    '#..##..#.....##..#',
    '#......#.........#',
    '#.####.#####.###.#',
    '#....#.....#...#.#',
    '#.#..#..#..#.#...#',
    '#.#.....#....#.#.#',
    '#.#####.####.#.#.#',
    '#................#',
    '##################',
  ];
  const H = MAP.length, W = MAP[0].length;
  const wall = (x, z) => { const i = Math.floor(z), j = Math.floor(x); return i < 0 || j < 0 || i >= H || j >= W || MAP[i][j] === '#'; };

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_inst;   // x, y, z, kind
uniform mat4 u_vp; uniform mat4 u_model; uniform float u_time;
out vec3 v_w; out vec3 v_n; flat out float v_kind; out vec3 v_l;
void main() {
  vec3 p = a_pos; float k = a_inst.w;
  if (k > 1.5) { p *= 0.28; p.y += sin(u_time * 2.0 + a_inst.x) * 0.12; float a = u_time + a_inst.z; p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz; }
  vec3 w = (u_model * vec4(p + a_inst.xyz, 1.0)).xyz;
  v_w = w; v_n = normalize(mat3(u_model) * a_nrm); v_kind = k; v_l = a_pos;
  gl_Position = u_vp * vec4(w, 1.0);
}`;
  const FS = S.GLSL.colors + `
in vec3 v_w; in vec3 v_n; flat in float v_kind; in vec3 v_l; out vec4 o;
uniform vec3 u_eye; uniform vec3 u_lp[6]; uniform float u_time; uniform vec3 u_fwd;
void main() {
  vec3 n = normalize(v_n);
  if (v_kind > 1.5) { o = vec4(mix(RED, vec3(1.0), 0.25) * 1.6, 1.0); return; }  // orb
  vec3 alb; float emit = 0.0;
  if (v_kind > 0.5) { // floor / ceiling
    vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    alb = vec3(0.07, 0.072, 0.08) + line * 0.04;
  } else {
    float strip = smoothstep(0.03, 0.0, abs(v_w.y - 0.92)) + smoothstep(0.02, 0.0, abs(v_w.y - 0.08));
    vec2 q = abs(fract((n.x != 0.0 ? v_w.zy : v_w.xy) * vec2(2.0, 3.0)) - 0.5);
    float panel = smoothstep(0.47, 0.5, max(q.x, q.y));
    alb = vec3(0.13, 0.13, 0.15) - panel * 0.04;
    emit = strip;
  }
  vec3 c = alb * 0.3;
  for (int i = 0; i < 6; i++) {
    vec3 d = u_lp[i] - v_w; float r2 = dot(d, d);
    vec3 lc = (i % 2 == 0) ? RED : BLUE;
    c += alb * lc * max(dot(n, normalize(d)), 0.0) * 2.2 / (1.0 + r2 * 0.5);
  }
  // player headlamp: a soft cone along the view direction
  vec3 hd = v_w - u_eye; float hl = length(hd);
  float cone = smoothstep(0.75, 0.95, dot(hd / hl, u_fwd));
  c += alb * vec3(0.95, 0.92, 0.88) * (0.45 + 0.55 * cone) * (0.35 + 0.65 * max(dot(n, -hd / hl), 0.0)) * 2.6 / (1.0 + hl * hl * 0.1);
  c += emit * (mod(floor(v_w.x + v_w.z), 2.0) < 1.0 ? RED : BLUE) * 0.9;
  float fog = 1.0 - exp(-length(v_w - u_eye) * 0.09);
  o = vec4(mix(c, vec3(0.012, 0.012, 0.018), fog), 1.0);
}`;

  S.register({
    id: 'fps',
    title: 'Pointer-Lock Walk',
    category: 'Camera & Navigation',
    thumb: 'wide',
    hint: 'click to capture the mouse · WASD · Space to jump · Esc to release',
    description: 'First-person controls the way games do them. Clicking requests a Pointer Lock: the cursor disappears and raw movementX/Y deltas steer the view without ever hitting the screen edge. WASD walks with acceleration and Shift sprints, Space jumps under gravity, and collision resolves one axis at a time so you slide along walls. On touch screens a virtual joystick and look-pad replace the mouse and keys. Collect the eight orbs.',
    interact: [['Click', 'Capture the mouse (Pointer Lock API)'], ['Mouse', 'Look (raw movement deltas)'], ['W A S D · Shift', 'Walk / sprint'], ['Space', 'Jump'], ['Esc', 'Release the mouse'], ['Touch', 'Left thumb joystick · right thumb look'], ['Gamepad', 'Sticks + A to jump']],
    features: ['Pointer Lock API (movementX/Y)', 'Virtual touch joystick', 'Axis-separated collision', 'Gravity + jump physics', 'Instanced level geometry'],
    params: [
      { key: 'sens', label: 'Mouse sensitivity', type: 'range', min: 0.5, max: 4, step: 0.1, value: 1.6 },
      { key: 'fov', label: 'Field of view', type: 'range', min: 50, max: 110, step: 1, value: 78 },
      { key: 'bob', label: 'Head bob', type: 'toggle', value: true },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const inst = [];
      const orbs = [];
      for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
        if (MAP[i][j] === '#') inst.push(j + 0.5, 0.5, i + 0.5, 0);
        else if ((i * 7 + j * 3) % 23 === 0 && orbs.length < 8) orbs.push({ x: j + 0.5, z: i + 0.5, got: false });
      }
      inst.push(W / 2, -0.5, H / 2, 1); // floor slab (scaled in model below by duplicating)
      const s = {
        prog: util.program(VS, FS), cb, walls: inst.length / 4 - 1,
        instBuf: util.buffer(gl.ARRAY_BUFFER, new Float32Array(inst)),
        orbBuf: util.buffer(gl.ARRAY_BUFFER, 8 * 16, gl.DYNAMIC_DRAW), orbs,
        pos: [1.5, 0, 16.5], vel: [0, 0, 0], yaw: Math.PI / 2, pitch: 0, onGround: true, bob: 0, look: [0, 0], joy: null, lookTouch: null,
      };
      s.vao = util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: s.instBuf, loc: 2, size: 4, divisor: 1 }]);
      s.orbVao = util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: s.orbBuf, loc: 2, size: 4, divisor: 1 }]);
      // big floor + ceiling as scaled cubes via a separate tiny instance buffer
      s.slabBuf = util.buffer(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1]));
      s.slabVao = util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: s.slabBuf, loc: 2, size: 4, divisor: 1 }]);
      s.onMove = (e) => { if (document.pointerLockElement === ctx.canvas) { s.look[0] += e.movementX; s.look[1] += e.movementY; } };
      s.onLock = () => { s.locked = document.pointerLockElement === ctx.canvas; };
      document.addEventListener('mousemove', s.onMove);
      document.addEventListener('pointerlockchange', s.onLock);
      ctx.overlay.innerHTML = `
        <div class="ov-center" id="fp-tip"><b>Click</b> to capture the mouse · WASD to walk · Space to jump</div>
        <div id="fp-cross" style="position:absolute;left:50%;top:50%;width:14px;height:14px;transform:translate(-50%,-50%);opacity:.7">
          <i style="position:absolute;left:6px;top:0;width:1px;height:14px;background:#ece9e2"></i><i style="position:absolute;top:6px;left:0;height:1px;width:14px;background:#ece9e2"></i></div>
        <div class="ov-label" id="fp-score" style="right:34px;left:auto;top:64px;transform:none"></div>
        <div id="fp-joy" style="position:absolute;width:120px;height:120px;border:1px solid rgba(236,233,226,.4);border-radius:50%;display:none;transform:translate(-50%,-50%)"><i id="fp-knob" style="position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(255,59,78,.55)"></i></div>`;
      s.tip = ctx.overlay.querySelector('#fp-tip'); s.score = ctx.overlay.querySelector('#fp-score');
      s.joyEl = ctx.overlay.querySelector('#fp-joy'); s.knob = ctx.overlay.querySelector('#fp-knob');
      return s;
    },
    dispose(ctx, s) {
      document.removeEventListener('mousemove', s.onMove);
      document.removeEventListener('pointerlockchange', s.onLock);
      if (document.pointerLockElement === ctx.canvas) document.exitPointerLock();
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const coarse = input.pointerType === 'touch';
      // request pointer lock on click (desktop)
      if (input.clicks.length && !coarse && !s.locked && ctx.canvas.requestPointerLock) { try { const p = ctx.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* unsupported */ } }
      s.tip.style.display = s.locked || coarse || s.moved ? 'none' : '';
      // touch: joystick (left half) + look pad (right half)
      let jx = 0, jz = 0;
      const ptrs = [...input.pointers.values()];
      for (const p of ptrs) {
        if (p.born && !p.role) p.role = p.x < ctx.cssWidth / 2 ? 'joy' : 'look';
        if (p.role === 'joy') {
          if (!p.origin) p.origin = [p.x, p.y];
          const dx = p.x - p.origin[0], dy = p.y - p.origin[1], m = Math.min(1, Math.hypot(dx, dy) / 50);
          const a = Math.atan2(dy, dx);
          jx = Math.cos(a) * m; jz = Math.sin(a) * m;
          s.joyEl.style.display = 'block'; s.joyEl.style.left = p.origin[0] + 'px'; s.joyEl.style.top = p.origin[1] + 'px';
          s.knob.style.transform = `translate(${Math.cos(a) * m * 38}px, ${Math.sin(a) * m * 38}px)`;
        } else if (p.role === 'look') { s.look[0] += (p.x - p.px) * 2.2; s.look[1] += (p.y - p.py) * 2.2; }
      }
      if (!ptrs.some((p) => p.role === 'joy')) s.joyEl.style.display = 'none';
      if (!s.locked && !coarse && input.dragging) { s.look[0] += input.dragDX * 1.5; s.look[1] += input.dragDY * 1.5; }
      const k = 0.0022 * params.sens;
      s.yaw += s.look[0] * k; s.pitch = clamp(s.pitch - s.look[1] * k, -1.45, 1.45); s.look = [0, 0];
      const gp = input.gamepad;
      if (gp) { s.yaw += (gp.axes[2] || 0) * dt * 2.4; s.pitch = clamp(s.pitch - (gp.axes[3] || 0) * dt * 1.8, -1.45, 1.45); jx += gp.axes[0] || 0; jz += gp.axes[1] || 0; }
      // movement
      const key = (...c) => c.some((x) => input.keys.has(x));
      let mf = (key('KeyW', 'ArrowUp') ? 1 : 0) - (key('KeyS', 'ArrowDown') ? 1 : 0) - jz;
      let ms = (key('KeyD', 'ArrowRight') ? 1 : 0) - (key('KeyA', 'ArrowLeft') ? 1 : 0) + jx;
      const len = Math.hypot(mf, ms); if (len > 1) { mf /= len; ms /= len; }
      if (len > 0.1) s.moved = true;
      const speed = (key('ShiftLeft', 'ShiftRight') ? 5.2 : 3.0);
      const fx = Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const tx = (fx * mf + Math.cos(s.yaw) * ms) * speed, tz = (fz * mf + Math.sin(s.yaw) * ms) * speed;
      const acc = damp(s.onGround ? 12 : 3, dt);
      s.vel[0] += (tx - s.vel[0]) * acc; s.vel[2] += (tz - s.vel[2]) * acc;
      if (s.onGround && (input.pressed.has('Space') || (gp && gp.buttons[0] > 0.5 && !s.gpJump))) { s.vel[1] = 4.6; s.onGround = false; }
      s.gpJump = gp && gp.buttons[0] > 0.5;
      s.vel[1] -= 12 * dt;
      // collide one axis at a time (slide along walls)
      const R = 0.24;
      const blocked = (x, z) => wall(x - R, z - R) || wall(x + R, z - R) || wall(x - R, z + R) || wall(x + R, z + R);
      const nx = s.pos[0] + s.vel[0] * dt; if (!blocked(nx, s.pos[2])) s.pos[0] = nx; else s.vel[0] = 0;
      const nz = s.pos[2] + s.vel[2] * dt; if (!blocked(s.pos[0], nz)) s.pos[2] = nz; else s.vel[2] = 0;
      s.pos[1] += s.vel[1] * dt;
      if (s.pos[1] <= 0) { s.pos[1] = 0; s.vel[1] = 0; s.onGround = true; }
      const hs = Math.hypot(s.vel[0], s.vel[2]);
      s.bob += hs * dt * 2.2;
      const bob = params.bob && s.onGround ? Math.sin(s.bob * Math.PI) * 0.035 * Math.min(1, hs / 3) : 0;
      // orbs
      let got = 0;
      s.orbs.forEach((o, i) => { if (!o.got && Math.hypot(o.x - s.pos[0], o.z - s.pos[2]) < 0.5) { o.got = true; if (navigator.vibrate) navigator.vibrate(25); } if (o.got) got++; });
      const od = new Float32Array(32);
      let n = 0; s.orbs.forEach((o) => { if (!o.got) od.set([o.x, 0.55, o.z, 2], (n++) * 4); });
      gl.bindBuffer(gl.ARRAY_BUFFER, s.orbBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, od);
      s.score.textContent = got === 8 ? 'all 8 orbs collected' : `orbs ${got} / 8`;

      const eye = [s.pos[0], s.pos[1] + 0.62 + bob, s.pos[2]];
      const look = [eye[0] + Math.sin(s.yaw) * Math.cos(s.pitch), eye[1] + Math.sin(s.pitch), eye[2] - Math.cos(s.yaw) * Math.cos(s.pitch)];
      const vp = M4.mul(M4.persp(params.fov * Math.PI / 180, ctx.aspect, 0.03, 60), M4.lookAt(eye, look));
      const lights = [];
      for (let i = 0; i < 6; i++) { const a = i * 1.05 + t * 0.2; lights.push(W / 2 + Math.cos(a) * 6, 0.85, H / 2 + Math.sin(a * 1.3) * 6); }
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.012, 0.012, 0.018, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_model: M4.ident(), u_time: t, u_eye: eye, u_lp: new Float32Array(lights), u_fwd: [Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch)] });
      gl.bindVertexArray(s.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, s.walls);
      // floor + ceiling: one stretched cube each through the model matrix
      const slab = (y) => { s.prog.set({ u_model: M4.mul(M4.translate(W / 2, y, H / 2), M4.scale(W, 0.02, H)) }); gl.bindVertexArray(s.slabVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, 1); };
      slab(0); slab(1.0);
      s.prog.set({ u_model: M4.ident() });
      gl.bindVertexArray(s.orbVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, n);
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
