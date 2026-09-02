/* Adapter: bridges the MVP UI (mvp-home.js) to real AgoraSphere data and
   navigation. Loaded after mvp-home.js; classic script so it shares the
   global lexical scope (DEBATES, CAROUSEL_DATA, voteCounts, userVotes).
   Exposes window.__agoraApplyData so React can push live updates. */
(function () {
  /* Full-page jumps out of the shell: drop the top progress bar in (the
     same .sk-progress the route skeleton uses) so the tap answers at
     once, then navigate on the next frame so it paints. The page stays
     put — the same feel as an in-app navigation. */
  function go(url) {
    if (!document.querySelector('.sk-progress')) {
      var bar = document.createElement('div');
      bar.className = 'sk-progress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
    requestAnimationFrame(function () { window.location.href = url; });
  }

  /* Hero carousel = popular live rooms interleaved with top news stories
     (from /api/news, Particle-backed). Room slides and news slides are
     built independently and merged here, so either source can arrive or
     update at any time. */
  var roomSlides = [];
  var newsSlides = [];

  var NEWS_GRADIENTS = [
    'linear-gradient(120deg,#101426 0%,#1c2340 55%,#25172e 100%)',
    'linear-gradient(120deg,#141020 0%,#2a1a33 55%,#12203a 100%)',
    'linear-gradient(120deg,#0e1a2a 0%,#182a45 55%,#2b1f38 100%)',
  ];

  function rebuildCarousel() {
    CAROUSEL_DATA.length = 0;
    var n = Math.max(roomSlides.length, newsSlides.length);
    for (var i = 0; i < n; i++) {
      if (roomSlides[i]) CAROUSEL_DATA.push(roomSlides[i]);
      if (newsSlides[i]) CAROUSEL_DATA.push(newsSlides[i]);
    }
    renderCarousel();
  }

  fetch('/api/news')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      // Sample feeds are invented headlines — never put them in the hero.
      if (j.sample) return;
      // Hero = the major stories (ranked server-side); the ticker takes the rest.
      var stories = j.stories || [];
      var majors = stories.filter(function (s) { return s.major; });
      newsSlides = (majors.length ? majors : stories).slice(0, 3).map(function (s, i) {
        return {
          kind: 'news',
          headline: s.headline,
          category: s.category || null,
          url: s.url,
          sources: s.sources || [],
          imageUrl: s.imageUrl || null,
          summary: s.summary || null,
          gradient: NEWS_GRADIENTS[i % NEWS_GRADIENTS.length],
        };
      });
      if (newsSlides.length) rebuildCarousel();
    })
    .catch(function () { /* no news feed → carousel stays rooms-only */ });

  function applyData(D) {
    if (!D) return;

    if (Array.isArray(D.debates) && D.debates.length) {
      DEBATES.length = 0;
      D.debates.forEach(function (d) { DEBATES.push(d); });
      voteCounts = D.debates.map(function (d) {
        return { pro: d.votesPro || 0, con: d.votesCon || 0 };
      });
      userVotes = new Array(DEBATES.length).fill(null);

      var indexed = DEBATES.map(function (d, i) { d._i = i; return d; });
      var live = indexed.filter(function (d) { return d.status === 'live'; });
      live.sort(function (a, b) { return (b.viewersNum || 0) - (a.viewersNum || 0); });
      // Hero features LIVE rooms only, ranked by viewers — the slide
      // template says "Watch Live", so anything else up there lies.
      // Scheduled rooms have their own rail below; with nothing live the
      // strip goes news-only (renderCarousel hides it if news is empty too).
      var top = live.slice(0, 4);
      roomSlides = top.map(function (d) {
        return {
          debater: d.debater1,
          initials: (d.debater1 || '?').charAt(0).toUpperCase(),
          color: d.color1,
          viewersDisplay: d.viewers,
          viewersNum: d.viewersNum || 0,
          motion: d.motion,
          stance: d.debater1Stance || 'PRO',
          // No factCheck: real rooms have no fact-checking yet, and stamping
          // "verified" on them was a fabricated trust signal.
          gradient: d.gradient,
          thumbnailUrl: d.thumbnailUrl || null,
          topicKey: d.topicKey,
          debateIndex: d._i,
          // richer panel: the matchup + room facts
          debater2: d.debater2,
          color2: d.color2,
          initials2: (d.debater2 || '?').charAt(0).toUpperCase(),
          format: d.format || 'Open',
          language: d.language || 'EN',
          community: d.community || null,
          communityColor: d.communityColor || null,
          votesPro: d.votesPro || 0,
          votesCon: d.votesCon || 0,
          liveSince: d.liveSince || null,
          speakerCount: d.speakerCount || 0,
          audienceCount: d.audienceCount || 0,
          secondaryTopics: d.secondaryTopics || [],
        };
      });

      rebuildCarousel();
      renderTopicButtons();
      if (typeof renderTopicStrip === 'function') renderTopicStrip();
      renderDebateGrid();
      if (typeof renderELOModule === 'function') renderELOModule();
    }

    /* Live platform stats (explore banner): real rooms / members / viewers. */
    if (D.stats) {
      var vals = document.querySelectorAll('.explore-stat-val');
      var labels = document.querySelectorAll('.explore-stat-label');
      if (vals[0]) vals[0].textContent = String(D.stats.activeRooms);
      if (labels[0]) labels[0].textContent = 'Active rooms';
      if (vals[1]) vals[1].textContent = String(D.stats.members);
      if (labels[1]) labels[1].textContent = 'Members';
      if (vals[2]) vals[2].textContent = String(D.stats.watching);
      if (labels[2]) labels[2].textContent = 'Watching now';
    }
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

  /* Auth area */
  var D0 = window.__AGORA_DATA__ || {};
  var loginBtn = document.querySelector('.btn-ghost');
  var signupBtn = document.querySelector('.btn-signup');
  if (D0.user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (signupBtn) signupBtn.style.display = 'none';
    var initial = document.querySelector('.avatar-initial');
    if (initial) initial.textContent = (D0.user.name || 'U').charAt(0).toUpperCase();
    /* Identity header at the top of the avatar menu. */
    var menuHead = document.getElementById('avatarMenuHead');
    if (menuHead) {
      menuHead.style.display = '';
      var headName = document.getElementById('avatarMenuName');
      var headSub = document.getElementById('avatarMenuSub');
      if (headName) headName.textContent = D0.user.name || 'You';
      if (headSub) headSub.textContent = D0.user.username ? '@' + D0.user.username : '';
    }
    /* Real profile photo when there is one; the initial stays as fallback. */
    if (D0.user.avatarUrl && initial) {
      var img = document.createElement('img');
      img.className = 'avatar-photo';
      img.alt = '';
      img.src = D0.user.avatarUrl;
      img.onload = function () { initial.style.display = 'none'; };
      initial.parentNode.insertBefore(img, initial);
    }
  } else {
    if (loginBtn) loginBtn.addEventListener('click', function () { go('/login'); });
    if (signupBtn) signupBtn.addEventListener('click', function () { go('/login'); });
    var avWrap = document.getElementById('profileAvatarWrap');
    if (avWrap) avWrap.style.display = 'none';
    var msgBtn = document.getElementById('nav-messages-btn');
    if (msgBtn) msgBtn.style.display = 'none';
  }

  /* Avatar dropdown → real destinations */
  document.querySelectorAll('.avatar-menu-item').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var href = a.getAttribute('href');
      if (href === '#logout') window.dispatchEvent(new CustomEvent('agora:logout'));
      else if (href === '#settings') go('/settings');
      else if (href === '#friends') window.dispatchEvent(new CustomEvent('agora:friends'));
      else if (href === '#profile') window.dispatchEvent(new CustomEvent('agora:profile'));
    });
  });

  /* Phone search icon (.nav-search-icon) is handled by the React search
     hook (useNavbarSearch.ts): it reveals the navbar box, focuses it in
     the tap and opens the panel in place. */

  /* Messages button goes to the dedicated page. */
  var msgWrap = document.getElementById('nav-messages-btn');
  if (msgWrap) {
    msgWrap.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      go('/messages');
    });
  }


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
  if (!window.__agoraCreateHooked) {
    window.__agoraCreateHooked = true;
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('#searchBtn')) {
        e.stopPropagation();
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('agora:create'));
      } else if (e.target.closest('.nav-logo')) {
        // Logo → home (closes any open React tab and shows the home feed;
        // the sidebar nav itself is React-owned now, see HomeSidebar.tsx).
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('agora:tab', { detail: 'home' }));
      }
    }, true);
  }
})();
