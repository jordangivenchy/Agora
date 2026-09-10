/* Adapter: bridges the MVP UI (mvp-home.js) to real AgoraSphere data and
   navigation. Loaded after mvp-home.js; classic script so it shares the
   global lexical scope (DEBATES, voteCounts, userVotes).
   Exposes window.__agoraApplyData so React can push live updates. */
(function () {
  /* Full-page jumps out of the shell: drop the top progress bar in (the
     same .sk-progress the loading screen uses) so the tap answers at
     once, then navigate on the next frame so it paints. The page stays
     put — the same feel as an in-app navigation. */
  function go(url) {
    if (window.__agoraLeave) {
      window.__agoraLeave(); // the loading screen, handed on to the next page
    } else if (!document.querySelector('.sk-progress')) {
      var bar = document.createElement('div');
      bar.className = 'sk-progress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
    requestAnimationFrame(function () { window.location.href = url; });
  }

  /* The hero carousel (live rooms + the day's stories) is React now:
     components/HeroCarousel.tsx, fed by the page's own data pass. */

  function applyData(D) {
    if (!D) return;

    if (Array.isArray(D.debates) && D.debates.length) {
      DEBATES.length = 0;
      D.debates.forEach(function (d) { DEBATES.push(d); });
      voteCounts = D.debates.map(function (d) {
        return { pro: d.votesPro || 0, con: d.votesCon || 0 };
      });
      userVotes = new Array(DEBATES.length).fill(null);

      renderTopicButtons();
      if (typeof renderTopicStrip === 'function') renderTopicStrip();
      renderDebateGrid();
      if (typeof renderELOModule === 'function') renderELOModule();
    }

    /* The Explore banner's figures are React now (ExplorePage.tsx, from
       the page's stats). */
  }

  window.__agoraApplyData = applyData;
  applyData(window.__AGORA_DATA__);

  /* Cards navigate to the Agora (amphitheater view) when a real room exists. */
  var _origOpen = window.openDebateModal;
  window.openDebateModal = function (i) {
    var d = DEBATES[i];
    if (d && d.roomId) { go('/agora/' + d.roomId); }
    else if (typeof _origOpen === 'function') { _origOpen(i); }
  };

  /* The navbar — auth state, avatar menu, messages, Create, logo — is
     React now (components/SiteNavbar.tsx). */

  /* Phone search icon (.nav-search-icon) is handled by the React search
     hook (useNavbarSearch.ts): it reveals the navbar box, focuses it in
     the tap and opens the panel in place. */

  /* Friends section is rendered by React (FriendsSection) — the demo
     renderer stays idle. */

  /* "View all →" opens the Explore page. */
  document.querySelectorAll('.view-all').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var explore = document.querySelector('[data-nav-id="explore"]');
      if (explore) explore.click();
    });
  });
  /* Create button opens the real CreateRoomModal (document-level capture
     fires before the MVP's own target listener, so we can intercept). */
  /* The bar is see-through at the top of the page and solid once
     scrolled (mvp-home.css .nav:not(.is-scrolled)). */
  if (!window.__agoraNavScrollHooked) {
    window.__agoraNavScrollHooked = true;
    var navEl = document.querySelector('.nav');
    var applyNavScroll = function () {
      if (!navEl) navEl = document.querySelector('.nav');
      if (!navEl) return;
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      navEl.classList.toggle('is-scrolled', y > 8);
    };
    applyNavScroll();
    window.addEventListener('scroll', applyNavScroll, { passive: true });
  }
})();
