/* Group G — Text: SplitText, ScrambleText, TextPlugin, kinetic type. */
(function () {
  const { h } = Lab;

  Lab.register({
    id: 'splittext', title: 'SplitText', category: 'Text', thumb: 'tall',
    hint: 'choose chars / words / lines · toggle masks',
    description: 'SplitText splits text into characters, words and lines, each wrapped in its own element ready to animate. mask clips every line or word, so pieces slide up out of nowhere. autoSplit re-splits on resize and after fonts load, and onSplit returns the animation to rebuild with it. revert() restores the original markup exactly.',
    interact: [['type', 'Animate chars, words or lines'], ['Mask', 'Clip each piece (mask: "lines")'], ['Replay', 'Run the reveal again']],
    features: ['new SplitText(el, { type })', 'mask: "lines" | "words" | "chars"', 'autoSplit + onSplit', 'split.revert()', 'aria: "auto" accessibility'],
    params: [
      { key: 'type', label: 'Animate', type: 'select', options: ['chars', 'words', 'lines'], value: 0 },
      { key: 'mask', label: 'Mask', type: 'toggle', value: true, restart: true },
      { key: 'replay', label: 'Replay', type: 'button' },
    ],
    code: `SplitText.create('.headline', { type: 'chars, words, lines', mask: 'lines', autoSplit: true,
  onSplit: (self) => gsap.from(self.chars, { yPercent: 110, rotation: 8, stagger: 0.02 }) });`,
    init(ctx) {
      const el = h('<h2 class="big" style="position:absolute;left:8%;right:8%;top:22%;font-size:clamp(22px,7.5cqmin,90px)">Every character, word and line is its own <em>element</em>.</h2>');
      ctx.root.appendChild(el);
      const s = {};
      s.split = SplitText.create(el, { type: 'chars, words, lines', mask: ctx.params.mask ? 'lines' : undefined, aria: 'auto' });
      s.play = () => {
        const key = ['chars', 'words', 'lines'][ctx.params.type], parts = s.split[key];
        gsap.killTweensOf([s.split.chars, s.split.words, s.split.lines]);
        gsap.set([s.split.chars, s.split.words, s.split.lines], { clearProps: 'transform,opacity,color' });   // keep SplitText's own inline-block styles
        gsap.from(parts, { yPercent: 110, opacity: ctx.params.mask ? 1 : 0, rotation: key === 'chars' ? 10 : 2, color: Lab.ACC1, duration: 0.9, ease: 'power4.out', stagger: key === 'chars' ? 0.018 : key === 'words' ? 0.06 : 0.14 });
      };
      s.play();
      ctx.every(3.4, s.play);
      return s;
    },
    onParam(ctx, s) { s.play(); }, action(ctx, s) { s.play(); },
    dispose(ctx, s) { s.split.revert(); },
  });

  Lab.register({
    id: 'scramble', title: 'ScrambleText', category: 'Text', thumb: 'wide',
    hint: 'hover the nav items · pick a character set',
    description: 'ScrambleTextPlugin replaces text with randomised characters and then resolves them into the target string. You choose the character set (upperCase, lowerCase, upperAndLowerCase, numbers or any custom string), revealDelay, speed and tweenLength. Hover the nav items for the familiar decode effect; the headline cycles through phrases.',
    interact: [['Hover a nav item', 'Decode on hover'], ['chars', 'Character set used while scrambling'], ['speed', 'How often characters change']],
    features: ['scrambleText: { text, chars }', 'chars: "upperCase" | "01" | custom', 'revealDelay / speed', 'tweenLength', 'newClass / oldClass'],
    params: [
      { key: 'chars', label: 'chars', type: 'select', options: ['upperCase', 'lowerCase', '01', '!<>-_\\/[]{}—=+*^?#'], value: 0 },
      { key: 'speed', label: 'speed', type: 'range', min: 0.1, max: 2, step: 0.05, value: 0.6 },
    ],
    code: `gsap.to('.title', { duration: 1.6, scrambleText: {
  text: 'DECODED', chars: 'upperCase', revealDelay: 0.4, speed: 0.6 } });`,
    init(ctx) {
      const phrases = ['ANIMATE ANYTHING', 'SCROLL. SCRUB. PIN.', 'DECODE ON HOVER', 'GSAP TEXT PLUGINS'];
      const head = h(`<h2 class="big" style="position:absolute;left:8%;right:8%;top:24%;font-family:var(--mono);font-size:clamp(18px,6cqmin,64px);letter-spacing:.04em;color:${Lab.ACC1}">${phrases[0]}</h2>`);
      const navEl = h(`<div style="position:absolute;left:8%;right:8%;top:56%;display:flex;gap:4cqmin;flex-wrap:wrap">${['WORK', 'STUDIO', 'JOURNAL', 'CONTACT'].map((n) => `<a data-n="${n}" style="font:500 clamp(12px,2.6cqmin,22px) var(--mono);letter-spacing:.14em;color:var(--text);cursor:pointer;border-bottom:1px solid var(--rule-3);padding-bottom:4px">${n}</a>`).join('')}</div>`);
      ctx.root.append(head, navEl);
      const charset = () => ['upperCase', 'lowerCase', '01', '!<>-_\\/[]{}—=+*^?#'][ctx.params.chars];
      navEl.querySelectorAll('a').forEach((a) => ctx.on(a, 'pointerenter', ctx.safe(() => gsap.to(a, { duration: 0.8, scrambleText: { text: a.dataset.n, chars: charset(), speed: ctx.params.speed, revealDelay: 0.1 }, color: Lab.ACC2, onComplete: () => gsap.to(a, { color: Lab.BONE, duration: 0.4 }) }))));
      let k = 0;
      const next = () => gsap.to(head, { duration: 1.8, scrambleText: { text: phrases[(k = (k + 1) % phrases.length)], chars: charset(), revealDelay: 0.5, speed: ctx.params.speed, tweenLength: true } });
      ctx.every(3, next);
      return {};
    },
  });

  Lab.register({
    id: 'textplugin', title: 'TextPlugin Typewriter', category: 'Text', thumb: 'square',
    hint: 'watch it type · switch to word mode',
    description: 'TextPlugin tweens an element\'s text from one string to another, character by character or word by word with delimiter: " ". It can wrap the new and old text in their own classes for styling, pad spaces, and with type: "diff" change only the characters that differ. Paired with a blinking caret it makes a typewriter.',
    interact: [['Mode', 'Characters or words (delimiter)'], ['diff', 'Only change differing characters'], ['Watch', 'Typing, deleting and retyping']],
    features: ['text: "new string"', 'delimiter: " "', 'newClass / oldClass', 'type: "diff"', 'padSpace'],
    params: [{ key: 'mode', label: 'Mode', type: 'select', options: ['characters', 'words', 'diff'], value: 0 }],
    code: `gsap.to('.out', { duration: 2, text: { value: 'Hello, timeline.', delimiter: '' }, ease: 'none' });
gsap.to('.out', { text: { value: 'One word at a time', delimiter: ' ' } });
gsap.to('.out', { text: { value: 'Hello world', type: 'diff' } });`,
    init(ctx) {
      const lines = ['Hello, timeline.', 'Tweens are just objects.', 'Animate anything you can reference.', 'Hello, ScrollTrigger.'];
      const box = h(`<div style="position:absolute;left:10%;right:10%;top:34%;font-family:var(--serif);font-size:clamp(20px,6.5cqmin,70px);line-height:1.15"><span data-out></span><span style="display:inline-block;width:0.06em;height:0.9em;background:${Lab.ACC1};margin-left:4px;vertical-align:-0.1em;animation:livepulse 1s steps(1) infinite"></span></div>`);
      ctx.root.appendChild(box);
      const out = box.querySelector('[data-out]');
      let k = 0;
      const type = () => {
        const v = lines[k++ % lines.length], m = ctx.params.mode;
        if (m === 2) return gsap.to(out, { duration: 1.4, text: { value: v, type: 'diff' }, ease: 'none' });
        gsap.timeline().to(out, { duration: 0.6, text: { value: '', delimiter: m === 1 ? ' ' : '' }, ease: 'none' }).to(out, { duration: m === 1 ? 1 : v.length * 0.05, text: { value: v, delimiter: m === 1 ? ' ' : '' }, ease: 'none' });
      };
      type();
      ctx.every(3.4, type);
      return {};
    },
  });

  Lab.register({
    id: 'kinetic', title: 'Kinetic Type', category: 'Text', thumb: 'wide',
    hint: 'move the pointer through the letters',
    description: 'Characters react to the pointer. SplitText breaks the word into characters, and each gets gsap.quickTo() setters for y, scale and colour so updates on every pointermove stay cheap. Each frame computes the distance from the pointer to each character and pushes them with a smooth falloff, while an idle stagger wave keeps the line alive when the pointer leaves.',
    interact: [['Move the pointer', 'Characters swell and lift near it'], ['Leave', 'An idle wave takes over']],
    features: ['SplitText chars', 'gsap.quickTo() per character', 'Distance-based falloff', 'Idle stagger yoyo wave'],
    code: `const split = SplitText.create('.word', { type: 'chars' });
const setters = split.chars.map((c) => ({ y: gsap.quickTo(c, 'y', { duration: 0.4 }),
  s: gsap.quickTo(c, 'scale', { duration: 0.4 }) }));
stage.addEventListener('pointermove', (e) => split.chars.forEach((c, i) => {
  const d = distance(e, c); setters[i].y(-falloff(d) * 40); setters[i].s(1 + falloff(d)); }));`,
    init(ctx) {
      const el = h(`<div style="position:absolute;inset:0;display:grid;place-items:center"><h2 class="big" style="font-size:clamp(28px,15cqmin,180px);white-space:nowrap">interaction</h2></div>`);
      ctx.root.appendChild(el);
      const word = el.querySelector('h2');
      const split = SplitText.create(word, { type: 'chars' });
      const set = split.chars.map((c) => { const sx = gsap.quickTo(c, 'scaleX', { duration: 0.45, ease: 'power3' }), sy = gsap.quickTo(c, 'scaleY', { duration: 0.45, ease: 'power3' }); return { y: gsap.quickTo(c, 'y', { duration: 0.45, ease: 'power3' }), s: (v) => { sx(v); sy(v); }, c }; });
      gsap.set(split.chars, { display: 'inline-block', transformOrigin: '50% 100%' });
      let idle = null;
      const startIdle = () => { idle = gsap.to(split.chars, { y: '-3cqmin', color: Lab.ACC1, duration: 0.6, ease: 'sine.inOut', stagger: { each: 0.08, repeat: -1, yoyo: true } }); };
      startIdle();
      ctx.on(ctx.root, 'pointermove', (e) => {
        if (idle) { idle.kill(); idle = null; gsap.to(split.chars, { color: Lab.BONE, duration: 0.3 }); }
        set.forEach(({ y, s, c }) => { const r = c.getBoundingClientRect(); const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); const f = Math.max(0, 1 - d / 220); y(-f * f * 60); s(1 + f * 0.7); c.style.color = f > 0.55 ? Lab.ACC1 : f > 0.25 ? Lab.ACC2 : ''; });
      });
      ctx.on(ctx.root, 'pointerleave', ctx.safe(() => { set.forEach(({ y, s }) => { y(0); s(1); }); split.chars.forEach((c) => (c.style.color = '')); ctx.later(0.4, startIdle); }));
      return { split };
    },
    dispose(ctx, s) { s.split.revert(); },
  });

  Lab.register({
    id: 'split-scroll', title: 'Scroll-Revealed Article', category: 'Text', thumb: 'portrait',
    hint: 'scroll the article',
    description: 'Editorial line reveals. Each paragraph is split into lines with masks, and a ScrollTrigger per paragraph slides its lines up out of the masks as it enters, with a scrubbed highlight tracking reading progress across the words. SplitText\'s autoSplit means a reflow re-splits the lines correctly rather than breaking the layout.',
    interact: [['Scroll', 'Lines rise out of their masks'], ['Watch', 'Words light up with scroll progress']],
    features: ['SplitText lines + mask', 'ScrollTrigger per paragraph', 'Scrubbed word highlighting', 'autoSplit for reflow'],
    code: `SplitText.create('p', { type: 'lines,words', mask: 'lines', autoSplit: true,
  onSplit: (self) => gsap.from(self.lines, { yPercent: 100, stagger: 0.1,
    scrollTrigger: { trigger: self.elements[0], scroller: sc, start: 'top 85%' } }) });`,
    init(ctx) {
      const paras = ['GSAP began as a way to animate anything a browser could reference, and it still does: CSS, SVG, canvas, WebGL and plain objects.', 'Timelines made sequencing a matter of placing tweens where they belong, rather than chaining callbacks and guessing at delays.', 'ScrollTrigger turned the scrollbar into a playhead, and every pinned, scrubbed section you have admired since leans on that idea.', 'Now every plugin is free. The only remaining question is what you will make move.'];
      const sc = h(`<div class="scroller"><div style="padding:30cqh 12% 50cqh;max-width:860px;margin:0 auto">${paras.map((p, i) => `<p data-p style="font-family:var(--serif);font-size:clamp(18px,5cqmin,44px);line-height:1.25;margin:0 0 14cqh;color:var(--text)">${i === 0 ? '<span class="accent">GSAP</span> ' : ''}${p}</p>`).join('')}</div></div>`);
      ctx.root.appendChild(sc);
      const splits = [];
      sc.querySelectorAll('[data-p]').forEach((p) => {
        const sp = SplitText.create(p, { type: 'lines,words', mask: 'lines' });
        splits.push(sp);
        gsap.from(sp.lines, { yPercent: 110, duration: 0.9, ease: 'power4.out', stagger: 0.1, scrollTrigger: { trigger: p, scroller: sc, start: 'top 85%', toggleActions: 'play none none reverse' } });
        gsap.fromTo(sp.words, { opacity: 0.25 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: p, scroller: sc, start: 'top 70%', end: 'bottom 40%', scrub: true } });
      });
      let user = false; ctx.on(sc, 'wheel', () => (user = true), { passive: true });
      const o = { p: 0 }; gsap.to(o, { p: 1, duration: 12, ease: 'sine.inOut', repeat: -1, yoyo: true, onUpdate: () => { if (!user) sc.scrollTop = o.p * (sc.scrollHeight - sc.clientHeight); } });
      return { splits };
    },
    dispose(ctx, s) { s.splits.forEach((x) => x.revert()); },
  });
})();
