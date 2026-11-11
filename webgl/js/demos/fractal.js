/* Fractal Zoom — an infinite canvas: zoom toward the cursor, inertial pan,
 * pinch around the fingers' centroid, double-tap to dive. Deep zoom uses
 * emulated 64-bit arithmetic (double-single floats) in the fragment shader,
 * reaching ~10^11× before precision runs out. Julia mode follows the pointer. */
(function () {
  const S = window.Sandbox;
  const { damp } = S.math;

  const FS = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform vec2 u_res; uniform vec4 u_center;   // (re.hi, re.lo, im.hi, im.lo)
uniform float u_scale; uniform int u_iter; uniform bool u_deep; uniform bool u_julia; uniform vec2 u_c; uniform float u_one; uniform float u_time;
// --- double-single arithmetic (u_one stops the compiler folding the error terms away)
vec2 dsAdd(vec2 a, vec2 b) {
  float t1 = a.x + b.x, e = (t1 - a.x) * u_one;
  float t2 = ((b.x - e) + (a.x - (t1 - e))) + a.y + b.y;
  float h = t1 + t2; return vec2(h, t2 - (h - t1) * u_one);
}
vec2 dsMul(vec2 a, vec2 b) {
  const float SPLIT = 8193.0;
  float ca = a.x * SPLIT * u_one, a1 = ca - (ca - a.x), a2 = a.x - a1;
  float cb = b.x * SPLIT * u_one, b1 = cb - (cb - b.x), b2 = b.x - b1;
  float c11 = a.x * b.x;
  float c21 = a2 * b2 + (a2 * b1 + (a1 * b2 + (a1 * b1 - c11)));
  float c2 = a.x * b.y + a.y * b.x;
  float t1 = c11 + c2, e = (t1 - c11) * u_one;
  float t2 = a.y * b.y + ((c2 - e) + (c11 - (t1 - e))) + c21;
  float h = t1 + t2; return vec2(h, t2 - (h - t1) * u_one);
}
// Dark exterior; colour rises only near the boundary (high escape counts), banding red ↔ blue.
vec3 shade(float sm, float n) {
  float k = clamp(log(sm) / log(max(n, 32.0)), 0.0, 1.0);
  float glow = pow(k, 2.2);
  vec3 hue = mix(BLUE, RED, 0.5 + 0.5 * sin(sqrt(sm) * 1.35 + u_time * 0.15));
  vec3 c = mix(INK, hue, smoothstep(0.0, 0.55, glow));
  c = mix(c, vec3(0.93, 0.91, 0.87), smoothstep(0.75, 1.0, glow) * 0.65);
  return c;
}
void main() {
  vec2 off = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * u_scale;
  float it = 0.0; float m2 = 0.0; bool esc = false;
  int N = u_iter;
  if (u_deep) {
    vec2 cr = dsAdd(u_center.xy, vec2(off.x, 0.0)), ci = dsAdd(u_center.zw, vec2(off.y, 0.0));
    vec2 zr = cr, zi = ci;
    if (u_julia) { cr = vec2(u_c.x, 0.0); ci = vec2(u_c.y, 0.0); }
    for (int i = 0; i < 4000; i++) {
      if (i >= N) break;
      vec2 zr2 = dsMul(zr, zr), zi2 = dsMul(zi, zi);
      m2 = zr2.x + zi2.x;
      if (m2 > 256.0) { esc = true; break; }
      vec2 zri = dsMul(zr, zi);
      zi = dsAdd(dsAdd(zri, zri), ci);
      zr = dsAdd(dsAdd(zr2, -zi2), cr);
      it += 1.0;
    }
  } else {
    vec2 c = vec2(u_center.x + off.x, u_center.z + off.y), z = c;
    if (u_julia) c = u_c;
    for (int i = 0; i < 4000; i++) {
      if (i >= N) break;
      m2 = dot(z, z);
      if (m2 > 256.0) { esc = true; break; }
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      it += 1.0;
    }
  }
  vec3 col;
  if (!esc) col = vec3(0.012, 0.013, 0.02);
  else {
    float sm = it - log2(log2(m2) * 0.5) + 4.0;          // smooth iteration count
    col = shade(max(sm, 1.0), float(N));
  }
  col *= 1.0 - 0.3 * dot(v_uv - 0.5, v_uv - 0.5);
  o = vec4(col, 1.0);
}`;

  const PRESETS = [
    { name: 'Overview', re: -0.6, im: 0, scale: 3 },
    { name: 'Seahorse Valley', re: -0.743643887037151, im: 0.131825904205330, scale: 2e-6 },
    { name: 'Elephant Valley', re: 0.2925755, im: -0.0149977, scale: 3e-4 },
    { name: 'Spiral', re: -0.7746806106269039, im: -0.1374168856037867, scale: 1.4e-9 },
  ];
  const split = (x) => { const hi = Math.fround(x); return [hi, x - hi]; };

  S.register({
    id: 'fractal',
    title: 'Fractal Zoom',
    category: 'Camera & Navigation',
    thumb: 'wide',
    hint: 'wheel / pinch to zoom at the cursor · drag to pan · double-tap to dive',
    description: 'Infinite-canvas navigation, the interaction behind maps and design tools, applied to the Mandelbrot set. The wheel and pinch zoom about the point under the cursor or between your fingers, a drag pans with momentum, and a double-tap dives in. A float has only about 7 digits, so deep zoom emulates 64-bit maths in the shader with pairs of floats, going about ten thousand times deeper. Julia mode turns the pointer into the seed.',
    interact: [['Wheel / pinch', 'Zoom anchored at the cursor or finger centroid'], ['Drag / fling', 'Pan with momentum'], ['Double-click / tap', 'Dive 4× toward the point'], ['Right-click / Shift+double-click', 'Zoom out'], ['J / Julia toggle', 'Julia set seeded by the pointer'], ['+ / −', 'Keyboard zoom']],
    features: ['Zoom-to-cursor transform', 'Emulated 64-bit (double-single) floats', 'Dynamic iteration loops', 'Smooth iteration colouring', 'Animated fly-to'],
    params: [
      { key: 'iter', label: 'Max iterations', type: 'range', min: 64, max: 3000, step: 1, value: 600 },
      { key: 'deep', label: 'Deep precision (emulated 64-bit)', type: 'toggle', value: true },
      { key: 'julia', label: 'Julia mode', type: 'toggle', value: false },
      { key: 'res', label: 'Render scale', type: 'range', min: 0.35, max: 1, step: 0.05, value: 0.7 },
      { key: 'p0', label: 'Overview', type: 'button' },
      { key: 'p1', label: 'Seahorse Valley', type: 'button' },
      { key: 'p2', label: 'Elephant Valley', type: 'button' },
      { key: 'p3', label: 'Spiral', type: 'button' },
    ],
    init(ctx) {
      ctx.overlay.innerHTML = '<div class="ov-label" id="fz-read" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      return {
        prog: ctx.util.program(S.GLSL.fullscreenVS, FS), copy: ctx.util.program(S.GLSL.fullscreenVS, `in vec2 v_uv; out vec4 o; uniform sampler2D u_t; void main(){ o = texture(u_t, v_uv); }`),
        re: -0.6, im: 0, scale: 3, vre: 0, vim: 0, fly: null, juliaC: [-0.8, 0.156], lastTap: null, idleT: 0,
        read: ctx.overlay.querySelector('#fz-read'), fb: null,
      };
    },
    action(ctx, s, key) {
      if (key[0] === 'p') { const p = PRESETS[+key.slice(1)]; s.fly = { re0: s.re, im0: s.im, s0: s.scale, re1: p.re, im1: p.im, s1: p.scale, t: 0, dur: 2.2 + Math.abs(Math.log10(p.scale / s.scale)) * 0.35 }; }
    },
    resize(ctx, s) { if (s.fb) { ctx.util.release(s.fb, s.tex); s.fb = null; } },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const asp = ctx.aspect;
      const toC = (uvx, uvy) => [s.re + (uvx - 0.5) * asp * s.scale, s.im + (uvy - 0.5) * s.scale];
      const zoomAt = (uvx, uvy, f) => { const c = toC(uvx, uvy); const ns = Math.min(4, Math.max(params.deep ? 1e-13 : 2e-6, s.scale * f)); const k = 1 - ns / s.scale; s.re += (c[0] - s.re) * k; s.im += (c[1] - s.im) * k; s.scale = ns; };
      if (input.pressed.has('KeyJ')) ctx.syncParam('julia', !params.julia);
      if (params.julia && (input.hover || input.down)) s.juliaC = [(input.uvx - 0.5) * 2.4 - 0.4, (input.uvy - 0.5) * 2.0];
      // pan with momentum
      if (input.dragging && !params.julia) {
        const dre = -input.dragDX / ctx.cssHeight * s.scale, dim = input.dragDY / ctx.cssHeight * s.scale;
        s.re += dre; s.im += dim; s.vre = dre / Math.max(dt, 1 / 120); s.vim = dim / Math.max(dt, 1 / 120); s.fly = null;
      } else if (!input.down) { s.re += s.vre * dt; s.im += s.vim * dt; const f = Math.exp(-4 * dt); s.vre *= f; s.vim *= f; }
      if (input.wheel) { zoomAt(input.uvx, input.uvy, Math.exp(input.wheel * 0.0015)); s.fly = null; }
      if (input.pinch !== 1 && input.pointers.size === 2) {
        const ps = [...input.pointers.values()];
        zoomAt((ps[0].uvx + ps[1].uvx) / 2, (ps[0].uvy + ps[1].uvy) / 2, 1 / input.pinch); s.fly = null;
      }
      if (input.keys.has('Equal') || input.keys.has('NumpadAdd')) zoomAt(0.5, 0.5, Math.exp(-dt * 1.5));
      if (input.keys.has('Minus') || input.keys.has('NumpadSubtract')) zoomAt(0.5, 0.5, Math.exp(dt * 1.5));
      for (const c of input.clicks) {
        const now = performance.now();
        if (c.button === 2) { const p = toC(c.uvx, c.uvy); s.fly = { re0: s.re, im0: s.im, s0: s.scale, re1: p[0], im1: p[1], s1: Math.min(4, s.scale * 4), t: 0, dur: 0.8 }; continue; }
        if (s.lastTap && now - s.lastTap < 320) {
          const p = toC(c.uvx, c.uvy), out = input.shift;
          s.fly = { re0: s.re, im0: s.im, s0: s.scale, re1: p[0], im1: p[1], s1: Math.max(1e-13, Math.min(4, s.scale * (out ? 4 : 0.25))), t: 0, dur: 0.9 };
          s.lastTap = null;
        } else s.lastTap = now;
      }
      // idle: a slow automatic dive so the study is alive
      s.idleT = input.hover || input.down ? 0 : s.idleT + dt;
      if (s.idleT > 4 && !s.fly) { const p = PRESETS[1]; s.re += (p.re - s.re) * damp(0.6, dt); s.im += (p.im - s.im) * damp(0.6, dt); s.scale = Math.max(p.scale * 50, s.scale * Math.exp(-dt * 0.35)); }
      if (s.fly) {
        const f = s.fly; f.t += dt / f.dur;
        const k = f.t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * f.t);
        const ls = Math.log(f.s0) + (Math.log(f.s1) - Math.log(f.s0)) * k;
        s.scale = Math.exp(ls);
        // move in "zoom-normalised" space so the target stays steady while zooming
        const w = (f.s0 - s.scale) / Math.max(f.s0 - f.s1, 1e-300);
        const kk = f.s1 < f.s0 ? Math.min(1, Math.max(0, w)) : k;
        s.re = f.re0 + (f.re1 - f.re0) * kk; s.im = f.im0 + (f.im1 - f.im0) * kk;
        if (f.t >= 1) s.fly = null;
      }
      const w = Math.max(1, Math.round(ctx.width * params.res)), h = Math.max(1, Math.round(ctx.height * params.res));
      if (!s.fb || s.fw !== w || s.fh !== h) {
        if (s.fb) ctx.util.release(s.fb, s.tex);
        s.tex = ctx.util.texture({ width: w, height: h }); s.fb = ctx.util.framebuffer([s.tex]); s.fw = w; s.fh = h;
      }
      const [rh, rl] = split(s.re), [ih, il] = split(s.im);
      const iter = Math.round(Math.min(params.iter, 3000) * (params.deep ? 1 : 1));
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
      gl.viewport(0, 0, w, h);
      s.prog.use().set({ u_res: [w, h], u_center: [rh, rl, ih, il], u_scale: s.scale, u_iter: iter, u_deep: params.deep, u_julia: params.julia, u_c: s.juliaC, u_one: 1, u_time: t });
      ctx.util.drawFullscreen();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex);
      s.copy.use().set({ u_t: 0 });
      ctx.util.drawFullscreen();
      const zoom = 3 / s.scale;
      s.read.textContent = `zoom ${zoom < 1e4 ? zoom.toFixed(1) : zoom.toExponential(2)}× · centre ${s.re.toFixed(12)} ${s.im >= 0 ? '+' : '−'} ${Math.abs(s.im).toFixed(12)}i${params.julia ? ` · julia c = ${s.juliaC[0].toFixed(3)} ${s.juliaC[1] >= 0 ? '+' : '−'} ${Math.abs(s.juliaC[1]).toFixed(3)}i` : ''}${!params.deep && s.scale < 1e-5 ? ' · float precision limit: enable deep precision' : ''}`;
    },
  });
})();
