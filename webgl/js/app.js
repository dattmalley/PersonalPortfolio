/* WebGL2 Interaction Lab — application shell.
 * Views: #g-<group>  → masonry grid of study cards for that group
 *        #<demo-id>  → the full study (stage + spec sheet)
 *        ?capture=<id> → bare full-window render used to generate thumbnails */
(function () {
  'use strict';
  const S = window.Sandbox;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const GROUPS = [
    { name: 'Pointer & Touch', desc: 'Hover, press, drag, multi-touch, pen pressure and gestures: the ways a hand reaches into the canvas.' },
    { name: 'Camera & Navigation', desc: 'Orbiting, flying, walking, zooming without limit, and stepping into virtual reality.' },
    { name: 'Selection', desc: 'Picking, marquee and lasso selection, transform gizmos and building block by block.' },
    { name: 'Simulation', desc: 'Fluids, flocks and rigid bodies: motion that emerges from rules rather than keyframes.' },
    { name: 'GPU Motion', desc: 'Hundreds of thousands of moving things, simulated and drawn without the CPU touching them.' },
    { name: 'Animation', desc: 'Easing, morphing, skeletons, paths, transitions and scroll-driven storytelling.' },
    { name: 'Rendering', desc: 'Light, shadow, volume, HDR, texture filtering and the post-processing that finishes an image.' },
    { name: 'Performance', desc: 'Occlusion culling, GPU timers, and rendering off the main thread.' },
    { name: 'Sensors & Media', desc: 'Gyroscopes, microphones, cameras, screens, voices and MIDI as live inputs to the GPU.' },
  ];
  const GNAMES = GROUPS.map((g) => g.name);
  const LETTERS = 'ABCDEFGHIJ';
  const slug = (n) => n.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const demos = S.demos.slice().sort((a, b) => GNAMES.indexOf(a.category) - GNAMES.indexOf(b.category));
  const pad = (n) => String(n).padStart(2, '0');
  const numOf = (d) => pad(demos.indexOf(d) + 1);
  const gIndex = (d) => GNAMES.indexOf(d.category);
  const letterOf = (d) => LETTERS[gIndex(d)];
  const inGroup = (gi) => demos.filter((d) => d.category === GNAMES[gi]);
  const titleHTML = (t) => { const p = esc(t).split(' '); if (p.length < 2) return `<em>${p[0]}</em>`; const l = p.pop(); return `${p.join(' ')} <em>${l}</em>`; };
  const firstSentence = (t) => { const m = String(t || '').match(/^.*?[.!?](\s|$)/); return m ? m[0].trim() : t; };

  const params = new URLSearchParams(location.search);
  const CAPTURE = params.get('capture');
  if (CAPTURE) document.body.classList.add('capture');

  const canvas = $('gl');
  const stage = $('stage');
  const overlay = $('overlay');
  const message = $('message');
  const status = $('gl-status');

  /* ================================================================ */
  /* Group tabs (horizontally scrolling strip)                         */
  /* ================================================================ */
  const nav = $('groupnav');
  const scroller = $('gn-scroller');
  const track = $('gn-track');
  const indicator = $('gn-indicator');
  const tabs = [];
  GROUPS.forEach((g, gi) => {
    const n = inGroup(gi).length;
    const a = document.createElement('a');
    a.className = 'gn-tab group';
    a.href = '#g-' + slug(g.name);
    a.draggable = false;
    a.innerHTML = `<span class="gt-meta"><b>${LETTERS[gi]}</b><span>${pad(n)} ${n === 1 ? 'study' : 'studies'}</span></span><span class="gt-name">${esc(g.name)}</span>`;
    track.appendChild(a);
    tabs.push(a);
  });
  let activeGroup = 0;
  const contentX = (el) => el.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
  function updateEdges() {
    const max = scroller.scrollWidth - scroller.clientWidth;
    const l = scroller.scrollLeft > 2, r = scroller.scrollLeft < max - 2;
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
  function setActiveGroup(gi) {
    activeGroup = gi;
    tabs.forEach((a, i) => { a.classList.toggle('active', i === gi); a.toggleAttribute('aria-current', i === gi); });
    placeIndicator(); revealActive();
  }
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

  /* ================================================================ */
  /* Grid view: masonry of static-thumbnail cards                       */
  /* ================================================================ */
  const masonry = $('masonry');
  const SHAPES = { tall: '4 / 5', wide: '16 / 10', square: '1 / 1', portrait: '3 / 4' };
  const RHYTHM = ['tall', 'wide', 'square', 'wide', 'portrait', 'square', 'wide', 'tall'];
  const shapeOf = (d) => d.thumb || RHYTHM[demos.indexOf(d) % RHYTHM.length];
  const stacked = () => window.matchMedia('(orientation: portrait), (max-width: 640px), (max-height: 520px) and (pointer: coarse)').matches;

  function layoutMasonry() {
    const cards = masonry.querySelectorAll('.card');
    if (stacked()) { cards.forEach((c) => (c.style.gridRowEnd = '')); return; }
    const row = 4;
    cards.forEach((c) => {
      const h = c.getBoundingClientRect().height + 22; // + margin-bottom
      c.style.gridRowEnd = 'span ' + Math.ceil(h / row);
    });
  }
  new ResizeObserver(() => { if (document.body.classList.contains('mode-grid')) layoutMasonry(); }).observe(masonry);

  function renderGrid(gi) {
    const g = GROUPS[gi], list = inGroup(gi);
    $('gh-letter').textContent = LETTERS[gi];
    $('gh-index').textContent = `Group ${pad(gi + 1)} / ${pad(GROUPS.length)}`;
    $('gh-count').textContent = `${pad(list.length)} ${list.length === 1 ? 'study' : 'studies'}`;
    $('gh-title').innerHTML = titleHTML(g.name);
    $('gh-desc').textContent = g.desc;
    masonry.innerHTML = list.map((d, i) => `
      <a class="card" href="#${d.id}" style="--ar:${SHAPES[shapeOf(d)]};--i:${i}" aria-label="${esc(d.title)}">
        <div class="card-media">
          <div class="ph"></div>
          <img src="thumbs/${d.id}.jpg" alt="" loading="lazy" decoding="async" onerror="this.remove()">
          <span class="card-crop a"></span><span class="card-crop b"></span>
          <span class="card-num">${numOf(d)}</span>
        </div>
        <div class="card-body">
          <div class="card-kicker"><span>${LETTERS[gi]} · ${esc(g.name)}</span><span>${numOf(d)} / ${pad(demos.length)}</span></div>
          <h3>${titleHTML(d.title)}</h3>
          <p>${esc(d.summary || firstSentence(d.description))}</p>
          <ul class="card-tags">${(d.features || []).slice(0, 3).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <div class="card-cta"><span>${esc((d.hint || '').split('·')[0].trim() || 'Open study')}</span><i>Open →</i></div>
        </div>
      </a>`).join('');
    const prev = (gi - 1 + GROUPS.length) % GROUPS.length, next = (gi + 1) % GROUPS.length;
    $('gf-prev').href = '#g-' + slug(GNAMES[prev]); $('gf-prev').querySelector('span').textContent = '← ' + GNAMES[prev];
    $('gf-next').href = '#g-' + slug(GNAMES[next]); $('gf-next').querySelector('span').textContent = GNAMES[next] + ' →';
    document.title = `${g.name} · WebGL2 Interaction Lab`;
    requestAnimationFrame(layoutMasonry);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(layoutMasonry);
  }

  /* ================================================================ */
  /* WebGL2 context                                                    */
  /* ================================================================ */
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!CAPTURE });
  $('hud-total').textContent = pad(demos.length);
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const countWord = (n) => (n < 20 ? WORDS[n] : n < 100 ? ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(n / 10) - 2] + (n % 10 ? '-' + WORDS[n % 10] : '') : String(n));
  document.querySelector('.wm-sub').innerHTML = `WebGL&nbsp;2.0 / ${countWord(demos.length)} studies`;

  let caps = {};
  if (!gl) {
    status.classList.add('bad');
    status.lastElementChild.textContent = 'WebGL2 unavailable';
    message.hidden = false;
    message.textContent = 'This browser or device does not support WebGL 2.0.\nTry a current Chrome, Edge, Firefox or Safari (15+).';
  } else {
    status.classList.add('ok');
    status.lastElementChild.textContent = 'WebGL 2.0 live';
    caps = {
      floatRT: !!gl.getExtension('EXT_color_buffer_float'),
      floatLinear: !!gl.getExtension('OES_texture_float_linear'),
      maxSamples: gl.getParameter(gl.MAX_SAMPLES),
      maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rows = [
      ['Renderer', dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)],
      ['GLSL', gl.getParameter(gl.SHADING_LANGUAGE_VERSION)],
      ['Max texture', gl.getParameter(gl.MAX_TEXTURE_SIZE)],
      ['Max 3D texture', gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)],
      ['Array layers', gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)],
      ['Draw buffers', caps.maxDrawBuffers],
      ['MSAA samples', caps.maxSamples],
      ['Vertex attribs', gl.getParameter(gl.MAX_VERTEX_ATTRIBS)],
      ['UBO size', gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE)],
      ['TF components', gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS)],
      ['Float targets', caps.floatRT ? 'yes' : 'no'],
    ];
    $('caps').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  }

  /* ================================================================ */
  /* Demo state                                                        */
  /* ================================================================ */
  const input = S.createInput(canvas);
  let util = gl ? S.createUtil(gl) : null;
  let current = null, state = null, ctx = null;
  let paused = false, time = 0, last = performance.now();
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sync = new Map();

  function showMessage(text) { message.hidden = !text; message.textContent = text || ''; }

  function resize() {
    if (!gl) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return; // hidden (grid view)
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    if (ctx) {
      Object.assign(ctx, { width: w, height: h, cssWidth: r.width, cssHeight: r.height, dpr, aspect: w / h });
      if (current && current.resize && state) { try { current.resize(ctx, state); } catch (err) { fail(err); } }
    }
  }
  new ResizeObserver(resize).observe(stage);

  function fail(err) {
    console.error(err);
    state = null;
    showMessage('This study could not start on this device.\n\n' + (err && err.message ? err.message : String(err)));
  }

  function buildSheet(demo) {
    const sheet = document.querySelector('.sheet');
    sheet.classList.add('swap'); sheet.offsetWidth; sheet.classList.remove('swap');
    sheet.scrollTop = 0;
    $('info-num').textContent = numOf(demo);
    $('info-letter').textContent = letterOf(demo);
    $('info-cat').textContent = demo.category;
    $('info-title').innerHTML = titleHTML(demo.title);
    $('info-desc').textContent = demo.description || '';
    $('hud-num').textContent = numOf(demo);
    $('hud-title').textContent = demo.title;
    $('hud-hint').textContent = demo.hint || '';
    $('info-features').innerHTML = (demo.features || []).map((f) => `<li>${esc(f)}</li>`).join('');
    $('info-interact').innerHTML = (demo.interact || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    const i = demos.indexOf(demo);
    const prev = demos[(i - 1 + demos.length) % demos.length], next = demos[(i + 1) % demos.length];
    $('pg-prev').href = '#' + prev.id; $('pg-prev').querySelector('span').textContent = '← ' + prev.title;
    $('pg-next').href = '#' + next.id; $('pg-next').querySelector('span').textContent = next.title + ' →';
    $('crumb-back').href = '#g-' + slug(demo.category);
    $('crumb-group').textContent = `${letterOf(demo)} · ${demo.category}`;
    const list = inGroup(gIndex(demo));
    $('crumb-pos').textContent = `${pad(list.indexOf(demo) + 1)} of ${pad(list.length)} in group`;
    document.title = `${demo.title} · WebGL2 Interaction Lab`;
    buildControls(demo);
  }

  function buildControls(demo) {
    const box = $('controls');
    box.innerHTML = '';
    sync.clear();
    const ps = demo.params || [];
    if (!ps.length) { box.innerHTML = '<p class="empty">This study has no adjustable parameters.</p>'; return; }
    let actions = null;
    ps.forEach((p) => {
      if (p.type === 'button') {
        if (!actions) { actions = document.createElement('div'); actions.className = 'actions'; box.appendChild(actions); }
        const b = document.createElement('button');
        b.className = 'act'; b.type = 'button'; b.textContent = p.label;
        b.addEventListener('click', () => { if (current && current.action && state) current.action(ctx, state, p.key); });
        actions.appendChild(b);
        return;
      }
      actions = null;
      const wrap = document.createElement('div');
      wrap.className = 'ctl';
      const id = 'ctl-' + p.key;
      if (p.type === 'toggle') {
        wrap.innerHTML = `<label class="switch" for="${id}"><span>${esc(p.label)}</span><input id="${id}" type="checkbox" ${ctx.params[p.key] ? 'checked' : ''}></label>`;
        const el = wrap.querySelector('input');
        el.addEventListener('change', () => setParam(p, el.checked));
        sync.set(p.key, (v) => { el.checked = !!v; });
      } else if (p.type === 'select') {
        wrap.innerHTML = `<div class="ctl-head"><span>${esc(p.label)}</span></div><div class="seg" role="radiogroup" aria-label="${esc(p.label)}">${p.options.map((o, i) => `<button type="button" role="radio" data-i="${i}">${esc(o)}</button>`).join('')}</div>`;
        const btns = [...wrap.querySelectorAll('.seg button')];
        const mark = (v) => btns.forEach((b, i) => { b.classList.toggle('on', i === v); b.setAttribute('aria-checked', i === v); });
        mark(ctx.params[p.key]);
        btns.forEach((b, i) => b.addEventListener('click', () => { mark(i); setParam(p, i); }));
        sync.set(p.key, mark);
      } else {
        const fmt = (v) => (p.step >= 1 ? Math.round(v).toLocaleString() : (+v).toFixed(p.step < 0.01 ? 3 : 2));
        wrap.innerHTML = `<div class="ctl-head"><label for="${id}">${esc(p.label)}</label><output>${fmt(ctx.params[p.key])}</output></div><div class="range"><span class="ticks"></span><input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${ctx.params[p.key]}"></div>`;
        const el = wrap.querySelector('input'), out = wrap.querySelector('output'), rg = wrap.querySelector('.range');
        const paint = (v) => { out.textContent = fmt(v); rg.style.setProperty('--p', ((v - p.min) / (p.max - p.min)) * 100 + '%'); };
        paint(ctx.params[p.key]);
        el.addEventListener('input', () => { paint(+el.value); setParam(p, +el.value); });
        sync.set(p.key, (v) => { el.value = v; paint(v); });
      }
      box.appendChild(wrap);
    });
  }

  let restartTimer = 0;
  function setParam(p, v) {
    ctx.params[p.key] = v;
    if (p.restart) { clearTimeout(restartTimer); restartTimer = setTimeout(() => startDemo(current, true), 150); }
    else if (current.onParam && state) current.onParam(ctx, state, p.key, v);
  }

  function stopDemo() {
    if (current && current.dispose && state) { try { current.dispose(ctx, state); } catch (e) { console.warn(e); } }
    if (util) { util.disposeAll(); util = S.createUtil(gl); }
    overlay.innerHTML = '';
    canvas.style.cursor = '';
    state = null;
  }

  function startDemo(demo, keepParams = false) {
    if (!gl) return;
    const prevParams = keepParams && ctx ? ctx.params : null;
    const switching = demo !== current;
    stopDemo();
    current = demo;
    showMessage('');
    if (switching && !CAPTURE) { const scan = $('scan'); scan.classList.remove('run'); scan.offsetWidth; scan.classList.add('run'); }
    resize();
    const r = stage.getBoundingClientRect();
    const ps = {};
    (demo.params || []).forEach((p) => { if (p.type !== 'button') ps[p.key] = prevParams && p.key in prevParams ? prevParams[p.key] : p.value; });
    ctx = {
      gl, canvas, overlay, input, util, caps, params: ps, S, capture: !!CAPTURE,
      width: canvas.width, height: canvas.height, cssWidth: r.width, cssHeight: r.height,
      dpr, aspect: canvas.width / canvas.height, time: 0,
      message: showMessage,
      syncParam(key, v) { ps[key] = v; const f = sync.get(key); if (f) f(v); },
    };
    if (!keepParams) buildSheet(demo);
    S.resetGLState(gl, canvas.width, canvas.height);
    time = 0;
    try { state = demo.init(ctx) || {}; } catch (err) { fail(err); }
  }

  /* ================================================================ */
  /* Routing                                                           */
  /* ================================================================ */
  function route() {
    if (CAPTURE) return;
    const h = location.hash.replace('#', '');
    const d = demos.find((x) => x.id === h);
    if (d) {
      document.body.classList.remove('mode-grid'); document.body.classList.add('mode-demo');
      setActiveGroup(gIndex(d));
      window.scrollTo(0, 0);
      requestAnimationFrame(() => { if (d !== current || !state) startDemo(d); });
      return;
    }
    let gi = GROUPS.findIndex((g) => 'g-' + slug(g.name) === h);
    if (gi < 0) gi = current ? gIndex(current) : 0;
    stopDemo(); current = null;
    document.body.classList.remove('mode-demo'); document.body.classList.add('mode-grid');
    setActiveGroup(gi);
    renderGrid(gi);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => { if (document.body.classList.contains('mode-grid')) layoutMasonry(); });

  /* ================================================================ */
  /* Toolbar & keys                                                    */
  /* ================================================================ */
  const step = (n) => {
    if (document.body.classList.contains('mode-grid')) { location.hash = 'g-' + slug(GNAMES[(activeGroup + n + GROUPS.length) % GROUPS.length]); return; }
    const i = demos.indexOf(current); location.hash = demos[(i + n + demos.length) % demos.length].id;
  };
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('btn-reset').addEventListener('click', () => current && startDemo(current, true));
  const pauseBtn = $('btn-pause');
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.classList.toggle('on', paused);
    pauseBtn.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
    pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  });
  $('btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (current && current.captureKeys) return; // e.g. typing demos own the keyboard
    if (e.key === '[') step(-1);
    else if (e.key === ']') step(1);
    else if (e.key === 'Escape' && document.body.classList.contains('mode-demo') && !document.pointerLockElement && current) location.hash = 'g-' + slug(current.category);
  });

  if (gl) {
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state = null; showMessage('The GPU context was lost.\nWaiting for the browser to restore it…'); });
    canvas.addEventListener('webglcontextrestored', () => { util = S.createUtil(gl); if (current) startDemo(current, true); });
  }

  /* ================================================================ */
  /* HUD + loop                                                        */
  /* ================================================================ */
  const fpsEl = $('fps'), rdX = $('rd-x'), rdY = $('rd-y');
  const spark = $('spark'), sctx = spark.getContext('2d');
  const sparkDpr = Math.min(window.devicePixelRatio || 1, 2);
  spark.width = 72 * sparkDpr; spark.height = 18 * sparkDpr; sctx.scale(sparkDpr, sparkDpr);
  const frameTimes = new Array(48).fill(16.7);
  let fpsAcc = 0, fpsFrames = 0, hudTick = 0, captureFrames = 0;
  function drawSpark() {
    sctx.clearRect(0, 0, 72, 18);
    sctx.strokeStyle = 'rgba(236,233,226,0.12)';
    sctx.beginPath(); sctx.moveTo(0, 18 - 16.7 / 50 * 18 + 0.5); sctx.lineTo(72, 18 - 16.7 / 50 * 18 + 0.5); sctx.stroke();
    sctx.strokeStyle = '#3b8bff'; sctx.lineWidth = 1;
    sctx.beginPath();
    frameTimes.forEach((ft, i) => { const x = (i / (frameTimes.length - 1)) * 72, y = 18 - Math.min(ft, 50) / 50 * 17 - 0.5; i ? sctx.lineTo(x, y) : sctx.moveTo(x, y); });
    sctx.stroke();
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = now - last;
    const dt = Math.min(Math.max(raw, 0) / 1000, 0.05); // rAF timestamps can precede the last performance.now()
    last = now;
    if (!current) { input.endFrame(); return; }
    fpsAcc += dt; fpsFrames++;
    frameTimes.push(raw); frameTimes.shift();
    if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    if (++hudTick % 3 === 0) { rdX.textContent = input.uvx.toFixed(3); rdY.textContent = input.uvy.toFixed(3); drawSpark(); }
    input.update();
    if (CAPTURE) input.hover = input.down; // a resting pointer at (0,0) must not count as hover in thumbnails
    if (!paused && state && !gl.isContextLost()) {
      time += dt; ctx.time = time;
      try { current.frame(ctx, state, time, dt); } catch (err) { fail(err); }
      if (CAPTURE && ++captureFrames === 1) window.__captureStarted = true;
    }
    input.endFrame();
  }

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { placeIndicator(false); updateEdges(); revealActive(false); });
  updateEdges();
  if (CAPTURE) {
    const d = demos.find((x) => x.id === CAPTURE) || demos[0];
    document.body.classList.add('mode-demo');
    requestAnimationFrame(() => startDemo(d));
  } else route();
  window.__lab = { demos: demos.map((d) => ({ id: d.id, shape: shapeOf(d), category: d.category })) };
  requestAnimationFrame(frame);
})();
