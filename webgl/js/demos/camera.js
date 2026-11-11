/* Camera Mirror — live video as a texture. Sources: a synthetic canvas feed
 * (default, no permission needed), your webcam, or any image/video dropped on
 * the stage. Frames go into a 48-layer texture-array ring buffer with
 * copyTexSubImage3D for slit-scan time effects, and frame differencing drives
 * motion trails. */
(function () {
  const S = window.Sandbox;
  const HW = 320, HH = 180, HIST = 48;
  const EFFECTS = ['Motion', 'Time warp', 'Halftone', 'Edges'];

  const CAPTURE = `in vec2 v_uv; out vec4 o; uniform sampler2D u_src; uniform bool u_mirror; uniform vec2 u_fit;
void main() { vec2 uv = (v_uv - 0.5) * u_fit + 0.5; if (u_mirror) uv.x = 1.0 - uv.x; o = vec4(texture(u_src, uv).rgb, 1.0); }`;
  const MOTION = S.GLSL.colors + `
in vec2 v_uv; out vec4 o; uniform sampler2D u_cur; uniform sampler2D u_prev; uniform sampler2D u_trail; uniform float u_decay; uniform vec2 u_ptr; uniform float u_ptrOn; uniform float u_aspect;
void main() {
  float a = dot(texture(u_cur, v_uv).rgb, vec3(0.299, 0.587, 0.114));
  float b = dot(texture(u_prev, v_uv).rgb, vec3(0.299, 0.587, 0.114));
  float d = a - b;                                              // signed temporal difference
  vec3 add = (RED * smoothstep(0.04, 0.25, d) + BLUE * smoothstep(0.04, 0.25, -d)) * 0.6;
  vec2 q = (v_uv - u_ptr) * vec2(u_aspect, 1.0);
  add += mix(RED, BLUE, 0.5) * exp(-dot(q, q) * 900.0) * u_ptrOn;
  vec3 prev = texture(u_trail, v_uv + vec2(0.0, 0.0007)).rgb;   // trails drift upward like smoke
  o = vec4(max(prev * u_decay - 0.004, 0.0) + add, 1.0);
}`;
  const SHOW = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_cur; uniform sampler2D u_trail; uniform sampler2DArray u_hist; uniform int u_fx; uniform float u_head; uniform vec2 u_ptr; uniform vec2 u_res; uniform float u_amount;
vec2 fitUV(vec2 uv) {   // cover-fit 16:9 feed into the stage
  float sa = u_res.x / u_res.y, fa = ${HW}.0 / ${HH}.0;
  vec2 s = sa > fa ? vec2(1.0, fa / sa) : vec2(sa / fa, 1.0);
  return (uv - 0.5) * s + 0.5;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 uv = fitUV(v_uv);
  vec3 cur = texture(u_cur, uv).rgb;
  vec3 c;
  if (u_fx == 0) {
    float l = luma(cur);
    vec3 tr = texture(u_trail, uv).rgb;
    c = vec3(l) * 0.6 * vec3(0.9, 0.92, 1.0) * (1.0 - clamp(length(tr), 0.0, 0.6)) + tr;
  } else if (u_fx == 1) {
    vec2 q = (v_uv - u_ptr) * vec2(u_res.x / u_res.y, 1.0);
    float delay = clamp(length(q) * u_amount, 0.0, ${HIST - 1}.0);      // older frames further from the pointer
    float layer = mod(u_head - floor(delay) + ${HIST}.0, ${HIST}.0);
    c = texture(u_hist, vec3(uv, layer)).rgb;
    c = mix(c, c * mix(BLUE, RED, delay / ${HIST}.0) * 1.6, 0.35);
  } else if (u_fx == 2) {
    float cell = 7.0;
    mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
    vec2 p = R * gl_FragCoord.xy / cell;
    vec2 cuv = fitUV((transpose(R) * ((floor(p) + 0.5) * cell)) / u_res);   // cell centre back in screen space
    float l = luma(texture(u_cur, cuv).rgb);
    float d = length(fract(p) - 0.5);
    float dotm = smoothstep(0.02, -0.02, d - sqrt(l) * 0.55);
    c = mix(vec3(0.03), mix(BLUE, RED, l), dotm);
  } else {
    vec2 tx = 1.0 / vec2(${HW}.0, ${HH}.0);
    float gx = 0.0, gy = 0.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      float l = luma(texture(u_cur, uv + vec2(i, j) * tx).rgb);
      gx += l * float(i) * (j == 0 ? 2.0 : 1.0);
      gy += l * float(j) * (i == 0 ? 2.0 : 1.0);
    }
    float m = length(vec2(gx, gy));
    float ang = atan(gy, gx) / 6.2831853 + 0.5;
    c = mix(BLUE, RED, ang) * smoothstep(0.08, 0.6, m) * 1.5;
  }
  o = vec4(c, 1.0);
}`;

  function synthetic() {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    return {
      el: c, w: 640, h: 360,
      draw(t) {
        g.fillStyle = '#121318'; g.fillRect(0, 0, 640, 360);
        for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#1a1c22' : '#16171c'; g.fillRect(i * 72, 0, 72, 360); }
        // a "person": head + swaying arms
        const cx = 320 + Math.sin(t * 0.7) * 90, cy = 210;
        g.fillStyle = '#c9c4ba';
        g.beginPath(); g.arc(cx, cy - 95, 34, 0, Math.PI * 2); g.fill();
        g.fillRect(cx - 40, cy - 55, 80, 150);
        g.lineCap = 'round'; g.lineWidth = 22; g.strokeStyle = '#c9c4ba';
        const arm = (side, ph) => { const a = Math.sin(t * 2.2 + ph) * 1.1 - 0.4; g.beginPath(); g.moveTo(cx + side * 40, cy - 40); g.lineTo(cx + side * (40 + Math.cos(a) * 70), cy - 40 - Math.sin(a) * 70 * side * side); g.stroke(); };
        arm(1, 0); arm(-1, 1.7);
        for (let i = 0; i < 3; i++) {
          const x = (t * 140 + i * 230) % 760 - 60;
          g.fillStyle = i % 2 ? '#3b8bff' : '#ff3b4e';
          g.beginPath(); g.arc(x, 70 + i * 22, 14, 0, Math.PI * 2); g.fill();
        }
      },
    };
  }

  S.register({
    id: 'camera',
    title: 'Camera Mirror',
    category: 'Sensors & Media',
    hint: 'turn on your camera or drop an image / video onto the stage',
    description: 'Any video source can be a texture: a webcam via getUserMedia, a dropped image or video file, or the built-in canvas animation. Frames are uploaded only when a new one arrives (requestVideoFrameCallback) and copied into a 48-frame texture-array ring buffer with copyTexSubImage3D. Time warp then samples past frames by distance from the pointer, and Motion colours what got brighter red and what got darker blue.',
    interact: [['Use camera', 'Your webcam becomes the source (permission prompt)'], ['Drop a file', 'Any image or video dropped on the stage'], ['Move', 'Time warp radiates from the pointer; Motion paints with it'], ['Wave', 'In Motion mode, movement leaves trails']],
    features: ['texImage2D from HTMLVideoElement / Canvas / ImageBitmap', 'requestVideoFrameCallback', 'copyTexSubImage3D ring buffer', 'sampler2DArray time lookups', 'Frame differencing', 'Sobel edges'],
    params: [
      { key: 'fx', label: 'Effect', type: 'select', options: EFFECTS, value: 0 },
      { key: 'amount', label: 'Time-warp depth', type: 'range', min: 4, max: 140, step: 1, value: 60 },
      { key: 'decay', label: 'Trail persistence', type: 'range', min: 0.8, max: 0.995, step: 0.001, value: 0.92 },
      { key: 'mirror', label: 'Mirror', type: 'toggle', value: true },
      { key: 'cam', label: 'Use camera', type: 'button' },
      { key: 'synthetic', label: 'Synthetic feed', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const mk = () => util.texture({ width: HW, height: HH });
      const cur = [mk(), mk()], trail = [mk(), mk()];
      const hist = util.rawTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, hist);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, HW, HH, HIST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const srcTex = util.texture({ width: 2, height: 2 });
      const s = {
        cur, curFb: cur.map((t) => util.framebuffer([t])), trail, trailFb: trail.map((t) => util.framebuffer([t])), ci: 0, ti: 0,
        hist, head: 0, srcTex, srcW: 0, srcH: 0, fresh: true,
        capP: util.program(S.GLSL.fullscreenVS, CAPTURE), motP: util.program(S.GLSL.fullscreenVS, MOTION), showP: util.program(S.GLSL.fullscreenVS, SHOW),
        source: null, kind: 'synthetic', synth: synthetic(), stream: null,
      };
      s.source = s.synth;
      ctx.overlay.innerHTML = '<div class="ov-label" id="cm-src" style="left:34px;top:auto;bottom:64px;transform:none"></div><div id="cm-drop" style="position:absolute;inset:14px;border:1px dashed rgba(236,233,226,.5);display:none;place-items:center;font-family:var(--mono);font-size:12px;color:var(--text)">Drop to use as the source</div>';
      s.label = ctx.overlay.querySelector('#cm-src');
      const drop = ctx.overlay.querySelector('#cm-drop');
      const stage = ctx.canvas.parentElement;
      s.onOver = (e) => { e.preventDefault(); drop.style.display = 'grid'; };
      s.onLeave = () => { drop.style.display = 'none'; };
      s.onDrop = (e) => {
        e.preventDefault(); drop.style.display = 'none';
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        if (f.type.startsWith('video/')) {
          const v = document.createElement('video');
          v.src = URL.createObjectURL(f); v.loop = true; v.muted = true; v.playsInline = true; v.play();
          useVideo(s, v, 'Dropped video · ' + f.name);
        } else if (f.type.startsWith('image/')) {
          createImageBitmap(f).then((bmp) => { stopStream(s); s.source = { el: bmp, w: bmp.width, h: bmp.height, still: true }; s.kind = 'Dropped image · ' + f.name; s.fresh = true; });
        }
      };
      stage.addEventListener('dragover', s.onOver); stage.addEventListener('dragleave', s.onLeave); stage.addEventListener('drop', s.onDrop);
      s.stage = stage;
      return s;
    },
    action(ctx, s, key) {
      if (key === 'synthetic') { stopStream(s); s.source = s.synth; s.kind = 'synthetic'; }
      if (key === 'cam') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { ctx.message('Camera access needs HTTPS and a browser that supports getUserMedia.'); setTimeout(() => ctx.message(''), 2500); return; }
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false }).then((stream) => {
          const v = document.createElement('video');
          v.srcObject = stream; v.muted = true; v.playsInline = true; v.play();
          useVideo(s, v, 'Camera');
          s.stream = stream;
        }).catch(() => { ctx.message('Camera permission was declined.'); setTimeout(() => ctx.message(''), 2000); });
      }
    },
    dispose(ctx, s) {
      stopStream(s);
      s.stage.removeEventListener('dragover', s.onOver); s.stage.removeEventListener('dragleave', s.onLeave); s.stage.removeEventListener('drop', s.onDrop);
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const src = s.source;
      // ---- upload a new frame (only when one exists)
      if (src === s.synth) { src.draw(t); s.fresh = true; }
      const w = src.el.videoWidth || src.w, h = src.el.videoHeight || src.h;
      if (w && h && (s.fresh || (src.el.tagName === 'VIDEO' && !src.rvfc))) {
        gl.bindTexture(gl.TEXTURE_2D, s.srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        if (w !== s.srcW || h !== s.srcH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src.el); s.srcW = w; s.srcH = h; }
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.el);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        s.fresh = false;
      }
      if (s.srcW === 0) return;
      // ---- capture into the 320×180 working frame (cover-fit), ping-pong with previous
      const prev = s.ci, curI = 1 - s.ci;
      const fa = s.srcW / s.srcH, ta = HW / HH;
      const fit = fa > ta ? [ta / fa, 1] : [1, fa / ta];
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.curFb[curI]);
      gl.viewport(0, 0, HW, HH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.srcTex);
      s.capP.use().set({ u_src: 0, u_mirror: params.mirror && s.kind === 'Camera', u_fit: fit });
      ctx.util.drawFullscreen();
      // ---- push into the history ring: copy the bound framebuffer into one array layer
      s.head = (s.head + 1) % HIST;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.hist);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, s.head, 0, 0, HW, HH);
      s.ci = curI;
      // ---- motion trails
      const tdst = 1 - s.ti;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.trailFb[tdst]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.cur[curI]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.cur[prev]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, s.trail[s.ti]);
      s.motP.use().set({ u_cur: 0, u_prev: 1, u_trail: 2, u_decay: params.decay, u_ptr: [input.uvx, input.uvy], u_ptrOn: input.down ? 1 : input.hover ? 0.35 : 0, u_aspect: HW / HH });
      ctx.util.drawFullscreen();
      s.ti = tdst;
      // ---- show
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.trail[s.ti]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.hist);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.cur[s.ci]);
      const ptr = input.hover || input.down ? [input.uvx, input.uvy] : [0.5 + 0.3 * Math.sin(t * 0.6), 0.5];
      s.showP.use().set({ u_cur: 0, u_trail: 1, u_hist: 2, u_fx: params.fx, u_head: s.head, u_ptr: ptr, u_res: [ctx.width, ctx.height], u_amount: params.amount });
      ctx.util.drawFullscreen();
      s.label.textContent = 'source · ' + (s.kind === 'synthetic' ? 'synthetic canvas feed' : s.kind) + ' · drop an image or video to use it';
    },
  });

  function useVideo(s, v, label) {
    stopStream(s);
    const src = { el: v, w: 0, h: 0, rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype };
    if (src.rvfc) { const cb = () => { s.fresh = true; if (s.source === src) v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); }
    s.source = src; s.kind = label;
  }
  function stopStream(s) {
    if (s.stream) { s.stream.getTracks().forEach((tr) => tr.stop()); s.stream = null; }
    if (s.source && s.source.el && s.source.el.tagName === 'VIDEO') { s.source.el.pause(); }
  }
})();
