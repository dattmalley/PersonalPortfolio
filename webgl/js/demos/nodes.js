/* Node Graph — a visual shader editor. Drag nodes, drag wires from outputs to
 * typed inputs (incompatible or cyclic links are refused), tweak parameters;
 * the graph is compiled to GLSL and linked at runtime. With
 * KHR_parallel_shader_compile the new program builds in the background while
 * the previous one keeps rendering. */
(function () {
  const S = window.Sandbox;
  const f = (x) => (+x).toFixed(3);

  const TYPES = {
    uv: { title: 'UV', out: 'vec2', glsl: () => 'v_p' },
    time: { title: 'Time', out: 'float', params: { speed: [0, 3, 1] }, glsl: (i, p) => `(u_time * ${f(p.speed)})` },
    warp: { title: 'Warp', out: 'vec2', ins: [['p', 'vec2'], ['t', 'float']], params: { amount: [0, 0.6, 0.18] }, glsl: (i, p) => `(${i.p} + ${f(p.amount)} * vec2(sin(${i.p}.y * 5.0 + ${i.t}), cos(${i.p}.x * 5.0 - ${i.t})))` },
    noise: { title: 'Noise', out: 'float', ins: [['p', 'vec2']], params: { scale: [1, 24, 5] }, glsl: (i, p) => `fbm(${i.p} * ${f(p.scale)})` },
    rings: { title: 'Rings', out: 'float', ins: [['p', 'vec2'], ['t', 'float']], params: { freq: [1, 60, 18] }, glsl: (i, p) => `(0.5 + 0.5 * sin(length(${i.p}) * ${f(p.freq)} - ${i.t} * 3.0))` },
    stripes: { title: 'Stripes', out: 'float', ins: [['p', 'vec2']], params: { freq: [1, 60, 14] }, glsl: (i, p) => `(0.5 + 0.5 * sin((${i.p}.x + ${i.p}.y) * ${f(p.freq)}))` },
    mul: { title: 'Multiply', out: 'float', ins: [['a', 'float'], ['b', 'float']], glsl: (i) => `(${i.a} * ${i.b})` },
    contrast: { title: 'Contrast', out: 'float', ins: [['v', 'float']], params: { edge: [0, 1, 0.45], soft: [0.01, 0.5, 0.12] }, glsl: (i, p) => `smoothstep(${f(p.edge - p.soft)}, ${f(+p.edge + +p.soft)}, ${i.v})` },
    red: { title: 'Red', out: 'color', glsl: () => 'RED' },
    blue: { title: 'Blue', out: 'color', glsl: () => 'BLUE' },
    bone: { title: 'Bone', out: 'color', glsl: () => 'vec3(0.93, 0.91, 0.87)' },
    mix: { title: 'Mix', out: 'color', ins: [['a', 'color'], ['b', 'color'], ['t', 'float']], glsl: (i) => `mix(${i.a}, ${i.b}, clamp(${i.t}, 0.0, 1.0))` },
    out: { title: 'Output', out: null, ins: [['color', 'any']] },
  };
  const DEF = { vec2: 'v_p', float: '0.5', color: 'vec3(0.0)', any: 'vec3(0.0)' };
  const GT = { vec2: 'vec2', float: 'float', color: 'vec3' };
  const TCOL = { vec2: '#9aa0b4', float: '#3b8bff', color: '#ff3b4e', any: '#ece9e2' };
  const compatible = (from, to) => to === 'any' || from === to || (from === 'float' && to === 'color');

  const HEAD = S.GLSL.colors + S.GLSL.noise + `
in vec2 v_uv; out vec4 o; uniform float u_time; uniform float u_aspect;
void main() {
  vec2 v_p = (v_uv - 0.5) * vec2(u_aspect, 1.0);
  `;
  const WIRE_VS = `
layout(location = 0) in vec4 a_seg; layout(location = 1) in vec4 a_col;
uniform vec2 u_res; uniform float u_w;
out vec2 v_q; out vec4 v_col; out float v_len;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 a = a_seg.xy, b = a_seg.zw, d = b - a; float L = length(d);
  vec2 t = L > 1e-4 ? d / L : vec2(1, 0), n = vec2(-t.y, t.x);
  float w = u_w * 0.5 + 1.5;
  vec2 p = mix(a, b, corner.x * 0.5 + 0.5) + t * corner.x * w + n * corner.y * w;
  v_q = vec2((corner.x * 0.5 + 0.5) * (L + 2.0 * w) - w, corner.y * w); v_col = a_col; v_len = L;
  vec2 c = p / u_res * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
  const WIRE_FS = `in vec2 v_q; in vec4 v_col; in float v_len; out vec4 o; uniform float u_w;
void main() { vec2 q = vec2(v_q.x - clamp(v_q.x, 0.0, v_len), v_q.y); float d = length(q) - u_w * 0.5; float a = clamp(0.5 - d, 0.0, 1.0) * v_col.a; if (a <= 0.0) discard; o = vec4(v_col.rgb * a, a); }`;

  S.register({
    id: 'nodes',
    title: 'Node Graph Shader',
    category: 'Selection',
    thumb: 'wide',
    hint: 'drag wires between ports · drag headers to move · add nodes from the bar',
    description: 'A node-based shader editor like those in game engines and compositors. Drag node headers to arrange them, and drag from an output port to a typed input to wire them up; mismatched types and cycles are refused. Grab a connected input to unplug it, and change parameters live. Every edit compiles the graph to GLSL and links a new program at runtime. If KHR_parallel_shader_compile is available, compilation runs in the background and the previous shader keeps rendering until the new one is ready.',
    interact: [['Drag output → input', 'Connect (types must match; cycles refused)'], ['Drag a connected input', 'Unplug / re-route the wire'], ['Drag a node header', 'Move the node'], ['Sliders in nodes', 'Live parameters'], ['+ buttons', 'Add nodes · × removes'], ['Show GLSL', 'See the generated shader source']],
    features: ['Runtime GLSL generation', 'KHR_parallel_shader_compile', 'Typed ports + cycle detection', 'Bézier wires as SDF segments', 'Hot-swapped programs'],
    params: [
      { key: 'code', label: 'Show generated GLSL', type: 'toggle', value: false },
      { key: 'reset', label: 'Reset graph', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const data = new Float32Array(4000 * 8);
      const buf = util.buffer(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const s = {
        ext: gl.getExtension('KHR_parallel_shader_compile'),
        wireP: util.program(WIRE_VS, WIRE_FS), data, buf,
        wireVao: util.vao([{ buffer: buf, loc: 0, size: 4, stride: 32, divisor: 1 }, { buffer: buf, loc: 1, size: 4, stride: 32, offset: 16, divisor: 1 }]),
        nodes: new Map(), links: [], nextId: 1, prog: null, pending: null, status: '', pend: null, ptr: [0, 0],
      };
      ctx.overlay.innerHTML = `
        <div id="ng-wrap" class="cap-keep" style="position:absolute;inset:0;pointer-events:none"></div>
        <div id="ng-bar" style="position:absolute;left:30px;right:30px;top:52px;display:flex;flex-wrap:wrap;gap:6px;pointer-events:auto"></div>
        <select id="ng-add" aria-label="Add node" style="display:none;position:absolute;right:12px;bottom:12px;pointer-events:auto;font:10.5px var(--mono);color:#ece9e2;background:rgba(6,7,8,.85);border:1px solid rgba(236,233,226,.25);padding:3px 4px"><option value="">+ add node</option></select>
        <div class="ov-label" id="ng-status" style="left:34px;top:auto;bottom:64px;transform:none"></div>
        <pre id="ng-code" style="display:none;position:absolute;right:20px;bottom:60px;max-width:46%;max-height:50%;overflow:auto;margin:0;padding:10px 12px;background:rgba(6,7,8,.88);outline:1px solid rgba(236,233,226,.2);font:10.5px/1.6 var(--mono);color:#b9b6ae;pointer-events:auto"></pre>
        <style>
          .ng-node{position:absolute;min-width:136px;background:rgba(11,12,14,.92);outline:1px solid rgba(236,233,226,.18);font:11px var(--mono);color:#ece9e2;pointer-events:auto;user-select:none;transform-origin:0 0}
          .ng-node header{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(236,233,226,.06);cursor:grab;letter-spacing:.06em;text-transform:uppercase;font-size:10px}
          .ng-node header button{background:none;border:0;color:#74757b;cursor:pointer;font:12px var(--mono);padding:0 2px}
          .ng-row{display:flex;align-items:center;gap:6px;padding:4px 8px;position:relative}
          .ng-row.out{justify-content:flex-end}
          .ng-port{width:10px;height:10px;border-radius:50%;border:2px solid;background:#0b0c0e;cursor:crosshair;flex:none;touch-action:none}
          .ng-port.on{background:currentColor}
          .ng-row input[type=range]{width:78px;accent-color:#ff3b4e}
          .ng-row label{color:#b9b6ae}
          #ng-bar button{font:10.5px var(--mono);color:#ece9e2;background:rgba(6,7,8,.7);border:1px solid rgba(236,233,226,.2);padding:4px 8px;cursor:pointer}
          #ng-bar button:hover{border-color:#ff3b4e}
        </style>`;
      s.wrap = ctx.overlay.querySelector('#ng-wrap'); s.statusEl = ctx.overlay.querySelector('#ng-status'); s.codeEl = ctx.overlay.querySelector('#ng-code');
      const bar = ctx.overlay.querySelector('#ng-bar');
      s.bar = bar; s.addSel = ctx.overlay.querySelector('#ng-add');
      Object.keys(TYPES).filter((k) => k !== 'out').forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = TYPES[k].title; s.addSel.appendChild(o); });
      s.addSel.addEventListener('change', () => { if (s.addSel.value) { addNode(ctx, s, s.addSel.value, 0.4, 0.45); compile(ctx, s); } s.addSel.value = ''; });
      Object.keys(TYPES).filter((k) => k !== 'out').forEach((k) => {
        const b = document.createElement('button'); b.textContent = '+ ' + TYPES[k].title;
        b.addEventListener('click', () => { addNode(ctx, s, k, 0.42 + Math.random() * 0.1, 0.4 + Math.random() * 0.2); compile(ctx, s); });
        bar.appendChild(b);
      });
      // global pointer tracking for wire dragging / node moving
      const stagePos = (e) => { const r = ctx.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      s.onMove = (e) => {
        s.ptr = stagePos(e);
        if (s.moving) { const n = s.moving.n; n.x = s.moving.x0 + (e.clientX - s.moving.cx) / s.scale; n.y = s.moving.y0 + (e.clientY - s.moving.cy) / s.scale; place(s, n); }
      };
      s.onUp = (e) => {
        if (s.pend) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const port = el && el.closest && el.closest('.ng-port[data-dir="in"]');
          if (port) connect(ctx, s, s.pend.from, +port.dataset.node, port.dataset.port);
          s.pend = null; compile(ctx, s);
        }
        s.moving = null;
      };
      window.addEventListener('pointermove', s.onMove);
      window.addEventListener('pointerup', s.onUp);
      defaultGraph(ctx, s);
      compile(ctx, s);
      return s;
    },
    resize(ctx, s) { for (const n of s.nodes.values()) place(s, n); },
    action(ctx, s, key) { if (key === 'reset') { defaultGraph(ctx, s); compile(ctx, s); } },
    onParam(ctx, s, key, v) { if (key === 'code') s.codeEl.style.display = v ? 'block' : 'none'; },
    dispose(ctx, s) {
      window.removeEventListener('pointermove', s.onMove); window.removeEventListener('pointerup', s.onUp);
      const gl = ctx.gl; if (s.prog) gl.deleteProgram(s.prog.p); if (s.pending) gl.deleteProgram(s.pending.p);
    },
    frame(ctx, s, t, dt) {
      const { gl } = ctx;
      // compact (e.g. live inside a grid card): smaller nodes, add-bar collapses to a menu
      const compact = ctx.cssWidth < 640;
      const sc = compact ? Math.max(0.42, ctx.cssWidth / 900) : Math.min(1, Math.max(0.62, ctx.cssWidth / 1000));
      if (sc !== s.scale) { s.scale = sc; for (const n of s.nodes.values()) place(s, n); }
      s.bar.style.display = compact ? 'none' : 'flex'; s.addSel.style.display = compact ? 'block' : 'none'; s.statusEl.style.display = compact ? 'none' : '';
      // finish a background compile when the driver reports completion
      if (s.pending) {
        const done = !s.ext || gl.getProgramParameter(s.pending.p, s.ext.COMPLETION_STATUS_KHR);
        if (done) {
          if (gl.getProgramParameter(s.pending.p, gl.LINK_STATUS)) {
            if (s.prog) gl.deleteProgram(s.prog.p);
            s.prog = s.pending; s.status = `compiled in ${(performance.now() - s.pending.t0).toFixed(1)} ms${s.ext ? ' · parallel (KHR_parallel_shader_compile)' : ' · synchronous'}`;
          } else {
            const log = gl.getShaderInfoLog(s.pending.fs) || gl.getProgramInfoLog(s.pending.p);
            s.status = 'compile error · ' + String(log).split('\n')[0];
            gl.deleteProgram(s.pending.p);
          }
          gl.deleteShader(s.pending.vs); gl.deleteShader(s.pending.fs);
          s.pending = null;
        } else s.status = 'compiling in the background… previous shader still live';
      }
      gl.viewport(0, 0, ctx.width, ctx.height);
      if (s.prog) {
        gl.useProgram(s.prog.p);
        gl.uniform1f(s.prog.ut, t); gl.uniform1f(s.prog.ua, ctx.aspect);
        ctx.util.drawFullscreen();
      } else { gl.clearColor(0.03, 0.03, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      // wires
      const sr = ctx.canvas.getBoundingClientRect();
      const portXY = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top]; };
      const segs = [];
      const curve = (a, b, col) => {
        const dx = Math.max(40, Math.abs(b[0] - a[0]) * 0.5);
        const c1 = [a[0] + dx, a[1]], c2 = [b[0] - dx, b[1]];
        let prev = a;
        for (let k = 1; k <= 24; k++) {
          const u = k / 24, v = 1 - u;
          const p = [v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0], v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1]];
          segs.push([prev[0], prev[1], p[0], p[1], ...col]); prev = p;
        }
      };
      const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 1];
      for (const l of s.links) {
        const a = s.nodes.get(l.from), b = s.nodes.get(l.to);
        if (!a || !b) continue;
        const pa = a.el.querySelector('.ng-port[data-dir="out"]'), pb = b.el.querySelector(`.ng-port[data-dir="in"][data-port="${l.port}"]`);
        if (pa && pb) curve(portXY(pa), portXY(pb), hex(TCOL[TYPES[a.type].out]));
      }
      if (s.pend) { const a = s.nodes.get(s.pend.from); const pa = a && a.el.querySelector('.ng-port[data-dir="out"]'); if (pa) curve(portXY(pa), s.ptr, [0.93, 0.91, 0.87, 0.8]); }
      const n = Math.min(segs.length, 4000);
      segs.slice(0, n).forEach((g, i) => s.data.set(g, i * 8));
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data, 0, n * 8);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      s.wireP.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_w: 2.2 });
      gl.bindVertexArray(s.wireVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
      s.statusEl.textContent = `${s.nodes.size} nodes · ${s.links.length} wires · ${s.status}`;
    },
  });

  function addNode(ctx, s, type, fx, fy, params) {
    const T = TYPES[type], id = s.nextId++;
    const n = { id, type, fx, fy, x: 0, y: 0, params: {} };
    for (const k in T.params || {}) n.params[k] = params && k in params ? params[k] : T.params[k][2];
    const el = document.createElement('div');
    el.className = 'ng-node';
    el.innerHTML = `<header><span>${T.title}</span>${type === 'out' ? '' : '<button aria-label="Remove node">×</button>'}</header>`
      + (T.ins || []).map(([nm, ty]) => `<div class="ng-row"><span class="ng-port" data-dir="in" data-node="${id}" data-port="${nm}" style="color:${TCOL[ty]}"></span><label>${nm}</label></div>`).join('')
      + Object.keys(T.params || {}).map((k) => { const [mn, mx] = T.params[k]; return `<div class="ng-row"><label>${k}</label><input type="range" min="${mn}" max="${mx}" step="${(mx - mn) / 200}" value="${n.params[k]}" data-k="${k}"></div>`; }).join('')
      + (T.out ? `<div class="ng-row out"><label>${T.out}</label><span class="ng-port" data-dir="out" data-node="${id}" style="color:${TCOL[T.out]}"></span></div>` : '');
    s.wrap.appendChild(el);
    n.el = el;
    el.querySelector('header').addEventListener('pointerdown', (e) => { if (e.target.tagName === 'BUTTON') return; e.preventDefault(); s.moving = { n, x0: n.x, y0: n.y, cx: e.clientX, cy: e.clientY }; });
    const del = el.querySelector('header button');
    if (del) del.addEventListener('click', () => { s.links = s.links.filter((l) => l.from !== id && l.to !== id); el.remove(); s.nodes.delete(id); compile(ctx, s); });
    el.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => { n.params[inp.dataset.k] = +inp.value; compile(ctx, s); }));
    el.querySelectorAll('.ng-port').forEach((p) => p.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = ctx.canvas.getBoundingClientRect(); s.ptr = [e.clientX - r.left, e.clientY - r.top];
      if (p.dataset.dir === 'out') s.pend = { from: id };
      else { const l = s.links.find((k) => k.to === id && k.port === p.dataset.port); if (l) { s.links = s.links.filter((k) => k !== l); s.pend = { from: l.from }; compile(ctx, s); } }
    }));
    s.nodes.set(id, n);
    n.x = fx * ctx.cssWidth; n.y = fy * ctx.cssHeight;
    place(s, n);
    return id;
  }
  function place(s, n) { n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px'; n.el.style.transform = `scale(${s.scale || 1})`; }
  function connect(ctx, s, from, to, port) {
    if (from === to) return;
    const A = s.nodes.get(from), B = s.nodes.get(to);
    const inType = (TYPES[B.type].ins || []).find((x) => x[0] === port)[1];
    if (!compatible(TYPES[A.type].out, inType)) { flash(s, `can't connect ${TYPES[A.type].out} → ${inType}`); return; }
    // refuse cycles: is `from` reachable downstream of `to`?
    const seen = new Set(), stack = [to];
    while (stack.length) { const x = stack.pop(); if (x === from) { flash(s, 'that link would create a cycle'); return; } if (seen.has(x)) continue; seen.add(x); s.links.filter((l) => l.from === x).forEach((l) => stack.push(l.to)); }
    s.links = s.links.filter((l) => !(l.to === to && l.port === port));
    s.links.push({ from, to, port });
  }
  function flash(s, msg) { s.status = msg; }
  function generate(s) {
    const lines = [], done = new Map();
    const outType = (id) => TYPES[s.nodes.get(id).type].out;
    const expr = (id) => {
      if (done.has(id)) return done.get(id);
      const n = s.nodes.get(id), T = TYPES[n.type], ins = {};
      (T.ins || []).forEach(([nm, ty]) => {
        const l = s.links.find((k) => k.to === id && k.port === nm);
        if (l && s.nodes.has(l.from)) { let e = expr(l.from); if (ty === 'color' && outType(l.from) === 'float') e = `vec3(${e})`; ins[nm] = e; } else ins[nm] = DEF[ty];
      });
      const v = 'n' + id;
      lines.push(`${GT[T.out]} ${v} = ${T.glsl(ins, n.params)};`);
      done.set(id, v);
      return v;
    };
    const outNode = [...s.nodes.values()].find((n) => n.type === 'out');
    const l = outNode && s.links.find((k) => k.to === outNode.id);
    let col = 'vec3(0.03)';
    if (l && s.nodes.has(l.from)) { col = expr(l.from); const ty = outType(l.from); if (ty === 'float') col = `vec3(${col})`; else if (ty === 'vec2') col = `vec3(${col} * 0.5 + 0.5, 0.0)`; }
    return HEAD + lines.join('\n  ') + `\n  o = vec4((${col}) * (0.9 - 0.45 * dot(v_p, v_p)), 1.0);\n}`;
  }
  function compile(ctx, s) {
    const gl = ctx.gl;
    if (s.pending) { gl.deleteProgram(s.pending.p); gl.deleteShader(s.pending.vs); gl.deleteShader(s.pending.fs); s.pending = null; }
    const src = generate(s);
    s.codeEl.textContent = src.slice(src.indexOf('void main'));
    const PRE = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
    const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, PRE + S.GLSL.fullscreenVS); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, PRE + src); gl.compileShader(fs);
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    // no status query here: with KHR_parallel_shader_compile that would force a synchronous wait
    s.pending = { p, vs, fs, t0: performance.now(), ut: null, ua: null };
    const finish = s.pending;
    Object.defineProperty(finish, 'ut', { get() { return this._ut ?? (this._ut = gl.getUniformLocation(p, 'u_time')); } });
    Object.defineProperty(finish, 'ua', { get() { return this._ua ?? (this._ua = gl.getUniformLocation(p, 'u_aspect')); } });
  }
  function defaultGraph(ctx, s) {
    for (const n of s.nodes.values()) n.el.remove();
    s.nodes.clear(); s.links = []; s.nextId = 1;
    const uv = addNode(ctx, s, 'uv', 0.03, 0.2), time = addNode(ctx, s, 'time', 0.03, 0.42, { speed: 0.8 });
    const warp = addNode(ctx, s, 'warp', 0.2, 0.22), noise = addNode(ctx, s, 'noise', 0.37, 0.16), rings = addNode(ctx, s, 'rings', 0.37, 0.44);
    const mul = addNode(ctx, s, 'mul', 0.53, 0.28), con = addNode(ctx, s, 'contrast', 0.53, 0.48, { edge: 0.4, soft: 0.3 });
    const red = addNode(ctx, s, 'red', 0.53, 0.72), blue = addNode(ctx, s, 'blue', 0.66, 0.74);
    const mix = addNode(ctx, s, 'mix', 0.7, 0.36), out = addNode(ctx, s, 'out', 0.85, 0.4);
    [[uv, warp, 'p'], [time, warp, 't'], [warp, noise, 'p'], [warp, rings, 'p'], [time, rings, 't'], [noise, mul, 'a'], [rings, mul, 'b'], [mul, con, 'v'], [blue, mix, 'a'], [red, mix, 'b'], [con, mix, 't'], [mix, out, 'color']]
      .forEach(([a, b, p]) => s.links.push({ from: a, to: b, port: p }));
  }
})();
