/* G · Context & Canvas — creation attributes, loss and restore, limits and precision, readback and
 * capture, colour spaces, OffscreenCanvas in a worker, and the debug extensions. */
(function () {
  const S = window.Sandbox;
  const { M4, clamp, damp, lerp } = S.math;
  const G = S.GLSL;
  const CAT = 'Context & Canvas';

  const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const place = (e, x, y, w, h) => { const st = e.style; const v = [x, y, w, h].map((n) => Math.round(n) + 'px'); if (st.left !== v[0]) st.left = v[0]; if (st.top !== v[1]) st.top = v[1]; if (w != null && st.width !== v[2]) st.width = v[2]; if (h != null && st.height !== v[3]) st.height = v[3]; };
  const fitCanvas = (cv, dpr) => { const w = Math.max(1, Math.round(parseFloat(cv.style.width) * dpr)), h = Math.max(1, Math.round(parseFloat(cv.style.height) * dpr)); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } return [w, h]; };
  const loseCtx = (g) => { if (g && !g.isContextLost()) { const e = g.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } };
  const CHECKER = 'repeating-conic-gradient(#2b2e37 0 25%, #15171d 0 50%) 0 0 / 14px 14px';
  const BACKDROP_FS = G.colors + `
uniform vec2 u_res; uniform float u_t; varying vec2 v_uv;
void main() {
  vec2 px = v_uv * u_res;
  float d = length(fract(px / u_res.y * 28.0) - 0.5);
  float dots = 1.0 - smoothstep(0.04, 0.09, d);
  vec2 q = v_uv - 0.5;
  vec3 c = INK + dots * 0.035 + A1 * 0.02 * (0.5 + 0.5 * sin(u_t * 0.3 + v_uv.x * 3.0));
  c *= 1.0 - dot(q, q) * 0.7;
  gl_FragColor = vec4(c, 1.0);
}`;
  const ERR = { 0: 'NO_ERROR', 0x500: 'INVALID_ENUM', 0x501: 'INVALID_VALUE', 0x502: 'INVALID_OPERATION', 0x505: 'OUT_OF_MEMORY', 0x506: 'INVALID_FRAMEBUFFER_OPERATION', 0x9242: 'CONTEXT_LOST_WEBGL' };

  /* small 2D program used inside secondary contexts */
  const MINI_VS = `
attribute vec2 a_pos; uniform vec2 u_off; uniform vec2 u_sc; uniform float u_rot; uniform float u_z; uniform float u_tilt;
varying vec2 v_l;
void main() { v_l = a_pos; float c = cos(u_rot), s = sin(u_rot); vec2 p = mat2(c, s, -s, c) * a_pos * u_sc + u_off; gl_Position = vec4(p, u_z + a_pos.x * u_tilt, 1.0); }`;
  const MINI_FS = `
uniform vec4 u_col; uniform float u_disc; varying vec2 v_l;
void main() { float a = u_col.a; if (u_disc > 0.5) { float d = length(v_l); if (d > 1.0) discard; a *= 1.0 - smoothstep(0.35, 1.0, d) * (u_disc - 1.0 > 0.0 ? 0.0 : 1.0); } gl_FragColor = vec4(u_col.rgb, a); }`;
  function miniKit(g) {
    const u = S.createUtil(g);
    const prog = u.program(MINI_VS, MINI_FS);
    const quad = u.mesh([{ buffer: u.buffer(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])), loc: 0, size: 2 }], null, { count: 4 });
    const sp = []; const N = 18;
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, b = a + 0.045; sp.push(0, 0, Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)); }
    const star = u.mesh([{ buffer: u.buffer(g.ARRAY_BUFFER, new Float32Array(sp)), loc: 0, size: 2 }], null, { count: N * 3 });
    const set = (o) => prog.set(Object.assign({ u_off: [0, 0], u_sc: [1, 1], u_rot: 0, u_z: 0, u_tilt: 0, u_disc: 0, u_col: [1, 1, 1, 1] }, o));
    return { u, prog, quad, star, set };
  }

  /* ---------------------------------------------------------------- */
  /* 1. Context attributes                                             */
  /* ---------------------------------------------------------------- */
  const ATTR_CARDS = [
    { label: 'antialias: true', key: 'antialias', attrs: { antialias: true, powerPreference: 'high-performance' }, scene: 'aa' },
    { label: 'antialias: false', key: 'antialias', attrs: { antialias: false, powerPreference: 'low-power' }, scene: 'aa' },
    { label: 'alpha · premultiplied', key: 'premultipliedAlpha', attrs: { alpha: true, premultipliedAlpha: true }, scene: 'alpha', bg: true },
    { label: 'alpha · straight', key: 'premultipliedAlpha', attrs: { alpha: true, premultipliedAlpha: false }, scene: 'alpha', bg: true },
    { label: 'alpha: false', key: 'alpha', attrs: { alpha: false }, scene: 'alpha', bg: true },
    { label: 'preserveDrawingBuffer: true', key: 'preserveDrawingBuffer', attrs: { preserveDrawingBuffer: true }, scene: 'trail' },
    { label: 'preserveDrawingBuffer: false', key: 'preserveDrawingBuffer', attrs: { preserveDrawingBuffer: false }, scene: 'trail' },
    { label: 'depth: true · stencil: true', key: 'stencil', attrs: { depth: true, stencil: true, antialias: false }, scene: 'ds' },
    { label: 'depth: false · stencil: false', key: 'depth', attrs: { depth: false, stencil: false, antialias: false }, scene: 'ds' },
    { label: 'desynchronized: true', key: 'desynchronized', attrs: { desynchronized: true, alpha: false }, scene: 'desync' },
  ];
  S.register({
    id: 'context-attributes',
    title: 'Context Attributes',
    category: CAT,
    thumb: 'wide',
    hint: 'hover a card to steer it · click to inspect',
    description: 'Ten small canvases, each created with a different getContext(\'webgl\', attributes) dictionary and running the same kind of drawing. Antialiasing changes the edges of thin wedges, alpha and premultipliedAlpha change how the canvas composites over the checked page behind it, preserveDrawingBuffer decides whether trails survive between frames, and a context without depth or stencil simply ignores those tests. The browser may decline a request, so each card shows what getContextAttributes actually granted.',
    interact: [['Hover a card', 'its moving element follows the pointer'], ['Click a card', 'show its full getContextAttributes() below'], ['Speed', 'animation speed for every card']],
    features: ['canvas.getContext(\'webgl\', attrs)', 'gl.getContextAttributes()', 'antialias · alpha · premultipliedAlpha', 'preserveDrawingBuffer · depth · stencil', 'desynchronized · powerPreference'],
    params: [
      { key: 'speed', label: 'Speed', type: 'range', min: 0, max: 2, step: 0.01, value: 1 },
      { key: 'fade', label: 'Trail fade', type: 'range', min: 0.01, max: 0.3, step: 0.01, value: 0.06 },
    ],
    code: `const gl = canvas.getContext('webgl', {
  antialias: false, alpha: true, premultipliedAlpha: false,
  preserveDrawingBuffer: true, depth: false, stencil: false,
  desynchronized: true, powerPreference: 'low-power',
});
gl.getContextAttributes();   // what was actually granted`,
    init(ctx) {
      const { util } = ctx;
      const backdrop = util.program(G.fullscreenVS, BACKDROP_FS);
      const cards = ATTR_CARDS.map((sp, i) => {
        const cv = el('canvas', 'ov-canvas cap-keep', null, ctx.overlay);
        cv.style.pointerEvents = 'auto'; cv.style.cursor = 'crosshair';
        if (sp.bg) cv.style.background = CHECKER;
        const cap = el('div', 'ov-cap cap-keep', null, ctx.overlay);
        cap.style.cssText += ';line-height:1.4;letter-spacing:.04em;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        const g = cv.getContext('webgl', sp.attrs);
        const card = { sp, cv, cap, g, kit: g ? miniKit(g) : null, got: g ? g.getContextAttributes() : null, ptr: null, frames: 0 };
        cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); card.ptr = [(e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2]; });
        cv.addEventListener('pointerleave', () => { card.ptr = null; });
        cv.addEventListener('pointerdown', () => { s.sel = i; s.dirty = true; });
        const gv = card.got ? card.got[sp.key] : 'n/a';
        cap.innerHTML = `<span style="color:var(--text)">${sp.label}</span><br><span style="opacity:.75">granted ${sp.key}: <span class="${gv === true ? 'on' : 'off'}" style="color:${gv === true ? 'var(--acc1)' : 'var(--acc2)'}">${gv}</span></span>`;
        return card;
      });
      const panel = el('div', 'ov-panel ov-bl', null, ctx.overlay);
      panel.style.cssText += ';width:calc(100% - 28px);max-width:none;padding:8px 12px';
      const s = { backdrop, cards, panel, sel: 0, dirty: true, t: 0 };
      return s;
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params } = ctx;
      s.t += dt * params.speed;
      const T = s.t;
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.backdrop.use().set({ u_res: [ctx.width, ctx.height], u_t: t });
      util.drawFullscreen();
      // layout
      const cw = ctx.cssWidth, ch = ctx.cssHeight;
      const cols = cw >= 640 ? 5 : 2, rows = Math.ceil(s.cards.length / cols);
      const x0 = 16, y0 = ctx.capture ? 16 : 52, x1 = cw - 16, y1 = ch - (ctx.capture ? 16 : 64 + s.panel.offsetHeight + 8);
      const cellW = (x1 - x0) / cols, cellH = (y1 - y0) / rows;
      s.cards.forEach((c, i) => {
        const cx = x0 + (i % cols) * cellW, cy = y0 + Math.floor(i / cols) * cellH;
        place(c.cv, cx + 4, cy + 4, cellW - 8, Math.max(20, cellH - 44));
        place(c.cap, cx + 4, cy + cellH - 38, cellW - 8);
        c.cv.style.borderColor = i === s.sel ? 'var(--acc1)' : '';
        if (!c.g || c.g.isContextLost()) return;
        const [w, h] = fitCanvas(c.cv, ctx.dpr);
        this.drawCard(c, w, h, T, params);
      });
      if (s.dirty) {
        s.dirty = false;
        const c = s.cards[s.sel], got = c.got || {};
        const keys = ['alpha', 'antialias', 'depth', 'stencil', 'premultipliedAlpha', 'preserveDrawingBuffer', 'desynchronized', 'powerPreference', 'failIfMajorPerformanceCaveat', 'xrCompatible'];
        s.panel.innerHTML = `<b>getContextAttributes()</b> · card ${s.sel + 1} · <span class="on">${esc(c.sp.label)}</span><br>`
          + `<span style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));column-gap:14px">${keys.map((k) => { const req = k in c.sp.attrs ? c.sp.attrs[k] : '·', v = got[k]; const diff = k in c.sp.attrs && req !== v; return `<span>${k} <b class="${diff ? 'off' : ''}">${v}</b>${k in c.sp.attrs ? ` <span style="opacity:.55">(asked ${req})</span>` : ''}</span>`; }).join('')}</span>`;
      }
    },
    drawCard(c, w, h, T, params) {
      const g = c.g, k = c.kit, asp = w / h, sc = (r) => [r / asp, r];
      g.viewport(0, 0, w, h);
      k.prog.use();
      const ptr = c.ptr;
      if (c.sp.scene === 'aa' || c.sp.scene === 'desync') {
        g.clearColor(0.03, 0.033, 0.045, 1); g.clear(g.COLOR_BUFFER_BIT);
        k.set({ u_sc: sc(0.92), u_rot: T * 0.25, u_col: [0.93, 0.91, 0.88, 1] }); k.star.draw();
        k.set({ u_sc: sc(0.55), u_rot: -T * 0.4, u_col: [S.A1[0], S.A1[1], S.A1[2], 1] }); k.star.draw();
        if (c.sp.scene === 'desync') {
          const p = ptr || [Math.cos(T * 1.3) * 0.6, Math.sin(T * 1.9) * 0.6];
          k.set({ u_off: p, u_sc: [0.004 * 2, 1.2], u_col: [S.A2[0], S.A2[1], S.A2[2], 1] }); k.quad.draw(g.TRIANGLE_STRIP);
          k.set({ u_off: p, u_sc: [1.2, 0.004 * 2 * asp], u_col: [S.A2[0], S.A2[1], S.A2[2], 1] }); k.quad.draw(g.TRIANGLE_STRIP);
        }
      } else if (c.sp.scene === 'alpha') {
        g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
        g.enable(g.BLEND); g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
        const cols = [S.A1, S.A2, [0.93, 0.91, 0.88]];
        cols.forEach((col, i) => {
          const a = T * 0.7 + i * 2.094, p = i === 0 && ptr ? ptr : [Math.cos(a) * 0.32, Math.sin(a) * 0.3];
          k.set({ u_off: p, u_sc: sc(0.52), u_disc: 1, u_col: [col[0], col[1], col[2], 0.7] }); k.quad.draw(g.TRIANGLE_STRIP);
        });
        g.disable(g.BLEND);
      } else if (c.sp.scene === 'trail') {
        if (!c.frames++) { g.clearColor(0.03, 0.033, 0.045, 1); g.clear(g.COLOR_BUFFER_BIT); }
        g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
        k.set({ u_sc: [1, 1], u_col: [0.03, 0.033, 0.045, params.fade] }); k.quad.draw(g.TRIANGLE_STRIP);
        const p = ptr || [Math.sin(T * 1.7) * 0.75, Math.sin(T * 2.3 + 1) * 0.7];
        k.set({ u_off: p, u_sc: sc(0.08), u_disc: 2, u_col: [S.A2[0], S.A2[1], S.A2[2], 1] }); k.quad.draw(g.TRIANGLE_STRIP);
        const p2 = [Math.sin(T * 1.1 + 2) * 0.6, Math.cos(T * 1.6) * 0.6];
        k.set({ u_off: p2, u_sc: sc(0.05), u_disc: 2, u_col: [S.A1[0], S.A1[1], S.A1[2], 1] }); k.quad.draw(g.TRIANGLE_STRIP);
        g.disable(g.BLEND);
      } else if (c.sp.scene === 'ds') {
        g.clearColor(0.03, 0.033, 0.045, 1); g.clearDepth(1); g.clearStencil(0);
        g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT | g.STENCIL_BUFFER_BIT);
        // stencil: a disc mask, then bars that may only land inside it
        const mc = ptr || [Math.sin(T * 0.8) * 0.25 - 0.35, 0];
        g.enable(g.STENCIL_TEST); g.stencilFunc(g.ALWAYS, 1, 0xff); g.stencilOp(g.KEEP, g.KEEP, g.REPLACE); g.colorMask(false, false, false, false);
        k.set({ u_off: mc, u_sc: sc(0.5), u_disc: 2 }); k.quad.draw(g.TRIANGLE_STRIP);
        g.colorMask(true, true, true, true); g.stencilFunc(g.EQUAL, 1, 0xff); g.stencilOp(g.KEEP, g.KEEP, g.KEEP);
        for (let b = -6; b <= 6; b++) { k.set({ u_off: [b * 0.16, 0], u_sc: [0.035, 1.4], u_rot: 0.5, u_col: [S.A1[0], S.A1[1], S.A1[2], 1] }); k.quad.draw(g.TRIANGLE_STRIP); }
        g.disable(g.STENCIL_TEST);
        // depth: two tilted quads that intersect
        g.enable(g.DEPTH_TEST);
        k.set({ u_off: [0.45, 0], u_sc: [0.32, 0.55], u_rot: T * 0.6, u_tilt: 0.6, u_col: [0.93, 0.91, 0.88, 1] }); k.quad.draw(g.TRIANGLE_STRIP);
        k.set({ u_off: [0.45, 0], u_sc: [0.32, 0.55], u_rot: -T * 0.6 + 1.2, u_tilt: -0.6, u_col: [S.A2[0], S.A2[1], S.A2[2], 1] }); k.quad.draw(g.TRIANGLE_STRIP);
        g.disable(g.DEPTH_TEST);
      }
    },
    dispose(ctx, s) {
      for (const c of s.cards) { if (c.kit && !c.g.isContextLost()) c.kit.u.disposeAll(); loseCtx(c.g); }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Context loss & restore                                         */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'context-loss',
    title: 'Context Loss & Restore',
    category: CAT,
    thumb: 'square',
    hint: 'lose the context · restore it · watch the log',
    description: 'A GPU context can disappear at any time: a driver reset, a background tab, too many contexts. WEBGL_lose_context simulates it on a secondary canvas that owns a mesh, a texture and a program. The page cancels the webglcontextlost event with preventDefault so that restoration is allowed, stops drawing while isContextLost() is true, and on webglcontextrestored rebuilds every resource from scratch, because all old objects are now invalid.',
    interact: [['Lose', 'loseContext() on the secondary context'], ['Restore', 'restoreContext(), then rebuild resources'], ['Auto cycle', 'lose and restore on a timer']],
    features: ['WEBGL_lose_context', 'webglcontextlost + preventDefault()', 'webglcontextrestored', 'gl.isContextLost()', 'rebuild every resource'],
    params: [
      { key: 'auto', label: 'Auto cycle', type: 'toggle', value: true },
      { key: 'lose', label: 'Lose context', type: 'button' },
      { key: 'restore', label: 'Restore context', type: 'button' },
    ],
    code: `canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();            // allow a later restore
  running = false;
});
canvas.addEventListener('webglcontextrestored', () => {
  buildResources(); running = true;   // old objects are gone
});
gl.getExtension('WEBGL_lose_context').loseContext();`,
    init(ctx) {
      const { util } = ctx;
      const cv = el('canvas', 'ov-canvas cap-keep', null, ctx.overlay);
      const badge = el('div', 'ov-label cap-keep', '', ctx.overlay);
      badge.style.fontSize = '13px';
      const g = cv.getContext('webgl', { antialias: true });
      const panel = el('div', 'ov-panel ov-tr', null, ctx.overlay);
      panel.style.width = '260px';
      const head = el('div', null, null, panel);
      const btns = el('div', 'ov-btns', '<button data-k="lose">loseContext()</button><button data-k="restore">restoreContext()</button>', panel);
      const logEl = el('div', null, null, panel);
      logEl.style.cssText = 'margin-top:8px;max-height:220px;overflow:auto;border-top:1px solid rgba(236,233,226,.12);padding-top:6px';
      const s = {
        cv, g, badge, panel, head, logEl, lc: g ? g.getExtension('WEBGL_lose_context') : null, util2: null, res: null, gen: 0, log: [],
        lostSeen: false, wantRestore: false, dead: false, segs: [], t0: performance.now(), nextAuto: ctx.capture ? 1.0 : 2.2, timers: [],
        bars: util.program(G.fullscreenVS, BACKDROP_FS),
      };
      btns.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.action(ctx, s, b.dataset.k)));
      const log = (msg, cls) => { const tt = ((performance.now() - s.t0) / 1000).toFixed(2); s.log.unshift(`<span style="opacity:.55">${tt}s</span> <span class="${cls || ''}">${msg}</span>`); s.log.length = Math.min(s.log.length, 40); s.logEl.innerHTML = s.log.join('<br>'); };
      s.logf = log;
      s.onLost = (e) => { e.preventDefault(); s.lostSeen = true; s.res = null; log('webglcontextlost · preventDefault()', 'off'); s.segs.push({ a: s.now(), b: null, lost: true }); if (s.wantRestore) { s.wantRestore = false; s.timers.push(setTimeout(() => this.action(ctx, s, 'restore'), 60)); } };
      s.onRestored = () => { s.lostSeen = false; log('webglcontextrestored', 'on'); this.build(s); const last = s.segs[s.segs.length - 1]; if (last) last.b = s.now(); };
      s.now = () => (performance.now() - s.t0) / 1000;
      if (!g) { head.innerHTML = '<span class="off">No secondary WebGL context available.</span>'; return s; }
      cv.addEventListener('webglcontextlost', s.onLost);
      cv.addEventListener('webglcontextrestored', s.onRestored);
      this.build(s);
      return s;
    },
    build(s) {
      const t0 = performance.now(), g = s.g;
      s.util2 = S.createUtil(g);
      const u = s.util2;
      const knot = S.geo.upload(u, S.geo.torusKnot(220, 24, 0.26));
      const tex = u.texture({ source: S.testCanvas(256, String(s.gen + 1)), filter: g.LINEAR, wrap: g.REPEAT, mipmap: true });
      const prog = u.program(`
attribute vec3 a_pos; attribute vec3 a_nrm; attribute vec2 a_uv; uniform mat4 u_vp; uniform mat4 u_m;
varying vec3 v_n; varying vec2 v_uv;
void main() { v_n = mat3(u_m) * a_nrm; v_uv = a_uv; gl_Position = u_vp * u_m * vec4(a_pos, 1.0); }`, G.colors + `
uniform sampler2D u_tex; uniform float u_gen; varying vec3 v_n; varying vec2 v_uv;
void main() { vec3 n = normalize(v_n); float l = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.4, 0.9, 0.6))), 0.0);
  vec3 t = texture2D(u_tex, v_uv * vec2(8.0, 1.0)).rgb; gl_FragColor = vec4(t * l + pow(1.0 - abs(n.z), 3.0) * 0.25 * mix(A1, A2, u_gen), 1.0); }`);
      s.res = { knot, tex, prog };
      s.gen++;
      s.logf(`built program, ${u.trackedCount} GPU objects in ${(performance.now() - t0).toFixed(1)} ms · generation ${s.gen}`);
    },
    action(ctx, s, key) {
      if (!s.g || s.dead) return;
      if (key === 'lose') {
        if (s.g.isContextLost()) { s.logf('already lost · ignored'); return; }
        s.logf('loseContext()'); s.lc.loseContext();
      } else if (key === 'restore') {
        if (!s.g.isContextLost()) { s.logf('context is live · nothing to restore'); return; }
        if (!s.lostSeen) { s.wantRestore = true; s.logf('restore queued until the lost event fires'); return; }
        s.logf('restoreContext()'); s.lostSeen = false; s.lc.restoreContext();
      }
    },
    frame(ctx, s, t, dt) {
      const { gl, util, params } = ctx;
      const now = s.now();
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.bars.use().set({ u_res: [ctx.width, ctx.height], u_t: t });
      util.drawFullscreen();
      const cw = ctx.cssWidth, ch = ctx.cssHeight;
      const side = cw > 700 && !ctx.capture ? 290 : 0;
      const tlH = 36, bottom = ctx.capture ? 24 : 72;
      const x0 = 16, y0 = ctx.capture ? 16 : 52, w = cw - side - 32, h = ch - y0 - bottom - tlH - 14;
      place(s.cv, x0, y0, w, h);
      if (!s.g) return;
      const lost = s.g.isContextLost();
      s.cv.style.visibility = lost ? 'hidden' : ''; // a lost context's canvas shows no usable image
      if (lost) {
        const d = ctx.dpr, X = x0 * d, Y = ctx.height - (y0 + h) * d, Wd = w * d, Hd = h * d;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(X, Y, Wd, Hd); gl.clearColor(0.06, 0.03, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.clearColor(S.A2[0] * 0.7, S.A2[1] * 0.7, S.A2[2] * 0.7, 1);
        const lw = Math.max(1, Math.round(d));
        [[X, Y, Wd, lw], [X, Y + Hd - lw, Wd, lw], [X, Y, lw, Hd], [X + Wd - lw, Y, lw, Hd]].forEach((r) => { gl.scissor(r[0], r[1], r[2], r[3]); gl.clear(gl.COLOR_BUFFER_BIT); });
        gl.disable(gl.SCISSOR_TEST);
      }
      place(s.badge, x0 + 14, y0 + 14);
      s.badge.innerHTML = lost ? '<span style="color:var(--acc2)">● context lost</span> · isContextLost() = true' : `<span style="color:var(--acc1)">● live</span> · generation ${s.gen}`;
      // auto cycle
      if (params.auto && now > s.nextAuto) {
        if (!lost) { this.action(ctx, s, 'lose'); s.nextAuto = now + 1.3; } else { this.action(ctx, s, 'restore'); s.nextAuto = now + 2.6; }
      }
      if (!lost && s.res) {
        const g = s.g, [bw, bh] = fitCanvas(s.cv, ctx.dpr);
        g.viewport(0, 0, bw, bh);
        g.clearColor(0.03, 0.033, 0.045, 1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
        g.enable(g.DEPTH_TEST);
        const vp = M4.mul(M4.persp(0.8, bw / bh, 0.1, 30), M4.lookAt([0, 0.4, 4.4], [0, 0, 0]));
        const m = M4.mul(M4.rotY(t * 0.5), M4.rotX(t * 0.3));
        s.util2.tex(0, s.res.tex);
        s.res.prog.use().set({ u_vp: vp, u_m: m, u_tex: 0, u_gen: (s.gen % 2) });
        s.res.knot.draw();
        g.disable(g.DEPTH_TEST);
      }
      // timeline of live / lost spans (scissored clears on the main canvas)
      const dpr = ctx.dpr, H = ctx.height;
      const tx = x0 * dpr, ty = H - (y0 + h + 14 + tlH) * dpr, tw = w * dpr, th = tlH * dpr;
      const span = 20, t0 = now - span;
      gl.enable(gl.SCISSOR_TEST);
      const box = (x, y, ww, hh, c) => { if (ww <= 0 || hh <= 0) return; gl.scissor(Math.round(x), Math.round(y), Math.max(1, Math.round(ww)), Math.max(1, Math.round(hh))); gl.clearColor(c[0], c[1], c[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); };
      box(tx, ty, tw, th, [0.05, 0.055, 0.07]);
      box(tx, ty + th * 0.45, tw, Math.max(1, dpr), [0.13, 0.42, 0.46]);
      for (const sg of s.segs) {
        const a = Math.max(sg.a, t0), b = sg.b == null ? now : sg.b;
        if (b < t0) continue;
        box(tx + (a - t0) / span * tw, ty + 3 * dpr, (b - a) / span * tw, th - 6 * dpr, [S.A2[0] * 0.8, S.A2[1] * 0.8, S.A2[2] * 0.8]);
      }
      for (let k = Math.ceil(t0); k <= now; k++) box(tx + (k - t0) / span * tw, ty, Math.max(1, dpr), 4 * dpr, [0.5, 0.5, 0.5]);
      box(tx + tw - 2 * dpr, ty, 2 * dpr, th, [0.93, 0.91, 0.88]);
      gl.disable(gl.SCISSOR_TEST);
      if (s.segs.length > 60) s.segs.shift();
      s.head.innerHTML = `<b>WEBGL_lose_context</b><br>isContextLost() <b class="${lost ? 'off' : 'on'}">${lost}</b> · generation <b>${s.gen}</b><br><span style="opacity:.7">timeline: last 20 s, magenta = lost</span>`;
    },
    dispose(ctx, s) {
      s.dead = true;
      s.timers.forEach(clearTimeout);
      if (s.g) {
        s.cv.removeEventListener('webglcontextlost', s.onLost);
        s.cv.removeEventListener('webglcontextrestored', s.onRestored);
        if (!s.g.isContextLost() && s.util2) s.util2.disposeAll();
        loseCtx(s.g);
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Limits & precision                                             */
  /* ---------------------------------------------------------------- */
  const LIMITS = [
    ['MAX_TEXTURE_SIZE', 64], ['MAX_CUBE_MAP_TEXTURE_SIZE', 16], ['MAX_RENDERBUFFER_SIZE', 1], ['MAX_VIEWPORT_DIMS'],
    ['MAX_TEXTURE_IMAGE_UNITS', 8], ['MAX_VERTEX_TEXTURE_IMAGE_UNITS', 0], ['MAX_COMBINED_TEXTURE_IMAGE_UNITS', 8],
    ['MAX_VERTEX_ATTRIBS', 8], ['MAX_VERTEX_UNIFORM_VECTORS', 128], ['MAX_FRAGMENT_UNIFORM_VECTORS', 16], ['MAX_VARYING_VECTORS', 8],
    ['ALIASED_POINT_SIZE_RANGE'], ['ALIASED_LINE_WIDTH_RANGE'], ['SUBPIXEL_BITS', 4], ['SAMPLES'], ['SAMPLE_BUFFERS'],
    ['RED_BITS'], ['GREEN_BITS'], ['BLUE_BITS'], ['ALPHA_BITS'], ['DEPTH_BITS'], ['STENCIL_BITS'],
    ['VENDOR'], ['RENDERER'], ['VERSION'], ['SHADING_LANGUAGE_VERSION'],
  ];
  S.register({
    id: 'limits',
    title: 'Limits & Precision',
    category: CAT,
    thumb: 'tall',
    hint: 'move to push precision · wheel to zoom',
    description: 'Every implementation limit getParameter reports, next to the minimum WebGL 1.0 guarantees, plus getShaderPrecisionFormat for all six float and integer precisions in both shader stages. The canvas makes them tangible: a precision lab that evaluates fract(offset + x) in lowp, mediump and highp and beside them a simulation of the minimum precision the specification allows, a point-size ramp that hits ALIASED_POINT_SIZE_RANGE, and the size limits drawn to scale.',
    interact: [['Move (precision)', 'larger offsets leave fewer bits for the fraction'], ['Wheel', 'zoom the x span'], ['View', 'precision, point sizes or size limits']],
    features: ['gl.getParameter(MAX_*)', 'gl.getShaderPrecisionFormat()', 'lowp · mediump · highp', 'ALIASED_POINT_SIZE_RANGE', 'MAX_TEXTURE_SIZE · MAX_VIEWPORT_DIMS'],
    params: [
      { key: 'view', label: 'View', type: 'select', options: ['Precision', 'Point sizes', 'Size limits'], value: 0 },
      { key: 'span', label: 'X span', type: 'range', min: 0.01, max: 4, step: 0.01, value: 0.6 },
    ],
    code: `gl.getParameter(gl.MAX_TEXTURE_SIZE);
const f = gl.getShaderPrecisionFormat(
  gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT);
f.rangeMin; f.rangeMax; f.precision;   // log2 values / bits
// GLSL
mediump float x = u_off + v_uv.x * u_span;`,
    init(ctx) {
      const { gl, util } = ctx;
      const fmtV = (v) => (v == null ? '–' : (v instanceof Float32Array || v instanceof Int32Array || Array.isArray(v)) ? Array.from(v).join(' – ') : String(v));
      const rows = LIMITS.map(([k, min]) => [k, fmtV(gl.getParameter(gl[k])), min]);
      const an = util.ext('EXT_texture_filter_anisotropic'); if (an) rows.push(['MAX_TEXTURE_MAX_ANISOTROPY_EXT', fmtV(gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT))]);
      const db = util.ext('WEBGL_draw_buffers'); if (db) { rows.push(['MAX_DRAW_BUFFERS_WEBGL', fmtV(gl.getParameter(db.MAX_DRAW_BUFFERS_WEBGL))]); rows.push(['MAX_COLOR_ATTACHMENTS_WEBGL', fmtV(gl.getParameter(db.MAX_COLOR_ATTACHMENTS_WEBGL))]); }
      const prec = {};
      for (const st of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) for (const p of ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT']) { const f = gl.getShaderPrecisionFormat(gl[st], gl[p]); prec[st + p] = f ? [f.rangeMin, f.rangeMax, f.precision] : [0, 0, 0]; }
      const panel = el('div', 'ov-panel ov-tr', null, ctx.overlay);
      panel.style.cssText += ';width:330px;max-width:min(52%,330px);max-height:calc(100% - 130px);overflow:auto;font-size:10.5px';
      const pt = ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT'].map((p) => { const v = prec['VERTEX_SHADER' + p], f = prec['FRAGMENT_SHADER' + p]; return `<tr><td>${p.toLowerCase()}</td><td>${v[0]}/${v[1]}</td><td>${v[2]}</td><td>${f[0]}/${f[1]}</td><td>${f[2]}</td></tr>`; }).join('');
      panel.innerHTML = `<b>getShaderPrecisionFormat</b> <span style="opacity:.6">range log₂ min/max · bits</span>
<table style="width:100%;border-collapse:collapse;margin:4px 0 10px"><tr style="opacity:.6"><td></td><td>vertex</td><td></td><td>fragment</td><td></td></tr>${pt}</table>
<b>getParameter</b> <span style="opacity:.6">value · spec minimum</span>
<table style="width:100%;border-collapse:collapse;margin-top:4px">${rows.map(([k, v, min]) => `<tr style="border-top:1px solid rgba(236,233,226,.06)"><td style="padding:2px 6px 2px 0;word-break:break-all">${k.replace(/^MAX_/, 'MAX_')}</td><td style="text-align:right;color:var(--text);word-break:break-word;max-width:120px">${esc(v)}</td><td style="text-align:right;opacity:.5;padding-left:6px">${min == null ? '' : min}</td></tr>`).join('')}</table>`;
      panel.querySelectorAll('td').forEach((td) => (td.style.verticalAlign = 'top'));
      const precProg = util.program(G.fullscreenVS, G.colors + `
uniform float u_off; uniform float u_span; uniform float u_row; uniform vec2 u_res;
varying vec2 v_uv;
float q10(float x) { float e = exp2(floor(log2(max(abs(x), 1e-30))) - 10.0); return floor(x / e + 0.5) * e; }
void main() {
  float y = v_uv.y, f;
  if (u_row < 0.5) { lowp float x = u_off + v_uv.x * u_span; lowp float fr = fract(x); f = fr; }
  else if (u_row < 1.5) { mediump float x = u_off + v_uv.x * u_span; mediump float fr = fract(x); f = fr; }
  else if (u_row < 2.5) { highp float x = u_off + v_uv.x * u_span; highp float fr = fract(x); f = fr; }
  else if (u_row < 3.5) { float x = q10(q10(u_off) + q10(v_uv.x * u_span)); f = fract(q10(x)); }
  else { float x = clamp(floor((u_off + v_uv.x * u_span) * 256.0 + 0.5) / 256.0, -2.0, 2.0); f = fract(x); }
  float fill = step(y, f * 0.86 + 0.07);
  float edge = 1.0 - smoothstep(0.0, 2.0 / u_res.y, abs(y - (f * 0.86 + 0.07)));
  vec3 base = u_row > 2.5 ? A2 : A1;
  vec3 c = INK + base * fill * (0.12 + 0.3 * y) + BONE * edge * 0.9;
  float grid = step(0.995, fract(v_uv.x * 10.0)) * 0.05;
  gl_FragColor = vec4(c + grid, 1.0);
}`);
      const ptProg = util.program(`
attribute vec2 a_pos; uniform float u_max; uniform float u_dpr; uniform float u_hl; varying float v_k; varying float v_clamped; varying float v_hl;
void main() { float req = exp(mix(log(1.0), log(u_max * 1.6), a_pos.x)); v_k = a_pos.x; v_clamped = step(u_max, req); v_hl = step(abs(a_pos.y - u_hl), 0.5);
  gl_Position = vec4(mix(-0.92, 0.92, a_pos.x), -0.1, 0.0, 1.0); gl_PointSize = req; }`, G.colors + `
varying float v_k; varying float v_clamped; varying float v_hl;
void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r = length(q); float ring = smoothstep(0.03, 0.0, abs(r - 0.97));
  float a = (1.0 - step(1.0, r)) * (0.08 + v_hl * 0.15) + ring * (0.5 + v_hl * 0.5);
  vec3 c = mix(A1, A2, v_clamped); gl_FragColor = vec4(c * a, a); }`);
      const pr = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      const NP = 24, pd = []; for (let i = 0; i < NP; i++) pd.push(i / (NP - 1), i);
      const ptBuf = util.buffer(gl.ARRAY_BUFFER, new Float32Array(pd));
      const labels = Array.from({ length: 6 }, () => { const l = el('div', 'ov-label cap-keep', '', ctx.overlay); return l; });
      const lim = { tex: gl.getParameter(gl.MAX_TEXTURE_SIZE), cube: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE), rb: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vp: gl.getParameter(gl.MAX_VIEWPORT_DIMS) };
      return { panel, precProg, ptProg, ptBuf, pr, NP, labels, prec, lim, off: 8, zoom: 1, backdrop: util.program(G.fullscreenVS, BACKDROP_FS) };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const W = ctx.width, H = ctx.height, dpr = ctx.dpr;
      const cw = ctx.cssWidth, ch = ctx.cssHeight;
      const side = cw > 720 && !ctx.capture ? 350 : 0;
      const ax = 16, ay = ctx.capture ? 34 : 78, aw = cw - side - 32, ah = ch - ay - (ctx.capture ? 24 : 72);
      gl.viewport(0, 0, W, H);
      s.backdrop.use().set({ u_res: [W, H], u_t: t });
      util.drawFullscreen();
      s.labels.forEach((l) => (l.style.display = 'none'));
      const L = (i, html, x, y, col) => { const l = s.labels[i]; l.style.display = ''; l.innerHTML = html; place(l, x, y); l.style.color = col || ''; };
      const live = input.hover && !ctx.capture;
      if (params.view === 0) {
        s.zoom = clamp(s.zoom * Math.exp(input.wheel * 0.001), 0.05, 20);
        const target = live ? Math.pow(2, input.uvx * 16) : Math.pow(2, 6 + 5 * (0.5 + 0.5 * Math.sin(t * 0.25)));
        s.off += (target - s.off) * damp(4, dt);
        const span = params.span * s.zoom;
        const rowsN = 5, rh = ah / rowsN;
        const names = ['lowp · device', 'mediump · device', 'highp · device', 'mediump · spec minimum (10-bit, simulated)', 'lowp · spec minimum (8-bit, ±2, simulated)'];
        const keys = ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT'];
        gl.enable(gl.SCISSOR_TEST);
        for (let r = 0; r < rowsN; r++) {
          const x = ax * dpr, y = H - (ay + (r + 1) * rh) * dpr + 4 * dpr, w = aw * dpr, h = rh * dpr - 18 * dpr;
          gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
          s.precProg.use().set({ u_off: s.off, u_span: span, u_row: r, u_res: [w, h] });
          util.drawFullscreen();
          const f = keys[r] ? s.prec['FRAGMENT_SHADER' + keys[r]] : null;
          L(r, `${names[r]}${f ? ` <span style="opacity:.6">· ${f[2]} bits</span>` : ''}`, ax + 2, ay + r * rh + rh - 14, r > 2 ? 'var(--acc2)' : '');
        }
        gl.disable(gl.SCISSOR_TEST);
        L(5, `fract(${s.off.toFixed(s.off < 100 ? 2 : 0)} + x · ${span.toFixed(3)})`, ax + 2, ay - 18, 'var(--text)');
      } else if (params.view === 1) {
        const pr = s.pr, maxP = pr[1];
        let hl = -1;
        if (live) hl = Math.round(clamp((input.x - ax - aw * 0.04) / (aw * 0.92), 0, 1) * (s.NP - 1));
        else hl = Math.round((0.5 + 0.5 * Math.sin(t * 0.6)) * (s.NP - 1));
        gl.viewport(ax * dpr, H - (ay + ah) * dpr, aw * dpr, ah * dpr);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        s.ptProg.use().set({ u_max: Math.min(maxP, ah * dpr * 0.8), u_dpr: dpr, u_hl: hl });
        util.bindAttribs([{ buffer: s.ptBuf, loc: 0, size: 2 }]);
        gl.drawArrays(gl.POINTS, 0, s.NP);
        gl.disable(gl.BLEND);
        const shown = Math.min(maxP, ah * dpr * 0.8);
        const req = Math.exp(lerp(0, Math.log(shown * 1.6), hl / (s.NP - 1)));
        L(0, `ALIASED_POINT_SIZE_RANGE <b style="color:var(--text)">${pr[0]} – ${pr[1]}</b>`, ax + 2, ay);
        L(1, `requested gl_PointSize <b style="color:var(--text)">${req.toFixed(1)}</b> px → drawn <b style="color:${req > maxP ? 'var(--acc2)' : 'var(--acc1)'}">${Math.min(req, maxP).toFixed(1)}</b> px`, ax + 2, ay + 18);
        if (shown < maxP) L(2, `ramp capped at ${shown.toFixed(0)} px to fit the canvas; magenta points ask for more than the ramp's ceiling`, ax + 2, ay + ah - 14);
        else L(2, 'magenta points request more than the maximum and are clamped', ax + 2, ay + ah - 14, 'var(--acc2)');
      } else {
        const lim = s.lim;
        const items = [
          { n: 'drawing buffer', w: W, h: H, c: [0.93, 0.91, 0.88] },
          { n: 'MAX_RENDERBUFFER_SIZE', w: lim.rb, h: lim.rb, c: S.A2 },
          { n: 'MAX_VIEWPORT_DIMS', w: lim.vp[0], h: lim.vp[1], c: [0.6, 0.62, 0.7] },
          { n: 'MAX_CUBE_MAP_TEXTURE_SIZE', w: lim.cube, h: lim.cube, c: S.A2 },
          { n: 'MAX_TEXTURE_SIZE', w: lim.tex, h: lim.tex, c: S.A1 },
        ];
        const big = Math.max(...items.map((i) => Math.max(i.w, i.h * aw / ah)));
        const k = (aw * dpr * 0.94) / big;
        const ox = ax * dpr + aw * dpr * 0.03, oy = H - (ay + ah) * dpr + ah * dpr * 0.03;
        const pxv = live ? input.x * dpr : ox + lim.tex * k * (0.5 + 0.45 * Math.sin(t * 0.4)) * 0.3, pyv = live ? H - input.y * dpr : oy + 20;
        gl.enable(gl.SCISSOR_TEST);
        const box = (x, y, w, h, c, a) => { if (w < 1 || h < 1) return; gl.scissor(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); gl.clearColor(c[0] * a, c[1] * a, c[2] * a, 1); gl.clear(gl.COLOR_BUFFER_BIT); };
        const sorted = items.slice().sort((a, b) => b.w * b.h - a.w * a.h);
        let hov = null;
        for (const it of sorted) if (pxv >= ox && pxv <= ox + it.w * k && pyv >= oy && pyv <= oy + it.h * k) hov = it;
        sorted.forEach((it) => {
          const w = it.w * k, h = it.h * k, lw = Math.max(1, dpr);
          if (it === hov) box(ox, oy, w, h, it.c, 0.12);
          box(ox, oy, w, lw, it.c, 0.9); box(ox, oy + h - lw, w, lw, it.c, 0.9); box(ox, oy, lw, h, it.c, 0.9); box(ox + w - lw, oy, lw, h, it.c, 0.9);
        });
        gl.disable(gl.SCISSOR_TEST);
        sorted.forEach((it, i) => {
          const w = it.w * k, h = it.h * k;
          const ly = (H - oy - h) / dpr + 6;
          L(i, `${it.n} <b style="color:var(--text)">${it.w} × ${it.h}</b>`, (ox + Math.min(w, aw * dpr * 0.94)) / dpr - 8 - (it.n.length + 14) * 6.4, Math.max(ay, ly), it === hov ? 'var(--acc1)' : '');
        });
      }
      gl.viewport(0, 0, W, H);
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Readback & capture                                             */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'capture',
    title: 'Readback & Capture',
    category: CAT,
    thumb: 'portrait',
    hint: 'move to inspect pixels · snapshot · record',
    description: 'readPixels copies the block of pixels under the pointer back to JavaScript every frame; the block is uploaded again as a texture and drawn as a magnified grid with the exact RGBA values alongside. Because this context uses preserveDrawingBuffer: false, the drawing buffer may be cleared once the frame is composited, so readPixels, toDataURL and toBlob all run in the same task as the drawing; the read-after-frame button reads from a later task to show the difference. captureStream and MediaRecorder turn the canvas into a video.',
    interact: [['Move', 'inspect the pixels under the pointer'], ['Snapshot', 'toDataURL thumbnail + toBlob PNG link'], ['Record', 'four seconds of captureStream video'], ['Read after frame', 'readPixels from a later task']],
    features: ['gl.readPixels(x, y, w, h, RGBA, UNSIGNED_BYTE)', 'canvas.toDataURL() · canvas.toBlob()', 'canvas.captureStream() + MediaRecorder', 'preserveDrawingBuffer: false', 'texSubImage2D of the readback'],
    params: [
      { key: 'size', label: 'Block size', type: 'select', options: ['7²', '11²', '17²'], value: 1 },
      { key: 'shot', label: 'Snapshot', type: 'button' },
      { key: 'rec', label: 'Record 4 s', type: 'button' },
      { key: 'late', label: 'Read after frame', type: 'button' },
    ],
    code: `drawScene();
// same task as the draw: the buffer is still intact
gl.readPixels(x, y, 11, 11, gl.RGBA, gl.UNSIGNED_BYTE, px);
canvas.toBlob((b) => save(b), 'image/png');
// a later task may see a cleared buffer
setTimeout(() => gl.readPixels(x, y, 1, 1, …), 0);
new MediaRecorder(canvas.captureStream(30)).start();`,
    init(ctx) {
      const { gl, util } = ctx;
      const SCENE = G.colors + G.noise + `
uniform vec2 u_res; uniform float u_t; varying vec2 v_uv;
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 p = (fc - 0.5 * u_res) / u_res.y;
  float v = sin(p.x * 3.0 + u_t * 0.5) + sin(p.y * 4.0 - u_t * 0.4) + sin(length(p - vec2(0.3, -0.2)) * 7.0 - u_t);
  vec3 c = mix(INK, mix(A1, A2, 0.5 + 0.5 * sin(v * 1.2)), 0.3 + 0.2 * sin(v * 1.7));
  vec2 g = fract(p * 4.0) - 0.5; vec2 id = floor(p * 4.0);
  float r = 0.18 + 0.12 * sin(u_t * 0.8 + id.x * 1.3 + id.y * 0.7);
  float d = length(g);
  c = mix(c, BONE, (1.0 - smoothstep(r - 0.004, r + 0.004, d)) * 0.9);
  c = mix(c, A1, (1.0 - smoothstep(0.004, 0.012, abs(d - r - 0.03))) * 0.8);
  c += (hash12(fc + floor(u_t * 4.0)) - 0.5) * 0.03;
  gl_FragColor = vec4(c, 1.0);
}`;
      const scene = util.program(G.fullscreenVS, SCENE);
      const lens = util.program(`
attribute vec2 a_pos; uniform vec4 u_rect; varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(u_rect.xy + a_pos * u_rect.zw, 0.0, 1.0); }`, G.colors + `
uniform sampler2D u_tex; uniform float u_n; uniform vec2 u_px; varying vec2 v_uv;
void main() {
  vec2 c = v_uv * u_n; vec2 f = fract(c); vec2 cell = floor(c);
  vec3 col = texture2D(u_tex, (cell + 0.5) / ${17}.0).rgb;
  vec2 fw = 1.0 / u_px * u_n;
  float grid = max(step(f.x, fw.x), step(f.y, fw.y));
  col = mix(col, INK, grid * 0.75);
  float mid = floor(u_n * 0.5);
  if (cell.x == mid && cell.y == mid) { float e = max(step(f.x, fw.x * 2.5), max(step(1.0 - fw.x * 2.5, f.x), max(step(f.y, fw.y * 2.5), step(1.0 - fw.y * 2.5, f.y)))); col = mix(col, A1, e); }
  float border = max(step(v_uv.x, 0.006), max(step(0.994, v_uv.x), max(step(v_uv.y, 0.006), step(0.994, v_uv.y))));
  gl_FragColor = vec4(mix(col, BONE, border), 1.0);
}`);
      const quad = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])), loc: 0, size: 2 }], null, { count: 4 });
      const MAXN = 17;
      const buf = new Uint8Array(MAXN * MAXN * 4);
      const tex = util.texture({ width: MAXN, height: MAXN, data: buf, filter: gl.NEAREST });
      const panel = el('div', 'ov-panel ov-tr', null, ctx.overlay); panel.style.width = '250px';
      const head = el('div', null, null, panel);
      const btns = el('div', 'ov-btns', '<button data-k="shot">snapshot</button><button data-k="rec">record 4 s</button><button data-k="late">read after frame</button>', panel);
      const out = el('div', null, null, panel); out.style.marginTop = '8px';
      const s = { scene, lens, quad, buf, tex, panel, head, out, MAXN, m: [0.5, 0.5], urls: [], timers: [], wantShot: false, rec: null, stream: null, late: '', shotHTML: '', recHTML: '', dead: false, tick: 0 };
      btns.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.action(ctx, s, b.dataset.k)));
      return s;
    },
    action(ctx, s, key) {
      const { gl, canvas } = ctx;
      if (key === 'shot') s.wantShot = true;
      if (key === 'late') {
        s.timers.push(setTimeout(() => {
          if (s.dead || gl.isContextLost()) return;
          const p = new Uint8Array(4);
          gl.readPixels(Math.round(s.lastPx[0]), Math.round(s.lastPx[1]), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
          s.late = `read after frame: <b>${Array.from(p).join(', ')}</b> vs in-frame <b>${s.lastRGBA.join(', ')}</b>`;
          this.renderOut(s);
        }, 30));
      }
      if (key === 'rec') {
        if (s.rec) return;
        if (!canvas.captureStream || !window.MediaRecorder) { s.recHTML = '<span class="off">captureStream / MediaRecorder unavailable</span>'; this.renderOut(s); return; }
        const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((tp) => MediaRecorder.isTypeSupported(tp)) || '';
        try {
          s.stream = canvas.captureStream(30);
          const chunks = [];
          s.rec = new MediaRecorder(s.stream, type ? { mimeType: type } : undefined);
          s.rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
          s.rec.onstop = () => {
            if (s.stream) s.stream.getTracks().forEach((tr) => tr.stop());
            const rec = s.rec; s.rec = null; s.stream = null;
            if (s.dead) return;
            const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
            const url = URL.createObjectURL(blob); s.urls.push(url);
            s.recHTML = `recorded <b>${(blob.size / 1024).toFixed(0)} KB</b> ${esc(rec.mimeType || '')} · <a href="${url}" download="capture.webm" style="color:var(--acc1)">save</a>`;
            this.renderOut(s);
          };
          s.rec.start(250); s.recStart = performance.now();
          s.timers.push(setTimeout(() => { if (s.rec && s.rec.state === 'recording') s.rec.stop(); }, 4000));
        } catch (err) { s.recHTML = '<span class="off">recording failed: ' + esc(err.message) + '</span>'; s.rec = null; this.renderOut(s); }
      }
    },
    renderOut(s) { s.out.innerHTML = [s.shotHTML, s.recHTML, s.late].filter(Boolean).join('<br>'); },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util, canvas } = ctx;
      const W = ctx.width, H = ctx.height, dpr = ctx.dpr;
      // the scene goes into a canvas-sized texture first: reading a framebuffer object avoids a pipeline stall
      // on the default framebuffer, and the copy on screen is a single textured triangle
      gl.viewport(0, 0, W, H);
      s.scene.use().set({ u_res: [W, H], u_t: t });
      util.drawFullscreen();
      const N = [7, 11, 17][params.size];
      const live = input.hover && !ctx.capture;
      const tx = live ? input.uvx : 0.5 + 0.3 * Math.cos(t * 0.4), ty = live ? input.uvy : 0.5 + 0.28 * Math.sin(t * 0.55);
      const k = live ? 1 : damp(6, dt);
      s.m[0] += (tx - s.m[0]) * k; s.m[1] += (ty - s.m[1]) * k;
      const px = clamp(Math.round(s.m[0] * W), 0, W - 1), py = clamp(Math.round(s.m[1] * H), 0, H - 1);
      const x0 = clamp(px - (N >> 1), 0, W - N), y0 = clamp(py - (N >> 1), 0, H - N);
      // same task as the draw: with preserveDrawingBuffer false the buffer is only guaranteed intact until we return
      gl.readPixels(x0, y0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, s.buf);
      // snapshot: same task as the draw, before the lens is drawn on top
      if (s.wantShot) {
        s.wantShot = false;
        const data = canvas.toDataURL('image/jpeg', 0.8);
        canvas.toBlob((b) => {
          if (!b || s.dead) return;
          const url = URL.createObjectURL(b); s.urls.push(url);
          s.shotHTML = `<img src="${data}" style="display:block;width:100%;margin:2px 0 4px;border:1px solid rgba(236,233,226,.15)">toBlob PNG <b>${(b.size / 1024).toFixed(0)} KB</b> · <a href="${url}" download="snapshot.png" style="color:var(--acc1)">save</a>`;
          this.renderOut(s);
        }, 'image/png');
      }
      s.lastPx = [px, py];
      const ci = ((py - y0) * N + (px - x0)) * 4;
      s.lastRGBA = [s.buf[ci], s.buf[ci + 1], s.buf[ci + 2], s.buf[ci + 3]];
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, s.buf.subarray(0, N * N * 4));
      gl.bindTexture(gl.TEXTURE_2D, null);
      // outline of the sampled block
      gl.enable(gl.SCISSOR_TEST);
      const lw = Math.max(1, Math.round(dpr));
      const rect = (x, y, w, h) => { gl.scissor(x, y, w, h); gl.clear(gl.COLOR_BUFFER_BIT); };
      gl.clearColor(0.93, 0.91, 0.88, 1);
      rect(x0 - lw, y0 - lw, N + 2 * lw, lw); rect(x0 - lw, y0 + N, N + 2 * lw, lw); rect(x0 - lw, y0, lw, N); rect(x0 + N, y0, lw, N);
      gl.disable(gl.SCISSOR_TEST);
      // magnified lens, offset from the pointer
      const L = Math.min(W, H) * 0.34;
      let lx = px + 40 * dpr, ly = py + 40 * dpr;
      if (lx + L > W - 10) lx = px - 40 * dpr - L;
      if (ly + L > H - 10) ly = py - 40 * dpr - L;
      lx = clamp(lx, 4, W - L - 4); ly = clamp(ly, 4, H - L - 4);
      if (!ctx.capture) {
        // keep the lens clear of the info panel (panel rect in drawing-buffer px, y up)
        const pl = s.panel.offsetLeft * dpr, pb = H - (s.panel.offsetTop + s.panel.offsetHeight) * dpr;
        const hits = (x, y) => x + L > pl && y + L > pb;
        if (hits(lx, ly)) { lx = clamp(px - 40 * dpr - L, 4, W - L - 4); if (hits(lx, ly)) ly = clamp(Math.min(py - 40 * dpr - L, pb - L - 8), 4, H - L - 4); }
      }
      s.lens.use().set({ u_rect: [(lx + L / 2) / W * 2 - 1, (ly + L / 2) / H * 2 - 1, L / W, L / H], u_tex: 0, u_n: N, u_px: [L, L] });
      util.tex(0, s.tex);
      s.quad.draw(gl.TRIANGLE_STRIP);
      if (++s.tick % 3 === 0) {
        const [r, g, b, a] = s.lastRGBA;
        const hx = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        s.head.innerHTML = `<b>readPixels</b> ${N}×${N} at (${px}, ${py})<br>`
          + `<span style="display:inline-block;width:12px;height:12px;background:${hx};vertical-align:-2px;border:1px solid rgba(236,233,226,.3)"></span> RGBA <b>${r}, ${g}, ${b}, ${a}</b> · ${hx}<br>`
          + `preserveDrawingBuffer <b>${ctx.attrs.preserveDrawingBuffer}</b>${s.rec ? `<br><span class="off">● recording ${((performance.now() - s.recStart) / 1000).toFixed(1)} s</span>` : ''}`;
      }
      canvas.style.cursor = 'crosshair';
    },
    dispose(ctx, s) {
      s.dead = true;
      s.timers.forEach(clearTimeout);
      if (s.rec && s.rec.state !== 'inactive') { try { s.rec.stop(); } catch (_) { /* ignore */ } }
      if (s.stream) s.stream.getTracks().forEach((tr) => tr.stop());
      s.urls.forEach((u) => URL.revokeObjectURL(u));
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Colour spaces                                                  */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'colorspace',
    title: 'Colour Spaces',
    category: CAT,
    thumb: 'wide',
    hint: 'drag the divider · switch the drawing buffer',
    description: 'Values in a WebGL drawing buffer are sRGB-encoded, so mixing or adding them directly is not physically linear. Each band shows the naive result on the left of the divider and the result computed in linear light on the right: a colour gradient, a grey ramp, additive light and texture filtering, where an EXT_sRGB SRGB_ALPHA_EXT texture is decoded before it is filtered. drawingBufferColorSpace and unpackColorSpace select display-p3 where supported, which widens the gamut of the swatches on capable displays.',
    interact: [['Drag', 'move the naive / linear divider'], ['Drawing buffer', 'drawingBufferColorSpace srgb or display-p3'], ['Unpack', 'unpackColorSpace used when the swatch image is uploaded']],
    features: ['gl.drawingBufferColorSpace', 'gl.unpackColorSpace', 'EXT_sRGB · SRGB_ALPHA_EXT', 'sRGB ↔ linear in GLSL', 'gamma-correct blending'],
    params: [
      { key: 'space', label: 'Drawing buffer', type: 'select', options: ['srgb', 'display-p3'], value: 0 },
      { key: 'unpack', label: 'Unpack colour space', type: 'select', options: ['srgb', 'display-p3'], value: 0 },
    ],
    code: `gl.drawingBufferColorSpace = 'display-p3';
gl.unpackColorSpace = 'display-p3';
const e = gl.getExtension('EXT_sRGB');
gl.texImage2D(gl.TEXTURE_2D, 0, e.SRGB_ALPHA_EXT, 2, 1, 0,
  e.SRGB_ALPHA_EXT, gl.UNSIGNED_BYTE, px);  // decoded before filtering
vec3 lin = pow(c, vec3(2.2));   // approx. decode`,
    init(ctx) {
      const { gl, util } = ctx;
      const srgb = util.ext('EXT_sRGB');
      const hasDB = 'drawingBufferColorSpace' in gl, hasUP = 'unpackColorSpace' in gl;
      const bw = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
      const rgbTex = util.texture({ width: 2, height: 1, data: bw, filter: gl.LINEAR });
      let srgbTex = null;
      if (srgb) {
        srgbTex = util.rawTexture();
        gl.bindTexture(gl.TEXTURE_2D, srgbTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, srgb.SRGB_ALPHA_EXT, 2, 1, 0, srgb.SRGB_ALPHA_EXT, gl.UNSIGNED_BYTE, bw);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      // swatch image drawn in display-p3 where the 2D canvas supports it
      const sw = document.createElement('canvas'); sw.width = 6; sw.height = 1;
      let g2 = null; try { g2 = sw.getContext('2d', { colorSpace: 'display-p3' }); } catch (_) { g2 = null; }
      if (!g2) g2 = sw.getContext('2d');
      const p3 = !!(g2.getContextAttributes && g2.getContextAttributes().colorSpace === 'display-p3');
      ['1 0 0', '0 1 0', '0 0 1', '0.22 0.84 0.91', '1 0.31 0.64', '1 0.85 0'].forEach((c, i) => { g2.fillStyle = p3 ? `color(display-p3 ${c})` : `rgb(${c.split(' ').map((v) => Math.round(v * 255)).join(',')})`; g2.fillRect(i, 0, 1, 1); });
      const prog = util.program(G.fullscreenVS, G.colors + `
uniform float u_split; uniform float u_row; uniform vec2 u_res; uniform float u_t;
uniform sampler2D u_rgb; uniform sampler2D u_srgb; uniform sampler2D u_sw; uniform float u_hasSrgb;
varying vec2 v_uv;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  float x = v_uv.x, y = v_uv.y;
  bool lin = x > u_split;
  vec3 c = INK;
  if (u_row < 0.5) {
    c = lin ? toSrgb(mix(toLin(A1), toLin(A2), x)) : mix(A1, A2, x);
  } else if (u_row < 1.5) {
    float v = y > 0.5 ? floor(x * 11.0) / 10.0 : x;
    c = lin ? toSrgb(vec3(v)) : vec3(v);
  } else if (u_row < 2.5) {
    vec2 p = vec2(x * u_res.x / u_res.y, y);
    vec3 acc = vec3(0.0);
    for (int k = 0; k < 9; k++) {
      float fk = float(k);
      vec2 cpos = vec2((fk + 0.5) / 9.0 * u_res.x / u_res.y, 0.5 + 0.18 * sin(u_t * 0.6 + fk * 1.7));
      float g = exp(-dot(p - cpos, p - cpos) * 14.0);
      vec3 col = mod(fk, 2.0) < 0.5 ? A1 : A2;
      acc += (lin ? toLin(col) : col) * g;
    }
    c = lin ? toSrgb(acc) : clamp(acc, 0.0, 1.0);
  } else if (u_row < 3.5) {
    vec2 tuv = vec2(0.25 + x * 0.5, 0.5);
    if (lin) c = u_hasSrgb > 0.5 ? toSrgb(texture2D(u_srgb, tuv).rgb) : toSrgb(vec3(x));
    else c = texture2D(u_rgb, tuv).rgb;
  } else {
    float i = floor(x * 6.0);
    vec3 pure = i < 0.5 ? vec3(1, 0, 0) : i < 1.5 ? vec3(0, 1, 0) : i < 2.5 ? vec3(0, 0, 1) : i < 3.5 ? A1 : i < 4.5 ? A2 : vec3(1.0, 0.85, 0.0);
    c = lin ? texture2D(u_sw, vec2((i + 0.5) / 6.0, 0.5)).rgb : pure;
    c *= step(0.04, fract(x * 6.0)) * step(fract(x * 6.0), 0.96);
  }
  float px = 1.5 / u_res.x;
  c = mix(c, BONE, 1.0 - smoothstep(0.0, px, abs(x - u_split)));
  gl_FragColor = vec4(c, 1.0);
}`);
      const panel = el('div', 'ov-panel ov-tr', null, ctx.overlay); panel.style.width = '300px';
      const names = ['A1 → A2 gradient', 'black → white ramp (top: 11 steps)', 'additive light: 9 overlapping glows', 'texture filtering: 2×1 black / white texel pair', 'swatches · left: shader values · right: display-p3 image'];
      const rowL = names.map((n) => el('div', 'ov-label cap-keep', n, ctx.overlay));
      const sideL = el('div', 'ov-label cap-keep', 'naive · sRGB values', ctx.overlay);
      const sideR = el('div', 'ov-label cap-keep', 'linear light', ctx.overlay);
      sideL.style.color = 'var(--text)'; sideR.style.color = 'var(--acc1)';
      const s = { prog, rgbTex, srgbTex, srgb, sw, swTex: null, hasDB, hasUP, p3, panel, rowL, sideL, sideR, split: 0.5, touched: false, backdrop: util.program(G.fullscreenVS, BACKDROP_FS) };
      this.apply(ctx, s);
      return s;
    },
    apply(ctx, s) {
      const { gl, util, params } = ctx;
      const sp = ['srgb', 'display-p3'][params.space], up = ['srgb', 'display-p3'][params.unpack];
      if (s.hasDB && gl.drawingBufferColorSpace !== sp) { try { gl.drawingBufferColorSpace = sp; } catch (_) { /* unsupported value */ } }
      if (s.hasUP) { try { gl.unpackColorSpace = up; } catch (_) { /* unsupported value */ } }
      if (s.swTex) util.release(s.swTex);
      s.swTex = util.texture({ source: s.sw, filter: gl.NEAREST });
      if (s.hasUP) gl.unpackColorSpace = 'srgb';
      s.panel.innerHTML = `drawingBufferColorSpace <b>${s.hasDB ? gl.drawingBufferColorSpace : 'unsupported'}</b><br>unpackColorSpace (swatch upload) <b>${s.hasUP ? up : 'unsupported'}</b><br>`
        + `2D swatch canvas <b>${s.p3 ? 'display-p3' : 'srgb'}</b><br>EXT_sRGB <b class="${s.srgb ? 'on' : 'off'}">${s.srgb ? 'SRGB_ALPHA_EXT texture' : 'unavailable (emulated)'}</b><br>`
        + `<span style="opacity:.7">Wide-gamut differences only show on a display-p3 screen.</span>`;
    },
    onParam(ctx, s) { this.apply(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, util } = ctx;
      const W = ctx.width, H = ctx.height, dpr = ctx.dpr, cw = ctx.cssWidth, ch = ctx.cssHeight;
      gl.viewport(0, 0, W, H);
      s.backdrop.use().set({ u_res: [W, H], u_t: t });
      util.drawFullscreen();
      const ax = 16, aw = cw - 32, ay = ctx.capture ? 30 : Math.max(80, s.panel.offsetHeight + 84), ah = ch - ay - (ctx.capture ? 20 : 70);
      if (input.down && !ctx.capture) { s.split = clamp((input.x - ax) / aw, 0.02, 0.98); s.touched = true; }
      else if (!s.touched) s.split = 0.5 + 0.22 * Math.sin(t * 0.5);
      const rows = 5, rh = ah / rows;
      gl.enable(gl.SCISSOR_TEST);
      util.tex(0, s.rgbTex); if (s.srgbTex) util.tex(1, s.srgbTex); util.tex(2, s.swTex);
      for (let r = 0; r < rows; r++) {
        const x = ax * dpr, y = H - (ay + r * rh + rh) * dpr, w = aw * dpr, h = (rh - 22) * dpr;
        gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
        s.prog.use().set({ u_split: s.split, u_row: r, u_res: [w, h], u_t: t, u_rgb: 0, u_srgb: 1, u_sw: 2, u_hasSrgb: s.srgbTex ? 1 : 0 });
        util.drawFullscreen();
        place(s.rowL[r], ax, ay + r * rh + 6);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, W, H);
      const sx = ax + aw * s.split;
      place(s.sideL, sx - 150, ay - 14); s.sideL.style.width = '140px'; s.sideL.style.textAlign = 'right';
      place(s.sideR, sx + 10, ay - 14);
      ctx.canvas.style.cursor = 'ew-resize';
    },
    dispose(ctx, s) {
      const gl = ctx.gl;
      if (s.hasDB) { try { gl.drawingBufferColorSpace = 'srgb'; } catch (_) { /* ignore */ } }
      if (s.hasUP) { try { gl.unpackColorSpace = 'srgb'; } catch (_) { /* ignore */ } }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 6. OffscreenCanvas in a worker                                    */
  /* ---------------------------------------------------------------- */
  const CLOCK_FS = `
uniform float u_t; uniform vec2 u_res; uniform vec2 u_m; uniform vec3 u_tint;
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y * 2.2;
  float r = length(p), a = atan(p.y, p.x);
  float behind = mod(-u_t * 2.4 - a, 6.28318);
  float trail = exp(-behind * 1.2) * smoothstep(0.98, 0.94, r) * smoothstep(0.12, 0.16, r);
  float ticks = smoothstep(0.85, 1.0, cos(a * 60.0)) * smoothstep(0.02, 0.0, abs(r - 0.92));
  float ring = smoothstep(0.012, 0.0, abs(r - 1.0));
  vec2 m = (u_m - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 2.2;
  float glow = exp(-dot(p - m, p - m) * 10.0);
  float orb = smoothstep(0.08, 0.06, length(p - vec2(cos(u_t * 1.3), sin(u_t * 1.3)) * 0.6));
  vec3 ink = vec3(0.027, 0.031, 0.047);
  vec3 c = ink + u_tint * trail * 0.9 + vec3(0.93, 0.91, 0.88) * (ticks * 0.5 + ring * 0.35 + orb) + u_tint * glow * 0.35;
  gl_FragColor = vec4(c, 1.0);
}`;
  const WORKER_SRC = `
let gl, U = {}, ptr = null, epoch = 0, frames = 0, last = performance.now(), running = true, raf;
self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'init') {
    epoch = d.epoch;
    gl = d.canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) { self.postMessage({ type: 'error', msg: 'getContext("webgl") failed in the worker' }); return; }
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;\\n' + d.fs));
    gl.bindAttribLocation(prog, 0, 'a_pos'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { self.postMessage({ type: 'error', msg: gl.getProgramInfoLog(prog) }); return; }
    gl.useProgram(prog);
    for (const n of ['u_t', 'u_res', 'u_m', 'u_tint']) U[n] = gl.getUniformLocation(prog, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(U.u_tint, d.tint[0], d.tint[1], d.tint[2]);
    raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(f, 16);
    self.postMessage({ type: 'ready', raf: !!self.requestAnimationFrame });
    loop();
  } else if (d.type === 'ptr') ptr = d.p;
  else if (d.type === 'size' && gl) { gl.canvas.width = d.w; gl.canvas.height = d.h; }
  else if (d.type === 'stop') running = false;
};
function loop() {
  if (!running) return;
  const now = performance.now(), t = (performance.timeOrigin + now - epoch) / 1000;
  const W = gl.canvas.width, H = gl.canvas.height;
  gl.viewport(0, 0, W, H);
  const m = ptr || [0.5 + 0.3 * Math.cos(t * 0.7), 0.5 + 0.3 * Math.sin(t * 0.9)];
  gl.uniform1f(U.u_t, t); gl.uniform2f(U.u_res, W, H); gl.uniform2f(U.u_m, m[0], m[1]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  frames++;
  if (now - last > 500) { self.postMessage({ type: 'fps', fps: frames * 1000 / (now - last) }); frames = 0; last = now; }
  raf(loop);
}`;
  S.register({
    id: 'offscreen-worker',
    title: 'OffscreenCanvas in a Worker',
    category: CAT,
    thumb: 'square',
    hint: 'block the main thread · compare the two clocks',
    description: 'The right canvas hands its drawing surface to a worker with transferControlToOffscreen; the worker creates its own WebGL 1.0 context and runs its own animation loop. The left half is drawn by the page as usual. Turn on the main-thread blocker, which busy-waits for 200 ms every 400 ms, and the page clock stutters while the worker clock keeps sweeping. Pointer positions are forwarded to the worker with postMessage.',
    interact: [['Move', 'both glows follow the pointer (the worker via postMessage)'], ['Block main thread', 'busy-wait 200 ms every 400 ms'], ['Restart', 'terminate and recreate the worker']],
    features: ['canvas.transferControlToOffscreen()', 'new Worker(Blob URL)', 'OffscreenCanvas.getContext(\'webgl\')', 'requestAnimationFrame in a worker', 'worker.postMessage(…, [offscreen])'],
    params: [
      { key: 'block', label: 'Block main thread', type: 'toggle', value: false },
      { key: 'restart', label: 'Restart worker', type: 'button' },
    ],
    code: `const off = canvas.transferControlToOffscreen();
const url = URL.createObjectURL(new Blob([src]));
const worker = new Worker(url);
worker.postMessage({ type: 'init', canvas: off }, [off]);
// worker.js
const gl = e.data.canvas.getContext('webgl');
(function loop() { draw(); requestAnimationFrame(loop); })();`,
    init(ctx) {
      const { util } = ctx;
      const prog = util.program(G.fullscreenVS, CLOCK_FS);
      const labL = el('div', 'ov-label cap-keep', '', ctx.overlay);
      const labR = el('div', 'ov-label cap-keep', '', ctx.overlay);
      const note = el('div', 'ov-label cap-keep', '', ctx.overlay);
      labL.style.fontSize = labR.style.fontSize = '12px';
      const s = { prog, labL, labR, note, cv: null, worker: null, url: null, wfps: 0, mfps: 60, status: '', blockTimer: 0, lastPtr: '', epoch: performance.timeOrigin + performance.now() };
      this.spawn(ctx, s);
      this.setBlock(ctx, s, ctx.params.block);
      return s;
    },
    spawn(ctx, s) {
      this.kill(s);
      const cv = el('canvas', 'ov-canvas cap-keep', null, null);
      ctx.overlay.insertBefore(cv, ctx.overlay.firstChild); // labels stay on top
      s.cv = cv; s.size = '';
      if (!cv.transferControlToOffscreen || !window.OffscreenCanvas || !window.Worker) { s.status = 'unsupported'; return; }
      try {
        cv.width = 300; cv.height = 300;
        const off = cv.transferControlToOffscreen();
        s.url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
        s.worker = new Worker(s.url);
        s.worker.onmessage = (e) => { const d = e.data; if (d.type === 'fps') s.wfps = d.fps; else if (d.type === 'ready') s.status = d.raf ? 'worker rAF' : 'worker setTimeout loop'; else if (d.type === 'error') s.status = 'error: ' + d.msg; };
        s.worker.onerror = (e) => { s.status = 'error: ' + (e.message || 'worker failed'); e.preventDefault(); };
        s.worker.postMessage({ type: 'init', canvas: off, fs: CLOCK_FS, tint: S.A1, epoch: s.epoch }, [off]);
        s.status = 'starting';
      } catch (err) { s.status = 'unsupported: ' + err.message; }
    },
    kill(s) {
      if (s.worker) { s.worker.terminate(); s.worker = null; }
      if (s.url) { URL.revokeObjectURL(s.url); s.url = null; }
      if (s.cv) { s.cv.remove(); s.cv = null; }
      s.wfps = 0;
    },
    setBlock(ctx, s, on) {
      clearInterval(s.blockTimer); s.blockTimer = 0;
      if (on) s.blockTimer = setInterval(() => { const end = performance.now() + 200; while (performance.now() < end) { /* busy */ } }, 400);
    },
    onParam(ctx, s, key, v) { if (key === 'block') this.setBlock(ctx, s, v); },
    action(ctx, s, key) { if (key === 'restart') this.spawn(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, util } = ctx;
      const W = ctx.width, H = ctx.height, dpr = ctx.dpr, cw = ctx.cssWidth, ch = ctx.cssHeight;
      const tt = (performance.timeOrigin + performance.now() - s.epoch) / 1000;
      if (dt > 0) s.mfps += (1 / Math.max(dt, 1e-3) - s.mfps) * 0.1;
      const half = Math.floor(cw / 2);
      const top = ctx.capture ? 0 : 0, bot = 0;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.02, 0.022, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      // left half: main thread
      const lw = Math.round(half * dpr) - Math.round(2 * dpr);
      gl.viewport(0, 0, lw, H);
      const live = input.hover && !ctx.capture;
      const m = live ? [clamp(input.x / (lw / dpr), 0, 1), input.uvy] : [0.5 + 0.3 * Math.cos(tt * 0.7), 0.5 + 0.3 * Math.sin(tt * 0.9)];
      s.prog.use().set({ u_t: tt, u_res: [lw, H], u_m: m, u_tint: S.A2 });
      util.drawFullscreen();
      gl.viewport(0, 0, W, H);
      if (s.cv) {
        place(s.cv, half + 1, top, cw - half - 1, ch - top - bot);
        s.cv.style.border = '0'; s.cv.style.borderLeft = '1px solid rgba(236,233,226,.18)';
        const sz = Math.round((cw - half - 1) * dpr) + 'x' + Math.round((ch - top - bot) * dpr);
        if (s.worker && sz !== s.size) { s.size = sz; const [w, h] = sz.split('x').map(Number); s.worker.postMessage({ type: 'size', w, h }); }
        if (s.worker) {
          const wp = live ? [clamp((input.x - half) / (cw - half), -1, 2), input.uvy] : null;
          const key = wp ? wp[0].toFixed(3) + wp[1].toFixed(3) : 'ghost';
          if (key !== s.lastPtr) { s.lastPtr = key; s.worker.postMessage({ type: 'ptr', p: wp }); }
        }
      }
      const blocked = ctx.params.block;
      place(s.labL, 16, ch - (ctx.capture ? 34 : 92));
      s.labL.innerHTML = `<span style="color:var(--acc2)">main thread</span> · ${Math.round(s.mfps)} fps`;
      place(s.labR, half + 16, ch - (ctx.capture ? 34 : 92));
      const unsupported = !s.worker;
      s.labR.innerHTML = unsupported ? `<span style="color:var(--acc2)">OffscreenCanvas transfer not supported here</span>` : `<span style="color:var(--acc1)">worker · OffscreenCanvas</span> · ${Math.round(s.wfps)} fps`;
      place(s.note, 16, ctx.capture ? 16 : 52);
      s.note.style.display = ctx.capture ? 'none' : '';
      s.note.innerHTML = blocked ? '<span style="color:var(--acc2)">● main thread blocked 200 ms every 400 ms</span>' : `main thread free · ${esc(s.status)}`;
    },
    dispose(ctx, s) {
      clearInterval(s.blockTimer);
      if (s.worker) s.worker.postMessage({ type: 'stop' });
      this.kill(s);
    },
  });

  /* ---------------------------------------------------------------- */
  /* 7. Debug extensions                                               */
  /* ---------------------------------------------------------------- */
  const DEBUG_FS = `// edit me: this fragment shader draws the canvas
uniform float u_t;
uniform vec2 u_res;
uniform vec2 u_m;
varying vec2 v_uv;

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float d = length(p - (u_m - 0.5) * 0.6);
  float w = sin(d * 38.0 - u_t * 3.0) * 0.5 + 0.5;
  float v = sin(p.x * 9.0 + u_t) * sin(p.y * 9.0 - u_t * 0.7);
  vec3 a = vec3(0.22, 0.839, 0.91), b = vec3(1.0, 0.31, 0.639);
  vec3 c = mix(a, b, w) * smoothstep(-0.3, 1.0, v + w * 0.6);
  c = mix(vec3(0.027, 0.031, 0.047), c, 0.85 - d * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;
  S.register({
    id: 'debug-tools',
    title: 'Debug Extensions',
    category: CAT,
    thumb: 'tall',
    hint: 'edit the shader · provoke a GL error',
    description: 'WEBGL_debug_renderer_info reveals the unmasked GPU vendor and renderer behind the generic VENDOR and RENDERER strings. WEBGL_debug_shaders returns the source the browser actually hands to the driver after translation; edit the fragment shader on the left and the translation updates as you type. The getError lab deliberately provokes each error code on a separate, private context, so the context that draws this page always ends its frame with getError() returning NO_ERROR.',
    interact: [['Type', 'edit the fragment shader; it recompiles after a pause'], ['Error buttons', 'provoke INVALID_ENUM, INVALID_VALUE, INVALID_OPERATION or INVALID_FRAMEBUFFER_OPERATION'], ['Move', 'the shader reads the pointer as u_m']],
    features: ['WEBGL_debug_renderer_info', 'UNMASKED_VENDOR_WEBGL · UNMASKED_RENDERER_WEBGL', 'WEBGL_debug_shaders.getTranslatedShaderSource', 'gl.getError() until NO_ERROR', 'INVALID_ENUM · VALUE · OPERATION · FRAMEBUFFER_OPERATION'],
    params: [
      { key: 'reset', label: 'Reset shader', type: 'button' },
    ],
    captureKeys: true,
    code: `const info = gl.getExtension('WEBGL_debug_renderer_info');
gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
const dbg = gl.getExtension('WEBGL_debug_shaders');
dbg.getTranslatedShaderSource(shader);
gl.enable(0x1234);            // → INVALID_ENUM
while (gl.getError() !== gl.NO_ERROR) {}`,
    init(ctx) {
      const { gl, util } = ctx;
      const ri = util.ext('WEBGL_debug_renderer_info');
      const ds = util.ext('WEBGL_debug_shaders');
      const ed = el('div', 'ov-editor', null, ctx.overlay);
      const ta = el('textarea', null, null, ed);
      ta.spellcheck = false; ta.value = DEBUG_FS;
      const log = el('div', 'log', null, ed);
      log.style.maxHeight = '42%';
      const info = el('div', 'ov-panel ov-tr', null, ctx.overlay); info.style.width = '300px';
      const v = (k) => esc(String(gl.getParameter(k)));
      info.innerHTML = `<b>WEBGL_debug_renderer_info</b><br>`
        + (ri ? `UNMASKED_VENDOR <b>${v(ri.UNMASKED_VENDOR_WEBGL)}</b><br>UNMASKED_RENDERER <b>${v(ri.UNMASKED_RENDERER_WEBGL)}</b><br>` : '<span class="off">not exposed by this browser</span><br>')
        + `<span style="opacity:.7">VENDOR ${v(gl.VENDOR)} · RENDERER ${v(gl.RENDERER)}</span><br><span style="opacity:.7">${v(gl.VERSION)}</span>`;
      const lab = el('div', 'ov-panel ov-br', null, ctx.overlay); lab.style.width = '300px';
      const labHead = el('div', null, '<b>getError lab</b> <span style="opacity:.6">· private context</span>', lab);
      const btns = el('div', 'ov-btns', ['INVALID_ENUM', 'INVALID_VALUE', 'INVALID_OPERATION', 'INVALID_FRAMEBUFFER_OPERATION'].map((n) => `<button data-k="${n}">${n.replace('INVALID_', '').replace('FRAMEBUFFER_OPERATION', 'FRAMEBUFFER_OP').toLowerCase()}</button>`).join(''), lab);
      const labOut = el('div', null, '<span style="opacity:.6">press a button: the call runs on a separate context and getError() reports the code</span>', lab);
      labOut.style.marginTop = '8px';
      // private context for the deliberate errors
      const ecv = document.createElement('canvas'); ecv.width = ecv.height = 4;
      const eg = ecv.getContext('webgl');
      const s = { ri, ds, ta, log, info, lab, labHead, labOut, eg, prog: null, drained: 0, timer: 0, hist: [], m: [0.5, 0.5] };
      btns.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.provoke(s, b.dataset.k)));
      ta.addEventListener('input', () => { clearTimeout(s.timer); s.timer = setTimeout(() => this.compile(ctx, s), 350); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
      this.compile(ctx, s);
      return s;
    },
    compile(ctx, s) {
      const { gl, util } = ctx;
      const src = s.ta.value;
      // translation via a raw shader object (the util deletes its shaders after linking)
      let translated = '';
      const sh = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(sh, (util.fsHigh ? 'precision highp float;\n' : 'precision mediump float;\n') + src);
      gl.compileShader(sh);
      const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
      if (ok && s.ds) translated = s.ds.getTranslatedShaderSource(sh);
      const errLog = ok ? '' : gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      if (!ok) { s.log.className = 'log'; s.log.textContent = errLog.trim() || 'compile failed'; return; }
      try {
        const p = util.program(G.fullscreenVS, src);
        if (s.prog) util.release(s.prog.prog);
        s.prog = p;
        s.log.className = 'log ok';
        s.log.textContent = `compiled · ${p.uniforms.length} active uniforms\n\n` + (s.ds ? '// getTranslatedShaderSource()\n' + (translated || '(empty string: this platform does not expose it)') : 'WEBGL_debug_shaders is not available here.');
      } catch (err) { s.log.className = 'log'; s.log.textContent = err.message; }
    },
    provoke(s, kind) {
      const g = s.eg;
      if (!g || g.isContextLost()) { s.labOut.innerHTML = '<span class="off">no private context available</span>'; return; }
      while (g.getError() !== g.NO_ERROR) { /* start clean */ }
      let call = '';
      if (kind === 'INVALID_ENUM') { g.enable(0x1234); call = 'gl.enable(0x1234)'; }
      else if (kind === 'INVALID_VALUE') { g.viewport(0, 0, -1, -1); call = 'gl.viewport(0, 0, -1, -1)'; }
      else if (kind === 'INVALID_OPERATION') { g.useProgram(null); g.drawArrays(g.TRIANGLES, 0, 3); call = 'drawArrays with no program'; }
      else { const fb = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, fb); g.clear(g.COLOR_BUFFER_BIT); g.bindFramebuffer(g.FRAMEBUFFER, null); g.deleteFramebuffer(fb); call = 'clear() on an empty framebuffer'; }
      const codes = []; let e, n = 0;
      while ((e = g.getError()) !== g.NO_ERROR && n++ < 8) codes.push(e);
      const first = codes[0] || 0;
      s.hist.unshift(`${call} → <b class="${first ? 'off' : 'on'}">${ERR[first] || '0x' + first.toString(16)}</b> <span style="opacity:.6">0x${first.toString(16)}</span>`);
      s.hist.length = Math.min(s.hist.length, 5);
      s.labOut.innerHTML = s.hist.join('<br>') + '<br><span style="opacity:.6">then getError() → NO_ERROR</span>';
      s.lab.animate([{ borderColor: '#ff4fa3' }, { borderColor: 'rgba(236,233,226,.12)' }], { duration: 600 });
    },
    action(ctx, s, key) { if (key === 'reset') { s.ta.value = DEBUG_FS; this.compile(ctx, s); } },
    frame(ctx, s, t, dt) {
      const { gl, input, util } = ctx;
      const live = input.hover && !ctx.capture;
      const tm = live ? [input.uvx, input.uvy] : [0.5 + 0.35 * Math.cos(t * 0.4), 0.5 + 0.3 * Math.sin(t * 0.6)];
      const k = damp(6, dt); s.m[0] += (tm[0] - s.m[0]) * k; s.m[1] += (tm[1] - s.m[1]) * k;
      gl.viewport(0, 0, ctx.width, ctx.height);
      if (s.prog) { s.prog.use().set({ u_t: t, u_res: [ctx.width, ctx.height], u_m: s.m }); util.drawFullscreen(); }
      else { gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      // leave every frame with a clean error state
      let e, n = 0;
      while ((e = gl.getError()) !== gl.NO_ERROR && n++ < 32) s.drained++;
    },
    dispose(ctx, s) {
      clearTimeout(s.timer);
      loseCtx(s.eg);
    },
  });
})();
