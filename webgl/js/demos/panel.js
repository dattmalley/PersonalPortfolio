/* Instrument Panel — UI controls drawn entirely by the GPU: rotary knobs,
 * faders, an XY pad, an HSV colour wheel and toggles, each a signed-distance
 * shape in one instanced draw, with hit-testing, drag semantics and full
 * keyboard focus (Tab, arrows, Space, Home/End). They drive a live
 * oscilloscope-style Lissajous figure. */
(function () {
  const S = window.Sandbox;
  const { damp, clamp } = S.math;

  const UI_VS = `
layout(location = 0) in vec4 a_rect;   // x, y, w, h (css px)
layout(location = 1) in vec4 a_v;      // type, value1, value2, flags (1 focus, 2 hover, 4 active)
uniform vec2 u_res;
out vec2 v_p; out vec2 v_size; flat out vec4 v_v;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 pad = vec2(6.0);
  vec2 p = a_rect.xy - pad + corner * (a_rect.zw + pad * 2.0);
  v_p = (corner * (a_rect.zw + pad * 2.0) - pad) - a_rect.zw * 0.5; v_size = a_rect.zw; v_v = a_v;
  vec2 c = p / u_res * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
  const UI_FS = S.GLSL.colors + `
in vec2 v_p; in vec2 v_size; flat in vec4 v_v; out vec4 o;
vec3 hsv(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  int type = int(v_v.x); float v1 = v_v.y, v2 = v_v.z; int fl = int(v_v.w);
  bool focus = (fl & 1) != 0, hover = (fl & 2) != 0, pressed = (fl & 4) != 0;  // 'active' is reserved in GLSL ES
  vec3 c = vec3(0.0); float a = 0.0;
  vec3 ink = vec3(0.93, 0.91, 0.87);
  if (type == 0) {                                     // knob
    float R = min(v_size.x, v_size.y) * 0.5;
    float r = length(v_p), ang = atan(v_p.x, -v_p.y);  // 0 at bottom? (top = pi)
    float body = clamp(0.5 - (r - R * 0.62), 0.0, 1.0);
    c = vec3(0.1, 0.105, 0.12) * body; a = body;
    float t0 = -2.356, t1 = 2.356;                     // 270° sweep
    float aa = atan(v_p.x, v_p.y);                     // 0 at top, clockwise positive
    float trackD = abs(r - R * 0.86) - 2.0;
    float inSweep = step(t0, aa) * step(aa, t1);
    float track = clamp(0.5 - trackD, 0.0, 1.0) * inSweep;
    float val = t0 + (t1 - t0) * v1;
    float fill = track * step(aa, val);
    c = mix(c, vec3(0.22), track * 0.8); a = max(a, track);
    c = mix(c, RED, fill);
    // pointer line
    vec2 dir = vec2(sin(val), cos(val));
    float along = dot(v_p, dir), perp = abs(dot(v_p, vec2(-dir.y, dir.x)));
    float ptr = clamp(0.5 - (perp - 1.5), 0.0, 1.0) * step(R * 0.18, along) * step(along, R * 0.58);
    c = mix(c, ink, ptr); a = max(a, ptr);
    if (hover || pressed) c += body * 0.04;
  } else if (type == 1) {                              // vertical fader
    float trk = clamp(0.5 - box(v_p, vec2(2.0, v_size.y * 0.5), 2.0), 0.0, 1.0);
    float fillY = (0.5 - v1) * v_size.y;
    float fill = trk * step(fillY, v_p.y);
    float capY = fillY;
    float cap = clamp(0.5 - box(v_p - vec2(0.0, capY), vec2(v_size.x * 0.45, 6.0), 2.0), 0.0, 1.0);
    c = mix(vec3(0.2), BLUE, fill / max(trk, 1e-3)) * trk; a = trk;
    c = mix(c, (hover || pressed) ? ink : vec3(0.75, 0.74, 0.72), cap); a = max(a, cap);
  } else if (type == 2) {                              // XY pad
    vec2 h = v_size * 0.5;
    float bx = clamp(0.5 - box(v_p, h, 4.0), 0.0, 1.0);
    vec2 g = abs(fract(v_p / 24.0) - 0.5) * 24.0;
    float grid = (1.0 - smoothstep(0.0, 1.0, min(g.x, g.y))) * 0.08;
    vec2 pt = (vec2(v1, 1.0 - v2) - 0.5) * v_size;
    float cross_ = max(clamp(1.0 - abs(v_p.x - pt.x), 0.0, 1.0), clamp(1.0 - abs(v_p.y - pt.y), 0.0, 1.0)) * 0.35;
    float dotm = clamp(0.5 - (length(v_p - pt) - 7.0), 0.0, 1.0);
    c = vec3(0.07, 0.075, 0.09) * bx + grid * bx + cross_ * BLUE * bx; a = bx;
    c = mix(c, RED, dotm);
  } else if (type == 3) {                              // colour wheel (hue = angle, sat = radius)
    float R = min(v_size.x, v_size.y) * 0.5;
    float r = length(v_p);
    float disc = clamp(0.5 - (r - R), 0.0, 1.0);
    float h = atan(-v_p.y, v_p.x) / 6.2831853 + 0.5;
    c = hsv(vec3(h, clamp(r / R, 0.0, 1.0), 0.9)) * disc; a = disc;
    vec2 mp = vec2(cos((v1 - 0.5) * 6.2831853), -sin((v1 - 0.5) * 6.2831853)) * v2 * R * -1.0;
    float ring = clamp(0.5 - abs(length(v_p - mp) - 7.0) + 1.0, 0.0, 1.0);
    c = mix(c, ink, ring); a = max(a, ring);
  } else {                                             // toggle
    vec2 h = vec2(v_size.x * 0.5, min(v_size.y * 0.5, 13.0));
    float pill = clamp(0.5 - box(v_p, h, h.y), 0.0, 1.0);
    float kx = mix(-h.x + h.y, h.x - h.y, v1);
    float knob = clamp(0.5 - (length(v_p - vec2(kx, 0.0)) - h.y + 4.0), 0.0, 1.0);
    c = mix(vec3(0.16), BLUE, v1) * pill; a = pill;
    c = mix(c, ink, knob);
  }
  if (focus) {                                         // keyboard focus ring
    float fr = clamp(1.0 - abs(box(v_p, v_size * 0.5 + 4.0, 6.0)), 0.0, 1.0);
    c = mix(c, BLUE, fr); a = max(a, fr);
  }
  o = vec4(c * a, a);
}`;
  const SCOPE_VS = S.GLSL.colors + `
uniform vec4 u_area; uniform vec2 u_res; uniform vec4 u_k;   // fx, fy, phase, decay
uniform vec2 u_off; uniform float u_size; uniform float u_time; uniform float u_echo; uniform bool u_mirror;
out float v_a;
void main() {
  int id = gl_VertexID % 3000; int copy = gl_VertexID / 3000;
  float t = float(id) / 3000.0 * 6.2831853 * 4.0;
  float ph = u_k.z + u_time * 0.6 - u_echo * float(copy) * 0.06;
  float env = exp(-u_k.w * float(id) / 3000.0 * 3.0);
  vec2 p = vec2(sin(u_k.x * t + ph), sin(u_k.y * t)) * env * 0.42 + u_off * 0.3;
  if (u_mirror && copy % 2 == 1) p.x = -p.x;
  vec2 px = u_area.xy + (p * vec2(1.0, -1.0) + 0.5) * u_area.zw;
  vec2 c = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  gl_PointSize = u_size;
  v_a = (1.0 - float(copy) / 6.0) * (0.35 + 0.65 * env);
}`;
  const SCOPE_FS = `in float v_a; out vec4 o; uniform vec3 u_col; uniform float u_glow;
void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.0, r) * v_a * u_glow; o = vec4(u_col * a, a); }`;

  const CONTROLS = [
    { key: 'fx', label: 'Freq X', type: 0, min: 1, max: 9, v: 3, step: 1 },
    { key: 'fy', label: 'Freq Y', type: 0, min: 1, max: 9, v: 2, step: 1 },
    { key: 'phase', label: 'Phase', type: 0, min: 0, max: 6.283, v: 1.2 },
    { key: 'decay', label: 'Decay', type: 0, min: 0, max: 1, v: 0.15 },
    { key: 'size', label: 'Thickness', type: 1, min: 1, max: 8, v: 2.5 },
    { key: 'glow', label: 'Glow', type: 1, min: 0.1, max: 1, v: 0.7 },
    { key: 'xy', label: 'Offset XY', type: 2, v: 0.5, v2: 0.5 },
    { key: 'col', label: 'Colour', type: 3, v: 0.02, v2: 0.85 },
    { key: 'mirror', label: 'Mirror', type: 4, v: 0 },
    { key: 'echo', label: 'Echo trails', type: 4, v: 1 },
  ];

  function layout(ctx, s) {
    const W = ctx.cssWidth, H = ctx.cssHeight, portrait = W < H * 0.95;
    const pw = portrait ? W : Math.min(440, W * 0.46), ph = portrait ? H * 0.5 : H;
    const ox = 30, oy = portrait ? H - ph + 10 : 70;
    const k = Math.min(78, (pw - 60) / 4 - 14);
    s.ctl.forEach((c, i) => {
      if (c.type === 0) c.r = [ox + i * (k + 14), oy, k, k];
      else if (c.type === 1) c.r = [ox + 8 + (i - 4) * 62, oy + k + 52, 22, Math.min(140, ph * 0.36)];
      else if (c.type === 2) c.r = [ox + 140, oy + k + 52, Math.min(140, ph * 0.36), Math.min(140, ph * 0.36)];
      else if (c.type === 3) { const d = Math.min(140, ph * 0.36); c.r = [ox + 140 + d + 34, oy + k + 52, d, d]; }
      else c.r = [ox + (i - 8) * 140, oy + k + 52 + Math.min(140, ph * 0.36) + 58, 52, 26];
    });
    s.area = portrait ? [W * 0.08, 60, W * 0.84, H * 0.42] : [pw + 40, 50, W - pw - 70, H - 110];
    s.labels.innerHTML = s.ctl.map((c) => `<div style="position:absolute;left:${c.r[0]}px;top:${c.r[1] + c.r[3] + 10}px;width:${c.type === 1 ? 58 : Math.max(c.r[2], 80)}px;font:10px var(--mono);color:#b9b6ae;letter-spacing:.04em">${c.label}<br><span data-k="${c.key}" style="color:#ece9e2"></span></div>`).join('');
  }

  S.register({
    id: 'panel',
    title: 'Instrument Panel',
    category: 'Selection',
    thumb: 'wide',
    captureKeys: true,
    hint: 'drag knobs vertically · Tab through controls · arrows adjust',
    description: 'User-interface controls drawn by the GPU rather than the DOM: rotary knobs with 270° arcs, faders, an XY pad, an HSV colour wheel and toggles, each a signed-distance shape in a single instanced draw. They behave like pro audio hardware. Knobs turn with a vertical drag (Shift for fine), the wheel or a double-click to reset. They are fully keyboard-accessible: Tab moves a focus ring, arrows adjust, Home/End jump, Space toggles. They play a live Lissajous oscilloscope.',
    interact: [['Drag knob up / down', 'Turn (Shift = fine) · wheel also turns'], ['Double-click', 'Reset to default'], ['Fader / XY pad / wheel', 'Drag to set'], ['Tab / Shift+Tab', 'Move keyboard focus'], ['← → ↑ ↓ · Home · End', 'Adjust the focused control'], ['Space / Enter', 'Toggle switches']],
    features: ['SDF UI widgets in one instanced draw', 'Custom hit-testing + drag semantics', 'Keyboard focus management', 'HSV colour wheel in GLSL', 'gl_VertexID-generated waveform'],
    params: [{ key: 'reset', label: 'Reset controls', type: 'button' }],
    init(ctx) {
      const { gl, util } = ctx;
      const data = new Float32Array(CONTROLS.length * 8);
      const buf = util.buffer(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const s = {
        uiP: util.program(UI_VS, UI_FS), scopeP: util.program(SCOPE_VS, SCOPE_FS), data, buf,
        vao: util.vao([{ buffer: buf, loc: 0, size: 4, stride: 32, divisor: 1 }, { buffer: buf, loc: 1, size: 4, stride: 32, offset: 16, divisor: 1 }]),
        ctl: CONTROLS.map((c) => ({ ...c, def: c.v, def2: c.v2 })), focus: 0, active: null, hover: -1, lastTap: 0,
      };
      ctx.overlay.innerHTML = '<div id="ip-labels" class="cap-keep" style="position:absolute;inset:0;pointer-events:none"></div>';
      s.labels = ctx.overlay.querySelector('#ip-labels');
      layout(ctx, s);
      s.onKey = (e) => {
        if (document.activeElement !== ctx.canvas) return;
        const c = s.ctl[s.focus];
        const norm = (x) => (c.max !== undefined ? (x - c.min) / (c.max - c.min) : x);
        const adj = (d) => { if (c.type === 2) { c.v = clamp(c.v + d[0], 0, 1); c.v2 = clamp(c.v2 + d[1], 0, 1); } else if (c.type === 3) { c.v = (c.v + d[0] + 1) % 1; c.v2 = clamp(c.v2 + d[1], 0, 1); } else if (c.type !== 4) { const st = c.step || (c.max - c.min) / 50; c.v = clamp(c.v + (d[0] + d[1]) / 0.02 * st, c.min, c.max); } };
        const big = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'Tab') { s.focus = (s.focus + (e.shiftKey ? -1 : 1) + s.ctl.length) % s.ctl.length; e.preventDefault(); }
        else if (e.key === 'ArrowRight') { adj([big, 0]); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { adj([-big, 0]); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { adj([0, big]); e.preventDefault(); }
        else if (e.key === 'ArrowDown') { adj([0, -big]); e.preventDefault(); }
        else if (e.key === 'Home' && c.max !== undefined) c.v = c.min;
        else if (e.key === 'End' && c.max !== undefined) c.v = c.max;
        else if ((e.key === ' ' || e.key === 'Enter') && c.type === 4) { c.v = c.v ? 0 : 1; e.preventDefault(); }
        void norm;
      };
      window.addEventListener('keydown', s.onKey);
      return s;
    },
    resize(ctx, s) { layout(ctx, s); },
    dispose(ctx, s) { window.removeEventListener('keydown', s.onKey); },
    action(ctx, s, key) { if (key === 'reset') s.ctl.forEach((c) => { c.v = c.def; if (c.def2 !== undefined) c.v2 = c.def2; }); },
    frame(ctx, s, t, dt) {
      const { gl, input } = ctx;
      const inside = (c, x, y) => x >= c.r[0] - 6 && x <= c.r[0] + c.r[2] + 6 && y >= c.r[1] - 6 && y <= c.r[1] + c.r[3] + 6;
      s.hover = s.ctl.findIndex((c) => inside(c, input.x, input.y));
      if (input.down && !s.active && s.hover >= 0) {
        s.active = s.ctl[s.hover]; s.focus = s.hover;
        const now = performance.now();
        if (now - s.lastTap < 320 && s.lastIdx === s.hover) { s.active.v = s.active.def; if (s.active.def2 !== undefined) s.active.v2 = s.active.def2; }
        s.lastTap = now; s.lastIdx = s.hover;
        if (s.active.type === 4) s.active.v = s.active.v ? 0 : 1;
      }
      if (!input.down) s.active = null;
      const c = s.active;
      if (c) {
        const lx = (input.x - c.r[0]) / c.r[2], ly = (input.y - c.r[1]) / c.r[3];
        if (c.type === 0) { const k = (input.shift ? 0.0012 : 0.006) * (c.max - c.min); c.v = clamp(c.v - input.dragDY * k, c.min, c.max); }
        else if (c.type === 1) c.v = c.min + clamp(1 - ly, 0, 1) * (c.max - c.min);
        else if (c.type === 2) { c.v = clamp(lx, 0, 1); c.v2 = clamp(1 - ly, 0, 1); }
        else if (c.type === 3) { const dx = lx - 0.5, dy = ly - 0.5; c.v = (Math.atan2(dy, -dx) / (Math.PI * 2) + 1) % 1; c.v2 = clamp(Math.hypot(dx, dy) * 2, 0, 1); }
      }
      if (input.wheel && s.hover >= 0) { const h = s.ctl[s.hover]; if (h.type === 0 || h.type === 1) h.v = clamp(h.v - input.wheel * 0.002 * (h.max - h.min), h.min, h.max); }
      // instance data
      s.ctl.forEach((k, i) => {
        const n1 = k.max !== undefined ? (k.v - k.min) / (k.max - k.min) : k.v;
        const fl = (i === s.focus && document.activeElement === ctx.canvas ? 1 : 0) | (i === s.hover ? 2 : 0) | (k === s.active ? 4 : 0);
        s.data.set([...k.r, k.type, n1, k.v2 ?? 0, fl], i * 8);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data);
      const V = Object.fromEntries(s.ctl.map((k) => [k.key, k]));
      const hsv = (h, sat) => { const f = (n) => { const k = (n + h * 6) % 6; return 0.92 - 0.92 * sat * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.036, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      s.scopeP.use().set({ u_area: s.area, u_res: [ctx.cssWidth, ctx.cssHeight], u_k: [Math.round(V.fx.v), Math.round(V.fy.v), V.phase.v, V.decay.v * 3], u_off: [V.xy.v * 2 - 1, V.xy.v2 * 2 - 1], u_size: V.size.v * ctx.dpr, u_time: t, u_echo: V.echo.v, u_mirror: !!V.mirror.v, u_col: hsv(V.col.v, V.col.v2), u_glow: V.glow.v * 0.5 });
      gl.bindVertexArray(ctx.util.emptyVAO);
      gl.drawArrays(gl.POINTS, 0, 3000 * (V.echo.v || V.mirror.v ? 6 : 1));
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.uiP.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight] });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.ctl.length);
      gl.disable(gl.BLEND);
      if (Math.floor(t * 10) !== s.tick) {
        s.tick = Math.floor(t * 10);
        s.ctl.forEach((k) => { const el = s.labels.querySelector(`[data-k="${k.key}"]`); if (el) el.textContent = k.type === 4 ? (k.v ? 'on' : 'off') : k.type === 2 ? `${(k.v * 2 - 1).toFixed(2)}, ${(k.v2 * 2 - 1).toFixed(2)}` : k.type === 3 ? `h ${(k.v * 360).toFixed(0)}° s ${(k.v2 * 100).toFixed(0)}%` : (k.step === 1 ? Math.round(k.v) : k.v.toFixed(2)); });
      }
      ctx.canvas.style.cursor = s.active ? (s.active.type === 0 ? 'ns-resize' : 'grabbing') : s.hover >= 0 ? 'pointer' : 'default';
    },
  });
})();
