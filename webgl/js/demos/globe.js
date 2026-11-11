/* Globe & Geolocation — a dotted-halftone Earth from Natural Earth coastlines,
 * lit by the real sun position for the current UTC time. Spin with momentum,
 * drop pins, watch great-circle arcs connect them, and fly to your location
 * with the Geolocation API. */
(function () {
  const S = window.Sandbox;
  const { M4, V3, Ray, damp } = S.math;
  const TW = 2048, TH = 1024, MAXPIN = 24;

  const VS = `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm; layout(location = 2) in vec2 a_uv;
uniform mat4 u_vp; uniform float u_scale;
out vec3 v_n; out vec2 v_uv; out vec3 v_w;
void main() { vec3 p = a_pos * u_scale; v_n = a_nrm; v_uv = a_uv; v_w = p; gl_Position = u_vp * vec4(p, 1.0); }`;
  const FS = S.GLSL.colors + `
in vec3 v_n; in vec2 v_uv; in vec3 v_w; out vec4 o;
uniform sampler2D u_land; uniform vec3 u_sun; uniform vec3 u_eye; uniform vec3 u_hover; uniform float u_time; uniform bool u_atmo;
void main() {
  vec3 n = normalize(v_n), V = normalize(u_eye - v_w);
  if (u_atmo) { float f = pow(1.0 - abs(dot(n, V)), 3.0); o = vec4(mix(BLUE, vec3(0.6, 0.75, 1.0), f) * f * 0.9, f); return; }
  float land = texture(u_land, v_uv).r;
  // halftone dots on a lat/long lattice, sized by land coverage
  vec2 g = v_uv * vec2(360.0, 180.0);
  float lat = (0.5 - v_uv.y) * 3.14159;
  vec2 cell = vec2(fract(g.x * cos(lat) * 0.999 + 0.5) - 0.5, fract(g.y + 0.5) - 0.5);
  float dotm = smoothstep(0.32, 0.22, length(cell)) * smoothstep(0.35, 0.6, land);
  float day = smoothstep(-0.12, 0.25, dot(n, u_sun));
  vec3 ocean = mix(vec3(0.02, 0.025, 0.04), vec3(0.03, 0.05, 0.09), day);
  vec3 dotCol = mix(vec3(0.4, 0.42, 0.5) * 0.6, vec3(0.93, 0.91, 0.87), day);
  vec3 c = ocean + land * 0.03 + dotm * dotCol;
  // night side: land glows faintly red, like a city-light map
  c += (1.0 - day) * dotm * RED * 0.35;
  // graticule
  vec2 gr = abs(fract(v_uv * vec2(24.0, 12.0)) - 0.5) / fwidth(v_uv * vec2(24.0, 12.0));
  c += (1.0 - min(min(gr.x, gr.y), 1.0)) * 0.035;
  // terminator line
  c += smoothstep(0.03, 0.0, abs(dot(n, u_sun))) * RED * 0.25;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  c += fres * BLUE * 0.45;
  if (dot(u_hover, u_hover) > 0.0) c += smoothstep(0.03, 0.0, abs(length(n - u_hover) - 0.05)) * 0.8;
  o = vec4(c, 1.0);
}`;
  const PIN_VS = S.GLSL.colors + `
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 a_pin;   // dir xyz, birth time
uniform mat4 u_vp; uniform float u_time;
out vec3 v_c; out float v_l;
void main() {
  vec3 d = normalize(a_pin.xyz);
  vec3 r = normalize(cross(d, abs(d.y) > 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0))), u = cross(d, r);
  float age = u_time - a_pin.w;
  float h = 0.18 * smoothstep(0.0, 0.5, age);
  vec3 lp = a_pos * vec3(0.012, 0.012, 1.0);
  vec3 p = d * (1.0 + (lp.z * 0.5 + 0.5) * h) + r * lp.x + u * lp.y;
  if (a_pos.z > 0.4) p = d * (1.0 + h) + (r * a_pos.x + u * a_pos.y) * 0.03 * (1.0 + 0.3 * sin(age * 6.0));
  v_c = gl_InstanceID % 2 == 0 ? RED : BLUE; v_l = 0.6 + 0.4 * a_nrm.z;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  const PIN_FS = `in vec3 v_c; in float v_l; out vec4 o; void main() { o = vec4(v_c * 1.3 * v_l + 0.1, 1.0); }`;
  const ARC_VS = `
layout(location = 0) in vec3 a_p; layout(location = 1) in float a_k;
uniform mat4 u_vp; out float v_k;
void main() { v_k = a_k; gl_Position = u_vp * vec4(a_p, 1.0); }`;
  const ARC_FS = S.GLSL.colors + `in float v_k; out vec4 o; uniform float u_time;
void main() { float dash = smoothstep(0.0, 0.2, fract(v_k * 6.0 - u_time * 0.8)) * 0.8 + 0.2; o = vec4(mix(RED, BLUE, fract(v_k)) * dash, 1.0); }`;

  const toDir = (lat, lon) => { const b = (90 - lat) * Math.PI / 180, a = (lon + 180) * Math.PI / 180; return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; };
  const toLatLon = (d) => { const lat = 90 - Math.acos(Math.max(-1, Math.min(1, d[1]))) * 180 / Math.PI; let a = Math.atan2(d[2], d[0]); if (a < 0) a += Math.PI * 2; return [lat, a * 180 / Math.PI - 180]; };
  const fmt = ([lat, lon]) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

  function sunDir() {
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), 0, 0);
    const day = (now - start) / 86400000;
    const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));
    const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
    return toDir(decl, -(hours - 12) * 15);
  }

  function landTexture(ctx, topo) {
    const { gl, util } = ctx;
    const c = document.createElement('canvas'); c.width = TW; c.height = TH;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, TW, TH);
    if (topo) {
      const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
      const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [(x * sx + tx + 180) / 360 * TW, (90 - (y * sy + ty)) / 180 * TH]; }); });
      const ring = (idx) => { const pts = []; for (const i of idx) { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; pts.push(...(pts.length ? a.slice(1) : a)); } return pts; };
      g.fillStyle = '#fff';
      g.beginPath();
      const poly = (rings) => rings.forEach((r) => { const pts = ring(r); pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); });
      for (const geo of topo.objects.land.geometries) {
        if (geo.type === 'Polygon') poly(geo.arcs);
        else if (geo.type === 'MultiPolygon') geo.arcs.forEach(poly);
      }
      g.fill('evenodd');
    }
    const tex = util.rawTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // Pin mesh: a thin stalk (z -1..1) plus a disc cap (z = 1).
  function pinMesh() {
    const out = [];
    const SEG = 10;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      const p = (a, z) => [Math.cos(a), Math.sin(a), z];
      for (const v of [p(a0, -1), p(a1, -1), p(a1, 0.2), p(a0, -1), p(a1, 0.2), p(a0, 0.2)]) out.push(...v, Math.cos(a0), Math.sin(a0), 0);
      for (const v of [[0, 0, 1], p(a0, 1), p(a1, 1)]) out.push(...v, 0, 0, 1);
    }
    return new Float32Array(out);
  }

  S.register({
    id: 'globe',
    title: 'Globe & Geolocation',
    category: 'Camera & Navigation',
    thumb: 'square',
    hint: 'spin · click to pin · double-click to fly · Locate me',
    description: 'A halftone Earth drawn from Natural Earth coastlines and lit by the real sun for this moment in UTC, with the day/night terminator in the right place. Spin it with momentum and zoom in. Clicking drops pins joined by animated great-circle arcs, and a double-click flies there along a spherical interpolation. "Locate me" uses the Geolocation API to find you.',
    interact: [['Drag / fling', 'Spin with momentum'], ['Wheel / pinch', 'Zoom'], ['Click / tap', 'Drop a pin (lat/long readout)'], ['Double-click', 'Fly to that point'], ['Locate me', 'Geolocation fly-to (permission prompt)']],
    features: ['Geolocation API', 'TopoJSON → canvas → texture', 'Real-time solar terminator', 'Great-circle arcs (slerp)', 'Ray-sphere picking', 'Instanced pins'],
    params: [
      { key: 'spin', label: 'Idle spin', type: 'range', min: 0, max: 0.4, step: 0.01, value: 0.08 },
      { key: 'atmo', label: 'Atmosphere', type: 'toggle', value: true },
      { key: 'locate', label: 'Locate me', type: 'button' },
      { key: 'clear', label: 'Clear pins', type: 'button' },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const s = {
        globe: S.geo.upload(util, S.geo.sphere(160, 80, 1)), prog: util.program(VS, FS), pinP: util.program(PIN_VS, PIN_FS), arcP: util.program(ARC_VS, ARC_FS),
        land: landTexture(ctx, null), pins: [], pinData: new Float32Array(MAXPIN * 4),
        cam: new S.OrbitCam({ dist: 3.4, pitch: 0.35, yaw: 0.6, minDist: 1.5, maxDist: 8, damping: 0.94 }), fly: null, lastTap: null, hover: null,
      };
      const pm = pinMesh();
      const pb = util.buffer(gl.ARRAY_BUFFER, pm);
      s.pinBuf = util.buffer(gl.ARRAY_BUFFER, s.pinData.byteLength, gl.DYNAMIC_DRAW);
      s.pinVao = util.vao([{ buffer: pb, loc: 0, size: 3, stride: 24 }, { buffer: pb, loc: 1, size: 3, stride: 24, offset: 12 }, { buffer: s.pinBuf, loc: 2, size: 4, divisor: 1 }]);
      s.pinCount = pm.length / 6;
      s.arcBuf = util.buffer(gl.ARRAY_BUFFER, MAXPIN * 64 * 16, gl.DYNAMIC_DRAW);
      s.arcVao = util.vao([{ buffer: s.arcBuf, loc: 0, size: 3, stride: 16 }, { buffer: s.arcBuf, loc: 1, size: 1, stride: 16, offset: 12 }]);
      fetch('data/land-50m.json').then((r) => r.json()).then((topo) => { if (s.dead) return; util.release(s.land); s.land = landTexture(ctx, topo); }).catch(() => { /* offline: graticule-only globe */ });
      ctx.overlay.innerHTML = '<div class="ov-label" id="gl-read" style="left:34px;top:auto;bottom:64px;transform:none"></div>';
      s.read = ctx.overlay.querySelector('#gl-read');
      // a few seed pins so arcs are visible straight away
      [[51.5, -0.12], [40.71, -74.0], [35.68, 139.69], [-33.87, 151.2]].forEach(([la, lo], i) => s.pins.push({ dir: toDir(la, lo), born: -i * 0.3, label: fmt([la, lo]) }));
      return s;
    },
    dispose(ctx, s) { s.dead = true; },
    action(ctx, s, key) {
      if (key === 'clear') s.pins.length = 0;
      if (key === 'locate') {
        if (!navigator.geolocation) { ctx.message('Geolocation is not available in this browser.'); setTimeout(() => ctx.message(''), 2200); return; }
        s.read.textContent = 'locating…';
        navigator.geolocation.getCurrentPosition((pos) => {
          const d = toDir(pos.coords.latitude, pos.coords.longitude);
          s.pins.push({ dir: d, born: ctx.time, label: 'you · ' + fmt([pos.coords.latitude, pos.coords.longitude]), you: true });
          flyTo(s, d, 2.2);
        }, (err) => { ctx.message('Location unavailable: ' + err.message); setTimeout(() => ctx.message(''), 2500); }, { enableHighAccuracy: false, timeout: 10000 });
      }
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.auto = s.fly || input.down ? 0 : params.spin;
      s.cam.update(input, dt, false);
      // ray → sphere
      const hit = (uvx, uvy) => { const r = s.cam.ray(uvx * 2 - 1, uvy * 2 - 1, ctx.aspect); const k = Ray.sphere(r.origin, r.dir, [0, 0, 0], 1); return k ? V3.norm(V3.add(r.origin, V3.scale(r.dir, k))) : null; };
      s.hover = input.hover && !input.dragging ? hit(input.uvx, input.uvy) : null;
      for (const c of input.clicks) {
        const d = hit(c.uvx, c.uvy); if (!d) continue;
        const now = performance.now();
        if (s.lastTap && now - s.lastTap < 320) { flyTo(s, d, Math.max(1.6, s.cam.dist * 0.7)); s.lastTap = null; s.pins.pop(); }
        else { s.lastTap = now; if (s.pins.length >= MAXPIN) s.pins.shift(); s.pins.push({ dir: d, born: t, label: fmt(toLatLon(d)) }); }
      }
      if (s.fly) {
        const f = s.fly; f.t = Math.min(1, f.t + dt / 1.6);
        const k = 0.5 - 0.5 * Math.cos(Math.PI * f.t);
        let dy = f.y1 - f.y0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        s.cam.yaw = f.y0 + dy * k; s.cam.pitch = f.p0 + (f.p1 - f.p0) * k; s.cam.dist = f.d0 + (f.d1 - f.d0) * k;
        s.cam.vy = s.cam.vp = 0;
        if (f.t >= 1) s.fly = null;
      }
      // pins + arcs
      s.pins.forEach((p, i) => s.pinData.set([...p.dir, p.born], i * 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, s.pinBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.pinData);
      const arc = [];
      for (let i = 1; i < s.pins.length; i++) {
        const a = s.pins[i - 1].dir, b = s.pins[i].dir;
        const om = Math.acos(Math.max(-1, Math.min(1, V3.dot(a, b))));
        const grow = Math.min(1, (t - s.pins[i].born) / 0.8);
        for (let k = 0; k <= 63; k++) {
          const u = (k / 63) * grow;
          const so = Math.sin(om) || 1;
          const p = V3.add(V3.scale(a, Math.sin((1 - u) * om) / so), V3.scale(b, Math.sin(u * om) / so));
          const lift = 1 + Math.sin(u / Math.max(grow, 1e-3) * Math.PI) * om * 0.12 + 0.004;
          arc.push(p[0] * lift, p[1] * lift, p[2] * lift, (i - 1) + u);
        }
      }
      if (arc.length) { gl.bindBuffer(gl.ARRAY_BUFFER, s.arcBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(arc)); }

      const vp = M4.mul(s.cam.proj(ctx.aspect, 0.05, 50), s.cam.view());
      const eye = s.cam.eye();
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.02, 0.022, 0.032, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.land);
      s.prog.use().set({ u_vp: vp, u_scale: 1, u_land: 0, u_sun: sunDir(), u_eye: eye, u_hover: s.hover || [0, 0, 0], u_time: t, u_atmo: false });
      s.globe.draw();
      s.pinP.use().set({ u_vp: vp, u_time: t });
      gl.bindVertexArray(s.pinVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, s.pinCount, s.pins.length);
      if (arc.length) { s.arcP.use().set({ u_vp: vp, u_time: t }); gl.bindVertexArray(s.arcVao); for (let i = 0; i < s.pins.length - 1; i++) gl.drawArrays(gl.LINE_STRIP, i * 64, 64); }
      if (params.atmo) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
        s.prog.use().set({ u_scale: 1.12, u_atmo: true });
        s.globe.draw();
        gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.disable(gl.DEPTH_TEST);
      const last = s.pins[s.pins.length - 1];
      s.read.textContent = (s.hover ? 'cursor ' + fmt(toLatLon(s.hover)) + ' · ' : '') + (last ? 'last pin ' + last.label : 'click to drop a pin') + ` · ${s.pins.length} pins`;
    },
  });

  function flyTo(s, d, dist) {
    s.fly = { t: 0, y0: s.cam.yaw, p0: s.cam.pitch, d0: s.cam.dist, y1: Math.atan2(d[0], d[2]), p1: Math.asin(Math.max(-1, Math.min(1, d[1]))), d1: dist };
  }
})();
