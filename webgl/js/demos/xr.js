/* WebXR Room — one scene, three ways to see it: an inline first-person view,
 * a side-by-side stereo preview, and real immersive VR / AR through the WebXR
 * Device API (XRWebGLLayer, per-eye viewports and projection matrices,
 * controller rays). */
(function () {
  const S = window.Sandbox;
  const { M4, V3, clamp } = S.math;
  const RING = 12;

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_proj; uniform mat4 u_view; uniform mat4 u_model;
out vec3 v_w; out vec3 v_n;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_w = w.xyz; v_n = mat3(u_model) * a_nrm; gl_Position = u_proj * u_view * w; }`;
  const FS = S.GLSL.colors + `
in vec3 v_w; in vec3 v_n; out vec4 o;
uniform int u_kind; uniform vec3 u_col; uniform float u_glow;
void main() {
  vec3 n = normalize(v_n);
  if (u_kind == 1) { // floor grid
    vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    float r = length(v_w.xz);
    o = vec4(vec3(0.035, 0.037, 0.05) + line * mix(BLUE, RED, smoothstep(0.0, 6.0, r)) * 0.25 * exp(-r * 0.12), 1.0); return;
  }
  if (u_kind == 2) { o = vec4(u_col, 1.0); return; } // rays / emissive
  float d = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.3, 0.9, 0.4))), 0.0);
  o = vec4(u_col * d + u_col * u_glow, 1.0);
}`;

  S.register({
    id: 'xr',
    title: 'WebXR Room',
    category: 'Camera & Navigation',
    hint: 'drag to look around · enter VR / AR on a headset',
    description: 'The same room rendered three ways. Inline, you look around in first person. Stereo preview splits the screen into two eye viewports offset by the interpupillary distance, which is exactly how a headset frame is built. On a WebXR device, Enter VR or AR hands the render loop to the XR session: each eye gets its own viewport and projection matrix from the hardware, and controller rays select objects.',
    interact: [['Drag', 'Look around (first person)'], ['Stereo preview', 'See the per-eye viewports a headset renders'], ['Enter VR / AR', 'Immersive session on a WebXR device'], ['Controller trigger', 'Pulse the ring in VR (click does it inline)']],
    features: ['WebXR Device API', 'XRWebGLLayer + makeXRCompatible', 'Per-view projection & viewport', 'Controller target-ray poses', 'Stereo viewport rendering'],
    params: [
      { key: 'stereo', label: 'Stereo preview', type: 'toggle', value: false },
      { key: 'ipd', label: 'Eye separation (m)', type: 'range', min: 0, max: 0.2, step: 0.002, value: 0.064 },
      { key: 'vr', label: 'Enter VR', type: 'button' },
      { key: 'ar', label: 'Enter AR', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const s = {
        prog: util.program(VS, FS),
        cube: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        ball: S.geo.upload(util, S.geo.sphere(32, 16, 1)), knot: S.geo.upload(util, S.geo.torusKnot(200, 24, 0.12, 0.45, 0.2)),
        yaw: 0, pitch: -0.05, session: null, pulse: 0, dir: 1, support: { vr: false, ar: false }, rays: [],
      };
      ctx.overlay.innerHTML = '<div class="ov-label" id="xr-st" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      s.st = ctx.overlay.querySelector('#xr-st');
      s.st.textContent = 'checking for WebXR devices…';
      if (navigator.xr) {
        Promise.all([navigator.xr.isSessionSupported('immersive-vr').catch(() => false), navigator.xr.isSessionSupported('immersive-ar').catch(() => false)]).then(([vr, ar]) => {
          s.support = { vr, ar };
          s.st.textContent = vr || ar ? `WebXR ready · ${[vr && 'VR', ar && 'AR'].filter(Boolean).join(' + ')} available` : 'WebXR present · no headset connected · inline + stereo preview';
        });
      } else s.st.textContent = 'WebXR not available in this browser · inline + stereo preview';
      return s;
    },
    action(ctx, s, key) {
      if (key !== 'vr' && key !== 'ar') return;
      const mode = key === 'vr' ? 'immersive-vr' : 'immersive-ar';
      if (!navigator.xr || !s.support[key]) { ctx.message(`No ${key.toUpperCase()} device detected. Open this page in a headset browser (e.g. Meta Quest) to enter ${key.toUpperCase()}.`); setTimeout(() => ctx.message(''), 3200); return; }
      enterXR(ctx, s, mode).catch((e) => { ctx.message('Could not start the XR session: ' + e.message); setTimeout(() => ctx.message(''), 3000); });
    },
    dispose(ctx, s) { if (s.session) s.session.end().catch(() => {}); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      if (s.session) return; // the XR session drives rendering
      if (input.dragging) { s.yaw -= input.dragDX * 0.005; s.pitch = clamp(s.pitch - input.dragDY * 0.005, -1.3, 1.3); }
      else if (!input.down) s.yaw += dt * 0.05;
      if (input.gamepad) { s.yaw -= (input.gamepad.axes[2] || 0) * dt * 2; s.pitch = clamp(s.pitch - (input.gamepad.axes[3] || 0) * dt * 1.5, -1.3, 1.3); }
      if (input.clicks.length) { s.pulse = 1; s.dir *= -1; }
      s.time = t; s.pulse = Math.max(0, s.pulse - dt * 1.5);
      const eye = [0, 1.6, 0];
      const fwd = [Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch)];
      const right = V3.norm(V3.cross(fwd, [0, 1, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0.024, 0.027, 0.04, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (params.stereo) {
        const hw = Math.floor(ctx.width / 2);
        [-1, 1].forEach((side, i) => {
          const e = V3.add(eye, V3.scale(right, side * params.ipd / 2));
          const view = M4.lookAt(e, V3.add(e, fwd));
          drawScene(ctx, s, M4.persp(1.2, hw / ctx.height, 0.05, 100), view, [i * hw, 0, hw, ctx.height], 0);
        });
      } else {
        drawScene(ctx, s, M4.persp(1.0, ctx.aspect, 0.05, 100), M4.lookAt(eye, V3.add(eye, fwd)), [0, 0, ctx.width, ctx.height], 0);
      }
    },
  });

  function drawScene(ctx, s, proj, view, vp, floorOffset, ar) {
    const { gl } = ctx;
    const t = s.time || 0;
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.enable(gl.DEPTH_TEST);
    const P = s.prog.use();
    P.set({ u_proj: proj, u_view: view, u_glow: 0 });
    const base = M4.translate(0, floorOffset, 0);
    gl.bindVertexArray(s.cube);
    if (!ar) { P.set({ u_kind: 1, u_model: M4.mul(base, M4.mul(M4.translate(0, -0.05, 0), M4.scale(40, 0.1, 40))) }); gl.drawArrays(gl.TRIANGLES, 0, 36); }
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * Math.PI * 2 + t * 0.15 * s.dir;
      const r = 2.6 + Math.sin(t * 0.8 + i) * 0.1;
      const y = 1.4 + Math.sin(t * 1.2 + i * 0.8) * 0.25 + s.pulse * Math.sin(i * 2.0) * 0.4;
      const m = M4.mul(base, M4.mul(M4.translate(Math.cos(a) * r, y, Math.sin(a) * r), M4.mul(M4.rotY(-a + t * s.dir), M4.mul(M4.rotX(t * 0.7 + i), M4.scale(0.32)))));
      P.set({ u_kind: 0, u_model: m, u_col: i % 2 ? S.BLUE : S.RED, u_glow: s.pulse * 0.8 });
      gl.bindVertexArray(s.cube); gl.drawArrays(gl.TRIANGLES, 0, 36);
    }
    P.set({ u_kind: 0, u_glow: 0.1 + s.pulse, u_col: [0.93, 0.91, 0.87], u_model: M4.mul(base, M4.mul(M4.translate(0, 1.5, -3.6), M4.mul(M4.rotY(t * 0.6), M4.rotX(t * 0.4)))) });
    s.knot.draw();
    for (let i = 0; i < 3; i++) {
      P.set({ u_kind: 2, u_col: i === 1 ? S.BLUE : S.RED, u_model: M4.mul(base, M4.mul(M4.translate(Math.cos(i * 2.1) * 6, 3.2, Math.sin(i * 2.1) * 6), M4.scale(0.25))) });
      s.ball.draw();
    }
    for (const ray of s.rays) { // controller rays: thin stretched cubes along -Z of the target-ray pose
      P.set({ u_kind: 2, u_col: [0.93, 0.91, 0.87], u_model: M4.mul(ray, M4.mul(M4.translate(0, 0, -1.5), M4.scale(0.004, 0.004, 3))) });
      gl.bindVertexArray(s.cube); gl.drawArrays(gl.TRIANGLES, 0, 36);
    }
    gl.disable(gl.DEPTH_TEST);
  }

  async function enterXR(ctx, s, mode) {
    const { gl } = ctx;
    await gl.makeXRCompatible();
    const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor'] });
    s.session = session;
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    let space, floorOffset = 0;
    try { space = await session.requestReferenceSpace('local-floor'); } catch (_) { space = await session.requestReferenceSpace('local'); floorOffset = -1.6; }
    session.addEventListener('select', () => { s.pulse = 1; s.dir *= -1; });
    session.addEventListener('end', () => { s.session = null; s.rays = []; });
    const t0 = performance.now();
    const onFrame = (time, frame) => {
      if (!s.session) return;
      session.requestAnimationFrame(onFrame);
      s.time = (performance.now() - t0) / 1000;
      s.pulse = Math.max(0, s.pulse - 1 / 60 * 1.5);
      const pose = frame.getViewerPose(space);
      if (!pose) return;
      s.rays = [];
      for (const src of session.inputSources) {
        const rp = src.targetRaySpace && frame.getPose(src.targetRaySpace, space);
        if (rp) s.rays.push(new Float32Array(rp.transform.matrix));
      }
      const layer = session.renderState.baseLayer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      const ar = mode === 'immersive-ar';
      gl.clearColor(0.024, 0.027, 0.04, ar ? 0 : 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      for (const view of pose.views) {
        const v = layer.getViewport(view);
        drawScene(ctx, s, view.projectionMatrix, view.transform.inverse.matrix, [v.x, v.y, v.width, v.height], floorOffset, ar);
      }
    };
    session.requestAnimationFrame(onFrame);
  }
})();
