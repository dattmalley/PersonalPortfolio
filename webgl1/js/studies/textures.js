/* C · Textures — upload sources, formats and packed types, filtering + mipmaps, wrapping and
 * NPOT rules, cube maps, copying from the drawing buffer, pixel-store flags, texture units. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, clamp, damp, lerp } = S.math;
  const G = S.GLSL;
  const CAT = 'Textures';

  const el = (parent, tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent.appendChild(e); return e; };
  const panel = (ctx, pos, html) => el(ctx.overlay, 'div', 'ov-panel ' + pos, html);
  const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
  const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  /** Smoothed pointer in drawing-buffer pixels; follows a ghost path when idle or capturing. */
  function ghostPointer(ctx, s, t, dt, path) {
    const { input } = ctx;
    let tx, ty;
    if (input.hover && !ctx.capture) { tx = input.x * ctx.dpr; ty = ctx.height - input.y * ctx.dpr; }
    else { const g = path(t); tx = g[0] * ctx.width; ty = g[1] * ctx.height; }
    if (!s.ptr) s.ptr = [tx, ty];
    const k = damp(input.hover ? 16 : 3, dt);
    s.ptr[0] += (tx - s.ptr[0]) * k; s.ptr[1] += (ty - s.ptr[1]) * k;
    return s.ptr;
  }
  // Unit quad [0,1]² placed by a rect in NDC (x, y, w, h); shared by the tile / cell studies.
  const RECT_VS = `
attribute vec2 a_pos;
uniform vec4 u_rect;
varying vec2 v_uv;
void main() { v_uv = a_pos; gl_Position = vec4(u_rect.xy + a_pos * u_rect.zw, 0.0, 1.0); }`;
  const unitQuad = (util) => util.mesh([{ buffer: util.buffer(util.gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])), loc: 0, size: 2 }], null, { count: 4, mode: util.gl.TRIANGLE_STRIP });
  // px rect (x, y from bottom-left, w, h) → NDC rect
  const ndcRect = (ctx, x, y, w, h) => [x / ctx.width * 2 - 1, y / ctx.height * 2 - 1, w / ctx.width * 2, h / ctx.height * 2];

  /* ---------------------------------------------------------------- */
  /* 1. Texture sources                                                */
  /* ---------------------------------------------------------------- */
  const SRC_NAMES = ['Canvas 2D', 'ImageData', 'Typed array', 'Image', 'ImageBitmap', 'Video'];
  S.register({
    id: 'tex-sources',
    title: 'Texture Sources',
    category: CAT,
    thumb: 'wide',
    hint: 'drag the carousel · pick a source',
    description: 'texImage2D accepts six kinds of source. A live 2D canvas, an ImageData buffer and a raw typed array are re-uploaded every frame; an image decoded from a data URL and an ImageBitmap are uploaded once; a muted video element plays a canvas.captureStream() and its current frame is uploaded whenever one is ready. All six cards are ordinary 2D textures and the shader cannot tell them apart.',
    interact: [['Drag', 'spin the carousel; it settles on the nearest card'], ['Source', 'bring a card to the front'], ['Move', 'tilts the front card']],
    features: ['texImage2D(…, HTMLCanvasElement | ImageData)', 'texImage2D(w, h, …, Uint8Array)', 'HTMLImageElement (data URL) · ImageBitmap', 'HTMLVideoElement ← canvas.captureStream()', 'UNPACK_FLIP_Y_WEBGL for DOM sources'],
    params: [
      { key: 'src', label: 'Source', type: 'select', options: SRC_NAMES, value: 0 },
      { key: 'live', label: 'Re-upload live sources', type: 'toggle', value: true },
      { key: 'mirror', label: 'Floor reflection', type: 'toggle', value: true },
    ],
    code: `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
// raw bytes: width, height and border are explicit
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8);`,
    init(ctx) {
      const { gl, util } = ctx;
      const s = { rot: 0, vel: 0, tilt: [0, 0], uploads: [0, 0, 0, 0, 0, 0], ready: [false, false, false, false, false, false], ms: 0 };
      s.tex = SRC_NAMES.map(() => util.texture({ width: 1, height: 1, data: new Uint8Array([20, 22, 28, 255]) }));
      s.aspect = [1.6, 1.6, 1.6, 0.8, 0.8, 1.6];
      const upload = (i, src) => {
        gl.bindTexture(gl.TEXTURE_2D, s.tex[i]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.bindTexture(gl.TEXTURE_2D, null);
        s.uploads[i]++; s.ready[i] = true;
      };
      s.upload = upload;
      // 0 · live canvas
      [s.cv, s.g] = canvas2d(512, 320);
      // 1 · ImageData plasma
      s.idW = 192; s.idH = 120;
      s.imgData = new ImageData(s.idW, s.idH);
      // 2 · typed array: Game of Life
      s.lw = 96; s.lh = 60;
      s.cells = new Uint8Array(s.lw * s.lh); s.next = new Uint8Array(s.lw * s.lh); s.age = new Float32Array(s.lw * s.lh);
      s.rgba = new Uint8Array(s.lw * s.lh * 4);
      const seed = () => { for (let i = 0; i < s.cells.length; i++) s.cells[i] = Math.random() < 0.3 ? 1 : 0; s.seededAt = performance.now(); };
      seed(); s.seed = seed; s.lifeT = 0;
      // 3 · HTMLImageElement from a data URL
      s.img = new Image();
      s.img.onload = () => { if (!s.dead) upload(3, s.img); };
      s.img.src = S.posterCanvas(2, 400, 500).toDataURL('image/png');
      // 4 · ImageBitmap
      if (window.createImageBitmap) createImageBitmap(S.posterCanvas(4, 400, 500)).then((bmp) => { if (!s.dead) upload(4, bmp); if (bmp.close) bmp.close(); }).catch(() => { s.bmpErr = true; });
      else s.bmpErr = true;
      // 5 · video from a captured canvas stream
      [s.vc, s.vg] = canvas2d(480, 300);
      this.drawVideoCanvas(s, 0);
      s.video = document.createElement('video');
      s.video.muted = true; s.video.playsInline = true; s.video.autoplay = true;
      if (s.vc.captureStream) {
        try {
          s.stream = s.vc.captureStream(30);
          s.video.srcObject = s.stream;
          const pr = s.video.play();
          if (pr && pr.catch) pr.catch((e) => { s.videoErr = e && e.name ? e.name : 'play() rejected'; });
        } catch (e) { s.videoErr = 'captureStream failed'; }
      } else s.videoErr = 'captureStream unsupported';
      // card geometry: unit quad centred on the origin
      s.quad = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5])), loc: 0, size: 2 }], null, { count: 4, mode: gl.TRIANGLE_STRIP });
      s.prog = util.program(`
attribute vec2 a_pos;
uniform mat4 u_vp; uniform mat4 u_m; uniform vec2 u_size; uniform float u_mirror;
varying vec2 v_uv; varying vec3 v_w;
void main() {
  v_uv = a_pos + 0.5;
  vec4 w = u_m * vec4(a_pos * u_size, 0.0, 1.0);
  if (u_mirror > 0.5) w.y = -2.4 - w.y;
  v_w = w.xyz;
  gl_Position = u_vp * w;
}`, G.colors + `
uniform sampler2D u_tex; uniform float u_front; uniform float u_mirror; uniform vec2 u_size; uniform float u_ready;
varying vec2 v_uv; varying vec3 v_w;
void main() {
  vec2 px = v_uv * u_size * 120.0;
  vec2 edge = min(px, u_size * 120.0 - px);
  float frame = step(min(edge.x, edge.y), 3.0);
  vec3 c = texture2D(u_tex, v_uv).rgb;
  if (u_ready < 0.5) c = INK * 2.0 + 0.04 * step(0.5, fract((v_uv.x + v_uv.y) * 10.0));
  float gloss = smoothstep(0.35, 0.0, abs(v_uv.x - v_uv.y * 0.6 - 0.1)) * 0.06;
  c = c * (0.35 + 0.65 * u_front) + gloss * u_front;
  c = mix(c, mix(BONE * 0.25, A1, u_front), frame);
  float a = 1.0;
  if (u_mirror > 0.5) { a = 0.22 * smoothstep(0.35, 1.0, v_uv.y); }
  gl_FragColor = vec4(c * a, a);
}`);
      s.floor = util.program(G.fullscreenVS, G.colors + `varying vec2 v_uv; uniform float u_asp; void main() {
  vec2 q = (v_uv - vec2(0.5, 0.55)) * vec2(u_asp, 1.0);
  vec3 c = INK + A1 * 0.025 * exp(-dot(q, q) * 3.0) + A2 * 0.015 * exp(-dot(q - vec2(0.6, 0.0), q - vec2(0.6, 0.0)) * 4.0);
  gl_FragColor = vec4(c, 1.0);
}`);
      s.labels = SRC_NAMES.map((n) => el(ctx.overlay, 'div', 'ov-label', n));
      s.info = panel(ctx, 'ov-tr', '');
      s.rot = -ctx.params.src * Math.PI / 3;
      return s;
    },
    drawCanvas(s, t) {
      const g = s.g, W = 512, H = 320, { A1, A2, BONE } = S.CSS;
      g.fillStyle = '#0b0c10'; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 12; k++) {
        g.strokeStyle = k % 2 ? A1 : A2; g.globalAlpha = 0.18 + 0.06 * (k % 3); g.lineWidth = 2;
        g.beginPath(); g.arc(W * 0.72, H * 0.5, 20 + k * 14 + Math.sin(t * 2 + k) * 4, t * (0.3 + k * 0.05), t * (0.3 + k * 0.05) + 4.2); g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = BONE; g.font = 'italic 64px "Instrument Serif", Georgia, serif'; g.fillText('Canvas 2D', 28, 120);
      g.font = '500 15px "JetBrains Mono", monospace'; g.fillStyle = A1;
      g.fillText('t = ' + t.toFixed(2) + ' s', 32, 160);
      g.fillStyle = 'rgba(236,233,226,0.6)'; g.fillText('drawn, then uploaded every frame', 32, 186);
      const x = 32 + ((t * 120) % (W - 100));
      g.fillStyle = A2; g.fillRect(x, H - 54, 64, 6);
      g.fillStyle = 'rgba(236,233,226,0.15)'; g.fillRect(32, H - 52, W - 64, 2);
    },
    drawVideoCanvas(s, t) {
      const g = s.vg, W = 480, H = 300, { A1, A2, BONE } = S.CSS;
      g.fillStyle = '#08090c'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 24; i++) {
        const h = (0.3 + 0.7 * Math.abs(Math.sin(t * 2.1 + i * 0.6) * Math.cos(t * 0.7 + i * 0.23))) * H * 0.55;
        g.fillStyle = i % 2 ? A1 : A2; g.globalAlpha = 0.85;
        g.fillRect(24 + i * 18.5, H * 0.78 - h, 12, h);
      }
      g.globalAlpha = 1; g.fillStyle = BONE; g.font = '500 18px "JetBrains Mono", monospace';
      const f = Math.floor(t * 30);
      g.fillText('VIDEO  ' + String(Math.floor(f / 1800)).padStart(2, '0') + ':' + String(Math.floor(f / 30) % 60).padStart(2, '0') + ':' + String(f % 30).padStart(2, '0'), 24, 40);
      g.fillStyle = '#ff3b5c'; g.beginPath(); g.arc(W - 36, 34, 7, 0, 7); g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6); g.fill(); g.globalAlpha = 1;
      g.fillStyle = 'rgba(236,233,226,0.6)'; g.font = '500 12px "JetBrains Mono", monospace'; g.fillText('canvas.captureStream(30) → <video muted>', 24, H - 22);
    },
    stepLife(s) {
      const { lw, lh, cells, next, age } = s;
      let alive = 0;
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += cells[((y + dy + lh) % lh) * lw + ((x + dx + lw) % lw)];
        const i = y * lw + x, c = cells[i];
        next[i] = (c && (n === 2 || n === 3)) || (!c && n === 3) ? 1 : 0;
        age[i] = next[i] ? Math.min(age[i] + 1, 40) : age[i] * 0.8;
        alive += next[i];
      }
      s.cells = next; s.next = cells;
      if (alive < lw * lh * 0.04 || performance.now() - s.seededAt > 14000) s.seed();
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const t0 = performance.now();
      if (params.live || !s.ready[0]) {
        // 0 · canvas
        this.drawCanvas(s, t); s.upload(0, s.cv);
        // 1 · ImageData: CPU plasma
        const d = s.imgData.data, W = s.idW, H = s.idH;
        for (let y = 0, k = 0; y < H; y++) for (let x = 0; x < W; x++, k += 4) {
          const u = x / W, v = y / H;
          const p = Math.sin(u * 9 + t) + Math.sin(v * 7 - t * 1.3) + Math.sin((u + v) * 6 + t * 0.7) + Math.sin(Math.hypot(u - 0.5, v - 0.5) * 14 - t * 2);
          const q = p * 0.25 + 0.5, c = mix3(S.A1, S.A2, q), b = 0.25 + 0.75 * Math.pow(Math.abs(Math.sin(p * 1.6)), 3);
          d[k] = c[0] * b * 255; d[k + 1] = c[1] * b * 255; d[k + 2] = c[2] * b * 255; d[k + 3] = 255;
        }
        s.upload(1, s.imgData);
        // 2 · typed array
        s.lifeT += dt;
        if (s.lifeT > 0.08) { s.lifeT = 0; this.stepLife(s); }
        for (let i = 0; i < s.cells.length; i++) {
          const a = s.age[i] / 40, on = s.cells[i];
          const c = on ? mix3([0.93, 0.91, 0.88], S.A1, Math.min(1, a * 3)) : mix3([0.03, 0.035, 0.05], S.A2, Math.min(0.5, a) * 0.6);
          s.rgba[i * 4] = c[0] * 255; s.rgba[i * 4 + 1] = c[1] * 255; s.rgba[i * 4 + 2] = c[2] * 255; s.rgba[i * 4 + 3] = 255;
        }
        gl.bindTexture(gl.TEXTURE_2D, s.tex[2]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, s.lw, s.lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.rgba);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindTexture(gl.TEXTURE_2D, null);
        s.uploads[2]++; s.ready[2] = true;
        // 5 · video
        this.drawVideoCanvas(s, t);
        if (s.video.readyState >= 2 && s.video.videoWidth > 0) s.upload(5, s.video);
      }
      s.ms += (performance.now() - t0 - s.ms) * 0.1;
      // carousel motion
      const step = Math.PI / 3;
      if (input.dragging) { s.vel = input.dragDX * 0.006; s.rot += s.vel; s.dragged = true; }
      else {
        if (s.dragged) { s.dragged = false; s.rot += s.vel * 8; const idx = ((Math.round(-s.rot / step) % 6) + 6) % 6; s.rot = -Math.round(-s.rot / step) * step; if (idx !== params.src) ctx.syncParam('src', idx); }
        let target = -params.src * step;
        target += Math.round((s.rot - target) / (Math.PI * 2)) * Math.PI * 2;
        s.rot += (target - s.rot) * damp(4, dt);
      }
      const tx = input.hover ? input.nx * 0.25 : Math.sin(t * 0.5) * 0.12, ty = input.hover ? input.ny * 0.15 : Math.cos(t * 0.4) * 0.06;
      s.tilt[0] += (tx - s.tilt[0]) * damp(5, dt); s.tilt[1] += (ty - s.tilt[1]) * damp(5, dt);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      s.floor.use().set({ u_asp: ctx.aspect }); util.drawFullscreen();
      const vp = M4.mul(M4.persp(0.62, ctx.aspect, 0.1, 50), M4.lookAt([0, 0.35, 7.4], [0, -0.05, 0]));
      const R = 2.3;
      const cards = SRC_NAMES.map((_, i) => {
        const a = i * step + s.rot;
        const front = Math.max(0, Math.cos(a));
        let m = M4.mul(M4.translate(Math.sin(a) * R, 0, Math.cos(a) * R - 0.6), M4.rotY(a));
        if (front > 0.95) m = M4.mul(m, M4.mul(M4.rotY(s.tilt[0] * front), M4.rotX(-s.tilt[1] * front)));
        const h = 1.65, size = [h * s.aspect[i], h];
        return { i, a, m, front, size, z: Math.cos(a) };
      }).sort((p, q) => p.z - q.z);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.prog.use().set({ u_vp: vp, u_tex: 0 });
      if (params.mirror) for (const c of cards) { util.tex(0, s.tex[c.i]); s.prog.set({ u_m: c.m, u_size: c.size, u_front: c.front, u_mirror: 1, u_ready: s.ready[c.i] ? 1 : 0 }); s.quad.draw(); }
      gl.enable(gl.DEPTH_TEST);
      for (const c of cards) { util.tex(0, s.tex[c.i]); s.prog.set({ u_m: c.m, u_size: c.size, u_front: 0.15 + 0.85 * Math.pow(c.front, 3), u_mirror: 0, u_ready: s.ready[c.i] ? 1 : 0 }); s.quad.draw(); }
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      // labels above each card
      for (const c of cards) {
        const top = [c.m[12], c.m[13] + c.size[1] / 2 + 0.16, c.m[14]];
        const p = [vp[0] * top[0] + vp[4] * top[1] + vp[8] * top[2] + vp[12], vp[1] * top[0] + vp[5] * top[1] + vp[9] * top[2] + vp[13], vp[3] * top[0] + vp[7] * top[1] + vp[11] * top[2] + vp[15]];
        const L = s.labels[c.i];
        L.style.left = ((p[0] / p[2]) * 0.5 + 0.5) * ctx.cssWidth - L.offsetWidth / 2 + 'px';
        L.style.top = (0.5 - (p[1] / p[2]) * 0.5) * ctx.cssHeight - 10 + 'px';
        L.style.opacity = c.z < -0.1 ? '0' : (0.3 + 0.7 * c.front).toFixed(2);
        L.style.color = c.front > 0.95 ? 'var(--acc1)' : '';
      }
      ctx.canvas.style.cursor = input.dragging ? 'grabbing' : 'grab';
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        const i = params.src;
        const lines = [
          `HTMLCanvasElement · 512×320<br>redrawn + texImage2D each frame`,
          `ImageData · ${s.idW}×${s.idH}<br>CPU plasma written into .data`,
          `Uint8Array · ${s.lw}×${s.lh} RGBA<br>Game of Life, NEAREST magnified`,
          `HTMLImageElement · data URL<br>decoded async, uploaded once`,
          s.bmpErr ? '<span class="off">createImageBitmap unavailable</span>' : `ImageBitmap · createImageBitmap()<br>decoded off-thread, uploaded once`,
          s.videoErr ? `<span class="off">video: ${s.videoErr}</span>` : `HTMLVideoElement · ${s.video.videoWidth}×${s.video.videoHeight}<br>readyState <b>${s.video.readyState}</b> · stream from a canvas`,
        ];
        s.info.innerHTML = `<b>${SRC_NAMES[i]}</b><br>${lines[i]}<br>uploads <b>${s.uploads[i]}</b> · NPOT → CLAMP, no mips<br>live uploads <b>${s.ms.toFixed(1)} ms</b>/frame`;
      }
    },
    dispose(ctx, s) {
      s.dead = true;
      if (s.video) { try { s.video.pause(); } catch (_) { /* ignore */ } s.video.srcObject = null; s.video.removeAttribute('src'); s.video.load(); }
      if (s.stream) s.stream.getTracks().forEach((tr) => tr.stop());
      s.img.onload = null;
    },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Formats & packed types                                         */
  /* ---------------------------------------------------------------- */
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function toHalf(v) {
    f32[0] = v; const x = u32[0];
    const sgn = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 112; let m = x & 0x7fffff;
    if (e <= 0) { if (e < -10) return sgn; m = (m | 0x800000) >> (1 - e); return sgn | (m >> 13); }
    if (e >= 31) return sgn | 0x7c00;
    return sgn | (e << 10) | (m >> 13);
  }
  S.register({
    id: 'tex-formats',
    title: 'Formats & Packed Types',
    category: CAT,
    thumb: 'square',
    hint: 'hover a tile to zoom · lower exposure',
    description: 'One HDR test image converted on the CPU into every format and type WebGL 1.0 accepts. RGB, LUMINANCE, ALPHA and LUMINANCE_ALPHA keep only some channels; the 16-bit packed types squeeze a whole texel into two bytes, and the smooth gradient breaks into visible bands. OES_texture_float and OES_texture_half_float textures keep values above 1.0, so lowering the exposure brings back the highlight that every 8-bit tile has clipped.',
    interact: [['Hover', 'enlarge a tile with a 3× loupe at the pointer'], ['Exposure', 'scale the sampled value before display'], ['Animate', 'sweep the exposure automatically']],
    features: ['RGBA · RGB · LUMINANCE · ALPHA · LUMINANCE_ALPHA', 'UNSIGNED_SHORT_5_6_5 / 4_4_4_4 / 5_5_5_1', 'OES_texture_float (FLOAT)', 'OES_texture_half_float (HALF_FLOAT_OES)', 'bytes per texel from 1 to 16'],
    params: [
      { key: 'exposure', label: 'Exposure', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 },
      { key: 'anim', label: 'Animate exposure', type: 'toggle', value: true },
      { key: 'filter', label: 'Magnification', type: 'select', options: ['NEAREST', 'LINEAR'], value: 0 },
    ],
    code: `// 16-bit packed: r5 g6 b5 in one Uint16
px[i] = (r >> 3) << 11 | (g >> 2) << 5 | (b >> 3);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0,
              gl.RGB, gl.UNSIGNED_SHORT_5_6_5, new Uint16Array(px));
const hf = gl.getExtension('OES_texture_half_float');
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0,
              gl.RGBA, hf.HALF_FLOAT_OES, halfs /* Uint16Array */);`,
    init(ctx) {
      const { gl, util } = ctx;
      const N = 96;
      // HDR source: hue ramp across, luminance ramp up, a bright sun (up to ~3.0), alpha falling off at the rim
      const src = new Float32Array(N * N * 4);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N, v = (y + 0.5) / N, i = (y * N + x) * 4;
        const c = mix3(S.A1, S.A2, u);
        const L = Math.pow(v, 1.15);
        const sun = 2.6 * Math.exp(-((u - 0.66) ** 2 + (v - 0.66) ** 2) * 60);
        const a = clamp(1.25 - Math.hypot(u - 0.5, v - 0.5) * 2.1, 0, 1);
        src[i] = c[0] * L + sun; src[i + 1] = c[1] * L + sun * 0.95; src[i + 2] = c[2] * L + sun * 0.85; src[i + 3] = a;
      }
      const b8 = (v) => Math.round(clamp(v, 0, 1) * 255);
      const lum = (i) => 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
      const build = (ch, fn, Arr) => { const o = new Arr(N * N * ch); for (let p = 0; p < N * N; p++) fn(o, p, p * 4); return o; };
      const fext = util.ext('OES_texture_float'), hext = util.ext('OES_texture_half_float');
      const F = [
        ['RGBA', 'UNSIGNED_BYTE', 4, gl.RGBA, gl.UNSIGNED_BYTE, () => build(4, (o, p, i) => { o[p * 4] = b8(src[i]); o[p * 4 + 1] = b8(src[i + 1]); o[p * 4 + 2] = b8(src[i + 2]); o[p * 4 + 3] = b8(src[i + 3]); }, Uint8Array)],
        ['RGB', 'UNSIGNED_BYTE', 3, gl.RGB, gl.UNSIGNED_BYTE, () => build(3, (o, p, i) => { o[p * 3] = b8(src[i]); o[p * 3 + 1] = b8(src[i + 1]); o[p * 3 + 2] = b8(src[i + 2]); }, Uint8Array)],
        ['LUMINANCE', 'UNSIGNED_BYTE', 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, () => build(1, (o, p, i) => { o[p] = b8(lum(i)); }, Uint8Array)],
        ['ALPHA', 'UNSIGNED_BYTE', 1, gl.ALPHA, gl.UNSIGNED_BYTE, () => build(1, (o, p, i) => { o[p] = b8(src[i + 3]); }, Uint8Array)],
        ['LUMINANCE_ALPHA', 'UNSIGNED_BYTE', 2, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, () => build(2, (o, p, i) => { o[p * 2] = b8(lum(i)); o[p * 2 + 1] = b8(src[i + 3]); }, Uint8Array)],
        ['RGB', 'UNSIGNED_SHORT_5_6_5', 2, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, () => build(1, (o, p, i) => { o[p] = ((b8(src[i]) >> 3) << 11) | ((b8(src[i + 1]) >> 2) << 5) | (b8(src[i + 2]) >> 3); }, Uint16Array)],
        ['RGBA', 'UNSIGNED_SHORT_4_4_4_4', 2, gl.RGBA, gl.UNSIGNED_SHORT_4_4_4_4, () => build(1, (o, p, i) => { o[p] = ((b8(src[i]) >> 4) << 12) | ((b8(src[i + 1]) >> 4) << 8) | ((b8(src[i + 2]) >> 4) << 4) | (b8(src[i + 3]) >> 4); }, Uint16Array)],
        ['RGBA', 'UNSIGNED_SHORT_5_5_5_1', 2, gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1, () => build(1, (o, p, i) => { o[p] = ((b8(src[i]) >> 3) << 11) | ((b8(src[i + 1]) >> 3) << 6) | ((b8(src[i + 2]) >> 3) << 1) | (src[i + 3] >= 0.5 ? 1 : 0); }, Uint16Array)],
        ['RGBA', 'FLOAT', 16, gl.RGBA, fext ? gl.FLOAT : 0, () => src],
        ['LUMINANCE', 'FLOAT', 4, gl.LUMINANCE, fext ? gl.FLOAT : 0, () => build(1, (o, p, i) => { o[p] = lum(i); }, Float32Array)],
        ['RGBA', 'HALF_FLOAT_OES', 8, gl.RGBA, hext ? hext.HALF_FLOAT_OES : 0, () => build(4, (o, p, i) => { for (let k = 0; k < 4; k++) o[p * 4 + k] = toHalf(src[i + k]); }, Uint16Array)],
        ['RGB', 'HALF_FLOAT_OES', 6, gl.RGB, hext ? hext.HALF_FLOAT_OES : 0, () => build(3, (o, p, i) => { for (let k = 0; k < 3; k++) o[p * 3 + k] = toHalf(src[i + k]); }, Uint16Array)],
      ];
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const tiles = F.map(([fmt, type, bpp, gf, gt, make]) => {
        if (!gt) return { fmt, type, bpp, tex: null };
        const tex = util.rawTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gf, N, N, 0, gf, gt, make());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return { fmt, type, bpp, tex, float: type !== 'UNSIGNED_BYTE' && !type.startsWith('UNSIGNED_SHORT') };
      });
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.bindTexture(gl.TEXTURE_2D, null);
      const fl = util.ext('OES_texture_float_linear'), hl = util.ext('OES_texture_half_float_linear');
      tiles.forEach((tl) => { tl.linearOK = !tl.float || (tl.type === 'FLOAT' ? !!fl : !!hl); });
      const prog = util.program(RECT_VS, G.colors + `
uniform sampler2D u_tex; uniform float u_exp; uniform float u_missing; uniform vec4 u_zoom; uniform float u_hover;
varying vec2 v_uv;
void main() {
  vec2 uv = mix(v_uv, u_zoom.xy + (v_uv - 0.5) / u_zoom.z, u_zoom.w);
  vec2 g = floor(v_uv * 12.0);
  vec3 chk = mix(vec3(0.16, 0.17, 0.19), vec3(0.27, 0.28, 0.3), mod(g.x + g.y, 2.0));
  vec4 t = texture2D(u_tex, uv);
  vec3 c = mix(chk, t.rgb * u_exp, t.a);
  if (u_missing > 0.5) c = chk * 0.5 + A2 * 0.25 * step(0.5, fract((v_uv.x - v_uv.y) * 8.0));
  vec2 e = min(v_uv, 1.0 - v_uv);
  c = mix(c, u_hover > 0.5 ? A1 : BONE * 0.25, step(min(e.x, e.y), u_hover > 0.5 ? 0.006 : 0.004));
  gl_FragColor = vec4(c, 1.0);
}`);
      const labels = tiles.map((tl) => el(ctx.overlay, 'div', 'ov-label', `${tl.fmt}<br><span style="opacity:.65">${tl.type.replace('UNSIGNED_', 'U_')} · ${tl.bpp} B</span>`));
      labels.forEach((L) => { L.style.lineHeight = '1.45'; L.style.fontSize = '9.5px'; });
      const info = panel(ctx, 'ov-tr', '');
      return { prog, quad: unitQuad(util), tiles, labels, info, hover: -1, grow: tiles.map(() => 0), exp: 1 };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const W = ctx.width, H = ctx.height, dpr = ctx.dpr;
      const top = 96 * dpr, bot = 76 * dpr, side = 24 * dpr;
      const cols = W > H * 1.25 ? 6 : 4, rows = Math.ceil(12 / cols);
      const gap = 30 * dpr;
      const cell = Math.min((W - side * 2 - gap * (cols - 1)) / cols, (H - top - bot - gap * (rows - 1)) / rows);
      const x0 = (W - (cell * cols + gap * (cols - 1))) / 2, y0 = bot + (H - top - bot - (cell * rows + gap * (rows - 1))) / 2;
      const rects = s.tiles.map((_, i) => { const c = i % cols, r = Math.floor(i / cols); return [x0 + c * (cell + gap), y0 + (rows - 1 - r) * (cell + gap), cell, cell]; });
      let px, py;
      if (input.hover && !ctx.capture) { px = input.x * dpr; py = H - input.y * dpr; }
      else { const r = rects[6]; px = r[0] + r[2] * (0.3 + 0.12 * Math.sin(t * 0.8)); py = r[1] + r[3] * (0.62 + 0.08 * Math.cos(t * 0.6)); }
      s.hover = rects.findIndex((r) => px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]);
      const e = params.anim ? 1.05 + Math.sin(t * 0.6 - 1.9) * 0.75 : params.exposure;
      if (params.anim && Math.abs(e - params.exposure) > 0.02 && Math.floor(t * 10) !== s.tk) { s.tk = Math.floor(t * 10); ctx.syncParam('exposure', +e.toFixed(2)); }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      s.prog.use().set({ u_tex: 0, u_exp: e });
      const order = [...s.tiles.keys()].sort((a, b) => (a === s.hover) - (b === s.hover));
      for (const i of order) {
        const tl = s.tiles[i], r = rects[i];
        s.grow[i] += ((i === s.hover ? 1 : 0) - s.grow[i]) * damp(10, dt);
        const g = 1 + s.grow[i] * 0.75;
        const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
        const w = r[2] * g, h = r[3] * g;
        const rx = clamp(cx - w / 2, 4, W - w - 4), ry = clamp(cy - h / 2, bot * 0.6, H - top * 0.6 - h);
        if (tl.tex) {
          gl.bindTexture(gl.TEXTURE_2D, tl.tex);
          const lin = params.filter === 1 && tl.linearOK;
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
        }
        const zu = clamp((px - r[0]) / r[2], 0, 1), zv = clamp((py - r[1]) / r[3], 0, 1);
        s.prog.set({ u_rect: ndcRect(ctx, rx, ry, w, h), u_missing: tl.tex ? 0 : 1, u_zoom: [zu, zv, 3, s.grow[i] > 0.05 ? s.grow[i] : 0], u_hover: i === s.hover ? 1 : 0 });
        s.quad.draw();
        const L = s.labels[i];
        L.style.left = rx / dpr + 'px'; L.style.top = (H - ry) / dpr + 6 + 'px';
        L.style.zIndex = i === s.hover ? 2 : 1;
        L.style.color = i === s.hover ? 'var(--acc1)' : '';
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (s.hover !== s.lastHover || Math.floor(t * 4) !== s.tick) {
        s.lastHover = s.hover; s.tick = Math.floor(t * 4);
        const tl = s.tiles[s.hover];
        s.info.innerHTML = tl ? `<b>${tl.fmt} · ${tl.type}</b><br>${tl.bpp} bytes per texel · ${(tl.bpp * 96 * 96 / 1024).toFixed(1)} KB<br>${!tl.tex ? '<span class="off">extension not supported</span>' : tl.float ? '<span class="on">keeps values above 1.0</span>' : tl.type.startsWith('UNSIGNED_SHORT') ? 'packed 16-bit: ' + (tl.type.includes('5_6_5') ? '32·64·32 levels, no alpha' : tl.type.includes('4_4_4_4') ? '16 levels per channel' : '32 levels, 1-bit alpha') : '8 bits per channel, clipped at 1.0'}<br>exposure <b>${e.toFixed(2)}</b>` : `12 formats · 96 × 96 each<br>exposure <b>${e.toFixed(2)}</b><br>hover a tile to inspect`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Filtering & mipmaps                                            */
  /* ---------------------------------------------------------------- */
  const FILTERS = ['NEAREST', 'LINEAR', 'NEAREST_MIPMAP_NEAREST', 'LINEAR_MIPMAP_NEAREST', 'NEAREST_MIPMAP_LINEAR', 'LINEAR_MIPMAP_LINEAR'];
  const LEVEL_COLS = ['#38d6e8', '#5fb8f0', '#8f9cf2', '#c487e6', '#ff4fa3', '#ff7d7d', '#ffb36b', '#ece9e2', '#9aa0a8'];
  S.register({
    id: 'filtering-mipmaps',
    title: 'Filtering & Mipmaps',
    category: CAT,
    thumb: 'tall',
    hint: 'drag to fly · switch filters and mip chains',
    description: 'A textured plane running to the horizon, where hundreds of texels fall inside every pixel. NEAREST and LINEAR shimmer and alias in the distance; the four mipmap filters pick or blend between pre-shrunk levels. A custom chain uploads every level with its own texImage2D call and colour, so you can see which level each pixel samples. Anisotropic filtering takes more samples along the stretched axis, and EXT_shader_texture_lod lets the shader force a level.',
    interact: [['Drag', 'fly forward / back and sideways'], ['Move', 'look around'], ['Wheel', 'camera height'], ['Force level', 'texture2DLodEXT with an explicit LOD (−1 = automatic)']],
    features: ['TEXTURE_MIN_FILTER (all 6) / MAG_FILTER', 'generateMipmap + GENERATE_MIPMAP_HINT', 'texImage2D per level (custom chain)', 'EXT_texture_filter_anisotropic', 'EXT_shader_texture_lod → texture2DLodEXT'],
    params: [
      { key: 'filter', label: 'Min filter', type: 'select', options: ['NEAREST', 'LINEAR', 'N_MIP_N', 'L_MIP_N', 'N_MIP_L', 'L_MIP_L'], value: 5 },
      { key: 'chain', label: 'Mip chain', type: 'select', options: ['generateMipmap', 'Coloured levels'], value: 1 },
      { key: 'aniso', label: 'Anisotropy', type: 'range', min: 1, max: 16, step: 1, value: 1 },
      { key: 'lod', label: 'Force level (LOD ext)', type: 'range', min: -1, max: 8, step: 1, value: -1 },
      { key: 'hint', label: 'GENERATE_MIPMAP_HINT', type: 'select', options: ['DONT_CARE', 'FASTEST', 'NICEST'], value: 0 },
    ],
    code: `for (let l = 0, s = 256; s >= 1; l++, s >>= 1)
  gl.texImage2D(gl.TEXTURE_2D, l, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, level[l]);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
const af = gl.getExtension('EXT_texture_filter_anisotropic');
gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, 8);
// GLSL with EXT_shader_texture_lod
vec4 c = texture2DLodEXT(u_tex, uv, 3.0);`,
    init(ctx) {
      const { gl, util } = ctx;
      const S0 = 256;
      // base texture: fine grid + checker + label (aliases badly without mips)
      const [bc, bg] = canvas2d(S0, S0);
      bg.fillStyle = '#16181f'; bg.fillRect(0, 0, S0, S0);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) { bg.fillStyle = '#242833'; bg.fillRect(x * 32, y * 32, 32, 32); }
      bg.strokeStyle = S.CSS.A1; bg.lineWidth = 2; for (let k = 0; k <= 8; k++) { bg.beginPath(); bg.moveTo(k * 32, 0); bg.lineTo(k * 32, S0); bg.moveTo(0, k * 32); bg.lineTo(S0, k * 32); bg.stroke(); }
      bg.strokeStyle = S.CSS.A2; bg.lineWidth = 1; for (let k = 0; k < 32; k++) { bg.beginPath(); bg.moveTo(k * 8 + 4, 0); bg.lineTo(k * 8 + 4, S0); bg.stroke(); }
      bg.fillStyle = S.CSS.BONE; bg.font = 'italic 70px "Instrument Serif", Georgia, serif'; bg.textAlign = 'center'; bg.textBaseline = 'middle'; bg.fillText('mip', S0 / 2, S0 / 2);
      const texGen = util.rawTexture();
      gl.bindTexture(gl.TEXTURE_2D, texGen);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bc);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      // custom chain: every level drawn separately, tinted
      const texChain = util.rawTexture();
      gl.bindTexture(gl.TEXTURE_2D, texChain);
      const strip = el(ctx.overlay, 'canvas', 'ov-canvas');
      const levels = [];
      for (let l = 0, sz = S0; sz >= 1; l++, sz >>= 1) {
        const [c, g] = canvas2d(sz, sz);
        g.drawImage(bc, 0, 0, sz, sz);
        g.globalCompositeOperation = 'multiply'; g.fillStyle = LEVEL_COLS[l]; g.fillRect(0, 0, sz, sz);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.55; g.fillStyle = LEVEL_COLS[l]; g.fillRect(0, 0, sz, sz); g.globalAlpha = 1;
        if (sz >= 16) { g.fillStyle = '#0b0c0e'; g.font = `600 ${Math.round(sz * 0.3)}px "JetBrains Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('L' + l, sz / 2, sz / 2); }
        gl.texImage2D(gl.TEXTURE_2D, l, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        levels.push(c);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_2D, null);
      // mip strip overlay (also a picture of what was uploaded)
      const sh = 40;
      strip.width = 9 * (sh + 6) * 2; strip.height = (sh + 18) * 2;
      strip.style.width = strip.width / 2 + 'px'; strip.style.height = strip.height / 2 + 'px';
      strip.style.left = '14px'; strip.style.bottom = '84px'; strip.style.background = 'rgba(6,7,8,.72)';
      const sg = strip.getContext('2d'); sg.scale(2, 2); sg.imageSmoothingEnabled = false;
      levels.forEach((c, l) => {
        const x = 6 + l * (sh + 6) - 3, d = Math.max(4, sh * Math.pow(0.82, l));
        sg.drawImage(c, x, 4 + (sh - d), d, d);
        sg.fillStyle = 'rgba(236,233,226,0.7)'; sg.font = '500 9px "JetBrains Mono", monospace'; sg.fillText(String(256 >> l), x, sh + 14);
      });
      const af = util.ext('EXT_texture_filter_anisotropic') || util.ext('WEBKIT_EXT_texture_filter_anisotropic');
      const maxAniso = af ? gl.getParameter(af.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
      const lodExt = util.ext('EXT_shader_texture_lod');
      const vs = `
attribute vec2 a_pos;
uniform mat4 u_vp; uniform vec2 u_scroll;
varying vec2 v_uv; varying float v_d;
void main() { vec3 w = vec3(a_pos.x, 0.0, a_pos.y); v_uv = a_pos * 0.5 + u_scroll; vec4 p = u_vp * vec4(w, 1.0); v_d = p.w; gl_Position = p; }`;
      const fs = (lod) => (lod ? '#extension GL_EXT_shader_texture_lod : enable\n' : '') + G.colors + `
uniform sampler2D u_tex; uniform float u_lod;
varying vec2 v_uv; varying float v_d;
void main() {
  vec4 t;
${lod ? '  if (u_lod >= 0.0) t = texture2DLodEXT(u_tex, v_uv, u_lod); else t = texture2D(u_tex, v_uv);' : '  t = texture2D(u_tex, v_uv);'}
  float fog = 1.0 - exp(-v_d * 0.006);
  vec3 sky = mix(INK * 2.2, vec3(0.06, 0.07, 0.1), 0.6);
  gl_FragColor = vec4(mix(t.rgb, sky, fog * 0.6), 1.0);
}`;
      const prog = util.program(vs, fs(!!lodExt));
      const plane = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array([-400, -400, 400, -400, -400, 400, 400, 400])), loc: 0, size: 2 }], null, { count: 4, mode: gl.TRIANGLE_STRIP });
      const sky = util.program(G.fullscreenVS, G.colors + `varying vec2 v_uv; uniform float u_h; void main() { float k = smoothstep(u_h - 0.02, 1.0, v_uv.y); vec3 c = mix(vec3(0.06, 0.07, 0.1), INK, k); c += A1 * 0.05 * exp(-abs(v_uv.y - u_h) * 40.0); gl_FragColor = vec4(c, 1.0); }`);
      const info = panel(ctx, 'ov-tr', '');
      return { prog, sky, plane, texGen, texChain, af, maxAniso, lodExt, info, scroll: [0, 0], yaw: 0, pitch: -0.12, h: 1.2, hintSet: -1 };
    },
    regen(ctx, s) {
      const { gl } = ctx;
      gl.hint(gl.GENERATE_MIPMAP_HINT, [gl.DONT_CARE, gl.FASTEST, gl.NICEST][ctx.params.hint]);
      gl.bindTexture(gl.TEXTURE_2D, s.texGen);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
      s.hintSet = ctx.params.hint;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      if (s.hintSet !== params.hint) this.regen(ctx, s);
      const ty = input.hover && !input.down ? input.nx * 0.5 : Math.sin(t * 0.15) * 0.25;
      const tp = input.hover && !input.down ? -0.06 - (input.ny + 1) * 0.12 : -0.16;
      s.yaw += (ty - s.yaw) * damp(3, dt); s.pitch += (tp - s.pitch) * damp(3, dt);
      s.h = clamp(s.h * Math.exp(input.wheel * 0.001), 0.25, 8);
      const fwd = [Math.sin(s.yaw), Math.cos(s.yaw)];
      if (input.dragging) {
        const k = 0.004 * s.h;
        s.scroll[0] += (-fwd[0] * input.dragDY * k - fwd[1] * input.dragDX * k) * 0.5;
        s.scroll[1] += (fwd[1] * input.dragDY * k * -1 + fwd[0] * input.dragDX * k) * 0.5;
      } else { s.scroll[0] -= fwd[0] * dt * 0.18; s.scroll[1] -= fwd[1] * dt * 0.18; }
      const eye = [0, s.h, 0];
      const look = [Math.sin(s.yaw) * Math.cos(s.pitch), s.h + Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch)];
      const vp = M4.mul(M4.persp(1.0, ctx.aspect, 0.05, 600), M4.lookAt(eye, look));
      gl.viewport(0, 0, ctx.width, ctx.height);
      // horizon height in uv for the sky gradient
      const hz = 0.5 - Math.tan(s.pitch) / Math.tan(0.5) * 0.5;
      s.sky.use().set({ u_h: hz }); util.drawFullscreen();
      const tex = params.chain ? s.texChain : s.texGen;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const f = FILTERS[params.filter];
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl[f]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f.startsWith('NEAREST') ? gl.NEAREST : gl.LINEAR);
      const an = Math.min(params.aniso, s.maxAniso);
      if (s.af) gl.texParameterf(gl.TEXTURE_2D, s.af.TEXTURE_MAX_ANISOTROPY_EXT, an);
      s.prog.use().set({ u_vp: vp, u_scroll: s.scroll, u_tex: 0, u_lod: s.lodExt ? params.lod : -1 });
      s.plane.draw();
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        const hv = gl.getParameter(gl.GENERATE_MIPMAP_HINT);
        s.info.innerHTML = `MIN <b>${f}</b><br>MAG <b>${f.startsWith('NEAREST') ? 'NEAREST' : 'LINEAR'}</b> · chain <b>${params.chain ? 'texImage2D × 9' : 'generateMipmap'}</b><br>anisotropy ${s.af ? `<b>${an}</b> / max ${s.maxAniso}` : '<span class="off">ext missing</span>'}<br>LOD ${s.lodExt ? (params.lod < 0 ? '<b>automatic</b>' : `<span class="on">forced ${params.lod}</span> · texture2DLodEXT`) : '<span class="off">EXT_shader_texture_lod missing</span>'}<br>GENERATE_MIPMAP_HINT <b>${hv === gl.NICEST ? 'NICEST' : hv === gl.FASTEST ? 'FASTEST' : 'DONT_CARE'}</b>`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Wrapping & NPOT                                                */
  /* ---------------------------------------------------------------- */
  const WRAPS = ['REPEAT', 'MIRRORED_REPEAT', 'CLAMP_TO_EDGE'];
  S.register({
    id: 'wrap-npot',
    title: 'Wrapping & NPOT',
    category: CAT,
    thumb: 'portrait',
    hint: 'drag to pan · wheel to zoom',
    description: 'Texture coordinates outside 0–1 are resolved by the wrap mode, set separately for S and T: REPEAT tiles, MIRRORED_REPEAT flips every other tile, CLAMP_TO_EDGE stretches the border texels. WebGL 1.0 restricts textures whose sides are not powers of two: they must use CLAMP_TO_EDGE on both axes and a filter without mipmaps. Break either rule and the texture is incomplete, so every sample returns opaque black, with no error raised.',
    interact: [['Drag', 'pan the texture coordinates'], ['Wheel', 'zoom'], ['Wrap S / T', 'per-axis wrap mode'], ['Texture', 'power-of-two or not, with or without mipmaps']],
    features: ['TEXTURE_WRAP_S / TEXTURE_WRAP_T', 'REPEAT · MIRRORED_REPEAT · CLAMP_TO_EDGE', 'NPOT: CLAMP_TO_EDGE + no mipmaps only', 'incomplete texture → (0, 0, 0, 1)', 'generateMipmap needs power-of-two sizes'],
    params: [
      { key: 'tex', label: 'Texture', type: 'select', options: ['POT 256 × 256', 'NPOT 320 × 200'], value: 0 },
      { key: 'ws', label: 'Wrap S', type: 'select', options: ['REPEAT', 'MIRRORED', 'CLAMP'], value: 0 },
      { key: 'wt', label: 'Wrap T', type: 'select', options: ['REPEAT', 'MIRRORED', 'CLAMP'], value: 1 },
      { key: 'mip', label: 'Mipmapped min filter', type: 'toggle', value: false },
      { key: 'grid', label: 'Tile grid', type: 'toggle', value: true },
    ],
    code: `gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
// NPOT (320×200) must be:
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
// otherwise it is incomplete and samples as black`,
    init(ctx) {
      const { gl, util } = ctx;
      const pot = util.texture({ source: S.testCanvas(256, 'Aa'), mipmap: true, flipY: true });
      const [nc, ng] = canvas2d(320, 200);
      ng.drawImage(S.testCanvas(256, 'Np'), 0, 0, 320, 200);
      ng.fillStyle = 'rgba(236,233,226,0.85)'; ng.font = '500 13px "JetBrains Mono", monospace'; ng.fillText('320 × 200', 116, 186);
      const npot = util.texture({ source: nc, flipY: true });
      const prog = util.program(G.fullscreenVS, G.colors + `
uniform sampler2D u_tex; uniform vec2 u_pan; uniform float u_scale; uniform vec2 u_res; uniform float u_asp; uniform float u_bad; uniform float u_grid; uniform float u_t;
varying vec2 v_uv;
void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 uv = q * vec2(1.0, u_asp) * u_scale + u_pan;     // texel-aspect corrected
  vec4 t = texture2D(u_tex, uv);
  vec3 c = t.rgb;
  float px = u_scale / u_res.y * 1.5;
  vec2 d = abs(uv - floor(uv + 0.5));
  float tile = step(min(d.x, d.y), px * 0.6) * u_grid;
  vec2 dd = min(abs(uv), abs(uv - 1.0));
  float inUnit = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float unit = (step(dd.x, px) * step(-px, uv.y) * step(uv.y, 1.0 + px) + step(dd.y, px) * step(-px, uv.x) * step(uv.x, 1.0 + px));
  c = mix(c, BONE, tile * 0.25);
  c = mix(c, A1, clamp(unit, 0.0, 1.0));
  if (u_bad > 0.5) {
    float h = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 14.0 - u_t * 0.5));
    c += A2 * h * 0.07 * (1.0 - inUnit * 0.5);
  }
  gl_FragColor = vec4(c, 1.0);
}`);
      const info = panel(ctx, 'ov-tr', '');
      const warn = el(ctx.overlay, 'div', 'ov-label');
      warn.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);font-size:12px;letter-spacing:.14em;color:var(--acc2);text-align:center;line-height:1.7';
      return { prog, pot, npot, info, warn, pan: [0.5, 0.5], scale: 2.6, vel: [0, 0] };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      if (input.dragging) {
        const k = s.scale / ctx.cssHeight;
        s.vel = [-input.dragDX * k, input.dragDY * k];
        s.pan[0] += s.vel[0]; s.pan[1] += s.vel[1];
      } else if (!input.hover || ctx.capture) {
        s.pan[0] += Math.cos(t * 0.21) * dt * 0.12; s.pan[1] += Math.sin(t * 0.17) * dt * 0.08;
      } else { s.pan[0] += s.vel[0]; s.pan[1] += s.vel[1]; s.vel[0] *= 0.9; s.vel[1] *= 0.9; }
      s.scale = clamp(s.scale * Math.exp(input.wheel * 0.0012) / input.pinch, 0.4, 12);
      const npot = params.tex === 1;
      const tex = npot ? s.npot : s.pot;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl[WRAPS[params.ws]]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl[WRAPS[params.wt]]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, params.mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      const reasons = [];
      if (npot && params.ws !== 2) reasons.push('WRAP_S ≠ CLAMP_TO_EDGE');
      if (npot && params.wt !== 2) reasons.push('WRAP_T ≠ CLAMP_TO_EDGE');
      if (npot && params.mip) reasons.push('mipmap filter, no levels (generateMipmap is invalid for NPOT)');
      const bad = reasons.length > 0;
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.prog.use().set({ u_tex: 0, u_pan: s.pan, u_scale: s.scale, u_res: [ctx.width, ctx.height], u_asp: npot ? 320 / 200 : 1, u_bad: bad ? 1 : 0, u_grid: params.grid ? 1 : 0, u_t: t });
      util.drawFullscreen();
      gl.bindTexture(gl.TEXTURE_2D, null);
      s.warn.innerHTML = bad ? 'texture incomplete<br><span style="opacity:.75">every sample → (0, 0, 0, 1)</span>' : '';
      ctx.canvas.style.cursor = input.dragging ? 'grabbing' : 'grab';
      if (Math.floor(t * 4) !== s.tick || bad !== s.lastBad) {
        s.tick = Math.floor(t * 4); s.lastBad = bad;
        s.info.innerHTML = `<b>${npot ? '320 × 200 · NPOT' : '256 × 256 · POT'}</b><br>S <b>${WRAPS[params.ws]}</b><br>T <b>${WRAPS[params.wt]}</b><br>MIN <b>${params.mip ? 'LINEAR_MIPMAP_LINEAR' : 'LINEAR'}</b><br>${bad ? `<span class="off">incomplete:</span><br>${reasons.join('<br>')}` : '<span class="on">complete</span>'}<br>uv centre (${s.pan[0].toFixed(2)}, ${s.pan[1].toFixed(2)}) · zoom ${(1 / s.scale).toFixed(2)}×`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Cube maps                                                      */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'cubemap',
    title: 'Cube Maps',
    category: CAT,
    thumb: 'square',
    hint: 'drag to orbit · reflect or refract',
    description: 'Six square faces bound as one TEXTURE_CUBE_MAP and sampled with a direction rather than a coordinate. The skybox looks up the view ray; the object looks up reflect(I, N) or refract(I, N, η), split into three wavelengths for a little dispersion, or blends both with a Fresnel term. The bias argument of textureCube selects blurrier mip levels. WebGL 1.0 does not require seamless filtering across faces, so at high bias the face edges can show.',
    interact: [['Drag', 'orbit'], ['Wheel', 'zoom'], ['Mode', 'reflection, refraction or Fresnel mix'], ['Blur', 'textureCube bias into the mip chain']],
    features: ['TEXTURE_CUBE_MAP + 6 × texImage2D', 'textureCube(sampler, dir, bias)', 'reflect() · refract()', 'generateMipmap on a cube map', 'TEXTURE_CUBE_MAP_POSITIVE_X … NEGATIVE_Z'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Reflect', 'Refract', 'Fresnel'], value: 2 },
      { key: 'obj', label: 'Object', type: 'select', options: ['Sphere', 'Torus knot', 'Cube'], value: 0 },
      { key: 'eta', label: 'Refraction ratio η', type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.76 },
      { key: 'bias', label: 'Blur (bias)', type: 'range', min: 0, max: 7, step: 0.1, value: 0 },
      { key: 'sky', label: 'Skybox', type: 'toggle', value: true },
    ],
    code: `for (let i = 0; i < 6; i++)
  gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA,
                gl.RGBA, gl.UNSIGNED_BYTE, faces[i]);
gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
// fragment shader
vec3 r = reflect(normalize(v_w - u_eye), n);
gl_FragColor = textureCube(u_cube, r, u_bias);`,
    init(ctx) {
      const { gl, util } = ctx;
      const cube = util.texture({ faces: S.cubeFaces(256), mipmap: true });
      const meshes = [S.geo.upload(util, S.geo.sphere(72, 36, 1.15)), S.geo.upload(util, S.geo.torusKnot(320, 40, 0.3, 0.95, 0.42)), S.geo.uploadFlat(util, S.geo.cube())];
      const sky = util.program(G.fullscreenVS, `
uniform samplerCube u_cube; uniform vec3 u_r; uniform vec3 u_u; uniform vec3 u_f; uniform vec2 u_tan; uniform float u_bias;
varying vec2 v_uv;
void main() {
  vec2 n = v_uv * 2.0 - 1.0;
  vec3 d = normalize(u_f + u_r * n.x * u_tan.x + u_u * n.y * u_tan.y);
  gl_FragColor = vec4(textureCube(u_cube, d, u_bias * 0.5).rgb * 0.55, 1.0);
}`);
      const obj = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_m; uniform float u_scale;
varying vec3 v_w; varying vec3 v_n;
void main() { vec4 w = u_m * vec4(a_pos * u_scale, 1.0); v_w = w.xyz; v_n = mat3(u_m) * a_nrm; gl_Position = u_vp * w; }`, G.colors + `
uniform samplerCube u_cube; uniform vec3 u_eye; uniform float u_mode; uniform float u_eta; uniform float u_bias;
varying vec3 v_w; varying vec3 v_n;
void main() {
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 I = normalize(v_w - u_eye);
  vec3 refl = textureCube(u_cube, reflect(I, n), u_bias).rgb;
  vec3 refr = vec3(textureCube(u_cube, refract(I, n, u_eta * 0.985), u_bias).r,
                   textureCube(u_cube, refract(I, n, u_eta), u_bias).g,
                   textureCube(u_cube, refract(I, n, u_eta * 1.015), u_bias).b);
  float fr = 0.04 + 0.96 * pow(1.0 - max(dot(-I, n), 0.0), 5.0);
  vec3 c = u_mode < 0.5 ? refl : u_mode < 1.5 ? refr * vec3(0.92, 0.97, 1.0) : mix(refr * vec3(0.9, 0.96, 1.0), refl, fr);
  c += BONE * pow(max(dot(reflect(I, n), normalize(vec3(0.4, 0.8, 0.3))), 0.0), 120.0) * 0.6;
  gl_FragColor = vec4(c, 1.0);
}`);
      const info = panel(ctx, 'ov-tr', `TEXTURE_CUBE_MAP · 6 × 256²<br>MAX_CUBE_MAP_TEXTURE_SIZE <b>${gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE)}</b><br>seamless filtering: <span class="off">not guaranteed</span> in WebGL 1.0`);
      return { cube, meshes, sky, obj, info, cam: new S.OrbitCam({ dist: 4.2, pitch: 0.1, yaw: 0.6, auto: 0.16, minDist: 2.2, maxDist: 10 }) };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      s.cam.update(input, dt);
      const b = s.cam.basis(), tn = Math.tan(s.cam.fov / 2);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      util.tex(0, s.cube, gl.TEXTURE_CUBE_MAP);
      if (params.sky) { s.sky.use().set({ u_cube: 0, u_r: b.right, u_u: b.up, u_f: b.fwd, u_tan: [tn * ctx.aspect, tn], u_bias: params.bias }); util.drawFullscreen(); }
      gl.enable(gl.DEPTH_TEST);
      const m = M4.mul(M4.rotY(t * 0.25), M4.rotX(Math.sin(t * 0.3) * 0.3));
      s.obj.use().set({ u_vp: M4.mul(s.cam.proj(ctx.aspect), s.cam.view()), u_m: m, u_cube: 0, u_eye: s.cam.eye(), u_mode: params.mode, u_eta: params.eta, u_bias: params.bias, u_scale: params.obj === 2 ? 1.6 : 1 });
      s.meshes[params.obj].draw();
      gl.disable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    },
  });

  /* ---------------------------------------------------------------- */
  /* 6. Copy texture image                                             */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'copy-tex',
    title: 'Copy Texture Image',
    category: CAT,
    thumb: 'portrait',
    hint: 'paint with the pointer · try the kaleidoscope',
    description: 'A feedback loop with no framebuffer object. Each frame draws last frame\'s texture slightly zoomed, rotated and faded, paints the brush on top, then copies the drawing buffer back into the texture with copyTexSubImage2D. copyTexImage2D does the same but reallocates the texture every time. Because this canvas has no alpha channel, the texture must be RGB: copying RGBA from an RGB buffer is an error.',
    interact: [['Move / drag', 'paint'], ['Click', 'a burst of colour'], ['Mode', 'zooming trails or a mirrored kaleidoscope'], ['Copy with', 'copyTexSubImage2D into existing storage, or copyTexImage2D']],
    features: ['gl.copyTexSubImage2D(target, 0, x, y, sx, sy, w, h)', 'gl.copyTexImage2D(target, 0, fmt, x, y, w, h, 0)', 'drawing buffer → texture feedback', 'format must fit the buffer (RGB without alpha)', 'polar mirroring in the sampling pass'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Trails', 'Kaleidoscope'], value: 1 },
      { key: 'method', label: 'Copy with', type: 'select', options: ['copyTexSubImage2D', 'copyTexImage2D'], value: 0 },
      { key: 'decay', label: 'Persistence', type: 'range', min: 0.8, max: 0.995, step: 0.001, value: 0.965 },
      { key: 'zoom', label: 'Zoom per frame', type: 'range', min: -0.02, max: 0.03, step: 0.001, value: 0.006 },
      { key: 'spin', label: 'Rotation per frame', type: 'range', min: -0.03, max: 0.03, step: 0.001, value: 0.004 },
      { key: 'segs', label: 'Kaleidoscope segments', type: 'range', min: 2, max: 12, step: 1, value: 6 },
      { key: 'clear', label: 'Clear', type: 'button' },
    ],
    code: `// 1 draw last frame (transformed) + new paint to the canvas
drawFeedback(tex); drawBrush();
// 2 copy what was just drawn back into the texture
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
// or reallocate: copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0)`,
    init(ctx) {
      const { gl, util } = ctx;
      const alpha = !!(gl.getContextAttributes() || {}).alpha;
      const fmt = alpha ? gl.RGBA : gl.RGB;
      const fb = util.program(G.fullscreenVS, G.colors + `
uniform sampler2D u_prev; uniform float u_decay; uniform float u_zoom; uniform float u_spin; uniform float u_mode; uniform float u_segs; uniform float u_asp; uniform float u_t;
varying vec2 v_uv;
void main() {
  vec2 q = (v_uv - 0.5) * vec2(u_asp, 1.0);
  float c = cos(u_spin), s = sin(u_spin);
  q = mat2(c, s, -s, c) * q * (1.0 - u_zoom);
  if (u_mode > 0.5) {
    float r = length(q), a = atan(q.y, q.x);
    float seg = 6.2831853 / u_segs;
    a = mod(a, seg); a = min(a, seg - a);           // mirror inside each wedge
    q = vec2(cos(a), sin(a)) * r;
  }
  vec2 uv = q / vec2(u_asp, 1.0) + 0.5;
  vec3 p = texture2D(u_prev, uv).rgb;
  float edge = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  p = p * u_decay * edge;
  p = max(p - 0.0025, 0.0);
  gl_FragColor = vec4(p + INK * 0.25, 1.0);
}`);
      const brush = util.program(G.fullscreenVS, `
uniform vec2 u_a; uniform vec2 u_b; uniform float u_r; uniform vec3 u_col;
void main() {
  vec2 p = gl_FragCoord.xy, ab = u_b - u_a;
  float h = clamp(dot(p - u_a, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
  float d = length(p - u_a - ab * h);
  float core = smoothstep(u_r, u_r * 0.5, d), glow = exp(-d * d / (u_r * u_r * 5.0));
  gl_FragColor = vec4(u_col * (core * 0.7 + glow * 0.22), 1.0);
}`);
      const blit = util.program(G.fullscreenVS, `uniform sampler2D u_tex; varying vec2 v_uv; void main() { gl_FragColor = vec4(texture2D(u_tex, v_uv).rgb, 1.0); }`);
      const tex = util.rawTexture();
      const info = panel(ctx, 'ov-tr', '');
      const s = { fb, brush, blit, tex, fmt, alpha, info, w: 0, h: 0, last: null, hue: 0, bursts: [], ms: 0 };
      this.alloc(ctx, s);
      return s;
    },
    alloc(ctx, s) {
      const { gl } = ctx;
      s.w = ctx.width; s.h = ctx.height;
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, s.fmt, s.w, s.h, 0, s.fmt, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      s.cleared = true;
    },
    action(ctx, s, key) { if (key === 'clear') this.alloc(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      if (s.w !== ctx.width || s.h !== ctx.height) this.alloc(ctx, s);
      const W = s.w, H = s.h;
      const ghost = (tt) => [0.5 + 0.32 * Math.sin(tt * 1.7) * Math.cos(tt * 0.31), 0.5 + 0.3 * Math.sin(tt * 2.3 + 1.0)];
      const p = (input.hover && !ctx.capture) ? [input.x * ctx.dpr, H - input.y * ctx.dpr] : (() => { const g = ghost(t); return [g[0] * W, g[1] * H]; })();
      const prev = s.last || p;
      s.last = p.slice();
      for (const c of input.clicks) s.bursts.push({ x: c.x * ctx.dpr, y: H - c.y * ctx.dpr, t });
      if ((ctx.capture || !input.hover) && Math.floor(t / 0.9) !== s.autoBurst) { s.autoBurst = Math.floor(t / 0.9); s.bursts.push({ x: p[0], y: p[1], t }); }
      s.hue += dt * 0.35;
      gl.viewport(0, 0, W, H);
      // 1 · feedback
      util.tex(0, s.tex);
      if (s.cleared) { gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT); s.cleared = false; }
      else { s.fb.use().set({ u_prev: 0, u_decay: params.decay, u_zoom: params.zoom, u_spin: params.spin, u_mode: params.mode, u_segs: params.segs, u_asp: W / H, u_t: t }); util.drawFullscreen(); }
      // 2 · brush (additive)
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const k = (Math.sin(s.hue) * 0.5 + 0.5);
      const col = mix3(S.A1, S.A2, k);
      s.brush.use().set({ u_a: prev, u_b: p, u_r: (input.down ? 14 : 9) * ctx.dpr, u_col: col.map((v) => v * (input.down ? 0.9 : 0.6)) });
      util.drawFullscreen();
      s.bursts = s.bursts.filter((b) => t - b.t < 0.5);
      for (const b of s.bursts) { const a = (t - b.t) / 0.5; s.brush.set({ u_a: [b.x, b.y], u_b: [b.x, b.y], u_r: (6 + a * 40) * ctx.dpr, u_col: mix3(S.A2, S.A1, k).map((v) => v * (1 - a) * 0.3) }); util.drawFullscreen(); }
      gl.disable(gl.BLEND);
      // 3 · copy the drawing buffer into the texture
      const t0 = performance.now();
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      if (params.method === 0) gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
      else gl.copyTexImage2D(gl.TEXTURE_2D, 0, s.fmt, 0, 0, W, H, 0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      s.ms += (performance.now() - t0 - s.ms) * 0.1;
      ctx.canvas.style.cursor = 'crosshair';
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        s.info.innerHTML = `<b>${params.method ? 'copyTexImage2D' : 'copyTexSubImage2D'}</b><br>${W} × ${H} · ${s.alpha ? 'RGBA' : 'RGB'} (canvas alpha: ${s.alpha})<br>${params.method ? 'storage reallocated every frame' : 'writes into existing storage'}<br>${(W * H * (s.alpha ? 4 : 3) / 1048576).toFixed(1)} MB per copy`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 7. Pixel store flags                                              */
  /* ---------------------------------------------------------------- */
  // Minimal PNG writer (stored deflate blocks) so the colour-space test image can carry a gAMA chunk.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function pngWithGamma(w, h, rgb, gamma) {
    const raw = new Uint8Array(h * (1 + w * 3));
    for (let y = 0; y < h; y++) { raw[y * (1 + w * 3)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1); }
    const blocks = [];
    for (let o = 0; o < raw.length; o += 65535) {
      const n = Math.min(65535, raw.length - o), last = o + n >= raw.length;
      blocks.push(new Uint8Array([last ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255]), raw.subarray(o, o + n));
    }
    let a = 1, b = 0; for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
    const z = [new Uint8Array([0x78, 0x01]), ...blocks, new Uint8Array([b >> 8, b & 255, a >> 8, a & 255])];
    const cat = (arr) => { const n = arr.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let k = 0; for (const x of arr) { o.set(x, k); k += x.length; } return o; };
    const be = (v) => new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
    const chunk = (type, data) => { const td = cat([new TextEncoder().encode(type), data]); return cat([be(data.length), td, be(crc32(td))]); };
    const ihdr = cat([be(w), be(h), new Uint8Array([8, 2, 0, 0, 0])]);
    const png = cat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('gAMA', be(Math.round(gamma * 100000))), chunk('IDAT', cat(z)), chunk('IEND', new Uint8Array(0))]);
    let bin = ''; for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i]);
    return 'data:image/png;base64,' + btoa(bin);
  }
  S.register({
    id: 'pixel-store',
    title: 'Pixel Store Flags',
    category: CAT,
    thumb: 'tall',
    hint: 'hover a cell for a loupe · flip the flags',
    description: 'pixelStorei changes how bytes travel between JavaScript and the GPU. FLIP_Y turns DOM images the right way up for texture coordinates that start at the bottom. PREMULTIPLY_ALPHA decides whether filtering blends colours weighted by alpha; without it, transparent black bleeds in as a dark fringe. COLORSPACE_CONVERSION lets the browser apply an image\'s colour information, here a PNG gAMA chunk. UNPACK_ALIGNMENT and PACK_ALIGNMENT set the row padding assumed on upload and produced by readPixels.',
    interact: [['Hover', 'a 4× loupe inside the cell under the pointer'], ['Toggles', 'each re-uploads its texture with the new flag'], ['Read back', 'button in the PACK cell runs readPixels']],
    features: ['UNPACK_FLIP_Y_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'UNPACK_COLORSPACE_CONVERSION_WEBGL', 'UNPACK_ALIGNMENT (odd-width RGB)', 'PACK_ALIGNMENT + readPixels'],
    params: [
      { key: 'flip', label: 'UNPACK_FLIP_Y_WEBGL', type: 'toggle', value: true },
      { key: 'premul', label: 'UNPACK_PREMULTIPLY_ALPHA', type: 'toggle', value: false },
      { key: 'cs', label: 'COLORSPACE_CONVERSION', type: 'select', options: ['BROWSER_DEFAULT', 'NONE'], value: 0 },
      { key: 'ua', label: 'UNPACK_ALIGNMENT', type: 'select', options: ['1', '2', '4', '8'], value: 2 },
      { key: 'pa', label: 'PACK_ALIGNMENT', type: 'select', options: ['1', '2', '4', '8'], value: 3 },
    ],
    code: `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);          // 33 px × 3 B = 99 B rows
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 33, 24, 0, gl.RGB, gl.UNSIGNED_BYTE, u8);
gl.pixelStorei(gl.PACK_ALIGNMENT, 8);
gl.readPixels(x, y, 5, 3, gl.RGBA, gl.UNSIGNED_BYTE, out);`,
    init(ctx) {
      const { gl, util } = ctx;
      const s = { quad: unitQuad(util), ready: {} };
      s.prog = util.program(RECT_VS, G.colors + `
uniform sampler2D u_tex; uniform vec4 u_zoom; uniform float u_bg; uniform vec2 u_texel;
varying vec2 v_uv;
void main() {
  vec2 uv = mix(v_uv, u_zoom.xy + (v_uv - u_zoom.xy) / u_zoom.z, u_zoom.w);
  vec4 t = texture2D(u_tex, uv);
  if (u_bg > 0.5) {
    // bright background so a dark fringe is obvious
    vec3 bg = mix(vec3(0.93, 0.91, 0.88), vec3(0.75, 0.82, 0.86), v_uv.y);
    gl_FragColor = vec4(bg, 1.0);
    return;
  }
  gl_FragColor = t;
}`);
      // 0 · FLIP_Y source: sky on top, ground below, "TOP" text
      [s.flipC] = canvas2d(160, 120);
      { const g = s.flipC.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 120); gr.addColorStop(0, '#1b3a52'); gr.addColorStop(0.6, '#0c1018'); g.fillStyle = gr; g.fillRect(0, 0, 160, 120); g.fillStyle = '#07080a'; g.fillRect(0, 84, 160, 36); g.fillStyle = S.CSS.A2; g.beginPath(); g.arc(122, 30, 14, 0, 7); g.fill(); g.fillStyle = S.CSS.BONE; g.font = '600 22px "JetBrains Mono", monospace'; g.fillText('TOP ↑', 14, 34); g.fillStyle = S.CSS.A1; g.fillRect(14, 96, 100, 6); }
      // 1 · PREMULTIPLY source: anti-aliased shapes on transparent
      [s.preC] = canvas2d(32, 32);
      { const g = s.preC.getContext('2d'); g.clearRect(0, 0, 32, 32); g.strokeStyle = S.CSS.A1; g.lineWidth = 2.5; g.beginPath(); g.arc(16, 16, 9, 0, 7); g.stroke(); g.strokeStyle = S.CSS.A2; g.lineWidth = 1.6; g.beginPath(); g.moveTo(7, 25); g.lineTo(25, 7); g.stroke(); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(16, 16, 2.6, 0, 7); g.fill(); }
      // 2 · COLORSPACE: PNG with a gAMA chunk (gamma 1.0) vs the same bytes as a typed array
      const GW = 128, GH = 8, rgb = new Uint8Array(GW * GH * 3);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const v = Math.round(x / (GW - 1) * 255), i = (y * GW + x) * 3; rgb[i] = v; rgb[i + 1] = Math.round(v * 0.85); rgb[i + 2] = Math.round(v * 0.95); }
      s.csRaw = util.texture({ width: GW, height: GH, data: (() => { const o = new Uint8Array(GW * GH * 4); for (let i = 0; i < GW * GH; i++) { o[i * 4] = rgb[i * 3]; o[i * 4 + 1] = rgb[i * 3 + 1]; o[i * 4 + 2] = rgb[i * 3 + 2]; o[i * 4 + 3] = 255; } return o; })() });
      s.csImg = new Image();
      s.csImg.onload = () => {
        if (s.dead) return;
        s.ready.cs = true;
        // does this browser apply gAMA when decoding? compare a 2D-canvas decode with the raw bytes
        try { const [c, g] = canvas2d(GW, GH); g.drawImage(s.csImg, 0, 0); const d = g.getImageData(64, 4, 1, 1).data; s.csDecoded = d[0]; } catch (_) { s.csDecoded = -1; }
        this.uploadAll(ctx, s);
      };
      s.csImg.src = pngWithGamma(GW, GH, rgb, 1.0);
      s.csMid = rgb[(4 * GW + 64) * 3];
      // 3 · UNPACK_ALIGNMENT: tightly packed odd-width RGB (33 × 24 → 99-byte rows), buffer padded so every alignment uploads
      s.aw = 33; s.ah = 24;
      const tight = new Uint8Array(s.aw * s.ah * 3);
      for (let y = 0; y < s.ah; y++) for (let x = 0; x < s.aw; x++) {
        const i = (y * s.aw + x) * 3, dx = x - 16, dy = y - 11.5, r = Math.hypot(dx, dy * 1.2);
        const ring = r > 7 && r < 10, stripe = (x + y) % 8 < 2, axis = x === 16 || y === 12;
        const c = ring ? S.A2 : axis ? [0.93, 0.91, 0.88] : stripe ? S.A1 : [0.06, 0.07, 0.09];
        tight[i] = c[0] * 255; tight[i + 1] = c[1] * 255; tight[i + 2] = c[2] * 255;
      }
      s.alignData = new Uint8Array((s.ah - 1) * Math.ceil(s.aw * 3 / 8) * 8 + s.aw * 3);
      s.alignData.set(tight);
      s.tex = { flip: util.rawTexture(), pre: util.rawTexture(), cs: util.rawTexture(), align: util.rawTexture(), pack: util.rawTexture() };
      // 4 · PACK: a small source to read back (an FBO filled by upload) + a diagram canvas
      s.packSrc = util.texture({ width: 8, height: 4, data: (() => { const o = new Uint8Array(8 * 4 * 4); for (let i = 0; i < 32; i++) { const c = mix3(S.A1, S.A2, (i % 8) / 7); o[i * 4] = c[0] * 255 * (0.5 + (i >> 3) / 6); o[i * 4 + 1] = c[1] * 255 * (0.5 + (i >> 3) / 6); o[i * 4 + 2] = c[2] * 255; o[i * 4 + 3] = 255; } return o; })(), filter: gl.NEAREST });
      s.packFb = util.framebuffer([s.packSrc]);
      [s.packC, s.packG] = canvas2d(560, 150);
      s.read = null;
      const btnPanel = panel(ctx, 'ov-br', '<div style="margin-bottom:2px">PACK_ALIGNMENT readback</div>');
      const btns = el(btnPanel, 'div', 'ov-btns');
      const rb = el(btns, 'button', '', 'readPixels 5 × 3'); rb.type = 'button';
      rb.addEventListener('click', () => this.readBack(ctx, s));
      s.labels = ['UNPACK_FLIP_Y_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'UNPACK_COLORSPACE_CONVERSION', 'UNPACK_ALIGNMENT', 'PACK_ALIGNMENT · readPixels'].map((n) => { const L = el(ctx.overlay, 'div', 'ov-label'); L.dataset.name = n; L.style.lineHeight = '1.5'; return L; });
      this.uploadAll(ctx, s);
      return s;
    },
    readBack(ctx, s) {
      const { gl } = ctx;
      const al = [1, 2, 4, 8][ctx.params.pa];
      const w = 5, h = 3, stride = Math.ceil(w * 4 / al) * al;
      const out = new Uint8Array(stride * (h - 1) + w * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.packFb);
      gl.pixelStorei(gl.PACK_ALIGNMENT, al);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      s.read = { al, out };
      this.drawPack(ctx, s);
    },
    drawPack(ctx, s) {
      const { gl } = ctx;
      const g = s.packG, W = 560, H = 150, al = [1, 2, 4, 8][ctx.params.pa];
      const w = 5, h = 3, rowB = w * 4, stride = Math.ceil(rowB / al) * al;
      g.fillStyle = '#0b0c10'; g.fillRect(0, 0, W, H);
      const bw = Math.min(16, (W - 30) / stride);
      const data = s.read && s.read.al === al ? s.read.out : null;
      for (let r = 0; r < h; r++) for (let b = 0; b < stride; b++) {
        const x = 14 + b * bw, y = 22 + r * 38, pad = b >= rowB;
        if (pad && r === h - 1) continue; // the last row carries no padding
        const k = r * stride + b;
        if (pad) { g.fillStyle = 'rgba(255,79,163,0.35)'; g.fillRect(x, y, bw - 2, 28); g.strokeStyle = '#ff4fa3'; g.strokeRect(x + 0.5, y + 0.5, bw - 3, 27); continue; }
        if (data) { const px = r * stride + (b - (b % 4)); g.fillStyle = `rgb(${data[px]},${data[px + 1]},${data[px + 2]})`; g.fillRect(x, y, bw - 2, 28); g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y + 20, bw - 2, 8); g.fillStyle = '#ece9e2'; g.font = '500 7px "JetBrains Mono", monospace'; g.fillText(String(data[k]), x + 1, y + 27); }
        else { g.fillStyle = b % 4 === 3 ? 'rgba(236,233,226,0.35)' : 'rgba(56,214,232,' + (0.3 + 0.2 * (b % 4)) + ')'; g.fillRect(x, y, bw - 2, 28); }
      }
      g.fillStyle = 'rgba(236,233,226,0.8)'; g.font = '500 12px "JetBrains Mono", monospace';
      g.fillText(`row ${rowB} B → stride ${stride} B · buffer ≥ ${stride * (h - 1) + rowB} B${data ? ' · read ✓' : ''}`, 14, 14);
      gl.bindTexture(gl.TEXTURE_2D, s.tex.pack);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.packC);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.texParams(gl, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    texParams(gl, f) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
    uploadAll(ctx, s) {
      const { gl, params } = ctx;
      const P = gl.pixelStorei.bind(gl);
      // FLIP_Y
      gl.bindTexture(gl.TEXTURE_2D, s.tex.flip);
      P(gl.UNPACK_FLIP_Y_WEBGL, params.flip);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.flipC);
      P(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.texParams(gl, gl.LINEAR);
      // PREMULTIPLY
      gl.bindTexture(gl.TEXTURE_2D, s.tex.pre);
      P(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, params.premul);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.preC);
      P(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.texParams(gl, gl.LINEAR);
      // COLORSPACE
      if (s.ready.cs) {
        gl.bindTexture(gl.TEXTURE_2D, s.tex.cs);
        P(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, params.cs ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.csImg);
        P(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
        this.texParams(gl, gl.NEAREST);
      }
      P(gl.UNPACK_FLIP_Y_WEBGL, false);
      // ALIGNMENT: tight 99-byte rows read with the chosen row alignment
      gl.bindTexture(gl.TEXTURE_2D, s.tex.align);
      P(gl.UNPACK_ALIGNMENT, [1, 2, 4, 8][params.ua]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, s.aw, s.ah, 0, gl.RGB, gl.UNSIGNED_BYTE, s.alignData);
      P(gl.UNPACK_ALIGNMENT, 4);
      this.texParams(gl, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.drawPack(ctx, s);
    },
    onParam(ctx, s) { this.uploadAll(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const W = ctx.width, H = ctx.height, dpr = ctx.dpr;
      const top = 118 * dpr, bot = 72 * dpr, side = 18 * dpr, gap = 46 * dpr;
      const cw = (W - side * 2 - gap) / 2;
      const rowsH = H - top - bot - gap * 2;
      const rh = rowsH / 3;
      const cells = [
        [side, bot + 2 * (rh + gap), cw, rh], [side + cw + gap, bot + 2 * (rh + gap), cw, rh],
        [side, bot + rh + gap, cw, rh], [side + cw + gap, bot + rh + gap, cw, rh],
        [side, bot, W - side * 2 - 230 * dpr, rh],
      ];
      // fit content aspect inside each cell
      const asp = [160 / 120, 1, 128 / 8 / 3.2, 33 / 24, 560 / 150];
      const fitted = cells.map((c, i) => { let w = c[2], h = c[3]; if (w / h > asp[i]) w = h * asp[i]; else h = w / asp[i]; return [c[0] + (c[2] - w) / 2, c[1] + (c[3] - h) / 2, w, h]; });
      let px, py, hov = -1;
      if (input.hover && !ctx.capture) { px = input.x * dpr; py = H - input.y * dpr; }
      else { const f = fitted[3]; px = f[0] + f[2] * (0.4 + 0.15 * Math.sin(t * 0.7)); py = f[1] + f[3] * (0.5 + 0.15 * Math.cos(t * 0.5)); }
      hov = fitted.findIndex((r) => px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      s.prog.use().set({ u_tex: 0 });
      const zoomFor = (i) => { const r = fitted[i]; return i === hov ? [(px - r[0]) / r[2], (py - r[1]) / r[3], 4, 1] : i === 1 ? [0.5, 0.5, 1.4, 1] : [0.5, 0.5, 1, 0]; };
      const draw = (i, tex, bg) => { const r = fitted[i]; gl.bindTexture(gl.TEXTURE_2D, tex); s.prog.set({ u_rect: ndcRect(ctx, ...r), u_zoom: zoomFor(i), u_bg: bg ? 1 : 0 }); s.quad.draw(); };
      draw(0, s.tex.flip);
      // premultiply cell: bright background, then the texture blended to match the upload
      draw(1, s.tex.pre, true);
      gl.enable(gl.BLEND);
      if (params.premul) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      draw(1, s.tex.pre);
      gl.disable(gl.BLEND);
      // colour space cell: top half the image upload, bottom half the raw bytes
      { const r = fitted[2]; const half = [r[0], r[1] + r[3] * 0.53, r[2], r[3] * 0.47];
        if (s.ready.cs) { gl.bindTexture(gl.TEXTURE_2D, s.tex.cs); s.prog.set({ u_rect: ndcRect(ctx, ...half), u_zoom: [0.5, 0.5, 1, 0], u_bg: 0 }); s.quad.draw(); }
        gl.bindTexture(gl.TEXTURE_2D, s.csRaw); s.prog.set({ u_rect: ndcRect(ctx, r[0], r[1], r[2], r[3] * 0.47) }); s.quad.draw(); }
      draw(3, s.tex.align);
      draw(4, s.tex.pack);
      gl.bindTexture(gl.TEXTURE_2D, null);
      // labels
      const al = [1, 2, 4, 8][params.ua], stride = Math.ceil(s.aw * 3 / al) * al;
      const conv = s.csDecoded == null ? 'decoding…' : s.csDecoded < 0 ? '' : Math.abs(s.csDecoded - s.csMid) > 3 ? `gAMA ${params.cs ? 'ignored' : 'applied'} (mid ${s.csMid} → ${params.cs ? s.csMid : s.csDecoded})` : 'browser ignores gAMA';
      const pal = [1, 2, 4, 8][params.pa], pst = Math.ceil(20 / pal) * pal;
      const sub = [
        params.flip ? '<span class="on">true</span> · upright' : '<span class="off">false</span> · upside down',
        params.premul ? '<span class="on">true</span> · ONE, 1−SRC_ALPHA · clean edges' : '<span class="off">false</span> · SRC_ALPHA · dark fringes',
        `${params.cs ? 'NONE' : 'BROWSER_DEFAULT'} · ${conv}`,
        `${al} · ${stride} B rows for 99 B of data · ${stride === 99 ? '<span class="on">correct</span>' : '<span class="off">skewed</span>'}`,
        `${pal} · stride ${pst} B for 20 B rows${pst > 20 ? ' · <span class="off">4 B padding</span>' : ''}`,
      ];
      s.labels.forEach((L, i) => {
        const c = cells[i];
        L.innerHTML = `${L.dataset.name}<br><span style="opacity:.85;letter-spacing:.04em;text-transform:none">${sub[i]}</span>`;
        L.style.left = c[0] / dpr + 'px'; L.style.top = (H - c[1] - c[3]) / dpr - 36 + 'px';
        L.style.color = i === hov ? 'var(--acc1)' : '';
      });
      ctx.canvas.style.cursor = hov >= 0 ? 'zoom-in' : 'default';
    },
    dispose(ctx, s) { s.dead = true; s.csImg.onload = null; },
  });

  /* ---------------------------------------------------------------- */
  /* 8. Texture units & splatting                                      */
  /* ---------------------------------------------------------------- */
  const MATS = ['Moss', 'Rock', 'Clay', 'Snow'];
  S.register({
    id: 'multitexture',
    title: 'Texture Units & Splatting',
    category: CAT,
    thumb: 'wide',
    hint: 'drag to paint · right-drag to orbit',
    description: 'A terrain shaded from six texture units at once: four tiling materials, a splat map whose RGBA channels weight them, and a height map. The vertex shader reads the height map directly, which is vertex texture fetch; WebGL 1.0 allows MAX_VERTEX_TEXTURE_IMAGE_UNITS to be zero, and then the heights come from a vertex buffer computed on the CPU. Painting updates only the touched rectangle of the splat or height texture with texSubImage2D.',
    interact: [['Drag', 'paint the selected material, or raise / lower'], ['Right-drag / Shift-drag', 'orbit'], ['Wheel', 'zoom'], ['Brush', 'material or height tool']],
    features: ['activeTexture(TEXTURE0 + i) × 6', 'sampler2D in the vertex shader (VTF)', 'MAX_TEXTURE / COMBINED / VERTEX _IMAGE_UNITS', 'texSubImage2D brush updates', 'RGBA splat weights'],
    params: [
      { key: 'brush', label: 'Brush', type: 'select', options: ['Moss', 'Rock', 'Clay', 'Snow', 'Raise', 'Lower'], value: 2 },
      { key: 'size', label: 'Brush radius', type: 'range', min: 2, max: 20, step: 1, value: 8 },
      { key: 'strength', label: 'Strength', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.5 },
      { key: 'vtf', label: 'Use vertex texture fetch', type: 'toggle', value: true },
      { key: 'paint', label: 'Left-drag paints', type: 'toggle', value: true },
    ],
    code: `// vertex shader (VTF)
uniform sampler2D u_height;
float h = texture2D(u_height, a_uv).r;
// fragment: four materials weighted by the splat map
vec4 w = texture2D(u_splat, v_uv);
vec3 c = texture2D(u_moss, uv).rgb * w.r + texture2D(u_rock, uv).rgb * w.g
       + texture2D(u_clay, uv).rgb * w.b + texture2D(u_snow, uv).rgb * w.a;
gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, patch);`,
    init(ctx) {
      const { gl, util } = ctx;
      const maxTU = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), maxC = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS), maxV = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
      const HN = 128;
      // CPU height map (value-noise fbm)
      const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
      const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return lerp(lerp(rnd(xi, yi), rnd(xi + 1, yi), u), lerp(rnd(xi, yi + 1), rnd(xi + 1, yi + 1), u), v); };
      const height = new Float32Array(HN * HN);
      for (let y = 0; y < HN; y++) for (let x = 0; x < HN; x++) {
        let h = 0, a = 0.5, f = 3 / HN;
        for (let o = 0; o < 5; o++) { h += a * vn(x * f + 11, y * f + 7); a *= 0.5; f *= 2; }
        const r = Math.hypot(x / HN - 0.5, y / HN - 0.5);
        height[y * HN + x] = clamp(h * 1.25 - 0.18 + 0.25 * Math.exp(-r * r * 18) - r * 0.25, 0, 1);
      }
      const hbytes = new Uint8Array(HN * HN);
      for (let i = 0; i < hbytes.length; i++) hbytes[i] = height[i] * 255;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const hTex = util.texture({ width: HN, height: HN, data: hbytes, format: gl.LUMINANCE });
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      // splat map from height + slope
      const SN = 128;
      const splat = new Uint8Array(SN * SN * 4);
      const hAt = (x, y) => height[clamp(Math.round(y), 0, HN - 1) * HN + clamp(Math.round(x), 0, HN - 1)];
      for (let y = 0; y < SN; y++) for (let x = 0; x < SN; x++) {
        const h = hAt(x, y), sl = Math.hypot(hAt(x + 1, y) - hAt(x - 1, y), hAt(x, y + 1) - hAt(x, y - 1)) * 18;
        let w = [clamp(1 - h * 1.6, 0, 1), clamp(sl * 1.2 - 0.2, 0, 1), clamp(vn(x * 0.12, y * 0.12) * 1.8 - 1.0, 0, 1) * (1 - h), clamp((h - 0.55) * 4, 0, 1)];
        const sum = w[0] + w[1] + w[2] + w[3] || 1; w = w.map((v) => v / sum);
        splat.set(w.map((v) => v * 255), (y * SN + x) * 4);
      }
      const sTex = util.texture({ width: SN, height: SN, data: splat });
      // four material textures drawn with canvas 2D
      const matTex = MATS.map((m, k) => {
        const [c, g] = canvas2d(256, 256);
        const base = ['#1d5458', '#4a4e58', '#7a2d55', '#e8e6e0'][k];
        g.fillStyle = base; g.fillRect(0, 0, 256, 256);
        let seed = 13 + k * 101; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        if (k === 0) for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? 'rgba(56,214,232,0.3)' : 'rgba(10,30,30,0.35)'; g.beginPath(); g.arc(r() * 256, r() * 256, 2 + r() * 7, 0, 7); g.fill(); }
        if (k === 1) for (let i = 0; i < 70; i++) { g.strokeStyle = r() < 0.5 ? 'rgba(236,233,226,0.12)' : 'rgba(0,0,0,0.35)'; g.lineWidth = 1 + r() * 3; const y = r() * 256; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 6); g.stroke(); }
        if (k === 2) { for (let i = 0; i < 200; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,79,163,0.22)' : 'rgba(20,5,12,0.3)'; g.fillRect(r() * 256, r() * 256, 4 + r() * 16, 4 + r() * 16); } g.strokeStyle = 'rgba(15,4,10,0.6)'; g.lineWidth = 2; for (let i = 0; i < 24; i++) { g.beginPath(); let x = r() * 256, y = r() * 256; g.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); } }
        if (k === 3) for (let i = 0; i < 1400; i++) { g.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.5)' : 'rgba(150,170,190,0.25)'; g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2); }
        return util.texture({ source: c, mipmap: true, wrap: gl.REPEAT });
      });
      // grid mesh (uv only) + CPU height attribute for the fallback path
      const GN = 160, vc = (GN + 1) * (GN + 1);
      const uv = new Float32Array(vc * 2);
      for (let j = 0, k = 0; j <= GN; j++) for (let i = 0; i <= GN; i++, k++) { uv[k * 2] = i / GN; uv[k * 2 + 1] = j / GN; }
      const idx = new Uint16Array(GN * GN * 6);
      for (let j = 0, t = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const a = j * (GN + 1) + i; idx.set([a, a + GN + 1, a + 1, a + 1, a + GN + 1, a + GN + 2], t); t += 6; }
      const cpuH = new Float32Array(vc);
      const uvBuf = util.buffer(gl.ARRAY_BUFFER, uv), hBuf = util.buffer(gl.ARRAY_BUFFER, cpuH, gl.DYNAMIC_DRAW), iBuf = util.buffer(gl.ELEMENT_ARRAY_BUFFER, idx);
      const mesh = util.mesh([{ buffer: uvBuf, loc: 0, size: 2 }, { buffer: hBuf, loc: 4, size: 1 }], iBuf, { count: idx.length });
      const fs = G.colors + `
uniform sampler2D u_m0; uniform sampler2D u_m1; uniform sampler2D u_m2; uniform sampler2D u_m3; uniform sampler2D u_splat; uniform sampler2D u_hf;
uniform vec3 u_brush; uniform float u_hs; uniform vec3 u_eye;
varying vec2 v_uv; varying vec3 v_w;
void main() {
  float e = 1.0 / 128.0;
  float hl = texture2D(u_hf, v_uv - vec2(e, 0.0)).r, hr = texture2D(u_hf, v_uv + vec2(e, 0.0)).r;
  float hd = texture2D(u_hf, v_uv - vec2(0.0, e)).r, hu = texture2D(u_hf, v_uv + vec2(0.0, e)).r;
  vec3 n = normalize(vec3((hl - hr) * u_hs, 2.0 * 8.0 / 128.0, (hd - hu) * u_hs));
  vec4 w = texture2D(u_splat, v_uv);
  w /= max(w.r + w.g + w.b + w.a, 1e-3);
  vec2 uv = v_uv * 10.0;
  vec3 c = texture2D(u_m0, uv).rgb * w.r + texture2D(u_m1, uv).rgb * w.g + texture2D(u_m2, uv).rgb * w.b + texture2D(u_m3, uv).rgb * w.a;
  float l = 0.2 + 1.0 * max(dot(n, normalize(vec3(0.5, 0.8, 0.3))), 0.0);
  c *= l;
  c += A1 * pow(1.0 - max(dot(n, normalize(u_eye - v_w)), 0.0), 4.0) * 0.12;
  float d = length(v_w.xz - u_brush.xy);
  c = mix(c, A1, smoothstep(0.03, 0.0, abs(d - u_brush.z)) * 0.9);
  float fog = 1.0 - exp(-length(v_w - u_eye) * 0.05);
  gl_FragColor = vec4(mix(c, INK, fog * 0.6), 1.0);
}`;
      const vsVTF = `
attribute vec2 a_pos;
uniform mat4 u_vp; uniform sampler2D u_height; uniform float u_hs;
varying vec2 v_uv; varying vec3 v_w;
void main() { v_uv = a_pos; float h = texture2D(u_height, a_pos).r; v_w = vec3((a_pos.x - 0.5) * 8.0, h * u_hs, (0.5 - a_pos.y) * 8.0); gl_Position = u_vp * vec4(v_w, 1.0); }`;
      const vsCPU = `
attribute vec2 a_pos; attribute float a_i0;
uniform mat4 u_vp; uniform float u_hs;
varying vec2 v_uv; varying vec3 v_w;
void main() { v_uv = a_pos; v_w = vec3((a_pos.x - 0.5) * 8.0, a_i0 * u_hs, (0.5 - a_pos.y) * 8.0); gl_Position = u_vp * vec4(v_w, 1.0); }`;
      const progVTF = maxV > 0 ? util.program(vsVTF, fs) : null;
      const progCPU = util.program(vsCPU, fs);
      const info = panel(ctx, 'ov-tr', '');
      const s = { maxTU, maxC, maxV, HN, SN, height, hbytes, hTex, splat, sTex, matTex, mesh, progVTF, progCPU, cpuH, hBuf, GN, info, brush: [0, 0, 0], hs: 1.5, dirtyH: true,
        cam: new S.OrbitCam({ dist: 8.5, pitch: 0.62, yaw: 0.5, auto: 0.04, minDist: 3, maxDist: 16, target: [0, 0.4, 0] }) };
      if (ctx.capture) for (let k = 0; k < 14; k++) { const a = k * 0.45; this.paint(ctx, s, [Math.cos(a) * (1 + k * 0.12), Math.sin(a) * (1 + k * 0.12)], k % 3 === 0 ? 3 : 2, 7, 0.7); }
      return s;
    },
    hAt(s, x, z) {
      const u = (x / 8 + 0.5) * (s.HN - 1), v = (0.5 - z / 8) * (s.HN - 1);
      const xi = clamp(Math.floor(u), 0, s.HN - 2), yi = clamp(Math.floor(v), 0, s.HN - 2), fx = clamp(u - xi, 0, 1), fy = clamp(v - yi, 0, 1);
      const H = s.height, N = s.HN;
      return lerp(lerp(H[yi * N + xi], H[yi * N + xi + 1], fx), lerp(H[(yi + 1) * N + xi], H[(yi + 1) * N + xi + 1], fx), fy) * s.hs;
    },
    pick(ctx, s) {
      const r = s.cam.ray(ctx.input.nx, ctx.input.ny, ctx.aspect);
      let prev = 0;
      for (let t = 0.5; t < 30; t += 0.05) {
        const p = V3.add(r.origin, V3.scale(r.dir, t));
        if (Math.abs(p[0]) > 4.2 || Math.abs(p[2]) > 4.2) { if (p[1] < 0) return null; prev = t; continue; }
        if (p[1] < this.hAt(s, p[0], p[2])) {
          let a = prev, b = t;
          for (let k = 0; k < 8; k++) { const m = (a + b) / 2, q = V3.add(r.origin, V3.scale(r.dir, m)); if (q[1] < this.hAt(s, q[0], q[2])) b = m; else a = m; }
          const q = V3.add(r.origin, V3.scale(r.dir, b));
          return [q[0], q[2]];
        }
        prev = t;
      }
      return null;
    },
    paint(ctx, s, xz, tool, radius, strength) {
      const { gl } = ctx;
      if (tool <= 3) {
        const N = s.SN, cx = (xz[0] / 8 + 0.5) * N, cy = (0.5 - xz[1] / 8) * N;
        const x0 = clamp(Math.floor(cx - radius), 0, N - 1), x1 = clamp(Math.ceil(cx + radius), 0, N - 1), y0 = clamp(Math.floor(cy - radius), 0, N - 1), y1 = clamp(Math.ceil(cy + radius), 0, N - 1);
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, patch = new Uint8Array(bw * bh * 4);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cx, y - cy) / radius, i = (y * N + x) * 4;
          if (d < 1) {
            const f = (1 - d * d) * strength * 0.5;
            const w = [0, 1, 2, 3].map((k) => s.splat[i + k] / 255 * (1 - f) + (k === tool ? f : 0));
            for (let k = 0; k < 4; k++) s.splat[i + k] = Math.round(w[k] * 255);
          }
          patch.set(s.splat.subarray(i, i + 4), ((y - y0) * bw + (x - x0)) * 4);
        }
        gl.bindTexture(gl.TEXTURE_2D, s.sTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, patch);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else {
        const N = s.HN, cx = (xz[0] / 8 + 0.5) * N, cy = (0.5 - xz[1] / 8) * N, R = radius * N / s.SN;
        const x0 = clamp(Math.floor(cx - R), 0, N - 1), x1 = clamp(Math.ceil(cx + R), 0, N - 1), y0 = clamp(Math.floor(cy - R), 0, N - 1), y1 = clamp(Math.ceil(cy + R), 0, N - 1);
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, patch = new Uint8Array(bw * bh);
        const sign = tool === 4 ? 1 : -1;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cx, y - cy) / R, i = y * N + x;
          if (d < 1) { s.height[i] = clamp(s.height[i] + sign * (1 - d * d) * strength * 0.02, 0, 1); s.hbytes[i] = s.height[i] * 255; }
          patch[(y - y0) * bw + (x - x0)] = s.hbytes[i];
        }
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.bindTexture(gl.TEXTURE_2D, s.hTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, bw, bh, gl.LUMINANCE, gl.UNSIGNED_BYTE, patch);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        s.dirtyH = true;
      }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const orbiting = input.dragging && (!params.paint || input.shift || input.button === 2);
      s.cam.update(orbiting ? input : { ...input, dragging: false }, dt);
      let hit = null;
      if (input.hover && !ctx.capture) hit = this.pick(ctx, s);
      else { const a = t * 0.7; hit = [Math.cos(a) * 1.8, Math.sin(a * 1.3) * 1.4]; }
      const radius = params.size;
      if (hit) {
        s.brush = [hit[0], hit[1], radius / s.SN * 8];
        const painting = (input.down && params.paint && !orbiting && input.button !== 2) || ((ctx.capture || !input.hover) && Math.sin(t * 0.9) > 0.2);
        if (painting) this.paint(ctx, s, hit, (ctx.capture || !input.hover) ? (Math.floor(t / 3) % 2 ? 3 : 2) : params.brush, radius, params.strength);
      } else s.brush = [99, 99, 0];
      const useVTF = params.vtf && s.progVTF;
      if (!useVTF && s.dirtyH) {
        const N = s.HN, G2 = s.GN;
        for (let j = 0, k = 0; j <= G2; j++) for (let i = 0; i <= G2; i++, k++) s.cpuH[k] = s.height[Math.round(j / G2 * (N - 1)) * N + Math.round(i / G2 * (N - 1))];
        gl.bindBuffer(gl.ARRAY_BUFFER, s.hBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.cpuH);
        s.dirtyH = false;
      }
      if (useVTF) s.dirtyH = true;
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.matTex.forEach((tx, i) => util.tex(i, tx));
      util.tex(4, s.sTex); util.tex(5, s.hTex);
      const p = useVTF ? s.progVTF : s.progCPU;
      p.use().set({ u_vp: M4.mul(s.cam.proj(ctx.aspect), s.cam.view()), u_m0: 0, u_m1: 1, u_m2: 2, u_m3: 3, u_splat: 4, u_hf: 5, u_height: 5, u_hs: s.hs, u_brush: s.brush, u_eye: s.cam.eye() });
      s.mesh.draw();
      gl.disable(gl.DEPTH_TEST);
      ctx.canvas.style.cursor = orbiting ? 'grabbing' : hit ? 'crosshair' : 'grab';
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        s.info.innerHTML = `MAX_TEXTURE_IMAGE_UNITS <b>${s.maxTU}</b><br>MAX_COMBINED_TEXTURE_IMAGE_UNITS <b>${s.maxC}</b><br>MAX_VERTEX_TEXTURE_IMAGE_UNITS <b>${s.maxV}</b><br>units used <b>6</b> (4 materials, splat, height)<br>heights: ${useVTF ? '<span class="on">vertex texture fetch</span>' : `<span class="off">CPU buffer</span>${s.maxV ? '' : ' (no vertex units)'}`}<br>brush <b>${['Moss', 'Rock', 'Clay', 'Snow', 'Raise', 'Lower'][params.brush]}</b>`;
      }
    },
  });
})();
