/* Group E — Drag & Flip. */
(function () {
  const { h } = Lab;

  /* Draggable types */
  Lab.register({
    id: 'draggable', title: 'Draggable Types', category: 'Drag & Flip', thumb: 'square',
    hint: 'drag the tile · change type, bounds, snapping',
    description: 'Draggable makes any element draggable, swipeable or spinnable. type picks the motion (x, y, "x,y", rotation or top/left), bounds confines it with edgeResistance for a rubber-band feel, and liveSnap snaps while dragging, here to a grid. lockAxis commits to the first direction you move. The readout comes from the instance\'s own x, y and rotation.',
    interact: [['Drag', 'Move the tile'], ['type', 'x · y · x,y · rotation'], ['Grid snap', 'liveSnap to a 10 % grid'], ['Lock axis', 'Commit to the first direction']],
    features: ['Draggable.create(el, { type })', 'bounds + edgeResistance', 'liveSnap', 'lockAxis', 'onDrag / this.x / this.rotation'],
    params: [
      { key: 'type', label: 'type', type: 'select', options: ['x,y', 'x', 'y', 'rotation'], value: 0, restart: true },
      { key: 'snap', label: 'liveSnap to grid', type: 'toggle', value: false, restart: true },
      { key: 'lock', label: 'lockAxis', type: 'toggle', value: false, restart: true },
    ],
    code: `Draggable.create('.tile', { type: 'x,y', bounds: '.area', edgeResistance: 0.65,
  lockAxis: true, liveSnap: { x: (v) => Math.round(v / 40) * 40, y: (v) => Math.round(v / 40) * 40 },
  onDrag() { readout.textContent = this.x + ', ' + this.y; } });`,
    init(ctx) {
      const area = h(`<div style="position:absolute;inset:14% 12% 20%;border:1px solid var(--rule-2);background-image:linear-gradient(var(--rule) 1px,transparent 1px),linear-gradient(90deg,var(--rule) 1px,transparent 1px);background-size:10% 10%"></div>`);
      const tile = h(`<div class="box" style="--s:14cqmin;position:absolute;left:0;top:0;display:grid;place-items:center;font:600 2.4cqmin var(--mono);color:#060708;cursor:grab">drag</div>`);
      const read = h('<div class="readout"></div>');
      area.appendChild(tile); ctx.root.append(area, read);
      const type = ['x,y', 'x', 'y', 'rotation'][ctx.params.type];
      if (type === 'rotation') { gsap.set(tile, { left: '50%', top: '50%', xPercent: -50, yPercent: -50, borderRadius: '50%' }); tile.innerHTML = '<div style="width:4px;height:45%;background:#060708;position:absolute;top:4%"></div>spin'; }
      else gsap.set(tile, { x: area.offsetWidth / 2 - tile.offsetWidth / 2, y: area.offsetHeight / 2 - tile.offsetHeight / 2 });
      const grid = (v, size) => Math.round(v / size) * size;
      const d = Draggable.create(tile, { type, bounds: type === 'rotation' ? null : area, edgeResistance: 0.65, lockAxis: ctx.params.lock, cursor: 'grab', activeCursor: 'grabbing',
        liveSnap: ctx.params.snap ? (type === 'rotation' ? (v) => grid(v, 30) : { x: (v) => grid(v, area.offsetWidth / 10), y: (v) => grid(v, area.offsetHeight / 10) }) : false,
        onPress() { gsap.to(tile, { scale: 1.08, backgroundColor: Lab.ACC2, duration: 0.2 }); }, onRelease() { gsap.to(tile, { scale: 1, backgroundColor: Lab.ACC1, duration: 0.3 }); },
        onDrag() { read.textContent = type === 'rotation' ? `rotation ${this.rotation.toFixed(1)}°` : `x ${this.x.toFixed(0)} · y ${this.y.toFixed(0)}${this.lockedAxis ? ' · locked ' + this.lockedAxis : ''}`; } })[0];
      read.textContent = `type: "${type}" · bounds: area · edgeResistance: 0.65`;
      return { d };
    },
  });

  /* Inertia throw */
  Lab.register({
    id: 'inertia', title: 'Inertia Throw', category: 'Drag & Flip', thumb: 'wide',
    hint: 'throw the pucks; they glide and snap',
    description: 'With inertia: true, InertiaPlugin tracks release velocity and glides each puck to a natural stop with resistance, settling on snap points (the dots) when snapping is on. InertiaPlugin.track() measures the velocity of any property, which is shown live, so the same physics can drive custom throws.',
    interact: [['Throw', 'Fling a puck and let it glide'], ['Snap', 'Land on the nearest grid dot'], ['Resistance', 'How quickly it slows']],
    features: ['Draggable inertia: true', 'snap: function / array', 'throwResistance', 'InertiaPlugin.track() / getVelocity()', 'onThrowUpdate / onThrowComplete'],
    params: [
      { key: 'snap', label: 'Snap to dots', type: 'toggle', value: true, restart: true },
      { key: 'res', label: 'throwResistance', type: 'range', min: 200, max: 6000, step: 100, value: 1500, restart: true },
    ],
    code: `Draggable.create('.puck', { type: 'x,y', bounds: area, inertia: true,
  throwResistance: 1500,
  snap: { x: (v) => Math.round(v / 80) * 80, y: (v) => Math.round(v / 80) * 80 } });
InertiaPlugin.track(puck, 'x,y');  InertiaPlugin.getVelocity(puck, 'x');`,
    init(ctx) {
      const area = h('<div style="position:absolute;inset:12% 8% 18%;border:1px solid var(--rule-2)"></div>');
      const read = h('<div class="readout"></div>');
      ctx.root.append(area, read);
      const step = () => area.offsetWidth / 8;
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 4; j++) area.appendChild(h(`<div style="position:absolute;left:${(i / 8) * 100}%;top:${(j / 4) * 100}%;width:4px;height:4px;margin:-2px;border-radius:50%;background:var(--rule-3)"></div>`));
      const pucks = [0, 1, 2].map((i) => { const p = h(`<div class="dot" style="--s:11cqmin;position:absolute;left:0;top:0;margin:-5.5cqmin;cursor:grab;background:${[Lab.ACC1, Lab.ACC2, Lab.BONE][i]}"></div>`); area.appendChild(p); gsap.set(p, { x: step() * (2 + i * 2), y: area.offsetHeight / 2 }); return p; });
      const snapFn = (size) => (v) => Math.round(v / size) * size;
      pucks.forEach((p) => {
        Draggable.create(p, { type: 'x,y', bounds: { minX: 0, maxX: area.offsetWidth, minY: 0, maxY: area.offsetHeight }, inertia: true, throwResistance: ctx.params.res, edgeResistance: 0.75,
          snap: ctx.params.snap ? { x: snapFn(area.offsetWidth / 8), y: snapFn(area.offsetHeight / 4) } : false,
          onPress() { gsap.to(p, { scale: 1.15, duration: 0.2 }); }, onRelease() { gsap.to(p, { scale: 1, duration: 0.3 }); } });
        InertiaPlugin.track(p, 'x,y');
      });
      return { pucks, read };
    },
    frame(ctx, s) {
      const v = s.pucks.map((p) => Math.hypot(InertiaPlugin.getVelocity(p, 'x'), InertiaPlugin.getVelocity(p, 'y')));
      s.read.textContent = 'velocity (px/s) · ' + v.map((x) => Math.round(x)).join(' · ');
    },
  });

  /* hitTest drop zones */
  Lab.register({
    id: 'drop-zones', title: 'Drop Zones (hitTest)', category: 'Drag & Flip', thumb: 'tall',
    hint: 'drag tokens into the matching bin',
    description: 'Drag-and-drop built on Draggable.hitTest(). While you drag, each bin tests for at least 50 % overlap and lights up. On release a token that overlaps its matching bin animates into a slot, and anything else springs back to where it started. The score updates as you go.',
    interact: [['Drag a token', 'Bins light up at 50 % overlap'], ['Drop on the matching bin', 'Snaps into place'], ['Wrong bin / empty space', 'Springs home']],
    features: ['Draggable.hitTest(a, b, "50%")', 'onDrag highlight', 'onDragEnd snap / return', 'Elastic return tween'],
    params: [{ key: 'reset', label: 'Reset', type: 'button' }],
    code: `Draggable.create('.token', {
  onDrag() { bins.forEach((b) => b.classList.toggle('hot', this.hitTest(b, '50%'))); },
  onDragEnd() {
    const bin = bins.find((b) => this.hitTest(b, '50%') && b.dataset.k === this.target.dataset.k);
    bin ? dropInto(bin) : gsap.to(this.target, { x: 0, y: 0, ease: 'elastic.out(1,0.5)' });
  } });`,
    init(ctx) {
      const wrap = h(`<div style="position:absolute;inset:12% 8% 18%;display:grid;grid-template-rows:auto 1fr;gap:8%">
        <div data-tokens style="display:flex;gap:3cqmin;justify-content:center;flex-wrap:wrap"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6%">${['green', 'amber'].map((k) => `<div data-bin="${k}" style="border:1px dashed var(--rule-3);display:flex;flex-wrap:wrap;align-content:flex-start;gap:1.4cqmin;padding:2cqmin;transition:background .2s"><div class="tag" style="width:100%">${k} bin</div></div>`).join('')}</div></div>`);
      const read = h('<div class="readout"></div>');
      ctx.root.append(wrap, read);
      const tokensEl = wrap.querySelector('[data-tokens]'), bins = [...wrap.querySelectorAll('[data-bin]')];
      let score = 0;
      const build = () => {
        tokensEl.innerHTML = ''; bins.forEach((b) => b.querySelectorAll('.box').forEach((x) => x.remove())); score = 0; read.textContent = 'sorted 0 / 8';
        gsap.utils.shuffle(['green', 'amber', 'green', 'amber', 'green', 'amber', 'green', 'amber']).forEach((k) => {
          const t = h(`<div class="box ${k === 'amber' ? 'b2' : ''}" data-k="${k}" style="--s:9cqmin;cursor:grab"></div>`); tokensEl.appendChild(t);
          Draggable.create(t, { zIndexBoost: true,
            onDrag() { bins.forEach((b) => (b.style.background = this.hitTest(b, '50%') ? 'rgba(47,224,122,.12)' : '')); },
            onDragEnd() {
              bins.forEach((b) => (b.style.background = ''));
              const bin = bins.find((b) => this.hitTest(b, '50%'));
              if (bin && bin.dataset.bin === k) {
                const st = Flip.getState(t); bin.appendChild(t); gsap.set(t, { x: 0, y: 0 }); Flip.from(st, { duration: 0.5, ease: 'power3.out' }); this.disable(); t.style.cursor = 'default';
                read.textContent = `sorted ${++score} / 8${score === 8 ? ' · done!' : ''}`;
              } else gsap.to(t, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1,0.5)' });
            } });
        });
        gsap.from(tokensEl.children, { scale: 0, rotation: -90, stagger: 0.05, ease: 'back.out(2)' });
      };
      build();
      return { build };
    },
    action(ctx, s) { s.build(); },
  });

  /* knob + prize wheel */
  Lab.register({
    id: 'knob', title: 'Knob & Prize Wheel', category: 'Drag & Flip', thumb: 'square',
    hint: 'turn the knob · spin the wheel',
    description: 'Rotation dragging in two flavours. The volume knob is a type: "rotation" Draggable clamped to a 270° range, with liveSnap to 15° detents. The prize wheel uses inertia, so a flick spins it freely and snap lands it exactly on a segment. onThrowComplete then reads which segment won.',
    interact: [['Drag the knob', 'Turn between detents (−135° to 135°)'], ['Flick the wheel', 'Inertia spin; snaps to a segment'], ['Result', 'Read in onThrowComplete']],
    features: ['type: "rotation"', 'bounds: { minRotation, maxRotation }', 'liveSnap detents', 'inertia + snap for rotation', 'onThrowComplete'],
    code: `Draggable.create(knob, { type: 'rotation', bounds: { minRotation: -135, maxRotation: 135 },
  liveSnap: (v) => Math.round(v / 15) * 15 });
Draggable.create(wheel, { type: 'rotation', inertia: true,
  snap: (v) => Math.round(v / 45) * 45, onThrowComplete: announce });`,
    init(ctx) {
      const N = 8;
      const segs = Array.from({ length: N }, (_, i) => { const a0 = (i / N) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2; return `<path d="M0,0 L${Math.cos(a0) * 50},${Math.sin(a0) * 50} A50,50 0 0,1 ${Math.cos(a1) * 50},${Math.sin(a1) * 50} Z" fill="${i % 2 ? Lab.ACC2 : Lab.ACC1}" opacity="${0.55 + (i % 3) * 0.15}"/><text x="${Math.cos((a0 + a1) / 2) * 34}" y="${Math.sin((a0 + a1) / 2) * 34 + 2}" font-size="7" text-anchor="middle" fill="#060708" font-family="monospace">${i + 1}</text>`; }).join('');
      const wrap = h(`<div style="position:absolute;inset:12% 6% 18%;display:grid;grid-template-columns:1fr 1.3fr;gap:6%;align-items:center;justify-items:center">
        <div style="text-align:center"><div data-knob style="width:30cqmin;height:30cqmin;border-radius:50%;background:radial-gradient(circle at 40% 35%,#2a2c32,#0d0e11);box-shadow:0 0 0 2px var(--rule-2),0 20px 40px -10px #000;position:relative;cursor:grab"><div style="position:absolute;left:50%;top:8%;width:4px;height:22%;margin-left:-2px;background:${Lab.ACC1};border-radius:2px"></div></div><div class="mono" data-kv style="margin-top:3cqmin">volume 50</div></div>
        <div style="text-align:center;position:relative"><div style="position:absolute;left:50%;top:-3cqmin;margin-left:-1.6cqmin;border-left:1.6cqmin solid transparent;border-right:1.6cqmin solid transparent;border-top:3cqmin solid ${Lab.BONE};z-index:2"></div><svg data-wheel viewBox="-52 -52 104 104" style="width:46cqmin;cursor:grab">${segs}<circle r="6" fill="#060708"/></svg><div class="mono" data-win style="margin-top:2cqmin">flick to spin</div></div></div>`);
      ctx.root.appendChild(wrap);
      const knob = wrap.querySelector('[data-knob]'), kv = wrap.querySelector('[data-kv]'), wheel = wrap.querySelector('[data-wheel]'), win = wrap.querySelector('[data-win]');
      Draggable.create(knob, { type: 'rotation', bounds: { minRotation: -135, maxRotation: 135 }, liveSnap: (v) => Math.round(v / 15) * 15, onDrag() { kv.textContent = `volume ${Math.round(((this.rotation + 135) / 270) * 100)}`; } });
      const seg = 360 / N;
      const result = (rot) => { const r = ((-rot % 360) + 360) % 360; return Math.floor(r / seg) % N + 1; };
      const wd = Draggable.create(wheel, { type: 'rotation', inertia: true, snap: (v) => Math.round(v / seg) * seg + seg / 2 * 0, onThrowComplete() { win.textContent = `segment ${result(this.rotation)} wins`; gsap.fromTo(win, { scale: 1.3, color: Lab.ACC1 }, { scale: 1, color: '', duration: 0.6 }); } })[0];
      ctx.every(4, () => { if (!ctx.root.matches(':hover')) { gsap.to(wheel, { rotation: `+=${gsap.utils.random(4, 7, 1) * 360 + gsap.utils.random(0, N - 1, 1) * seg}`, duration: 2.6, ease: 'power4.out', onUpdate: () => wd.update(), onComplete: () => { win.textContent = `segment ${result(gsap.getProperty(wheel, 'rotation'))} wins`; } }); } });
      return {};
    },
  });

  /* sortable */
  Lab.register({
    id: 'sortable', title: 'Sortable List', category: 'Drag & Flip', thumb: 'portrait',
    hint: 'drag rows to reorder',
    description: 'A sortable list that moves as you drag. The grabbed row follows the pointer while the others slide out of its way: each move recomputes the order and tweens every other row to its new slot. On release the dragged row settles into the gap, and the readout shows the final order.',
    interact: [['Drag a row', 'Others slide to make room'], ['Release', 'Row settles; order updates']],
    features: ['Draggable type: "y"', 'Live order recomputation', 'Tweening siblings to slots', 'zIndexBoost'],
    code: `Draggable.create(row, { type: 'y', zIndexBoost: true,
  onDrag() { const to = clamp(0, n - 1, Math.round((start + this.y) / rowH));
    if (to !== order.indexOf(row)) { move(order, row, to); layout(row); } },
  onRelease() { gsap.to(row, { y: slotY(row) - baseY(row) }); } });`,
    init(ctx) {
      const items = ['ScrollTrigger', 'Flip', 'Draggable', 'SplitText', 'MorphSVG', 'MotionPath'];
      const list = h('<div style="position:absolute;left:50%;top:16%;width:min(70cqw,420px);transform:translateX(-50%)"></div>');
      const read = h('<div class="readout"></div>');
      ctx.root.append(list, read);
      const rowH = () => Math.min(ctx.height * 0.1, 56);
      const rows = items.map((t, i) => { const r = h(`<div style="position:absolute;left:0;right:0;height:${rowH() - 8}px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#111215;border:1px solid var(--rule-2);cursor:grab;font:13px var(--mono)"><span style="color:${i % 2 ? Lab.ACC2 : Lab.ACC1}">⋮⋮</span>${t}</div>`); list.appendChild(r); return r; });
      let order = rows.slice();
      const layout = (except) => order.forEach((r, i) => { if (r !== except) gsap.to(r, { y: i * rowH(), duration: 0.35, ease: 'power3.out' }); });
      order.forEach((r, i) => gsap.set(r, { y: i * rowH() }));
      list.style.height = items.length * rowH() + 'px';
      rows.forEach((r) => Draggable.create(r, { type: 'y', zIndexBoost: true, bounds: { minY: -10, maxY: (items.length - 1) * rowH() + 10 },
        onPress() { gsap.to(r, { scale: 1.03, boxShadow: '0 16px 30px -10px #000', borderColor: Lab.ACC1, duration: 0.2 }); },
        onDrag() { const to = gsap.utils.clamp(0, items.length - 1, Math.round(this.y / rowH())); const from = order.indexOf(r); if (to !== from) { order.splice(from, 1); order.splice(to, 0, r); layout(r); } },
        onRelease() { gsap.to(r, { y: order.indexOf(r) * rowH(), scale: 1, boxShadow: 'none', borderColor: 'rgba(236,233,226,.14)', duration: 0.4, ease: 'back.out(1.6)' }); read.textContent = 'order · ' + order.map((x) => x.textContent.replace('⋮⋮', '').trim()).join(' → '); } }));
      read.textContent = 'order · ' + items.join(' → ');
      return {};
    },
  });

  /* Flip layouts */
  Lab.register({
    id: 'flip-layout', title: 'Flip Layouts', category: 'Drag & Flip', thumb: 'wide',
    hint: 'switch layout · filter categories',
    description: 'Flip records where elements are, lets you change the layout however you like (CSS classes, reordering, display: none), and then animates them seamlessly from the old positions to the new ones. Here it covers grid, list and stack layouts and category filtering. Entering and leaving elements get their own onEnter and onLeave animations, and nested and absolute modes are handled for you.',
    interact: [['Layout', 'grid ↔ list ↔ stack'], ['Filter', 'Only show a category (onEnter / onLeave)'], ['Shuffle', 'Reorder the DOM and Flip']],
    features: ['Flip.getState()', 'Flip.from(state, { absolute, nested })', 'onEnter / onLeave', 'stagger + scale in Flip'],
    params: [
      { key: 'layout', label: 'Layout', type: 'select', options: ['Grid', 'List', 'Stack'], value: 0 },
      { key: 'filter', label: 'Filter', type: 'select', options: ['All', 'Green', 'Amber'], value: 0 },
      { key: 'shuffle', label: 'Shuffle', type: 'button' },
    ],
    code: `const state = Flip.getState('.item');
container.className = 'list';            // change the layout any way you like
items.forEach((el) => el.hidden = !matches(el));
Flip.from(state, { duration: 0.7, ease: 'power3.inOut', absolute: true, stagger: 0.02,
  onEnter: (els) => gsap.fromTo(els, { scale: 0 }, { scale: 1 }),
  onLeave: (els) => gsap.to(els, { scale: 0 }) });`,
    init(ctx) {
      const c = h('<div style="position:absolute;inset:14% 8% 18%"></div>');
      const css = h(`<style>.fl-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:2cqmin}.fl-list{display:flex;flex-direction:column;gap:1cqmin}.fl-list .fl-i{height:5cqh;aspect-ratio:auto}.fl-stack{position:relative}.fl-stack .fl-i{position:absolute;inset:10% 30%;}.fl-i{aspect-ratio:1;border-radius:4px;display:flex;align-items:center;padding:0 1.4cqmin;font:600 1.8cqmin var(--mono);color:#060708}</style>`);
      ctx.root.append(css, c);
      for (let i = 0; i < 18; i++) c.appendChild(h(`<div class="fl-i" data-k="${i % 3 ? 'green' : 'amber'}" style="background:${i % 3 ? Lab.ACC1 : Lab.ACC2}">${String(i + 1).padStart(2, '0')}</div>`));
      const items = () => [...c.children];
      const apply = (mutate) => {
        const st = Flip.getState(items());
        mutate();
        Flip.from(st, { duration: 0.75, ease: 'power3.inOut', absolute: true, stagger: 0.015, scale: true, onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.5 }), onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0, duration: 0.4 }) });
      };
      const set = () => apply(() => {
        c.className = ['fl-grid', 'fl-list', 'fl-stack'][ctx.params.layout];
        const f = ['all', 'green', 'amber'][ctx.params.filter];
        items().forEach((el, i) => { el.style.display = f === 'all' || el.dataset.k === f ? '' : 'none'; if (ctx.params.layout === 2) el.style.transform = `rotate(${(i % 7 - 3) * 4}deg)`; else el.style.transform = ''; });
      });
      c.className = 'fl-grid';
      let k = 0; ctx.every(2.6, () => { if (ctx.root.matches(':hover')) return; k++; ctx.syncParam('layout', k % 3); if (k % 4 === 3) ctx.syncParam('filter', (ctx.params.filter + 1) % 3); set(); });
      return { set, shuffle: () => apply(() => gsap.utils.shuffle(items()).forEach((el) => c.appendChild(el))) };
    },
    onParam(ctx, s) { s.set(); }, action(ctx, s) { s.shuffle(); },
  });

  /* Flip shared-element transition */
  Lab.register({
    id: 'flip-shared', title: 'Shared-Element Transition', category: 'Drag & Flip', thumb: 'tall',
    hint: 'click a thumbnail to open it · click again to close',
    description: 'The thumbnail-to-detail transition from native apps. Clicking a thumbnail moves that same DOM element into the detail view and Flip animates it from where it was, including scale and border radius, while the caption text staggers in. Closing reverses it. Flip.fit() also handles cases where you want to match another element\'s bounds without reparenting.',
    interact: [['Click a thumbnail', 'Expand into the detail view'], ['Click the detail', 'Return to the grid']],
    features: ['Flip with reparenting', 'Flip.from({ scale: true, nested: true })', 'props: "borderRadius"', 'Flip.fit()'],
    code: `const state = Flip.getState(thumb, { props: 'borderRadius' });
detail.appendChild(thumb);                         // reparent
Flip.from(state, { duration: 0.7, ease: 'power3.inOut', scale: true,
  onComplete: () => gsap.from('.caption > *', { y: 20, opacity: 0, stagger: 0.05 }) });`,
    init(ctx) {
      const grid = h('<div style="position:absolute;inset:14% 10% 18%;display:grid;grid-template-columns:repeat(3,1fr);gap:2.4cqmin;align-content:center"></div>');
      const detail = h('<div style="position:absolute;inset:8%;display:none;grid-template-columns:1.2fr 1fr;gap:4cqmin;align-items:center;z-index:2;cursor:pointer"><div data-slot style="height:100%"></div><div data-cap><div class="tag">study</div><h2 class="big" data-ttl></h2><p class="mono" style="max-width:36ch;line-height:1.7">Flip moved this element in the DOM and animated the difference. Click to return it.</p></div></div>');
      ctx.root.append(grid, detail);
      const names = ['Field', 'Signal', 'Orbit', 'Grain', 'Tide', 'Prism'];
      const thumbs = names.map((n, i) => { const t = h(`<div data-i="${i}" style="aspect-ratio:4/5;border-radius:12px;cursor:pointer;background:linear-gradient(${30 + i * 50}deg,${i % 2 ? Lab.ACC2 : Lab.ACC1},#111215 80%);display:flex;align-items:flex-end;padding:1.6cqmin;font-family:var(--serif);font-size:3.4cqmin;color:#060708"><span>${n}</span></div>`); grid.appendChild(t); return t; });
      let open = null, home = null;
      const toggle = ctx.safe((t) => {
        if (!open) {
          home = { parent: t.parentNode, next: t.nextSibling };
          const st = Flip.getState(t, { props: 'borderRadius' });
          detail.style.display = 'grid'; detail.querySelector('[data-slot]').appendChild(t); t.style.aspectRatio = 'auto'; t.style.height = '100%'; t.style.borderRadius = '4px';
          detail.querySelector('[data-ttl]').innerHTML = `${names[+t.dataset.i]} <em>study</em>`;
          Flip.from(st, { duration: 0.75, ease: 'power3.inOut', scale: true });
          gsap.from(detail.querySelectorAll('[data-cap] > *'), { y: 30, opacity: 0, stagger: 0.07, delay: 0.35 });
          gsap.to(grid.children, { opacity: 0.15, duration: 0.3 }); open = t;
        } else {
          const st = Flip.getState(open, { props: 'borderRadius' });
          home.parent.insertBefore(open, home.next); open.style.aspectRatio = '4/5'; open.style.height = ''; open.style.borderRadius = '12px'; detail.style.display = 'none';
          Flip.from(st, { duration: 0.65, ease: 'power3.inOut', scale: true });
          gsap.to(grid.children, { opacity: 1, duration: 0.4, delay: 0.3 }); open = null;
        }
      });
      thumbs.forEach((t) => ctx.on(t, 'click', (e) => { e.stopPropagation(); toggle(t); }));
      ctx.on(detail, 'click', () => open && toggle(open));
      let k = 0; ctx.every(2.4, () => { if (!ctx.root.matches(':hover')) toggle(open || thumbs[(k++) % thumbs.length]); });
      return {};
    },
  });
})();
