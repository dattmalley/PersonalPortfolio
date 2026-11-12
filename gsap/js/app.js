/* GSAP Lab — application shell (shared design with the WebGL2 Interaction Lab).
 * Views: #g-<group> → masonry grid of study cards (click a thumbnail to make it live in place)
 *        #<id>      → full study (stage + spec sheet)
 *        ?capture=<id> → bare full-window render for thumbnails
 * Each study runs inside gsap.context(); leaving it calls revert(), which kills
 * every tween / timeline / ScrollTrigger / Draggable it made and restores inline styles. */
(function () {
  'use strict';
  const L = window.Lab;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const GROUPS = [
    { name: 'Tweens', desc: 'to, from, fromTo and set; transforms, CSS, staggers, keyframes, function values, repeats, controls and callbacks: the core of GSAP.' },
    { name: 'Timelines', desc: 'Sequencing with the position parameter, labels, nesting, scrubbing, the global timeline, the ticker and GSDevTools.' },
    { name: 'Easing', desc: 'Every built-in ease, CustomEase drawn by hand, CustomBounce, CustomWiggle and the EasePack eases.' },
    { name: 'Scroll', desc: 'ScrollTrigger, its scrub, pin, snap, batch and horizontal modes; ScrollSmoother, ScrollTo and Observer.' },
    { name: 'Drag & Flip', desc: 'Draggable in every mode, Inertia throws and velocity tracking, and Flip layout animation.' },
    { name: 'SVG', desc: 'DrawSVG, MorphSVG, MotionPath and its live path editor, and animating SVG attributes, origins and gradients.' },
    { name: 'Text', desc: 'SplitText characters, words and lines with masks; ScrambleText, TextPlugin and kinetic type.' },
    { name: 'Physics & Render', desc: 'Physics2D, PhysicsProps, and GSAP driving canvas, WebGL, PixiJS and EaselJS.' },
    { name: 'Utilities & Patterns', desc: 'The gsap.utils toolbox, matchMedia and reduced motion, quickTo cursors, effects, and real UI micro-interactions.' },
  ];
  const GNAMES = GROUPS.map((g) => g.name);
  const LETTERS = 'ABCDEFGHIJ';
  const slug = (n) => n.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const demos = L.studies.slice().sort((a, b) => GNAMES.indexOf(a.category) - GNAMES.indexOf(b.category));
  const pad = (n) => String(n).padStart(2, '0');
  const numOf = (d) => pad(demos.indexOf(d) + 1);
  const gIndex = (d) => GNAMES.indexOf(d.category);
  const letterOf = (d) => LETTERS[gIndex(d)];
  const inGroup = (gi) => demos.filter((d) => d.category === GNAMES[gi]);
  const titleHTML = (t) => { const p = esc(t).split(' '); if (p.length < 2) return `<em>${p[0]}</em>`; const l = p.pop(); return `${p.join(' ')} <em>${l}</em>`; };
  const firstSentence = (t) => { const m = String(t || '').match(/^.*?[.!?](\s|$)/); return m ? m[0].trim() : t; };

  const CAPTURE = new URLSearchParams(location.search).get('capture');
  if (CAPTURE) document.body.classList.add('capture');

  const stage = $('stage'), root = $('root'), message = $('message');
  $('gsap-ver').textContent = gsap.version;
  $('lib-status').lastElementChild.textContent = `GSAP ${gsap.version} · ${L.pluginCount} plugins`;

  /* ---------------- group tabs ---------------- */
  const nav = $('groupnav'), scroller = $('gn-scroller'), track = $('gn-track'), indicator = $('gn-indicator');
  const tabs = [];
  GROUPS.forEach((g, gi) => {
    const n = inGroup(gi).length;
    const a = document.createElement('a');
    a.className = 'gn-tab group'; a.href = '#g-' + slug(g.name); a.draggable = false;
    a.innerHTML = `<span class="gt-meta"><b>${LETTERS[gi]}</b><span>${pad(n)} ${n === 1 ? 'study' : 'studies'}</span></span><span class="gt-name">${esc(g.name)}</span>`;
    track.appendChild(a); tabs.push(a);
  });
  let activeGroup = 0;
  const contentX = (el) => el.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
  function updateEdges() {
    const max = scroller.scrollWidth - scroller.clientWidth, l = scroller.scrollLeft > 2, r = scroller.scrollLeft < max - 2;
    nav.classList.toggle('can-left', l); nav.classList.toggle('can-right', r);
    nav.querySelector('.gn-left').disabled = !l; nav.querySelector('.gn-right').disabled = !r;
  }
  function placeIndicator(animate = true) {
    const a = tabs[activeGroup]; if (!a) return;
    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = a.offsetWidth - 44 + 'px';
    indicator.style.transform = `translateX(${contentX(a) + 22}px)`;
    if (!animate) { indicator.offsetWidth; indicator.style.transition = ''; }
  }
  function revealActive(smooth = true) {
    const a = tabs[activeGroup]; if (!a) return;
    const x = contentX(a), w = a.offsetWidth, vw = scroller.clientWidth;
    if (x < scroller.scrollLeft + 48 || x + w > scroller.scrollLeft + vw - 48) scroller.scrollTo({ left: Math.max(0, x - (vw - w) / 2), behavior: smooth ? 'smooth' : 'auto' });
  }
  function setActiveGroup(gi) { activeGroup = gi; tabs.forEach((a, i) => { a.classList.toggle('active', i === gi); a.toggleAttribute('aria-current', i === gi); }); placeIndicator(); revealActive(); }
  scroller.addEventListener('scroll', updateEdges, { passive: true });
  new ResizeObserver(() => { updateEdges(); placeIndicator(false); }).observe(scroller);
  nav.querySelector('.gn-left').addEventListener('click', () => scroller.scrollBy({ left: -scroller.clientWidth * 0.7, behavior: 'smooth' }));
  nav.querySelector('.gn-right').addEventListener('click', () => scroller.scrollBy({ left: scroller.clientWidth * 0.7, behavior: 'smooth' }));
  scroller.addEventListener('wheel', (e) => {
    if (scroller.scrollWidth <= scroller.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault(); scroller.style.scrollBehavior = 'auto'; scroller.scrollLeft += e.deltaY; scroller.style.scrollBehavior = '';
  }, { passive: false });
  (function dragScroll() {
    let down = false, startX = 0, startL = 0, moved = 0;
    scroller.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; down = true; moved = 0; startX = e.clientX; startL = scroller.scrollLeft; });
    window.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - startX; moved = Math.max(moved, Math.abs(dx)); if (moved > 4) { scroller.classList.add('dragging'); scroller.scrollLeft = startL - dx; } });
    window.addEventListener('pointerup', () => { down = false; setTimeout(() => scroller.classList.remove('dragging'), 0); });
    scroller.addEventListener('click', (e) => { if (moved > 4) { e.preventDefault(); e.stopPropagation(); } }, true);
  })();

  /* ---------------- masonry grid + click-to-interact ---------------- */
  const masonry = $('masonry');
  const SHAPES = { tall: '4 / 5', wide: '16 / 10', square: '1 / 1', portrait: '3 / 4' };
  const RHYTHM = ['tall', 'wide', 'square', 'wide', 'portrait', 'square', 'wide', 'tall'];
  const shapeOf = (d) => d.thumb || RHYTHM[demos.indexOf(d) % RHYTHM.length];
  const stacked = () => matchMedia('(orientation: portrait), (max-width: 640px), (max-height: 520px) and (pointer: coarse)').matches;
  function layoutMasonry() {
    const cards = masonry.querySelectorAll('.card');
    if (stacked()) { cards.forEach((c) => (c.style.gridRowEnd = '')); return; }
    cards.forEach((c) => { c.style.gridRowEnd = 'span ' + Math.ceil((c.getBoundingClientRect().height + 22) / 4); });
  }
  new ResizeObserver(() => { if (document.body.classList.contains('mode-grid')) layoutMasonry(); }).observe(masonry);

  let inline = null;
  const stageHome = { parent: null, next: null };
  const liveObs = new IntersectionObserver((es) => { for (const e of es) if (inline && e.target === inline.media && e.intersectionRatio < 0.15) deactivateInline(); }, { threshold: [0, 0.15, 0.5] });
  function activateInline(card) {
    if (inline && inline.card === card) return;
    deactivateInline();
    const d = demos.find((x) => x.id === card.dataset.id); if (!d) return;
    const media = card.querySelector('.card-media');
    stageHome.parent = stage.parentNode; stageHome.next = stage.nextSibling;
    media.appendChild(stage); stage.classList.add('inline'); card.classList.add('live');
    inline = { card, media, d };
    liveObs.observe(media);
    requestAnimationFrame(() => { if (inline && inline.d === d) startDemo(d); });
  }
  function deactivateInline() {
    if (!inline) return;
    const g = gIndex(inline.d);
    liveObs.unobserve(inline.media);
    stopDemo(); current = null;
    inline.card.classList.remove('live'); stage.classList.remove('inline');
    if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
    if (stageHome.parent) stageHome.parent.insertBefore(stage, stageHome.next && stageHome.next.parentNode === stageHome.parent ? stageHome.next : null);
    inline = null;
    if (document.body.classList.contains('mode-grid')) document.title = `${GNAMES[g]} · GSAP Lab`;
  }
  masonry.addEventListener('click', (e) => {
    const media = e.target.closest('.card-media');
    if (media && !media.closest('.card').classList.contains('live')) { e.preventDefault(); activateInline(media.closest('.card')); }
  });
  masonry.addEventListener('keydown', (e) => {
    const media = e.target.closest && e.target.closest('.card-media');
    if (media && e.target === media && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activateInline(media.closest('.card')); }
  });
  document.addEventListener('pointerdown', (e) => { if (inline && !inline.card.contains(e.target)) deactivateInline(); }, true);

  function renderGrid(gi) {
    deactivateInline();
    const g = GROUPS[gi], list = inGroup(gi);
    $('gh-letter').textContent = LETTERS[gi];
    $('gh-index').textContent = `Group ${pad(gi + 1)} / ${pad(GROUPS.length)}`;
    $('gh-count').textContent = `${pad(list.length)} ${list.length === 1 ? 'study' : 'studies'}`;
    $('gh-title').innerHTML = titleHTML(g.name);
    $('gh-desc').textContent = g.desc;
    masonry.innerHTML = list.map((d, i) => `
      <article class="card" data-id="${d.id}" style="--ar:${SHAPES[shapeOf(d)]};--i:${i}">
        <div class="card-media" role="button" tabindex="0" aria-label="Interact with ${esc(d.title)} here">
          <div class="ph"></div>
          <img src="thumbs/${d.id}.jpg" alt="" loading="lazy" decoding="async" onerror="this.remove()">
          <span class="card-crop a"></span><span class="card-crop b"></span>
          <span class="card-num">${numOf(d)}</span>
          <span class="card-play"><i></i>Click to interact</span>
        </div>
        <a class="card-body" href="#${d.id}" aria-label="Open ${esc(d.title)} full study">
          <div class="card-live"><i></i>Live · click outside or press Esc to stop</div>
          <div class="card-kicker"><span>${LETTERS[gi]} · ${esc(g.name)}</span><span>${numOf(d)} / ${pad(demos.length)}</span></div>
          <h3>${titleHTML(d.title)}</h3>
          <p>${esc(d.summary || firstSentence(d.description))}</p>
          <ul class="card-tags">${(d.features || []).slice(0, 3).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <div class="card-cta"><span>${esc((d.hint || '').split('·')[0].trim() || 'Open study')}</span><i>Open full study →</i></div>
        </a>
      </article>`).join('');
    const prev = (gi - 1 + GROUPS.length) % GROUPS.length, next = (gi + 1) % GROUPS.length;
    $('gf-prev').href = '#g-' + slug(GNAMES[prev]); $('gf-prev').querySelector('span').textContent = '← ' + GNAMES[prev];
    $('gf-next').href = '#g-' + slug(GNAMES[next]); $('gf-next').querySelector('span').textContent = GNAMES[next] + ' →';
    document.title = `${g.name} · GSAP Lab`;
    requestAnimationFrame(layoutMasonry);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(layoutMasonry);
  }

  /* ---------------- study lifecycle ---------------- */
  $('hud-total').textContent = pad(demos.length);
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const countWord = (n) => (n < 20 ? WORDS[n] : ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(n / 10) - 2] + (n % 10 ? '-' + WORDS[n % 10] : ''));
  document.querySelector('.wm-sub').innerHTML = `GSAP ${gsap.version} / ${countWord(demos.length)} studies`;

  let current = null, state = null, ctx = null, paused = false, sync = new Map();
  function showMessage(t) { message.hidden = !t; message.textContent = t || ''; }
  function fail(err) { console.error(err); showMessage('This study could not start.\n\n' + (err && err.message ? err.message : String(err))); }

  function buildSheet(d) {
    const sheet = document.querySelector('.sheet');
    sheet.classList.add('swap'); sheet.offsetWidth; sheet.classList.remove('swap'); sheet.scrollTop = 0;
    $('info-num').textContent = numOf(d); $('info-letter').textContent = letterOf(d); $('info-cat').textContent = d.category;
    $('info-title').innerHTML = titleHTML(d.title); $('info-desc').textContent = d.description || '';
    $('hud-num').textContent = numOf(d); $('hud-title').textContent = d.title; $('hud-hint').textContent = d.hint || '';
    $('info-features').innerHTML = (d.features || []).map((f) => `<li>${esc(f)}</li>`).join('');
    $('info-interact').innerHTML = (d.interact || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('info-code').innerHTML = d.code ? L.highlight(d.code.trim()) : '<span class="c">// see the study source</span>';
    const i = demos.indexOf(d), prev = demos[(i - 1 + demos.length) % demos.length], next = demos[(i + 1) % demos.length];
    $('pg-prev').href = '#' + prev.id; $('pg-prev').querySelector('span').textContent = '← ' + prev.title;
    $('pg-next').href = '#' + next.id; $('pg-next').querySelector('span').textContent = next.title + ' →';
    $('crumb-back').href = '#g-' + slug(d.category); $('crumb-group').textContent = `${letterOf(d)} · ${d.category}`;
    const list = inGroup(gIndex(d)); $('crumb-pos').textContent = `${pad(list.indexOf(d) + 1)} of ${pad(list.length)} in group`;
    document.title = `${d.title} · GSAP Lab`;
    buildControls(d);
  }
  function buildControls(d) {
    const box = $('controls'); box.innerHTML = ''; sync.clear();
    const ps = d.params || [];
    if (!ps.length) { box.innerHTML = '<p class="empty">This study has no adjustable parameters.</p>'; return; }
    let actions = null;
    ps.forEach((p) => {
      if (p.type === 'button') {
        if (!actions) { actions = document.createElement('div'); actions.className = 'actions'; box.appendChild(actions); }
        const b = document.createElement('button'); b.className = 'act'; b.type = 'button'; b.textContent = p.label;
        b.addEventListener('click', () => { if (current && current.action && state) ctx.gc.add(() => current.action(ctx, state, p.key)); });
        actions.appendChild(b); return;
      }
      actions = null;
      const wrap = document.createElement('div'); wrap.className = 'ctl'; const id = 'ctl-' + p.key;
      if (p.type === 'toggle') {
        wrap.innerHTML = `<label class="switch" for="${id}"><span>${esc(p.label)}</span><input id="${id}" type="checkbox" ${ctx.params[p.key] ? 'checked' : ''}></label>`;
        const el = wrap.querySelector('input'); el.addEventListener('change', () => setParam(p, el.checked)); sync.set(p.key, (v) => { el.checked = !!v; });
      } else if (p.type === 'select') {
        wrap.innerHTML = `<div class="ctl-head"><span>${esc(p.label)}</span></div><div class="seg" role="radiogroup" aria-label="${esc(p.label)}">${p.options.map((o, i) => `<button type="button" role="radio" data-i="${i}">${esc(o)}</button>`).join('')}</div>`;
        const btns = [...wrap.querySelectorAll('.seg button')];
        const mark = (v) => btns.forEach((b, i) => { b.classList.toggle('on', i === v); b.setAttribute('aria-checked', i === v); });
        mark(ctx.params[p.key]); btns.forEach((b, i) => b.addEventListener('click', () => { mark(i); setParam(p, i); })); sync.set(p.key, mark);
      } else {
        const fmt = (v) => (p.step >= 1 ? Math.round(v).toLocaleString() : (+v).toFixed(p.step < 0.01 ? 3 : 2));
        wrap.innerHTML = `<div class="ctl-head"><label for="${id}">${esc(p.label)}</label><output>${fmt(ctx.params[p.key])}</output></div><div class="range"><span class="ticks"></span><input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${ctx.params[p.key]}"></div>`;
        const el = wrap.querySelector('input'), out = wrap.querySelector('output'), rg = wrap.querySelector('.range');
        const paint = (v) => { out.textContent = fmt(v); rg.style.setProperty('--p', ((v - p.min) / (p.max - p.min)) * 100 + '%'); };
        paint(ctx.params[p.key]); el.addEventListener('input', () => { paint(+el.value); setParam(p, +el.value); }); sync.set(p.key, (v) => { el.value = v; paint(v); });
      }
      box.appendChild(wrap);
    });
  }
  let restartTimer = 0;
  function setParam(p, v) {
    ctx.params[p.key] = v;
    if (p.restart) { clearTimeout(restartTimer); restartTimer = setTimeout(() => startDemo(current, true), 120); }
    else if (current.onParam && state) ctx.gc.add(() => current.onParam(ctx, state, p.key, v));
  }

  function stopDemo() {
    if (current && ctx) {
      // order matters: revert the context first (it renders tweens back to their start, which
      // must happen while the study's objects still exist), then let the study dispose them
      ctx.dead = true;
      ctx.offs.forEach((f) => f());
      try { ctx.gc.revert(); } catch (e) { console.warn(e); }
      try { if (current.dispose && state) current.dispose(ctx, state); } catch (e) { console.warn(e); }
      // stragglers created inside event callbacks (outside any context) still target study DOM: sweep them
      gsap.killTweensOf(root.querySelectorAll('*'));
      ctx.ro.disconnect();
    }
    root.innerHTML = ''; root.className = 'root'; root.removeAttribute('style');
    state = null;
  }
  function startDemo(d, keepParams = false) {
    const prev = keepParams && ctx ? ctx.params : null;
    const switching = d !== current;
    stopDemo(); current = d; showMessage('');
    if (paused) { gsap.globalTimeline.resume(); paused = false; setPauseIcon(); }
    if (switching && !CAPTURE) { const scan = $('scan'); scan.classList.remove('run'); scan.offsetWidth; scan.classList.add('run'); }
    const ps = {};
    (d.params || []).forEach((p) => { if (p.type !== 'button') ps[p.key] = prev && p.key in prev ? prev[p.key] : p.value; });
    const r = root.getBoundingClientRect();
    ctx = {
      root, params: ps, capture: !!CAPTURE, width: r.width, height: r.height, time: 0,
      offs: [], message: showMessage, Lab: L,
      on(t, type, fn, opts) { t.addEventListener(type, fn, opts); this.offs.push(() => t.removeEventListener(type, fn, opts)); },
      // context-safe wrapper for handlers/callbacks: anything they create is reverted with the study
      safe(fn) { return (...a) => { if (ctx.dead) return; let r; ctx.gc.add(() => { r = fn(...a); }); return r; }; },
      // repeating call owned by the context (never leaks past the study)
      every(sec, fn) { let tl; ctx.gc.add(() => { tl = gsap.timeline({ repeat: -1 }).call(() => { if (!ctx.dead) ctx.gc.add(fn); }, null, sec); }); return tl; },
      later(sec, fn) { let dc; ctx.gc.add(() => { dc = gsap.delayedCall(sec, () => { if (!ctx.dead) ctx.gc.add(fn); }); }); return dc; },
      syncParam(k, v) { ps[k] = v; const f = sync.get(k); if (f) f(v); },
    };
    ctx.ro = new ResizeObserver(() => {
      const rr = root.getBoundingClientRect(); ctx.width = rr.width; ctx.height = rr.height;
      if (current && current.resize && state) ctx.gc.add(() => current.resize(ctx, state));
      if (window.ScrollTrigger) ScrollTrigger.refresh();
    });
    ctx.ro.observe(root);
    if (!keepParams) buildSheet(d);
    ctx.gc = gsap.context(() => {}, root);
    try { ctx.gc.add(() => { state = d.init(ctx) || {}; }); } catch (err) { fail(err); }
    if (window.ScrollTrigger) requestAnimationFrame(() => ScrollTrigger.refresh());
  }

  /* ---------------- routing ---------------- */
  function route() {
    if (CAPTURE) return;
    const h = location.hash.replace('#', '');
    const d = demos.find((x) => x.id === h);
    if (d) {
      deactivateInline();
      document.body.classList.remove('mode-grid'); document.body.classList.add('mode-demo');
      setActiveGroup(gIndex(d)); window.scrollTo(0, 0);
      requestAnimationFrame(() => { if (d !== current || !state) startDemo(d); });
      return;
    }
    let gi = GROUPS.findIndex((g) => 'g-' + slug(g.name) === h);
    if (gi < 0) gi = current ? gIndex(current) : 0;
    deactivateInline(); stopDemo(); current = null;
    document.body.classList.remove('mode-demo'); document.body.classList.add('mode-grid');
    setActiveGroup(gi); renderGrid(gi); window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => { if (document.body.classList.contains('mode-grid')) layoutMasonry(); });

  /* ---------------- toolbar & keys ---------------- */
  const step = (n) => {
    if (document.body.classList.contains('mode-grid')) { location.hash = 'g-' + slug(GNAMES[(activeGroup + n + GROUPS.length) % GROUPS.length]); return; }
    const i = demos.indexOf(current); location.hash = demos[(i + n + demos.length) % demos.length].id;
  };
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('btn-reset').addEventListener('click', () => current && startDemo(current, true));
  const pauseBtn = $('btn-pause');
  const setPauseIcon = () => { pauseBtn.classList.toggle('on', paused); pauseBtn.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause'); };
  pauseBtn.addEventListener('click', () => { paused = !paused; paused ? gsap.globalTimeline.pause() : gsap.globalTimeline.resume(); setPauseIcon(); });
  $('btn-full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {}); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inline) { deactivateInline(); return; }
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || (e.target && e.target.isContentEditable)) return;
    if (current && current.captureKeys) return;
    if (inline) return;
    if (e.key === '[') step(-1); else if (e.key === ']') step(1);
    else if (e.key === 'Escape' && document.body.classList.contains('mode-demo') && current) location.hash = 'g-' + slug(current.category);
  });

  /* ---------------- HUD: fps from gsap.ticker ---------------- */
  const fpsEl = $('fps'), spark = $('spark'), sctx = spark.getContext('2d');
  const sd = Math.min(devicePixelRatio || 1, 2); spark.width = 72 * sd; spark.height = 18 * sd; sctx.scale(sd, sd);
  const ft = new Array(48).fill(16.7); let acc = 0, frames = 0, tick = 0, t0 = performance.now();
  gsap.ticker.add((time, deltaTime) => {
    if (!current) return;
    ft.push(deltaTime); ft.shift(); acc += deltaTime; frames++;
    if (acc > 500) { fpsEl.textContent = Math.round((frames * 1000) / acc); acc = 0; frames = 0; }
    if (++tick % 3 === 0) {
      sctx.clearRect(0, 0, 72, 18); sctx.strokeStyle = '#ffb224'; sctx.beginPath();
      ft.forEach((v, i) => { const x = (i / 47) * 72, y = 18 - Math.min(v, 50) / 50 * 17 - 0.5; i ? sctx.lineTo(x, y) : sctx.moveTo(x, y); }); sctx.stroke();
    }
    if (current.frame && state && !paused) { const dt = Math.min(deltaTime / 1000, 0.05); ctx.time += dt; try { current.frame(ctx, state, ctx.time, dt); } catch (err) { fail(err); current = null; } }
  });
  void t0;

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { placeIndicator(false); updateEdges(); revealActive(false); });
  updateEdges();
  if (CAPTURE) { const d = demos.find((x) => x.id === CAPTURE) || demos[0]; document.body.classList.add('mode-demo'); requestAnimationFrame(() => startDemo(d)); }
  else route();
  window.__lab = { demos: demos.map((d) => ({ id: d.id, shape: shapeOf(d), category: d.category })) };
})();
