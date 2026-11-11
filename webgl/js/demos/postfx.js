/* Post-Processing — scene rendered into a multisampled renderbuffer, resolved
 * with blitFramebuffer into an immutable mipmapped texture, then run through a
 * pointer-driven lens: chromatic aberration, mip-chain bloom, glitch, scanlines. */
(function () {
  const S = window.Sandbox;
  const { M4 } = S.math;
  const N = 220;

  const SCENE_VS = `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp; uniform float u_time;
out vec3 v_n; out vec3 v_local; flat out int v_i;
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
void main() {
  float i = float(gl_InstanceID);
  float a = i / ${N}.0 * 6.2831853 * 3.0 + u_time * 0.25;
  float ring = mod(i, 3.0);
  float R = 2.2 + ring * 0.9;
  vec3 c = vec3(cos(a) * R, sin(a * 2.0 + u_time) * 0.45 + (ring - 1.0) * 0.3, sin(a) * R);
  mat3 m = rotY(a * 2.0 + u_time) * rotX(u_time * 1.3 + i);
  v_n = m * a_nrm; v_local = a_pos; v_i = gl_InstanceID;
  gl_Position = u_vp * vec4(c + m * a_pos * 0.32, 1.0);
}`;
  const SCENE_FS = S.GLSL.colors + `
in vec3 v_n; in vec3 v_local; flat in int v_i; out vec4 o; uniform float u_time;
void main() {
  vec3 n = normalize(v_n);
  float d = 0.25 + 0.75 * max(dot(n, normalize(vec3(0.4, 0.9, 0.3))), 0.0);
  vec3 base = (v_i % 2 == 0) ? RED : BLUE;
  // emissive edges feed the bloom
  vec3 a = abs(v_local) * 2.0;
  float e = step(0.88, a.x + a.y + a.z - max(max(a.x, a.y), a.z));
  float pulse = 0.5 + 0.5 * sin(u_time * 3.0 + float(v_i) * 0.4);
  o = vec4(base * d * 0.35 + e * base * (1.2 + pulse * 1.3), 1.0);
}`;
  const POST = S.GLSL.colors + `
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_res; uniform vec2 u_mouse; uniform float u_time;
uniform float u_ab; uniform float u_bloom; uniform float u_glitch; uniform float u_scan; uniform float u_pixel;
uniform bool u_compare; uniform float u_split;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = v_uv;
  if (u_compare && uv.x < u_split) {
    o = vec4(texture(u_tex, uv).rgb, 1.0);
    if (abs(uv.x - u_split) < 1.5 / u_res.x) o = vec4(1.0);
    return;
  }
  if (u_pixel > 1.0) { vec2 px = u_res / u_pixel; uv = (floor(uv * px) + 0.5) / px; }
  // glitch: horizontal block displacement
  if (u_glitch > 0.0) {
    float row = floor(uv.y * 24.0 + floor(u_time * 14.0) * 3.0);
    float r = h(row + floor(u_time * 20.0));
    if (r < u_glitch * 0.6) uv.x += (h(row * 1.7) - 0.5) * 0.12 * u_glitch;
  }
  vec2 dir = uv - u_mouse;
  float dist = length(dir * vec2(u_res.x / u_res.y, 1.0));
  vec2 off = dir * u_ab * 0.03 * (0.4 + dist);
  vec3 c;
  c.r = texture(u_tex, uv + off).r;
  c.g = texture(u_tex, uv).g;
  c.b = texture(u_tex, uv - off).b;
  // bloom from the mip chain
  vec3 g = textureLod(u_tex, uv, 2.0).rgb * 0.5 + textureLod(u_tex, uv, 3.0).rgb * 0.7 + textureLod(u_tex, uv, 4.0).rgb + textureLod(u_tex, uv, 5.5).rgb * 1.2;
  c += max(g - 0.25, 0.0) * u_bloom;
  // scanlines + vignette + grain
  c *= 1.0 - u_scan * 0.25 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));
  c *= 1.0 - 0.5 * pow(length(v_uv - 0.5) * 1.25, 2.5);
  c += (h(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + u_time) - 0.5) * 0.04;
  if (u_glitch > 0.2) c = mix(c, c.bgr, step(0.92, h(floor(uv.y * 60.0) + floor(u_time * 30.0))) * u_glitch);
  c = c / (1.0 + c * 0.25);
  o = vec4(c, 1.0);
}`;

  function targets(ctx, s) {
    const { gl, util } = ctx;
    if (s.msFbo) util.release(s.msFbo, s.msColor, s.msDepth, s.resFbo, s.resTex);
    const w = ctx.width, h = ctx.height;
    const samples = Math.min(4, ctx.caps.maxSamples || 0);
    s.msColor = util.renderbuffer(gl.RGBA8, w, h, samples);
    s.msDepth = util.renderbuffer(gl.DEPTH_COMPONENT24, w, h, samples);
    s.msFbo = util.framebuffer([{ rb: s.msColor }], s.msDepth);
    // Immutable storage with a full mip chain (NPOT mipmaps are legal in WebGL2).
    s.levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    s.resTex = util.rawTexture();
    gl.bindTexture(gl.TEXTURE_2D, s.resTex);
    gl.texStorage2D(gl.TEXTURE_2D, s.levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    s.resFbo = util.framebuffer([s.resTex]);
  }

  S.register({
    id: 'postfx',
    title: 'Post-Processing Lens',
    category: 'Rendering',
    hint: 'move to bend the lens · hold to glitch',
    description: 'The scene is drawn into a 4× multisampled renderbuffer, resolved with blitFramebuffer into a texture with immutable storage (texStorage2D), and mipmapped every frame. The post pass uses the mip chain as a cheap bloom (textureLod), and the pointer drives chromatic aberration radiating from the cursor. Holding down glitches the image, and compare mode puts a before/after split under the pointer.',
    interact: [['Move', 'Aberration radiates from the pointer'], ['Hold', 'Glitch burst'], ['Compare', 'Split screen follows the pointer'], ['Pixelate', 'Quantize the image']],
    features: ['MSAA renderbuffers', 'blitFramebuffer resolve', 'texStorage2D', 'NPOT mipmaps', 'textureLod bloom', 'Instanced scene'],
    params: [
      { key: 'ab', label: 'Chromatic aberration', type: 'range', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'bloom', label: 'Bloom', type: 'range', min: 0, max: 3, step: 0.05, value: 1.3 },
      { key: 'scan', label: 'Scanlines', type: 'range', min: 0, max: 1, step: 0.05, value: 0.4 },
      { key: 'pixel', label: 'Pixelate', type: 'range', min: 1, max: 16, step: 1, value: 1 },
      { key: 'compare', label: 'Compare (split at pointer)', type: 'toggle', value: false },
    ],
    init(ctx) {
      const { gl, util } = ctx;
      const cube = S.geo.cube();
      const buf = util.buffer(gl.ARRAY_BUFFER, cube.data);
      const s = {
        scene: util.program(SCENE_VS, SCENE_FS), post: util.program(S.GLSL.fullscreenVS, POST),
        vao: util.vao([{ buffer: buf, loc: 0, size: 3, stride: 24 }, { buffer: buf, loc: 1, size: 3, stride: 24, offset: 12 }]),
        cam: new S.OrbitCam({ dist: 8.5, pitch: 0.45, minDist: 4, maxDist: 16, auto: 0.08 }),
        glitch: 0, mouse: [0.5, 0.5],
      };
      targets(ctx, s);
      return s;
    },
    resize(ctx, s) { targets(ctx, s); },
    frame(ctx, s, t, dt) {
      const { gl, input, params } = ctx;
      s.cam.update(input, dt, false);
      s.glitch = input.down ? Math.min(1, s.glitch + dt * 3) : Math.max(0, s.glitch - dt * 2.5);
      const tx = input.hover || input.down ? input.uvx : 0.5 + 0.3 * Math.sin(t * 0.7);
      const ty = input.hover || input.down ? input.uvy : 0.5 + 0.2 * Math.cos(t * 0.9);
      const k = S.math.damp(10, dt);
      s.mouse[0] += (tx - s.mouse[0]) * k; s.mouse[1] += (ty - s.mouse[1]) * k;

      // 1. scene → MSAA
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.msFbo);
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.02, 0.022, 0.035, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      s.scene.use().set({ u_vp: M4.mul(s.cam.proj(ctx.aspect, 0.1, 60), s.cam.view()), u_time: t });
      gl.bindVertexArray(s.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, N);
      gl.disable(gl.DEPTH_TEST);
      // 2. resolve MSAA → texture level 0, then build the mip chain
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.msFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.resFbo);
      gl.blitFramebuffer(0, 0, ctx.width, ctx.height, 0, 0, ctx.width, ctx.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, s.resTex);
      gl.generateMipmap(gl.TEXTURE_2D);
      // 3. post
      gl.viewport(0, 0, ctx.width, ctx.height);
      s.post.use().set({
        u_tex: 0, u_res: [ctx.width, ctx.height], u_mouse: s.mouse, u_time: t, u_ab: params.ab, u_bloom: params.bloom,
        u_glitch: s.glitch, u_scan: params.scan, u_pixel: params.pixel > 1 ? params.pixel * ctx.dpr : 1, u_compare: params.compare, u_split: s.mouse[0],
      });
      ctx.util.drawFullscreen();
    },
  });
})();
