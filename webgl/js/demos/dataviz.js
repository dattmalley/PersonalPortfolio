/* Data Viz Explorer — the interaction vocabulary of analytics tools in 3D:
 * hover tooltips, brushing a range on the floor, click-to-isolate, legend
 * toggles, linked summary chart, and animated re-sorting. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Ray, damp } = S.math;
  const NX = 12, NZ = 8;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CATS = ['Vertex', 'Fragment', 'Texture', 'Buffer', 'Query', 'Sampler', 'Sync', 'Feedback'];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_bar;    // x, z, height, emphasis (0 faded .. 1 normal .. 2 hovered)
layout(location = 3) in float a_cat;
uniform mat4 u_vp;
out vec3 v_n; out vec3 v_w; out float v_e; out float v_cat; out float v_h;
void main() {
  vec3 p = a_pos * vec3(0.7, a_bar.z, 0.7) + vec3(a_bar.x, a_bar.z * 0.5, a_bar.y);
  v_n = a_nrm; v_w = p; v_e = a_bar.w; v_cat = a_cat; v_h = (a_pos.y + 0.5);
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in float v_e; in float v_cat; in float v_h; out vec4 o;
void main() {
  vec3 n = normalize(v_n);
  float d = 0.4 + 0.6 * max(dot(n, normalize(vec3(0.4, 0.9, 0.3))), 0.0);
  vec3 base = mix(BLUE, RED, v_cat / 7.0);
  vec3 c = base * d * (0.55 + 0.45 * v_h);
  c = mix(vec3(0.09, 0.095, 0.11) * d, c, clamp(v_e, 0.0, 1.0));
  c += max(v_e - 1.0, 0.0) * 0.35;
  o = vec4(c, 1.0);
}`;
  const FLOOR_VS = `layout(location = 0) in vec3 a_pos; uniform mat4 u_vp; uniform mat4 u_model; out vec3 v_w;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_w = w.xyz; gl_Position = u_vp * w; }`;
  const FLOOR_FS = S.GLSL.colors + `
in vec3 v_w; out vec4 o; uniform vec4 u_brush;
void main() {
  vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz); float line = 1.0 - min(min(g.x, g.y), 1.0);
  vec3 c = vec3(0.04, 0.042, 0.052) + line * 0.035;
  if (u_brush.z > u_brush.x && u_brush.w > u_brush.y && v_w.x > u_brush.x && v_w.x < u_brush.z && v_w.z > u_brush.y && v_w.z < u_brush.w) c += vec3(0.25, 0.06, 0.08) * 0.6;
  o = vec4(c, 1.0);
}`;

  S.register({
    id: 'dataviz',
    title: 'Data Viz Explorer',
    category: 'Selection',
    thumb: 'wide',
    hint: 'hover bars · drag on the floor to brush · click to isolate',
    description: 'The interaction vocabulary of analytics tools on a 3D bar chart. Hovering a bar shows a tooltip, and dragging across the floor brushes a range of months and categories so everything else fades and the linked summary updates. Clicking a bar isolates its category, the legend toggles series, and Sort re-orders the chart with springs. Picking is an exact ray-versus-box test.',
    interact: [['Hover', 'Tooltip with the exact value'], ['Drag on the floor', 'Brush a range (linked summary + sparkline)'], ['Click a bar', 'Isolate its category; click again to restore'], ['Legend', 'Toggle categories'], ['Right-drag / two fingers', 'Orbit'], ['Double-click', 'Clear brush and filters']],
    features: ['Ray–AABB picking', 'Brushing & linking', 'DOM tooltips over WebGL', 'Spring-animated re-sorting', 'Instanced bars'],
    params: [
      { key: 'sort', label: 'Sort by total', type: 'toggle', value: false },
      { key: 'shuffle', label: 'New data', type: 'button' },
      { key: 'clear', label: 'Clear brush', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const N = NX * NZ;
      const barBuf = util.buffer(gl.ARRAY_BUFFER, N * 16, gl.DYNAMIC_DRAW);
      const catBuf = util.buffer(gl.ARRAY_BUFFER, new Float32Array(Array.from({ length: N }, (_, i) => i % NZ)));
      const s = {
        prog: util.program(VS, FS), floorP: util.program(FLOOR_VS, FLOOR_FS),
        vao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: barBuf, loc: 2, size: 4, divisor: 1 }, { buffer: catBuf, loc: 3, size: 1, divisor: 1 }]),
        floorVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        barBuf, data: new Float32Array(N * 4), hidden: new Set(), isolate: -1, brush: null, hover: -1,
        cam: new S.OrbitCam({ dist: 17, pitch: 0.62, yaw: 0.55, minDist: 8, maxDist: 34, target: [0, 1.2, 0] }), lastTap: 0,
      };
      makeData(s);
      ctx.overlay.innerHTML = `
        <div id="dv-tip" style="position:absolute;display:none;pointer-events:none;background:rgba(6,7,8,.88);outline:1px solid rgba(236,233,226,.24);padding:8px 10px;font-family:var(--mono);font-size:11px;line-height:1.6;color:var(--text);white-space:nowrap"></div>
        <div id="dv-legend" style="position:absolute;left:30px;top:56px;display:flex;flex-wrap:wrap;gap:6px;max-width:60%;pointer-events:auto"></div>
        <div id="dv-sum" style="position:absolute;right:30px;top:56px;font-family:var(--mono);font-size:11px;line-height:1.7;color:var(--text-2);text-align:right"></div>`;
      s.tip = ctx.overlay.querySelector('#dv-tip'); s.sum = ctx.overlay.querySelector('#dv-sum');
      const lg = ctx.overlay.querySelector('#dv-legend');
      CATS.forEach((c, i) => {
        const b = document.createElement('button');
        const col = mixHex(i / 7);
        b.innerHTML = `<i style="display:inline-block;width:8px;height:8px;background:${col};margin-right:6px"></i>${c}`;
        b.style.cssText = 'font:11px var(--mono);color:var(--text);background:rgba(6,7,8,.6);border:1px solid rgba(236,233,226,.18);padding:4px 8px;cursor:pointer';
        b.addEventListener('click', () => { s.hidden.has(i) ? s.hidden.delete(i) : s.hidden.add(i); b.style.opacity = s.hidden.has(i) ? 0.4 : 1; });
        lg.appendChild(b);
      });
      return s;
    },
    action(ctx, s, key) { if (key === 'shuffle') makeData(s); if (key === 'clear') { s.brush = null; s.isolate = -1; } },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const orbit = input.button === 2 || input.pointers.size >= 2;
      s.cam.update(orbit ? input : Object.assign({}, input, { dragging: false }), dt);
      // layout: column order (optionally sorted by category total)
      const totals = CATS.map((_, c) => s.values.reduce((a, row) => a + row[c], 0));
      const order = CATS.map((_, i) => i);
      if (params.sort) order.sort((a, b) => totals[b] - totals[a]);
      const zOf = []; order.forEach((c, k) => (zOf[c] = (k - (NZ - 1) / 2) * 1.0));
      const xOf = (m) => (m - (NX - 1) / 2) * 1.0;
      const r = s.cam.ray(input.nx, input.ny, ctx.aspect);
      // brushing on the floor
      if (input.dragging && !orbit) {
        const p = Ray.plane(r.origin, r.dir, [0, 0, 0], [0, 1, 0]);
        if (p) { if (!s.brushing) { s.brushing = true; s.b0 = p; } s.brush = [Math.min(s.b0[0], p[0]), Math.min(s.b0[2], p[2]), Math.max(s.b0[0], p[0]), Math.max(s.b0[2], p[2])]; }
      } else s.brushing = false;
      // hover pick: ray vs each bar's box
      s.hover = -1; let best = 1e9;
      if (input.hover && !input.dragging) for (let m = 0; m < NX; m++) for (let c = 0; c < NZ; c++) {
        if (s.hidden.has(c)) continue;
        const h = s.cur[m][c], x = xOf(m), z = zOf[c];
        const hit = rayBox(r.origin, r.dir, [x - 0.35, 0, z - 0.35], [x + 0.35, h, z + 0.35]);
        if (hit !== null && hit < best) { best = hit; s.hover = m * NZ + c; }
      }
      for (const cl of input.clicks) {
        if (performance.now() - s.lastTap < 320) { s.brush = null; s.isolate = -1; s.hidden.clear(); }
        else if (s.hover >= 0) s.isolate = s.isolate === s.hover % NZ ? -1 : s.hover % NZ;
        s.lastTap = performance.now();
      }
      const inBrush = (m, c) => !s.brush || (s.brush[2] - s.brush[0] < 0.2) || (xOf(m) > s.brush[0] - 0.35 && xOf(m) < s.brush[2] + 0.35 && zOf[c] > s.brush[1] - 0.35 && zOf[c] < s.brush[3] + 0.35);
      let sum = 0, cnt = 0, max = 0; const spark = new Array(NX).fill(0);
      for (let m = 0; m < NX; m++) for (let c = 0; c < NZ; c++) {
        const visible = !s.hidden.has(c) && (s.isolate < 0 || s.isolate === c);
        const sel = visible && inBrush(m, c);
        const target = visible ? s.values[m][c] : 0.02;
        s.cur[m][c] += (target - s.cur[m][c]) * damp(8, dt);
        s.zc[c] = s.zc[c] === undefined ? zOf[c] : s.zc[c] + (zOf[c] - s.zc[c]) * damp(6, dt);
        const i = m * NZ + c;
        const emph = s.hover === i ? 2 : sel ? 1 : 0.15;
        s.em[i] = (s.em[i] ?? 1) + (emph - (s.em[i] ?? 1)) * damp(12, dt);
        s.data.set([xOf(m), s.zc[c], Math.max(0.02, s.cur[m][c]), s.em[i]], i * 4);
        if (sel) { sum += s.values[m][c]; cnt++; max = Math.max(max, s.values[m][c]); spark[m] += s.values[m][c]; }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.barBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data);
      // tooltip + linked summary
      if (s.hover >= 0) {
        const m = Math.floor(s.hover / NZ), c = s.hover % NZ;
        s.tip.style.display = 'block'; s.tip.style.left = input.x + 14 + 'px'; s.tip.style.top = input.y + 14 + 'px';
        s.tip.innerHTML = `<span style="color:${mixHex(c / 7)}">■</span> ${CATS[c]} · ${MONTHS[m]}<br><b style="font-weight:500;font-size:14px">${(s.values[m][c] * 1000).toFixed(0)}</b> calls`;
      } else s.tip.style.display = 'none';
      const mx = Math.max(...spark, 1e-6);
      const path = spark.map((v, i) => `${i ? 'L' : 'M'}${(i / (NX - 1)) * 160},${36 - (v / mx) * 32}`).join(' ');
      s.sum.innerHTML = `${s.brush && s.brush[2] - s.brush[0] > 0.2 ? 'brushed selection' : s.isolate >= 0 ? 'isolated · ' + CATS[s.isolate] : 'all data'}<br>${cnt} cells · total <span style="color:var(--text)">${(sum * 1000).toFixed(0)}</span> · peak ${(max * 1000).toFixed(0)}<br>
        <svg width="160" height="40" style="margin-top:6px"><path d="${path}" fill="none" stroke="#ff3b4e" stroke-width="1.5"/></svg>`;

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 100), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.036, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.floorP.use().set({ u_vp: vp, u_model: M4.mul(M4.translate(0, -0.05, 0), M4.scale(NX + 2, 0.1, NZ + 2)), u_brush: s.brush || [0, 0, 0, 0] });
      gl.bindVertexArray(s.floorVao);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
      s.prog.use().set({ u_vp: vp });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, NX * NZ);
      gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = s.hover >= 0 ? 'pointer' : 'crosshair';
    },
  });

  function makeData(s) {
    const seed = Math.random() * 10;
    s.values = MONTHS.map((_, m) => CATS.map((_, c) => 0.4 + 2.6 * Math.pow(0.5 + 0.5 * Math.sin(m * 0.55 + c * 1.3 + seed) * Math.cos(c * 0.7 - m * 0.2), 1.4) + Math.random() * 0.3));
    if (!s.cur) { s.cur = s.values.map((r) => r.map(() => 0.02)); s.zc = []; s.em = []; }
  }
  function rayBox(o, d, mn, mx) {
    let t0 = -1e9, t1 = 1e9;
    for (let i = 0; i < 3; i++) {
      const inv = 1 / d[i]; let a = (mn[i] - o[i]) * inv, b = (mx[i] - o[i]) * inv;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t1 < t0) return null;
    }
    return t0 > 0 ? t0 : null;
  }
  function mixHex(k) {
    const a = [59, 139, 255], b = [255, 59, 78];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
  }
})();
