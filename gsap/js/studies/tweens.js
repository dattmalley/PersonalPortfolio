/* Group A — Tweens: the core API. */
(function () {
  const { h } = Lab;

  /* 1 ─ to / from / fromTo / set */
  Lab.register({
    id: 'basics', title: 'To, From, FromTo, Set', category: 'Tweens', thumb: 'wide',
    hint: 'click a lane to replay it · Play all',
    description: 'The four ways to create a tween. gsap.to() animates from the current values to new ones, gsap.from() animates from given values back to the current ones, gsap.fromTo() defines both ends, and gsap.set() applies values instantly with no animation. Each lane runs one of them on an identical element, so the difference is easy to see.',
    interact: [['Click a lane', 'Replay that method'], ['Play all', 'Run all four together'], ['Duration / ease', 'Applied to the next run']],
    features: ['gsap.to()', 'gsap.from()', 'gsap.fromTo()', 'gsap.set()', 'immediateRender'],
    params: [
      { key: 'dur', label: 'Duration (s)', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1.2 },
      { key: 'ease', label: 'Ease', type: 'select', options: ['power2.inOut', 'back.out(1.7)', 'elastic.out(1,0.4)', 'expo.out'], value: 0 },
      { key: 'all', label: 'Play all', type: 'button' },
    ],
    code: `gsap.to('.box', { x: 400, rotation: 180, duration: 1.2 });
gsap.from('.box', { x: 400, opacity: 0 });   // animate *from* these values
gsap.fromTo('.box', { x: 0 }, { x: 400 });   // define both ends
gsap.set('.box', { x: 400 });                 // instant, no animation`,
    init(ctx) {
      const names = ['gsap.to', 'gsap.from', 'gsap.fromTo', 'gsap.set'];
      const wrap = h(`<div class="lanes">${names.map((n) => `<div class="lane" data-m="${n}" style="cursor:pointer"><span class="tag">${n}()</span><div class="box" style="--s:7cqmin;position:absolute;top:50%;left:0;translate:0 -50%"></div></div>`).join('')}</div>`);
      ctx.root.appendChild(wrap);
      const lanes = [...wrap.querySelectorAll('.lane')];
      const run = ctx.safe((i) => {
        const box = lanes[i].querySelector('.box'), dist = () => lanes[i].offsetWidth - box.offsetWidth;
        const ease = ['power2.inOut', 'back.out(1.7)', 'elastic.out(1,0.4)', 'expo.out'][ctx.params.ease], duration = ctx.params.dur;
        gsap.killTweensOf(box); gsap.set(box, { x: 0, rotation: 0, opacity: 1, backgroundColor: '' });
        if (i === 0) gsap.to(box, { x: dist(), rotation: 360, duration, ease });
        if (i === 1) { gsap.set(box, { x: dist() / 2 }); gsap.from(box, { x: dist(), rotation: -360, opacity: 0, duration, ease }); }
        if (i === 2) gsap.fromTo(box, { x: 0, backgroundColor: Lab.ACC2 }, { x: dist(), backgroundColor: Lab.ACC1, rotation: 180, duration, ease });
        if (i === 3) gsap.set(box, { x: dist() * 0.75, rotation: 45 });
      });
      lanes.forEach((l, i) => ctx.on(l, 'click', () => run(i)));
      const all = () => lanes.forEach((_, i) => run(i));
      all();
      ctx.every(3.2, all);
      return { all };
    },
    action(ctx, s, k) { if (k === 'all') s.all(); },
  });

  /* 2 ─ transforms & CSS */
  Lab.register({
    id: 'transforms', title: 'Transforms & CSS', category: 'Tweens', thumb: 'square',
    hint: 'move the sliders · click the card to randomise',
    description: 'GSAP\'s CSSPlugin animates every transform component independently: x/y in pixels or as percentages, 2D and 3D rotation, scale, skew, transformOrigin and perspective. Each one composes correctly with the others, which raw CSS transforms cannot do. Colours, border-radius, box-shadow, filter, clip-path and CSS variables all tween smoothly too.',
    interact: [['Sliders', 'Tween to the new transform'], ['Click the card', 'Random transform + colour'], ['Origin', 'Change transformOrigin']],
    features: ['x / y / xPercent', 'rotationX / rotationY / rotation', 'scale / skewX', 'transformOrigin + transformPerspective', 'filter / clipPath / boxShadow / CSS variables'],
    params: [
      { key: 'rx', label: 'rotationX', type: 'range', min: -180, max: 180, step: 1, value: 20 },
      { key: 'ry', label: 'rotationY', type: 'range', min: -180, max: 180, step: 1, value: -30 },
      { key: 'rz', label: 'rotation', type: 'range', min: -180, max: 180, step: 1, value: 0 },
      { key: 'sc', label: 'scale', type: 'range', min: 0.3, max: 1.6, step: 0.01, value: 1 },
      { key: 'sk', label: 'skewX', type: 'range', min: -40, max: 40, step: 1, value: 0 },
      { key: 'blur', label: 'filter: blur (px)', type: 'range', min: 0, max: 12, step: 0.5, value: 0 },
      { key: 'origin', label: 'transformOrigin', type: 'select', options: ['center', 'top left', 'bottom right', '50% 50% -200'], value: 0 },
    ],
    code: `gsap.to(card, {
  rotationX: 20, rotationY: -30, scale: 1, skewX: 0,
  transformOrigin: 'center', transformPerspective: 900,
  filter: 'blur(0px)', clipPath: 'inset(0% round 18px)',
  '--hue': 140,                        // CSS variables tween too
  duration: 0.8, ease: 'power3.out'
});`,
    init(ctx) {
      const card = h(`<div style="position:absolute;left:50%;top:50%;width:38cqmin;height:50cqmin;margin:-25cqmin 0 0 -19cqmin;border-radius:18px;--hue:140;background:linear-gradient(135deg,hsl(var(--hue) 75% 52%),#ffb224);box-shadow:0 30px 60px -20px rgba(0,0,0,.8);display:grid;place-items:center;cursor:pointer">
        <div style="font-family:var(--serif);font-size:12cqmin;color:#060708;font-style:italic">gsap</div></div>`);
      ctx.root.append(card);
      const apply = () => {
        const p = ctx.params;
        gsap.to(card, { rotationX: p.rx, rotationY: p.ry, rotation: p.rz, scale: p.sc, skewX: p.sk, transformOrigin: ['center', 'top left', 'bottom right', '50% 50% -200'][p.origin], transformPerspective: 900, filter: `blur(${p.blur}px)`, duration: 0.8, ease: 'power3.out', overwrite: 'auto' });
      };
      apply();
      ctx.on(card, 'click', ctx.safe(() => {
        const r = gsap.utils.random;
        gsap.to(card, { rotationX: r(-60, 60), rotationY: r(-80, 80), rotation: r(-30, 30), '--hue': r(0, 360), borderRadius: r(4, 120), clipPath: `inset(${r(0, 12)}% round ${r(4, 60)}px)`, boxShadow: `0 ${r(10, 60)}px ${r(30, 120)}px -20px rgba(0,0,0,.85)`, duration: 1, ease: 'expo.out' });
      }));
      return { apply };
    },
    onParam(ctx, s) { s.apply(); },
  });

  /* 3 ─ stagger */
  Lab.register({
    id: 'stagger', title: 'Grid Stagger', category: 'Tweens', thumb: 'tall',
    hint: 'click any dot to ripple from it',
    description: 'Staggers offset each target\'s start time. The advanced stagger object understands 2D grids: from can be an index, "center", "edges", "random" or "end"; axis limits the spread to x or y; amount spreads the whole stagger across a fixed time; and the stagger itself has an ease. Click any dot to send a wave out from it.',
    interact: [['Click a dot', 'Stagger from that index'], ['From / axis', 'Change the stagger origin and direction'], ['Amount / ease', 'Shape the wave']],
    features: ['stagger: { grid, from, axis }', 'amount vs each', 'stagger ease', 'grid: "auto"'],
    params: [
      { key: 'from', label: 'from', type: 'select', options: ['clicked', 'center', 'edges', 'random', 'end'], value: 0 },
      { key: 'axis', label: 'axis', type: 'select', options: ['both', 'x', 'y'], value: 0 },
      { key: 'amount', label: 'amount (s)', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1.2 },
      { key: 'ease', label: 'stagger ease', type: 'select', options: ['none', 'power2.in', 'power2.out', 'sine.inOut'], value: 2 },
    ],
    code: `gsap.to('.dot', {
  scale: 0.2, y: -20, yoyo: true, repeat: 1,
  stagger: { grid: [cols, rows], from: clickedIndex, axis: null,
             amount: 1.2, ease: 'power2.out' }
});`,
    init(ctx) {
      const cols = 15, rows = 11;
      const grid = h(`<div style="position:absolute;inset:12% 10% 18%;display:grid;grid-template-columns:repeat(${cols},1fr);place-items:center"></div>`);
      for (let i = 0; i < cols * rows; i++) grid.appendChild(h(`<div class="dot" data-i="${i}" style="--s:2.6cqmin;cursor:pointer;background:${Lab.BONE};opacity:.5"></div>`));
      ctx.root.appendChild(grid);
      const dots = gsap.utils.toArray(grid.children);
      let last = Math.floor(cols * rows / 2);
      const wave = ctx.safe((i) => {
        last = i ?? last;
        const p = ctx.params;
        const from = p.from === 0 ? last : ['', 'center', 'edges', 'random', 'end'][p.from];
        gsap.killTweensOf(dots);
        gsap.timeline()
          .to(dots, { scale: 0.25, y: '-1.5cqmin', backgroundColor: Lab.ACC1, opacity: 1, duration: 0.35, ease: 'power2.out', stagger: { grid: [rows, cols], from, axis: [null, 'x', 'y'][p.axis], amount: p.amount, ease: ['none', 'power2.in', 'power2.out', 'sine.inOut'][p.ease] } })
          .to(dots, { scale: 1, y: 0, backgroundColor: Lab.BONE, opacity: 0.5, duration: 0.6, ease: 'elastic.out(1,0.5)', stagger: { grid: [rows, cols], from, axis: [null, 'x', 'y'][p.axis], amount: p.amount, ease: ['none', 'power2.in', 'power2.out', 'sine.inOut'][p.ease] } }, 0.35);
      });
      ctx.on(grid, 'click', (e) => { const d = e.target.closest('.dot'); if (d) wave(+d.dataset.i); });
      wave();
      ctx.every(3.5, () => { if (!ctx.root.matches(':hover')) wave(gsap.utils.random(0, cols * rows - 1, 1)); });
      return {};
    },
  });

  /* 4 ─ keyframes */
  Lab.register({
    id: 'keyframes', title: 'Keyframes', category: 'Tweens', thumb: 'square',
    hint: 'switch keyframe syntax · Replay',
    description: 'One tween can hold a whole sequence of states. GSAP accepts three keyframe syntaxes: an array of objects, each with its own duration and ease; percentage keys like a CSS @keyframes rule; and simple per-property value arrays spread evenly. easeEach eases every segment while the outer ease shapes the whole journey.',
    interact: [['Syntax', 'Array, percentage or value-array keyframes'], ['Replay', 'Run again'], ['easeEach', 'Ease applied per segment']],
    features: ['keyframes: [ {…}, {…} ]', 'keyframes: { "25%": {…} }', 'keyframes: { x: [ … ] }', 'easeEach'],
    params: [
      { key: 'mode', label: 'Syntax', type: 'select', options: ['Array', 'Percent', 'Value arrays'], value: 0 },
      { key: 'each', label: 'easeEach', type: 'select', options: ['none', 'sine.inOut', 'back.out'], value: 1 },
      { key: 'replay', label: 'Replay', type: 'button' },
    ],
    code: `gsap.to('.box', { keyframes: {
  '0%':   { x: 0,   y: 0 },
  '25%':  { x: 200, y: -80, rotation: 90 },
  '50%':  { x: 200, y: 80,  borderRadius: '50%' },
  '75%':  { x: -200, y: 80 },
  '100%': { x: 0,   y: 0, rotation: 360 },
  easeEach: 'sine.inOut' }, ease: 'none', duration: 4, repeat: -1 });`,
    init(ctx) {
      const box = h('<div class="box" style="--s:10cqmin;position:absolute;left:50%;top:50%;margin:-5cqmin"></div>');
      const trail = h(`<svg class="fill" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet"><path d="M0,0 L25,-12 L25,12 L-25,12 L-25,-12 Z" fill="none" stroke="rgba(236,233,226,.15)" stroke-dasharray="1 1.5"/></svg>`);
      ctx.root.append(trail, box);
      const play = () => {
        gsap.killTweensOf(box); gsap.set(box, { x: 0, y: 0, rotation: 0, borderRadius: '6%', backgroundColor: Lab.ACC1 });
        const u = Math.min(ctx.width, ctx.height) / 100, each = ['none', 'sine.inOut', 'back.out'][ctx.params.each];
        if (ctx.params.mode === 0) gsap.to(box, { keyframes: [{ x: 25 * u, y: -12 * u, rotation: 90, duration: 0.8 }, { y: 12 * u, borderRadius: '50%', backgroundColor: Lab.ACC2, duration: 0.8 }, { x: -25 * u, duration: 1.2, ease: 'power3.inOut' }, { y: -12 * u, borderRadius: '6%', duration: 0.8 }, { x: 0, y: 0, rotation: 360, backgroundColor: Lab.ACC1, duration: 0.8 }], repeat: -1 });
        if (ctx.params.mode === 1) gsap.to(box, { keyframes: { '0%': { x: 0, y: 0 }, '20%': { x: 25 * u, y: -12 * u, rotation: 90 }, '40%': { y: 12 * u, borderRadius: '50%', backgroundColor: Lab.ACC2 }, '70%': { x: -25 * u }, '85%': { y: -12 * u, borderRadius: '6%' }, '100%': { x: 0, y: 0, rotation: 360, backgroundColor: Lab.ACC1 }, easeEach: each }, duration: 4.4, ease: 'none', repeat: -1 });
        if (ctx.params.mode === 2) gsap.to(box, { keyframes: { x: [0, 25 * u, 25 * u, -25 * u, -25 * u, 0], y: [0, -12 * u, 12 * u, 12 * u, -12 * u, 0], rotation: [0, 90, 180, 270, 360], easeEach: each }, duration: 4.4, ease: 'none', repeat: -1 });
      };
      play();
      return { play };
    },
    onParam(ctx, s) { s.play(); }, action(ctx, s) { s.play(); }, resize(ctx, s) { s.play(); },
  });

  /* 5 ─ function-based & random values */
  Lab.register({
    id: 'function-values', title: 'Function & Random Values', category: 'Tweens', thumb: 'tall',
    hint: 'Scatter · hover tiles · relative nudges',
    description: 'Values do not have to be constants. A function receives each target\'s index, the target itself and the full array, and returns that target\'s value. Strings like "random(-200, 200, 10)" or "random([red, blue])" are evaluated per target, and relative strings ("+=90", "-=50%") offset from the current value. Together they let one line choreograph dozens of elements differently.',
    interact: [['Scatter', 'random() positions per tile'], ['Arrange', 'Function-based circle layout'], ['Hover a tile', 'Relative rotation "+=90"'], ['Nudge', 'x: "+=40" on every tile']],
    features: ['(index, target, targets) => value', '"random(min, max, snap)"', '"random([a, b, c])"', 'relative "+=" / "-="'],
    params: [{ key: 'scatter', label: 'Scatter', type: 'button' }, { key: 'arrange', label: 'Arrange in a circle', type: 'button' }, { key: 'nudge', label: 'Nudge +=40', type: 'button' }],
    code: `gsap.to('.tile', {
  x: 'random(-200, 200, 10)',            // per-target random, snapped to 10
  backgroundColor: 'random([#2fe07a, #ffb224, #ece9e2])',
  rotation: (i, el, all) => i / all.length * 360,   // function value
  duration: 1, stagger: 0.02
});
gsap.to(tile, { rotation: '+=90' });      // relative`,
    init(ctx) {
      const N = 24, layer = h('<div class="center"></div>');
      for (let i = 0; i < N; i++) layer.appendChild(h(`<div class="box" style="--s:7cqmin;position:absolute;display:grid;place-items:center;font:600 2.4cqmin var(--mono);color:#060708">${i}</div>`));
      ctx.root.appendChild(layer);
      const tiles = gsap.utils.toArray(layer.children);
      const u = () => Math.min(ctx.width, ctx.height) / 100;
      const arrange = () => gsap.to(tiles, { x: (i, el, all) => Math.cos(i / all.length * Math.PI * 2) * 30 * u(), y: (i, el, all) => Math.sin(i / all.length * Math.PI * 2) * 30 * u(), rotation: (i, el, all) => i / all.length * 360, backgroundColor: (i) => (i % 3 === 0 ? Lab.ACC2 : Lab.ACC1), duration: 1.2, ease: 'expo.inOut', stagger: 0.02 });
      const scatter = () => gsap.to(tiles, { x: () => gsap.utils.random(-38, 38) * u(), y: () => gsap.utils.random(-30, 30) * u(), rotation: 'random(-180, 180, 15)', backgroundColor: 'random([#2fe07a, #ffb224, #ece9e2])', duration: 1, ease: 'power3.out', stagger: { each: 0.015, from: 'random' } });
      tiles.forEach((t) => ctx.on(t, 'pointerenter', ctx.safe(() => gsap.to(t, { rotation: '+=90', scale: 1.15, duration: 0.4, ease: 'back.out(2)', onComplete: () => gsap.to(t, { scale: 1, duration: 0.3 }) }))));
      arrange();
      ctx.every(3, () => { if (!ctx.root.matches(':hover')) (Math.random() < 0.5 ? scatter : arrange)(); });
      return { arrange, scatter, nudge: () => gsap.to(tiles, { x: '+=40', duration: 0.5, ease: 'power2.out', stagger: 0.01 }) };
    },
    action(ctx, s, k) { s[k](); },
  });

  /* 6 ─ animate anything */
  Lab.register({
    id: 'animate-anything', title: 'Animate Anything', category: 'Tweens', thumb: 'wide',
    hint: 'click to retarget the numbers and the blob',
    description: 'GSAP animates any numeric property of any JavaScript object, not just the DOM. Here a plain object\'s fields drive a canvas blob through onUpdate, a counter tweens with snap so it lands on whole numbers, a colour property is interpolated in RGB, and a CSS custom property recolours the page. One engine handles all of them.',
    interact: [['Click', 'Tween every value to new random targets'], ['Watch', 'Numbers snap to whole values; the blob is a plain object']],
    features: ['Generic object tweens', 'onUpdate render loops', 'snap: { value: 1 }', 'Colour string interpolation', 'CSS custom properties'],
    code: `const blob = { r: 80, wobble: 0.2, hue: 140 };
gsap.to(blob, { r: 140, wobble: 0.6, hue: 40, duration: 1.4,
  onUpdate: () => drawBlob(blob) });          // any object, any number

const stats = { users: 0 };
gsap.to(stats, { users: 12847, snap: { users: 1 },
  onUpdate: () => el.textContent = stats.users.toLocaleString() });`,
    init(ctx) {
      const cv = h('<canvas class="fill"></canvas>');
      const hud = h(`<div style="position:absolute;left:6%;top:16%;display:grid;gap:2cqmin;font-family:var(--serif)">
        <div><div class="tag">Users</div><div data-v="users" style="font-size:9cqmin;line-height:1">0</div></div>
        <div><div class="tag">Revenue</div><div data-v="rev" style="font-size:6cqmin;line-height:1">$0</div></div>
        <div><div class="tag">Colour</div><div data-v="col" class="mono">#2fe07a</div></div></div>`);
      ctx.root.append(cv, hud);
      const g = cv.getContext('2d');
      const blob = { r: 0.28, wobble: 0.25, spin: 0, color: '#2fe07a' };
      const stats = { users: 0, rev: 0 };
      const draw = () => {
        const W = (cv.width = ctx.width * devicePixelRatio), H = (cv.height = ctx.height * devicePixelRatio);
        g.clearRect(0, 0, W, H);
        const cx = W * 0.62, cy = H * 0.52, R = Math.min(W, H) * blob.r;
        g.beginPath();
        for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2, rr = R * (1 + blob.wobble * 0.3 * Math.sin(a * 5 + blob.spin) * Math.cos(a * 3 - blob.spin * 0.7)); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        const grd = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.2);
        grd.addColorStop(0, blob.color); grd.addColorStop(1, '#060708'); g.fillStyle = grd; g.fill();
        hud.querySelector('[data-v=users]').textContent = Math.round(stats.users).toLocaleString();
        hud.querySelector('[data-v=rev]').textContent = '$' + Math.round(stats.rev).toLocaleString();
        hud.querySelector('[data-v=col]').textContent = blob.color;
      };
      const retarget = () => {
        gsap.to(blob, { r: gsap.utils.random(0.18, 0.36), wobble: gsap.utils.random(0, 1), color: gsap.utils.random(['#2fe07a', '#ffb224', '#ece9e2', '#4fb8ff']), duration: 1.4, ease: 'elastic.out(1,0.5)', onUpdate: draw });
        gsap.to(stats, { users: gsap.utils.random(1000, 99999, 1), rev: gsap.utils.random(1e4, 9e5, 1), duration: 1.6, ease: 'power3.out', snap: { users: 1, rev: 1 }, onUpdate: draw });
      };
      gsap.to(blob, { spin: Math.PI * 2, duration: 6, repeat: -1, ease: 'none', onUpdate: draw });
      ctx.on(ctx.root, 'click', ctx.safe(retarget));
      retarget();
      ctx.every(3, () => { if (!ctx.root.matches(':hover')) retarget(); });
      return {};
    },
  });

  /* 7 ─ repeat & yoyo */
  Lab.register({
    id: 'repeat', title: 'Repeat, Yoyo & Refresh', category: 'Tweens', thumb: 'portrait',
    hint: 'compare the four repeat strategies',
    description: 'Repeating behaviour side by side. repeat: -1 loops forever, yoyo alternates direction, repeatDelay pauses between cycles, and yoyoEase swaps the ease on the way back. repeatRefresh re-evaluates random and function-based values on every cycle, so each loop goes somewhere new.',
    interact: [['Watch', 'Four identical boxes, four strategies'], ['Repeat delay', 'Pause between cycles'], ['Restart', 'Re-sync all four']],
    features: ['repeat / repeat: -1', 'yoyo + yoyoEase', 'repeatDelay', 'repeatRefresh'],
    params: [{ key: 'delay', label: 'repeatDelay (s)', type: 'range', min: 0, max: 1.5, step: 0.05, value: 0.3, restart: true }],
    code: `gsap.to(a, { x: 300, repeat: -1 });
gsap.to(b, { x: 300, repeat: -1, yoyo: true });
gsap.to(c, { x: 300, repeat: -1, yoyo: true, ease: 'power3.in', yoyoEase: 'bounce.out' });
gsap.to(d, { x: 'random(-150, 300)', y: 'random(-40, 40)',
             repeat: -1, repeatRefresh: true });   // new random each cycle`,
    init(ctx) {
      const names = ['repeat: -1', 'yoyo: true', 'yoyoEase', 'repeatRefresh'];
      const wrap = h(`<div class="lanes">${names.map((n, i) => `<div class="lane"><span class="tag">${n}</span><div class="box ${i % 2 ? 'b2' : ''}" style="--s:6cqmin;position:absolute;top:50%;left:0;translate:0 -50%"></div></div>`).join('')}</div>`);
      ctx.root.appendChild(wrap);
      const boxes = wrap.querySelectorAll('.box'), d = ctx.params.delay;
      const dist = () => wrap.offsetWidth - boxes[0].offsetWidth;
      gsap.to(boxes[0], { x: dist, rotation: 360, duration: 1.4, repeat: -1, repeatDelay: d, ease: 'power2.inOut' });
      gsap.to(boxes[1], { x: dist, rotation: 180, duration: 1.4, repeat: -1, yoyo: true, repeatDelay: d, ease: 'power2.inOut' });
      gsap.to(boxes[2], { x: dist, duration: 1.4, repeat: -1, yoyo: true, repeatDelay: d, ease: 'power3.in', yoyoEase: 'bounce.out' });
      gsap.to(boxes[3], { x: () => gsap.utils.random(0, dist()), y: 'random(-20, 20)', rotation: 'random(-90, 90)', duration: 0.9, repeat: -1, repeatDelay: d, repeatRefresh: true, ease: 'expo.inOut' });
      return {};
    },
  });

  /* 8 ─ playback controls */
  Lab.register({
    id: 'controls', title: 'Playback Control', category: 'Tweens', thumb: 'wide',
    hint: 'play · pause · reverse · scrub · timeScale',
    description: 'Every tween and timeline is a controllable object. play(), pause(), reverse(), restart() and seek() drive it; progress() and time() read or set the playhead; timeScale() slows it down or speeds it up without changing the authored durations. The scrubber is a plain range input bound to progress(), and it stays in sync while the animation runs.',
    interact: [['Buttons', 'play / pause / reverse / restart'], ['Scrubber', 'Set progress() directly'], ['timeScale', 'Slow-motion to fast-forward']],
    features: ['play() / pause() / reverse()', 'restart() / seek()', 'progress() / time()', 'timeScale()', 'isActive() / reversed()'],
    params: [{ key: 'ts', label: 'timeScale', type: 'range', min: 0.1, max: 3, step: 0.05, value: 1 }],
    code: `const tl = gsap.timeline({ repeat: -1, yoyo: true });
tl.to('.orb', { x: 400, stagger: 0.1 });
tl.pause(); tl.reverse(); tl.restart(); tl.seek(1.5);
tl.progress(0.5);          // set the playhead (0–1)
tl.timeScale(0.25);        // quarter speed`,
    init(ctx) {
      const N = 7;
      const stageEl = h(`<div style="position:absolute;inset:18% 8% 34%">${Array.from({ length: N }, (_, i) => `<div class="dot" style="--s:6cqmin;position:absolute;left:0;top:${(i / (N - 1)) * 100}%;translate:0 -50%;background:${i % 2 ? Lab.ACC2 : Lab.ACC1}"></div>`).join('')}</div>`);
      const ui = h(`<div class="bar" style="bottom:18%"><button class="sbtn" data-a="play">play()</button><button class="sbtn" data-a="pause">pause()</button><button class="sbtn" data-a="reverse">reverse()</button><button class="sbtn" data-a="restart">restart()</button></div>`);
      const scrub = h('<div style="position:absolute;left:8%;right:8%;bottom:28%;display:flex;gap:12px;align-items:center"><span class="mono" style="width:9ch">progress</span><input type="range" min="0" max="1" step="0.001" value="0" style="flex:1"><span class="mono" data-p style="width:5ch;text-align:right">0.00</span></div>');
      ctx.root.append(stageEl, ui, scrub);
      const orbs = stageEl.querySelectorAll('.dot');
      const tl = gsap.timeline({ repeat: -1, yoyo: true, onUpdate: () => { range.value = tl.progress(); out.textContent = tl.progress().toFixed(2); } });
      tl.to(orbs, { x: () => stageEl.offsetWidth, rotation: 360, duration: 2, ease: 'power3.inOut', stagger: 0.12 }).to(orbs, { scale: 1.6, duration: 0.4, ease: 'back.out(3)', stagger: 0.05 }, '-=0.3');
      tl.timeScale(ctx.params.ts);
      const range = scrub.querySelector('input'), out = scrub.querySelector('[data-p]');
      ctx.on(range, 'input', () => { tl.pause(); tl.progress(+range.value); });
      ctx.on(ui, 'click', (e) => { const a = e.target.dataset.a; if (a) tl[a](); });
      return { tl };
    },
    onParam(ctx, s, k, v) { gsap.to(s.tl, { timeScale: v, duration: 0.4 }); },
  });

  /* 9 ─ callbacks */
  Lab.register({
    id: 'callbacks', title: 'Callbacks & Events', category: 'Tweens', thumb: 'tall',
    hint: 'watch the event log · click to interrupt',
    description: 'A live log of lifecycle callbacks: onStart, onUpdate (throttled for display), onRepeat, onComplete, onReverseComplete and onInterrupt. Clicking the stage interrupts the running tween with a new one so you can see onInterrupt fire. eventCallback() adds or replaces callbacks after creation, and callbackScope and params pass context into them.',
    interact: [['Watch', 'Callbacks fire in order'], ['Click the stage', 'Interrupt (kills and replaces the tween)'], ['Reverse', 'Triggers onReverseComplete']],
    features: ['onStart / onUpdate / onComplete', 'onRepeat / onReverseComplete', 'onInterrupt', 'eventCallback()', 'callbackScope / onCompleteParams'],
    params: [{ key: 'rev', label: 'Reverse', type: 'button' }],
    code: `const t = gsap.to(box, { x: 300, repeat: 2, yoyo: true,
  onStart: () => log('onStart'),
  onRepeat: () => log('onRepeat'),
  onComplete: () => log('onComplete'),
  onInterrupt: () => log('onInterrupt') });
t.eventCallback('onReverseComplete', () => log('onReverseComplete'));`,
    init(ctx) {
      const box = h('<div class="box" style="--s:9cqmin;position:absolute;left:12%;top:28%"></div>');
      const log = h('<div style="position:absolute;left:12%;right:12%;top:46%;bottom:20%;font:12px/1.9 var(--mono);color:var(--text-2);overflow:hidden"></div>');
      ctx.root.append(box, log);
      let updates = 0;
      const add = (msg, col) => { const row = h(`<div><span style="color:${col || Lab.ACC1}">●</span> ${msg} <span style="color:var(--muted)">t=${(gsap.ticker.time).toFixed(2)}</span></div>`); log.prepend(row); gsap.from(row, { x: -20, opacity: 0, duration: 0.3 }); while (log.children.length > 9) log.lastChild.remove(); };
      const make = ctx.safe(() => {
        updates = 0;
        const t = gsap.to(box, { x: () => ctx.width * 0.6, rotation: 180, duration: 1.4, repeat: 2, yoyo: true, ease: 'power2.inOut',
          onStart: () => add('onStart'), onUpdate: () => { if (++updates % 20 === 0) add(`onUpdate ×${updates}`, 'var(--muted)'); }, onRepeat: () => add('onRepeat', Lab.ACC2),
          onComplete: () => { add('onComplete', Lab.BONE); ctx.later(1, make); }, onInterrupt: () => add('onInterrupt (killed by overwrite)', '#ff5a5a') });
        t.eventCallback('onReverseComplete', () => add('onReverseComplete', '#4fb8ff'));
        s.t = t;
      });
      const s = {};
      make();
      ctx.on(ctx.root, 'click', ctx.safe(() => { gsap.to(box, { x: () => gsap.utils.random(0, ctx.width * 0.6), duration: 0.6, overwrite: true, onComplete: () => ctx.later(0.6, make) }); }));
      s.rev = () => s.t && s.t.reverse();
      return s;
    },
    action(ctx, s) { s.rev(); },
  });

  /* 10 ─ overwrite */
  Lab.register({
    id: 'overwrite', title: 'Overwrite Modes', category: 'Tweens', thumb: 'square',
    hint: 'move the pointer quickly across the stage',
    description: 'What happens when a new tween targets a property that is already animating? With overwrite: false both tweens fight and the motion stutters. "auto" kills only the conflicting properties of the old tween on its first render. true kills every tween of the same targets immediately. Move the pointer and each lane chases it with a different mode.',
    interact: [['Move pointer', 'Each lane fires a new tween per move'], ['Compare', 'false fights, "auto" hands over smoothly, true resets']],
    features: ['overwrite: false', 'overwrite: "auto"', 'overwrite: true', 'gsap.killTweensOf()'],
    code: `// every pointermove creates a new tween:
gsap.to(a, { x: px, duration: 1, overwrite: false });   // tweens fight
gsap.to(b, { x: px, duration: 1, overwrite: 'auto' });  // hands over
gsap.to(c, { x: px, duration: 1, overwrite: true });    // kills all first`,
    init(ctx) {
      const modes = [false, 'auto', true];
      const wrap = h(`<div class="lanes">${modes.map((m, i) => `<div class="lane"><span class="tag">overwrite: ${JSON.stringify(m)}</span><div class="dot" style="--s:6cqmin;background:${[Lab.BONE, Lab.ACC1, Lab.ACC2][i]}"></div></div>`).join('')}</div>`);
      ctx.root.appendChild(wrap);
      const dots = wrap.querySelectorAll('.dot');
      let last = 0;
      const chase = ctx.safe((x) => dots.forEach((d, i) => gsap.to(d, { x, duration: 1.2, ease: 'power2.out', overwrite: modes[i] })));
      ctx.on(ctx.root, 'pointermove', (e) => { const now = performance.now(); if (now - last < 40) return; last = now; const r = wrap.getBoundingClientRect(); chase(Math.max(0, Math.min(r.width, e.clientX - r.left))); });
      ctx.every(0.35, () => { if (!ctx.root.matches(':hover')) chase(Math.random() * wrap.offsetWidth); });
      return {};
    },
  });
})();
