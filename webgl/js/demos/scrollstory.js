/* Scroll Story — real DOM scrolling drives a WebGL camera. A scrollable
 * editorial column sits over the stage; its scroll progress moves the camera
 * along a spline through five scenes, with lighting and fog shifting per
 * chapter. The canvas forwards wheel and touch scrolling to the column. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, damp } = S.math;
  const CH = [
    { k: 'I', t: 'Departure', b: 'Scroll, and the camera leaves the ground. Every pixel of this motion comes from the scroll position of the column you are reading.' },
    { k: 'II', t: 'The colonnade', b: 'Forty pillars rise and fall in waves. The camera threads between them on a Catmull-Rom spline, eased by a critically damped follower.' },
    { k: 'III', t: 'The knot', b: 'A torus knot turns slowly in red light. The chapter you are reading sets the palette, fog density and key light.' },
    { k: 'IV', t: 'Inside the sphere', b: 'Through the shell and into the blueprint. Scroll back up and everything reverses exactly: scroll position is the timeline.' },
    { k: 'V', t: 'Horizon', b: 'The sun sets on a field of cubes. This is the scroll-driven storytelling used on product and editorial sites.' },
  ];
  const KEYS = [ // camera eye / target per chapter boundary
    [[0, 1.5, 12], [0, 1.2, 0]], [[6, 2.2, 2], [0, 1.4, -6]], [[-3, 3.0, -12], [0, 2.2, -18]], [[0, 2.4, -26], [0, 2.4, -30]], [[4, 4, -38], [0, 1, -52]], [[0, 9, -44], [0, 0.5, -60]],
  ];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_inst;
uniform mat4 u_vp; uniform mat4 u_model; uniform bool u_inst; uniform float u_time;
out vec3 v_n; out vec3 v_w;
void main() {
  vec3 p = a_pos; vec4 w;
  if (u_inst) { float h = a_inst.w * (0.7 + 0.3 * sin(u_time * 1.2 + a_inst.x * 0.6 + a_inst.z * 0.4)); p = vec3(p.x * 0.6, (p.y + 0.5) * h, p.z * 0.6); w = vec4(p + a_inst.xyz, 1.0); }
  else w = u_model * vec4(p, 1.0);
  v_n = u_inst ? a_nrm : mat3(u_model) * a_nrm; v_w = w.xyz;
  gl_Position = u_vp * w;
}`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; out vec4 o;
uniform vec3 u_col; uniform vec3 u_eye; uniform vec3 u_key; uniform vec3 u_fogc; uniform float u_fog; uniform int u_kind;
void main() {
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  if (u_kind == 1) { vec2 g = abs(fract(v_w.xz * 0.5) - 0.5) / fwidth(v_w.xz * 0.5); float line = 1.0 - min(min(g.x, g.y), 1.0); vec3 c = vec3(0.03) + line * u_key * 0.12; o = vec4(mix(c, u_fogc, 1.0 - exp(-length(v_w - u_eye) * u_fog)), 1.0); return; }
  if (u_kind == 2) { o = vec4(u_col, 1.0); return; }
  vec3 V = normalize(u_eye - v_w), L = normalize(vec3(0.4, 0.8, 0.3));
  float d = max(dot(n, L), 0.0), fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  vec3 c = u_col * (0.12 + 0.88 * d) * u_key + fres * u_key * 0.5;
  o = vec4(mix(c, u_fogc, 1.0 - exp(-length(v_w - u_eye) * u_fog)), 1.0);
}`;

  const cr = (a, b, c, d, t) => a.map((_, i) => 0.5 * (2 * b[i] + (-a[i] + c[i]) * t + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t * t + (-a[i] + 3 * b[i] - 3 * c[i] + d[i]) * t * t * t));
  const along = (p, idx) => {
    const n = KEYS.length - 1, f = Math.min(n - 1e-6, Math.max(0, p * n)), i = Math.floor(f), t = f - i;
    const K = (j) => KEYS[Math.max(0, Math.min(n, j))][idx];
    return cr(K(i - 1), K(i), K(i + 1), K(i + 2), t);
  };

  S.register({
    id: 'scrollstory',
    title: 'Scroll Story',
    category: 'Animation',
    thumb: 'tall',
    hint: 'scroll the story column (or the canvas)',
    description: 'Scroll-driven storytelling, the technique behind product launch pages, with genuine DOM scrolling. The text column is a real scrollable element; its scroll position becomes a 0–1 timeline that moves the camera along a spline through five scenes and crossfades palette, fog and light per chapter. Wheel and touch scrolling over the canvas are forwarded to the column, and scrolling back plays everything in reverse.',
    interact: [['Scroll the column', 'Drive the camera through the story'], ['Wheel / drag over the canvas', 'Forwarded to the column'], ['Chapter list', 'Click a chapter to scroll smoothly to it']],
    features: ['DOM scroll → WebGL timeline', 'Spline camera path', 'Per-chapter palette crossfade', 'Damped scroll follower', 'Instanced colonnade'],
    params: [
      { key: 'smooth', label: 'Scroll smoothing', type: 'range', min: 1, max: 20, step: 0.5, value: 5 },
      { key: 'auto', label: 'Auto-scroll when idle', type: 'toggle', value: true },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const cols = [];
      for (let i = 0; i < 40; i++) { const side = i % 2 ? 1 : -1; cols.push(side * (2.4 + (i % 4 === 0 ? 0.4 : 0)), 0, -2 - Math.floor(i / 2) * 1.0, 2 + (i % 5) * 0.6); }
      for (let i = 0; i < 160; i++) cols.push((Math.random() - 0.5) * 30, 0, -46 - Math.random() * 24, 0.3 + Math.random() * 1.8);
      const instBuf = util.buffer(gl.ARRAY_BUFFER, new Float32Array(cols));
      const s = {
        prog: util.program(VS, FS),
        cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        instVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: instBuf, loc: 2, size: 4, divisor: 1 }]),
        knot: S.geo.upload(util, S.geo.torusKnot(260, 36, 0.35, 2.2, 0.9)), sphere: S.geo.upload(util, S.geo.sphere(64, 32, 1)),
        p: 0, idle: 0,
      };
      ctx.overlay.innerHTML = `
        <div id="ss-col" style="position:absolute;top:14px;right:14px;bottom:14px;width:min(380px,42%);overflow-y:auto;pointer-events:auto;scrollbar-width:thin;background:linear-gradient(90deg,transparent,rgba(6,7,8,.72) 18%);padding:0 26px 0 46px">
          <div style="height:38vh"></div>
          ${CH.map((c, i) => `<section data-i="${i}" style="min-height:62vh;padding:24px 0;opacity:.35;transition:opacity .4s">
            <div style="font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--red)">CHAPTER ${c.k}</div>
            <h3 style="font-family:var(--serif);font-weight:400;font-size:38px;line-height:1;margin:10px 0 14px;color:var(--text)">${c.t}</h3>
            <p style="font-size:14.5px;line-height:1.65;color:var(--text-2)">${c.b}</p></section>`).join('')}
          <div style="height:40vh"></div>
        </div>
        <div id="ss-rail" style="position:absolute;right:calc(min(380px,42%) + 14px);top:24%;bottom:24%;width:1px;background:rgba(236,233,226,.15)"><i id="ss-fill" style="position:absolute;left:-0.5px;top:0;width:2px;background:linear-gradient(#3b8bff,#ff3b4e)"></i></div>`;
      s.col = ctx.overlay.querySelector('#ss-col'); s.fill = ctx.overlay.querySelector('#ss-fill');
      s.secs = [...ctx.overlay.querySelectorAll('#ss-col section')];
      s.secs.forEach((sec) => sec.addEventListener('click', () => sec.scrollIntoView({ behavior: 'smooth', block: 'center' })));
      s.col.addEventListener('scroll', () => { s.idle = 0; }, { passive: true });
      return s;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      // forward canvas wheel / drag to the DOM column
      if (input.wheel) s.col.scrollTop += input.wheel;
      if (input.dragging) s.col.scrollTop -= input.dragDY * 1.5;
      s.idle += dt;
      if (params.auto && s.idle > 3 && !input.hover) { s.col.scrollTop += dt * 70; if (s.col.scrollTop >= s.col.scrollHeight - s.col.clientHeight - 1) s.col.scrollTop = 0; s.idle = 3.01; }
      const max = Math.max(1, s.col.scrollHeight - s.col.clientHeight);
      const target = s.col.scrollTop / max;
      s.p += (target - s.p) * damp(params.smooth, dt);
      s.fill.style.height = s.p * 100 + '%';
      const chapF = s.p * (CH.length - 1e-3), chap = Math.floor(chapF);
      s.secs.forEach((sec, i) => { sec.style.opacity = i === chap ? '1' : '.35'; });
      // palette crossfade per chapter
      const PAL = [[S.BLUE, [0.02, 0.025, 0.05], 0.03], [[0.9, 0.88, 0.84], [0.03, 0.03, 0.04], 0.04], [S.RED, [0.06, 0.015, 0.025], 0.05], [S.BLUE, [0.01, 0.02, 0.05], 0.06], [[1.0, 0.55, 0.45], [0.08, 0.03, 0.04], 0.025]];
      const a = PAL[Math.min(chap, 4)], b = PAL[Math.min(chap + 1, 4)], k = chapF - chap;
      const mixv = (x, y) => x.map((v, i) => v + (y[i] - v) * k);
      const key = mixv(a[0], b[0]), fogc = mixv(a[1], b[1]), fog = a[2] + (b[2] - a[2]) * k;
      const eye = along(s.p, 0), at = along(Math.min(1, s.p + 0.02), 1);
      const vp = M4.mul(M4.persp(0.9, ctx.aspect, 0.1, 200), M4.lookAt(eye, at));
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(fogc[0], fogc[1], fogc[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const P = s.prog.use().set({ u_vp: vp, u_eye: eye, u_key: key, u_fogc: fogc, u_fog: fog, u_time: t, u_inst: false });
      P.set({ u_kind: 1, u_model: M4.mul(M4.translate(0, -0.05, -30), M4.scale(80, 0.1, 100)) }); gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
      P.set({ u_kind: 0, u_inst: true, u_col: [0.75, 0.74, 0.72] }); gl.bindVertexArray(s.instVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, 200);
      P.set({ u_inst: false, u_col: S.RED, u_model: M4.mul(M4.translate(0, 2.4, -18), M4.mul(M4.rotY(t * 0.3), M4.rotX(t * 0.2))) }); s.knot.draw();
      P.set({ u_col: S.BLUE, u_model: M4.mul(M4.translate(0, 2.4, -30), M4.scale(3.2)) }); s.sphere.draw();
      P.set({ u_col: [0.9, 0.88, 0.84], u_model: M4.mul(M4.translate(0, 2.4, -30), M4.mul(M4.rotY(t), M4.scale(0.6))) }); s.knot.draw();
      P.set({ u_kind: 2, u_col: [1.0, 0.45, 0.4], u_model: M4.mul(M4.translate(0, 6, -75), M4.scale(7)) }); s.sphere.draw();
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
