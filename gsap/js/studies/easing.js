/* Group C — Easing. */
(function () {
  const { h } = Lab;
  const curvePath = (fn, W = 100, H = 100, n = 120) => {
    let d = '', lo = 0, hi = 1;
    const ys = []; for (let i = 0; i <= n; i++) { const y = fn(i / n); ys.push(y); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    ys.forEach((y, i) => { d += (i ? 'L' : 'M') + ((i / n) * W).toFixed(2) + ',' + (H - ((y - lo) / (hi - lo || 1)) * H).toFixed(2); });
    return { d, lo, hi };
  };

  /* every built-in ease */
  Lab.register({
    id: 'ease-visualizer', title: 'Ease Visualizer', category: 'Easing', thumb: 'tall',
    hint: 'choose a family and type · tune its config',
    description: 'Every built-in ease plotted and played. Choose a family (power0–4, sine, expo, circ, back, elastic, bounce, steps) and a type (in, out, inOut), then tune the configurable ones: back overshoot, elastic amplitude and period, and the step count. The curve is sampled from the real ease function, gsap.parseEase(), and the ball and bar move by it.',
    interact: [['Family / type', 'Pick any ease'], ['Config sliders', 'back(overshoot), elastic(amp, period), steps(n)'], ['Watch', 'Graph + position + scale driven by the ease']],
    features: ['power1–4 / sine / expo / circ', 'back(1.7) / elastic(1, 0.3) / bounce', 'steps(n)', 'gsap.parseEase()', '.in / .out / .inOut'],
    params: [
      { key: 'fam', label: 'Family', type: 'select', options: ['power1', 'power2', 'power3', 'power4', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce', 'steps', 'none'], value: 8 },
      { key: 'type', label: 'Type', type: 'select', options: ['in', 'out', 'inOut'], value: 1 },
      { key: 'p1', label: 'back overshoot / elastic amplitude / steps', type: 'range', min: 0.5, max: 12, step: 0.1, value: 1 },
      { key: 'p2', label: 'elastic period', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.3 },
    ],
    code: `gsap.to('.ball', { y: -200, ease: 'elastic.out(1, 0.3)' });
gsap.to('.ball', { x: 300, ease: 'back.inOut(1.7)' });
gsap.to('.ball', { x: 300, ease: 'steps(12)' });
const fn = gsap.parseEase('power3.out'); fn(0.5); // 0.875`,
    init(ctx) {
      const view = h(`<div style="position:absolute;inset:12% 8% 18%;display:grid;grid-template-columns:1.2fr 1fr;gap:6%">
        <div style="position:relative"><svg viewBox="-6 -40 112 180" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">
          <rect x="0" y="0" width="100" height="100" fill="none" stroke="rgba(236,233,226,.12)"/><path data-c fill="none" stroke="${Lab.ACC1}" stroke-width="1.4" vector-effect="non-scaling-stroke"/><circle data-p r="2.4" fill="${Lab.BONE}"/></svg><div class="tag" data-n style="position:absolute;left:0;bottom:-24px"></div></div>
        <div style="position:relative"><div style="position:absolute;left:30%;top:0;bottom:0;width:1px;background:var(--rule-2)"></div><div class="dot" data-b style="--s:7cqmin;position:absolute;left:30%;bottom:0;margin-left:-3.5cqmin"></div>
          <div class="box b2" data-s style="--s:10cqmin;position:absolute;right:6%;top:40%"></div></div></div>`);
      ctx.root.appendChild(view);
      const pathEl = view.querySelector('[data-c]'), pt = view.querySelector('[data-p]'), ball = view.querySelector('[data-b]'), sq = view.querySelector('[data-s]'), nameEl = view.querySelector('[data-n]');
      const s = {};
      s.build = () => {
        if (s.tl) s.tl.kill();
        const p = ctx.params, fam = ['power1', 'power2', 'power3', 'power4', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce', 'steps', 'none'][p.fam], type = ['in', 'out', 'inOut'][p.type];
        let name = fam === 'none' ? 'none' : fam === 'steps' ? `steps(${Math.round(p.p1)})` : `${fam}.${type}`;
        if (fam === 'back') name += `(${p.p1.toFixed(1)})`;
        if (fam === 'elastic') name += `(${Math.min(p.p1, 3).toFixed(1)}, ${p.p2.toFixed(2)})`;
        const fn = gsap.parseEase(name);
        const { d, lo, hi } = curvePath(fn);
        pathEl.setAttribute('d', d);
        nameEl.textContent = `ease: "${name}"`;
        const prog = { t: 0 };
        s.tl = gsap.timeline({ repeat: -1, repeatDelay: 0.5 })
          .to(prog, { t: 1, duration: 1.6, ease: 'none', onUpdate: () => { const y = fn(prog.t); pt.setAttribute('cx', prog.t * 100); pt.setAttribute('cy', 100 - ((y - lo) / (hi - lo || 1)) * 100); } })
          .fromTo(ball, { y: 0 }, { y: () => -(view.offsetHeight - ball.offsetHeight), duration: 1.6, ease: name }, 0)
          .fromTo(sq, { scale: 0.4, rotation: 0 }, { scale: 1.4, rotation: 180, duration: 1.6, ease: name }, 0);
      };
      s.build();
      return s;
    },
    onParam(ctx, s) { s.build(); },
  });

  /* CustomEase editor */
  Lab.register({
    id: 'custom-ease', title: 'CustomEase Editor', category: 'Easing', thumb: 'square',
    hint: 'drag the handles to draw your own ease',
    description: 'CustomEase turns any SVG path into an ease. Drag the four control handles of this two-segment Bézier curve (the middle anchor moves too) and the path data is fed straight into CustomEase.create(), so the ball immediately moves by your curve. Copy the result as ready-to-paste code.',
    interact: [['Drag handles', 'Reshape the curve (Draggable)'], ['Drag the middle anchor', 'Move the join'], ['Copy', 'Clipboard: the CustomEase.create() call']],
    features: ['CustomEase.create(id, svgPath)', 'Draggable control points', 'Multi-segment cubic Béziers', 'Overshoot beyond 0–1'],
    params: [{ key: 'copy', label: 'Copy CustomEase code', type: 'button' }, { key: 'reset', label: 'Reset curve', type: 'button' }],
    code: `CustomEase.create('mine', 'M0,0 C0.2,0 0.3,1.1 0.5,1.05 C0.7,1 0.8,1 1,1');
gsap.to('.ball', { x: 300, ease: 'mine' });`,
    init(ctx) {
      const S = 260;
      const wrap = h(`<div style="position:absolute;inset:10% 6% 16%;display:grid;grid-template-columns:auto 1fr;gap:5%;align-items:center">
        <div data-ed style="position:relative;width:min(56cqh,46cqw);aspect-ratio:1"><svg viewBox="0 -60 ${S} ${S + 120}" style="position:absolute;inset:-23% 0;width:100%;height:146%">
          <rect x="0" y="0" width="${S}" height="${S}" fill="none" stroke="rgba(236,233,226,.15)"/>
          <line data-l1 stroke="rgba(236,233,226,.4)"/><line data-l2 stroke="rgba(236,233,226,.4)"/><line data-l3 stroke="rgba(236,233,226,.4)"/><line data-l4 stroke="rgba(236,233,226,.4)"/>
          <path data-c fill="none" stroke="${Lab.ACC1}" stroke-width="3"/></svg></div>
        <div style="position:relative;height:60%"><div style="position:absolute;left:0;right:0;top:50%;height:1px;background:var(--rule-2)"></div><div class="dot" data-ball style="--s:7cqmin;position:absolute;left:0;top:50%;margin-top:-3.5cqmin"></div><div class="mono" data-code style="position:absolute;left:0;right:0;bottom:-10px;font-size:10px;word-break:break-all"></div></div></div>`);
      ctx.root.appendChild(wrap);
      const ed = wrap.querySelector('[data-ed]'), svg = ed.querySelector('svg'), path = svg.querySelector('[data-c]'), ball = wrap.querySelector('[data-ball]'), codeEl = wrap.querySelector('[data-code]');
      const L = [1, 2, 3, 4].map((i) => svg.querySelector(`[data-l${i}]`));
      const def = [[0.25, 0], [0.3, 1.15], [0.5, 1.02], [0.7, 0.92], [0.85, 1]];
      let pts = def.map((p) => p.slice());
      const handles = pts.map((p, i) => { const el = h(`<div style="position:absolute;width:18px;height:18px;margin:-9px;border-radius:${i === 2 ? '2px' : '50%'};background:${i === 2 ? Lab.ACC2 : Lab.BONE};cursor:grab;box-shadow:0 0 0 3px #060708;z-index:2"></div>`); ed.appendChild(el); return el; });
      const toPx = (p) => [p[0] * ed.offsetWidth, (1 - p[1]) * ed.offsetWidth];
      const pathStr = () => `M0,0 C${pts[0][0].toFixed(3)},${pts[0][1].toFixed(3)} ${pts[1][0].toFixed(3)},${pts[1][1].toFixed(3)} ${pts[2][0].toFixed(3)},${pts[2][1].toFixed(3)} C${pts[3][0].toFixed(3)},${pts[3][1].toFixed(3)} ${pts[4][0].toFixed(3)},${pts[4][1].toFixed(3)} 1,1`;
      let tl;
      const refresh = () => {
        const q = (p) => `${p[0] * S},${(1 - p[1]) * S}`;
        path.setAttribute('d', `M0,${S} C${q(pts[0])} ${q(pts[1])} ${q(pts[2])} C${q(pts[3])} ${q(pts[4])} ${S},0`);
        const seg = [[[0, 0], pts[0]], [pts[1], pts[2]], [pts[2], pts[3]], [pts[4], [1, 1]]];
        seg.forEach(([a, b], i) => { L[i].setAttribute('x1', a[0] * S); L[i].setAttribute('y1', (1 - a[1]) * S); L[i].setAttribute('x2', b[0] * S); L[i].setAttribute('y2', (1 - b[1]) * S); });
        CustomEase.create('labCustom', pathStr());
        codeEl.textContent = `CustomEase.create("mine", "${pathStr()}")`;
        if (tl) tl.kill();
        tl = gsap.timeline({ repeat: -1, repeatDelay: 0.4 }).fromTo(ball, { x: 0 }, { x: () => ball.parentNode.offsetWidth - ball.offsetWidth, duration: 1.4, ease: 'labCustom' });
      };
      const place = () => handles.forEach((el, i) => { const [x, y] = toPx(pts[i]); gsap.set(el, { x, y }); });
      handles.forEach((el, i) => Draggable.create(el, { onDrag() { const w = ed.offsetWidth; const nx = Math.min(1, Math.max(0, this.x / w)), ny = 1 - this.y / w; if (i === 2) { const dx = nx - pts[2][0], dy = ny - pts[2][1]; pts[1][0] += dx; pts[1][1] += dy; pts[3][0] += dx; pts[3][1] += dy; } pts[i] = [nx, ny]; place(); refresh(); } }));
      place(); refresh();
      return { codeEl, reset: () => { pts = def.map((p) => p.slice()); place(); refresh(); }, place };
    },
    resize(ctx, s) { s.place(); },
    action(ctx, s, k) { if (k === 'reset') s.reset(); else navigator.clipboard && navigator.clipboard.writeText(s.codeEl.textContent).then(() => ctx.message(''), () => {}); },
  });

  /* CustomBounce + CustomWiggle */
  Lab.register({
    id: 'bounce-wiggle', title: 'CustomBounce & CustomWiggle', category: 'Easing', thumb: 'wide',
    hint: 'tune strength / squash · pick a wiggle type',
    description: 'Two ease generators. CustomBounce builds a bounce ease of any strength, plus a matching squash ease, so the ball flattens exactly when it hits the floor. CustomWiggle oscillates a value any number of times; its types (easeOut, easeInOut, anticipate, uniform, random) shape how the shaking starts and decays. Here it drives a notification bell and a nudging button.',
    interact: [['Bounce strength / squash', 'Rebuild the bounce + squash eases'], ['Wiggle type / count', 'Rebuild the wiggle ease'], ['Click the bell', 'Ring it']],
    features: ['CustomBounce.create(id, { strength, squash })', 'Auto-generated "-squash" ease', 'CustomWiggle.create(id, { wiggles, type })', 'Wiggle types'],
    params: [
      { key: 'str', label: 'Bounce strength', type: 'range', min: 0.1, max: 0.95, step: 0.01, value: 0.6 },
      { key: 'sq', label: 'Squash', type: 'range', min: 0, max: 4, step: 0.1, value: 2 },
      { key: 'wt', label: 'Wiggle type', type: 'select', options: ['easeOut', 'easeInOut', 'anticipate', 'uniform', 'random'], value: 0 },
      { key: 'wn', label: 'Wiggles', type: 'range', min: 2, max: 20, step: 1, value: 8 },
    ],
    code: `CustomBounce.create('myBounce', { strength: 0.6, squash: 2, squashID: 'myBounce-squash' });
gsap.to(ball, { y: 300, ease: 'myBounce', duration: 1.6 });
gsap.to(ball, { scaleX: 1.4, scaleY: 0.6, ease: 'myBounce-squash', duration: 1.6 });
CustomWiggle.create('shake', { wiggles: 8, type: 'easeOut' });
gsap.to(bell, { rotation: 25, ease: 'shake', duration: 1 });`,
    init(ctx) {
      const wrap = h(`<div style="position:absolute;inset:12% 8% 18%;display:grid;grid-template-columns:1fr 1fr;gap:8%">
        <div style="position:relative;border-bottom:1px solid var(--rule-3)"><div class="dot" data-ball style="--s:12cqmin;position:absolute;left:50%;top:0;margin-left:-6cqmin;transform-origin:50% 100%"></div></div>
        <div style="display:grid;place-items:center;gap:4cqmin;align-content:center"><svg data-bell viewBox="0 0 64 64" style="width:22cqmin;cursor:pointer;transform-origin:50% 8%"><path d="M32 6c-11 0-18 9-18 20v12l-6 8h48l-6-8V26C50 15 43 6 32 6z" fill="${Lab.ACC2}"/><circle cx="32" cy="54" r="6" fill="${Lab.BONE}"/></svg><button class="sbtn" data-btn style="font-size:13px;padding:10px 18px">Subscribe</button></div></div>`);
      ctx.root.appendChild(wrap);
      const ball = wrap.querySelector('[data-ball]'), bell = wrap.querySelector('[data-bell]'), btn = wrap.querySelector('[data-btn]');
      const s = {};
      s.bounce = () => {
        if (s.bt) s.bt.kill();
        CustomBounce.create('labBounce', { strength: ctx.params.str, squash: ctx.params.sq, squashID: 'labBounce-squash' });
        const fall = () => ball.parentNode.offsetHeight - ball.offsetHeight;
        s.bt = gsap.timeline({ repeat: -1, repeatDelay: 0.6 }).fromTo(ball, { y: 0 }, { y: fall, duration: 2, ease: 'labBounce' }).fromTo(ball, { scaleX: 1, scaleY: 1 }, { scaleX: 1.45, scaleY: 0.6, duration: 2, ease: 'labBounce-squash' }, 0);
      };
      s.wiggle = () => {
        CustomWiggle.create('labWiggle', { wiggles: ctx.params.wn, type: ['easeOut', 'easeInOut', 'anticipate', 'uniform', 'random'][ctx.params.wt] });
        gsap.fromTo(bell, { rotation: 0 }, { rotation: 22, duration: 1.2, ease: 'labWiggle' });
        gsap.fromTo(btn, { x: 0 }, { x: 10, duration: 0.9, ease: 'labWiggle', delay: 0.15 });
      };
      ctx.on(bell, 'click', ctx.safe(s.wiggle));
      s.bounce(); s.wiggle();
      ctx.every(2.4, s.wiggle);
      return s;
    },
    onParam(ctx, s, k) { if (k === 'str' || k === 'sq') s.bounce(); else s.wiggle(); },
  });

  /* EasePack */
  Lab.register({
    id: 'easepack', title: 'EasePack: SlowMo, Rough, ExpoScale', category: 'Easing', thumb: 'portrait',
    hint: 'tune each EasePack ease',
    description: 'The three specialist eases in EasePack. SlowMo eases in, holds nearly still through the middle and eases out, which suits text that glides past. RoughEase adds controllable jitter for flicker, shake and glitch. ExpoScaleEase compensates for exponential change, so a zoom from 1× to 20× feels linear to the eye rather than racing at the end.',
    interact: [['SlowMo ratio / power', 'Width and strength of the slow middle'], ['Rough strength / points', 'Amount and frequency of jitter'], ['Watch the zoom', 'ExpoScaleEase vs a plain ease side by side']],
    features: ['SlowMo.ease.config(ratio, power, yoyo)', 'RoughEase.ease.config({ strength, points, taper, randomize })', 'ExpoScaleEase.config(start, end, ease)'],
    params: [
      { key: 'ratio', label: 'SlowMo linearRatio', type: 'range', min: 0.1, max: 0.95, step: 0.01, value: 0.7 },
      { key: 'power', label: 'SlowMo power', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.7 },
      { key: 'strength', label: 'Rough strength', type: 'range', min: 0.2, max: 4, step: 0.1, value: 1.5 },
      { key: 'points', label: 'Rough points', type: 'range', min: 5, max: 100, step: 1, value: 30 },
    ],
    code: `gsap.to(text, { x: 600, ease: 'slow(0.7, 0.7, false)' });
gsap.to(el, { opacity: 0.2, ease: 'rough({ strength: 1.5, points: 30, taper: "none", randomize: true })' });
gsap.fromTo(img, { scale: 1 }, { scale: 20, ease: 'expoScale(1, 20, power1.inOut)' });`,
    init(ctx) {
      const wrap = h(`<div style="position:absolute;inset:12% 8% 18%;display:grid;grid-template-rows:1fr 1fr 1.4fr;gap:4%">
        <div style="position:relative"><span class="tag">SlowMo</span><div data-slow style="position:absolute;left:0;top:45%;font-family:var(--serif);font-size:8cqmin;white-space:nowrap">glides <em>past</em></div></div>
        <div style="position:relative"><span class="tag">RoughEase</span><div data-rough style="position:absolute;left:0;top:40%;width:100%;height:4cqmin;background:linear-gradient(90deg,${Lab.ACC1},${Lab.ACC2})"></div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6%"><div style="position:relative;overflow:hidden;border:1px solid var(--rule-2)"><span class="tag" style="position:absolute;left:6px;top:4px;z-index:1">expoScale(1, 20)</span><div data-z1 class="center"><div style="width:2cqmin;height:2cqmin;background:repeating-conic-gradient(${Lab.ACC1} 0 25%,#060708 0 50%) 0 0/0.5cqmin 0.5cqmin"></div></div></div>
          <div style="position:relative;overflow:hidden;border:1px solid var(--rule-2)"><span class="tag" style="position:absolute;left:6px;top:4px;z-index:1">power1.inOut</span><div data-z2 class="center"><div style="width:2cqmin;height:2cqmin;background:repeating-conic-gradient(${Lab.ACC2} 0 25%,#060708 0 50%) 0 0/0.5cqmin 0.5cqmin"></div></div></div></div></div>`);
      ctx.root.appendChild(wrap);
      const slow = wrap.querySelector('[data-slow]'), rough = wrap.querySelector('[data-rough]'), z1 = wrap.querySelector('[data-z1] div'), z2 = wrap.querySelector('[data-z2] div');
      const s = {};
      s.build = () => {
        (s.anims || []).forEach((a) => a.kill());
        const p = ctx.params;
        s.anims = [
          gsap.fromTo(slow, { x: -ctx.width * 0.4 }, { x: ctx.width * 0.95, duration: 3.2, repeat: -1, ease: `slow(${p.ratio}, ${p.power}, false)` }),
          gsap.fromTo(rough, { opacity: 1, scaleX: 1 }, { opacity: 0.1, scaleX: 0.6, duration: 2, repeat: -1, yoyo: true, ease: `rough({ strength: ${p.strength}, points: ${Math.round(p.points)}, template: none.out, taper: none, randomize: true, clamp: false })` }),
          gsap.fromTo(z1, { scale: 1 }, { scale: 20, duration: 3, repeat: -1, yoyo: true, ease: 'expoScale(1, 20, power1.inOut)' }),
          gsap.fromTo(z2, { scale: 1 }, { scale: 20, duration: 3, repeat: -1, yoyo: true, ease: 'power1.inOut' }),
        ];
      };
      s.build();
      return s;
    },
    onParam(ctx, s) { s.build(); },
  });
})();
