/* WebGL2 Interaction Lab — application shell: grouped navigation, spec sheet,
 * controls, HUD and the render loop. */
(function () {
  'use strict';
  const S = window.Sandbox;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const GROUPS = ['Pointer & Touch', 'Camera & Navigation', 'Selection', 'GPU Motion', 'Animation', 'Rendering', 'Sensors'];
  const LETTERS = 'ABCDEFGHIJ';
  const demos = S.demos.slice().sort((a, b) => GROUPS.indexOf(a.category) - GROUPS.indexOf(b.category));
  const pad = (n) => String(n).padStart(2, '0');
  const numOf = (d) => pad(demos.indexOf(d) + 1);
  const letterOf = (d) => LETTERS[GROUPS.indexOf(d.category)];

  const canvas = $('gl');
  const stage = $('stage');
  const overlay = $('overlay');
  const message = $('message');
  const status = $('gl-status');

  /* ================================================================ */
  /* Grouped horizontal navigation                                     */
  /* ================================================================ */
  const nav = $('groupnav');
  const scroller = $('gn-scroller');
  const track = $('gn-track');
  const indicator = $('gn-indicator');
  const tabs = new Map();
  const groupEls = new Map();

  GROUPS.forEach((cat, gi) => {
    const list = demos.filter((d) => d.category === cat);
    if (!list.length) return;
    const g = document.createElement('section');
    g.className = 'gn-group';
    g.setAttribute('aria-label', cat);
    g.innerHTML = `<div class="gn-head"><span class="l">${LETTERS[gi]}</span><span>${esc(cat)}</span><span class="c">${pad(list.length)}</span></div><div class="gn-tabs"></div>`;
    const row = g.querySelector('.gn-tabs');
    list.forEach((d) => {
      const a = document.createElement('a');
      a.className = 'gn-tab';
      a.href = '#' + d.id;
      a.draggable = false;
      a.innerHTML = `<span class="n">${numOf(d)}</span><span>${esc(d.title)}</span>`;
      row.appendChild(a);
      tabs.set(d.id, a);
    });
    track.appendChild(g);
    groupEls.set(cat, g);
  });

  function updateEdges() {
    const max = scroller.scrollWidth - scroller.clientWidth;
    const l = scroller.scrollLeft > 2, r = scroller.scrollLeft < max - 2;
    nav.classList.toggle('can-left', l);
    nav.classList.toggle('can-right', r);
    nav.querySelector('.gn-left').disabled = !l;
    nav.querySelector('.gn-right').disabled = !r;
  }
  // Position of an element in the scroller's content coordinates (independent of offsetParent chains).
  const contentX = (el) => el.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
  function placeIndicator(animate = true) {
    const a = current && tabs.get(current.id);
    if (!a) return;
    if (!animate) indicator.style.transition = 'none';
    const x = contentX(a);
    const pad = 10;
    indicator.style.width = a.offsetWidth - pad * 2 + 'px';
    indicator.style.transform = `translateX(${x + pad}px)`;
    if (!animate) { indicator.offsetWidth; indicator.style.transition = ''; }
  }
  function revealActive(smooth = true) {
    const a = current && tabs.get(current.id);
    if (!a) return;
    const g = a.closest('.gn-group');
    // Prefer showing the whole group; fall back to centering the tab.
    const gl = contentX(g), gw = g.offsetWidth, vw = scroller.clientWidth;
    let target;
    if (gw <= vw - 80) {
      if (gl < scroller.scrollLeft + 40 || gl + gw > scroller.scrollLeft + vw - 40) target = gl - (vw - gw) / 2;
    } else {
      const ax = contentX(a);
      target = ax - (vw - a.offsetWidth) / 2;
    }
    if (target !== undefined) scroller.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  scroller.addEventListener('scroll', updateEdges, { passive: true });
  new ResizeObserver(() => { updateEdges(); placeIndicator(false); }).observe(scroller);
  nav.querySelector('.gn-left').addEventListener('click', () => scroller.scrollBy({ left: -scroller.clientWidth * 0.7, behavior: 'smooth' }));
  nav.querySelector('.gn-right').addEventListener('click', () => scroller.scrollBy({ left: scroller.clientWidth * 0.7, behavior: 'smooth' }));
  // Vertical wheel scrolls the strip horizontally (only when it actually overflows).
  scroller.addEventListener('wheel', (e) => {
    if (scroller.scrollWidth <= scroller.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    scroller.style.scrollBehavior = 'auto';
    scroller.scrollLeft += e.deltaY;
    scroller.style.scrollBehavior = '';
  }, { passive: false });
  // Mouse drag-to-scroll; a real drag suppresses the click that would follow.
  (function dragScroll() {
    let down = false, startX = 0, startL = 0, moved = 0;
    scroller.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; moved = 0; startX = e.clientX; startL = scroller.scrollLeft;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved > 4) { scroller.classList.add('dragging'); scroller.scrollLeft = startL - dx; }
    });
    window.addEventListener('pointerup', () => { down = false; setTimeout(() => scroller.classList.remove('dragging'), 0); });
    scroller.addEventListener('click', (e) => { if (moved > 4) { e.preventDefault(); e.stopPropagation(); } }, true);
  })();

  /* ================================================================ */
  /* WebGL2 context                                                    */
  /* ================================================================ */
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  $('hud-total').textContent = pad(demos.length);

  if (!gl) {
    status.classList.add('bad');
    status.lastElementChild.textContent = 'WebGL2 unavailable';
    message.hidden = false;
    message.textContent = 'This browser or device does not support WebGL 2.0.\nTry a current Chrome, Edge, Firefox or Safari (15+).';
    return;
  }
  status.classList.add('ok');
  status.lastElementChild.textContent = 'WebGL 2.0 live';

  const caps = {
    floatRT: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
  };
  (function fillCaps() {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rows = [
      ['Renderer', dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)],
      ['GLSL', gl.getParameter(gl.SHADING_LANGUAGE_VERSION)],
      ['Max texture', gl.getParameter(gl.MAX_TEXTURE_SIZE)],
      ['Max 3D texture', gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)],
      ['Draw buffers', caps.maxDrawBuffers],
      ['MSAA samples', caps.maxSamples],
      ['Vertex attribs', gl.getParameter(gl.MAX_VERTEX_ATTRIBS)],
      ['UBO size', gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE)],
      ['TF components', gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS)],
      ['Float targets', caps.floatRT ? 'yes' : 'no'],
    ];
    $('caps').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  })();

  /* ================================================================ */
  /* State                                                             */
  /* ================================================================ */
  const input = S.createInput(canvas);
  let util = S.createUtil(gl);
  let current = null, state = null, ctx = null;
  let paused = false, time = 0, last = performance.now();
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sync = new Map(); // param key → fn(value) that updates its control without firing it

  function showMessage(text) { message.hidden = !text; message.textContent = text || ''; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
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

  /* ================================================================ */
  /* Spec sheet                                                        */
  /* ================================================================ */
  const titleHTML = (t) => {
    const parts = esc(t).split(' ');
    if (parts.length < 2) return `<em>${parts[0]}</em>`;
    const lastWord = parts.pop();
    return `${parts.join(' ')} <em>${lastWord}</em>`;
  };

  function buildSheet(demo) {
    const sheet = document.querySelector('.sheet');
    sheet.classList.add('swap'); sheet.offsetWidth; sheet.classList.remove('swap'); // restart entrance animation
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
    document.title = `${demo.title} · WebGL2 Interaction Lab`;
    buildControls(demo);
  }

  function buildControls(demo) {
    const box = $('controls');
    box.innerHTML = '';
    sync.clear();
    const params = demo.params || [];
    if (!params.length) { box.innerHTML = '<p class="empty">This study has no adjustable parameters.</p>'; return; }
    let actions = null;
    params.forEach((p) => {
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
    if (p.restart) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => startDemo(current, true), 150);
    } else if (current.onParam && state) current.onParam(ctx, state, p.key, v);
  }

  /* ================================================================ */
  /* Lifecycle                                                         */
  /* ================================================================ */
  function stopDemo() {
    if (current && current.dispose && state) { try { current.dispose(ctx, state); } catch (e) { console.warn(e); } }
    util.disposeAll();
    util = S.createUtil(gl);
    overlay.innerHTML = '';
    state = null;
  }

  function startDemo(demo, keepParams = false) {
    const prevParams = keepParams && ctx ? ctx.params : null;
    const switching = demo !== current;
    stopDemo();
    current = demo;
    showMessage('');
    tabs.forEach((a, id) => { a.classList.toggle('active', id === demo.id); a.toggleAttribute('aria-current', id === demo.id); });
    groupEls.forEach((g, cat) => g.classList.toggle('active', cat === demo.category));
    placeIndicator();
    revealActive();

    if (switching) {
      const scan = $('scan');
      scan.classList.remove('run'); scan.offsetWidth; scan.classList.add('run');
    }

    const r = stage.getBoundingClientRect();
    const params = {};
    (demo.params || []).forEach((p) => { if (p.type !== 'button') params[p.key] = prevParams && p.key in prevParams ? prevParams[p.key] : p.value; });
    ctx = {
      gl, canvas, overlay, input, util, caps, params, S,
      width: canvas.width, height: canvas.height, cssWidth: r.width, cssHeight: r.height,
      dpr, aspect: canvas.width / canvas.height, time: 0,
      message: showMessage,
      /** Update a parameter from inside a demo and reflect it in the UI. */
      syncParam(key, v) { params[key] = v; const f = sync.get(key); if (f) f(v); },
    };
    if (!keepParams) buildSheet(demo);
    S.resetGLState(gl, canvas.width, canvas.height);
    time = 0;
    try { state = demo.init(ctx) || {}; } catch (err) { fail(err); }
  }

  function selectFromHash() {
    const id = location.hash.replace('#', '');
    const d = demos.find((x) => x.id === id) || demos[0];
    if (d !== current) startDemo(d);
  }
  window.addEventListener('hashchange', selectFromHash);

  /* ================================================================ */
  /* Toolbar & keys                                                    */
  /* ================================================================ */
  const step = (n) => { const i = demos.indexOf(current); location.hash = demos[(i + n + demos.length) % demos.length].id; };
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('btn-reset').addEventListener('click', () => startDemo(current, true));
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
    if (e.key === '[') step(-1);
    else if (e.key === ']') step(1);
  });

  /* ================================================================ */
  /* Context loss                                                      */
  /* ================================================================ */
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state = null; showMessage('The GPU context was lost.\nWaiting for the browser to restore it…'); });
  canvas.addEventListener('webglcontextrestored', () => { util = S.createUtil(gl); startDemo(current, true); });

  /* ================================================================ */
  /* HUD: pointer readout + frame-time sparkline                       */
  /* ================================================================ */
  const fpsEl = $('fps'), rdX = $('rd-x'), rdY = $('rd-y');
  const spark = $('spark'), sctx = spark.getContext('2d');
  const sparkDpr = Math.min(window.devicePixelRatio || 1, 2);
  spark.width = 72 * sparkDpr; spark.height = 18 * sparkDpr; sctx.scale(sparkDpr, sparkDpr);
  const frameTimes = new Array(48).fill(16.7);
  let fpsAcc = 0, fpsFrames = 0, hudTick = 0;
  function drawSpark() {
    sctx.clearRect(0, 0, 72, 18);
    sctx.strokeStyle = 'rgba(236,233,226,0.12)';
    sctx.beginPath(); sctx.moveTo(0, 18 - 16.7 / 50 * 18 + 0.5); sctx.lineTo(72, 18 - 16.7 / 50 * 18 + 0.5); sctx.stroke();
    sctx.strokeStyle = '#3b8bff'; sctx.lineWidth = 1;
    sctx.beginPath();
    frameTimes.forEach((ft, i) => {
      const x = (i / (frameTimes.length - 1)) * 72, y = 18 - Math.min(ft, 50) / 50 * 17 - 0.5;
      i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    });
    sctx.stroke();
  }

  /* ================================================================ */
  /* Loop                                                              */
  /* ================================================================ */
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = now - last;
    const dt = Math.min(raw / 1000, 0.05);
    last = now;
    fpsAcc += dt; fpsFrames++;
    frameTimes.push(raw); frameTimes.shift();
    if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    if (++hudTick % 3 === 0) {
      rdX.textContent = input.uvx.toFixed(3);
      rdY.textContent = input.uvy.toFixed(3);
      drawSpark();
    }
    input.update();
    if (!paused && state && current && !gl.isContextLost()) {
      time += dt;
      ctx.time = time;
      try { current.frame(ctx, state, time, dt); } catch (err) { fail(err); }
    }
    input.endFrame();
  }

  resize();
  selectFromHash();
  // fonts change tab widths: re-place the indicator once they are ready
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { placeIndicator(false); updateEdges(); revealActive(false); });
  updateEdges();
  requestAnimationFrame(frame);
})();
