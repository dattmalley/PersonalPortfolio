/* Radial Menu — marking menus as in pro creative tools. Right-click or
 * long-press opens a pie menu at the pointer; flick toward a slice and release
 * to choose. Experts can flick before the menu even appears. "Paint" opens a
 * nested submenu. The menu is a single polar-SDF fragment shader. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Ray, damp } = S.math;
  const ROOT = ['Sphere', 'Cube', 'Torus', 'Knot', 'Paint ▸', 'Grow', 'Shrink', 'Clear'];
  const PAINT = ['Red', 'Blue', 'Bone', 'Graphite', '◂ Back'];
  const COLS = { Red: S.RED, Blue: S.BLUE, Bone: [0.9, 0.88, 0.84], Graphite: [0.3, 0.31, 0.35] };

  const MENU = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform vec2 u_res; uniform vec2 u_c; uniform float u_n; uniform float u_hot; uniform float u_vis; uniform float u_r0; uniform float u_r1; uniform float u_dir; uniform float u_sub;
void main() {
  vec2 p = v_uv * u_res - u_c; p.y = -p.y;
  float r = length(p);
  float a = atan(p.y, p.x);                        // slice 0 points right, counter-clockwise
  float sl = 6.2831853 / u_n;
  float k = floor(mod(a + sl * 0.5, 6.2831853) / sl);
  float local = mod(a + sl * 0.5, sl) - sl * 0.5;
  float gap = abs(local) * r - (sl * 0.5 * r - 3.0);   // 3px gutters between slices
  float ring = max(u_r0 - r, r - u_r1);
  float d = max(ring, gap);
  float aa = clamp(0.5 - d, 0.0, 1.0);
  bool hot = abs(k - u_hot) < 0.5;
  vec3 col = hot ? mix(RED, vec3(1.0), 0.1) : (u_sub > 0.5 ? vec3(0.1, 0.12, 0.2) : vec3(0.075, 0.08, 0.095));
  float edge = clamp(0.5 - abs(d + 0.5), 0.0, 1.0) * (hot ? 0.0 : 0.35);
  vec3 c = col + edge;
  float hub = smoothstep(u_r0 * 0.42 + 1.0, u_r0 * 0.42, r);
  // direction indicator from the centre
  float dirLine = smoothstep(2.0, 0.0, abs(r - u_r0 * 0.6)) * step(abs(mod(a - u_dir + 3.14159, 6.2831853) - 3.14159), 0.35) * step(-0.5, u_hot);
  float alpha = max(aa * 0.94, max(hub * 0.9, dirLine)) * u_vis;
  c = mix(c, vec3(0.93, 0.91, 0.87), max(hub * 0.15, dirLine));
  o = vec4(c * alpha, alpha);
}`;
  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_n; out vec3 v_w;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_n = mat3(u_model) * a_nrm; v_w = w.xyz; gl_Position = u_vp * w; }`;
  const FS = `
in vec3 v_n; in vec3 v_w; out vec4 o; uniform vec3 u_col; uniform int u_kind; uniform float u_hl;
void main() {
  if (u_kind == 1) { vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz); float line = 1.0 - min(min(g.x, g.y), 1.0); o = vec4(vec3(0.04, 0.042, 0.05) + line * 0.04 * exp(-length(v_w.xz) * 0.08), 1.0); return; }
  float d = 0.3 + 0.7 * max(dot(normalize(v_n), normalize(vec3(0.3, 0.9, 0.4))), 0.0);
  o = vec4(u_col * d + u_hl * 0.18, 1.0);
}`;

  S.register({
    id: 'radial',
    title: 'Radial Menu',
    category: 'Pointer & Touch',
    thumb: 'square',
    hint: 'right-click or long-press · flick toward a slice · release',
    description: 'Marking menus, the fastest command menus there are. Right-click, or long-press on touch, opens a pie menu centred on the pointer. Moving toward a slice selects by direction alone, so distance doesn\'t matter and the motion becomes muscle memory. Experts can flick and release before the menu appears; the menu only fades in if you hesitate. Paint opens a nested submenu. The entire menu is drawn by one polar signed-distance fragment shader.',
    interact: [['Right-click / long-press', 'Open the menu at the pointer'], ['Flick + release', 'Choose by direction (works before the menu appears)'], ['Release in the centre', 'Keep the menu open; click a slice'], ['Paint ▸', 'Nested submenu'], ['Esc', 'Cancel'], ['Left-drag', 'Orbit']],
    features: ['Marking-menu gesture recognition', 'Polar SDF menu shader', 'Hierarchical (nested) menus', 'Long-press detection', 'Contextual targeting via ray picking'],
    params: [
      { key: 'delay', label: 'Menu reveal delay (ms)', type: 'range', min: 0, max: 600, step: 10, value: 260 },
      { key: 'radius', label: 'Menu radius', type: 'range', min: 80, max: 200, step: 2, value: 128 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const s = {
        menuP: util.program(S.GLSL.fullscreenVS, MENU), prog: util.program(VS, FS),
        cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        meshes: { Sphere: S.geo.upload(util, S.geo.sphere(40, 20, 0.6)), Torus: S.geo.upload(util, S.geo.torus(80, 18, 0.5, 0.18)), Knot: S.geo.upload(util, S.geo.torusKnot(200, 24, 0.13, 0.45, 0.2)) },
        objs: [], menu: null, vis: 0, cam: new S.OrbitCam({ dist: 13, pitch: 0.6, yaw: 0.5, minDist: 6, maxDist: 28 }), toast: '', toastT: -9,
      };
      [['Sphere', [-2, 0, 0], S.RED], ['Cube', [0.5, 0, -1.5], S.BLUE], ['Knot', [2.2, 0, 1], [0.9, 0.88, 0.84]]].forEach(([k, p, c]) => s.objs.push({ kind: k, pos: p, col: c.slice(), scale: 1, born: -9 }));
      ctx.overlay.innerHTML = '<div id="rm-labels" class="cap-keep" style="position:absolute;inset:0;pointer-events:none"></div><div class="ov-label" id="rm-toast" style="left:50%;transform:translateX(-50%);top:auto;bottom:64px"></div>';
      s.labels = ctx.overlay.querySelector('#rm-labels'); s.toastEl = ctx.overlay.querySelector('#rm-toast');
      return s;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const R1 = params.radius, R0 = R1 * 0.36;
      const ptrs = [...input.pointers.values()];
      const p0 = ptrs[0];
      // ---- open: right button immediately, or long-press (any pointer) without movement
      if (!s.menu && p0) {
        const held = performance.now() - p0.born;
        if (input.button === 2 || (held > 450 && p0.moved < 8 && ptrs.length === 1)) {
          s.menu = { c: [p0.x, p0.y], items: ROOT, level: 'root', t0: t, sticky: false, hot: -1, target: pick(ctx, s, p0.uvx, p0.uvy), ground: ground(ctx, s, p0.uvx, p0.uvy), quick: input.button === 2 };
          if (input.button !== 2 && navigator.vibrate) navigator.vibrate(12);
        }
      }
      if (input.pressed.has('Escape')) s.menu = null;
      const m = s.menu;
      if (m) {
        const px = p0 ? p0.x : input.x, py = p0 ? p0.y : input.y;
        const dx = px - m.c[0], dy = -(py - m.c[1]), dist = Math.hypot(dx, dy);
        const n = m.items.length, sl = (Math.PI * 2) / n;
        const ang = (Math.atan2(dy, dx) + Math.PI * 2 + sl / 2) % (Math.PI * 2);
        m.hot = dist > R0 * 0.75 ? Math.floor(ang / sl) : -1;
        m.dir = Math.atan2(dy, dx);
        const released = !input.down && !m.sticky;
        if (released) {
          if (m.hot >= 0) choose(ctx, s, m.items[m.hot]); else m.sticky = true;
          if (s.menu === m && !m.sticky) s.menu = null;
        } else if (m.sticky) {
          for (const c of input.clicks) {
            const cdx = c.x - m.c[0], cdy = -(c.y - m.c[1]), cd = Math.hypot(cdx, cdy);
            if (cd < R0 * 0.75 || cd > R1 * 1.4) { s.menu = null; break; }
            const k = Math.floor(((Math.atan2(cdy, cdx) + Math.PI * 2 + sl / 2) % (Math.PI * 2)) / sl);
            choose(ctx, s, m.items[k]);
            if (s.menu === m) s.menu = null;
            break;
          }
        }
      }
      // reveal only after hesitating (expert flicks never see it)
      const want = s.menu && (s.menu.sticky || t - s.menu.t0 > params.delay / 1000) ? 1 : 0;
      s.vis += (want - s.vis) * damp(18, dt);
      if (!s.menu) s.vis = Math.max(0, s.vis - dt * 6);
      // orbit only when no menu is involved and with the left button
      const camIn = s.menu || input.button === 2 || (p0 && performance.now() - p0.born > 400 && p0.moved < 8) ? Object.assign({}, input, { dragging: false }) : input;
      s.cam.update(camIn, dt);

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 80), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.036, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_kind: 1, u_col: [0, 0, 0], u_hl: 0, u_model: M4.mul(M4.translate(0, -0.05, 0), M4.scale(40, 0.1, 40)) });
      gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
      s.objs.forEach((o) => {
        const age = t - o.born, pop = age < 0 ? 1 : 1 - Math.exp(-age * 8) * Math.cos(age * 18) * 0.7;
        o.disp = (o.disp ?? o.scale) + (o.scale - (o.disp ?? o.scale)) * damp(10, dt);
        const sc = o.disp * pop;
        const hl = s.menu && s.menu.target === o ? 1 : 0;
        s.prog.set({ u_kind: 0, u_col: o.col, u_hl: hl, u_model: M4.mul(M4.translate(o.pos[0], 0.6 * sc, o.pos[2]), M4.mul(M4.rotY(t * 0.3 + o.pos[0]), M4.scale(sc))) });
        if (o.kind === 'Cube') { gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36); } else s.meshes[o.kind].draw();
      });
      gl.disable(gl.DEPTH_TEST);
      // menu
      const mm = s.menu;
      if (s.vis > 0.01 && mm) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        s.menuP.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_c: mm.c, u_n: mm.items.length, u_hot: mm.hot, u_vis: s.vis, u_r0: R0 * (0.85 + 0.15 * s.vis), u_r1: R1 * (0.8 + 0.2 * s.vis), u_dir: mm.dir || 0, u_sub: mm.level === 'paint' ? 1 : 0 });
        ctx.util.drawFullscreen();
        gl.disable(gl.BLEND);
      }
      // slice labels (DOM, positioned on the ring)
      if (mm && s.vis > 0.05) {
        const n = mm.items.length, sl = (Math.PI * 2) / n, rr = (R0 + R1) / 2;
        if (s.labels.childElementCount !== n || s.labels.dataset.level !== mm.level) {
          s.labels.dataset.level = mm.level;
          s.labels.innerHTML = mm.items.map((it) => `<span style="position:absolute;transform:translate(-50%,-50%);font:11px var(--mono);letter-spacing:.04em;white-space:nowrap">${it}</span>`).join('');
        }
        [...s.labels.children].forEach((el, k) => {
          const a = k * sl;
          el.style.left = mm.c[0] + Math.cos(a) * rr + 'px'; el.style.top = mm.c[1] - Math.sin(a) * rr + 'px';
          el.style.opacity = s.vis; el.style.color = k === mm.hot ? '#fff' : '#b9b6ae';
        });
      } else s.labels.innerHTML = '';
      s.toastEl.textContent = t - s.toastT < 2 ? s.toast : s.objs.length + ' objects · right-click or long-press anywhere';
      ctx.canvas.style.cursor = s.menu ? 'none' : 'default';
    },
  });

  function ground(ctx, s, uvx, uvy) { const r = s.cam.ray(uvx * 2 - 1, uvy * 2 - 1, ctx.aspect); return Ray.plane(r.origin, r.dir, [0, 0, 0], [0, 1, 0]) || [0, 0, 0]; }
  function pick(ctx, s, uvx, uvy) {
    const r = s.cam.ray(uvx * 2 - 1, uvy * 2 - 1, ctx.aspect);
    let best = null, bd = 1e9;
    for (const o of s.objs) { const tt = Ray.sphere(r.origin, r.dir, [o.pos[0], 0.6 * o.scale, o.pos[2]], 0.75 * o.scale); if (tt && tt < bd) { bd = tt; best = o; } }
    return best;
  }
  function choose(ctx, s, item) {
    const m = s.menu, t = ctx.time;
    const target = m.target || s.objs[s.objs.length - 1];
    const say = (x) => { s.toast = x; s.toastT = t; };
    if (['Sphere', 'Cube', 'Torus', 'Knot'].includes(item)) { s.objs.push({ kind: item, pos: [m.ground[0], 0, m.ground[2]], col: [0.9, 0.88, 0.84], scale: 1, born: t }); say(`${item} placed${m.sticky ? '' : ' · marked by direction'}`); }
    else if (item === 'Paint ▸') { s.menu = { ...m, items: PAINT, level: 'paint', sticky: true, hot: -1, t0: t - 1 }; say('paint submenu'); return; }
    else if (item === '◂ Back') { s.menu = { ...m, items: ROOT, level: 'root', sticky: true, hot: -1 }; return; }
    else if (COLS[item] && target) { target.col = COLS[item].slice(); say(`${target.kind} painted ${item.toLowerCase()}`); }
    else if (item === 'Grow' && target) { target.scale = Math.min(2.5, target.scale * 1.3); say(`${target.kind} grown`); }
    else if (item === 'Shrink' && target) { target.scale = Math.max(0.3, target.scale / 1.3); say(`${target.kind} shrunk`); }
    else if (item === 'Clear') { s.objs.length = 0; say('cleared'); }
    if (s.menu && s.menu.level === 'paint' && COLS[item]) s.menu = null;
  }
})();
