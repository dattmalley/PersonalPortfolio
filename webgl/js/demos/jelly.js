/* Jelly Grid — CPU mass-spring (Verlet + constraint relaxation) mesh,
 * streamed to the GPU each frame. Grab nodes with any number of pointers. */
(function () {
  const S = window.Sandbox;

  const VS = S.GLSL.colors + `
layout(location = 0) in vec3 a_p;   // x, y (css px), stretch
uniform vec2 u_res; uniform float u_size;
out vec3 v_col;
void main() {
  vec2 c = a_p.xy / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  gl_PointSize = u_size;
  float s = clamp(a_p.z, 0.0, 1.0);
  v_col = mix(BLUE * 0.85, RED, s) + s * 0.25;
}`;
  const FS = `
in vec3 v_col; out vec4 o; uniform float u_alpha; uniform bool u_round;
void main() {
  if (u_round) { vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; }
  o = vec4(v_col * u_alpha, u_alpha);
}`;

  function build(ctx, s) {
    const { gl, util } = ctx;
    const W = ctx.cssWidth, H = ctx.cssHeight;
    const cols = Math.max(8, Math.round(W / 26)), rows = Math.max(6, Math.round(H / 26));
    const mx = W * 0.08, my = H * 0.1;
    const sx = (W - 2 * mx) / (cols - 1), sy = (H - 2 * my) / (rows - 1);
    const n = cols * rows;
    s.cols = cols; s.rows = rows; s.n = n;
    s.pos = new Float32Array(n * 2); s.prev = new Float32Array(n * 2); s.rest = new Float32Array(n * 2);
    s.pinned = new Uint8Array(n);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      s.rest[k * 2] = mx + i * sx; s.rest[k * 2 + 1] = my + j * sy;
      s.pinned[k] = i === 0 || j === 0 || i === cols - 1 || j === rows - 1 ? 1 : 0;
    }
    s.pos.set(s.rest); s.prev.set(s.rest);
    const links = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (i < cols - 1) links.push(k, k + 1);
      if (j < rows - 1) links.push(k, k + cols);
    }
    s.links = new Uint32Array(links);
    s.restLen = new Float32Array(links.length / 2);
    for (let l = 0; l < s.restLen.length; l++) {
      const a = links[l * 2], b = links[l * 2 + 1];
      s.restLen[l] = Math.hypot(s.rest[a * 2] - s.rest[b * 2], s.rest[a * 2 + 1] - s.rest[b * 2 + 1]);
    }
    s.verts = new Float32Array(n * 3);
    if (s.vbo) util.release(s.vbo, s.ibo, s.vao);
    s.vbo = util.buffer(gl.ARRAY_BUFFER, s.verts.byteLength, gl.DYNAMIC_DRAW);
    s.ibo = util.buffer(gl.ELEMENT_ARRAY_BUFFER, s.links, gl.STATIC_DRAW);
    s.vao = util.vao([{ buffer: s.vbo, loc: 0, size: 3 }], s.ibo);
    s.grabs = new Map();
  }

  S.register({
    id: 'jelly',
    title: 'Jelly Grid',
    category: 'Pointer & Touch',
    hint: 'grab and fling the mesh',
    description: 'A soft-body grid solved on the CPU with Verlet integration and iterative distance constraints, then streamed into a dynamic vertex buffer every frame. Each pointer can grab its own node, so multi-touch pulls the mesh several ways at once. Color shows local stretch.',
    interact: [['Drag', 'Grab the nearest node and pull'], ['Release', 'The mesh springs back with momentum'], ['Multi-touch', 'Grab several nodes at once']],
    features: ['Dynamic buffers (bufferSubData)', 'Uint32 element indices', 'gl.LINES + gl.POINTS', 'Additive blending'],
    params: [
      { key: 'stiff', label: 'Stiffness (iterations)', type: 'range', min: 1, max: 20, step: 1, value: 8 },
      { key: 'memory', label: 'Shape memory', type: 'range', min: 0, max: 0.2, step: 0.005, value: 0.04 },
      { key: 'damping', label: 'Damping', type: 'range', min: 0.9, max: 0.999, step: 0.001, value: 0.985 },
      { key: 'gravity', label: 'Gravity', type: 'range', min: 0, max: 1500, step: 10, value: 0 },
      { key: 'pins', label: 'Pin all edges', type: 'toggle', value: true },
      { key: 'shake', label: 'Shake', type: 'button' },
    ],
    init(ctx) {
      const s = { prog: ctx.util.program(VS, FS) };
      build(ctx, s);
      return s;
    },
    resize(ctx, s) { build(ctx, s); },
    action(ctx, s, key) {
      if (key === 'shake') for (let k = 0; k < s.n; k++) if (!s.pinned[k]) { s.prev[k * 2] -= (Math.random() - 0.5) * 30; s.prev[k * 2 + 1] -= (Math.random() - 0.5) * 30; }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      const { pos, prev, rest, n, cols, rows } = s;
      const isPinned = (k) => {
        if (params.pins) return s.pinned[k];
        return k < cols && k % 3 === 0 ? 1 : 0; // only some top-row nodes: a hanging cloth
      };
      // grabs
      for (const [id] of s.grabs) if (!input.pointers.has(id)) s.grabs.delete(id);
      for (const p of input.pointers.values()) {
        if (!s.grabs.has(p.id)) {
          let best = -1, bd = 60 * 60;
          for (let k = 0; k < n; k++) {
            const d = (pos[k * 2] - p.x) ** 2 + (pos[k * 2 + 1] - p.y) ** 2;
            if (d < bd) { bd = d; best = k; }
          }
          if (best >= 0) s.grabs.set(p.id, best);
        }
      }
      const h = Math.min(dt, 1 / 30);
      const fr = Math.pow(params.damping, h * 60);
      for (let k = 0; k < n; k++) {
        if (isPinned(k)) { pos[k * 2] = rest[k * 2]; pos[k * 2 + 1] = rest[k * 2 + 1]; prev[k * 2] = pos[k * 2]; prev[k * 2 + 1] = pos[k * 2 + 1]; continue; }
        const x = pos[k * 2], y = pos[k * 2 + 1];
        let vx = (x - prev[k * 2]) * fr, vy = (y - prev[k * 2 + 1]) * fr;
        vx += (rest[k * 2] - x) * params.memory;
        vy += (rest[k * 2 + 1] - y) * params.memory + params.gravity * h * h;
        prev[k * 2] = x; prev[k * 2 + 1] = y;
        pos[k * 2] = x + vx; pos[k * 2 + 1] = y + vy;
      }
      const L = s.links, RL = s.restLen;
      for (let it = 0; it < params.stiff; it++) {
        for (let l = 0; l < RL.length; l++) {
          const a = L[l * 2], b = L[l * 2 + 1];
          const dx = pos[b * 2] - pos[a * 2], dy = pos[b * 2 + 1] - pos[a * 2 + 1];
          const d = Math.hypot(dx, dy) || 1e-6;
          const diff = (d - RL[l]) / d * 0.5;
          const pa = isPinned(a), pb = isPinned(b);
          if (pa && pb) continue;
          const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
          pos[a * 2] += dx * diff * wa * 2; pos[a * 2 + 1] += dy * diff * wa * 2;
          pos[b * 2] -= dx * diff * wb * 2; pos[b * 2 + 1] -= dy * diff * wb * 2;
        }
        for (const [id, k] of s.grabs) {
          const p = input.pointers.get(id);
          if (p && !isPinned(k)) { pos[k * 2] = p.x; pos[k * 2 + 1] = p.y; }
        }
      }
      // idle wobble so the mesh is alive without input
      if (!input.down) {
        const k = Math.floor(rows / 2) * cols + Math.floor(cols / 2 + Math.sin(t * 0.7) * cols * 0.3);
        if (!isPinned(k)) pos[k * 2 + 1] += Math.sin(t * 3.1) * 0.6;
      }
      for (let k = 0; k < n; k++) {
        const st = Math.hypot(pos[k * 2] - rest[k * 2], pos[k * 2 + 1] - rest[k * 2 + 1]) / 90;
        s.verts[k * 3] = pos[k * 2]; s.verts[k * 3 + 1] = pos[k * 2 + 1]; s.verts[k * 3 + 2] = st;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.verts);

      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.027, 0.031, 0.047, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(s.vao);
      s.prog.use().set({ u_res: [ctx.cssWidth, ctx.cssHeight], u_size: 4 * ctx.dpr, u_alpha: 0.75, u_round: false });
      gl.drawElements(gl.LINES, s.links.length, gl.UNSIGNED_INT, 0);
      s.prog.set({ u_alpha: 1, u_round: true });
      gl.drawArrays(gl.POINTS, 0, n);
      gl.disable(gl.BLEND);
    },
  });
})();
