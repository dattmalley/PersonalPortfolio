/* WebGL 1.0 Interaction Lab — application shell.
 * Views: #g-<group>  → masonry grid of study cards for that group
 *        #<demo-id>  → the full study (stage + spec sheet)
 *        ?capture=<id> → bare full-window render used to generate thumbnails */
(function () {
  'use strict';
  const S = window.Sandbox;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const GROUPS = [
    { name: 'Pipeline & Geometry', desc: 'Primitives, vertex attributes, buffers, indices, viewports and winding: every route a vertex takes on its way to becoming pixels.' },
    { name: 'GLSL ES 1.00', desc: 'The shading language of WebGL 1.0: live compilation, uniforms and structs, varyings, built-in variables, derivatives and fragment depth.' },
    { name: 'Textures', desc: 'Sources, formats, filtering, mipmaps, wrapping, cube maps, copies, pixel-store flags and multiple units: all the ways an image enters the GPU.' },
    { name: 'Framebuffers', desc: 'Rendering into textures and renderbuffers: depth and stencil attachments, depth textures, float targets, multiple render targets and readback.' },
    { name: 'Fragment Operations', desc: 'What happens after the fragment shader: blending, min and max, depth, polygon offset, stencil, colour masks and coverage.' },
    { name: 'Extensions & Performance', desc: 'Instancing, vertex array objects, GPU timers, multi-draw, parallel compilation and the full list of extensions this device reports.' },
    { name: 'Context & Canvas', desc: 'The context itself: creation attributes, loss and restore, limits and precision, readback and capture, colour spaces, workers and debug tools.' },
    { name: 'GPGPU & Simulation', desc: 'Computing on the GPU with textures as memory: cellular automata, reaction and diffusion, particles, waves and fluids.' },
    { name: 'Rendering Techniques', desc: 'Lighting, normal maps, shadows, reflections, bloom, outlines and ray marching, all built on WebGL 1.0 alone.' },
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

  /* ---- click-to-interact: the single GL stage moves into the live card ---- */
  let inline = null;
  const stageHome = { parent: null, next: null };
  const liveObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (inline && e.target === inline.media && e.intersectionRatio < 0.15) deactivateInline();
  }, { threshold: [0, 0.15, 0.5] });
  function activateInline(card) {
    if (!gl || (inline && inline.card === card)) return;
    deactivateInline();
    const d = demos.find((x) => x.id === card.dataset.id);
    if (!d) return;
    const media = card.querySelector('.card-media');
    stageHome.parent = stage.parentNode; stageHome.next = stage.nextSibling;
    media.appendChild(stage);
    stage.classList.add('inline');
    card.classList.add('live');
    inline = { card, media, d };
    liveObserver.observe(media);
    requestAnimationFrame(() => { if (inline && inline.d === d) { startDemo(d); canvas.focus({ preventScroll: true }); } });
  }
  function deactivateInline() {
    if (!inline) return;
    const g = gIndex(inline.d);
    liveObserver.unobserve(inline.media);
    stopDemo(); current = null;
    inline.card.classList.remove('live');
    stage.classList.remove('inline');
    if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
    if (stageHome.parent) stageHome.parent.insertBefore(stage, stageHome.next && stageHome.next.parentNode === stageHome.parent ? stageHome.next : null);
    inline = null;
    if (document.body.classList.contains('mode-grid')) document.title = `${GNAMES[g]} · WebGL 1.0 Interaction Lab`;
  }
  masonry.addEventListener('click', (e) => {
    const media = e.target.closest('.card-media');
    if (media && !media.closest('.card').classList.contains('live')) { e.preventDefault(); activateInline(media.closest('.card')); }
  });
  masonry.addEventListener('keydown', (e) => {
    const media = e.target.closest && e.target.closest('.card-media');
    if (media && (e.key === 'Enter' || e.key === ' ') && e.target === media) { e.preventDefault(); activateInline(media.closest('.card')); }
  });
  // any press outside the live card stops it
  document.addEventListener('pointerdown', (e) => { if (inline && !inline.card.contains(e.target)) deactivateInline(); }, true);

  function renderGrid(gi) {
    const g = GROUPS[gi], list = inGroup(gi);
    $('gh-letter').textContent = LETTERS[gi];
    $('gh-index').textContent = `Group ${pad(gi + 1)} / ${pad(GROUPS.length)}`;
    $('gh-count').textContent = `${pad(list.length)} ${list.length === 1 ? 'study' : 'studies'}`;
    $('gh-title').innerHTML = titleHTML(g.name);
    $('gh-desc').textContent = g.desc;
    deactivateInline();
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
    document.title = `${g.name} · WebGL 1.0 Interaction Lab`;
    requestAnimationFrame(layoutMasonry);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(layoutMasonry);
  }

  /* ================================================================ */
  /* WebGL2 context                                                    */
  /* ================================================================ */
  const glAttrs = { antialias: true, alpha: false, stencil: true, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!CAPTURE };
  const gl = canvas.getContext('webgl', glAttrs) || canvas.getContext('experimental-webgl', glAttrs);
  $('hud-total').textContent = pad(demos.length);
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const countWord = (n) => (n < 20 ? WORDS[n] : n < 100 ? ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(n / 10) - 2] + (n % 10 ? '-' + WORDS[n % 10] : '') : String(n));
  document.querySelector('.wm-sub').innerHTML = `WebGL&nbsp;1.0 / ${countWord(demos.length)} studies`;

  let caps = {};
  if (!gl) {
    status.classList.add('bad');
    status.lastElementChild.textContent = 'WebGL unavailable';
    message.hidden = false;
    message.textContent = 'This browser or device does not support WebGL.\nTry a current Chrome, Edge, Firefox or Safari.';
  } else {
    status.classList.add('ok');
    status.lastElementChild.textContent = 'WebGL 1.0 live';
    const exts = gl.getSupportedExtensions() || [];
    caps = {
      exts,
      floatTex: exts.includes('OES_texture_float'),
      halfTex: exts.includes('OES_texture_half_float'),
      instancing: exts.includes('ANGLE_instanced_arrays'),
      drawBuffers: exts.includes('WEBGL_draw_buffers'),
      depthTex: exts.includes('WEBGL_depth_texture'),
    };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const rows = [
      ['Renderer', dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)],
      ['Version', gl.getParameter(gl.VERSION)],
      ['GLSL', gl.getParameter(gl.SHADING_LANGUAGE_VERSION)],
      ['Max texture', gl.getParameter(gl.MAX_TEXTURE_SIZE)],
      ['Max cube map', gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE)],
      ['Texture units', gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) + ' frag / ' + gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) + ' vert'],
      ['Vertex attribs', gl.getParameter(gl.MAX_VERTEX_ATTRIBS)],
      ['Varying vectors', gl.getParameter(gl.MAX_VARYING_VECTORS)],
      ['Viewport', vp[0] + ' × ' + vp[1]],
      ['Float textures', caps.floatTex ? 'yes' : 'no'],
      ['Extensions', exts.length],
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
    document.title = `${demo.title} · WebGL 1.0 Interaction Lab`;
    const code = $('info-code');
    code.innerHTML = demo.code ? highlight(demo.code.trim()) : '';
    $('code-sect').hidden = !demo.code;
    buildControls(demo);
  }
  function highlight(src) {
    const e = esc(src);
    return e.split('\n').map((line) => {
      if (/^\s*#/.test(line)) return `<span class="d">${line}</span>`;
      const ci = line.indexOf('//');
      const code = ci >= 0 ? line.slice(0, ci) : line, com = ci >= 0 ? line.slice(ci) : '';
      return code
        .replace(/\b(attribute|varying|uniform|precision|highp|mediump|lowp|const|void|struct|if|else|for|return|discard|true|false|float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234]|sampler2D|samplerCube)\b/g, '<span class="k">$1</span>')
        .replace(/\b(gl_\w+|texture2D\w*|textureCube\w*|dFd[xy]|fwidth|gl\.\w+|ext\.\w+)/g, '<span class="s">$1</span>') + (com ? `<span class="c">${com}</span>` : '');
    }).join('\n');
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
      gl, canvas, overlay, input, util, caps, params: ps, S, capture: !!CAPTURE, ext: (n) => util.ext(n), attrs: glAttrs,
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
      deactivateInline();
      document.body.classList.remove('mode-grid'); document.body.classList.add('mode-demo');
      setActiveGroup(gIndex(d));
      window.scrollTo(0, 0);
      requestAnimationFrame(() => { if (d !== current || !state) startDemo(d); });
      return;
    }
    let gi = GROUPS.findIndex((g) => 'g-' + slug(g.name) === h);
    if (gi < 0) gi = current ? gIndex(current) : 0;
    deactivateInline();
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
  // Canvas output: PNG snapshot (shared on mobile when supported) and WebM recording.
  let wantShot = false, recorder = null;
  const saveBlob = (blob, name) => {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) { navigator.share({ files: [file], title: name }).catch(() => {}); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $('btn-shot').addEventListener('click', () => { wantShot = true; });
  const recBtn = $('btn-rec');
  recBtn.addEventListener('click', () => {
    if (recorder) { recorder.stop(); return; }
    if (!canvas.captureStream || !window.MediaRecorder) { showMessage('Recording is not supported in this browser.'); setTimeout(() => showMessage(''), 2200); return; }
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    recorder = new MediaRecorder(canvas.captureStream(60), type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => { saveBlob(new Blob(chunks, { type: recorder.mimeType }), `${current ? current.id : 'study'}.${(recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm'}`); recorder = null; recBtn.classList.remove('on'); };
    recorder.start(); recBtn.classList.add('on');
    setTimeout(() => recorder && recorder.state === 'recording' && recorder.stop(), 30000);
  });
  $('btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inline && !document.pointerLockElement) { deactivateInline(); return; }
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (current && current.captureKeys) return; // e.g. typing demos own the keyboard
    if (inline) return; // live cards keep the keyboard to themselves
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
    sctx.strokeStyle = '#ff4fa3'; sctx.lineWidth = 1;
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
      if (wantShot) { wantShot = false; const id = current.id; canvas.toBlob((b) => b && saveBlob(b, `${id}.png`), 'image/png'); } // same task as the draw, so the buffer is intact
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
