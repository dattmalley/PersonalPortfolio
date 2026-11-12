/* Group H — Physics & Render: Physics2D, PhysicsProps, canvas, WebGL, PixiJS, EaselJS. */
(function () {
  const { h } = Lab;

  Lab.register({
    id: 'physics2d', title: 'Physics2D Bursts', category: 'Physics & Render', thumb: 'tall',
    hint: 'click anywhere for a burst',
    description: 'Physics2DPlugin animates position with velocity, angle, gravity, acceleration and friction rather than a fixed destination, so motion is ballistic and believable. Each click launches a burst of particles at random angles and speeds; gravity pulls them down while they fade. The duration still bounds each tween, so cleanup stays predictable.',
    interact: [['Click', 'Burst at the pointer'], ['Gravity / friction', 'Shape the arcs']],
    features: ['physics2D: { velocity, angle, gravity }', 'friction / acceleration / accelerationAngle', 'Random angles per particle'],
    params: [
      { key: 'g', label: 'gravity', type: 'range', min: 0, max: 1500, step: 10, value: 600 },
      { key: 'f', label: 'friction', type: 'range', min: 0, max: 0.2, step: 0.005, value: 0.02 },
    ],
    code: `gsap.to(particle, { duration: 2.5, opacity: 0,
  physics2D: { velocity: 'random(200, 650)', angle: 'random(200, 340)', gravity: 600, friction: 0.02 } });`,
    init(ctx) {
      const layer = h('<div class="fill" style="cursor:crosshair"></div>');
      const hint = h('<div class="hint-c">click to burst</div>');
      ctx.root.append(layer, hint);
      const burst = ctx.safe((x, y) => {
        gsap.to(hint, { opacity: 0, duration: 0.3 });
        for (let i = 0; i < 40; i++) {
          const p = h(`<div class="dot" style="--s:${gsap.utils.random(0.8, 2.4)}cqmin;position:absolute;left:${x}px;top:${y}px;background:${gsap.utils.random([Lab.ACC1, Lab.ACC2, Lab.BONE])}"></div>`);
          layer.appendChild(p);
          gsap.to(p, { duration: 2.6, opacity: 0, scale: 0.4, physics2D: { velocity: gsap.utils.random(200, 700), angle: gsap.utils.random(200, 340), gravity: ctx.params.g, friction: ctx.params.f }, onComplete: () => p.remove() });
        }
      });
      ctx.on(layer, 'click', (e) => { const r = layer.getBoundingClientRect(); burst(e.clientX - r.left, e.clientY - r.top); });
      ctx.later(0.4, () => burst(ctx.width * 0.5, ctx.height * 0.62));
      ctx.every(1.2, () => { if (ctx.capture || !ctx.root.matches(':hover')) burst(gsap.utils.random(0.25, 0.75) * ctx.width, gsap.utils.random(0.5, 0.75) * ctx.height); });
      return {};
    },
  });

  Lab.register({
    id: 'physicsprops', title: 'PhysicsProps', category: 'Physics & Render', thumb: 'square',
    hint: 'click a token to flick it',
    description: 'PhysicsPropsPlugin applies velocity, acceleration and friction to any properties independently: x, y, rotation, scale, even opacity. A click flicks a token with random x velocity and spin while friction brings each property to rest at its own pace. Unlike Physics2D it has no single heading, so every property decays separately.',
    interact: [['Click a token', 'Flick it (x + rotation + scale velocities)'], ['Friction', 'How quickly each property settles']],
    features: ['physicsProps: { x: { velocity, friction } }', 'rotation / scale velocities', 'acceleration', 'Independent per-property physics'],
    params: [{ key: 'f', label: 'friction', type: 'range', min: 0.02, max: 0.5, step: 0.01, value: 0.12 }],
    code: `gsap.to(token, { duration: 3, physicsProps: {
  x: { velocity: 'random(-600, 600)', friction: 0.12 },
  rotation: { velocity: 'random(-720, 720)', friction: 0.1 },
  scale: { velocity: 1.5, friction: 0.3 } } });`,
    init(ctx) {
      const wrap = h('<div class="center"><div data-row style="display:flex;gap:3cqmin"></div></div>');
      const row = wrap.querySelector('[data-row]');
      for (let i = 0; i < 6; i++) row.appendChild(h(`<div class="box ${i % 2 ? 'b2' : ''}" style="--s:10cqmin;cursor:pointer;border-radius:${i % 3 === 0 ? '50%' : '10%'}"></div>`));
      ctx.root.appendChild(wrap);
      const flick = ctx.safe((t) => gsap.to(t, { duration: 3, physicsProps: { x: { velocity: gsap.utils.random(-500, 500), friction: ctx.params.f }, y: { velocity: gsap.utils.random(-300, 100), acceleration: 300, friction: ctx.params.f }, rotation: { velocity: gsap.utils.random(-900, 900), friction: ctx.params.f * 0.8 } }, onComplete: () => gsap.to(t, { x: 0, y: 0, rotation: 0, duration: 1, ease: 'elastic.out(1,0.5)' }) }));
      [...row.children].forEach((t) => ctx.on(t, 'click', () => flick(t)));
      ctx.every(1.4, () => { if (!ctx.root.matches(':hover')) flick(gsap.utils.random([...row.children])); });
      return {};
    },
  });

  Lab.register({
    id: 'canvas2d', title: 'GSAP + Canvas', category: 'Physics & Render', thumb: 'wide',
    hint: 'click to re-form the particle field',
    description: 'GSAP drives a canvas by tweening plain objects. Each of 900 particles is an object with x, y, radius and hue; staggered tweens with repeatRefresh move them between formations, and a single gsap.ticker callback redraws the canvas every frame. Click to cycle formations; the draw loop never needs to know what is animating.',
    interact: [['Click', 'Next formation (grid · ring · scatter · wave)'], ['Watch', 'Staggered object tweens rendered by one ticker callback']],
    features: ['Tweening arrays of objects', 'gsap.ticker.add(render)', 'stagger on non-DOM targets', 'Function values per object'],
    code: `const parts = Array.from({ length: 900 }, () => ({ x: 0, y: 0, r: 2 }));
gsap.to(parts, { x: (i) => ring(i).x, y: (i) => ring(i).y, stagger: { amount: 0.8, from: 'random' } });
gsap.ticker.add(() => { ctx.clearRect(0, 0, w, h); parts.forEach(draw); });`,
    init(ctx) {
      const cv = h('<canvas class="fill" style="cursor:pointer"></canvas>');
      ctx.root.appendChild(cv);
      const g = cv.getContext('2d');
      const N = 900, parts = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), r: 1, c: 0 }));
      const forms = [
        (i) => ({ x: 0.15 + (i % 36) / 35 * 0.7, y: 0.15 + Math.floor(i / 36) / 24 * 0.7, r: 1.4, c: 0 }),
        (i) => { const a = (i / N) * Math.PI * 2 * 3, rr = 0.18 + (i % 3) * 0.08; return { x: 0.5 + Math.cos(a) * rr * 0.75, y: 0.5 + Math.sin(a) * rr, r: 1.6, c: 1 }; },
        () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 2.4 + 0.4, c: 2 }),
        (i) => ({ x: (i / N), y: 0.5 + Math.sin((i / N) * Math.PI * 6) * 0.22 + (i % 5 - 2) * 0.012, r: 1.2, c: 1 }),
      ];
      let k = 0;
      const next = ctx.safe(() => { const f = forms[(k = (k + 1) % forms.length)]; gsap.to(parts, { x: (i) => f(i).x, y: (i) => f(i).y, r: (i) => f(i).r, c: (i) => f(i).c, duration: 1.4, ease: 'power3.inOut', stagger: { amount: 0.9, from: 'random' } }); });
      const render = () => {
        const W = (cv.width = ctx.width * devicePixelRatio), H = (cv.height = ctx.height * devicePixelRatio);
        g.clearRect(0, 0, W, H);
        for (const p of parts) { g.fillStyle = p.c < 0.5 ? Lab.ACC1 : p.c < 1.5 ? Lab.ACC2 : Lab.BONE; g.beginPath(); g.arc(p.x * W, p.y * H, p.r * devicePixelRatio, 0, Math.PI * 2); g.fill(); }
      };
      gsap.ticker.add(render);
      ctx.on(cv, 'click', next);
      next();
      ctx.every(2.6, () => { if (!ctx.root.matches(':hover')) next(); });
      return { render };
    },
    dispose(ctx, s) { gsap.ticker.remove(s.render); },
  });

  Lab.register({
    id: 'webgl-uniforms', title: 'GSAP + WebGL Uniforms', category: 'Physics & Render', thumb: 'portrait',
    hint: 'hover to warp · click for the next palette',
    description: 'GSAP drives a raw WebGL fragment shader by tweening a plain object of uniform values: warp strength, zoom, palette colours and a ripple origin. Hovering eases the warp toward the pointer with quickTo, and clicking runs a timeline that crossfades palettes and fires a ripple. The shader only reads numbers; GSAP choreographs them.',
    interact: [['Move pointer', 'quickTo eases the warp centre'], ['Click', 'Timeline: ripple + palette crossfade'], ['Idle', 'Slow breathing zoom']],
    features: ['Tweening a uniforms object', 'gsap.quickTo() for pointer-driven uniforms', 'Colour arrays tweened as numbers', 'gsap.ticker render loop'],
    code: `const u = { warp: 0.2, zoom: 1, mx: 0.5, my: 0.5, ripple: 0, c1: [0.18, 0.88, 0.48] };
const toX = gsap.quickTo(u, 'mx', { duration: 0.6 });
gsap.timeline().to(u, { ripple: 1, duration: 1.2 }).to(u.c1, { 0: 1, 1: 0.7, 2: 0.14 }, 0);
gsap.ticker.add(() => { gl.uniform1f(loc.warp, u.warp); /* … */ draw(); });`,
    init(ctx) {
      const cv = h('<canvas class="fill" style="cursor:crosshair"></canvas>');
      ctx.root.appendChild(cv);
      const gl = cv.getContext('webgl');
      if (!gl) { ctx.root.appendChild(h('<div class="hint-c">WebGL is not available here.</div>')); return {}; }
      const vs = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
      const fs = `precision highp float; varying vec2 uv; uniform float t, warp, zoom, ripple; uniform vec2 m, res; uniform vec3 c1, c2;
        void main(){ vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0) * zoom; vec2 q = p - (m - 0.5) * vec2(res.x / res.y, 1.0);
          float d = length(q); p += normalize(q + 1e-4) * warp * 0.25 * sin(d * 10.0 - t * 2.0) * exp(-d * 1.5);
          float rp = sin(d * 30.0 - ripple * 25.0) * exp(-abs(d - ripple * 1.2) * 8.0) * (1.0 - ripple);
          float v = sin(p.x * 6.0 + t) * cos(p.y * 5.0 - t * 0.7) + sin(length(p) * 9.0 - t * 1.3) + rp * 2.0;
          vec3 col = mix(c1, c2, smoothstep(-1.2, 1.2, v)); col *= 0.6 + 0.5 * smoothstep(-0.5, 1.5, v); col *= 1.0 - 0.35 * dot(uv - 0.5, uv - 0.5);
          gl_FragColor = vec4(col * 0.9, 1.0); }`;
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const U = (n) => gl.getUniformLocation(prog, n);
      const pal = [[[0.18, 0.88, 0.48], [0.04, 0.05, 0.07]], [[1, 0.7, 0.14], [0.05, 0.04, 0.06]], [[0.93, 0.91, 0.87], [0.06, 0.12, 0.1]]];
      const u = { t: 0, warp: 0.4, zoom: 1, mx: 0.5, my: 0.5, ripple: 1, c1: pal[0][0].slice(), c2: pal[0][1].slice() };
      const toX = gsap.quickTo(u, 'mx', { duration: 0.8, ease: 'power3' }), toY = gsap.quickTo(u, 'my', { duration: 0.8, ease: 'power3' });
      gsap.to(u, { zoom: 1.4, duration: 5, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      let k = 0;
      const pulse = ctx.safe(() => { const p = pal[(k = (k + 1) % pal.length)]; gsap.timeline().fromTo(u, { ripple: 0 }, { ripple: 1, duration: 1.4, ease: 'power2.out' }).to(u.c1, { 0: p[0][0], 1: p[0][1], 2: p[0][2], duration: 1 }, 0).to(u.c2, { 0: p[1][0], 1: p[1][1], 2: p[1][2], duration: 1 }, 0).fromTo(u, { warp: 1.4 }, { warp: 0.4, duration: 1.4, ease: 'power2.out' }, 0); });
      ctx.on(cv, 'pointermove', (e) => { const r = cv.getBoundingClientRect(); toX((e.clientX - r.left) / r.width); toY(1 - (e.clientY - r.top) / r.height); });
      ctx.on(cv, 'click', pulse);
      const render = (time) => {
        const W = Math.round(ctx.width * Math.min(devicePixelRatio, 2)), H = Math.round(ctx.height * Math.min(devicePixelRatio, 2));
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
        gl.viewport(0, 0, W, H);
        gl.uniform1f(U('t'), time); gl.uniform1f(U('warp'), u.warp); gl.uniform1f(U('zoom'), u.zoom); gl.uniform1f(U('ripple'), u.ripple);
        gl.uniform2f(U('m'), u.mx, u.my); gl.uniform2f(U('res'), W, H); gl.uniform3fv(U('c1'), u.c1); gl.uniform3fv(U('c2'), u.c2);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      gsap.ticker.add(render);
      ctx.every(3, () => { if (!ctx.root.matches(':hover')) pulse(); });
      return { render, gl };
    },
    dispose(ctx, s) { if (s.render) gsap.ticker.remove(s.render); if (s.gl) { const e = s.gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } },
  });

  Lab.register({
    id: 'pixi', title: 'PixiPlugin', category: 'Physics & Render', thumb: 'square',
    hint: 'hover sprites · click to scramble',
    description: 'PixiPlugin gives GSAP direct access to PixiJS display objects through pixi: { … }. Position, scale, rotation and tint tween directly, and so do filter values (blur, brightness, saturation, hue, colorize) that would otherwise need manual ColorMatrixFilter work. Hover a sprite to light it; click to send the field to new positions.',
    interact: [['Hover a sprite', 'pixi: { scale, tint, brightness }'], ['Click', 'Scatter with blur and hue on the way'], ['Watch', 'Filters animate as easily as positions']],
    features: ['PixiPlugin.registerPIXI(PIXI)', 'pixi: { x, y, scale, rotation, tint }', 'pixi: { blur, brightness, saturation, hue, colorize }', 'PixiJS v7 display objects'],
    code: `PixiPlugin.registerPIXI(PIXI);
gsap.to(sprite, { pixi: { x: 300, scale: 1.4, rotation: 90, tint: '#2fe07a' } });
gsap.to(sprite, { pixi: { blur: 8, brightness: 1.6, hue: 120, saturation: 0.2 } });`,
    init(ctx) {
      if (!window.PIXI) { ctx.root.appendChild(h('<div class="hint-c">PixiJS failed to load.</div>')); return {}; }
      PixiPlugin.registerPIXI(PIXI);
      const app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, resizeTo: ctx.root, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
      app.view.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      ctx.root.appendChild(app.view);
      const sprites = [];
      for (let i = 0; i < 24; i++) {
        const g = new PIXI.Graphics(); g.beginFill(0xffffff); if (i % 3 === 0) g.drawCircle(0, 0, 26); else if (i % 3 === 1) g.drawRoundedRect(-24, -24, 48, 48, 8); else g.drawPolygon([0, -30, 28, 20, -28, 20]); g.endFill();
        g.x = Math.random() * ctx.width; g.y = Math.random() * ctx.height; g.tint = i % 2 ? 0xffb224 : 0x2fe07a; g.eventMode = 'static'; g.cursor = 'pointer';
        g.on('pointerover', ctx.safe(() => gsap.to(g, { pixi: { scale: 1.5, brightness: 1.6, tint: '#ece9e2' }, duration: 0.3 })));
        g.on('pointerout', ctx.safe(() => gsap.to(g, { pixi: { scale: 1, brightness: 1, tint: i % 2 ? '#ffb224' : '#2fe07a' }, duration: 0.5 })));
        app.stage.addChild(g); sprites.push(g);
        gsap.to(g, { pixi: { rotation: 360 }, duration: gsap.utils.random(4, 10), repeat: -1, ease: 'none' });
      }
      const scatter = ctx.safe(() => sprites.forEach((g) => gsap.timeline().to(g, { pixi: { blur: 6, hue: 90 }, duration: 0.3 }).to(g, { pixi: { x: gsap.utils.random(40, ctx.width - 40), y: gsap.utils.random(60, ctx.height - 60) }, duration: 1.2, ease: 'expo.inOut' }, 0).to(g, { pixi: { blur: 0, hue: 0 }, duration: 0.5 }, 0.8)));
      ctx.on(app.view, 'click', scatter);
      scatter();
      ctx.every(2.8, () => { if (!ctx.root.matches(':hover')) scatter(); });
      return { app };
    },
    dispose(ctx, s) { if (s.app) s.app.destroy(true, { children: true }); },
  });

  Lab.register({
    id: 'easel', title: 'EaselPlugin', category: 'Physics & Render', thumb: 'tall',
    hint: 'click a shape to recolour it',
    description: 'EaselPlugin brings GSAP to EaselJS from the CreateJS suite: it tweens colour filters, tint, saturation, contrast, hue and frame-based properties on cached display objects through easel: { … }, while ordinary properties like x and rotation tween directly. EaselJS needs a ticker to redraw, so the stage updates from gsap.ticker.',
    interact: [['Click a shape', 'easel: { tint, tintAmount, saturation }'], ['Watch', 'Colour filters tween on cached EaselJS shapes']],
    features: ['EaselPlugin.registerCreateJS(createjs)', 'easel: { tint, tintAmount }', 'easel: { saturation, contrast, hue, brightness }', 'EaselJS cached display objects'],
    code: `EaselPlugin.registerCreateJS(createjs);
shape.cache(-50, -50, 100, 100);           // filters need a cache
gsap.to(shape, { easel: { tint: '#ffb224', tintAmount: 0.8, saturation: 1.6 }, rotation: 180 });`,
    init(ctx) {
      if (!window.createjs) { ctx.root.appendChild(h('<div class="hint-c">EaselJS failed to load.</div>')); return {}; }
      EaselPlugin.registerCreateJS(createjs);
      const cv = h('<canvas class="fill" style="cursor:pointer"></canvas>');
      ctx.root.appendChild(cv);
      const dpr = Math.min(devicePixelRatio, 2);
      cv.width = ctx.width * dpr; cv.height = ctx.height * dpr;
      const stage = new createjs.Stage(cv); stage.scaleX = stage.scaleY = dpr;
      stage.enableMouseOver(10);
      const shapes = [];
      for (let i = 0; i < 9; i++) {
        const s = new createjs.Shape(); s.graphics.beginLinearGradientFill(['#2fe07a', '#ece9e2'], [0, 1], -40, -40, 40, 40); if (i % 2) s.graphics.drawRoundRect(-40, -40, 80, 80, 12); else s.graphics.drawCircle(0, 0, 42);
        s.x = ctx.width * (0.2 + (i % 3) * 0.3); s.y = ctx.height * (0.25 + Math.floor(i / 3) * 0.24); s.cache(-44, -44, 88, 88, dpr); s.cursor = 'pointer';
        s.on('click', ctx.safe(() => gsap.to(s, { easel: { tint: gsap.utils.random(['#ffb224', '#2fe07a', '#4fb8ff', '#ff5a5a']), tintAmount: 0.85, saturation: gsap.utils.random(0.4, 2) }, rotation: '+=90', duration: 0.8, ease: 'power3.out' })));
        stage.addChild(s); shapes.push(s);
        gsap.to(s, { scaleX: 0.85, scaleY: 0.85, duration: gsap.utils.random(1, 2), repeat: -1, yoyo: true, ease: 'sine.inOut' });
      }
      const tick = () => stage.update();
      gsap.ticker.add(tick);
      ctx.every(1.2, () => { if (!ctx.root.matches(':hover')) { const s = gsap.utils.random(shapes); gsap.to(s, { easel: { tint: gsap.utils.random(['#ffb224', '#2fe07a', '#4fb8ff']), tintAmount: gsap.utils.random(0, 0.9), saturation: gsap.utils.random(0.3, 2) }, rotation: '+=90', duration: 0.8 }); } });
      return { tick, stage };
    },
    dispose(ctx, s) { if (s.tick) gsap.ticker.remove(s.tick); if (s.stage) { s.stage.removeAllChildren(); s.stage.enableMouseOver(0); } },
  });
})();
