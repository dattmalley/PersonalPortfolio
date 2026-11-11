# WebGL2 Interaction Lab

A sandbox of interaction and motion techniques written in **raw WebGL 2.0**: no libraries and no build step. Open `webgl/index.html` through any static server (or GitHub Pages). Deep-link to a demo with its hash, e.g. `webgl/index.html#particles`.

| # | Demo | Interaction / motion | Key WebGL2 features |
|---|------|----------------------|---------------------|
| 01 | Pointer Field | Eased follower chain, click shockwaves | `gl_VertexID` fullscreen triangle, uniform arrays |
| 02 | Feedback Paint | Multi-touch painting, decaying trails | Ping-pong render targets, RGBA16F |
| 03 | Water Ripples | Stir / drop / rain on a wave sim | Half-float simulation, `EXT_color_buffer_float` |
| 04 | Jelly Grid | Grab-and-fling soft body (multi-touch) | Dynamic buffers, Uint32 indices |
| 05 | Orbit Camera | Inertial orbit, pinch zoom, pan | Uniform Buffer Objects, VAOs |
| 06 | Terrain Flight | WASD flight, mouse-look, autopilot | 32-bit indices, uint hashing, displacement |
| 07 | GPU Picking | Hover outlines, click springs + ripple | MRT, R32UI targets, `readPixels` integer |
| 08 | Instancing Swarm | 200k instances, repel, formation morph | `drawArraysInstanced`, `gl_InstanceID` |
| 09 | Transform Feedback Particles | 1M particles: attract, repel, burst | Transform feedback, `RASTERIZER_DISCARD` |
| 10 | Easing Lab | 8 easing curves + physical spring, retargeting | Instanced SDF quads |
| 11 | Scroll Morph | Wheel-scrubbed morph targets, velocity twist | 8 vertex attributes |
| 12 | Raymarched SDF | Cursor-as-blob, floor pulses | Per-pixel ray marching, `blitFramebuffer` upscale |
| 13 | Volume (3D Texture) | Orbit, clip-plane sweep | `TEXTURE_3D`, `sampler3D` |
| 14 | Post-Processing Lens | Pointer-driven aberration, glitch, compare split | MSAA renderbuffers, `texStorage2D`, mip bloom |
| 15 | Parallax Tilt | Gyroscope / pointer parallax | DeviceOrientation API |
| 16 | Audio Reactive | Built-in synth or microphone | Vertex texture fetch, R8 streaming |

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
