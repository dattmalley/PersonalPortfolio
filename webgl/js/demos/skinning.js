/* IK Tentacles — skeletal animation. Each tentacle is a 14-bone chain solved
 * with FABRIK inverse kinematics toward the pointer; bone matrices go into a
 * Uniform Buffer Object and the vertex shader skins every vertex using integer
 * joint indices. All tentacles render in a single instanced draw. */
(function () {
  const S = window.Sandbox;
  const { V3, M4, damp } = S.math;
  const NT = 7, NB = 14, L = 0.3, LEN = NB * L;

  const VS = S.GLSL.colors + `
layout(std140) uniform Bones { mat4 u_bones[${NT * NB}]; };
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in uvec2 a_joint;  // integer bone indices
layout(location = 3) in vec2 a_weight;
uniform mat4 u_vp;
out vec3 v_n; out vec3 v_w; out vec3 v_rest; flat out int v_id;
void main() {
  uint base = uint(gl_InstanceID) * ${NB}u;
  mat4 m = u_bones[base + a_joint.x] * a_weight.x + u_bones[base + a_joint.y] * a_weight.y;
  vec4 w = m * vec4(a_pos, 1.0);
  v_n = mat3(m) * a_nrm; v_w = w.xyz; v_rest = a_pos; v_id = gl_InstanceID;
  gl_Position = u_vp * w;
}`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; in vec3 v_rest; flat in int v_id; out vec4 o;
uniform vec3 u_eye; uniform float u_len; uniform float u_time; uniform float u_grip;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w), L = normalize(vec3(0.3, 0.9, 0.5));
  float k = v_rest.y / u_len;
  vec3 tip = (v_id % 2 == 0) ? RED : BLUE;
  vec3 alb = mix(vec3(0.12, 0.11, 0.13), tip, smoothstep(0.15, 1.0, k));
  // suckers along the inner face
  float ang = atan(v_rest.z, v_rest.x);
  float side = smoothstep(0.9, 0.4, abs(ang + 1.5708));
  float suck = smoothstep(0.42, 0.28, length(vec2(fract(k * 34.0) - 0.5, (ang + 1.5708) * 1.6))) * side;
  alb = mix(alb, vec3(0.9, 0.82, 0.8), suck * 0.6);
  float dif = max(dot(n, L), 0.0);
  float sp = pow(max(dot(reflect(-L, n), V), 0.0), 32.0) * 0.5;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  float pulse = smoothstep(0.0, 0.05, sin(k * 18.0 - u_time * 6.0) - 0.9) * (0.3 + u_grip * 0.7);
  vec3 c = alb * (0.2 + 0.8 * dif) + sp + fres * tip * 0.6 + pulse * tip * k;
  o = vec4(c, 1.0);
}`;
  const BODY_FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; out vec4 o; uniform vec3 u_eye;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.0);
  float dif = max(dot(n, normalize(vec3(0.3, 0.9, 0.5))), 0.0);
  o = vec4(vec3(0.1, 0.1, 0.12) * (0.3 + dif) + fres * mix(RED, BLUE, 0.5) * 0.5, 1.0);
}`;
  const BODY_VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp;
out vec3 v_n; out vec3 v_w;
void main() { vec3 p = a_pos * vec3(1.0, 0.45, 1.0); v_n = normalize(a_nrm * vec3(1.0, 2.2, 1.0)); v_w = p; gl_Position = u_vp * vec4(p, 1.0); }`;

  // Tapered tube along +Y, skinned to two bones per vertex.
  function tentacleMesh() {
    const RINGS = NB * 6, SEG = 18;
    const pos = [], nrm = [], joint = [], weight = [], idx = [];
    for (let i = 0; i <= RINGS; i++) {
      const y = (i / RINGS) * LEN;
      const k = y / LEN;
      const r = 0.2 * Math.pow(1 - k, 0.85) + 0.018;
      const j = Math.min(Math.floor(y / L), NB - 1), tt = y / L - j;
      let other, wo;
      if (tt < 0.5) { other = Math.max(j - 1, 0); wo = 0.5 * (1 - smooth(0, 0.5, tt)); } else { other = Math.min(j + 1, NB - 1); wo = 0.5 * smooth(0.5, 1, tt); }
      for (let q = 0; q <= SEG; q++) {
        const a = (q / SEG) * Math.PI * 2;
        const cx = Math.cos(a), cz = Math.sin(a);
        pos.push(cx * r, y, cz * r); nrm.push(cx, 0.08, cz);
        joint.push(j, other); weight.push(1 - wo, wo);
      }
    }
    for (let i = 0; i < RINGS; i++) for (let q = 0; q < SEG; q++) {
      const a = i * (SEG + 1) + q, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), joint: new Uint8Array(joint), weight: new Float32Array(weight), idx: new Uint16Array(idx) };
  }
  function smooth(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }

  // Rotate v about unit axis k by angle with cos c, sin s (Rodrigues).
  function rot(v, k, c, s) {
    const d = V3.dot(k, v), cr = V3.cross(k, v);
    return [v[0] * c + cr[0] * s + k[0] * d * (1 - c), v[1] * c + cr[1] * s + k[1] * d * (1 - c), v[2] * c + cr[2] * s + k[2] * d * (1 - c)];
  }

  S.register({
    id: 'skinning',
    title: 'IK Tentacles',
    category: 'Animation',
    hint: 'move to beckon · hold to grab',
    description: 'Seven tentacles, each a 14-bone skeleton solved every frame with FABRIK inverse kinematics so the tips reach for the pointer. Bone matrices are built with parallel-transport frames to stop twisting and uploaded to a Uniform Buffer Object. The vertex shader blends two bones per vertex using integer joint indices. All seven draw in one instanced call.',
    interact: [['Move', 'Tentacles lean and reach toward the pointer'], ['Hold', 'Grab: every tip converges on the pointer'], ['Drag', 'Orbit'], ['Idle', 'Tentacles sway on their own']],
    features: ['GPU skeletal skinning', 'Bone matrices in a UBO', 'Integer joint indices (uvec2)', 'FABRIK inverse kinematics', 'drawElementsInstanced'],
    params: [
      { key: 'reach', label: 'Attention', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55 },
      { key: 'follow', label: 'Follow speed', type: 'range', min: 1, max: 20, step: 0.5, value: 6 },
      { key: 'sway', label: 'Idle sway', type: 'range', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'bones', label: 'Show skeleton', type: 'toggle', value: false },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const m = tentacleMesh();
      const vao = util.vao([
        { buffer: util.buffer(gl.ARRAY_BUFFER, m.pos), loc: 0, size: 3 },
        { buffer: util.buffer(gl.ARRAY_BUFFER, m.nrm), loc: 1, size: 3 },
        { buffer: util.buffer(gl.ARRAY_BUFFER, m.joint), loc: 2, size: 2, type: gl.UNSIGNED_BYTE, integer: true },
        { buffer: util.buffer(gl.ARRAY_BUFFER, m.weight), loc: 3, size: 2 },
      ], util.buffer(gl.ELEMENT_ARRAY_BUFFER, m.idx));
      const chains = [];
      for (let c = 0; c < NT; c++) {
        const a = (c / NT) * Math.PI * 2;
        const root = [Math.cos(a) * 0.75, 0.15, Math.sin(a) * 0.75];
        const out = [Math.cos(a), 0, Math.sin(a)];
        const pts = [];
        for (let j = 0; j <= NB; j++) pts.push([root[0] + out[0] * j * L * 0.25, root[1] + j * L * 0.97, root[2] + out[2] * j * L * 0.25]);
        chains.push({ root, out, pts, tip: pts[NB].slice(), phase: c * 1.7 });
      }
      const body = S.geo.sphere(48, 24, 1.05);
      const lineBuf = util.buffer(gl.ARRAY_BUFFER, NT * NB * 2 * 12, gl.DYNAMIC_DRAW);
      return {
        vao, count: m.idx.length, chains,
        prog: util.program(VS, FS).bindBlock('Bones', 0), bodyP: util.program(BODY_VS, BODY_FS), body: S.geo.upload(util, body),
        ubo: util.buffer(gl.UNIFORM_BUFFER, NT * NB * 64, gl.DYNAMIC_DRAW), mats: new Float32Array(NT * NB * 16),
        lineP: util.program(`layout(location=0) in vec3 a_p; uniform mat4 u_vp; void main(){ gl_Position = u_vp * vec4(a_p,1.0); gl_PointSize = 5.0; }`, `out vec4 o; void main(){ o = vec4(0.93, 0.91, 0.87, 1.0); }`),
        lineBuf, lineVao: util.vao([{ buffer: lineBuf, loc: 0, size: 3 }]), lines: new Float32Array(NT * NB * 6),
        target: [0, 3, 0], grip: 0,
        cam: new S.OrbitCam({ dist: 7.2, pitch: 0.22, minDist: 4, maxDist: 18, target: [0, 2.2, 0], auto: 0.05 }),
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      let tgt;
      if (input.hover || input.down) {
        const r = s.cam.ray(input.nx, input.ny, ctx.aspect), b = s.cam.basis();
        const k = V3.dot(V3.sub(s.cam.target, r.origin), b.fwd) / V3.dot(r.dir, b.fwd);
        tgt = V3.add(r.origin, V3.scale(r.dir, k));
      } else tgt = [Math.sin(t * 0.6) * 2.5, 2.8 + Math.sin(t * 0.9) * 0.8, Math.cos(t * 0.45) * 2.5];
      for (let i = 0; i < 3; i++) s.target[i] += (tgt[i] - s.target[i]) * damp(8, dt);
      s.grip += ((input.down ? 1 : 0) - s.grip) * damp(6, dt);
      const att = Math.min(1, params.reach + s.grip);

      s.chains.forEach((ch, ci) => {
        // desired tip: blend between a swaying rest pose and the pointer
        const sw = params.sway;
        const rest = [ch.root[0] + ch.out[0] * 1.2 + Math.sin(t * 0.8 + ch.phase) * 0.6 * sw, LEN * 0.82 + Math.sin(t * 1.1 + ch.phase) * 0.3 * sw, ch.root[2] + ch.out[2] * 1.2 + Math.cos(t * 0.7 + ch.phase) * 0.6 * sw];
        const spread = (1 - s.grip) * 0.7;
        const ptr = [s.target[0] + ch.out[0] * spread, s.target[1] + Math.sin(ci * 2.1) * spread * 0.5, s.target[2] + ch.out[2] * spread];
        const want = V3.add(V3.scale(rest, 1 - att), V3.scale(ptr, att));
        for (let i = 0; i < 3; i++) ch.tip[i] += (want[i] - ch.tip[i]) * damp(params.follow, dt);
        // FABRIK
        const P = ch.pts;
        for (let it = 0; it < 10; it++) {
          P[NB] = ch.tip.slice();
          for (let j = NB - 1; j >= 0; j--) { const d = V3.norm(V3.sub(P[j], P[j + 1])); P[j] = V3.add(P[j + 1], V3.scale(d, L)); }
          P[0] = ch.root.slice();
          for (let j = 1; j <= NB; j++) { const d = V3.norm(V3.sub(P[j], P[j - 1])); P[j] = V3.add(P[j - 1], V3.scale(d, L)); }
        }
        // parallel-transport frames → skin matrices  S_j = [X Y Z | P_j] · T(0, -jL, 0)
        let X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
        for (let j = 0; j < NB; j++) {
          const d = V3.norm(V3.sub(P[j + 1], P[j]));
          const ax = V3.cross(Y, d), sn = V3.len(ax), cs = V3.dot(Y, d);
          if (sn > 1e-6) { const k = V3.scale(ax, 1 / sn); X = rot(X, k, cs, sn); Z = rot(Z, k, cs, sn); }
          Y = d;
          const tr = V3.sub(P[j], V3.scale(Y, j * L));
          s.mats.set([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, tr[0], tr[1], tr[2], 1], (ci * NB + j) * 16);
          s.lines.set([...P[j], ...P[j + 1]], (ci * NB + j) * 6);
        }
      });
      gl.bindBuffer(gl.UNIFORM_BUFFER, s.ubo);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, s.mats);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, s.ubo);

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 60), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.028, 0.03, 0.04, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.bodyP.use().set({ u_vp: vp, u_eye: s.cam.eye() });
      s.body.draw();
      s.prog.use().set({ u_vp: vp, u_eye: s.cam.eye(), u_len: LEN, u_time: t, u_grip: s.grip });
      gl.bindVertexArray(s.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, s.count, gl.UNSIGNED_SHORT, 0, NT);
      if (params.bones) {
        gl.disable(gl.DEPTH_TEST);
        gl.bindBuffer(gl.ARRAY_BUFFER, s.lineBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.lines);
        s.lineP.use().set({ u_vp: vp });
        gl.bindVertexArray(s.lineVao);
        gl.drawArrays(gl.LINES, 0, NT * NB * 2);
        gl.drawArrays(gl.POINTS, 0, NT * NB * 2);
      }
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
