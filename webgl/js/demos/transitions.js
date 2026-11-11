/* Swipe Transitions — a carousel whose transition is driven directly by your
 * finger: drag scrubs the effect, release flings to the next slide with a
 * velocity-aware spring. Five GPU transition styles between poster layers. */
(function () {
  const S = window.Sandbox;
  const EFFECTS = ['Displace', 'Ripple', 'Slices', 'Pixels', 'Zoom blur'];

  const FS = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2DArray u_img; uniform float u_a; uniform float u_b; uniform float u_p; uniform int u_fx;
uniform vec2 u_res; uniform float u_aspectImg; uniform float u_time; uniform float u_dir;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
vec2 fit(vec2 uv) {   // contain-fit the portrait poster in the stage
  float sa = u_res.x / u_res.y;
  vec2 s = sa > u_aspectImg ? vec2(sa / u_aspectImg, 1.0) : vec2(1.0, u_aspectImg / sa);
  return (uv - 0.5) * s / 0.86 + 0.5;
}
vec3 img(vec2 uv, float layer, float lod) {
  vec2 f = fit(uv);
  vec3 bg = textureLod(u_img, vec3(clamp((uv - 0.5) * 0.6 + 0.5, 0.0, 1.0), layer), 6.0).rgb * 0.35;   // blurred backdrop from a deep mip
  if (any(lessThan(f, vec2(0.0))) || any(greaterThan(f, vec2(1.0)))) return bg;
  return textureLod(u_img, vec3(f, layer), lod).rgb;
}
void main() {
  vec2 uv = v_uv; float p = u_p;
  vec3 c;
  if (u_fx == 0) {
    float n = n2(uv * 6.0) * 0.6 + n2(uv * 14.0) * 0.4;
    vec2 off = vec2(u_dir * 0.35, 0.05) * (n - 0.3);
    vec3 A = img(uv + off * p, u_a, 0.0), B = img(uv - off * (1.0 - p), u_b, 0.0);
    c = mix(A, B, smoothstep(0.0, 1.0, p * 1.4 - (1.0 - n) * 0.4 + 0.2));
  } else if (u_fx == 1) {
    vec2 d = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    float r = length(d), R = p * 1.25;
    float w = exp(-pow((r - R) * 12.0, 2.0)) * (1.0 - p) * p * 4.0;
    vec2 q = uv + normalize(d + 1e-5) * w * 0.05;
    c = r < R ? img(q, u_b, 0.0) : img(q, u_a, 0.0);
    c += w * 0.15;
  } else if (u_fx == 2) {
    float N = 9.0, k = floor(uv.x * N);
    float pp = clamp(p * 1.7 - (u_dir > 0.0 ? k : N - 1.0 - k) / N * 0.7, 0.0, 1.0);
    pp = pp * pp * (3.0 - 2.0 * pp);
    float sgn = mod(k, 2.0) < 1.0 ? 1.0 : -1.0;
    vec2 qa = uv + vec2(0.0, sgn * pp), qb = uv + vec2(0.0, sgn * (pp - 1.0));
    c = (sgn * (uv.y + sgn * pp) < sgn * 1.0 && qa.y >= 0.0 && qa.y <= 1.0) ? img(qa, u_a, 0.0) : img(qb, u_b, 0.0);
  } else if (u_fx == 3) {
    float px = mix(1.0, 48.0, sin(p * 3.14159));
    vec2 cell = u_res / px;
    vec2 q = (floor(uv * cell) + 0.5) / cell;
    float t = step(h(floor(uv * cell)), p);
    c = mix(img(q, u_a, 0.0), img(q, u_b, 0.0), t);
  } else {
    float s = sin(p * 3.14159) * 0.25;
    vec3 A = vec3(0.0), B = vec3(0.0);
    for (int i = 0; i < 12; i++) { float k = float(i) / 11.0; vec2 q = (uv - 0.5) * (1.0 - s * k) + 0.5; A += img(q, u_a, 0.0); B += img(q, u_b, 0.0); }
    c = mix(A, B, smoothstep(0.3, 0.7, p)) / 12.0;
  }
  o = vec4(c, 1.0);
}`;

  S.register({
    id: 'transitions',
    title: 'Swipe Transitions',
    category: 'Animation',
    thumb: 'portrait',
    hint: 'swipe / drag sideways · arrows · wheel · click the dots',
    description: 'A carousel where your finger drives the transition. While you drag, the gesture scrubs the effect frame by frame, so you can hold it halfway. On release, flick velocity decides whether to advance and a spring settles the result. Five fragment-shader transitions (noise displacement, ripple wavefront, staggered slices, pixel dissolve, zoom blur) blend two layers of one texture array over a backdrop blurred by sampling a deep mip.',
    interact: [['Drag / swipe', 'Scrub the transition directly'], ['Release / flick', 'Velocity-aware spring to the next slide'], ['← → / wheel', 'Step slides'], ['Dots', 'Jump to a slide'], ['Autoplay', 'Advance every few seconds']],
    features: ['Gesture-scrubbed transitions', 'Velocity-aware snapping spring', 'sampler2DArray layer blending', 'textureLod blurred backdrop', '5 shader transition styles'],
    params: [
      { key: 'fx', label: 'Transition', type: 'select', options: EFFECTS, value: 0 },
      { key: 'auto', label: 'Autoplay', type: 'toggle', value: true },
      { key: 'stiff', label: 'Spring stiffness', type: 'range', min: 20, max: 300, step: 5, value: 90 },
    ],
    init(ctx) {
      const s = { prog: ctx.util.program(S.GLSL.fullscreenVS, FS), posters: S.posters(ctx), pos: 0, vel: 0, target: 0, dragV: 0, lastAuto: 0, dir: 1 };
      ctx.overlay.innerHTML = `<div id="tr-dots" style="position:absolute;left:50%;bottom:66px;transform:translateX(-50%);display:flex;gap:10px;pointer-events:auto">${S.POSTER_TITLES.map((_, i) => `<button data-i="${i}" aria-label="Slide ${i + 1}" style="width:26px;height:2px;padding:6px 0;background:none;border:0;cursor:pointer"><i style="display:block;height:2px;background:rgba(236,233,226,.3)"></i></button>`).join('')}</div>
        <div class="ov-label" id="tr-cap" style="left:34px;top:64px;transform:none"></div>`;
      s.dots = [...ctx.overlay.querySelectorAll('#tr-dots button')];
      s.dots.forEach((b) => b.addEventListener('click', () => { s.target = Math.round(s.pos) + (+b.dataset.i - ((Math.round(s.pos) % 6) + 6) % 6); s.lastAuto = ctx.time; }));
      s.cap = ctx.overlay.querySelector('#tr-cap');
      return s;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const h = Math.min(dt, 1 / 30);
      if (input.dragging) {
        const d = -input.dragDX / ctx.cssWidth * 1.2;
        s.pos += d; s.dragV = d / Math.max(dt, 1 / 120); s.vel = 0; s.target = s.pos; s.lastAuto = t;
        if (Math.abs(d) > 0) s.dir = Math.sign(d) || s.dir;
      } else {
        if (s.wasDragging) { s.target = Math.round(s.pos + Math.max(-1, Math.min(1, s.dragV * 0.25))); s.vel = s.dragV; }
        if (input.pressed.has('ArrowRight')) { s.target = Math.round(s.target) + 1; s.dir = 1; s.lastAuto = t; }
        if (input.pressed.has('ArrowLeft')) { s.target = Math.round(s.target) - 1; s.dir = -1; s.lastAuto = t; }
        if (Math.abs(input.wheel) > 20 && t - (s.lastWheel || 0) > 0.5) { s.target = Math.round(s.target) + Math.sign(input.wheel); s.dir = Math.sign(input.wheel); s.lastWheel = t; s.lastAuto = t; }
        if (params.auto && t - s.lastAuto > 3.5) { s.target = Math.round(s.target) + 1; s.dir = 1; s.lastAuto = t; }
        s.vel += ((s.target - s.pos) * params.stiff - s.vel * 2 * Math.sqrt(params.stiff)) * h;   // critically damped
        s.pos += s.vel * h;
      }
      s.wasDragging = input.dragging;
      const i = Math.floor(s.pos), p = s.pos - i;
      const a = ((i % 6) + 6) % 6, b = (a + 1) % 6;
      const cur = ((Math.round(s.pos) % 6) + 6) % 6;
      s.dots.forEach((d, k) => { d.firstChild.style.background = k === cur ? '#ff3b4e' : 'rgba(236,233,226,.3)'; });
      s.cap.textContent = `${String(cur + 1).padStart(2, '0')} / 06 · ${S.POSTER_TITLES[cur]} · ${EFFECTS[params.fx]}`;
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.posters.tex);
      s.prog.use().set({ u_img: 0, u_a: a, u_b: b, u_p: p, u_fx: params.fx, u_res: [ctx.width, ctx.height], u_aspectImg: s.posters.aspect, u_time: t, u_dir: s.dir });
      ctx.util.drawFullscreen();
    },
  });
})();
