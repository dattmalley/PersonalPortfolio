/* Audio Reactive — Web Audio AnalyserNode spectrum + waveform streamed into an
 * R8 texture every frame and read in the vertex shader (texelFetch) to drive
 * a ring of instanced bars, a pulsing core and a waveform halo. */
(function () {
  const S = window.Sandbox;
  const { M4, damp } = S.math;
  const BINS = 256;

  const BAR_VS = S.GLSL.colors + `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform sampler2D u_audio; uniform float u_gain; uniform float u_time;
out vec3 v_n; out vec3 v_col; out float v_amp;
void main() {
  int i = gl_InstanceID;
  int bin = i < ${BINS / 2} ? i : ${BINS - 1} - i;            // mirror for symmetry
  float amp = texelFetch(u_audio, ivec2(bin * 2 / 3, 0), 0).r * u_gain;
  float a = float(i) / ${BINS}.0 * 6.2831853;
  float h = 0.05 + amp * 2.4;
  vec3 p = a_pos * vec3(0.045, h, 0.09) + vec3(0.0, h * 0.5, 0.0);
  float c = cos(a), s = sin(a);
  p = vec3(c * (p.x + 2.2) - s * p.z, p.y - 0.6, s * (p.x + 2.2) + c * p.z);
  v_n = vec3(c * a_nrm.x - s * a_nrm.z, a_nrm.y, s * a_nrm.x + c * a_nrm.z);
  v_col = mix(BLUE, RED, clamp(amp * 1.3, 0.0, 1.0)); v_amp = amp;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  const BAR_FS = `
in vec3 v_n; in vec3 v_col; in float v_amp; out vec4 o;
void main() {
  float d = 0.4 + 0.6 * max(dot(normalize(v_n), normalize(vec3(0.3, 1.0, 0.5))), 0.0);
  o = vec4(v_col * d + v_amp * v_amp * 0.4, 1.0);
}`;
  const CORE_VS = `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform float u_bass; uniform float u_time; uniform sampler2D u_audio;
out vec3 v_n; out vec3 v_w;
void main() {
  float wav = texelFetch(u_audio, ivec2(int(fract(atan(a_pos.z, a_pos.x) / 6.2831853 + 0.5) * 255.0), 1), 0).r - 0.5;
  vec3 p = a_pos * (0.9 + u_bass * 0.6 + wav * 0.5 * abs(a_pos.y - 1.0) * 0.5);
  v_n = a_nrm; v_w = p;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  const CORE_FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; out vec4 o; uniform vec3 u_eye; uniform float u_bass;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.0);
  vec3 c = mix(vec3(0.05, 0.05, 0.08), RED, u_bass * 0.7) + fres * mix(BLUE, RED, u_bass);
  o = vec4(c, 1.0);
}`;
  const WAVE_VS = `
uniform mat4 u_vp; uniform sampler2D u_audio; uniform float u_time;
out float v_k;
void main() {
  int i = gl_VertexID;
  float k = float(i) / 255.0;
  float w = texelFetch(u_audio, ivec2(i, 1), 0).r - 0.5;
  float a = k * 6.2831853;
  float r = 3.1 + w * 1.4;
  v_k = k;
  gl_Position = u_vp * vec4(cos(a) * r, -0.6 + w * 0.6, sin(a) * r, 1.0);
}`;
  const WAVE_FS = S.GLSL.colors + `in float v_k; out vec4 o; void main() { o = vec4(mix(RED, BLUE, abs(v_k * 2.0 - 1.0)), 1.0); }`;

  // Small generative synth so the demo works without a microphone.
  function startSynth(s) {
    const ac = s.ac;
    const master = ac.createGain(); master.gain.value = 0.35; master.connect(s.analyser); s.analyser.connect(ac.destination);
    s.master = master;
    const noise = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
    const ch = noise.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const scale = [0, 3, 5, 7, 10, 12, 15];
    let step = 0, next = ac.currentTime + 0.05;
    const tempo = 0.125;
    s.tick = () => {
      while (next < ac.currentTime + 0.15) {
        const t = next;
        if (step % 4 === 0) { // kick
          const o = ac.createOscillator(), g = ac.createGain();
          o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
          g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
          o.connect(g).connect(master); o.start(t); o.stop(t + 0.32);
        }
        if (step % 2 === 1) { // hat
          const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
          n.buffer = noise; f.type = 'highpass'; f.frequency.value = 7000;
          g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
          n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.06);
        }
        { // arp
          const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
          o.type = 'sawtooth';
          const note = 45 + scale[(step * 5 + Math.floor(step / 16) * 2) % scale.length] + (step % 8 === 7 ? 12 : 0);
          o.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
          f.type = 'lowpass'; f.frequency.setValueAtTime(400 + 2600 * (0.5 + 0.5 * Math.sin(step * 0.15)), t); f.Q.value = 8;
          g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + tempo * 1.8);
          o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + tempo * 2);
        }
        step++; next += tempo;
      }
    };
  }

  function stopAudio(s) {
    s.tick = null;
    if (s.stream) { s.stream.getTracks().forEach((tr) => tr.stop()); s.stream = null; }
    if (s.ac) { s.ac.close().catch(() => {}); s.ac = null; }
    s.analyser = null; s.mode = 'idle';
  }

  function ensureContext(s) {
    stopAudio(s);
    const AC = window.AudioContext || window.webkitAudioContext;
    s.ac = new AC();
    s.analyser = s.ac.createAnalyser();
    s.analyser.fftSize = BINS * 2;
    s.analyser.smoothingTimeConstant = 0.78;
  }

  S.register({
    id: 'audio',
    title: 'Audio Reactive',
    category: 'Sensors & Media',
    hint: 'start the synth or use your microphone',
    description: 'The Web Audio AnalyserNode supplies 256 frequency bins and 256 waveform samples each frame. Both go into a 256×2 single-channel R8 texture with texSubImage2D, and the vertex shaders read them with texelFetch to drive 256 instanced bars, a bass-pumped core and a waveform halo. A small built-in sequencer means it works without a microphone.',
    interact: [['Start synth', 'Generative beat (audio on)'], ['Use microphone', 'React to the room (permission prompt)'], ['Stop', 'Silence; idle animation resumes'], ['Drag / wheel', 'Orbit and zoom']],
    features: ['Vertex texture fetch (texelFetch)', 'R8 textures + texSubImage2D streaming', 'Instanced bars', 'gl.LINE_LOOP from gl_VertexID', 'Web Audio AnalyserNode'],
    params: [
      { key: 'gain', label: 'Visual gain', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1.1 },
      { key: 'synth', label: 'Start synth', type: 'button' },
      { key: 'mic', label: 'Use microphone', type: 'button' },
      { key: 'stop', label: 'Stop', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const sph = S.geo.surface(64, 32, (u, v) => {
        const a = u * Math.PI * 2, b = v * Math.PI;
        const d = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
        return { p: d, n: d };
      });
      const tex = util.texture({ width: BINS, height: 2, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST });
      const s = {
        bars: util.program(BAR_VS, BAR_FS), core: util.program(CORE_VS, CORE_FS), wave: util.program(WAVE_VS, WAVE_FS),
        barVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        coreVao: util.vao([{ buffer: util.buffer(gl.ARRAY_BUFFER, sph.pos), loc: 0, size: 3 }, { buffer: util.buffer(gl.ARRAY_BUFFER, sph.nrm), loc: 1, size: 3 }], util.buffer(gl.ELEMENT_ARRAY_BUFFER, sph.idx)),
        coreCount: sph.count, tex, data: new Uint8Array(BINS * 2), bass: 0, mode: 'idle',
        cam: new S.OrbitCam({ dist: 7.5, pitch: 0.5, minDist: 4, maxDist: 16, auto: 0.12 }),
      };
      ctx.overlay.innerHTML = '<div class="ov-center" id="audio-tip">Press <b>Start synth</b> or <b>Use microphone</b> in Controls</div>';
      s.tip = ctx.overlay.querySelector('#audio-tip');
      return s;
    },
    action(ctx, s, key) {
      try {
        if (key === 'synth') { ensureContext(s); startSynth(s); s.ac.resume(); s.mode = 'synth'; }
        if (key === 'mic') {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { ctx.message('Microphone access is not available here (needs HTTPS).'); setTimeout(() => ctx.message(''), 2500); return; }
          navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
            ensureContext(s);
            s.stream = stream;
            s.ac.createMediaStreamSource(stream).connect(s.analyser);
            s.ac.resume();
            s.mode = 'mic';
          }).catch(() => { ctx.message('Microphone permission was declined.'); setTimeout(() => ctx.message(''), 2000); });
        }
        if (key === 'stop') stopAudio(s);
      } catch (e) { console.warn(e); }
    },
    dispose(ctx, s) { stopAudio(s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt);
      if (s.tip) s.tip.style.display = s.mode === 'idle' ? '' : 'none';
      if (s.tick) s.tick();
      const fft = s.data.subarray(0, BINS), wav = s.data.subarray(BINS);
      if (s.analyser) {
        s.analyser.getByteFrequencyData(fft);
        s.analyser.getByteTimeDomainData(wav);
      } else {
        for (let i = 0; i < BINS; i++) {
          const k = i / BINS;
          fft[i] = Math.max(0, 255 * (0.55 - k * 0.6) * (0.6 + 0.4 * Math.sin(t * 3 + i * 0.15)) * (0.7 + 0.3 * Math.sin(t * 8 - i * 0.05)));
          wav[i] = 128 + 30 * Math.sin(i * 0.15 + t * 4) * Math.sin(t * 1.3);
        }
      }
      let bass = 0; for (let i = 0; i < 12; i++) bass += fft[i]; bass /= 12 * 255;
      s.bass += (bass - s.bass) * damp(14, dt);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BINS, 2, gl.RED, gl.UNSIGNED_BYTE, s.data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 60), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.02 + s.bass * 0.05, 0.022, 0.035 + s.bass * 0.02, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.bars.use().set({ u_vp: vp, u_audio: 0, u_gain: params.gain, u_time: t });
      gl.bindVertexArray(s.barVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, BINS);
      s.core.use().set({ u_vp: vp, u_bass: s.bass * params.gain, u_time: t, u_audio: 0, u_eye: s.cam.eye() });
      gl.bindVertexArray(s.coreVao);
      gl.drawElements(gl.TRIANGLES, s.coreCount, gl.UNSIGNED_SHORT, 0);
      s.wave.use().set({ u_vp: vp, u_audio: 0, u_time: t });
      gl.bindVertexArray(ctx.util.emptyVAO);
      gl.drawArrays(gl.LINE_LOOP, 0, BINS);
      gl.disable(gl.DEPTH_TEST);
    },
  });
})();
