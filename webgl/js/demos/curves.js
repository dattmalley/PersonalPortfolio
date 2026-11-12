/* Curve Editor — direct manipulation of a cubic Bézier spline: drag anchors
 * and handles, double-click to insert (de Casteljau split), right-click or
 * long-press to delete, Alt breaks handle symmetry, Shift snaps, arrows nudge.
 * A traveller rides the curve at constant speed; a curvature comb shows its
 * smoothness; Copy exports SVG path data with the Clipboard API. */
(function () {
  const S = window.Sandbox;
  const MAXI = 6000;

  const VS = `
layout(location = 0) in vec4 a_seg;   // x0, y0, x1, y1 (css px)
layout(location = 1) in vec4 a_col;
layout(location = 2) in vec2 a_wk;    // width, kind (0 line, 1 circle, 2 square)
uniform vec2 u_res;
out vec2 v_q; out vec4 v_col; out vec2 v_wk; out float v_len;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 a = a_seg.xy, b = a_seg.zw;
  vec2 d = b - a; float L = length(d); vec2 t = L > 1e-4 ? d / L : vec2(1, 0), n = vec2(-t.y, t.x);
  float w = a_wk.x * 0.5 + 1.5;
  vec2 p = mix(a, b, corner.x * 0.5 + 0.5) + t * corner.x * w + n * corner.y * w;
  v_q = vec2((corner.x * 0.5 + 0.5) * (L + 2.0 * w) - w, corner.y * w); v_col = a_col; v_wk = a_wk; v_len = L;
  vec2 c = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
  const FS = `
in vec2 v_q; in vec4 v_col; in vec2 v_wk; in float v_len; out vec4 o;
void main() {
  float r = v_wk.x * 0.5, d;
  if (v_wk.y < 0.5) { vec2 q = vec2(v_q.x - clamp(v_q.x, 0.0, v_len), v_q.y); d = length(q) - r; }
  else if (v_wk.y < 1.5) { d = length(v_q) - r; }
  else { vec2 q = abs(v_q) - r; d = max(q.x, q.y); }
  float a = clamp(0.5 - d, 0.0, 1.0) * v_col.a;
  if (a <= 0.0) discard;
  o = vec4(v_col.rgb * a, a);
}`;

  const RED = [1, 0.231, 0.306, 1], BLUE = [0.231, 0.545, 1, 1], BONE = [0.93, 0.91, 0.87, 1], DIM = [0.93, 0.91, 0.87, 0.35];
  const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; };
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  S.register({
    id: 'curves',
    title: 'Curve Editor',
    category: 'Animation',
    thumb: 'wide',
    hint: 'drag points · double-click to add · right-click / long-press to delete',
    description: 'Direct manipulation, the core of every vector and animation tool, rendered entirely as GPU signed-distance shapes. Drag anchors and their handles, which stay mirrored unless you hold Alt. Double-click the curve to insert a point exactly where you clicked, using a de Casteljau split so the shape is unchanged. Right-click or long-press deletes, Shift snaps to the grid and the arrow keys nudge. A traveller rides the curve at constant speed, a curvature comb shows how smooth it is, and Copy SVG puts the path on your clipboard.',
    interact: [['Drag anchor / handle', 'Reshape (handles mirror)'], ['Alt + drag handle', 'Break symmetry (cusp)'], ['Double-click curve', 'Insert a point (shape preserved)'], ['Right-click / long-press', 'Delete a point'], ['Shift', 'Snap to 20 px grid'], ['Arrows · Delete', 'Nudge / remove the selected point'], ['Copy SVG', 'Clipboard API export']],
    features: ['SDF line & handle rendering', 'De Casteljau subdivision', 'Arc-length sampling', 'Curvature comb', 'Clipboard API'],
    params: [
      { key: 'comb', label: 'Curvature comb', type: 'toggle', value: true },
      { key: 'speed', label: 'Traveller speed', type: 'range', min: 0, max: 900, step: 10, value: 260 },
      { key: 'closed', label: 'Closed path', type: 'toggle', value: false },
      { key: 'copy', label: 'Copy SVG path', type: 'button' },
      { key: 'reset', label: 'Reset curve', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const data = new Float32Array(MAXI * 10);
      const buf = util.buffer(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const s = {
        prog: util.program(VS, FS), data, buf,
        vao: util.vao([{ buffer: buf, loc: 0, size: 4, stride: 40, divisor: 1 }, { buffer: buf, loc: 1, size: 4, stride: 40, offset: 16, divisor: 1 }, { buffer: buf, loc: 2, size: 2, stride: 40, offset: 32, divisor: 1 }]),
        pts: null, drag: null, sel: 0, dist: 0, lastTap: 0, pressT: 0,
      };
      reset(ctx, s);
      ctx.overlay.innerHTML = '<div class="ov-label" id="cv-read" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      s.read = ctx.overlay.querySelector('#cv-read');
      return s;
    },
    resize(ctx, s) { if (!s.drag) reset(ctx, s, true); },
    action(ctx, s, key) {
      if (key === 'reset') reset(ctx, s);
      if (key === 'copy') {
        const d = toSVG(s, ctx.params.closed);
        (navigator.clipboard ? navigator.clipboard.writeText(d) : Promise.reject()).then(() => { s.flash = 'SVG path copied to clipboard'; }, () => { s.flash = 'clipboard unavailable · ' + d.slice(0, 40) + '…'; });
        s.flashT = ctx.time;
      }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const P = s.pts;
      const hitPoint = (x, y) => {
        let best = null, bd = 14 * 14;
        P.forEach((a, i) => {
          [['in', a.in], ['out', a.out], ['p', a.p]].forEach(([k, q]) => { if (k !== 'p' && i !== s.sel) return; const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; best = { i, k }; } });
        });
        return best;
      };
      const segs = () => { const n = params.closed ? P.length : P.length - 1; const out = []; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % P.length]; out.push([a.p, a.out, b.in, b.p, i]); } return out; };
      // press: pick a point / handle
      if (input.down && !s.drag && !s.pressed) {
        s.pressed = true; s.pressT = t;
        const h = hitPoint(input.x, input.y);
        if (h) { s.drag = h; s.sel = h.i; }
        if (input.button === 2 && h && h.k === 'p' && P.length > 2) { P.splice(h.i, 1); s.sel = Math.min(s.sel, P.length - 1); s.drag = null; }
      }
      if (!input.down) { s.pressed = false; s.drag = null; s.longDone = false; }
      // long-press delete (touch)
      if (s.drag && s.drag.k === 'p' && !s.longDone && t - s.pressT > 0.6 && (input.pointers.values().next().value || {}).moved < 6 && P.length > 2) { P.splice(s.drag.i, 1); s.sel = Math.min(s.sel, P.length - 1); s.drag = null; s.longDone = true; if (navigator.vibrate) navigator.vibrate(15); }
      // drag
      if (s.drag && (input.dragDX || input.dragDY)) {
        const a = P[s.drag.i];
        let x = input.x, y = input.y;
        if (input.shift) { x = Math.round(x / 20) * 20; y = Math.round(y / 20) * 20; }
        const alt = input.keys.has('AltLeft') || input.keys.has('AltRight');
        if (s.drag.k === 'p') { const dx = x - a.p[0], dy = y - a.p[1]; a.p = [x, y]; a.in = [a.in[0] + dx, a.in[1] + dy]; a.out = [a.out[0] + dx, a.out[1] + dy]; }
        else {
          a[s.drag.k] = [x, y];
          if (!alt && !a.broken) { const o = s.drag.k === 'in' ? 'out' : 'in'; const len = Math.hypot(a[o][0] - a.p[0], a[o][1] - a.p[1]); const v = [a.p[0] - x, a.p[1] - y], vl = Math.hypot(...v) || 1; a[o] = [a.p[0] + v[0] / vl * len, a.p[1] + v[1] / vl * len]; }
          else a.broken = true;
        }
      }
      // double-click on the curve → split
      for (const c of input.clicks) {
        if (c.button !== 0) continue;
        const now = performance.now();
        if (now - s.lastTap < 320) {
          let best = null, bd = 18 * 18;
          for (const sg of segs()) for (let k = 0; k <= 60; k++) { const q = bez(sg[0], sg[1], sg[2], sg[3], k / 60); const d = (q[0] - c.x) ** 2 + (q[1] - c.y) ** 2; if (d < bd) { bd = d; best = { sg, t: k / 60 }; } }
          if (best) split(P, best.sg[4], best.t), (s.sel = best.sg[4] + 1);
          s.lastTap = 0;
        } else s.lastTap = now;
      }
      // keyboard nudge / delete
      const a = P[s.sel];
      if (a) {
        const st = input.shift ? 10 : 1;
        const nud = (dx, dy) => { a.p = [a.p[0] + dx, a.p[1] + dy]; a.in = [a.in[0] + dx, a.in[1] + dy]; a.out = [a.out[0] + dx, a.out[1] + dy]; };
        if (input.pressed.has('ArrowLeft')) nud(-st, 0); if (input.pressed.has('ArrowRight')) nud(st, 0);
        if (input.pressed.has('ArrowUp')) nud(0, -st); if (input.pressed.has('ArrowDown')) nud(0, st);
        if ((input.pressed.has('Delete') || input.pressed.has('Backspace')) && P.length > 2) { P.splice(s.sel, 1); s.sel = Math.max(0, s.sel - 1); }
      }

      // ---- build draw list
      const list = [];
      const line = (p, q, w, col) => list.push([p[0], p[1], q[0], q[1], ...col, w, 0]);
      const dot = (p, w, col, kind = 1) => list.push([p[0], p[1], p[0], p[1], ...col, w, kind]);
      // grid
      for (let x = 0; x < ctx.cssWidth; x += 40) line([x, 0], [x, ctx.cssHeight], 1, [0.93, 0.91, 0.87, 0.05]);
      for (let y = 0; y < ctx.cssHeight; y += 40) line([0, y], [ctx.cssWidth, y], 1, [0.93, 0.91, 0.87, 0.05]);
      // sample the curve once (also used for arc length + comb)
      const samples = [];
      for (const sg of segs()) for (let k = 0; k < 48; k++) { const u = k / 48; samples.push({ p: bez(sg[0], sg[1], sg[2], sg[3], u), sg, u }); }
      const last = segs().slice(-1)[0]; if (last && !params.closed) samples.push({ p: last[3], sg: last, u: 1 });
      if (params.closed && samples.length) samples.push({ ...samples[0] });
      for (let i = 1; i < samples.length; i++) {
        const k = i / samples.length;
        line(samples[i - 1].p, samples[i].p, 3, [1 - k * 0.77, 0.231 + k * 0.31, 0.306 + k * 0.69, 1]);
      }
      if (params.comb) for (let i = 0; i < samples.length; i += 2) {
        const { sg, u, p } = samples[i];
        const e = 0.002, a0 = bez(sg[0], sg[1], sg[2], sg[3], Math.max(0, u - e)), a1 = bez(sg[0], sg[1], sg[2], sg[3], Math.min(1, u + e));
        const d1 = [(a1[0] - a0[0]) / (2 * e), (a1[1] - a0[1]) / (2 * e)];
        const b0 = bez(sg[0], sg[1], sg[2], sg[3], Math.max(0, u - 2 * e)), b1 = bez(sg[0], sg[1], sg[2], sg[3], Math.min(1, u + 2 * e));
        const d2 = [(b1[0] - 2 * p[0] + b0[0]) / (4 * e * e), (b1[1] - 2 * p[1] + b0[1]) / (4 * e * e)];
        const sp = Math.hypot(...d1) || 1, curv = (d1[0] * d2[1] - d1[1] * d2[0]) / (sp * sp * sp);
        const n = [-d1[1] / sp, d1[0] / sp];
        line(p, [p[0] + n[0] * curv * 2500, p[1] + n[1] * curv * 2500], 1, [0.231, 0.545, 1, 0.45]);
      }
      // handles + anchors
      P.forEach((q, i) => {
        if (i === s.sel) { line(q.p, q.in, 1, DIM); line(q.p, q.out, 1, DIM); dot(q.in, 9, BLUE); dot(q.out, 9, BLUE); }
        dot(q.p, i === s.sel ? 14 : 11, i === s.sel ? RED : BONE, 2);
      });
      // traveller at constant speed along the sampled polyline
      let total = 0; const L = [0];
      for (let i = 1; i < samples.length; i++) { total += Math.hypot(samples[i].p[0] - samples[i - 1].p[0], samples[i].p[1] - samples[i - 1].p[1]); L.push(total); }
      s.dist = (s.dist + params.speed * dt) % Math.max(total, 1);
      let j = 1; while (j < L.length - 1 && L[j] < s.dist) j++;
      if (samples.length > 1) {
        const k = (s.dist - L[j - 1]) / Math.max(L[j] - L[j - 1], 1e-6), pos = lerp2(samples[j - 1].p, samples[j].p, k);
        for (let g = 6; g > 0; g--) dot(pos, 10 + g * 6, [1, 0.231, 0.306, 0.06], 1);
        dot(pos, 12, BONE, 1);
      }
      const n = Math.min(list.length, MAXI);
      list.slice(0, n).forEach((o, i) => s.data.set(o, i * 10));
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data, 0, n * 10);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.036, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.prog.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight] });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
      const hov = input.hover && hitPoint(input.x, input.y);
      ctx.canvas.style.cursor = s.drag ? 'grabbing' : hov ? 'grab' : 'crosshair';
      s.read.textContent = s.flash && t - s.flashT < 2.5 ? s.flash : `${P.length} anchors · length ${total.toFixed(0)} px · ${a ? `selected (${a.p[0].toFixed(0)}, ${a.p[1].toFixed(0)})` : ''}`;
    },
  });

  function reset(ctx, s, keepShape) {
    const W = ctx.cssWidth, H = ctx.cssHeight;
    if (keepShape && s.pts) return;
    const ys = [0.6, 0.35, 0.65, 0.4, 0.6];
    s.pts = ys.map((y, i) => { const x = W * (0.12 + i * 0.19), p = [x, H * y], h = W * 0.07; return { p, in: [x - h, H * y + (i % 2 ? -1 : 1) * H * 0.12], out: [x + h, H * y - (i % 2 ? -1 : 1) * H * 0.12] }; });
    s.sel = 2;
  }
  function split(P, i, t) {
    const a = P[i], b = P[(i + 1) % P.length];
    const p01 = lerp2(a.p, a.out, t), p12 = lerp2(a.out, b.in, t), p23 = lerp2(b.in, b.p, t);
    const p012 = lerp2(p01, p12, t), p123 = lerp2(p12, p23, t), mid = lerp2(p012, p123, t);
    a.out = p01; b.in = p23;
    P.splice(i + 1, 0, { p: mid, in: p012, out: p123 });
  }
  function toSVG(s, closed) {
    const P = s.pts, f = (q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    let d = `M ${f(P[0].p)}`;
    const n = closed ? P.length : P.length - 1;
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % P.length]; d += ` C ${f(a.out)}, ${f(b.in)}, ${f(b.p)}`; }
    return d + (closed ? ' Z' : '');
  }
})();
