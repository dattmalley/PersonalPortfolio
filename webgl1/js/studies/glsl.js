/* B · GLSL ES 1.00 — a live shader editor, uniforms / arrays / structs, varyings and
 * interpolation, built-in variables, derivatives, fragment depth and precision qualifiers. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, clamp, damp } = S.math;
  const G = S.GLSL;
  const CAT = 'GLSL ES 1.00';

  const el = (parent, tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent.appendChild(e); return e; };
  const panel = (ctx, pos, html) => el(ctx.overlay, 'div', 'ov-panel ' + pos, html);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const TYPE_NAMES = (gl) => {
    const m = {};
    ['FLOAT', 'FLOAT_VEC2', 'FLOAT_VEC3', 'FLOAT_VEC4', 'INT', 'INT_VEC2', 'INT_VEC3', 'INT_VEC4', 'BOOL', 'BOOL_VEC2', 'BOOL_VEC3', 'BOOL_VEC4', 'FLOAT_MAT2', 'FLOAT_MAT3', 'FLOAT_MAT4', 'SAMPLER_2D', 'SAMPLER_CUBE'].forEach((k) => { m[gl[k]] = k; });
    return m;
  };
  /** Smoothed pointer in drawing-buffer pixels, with a ghost path when idle / capturing. */
  function ghostPointer(ctx, s, t, dt, path) {
    const { input } = ctx;
    let tx, ty;
    if (input.hover && !ctx.capture) { tx = input.x * ctx.dpr; ty = ctx.height - input.y * ctx.dpr; }
    else { const g = path(t); tx = g[0] * ctx.width; ty = g[1] * ctx.height; }
    if (!s.ptr) s.ptr = [tx, ty];
    const k = damp(input.hover ? 14 : 3, dt);
    s.ptr[0] += (tx - s.ptr[0]) * k; s.ptr[1] += (ty - s.ptr[1]) * k;
    return s.ptr;
  }

  /* ---------------------------------------------------------------- */
  /* 1. Live shader editor                                             */
  /* ---------------------------------------------------------------- */
  const HEAD = `uniform float u_time;   // seconds
uniform vec2  u_res;    // drawing buffer, px
uniform vec2  u_mouse;  // pointer, px (y up)
uniform vec3  u_click;  // last click: x, y, time
varying vec2  v_uv;
`;
  const PRESETS = [
    ['Rings', HEAD + `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 m = (u_mouse - 0.5 * u_res) / u_res.y;
  vec2 q = p - m;
  float d = length(q), a = atan(q.y, q.x);
  float r = sin(d * 42.0 - u_time * 3.0 + sin(a * 6.0 + u_time) * 1.4);
  float k = u_time - u_click.z;
  float cd = length(gl_FragCoord.xy - u_click.xy) / u_res.y;
  float ring = exp(-abs(cd - k * 0.6) * 60.0) * exp(-k * 1.2);
  vec3 c = mix(vec3(0.22, 0.84, 0.91), vec3(1.0, 0.31, 0.64),
               0.5 + 0.5 * sin(a * 3.0 + d * 7.0 - u_time));
  c *= smoothstep(0.1, 1.0, r * 0.5 + 0.5) * exp(-d * 1.8);
  c += ring * vec3(0.93, 0.91, 0.89);
  gl_FragColor = vec4(c + vec3(0.027, 0.031, 0.047), 1.0);
}
`],
    ['Metaballs', HEAD + `
float map(vec3 p) {
  float d = 1e3;
  for (int i = 0; i < 5; i++) {
    float f = float(i);
    vec3 c = vec3(sin(u_time * 0.7 + f * 1.7),
                  cos(u_time * 0.9 + f * 2.3) * 0.6,
                  sin(u_time * 0.5 + f * 0.9) * 0.5) * 0.9;
    float s = length(p - c) - 0.36;
    float h = clamp(0.5 + 0.5 * (d - s) / 0.5, 0.0, 1.0);
    d = mix(d, s, h) - 0.5 * h * (1.0 - h);   // smooth union
  }
  return d;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 m = (u_mouse / u_res - 0.5) * vec2(5.0, 2.4);
  vec3 ro = vec3(sin(m.x) * 3.2, m.y, cos(m.x) * 3.2);
  vec3 fw = normalize(-ro), rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 rd = normalize(fw * 1.7 + rt * p.x + cross(rt, fw) * p.y);
  float t = 0.0, hit = 0.0, mind = 9.0;
  for (int i = 0; i < 72; i++) {
    float d = map(ro + rd * t);
    mind = min(mind, d);
    if (d < 0.002 * t) { hit = 1.0; break; }
    t += d;
    if (t > 8.0) break;
  }
  vec3 col = vec3(0.027, 0.031, 0.047) * (1.4 - length(p));
  col += vec3(0.22, 0.84, 0.91) * exp(-mind * 14.0) * 0.35;
  if (hit > 0.5) {
    vec3 q = ro + rd * t; vec2 e = vec2(0.003, 0.0);
    vec3 n = normalize(vec3(map(q + e.xyy) - map(q - e.xyy),
                            map(q + e.yxy) - map(q - e.yxy),
                            map(q + e.yyx) - map(q - e.yyx)));
    float dif = max(dot(n, normalize(vec3(0.6, 0.8, 0.4))), 0.0);
    float fr = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col = mix(vec3(0.22, 0.84, 0.91), vec3(1.0, 0.31, 0.64), n.y * 0.5 + 0.5)
        * (0.12 + 0.88 * dif) + fr * 0.5;
  }
  gl_FragColor = vec4(col, 1.0);
}
`],
    ['Domain warp', HEAD + `
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x),
             mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s;
}
void main() {
  vec2 p = gl_FragCoord.xy / u_res.y * 3.0;
  vec2 m = u_mouse / u_res.y * 3.0;
  vec2 q = vec2(fbm(p + u_time * 0.05), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 4.0 * q + m * 0.4), fbm(p + 4.0 * q + vec2(8.3, 2.8) - u_time * 0.07));
  float f = fbm(p + 4.0 * r);
  vec3 c = mix(vec3(0.027, 0.031, 0.047), vec3(0.22, 0.84, 0.91), clamp(f * f * 2.2, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.31, 0.64), clamp(length(q) * 0.7 - 0.25, 0.0, 1.0) * 0.8);
  c = mix(c, vec3(0.93, 0.91, 0.89), clamp(r.x * r.x * 1.4 - 0.4, 0.0, 1.0));
  gl_FragColor = vec4(c * (0.25 + 0.9 * f), 1.0);
}
`],
    ['Truchet', HEAD + `
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  vec2 m = u_mouse / u_res.y;
  vec2 p = gl_FragCoord.xy / u_res.y;
  float zoom = 9.0 + 5.0 * exp(-length(p - m) * 4.0);   // denser near the pointer
  vec2 g = p * zoom;
  vec2 id = floor(g), f = fract(g) - 0.5;
  if (h(id) > 0.5) f.x = -f.x;
  vec2 c1 = f - 0.5, c2 = f + 0.5;
  float d1 = abs(length(c1) - 0.5), d2 = abs(length(c2) - 0.5);
  float d = min(d1, d2);
  float a = d1 < d2 ? atan(c1.y, c1.x) : atan(c2.y, c2.x);
  float flow = sin(a * 4.0 * sign(h(id) - 0.5) + u_time * 3.0 + (id.x + id.y) * 1.57);
  float w = 0.09 + 0.04 * flow;
  float line = smoothstep(w, w - 3.0 * zoom / u_res.y, d);
  vec3 c = mix(vec3(0.22, 0.84, 0.91), vec3(1.0, 0.31, 0.64), 0.5 + 0.5 * flow);
  gl_FragColor = vec4(vec3(0.027, 0.031, 0.047) + c * line, 1.0);
}
`],
    ['Tunnel', HEAD + `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 m = (u_mouse - 0.5 * u_res) / u_res.y;
  p -= m * 0.35;                                   // steer the vanishing point
  float r = length(p), a = atan(p.y, p.x) / 6.28318;
  float z = 0.3 / r + u_time * 0.6;
  float tw = a + z * 0.08 + sin(u_time * 0.3) * 0.2;
  vec2 uv = vec2(tw * 12.0, z * 2.0);
  float chk = mod(floor(uv.x) + floor(uv.y), 2.0);
  vec2 f = abs(fract(uv) - 0.5);
  float edge = smoothstep(0.42, 0.5, max(f.x, f.y));
  vec3 c = mix(vec3(0.22, 0.84, 0.91), vec3(1.0, 0.31, 0.64), chk) * (0.35 + 0.65 * edge);
  c = mix(vec3(0.027, 0.031, 0.047), c, smoothstep(0.0, 0.35, r)) * min(1.0, r * 2.2);
  gl_FragColor = vec4(c, 1.0);
}
`],
  ];
  S.register({
    id: 'shader-editor',
    title: 'Live Shader Editor',
    category: CAT,
    thumb: 'wide',
    hint: 'type to recompile · click for a ripple',
    description: 'A fragment shader you can edit while it runs. Each pause in typing recompiles the source; if compilation fails the info log is shown and the last good program keeps running. Four uniforms are provided: time, resolution, pointer position and the last click. The presets cover the usual GLSL ES 1.00 patterns: polar coordinates, ray marching with constant loop bounds, value noise and tiling.',
    interact: [['Type', 'edit the shader; it recompiles about 300 ms after you stop'], ['Move', 'u_mouse follows the pointer'], ['Click', 'sets u_click (position and time)'], ['Presets', 'replace the source with an example']],
    features: ['gl.shaderSource + gl.compileShader', 'COMPILE_STATUS + getShaderInfoLog', 'gl.linkProgram + LINK_STATUS', 'uniform1f / uniform2f / uniform3f', 'keep the last good program on error'],
    captureKeys: true,
    params: [
      { key: 'preset', label: 'Preset', type: 'select', options: PRESETS.map((p) => p[0]), value: 1 },
      { key: 'scale', label: 'Resolution scale', type: 'range', min: 0.25, max: 1, step: 0.05, value: 0.6 },
      { key: 'revert', label: 'Revert to preset', type: 'button' },
    ],
    code: `gl.shaderSource(fs, src);
gl.compileShader(fs);
if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
  log.textContent = gl.getShaderInfoLog(fs);
  return;                  // keep the previous program
}
gl.attachShader(p, vs); gl.attachShader(p, fs);
gl.linkProgram(p);`,
    init(ctx) {
      const { util } = ctx;
      const ed = el(ctx.overlay, 'div', 'ov-editor');
      const btns = el(ed, 'div', 'ov-btns');
      btns.style.marginTop = '0';
      const ta = el(ed, 'textarea');
      ta.spellcheck = false; ta.setAttribute('autocomplete', 'off'); ta.setAttribute('autocapitalize', 'off');
      const log = el(ed, 'div', 'log ok', '');
      const s = { prog: null, ta, log, timer: 0, click: [0, 0, -10], btns: [], target: null, blit: null };
      const stop = (e) => e.stopPropagation();
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') {
          e.preventDefault();
          const a = ta.selectionStart, b = ta.selectionEnd;
          ta.value = ta.value.slice(0, a) + '  ' + ta.value.slice(b);
          ta.selectionStart = ta.selectionEnd = a + 2;
          schedule();
        }
      });
      ta.addEventListener('keyup', stop); ta.addEventListener('keypress', stop);
      ta.addEventListener('pointerdown', stop); ta.addEventListener('wheel', stop);
      const schedule = () => { clearTimeout(s.timer); s.timer = setTimeout(() => this.compile(ctx, s), 300); };
      ta.addEventListener('input', schedule);
      PRESETS.forEach((p, i) => {
        const b = el(btns, 'button', '', p[0]); b.type = 'button';
        b.addEventListener('click', () => { ctx.syncParam('preset', i); this.load(ctx, s, i); });
        s.btns.push(b);
      });
      s.blitProg = util.program(G.fullscreenVS, `uniform sampler2D u_tex; varying vec2 v_uv; void main() { gl_FragColor = texture2D(u_tex, v_uv); }`);
      this.load(ctx, s, ctx.params.preset);
      return s;
    },
    load(ctx, s, i) {
      s.ta.value = PRESETS[i][1].replace(/^\n/, '');
      s.btns.forEach((b, k) => b.classList.toggle('on', k === i));
      this.compile(ctx, s);
    },
    compile(ctx, s) {
      const src = s.ta.value;
      const t0 = performance.now();
      try {
        const p = ctx.util.program(G.fullscreenVS, src);
        if (s.prog) ctx.util.release(s.prog.prog);
        s.prog = p;
        const ms = performance.now() - t0;
        s.log.className = 'log ok';
        s.log.textContent = `compiled + linked in ${ms.toFixed(1)} ms · ${p.uniforms.length} active uniform${p.uniforms.length === 1 ? '' : 's'}: ${p.uniforms.map((u) => u.name).join(', ') || 'none'}`;
      } catch (err) {
        // core prepends one precision line (after any hoisted #extension lines): shift line numbers back.
        const raw = err.shaderLog || err.message || String(err);
        s.log.className = 'log';
        s.log.textContent = raw.trim().replace(/(ERROR|WARNING): 0:(\d+):/g, (m, k, n) => `${k} line ${Math.max(1, +n - 1)}:`) + (s.prog ? '\n· still running the last good program' : '');
      }
    },
    onParam(ctx, s, key, v) { if (key === 'preset') this.load(ctx, s, v); },
    action(ctx, s, key) { if (key === 'revert') this.load(ctx, s, ctx.params.preset); },
    frame(ctx, s, t, dt) {
      const { gl, input, util } = ctx;
      const sc = ctx.params.scale;
      const w = Math.max(16, Math.round(ctx.width * sc)), h = Math.max(16, Math.round(ctx.height * sc));
      if (!s.target || s.target.w !== w || s.target.h !== h) { if (s.target) util.release(s.target.fb, s.target.tex); s.target = util.target(w, h); }
      const m = ghostPointer(ctx, s, t, dt, (tt) => [0.62 + Math.cos(tt * 0.6) * 0.18, 0.5 + Math.sin(tt * 0.9) * 0.22]);
      for (const c of input.clicks) s.click = [c.x * ctx.dpr * sc, (ctx.height - c.y * ctx.dpr) * sc, t];
      if ((ctx.capture || !input.hover) && t - s.click[2] > 2.2) s.click = [m[0] * sc, m[1] * sc, t];
      util.bindTarget(s.target);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (s.prog) {
        s.prog.use().set({ u_time: t, u_res: [w, h], u_mouse: [m[0] * sc, m[1] * sc], u_click: s.click });
        util.drawFullscreen();
      }
      util.bindTarget(null, ctx.width, ctx.height);
      util.tex(0, s.target.tex);
      s.blitProg.use().set({ u_tex: 0 });
      util.drawFullscreen();
    },
    dispose(ctx, s) { clearTimeout(s.timer); },
  });

  /* ---------------------------------------------------------------- */
  /* 2. Uniforms, arrays & structs                                     */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'uniforms-structs',
    title: 'Uniforms, Arrays & Structs',
    category: CAT,
    thumb: 'square',
    hint: 'drag a light · watch the uniform table',
    description: 'Eight point lights live in a uniform array of structs. WebGL has no way to upload a struct in one call: every member of every element is its own uniform, located by a name such as u_lights[3].pos. The table lists exactly what getActiveUniform reports after linking, alongside a mat2 that rotates the tiles, a mat3 colour matrix, a bool and an ivec2.',
    interact: [['Drag', 'move a light (its u_lights[i].pos)'], ['Count', 'how many lights the loop reads before break'], ['Sliders', 'drive the mat2, mat3, bool and ivec2 uniforms']],
    features: ['struct + uniform Light u_lights[8]', "getUniformLocation(p, 'u_lights[i].pos')", 'getActiveUniform → name, type, size', 'uniformMatrix2fv / uniformMatrix3fv', 'uniform1i (bool) · uniform2iv (ivec2)'],
    params: [
      { key: 'count', label: 'Active lights (u_count)', type: 'range', min: 1, max: 8, step: 1, value: 6 },
      { key: 'intensity', label: 'Intensity', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1.3 },
      { key: 'radius', label: 'Light radius', type: 'range', min: 0.1, max: 1.2, step: 0.01, value: 0.5 },
      { key: 'rot', label: 'Tile rotation (mat2)', type: 'range', min: 0, max: 90, step: 1, value: 18 },
      { key: 'sat', label: 'Saturation (mat3)', type: 'range', min: 0, max: 1.6, step: 0.05, value: 1 },
      { key: 'cells', label: 'Cells (ivec2)', type: 'range', min: 3, max: 24, step: 1, value: 10 },
      { key: 'grout', label: 'Grout (bool)', type: 'toggle', value: true },
    ],
    code: `struct Light { vec3 pos; vec3 col; float radius; };
uniform Light u_lights[8];
// one location per member per element
for (let i = 0; i < 8; i++) {
  const loc = gl.getUniformLocation(p, 'u_lights[' + i + '].pos');
  gl.uniform3fv(loc, lights[i].pos);
}`,
    init(ctx) {
      const { gl, util } = ctx;
      const prog = util.program(G.fullscreenVS, G.colors + G.noise + `
struct Light { vec3 pos; vec3 col; float radius; };
uniform Light u_lights[8];
uniform int u_count;
uniform float u_intensity;
uniform mat2 u_rot;
uniform mat3 u_grade;
uniform bool u_grout;
uniform ivec2 u_cells;
uniform float u_asp;
uniform int u_sel;
varying vec2 v_uv;
float height(vec2 p) {
  vec2 g = (u_rot * p) * vec2(u_cells);
  vec2 id = floor(g), f = fract(g) - 0.5;
  float e = u_grout ? 4.0 : 18.0;
  float h = (1.0 - pow(abs(f.x) * 2.0, e)) * (1.0 - pow(abs(f.y) * 2.0, e));
  return h * (0.55 + 0.45 * hash12(id)) + 0.02 * vnoise(p * 60.0);
}
void main() {
  vec2 p = (v_uv - 0.5) * vec2(u_asp, 1.0);
  float h = height(p);
  vec2 e = vec2(0.0015, 0.0);
  vec3 n = normalize(vec3(height(p - e.xy) - height(p + e.xy), height(p - e.yx) - height(p + e.yx), 0.06));
  vec3 P = vec3(p, h * 0.03);
  vec3 col = vec3(0.012, 0.014, 0.02) * (0.6 + h);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= u_count) break;
    Light L = u_lights[i];
    vec3 d = L.pos - P;
    float dist = length(d);
    float att = pow(clamp(1.0 - dist / L.radius, 0.0, 1.0), 2.0);
    vec3 l = d / dist;
    float dif = max(dot(n, l), 0.0);
    float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
    col += L.col * (dif * 0.9 + spec * 0.8) * att * u_intensity;
    float r = length(p - L.pos.xy);
    glow += L.col * (exp(-r * r * 9000.0) * 1.2 + exp(-r * r * 300.0) * 0.08) + (i == u_sel ? BONE * smoothstep(0.004, 0.0, abs(r - 0.028)) : vec3(0.0));
  }
  col = u_grade * col + glow;
  vec2 q = v_uv - 0.5;
  col *= 1.0 - dot(q, q) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`);
      // Locate every struct member explicitly, the way WebGL exposes them.
      const locs = [];
      for (let i = 0; i < 8; i++) locs.push({ pos: gl.getUniformLocation(prog.prog, `u_lights[${i}].pos`), col: gl.getUniformLocation(prog.prog, `u_lights[${i}].col`), radius: gl.getUniformLocation(prog.prog, `u_lights[${i}].radius`) });
      const names = TYPE_NAMES(gl);
      const n = gl.getProgramParameter(prog.prog, gl.ACTIVE_UNIFORMS);
      const rows = [];
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog.prog, i); rows.push(u); }
      const info = panel(ctx, 'ov-tr', '');
      info.style.maxHeight = 'min(52%, calc(100% - 150px))'; info.style.overflow = 'auto'; info.style.fontSize = '10.5px';
      info.innerHTML = `ACTIVE_UNIFORMS <b>${n}</b><table style="border-collapse:collapse;margin-top:6px">${rows.map((u, i) => `<tr data-i="${i}"><td style="padding:0 10px 0 0">${esc(u.name)}</td><td style="padding:0 10px 0 0;opacity:.7">${names[u.type] || u.type}</td><td>${u.size}</td></tr>`).join('')}</table>`;
      const trs = [...info.querySelectorAll('tr')];
      const cols = [S.A1, S.A2, [0.93, 0.91, 0.88], [0.55, 0.62, 1.0], [0.3, 0.95, 0.75], [1.0, 0.6, 0.35], [0.8, 0.4, 1.0], [1.0, 0.85, 0.5]];
      const lights = cols.map((c, i) => { const a = (i / 8) * Math.PI * 2 + 0.3; return { anchor: [Math.cos(a) * 0.32 * (i % 2 ? 0.55 : 1), Math.sin(a) * 0.3 * (i % 2 ? 0.55 : 1)], pos: [0, 0, 0.06], col: c, phase: i * 1.3 }; });
      const tags = lights.map((_, i) => el(ctx.overlay, 'div', 'ov-label', `[${i}]`));
      return { prog, locs, lights, tags, trs, rows, info, drag: -1, sel: -1 };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const asp = ctx.aspect;
      const wp = [(input.uvx - 0.5) * asp, input.uvy - 0.5];
      s.lights.forEach((L, i) => {
        if (i === s.drag) return;
        const r = 0.04 + 0.02 * Math.sin(t * 0.3 + i);
        L.pos[0] = L.anchor[0] + Math.cos(t * 0.5 + L.phase) * r;
        L.pos[1] = L.anchor[1] + Math.sin(t * 0.63 + L.phase) * r;
      });
      let hoverI = -1;
      if (input.hover) { let best = 0.05; s.lights.forEach((L, i) => { if (i >= params.count) return; const d = Math.hypot(L.pos[0] - wp[0], L.pos[1] - wp[1]); if (d < best) { best = d; hoverI = i; } }); }
      if (input.down && s.drag < 0) s.drag = hoverI;
      if (!input.down) s.drag = -1;
      if (s.drag >= 0) { const L = s.lights[s.drag]; L.anchor = [clamp(wp[0], -asp / 2, asp / 2), clamp(wp[1], -0.5, 0.5)]; L.pos[0] = L.anchor[0]; L.pos[1] = L.anchor[1]; }
      const sel = s.drag >= 0 ? s.drag : hoverI;
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.prog.use();
      s.lights.forEach((L, i) => {
        gl.uniform3fv(s.locs[i].pos, L.pos);
        gl.uniform3fv(s.locs[i].col, L.col);
        gl.uniform1f(s.locs[i].radius, params.radius * (0.8 + 0.2 * Math.sin(t * 1.7 + i)));
      });
      const a = (params.rot * Math.PI) / 180 + Math.sin(t * 0.1) * 0.03, c = Math.cos(a), sn = Math.sin(a);
      const k = params.sat, lr = 0.2126, lg = 0.7152, lb = 0.0722;
      const grade = new Float32Array([
        lr * (1 - k) + k, lr * (1 - k), lr * (1 - k),
        lg * (1 - k), lg * (1 - k) + k, lg * (1 - k),
        lb * (1 - k), lb * (1 - k), lb * (1 - k) + k,
      ]);
      s.prog.set({ u_count: params.count, u_intensity: params.intensity, u_rot: new Float32Array([c, sn, -sn, c]), u_grade: grade, u_grout: params.grout ? 1 : 0, u_cells: new Int32Array([params.cells, params.cells]), u_asp: asp, u_sel: sel });
      ctx.util.drawFullscreen();
      s.lights.forEach((L, i) => {
        const tg = s.tags[i];
        tg.style.display = i < params.count ? '' : 'none';
        tg.style.left = ((L.pos[0] / asp + 0.5) * ctx.cssWidth + 12) + 'px';
        tg.style.top = ((0.5 - L.pos[1]) * ctx.cssHeight - 16) + 'px';
        tg.style.color = i === sel ? 'var(--acc1)' : '';
      });
      if (sel !== s.sel) {
        s.sel = sel;
        let first = null;
        s.trs.forEach((tr, i) => { const on = sel >= 0 && s.rows[i].name.startsWith(`u_lights[${sel}]`); tr.style.color = on ? 'var(--acc1)' : ''; if (on && !first) first = tr; });
        if (first) s.info.scrollTop = first.offsetTop - 40;
      }
      ctx.canvas.style.cursor = s.drag >= 0 ? 'grabbing' : hoverI >= 0 ? 'grab' : 'default';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 3. Varyings & interpolation                                       */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'varyings',
    title: 'Varyings & Interpolation',
    category: CAT,
    thumb: 'tall',
    hint: 'move to tilt · compare the halves',
    description: 'Varyings are interpolated across each triangle with perspective correction: the GPU interpolates value/w and 1/w in screen space and divides per fragment. Multiplying a varying by w in the vertex shader and dividing by the interpolated w in the fragment shader undoes the correction, giving the affine mapping of early consoles. The texture bends along each triangle diagonal until the plane is subdivided finely. GLSL ES 1.00 has no flat qualifier, so flat shading is emulated by giving all three vertices of a triangle the same value.',
    interact: [['Move', 'tilts the plane'], ['View', 'split, either interpolation alone, or their difference'], ['Subdivision', 'more triangles hide the affine error']],
    features: ['varying (perspective-correct by default)', 'affine emulation: v·w, then ÷ w per fragment', 'MAX_VARYING_VECTORS', 'flat shading via duplicated vertices', 'barycentric wireframe varying'],
    params: [
      { key: 'view', label: 'View', type: 'select', options: ['Split', 'Perspective', 'Affine', 'Difference'], value: 0 },
      { key: 'shade', label: 'Varying shown', type: 'select', options: ['Texture', 'Smooth colour', 'Flat colour'], value: 0 },
      { key: 'subdiv', label: 'Subdivision', type: 'range', min: 1, max: 16, step: 1, value: 1, restart: true },
      { key: 'wire', label: 'Triangle edges', type: 'toggle', value: true },
    ],
    code: `// vertex: pre-multiply by w to cancel the GPU's correction
v_uv  = a_uv;                                  // perspective-correct
v_uvw = vec3(a_uv * gl_Position.w, gl_Position.w);
// fragment
vec2 affine = v_uvw.xy / v_uvw.z;              // screen-linear`,
    init(ctx) {
      const { gl, util, params } = ctx;
      const n = params.subdiv;
      const verts = [];
      const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      const smoothCol = (u, v) => lerp3(lerp3(S.A1, S.A2, u), [0.93, 0.91, 0.88], v * v * 0.6);
      let tri = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const c = [[i / n, j / n], [(i + 1) / n, j / n], [(i + 1) / n, (j + 1) / n], [i / n, (j + 1) / n]];
        for (const T of [[0, 1, 2], [0, 2, 3]]) {
          const fk = ((tri * 7) % 5) / 4;
          const flat = lerp3(S.A1, S.A2, fk).map((x) => x * (0.55 + 0.45 * ((tri * 3) % 4) / 3));
          T.forEach((vi, b) => {
            const [u, v] = c[vi];
            const sc = smoothCol(u, v);
            verts.push(u * 2 - 1, 0, 1 - v * 2, u, v, ...flat, ...sc, b === 0 ? 1 : 0, b === 1 ? 1 : 0, b === 2 ? 1 : 0);
          });
          tri++;
        }
      }
      const data = new Float32Array(verts), F = 4, stride = 14 * F;
      const buf = util.buffer(gl.ARRAY_BUFFER, data);
      const mesh = util.mesh([
        { buffer: buf, loc: 0, size: 3, stride, offset: 0 },
        { buffer: buf, loc: 2, size: 2, stride, offset: 3 * F },
        { buffer: buf, loc: 3, size: 3, stride, offset: 5 * F },
        { buffer: buf, loc: 4, size: 3, stride, offset: 8 * F },
        { buffer: buf, loc: 5, size: 3, stride, offset: 11 * F },
      ], null, { count: data.length / 14 });
      const deriv = !!util.ext('OES_standard_derivatives');
      const prog = util.program(`
attribute vec3 a_pos; attribute vec2 a_uv; attribute vec3 a_col; attribute vec3 a_i0; attribute vec3 a_i1;
uniform mat4 u_mvp; uniform float u_flat;
varying vec2 v_uv; varying vec3 v_uvw; varying vec3 v_col; varying vec3 v_bary;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_uv = a_uv;
  v_uvw = vec3(a_uv * gl_Position.w, gl_Position.w);
  v_col = mix(a_i0, a_col, u_flat);
  v_bary = a_i1;
}`, (deriv ? '#extension GL_OES_standard_derivatives : enable\n' : '') + G.colors + `
uniform sampler2D u_tex; uniform float u_mode; uniform float u_shade; uniform float u_wire;
varying vec2 v_uv; varying vec3 v_uvw; varying vec3 v_col; varying vec3 v_bary;
vec3 look(vec2 uv) {
  vec3 t = texture2D(u_tex, uv * 2.0).rgb;
  float chk = mod(floor(uv.x * 16.0) + floor(uv.y * 16.0), 2.0);
  return t * (0.8 + 0.2 * chk);
}
void main() {
  vec2 aff = v_uvw.xy / v_uvw.z;
  vec2 uv = u_mode > 0.5 ? aff : v_uv;
  vec3 c = u_shade < 0.5 ? look(uv) : v_col * (0.35 + 0.65 * texture2D(u_tex, uv * 2.0).g);
  if (u_mode > 1.5) {
    float d = length(v_uv - aff) * 18.0;
    c = mix(INK * 2.0, mix(A1, A2, clamp(d * 0.5, 0.0, 1.0)), clamp(d, 0.0, 1.0)) + look(v_uv) * 0.12;
  }
  float m = min(v_bary.x, min(v_bary.y, v_bary.z));
#ifdef GL_OES_standard_derivatives
  float e = 1.0 - smoothstep(0.0, fwidth(m) * 1.5, m);
#else
  float e = 1.0 - smoothstep(0.0, 0.02, m);
#endif
  c = mix(c, BONE, e * u_wire * 0.85);
  gl_FragColor = vec4(c, 1.0);
}`);
      const tex = util.texture({ source: S.testCanvas(512, 'uv'), mipmap: true, wrap: gl.REPEAT });
      const maxV = gl.getParameter(gl.MAX_VARYING_VECTORS);
      const info = panel(ctx, 'ov-tr', `MAX_VARYING_VECTORS <b>${maxV}</b><br>this program: <b>4</b> (v_uv, v_uvw, v_col, v_bary)<br>triangles <b>${n * n * 2}</b>`);
      const labs = [el(ctx.overlay, 'div', 'ov-label', 'perspective-correct'), el(ctx.overlay, 'div', 'ov-label', 'affine · uv·w ÷ w')];
      return { prog, mesh, tex, info, labs, tilt: [0.62, 0.35] };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const ty = input.hover ? 0.3 + input.uvy * 0.95 : 0.62 + Math.sin(t * 0.4) * 0.16;
      const tx = input.hover ? (input.uvx - 0.5) * 1.6 : Math.sin(t * 0.27) * 0.6 + 0.2;
      s.tilt[0] += (ty - s.tilt[0]) * damp(5, dt); s.tilt[1] += (tx - s.tilt[1]) * damp(5, dt);
      const W = ctx.width, H = ctx.height;
      const split = params.view === 0;
      const horiz = W >= H;
      const views = split ? (horiz ? [[0, 0, W >> 1, H, 0], [W >> 1, 0, W - (W >> 1), H, 1]] : [[0, H >> 1, W, H - (H >> 1), 0], [0, 0, W, H >> 1, 1]]) : [[0, 0, W, H, params.view - 1]];
      gl.enable(gl.SCISSOR_TEST); gl.enable(gl.DEPTH_TEST);
      ctx.util.tex(0, s.tex);
      s.prog.use().set({ u_tex: 0, u_flat: params.shade === 2 ? 1 : 0, u_shade: params.shade ? 1 : 0, u_wire: params.wire ? 1 : 0 });
      views.forEach(([x, y, w, h, mode], vi) => {
        gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
        const g = vi ? 0.036 : 0.027;
        gl.clearColor(g, g + 0.004, g + 0.016, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const fit = Math.min(1, (w / h) / 1.1);
        const mvp = M4.mul(M4.persp(1.1, w / h, 0.05, 20), M4.mul(M4.lookAt([0, 0, 2.0], [0, 0, 0]), M4.mul(M4.rotX(s.tilt[0]), M4.mul(M4.rotY(s.tilt[1]), M4.scale(1.55 * fit)))));
        s.prog.set({ u_mvp: mvp, u_mode: mode });
        s.mesh.draw();
      });
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
      // labels
      const names = ['perspective-correct', 'affine · uv·w ÷ w', 'difference |persp − affine|'];
      s.labs.forEach((L, i) => {
        const v = views[i];
        L.style.display = v ? '' : 'none';
        if (!v) return;
        L.textContent = names[v[4]];
        L.style.left = v[0] / ctx.dpr + 14 + 'px';
        L.style.top = (H - v[1] - v[3]) / ctx.dpr + ((v[1] + v[3] >= H - 1) ? 54 : 14) + 'px';
        L.style.color = v[4] === 1 ? 'var(--acc2)' : v[4] === 0 ? 'var(--acc1)' : '';
      });
    },
  });

  /* ---------------------------------------------------------------- */
  /* 4. Built-in variables                                             */
  /* ---------------------------------------------------------------- */
  const BMODES = ['gl_FragCoord', 'gl_FrontFacing', 'gl_PointCoord', 'gl_Position.w', 'gl_FragColor'];
  S.register({
    id: 'builtins',
    title: 'Built-in Variables',
    category: CAT,
    thumb: 'portrait',
    hint: 'pick a built-in · move the pointer',
    description: 'The special variables GLSL ES 1.00 provides, one per view. gl_FragCoord gives window coordinates at pixel centres (x.5), so patterns centred on the pointer can be exact to the pixel. gl_FrontFacing tells the two sides of a Möbius strip apart, gl_PointCoord spans each point sprite with its origin at the top left, and gl_Position.w is the view depth that drives the perspective divide. gl_FragColor is clamped and quantised when it lands in an 8-bit buffer; the readout compares the value written with the value stored.',
    interact: [['Built-in', 'choose the variable to visualise'], ['Move', 'centres patterns, swells points, probes the buffer'], ['Drag', 'rotates the Möbius strip and the cube field']],
    features: ['gl_FragCoord (window px, centre x.5)', 'gl_FrontFacing', 'gl_PointCoord + gl_PointSize', 'gl_Position.w + gl_FragCoord.w = 1/w', 'gl_FragColor clamping to [0, 1] in RGBA8'],
    params: [
      { key: 'mode', label: 'Built-in', type: 'select', options: ['FragCoord', 'FrontFacing', 'PointCoord', 'Position.w', 'FragColor'], value: 0 },
      { key: 'gain', label: 'Pattern scale / gain', type: 'range', min: 0.5, max: 4, step: 0.05, value: 1.6 },
    ],
    code: `// pixel-exact rings around the pointer (u_m = floor(px) + 0.5)
vec2 d = gl_FragCoord.xy - u_m;          // integer offsets
float ring = step(mod(max(abs(d.x), abs(d.y)), 8.0), 0.5);
vec3 side = gl_FrontFacing ? A1 : A2;
vec2 pc = gl_PointCoord;                 // (0,0) = top-left
float depth = gl_Position.w;             // in the vertex shader`,
    init(ctx) {
      const { gl, util } = ctx;
      const s = { cam: new S.OrbitCam({ dist: 3.6, pitch: 0.45, yaw: 0.4, auto: 0.25 }), probe: [0, 0, 0, 0] };
      s.fc = util.program(G.fullscreenVS, G.colors + `
uniform vec2 u_m; uniform float u_t; uniform float u_g;
void main() {
  vec2 d = gl_FragCoord.xy - u_m;
  vec2 a = abs(d);
  float cheb = max(a.x, a.y), man = a.x + a.y;
  float step8 = floor(4.0 * u_g + 0.5) * 2.0;
  float ph = floor(u_t * 6.0);
  float ext = 360.0 * u_g;
  float ring = step(mod(cheb + ph, step8), 0.5) * step(cheb, ext);
  float idx = floor((cheb + ph) / step8);
  vec3 c = INK + vec3(0.012) * step(mod(gl_FragCoord.x, 16.0), 1.0) * step(mod(gl_FragCoord.y, 16.0), 1.0) * 8.0;
  float fall = pow(max(0.0, 1.0 - cheb / (ext + 10.0)), 1.4);
  c += mix(A1, A2, mod(idx, 2.0)) * ring * fall * 1.2;
  float dia = step(mod(man - ph * 2.0, step8 * 3.0), 0.5) * fall * 0.35;
  c += A2 * dia * (1.0 - ring);
  float chk = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
  if (cheb <= 10.0) c = mix(INK, BONE, chk) * (cheb > 9.0 ? 0.0 : 1.0) + A1 * (cheb > 9.0 ? 1.0 : 0.0);
  if ((a.x < 0.5 || a.y < 0.5) && cheb > 10.0) c = mix(c, BONE, 0.7);
  float diag = step(abs(a.x - a.y), 0.5) * step(cheb, ext) * step(10.5, cheb);
  c = mix(c, A1 * 0.6, diag * 0.6);
  c += mix(A2, A1, gl_FragCoord.x / 2000.0) * 0.05 * exp(-man / (400.0 * u_g));
  gl_FragColor = vec4(c, 1.0);
}`);
      // Möbius strip
      const mob = S.geo.surface(220, 16, (u, v) => {
        const a = u * Math.PI * 2, w = (v - 0.5) * 0.9;
        const r = 1 + w * Math.cos(a / 2);
        return { p: [r * Math.cos(a), w * Math.sin(a / 2), r * Math.sin(a)] };
      });
      s.mob = S.geo.upload(util, mob);
      s.ff = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm; attribute vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_m;
varying vec3 v_n; varying vec2 v_uv;
void main() { v_n = mat3(u_m) * a_nrm; v_uv = a_uv; gl_Position = u_vp * u_m * vec4(a_pos, 1.0); }`, G.colors + `
uniform float u_t; uniform float u_g;
varying vec3 v_n; varying vec2 v_uv;
void main() {
  vec3 n = normalize(v_n) * (gl_FrontFacing ? 1.0 : -1.0);
  float l = 0.3 + 0.7 * abs(dot(n, normalize(vec3(0.4, 0.9, 0.5))));
  vec3 c = gl_FrontFacing ? A1 : A2;
  float stripe = step(0.8, fract(v_uv.x * 40.0 * u_g * 0.6 - u_t * 0.5));
  float edge = smoothstep(0.42, 0.5, abs(v_uv.y - 0.5));
  c = c * l * (0.75 + 0.25 * stripe) + BONE * edge * 0.5;
  gl_FragColor = vec4(c, 1.0);
}`);
      // point grid
      const pts = [];
      for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) pts.push((i - 4) / 4.6, (j - 4) / 4.6);
      s.pts = util.mesh([{ buffer: util.buffer(gl.ARRAY_BUFFER, new Float32Array(pts)), loc: 0, size: 2 }], null, { count: 81 });
      s.pc = util.program(`
attribute vec2 a_pos;
uniform vec2 u_m; uniform float u_asp; uniform float u_size; uniform float u_max; uniform float u_t;
varying float v_near;
void main() {
  vec2 p = a_pos * vec2(min(1.0, 1.0 / u_asp), min(1.0, u_asp)) * 0.92;
  vec2 d = (p - u_m) * vec2(u_asp, 1.0);
  v_near = exp(-dot(d, d) * 5.0);
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = min(u_max, u_size * (0.45 + 1.4 * v_near));
}`, G.colors + `
varying float v_near;
void main() {
  vec2 pc = gl_PointCoord;
  vec3 c = mix(INK, mix(A1, A2, pc.x), 0.25 + 0.75 * (1.0 - pc.y));
  vec2 g = abs(pc - 0.5);
  float frame = step(0.46, max(g.x, g.y));
  float cross = step(min(g.x, g.y), 0.012);
  float origin = step(length(pc), 0.16);
  c = mix(c, BONE, max(frame * 0.8, cross * 0.35 * v_near));
  c = mix(c, BONE, origin);
  gl_FragColor = vec4(c * (0.55 + 0.45 * v_near), 1.0);
}`);
      // cube field for gl_Position.w
      const cube = S.geo.cube();
      const cd = [];
      for (let z = 0; z < 14; z++) for (let x = -3; x <= 3; x++) {
        const h = 0.3 + Math.abs(Math.sin(x * 1.3 + z * 0.7)) * 1.1;
        const cx = x * 2.1 + (z % 2) * 1.05, cz = -z * 2.0;
        for (let k = 0; k < 36; k++) {
          const o = k * 6;
          cd.push(cube.data[o] * 0.55 + cx, (cube.data[o + 1] + 0.5) * h, cube.data[o + 2] * 0.55 + cz, cube.data[o + 3], cube.data[o + 4], cube.data[o + 5]);
        }
      }
      for (const [x, z] of [[-9, 3], [9, 3], [9, -27], [-9, 3], [9, -27], [-9, -27]]) cd.push(x, 0, z, 0, 1, 0);
      const cb = util.buffer(gl.ARRAY_BUFFER, new Float32Array(cd));
      s.field = util.mesh([{ buffer: cb, loc: 0, size: 3, stride: 24, offset: 0 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }], null, { count: cd.length / 6 });
      s.pw = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp;
varying float v_w; varying vec3 v_n;
void main() { gl_Position = u_vp * vec4(a_pos, 1.0); v_w = gl_Position.w; v_n = a_nrm; }`, G.colors + `
uniform float u_focus; uniform float u_g;
varying float v_w; varying vec3 v_n;
void main() {
  float band = fract(v_w / u_g);
  float line = smoothstep(0.1, 0.02, band) + smoothstep(0.9, 0.98, band);
  float l = 0.4 + 0.6 * max(dot(v_n, normalize(vec3(0.3, 1.0, 0.6))), 0.0);
  vec3 c = vec3(0.07, 0.075, 0.095) * l * (abs(v_n.y) > 0.5 && v_n.y > 0.0 ? 1.0 : 1.8);
  c += mix(A1, A2, clamp(v_w / 22.0, 0.0, 1.0)) * line * 0.9;
  float f = exp(-pow((v_w - u_focus) * 1.4, 2.0));
  c += BONE * f * 0.55;
  // gl_FragCoord.w is 1 / gl_Position.w: the same depth, seen from the fragment side
  float check = abs(gl_FragCoord.w * v_w - 1.0);
  c = mix(c, A2, step(0.01, check));
  c *= 1.0 / (1.0 + v_w * 0.03);
  gl_FragColor = vec4(c, 1.0);
}`);
      // gl_FragColor ramp
      s.fcol = util.program(G.fullscreenVS, G.colors + `
uniform vec2 u_res; uniform float u_t; uniform float u_g; uniform float u_hatch;
varying vec2 v_uv;
vec4 shade(vec2 q, float t, float g) {
  vec2 a = vec2(cos(t * 0.5), sin(t * 0.7)) * 0.32, b = vec2(cos(t * 0.37 + 2.0), sin(t * 0.53 + 1.0)) * 0.32;
  float f1 = exp(-dot(q - a, q - a) * 7.0), f2 = exp(-dot(q - b, q - b) * 7.0);
  vec3 c = (A1 * f1 + A2 * f2) * g - 0.15;
  return vec4(c, 1.0);
}
void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec4 c = shade(q, u_t, u_g);
  float over = step(1.0, max(c.r, max(c.g, c.b)));
  float under = step(min(c.r, min(c.g, c.b)), 0.0) * (1.0 - step(0.02, max(c.r, max(c.g, c.b))));
  float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 10.0));
  c.rgb = mix(c.rgb, c.rgb * 0.82, over * hatch * u_hatch);
  gl_FragColor = c;   // values above 1 and below 0 are clamped on write
}`);
      s.info = panel(ctx, 'ov-tr', '');
      s.maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
      return s;
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const W = ctx.width, H = ctx.height, mode = params.mode;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const p = ghostPointer(ctx, s, t, dt, (tt) => [0.5 + Math.cos(tt * 0.45) * 0.22, 0.48 + Math.sin(tt * 0.6) * 0.2]);
      const mx = Math.floor(p[0]) + 0.5, my = Math.floor(p[1]) + 0.5;
      let html = `<b>${BMODES[mode]}</b><br>`;
      if (mode === 0) {
        s.fc.use().set({ u_m: [mx, my], u_t: t, u_g: params.gain * ctx.dpr / 1.6 });
        util.drawFullscreen();
        html += `at pointer <b>(${mx.toFixed(1)}, ${my.toFixed(1)})</b><br>z <b>0.5</b> (fullscreen tri at depth 0) · w <b>1.0</b><br>origin bottom-left · pixel centres at .5`;
      } else if (mode === 1) {
        s.cam.update(input, dt);
        gl.enable(gl.DEPTH_TEST);
        s.ff.use().set({ u_vp: M4.mul(s.cam.proj(ctx.aspect), s.cam.view()), u_m: M4.rotX(Math.sin(t * 0.3) * 0.25), u_t: t, u_g: params.gain });
        s.mob.draw();
        gl.disable(gl.DEPTH_TEST);
        html += `<span class="on">■</span> front-facing &nbsp;<span class="off">■</span> back-facing<br>one surface, no culling: follow the strip<br>once round and the side flips`;
      } else if (mode === 2) {
        const asp = ctx.aspect;
        const m = [p[0] / W * 2 - 1, p[1] / H * 2 - 1];
        s.pc.use().set({ u_m: m, u_asp: asp, u_size: Math.min(W, H) / 11 * params.gain / 1.6, u_max: s.maxPt, u_t: t });
        s.pts.draw(gl.POINTS);
        html += `gl_PointCoord.x → cyan…magenta<br>gl_PointCoord.y = 0 at the <b>top</b> (bright)<br>white dot marks (0, 0) · max size <b>${s.maxPt}</b>`;
      } else if (mode === 3) {
        const yaw = (p[0] / W - 0.5) * 0.6;
        const eye = [Math.sin(yaw) * 2.5, 2.0 + (p[1] / H) * 2.0, 3.2];
        const vp = M4.mul(M4.persp(0.9, ctx.aspect, 0.1, 60), M4.lookAt(eye, [Math.sin(yaw) * 6, 0.2, -10]));
        const focus = 3 + (Math.sin(t * 0.6) * 0.5 + 0.5) * 16;
        gl.enable(gl.DEPTH_TEST);
        s.pw.use().set({ u_vp: vp, u_focus: focus, u_g: params.gain });
        s.field.draw();
        gl.disable(gl.DEPTH_TEST);
        html += `contour every <b>${params.gain.toFixed(2)}</b> units of w<br>highlight sweeps w = <b>${focus.toFixed(1)}</b><br>gl_FragCoord.w = 1 / w = <b>${(1 / focus).toFixed(3)}</b>`;
      } else {
        s.fcol.use().set({ u_res: [W, H], u_t: t, u_g: params.gain, u_hatch: 1 });
        util.drawFullscreen();
        // what the shader wrote at the pointer (same formula on the CPU) vs what the buffer stored
        const q = [(mx - 0.5 * W) / H, (my - 0.5 * H) / H];
        const a = [Math.cos(t * 0.5) * 0.32, Math.sin(t * 0.7) * 0.32], b = [Math.cos(t * 0.37 + 2) * 0.32, Math.sin(t * 0.53 + 1) * 0.32];
        const f1 = Math.exp(-((q[0] - a[0]) ** 2 + (q[1] - a[1]) ** 2) * 7), f2 = Math.exp(-((q[0] - b[0]) ** 2 + (q[1] - b[1]) ** 2) * 7);
        const wv = [0, 1, 2].map((i) => (S.A1[i] * f1 + S.A2[i] * f2) * params.gain - 0.15);
        // RGBA8 conversion rule (readPixels would return the same bytes; it stalls the pipeline every frame)
        const st = wv.map((v) => Math.round(clamp(v, 0, 1) * 255));
        html += `wrote <b>vec4(${wv.map((v) => v.toFixed(2)).join(', ')}, 1.0)</b><br>stored <b>(${st.join(', ')}, 255)</b> · RGBA8<br>clamp to [0, 1] → ×255 → round<br>hatched = a channel above 1.0`;
      }
      if (Math.floor(t * 8) !== s.tick || mode !== s.lastMode) { s.tick = Math.floor(t * 8); s.lastMode = mode; s.info.innerHTML = html; }
      ctx.canvas.style.cursor = mode === 1 ? 'grab' : 'crosshair';
    },
  });

  /* ---------------------------------------------------------------- */
  /* 5. Derivatives                                                    */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'derivatives',
    title: 'Derivatives',
    category: CAT,
    thumb: 'wide',
    hint: 'drag to orbit · move the split',
    description: 'OES_standard_derivatives exposes dFdx, dFdy and fwidth: how fast any value changes from one pixel to the next, computed across each 2×2 block of fragments. Dividing a distance by fwidth gives line widths measured in pixels, so the grid and contours stay sharp and alias-free at every distance. The same functions find edges where a quantised value jumps, and build per-triangle normals from the screen-space derivatives of position.',
    interact: [['Drag', 'orbit the terrain'], ['Move', 'in Split mode, the pointer sets the AA on / off divide'], ['Mode', 'lines, edge detection, flat normals or raw fwidth']],
    features: ['OES_standard_derivatives', 'dFdx · dFdy · fwidth', 'pixel-width antialiased lines', 'normalize(cross(dFdx(p), dFdy(p)))', 'FRAGMENT_SHADER_DERIVATIVE_HINT_OES'],
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['Grid + contours', 'Toon edges', 'Flat normals', 'fwidth heat'], value: 0 },
      { key: 'aa', label: 'Antialiasing', type: 'select', options: ['Off', 'On', 'Split'], value: 2 },
      { key: 'width', label: 'Line width (px)', type: 'range', min: 0.5, max: 4, step: 0.1, value: 1.2 },
      { key: 'res', label: 'Mesh resolution', type: 'range', min: 16, max: 200, step: 4, value: 40, restart: true },
      { key: 'hint', label: 'Derivative hint', type: 'select', options: ['DONT_CARE', 'FASTEST', 'NICEST'], value: 0 },
    ],
    code: `#extension GL_OES_standard_derivatives : enable
vec2 g = v_world.xz / spacing;
vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g); // distance in px
float line = 1.0 - min(min(d.x, d.y) / u_width, 1.0);
vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
gl.hint(ext.FRAGMENT_SHADER_DERIVATIVE_HINT_OES, gl.NICEST);`,
    init(ctx) {
      const { gl, util, params } = ctx;
      const ext = util.ext('OES_standard_derivatives');
      if (!ext) { ctx.message('OES_standard_derivatives is not supported on this device.\nThis study needs dFdx / dFdy / fwidth.'); return { off: true }; }
      const n = params.res;
      const g = S.geo.surface(n, n, (u, v) => ({ p: [u * 8 - 4, 0, v * 8 - 4], n: [0, 1, 0] }));
      const mesh = S.geo.upload(util, g);
      const prog = util.program(`
attribute vec3 a_pos;
uniform mat4 u_vp; uniform float u_t;
varying vec3 v_w; varying vec3 v_sn;
float H(vec2 p) {
  float h = sin(p.x * 0.9 + u_t * 0.3) * 0.35 + cos(p.y * 1.1 - u_t * 0.2) * 0.3;
  h += sin(length(p) * 2.2 - u_t * 0.8) * 0.18 * exp(-length(p) * 0.2);
  h += abs(sin(p.x * 0.5 + p.y * 0.7)) * 0.4;
  return h;
}
void main() {
  vec2 p = a_pos.xz;
  float h = H(p);
  vec2 e = vec2(0.02, 0.0);
  v_sn = normalize(vec3(H(p - e.xy) - H(p + e.xy), 0.04, H(p - e.yx) - H(p + e.yx)));
  v_w = vec3(p.x, h, p.y);
  gl_Position = u_vp * vec4(v_w, 1.0);
}`, '#extension GL_OES_standard_derivatives : enable\n' + G.colors + `
uniform float u_mode; uniform float u_aa; uniform float u_split; uniform float u_width; uniform vec3 u_eye;
varying vec3 v_w; varying vec3 v_sn;
float gridLine(vec2 g, float aa) {
  vec2 fw = fwidth(g);
  vec2 d = abs(fract(g - 0.5) - 0.5);
  if (aa > 0.5) { vec2 px = d / fw; return 1.0 - clamp(min(px.x, px.y) / u_width, 0.0, 1.0); }
  return step(min(d.x, d.y), 0.012 * u_width);           // fixed width in world units: aliases
}
float isoLine(float v, float aa) {
  float d = abs(fract(v - 0.5) - 0.5);
  if (aa > 0.5) return 1.0 - clamp(d / fwidth(v) / u_width, 0.0, 1.0);
  return step(d, 0.03 * u_width);
}
void main() {
  float aa = u_aa > 1.5 ? step(u_split, gl_FragCoord.x) : u_aa;
  vec3 L = normalize(vec3(0.5, 0.9, 0.3));
  vec3 sn = normalize(v_sn);
  vec3 fn = normalize(cross(dFdx(v_w), dFdy(v_w)));
  float fog = exp(-length(v_w - u_eye) * 0.06);
  vec3 c;
  if (u_mode < 0.5) {
    float l = 0.25 + 0.6 * max(dot(sn, L), 0.0);
    c = INK * 3.0 + vec3(0.03, 0.035, 0.05) * l * 4.0;
    c = mix(c, A1, gridLine(v_w.xz * 2.0, aa) * 0.9);
    c = mix(c, A2, isoLine(v_w.y * 8.0, aa) * 0.75);
  } else if (u_mode < 1.5) {
    float l = max(dot(sn, L), 0.0);
    float bands = floor(l * 4.0) / 4.0;
    float hb = floor(v_w.y * 4.0);
    // toon outlines: band boundaries found from screen-space rates of change
    float e1 = isoLine(l * 4.0, 1.0), e2 = isoLine(v_w.y * 4.0, 1.0);
    float crease = clamp(length(fwidth(sn)) * 6.0 - 0.3, 0.0, 1.0);
    c = mix(INK * 2.0, mix(A1, A2, clamp(hb * 0.3 + 0.5, 0.0, 1.0)), 0.15 + 0.5 * bands);
    c = mix(c, BONE, max(e1 * 0.85, crease * 0.6));
    c = mix(c, INK, e2 * 0.9);
  } else if (u_mode < 2.5) {
    vec3 n = aa > 0.5 ? fn : sn;
    float l = max(dot(n, L), 0.0);
    vec3 h = normalize(L + normalize(u_eye - v_w));
    c = mix(A1, A2, clamp(v_w.y * 0.8 + 0.3, 0.0, 1.0)) * (0.12 + 0.8 * l) + pow(max(dot(n, h), 0.0), 60.0) * 0.4;
  } else {
    vec2 fw = fwidth(v_w.xz);
    float r = clamp(log2(max(fw.x, fw.y) * 400.0) / 6.0, 0.0, 1.0);
    c = mix(mix(INK * 3.0, A1, smoothstep(0.0, 0.5, r)), A2, smoothstep(0.5, 1.0, r));
    c = mix(c, BONE, gridLine(v_w.xz * 2.0, 1.0) * 0.25);
  }
  c = mix(INK, c, fog);
  gl_FragColor = vec4(c, 1.0);
}`);
      const info = panel(ctx, 'ov-tr', '');
      const labs = [el(ctx.overlay, 'div', 'ov-label', 'aa off'), el(ctx.overlay, 'div', 'ov-label', 'aa on · fwidth')];
      return { ext, mesh, prog, info, labs, split: 0.5, cam: new S.OrbitCam({ dist: 6.5, pitch: 0.42, yaw: 0.7, auto: 0.05, minDist: 2.5, maxDist: 14 }) };
    },
    frame(ctx, s, t, dt) {
      if (s.off) return;
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      const hints = [gl.DONT_CARE, gl.FASTEST, gl.NICEST];
      gl.hint(s.ext.FRAGMENT_SHADER_DERIVATIVE_HINT_OES, hints[params.hint]);
      const target = input.hover && !input.down ? input.uvx : 0.5 + Math.sin(t * 0.5) * 0.18;
      s.split += (target - s.split) * damp(8, dt);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: M4.mul(s.cam.proj(ctx.aspect), s.cam.view()), u_t: t, u_mode: params.mode, u_aa: params.aa, u_split: s.split * ctx.width, u_width: params.width * ctx.dpr, u_eye: s.cam.eye() });
      s.mesh.draw();
      gl.disable(gl.DEPTH_TEST);
      if (params.aa === 2) {
        gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.round(s.split * ctx.width), 0, Math.max(1, ctx.dpr), ctx.height);
        gl.clearColor(0.93, 0.91, 0.88, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
      }
      const names = params.mode === 2 ? ['smooth normals', 'flat · cross(dFdx, dFdy)'] : ['aa off', 'aa on · fwidth'];
      s.labs.forEach((L, i) => {
        L.style.display = params.aa === 2 && (params.mode === 0 || params.mode === 2) ? '' : 'none';
        L.textContent = names[i];
        L.style.top = ctx.cssHeight - 90 + 'px';
        L.style.left = i ? s.split * ctx.cssWidth + 14 + 'px' : s.split * ctx.cssWidth - 14 - L.offsetWidth + 'px';
      });
      if (Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        const hv = gl.getParameter(s.ext.FRAGMENT_SHADER_DERIVATIVE_HINT_OES);
        s.info.innerHTML = `OES_standard_derivatives <span class="on">on</span><br>DERIVATIVE_HINT <b>${hv === gl.NICEST ? 'NICEST' : hv === gl.FASTEST ? 'FASTEST' : 'DONT_CARE'}</b><br>${['grid every 0.5 · contours every 0.125', 'toon bands outlined via fwidth · creases = fwidth(normal)', 'flat: per-triangle normals, no extra data', 'fwidth(world.xz): px footprint, log scale'][params.mode]}`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 6. Fragment depth                                                 */
  /* ---------------------------------------------------------------- */
  S.register({
    id: 'frag-depth',
    title: 'Fragment Depth',
    category: CAT,
    thumb: 'square',
    hint: 'drag to orbit · toggle depth writes',
    description: 'Each sphere is a single camera-facing quad. The fragment shader ray-traces the sphere inside it, discards the misses, and with EXT_frag_depth writes the true depth of the hit point to gl_FragDepthEXT. The impostors then cut into the rasterised knot along exact curved seams. Turn the depth write off and each sphere falls back to the depth of its flat quad, so the intersections become straight, wrong cuts.',
    interact: [['Drag', 'orbit'], ['Wheel', 'zoom'], ['Write depth', 'gl_FragDepthEXT on or off'], ['View', 'shaded or the depth buffer itself']],
    features: ['EXT_frag_depth', 'gl_FragDepthEXT', 'ray-sphere intersection per fragment', 'billboard quads (4 vertices per sphere)', 'discard outside the silhouette'],
    params: [
      { key: 'write', label: 'Write gl_FragDepthEXT', type: 'toggle', value: true },
      { key: 'view', label: 'View', type: 'select', options: ['Shaded', 'Depth buffer'], value: 0 },
      { key: 'count', label: 'Spheres', type: 'range', min: 12, max: 600, step: 4, value: 96, restart: true },
      { key: 'size', label: 'Sphere size', type: 'range', min: 0.3, max: 2, step: 0.05, value: 1 },
    ],
    code: `#extension GL_EXT_frag_depth : enable
vec3 hit = ro + rd * t;                  // view-space hit point
vec4 clip = u_proj * vec4(hit, 1.0);
gl_FragDepthEXT = (clip.z / clip.w) * 0.5 + 0.5;
// off: the quad's own gl_FragCoord.z is used instead`,
    init(ctx) {
      const { gl, util, params } = ctx;
      const ext = util.ext('EXT_frag_depth');
      const knotG = S.geo.torusKnot(300, 32, 0.32, 1.25, 0.55);
      const knot = S.geo.upload(util, knotG);
      const N = params.count;
      // centres along the knot, pushed out so they straddle the tube surface
      const C = (t) => [(1.25 + 0.55 * Math.cos(3 * t)) * Math.cos(2 * t), 0.55 * Math.sin(3 * t), (1.25 + 0.55 * Math.cos(3 * t)) * Math.sin(2 * t)];
      const cen = new Float32Array(N * 4 * 3), corner = new Float32Array(N * 4 * 2), attr = new Float32Array(N * 4 * 2);
      const idx = new Uint16Array(N * 6);
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < N; i++) {
        const tt = (i / N) * Math.PI * 2, c = C(tt);
        const d = V3.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
        const p = V3.add(c, V3.scale(d, 0.3 + rnd() * 0.12));
        const r = 0.1 + rnd() * 0.14;
        for (let k = 0; k < 4; k++) {
          cen.set(p, (i * 4 + k) * 3);
          corner.set([k & 1 ? 1 : -1, k & 2 ? 1 : -1], (i * 4 + k) * 2);
          attr.set([r, rnd()], (i * 4 + k) * 2);
        }
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
      }
      const B = gl.ARRAY_BUFFER;
      const quads = util.mesh([
        { buffer: util.buffer(B, cen), loc: 0, size: 3 },
        { buffer: util.buffer(B, corner), loc: 2, size: 2 },
        { buffer: util.buffer(B, attr), loc: 4, size: 2 },
      ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, idx), { count: N * 6 });
      const ground = util.mesh([{ buffer: util.buffer(B, new Float32Array([-6, -1.3, -6, 6, -1.3, -6, -6, -1.3, 6, 6, -1.3, 6])), loc: 0, size: 3 }], null, { count: 4 });
      const raster = util.program(`
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_view; uniform mat4 u_proj; uniform mat4 u_m;
varying vec3 v_n; varying vec3 v_vp; varying vec3 v_wp;
void main() { vec4 w = u_m * vec4(a_pos, 1.0); v_wp = w.xyz; vec4 v = u_view * w; v_vp = v.xyz; v_n = mat3(u_view) * mat3(u_m) * a_nrm; gl_Position = u_proj * v; }`, G.colors + `
uniform float u_view_depth; uniform float u_ground;
varying vec3 v_n; varying vec3 v_vp; varying vec3 v_wp;
void main() {
  vec3 c;
  if (u_ground > 0.5) {
    vec2 g = abs(fract(v_wp.xz * 2.0) - 0.5);
    float line = step(0.47, max(g.x, g.y));
    c = INK * 2.0 + A1 * line * 0.12 * exp(-length(v_wp.xz) * 0.35);
  } else {
    vec3 n = normalize(v_n);
    vec3 l = normalize(vec3(0.4, 0.8, 0.5));
    float d = max(dot(n, l), 0.0);
    float sp = pow(max(dot(reflect(-l, n), normalize(-v_vp)), 0.0), 40.0);
    c = A1 * (0.12 + 0.75 * d) + sp * 0.5;
  }
  if (u_view_depth > 0.5) { float z = gl_FragCoord.z; c = vec3(pow(1.0 - z, 0.35)); c *= mix(vec3(0.6, 0.95, 1.0), vec3(1.0), 0.5); }
  gl_FragColor = vec4(c, 1.0);
}`);
      const impFS = (useExt) => (useExt ? '#extension GL_EXT_frag_depth : enable\n' : '') + G.colors + `
uniform mat4 u_proj; uniform float u_write; uniform float u_view_depth;
varying vec3 v_vp; varying vec3 v_c; varying float v_r; varying float v_k;
void main() {
  vec3 rd = normalize(v_vp);
  vec3 oc = -v_c;
  float b = dot(oc, rd), cc = dot(oc, oc) - v_r * v_r, h = b * b - cc;
  if (h < 0.0) discard;
  float t = -b - sqrt(h);
  vec3 hit = rd * t;
  vec3 n = normalize(hit - v_c);
  vec4 clip = u_proj * vec4(hit, 1.0);
  float z = (clip.z / clip.w) * 0.5 + 0.5;
  float depth = mix(gl_FragCoord.z, z, u_write);
${useExt ? '  gl_FragDepthEXT = depth;' : ''}
  vec3 l = normalize(vec3(0.4, 0.8, 0.5));
  float d = max(dot(n, l), 0.0);
  float sp = pow(max(dot(reflect(-l, n), -rd), 0.0), 50.0);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  vec3 base = mix(A2, BONE, step(0.78, v_k));
  vec3 c = base * (0.1 + 0.8 * d) + sp * 0.6 + rim * base * 0.3;
  if (u_view_depth > 0.5) { c = vec3(pow(1.0 - depth, 0.35)); c *= mix(vec3(1.0, 0.6, 0.85), vec3(1.0), 0.5); }
  gl_FragColor = vec4(c, 1.0);
}`;
      const impVS = `
attribute vec3 a_pos; attribute vec2 a_uv; attribute vec2 a_i0;
uniform mat4 u_view; uniform mat4 u_proj; uniform float u_size; uniform float u_t;
varying vec3 v_vp; varying vec3 v_c; varying float v_r; varying float v_k;
void main() {
  vec3 wp = a_pos + vec3(0.0, sin(u_t * 0.9 + a_i0.y * 30.0) * 0.04, 0.0);
  vec3 c = (u_view * vec4(wp, 1.0)).xyz;
  float r = a_i0.x * u_size;
  vec3 dir = normalize(c);
  vec3 X = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 Y = cross(dir, X);
  vec3 p = c - dir * r + (X * a_uv.x + Y * a_uv.y) * r * 1.05;   // quad on the sphere's front
  v_vp = p; v_c = c; v_r = r; v_k = a_i0.y;
  gl_Position = u_proj * vec4(p, 1.0);
}`;
      const imp = util.program(impVS, impFS(!!ext));
      const info = panel(ctx, 'ov-tr', '');
      if (!ext) info.innerHTML = '<span class="off">EXT_frag_depth not supported</span><br>impostors use their flat quad depth';
      return { ext, knot, quads, ground, raster, imp, info, N, cam: new S.OrbitCam({ dist: 4.6, pitch: 0.55, yaw: 0.3, auto: 0.18, minDist: 2, maxDist: 12 }) };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      const view = s.cam.view(), proj = s.cam.proj(ctx.aspect, 0.1, 40);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const vd = params.view;
      s.raster.use().set({ u_view: view, u_proj: proj, u_view_depth: vd, u_ground: 1, u_m: M4.ident() });
      s.ground.draw(gl.TRIANGLE_STRIP);
      s.raster.set({ u_ground: 0, u_m: M4.ident() });
      s.knot.draw();
      const write = params.write && !!s.ext;
      s.imp.use().set({ u_view: view, u_proj: proj, u_size: params.size, u_t: t, u_write: write ? 1 : 0, u_view_depth: vd });
      s.quads.draw();
      gl.disable(gl.DEPTH_TEST);
      if (s.ext && Math.floor(t * 4) !== s.tick) {
        s.tick = Math.floor(t * 4);
        s.info.innerHTML = `EXT_frag_depth <span class="on">on</span><br>gl_FragDepthEXT <b>${write ? '<span class="on">ray-traced depth</span>' : '<span class="off">off · flat quad depth</span>'}</b><br>${s.N} spheres = ${s.N * 2} triangles`;
      }
    },
  });

  /* ---------------------------------------------------------------- */
  /* 7. Precision qualifiers                                           */
  /* ---------------------------------------------------------------- */
  const PREC = ['lowp', 'mediump', 'highp'];
  S.register({
    id: 'precision',
    title: 'Precision Qualifiers',
    category: CAT,
    thumb: 'tall',
    hint: 'wheel to zoom · drag to pan',
    description: 'The same shader compiled three times, with precision lowp, mediump and highp float. Desktop GPUs usually run all three at 32-bit, so by default the columns also round every operation to the minimum the specification allows: 8-bit fixed point for lowp and a 10-bit mantissa for mediump. That is what many mobile GPUs really do. The table lists what getShaderPrecisionFormat reports for this device.',
    interact: [['Wheel', 'zoom the fractal'], ['Drag', 'pan (stops the automatic zoom)'], ['Scene', 'deep-zoom fractal or sine at large coordinates'], ['Emulate', 'off shows this GPU\'s native behaviour']],
    features: ['precision lowp / mediump / highp float', 'getShaderPrecisionFormat(type, format)', 'rangeMin · rangeMax · precision', 'GL_FRAGMENT_PRECISION_HIGH', 'LOW / MEDIUM / HIGH _FLOAT and _INT'],
    params: [
      { key: 'scene', label: 'Scene', type: 'select', options: ['Fractal zoom', 'Large-coordinate sine'], value: 0 },
      { key: 'emu', label: 'Emulate minimum precision', type: 'toggle', value: true },
      { key: 'auto', label: 'Automatic zoom', type: 'toggle', value: true },
      { key: 'iter', label: 'Iterations', type: 'range', min: 32, max: 256, step: 8, value: 72 },
      { key: 'scale', label: 'Resolution scale', type: 'range', min: 0.25, max: 1, step: 0.05, value: 0.5 },
    ],
    code: `precision mediump float;   // per shader, overrides the default
const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT);
f.rangeMin;  // log2 of the smallest magnitude
f.rangeMax;  // log2 of the largest magnitude
f.precision; // bits of mantissa (0 = unsupported)`,
    init(ctx) {
      const { gl, util } = ctx;
      const fs = (prec) => `
precision ${prec} float;
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define HP highp
#else
#define HP mediump
#endif
` + G.colors + `
uniform HP vec2 u_center; uniform HP float u_scale; uniform HP vec2 u_origin; uniform HP vec2 u_size;
uniform float u_bits; uniform float u_scene; uniform float u_t; uniform float u_iter;
// round to the spec minimum: u_bits > 0 → float mantissa bits, u_bits < 0 → lowp fixed point
HP float qz(HP float x) {
  if (u_bits > 0.5) {
    if (x == 0.0) return 0.0;
    HP float e = exp2(floor(log2(abs(x))) - u_bits);
    return floor(x / e + 0.5) * e;
  }
  if (u_bits < -0.5) return clamp(floor(x * 256.0 + 0.5) / 256.0, -2.0, 2.0);
  return x;
}
HP vec2 qz2(HP vec2 v) { return vec2(qz(v.x), qz(v.y)); }
void main() {
  vec2 px = gl_FragCoord.xy - u_origin;
  vec3 col;
  if (u_scene < 0.5) {
    vec2 off = (px - 0.5 * u_size) / u_size.y;
    vec2 c = qz2(u_center + qz2(off * u_scale));
    vec2 z = vec2(0.0);
    float it = 0.0, esc = 0.0;
    for (int i = 0; i < 256; i++) {
      if (float(i) >= u_iter) break;
      z = qz2(vec2(qz(qz(z.x * z.x) - qz(z.y * z.y)), qz(2.0 * qz(z.x * z.y))) + c);
      if (dot(z, z) > 4.0) { esc = 1.0; break; }
      it += 1.0;
    }
    float band = 0.5 - 0.5 * cos(it * 0.21);
    vec3 pal = mix(mix(INK * 2.5, A1 * 0.85, smoothstep(0.0, 0.6, band)), A2, smoothstep(0.55, 1.0, band) * 0.85);
    col = esc > 0.5 ? pal * (0.25 + 0.75 * min(1.0, it / 14.0)) : INK;
  } else {
    float ty = px.y / u_size.y;
    float mag = pow(10.0, ty * 6.0);                      // 1 … 1,000,000 up the column
    float x = qz(mag + qz(px.x * 0.11));
    float v = sin(qz(x * 1.7) + u_t * 1.5) * 0.5 + 0.5;
    float decade = abs(fract(ty * 6.0 + 0.5) - 0.5);
    col = mix(INK, mix(A1, A2, ty), v) + BONE * smoothstep(0.004, 0.0, decade) * 0.35;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
      const progs = PREC.map((p) => util.program(G.fullscreenVS, fs(p)));
      const fmt = (st, pt) => { const f = gl.getShaderPrecisionFormat(st, pt); return f ? [f.rangeMin, f.rangeMax, f.precision] : ['–', '–', '–']; };
      const rows = [];
      for (const [sn, st] of [['VS', gl.VERTEX_SHADER], ['FS', gl.FRAGMENT_SHADER]]) for (const k of ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT']) rows.push([sn, k, ...fmt(st, gl[k])]);
      const native = PREC.map((p, i) => fmt(gl.FRAGMENT_SHADER, gl[['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT'][i]]));
      const info = panel(ctx, 'ov-br', `getShaderPrecisionFormat<table style="border-collapse:collapse;margin-top:6px;font-size:10px">
<tr style="opacity:.6"><td></td><td style="padding-right:10px">format</td><td style="padding-right:8px">min</td><td style="padding-right:8px">max</td><td>bits</td></tr>
${rows.map((r) => `<tr><td style="padding-right:8px;opacity:.6">${r[0]}</td><td style="padding-right:10px">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td><b>${r[4]}</b></td></tr>`).join('')}</table>`);
      const labs = PREC.map(() => el(ctx.overlay, 'div', 'ov-label'));
      const decades = [];
      for (let k = 0; k <= 6; k++) decades.push(el(ctx.overlay, 'div', 'ov-label', '10' + '⁰¹²³⁴⁵⁶'[k]));
      const blit = util.program(G.fullscreenVS, `uniform sampler2D u_tex; varying vec2 v_uv; void main() { gl_FragColor = texture2D(u_tex, v_uv); }`);
      return { progs, blit, rt: null, info, labs, decades, native, logZoom: 0, center: [-0.743643887037151, 0.13182590420533], manual: false };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params, util } = ctx;
      const sc = params.scale;
      const W = Math.max(48, Math.round(ctx.width * sc)), H = Math.max(16, Math.round(ctx.height * sc)), cw = Math.floor(W / 3);
      if (!s.rt || s.rt.w !== W || s.rt.h !== H) { if (s.rt) util.release(s.rt.fb, s.rt.tex); s.rt = util.target(W, H, { filter: gl.NEAREST }); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.rt.fb);
      if (params.scene === 0) {
        if (input.wheel) { s.logZoom = clamp(s.logZoom + input.wheel * 0.002, 0, 17); s.manual = true; }
        if (input.dragging) {
          const k = 2.6 * Math.exp(-s.logZoom) / ctx.cssHeight;
          s.center[0] -= input.dragDX * k; s.center[1] += input.dragDY * k; s.manual = true;
        }
        if (params.auto && !s.manual) s.logZoom = 5 + (t * 0.8) % 11;
      }
      const scale = 2.6 * Math.exp(-s.logZoom);
      const bits = [-1, 10, 0];
      gl.enable(gl.SCISSOR_TEST);
      for (let i = 0; i < 3; i++) {
        const x = i * cw, w = i === 2 ? W - x : cw;
        gl.viewport(x, 0, w, H); gl.scissor(x, 0, w, H);
        s.progs[i].use().set({ u_center: s.center, u_scale: scale, u_origin: [x, 0], u_size: [w, H], u_bits: params.emu ? bits[i] : 0, u_scene: params.scene, u_t: t, u_iter: params.iter });
        util.drawFullscreen();
        const L = s.labs[i];
        const nb = s.native[i][2];
        L.innerHTML = `${PREC[i]}<br><span style="opacity:.7;letter-spacing:.06em">${params.emu ? ['8-bit fixed · emulated', '10-bit mantissa · emulated', 'native · ' + nb + ' bits'][i] : 'native · ' + nb + ' bits'}</span>`;
        L.style.left = x / sc / ctx.dpr + 14 + 'px'; L.style.top = '92px'; L.style.lineHeight = '1.5';
        L.style.color = i === 2 ? 'var(--acc1)' : i === 1 ? '' : 'var(--acc2)';
      }
      gl.disable(gl.SCISSOR_TEST);
      util.bindTarget(null, ctx.width, ctx.height);
      util.tex(0, s.rt.tex);
      s.blit.use().set({ u_tex: 0 });
      util.drawFullscreen();
      gl.enable(gl.SCISSOR_TEST);
      gl.clearColor(0.93, 0.91, 0.88, 1);
      for (const k of [1, 2]) { gl.scissor(Math.round(cw * k / sc), 0, Math.max(1, ctx.dpr), ctx.height); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.disable(gl.SCISSOR_TEST);
      s.decades.forEach((d, k) => {
        d.style.display = params.scene === 1 ? '' : 'none';
        d.style.left = ctx.cssWidth - 46 + 'px';
        d.style.top = (1 - k / 6) * ctx.cssHeight - (k === 6 ? -4 : 14) + 'px';
      });
      if (params.scene === 0) s.labs[0].innerHTML += `<br><span style="opacity:.7">zoom ×${Math.exp(s.logZoom).toExponential(1)}</span>`;
    },
  });
})();
