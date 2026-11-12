/* Group D — Scroll: ScrollTrigger, ScrollSmoother, ScrollTo, Observer.
 * ScrollTrigger studies use a scroller element inside the stage (scroller: el). */
(function () {
  const { h } = Lab;
  const sect = (txt, sub, extra = '') => `<section style="min-height:100cqh;display:grid;place-items:center;position:relative;${extra}"><div style="text-align:center"><div class="tag">${sub}</div><h2 class="big">${txt}</h2></div></section>`;
  const autoScroll = (ctx, sc, speed = 0.6) => {
    // idle demo: drift the scroller so the study reads at a glance (stops once the user scrolls)
    let user = false; ctx.on(sc, 'wheel', () => (user = true), { passive: true }); ctx.on(sc, 'pointerdown', () => (user = true));
    const st = { y: 0 };
    return gsap.to(st, { y: 1, duration: 9 / speed, ease: 'sine.inOut', repeat: -1, yoyo: true, onUpdate: () => { if (!user) sc.scrollTop = st.y * (sc.scrollHeight - sc.clientHeight); } });
  };

  /* basics */
  Lab.register({
    id: 'st-basics', title: 'ScrollTrigger Basics', category: 'Scroll', thumb: 'tall',
    hint: 'scroll the stage · watch the markers and the log',
    description: 'ScrollTrigger ties animations to scroll position. Each card here has a trigger with visible markers: start and end lines on the element, matched by scroller-start and scroller-end lines on the viewport. toggleActions decides what happens on enter, leave, enter-back and leave-back, toggleClass adds a class while the card is active, and every callback writes to the log.',
    interact: [['Scroll', 'Cross the start / end markers'], ['toggleActions', 'Change the four-state behaviour'], ['Log', 'onEnter / onLeave / onEnterBack / onLeaveBack']],
    features: ['scrollTrigger: { trigger, start, end }', 'markers: true', 'toggleActions', 'toggleClass', 'onEnter / onLeave / onEnterBack / onLeaveBack', 'scroller: element'],
    params: [{ key: 'ta', label: 'toggleActions', type: 'select', options: ['play none none none', 'play reverse play reverse', 'restart pause resume reset', 'play complete reverse reset'], value: 1, restart: true }],
    code: `gsap.to('.card', {
  x: 200, rotation: 10,
  scrollTrigger: { trigger: '.card', scroller: '.scroller',
    start: 'top 75%', end: 'bottom 25%', markers: true,
    toggleActions: 'play reverse play reverse', toggleClass: 'active',
    onEnter: () => log('onEnter') }
});`,
    init(ctx) {
      const sc = h(`<div class="scroller">${sect('Scroll <em>down</em>', 'ScrollTrigger')}<div data-list style="padding:0 12% 60cqh;display:grid;gap:30cqh"></div></div>`);
      const log = h('<div style="position:absolute;right:16px;top:52px;width:min(42%,260px);font:11px/1.8 var(--mono);color:var(--text-2);pointer-events:none;z-index:3"></div>');
      ctx.root.append(sc, log);
      const list = sc.querySelector('[data-list]');
      const add = (m, c) => { const r = h(`<div><span style="color:${c}">●</span> ${m}</div>`); log.prepend(r); while (log.children.length > 8) log.lastChild.remove(); };
      const ta = ['play none none none', 'play reverse play reverse', 'restart pause resume reset', 'play complete reverse reset'][ctx.params.ta];
      for (let i = 0; i < 5; i++) {
        const card = h(`<div class="panel-s" style="height:24cqh;display:flex;align-items:center;justify-content:space-between"><span class="mono">card ${i + 1}</span><div class="box ${i % 2 ? 'b2' : ''}" style="--s:10cqmin"></div></div>`);
        list.appendChild(card);
        gsap.fromTo(card.querySelector('.box'), { x: 0, rotation: 0, scale: 0.6 }, { x: () => -card.offsetWidth * 0.55, rotation: 180, scale: 1, duration: 1, ease: 'power2.out',
          scrollTrigger: { trigger: card, scroller: sc, start: 'top 75%', end: 'bottom 25%', markers: { startColor: Lab.ACC1, endColor: Lab.ACC2, fontSize: '10px', indent: 10 * i }, toggleActions: ta, toggleClass: { targets: card, className: 'is-active' },
            onEnter: () => add(`card ${i + 1} onEnter`, Lab.ACC1), onLeave: () => add(`card ${i + 1} onLeave`, Lab.ACC2), onEnterBack: () => add(`card ${i + 1} onEnterBack`, '#4fb8ff'), onLeaveBack: () => add(`card ${i + 1} onLeaveBack`, '#ff5a5a') } });
      }
      autoScroll(ctx, sc);
      return {};
    },
  });

  /* scrub + pin */
  Lab.register({
    id: 'st-scrub-pin', title: 'Scrub & Pin', category: 'Scroll', thumb: 'wide',
    hint: 'scroll: the panel pins while the timeline scrubs',
    description: 'Pinning holds an element in place while the scroll distance plays a timeline. scrub: true locks the animation directly to the scrollbar; a number such as scrub: 1 adds a second of smoothing so it catches up softly. The progress bar reads self.progress, and pinSpacing pads the content so nothing jumps when the pin releases.',
    interact: [['Scroll', 'Pin + scrub through the timeline'], ['scrub', 'true (locked) or seconds of smoothing'], ['Readout', 'self.progress / direction / velocity']],
    features: ['pin: true', 'scrub: true | number', 'end: "+=300%"', 'self.progress / direction / getVelocity()', 'pinSpacing'],
    params: [{ key: 'scrub', label: 'scrub (s)', type: 'range', min: 0, max: 3, step: 0.1, value: 1, restart: true }],
    code: `gsap.timeline({ scrollTrigger: { trigger: '.panel', scroller: '.scroller',
    pin: true, scrub: 1, start: 'top top', end: '+=300%',
    onUpdate: (self) => bar.style.width = self.progress * 100 + '%' } })
  .to('.ring', { rotation: 360, scale: 1.6 })
  .to('.word', { y: 0, opacity: 1, stagger: 0.1 }, '<');`,
    init(ctx) {
      const sc = h(`<div class="scroller">${sect('Pin <em>&amp;</em> scrub', 'scroll to begin')}<section data-pin style="height:100cqh;position:relative;overflow:hidden">
        <div class="center"><div data-ring style="width:48cqmin;height:48cqmin"><svg viewBox="-60 -60 120 120" style="width:100%;height:100%;display:block"><circle r="50" fill="none" stroke="${Lab.ACC1}" stroke-width="3" stroke-dasharray="8 6"/><circle r="34" fill="none" stroke="${Lab.ACC2}" stroke-width="2"/><rect x="-10" y="-10" width="20" height="20" fill="${Lab.BONE}"/></svg></div></div>
        <div class="center" style="pointer-events:none"><h2 class="big" style="display:flex;gap:2cqmin">${['every', 'pixel', 'scrubbed'].map((w) => `<span data-w style="display:inline-block">${w}</span>`).join('')}</h2></div>
        <div style="position:absolute;left:8%;right:8%;bottom:12%;height:2px;background:var(--rule-2)"><div data-bar style="height:100%;width:0;background:${Lab.ACC1}"></div></div><div class="readout" data-r style="bottom:16%"></div></section>${sect('Released', 'pin ends here')}</div>`);
      ctx.root.appendChild(sc);
      const pin = sc.querySelector('[data-pin]'), bar = sc.querySelector('[data-bar]'), read = sc.querySelector('[data-r]');
      const s = ctx.params.scrub;
      gsap.timeline({ scrollTrigger: { trigger: pin, scroller: sc, pin: true, scrub: s === 0 ? true : s, start: 'top top', end: '+=300%', onUpdate: (self) => { bar.style.width = self.progress * 100 + '%'; read.textContent = `progress ${self.progress.toFixed(3)} · direction ${self.direction} · velocity ${Math.round(self.getVelocity())} px/s`; } } })
        .to(sc.querySelector('[data-ring]'), { rotation: 540, scale: 1.5, duration: 1 })
        .from(sc.querySelectorAll('[data-w]'), { y: '30cqh', opacity: 0, rotation: 20, stagger: 0.15, duration: 0.6 }, 0)
        .to(sc.querySelectorAll('[data-w]'), { color: Lab.ACC1, stagger: 0.1, duration: 0.3 }, 0.7);
      autoScroll(ctx, sc, 0.5);
      return {};
    },
  });

  /* snap + batch */
  Lab.register({
    id: 'st-snap-batch', title: 'Batch & Snap', category: 'Scroll', thumb: 'portrait',
    hint: 'scroll: cards reveal in batches; sections snap',
    description: 'ScrollTrigger.batch() collects every element entering the viewport within a short interval and passes them to a single callback, so a whole row of cards reveals with one staggered tween rather than dozens of separate triggers. Separately, snap carries the scroller to the nearest section once scrolling stops, using its own duration and ease.',
    interact: [['Scroll', 'Cards reveal in staggered batches'], ['Stop scrolling', 'Snap to the nearest section'], ['Snap toggle', 'Turn section snapping on or off']],
    features: ['ScrollTrigger.batch()', 'interval / batchMax', 'snap: { snapTo, duration, ease }', 'onEnter / onLeaveBack batches'],
    params: [{ key: 'snap', label: 'Section snapping', type: 'toggle', value: true, restart: true }],
    code: `ScrollTrigger.batch('.card', { scroller: '.scroller', interval: 0.1, batchMax: 6,
  onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, stagger: 0.08 }),
  onLeaveBack: (batch) => gsap.to(batch, { opacity: 0, y: 60 }) });
ScrollTrigger.create({ scroller: '.scroller', snap: { snapTo: 1 / 4, duration: 0.6, ease: 'power2.inOut' } });`,
    init(ctx) {
      const cards = Array.from({ length: 36 }, (_, i) => `<div class="b-card" style="height:16cqh;background:${i % 3 === 0 ? Lab.ACC2 : i % 3 === 1 ? Lab.ACC1 : Lab.BONE};opacity:0;border-radius:4px"></div>`).join('');
      const sc = h(`<div class="scroller">${sect('Batch <em>reveal</em>', 'scroll')}<div style="padding:4cqh 8%;display:grid;grid-template-columns:repeat(3,1fr);gap:2cqmin">${cards}</div>${sect('The end', 'snap')}</div>`);
      ctx.root.appendChild(sc);
      gsap.set(sc.querySelectorAll('.b-card'), { y: 60 });
      ScrollTrigger.batch(sc.querySelectorAll('.b-card'), { scroller: sc, interval: 0.1, batchMax: 6, onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, stagger: { each: 0.08 }, overwrite: true }), onLeaveBack: (b) => gsap.to(b, { opacity: 0, y: 60, overwrite: true }) });
      if (ctx.params.snap) ScrollTrigger.create({ scroller: sc, trigger: sc.firstElementChild, start: 0, end: 'max', snap: { snapTo: 1 / 4, duration: { min: 0.3, max: 0.8 }, ease: 'power2.inOut', delay: 0.1 } });
      autoScroll(ctx, sc, 0.5);
      return {};
    },
  });

  /* horizontal + containerAnimation */
  Lab.register({
    id: 'st-horizontal', title: 'Horizontal Scroll', category: 'Scroll', thumb: 'wide',
    hint: 'scroll vertically: the panels move sideways',
    description: 'The classic horizontal section. Vertical scrolling pins a track of panels and translates it sideways with a scrubbed tween. Triggers nested inside it use containerAnimation, so elements in each panel animate as that panel crosses the viewport horizontally, even though the page itself only ever scrolls vertically.',
    interact: [['Scroll', 'Pinned track moves horizontally'], ['Watch', 'Each panel\'s contents animate via containerAnimation']],
    features: ['xPercent scrubbed track', 'pin + end based on track width', 'containerAnimation', 'Nested ScrollTriggers'],
    code: `const move = gsap.to(track, { x: () => -(track.scrollWidth - innerWidth), ease: 'none',
  scrollTrigger: { trigger: wrap, pin: true, scrub: 1, end: () => '+=' + track.scrollWidth } });
gsap.from('.panel h2', { y: 100, opacity: 0,
  scrollTrigger: { trigger: '.panel', containerAnimation: move, start: 'left center' } });`,
    init(ctx) {
      const N = 5;
      const sc = h(`<div class="scroller">${sect('Go <em>sideways</em>', 'scroll down')}<section data-wrap style="height:100cqh;overflow:hidden;position:relative"><div data-track style="display:flex;height:100%;width:${N * 100}cqw">${Array.from({ length: N }, (_, i) => `<div data-p style="width:100cqw;height:100%;flex:none;display:grid;place-items:center;border-left:1px solid var(--rule-2);background:${i % 2 ? '#0b0c0e' : '#08090b'}"><div style="text-align:center"><div class="tag">panel ${i + 1} / ${N}</div><h2 class="big" data-hh>${['Pinned', 'Scrubbed', 'Sideways', 'Nested', 'Done'][i]}</h2><div class="box ${i % 2 ? 'b2' : ''}" data-bx style="--s:9cqmin;margin:4cqmin auto 0"></div></div></div>`).join('')}</div></section>${sect('Vertical <em>again</em>', 'released')}</div>`);
      ctx.root.appendChild(sc);
      const wrap = sc.querySelector('[data-wrap]'), track = sc.querySelector('[data-track]');
      const move = gsap.to(track, { x: () => -(track.scrollWidth - wrap.offsetWidth), ease: 'none', scrollTrigger: { trigger: wrap, scroller: sc, pin: true, scrub: 1, end: () => '+=' + (track.scrollWidth - wrap.offsetWidth), invalidateOnRefresh: true } });
      sc.querySelectorAll('[data-p]').forEach((p) => {
        gsap.from(p.querySelector('[data-hh]'), { y: '20cqh', opacity: 0, rotation: 8, scrollTrigger: { trigger: p, scroller: sc, containerAnimation: move, start: 'left 80%', end: 'left 30%', scrub: true } });
        gsap.to(p.querySelector('[data-bx]'), { rotation: 360, borderRadius: '50%', scrollTrigger: { trigger: p, scroller: sc, containerAnimation: move, start: 'left right', end: 'right left', scrub: true } });
      });
      autoScroll(ctx, sc, 0.45);
      return {};
    },
  });

  /* parallax + velocity skew */
  Lab.register({
    id: 'st-velocity', title: 'Parallax & Velocity Skew', category: 'Scroll', thumb: 'tall',
    hint: 'scroll fast: images skew with velocity',
    description: 'Two scroll effects. Parallax layers scrub at different rates (yPercent), so near layers travel further than far ones. A velocity skew reads ScrollTrigger\'s getVelocity() every update, skews the image column in proportion, and eases back to zero with quickTo once the scrolling settles. A progress bar and direction readout come from the same trigger.',
    interact: [['Scroll', 'Layers move at different speeds'], ['Scroll fast', 'Velocity skew; eases back when you stop']],
    features: ['yPercent scrub parallax', 'self.getVelocity()', 'gsap.quickTo() for smooth skew', 'clamp() velocity'],
    code: `const skewTo = gsap.quickTo('.img', 'skewY', { duration: 0.5, ease: 'power3' });
ScrollTrigger.create({ scroller: sc, onUpdate: (self) =>
  skewTo(gsap.utils.clamp(-20, 20, self.getVelocity() / -300)) });
gsap.to('.far', { yPercent: -30, scrollTrigger: { scroller: sc, scrub: true } });`,
    init(ctx) {
      const imgs = Array.from({ length: 10 }, (_, i) => `<div data-img style="height:34cqh;margin:3cqh 0;background:linear-gradient(${i * 37}deg,${i % 2 ? Lab.ACC2 : Lab.ACC1},#0b0c0e);border-radius:6px;transform-origin:50% 50%"></div>`).join('');
      const sc = h(`<div class="scroller"><div style="position:relative;padding:20cqh 18%"><div data-far style="position:absolute;inset:0;background:radial-gradient(circle at 20% 30%,rgba(47,224,122,.15),transparent 40%),radial-gradient(circle at 80% 70%,rgba(255,178,36,.15),transparent 40%)"></div>${imgs}</div></div>`);
      const bar = h(`<div style="position:absolute;left:0;top:0;height:3px;width:0;background:${Lab.ACC1};z-index:3"></div>`);
      const read = h('<div class="readout"></div>');
      ctx.root.append(sc, bar, read);
      const images = sc.querySelectorAll('[data-img]');
      const skewTo = gsap.quickTo(images, 'skewY', { duration: 0.5, ease: 'power3' });
      ScrollTrigger.create({ scroller: sc, trigger: sc.firstElementChild, start: 'top top', end: 'bottom bottom', onUpdate: (self) => { const v = self.getVelocity(); skewTo(gsap.utils.clamp(-18, 18, v / -250)); bar.style.width = self.progress * 100 + '%'; read.textContent = `velocity ${Math.round(v)} px/s · direction ${self.direction > 0 ? '↓' : '↑'}`; } });
      gsap.to(sc.querySelector('[data-far]'), { yPercent: 30, ease: 'none', scrollTrigger: { scroller: sc, trigger: sc.firstElementChild, scrub: true, start: 'top top', end: 'bottom bottom' } });
      images.forEach((im, i) => gsap.fromTo(im, { scale: 0.86 }, { scale: 1, ease: 'none', scrollTrigger: { scroller: sc, trigger: im, scrub: true, start: 'top bottom', end: 'center center' } }));
      autoScroll(ctx, sc, 1.2);
      return {};
    },
  });

  /* ScrollSmoother (iframe: it needs a page-level scroller) */
  Lab.register({
    id: 'smoother', title: 'ScrollSmoother', category: 'Scroll', thumb: 'portrait',
    hint: 'scroll inside the frame: smooth scroll + data-speed / data-lag',
    description: 'ScrollSmoother adds momentum smoothing to native scrolling and turns HTML attributes into effects: data-speed sets parallax speed and data-lag makes elements trail behind. It must own a page\'s main scroller, so this study runs a small real page inside an iframe with the required #smooth-wrapper and #smooth-content structure. ScrollTriggers inside work as normal.',
    interact: [['Scroll in the frame', 'Smoothed scrolling'], ['Watch', 'data-speed layers and data-lag trails'], ['smooth', 'Seconds of smoothing (rebuilds the page)']],
    features: ['ScrollSmoother.create({ smooth, effects })', 'data-speed / data-lag', 'smoothTouch', 'Works with ScrollTrigger'],
    params: [{ key: 'smooth', label: 'smooth (s)', type: 'range', min: 0.2, max: 3, step: 0.1, value: 1.4, restart: true }],
    code: `<div id="smooth-wrapper"><div id="smooth-content">
  <img data-speed="0.5"> <h2 data-lag="0.4">…</h2>
</div></div>
ScrollSmoother.create({ smooth: 1.4, effects: true, smoothTouch: 0.1 });`,
    init(ctx) {
      const v = (f) => new URL('vendor/' + f, location.href).href;
      const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;background:#060708;color:#ece9e2;font-family:system-ui,sans-serif}
        section{min-height:100vh;display:grid;place-items:center;position:relative;overflow:hidden}
        h2{font:italic 400 15vmin/0.95 Georgia,serif;margin:0;letter-spacing:-.02em}
        .tag{font:10px monospace;letter-spacing:.12em;text-transform:uppercase;color:#74757b;text-align:center}
        .orb{position:absolute;border-radius:50%}
        .row{display:flex;gap:4vmin;justify-content:center}.row div{width:12vmin;height:12vmin;border-radius:8%}
      </style></head><body><div id="smooth-wrapper"><div id="smooth-content">
        <section><div><div class="tag">ScrollSmoother</div><h2>Smooth <em>scroll</em></h2></div>
          <div class="orb" data-speed="0.4" style="width:40vmin;height:40vmin;left:-8vmin;top:12vh;background:radial-gradient(circle,rgba(47,224,122,.5),transparent 70%)"></div>
          <div class="orb" data-speed="1.6" style="width:22vmin;height:22vmin;right:6vmin;bottom:8vh;background:radial-gradient(circle,rgba(255,178,36,.6),transparent 70%)"></div></section>
        <section><div><div class="tag">data-lag</div><div class="row">${[0.1, 0.3, 0.5, 0.7, 0.9].map((l, i) => `<div data-lag="${l}" style="background:${i % 2 ? '#ffb224' : '#2fe07a'}"></div>`).join('')}</div></div></section>
        <section><div><div class="tag">data-speed</div><div class="row">${[0.6, 0.8, 1, 1.2, 1.4].map((sp, i) => `<div data-speed="${sp}" style="background:${i % 2 ? '#ece9e2' : '#2fe07a'}"></div>`).join('')}</div></div></section>
        <section><div><div class="tag">end</div><h2>Fin<em>.</em></h2></div></section>
      </div></div>
      <script src="${v('gsap.min.js')}"><\/script><script src="${v('ScrollTrigger.min.js')}"><\/script><script src="${v('ScrollSmoother.min.js')}"><\/script>
      <script>gsap.registerPlugin(ScrollTrigger, ScrollSmoother); const sm = ScrollSmoother.create({ smooth: ${ctx.params.smooth}, effects: true, smoothTouch: 0.1 });
        let user = false; addEventListener('wheel', () => user = true, { passive: true }); addEventListener('pointerdown', () => user = true);
        const o = { p: 0 }; gsap.to(o, { p: 1, duration: 14, ease: 'sine.inOut', repeat: -1, yoyo: true, onUpdate: () => { if (!user) sm.scrollTo(o.p * (document.body.scrollHeight - innerHeight)); } });<\/script></body></html>`;
      const fr = h('<iframe title="ScrollSmoother demo" style="position:absolute;inset:0;width:100%;height:100%;border:0;background:#060708"></iframe>');
      fr.srcdoc = doc;
      ctx.root.appendChild(fr);
      return {};
    },
  });

  /* ScrollTo plugin */
  Lab.register({
    id: 'scrollto', title: 'ScrollTo', category: 'Scroll', thumb: 'square',
    hint: 'click the nav to glide to a section',
    description: 'ScrollToPlugin animates any scroller, including the window, to a pixel value, an element or a selector, with offsetY to clear a fixed header. autoKill stops the tween the moment the user scrolls, so nothing fights them. The horizontal strip shows that x scrolling works the same way.',
    interact: [['Nav buttons', 'Glide to a section (offsetY: 40)'], ['Strip buttons', 'scrollTo: { x }'], ['Scroll mid-animation', 'autoKill hands control back']],
    features: ['scrollTo: { y: element, offsetY }', 'scrollTo: { x }', 'autoKill', 'Any scroller element or window'],
    code: `gsap.to(scroller, { scrollTo: { y: '#about', offsetY: 40, autoKill: true },
  duration: 1.2, ease: 'power3.inOut' });
gsap.to(strip, { scrollTo: { x: 600 }, duration: 0.8 });`,
    init(ctx) {
      const names = ['Intro', 'Work', 'About', 'Contact'];
      const sc = h(`<div class="scroller" style="top:46px">${names.map((n, i) => `<section data-s="${i}" style="min-height:80cqh;display:grid;place-items:center;border-bottom:1px solid var(--rule)"><div style="text-align:center"><div class="tag">section ${i + 1}</div><h2 class="big">${n}</h2></div></section>`).join('')}
        <div data-strip style="overflow-x:auto;white-space:nowrap;padding:4cqmin;border-top:1px solid var(--rule)">${Array.from({ length: 16 }, (_, i) => `<div style="display:inline-block;width:22cqmin;height:16cqmin;margin-right:2cqmin;background:${i % 2 ? Lab.ACC2 : Lab.ACC1};border-radius:4px"></div>`).join('')}</div></div>`);
      const navEl = h(`<div style="position:absolute;left:0;right:0;top:0;height:46px;display:flex;gap:6px;align-items:center;justify-content:center;background:rgba(6,7,8,.85);border-bottom:1px solid var(--rule-2);z-index:3">${names.map((n, i) => `<button class="sbtn" data-go="${i}">${n}</button>`).join('')}<button class="sbtn" data-x="0">strip ←</button><button class="sbtn" data-x="1">strip →</button></div>`);
      ctx.root.append(sc, navEl);
      const strip = sc.querySelector('[data-strip]');
      const go = ctx.safe((i) => gsap.to(sc, { scrollTo: { y: sc.querySelector(`[data-s="${i}"]`), offsetY: 0, autoKill: true }, duration: 1.2, ease: 'power3.inOut' }));
      ctx.on(navEl, 'click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.go) go(+b.dataset.go);
        else { gsap.to(sc, { scrollTo: { y: strip, offsetY: 60 }, duration: 0.8 }); gsap.to(strip, { scrollTo: { x: b.dataset.x === '1' ? 'max' : 0 }, duration: 1, ease: 'power2.inOut', delay: 0.5 }); }
      });
      let k = 0; ctx.every(2.4, () => { if (!ctx.root.matches(':hover')) go((k = (k + 1) % names.length)); });
      return {};
    },
  });

  /* Observer slider */
  Lab.register({
    id: 'observer', title: 'Observer Slides', category: 'Scroll', thumb: 'tall',
    hint: 'wheel, swipe, drag or press ↑ ↓ to change slides',
    description: 'Observer normalises wheel, touch and pointer input into simple onUp and onDown intent, with tolerance, axis locking and preventDefault, without scrolling anything. This full-stage slideshow is built on it: every input method moves one slide, and an animating flag ignores extra input while a transition plays. SplitText animates each heading in.',
    interact: [['Wheel', 'Next / previous slide'], ['Swipe / drag', 'Same, on touch or mouse'], ['↑ ↓', 'Keyboard']],
    features: ['Observer.create({ type: "wheel,touch,pointer" })', 'onUp / onDown / tolerance', 'preventDefault', 'wheelSpeed / lockAxis'],
    captureKeys: true,
    code: `Observer.create({ target: stage, type: 'wheel,touch,pointer',
  wheelSpeed: -1, tolerance: 10, preventDefault: true,
  onDown: () => !animating && go(index - 1),
  onUp:   () => !animating && go(index + 1) });`,
    init(ctx) {
      const titles = ['Intent', 'Not scroll', 'Wheel', 'Touch', 'Pointer'];
      const wrap = h(`<div class="fill">${titles.map((t, i) => `<section data-sl style="position:absolute;inset:0;display:grid;place-items:center;visibility:hidden;background:radial-gradient(circle at 50% 50%,${i % 2 ? 'rgba(255,178,36,.12)' : 'rgba(47,224,122,.12)'},transparent 60%)"><div style="text-align:center;overflow:hidden"><div class="tag">slide ${i + 1} / ${titles.length}</div><h2 class="big" data-t>${t}</h2></div></section>`).join('')}<div data-dots style="position:absolute;right:20px;top:50%;transform:translateY(-50%);display:grid;gap:8px">${titles.map(() => '<i style="display:block;width:6px;height:6px;border-radius:50%;background:var(--rule-3)"></i>').join('')}</div></div>`);
      ctx.root.appendChild(wrap);
      const slides = gsap.utils.toArray(wrap.querySelectorAll('[data-sl]')), dots = wrap.querySelectorAll('[data-dots] i');
      const splits = slides.map((s) => new SplitText(s.querySelector('[data-t]'), { type: 'chars' }));
      let idx = -1, animating = false;
      const go = ctx.safe((n, dir) => {
        n = gsap.utils.wrap(0, slides.length, n);
        if (n === idx) return;
        animating = true;
        const tl = gsap.timeline({ defaults: { duration: 0.9, ease: 'power3.inOut' }, onComplete: () => (animating = false) });
        if (idx >= 0) tl.to(slides[idx], { yPercent: -100 * dir, autoAlpha: 0 }, 0);
        tl.fromTo(slides[n], { yPercent: 100 * dir, autoAlpha: 1 }, { yPercent: 0 }, 0).from(splits[n].chars, { yPercent: 120 * dir, rotation: 12 * dir, opacity: 0, stagger: 0.025, duration: 0.7, ease: 'power3.out' }, 0.25);
        dots.forEach((d, i) => gsap.to(d, { backgroundColor: i === n ? Lab.ACC1 : 'rgba(236,233,226,.24)', scale: i === n ? 1.6 : 1, duration: 0.4 }));
        idx = n;
      });
      const obs = Observer.create({ target: ctx.root, type: 'wheel,touch,pointer', wheelSpeed: -1, tolerance: 10, preventDefault: true, onDown: () => !animating && go(idx - 1, -1), onUp: () => !animating && go(idx + 1, 1) });
      ctx.on(window, 'keydown', (e) => { if (animating) return; if (e.key === 'ArrowDown') go(idx + 1, 1); if (e.key === 'ArrowUp') go(idx - 1, -1); });
      go(0, 1);
      ctx.every(3.2, () => { if (!ctx.root.matches(':hover') && !animating) go(idx + 1, 1); });
      return { splits, obs };
    },
    dispose(ctx, s) { s.obs.kill(); s.splits.forEach((x) => x.revert()); },
  });
})();
