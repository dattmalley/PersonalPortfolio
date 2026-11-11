/* WebGL2 Interaction Lab — application shell: navigation, controls, loop. */
(function () {
  'use strict';
  const S = window.Sandbox;
  const $ = (id) => document.getElementById(id);

  const CATEGORY_ORDER = ['Pointer & Touch', 'Camera & Navigation', 'Selection', 'GPU Motion', 'Animation', 'Rendering', 'Sensors'];
  const demos = S.demos.slice().sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  const canvas = $('gl');
  const stage = $('stage');
  const overlay = $('overlay');
  const message = $('message');
  const status = $('gl-status');

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });

  /* ---------------- navigation ---------------- */
  const nav = $('demo-nav');
  const navButtons = new Map();
  CATEGORY_ORDER.forEach((cat) => {
    const list = demos.filter((d) => d.category === cat);
    if (!list.length) return;
    const g = document.createElement('div');
    g.className = 'nav-group';
    g.innerHTML = `<h3>${cat}</h3>`;
    list.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'nav-item';
      b.type = 'button';
      b.innerHTML = `<span class="num">${String(demos.indexOf(d) + 1).padStart(2, '0')}</span><span>${d.title}</span>`;
      b.addEventListener('click', () => { location.hash = d.id; });
      b.dataset.search = (d.title + ' ' + d.category + ' ' + (d.features || []).join(' ')).toLowerCase();
      g.appendChild(b);
      navButtons.set(d.id, b);
    });
    nav.appendChild(g);
  });
  $('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    navButtons.forEach((b) => { b.hidden = q && !b.dataset.search.includes(q); });
    nav.querySelectorAll('.nav-group').forEach((g) => {
      g.hidden = ![...g.querySelectorAll('.nav-item')].some((b) => !b.hidden);
    });
  });

  if (!gl) {
    status.textContent = 'WebGL2 unavailable';
    status.classList.add('bad');
    message.hidden = false;
    message.textContent = 'This browser or device does not support WebGL 2.0. Try a current version of Chrome, Edge, Firefox or Safari (15+).';
    return;
  }
  status.textContent = 'WebGL2 ready';
  status.classList.add('ok');

  /* ---------------- capabilities ---------------- */
  const caps = {
    floatRT: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
  };
  (function fillCaps() {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rows = [
      ['Version', gl.getParameter(gl.VERSION)],
      ['GLSL', gl.getParameter(gl.SHADING_LANGUAGE_VERSION)],
      ['Renderer', dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)],
      ['Max texture', gl.getParameter(gl.MAX_TEXTURE_SIZE)],
      ['Max 3D texture', gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)],
      ['Max draw buffers', caps.maxDrawBuffers],
      ['Max MSAA samples', caps.maxSamples],
      ['Max vertex attribs', gl.getParameter(gl.MAX_VERTEX_ATTRIBS)],
      ['Max UBO size', gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE)],
      ['TF interleaved comps', gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS)],
      ['Float render targets', caps.floatRT ? 'yes' : 'no'],
    ];
    $('caps').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${String(v)}</dd>`).join('');
  })();

  /* ---------------- state ---------------- */
  const input = S.createInput(canvas);
  let util = S.createUtil(gl);
  let current = null;   // demo definition
  let state = null;     // demo runtime state
  let ctx = null;       // context passed to demo
  let paused = false;
  let time = 0;
  let last = performance.now();
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function showMessage(text) {
    message.hidden = !text;
    message.textContent = text || '';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    if (ctx) {
      Object.assign(ctx, { width: w, height: h, cssWidth: r.width, cssHeight: r.height, dpr, aspect: w / h });
      if (current && current.resize && state) {
        try { current.resize(ctx, state); } catch (err) { fail(err); }
      }
    }
  }
  new ResizeObserver(resize).observe(stage);

  function fail(err) {
    console.error(err);
    state = null;
    showMessage('This demo could not start on this device.\n\n' + (err && err.message ? err.message : String(err)));
  }

  /* ---------------- controls panel ---------------- */
  function buildPanel(demo) {
    $('info-cat').textContent = demo.category;
    $('info-title').textContent = demo.title;
    $('info-desc').textContent = demo.description || '';
    $('hud-title').textContent = demo.title;
    $('hud-hint').textContent = demo.hint || '';
    $('info-features').innerHTML = (demo.features || []).map((f) => `<span class="chip">${f}</span>`).join('');
    $('info-interact').innerHTML = (demo.interact || []).map(([k, v]) => `<li><kbd>${k}</kbd><span>${v}</span></li>`).join('');

    const box = $('controls');
    box.innerHTML = '';
    const params = demo.params || [];
    if (!params.length) { box.innerHTML = '<p class="empty">No adjustable parameters.</p>'; return; }
    let btnRow = null;
    params.forEach((p) => {
      if (p.type === 'button') {
        if (!btnRow) { btnRow = document.createElement('div'); btnRow.className = 'btn-row'; box.appendChild(btnRow); }
        const b = document.createElement('button');
        b.className = 'btn'; b.type = 'button'; b.textContent = p.label;
        b.addEventListener('click', () => { if (current && current.action && state) current.action(ctx, state, p.key); });
        btnRow.appendChild(b);
        return;
      }
      btnRow = null;
      const wrap = document.createElement('div');
      wrap.className = 'ctl';
      const id = 'ctl-' + p.key;
      if (p.type === 'toggle') {
        wrap.innerHTML = `<label class="toggle" for="${id}"><span>${p.label}</span><input id="${id}" type="checkbox" ${ctx.params[p.key] ? 'checked' : ''}></label>`;
        wrap.querySelector('input').addEventListener('change', (e) => setParam(p, e.target.checked));
      } else if (p.type === 'select') {
        wrap.innerHTML = `<label for="${id}">${p.label}</label><select id="${id}">${p.options.map((o, i) => `<option value="${i}" ${i === ctx.params[p.key] ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
        wrap.querySelector('select').addEventListener('change', (e) => setParam(p, +e.target.value));
      } else {
        const fmt = (v) => (p.step >= 1 ? Math.round(v).toLocaleString() : (+v).toFixed(p.step < 0.01 ? 3 : 2));
        wrap.innerHTML = `<label for="${id}"><span>${p.label}</span><output>${fmt(ctx.params[p.key])}</output></label><input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${ctx.params[p.key]}">`;
        const out = wrap.querySelector('output');
        wrap.querySelector('input').addEventListener('input', (e) => { out.textContent = fmt(e.target.value); setParam(p, +e.target.value); });
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

  /* ---------------- lifecycle ---------------- */
  function stopDemo() {
    if (current && current.dispose && state) { try { current.dispose(ctx, state); } catch (e) { console.warn(e); } }
    util.disposeAll();
    util = S.createUtil(gl);
    overlay.innerHTML = '';
    state = null;
  }

  function startDemo(demo, keepParams = false) {
    const prevParams = keepParams && ctx ? ctx.params : null;
    stopDemo();
    current = demo;
    showMessage('');
    navButtons.forEach((b, id) => b.classList.toggle('active', id === demo.id));
    const active = navButtons.get(demo.id);
    if (active && window.matchMedia('(max-width: 900px)').matches) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });

    const r = stage.getBoundingClientRect();
    const params = {};
    (demo.params || []).forEach((p) => { if (p.type !== 'button') params[p.key] = prevParams && p.key in prevParams ? prevParams[p.key] : p.value; });
    ctx = {
      gl, canvas, overlay, input, util, caps, params, S,
      width: canvas.width, height: canvas.height, cssWidth: r.width, cssHeight: r.height,
      dpr, aspect: canvas.width / canvas.height, time: 0,
      message: showMessage,
    };
    if (!keepParams) buildPanel(demo);
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

  /* ---------------- toolbar ---------------- */
  const step = (n) => {
    const i = demos.indexOf(current);
    location.hash = demos[(i + n + demos.length) % demos.length].id;
  };
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('btn-reset').addEventListener('click', () => startDemo(current, true));
  const pauseBtn = $('btn-pause');
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.classList.toggle('on', paused);
    pauseBtn.textContent = paused ? '▶' : '❚❚';
  });
  $('btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key === '[') step(-1);
    else if (e.key === ']') step(1);
  });

  /* ---------------- context loss ---------------- */
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    state = null;
    showMessage('The GPU context was lost. Waiting for the browser to restore it…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    util = S.createUtil(gl);
    startDemo(current, true);
  });

  /* ---------------- loop ---------------- */
  const fpsEl = $('fps');
  let fpsAcc = 0, fpsFrames = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
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
  requestAnimationFrame(frame);
})();
