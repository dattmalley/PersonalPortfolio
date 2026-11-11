/* Pressure Ink — pen pressure, tilt, twist and the eraser end drive a brush
 * of instanced elliptical stamps. Uses getCoalescedEvents() to capture every
 * high-frequency pen sample between frames. Mouse users get speed-based
 * pressure simulation. */
(function () {
  const S = window.Sandbox;
  const MAXS = 4096;

  const STAMP_VS = `
layout(location = 0) in vec4 a_s;   // x, y (px), size, angle
layout(location = 1) in vec4 a_c;   // r, g, b, alpha
layout(location = 2) in float a_round;
uniform vec2 u_res;
out vec2 v_q; out vec4 v_c;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 r = vec2(a_s.z, a_s.z * a_round);
  float c = cos(a_s.w), s = sin(a_s.w);
  vec2 p = a_s.xy + mat2(c, s, -s, c) * (corner * r);
  v_q = corner; v_c = a_c;
  vec2 cl = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(cl.x, -cl.y, 0.0, 1.0);
}`;
  const STAMP_FS = `
in vec2 v_q; in vec4 v_c; out vec4 o;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float d = length(v_q);
  float a = smoothstep(1.0, 0.75, d) * v_c.a;
  a *= 0.85 + 0.15 * h(gl_FragCoord.xy);      // dry-brush grain
  if (a <= 0.002) discard;
  o = vec4(v_c.rgb * a, a);
}`;
  const PAPER = S.GLSL.colors + `
in vec2 v_uv; out vec4 o; uniform sampler2D u_ink; uniform vec2 u_res;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 px = v_uv * u_res;
  float fib = n(px * vec2(0.02, 0.6)) * 0.5 + n(px * 0.15) * 0.5;
  vec3 paper = vec3(0.075, 0.072, 0.07) + fib * 0.025;
  vec4 ink = texture(u_ink, v_uv);
  vec3 c = paper * (1.0 - ink.a) + ink.rgb;
  // wet edge darkening
  float e = ink.a - texture(u_ink, v_uv + vec2(1.5) / u_res).a;
  c += max(e, 0.0) * 0.25;
  o = vec4(c, 1.0);
}`;

  const INKS = [[1.0, 0.231, 0.306], [0.231, 0.545, 1.0], [0.93, 0.91, 0.87]];

  function targets(ctx, s) {
    const { gl, util } = ctx;
    const old = s.inkTex ? { tex: s.inkTex, fb: s.inkFb, w: s.w, h: s.h } : null;
    s.w = ctx.width; s.h = ctx.height;
    s.inkTex = util.texture({ width: s.w, height: s.h });
    s.inkFb = util.framebuffer([s.inkTex]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.inkFb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (old) { // keep the drawing across resizes
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.inkFb);
      gl.blitFramebuffer(0, 0, old.w, old.h, 0, s.h - old.h, old.w, s.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      util.release(old.tex, old.fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  S.register({
    id: 'pressure',
    title: 'Pressure Ink',
    category: 'Pointer & Touch',
    thumb: 'tall',
    hint: 'draw with a pen, finger or mouse',
    description: 'A brush that responds to everything a stylus reports: pressure sets the width, tilt angles and flattens a calligraphy nib, twist rotates it, and the eraser end erases. getCoalescedEvents() recovers every pen sample the browser collected between frames, which can be several per frame, so strokes stay smooth at any speed. With a mouse, speed thins the line in place of pressure.',
    interact: [['Pen pressure', 'Line width'], ['Pen tilt / twist', 'Nib angle and flatness'], ['Pen eraser end', 'Erase'], ['Mouse / finger', 'Speed-simulated pressure'], ['Right-click / Shift', 'Erase with the mouse']],
    features: ['PointerEvent.pressure / tiltX / tiltY / twist', 'getCoalescedEvents()', 'Pen eraser detection (buttons & 32)', 'Instanced elliptical stamps', 'Persistent render target'],
    params: [
      { key: 'ink', label: 'Ink', type: 'select', options: ['Red', 'Blue', 'Bone'], value: 0 },
      { key: 'nib', label: 'Nib', type: 'select', options: ['Round', 'Calligraphy'], value: 1 },
      { key: 'size', label: 'Max width', type: 'range', min: 2, max: 60, step: 1, value: 18 },
      { key: 'flow', label: 'Flow', type: 'range', min: 0.05, max: 1, step: 0.01, value: 0.55 },
      { key: 'sim', label: 'Simulate pressure from speed', type: 'toggle', value: true },
      { key: 'clear', label: 'Clear page', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const data = new Float32Array(MAXS * 9);
      const buf = util.buffer(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const s = {
        stampP: util.program(STAMP_VS, STAMP_FS), paperP: util.program(S.GLSL.fullscreenVS, PAPER), data, buf,
        vao: util.vao([{ buffer: buf, loc: 0, size: 4, stride: 36, divisor: 1 }, { buffer: buf, loc: 1, size: 4, stride: 36, offset: 16, divisor: 1 }, { buffer: buf, loc: 2, size: 1, stride: 36, offset: 32, divisor: 1 }]),
        queue: [], last: new Map(), n: 0, readout: { p: 0, tilt: 0, type: '—', co: 0 }, demo: 0,
      };
      targets(ctx, s);
      const onMove = (e) => {
        if (!(e.buttons & 1) && !(e.buttons & 2) && !(e.buttons & 32) && e.pointerType !== 'pen') return;
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        const r = ctx.canvas.getBoundingClientRect();
        s.readout.co = evs.length;
        const btn = e.buttons;   // coalesced samples share the parent event's button state
        if (!(btn & 1) && !(btn & 32) && !(btn & 2)) { s.queue.push({ id: e.pointerId, brk: true }); return; }
        for (const c of (evs.length ? evs : [e])) {
          s.queue.push({ id: e.pointerId, x: c.clientX - r.left, y: c.clientY - r.top, p: c.pressure || e.pressure, tx: c.tiltX || 0, ty: c.tiltY || 0, tw: c.twist || 0, type: e.pointerType, erase: !!(btn & 32) || !!(btn & 2) || e.shiftKey, t: c.timeStamp || e.timeStamp });
        }
      };
      // stroke breaks go through the queue so they are applied in order with the samples
      const onUp = (e) => s.queue.push({ id: e.pointerId, brk: true });
      const onDown = (e) => { const r = ctx.canvas.getBoundingClientRect(); s.queue.push({ id: e.pointerId, brk: true }); s.queue.push({ id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure, tx: e.tiltX || 0, ty: e.tiltY || 0, tw: e.twist || 0, type: e.pointerType, erase: !!(e.buttons & 32) || e.button === 2 || e.shiftKey, t: e.timeStamp }); };
      ctx.canvas.addEventListener('pointermove', onMove);
      ctx.canvas.addEventListener('pointerdown', onDown);
      ctx.canvas.addEventListener('pointerup', onUp);
      s.off = () => { ctx.canvas.removeEventListener('pointermove', onMove); ctx.canvas.removeEventListener('pointerdown', onDown); ctx.canvas.removeEventListener('pointerup', onUp); };
      ctx.overlay.innerHTML = '<div id="pi-read" style="position:absolute;left:34px;top:64px;font-family:var(--mono);font-size:11px;line-height:1.9;color:var(--text-2)"></div>';
      s.readEl = ctx.overlay.querySelector('#pi-read');
      return s;
    },
    resize(ctx, s) { targets(ctx, s); },
    dispose(ctx, s) { s.off(); },
    action(ctx, s, key) { if (key === 'clear') { const { gl } = ctx; gl.bindFramebuffer(gl.FRAMEBUFFER, s.inkFb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null); s.demo = 0; } },
    frame(ctx, s, t, dt) {
      const { gl, params } = ctx;
      // demo signature when the page is empty, so the study reads immediately
      if (s.demo < 160) {
        for (let k = 0; k < 3 && s.demo < 160; k++, s.demo++) {
          const u = s.demo / 160, W = ctx.cssWidth, H = ctx.cssHeight;
          const x = W * (0.2 + 0.6 * u), y = H * (0.55 + 0.16 * Math.sin(u * 9.0) * Math.cos(u * 3.0));
          s.queue.push({ id: -1, x, y, p: 0.25 + 0.75 * Math.pow(Math.sin(u * Math.PI), 0.7), tx: 30, ty: -20, tw: 0, type: 'pen', erase: false, t: s.demo * 8, synthetic: true });
        }
      }
      const out = [];
      const ink = INKS[params.ink];
      for (const e of s.queue) {
        if (e.brk) { s.last.delete(e.id); continue; }
        const prev = s.last.get(e.id);
        let p = e.p;
        if ((e.type !== 'pen' || p === 0.5) && params.sim && prev) {
          const v = Math.hypot(e.x - prev.x, e.y - prev.y) / Math.max(e.t - prev.t, 1);   // px per ms
          p = Math.max(0.15, 1 - v * 0.55);
          p = prev.ps + (p - prev.ps) * 0.3;
        } else if (e.type !== 'pen' && !params.sim) p = 0.6;
        if (e.type === 'pen' && p === 0) p = 0.01;
        const tiltMag = Math.min(1, Math.hypot(e.tx, e.ty) / 60);
        const angle = params.nib === 1 ? (e.tx || e.ty ? Math.atan2(e.ty, e.tx) : -0.6) + e.tw * Math.PI / 180 : 0;
        const round = params.nib === 1 ? 0.28 + 0.5 * (1 - tiltMag) : 1;
        const size = Math.max(0.6, params.size * p * (params.nib === 1 ? 1 : 0.6) * (1 + tiltMag * 0.5)) * ctx.dpr;
        s.readout.p = p; s.readout.tilt = Math.round(Math.hypot(e.tx, e.ty)); s.readout.type = e.synthetic ? 'demo stroke' : e.type + (e.erase ? ' · eraser' : '');
        const a = prev || e;
        const dist = Math.hypot(e.x - a.x, e.y - a.y) * ctx.dpr;
        const step = Math.max(0.6, size * 0.18);
        const n = Math.max(1, Math.ceil(dist / step));
        for (let i = 1; i <= n; i++) {
          const k = i / n;
          const sz = prev ? prev.size + (size - prev.size) * k : size;
          out.push([(a.x + (e.x - a.x) * k) * ctx.dpr, (a.y + (e.y - a.y) * k) * ctx.dpr, sz, angle, ...(e.erase ? [0, 0, 0] : ink), params.flow * (e.erase ? 1 : 0.9), round, e.erase]);
        }
        s.last.set(e.id, { x: e.x, y: e.y, t: e.t, ps: p, size });
      }
      s.queue.length = 0;
      if (s.demo >= 160) s.last.delete(-1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.inkFb);
      gl.viewport(0, 0, s.w, s.h);
      gl.enable(gl.BLEND);
      s.stampP.use().set({ u_res: [s.w, s.h] });
      gl.bindVertexArray(s.vao);
      for (const erase of [false, true]) {
        const list = out.filter((o) => o[9] === erase);
        if (!list.length) continue;
        if (erase) gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        for (let off = 0; off < list.length; off += MAXS) {
          const chunk = list.slice(off, off + MAXS);
          chunk.forEach((o, i) => s.data.set(o.slice(0, 9), i * 9));
          gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data, 0, chunk.length * 9);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, chunk.length);
        }
      }
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.inkTex);
      s.paperP.use().set({ u_ink: 0, u_res: [ctx.width, ctx.height] });
      ctx.util.drawFullscreen();
      const r = s.readout;
      s.readEl.innerHTML = `pointer · ${r.type}<br>pressure <span style="display:inline-block;width:80px;height:2px;background:var(--rule-3);vertical-align:middle;position:relative"><span style="position:absolute;left:0;top:-1px;height:4px;width:${(r.p * 100).toFixed(0)}%;background:var(--red)"></span></span> ${r.p.toFixed(2)}<br>tilt ${r.tilt}° · coalesced ${r.co}/event`;
    },
  });
})();
