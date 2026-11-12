/* Spatial Audio — four sound sources placed in 3D with Web Audio PannerNodes
 * (HRTF). The listener follows the WebGL camera, so walking and turning moves
 * the sound around your head. Drag sources across the floor; click to mute.
 * Floor ripples and pulses come from each source's live analyser level. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Ray, damp, clamp } = S.math;
  const NAMES = ['Drone', 'Arpeggio', 'Hats', 'Bell'];

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_n; out vec3 v_w;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_n = mat3(u_model) * a_nrm; v_w = w.xyz; gl_Position = u_vp * w; }`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; out vec4 o;
uniform int u_kind; uniform vec3 u_col; uniform float u_glow; uniform vec4 u_src[4]; uniform float u_time; uniform vec3 u_eye;
void main() {
  if (u_kind == 1) {
    vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz); float line = 1.0 - min(min(g.x, g.y), 1.0);
    vec3 c = vec3(0.035, 0.037, 0.046) + line * 0.035;
    for (int i = 0; i < 4; i++) {
      float d = length(v_w.xz - u_src[i].xz);
      float wave = pow(0.5 + 0.5 * sin(d * 7.0 - u_time * 6.0), 6.0) * exp(-d * 0.55) * u_src[i].w;
      c += wave * ((i % 2 == 0) ? RED : BLUE) * 0.9;
    }
    o = vec4(c, 1.0); return;
  }
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.0);
  o = vec4(u_col * (0.25 + u_glow * 1.6) + fres * u_col * 0.6, 1.0);
}`;

  S.register({
    id: 'spatial',
    title: 'Spatial Audio',
    category: 'Sensors & Media',
    thumb: 'square',
    hint: 'start audio (headphones) · WASD / drag to walk and look · drag sources',
    description: 'Sound positioned in 3D. Four synthesised sources (a drone, an arpeggio, hats and a bell) each run through a Web Audio PannerNode using HRTF, the same head-related filtering used in games and VR. The audio listener is locked to the WebGL camera, so turning your head moves the sound around you and walking closer makes it louder. Drag sources across the floor to hear them travel; click one to mute it. Use headphones.',
    interact: [['Start audio', 'Begin playback (browsers need a gesture)'], ['W A S D · drag', 'Walk and look; the listener follows the camera'], ['Drag a source', 'Move it across the floor'], ['Click a source', 'Mute / unmute'], ['Inset map', 'Top-down view of you and the sources']],
    features: ['Web Audio PannerNode (HRTF)', 'AudioListener tied to the camera', 'AnalyserNode-driven visuals', 'Ray picking + floor dragging', 'Scissored minimap viewport'],
    captureKeys: true,
    params: [
      { key: 'start', label: 'Start audio', type: 'button' },
      { key: 'stop', label: 'Stop audio', type: 'button' },
      { key: 'volume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: 'rolloff', label: 'Distance rolloff', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1.2 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const s = {
        prog: util.program(VS, FS), cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        ball: S.geo.upload(util, S.geo.sphere(40, 20, 1)),
        src: [[-4, 1, -3], [4, 1, -3], [-3, 1, 4], [3.5, 1, 3.5]].map((p, i) => ({ p, mute: false, level: 0, name: NAMES[i] })),
        pos: [0, 1.6, 7], yaw: 0, pitch: -0.12, ac: null, drag: null,
      };
      ctx.overlay.innerHTML = '<div class="ov-center" id="sp-tip"><b>Start audio</b> (click here or in Controls) · headphones recommended</div><div class="ov-label" id="sp-read" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      s.tip = ctx.overlay.querySelector('#sp-tip'); s.read = ctx.overlay.querySelector('#sp-read');
      s.tip.style.pointerEvents = 'auto'; s.tip.style.cursor = 'pointer';
      s.tip.addEventListener('click', () => startAudio(ctx, s));
      return s;
    },
    action(ctx, s, key) { if (key === 'start') startAudio(ctx, s); if (key === 'stop') stopAudio(s); },
    onParam(ctx, s, key, v) { if (!s.ac) return; if (key === 'volume') s.master.gain.value = v; if (key === 'rolloff') s.src.forEach((x) => (x.panner.rolloffFactor = v)); },
    dispose(ctx, s) { stopAudio(s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.tip.style.display = s.ac ? 'none' : '';
      const fwd = [Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch)];
      const vp = M4.mul(M4.persp(1.0, ctx.aspect, 0.05, 80), M4.lookAt(s.pos, V3.add(s.pos, fwd)));
      // ray from the camera through the pointer (manual: first-person camera)
      const rayAt = (nx, ny) => { const right = V3.norm(V3.cross(fwd, [0, 1, 0])), up = V3.cross(right, fwd), tt = Math.tan(0.5); return { o: s.pos, d: V3.norm(V3.add(fwd, V3.add(V3.scale(right, nx * tt * ctx.aspect), V3.scale(up, ny * tt)))) }; };
      if (input.down && !s.dragChecked) {
        s.dragChecked = true;
        const r = rayAt(input.nx, input.ny);
        let best = null, bd = 1e9;
        s.src.forEach((x) => { const h = Ray.sphere(r.o, r.d, x.p, 0.6); if (h && h < bd) { bd = h; best = x; } });
        s.drag = best;
      }
      if (!input.down) { s.dragChecked = false; s.drag = null; }
      for (const c of input.clicks) {
        const r = rayAt(c.uvx * 2 - 1, c.uvy * 2 - 1);
        s.src.forEach((x) => { if (Ray.sphere(r.o, r.d, x.p, 0.6)) { x.mute = !x.mute; if (x.gain) x.gain.gain.setTargetAtTime(x.mute ? 0 : 1, s.ac.currentTime, 0.05); if (!s.ac) startAudio(ctx, s); } });
      }
      if (s.drag && input.dragging) {
        const r = rayAt(input.nx, input.ny), h = Ray.plane(r.o, r.d, [0, 1, 0], [0, 1, 0]);
        if (h) s.drag.p = [clamp(h[0], -9, 9), 1, clamp(h[2], -9, 9)];
      } else if (input.dragging) { s.yaw += input.dragDX * 0.004; s.pitch = clamp(s.pitch - input.dragDY * 0.004, -1.2, 1.2); }
      const k = (...c) => c.some((x) => input.keys.has(x));
      const mf = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0), ms = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
      const flat = [Math.sin(s.yaw), 0, -Math.cos(s.yaw)], right = [Math.cos(s.yaw), 0, Math.sin(s.yaw)];
      s.pos = [clamp(s.pos[0] + (flat[0] * mf + right[0] * ms) * 3 * dt, -9, 9), 1.6, clamp(s.pos[2] + (flat[2] * mf + right[2] * ms) * 3 * dt, -9, 9)];
      if (!input.hover && !input.down && !mf && !ms) s.yaw += dt * 0.08;
      // audio: listener = camera, panners = sources, levels from analysers
      if (s.ac) {
        const L = s.ac.listener, at = s.ac.currentTime;
        if (L.positionX) { L.positionX.setTargetAtTime(s.pos[0], at, 0.02); L.positionY.setTargetAtTime(s.pos[1], at, 0.02); L.positionZ.setTargetAtTime(s.pos[2], at, 0.02); L.forwardX.setTargetAtTime(fwd[0], at, 0.02); L.forwardY.setTargetAtTime(fwd[1], at, 0.02); L.forwardZ.setTargetAtTime(fwd[2], at, 0.02); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
        else { L.setPosition(...s.pos); L.setOrientation(...fwd, 0, 1, 0); }
        s.src.forEach((x) => {
          if (x.panner.positionX) { x.panner.positionX.setTargetAtTime(x.p[0], at, 0.03); x.panner.positionY.setTargetAtTime(x.p[1], at, 0.03); x.panner.positionZ.setTargetAtTime(x.p[2], at, 0.03); } else x.panner.setPosition(...x.p);
          x.analyser.getByteTimeDomainData(x.buf);
          let rms = 0; for (let i = 0; i < x.buf.length; i++) { const v = (x.buf[i] - 128) / 128; rms += v * v; }
          x.level += (Math.min(1, Math.sqrt(rms / x.buf.length) * 5) - x.level) * damp(12, dt);
        });
        s.tick && s.tick();
      } else s.src.forEach((x, i) => (x.level = 0.25 + 0.2 * Math.sin(t * 2 + i)));
      const srcU = new Float32Array(16); s.src.forEach((x, i) => srcU.set([...x.p, x.mute ? 0 : x.level], i * 4));
      const draw = (vpm, eye) => {
        gl.enable(gl.DEPTH_TEST);
        s.prog.use().set({ u_vp: vpm, u_kind: 1, u_src: srcU, u_time: t, u_eye: eye, u_model: M4.mul(M4.translate(0, -0.05, 0), M4.scale(20, 0.1, 20)), u_col: [0, 0, 0], u_glow: 0 });
        gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
        s.src.forEach((x, i) => {
          const sc = 0.35 + (x.mute ? 0 : x.level) * 0.35;
          s.prog.set({ u_kind: 0, u_col: x.mute ? [0.25, 0.25, 0.28] : i % 2 ? S.BLUE : S.RED, u_glow: x.mute ? 0 : x.level, u_model: M4.mul(M4.translate(...x.p), M4.scale(sc)) });
          s.ball.draw();
        });
        gl.disable(gl.DEPTH_TEST);
      };
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.024, 0.026, 0.034, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      draw(vp, s.pos);
      // minimap inset: same scene, orthographic top-down, scissored
      const mw = Math.round(Math.min(ctx.width, ctx.height) * 0.24), mx = ctx.width - mw - Math.round(24 * ctx.dpr), my = ctx.height - mw - Math.round(56 * ctx.dpr);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(mx, my, mw, mw); gl.viewport(mx, my, mw, mw);
      gl.clearColor(0.05, 0.05, 0.07, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const top = M4.mul(M4.ortho(-10, 10, -10, 10, 0.1, 40), M4.lookAt([0, 20, 0], [0, 0, 0], [0, 0, -1]));
      draw(top, [0, 20, 0]);
      // listener marker: a small bone cube pointing forward
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
      s.prog.use().set({ u_vp: top, u_kind: 0, u_col: [0.93, 0.91, 0.87], u_glow: 0.4, u_model: M4.mul(M4.translate(s.pos[0], 2, s.pos[2]), M4.mul(M4.rotY(-s.yaw), M4.scale(0.5, 0.2, 1.1))) });
      gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
      s.read.textContent = s.src.map((x) => `${x.name} ${x.mute ? 'muted' : V3.len(V3.sub(x.p, s.pos)).toFixed(1) + ' m'}`).join(' · ');
      ctx.canvas.style.cursor = s.drag ? 'grabbing' : 'crosshair';
    },
  });

  function startAudio(ctx, s) {
    if (s.ac) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = (s.ac = new AC());
      s.master = ac.createGain(); s.master.gain.value = ctx.params.volume; s.master.connect(ac.destination);
      const noise = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate); const ch = noise.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      s.src.forEach((x, i) => {
        x.panner = new PannerNode(ac, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 40, rolloffFactor: ctx.params.rolloff });
        x.gain = ac.createGain(); x.gain.gain.value = x.mute ? 0 : 1;
        x.analyser = ac.createAnalyser(); x.analyser.fftSize = 256; x.buf = new Uint8Array(256);
        x.bus = ac.createGain();
        x.bus.connect(x.analyser); x.analyser.connect(x.gain); x.gain.connect(x.panner); x.panner.connect(s.master);
        if (i === 0) { // drone
          [55, 55.4, 82.5].forEach((hz) => { const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(); o.type = 'sawtooth'; o.frequency.value = hz; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0.12; o.connect(f).connect(g).connect(x.bus); o.start(); });
        }
      });
      let next = ac.currentTime + 0.05, step = 0;
      const scale = [0, 3, 7, 10, 12, 15];
      s.tick = () => {
        while (next < ac.currentTime + 0.15) {
          const tt = next;
          const arp = ac.createOscillator(), ag = ac.createGain(); arp.type = 'triangle'; arp.frequency.value = 220 * Math.pow(2, scale[(step * 2) % 6] / 12);
          ag.gain.setValueAtTime(0.0, tt); ag.gain.linearRampToValueAtTime(0.25, tt + 0.01); ag.gain.exponentialRampToValueAtTime(0.001, tt + 0.22);
          arp.connect(ag).connect(s.src[1].bus); arp.start(tt); arp.stop(tt + 0.25);
          if (step % 2 === 1) { const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); n.buffer = noise; f.type = 'highpass'; f.frequency.value = 6500; g.gain.setValueAtTime(0.35, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.06); n.connect(f).connect(g).connect(s.src[2].bus); n.start(tt); n.stop(tt + 0.07); }
          if (step % 12 === 0) { const c = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain(); c.frequency.value = 660; m.frequency.value = 660 * 3.5; mg.gain.value = 400; m.connect(mg).connect(c.frequency); g.gain.setValueAtTime(0.3, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 1.6); c.connect(g).connect(s.src[3].bus); c.start(tt); m.start(tt); c.stop(tt + 1.7); m.stop(tt + 1.7); }
          step++; next += 0.16;
        }
      };
      ac.resume();
    } catch (e) { ctx.message('Web Audio could not start: ' + e.message); setTimeout(() => ctx.message(''), 2500); s.ac = null; }
  }
  function stopAudio(s) { if (s.ac) { s.ac.close().catch(() => {}); s.ac = null; s.tick = null; } }
})();
