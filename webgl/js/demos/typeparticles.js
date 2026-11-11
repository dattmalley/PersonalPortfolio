/* Type & Particles — keyboard input becomes motion. Typed text is rasterised in
 * a 2D canvas, sampled into target points, and 30,000 transform-feedback
 * particles spring into the letterforms. Hover scatters them; click bursts.
 * A hidden input brings up the on-screen keyboard on phones. */
(function () {
  const S = window.Sandbox;
  const N = 30000;

  const UPDATE_VS = `
layout(location = 0) in vec4 a_state;  // pos.xy, vel.xy (css px)
layout(location = 1) in vec2 a_target;
out vec4 v_state;
uniform float u_dt; uniform vec2 u_mouse; uniform float u_mouseOn; uniform float u_k; uniform float u_time; uniform vec3 u_burst; uniform float u_repel;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 p = a_state.xy, v = a_state.zw;
  float id = float(gl_VertexID);
  vec2 f = (a_target - p) * u_k * (0.7 + 0.6 * h(id));
  f += vec2(sin(u_time * 1.3 + id * 0.37), cos(u_time * 1.1 + id * 0.71)) * 6.0;      // idle shimmer
  vec2 d = p - u_mouse; float r2 = dot(d, d);
  f += normalize(d + 1e-4) * u_mouseOn * u_repel * 900000.0 / (r2 + 900.0);
  if (u_burst.z > 0.0) { vec2 b = p - u_burst.xy; f += normalize(b + 1e-4) * u_burst.z * 9e6 / (dot(b, b) + 2500.0) * (0.5 + h(id + 3.0)); }
  v += f * u_dt;
  v *= pow(0.012, u_dt);       // strong damping → snappy settling
  p += v * u_dt;
  v_state = vec4(p, v);
}`;
  const NOP_FS = `out vec4 o; void main() { o = vec4(0.0); }`;
  const DRAW_VS = S.GLSL.colors + `
layout(location = 0) in vec4 a_state; layout(location = 1) in vec2 a_target;
uniform vec2 u_res; uniform float u_dpr;
out vec3 v_c;
void main() {
  vec2 c = a_state.xy / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  float sp = clamp(length(a_state.zw) / 600.0, 0.0, 1.0);
  vec3 settled = mix(vec3(0.93, 0.91, 0.87), mix(RED, BLUE, a_target.x / u_res.x), 0.35);
  v_c = mix(settled, mix(RED, BLUE, step(0.5, fract(float(gl_VertexID) * 0.618))), sp);
  gl_PointSize = (1.4 + sp * 1.2) * u_dpr;
}`;
  const DRAW_FS = `in vec3 v_c; out vec4 o; uniform float u_alpha; void main() { o = vec4(v_c * u_alpha, 1.0); }`;

  S.register({
    id: 'typeparticles',
    title: 'Type & Particles',
    category: 'GPU Motion',
    thumb: 'wide',
    captureKeys: true,
    hint: 'type anything · hover to scatter · click to burst',
    description: 'Keyboard input as motion. Each keystroke rasterises the text into a hidden 2D canvas in the page\'s own display face. Its pixels are sampled into target points, and 30,000 particles simulated by transform feedback spring into the new letterforms. The pointer pushes them aside and a click bursts them. On phones a hidden input field raises the on-screen keyboard.',
    interact: [['Type', 'Letters reform from particles (Backspace, Enter for a new line)'], ['Hover', 'Repel particles around the pointer'], ['Click / tap', 'Burst; on phones this also opens the keyboard'], ['Esc', 'Clear the text']],
    features: ['Keyboard + IME text input', 'Canvas 2D text → point sampling', 'Transform feedback springs', 'Attribute streaming of targets', 'Additive point sprites'],
    params: [
      { key: 'k', label: 'Spring stiffness', type: 'range', min: 5, max: 120, step: 1, value: 40 },
      { key: 'repel', label: 'Pointer repulsion', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'type', label: 'Open keyboard', type: 'button' },
      { key: 'reset', label: 'Reset text', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const state = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) { state[i * 4] = Math.random() * ctx.cssWidth; state[i * 4 + 1] = Math.random() * ctx.cssHeight; }
      const bufs = [0, 1].map(() => util.buffer(gl.ARRAY_BUFFER, state, gl.DYNAMIC_COPY));
      const targetBuf = util.buffer(gl.ARRAY_BUFFER, N * 8, gl.DYNAMIC_DRAW);
      const vaos = bufs.map((b) => util.vao([{ buffer: b, loc: 0, size: 4 }, { buffer: targetBuf, loc: 1, size: 2 }]));
      const tfs = bufs.map((b) => { const tf = util.transformFeedback(); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, b); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null); return tf; });
      const s = {
        update: util.program(UPDATE_VS, NOP_FS, { tf: ['v_state'] }), draw: util.program(DRAW_VS, DRAW_FS),
        bufs, vaos, tfs, targetBuf, src: 0, text: 'WebGL 2.0', burst: [0, 0, 0], canvas2d: document.createElement('canvas'),
      };
      ctx.overlay.innerHTML = `<input id="tp-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Text to turn into particles"
          style="position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px">
        <span id="tp-caret" style="position:absolute;width:2px;background:#ff3b4e;animation:tpblink 1s steps(1) infinite"></span>
        <style>@keyframes tpblink{50%{opacity:0}}</style>`;
      s.inputEl = ctx.overlay.querySelector('#tp-in'); s.caret = ctx.overlay.querySelector('#tp-caret');
      s.inputEl.value = s.text;
      s.inputEl.addEventListener('input', () => { s.text = s.inputEl.value.slice(0, 40); retarget(ctx, s); });
      s.onKey = (e) => {
        if (document.activeElement === s.inputEl) { if (e.key === 'Escape') { s.inputEl.value = ''; s.text = ''; retarget(ctx, s); } return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'Backspace') s.text = s.text.slice(0, -1);
        else if (e.key === 'Enter') { if (!s.text.includes('\n')) s.text += '\n'; }
        else if (e.key === 'Escape') s.text = '';
        else if (e.key.length === 1 && s.text.length < 40) s.text += e.key;
        else return;
        e.preventDefault(); s.inputEl.value = s.text; retarget(ctx, s);
      };
      window.addEventListener('keydown', s.onKey);
      (document.fonts && document.fonts.load ? document.fonts.load('italic 120px "Instrument Serif"') : Promise.resolve()).then(() => retarget(ctx, s)).catch(() => retarget(ctx, s));
      retarget(ctx, s);
      return s;
    },
    resize(ctx, s) { retarget(ctx, s); },
    dispose(ctx, s) { window.removeEventListener('keydown', s.onKey); },
    action(ctx, s, key) {
      if (key === 'type') { s.inputEl.style.pointerEvents = 'auto'; s.inputEl.focus(); }
      if (key === 'reset') { s.text = 'WebGL 2.0'; s.inputEl.value = s.text; retarget(ctx, s); }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      for (const c of input.clicks) { s.burst = [c.x, c.y, 1]; if (input.pointerType === 'touch') { s.inputEl.focus(); } }
      const dst = 1 - s.src;
      s.update.use().set({ u_dt: Math.min(dt, 1 / 30), u_mouse: [input.x, input.y], u_mouseOn: input.hover || input.down ? 1 : 0, u_k: params.k, u_time: t, u_burst: s.burst, u_repel: params.repel });
      s.burst = [0, 0, 0];
      gl.bindVertexArray(s.vaos[s.src]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, s.tfs[dst]);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, N); gl.endTransformFeedback();
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.disable(gl.RASTERIZER_DISCARD);
      s.src = dst;
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.024, 0.026, 0.034, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      s.draw.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_dpr: ctx.dpr, u_alpha: 0.55 });
      gl.bindVertexArray(s.vaos[s.src]);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.disable(gl.BLEND);
    },
  });

  function retarget(ctx, s) {
    const { gl } = ctx;
    const W = Math.max(2, Math.round(ctx.cssWidth)), H = Math.max(2, Math.round(ctx.cssHeight));
    const c = s.canvas2d; c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, W, H);
    const lines = (s.text || ' ').split('\n');
    let size = Math.min(H * (lines.length > 1 ? 0.3 : 0.42), 260);
    g.font = `italic ${size}px "Instrument Serif", Georgia, serif`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width), 1);
    if (widest > W * 0.86) { size *= (W * 0.86) / widest; g.font = `italic ${size}px "Instrument Serif", Georgia, serif`; }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lh = size * 0.95, y0 = H / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * lh));
    // caret after the last line
    const last = lines[lines.length - 1], lw = g.measureText(last).width;
    Object.assign(s.caret.style, { left: W / 2 + lw / 2 + size * 0.05 + 'px', top: y0 + (lines.length - 1) * lh - size * 0.38 + 'px', height: size * 0.76 + 'px' });
    const img = g.getImageData(0, 0, W, H).data;
    const pts = [];
    const step = Math.max(1, Math.floor(Math.sqrt((W * H) / 260000)));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (img[(y * W + x) * 4 + 3] > 128) pts.push(x + Math.random() * step, y + Math.random() * step);
    const tg = new Float32Array(N * 2);
    const n = pts.length / 2;
    for (let i = 0; i < N; i++) {
      if (n) { const k = Math.floor(Math.random() * n); tg[i * 2] = pts[k * 2]; tg[i * 2 + 1] = pts[k * 2 + 1]; }
      else { const a = Math.random() * Math.PI * 2, r = Math.min(W, H) * (0.3 + Math.random() * 0.1); tg[i * 2] = W / 2 + Math.cos(a) * r; tg[i * 2 + 1] = H / 2 + Math.sin(a) * r; }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, s.targetBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, tg);
  }
})();
