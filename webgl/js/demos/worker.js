/* Worker Render — the same WebGL2 scene rendered twice: on the main thread
 * (left) and inside a Web Worker through an OffscreenCanvas (right). Load the
 * main thread with work and only the left side stutters. */
(function () {
  const S = window.Sandbox;

  // Shared renderer source: evaluated on the main thread AND inside the worker.
  const RENDERER = `
function makeRenderer(gl) {
  const VS = '#version 300 es\\nprecision highp float;\\nuniform float u_t; uniform vec2 u_m; uniform float u_aspect; uniform int u_mode;\\nout vec3 v_c;\\n' +
    'void main(){\\n' +
    ' if (u_mode == 1) { int i = gl_VertexID; vec2 q = vec2(float(i & 1), float((i >> 1) & 1)); float a = -u_t * 3.14159; vec2 dir = vec2(sin(a), cos(a));\\n' +
    '   vec2 nrm = vec2(-dir.y, dir.x); vec2 p = dir * q.y * 0.82 + nrm * (q.x - 0.5) * 0.012; p.x /= u_aspect; v_c = vec3(0.93,0.91,0.87); gl_Position = vec4(p, 0.0, 1.0); return; }\\n' +
    ' float id = float(gl_VertexID); float k = id / 24000.0; float arm = mod(id, 2.0);\\n' +
    ' float r = pow(k, 0.55) * 0.9; float a = r * 7.0 + arm * 3.14159 + u_t * 0.6 + fract(sin(id * 12.9898) * 43758.5453) * 0.5;\\n' +
    ' vec2 p = vec2(cos(a), sin(a)) * r; p += (fract(sin(id * vec2(78.233, 39.425)) * 43758.5453) - 0.5) * 0.06 * (1.0 - k);\\n' +
    ' vec2 d = p - u_m; p += normalize(d + 1e-5) * 0.12 * exp(-dot(d, d) * 18.0);\\n' +
    ' p.x /= u_aspect; v_c = mix(vec3(1.0, 0.23, 0.31), vec3(0.23, 0.55, 1.0), arm) * (0.35 + 0.65 * (1.0 - k));\\n' +
    ' gl_Position = vec4(p, 0.0, 1.0); gl_PointSize = 2.0; }';
  const FS = '#version 300 es\\nprecision highp float;\\nin vec3 v_c; out vec4 o; void main(){ o = vec4(v_c, 1.0); }';
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
  const U = (n) => gl.getUniformLocation(p, n);
  const ut = U('u_t'), um = U('u_m'), ua = U('u_aspect'), umode = U('u_mode');
  const vao = gl.createVertexArray();
  return {
    draw(t, w, h, mx, my) {
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.024, 0.027, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(p); gl.bindVertexArray(vao);
      gl.uniform1f(ut, t); gl.uniform2f(um, mx, my); gl.uniform1f(ua, w / h);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1i(umode, 0); gl.drawArrays(gl.POINTS, 0, 24000);
      gl.uniform1i(umode, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND); gl.bindVertexArray(null);
    },
    dispose() { gl.deleteProgram(p); gl.deleteVertexArray(vao); },
  };
}`;

  const WORKER = RENDERER + `
let gl, r, w = 1, h = 1, mx = 9, my = 9, t0 = performance.now(), frames = 0, last = performance.now();
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
function loop(now) {
  if (!r) return;
  r.draw((now - t0) / 1000, w, h, mx, my);
  frames++;
  if (now - last > 500) { self.postMessage({ fps: Math.round(frames * 1000 / (now - last)) }); frames = 0; last = now; }
  raf(loop);
}
self.onmessage = (e) => {
  const d = e.data;
  if (d.canvas) { gl = d.canvas.getContext('webgl2', { antialias: true }); r = makeRenderer(gl); w = d.canvas.width; h = d.canvas.height; self.canvas = d.canvas; raf(loop); }
  if (d.size) { self.canvas.width = w = d.size[0]; self.canvas.height = h = d.size[1]; }
  if (d.pointer) { mx = d.pointer[0]; my = d.pointer[1]; }
};`;

  S.register({
    id: 'worker',
    title: 'Worker Render',
    category: 'Performance',
    hint: 'press “Freeze main thread” and watch the right side',
    description: 'WebGL 2.0 does not have to run on the main thread. The right half is an OffscreenCanvas handed to a Web Worker with transferControlToOffscreen, and the worker drives its own render loop. The left half renders the identical scene on the main thread. Freeze or load the main thread with JavaScript work and the left side stalls while the worker keeps going.',
    interact: [['Freeze main thread', 'Busy-loops the main thread for 2.5 s'], ['Heavy main-thread work', 'Burns 45 ms of JS every frame'], ['Move', 'Both galaxies part around the pointer (input is forwarded to the worker)']],
    features: ['OffscreenCanvas', 'transferControlToOffscreen', 'WebGL2 inside a Web Worker', 'Worker requestAnimationFrame', 'postMessage input forwarding'],
    params: [
      { key: 'heavy', label: 'Heavy main-thread work', type: 'toggle', value: false },
      { key: 'freeze', label: 'Freeze main thread 2.5 s', type: 'button' },
    ],
    init(ctx) {
      if (!('transferControlToOffscreen' in HTMLCanvasElement.prototype)) throw new Error('OffscreenCanvas is not supported in this browser.');
      const mainRenderer = new Function(RENDERER + '; return makeRenderer;')()(ctx.gl);
      const el = document.createElement('canvas');
      el.style.cssText = 'position:absolute;top:0;right:0;width:50%;height:100%;display:block;pointer-events:none';
      ctx.overlay.appendChild(el);
      ctx.overlay.insertAdjacentHTML('beforeend', `
        <div style="position:absolute;top:0;bottom:0;left:50%;width:1px;background:rgba(236,233,226,.35)"></div>
        <div class="ov-label" style="left:34px;top:64px;transform:none">MAIN THREAD · <span id="w-main">–</span> fps</div>
        <div class="ov-label" style="left:calc(50% + 20px);top:64px;transform:none">WORKER THREAD · <span id="w-work">–</span> fps</div>`);
      const resizeEl = () => {
        const w = Math.max(1, Math.round(ctx.cssWidth / 2 * ctx.dpr)), h = Math.max(1, Math.round(ctx.cssHeight * ctx.dpr));
        return [w, h];
      };
      const [w, h] = resizeEl();
      el.width = w; el.height = h;
      const off = el.transferControlToOffscreen();
      const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.postMessage({ canvas: off }, [off]);
      const s = { mainRenderer, worker, url, el, resizeEl, mainEl: ctx.overlay.querySelector('#w-main'), workEl: ctx.overlay.querySelector('#w-work'), frames: 0, acc: 0 };
      worker.onmessage = (e) => { if (e.data.fps != null) s.workEl.textContent = e.data.fps; };
      return s;
    },
    resize(ctx, s) { s.worker.postMessage({ size: s.resizeEl() }); },
    action(ctx, s, key) {
      if (key === 'freeze') {
        s.mainEl.textContent = '0';
        setTimeout(() => { const end = performance.now() + 2500; while (performance.now() < end) { /* deliberately block */ } }, 30);
      }
    },
    dispose(ctx, s) { s.worker.terminate(); URL.revokeObjectURL(s.url); s.mainRenderer.dispose(); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      if (params.heavy) { const end = performance.now() + 45; while (performance.now() < end) { /* simulated main-thread load */ } }
      // pointer in each half's own coordinates (-1..1, aspect-corrected like the shader)
      const halfAspect = (ctx.cssWidth / 2) / ctx.cssHeight;
      const lx = (input.uvx * 2) * 2 - 1, rx = (input.uvx * 2 - 1) * 2 - 1, y = input.ny;
      const on = input.hover || input.down;
      s.worker.postMessage({ pointer: on && input.uvx >= 0.5 ? [rx * halfAspect, y] : [9, 9] });
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, Math.round(ctx.width / 2), ctx.height);
      s.mainRenderer.draw(performance.now() / 1000, Math.round(ctx.width / 2), ctx.height, on && input.uvx < 0.5 ? lx * halfAspect : 9, y);
      gl.disable(gl.SCISSOR_TEST);
      s.frames++; s.acc += dt;
      if (s.acc > 0.5) { s.mainEl.textContent = Math.round(s.frames / s.acc); s.frames = 0; s.acc = 0; }
    },
  });
})();
