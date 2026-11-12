/* Group I — Utilities & Patterns. */
(function () {
  const { h } = Lab;

  Lab.register({
    id: 'utils', title: 'gsap.utils Playground', category: 'Utilities & Patterns', thumb: 'wide',
    hint: 'move the pointer: it is the input to every function',
    description: 'GSAP ships a toolbox of pure helper functions, and here each one takes your pointer\'s horizontal position as input and shows its output live. Included: clamp, mapRange, normalize, interpolate (colours and objects), snap (to an increment or array), wrap, wrapYoyo, distribute, random, pipe, splitColor, unitize and getUnit. Each has a gauge, a value readout and a swatch where useful.',
    interact: [['Move the pointer', 'Input x (0–1) feeds every function'], ['Watch', 'Gauges show each output']],
    features: ['clamp / mapRange / normalize', 'interpolate (numbers, colours, objects)', 'snap / wrap / wrapYoyo', 'distribute / random / shuffle', 'pipe / unitize / splitColor / getUnit / toArray / selector'],
    code: `const toDeg = gsap.utils.pipe(gsap.utils.normalize(0, innerWidth), gsap.utils.mapRange(0, 1, -90, 90), gsap.utils.snap(15));
gsap.utils.interpolate('#2fe07a', '#ffb224', 0.5);
gsap.utils.wrapYoyo(0, 10, 13);    // 7
gsap.utils.distribute({ base: 0, amount: 1, from: 'center', ease: 'power2' });`,
    init(ctx) {
      const U = gsap.utils;
      const items = [
        ['clamp(0.2, 0.8, x)', (x) => U.clamp(0.2, 0.8, x), 0, 1],
        ['mapRange(0,1, -90,90, x)', (x) => U.mapRange(0, 1, -90, 90, x), -90, 90],
        ['snap(0.125, x)', (x) => U.snap(0.125, x), 0, 1],
        ['snap([0, .3, .9], x)', (x) => U.snap([0, 0.3, 0.9], x), 0, 1],
        ['wrap(0, 0.25, x)', (x) => U.wrap(0, 0.25, x), 0, 0.25],
        ['wrapYoyo(0, 0.25, x)', (x) => U.wrapYoyo(0, 0.25, x), 0, 0.25],
        ['pipe(mapRange, snap(15))', U.pipe(U.mapRange(0, 1, 0, 360), U.snap(15)), 0, 360],
        ['interpolate(acc1, acc2, x)', (x) => U.interpolate(Lab.ACC1, Lab.ACC2, x), null],
        ['interpolate({a:0,b:100}, {a:50,b:0})', (x) => JSON.stringify(U.interpolate({ a: 0, b: 100 }, { a: 50, b: 0 }, x), (k, v) => (typeof v === 'number' ? Math.round(v) : v)), null],
        ['splitColor(interpolated)', (x) => U.splitColor(U.interpolate(Lab.ACC1, Lab.ACC2, x)).join(', '), null],
        ['unitize(mapRange)(x) + getUnit', (x) => { const f = U.unitize(U.mapRange(0, 1, 0, 100), '%'); const v = f(x); return `${v} · unit "${U.getUnit(v)}"`; }, null],
      ];
      const list = h(`<div style="position:absolute;inset:12% 6% 16%;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));gap:1.4cqmin 4cqmin;align-content:start;overflow:hidden">${items.map(([n]) => `<div><div class="mono" style="font-size:10.5px;display:flex;justify-content:space-between"><span>${n}</span><b data-v style="font-weight:500;color:var(--text)"></b></div><div style="position:relative;height:6px;background:var(--rule);margin-top:4px"><div data-b style="position:absolute;left:0;top:0;bottom:0;background:${Lab.ACC1}"></div></div></div>`).join('')}</div>`);
      const dist = h(`<div style="position:absolute;left:6%;right:6%;bottom:14%;display:flex;gap:4px;align-items:flex-end;height:8cqh">${'<div style="flex:1;background:var(--acc2)"></div>'.repeat(24)}</div>`);
      const inp = h('<div class="readout" style="bottom:calc(14% + 9cqh)"></div>');
      ctx.root.append(list, dist, inp);
      const rows = [...list.children], bars = [...dist.children];
      const update = (x) => {
        inp.textContent = `input x = ${x.toFixed(3)} · distribute(from: x) below`;
        items.forEach(([, f, lo, hi], i) => {
          const v = f(x), vEl = rows[i].querySelector('[data-v]'), bEl = rows[i].querySelector('[data-b]');
          vEl.textContent = typeof v === 'number' ? v.toFixed(3) : v;
          if (lo === null) { bEl.style.width = '100%'; bEl.style.background = typeof v === 'string' && v.startsWith('rgb') ? v : U.interpolate(Lab.ACC1, Lab.ACC2, x); }
          else bEl.style.width = ((v - lo) / (hi - lo)) * 100 + '%';
        });
        const d = U.distribute({ base: 0.1, amount: 0.9, from: x, ease: 'power2.inOut' });
        bars.forEach((b, i) => (b.style.height = (1.1 - d(i, b, bars)) * 100 + '%'));
      };
      const st = { x: 0.5 };
      ctx.on(ctx.root, 'pointermove', (e) => { const r = ctx.root.getBoundingClientRect(); gsap.to(st, { x: U.clamp(0, 1, (e.clientX - r.left) / r.width), duration: 0.2, overwrite: true, onUpdate: () => update(st.x) }); });
      update(0.5);
      gsap.to(st, { x: 1, duration: 4, repeat: -1, yoyo: true, ease: 'sine.inOut', onUpdate: () => { if (!ctx.root.matches(':hover')) update(st.x); } });
      return {};
    },
  });

  Lab.register({
    id: 'cursor', title: 'quickTo Cursor & Magnets', category: 'Utilities & Patterns', thumb: 'square',
    hint: 'move around · hover the buttons',
    description: 'gsap.quickTo() returns a reusable setter that retargets one property with no new tween allocation on every pointermove, the standard way to build custom cursors. The follower uses it for x and y with a slight lag. The magnetic buttons pull toward the pointer within a radius and spring back, and the cursor morphs over interactive elements with mix-blend-mode: difference.',
    interact: [['Move', 'Custom cursor follows (quickTo)'], ['Approach a button', 'Magnetic pull toward the pointer'], ['Hover', 'Cursor swells and inverts']],
    features: ['gsap.quickTo(el, "x", { duration, ease })', 'gsap.quickSetter()', 'Magnetic hover maths', 'mix-blend-mode: difference'],
    code: `const xTo = gsap.quickTo(cursor, 'x', { duration: 0.35, ease: 'power3' });
const yTo = gsap.quickTo(cursor, 'y', { duration: 0.35, ease: 'power3' });
addEventListener('pointermove', (e) => { xTo(e.clientX); yTo(e.clientY); });`,
    init(ctx) {
      const wrap = h(`<div class="center" style="cursor:none"><div style="display:flex;gap:6cqmin;flex-wrap:wrap;justify-content:center">${['Play', 'Explore', 'Contact'].map((t, i) => `<button data-mag style="font:500 clamp(13px,2.6cqmin,22px) var(--sans);padding:2cqmin 4cqmin;border-radius:999px;border:1px solid var(--rule-3);background:${i === 1 ? Lab.ACC1 : 'transparent'};color:${i === 1 ? '#060708' : 'var(--text)'};cursor:none">${t}</button>`).join('')}</div></div>`);
      const cur = h(`<div style="position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px;border-radius:50%;background:${Lab.BONE};mix-blend-mode:difference;pointer-events:none;z-index:5"></div>`);
      const dotEl = h(`<div style="position:absolute;left:0;top:0;width:6px;height:6px;margin:-3px;border-radius:50%;background:${Lab.ACC2};pointer-events:none;z-index:6"></div>`);
      ctx.root.append(wrap, cur, dotEl);
      const xTo = gsap.quickTo(cur, 'x', { duration: 0.4, ease: 'power3' }), yTo = gsap.quickTo(cur, 'y', { duration: 0.4, ease: 'power3' });
      const setDX = gsap.quickSetter(dotEl, 'x', 'px'), setDY = gsap.quickSetter(dotEl, 'y', 'px');
      const mags = [...wrap.querySelectorAll('[data-mag]')];
      const mxTo = mags.map((m) => ({ x: gsap.quickTo(m, 'x', { duration: 0.6, ease: 'elastic.out(1,0.4)' }), y: gsap.quickTo(m, 'y', { duration: 0.6, ease: 'elastic.out(1,0.4)' }) }));
      const move = (px, py) => {
        if (ctx.dead) return;   // revert() renders tweens one last time (firing onUpdate): ignore after teardown
        xTo(px); yTo(py); setDX(px); setDY(py);
        let over = false;
        const rr = ctx.root.getBoundingClientRect();
        mags.forEach((m, i) => { const r = m.getBoundingClientRect(); const cx = r.left - rr.left + r.width / 2 - gsap.getProperty(m, 'x'), cy = r.top - rr.top + r.height / 2 - gsap.getProperty(m, 'y'); const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy); if (d < 110) { mxTo[i].x(dx * 0.35); mxTo[i].y(dy * 0.35); over = over || d < 60; } else { mxTo[i].x(0); mxTo[i].y(0); } });
        gsap.to(cur, { scale: over ? 2.6 : 1, duration: 0.3, overwrite: 'auto' });
      };
      ctx.on(ctx.root, 'pointermove', (e) => { const r = ctx.root.getBoundingClientRect(); move(e.clientX - r.left, e.clientY - r.top); });
      const t = { a: 0 };
      gsap.to(t, { a: Math.PI * 2, duration: 5, repeat: -1, ease: 'none', onUpdate: () => { if (!ctx.root.matches(':hover')) move(ctx.width / 2 + Math.cos(t.a) * ctx.width * 0.28, ctx.height / 2 + Math.sin(t.a * 2) * ctx.height * 0.18); } });
      return {};
    },
  });

  Lab.register({
    id: 'matchmedia', title: 'matchMedia & Reduced Motion', category: 'Utilities & Patterns', thumb: 'tall',
    hint: 'resize the window or enable reduced motion in your OS',
    description: 'gsap.matchMedia() runs setup code only while a media query matches, and automatically reverts everything it created when the query stops matching. Responsive and accessible animation becomes declarative. The conditions object form tests several queries at once: this study builds a different animation for wide and narrow screens, and a gentle fade-only version under prefers-reduced-motion.',
    interact: [['Resize the browser', 'Wide ↔ narrow animations swap (auto-revert)'], ['OS: reduce motion', 'Switches to a fade-only version'], ['Readout', 'Which conditions currently match']],
    features: ['gsap.matchMedia()', 'mm.add({ conditions }, (context) => …)', 'context.conditions', 'Automatic revert when a query stops matching', 'prefers-reduced-motion'],
    code: `const mm = gsap.matchMedia();
mm.add({ isWide: '(min-width: 900px)', isNarrow: '(max-width: 899px)',
         reduce: '(prefers-reduced-motion: reduce)' }, (context) => {
  const { isWide, reduce } = context.conditions;
  gsap.to('.box', { x: reduce ? 0 : isWide ? 400 : 150, opacity: reduce ? 0.5 : 1,
                    rotation: reduce ? 0 : 360, repeat: -1, yoyo: true });
  return () => { /* optional cleanup when conditions change */ };
});`,
    init(ctx) {
      const boxes = h('<div style="position:absolute;inset:20% 10% 34%;display:flex;flex-direction:column;justify-content:space-around">' + '<div class="box" style="--s:8cqmin"></div>'.repeat(4) + '</div>');
      const read = h('<div style="position:absolute;left:10%;right:10%;bottom:18%;font:12px/1.9 var(--mono);color:var(--text-2)"></div>');
      ctx.root.append(boxes, read);
      const mm = gsap.matchMedia();
      mm.add({ isWide: '(min-width: 900px)', isNarrow: '(max-width: 899px)', reduce: '(prefers-reduced-motion: reduce)' }, (c) => {
        const { isWide, isNarrow, reduce } = c.conditions;
        const bx = boxes.children;
        if (reduce) gsap.fromTo(bx, { opacity: 0.25 }, { opacity: 1, duration: 1.4, repeat: -1, yoyo: true, stagger: 0.2 });
        else gsap.to(bx, { x: () => boxes.offsetWidth - bx[0].offsetWidth, rotation: isWide ? 360 : 90, borderRadius: isWide ? '50%' : '6%', backgroundColor: isWide ? Lab.ACC1 : Lab.ACC2, duration: isWide ? 1.6 : 0.9, repeat: -1, yoyo: true, ease: 'power2.inOut', stagger: 0.15 });
        read.innerHTML = `matched: ${[isWide && '<b style="color:var(--acc1);font-weight:500">isWide</b>', isNarrow && '<b style="color:var(--acc2);font-weight:500">isNarrow</b>', reduce && '<b style="color:#4fb8ff;font-weight:500">reduce</b>'].filter(Boolean).join(' + ')}<br>${reduce ? 'reduced motion: fade only' : isWide ? 'wide layout: full travel + spin' : 'narrow layout: short travel'}<br>window ${innerWidth}px. Resize to swap; the previous set reverts automatically.`;
      });
      return { mm };
    },
    dispose(ctx, s) { s.mm.revert(); },
  });

  Lab.register({
    id: 'effects', title: 'Effects & Defaults', category: 'Utilities & Patterns', thumb: 'square',
    hint: 'click tiles to apply effects',
    description: 'gsap.registerEffect() packages an animation behind a name and defaults, so it can be reused anywhere as gsap.effects.pop(targets, config). With extendTimeline: true it also becomes a timeline method, tl.pop(...). gsap.defaults() and per-timeline defaults remove repetition. Click tiles to apply the registered effects; the button builds a timeline from effect methods.',
    interact: [['Click a tile', 'Apply the selected effect'], ['Effect', 'pop · shake · flipIn · glow'], ['Timeline', 'Chain effects as timeline methods (extendTimeline)']],
    features: ['gsap.registerEffect({ name, effect, defaults, extendTimeline })', 'gsap.effects.name(targets, config)', 'tl.name() via extendTimeline', 'gsap.defaults() / timeline defaults'],
    params: [{ key: 'fx', label: 'Effect', type: 'select', options: ['pop', 'shake', 'flipIn', 'glow'], value: 0 }, { key: 'chain', label: 'Build effect timeline', type: 'button' }],
    code: `gsap.registerEffect({ name: 'pop', extendTimeline: true,
  defaults: { duration: 0.5, scale: 1.3 },
  effect: (targets, cfg) => gsap.timeline().to(targets, { scale: cfg.scale, duration: cfg.duration / 2 })
                                           .to(targets, { scale: 1, duration: cfg.duration / 2, ease: 'back.out(3)' }) });
gsap.effects.pop('.tile');
gsap.timeline().pop('.a').shake('.b', '<0.2');`,
    init(ctx) {
      const reg = (n, fn, defaults) => { if (!gsap.effects[n]) gsap.registerEffect({ name: n, effect: fn, defaults, extendTimeline: true }); };
      reg('pop', (t, c) => gsap.timeline().to(t, { scale: c.scale, duration: c.duration / 2, ease: 'power2.out' }).to(t, { scale: 1, duration: c.duration / 2, ease: 'back.out(3)' }), { duration: 0.6, scale: 1.35 });
      reg('shake', (t, c) => gsap.fromTo(t, { x: -c.amp }, { x: c.amp, duration: 0.06, repeat: 7, yoyo: true, ease: 'sine.inOut', onComplete: () => gsap.set(t, { x: 0 }) }), { amp: 10 });
      reg('flipIn', (t, c) => gsap.fromTo(t, { rotationY: -180, transformPerspective: 600 }, { rotationY: 0, duration: c.duration, ease: 'back.out(1.4)' }), { duration: 0.9 });
      reg('glow', (t, c) => gsap.fromTo(t, { boxShadow: `0 0 0 0 ${c.color}` }, { boxShadow: `0 0 40px 10px ${c.color}`, duration: 0.4, yoyo: true, repeat: 1 }), { color: 'rgba(47,224,122,.7)' });
      const grid = h('<div class="center"><div data-g style="display:grid;grid-template-columns:repeat(4,12cqmin);gap:3cqmin"></div></div>');
      const g = grid.querySelector('[data-g]');
      for (let i = 0; i < 12; i++) g.appendChild(h(`<div class="box ${i % 3 === 1 ? 'b2' : i % 3 === 2 ? 'b3' : ''}" style="--s:12cqmin;cursor:pointer"></div>`));
      ctx.root.appendChild(grid);
      const tiles = [...g.children], names = ['pop', 'shake', 'flipIn', 'glow'];
      tiles.forEach((t) => ctx.on(t, 'click', ctx.safe(() => gsap.effects[names[ctx.params.fx]](t))));
      const chain = () => gsap.timeline({ defaults: { duration: 0.6 } }).pop(tiles.slice(0, 4)).shake(tiles.slice(4, 8), '<0.2').flipIn(tiles.slice(8), '<0.2').glow(tiles, '>-0.2');
      chain();
      ctx.every(3.2, () => { if (!ctx.root.matches(':hover')) gsap.effects[gsap.utils.random(names)](gsap.utils.random(tiles)); });
      return { chain };
    },
    action(ctx, s) { s.chain(); },
  });

  Lab.register({
    id: 'micro', title: 'UI Micro-interactions', category: 'Utilities & Patterns', thumb: 'portrait',
    hint: 'menu · like · toast · loading button · modal',
    description: 'GSAP in everyday interface work. The menu toggle morphs its icon and staggers the items in, and reverses cleanly mid-way because it is a single reversible timeline. The like button bursts, a toast slides in and dismisses itself, a submit button runs through loading to success, and the modal opens from its trigger with a scaled backdrop.',
    interact: [['Menu', 'Reversible timeline (tl.reversed(!tl.reversed()))'], ['♥', 'Burst + scale bounce'], ['Toast', 'Slide in, auto-dismiss'], ['Submit', 'Loading → success state'], ['Modal', 'Open / close from its trigger']],
    features: ['Reversible toggle timelines', 'paused timelines + reverse()', 'Stagger menus', 'State-machine buttons', 'autoAlpha / clearProps'],
    code: `const menu = gsap.timeline({ paused: true, reversed: true })
  .to('.bar-1', { rotation: 45, y: 6 }).to('.bar-2', { rotation: -45, y: -6 }, '<')
  .from('.menu li', { x: -30, autoAlpha: 0, stagger: 0.05 }, '<0.1');
button.onclick = () => menu.reversed() ? menu.play() : menu.reverse();`,
    init(ctx) {
      const ui = h(`<div style="position:absolute;inset:12% 8% 16%;display:grid;grid-template-columns:1fr 1fr;gap:4cqmin;align-content:start">
        <div style="position:relative"><button data-menu class="sbtn" style="width:44px;height:44px;padding:0;display:grid;place-items:center"><span style="position:relative;width:20px;height:14px;display:block"><i data-b1 style="position:absolute;left:0;right:0;top:0;height:2px;background:var(--text)"></i><i data-b2 style="position:absolute;left:0;right:0;top:6px;height:2px;background:var(--text)"></i><i data-b3 style="position:absolute;left:0;right:0;top:12px;height:2px;background:var(--text)"></i></span></button>
          <ul data-list style="list-style:none;margin:12px 0 0;padding:0;display:grid;gap:6px">${['Overview', 'Timelines', 'Plugins', 'Pricing (free!)'].map((t) => `<li style="font-family:var(--serif);font-size:clamp(16px,3.4cqmin,30px);visibility:hidden">${t}</li>`).join('')}</ul></div>
        <div style="display:grid;gap:3cqmin;justify-items:start">
          <button data-like class="sbtn" style="font-size:20px;position:relative">♥ <span data-lc>128</span></button>
          <button data-toast class="sbtn">Show toast</button>
          <button data-submit class="sbtn" style="min-width:130px">Submit</button>
          <button data-modal class="sbtn">Open modal</button></div></div>
        <div data-toastel style="position:absolute;right:20px;bottom:64px;padding:12px 16px;background:${Lab.BONE};color:#060708;font:12px var(--mono);visibility:hidden">Saved · undo?</div>
        <div data-back style="position:absolute;inset:0;background:rgba(6,7,8,.7);visibility:hidden;z-index:4"></div>
        <div data-dialog style="position:absolute;left:50%;top:50%;width:min(70cqw,420px);padding:5cqmin;background:#111215;border:1px solid var(--rule-3);transform:translate(-50%,-50%);visibility:hidden;z-index:5"><div class="tag">modal</div><h2 class="big" style="font-size:clamp(20px,6cqmin,48px)">Opened from its <em>trigger</em></h2><button data-close class="sbtn" style="margin-top:3cqmin">Close</button></div>`);
      ctx.root.appendChild(ui);
      const q = (s) => ctx.root.querySelector(s);
      const menu = gsap.timeline({ paused: true, reversed: true }).to(q('[data-b1]'), { y: 6, rotation: 45, duration: 0.3 }).to(q('[data-b3]'), { y: -6, rotation: -45, duration: 0.3 }, '<').to(q('[data-b2]'), { autoAlpha: 0, duration: 0.2 }, '<').fromTo(ctx.root.querySelectorAll('[data-list] li'), { x: -30, autoAlpha: 0 }, { x: 0, autoAlpha: 1, stagger: 0.06, duration: 0.4, ease: 'power3.out' }, '<0.1');
      ctx.on(q('[data-menu]'), 'click', () => (menu.reversed() ? menu.play() : menu.reverse()));
      let likes = 128, liked = false;
      ctx.on(q('[data-like]'), 'click', ctx.safe(() => {
        liked = !liked; likes += liked ? 1 : -1; q('[data-lc]').textContent = likes; const b = q('[data-like]');
        gsap.fromTo(b, { scale: 0.8 }, { scale: 1, color: liked ? Lab.ACC2 : '', duration: 0.6, ease: 'elastic.out(1,0.4)' });
        if (liked) for (let i = 0; i < 10; i++) { const p = h(`<i style="position:absolute;left:14px;top:12px;width:5px;height:5px;border-radius:50%;background:${i % 2 ? Lab.ACC1 : Lab.ACC2};pointer-events:none"></i>`); b.appendChild(p); gsap.to(p, { x: Math.cos(i / 10 * Math.PI * 2) * 30, y: Math.sin(i / 10 * Math.PI * 2) * 30, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => p.remove() }); }
      }));
      ctx.on(q('[data-toast]'), 'click', ctx.safe(() => gsap.timeline().fromTo(q('[data-toastel]'), { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: 'back.out(2)' }).to(q('[data-toastel]'), { y: 40, autoAlpha: 0, duration: 0.3 }, '+=1.8')));
      ctx.on(q('[data-submit]'), 'click', ctx.safe(() => { const b = q('[data-submit]'); gsap.timeline().call(() => (b.textContent = 'Sending…')).to(b, { backgroundColor: 'rgba(255,178,36,.25)', duration: 0.2 }).to(b, { duration: 1.2 }).call(() => (b.textContent = '✓ Sent')).to(b, { backgroundColor: Lab.ACC1, color: '#060708', duration: 0.3 }).fromTo(b, { scale: 1.1 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' }, '<').to(b, { backgroundColor: '', color: '', duration: 0.4, delay: 1.2, onComplete: () => (b.textContent = 'Submit') }); }));
      const modal = gsap.timeline({ paused: true }).to(q('[data-back]'), { autoAlpha: 1, duration: 0.3 }).fromTo(q('[data-dialog]'), { autoAlpha: 0, scale: 0.85, y: 20 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.45, ease: 'back.out(1.6)' }, '<0.05');
      ctx.on(q('[data-modal]'), 'click', () => modal.play());
      ctx.on(q('[data-close]'), 'click', () => modal.reverse());
      ctx.on(q('[data-back]'), 'click', () => modal.reverse());
      let step = 0; ctx.every(1.6, () => { if (ctx.root.matches(':hover')) return; const acts = [() => menu.play(), () => q('[data-like]').click(), () => menu.reverse(), () => q('[data-toast]').click(), () => q('[data-submit]').click()]; acts[step++ % acts.length](); });
      return {};
    },
  });

  Lab.register({
    id: 'css-rules', title: 'CSS Variables & CSSRulePlugin', category: 'Utilities & Patterns', thumb: 'wide',
    hint: 'hover the cards · CSS variables drive the theme',
    description: 'Two ways to animate styles you cannot target directly. Modern: tween CSS custom properties, so one --accent, --radius or --tilt variable updates every element that uses it, including pseudo-elements. Legacy: CSSRulePlugin edits a stylesheet rule such as .card::after in place. It still works but is deprecated in favour of variables, so both are shown.',
    interact: [['Hover a card', 'Tween its --tilt / --glow variables'], ['Watch', 'Theme variables (--accent, --radius) animate globally'], ['::after bar', 'Driven by CSSRulePlugin (legacy)']],
    features: ['Tweening CSS custom properties', 'Variables reaching ::before / ::after', 'CSSRulePlugin.getRule()', 'cssRule: { … } (deprecated)'],
    code: `gsap.to(root, { '--accent': '#ffb224', '--radius': '30px', duration: 1 });   // modern
gsap.to(card, { '--tilt': '8deg', '--glow': 1 });
const rule = CSSRulePlugin.getRule('.lab-card::after');                  // legacy
gsap.to(rule, { cssRule: { scaleX: 1 }, duration: 0.6 });`,
    init(ctx) {
      const css = h(`<style id="lab-rule-css">.lab-card{--tilt:0deg;--glow:0;position:relative;border-radius:var(--radius);background:#111215;border:1px solid var(--rule-2);padding:3cqmin;transform:rotate(var(--tilt));box-shadow:0 0 calc(var(--glow)*40px) rgba(47,224,122,calc(var(--glow)*.6));cursor:pointer}.lab-card::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--accent);border-radius:var(--radius) 0 0 var(--radius)}.lab-card::after{content:"";position:absolute;left:3cqmin;right:3cqmin;bottom:2cqmin;height:2px;background:var(--accent);transform:scaleX(0);transform-origin:left}</style>`);
      document.head.appendChild(css);
      const wrap = h(`<div style="position:absolute;inset:16% 8% 20%;--accent:${Lab.ACC1};--radius:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:3cqmin">${['Variables', 'Pseudo-elements', 'One source of truth'].map((t) => `<div class="lab-card"><div class="tag">--accent / --radius</div><h3 style="font-family:var(--serif);font-weight:400;font-size:clamp(16px,3.6cqmin,30px);margin:1.4cqmin 0 0">${t}</h3></div>`).join('')}</div>`);
      ctx.root.appendChild(wrap);
      gsap.to(wrap, { '--accent': Lab.ACC2, '--radius': '28px', duration: 2.2, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      wrap.querySelectorAll('.lab-card').forEach((c) => { ctx.on(c, 'pointerenter', ctx.safe(() => gsap.to(c, { '--tilt': '-3deg', '--glow': 1, duration: 0.4 }))); ctx.on(c, 'pointerleave', ctx.safe(() => gsap.to(c, { '--tilt': '0deg', '--glow': 0, duration: 0.5 }))); });
      let rule = null;
      try { rule = CSSRulePlugin.getRule('.lab-card::after'); } catch (e) { /* plugin missing */ }
      if (rule) gsap.to(rule, { cssRule: { scaleX: 1 }, duration: 1.2, repeat: -1, yoyo: true, ease: 'power2.inOut' });
      return { css };
    },
    dispose(ctx, s) { s.css.remove(); },
  });
})();
