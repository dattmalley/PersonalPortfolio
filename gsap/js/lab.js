/* GSAP Lab — study registry + small helpers shared by every study. */
(function () {
  'use strict';
  const Lab = (window.Lab = { studies: [] });
  Lab.register = (s) => Lab.studies.push(s);

  // Register every plugin once.
  const plugins = ['ScrollTrigger', 'ScrollSmoother', 'ScrollToPlugin', 'Observer', 'Draggable', 'InertiaPlugin', 'Flip', 'MotionPathPlugin', 'MorphSVGPlugin', 'DrawSVGPlugin', 'SplitText', 'ScrambleTextPlugin', 'TextPlugin', 'Physics2DPlugin', 'PhysicsPropsPlugin', 'CustomEase', 'CustomBounce', 'CustomWiggle', 'EasePack', 'CSSRulePlugin', 'GSDevTools', 'PixiPlugin', 'EaselPlugin', 'MotionPathHelper'];
  const found = plugins.map((n) => window[n]).filter(Boolean);
  gsap.registerPlugin(...found);
  Lab.pluginCount = found.length;

  Lab.ACC1 = '#2fe07a';
  Lab.ACC2 = '#ffb224';
  Lab.BONE = '#ece9e2';
  Lab.INK = '#060708';

  /** html`...` → first element (or fragment) */
  Lab.h = function (html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
  };
  Lab.svg = function (markup, viewBox = '0 0 100 100', attrs = '') {
    return Lab.h(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${attrs}>${markup}</svg>`);
  };
  /** Lightweight syntax colouring for the code panel. */
  Lab.highlight = function (code) {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>')
      .replace(/('[^'\n]*'|"[^"\n]*"|`[^`]*`)/g, '<span class="s">$1</span>')
      .replace(/\b(gsap|ScrollTrigger|ScrollSmoother|Flip|Draggable|Observer|SplitText|CustomEase|CustomBounce|CustomWiggle|MotionPathHelper|InertiaPlugin|MorphSVGPlugin|GSDevTools|PIXI|createjs)\b/g, '<span class="k">$1</span>');
  };
})();
