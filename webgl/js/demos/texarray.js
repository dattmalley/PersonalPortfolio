/* Texture Arrays & Samplers — a 24-layer 2D texture array is generated on the
 * GPU (rendering into each layer with framebufferTextureLayer), mipmapped, and
 * used as per-tile flipbook animation across an endless floor. The left and
 * right halves sample the SAME texture through different sampler objects. */
(function () {
  const S = window.Sandbox;
  const LAYERS = 24, SIZE = 256;
  const NAMES = ['Nearest', 'Bilinear', 'Trilinear', 'Anisotropic'];

  const GEN = S.GLSL.colors + `
in vec2 v_uv; out vec4 o; uniform float u_f;
void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float r = length(p), a = atan(p.y, p.x);
  vec3 c = vec3(0.07, 0.075, 0.09);
  vec2 g = floor(v_uv * 32.0);
  c += mod(g.x + g.y, 2.0) * 0.035;                                      // fine checker: aliasing bait
  c += step(0.9, fract(a * 24.0 / 6.2831853)) * 0.12 * smoothstep(0.95, 0.75, r) * step(0.32, r);
  float border = step(0.93, max(abs(p.x), abs(p.y)));
  c = mix(c, vec3(0.3, 0.31, 0.36), border);
  float seg = floor((a / 6.2831853 + 0.5) * 12.0);
  float age = mod(seg - u_f * 12.0, 12.0) / 12.0;                         // rotating comet of lit segments
  float ring = smoothstep(0.015, 0.0, abs(r - 0.62) - 0.11) * step(0.12, fract((a / 6.2831853 + 0.5) * 12.0));
  vec3 lit = mix(RED, BLUE, age) * pow(1.0 - age, 1.5) * 1.3;
  c = mix(c, c * 0.6 + lit, ring);
  c = mix(c, vec3(0.93, 0.91, 0.87), smoothstep(0.17, 0.15, r));
  c = mix(c, (u_f < 0.5 ? RED : BLUE), smoothstep(0.08, 0.06, r));
  o = vec4(c, 1.0);
}`;

  const FLOOR = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2DArray u_arr; uniform vec2 u_res; uniform float u_pitch; uniform float u_height;
uniform float u_time; uniform float u_scroll; uniform vec2 u_hover; uniform float u_layers; uniform float u_fps; uniform float u_x;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
vec3 ray(vec2 uv) {
  vec2 p = (uv * 2.0 - 1.0) * vec2(u_res.x / u_res.y, 1.0);
  vec3 f = normalize(vec3(0.0, -sin(u_pitch), -cos(u_pitch)));
  vec3 r = vec3(1.0, 0.0, 0.0), up = cross(r, f);
  return normalize(f * 1.4 + r * p.x + up * p.y);
}
vec2 floorUV(vec3 rd) {
  vec3 eye = vec3(u_x, u_height, 0.0);
  float t = -eye.y / rd.y;
  vec3 hp = eye + rd * t;
  return hp.xz * 0.5 + vec2(0.0, -u_scroll);
}
void main() {
  vec3 rd = ray(v_uv);
  vec3 sky = mix(vec3(0.05, 0.03, 0.045), vec3(0.015, 0.018, 0.03), smoothstep(0.0, 0.5, rd.y));
  if (rd.y > -0.002) { o = vec4(sky, 1.0); return; }
  vec2 uv = floorUV(rd);
  vec2 id = floor(uv);
  float speed = 0.5 + h(id + 3.1) * 1.5;
  float layer = mod(floor(h(id) * u_layers + u_time * u_fps * speed), u_layers);
  vec3 hrd = ray(u_hover);
  if (hrd.y < -0.002 && all(equal(floor(floorUV(hrd)), id))) layer = mod(floor(u_time * u_fps * 4.0), u_layers);
  // textureGrad with derivatives of the continuous uv avoids mip seams at tile edges
  vec3 c = textureGrad(u_arr, vec3(fract(uv), layer), dFdx(uv), dFdy(uv)).rgb;
  if (hrd.y < -0.002 && all(equal(floor(floorUV(hrd)), id))) c += vec3(0.06, 0.07, 0.1);
  float dist = -u_height / rd.y;
  c = mix(c, sky, 1.0 - exp(-dist * 0.018));
  o = vec4(c, 1.0);
}`;

  S.register({
    id: 'texarray',
    title: 'Texture Arrays & Samplers',
    category: 'Rendering',
    hint: 'move to slide the comparison split · drag to tilt',
    description: 'A 24-layer texture array is created with immutable storage, and each layer is drawn on the GPU by attaching it with framebufferTextureLayer. The layers form a flipbook, so every floor tile plays its own animation. The left and right of the split sample that same texture through two sampler objects (nearest, bilinear, trilinear or anisotropic), so you can compare filtering live.',
    interact: [['Move', 'Slide the comparison split'], ['Hover a tile', 'It plays at 4× speed'], ['Drag', 'Tilt the camera and strafe'], ['Wheel / pinch', 'Change altitude']],
    features: ['TEXTURE_2D_ARRAY + texStorage3D', 'framebufferTextureLayer (render to layer)', 'sampler2DArray + textureGrad', 'Sampler objects', 'EXT_texture_filter_anisotropic', 'Scissor test'],
    params: [
      { key: 'left', label: 'Left sampler', type: 'select', options: NAMES, value: 0 },
      { key: 'right', label: 'Right sampler', type: 'select', options: NAMES, value: 3 },
      { key: 'fps', label: 'Flipbook fps', type: 'range', min: 0, max: 30, step: 1, value: 12 },
      { key: 'speed', label: 'Travel speed', type: 'range', min: 0, max: 6, step: 0.1, value: 1.2 },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const levels = Math.log2(SIZE) + 1;
      const arr = util.rawTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, SIZE, SIZE, LAYERS);
      const gen = util.program(S.GLSL.fullscreenVS, GEN);
      const fb = util.framebuffer([]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, SIZE, SIZE);
      gen.use();
      for (let l = 0; l < LAYERS; l++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, arr, 0, l);
        gen.set({ u_f: l / LAYERS });
        ctx.util.drawFullscreen();
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      const base = { TEXTURE_WRAP_S: gl.CLAMP_TO_EDGE, TEXTURE_WRAP_T: gl.CLAMP_TO_EDGE };
      const samplers = [
        util.sampler({ ...base, TEXTURE_MIN_FILTER: gl.NEAREST, TEXTURE_MAG_FILTER: gl.NEAREST }),
        util.sampler({ ...base, TEXTURE_MIN_FILTER: gl.LINEAR, TEXTURE_MAG_FILTER: gl.LINEAR }),
        util.sampler({ ...base, TEXTURE_MIN_FILTER: gl.LINEAR_MIPMAP_LINEAR, TEXTURE_MAG_FILTER: gl.LINEAR }),
        util.sampler({ ...base, TEXTURE_MIN_FILTER: gl.LINEAR_MIPMAP_LINEAR, TEXTURE_MAG_FILTER: gl.LINEAR }),
      ];
      let anisoMax = 0;
      if (aniso) { anisoMax = Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)); gl.samplerParameterf(samplers[3], aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisoMax); }
      ctx.overlay.innerHTML = `<div class="ov-label" id="ta-l" style="top:auto;bottom:66px;transform:none"></div><div class="ov-label" id="ta-r" style="top:auto;bottom:66px;transform:none"></div><div id="ta-split" style="position:absolute;top:0;bottom:0;width:1px;background:linear-gradient(transparent,rgba(236,233,226,.6) 20%,rgba(236,233,226,.6) 80%,transparent)"></div>`;
      return {
        arr, samplers, anisoMax, prog: util.program(S.GLSL.fullscreenVS, FLOOR),
        split: 0.5, pitch: 0.42, height: 2.2, x: 0, scroll: 0,
        lab: [ctx.overlay.querySelector('#ta-l'), ctx.overlay.querySelector('#ta-r')], line: ctx.overlay.querySelector('#ta-split'),
      };
    },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      if (input.dragging) { s.pitch = Math.min(1.4, Math.max(0.08, s.pitch + input.dragDY * 0.004)); s.x -= input.dragDX * 0.01; }
      s.height = Math.min(12, Math.max(0.6, s.height * Math.exp(input.wheel * 0.001) / input.pinch));
      const target = input.hover || input.down ? input.uvx : 0.5 + 0.3 * Math.sin(t * 0.5);
      s.split += (target - s.split) * S.math.damp(12, dt);
      s.scroll += dt * params.speed;
      const splitPx = Math.round(s.split * ctx.width);
      const nm = (i) => (i === 3 ? (s.anisoMax ? `Anisotropic ${s.anisoMax}×` : 'Anisotropic (n/a: trilinear)') : NAMES[i]);
      s.lab[0].textContent = '← ' + nm(params.left); s.lab[0].style.left = Math.max(34, s.split * ctx.cssWidth - 200) + 'px';
      s.lab[0].style.width = '180px'; s.lab[0].style.textAlign = 'right';
      s.lab[1].textContent = nm(params.right) + ' →'; s.lab[1].style.left = s.split * ctx.cssWidth + 20 + 'px';
      s.line.style.left = s.split * ctx.cssWidth + 'px';

      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.arr);
      s.prog.use().set({ u_arr: 0, u_res: [ctx.width, ctx.height], u_pitch: s.pitch, u_height: s.height, u_time: t, u_scroll: s.scroll, u_hover: [input.uvx, input.uvy], u_layers: LAYERS, u_fps: params.fps, u_x: s.x });
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, splitPx, ctx.height); gl.bindSampler(0, s.samplers[params.left]); ctx.util.drawFullscreen();
      gl.scissor(splitPx, 0, ctx.width - splitPx, ctx.height); gl.bindSampler(0, s.samplers[params.right]); ctx.util.drawFullscreen();
      gl.disable(gl.SCISSOR_TEST);
      gl.bindSampler(0, null);
    },
  });
})();
