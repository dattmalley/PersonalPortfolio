# WebGL2 Interaction Lab

A sandbox of 44 interaction and motion studies written in **raw WebGL 2.0**: no libraries and no build step. Open `webgl/index.html` through any static server (or GitHub Pages). The home view shows nine groups as tabs; each group is a masonry grid of study cards (stacked on phones and in portrait), and a card opens the full study. Deep-link to a demo with its hash, e.g. `webgl/index.html#particles`.

| Group | Study | Interaction / technique |
|---|---|---|
| Pointer & Touch | Pointer Field | Eased follower chain, shockwaves |
|  | Feedback Paint | Multi-touch painting, decaying trails |
|  | Water Ripples | Wave-equation sim |
|  | Jelly Grid | Grab-and-fling soft body |
|  | Mesh Painter | Paint onto a 3D model (async readback) |
|  | X-Ray Lens | Stencil lenses, one per finger |
|  | Gesture Lab | Drag, fling, pinch, twist, double-tap, long-press |
|  | Pressure Ink | Pen pressure / tilt / twist / eraser, coalesced events |
|  | Sculpt | Raise, dig, smooth, pinch clay |
|  | Hover Distortion | Tilt, liquid warp, RGB split, click to expand |
| Camera & Navigation | Orbit Camera | Inertial orbit, zoom, pan (UBOs) |
|  | Terrain Flight | WASD / gamepad flight |
|  | WebXR Room | Inline, stereo, immersive VR/AR |
|  | Fractal Zoom | Zoom-to-cursor infinite canvas, emulated 64-bit |
|  | Globe & Geolocation | Spin, pins, great-circle arcs, locate me |
|  | Pointer-Lock Walk | Pointer Lock FPS, jump, touch joystick |
| Selection | GPU Picking | MRT + R32UI ID buffer |
|  | Marquee & Lasso | Stencil even-odd mask + transform-feedback selection |
|  | Transform Gizmo | Translate / rotate / scale handles, snap, undo |
|  | Voxel Builder | DDA ray-march placement, paint, mirror, undo |
| Simulation | Fluid Simulation | Stable fluids on half-float targets |
|  | Flocking Ribbons | Boids, primitive restart |
|  | Physics Playground | Grab & fling, charged shots, tilt gravity, haptics |
| GPU Motion | Instancing Swarm | 200k instances |
|  | Transform Feedback Particles | 1M particles |
|  | Type & Particles | Keyboard text into 30k particles |
| Animation | Easing Lab | 8 easings + spring |
|  | Scroll Morph | Wheel-scrubbed morph targets |
|  | IK Tentacles | GPU skinning + FABRIK |
|  | Path Follow | Draw a path; arc-length travellers, chase cam |
|  | Swipe Transitions | Gesture-scrubbed shader transitions |
|  | Scroll Story | DOM scroll drives a camera spline |
| Rendering | Raymarched SDF | Ray marching |
|  | Volume (3D Texture) | TEXTURE_3D |
|  | Post-Processing Lens | MSAA, mip bloom |
|  | Shadow Studio | Depth textures, sampler objects |
|  | Texture Arrays & Samplers | Filtering comparison |
|  | HDR & Eye Adaptation | R11F_G11F_B10F, tone mapping |
| Performance | Occlusion & Timer Queries | Async occlusion culling |
|  | Worker Render | OffscreenCanvas in a worker |
| Sensors & Media | Parallax Tilt | DeviceOrientation |
|  | Audio Reactive | Synth / microphone |
|  | Camera Mirror | Webcam, screen share, paste, drop |
|  | Voice & MIDI | Web Speech, Web MIDI, keyboard piano |

Not covered (rare or hardware-specific): `OVR_multiview2`, `WEBGL_multi_draw`, `EXT_clip_control`,
`WEBGL_clip_cull_distance`, compressed texture formats, and `KHR_parallel_shader_compile`.

## Thumbnails

`thumbs/*.jpg` are rendered from the studies themselves via capture mode: `index.html?capture=<id>` draws one study full-window without UI.

## Structure

```
webgl/
  index.html        layout + script includes
  style.css         dark theme (red #ff3b4e / blue #3b8bff accents)
  js/core.js        math, geometry, GL resource tracker, orbit camera, unified input
  js/app.js         navigation, auto-generated controls, render loop, context-loss handling
  js/demos/*.js     one file per study, each calling Sandbox.register({...})
  thumbs/           card thumbnails (generated)
  data/             Natural Earth coastlines for the globe (see LICENSE-world-atlas.txt)
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
