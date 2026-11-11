/* Voxel Builder — place, erase and paint blocks on a 24×14×24 grid. Picking is
 * an exact grid ray-march (Amanatides–Woo DDA) that reports the hit cell and
 * the face normal; blocks render as one instanced draw with a pop-in spring. */
(function () {
  const S = window.Sandbox;
  const { M4, V3 } = S.math;
  const GX = 24, GY = 14, GZ = 24;
  const PALETTE = [[1.0, 0.231, 0.306], [0.231, 0.545, 1.0], [0.9, 0.88, 0.84], [0.32, 0.33, 0.37], [0.12, 0.12, 0.14]];
  const NAMES = ['Red', 'Blue', 'Bone', 'Graphite', 'Ink'];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_v;   // x, y, z, colour index
layout(location = 3) in float a_born;
uniform mat4 u_vp; uniform float u_time; uniform vec3 u_pal[5];
out vec3 v_n; out vec3 v_col; out vec3 v_l; out vec3 v_w;
void main() {
  float age = u_time - a_born;
  float s = age < 0.0 ? 1.0 : 1.0 - exp(-age * 9.0) * cos(age * 22.0) * 0.6;   // springy pop-in
  vec3 c = a_v.xyz + 0.5;
  vec3 w = c + a_pos * s;
  v_n = a_nrm; v_col = u_pal[int(a_v.w)]; v_l = a_pos; v_w = w;
  gl_Position = u_vp * vec4(w, 1.0);
}`;
  const FS = `
in vec3 v_n; in vec3 v_col; in vec3 v_l; in vec3 v_w; out vec4 o;
uniform vec4 u_ghost; uniform vec3 u_eye;
void main() {
  vec3 n = normalize(v_n);
  float d = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.35, 0.9, 0.45))), 0.0);
  d *= 0.85 + 0.15 * n.y;
  vec3 a = abs(v_l) * 2.0;
  float edge = smoothstep(0.92, 0.98, max(max(min(a.x, a.y), min(a.y, a.z)), min(a.x, a.z)));   // bevel line
  vec3 c = v_col * d * (1.0 - edge * 0.35);
  float fog = 1.0 - exp(-length(v_w - u_eye) * 0.012);
  o = vec4(mix(c, vec3(0.03, 0.032, 0.042), fog), 1.0);
}`;
  const GHOST_FS = `out vec4 o; uniform vec4 u_col; void main() { o = u_col; }`;
  const GHOST_VS = `layout(location = 0) in vec3 a_pos; uniform mat4 u_vp; uniform vec3 u_cell; uniform float u_s; void main() { gl_Position = u_vp * vec4(u_cell + 0.5 + a_pos * u_s, 1.0); }`;

  // Amanatides & Woo grid traversal
  function raycast(grid, o, d) {
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const sx = Math.sign(d[0]), sy = Math.sign(d[1]), sz = Math.sign(d[2]);
    const tdx = Math.abs(1 / d[0]), tdy = Math.abs(1 / d[1]), tdz = Math.abs(1 / d[2]);
    let tx = (sx > 0 ? x + 1 - o[0] : o[0] - x) * tdx, ty = (sy > 0 ? y + 1 - o[1] : o[1] - y) * tdy, tz = (sz > 0 ? z + 1 - o[2] : o[2] - z) * tdz;
    let n = [0, 0, 0];
    for (let i = 0; i < 200; i++) {
      if (x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ && grid[(y * GZ + z) * GX + x]) return { cell: [x, y, z], n };
      if (tx < ty && tx < tz) { x += sx; tx += tdx; n = [-sx, 0, 0]; }
      else if (ty < tz) { y += sy; ty += tdy; n = [0, -sy, 0]; }
      else { z += sz; tz += tdz; n = [0, 0, -sz]; }
      if (y < -1 && sy < 0) break;
    }
    // fall back to the floor plane y = 0
    if (d[1] < 0) { const t = -o[1] / d[1]; const p = V3.add(o, V3.scale(d, t)); const c = [Math.floor(p[0]), -1, Math.floor(p[2])]; if (c[0] >= 0 && c[2] >= 0 && c[0] < GX && c[2] < GZ) return { cell: c, n: [0, 1, 0], floor: true }; }
    return null;
  }

  S.register({
    id: 'voxels',
    title: 'Voxel Builder',
    category: 'Selection',
    thumb: 'tall',
    hint: 'click to build · Shift/right-click to erase · Alt-click picks colour · 1–5 colours',
    description: 'A block builder. The cell under the cursor is found by an exact grid traversal (Amanatides–Woo DDA) that steps voxel by voxel along the ray and reports which face it entered, so a click places a new block against that face. Hold and drag to build continuously, erase, recolour, mirror across the X axis, or undo. Thousands of blocks draw in one instanced call with a springy pop-in.',
    interact: [['Click / drag', 'Place blocks on the face under the cursor'], ['Shift / right-click', 'Erase'], ['Alt-click', 'Eyedropper'], ['1 – 5', 'Choose colour'], ['Orbit tool / two fingers', 'Orbit (right-drag erases)'], ['Ctrl+Z', 'Undo']],
    features: ['DDA voxel ray traversal', 'Face-normal placement', 'Instanced cubes + spring pop-in', 'Uniform array palette', 'Undo history'],
    params: [
      { key: 'tool', label: 'Tool', type: 'select', options: ['Build', 'Erase', 'Paint', 'Orbit'], value: 0 },
      { key: 'color', label: 'Colour', type: 'select', options: NAMES, value: 0 },
      { key: 'mirror', label: 'Mirror X', type: 'toggle', value: false },
      { key: 'undo', label: 'Undo', type: 'button' },
      { key: 'clear', label: 'Clear', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const MAXV = GX * GY * GZ;
      const instBuf = util.buffer(gl.ARRAY_BUFFER, MAXV * 16, gl.DYNAMIC_DRAW), bornBuf = util.buffer(gl.ARRAY_BUFFER, MAXV * 4, gl.DYNAMIC_DRAW);
      const s = {
        prog: util.program(VS, FS), ghostP: util.program(GHOST_VS, GHOST_FS),
        vao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: instBuf, loc: 2, size: 4, divisor: 1 }, { buffer: bornBuf, loc: 3, size: 1, divisor: 1 }]),
        cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }]),
        instBuf, bornBuf, grid: new Uint8Array(MAXV), born: new Float32Array(MAXV).fill(-10), count: 0, dirty: true, history: [], last: null,
        cam: new S.OrbitCam({ dist: 34, pitch: 0.6, yaw: 0.75, minDist: 10, maxDist: 70, target: [GX / 2, 2, GZ / 2], auto: 0.03 }),
      };
      seed(s);
      ctx.overlay.innerHTML = '<div class="ov-label" id="vx-read" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      s.read = ctx.overlay.querySelector('#vx-read');
      return s;
    },
    action(ctx, s, key) {
      if (key === 'undo') undo(s);
      if (key === 'clear') { s.history.push(s.grid.slice()); s.grid.fill(0); for (let x = 0; x < GX; x++) for (let z = 0; z < GZ; z++) s.grid[(0 * GZ + z) * GX + x] = 3; s.dirty = true; }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      for (let i = 0; i < 5; i++) if (input.pressed.has('Digit' + (i + 1))) ctx.syncParam('color', i);
      const k = input.keys;
      if (input.pressed.has('KeyZ') && (k.has('ControlLeft') || k.has('MetaLeft'))) undo(s);
      const orbit = params.tool === 3 || input.pointers.size >= 2;
      s.cam.update(orbit ? input : Object.assign({}, input, { dragging: false }), dt);
      const r = s.cam.ray(input.nx, input.ny, ctx.aspect);
      const hit = input.hover || input.down ? raycast(s.grid, r.origin, r.dir) : null;
      const erase = params.tool === 1 || input.shift || input.button === 2;
      const alt = k.has('AltLeft') || k.has('AltRight');
      const id = (c) => (c[1] * GZ + c[2]) * GX + c[0];
      const inb = (c) => c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < GX && c[1] < GY && c[2] < GZ;
      const apply = (c, v) => {
        const cells = [c]; if (params.mirror) cells.push([GX - 1 - c[0], c[1], c[2]]);
        for (const q of cells) if (inb(q)) { s.grid[id(q)] = v; s.born[id(q)] = v ? t : -10; }
        s.dirty = true;
      };
      let target = null;
      if (hit && !orbit) {
        if (alt) target = hit.floor ? null : { cell: hit.cell, kind: 'pick' };
        else if (erase) target = hit.floor ? null : { cell: hit.cell, kind: 'erase' };
        else if (params.tool === 2) target = hit.floor ? null : { cell: hit.cell, kind: 'paint' };
        else { const c = V3.add(hit.cell, hit.n); if (inb(c)) target = { cell: c, kind: 'build' }; }
      }
      // act on press, and keep acting while dragging onto new cells
      if (input.down && !orbit && target) {
        const key = target.cell.join(',');
        if (!s.pressing) { s.history.push(s.grid.slice()); if (s.history.length > 40) s.history.shift(); s.pressing = true; s.last = null; }
        if (key !== s.last) {
          if (target.kind === 'pick') ctx.syncParam('color', s.grid[id(target.cell)] - 1);
          else if (target.kind === 'erase') apply(target.cell, 0);
          else apply(target.cell, params.color + 1);
          s.last = target.kind === 'build' ? V3.sub(target.cell, hit.n).join(',') : key;
          s.last = key;
        }
      }
      if (!input.down) s.pressing = false;

      if (s.dirty) {
        const data = new Float32Array(s.grid.length * 4), born = new Float32Array(s.grid.length);
        let n = 0;
        for (let y = 0; y < GY; y++) for (let z = 0; z < GZ; z++) for (let x = 0; x < GX; x++) {
          const v = s.grid[(y * GZ + z) * GX + x];
          if (!v) continue;
          data.set([x, y, z, v - 1], n * 4); born[n] = s.born[(y * GZ + z) * GX + x]; n++;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, s.instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, s.bornBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, born, 0, n);
        s.count = n; s.dirty = false;
      }
      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.5, 200), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.03, 0.032, 0.042, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.prog.use().set({ u_vp: vp, u_time: t, u_pal: new Float32Array(PALETTE.flat()), u_eye: s.cam.eye() });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, s.count);
      if (target) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        const c = target.kind === 'erase' ? [0.5, 0.06, 0.08, 0.5] : target.kind === 'pick' ? [0.4, 0.4, 0.4, 0.4] : [...PALETTE[params.color].map((v) => v * 0.45), 0.45];
        s.ghostP.use().set({ u_vp: vp, u_cell: target.cell, u_s: target.kind === 'build' ? 1.0 : 1.04, u_col: c });
        gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
        if (params.mirror) { s.ghostP.set({ u_cell: [GX - 1 - target.cell[0], target.cell[1], target.cell[2]] }); gl.drawArrays(gl.TRIANGLES, 0, 36); }
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.disable(gl.DEPTH_TEST);
      s.read.textContent = `${s.count.toLocaleString()} blocks · ${['build', 'erase', 'paint', 'orbit'][params.tool]} · ${NAMES[params.color]}${target ? ` · cell ${target.cell.join(', ')}` : ''}`;
    },
  });

  function undo(s) { const g = s.history.pop(); if (g) { s.grid.set(g); s.dirty = true; } }
  function seed(s) {
    const set = (x, y, z, v) => { if (x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ) s.grid[(y * GZ + z) * GX + x] = v; };
    for (let x = 0; x < GX; x++) for (let z = 0; z < GZ; z++) set(x, 0, z, (x + z) % 2 ? 4 : 5);
    // a small red-and-blue tower and arch
    for (let y = 1; y < 8; y++) for (let x = 6; x < 9; x++) for (let z = 6; z < 9; z++) if (x === 7 && z === 7 ? true : y % 3 !== 0 || x !== 7) set(x, y, z, y > 5 ? 1 : 4);
    for (let y = 1; y < 5; y++) { set(14, y, 12, 2); set(18, y, 12, 2); }
    for (let x = 14; x <= 18; x++) set(x, 5, 12, 2);
    for (let x = 15; x <= 17; x++) set(x, 6, 12, 3);
    for (let i = 0; i < 9; i++) set(10 + i, 1, 18, i % 2 ? 1 : 2);
  }
})();
