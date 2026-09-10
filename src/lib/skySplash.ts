/* The sky time-lapse behind the loading screen, as plain script text
   the root layout inlines in <head>. It is script text rather than a
   module so the boot splash can start the sky the moment its markup
   is parsed — before any bundle loads, before React hydrates — from
   the inline starter BootSplash renders after itself. The route
   fallbacks and the live room call the same function from a React
   effect (components/LoadingScreen.tsx).

   window.__agoraSky(trails, heads, center, options) scatters a fresh
   sky over the whole screen and turns it about the centre, each star
   drawing its arc on the trails canvas (never cleared: each frame adds
   only the sliver turned since the last, in a handful of strokes with
   stars grouped by colour and size) behind a bright head on the heads
   canvas (redrawn every frame). It gathers speed over the first
   moments and then turns steadily until stopped, or until nobody can
   see it. The centre element gets `is-on` when the mark is due, on a
   timer of its own so it still arrives in a background tab. Returns
   { stop }. A canvas already running is left alone. */

export const SKY_SPLASH_JS = `
window.__agoraSky = function (trails, heads, center, o) {
  o = o || {};
  var SPEED = o.speed || 1.3, RAMP = o.ramp || 0.2, MARK_AT = o.markAt == null ? 1000 : o.markAt;
  var none = { stop: function () {} };
  if (!trails || !heads || trails.dataset.live) return none;
  var ctx = trails.getContext('2d'), hctx = heads.getContext('2d');
  if (!ctx || !hctx) return none;
  trails.dataset.live = '1';
  var stopped = false, raf = 0, markTimer = 0;
  var stop = function () {
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(markTimer);
    delete trails.dataset.live;
  };

  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var w = window.innerWidth, h = window.innerHeight;
  [[trails, ctx], [heads, hctx]].forEach(function (p) {
    p[0].width = Math.round(w * dpr);
    p[0].height = Math.round(h * dpr);
    p[1].setTransform(dpr, 0, 0, dpr, 0, 0);
    p[1].globalCompositeOperation = 'lighter';
  });
  var px = w / 2, py = h / 2;

  var COLOURS = [[200, 225, 255], [120, 170, 255], [255, 240, 214], [255, 183, 0]];
  var SIZES = [[0.7, 0.4], [1.2, 0.62], [1.9, 0.9]];
  var groups = [], key = {};
  var count = Math.max(220, Math.round(w * h * 0.00035));
  var m = Math.hypot(w, h) * 0.06;
  for (var i = 0; i < count; i++) {
    var x = -m + Math.random() * (w + 2 * m), y = -m + Math.random() * (h + 2 * m);
    var r = Math.hypot(x - px, y - py);
    if (r < 12) continue;
    var t = Math.random();
    var size = SIZES[t < 0.7 ? 0 : t < 0.94 ? 1 : 2];
    var c = Math.random();
    var col = COLOURS[c < 0.62 ? 0 : c < 0.84 ? 1 : c < 0.95 ? 2 : 3];
    var alpha = (size[1] * (Math.random() < 0.5 ? 0.72 : 1)).toFixed(2);
    var style = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha + ')';
    var k = style + '/' + size[0];
    var g = key[k];
    if (!g) { g = key[k] = { style: style, width: size[0], stars: [] }; groups.push(g); }
    g.stars.push({ r: r, a: Math.atan2(y - py, x - px) });
  }

  function sweep(from, to) {
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      ctx.beginPath();
      ctx.strokeStyle = g.style;
      ctx.lineWidth = g.width;
      for (var si = 0; si < g.stars.length; si++) {
        var s = g.stars[si], a0 = s.a + from;
        ctx.moveTo(px + s.r * Math.cos(a0), py + s.r * Math.sin(a0));
        ctx.arc(px, py, s.r, a0, s.a + to);
      }
      ctx.stroke();
    }
  }
  function drawHeads(theta) {
    hctx.clearRect(0, 0, w, h);
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi], rad = g.width * 0.9;
      hctx.beginPath();
      hctx.fillStyle = g.style;
      for (var si = 0; si < g.stars.length; si++) {
        var s = g.stars[si], a = s.a + theta;
        var x = px + s.r * Math.cos(a), y = py + s.r * Math.sin(a);
        hctx.moveTo(x + rad, y);
        hctx.arc(x, y, rad, 0, Math.PI * 2);
      }
      hctx.fill();
    }
  }
  function showMark() { if (center) center.classList.add('is-on'); }

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  sweep(0, 0.0001);
  drawHeads(0);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sweep(0, 0.9);
    drawHeads(0.9);
    showMark();
    return { stop: stop };
  }
  ctx.lineCap = 'butt';
  markTimer = setTimeout(showMark, MARK_AT);
  var t0 = 0, drawn = 0;
  function turned(s) { return SPEED * (s - RAMP + RAMP * Math.exp(-s / RAMP)); }
  function frame(now) {
    if (stopped || !trails.isConnected || trails.offsetWidth === 0) return;
    if (!t0) t0 = now;
    var theta = turned((now - t0) / 1000);
    if (theta > drawn) { sweep(drawn, theta); drawn = theta; drawHeads(theta); }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return { stop: stop };
};
`;

declare global {
  interface Window {
    __agoraSky?: (
      trails: HTMLCanvasElement,
      heads: HTMLCanvasElement,
      center: HTMLElement | null,
      options?: { speed?: number; ramp?: number; markAt?: number },
    ) => { stop: () => void };
  }
}
