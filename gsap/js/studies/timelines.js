/* Group B — Timelines. */
(function () {
  const { h } = Lab;

  /* position parameter, visualised */
  Lab.register({
    id: 'position', title: 'Position Parameter', category: 'Timelines', thumb: 'wide',
    hint: 'pick a position for tween 3 · watch the bars',
    description: 'A timeline\'s position parameter decides where each tween is inserted. It can be an absolute time, "+=1" or "-=0.5" relative to the end, "<" for the start of the previous tween, ">" for its end, "<0.3" for an offset from the previous start, or a label. The bar chart redraws the timeline as you change the third tween\'s position, and a playhead sweeps across it.',
    interact: [['Position', 'Where tween 3 is inserted'], ['Watch', 'Bars show start / duration; playhead follows time()']],
    features: ['timeline.to(target, vars, position)', '"<" / ">" / "<0.3"', '"+=1" / "-=0.5"', 'addLabel() + label offsets', 'timeline.duration()'],
    params: [{ key: 'pos', label: 'Tween 3 position', type: 'select', options: ['(end)', '"<"', '">"', '"-=0.6"', '"+=0.5"', '"<0.3"', '"spin"', '0.2'], value: 1, restart: true }],
    code: `const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6 });
tl.to(a, { x: 300 })
  .addLabel('spin')
  .to(b, { x: 300 })
  .to(c, { x: 300 }, '<')      // same start as previous
  .to(d, { x: 300 }, '-=0.25');`,
    init(ctx) {
      const POS = [undefined, '<', '>', '-=0.6', '+=0.5', '<0.3', 'spin', 0.2][ctx.params.pos];
      const names = ['tween 1', 'tween 2', 'tween 3', 'tween 4'];
      const wrap = h(`<div style="position:absolute;inset:16% 8% 20%"><div data-lanes style="position:absolute;inset:0 0 44% 0;display:flex;flex-direction:column;justify-content:space-around">${names.map((n, i) => `<div class="lane"><span class="tag">${n}</span><div class="box ${i === 2 ? 'b2' : ''}" style="--s:5cqmin;position:absolute;top:50%;left:0;translate:0 -50%"></div></div>`).join('')}</div>
        <div data-chart style="position:absolute;left:0;right:0;bottom:0;height:38%;border-top:1px solid var(--rule-2)"></div></div>`);
      ctx.root.appendChild(wrap);
      const boxes = wrap.querySelectorAll('.box'), chart = wrap.querySelector('[data-chart]');
      const dist = () => wrap.offsetWidth - boxes[0].offsetWidth;
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.8 });
      tl.to(boxes[0], { x: dist, duration: 1, ease: 'power2.inOut' }).addLabel('spin').to(boxes[1], { x: dist, duration: 1.2, ease: 'power2.inOut' }).to(boxes[2], { x: dist, rotation: 360, duration: 1, ease: 'power2.inOut' }, POS).to(boxes[3], { x: dist, duration: 0.8, ease: 'power2.inOut' });
      const total = tl.duration();
      const kids = tl.getChildren(false, true, false);
      chart.innerHTML = kids.map((t, i) => `<div style="position:absolute;left:${(t.startTime() / total) * 100}%;width:${(t.duration() / total) * 100}%;top:${8 + i * 22}%;height:16%;background:${i === 2 ? Lab.ACC2 : 'rgba(47,224,122,.55)'};font:10px var(--mono);color:#060708;padding-left:4px;white-space:nowrap">${t.startTime().toFixed(1)}s</div>`).join('')
        + `<div style="position:absolute;left:${(tl.labels.spin / total) * 100}%;top:0;bottom:0;border-left:1px dashed var(--text-2)"><span class="tag" style="position:absolute;top:-16px;left:4px">label "spin"</span></div><div data-ph style="position:absolute;top:0;bottom:0;width:1px;background:${Lab.BONE}"></div>`;
      const ph = chart.querySelector('[data-ph]');
      tl.eventCallback('onUpdate', () => { ph.style.left = (tl.time() / total) * 100 + '%'; });
      return { tl };
    },
  });

  /* labels, nesting, tweenTo, addPause */
  Lab.register({
    id: 'nesting', title: 'Nested Timelines & Labels', category: 'Timelines', thumb: 'square',
    hint: 'jump between labels · Resume past the pause',
    description: 'Real sequences are built from smaller timelines. Here a master timeline nests intro, build and outro timelines, each created by a function and placed with labels. The buttons call tweenTo(label) so the playhead animates smoothly to any chapter, and addPause() stops at a checkpoint until you resume. call() fires a function mid-timeline.',
    interact: [['Chapter buttons', 'master.tweenTo(label)'], ['Resume', 'Continue past addPause()'], ['Restart', 'Play the whole master']],
    features: ['Nested timelines', 'addLabel() / labels', 'tweenTo() / tweenFromTo()', 'addPause()', 'call()'],
    params: [{ key: 'resume', label: 'Resume', type: 'button' }, { key: 'restart', label: 'Restart', type: 'button' }],
    code: `function intro() { return gsap.timeline().from('.tile', { scale: 0, stagger: 0.05 }); }
const master = gsap.timeline()
  .add(intro(), 'intro')
  .add(build(), 'build')
  .addPause('build+=1.2')
  .add(outro(), 'outro');
master.tweenTo('build', { duration: 0.8, ease: 'power2.inOut' });`,
    init(ctx) {
      const grid = h('<div class="center"><div data-g style="display:grid;grid-template-columns:repeat(5,9cqmin);gap:2cqmin"></div></div>');
      const g = grid.querySelector('[data-g]');
      for (let i = 0; i < 15; i++) g.appendChild(h('<div class="box" style="--s:9cqmin"></div>'));
      const bar = h('<div class="topbar"></div>');
      const status = h('<div class="readout"></div>');
      ctx.root.append(grid, bar, status);
      const tiles = gsap.utils.toArray(g.children);
      const intro = () => gsap.timeline().from(tiles, { scale: 0, rotation: -90, duration: 0.6, ease: 'back.out(2)', stagger: { each: 0.04, from: 'center' } });
      const build = () => gsap.timeline().to(tiles, { borderRadius: '50%', backgroundColor: Lab.ACC2, duration: 0.5, stagger: { each: 0.03, from: 'start' } }).to(tiles, { y: (i) => (i % 2 ? -14 : 14), duration: 0.5, ease: 'sine.inOut' }, '<0.2');
      const outro = () => gsap.timeline().to(tiles, { y: 0, rotation: 180, scale: 0.6, backgroundColor: Lab.BONE, borderRadius: '6%', duration: 0.6, stagger: { each: 0.03, from: 'end' } }).to(tiles, { scale: 1, rotation: 360, backgroundColor: Lab.ACC1, duration: 0.6, ease: 'elastic.out(1,0.5)', stagger: 0.02 });
      const master = gsap.timeline({ onUpdate: () => (status.textContent = `master ${master.time().toFixed(2)} / ${master.duration().toFixed(2)}s · ${master.currentLabel() || ''}${master.paused() ? ' · paused at addPause()' : ''}`) });
      master.add(intro(), 'intro').add(build(), 'build').call(() => (status.style.color = Lab.ACC2)).addPause('build+=1.4').add(outro(), 'outro');
      ['intro', 'build', 'outro'].forEach((l) => { const b = h(`<button class="sbtn">tweenTo('${l}')</button>`); ctx.on(b, 'click', ctx.safe(() => master.tweenTo(l, { duration: 0.8, ease: 'power2.inOut' }))); bar.appendChild(b); });
      return { master };
    },
    action(ctx, s, k) { if (k === 'resume') s.master.play(); else s.master.restart(); },
  });

  /* custom scrubber */
  Lab.register({
    id: 'scrubber', title: 'Timeline Scrubber', category: 'Timelines', thumb: 'wide',
    hint: 'drag the playhead · arrows step · space plays',
    description: 'A custom transport built from GSAP itself. The playhead is a Draggable constrained to the track; dragging it sets the timeline\'s progress(), and while playing, onUpdate drives the playhead back. Chapter ticks come from the timeline\'s labels. Space plays and pauses, the arrow keys step a tenth of a second, and Home/End jump to either end.',
    interact: [['Drag the playhead', 'Scrub progress()'], ['Space', 'Play / pause'], ['← →', 'Step 0.1 s'], ['Home / End', 'Jump to start / end']],
    features: ['Draggable bounds + onDrag', 'timeline.progress()', 'labels → chapter ticks', 'timeline.paused()'],
    captureKeys: true,
    code: `const tl = gsap.timeline({ paused: true, onUpdate: syncHandle });
Draggable.create(handle, { type: 'x', bounds: track,
  onDrag() { tl.progress(this.x / this.maxX); } });`,
    init(ctx) {
      const scene = h(`<div style="position:absolute;inset:14% 10% 34%;display:flex;align-items:center;justify-content:space-around">${'<div class="dot" style="--s:9cqmin"></div>'.repeat(5)}</div>`);
      const ui = h(`<div style="position:absolute;left:10%;right:10%;bottom:20%"><div data-t style="position:relative;height:30px"><div style="position:absolute;left:0;right:0;top:14px;height:2px;background:var(--rule-3)"></div><div data-fill style="position:absolute;left:0;top:14px;height:2px;background:${Lab.ACC1}"></div><div data-ticks></div><div data-h style="position:absolute;left:0;top:3px;width:24px;height:24px;margin-left:-12px;border-radius:50%;background:${Lab.BONE};cursor:grab;box-shadow:0 0 0 4px #060708"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:10px"><button class="sbtn" data-play>▶ play</button><span class="mono" data-time>0.00s</span></div></div>`);
      ctx.root.append(scene, ui);
      const dots = scene.querySelectorAll('.dot'), track = ui.querySelector('[data-t]'), handle = ui.querySelector('[data-h]'), fill = ui.querySelector('[data-fill]'), timeEl = ui.querySelector('[data-time]'), play = ui.querySelector('[data-play]');
      const tl = gsap.timeline({ paused: true, repeat: 0 });
      tl.addLabel('rise').to(dots, { y: '-14cqmin', stagger: 0.1, duration: 0.6, ease: 'power3.out' }).addLabel('turn').to(dots, { rotation: 180, borderRadius: '10%', backgroundColor: Lab.ACC2, stagger: 0.08, duration: 0.6 }).addLabel('fall').to(dots, { y: 0, scale: 1.4, stagger: { each: 0.08, from: 'end' }, duration: 0.6, ease: 'bounce.out' }).addLabel('end').to(dots, { scale: 1, borderRadius: '50%', backgroundColor: Lab.ACC1, duration: 0.5 });
      const ticks = ui.querySelector('[data-ticks]');
      Object.entries(tl.labels).forEach(([n, t]) => ticks.appendChild(h(`<div style="position:absolute;left:${(t / tl.duration()) * 100}%;top:20px;font:9px var(--mono);color:var(--muted);transform:translateX(-50%);padding-top:12px;border-left:1px solid var(--rule-3)">${n}</div>`)));
      let drag;
      const sync = () => { const p = tl.progress(), max = track.offsetWidth; gsap.set(handle, { x: p * max }); fill.style.width = p * 100 + '%'; timeEl.textContent = tl.time().toFixed(2) + 's'; if (drag) drag.update(); };
      tl.eventCallback('onUpdate', sync);
      tl.eventCallback('onComplete', () => (play.textContent = '▶ play'));
      drag = Draggable.create(handle, { type: 'x', bounds: track, onPress() { tl.pause(); play.textContent = '▶ play'; }, onDrag() { tl.progress(this.x / track.offsetWidth); }, cursor: 'grab', activeCursor: 'grabbing' })[0];
      const toggle = () => { if (tl.progress() === 1) tl.restart(); else tl.paused(!tl.paused()); play.textContent = tl.paused() ? '▶ play' : '❚❚ pause'; };
      ctx.on(play, 'click', toggle);
      ctx.on(window, 'keydown', (e) => {
        if (e.code === 'Space') { e.preventDefault(); toggle(); }
        if (e.key === 'ArrowRight') { tl.pause(); tl.time(Math.min(tl.duration(), tl.time() + 0.1)); }
        if (e.key === 'ArrowLeft') { tl.pause(); tl.time(Math.max(0, tl.time() - 0.1)); }
        if (e.key === 'Home') tl.pause(0); if (e.key === 'End') tl.pause(tl.duration());
      });
      tl.play(); play.textContent = '❚❚ pause';
      return {};
    },
  });

  /* GSDevTools */
  Lab.register({
    id: 'devtools', title: 'GSDevTools', category: 'Timelines', thumb: 'tall',
    hint: 'use the GSDevTools panel: scrub, loop, slow down',
    description: 'GSDevTools is GSAP\'s official visual inspector: a transport panel with play/pause, a scrubbable timeline, in and out loop markers, speed control, and a menu of every animation and label. It is attached here to a looping timeline inside the stage, using its container option so it stays in the study rather than docking to the page.',
    interact: [['Panel', 'Scrub, loop a region, change speed'], ['Animation menu', 'Switch the inspected animation'], ['Keyboard', 'GSDevTools shortcuts when focused']],
    features: ['GSDevTools.create()', 'container option', 'id-named animations', 'inTime / outTime looping'],
    code: `const tl = gsap.timeline({ id: 'hero' });
tl.from('.shape', { y: 100, stagger: 0.1 });
GSDevTools.create({ animation: tl, container: '#panel', globalSync: false });`,
    init(ctx) {
      const scene = h(`<div style="position:absolute;inset:10% 10% 30%;display:grid;place-items:center"><svg viewBox="0 0 300 120" style="width:min(76cqw,640px);height:auto"><circle cx="40" cy="60" r="26" fill="${Lab.ACC1}"/><rect x="110" y="34" width="52" height="52" fill="${Lab.ACC2}"/><polygon points="230,30 262,90 198,90" fill="${Lab.BONE}"/></svg></div>`);
      const panel = h('<div style="position:absolute;left:4%;right:4%;bottom:56px;height:76px"></div>');
      ctx.root.append(scene, panel);
      const shapes = scene.querySelectorAll('circle,rect,polygon');
      const tl = gsap.timeline({ id: 'shapes', repeat: -1, repeatDelay: 0.4 });
      tl.from(shapes, { y: 80, opacity: 0, stagger: 0.15, duration: 0.7, ease: 'back.out(2)' }).addLabel('spin').to(shapes, { rotation: 360, transformOrigin: '50% 50%', duration: 1, stagger: 0.1, ease: 'power2.inOut' }).to(shapes, { y: -30, yoyo: true, repeat: 1, duration: 0.4, stagger: 0.08 });
      let dev = null;
      try { dev = GSDevTools.create({ animation: tl, container: panel, globalSync: false, minimal: ctx.width < 520, css: { width: '100%', bottom: 0 } }); } catch (e) { panel.innerHTML = `<div class="mono">GSDevTools unavailable: ${e.message}</div>`; }
      return { dev };   // GSDevTools is context-aware: revert() removes it
    },
  });

  /* global timeline, ticker, lagSmoothing, exportRoot */
  Lab.register({
    id: 'global', title: 'Global Timeline & Ticker', category: 'Timelines', thumb: 'square',
    hint: 'slow down everything · exportRoot rewinds it all',
    description: 'Everything in GSAP lives on the root timeline. Changing gsap.globalTimeline.timeScale() slows or speeds up every animation at once, for slow-motion debugging. exportRoot() wraps everything currently playing into one timeline you can reverse. gsap.ticker is the single requestAnimationFrame loop GSAP runs on; here it also draws the frame-time graph. lagSmoothing() and ticker.fps() shape how GSAP copes with dropped frames.',
    interact: [['Global timeScale', 'Slow motion for everything on the page'], ['exportRoot → reverse', 'Rewind every running animation'], ['ticker.fps', 'Cap the frame rate'], ['lagSmoothing', 'Toggle catch-up behaviour']],
    features: ['gsap.globalTimeline.timeScale()', 'gsap.exportRoot()', 'gsap.ticker.add() / fps()', 'gsap.ticker.lagSmoothing()', 'gsap.delayedCall()'],
    params: [
      { key: 'ts', label: 'globalTimeline.timeScale', type: 'range', min: 0.1, max: 2, step: 0.05, value: 1 },
      { key: 'fps', label: 'ticker.fps', type: 'select', options: ['60', '30', '15'], value: 0 },
      { key: 'lag', label: 'lagSmoothing on', type: 'toggle', value: true },
      { key: 'rewind', label: 'exportRoot → reverse', type: 'button' },
    ],
    code: `gsap.globalTimeline.timeScale(0.25);            // everything, slow-mo
const all = gsap.exportRoot(); all.reverse();     // rewind everything
gsap.ticker.add((time, delta) => draw(delta));    // one shared rAF loop
gsap.ticker.fps(30); gsap.ticker.lagSmoothing(500, 33);`,
    init(ctx) {
      const orbits = h(`<div class="center">${[0, 1, 2, 3, 4].map((i) => `<div style="position:absolute;width:${16 + i * 9}cqmin;height:${16 + i * 9}cqmin;border:1px solid var(--rule-2);border-radius:50%"><div class="dot" style="--s:${3.4 - i * 0.3}cqmin;position:absolute;top:-1.5cqmin;left:50%;background:${i % 2 ? Lab.ACC2 : Lab.ACC1}"></div></div>`).join('')}</div>`);
      const cv = h('<canvas style="position:absolute;right:18px;top:52px;width:180px;height:60px"></canvas>');
      const read = h('<div class="readout"></div>');
      ctx.root.append(orbits, cv, read);
      [...orbits.children].forEach((o, i) => gsap.to(o, { rotation: 360, duration: 3 + i * 1.6, repeat: -1, ease: 'none' }));
      const g = cv.getContext('2d'); cv.width = 360; cv.height = 120;
      const hist = [];
      const draw = (time, delta) => {
        hist.push(delta); if (hist.length > 90) hist.shift();
        g.clearRect(0, 0, 360, 120); g.strokeStyle = 'rgba(236,233,226,.2)'; g.strokeRect(0, 0, 360, 120);
        g.beginPath(); hist.forEach((d, i) => g.lineTo((i / 89) * 360, 120 - Math.min(d, 60) / 60 * 110)); g.strokeStyle = Lab.ACC2; g.lineWidth = 2; g.stroke();
        read.textContent = `ticker.time ${time.toFixed(1)}s · frame ${delta.toFixed(1)}ms · globalTimeline.timeScale ${gsap.globalTimeline.timeScale().toFixed(2)}`;
      };
      gsap.ticker.add(draw);
      gsap.globalTimeline.timeScale(ctx.params.ts);
      return { draw };
    },
    onParam(ctx, s, k, v) {
      if (k === 'ts') gsap.globalTimeline.timeScale(v);
      if (k === 'fps') gsap.ticker.fps([60, 30, 15][v]);
      if (k === 'lag') gsap.ticker.lagSmoothing(v ? 500 : 0, v ? 33 : 0);
    },
    action(ctx, s) { const all = gsap.exportRoot(); all.reverse(); ctx.later(1.5, () => all.play()); },
    dispose(ctx, s) { gsap.ticker.remove(s.draw); gsap.globalTimeline.timeScale(1); gsap.ticker.fps(60); gsap.ticker.lagSmoothing(500, 33); },
  });
})();
