/* Voice & MIDI — three musical / spoken inputs drive one scene: Web Speech
 * recognition commands, a hardware MIDI keyboard (Web MIDI API), and the
 * computer keyboard as a piano. Notes light a ring of twelve pillars and play
 * through a small Web Audio synth. */
(function () {
  const S = window.Sandbox;
  const { M4, damp } = S.math;
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const PIANO = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12 };

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_model;
out vec3 v_n; out vec3 v_w;
void main() { vec4 w = u_model * vec4(a_pos, 1.0); v_n = mat3(u_model) * a_nrm; v_w = w.xyz; gl_Position = u_vp * w; }`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_w; out vec4 o;
uniform vec3 u_col; uniform float u_glow; uniform vec3 u_eye; uniform int u_kind;
void main() {
  vec3 n = normalize(v_n);
  if (u_kind == 1) { vec2 g = abs(fract(v_w.xz) - 0.5) / fwidth(v_w.xz); float line = 1.0 - min(min(g.x, g.y), 1.0); o = vec4(vec3(0.03) + line * 0.04 * exp(-length(v_w.xz) * 0.1), 1.0); return; }
  vec3 V = normalize(u_eye - v_w);
  float d = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.3, 0.9, 0.4))), 0.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  o = vec4(u_col * d + u_col * u_glow * 1.4 + fres * u_col * 0.4, 1.0);
}`;

  S.register({
    id: 'voice',
    title: 'Voice & MIDI',
    category: 'Sensors & Media',
    thumb: 'square',
    hint: 'press Start voice and speak · or play A–K like a piano · or plug in MIDI',
    description: 'Three input devices drive one instrument. The Web Speech API listens continuously for spoken commands such as "red", "blue", "bigger", "smaller", "spin", "stop", "explode" and "reset", and prints the live transcript. The Web MIDI API connects a hardware keyboard: notes light the matching pillar with their velocity and the mod wheel sets the spin. Without hardware, the computer keys A to K play a chromatic octave.',
    interact: [['Start voice', 'Speak: red · blue · white · bigger · smaller · spin · stop · explode · reset'], ['Connect MIDI', 'Notes → pillars + synth; mod wheel → spin; CC7 → size'], ['A W S E D F T G Y H U J K', 'Computer-keyboard piano'], ['Click a pillar', 'Play that note'], ['Drag', 'Orbit']],
    features: ['Web Speech API (SpeechRecognition)', 'Web MIDI API', 'Keyboard as instrument', 'Web Audio synthesis', 'Velocity-driven animation'],
    captureKeys: true,
    params: [
      { key: 'voice', label: 'Start voice', type: 'button' },
      { key: 'midi', label: 'Connect MIDI', type: 'button' },
      { key: 'stop', label: 'Stop listening', type: 'button' },
      { key: 'volume', label: 'Synth volume', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube(), cb = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const s = {
        prog: util.program(VS, FS), cubeVao: util.vao([{ buffer: cb, loc: 0, size: 3, stride: 24 }, { buffer: cb, loc: 1, size: 3, stride: 24, offset: 12 }]),
        blob: S.geo.upload(util, S.geo.sphere(64, 32, 1)), shard: S.geo.upload(util, S.geo.sphere(12, 6, 1)),
        notes: new Float32Array(12), color: [...S.RED], targetColor: [...S.RED], size: 1, targetSize: 1, spin: 0.4, targetSpin: 0.4, explode: 0,
        transcript: '', cmd: '', midiName: '', rec: null,
        cam: new S.OrbitCam({ dist: 11, pitch: 0.42, minDist: 6, maxDist: 22, auto: 0.05, target: [0, 1, 0] }),
      };
      ctx.overlay.innerHTML = `<div id="vm-log" style="position:absolute;left:34px;top:64px;max-width:min(460px,60%);font-family:var(--mono);font-size:11px;line-height:1.8;color:var(--text-2)"></div>`;
      s.log = ctx.overlay.querySelector('#vm-log');
      s.onKey = (e) => {
        if (e.repeat || e.metaKey || e.ctrlKey) return;
        if (e.code in PIANO) { note(s, ctx, PIANO[e.code] + 60, 100); e.preventDefault(); }
      };
      window.addEventListener('keydown', s.onKey);
      return s;
    },
    dispose(ctx, s) {
      window.removeEventListener('keydown', s.onKey);
      if (s.rec) { s.rec.onend = null; try { s.rec.stop(); } catch (_) { /* already stopped */ } }
      if (s.midi) for (const inp of s.midi.inputs.values()) inp.onmidimessage = null;
      if (s.ac) s.ac.close().catch(() => {});
    },
    action(ctx, s, key) {
      if (key === 'voice') {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { ctx.message('Speech recognition is not supported in this browser (try Chrome, Edge or Safari).'); setTimeout(() => ctx.message(''), 2600); return; }
        const rec = new SR();
        rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
        rec.onresult = (e) => {
          let txt = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            txt += e.results[i][0].transcript;
            if (e.results[i].isFinal) command(s, ctx, e.results[i][0].transcript.toLowerCase());
          }
          s.transcript = txt.trim();
        };
        rec.onerror = (e) => { s.transcript = 'speech error · ' + e.error; };
        rec.onend = () => { if (s.rec === rec) try { rec.start(); } catch (_) { /* restart failed */ } };
        try { rec.start(); s.rec = rec; s.transcript = 'listening…'; } catch (e) { s.transcript = 'could not start: ' + e.message; }
      }
      if (key === 'midi') {
        if (!navigator.requestMIDIAccess) { ctx.message('Web MIDI is not available in this browser (try Chrome or Edge). Use the A–K keys instead.'); setTimeout(() => ctx.message(''), 2600); return; }
        navigator.requestMIDIAccess().then((m) => {
          s.midi = m;
          const bind = () => {
            const names = [];
            for (const inp of m.inputs.values()) {
              names.push(inp.name);
              inp.onmidimessage = (ev) => {
                const [st, d1, d2] = ev.data, type = st & 0xf0;
                if (type === 0x90 && d2 > 0) note(s, ctx, d1, d2);
                else if (type === 0xb0 && d1 === 1) s.targetSpin = (d2 / 127) * 4;
                else if (type === 0xb0 && d1 === 7) s.targetSize = 0.5 + (d2 / 127) * 1.5;
              };
            }
            s.midiName = names.length ? names.join(', ') : 'no MIDI inputs found';
          };
          bind(); m.onstatechange = bind;
        }).catch(() => { s.midiName = 'MIDI permission declined'; });
      }
      if (key === 'stop') { if (s.rec) { const r = s.rec; s.rec = null; try { r.stop(); } catch (_) { /* noop */ } } s.transcript = 'stopped'; }
    },
    frame(ctx, s, t, dt) {
      const { gl, input } = ctx;
      s.cam.update(input, dt);
      // click a pillar → play it (pillars are on a ring; use screen angle around the projected centre)
      for (const c of input.clicks) {
        const vp0 = M4.mul(s.cam.proj(ctx.aspect, 0.1, 80), s.cam.view());
        let best = -1, bd = 1e9;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2, p = [Math.cos(a) * 4, 1.2, Math.sin(a) * 4, 1];
          const x = vp0[0] * p[0] + vp0[4] * p[1] + vp0[8] * p[2] + vp0[12], y = vp0[1] * p[0] + vp0[5] * p[1] + vp0[9] * p[2] + vp0[13], w = vp0[3] * p[0] + vp0[7] * p[1] + vp0[11] * p[2] + vp0[15];
          const d = Math.hypot(x / w - (c.uvx * 2 - 1), y / w - (c.uvy * 2 - 1));
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0 && bd < 0.2) note(s, ctx, 60 + best, 110);
      }
      // idle arpeggio so the scene is alive before any input
      if (!s.lastInput || t - s.lastInput > 8) { if (Math.floor(t * 3) !== s.idleBeat) { s.idleBeat = Math.floor(t * 3); s.notes[[0, 4, 7, 11, 7, 4][s.idleBeat % 6]] = 0.7; } }
      for (let i = 0; i < 12; i++) s.notes[i] = Math.max(0, s.notes[i] - dt * 1.6);
      for (let i = 0; i < 3; i++) s.color[i] += (s.targetColor[i] - s.color[i]) * damp(5, dt);
      s.size += (s.targetSize - s.size) * damp(5, dt);
      s.spin += (s.targetSpin - s.spin) * damp(3, dt);
      s.explode = Math.max(0, s.explode - dt * 0.6);
      s.angle = (s.angle || 0) + s.spin * dt;

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.1, 80), s.cam.view());
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.026, 0.028, 0.038, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const P = s.prog.use().set({ u_vp: vp, u_eye: s.cam.eye() });
      P.set({ u_kind: 1, u_model: M4.mul(M4.translate(0, -0.05, 0), M4.scale(40, 0.1, 40)), u_col: [0, 0, 0], u_glow: 0 });
      gl.bindVertexArray(s.cubeVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, v = s.notes[i];
        const black = [1, 3, 6, 8, 10].includes(i);
        const h = 0.6 + v * 3;
        P.set({ u_kind: 0, u_glow: v, u_col: black ? S.BLUE : S.RED, u_model: M4.mul(M4.translate(Math.cos(a) * 4, h / 2, Math.sin(a) * 4), M4.mul(M4.rotY(-a), M4.scale(0.5, h, 0.5))) });
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      }
      const energy = s.notes.reduce((x, y) => x + y, 0) / 4;
      if (s.explode > 0) {
        for (let i = 0; i < 40; i++) {
          const a = i * 2.39996, e = (1 - s.explode) * 6;
          const d = [Math.cos(a) * Math.sin(i * 0.7 + 1), Math.cos(i * 0.7 + 1), Math.sin(a) * Math.sin(i * 0.7 + 1)];
          P.set({ u_glow: s.explode, u_col: s.color, u_model: M4.mul(M4.translate(d[0] * e, 1.6 + d[1] * e, d[2] * e), M4.scale(0.18 * s.size)) });
          s.shard.draw();
        }
      } else {
        P.set({ u_glow: energy * 0.5, u_col: s.color, u_model: M4.mul(M4.translate(0, 1.6, 0), M4.mul(M4.rotY(s.angle), M4.mul(M4.rotX(s.angle * 0.6), M4.scale(s.size * (1 + energy * 0.15), s.size * (0.8 + energy * 0.1), s.size)))) });
        s.blob.draw();
      }
      gl.disable(gl.DEPTH_TEST);
      s.log.innerHTML = `voice · ${s.rec ? '<span style="color:var(--red)">● listening</span>' : 'off'}${s.transcript ? ` · “${s.transcript.replace(/</g, '')}”` : ''}<br>`
        + (s.cmd ? `command · <span style="color:var(--text)">${s.cmd}</span><br>` : '')
        + `midi · ${s.midiName || 'not connected'}<br>keys · A–K play ${NOTE_NAMES.join(' ')}`;
    },
  });

  function command(s, ctx, text) {
    const has = (...w) => w.some((x) => text.includes(x));
    const did = [];
    if (has('red')) { s.targetColor = [...S.RED]; did.push('red'); }
    if (has('blue')) { s.targetColor = [...S.BLUE]; did.push('blue'); }
    if (has('white', 'bone')) { s.targetColor = [0.93, 0.91, 0.87]; did.push('white'); }
    if (has('bigger', 'grow', 'large')) { s.targetSize = Math.min(2.2, s.targetSize * 1.35); did.push('bigger'); }
    if (has('smaller', 'shrink', 'small')) { s.targetSize = Math.max(0.35, s.targetSize / 1.35); did.push('smaller'); }
    if (has('spin', 'faster', 'rotate')) { s.targetSpin = Math.min(6, s.targetSpin + 1.5); did.push('spin'); }
    if (has('stop', 'slower', 'freeze')) { s.targetSpin = 0; did.push('stop'); }
    if (has('explode', 'boom', 'burst')) { s.explode = 1; did.push('explode'); }
    if (has('reset')) { s.targetColor = [...S.RED]; s.targetSize = 1; s.targetSpin = 0.4; did.push('reset'); }
    if (did.length) { s.cmd = did.join(' + '); s.lastInput = ctx.time; }
  }

  function note(s, ctx, midi, vel) {
    s.notes[midi % 12] = 0.4 + (vel / 127) * 0.6;
    s.lastInput = ctx.time;
    try {
      if (!s.ac) { const AC = window.AudioContext || window.webkitAudioContext; s.ac = new AC(); }
      const ac = s.ac, t = ac.currentTime;
      const o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      const hz = 440 * Math.pow(2, (midi - 69) / 12);
      o.type = 'sawtooth'; o.frequency.value = hz; o2.type = 'triangle'; o2.frequency.value = hz * 2.003;
      f.type = 'lowpass'; f.frequency.setValueAtTime(600 + vel * 30, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.6); f.Q.value = 4;
      const vol = (ctx.params.volume ?? 0.35) * (vel / 127) * 0.4;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(f); o2.connect(f); f.connect(g).connect(ac.destination);
      o.start(t); o2.start(t); o.stop(t + 1.2); o2.stop(t + 1.2);
    } catch (_) { /* audio unavailable */ }
  }
})();
