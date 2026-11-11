/* Transform Gizmo — the editor interaction from every 3D tool. Click an object
 * to select it, then drag the translate arrows, rotation rings or scale
 * handles. Axis dragging uses closest-point-between-lines maths; rotation uses
 * ray–plane intersection. Snapping, undo and keyboard modes included. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Q, Ray, damp } = S.math;
  const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const AXC = [S.RED, [0.93, 0.91, 0.87], S.BLUE];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_n; out vec3 v_w;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_n = mat3(u_model) * a_nrm; v_w = w.xyz; gl_Position = u_vp * w; }`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; out vec4 o;
uniform vec3 u_col; uniform int u_kind; uniform vec3 u_eye; uniform float u_sel;
void main() {
  vec3 n = normalize(v_n);
  if (u_kind == 1) { o = vec4(u_col, 1.0); return; }                 // gizmo: unlit
  if (u_kind == 2) {                                                 // floor grid
    vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz); float line = 1.0 - min(min(g.x, g.y), 1.0);
    vec2 g2 = abs(fract(v_w.xz / 5.0) - 0.5) / fwidth(v_w.xz / 5.0); float major = 1.0 - min(min(g2.x, g2.y), 1.0);
    float f = exp(-length(v_w.xz) * 0.08);
    o = vec4(vec3(0.03, 0.032, 0.042) + (line * 0.05 + major * 0.12) * f, 1.0); return;
  }
  vec3 V = normalize(u_eye - v_w), L = normalize(vec3(0.4, 0.9, 0.3));
  float d = max(dot(n, L), 0.0), sp = pow(max(dot(reflect(-L, n), V), 0.0), 40.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  vec3 c = u_col * (0.2 + 0.8 * d) + sp * 0.4 + fres * mix(vec3(0.1), RED, u_sel) * (0.4 + u_sel);
  o = vec4(c, 1.0);
}`;

  function closest(o, a, r, d) { // param along axis line (o,a) closest to ray (r,d), and the distance
    const w0 = V3.sub(o, r), b = V3.dot(a, d), d0 = V3.dot(a, w0), e = V3.dot(d, w0), den = 1 - b * b;
    if (Math.abs(den) < 1e-5) return { s: 0, dist: 1e9 };
    const sc = (b * e - d0) / den, tc = (e - b * d0) / den;
    return { s: sc, dist: V3.len(V3.sub(V3.add(w0, V3.scale(a, sc)), V3.scale(d, tc))), t: tc };
  }

  S.register({
    id: 'gizmo',
    title: 'Transform Gizmo',
    category: 'Selection',
    thumb: 'square',
    hint: 'click an object · drag the handles · W E R switch modes · Ctrl+Z undo',
    description: 'The manipulator from every 3D editor, written out in full. Clicking selects an object by ray-casting its bounds. Translate arrows move it along an axis using the closest point between the mouse ray and that axis. Rotation rings intersect the ray with the ring\'s plane and measure the swept angle. Scale handles stretch per axis or uniformly. The gizmo keeps a constant on-screen size, and moves can snap and be undone.',
    interact: [['Click', 'Select / deselect an object'], ['Drag a handle', 'Translate, rotate or scale on that axis'], ['W / E / R', 'Translate / rotate / scale mode'], ['Ctrl (hold) or Snap', 'Snap to 0.25 units / 15°'], ['Ctrl+Z / Undo', 'Undo the last transform'], ['Drag empty space', 'Orbit']],
    features: ['Ray–axis closest-point dragging', 'Ray–plane rotation', 'Quaternion orientation', 'Constant screen-size gizmo', 'Undo stack'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Translate', 'Rotate', 'Scale'], value: 0 },
      { key: 'snap', label: 'Snap', type: 'toggle', value: false },
      { key: 'undo', label: 'Undo', type: 'button' },
      { key: 'reset', label: 'Reset scene', type: 'button' },
    ],
    init(ctx) {
      const { util, gl } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const s = {
        prog: util.program(VS, FS),
        cube: { draw() { gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36); } },
        cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        sphere: S.geo.upload(util, S.geo.sphere(48, 24, 0.5)), torus: S.geo.upload(util, S.geo.torus(96, 20, 0.42, 0.14)),
        knot: S.geo.upload(util, S.geo.torusKnot(200, 24, 0.12, 0.4, 0.18)), ring: S.geo.upload(util, S.geo.torus(128, 8, 1, 0.012)),
        cam: new S.OrbitCam({ dist: 9, pitch: 0.5, yaw: 0.7, minDist: 4, maxDist: 20, target: [0, 0.6, 0] }),
        sel: 0, hover: null, drag: null, history: [], wasDown: false,
      };
      reset(s);
      ctx.overlay.innerHTML = '<div class="ov-label" id="gz-read" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      s.read = ctx.overlay.querySelector('#gz-read');
      return s;
    },
    action(ctx, s, key) {
      if (key === 'undo') undo(s);
      if (key === 'reset') { reset(s); s.history.length = 0; }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const k = input.keys;
      if (input.pressed.has('KeyW')) ctx.syncParam('mode', 0);
      if (input.pressed.has('KeyE')) ctx.syncParam('mode', 1);
      if (input.pressed.has('KeyR')) ctx.syncParam('mode', 2);
      if (input.pressed.has('KeyZ') && (k.has('ControlLeft') || k.has('MetaLeft') || k.has('ControlRight') || k.has('MetaRight'))) undo(s);
      const snap = params.snap || k.has('ControlLeft') || k.has('ControlRight');
      const ray = s.cam.ray(input.nx, input.ny, ctx.aspect);
      const obj = s.sel >= 0 ? s.objs[s.sel] : null;
      const size = obj ? V3.len(V3.sub(s.cam.eye(), obj.pos)) * 0.16 : 1;
      // ---- hover test against the active gizmo
      const handleAt = (r) => {
        if (!obj) return null;
        let best = null, bd = 1e9;
        if (params.mode === 1) {
          AX.forEach((a, i) => { const h = Ray.plane(r.origin, r.dir, obj.pos, a); if (!h) return; const rr = V3.len(V3.sub(h, obj.pos)); const err = Math.abs(rr - size); const dd = V3.len(V3.sub(h, r.origin)); if (err < size * 0.12 && dd < bd) { bd = dd; best = { axis: i }; } });
        } else {
          AX.forEach((a, i) => { const c = closest(obj.pos, a, r.origin, r.dir); if (c.s > 0 && c.s < size * 1.15 && c.dist < size * 0.09 && c.t < bd) { bd = c.t; best = { axis: i }; } });
          if (params.mode === 2 && !best) { const c = Ray.sphere(r.origin, r.dir, obj.pos, size * 0.14); if (c) best = { axis: 3 }; }
        }
        return best;
      };
      if (!input.down) s.hover = input.hover ? handleAt(ray) : null;
      // ---- press: decide gizmo drag vs selection vs orbit
      if (input.down && !s.wasDown) {
        const h = handleAt(ray);
        if (h && obj) {
          const a = AX[h.axis] || [0, 0, 0];
          s.drag = { ...h, pos0: obj.pos.slice(), rot0: obj.rot.slice(), scl0: obj.scl.slice(), y0: input.y };
          if (params.mode === 1) { const p = Ray.plane(ray.origin, ray.dir, obj.pos, a); s.drag.v0 = p ? V3.sub(p, obj.pos) : null; }
          else if (h.axis < 3) s.drag.s0 = closest(obj.pos, a, ray.origin, ray.dir).s;
          s.history.push(snapshot(s));
          if (s.history.length > 50) s.history.shift();
        }
      }
      if (!input.down) s.drag = null;
      for (const c of input.clicks) {
        if (s.dragMoved) break;
        const r = s.cam.ray(c.uvx * 2 - 1, c.uvy * 2 - 1, ctx.aspect);
        if (handleAt(r)) continue;
        let best = -1, bd = 1e9;
        s.objs.forEach((o, i) => { const tt = Ray.sphere(r.origin, r.dir, o.pos, o.radius * Math.max(...o.scl)); if (tt && tt < bd) { bd = tt; best = i; } });
        s.sel = best;
      }
      s.dragMoved = false;
      // ---- apply drag
      if (s.drag && obj) {
        s.dragMoved = true;
        const d = s.drag, a = AX[d.axis];
        if (params.mode === 0) {
          const c = closest(d.pos0, a, ray.origin, ray.dir);
          let delta = c.s - d.s0; if (snap) delta = Math.round(delta / 0.25) * 0.25;
          obj.pos = V3.add(d.pos0, V3.scale(a, delta));
        } else if (params.mode === 1 && d.v0) {
          const p = Ray.plane(ray.origin, ray.dir, obj.pos, a);
          if (p) {
            const v1 = V3.sub(p, obj.pos);
            let ang = Math.atan2(V3.dot(a, V3.cross(d.v0, v1)), V3.dot(d.v0, v1));
            if (snap) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
            obj.rot = Q.norm(Q.mul(Q.axisAngle(a, ang), d.rot0));
            s.angle = ang;
          }
        } else if (params.mode === 2) {
          if (d.axis === 3) { let f = Math.exp(-(input.y - d.y0) * 0.01); if (snap) f = Math.max(0.25, Math.round(f * 4) / 4); obj.scl = d.scl0.map((v) => Math.max(0.1, v * f)); }
          else {
            const c = closest(d.pos0, a, ray.origin, ray.dir);
            let f = Math.max(0.1, c.s / Math.max(d.s0, 1e-3)); if (snap) f = Math.max(0.25, Math.round(f * 4) / 4);
            obj.scl = d.scl0.slice(); obj.scl[d.axis] = Math.max(0.1, d.scl0[d.axis] * f);
          }
        }
      } else {
        s.cam.update(input, dt);
      }
      s.wasDown = input.down;

      // ---- render
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 100), s.cam.view());
      const eye = s.cam.eye();
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.038, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const P = s.prog.use().set({ u_vp: vp, u_eye: eye });
      P.set({ u_kind: 2, u_model: M4.mul(M4.translate(0, -0.01, 0), M4.scale(60, 0.001, 60)), u_col: [0, 0, 0], u_sel: 0 }); s.cube.draw();
      s.objs.forEach((o, i) => {
        const m = M4.mul(M4.translate(...o.pos), M4.mul(Q.toMat4(o.rot), M4.scale(...o.scl)));
        P.set({ u_kind: 0, u_model: m, u_col: o.col, u_sel: i === s.sel ? 1 : 0 });
        s[o.mesh].draw();
      });
      if (obj) {
        gl.clear(gl.DEPTH_BUFFER_BIT); // gizmo always on top
        const hot = (i) => (s.drag ? s.drag.axis === i : s.hover && s.hover.axis === i);
        const col = (i) => (hot(i) ? [1, 0.85, 0.3] : AXC[i]);
        const T = M4.translate(...obj.pos);
        if (params.mode === 1) {
          AX.forEach((a, i) => {
            const orient = i === 0 ? M4.rotZ(Math.PI / 2) : i === 2 ? M4.rotX(Math.PI / 2) : M4.ident();
            P.set({ u_kind: 1, u_col: col(i), u_model: M4.mul(T, M4.mul(orient, M4.scale(size))) }); s.ring.draw();
          });
        } else {
          AX.forEach((a, i) => {
            const shaft = M4.mul(T, M4.mul(M4.translate(...V3.scale(a, size * 0.5)), M4.scale(...a.map((v) => (v ? size : size * 0.025)))));
            P.set({ u_kind: 1, u_col: col(i), u_model: shaft }); s.cube.draw();
            const head = M4.mul(T, M4.mul(M4.translate(...V3.scale(a, size)), M4.scale(size * (params.mode === 2 ? 0.12 : 0.09))));
            P.set({ u_model: params.mode === 0 ? M4.mul(head, M4.scale(1)) : head }); (params.mode === 0 ? s.sphere : s.cube).draw();
          });
          if (params.mode === 2) { P.set({ u_col: hot(3) ? [1, 0.85, 0.3] : [0.6, 0.6, 0.65], u_model: M4.mul(T, M4.scale(size * 0.14)) }); s.cube.draw(); }
        }
      }
      gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = s.drag ? 'grabbing' : s.hover ? 'grab' : 'default';
      s.read.textContent = obj
        ? `${obj.name} · pos ${obj.pos.map((v) => v.toFixed(2)).join(', ')} · scale ${obj.scl.map((v) => v.toFixed(2)).join(', ')}${snap ? ' · snapping' : ''} · undo ${s.history.length}`
        : 'click an object to select it';
    },
  });

  function reset(s) {
    s.objs = [
      { name: 'Cube', mesh: 'cube', pos: [-2.4, 0.5, 0], rot: Q.ident(), scl: [1, 1, 1], col: S.RED, radius: 0.87 },
      { name: 'Sphere', mesh: 'sphere', pos: [0, 0.5, -1.6], rot: Q.ident(), scl: [1, 1, 1], col: [0.85, 0.83, 0.8], radius: 0.5 },
      { name: 'Torus', mesh: 'torus', pos: [2.3, 0.6, 0.2], rot: Q.axisAngle([1, 0, 0], 1.2), scl: [1, 1, 1], col: S.BLUE, radius: 0.56 },
      { name: 'Knot', mesh: 'knot', pos: [0, 0.7, 1.8], rot: Q.ident(), scl: [1.2, 1.2, 1.2], col: [0.75, 0.3, 0.45], radius: 0.65 },
    ];
    s.sel = 0;
  }
  function snapshot(s) { return s.objs.map((o) => ({ pos: o.pos.slice(), rot: o.rot.slice(), scl: o.scl.slice() })); }
  function undo(s) { const h = s.history.pop(); if (h) h.forEach((v, i) => Object.assign(s.objs[i], { pos: v.pos, rot: v.rot, scl: v.scl })); }
})();
