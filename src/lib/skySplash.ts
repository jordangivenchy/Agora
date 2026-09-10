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
   canvas (redrawn every frame). The clock starts at the first frame
   the browser paints — not when the script runs, which can be well
   before anything is on screen — so the screen opens with still stars
   and turns from there, gathering speed over the first moments and
   then turning steadily until stopped, or until nobody can see it.
   The centre element gets `is-on` a second after that first frame.
   Returns { stop, elapsed }. A canvas already running is left alone.

   Skies hand over to each other: a route's fallback gives way to the
   page's own loading state, and both show the sky. So the scatter and
   the clock belong to the session (window.__agoraSkySession): a sky
   started within a beat of the last one stopping — a hand-off, not a
   new arrival — draws the same stars at the angle they have reached,
   with the mark already up if it was due, and turns on from there.
   Anything later opens a fresh, still sky and turns from rest.

   The sky settles into the page rather than fading to black: when the
   last sky of a session is about to go, window.__agoraSkySettle()
   freezes it where it stands and hands the stars — the session's
   scatter at the angle reached — to the page's starfield
   (components/Starfield.tsx), which draws the same stars in the same
   places while the splash and its trails fade over them.

   The sky is the site's opening: the boot splash shows it on the
   first document of a browser session and hides itself at parse time on
   every later one (components/BootSplash.tsx). A full page load inside
   a session gets the thin bar at the top instead: window.__agoraLeave()
   drops it the moment a same-origin link is clicked (the click listener
   below; the hero's Watch Live calls it directly) and the next document
   takes over from there. */

export const SKY_SPLASH_JS = `
/* The session's scatter: the same stars for every sky in it, and for
   the page's starfield once they settle. Polar about the centre, with
   the tier's line width and a colour at a fixed alpha. */
window.__agoraSkyScatter = function (seed, w, h) {
  var rnd = (function (a) {
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })(seed);
  var COLOURS = [[200, 225, 255], [120, 170, 255], [255, 240, 214], [255, 183, 0]];
  var SIZES = [[0.7, 0.4], [1.2, 0.62], [1.9, 0.9]];
  var px = w / 2, py = h / 2;
  var count = Math.max(220, Math.round(w * h * 0.00035));
  var m = Math.hypot(w, h) * 0.06;
  var stars = [];
  for (var i = 0; i < count; i++) {
    var x = -m + rnd() * (w + 2 * m), y = -m + rnd() * (h + 2 * m);
    var r = Math.hypot(x - px, y - py);
    if (r < 12) continue;
    var t = rnd();
    var size = SIZES[t < 0.7 ? 0 : t < 0.94 ? 1 : 2];
    var c = rnd();
    var col = COLOURS[c < 0.62 ? 0 : c < 0.84 ? 1 : c < 0.95 ? 2 : 3];
    var alpha = +(size[1] * (rnd() < 0.5 ? 0.72 : 1)).toFixed(2);
    stars.push({ r: r, a: Math.atan2(y - py, x - px), w: size[0], col: col, alpha: alpha });
  }
  return stars;
};
/* How far a session's sky has turned after s seconds: gathering speed
   over the first moments, then steady. */
window.__agoraSkyTurned = function (S, s) {
  var R = S.ramp;
  return S.speed * (s - R + R * Math.exp(-s / R));
};

window.__agoraSky = function (trails, heads, center, o) {
  o = o || {};
  var MARK_AT = o.markAt == null ? 1000 : o.markAt;
  var none = { stop: function () {}, elapsed: 0 };
  if (!trails || !heads || trails.dataset.live) return none;
  var ctx = trails.getContext('2d'), hctx = heads.getContext('2d');
  if (!ctx || !hctx) return none;
  trails.dataset.live = '1';

  // 1.5x is plenty for thin trails, and a third fewer pixels to clear
  // and stroke each frame than the full 2x.
  var dpr = Math.min(1.5, window.devicePixelRatio || 1);
  var w = window.innerWidth, h = window.innerHeight;
  var now0 = performance.now();
  var S = window.__agoraSkySession;
  // Continue the session while another sky is live (a page's own loading
  // screen under the boot splash, a fallback under the chrome's overlay)
  // or within a beat of the last one stopping; a settled session is
  // over, and anything after it is a fresh sky.
  var handoff = S && S.frozen == null && S.w === w && S.h === h && (S.live > 0 || (S.lastStop && now0 - S.lastStop <= 400));
  if (!handoff) {
    S = window.__agoraSkySession = {
      seed: (Math.random() * 4294967296) >>> 0, start: null, w: w, h: h, lastStop: 0, live: 0,
      speed: o.speed || 1.3, ramp: o.ramp || 0.2, stars: null, frozen: null, reduced: false, leaving: 0,
    };
  }
  S.live++;
  window.__agoraSkyLiveCount = (window.__agoraSkyLiveCount || 0) + 1;
  var elapsed0 = S.start == null ? 0 : now0 - S.start;

  var stopped = false, raf = 0, markTimer = 0, counted = true;
  var retire = function () {
    if (!counted) return;
    counted = false;
    S.live = Math.max(0, S.live - 1);
    window.__agoraSkyLiveCount = Math.max(0, (window.__agoraSkyLiveCount || 1) - 1);
    S.lastStop = performance.now();
    delete trails.dataset.live;
  };
  var stop = function () {
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(markTimer);
    delete trails.dataset.live;
    retire();
  };
  [[trails, ctx], [heads, hctx]].forEach(function (p) {
    p[0].width = Math.round(w * dpr);
    p[0].height = Math.round(h * dpr);
    p[1].setTransform(dpr, 0, 0, dpr, 0, 0);
    p[1].globalCompositeOperation = 'lighter';
  });
  var px = w / 2, py = h / 2;

  // The session's stars, grouped by colour and width for stroking.
  var stars = S.stars || (S.stars = window.__agoraSkyScatter(S.seed, w, h));
  var groups = [], key = {};
  for (var i = 0; i < stars.length; i++) {
    var st = stars[i];
    var style = 'rgba(' + st.col[0] + ',' + st.col[1] + ',' + st.col[2] + ',' + st.alpha + ')';
    var k = style + '/' + st.w;
    var g = key[k];
    if (!g) { g = key[k] = { style: style, width: st.w, stars: [] }; groups.push(g); }
    g.stars.push(st);
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
  // Heads for the two brighter tiers only — the faint ones read as
  // trail tips anyway, and they are seven in ten of the stars.
  function drawHeads(theta) {
    hctx.clearRect(0, 0, w, h);
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi], rad = g.width * 0.9;
      if (g.width < 1) continue;
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
  function showMark(atOnce) {
    if (!center) return;
    if (atOnce) center.classList.add('is-still');
    center.classList.add('is-on');
  }
  function turned(s) { return window.__agoraSkyTurned(S, s); }

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  sweep(0, 0.0001);
  // Reduced motion: the still sky, stars as points, the mark at once.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    S.reduced = true;
    drawHeads(0);
    showMark(true);
    return { stop: stop, elapsed: elapsed0 };
  }
  ctx.lineCap = 'butt';
  // The sky as it stands, if this continues an earlier one.
  var drawn = turned(elapsed0 / 1000);
  if (drawn > 0) sweep(0, drawn);
  drawHeads(drawn);
  if (elapsed0 >= MARK_AT) showMark(true);
  else if (S.start != null) markTimer = setTimeout(showMark, MARK_AT - elapsed0);
  function frame(now) {
    if (stopped) return;
    // Settled: the page's starfield has the stars now; hold this frame.
    if (S.frozen != null) { counted = false; return; }
    if (!trails.isConnected || trails.offsetWidth === 0) { retire(); return; }
    if (S.start == null) { S.start = now; markTimer = setTimeout(showMark, MARK_AT); }
    var theta = turned((now - S.start) / 1000);
    if (theta > drawn) { sweep(drawn, theta); drawn = theta; drawHeads(theta); }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return { stop: stop, elapsed: elapsed0 };
};

/* The end of a session's sky: freeze it where it stands and hand the
   stars to the page's starfield (agora:sky-settle, and
   window.__agoraSkySettled for a starfield that mounts a moment later).
   Idempotent; the same snapshot comes back. */
window.__agoraSkySettle = function () {
  var S = window.__agoraSkySession;
  if (!S || !S.stars) return null;
  if (S.frozen == null) {
    var elapsed = S.start == null ? 0 : performance.now() - S.start;
    S.frozen = S.reduced ? 0 : window.__agoraSkyTurned(S, elapsed / 1000);
    S.live = 0;
    window.__agoraSkyLiveCount = 0;
  }
  var snap = { at: performance.now(), w: S.w, h: S.h, theta: S.frozen, stars: S.stars };
  window.__agoraSkySettled = snap;
  window.dispatchEvent(new CustomEvent('agora:sky-settle', { detail: snap }));
  return snap;
};

/* A sky is leaving — its screen is about to fade. The session settles
   once every live sky is leaving, so the boot splash and the home
   page's first-load wait, which overlap, hand the stars over exactly
   once, from whichever of them goes last. */
window.__agoraSkyLeaving = function () {
  var S = window.__agoraSkySession;
  if (!S) return null;
  S.leaving = (S.leaving || 0) + 1;
  return S.leaving >= S.live ? window.__agoraSkySettle() : null;
};

/* Leaving for a full page load inside a session: the thin bar at the
   top of the page until the next document takes over (the same bar as
   lib/progress.ts uses for in-place navigation). */
window.__agoraLeave = function () {
  if (document.querySelector('.sk-progress[data-nav]:not(.is-done)')) return;
  var bar = document.createElement('div');
  bar.className = 'sk-progress';
  bar.setAttribute('data-nav', '1');
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  setTimeout(function () { if (bar.isConnected) bar.remove(); }, 10000);
};
// Any same-origin link that will load a whole page (Next's own links
// call preventDefault and route in place — those are skipped). On the
// window, not the document: React handles clicks at the document, and
// this script runs before React loads, so a document listener here
// would fire first and see nothing prevented yet — every in-app link
// would put the splash up over a page that then changes underneath it.
// Window listeners run after the document's, whoever registered first.
window.addEventListener('click', function (e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  var href = a.getAttribute('href') || '';
  if (href.charAt(0) === '#') return; // in-page: menus, "#" placeholders
  var u;
  try { u = new URL(a.href, location.href); } catch (err) { return; }
  if (u.origin !== location.origin) return;
  if (u.pathname === location.pathname && u.search === location.search && u.hash) return;
  if (window.__agoraLeave) window.__agoraLeave();
});
`;

/** One star of a session's sky: polar about the screen's centre. */
export type SkyStar = { r: number; a: number; w: number; col: [number, number, number]; alpha: number };
/** The sky as it settled: its stars at the angle reached, for the page's starfield. */
export type SkySnapshot = { at: number; w: number; h: number; theta: number; stars: SkyStar[] };

declare global {
  interface Window {
    __agoraSky?: (
      trails: HTMLCanvasElement,
      heads: HTMLCanvasElement,
      center: HTMLElement | null,
      options?: { speed?: number; ramp?: number; markAt?: number },
    ) => { stop: () => void; elapsed: number };
    __agoraSkySession?: {
      seed: number; start: number | null; w: number; h: number; lastStop: number; live: number;
      speed: number; ramp: number; stars: SkyStar[] | null; frozen: number | null; reduced: boolean; leaving: number;
    };
    /** One sky's screen is about to fade; settles the session once every live sky is leaving. */
    __agoraSkyLeaving?: () => SkySnapshot | null;
    __agoraSkyScatter?: (seed: number, w: number, h: number) => SkyStar[];
    __agoraSkyTurned?: (session: { speed: number; ramp: number }, seconds: number) => number;
    /** Freeze the session's sky and hand its stars to the page (see skySplash.ts). */
    __agoraSkySettle?: () => SkySnapshot | null;
    /** The last settled sky, for a starfield that mounts after the event. */
    __agoraSkySettled?: SkySnapshot;
    /** Skies currently drawing; the page starfields hold still while > 0. */
    __agoraSkyLiveCount?: number;
    /** The thin bar at the top for a full page load inside a session (see skySplash.ts). */
    __agoraLeave?: () => void;
  }
}
