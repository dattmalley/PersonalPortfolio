/* Group F — SVG: DrawSVG, MorphSVG, MotionPath (+ helper), attributes. */
(function () {
  const { h } = Lab;
  const SIG = 'M20,80 C40,20 60,20 70,60 S90,100 110,50 S140,10 150,60 C155,80 165,85 180,60 M195,30 L195,85 M205,55 C215,40 235,40 235,60 C235,80 215,82 205,70 M250,85 C255,50 265,35 275,45 C285,55 270,70 260,72 C280,70 295,80 300,60';

  /* DrawSVG */
  Lab.register({
    id: 'drawsvg', title: 'DrawSVG', category: 'SVG', thumb: 'wide',
    hint: 'drag the range handles · watch the stroke draw',
    description: 'DrawSVGPlugin animates the visible portion of any stroke, whether a path, line, circle or polyline, using values like "0% 100%" or a segment such as "40% 60%". The signature draws itself on a loop. The sliders set the start and end of a segment directly, and the comet travels along the outline as a moving "x% x+10%" window.',
    interact: [['Start / end', 'drawSVG: "start% end%"'], ['Watch', 'Line-art draw + travelling comet segment'], ['Replay', 'Redraw from 0%']],
    features: ['drawSVG: "0% 100%"', 'Segment values "40% 60%"', 'Works on path / circle / line / polyline', 'stagger across strokes'],
    params: [
      { key: 'a', label: 'segment start %', type: 'range', min: 0, max: 100, step: 1, value: 0 },
      { key: 'b', label: 'segment end %', type: 'range', min: 0, max: 100, step: 1, value: 100 },
      { key: 'replay', label: 'Replay draw', type: 'button' },
    ],
    code: `gsap.from('.sig path', { drawSVG: 0, duration: 2.4, ease: 'power1.inOut', stagger: 0.2 });
gsap.fromTo('.comet', { drawSVG: '0% 8%' }, { drawSVG: '92% 100%', repeat: -1, ease: 'none' });
gsap.set('.seg', { drawSVG: '40% 60%' });`,
    init(ctx) {
      const svg = h(`<svg viewBox="0 0 320 210" style="position:absolute;inset:10% 8% 18%;width:84%;height:72%">
        <path data-sig d="${SIG}" fill="none" stroke="${Lab.BONE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <rect data-out x="12" y="120" width="296" height="70" rx="14" fill="none" stroke="rgba(236,233,226,.15)" stroke-width="2"/>
        <rect data-comet x="12" y="120" width="296" height="70" rx="14" fill="none" stroke="${Lab.ACC2}" stroke-width="3" stroke-linecap="round"/>
        <circle data-seg cx="160" cy="155" r="24" fill="none" stroke="${Lab.ACC1}" stroke-width="5" stroke-linecap="round" transform="rotate(-90 160 155)"/></svg>`);
      ctx.root.appendChild(svg);
      const sig = svg.querySelector('[data-sig]'), seg = svg.querySelector('[data-seg]');
      const s = {};
      s.draw = () => gsap.fromTo(sig, { drawSVG: 0 }, { drawSVG: '100%', duration: 2.6, ease: 'power1.inOut' });
      s.seg = () => gsap.to(seg, { drawSVG: `${Math.min(ctx.params.a, ctx.params.b)}% ${Math.max(ctx.params.a, ctx.params.b)}%`, duration: 0.4 });
      gsap.fromTo(svg.querySelector('[data-comet]'), { drawSVG: '0% 10%' }, { drawSVG: '90% 100%', duration: 2.4, repeat: -1, ease: 'none' });
      s.draw(); s.seg();
      ctx.every(4, s.draw);
      return s;
    },
    onParam(ctx, s) { s.seg(); }, action(ctx, s) { s.draw(); },
  });

  /* MorphSVG */
  const SHAPES = {
    circle: 'M50,10 C72,10 90,28 90,50 C90,72 72,90 50,90 C28,90 10,72 10,50 C10,28 28,10 50,10 Z',
    star: 'M50,8 L61,38 L93,38 L67,57 L77,88 L50,69 L23,88 L33,57 L7,38 L39,38 Z',
    heart: 'M50,88 C20,66 8,48 8,32 C8,18 19,8 32,8 C40,8 47,13 50,20 C53,13 60,8 68,8 C81,8 92,18 92,32 C92,48 80,66 50,88 Z',
    bolt: 'M58,6 L22,54 L46,54 L38,94 L78,40 L54,40 Z',
    blob: 'M52,12 C74,10 92,30 88,54 C85,76 66,92 44,88 C22,84 8,64 12,42 C16,22 32,13 52,12 Z',
  };
  Lab.register({
    id: 'morphsvg', title: 'MorphSVG', category: 'SVG', thumb: 'square',
    hint: 'pick a target shape · try rotational type',
    description: 'MorphSVGPlugin morphs between any two shapes, even ones with different numbers of points, by mapping and subdividing their segments. shapeIndex: "auto" finds the start-point alignment with the least travel, and type: "rotational" interpolates angles and lengths rather than coordinates, which avoids kinks on complex morphs. Pick a shape, or let it cycle through them.',
    interact: [['Shape buttons', 'Morph to circle · star · heart · bolt · blob'], ['type', 'linear vs rotational'], ['Watch', 'Auto-cycling morph chain']],
    features: ['morphSVG: target', 'shapeIndex: "auto"', 'type: "rotational"', 'MorphSVGPlugin.convertToPath()', 'Mismatched point counts'],
    params: [{ key: 'type', label: 'type', type: 'select', options: ['linear', 'rotational'], value: 0 }],
    code: `gsap.to('#shape', { morphSVG: { shape: '#star', shapeIndex: 'auto', type: 'rotational' },
  duration: 1, ease: 'power2.inOut' });
MorphSVGPlugin.convertToPath('circle, rect, polygon');`,
    init(ctx) {
      const spinner = h('<div style="position:absolute;left:50%;top:44%;width:46cqmin;height:46cqmin;margin:-23cqmin 0 0 -23cqmin"></div>');
      const svg = h(`<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block"><defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${Lab.ACC1}"/><stop offset="1" stop-color="${Lab.ACC2}"/></linearGradient></defs><path data-m d="${SHAPES.circle}" fill="url(#mg)"/></svg>`);
      const bar = h(`<div class="bar">${Object.keys(SHAPES).map((k) => `<button class="sbtn" data-k="${k}">${k}</button>`).join('')}</div>`);
      spinner.appendChild(svg); ctx.root.append(spinner, bar);   // transform the wrapper, not the <svg> root
      const path = svg.querySelector('[data-m]');
      const keys = Object.keys(SHAPES);
      let cur = 0;
      const to = ctx.safe((k) => { cur = keys.indexOf(k); bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); gsap.to(path, { morphSVG: { shape: SHAPES[k], shapeIndex: 'auto', type: ['linear', 'rotational'][ctx.params.type] }, duration: 1, ease: 'power2.inOut' }); gsap.fromTo(spinner, { rotation: 0 }, { rotation: 360, duration: 1, ease: 'power2.inOut' }); });
      ctx.on(bar, 'click', (e) => { const b = e.target.closest('button'); if (b) to(b.dataset.k); });
      ctx.every(1.8, () => { if (!ctx.root.matches(':hover')) to(keys[(cur + 1) % keys.length]); });
      return {};
    },
  });

  /* MotionPath */
  Lab.register({
    id: 'motionpath', title: 'MotionPath', category: 'SVG', thumb: 'wide',
    hint: 'adjust start / end · autoRotate · followers',
    description: 'MotionPathPlugin moves any element, SVG or HTML, along a path. align locks it to the path\'s coordinate space, alignOrigin centres it, autoRotate turns it to face the direction of travel, and start/end use only part of the path. A stagger sends a convoy of followers along the same route at different offsets.',
    interact: [['start / end', 'Use part of the path'], ['autoRotate', 'Face the travel direction'], ['Followers', 'Staggered convoy']],
    features: ['motionPath: { path, align, alignOrigin }', 'autoRotate: true | degrees', 'start / end (0–1)', 'MotionPathPlugin.getRelativePosition()'],
    params: [
      { key: 'start', label: 'start', type: 'range', min: 0, max: 1, step: 0.01, value: 0, restart: true },
      { key: 'end', label: 'end', type: 'range', min: 0, max: 1, step: 0.01, value: 1, restart: true },
      { key: 'rot', label: 'autoRotate', type: 'toggle', value: true, restart: true },
    ],
    code: `gsap.to('.plane', { duration: 5, repeat: -1, ease: 'power1.inOut',
  motionPath: { path: '#route', align: '#route', alignOrigin: [0.5, 0.5],
                autoRotate: true, start: 0, end: 1 } });`,
    init(ctx) {
      const svg = h(`<svg viewBox="0 0 400 220" style="position:absolute;inset:12% 6% 18%;width:88%;height:70%"><path data-route d="M20,180 C80,20 160,20 200,110 S320,200 380,40" fill="none" stroke="rgba(236,233,226,.2)" stroke-width="2" stroke-dasharray="6 6"/>
        ${[0, 1, 2, 3, 4].map((i) => `<g data-f><polygon points="-12,-7 14,0 -12,7 -6,0" fill="${i === 0 ? Lab.BONE : i % 2 ? Lab.ACC2 : Lab.ACC1}"/></g>`).join('')}</svg>`);
      ctx.root.appendChild(svg);
      const route = svg.querySelector('[data-route]');
      gsap.to(svg.querySelectorAll('[data-f]'), { duration: 5, repeat: -1, ease: 'power1.inOut', stagger: { each: 0.25 }, motionPath: { path: route, align: route, alignOrigin: [0.5, 0.5], autoRotate: ctx.params.rot, start: Math.min(ctx.params.start, ctx.params.end), end: Math.max(ctx.params.start, ctx.params.end) } });
      return {};
    },
  });

  /* MotionPath editor (Draggable points + curviness) + MotionPathHelper */
  Lab.register({
    id: 'motionpath-editor', title: 'Motion Path Editor', category: 'SVG', thumb: 'portrait',
    hint: 'drag the points · change curviness · open MotionPathHelper',
    description: 'MotionPath can also run through an array of points, with curviness controlling how loosely the curve passes through them. Drag the points and the tween rebuilds live; the dashed curve is rendered from MotionPathPlugin.arrayToRawPath() so it matches the motion exactly. The button opens GSAP\'s own MotionPathHelper, its visual path editor, on the same tween.',
    interact: [['Drag points', 'Reshape the route (Draggable)'], ['curviness', '0 = straight lines · 2 = loose curves'], ['MotionPathHelper', 'GSAP\'s visual editor on this tween']],
    features: ['motionPath: { path: [{x,y}…], curviness }', 'MotionPathPlugin.arrayToRawPath() / rawPathToString()', 'MotionPathHelper.create()', 'Live tween rebuilding'],
    params: [
      { key: 'curv', label: 'curviness', type: 'range', min: 0, max: 2, step: 0.05, value: 1.2 },
      { key: 'helper', label: 'Open MotionPathHelper', type: 'button' },
    ],
    code: `gsap.to('.dot', { motionPath: { path: points, curviness: 1.2, autoRotate: true },
  duration: 4, repeat: -1, ease: 'none' });
const raw = MotionPathPlugin.arrayToRawPath(points, { curviness: 1.2 });
pathEl.setAttribute('d', MotionPathPlugin.rawPathToString(raw));
MotionPathHelper.create('.dot');   // drag-to-edit UI`,
    init(ctx) {
      const area = h(`<div style="position:absolute;inset:12% 8% 20%"><svg class="fill" style="width:100%;height:100%"><path data-p fill="none" stroke="rgba(47,224,122,.55)" stroke-width="2" stroke-dasharray="5 6"/></svg><div data-rider class="box b2" style="--s:6cqmin;position:absolute;left:0;top:0;margin:-3cqmin;border-radius:30%"></div></div>`);
      ctx.root.appendChild(area);
      const pathEl = area.querySelector('[data-p]'), rider = area.querySelector('[data-rider]');
      const W = () => area.offsetWidth, H = () => area.offsetHeight;
      let pts = [[0.05, 0.8], [0.25, 0.15], [0.5, 0.7], [0.72, 0.2], [0.95, 0.75]];
      const handles = pts.map(() => { const el = h(`<div style="position:absolute;left:0;top:0;width:18px;height:18px;margin:-9px;border-radius:50%;border:2px solid ${Lab.BONE};background:#060708;cursor:grab;z-index:2"></div>`); area.appendChild(el); return el; });
      let tw;
      const s = {};
      s.rebuild = () => {
        const P = pts.map(([x, y]) => ({ x: x * W(), y: y * H() }));
        pathEl.setAttribute('d', MotionPathPlugin.rawPathToString(MotionPathPlugin.arrayToRawPath(P, { curviness: ctx.params.curv })));
        const p = tw ? tw.progress() : 0;
        if (tw) tw.kill();
        tw = gsap.to(rider, { motionPath: { path: P, curviness: ctx.params.curv, autoRotate: true }, duration: 4, repeat: -1, ease: 'none' });
        tw.progress(p); s.tw = tw;
      };
      const place = () => handles.forEach((el, i) => gsap.set(el, { x: pts[i][0] * W(), y: pts[i][1] * H() }));
      handles.forEach((el, i) => Draggable.create(el, { bounds: area, onDrag() { pts[i] = [this.x / W(), this.y / H()]; s.rebuild(); } }));
      place(); s.rebuild();
      s.place = place;
      return s;
    },
    resize(ctx, s) { s.place(); s.rebuild(); },
    onParam(ctx, s) { s.rebuild(); },
    action(ctx, s) { try { if (s.helper) { s.helper.kill(); s.helper = null; } else s.helper = MotionPathHelper.create(s.tw); } catch (e) { ctx.message('MotionPathHelper: ' + e.message); setTimeout(() => ctx.message(''), 2400); } },
    dispose(ctx, s) { if (s.helper) s.helper.kill(); },
  });

  /* SVG attributes, origins, gradients, filters */
  Lab.register({
    id: 'svg-attrs', title: 'SVG Attributes & Origins', category: 'SVG', thumb: 'square',
    hint: 'click anywhere to set the svgOrigin pivot',
    description: 'GSAP animates raw SVG attributes through attr: circle radii, gradient stop colours, filter blur (stdDeviation) and even viewBox for pan-and-zoom. Two rotation origins are compared side by side: transformOrigin is relative to each element\'s own box, while svgOrigin is a point in the SVG\'s coordinate space shared by every element. Click to move the shared pivot; smoothOrigin stops it jumping.',
    interact: [['Click', 'Move the svgOrigin pivot (smoothOrigin)'], ['Watch', 'attr: r / stop-color / stdDeviation / viewBox tweens']],
    features: ['attr: { r, cx, "stop-color" }', 'Filter stdDeviation', 'viewBox animation', 'svgOrigin vs transformOrigin', 'smoothOrigin'],
    code: `gsap.to('circle', { attr: { r: 30 }, repeat: -1, yoyo: true });
gsap.to('stop', { attr: { 'stop-color': '#ffb224' } });
gsap.to('feGaussianBlur', { attr: { stdDeviation: 6 } });
gsap.to('.arm', { rotation: 360, svgOrigin: '200 120', smoothOrigin: true });`,
    init(ctx) {
      const svg = h(`<svg viewBox="0 0 400 240" style="position:absolute;inset:10% 6% 16%;width:88%;height:74%;cursor:crosshair">
        <defs><linearGradient id="sg"><stop data-s1 offset="0" stop-color="${Lab.ACC1}"/><stop data-s2 offset="1" stop-color="#4fb8ff"/></linearGradient><filter id="sb"><feGaussianBlur data-blur stdDeviation="0"/></filter></defs>
        <circle data-c cx="70" cy="70" r="20" fill="url(#sg)" filter="url(#sb)"/>
        <g data-arms>${[0, 1, 2, 3].map((i) => `<rect x="${170 + i * 18}" y="110" width="14" height="60" fill="${i % 2 ? Lab.ACC2 : Lab.BONE}"/>`).join('')}</g>
        <circle data-piv cx="200" cy="120" r="5" fill="#ff5a5a"/><text x="10" y="232" font-size="10" fill="#74757b" font-family="monospace">svgOrigin (shared pivot) · click to move</text></svg>`);
      ctx.root.appendChild(svg);
      const c = svg.querySelector('[data-c]'), arms = svg.querySelectorAll('[data-arms] rect'), piv = svg.querySelector('[data-piv]');
      gsap.to(c, { attr: { r: 44, cx: 90 }, duration: 1.4, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.to(svg.querySelector('[data-s1]'), { attr: { 'stop-color': Lab.ACC2 }, duration: 2, repeat: -1, yoyo: true });
      gsap.to(svg.querySelector('[data-blur]'), { attr: { stdDeviation: 5 }, duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      let spin = gsap.to(arms, { rotation: 360, svgOrigin: '200 120', duration: 4, repeat: -1, ease: 'none' });
      gsap.to(svg, { attr: { viewBox: '30 10 340 220' }, duration: 5, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      ctx.on(svg, 'click', ctx.safe((e) => {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        gsap.to(piv, { attr: { cx: p.x, cy: p.y }, duration: 0.4 });
        const r = gsap.getProperty(arms[0], 'rotation'); spin.kill();
        gsap.set(arms, { svgOrigin: `${p.x} ${p.y}`, smoothOrigin: true });
        spin = gsap.fromTo(arms, { rotation: r }, { rotation: r + 360, svgOrigin: `${p.x} ${p.y}`, duration: 4, repeat: -1, ease: 'none' });
      }));
      return {};
    },
  });
})();
