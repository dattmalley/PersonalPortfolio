# WebGL2 Interaction Lab

A sandbox of 28 interaction and motion studies written in **raw WebGL 2.0**: no libraries and no build step. Open `webgl/index.html` through any static server (or GitHub Pages). Deep-link to a demo with its hash, e.g. `webgl/index.html#particles`.

| Group | Demo | Interaction / motion | Key WebGL2 features |
|---|---|---|---|
| Pointer & Touch | Pointer Field | Eased follower chain, click shockwaves | `gl_VertexID` fullscreen triangle, uniform arrays |
| | Feedback Paint | Multi-touch painting, decaying trails | Ping-pong render targets, RGBA16F |
| | Water Ripples | Stir / drop / rain on a wave sim | Half-float simulation |
| | Jelly Grid | Grab-and-fling soft body | Dynamic buffers, Uint32 indices |
| | Mesh Painter | Paint onto a 3D model | `PIXEL_PACK_BUFFER`, `fenceSync`, `getBufferSubData` |
| | X-Ray Lens | Multi-touch lenses revealing an interior | Stencil buffer, `colorMask` |
| Camera & Navigation | Orbit Camera | Inertial orbit, pinch zoom, pan, gamepad | Uniform Buffer Objects |
| | Terrain Flight | WASD / gamepad flight, mouse-look | 32-bit indices, uint hashing |
| | WebXR Room | Inline, stereo preview, immersive VR/AR | WebXR, `XRWebGLLayer`, per-eye viewports |
| Selection | GPU Picking | Hover outlines, click springs + ripple | MRT, R32UI targets, integer `readPixels` |
| Simulation | Fluid Simulation | Push ink with any number of pointers | RG16F/R16F targets, Jacobi pressure solve |
| | Flocking Ribbons | Lead or scatter two flocks | Primitive restart, `drawRangeElements`, `vertexAttribIPointer` |
| GPU Motion | Instancing Swarm | 200k instances, repel, morph | `drawArraysInstanced`, `gl_InstanceID` |
| | Transform Feedback Particles | 1M particles | Transform feedback, `RASTERIZER_DISCARD` |
| Animation | Easing Lab | 8 easing curves + spring | Instanced SDF quads |
| | Scroll Morph | Wheel-scrubbed morph targets | 8 vertex attributes |
| | IK Tentacles | Tentacles reach for the pointer | GPU skinning, bone UBO, FABRIK |
| Rendering | Raymarched SDF | Cursor-as-blob, floor pulses | Ray marching, `blitFramebuffer` |
| | Volume (3D Texture) | Orbit, clip-plane sweep | `TEXTURE_3D`, `sampler3D` |
| | Post-Processing Lens | Aberration, glitch, compare | MSAA, `texStorage2D`, `invalidateFramebuffer` |
| | Shadow Studio | Steer the sun, raise pillars | Depth textures, `sampler2DShadow`, sampler objects |
| | Texture Arrays & Samplers | Live filtering comparison | `TEXTURE_2D_ARRAY`, `framebufferTextureLayer`, anisotropy |
| | HDR & Eye Adaptation | Flash and watch exposure adapt | R11F_G11F_B10F, sRGB textures, tone mapping |
| Performance | Occlusion & Timer Queries | Slide the occluder, god view | Occlusion queries, `EXT_disjoint_timer_query_webgl2` |
| | Worker Render | Freeze the main thread | OffscreenCanvas in a Web Worker |
| Sensors & Media | Parallax Tilt | Gyroscope / pointer parallax | DeviceOrientation API |
| | Audio Reactive | Synth or microphone | Vertex texture fetch, R8 streaming |
| | Camera Mirror | Webcam / dropped media effects | Video textures, `copyTexSubImage3D` ring buffer |

Not covered (rare or hardware-specific): `OVR_multiview2`, `WEBGL_multi_draw`, `EXT_clip_control`,
`WEBGL_clip_cull_distance`, compressed texture formats, and `KHR_parallel_shader_compile`.

## Structure

```
webgl/
  index.html        layout + script includes
  style.css         dark theme (red #ff3b4e / blue #3b8bff accents)
  js/core.js        math, geometry, GL resource tracker, orbit camera, unified input
  js/app.js         navigation, auto-generated controls, render loop, context-loss handling
  js/demos/*.js     one file per demo, each calling Sandbox.register({...})
```

## Adding a demo

Create `js/demos/my-demo.js`, add a `<script>` tag before `app.js`, and register:

```js
Sandbox.register({
  id: 'my-demo', title: 'My Demo', category: 'Rendering',
  description: '…', hint: '…', interact: [['Drag', 'does X']], features: ['…'],
  params: [{ key: 'speed', label: 'Speed', type: 'range', min: 0, max: 2, step: 0.1, value: 1 }],
  init(ctx) { return { prog: ctx.util.program(Sandbox.GLSL.fullscreenVS, `out vec4 o; void main(){ o = vec4(1); }`) }; },
  frame(ctx, s, t, dt) { s.prog.use(); ctx.util.drawFullscreen(); },
});
```

Every GPU object made through `ctx.util` is freed automatically when you switch demos. `ctx.input` provides the pointer position, drag deltas, wheel, pinch, clicks, every active touch point and the held keys.
