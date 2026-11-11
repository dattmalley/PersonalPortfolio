/* Hover Distortion Gallery — the signature portfolio-site interaction. Six
 * poster cards (one texture array) tilt toward the cursor, warp like liquid
 * around it, split RGB on movement, and expand to fill the stage on click. */
(function () {
  const S = window.Sandbox;
  const { damp } = S.math;

  const VS = `
layout(location = 0) in vec4 a_rect;   // x, y, w, h (css px, top-left)
layout(location = 1) in vec4 a_state;  // hover, tiltX, tiltY, layer
layout(location = 2) in vec4 a_mouse;  // local mouse uv (x,y), velocity (x,y)
uniform vec2 u_res;
out vec2 v_uv; flat out vec4 v_state; flat out vec4 v_mouse;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 c = corner * 2.0 - 1.0;
  // fake perspective tilt: depth per corner, then divide
  float z = (c.x * a_state.y + c.y * a_state.z) * 0.12;
  vec2 half_ = a_rect.zw * 0.5;
  vec2 ctr = a_rect.xy + half_;
  vec2 p = ctr + c * half_ / (1.0 + z);
  v_uv = vec2(corner.x, 1.0 - corner.y); v_state = a_state; v_mouse = a_mouse;
  vec2 cl = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(cl.x, -cl.y, 0.0, 1.0);
}`;
  const FS = S.GLSL.colors + `
in vec2 v_uv; flat in vec4 v_state; flat in vec4 v_mouse; out vec4 o;
uniform sampler2DArray u_img; uniform float u_time; uniform float u_aspect; uniform float u_strength;
float n2(vec2 p) { return sin(p.x * 1.7 + u_time) * sin(p.y * 1.3 - u_time * 0.8); }
void main() {
  float hv = v_state.x;
  vec2 uv = v_uv;
  vec2 d = uv - v_mouse.xy; d.x *= u_aspect;
  float r = length(d);
  float lens = exp(-r * r * 22.0) * hv;
  // liquid: noise flow + radial bulge around the cursor
  vec2 flow = vec2(n2(uv * 9.0 + 3.0), n2(uv.yx * 9.0 - 2.0)) * 0.018 * hv * u_strength;
  vec2 warped = uv - normalize(d + 1e-5) * lens * 0.06 * u_strength + flow;
  warped = (warped - 0.5) * (1.0 - 0.06 * hv) + 0.5;            // zoom in slightly on hover
  vec2 vel = v_mouse.zw * 0.04 * u_strength;
  vec3 c;
  c.r = texture(u_img, vec3(warped + vel, v_state.w)).r;
  c.g = texture(u_img, vec3(warped, v_state.w)).g;
  c.b = texture(u_img, vec3(warped - vel, v_state.w)).b;
  c *= 0.78 + 0.22 * hv;
  c += lens * 0.08;
  // border
  vec2 e = min(uv, 1.0 - uv) * vec2(u_aspect, 1.0);
  c = mix(c, vec3(0.93, 0.91, 0.87), smoothstep(0.004, 0.0, min(e.x, e.y)) * 0.3);
  o = vec4(c, 1.0);
}`;

  function layout(ctx, s) {
    const W = ctx.cssWidth, H = ctx.cssHeight;
    const cols = W / H > 1.15 ? 3 : 2, rows = Math.ceil(6 / cols);
    const pad = Math.max(24, W * 0.05), gap = Math.max(14, W * 0.025), top = 70, bottom = 80;
    let cw = (W - pad * 2 - gap * (cols - 1)) / cols, ch = cw / s.aspect;
    const maxH = (H - top - bottom - gap * (rows - 1)) / rows;
    if (ch > maxH) { ch = maxH; cw = ch * s.aspect; }
    const gw = cw * cols + gap * (cols - 1), gh = ch * rows + gap * (rows - 1);
    const ox = (W - gw) / 2, oy = top + (H - top - bottom - gh) / 2;
    s.cards.forEach((c, i) => { c.home = [ox + (i % cols) * (cw + gap), oy + Math.floor(i / cols) * (ch + gap), cw, ch]; if (!c.rect) c.rect = c.home.slice(); });
    const fw = Math.min(W - 60, (H - 120) * s.aspect), fh = fw / s.aspect;
    s.full = [(W - fw) / 2, (H - fh) / 2 + 10, fw, fh];
  }

  S.register({
    id: 'hover',
    title: 'Hover Distortion',
    category: 'Pointer & Touch',
    thumb: 'wide',
    hint: 'hover the posters · click one to open it',
    description: 'The gallery effect seen on award-winning portfolio sites, built from first principles. Each poster tilts toward the cursor with a fake perspective divide, and its texture flows like liquid and bulges under the pointer. Colour channels split with pointer velocity. A click springs the card open to fill the stage while the others recede. The six posters are one canvas-generated texture array.',
    interact: [['Hover', 'Tilt, liquid warp and lens bulge'], ['Move fast', 'RGB split follows velocity'], ['Click / tap', 'Expand a poster; click again to close'], ['Esc / arrows', 'Close / step between open posters']],
    features: ['2D texture array of posters', 'Fake perspective in the vertex shader', 'Per-instance hover springs', 'Velocity-driven RGB split', 'Spring layout transitions'],
    params: [
      { key: 'strength', label: 'Distortion', type: 'range', min: 0, max: 3, step: 0.05, value: 1.2 },
      { key: 'tilt', label: 'Tilt', type: 'range', min: 0, max: 2, step: 0.05, value: 1 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const posters = S.posters(ctx);
      const data = new Float32Array(6 * 12);
      const buf = util.buffer(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const s = {
        posters, aspect: posters.aspect, data, buf, prog: util.program(VS, FS),
        vao: util.vao([{ buffer: buf, loc: 0, size: 4, stride: 48, divisor: 1 }, { buffer: buf, loc: 1, size: 4, stride: 48, offset: 16, divisor: 1 }, { buffer: buf, loc: 2, size: 4, stride: 48, offset: 32, divisor: 1 }]),
        cards: Array.from({ length: 6 }, (_, i) => ({ i, hv: 0, tx: 0, ty: 0, mx: 0.5, my: 0.5, vx: 0, vy: 0, rect: null, vel: [0, 0, 0, 0], z: 0 })),
        open: -1, last: [0, 0],
      };
      layout(ctx, s);
      ctx.overlay.innerHTML = '<div class="ov-label" id="hv-cap" style="left:50%;transform:translateX(-50%);top:auto;bottom:64px;text-align:center"></div>';
      s.cap = ctx.overlay.querySelector('#hv-cap');
      return s;
    },
    resize(ctx, s) { layout(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const mx = input.hover || input.down ? input.x : -9999, my = input.hover || input.down ? input.y : -9999;
      const mvx = (input.x - s.last[0]) / Math.max(dt, 1 / 120), mvy = (input.y - s.last[1]) / Math.max(dt, 1 / 120);
      s.last = [input.x, input.y];
      const inside = (r) => mx >= r[0] && mx <= r[0] + r[2] && my >= r[1] && my <= r[1] + r[3];
      for (const c of input.clicks) {
        if (s.open >= 0) s.open = -1;
        else { const hit = s.cards.find((cd) => inside(cd.rect)); if (hit) s.open = hit.i; }
      }
      if (s.open >= 0 && input.pressed.has('Escape')) s.open = -1;
      if (s.open >= 0 && input.pressed.has('ArrowRight')) s.open = (s.open + 1) % 6;
      if (s.open >= 0 && input.pressed.has('ArrowLeft')) s.open = (s.open + 5) % 6;
      // idle: a ghost cursor wanders so the effect is always visible
      let gx = mx, gy = my;
      if (mx < -999 && s.open < 0) { const c = s.cards[((Math.floor(t / 2.5) % 6) + 6) % 6]; gx = c.rect[0] + c.rect[2] * (0.5 + 0.35 * Math.sin(t * 1.7)); gy = c.rect[1] + c.rect[3] * (0.5 + 0.35 * Math.cos(t * 1.3)); }
      const order = s.cards.slice().sort((a, b) => a.z - b.z);
      s.cards.forEach((c) => {
        const target = s.open === c.i ? s.full : c.home;
        for (let k = 0; k < 4; k++) { c.vel[k] += ((target[k] - c.rect[k]) * 140 - c.vel[k] * 20) * Math.min(dt, 1 / 30); c.rect[k] += c.vel[k] * Math.min(dt, 1 / 30); }
        c.z += ((s.open === c.i ? 1 : 0) - c.z) * damp(10, dt);
        const r = c.rect;
        const over = gx >= r[0] && gx <= r[0] + r[2] && gy >= r[1] && gy <= r[1] + r[3] && (s.open < 0 || s.open === c.i);
        const lx = (gx - r[0]) / r[2], ly = (gy - r[1]) / r[3];
        c.hv += ((over ? 1 : s.open === c.i ? 0.4 : 0) - c.hv) * damp(8, dt);
        const ttx = over ? (ly - 0.5) * 2 : 0, tty = over ? -(lx - 0.5) * 2 : 0;
        c.tx += (ttx * params.tilt * (s.open === c.i ? 0.3 : 1) - c.tx) * damp(8, dt);
        c.ty += (tty * params.tilt * (s.open === c.i ? 0.3 : 1) - c.ty) * damp(8, dt);
        if (over) { c.mx += (lx - c.mx) * damp(14, dt); c.my += (1 - ly - c.my) * damp(14, dt); }
        c.vx += ((over ? mvx / r[2] : 0) - c.vx) * damp(6, dt); c.vy += ((over ? -mvy / r[3] : 0) - c.vy) * damp(6, dt);
        const dim = s.open >= 0 && s.open !== c.i ? 0 : 1;
        c.dim = (c.dim ?? 1) + (dim - (c.dim ?? 1)) * damp(8, dt);
      });
      order.forEach((c, i) => {
        const shrink = 1 - (1 - c.dim) * 0.08;
        const r = c.rect, cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
        s.data.set([cx - r[2] * shrink / 2, cy - r[3] * shrink / 2, r[2] * shrink, r[3] * shrink, c.hv * (0.3 + 0.7 * c.dim) + (c.dim - 1) * 0.6, c.tx, c.ty, c.i, c.mx, c.my, Math.max(-3, Math.min(3, c.vx)), Math.max(-3, Math.min(3, c.vy))], i * 12);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.03, 0.032, 0.04, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.posters.tex);
      s.prog.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_img: 0, u_time: t, u_aspect: s.aspect, u_strength: params.strength });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 6);
      const hov = s.cards.find((c) => c.hv > 0.5);
      const idx = s.open >= 0 ? s.open : hov ? hov.i : -1;
      s.cap.textContent = idx >= 0 ? `${String(idx + 1).padStart(2, '0')} · ${S.POSTER_TITLES[idx]}${s.open >= 0 ? ' · click to close · ← → to step' : ' · click to open'}` : '';
      ctx.canvas.style.cursor = hov || s.open >= 0 ? 'pointer' : 'default';
    },
  });
})();
