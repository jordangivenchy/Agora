/* Adapter: bridges the MVP UI (mvp-home.js) to real AgoraSphere data and
   navigation. Loaded after mvp-home.js; classic script so it shares the
   global lexical scope (DEBATES, CAROUSEL_DATA, voteCounts, userVotes).
   Exposes window.__agoraApplyData so React can push live updates. */
(function () {
  function go(url) { window.location.href = url; }

  /* Hero carousel = the live rooms, most watched first. With nothing
     live it shows today's question instead (one slide, pushed by
     TopicsHome through applyData as heroTopics). News never goes in the
     hero: it has its own row further down (HomeNews.tsx). */
  var roomSlides = [];
  var topicSlides = [];

  function rebuildCarousel() {
    CAROUSEL_DATA.length = 0;
    var src = roomSlides.length ? roomSlides : topicSlides;
    for (var i = 0; i < src.length; i++) CAROUSEL_DATA.push(src[i]);
    renderCarousel();
  }

  function applyData(D) {
    if (!D) return;

    if (Array.isArray(D.heroTopics)) {
      topicSlides = D.heroTopics.slice(0, 1).map(function (t) {
        return {
          kind: 'topic',
          id: t.id,
          question: t.question,
          topicKey: t.topicKey,
          topicLabel: t.topicLabel,
          color: t.color,
          queueCount: t.queueCount || 0,
          amQueued: !!t.amQueued,
          rotateIn: t.rotateIn || '',
        };
      });
      rebuildCarousel();
    }

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

  /* "View all →" opens the Explore grid (no sidebar entry any more —
     React serves it on agora:tab). */
  document.querySelectorAll('.view-all').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('agora:tab', { detail: 'explore' }));
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

  /* React components that publish through __agoraApplyData (TopicsHome's
     hero question) may have done so before this script ran; tell them
     it's safe to publish again. */
  window.dispatchEvent(new CustomEvent('agora:adapter-ready'));
})();
