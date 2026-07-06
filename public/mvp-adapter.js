/* Adapter: bridges the MVP UI (mvp-home.js) to real AgoraSphere data and
   navigation. Loaded after mvp-home.js; classic script so it shares the
   global lexical scope (DEBATES, CAROUSEL_DATA, voteCounts, userVotes).
   Exposes window.__agoraApplyData so React can push live updates. */
(function () {
  function go(url) { window.location.href = url; }

  function applyData(D) {
    if (!D) return;

    if (Array.isArray(D.debates) && D.debates.length) {
      DEBATES.length = 0;
      D.debates.forEach(function (d) { DEBATES.push(d); });
      voteCounts = D.debates.map(function (d) {
        return { pro: d.votesPro || 0, con: d.votesCon || 0 };
      });
      userVotes = new Array(DEBATES.length).fill(null);

      var live = DEBATES.map(function (d, i) { d._i = i; return d; })
        .filter(function (d) { return d.status === 'live'; });
      live.sort(function (a, b) { return (b.viewersNum || 0) - (a.viewersNum || 0); });
      var top = (live.length ? live : DEBATES.slice()).slice(0, 4);
      CAROUSEL_DATA.length = 0;
      top.forEach(function (d) {
        CAROUSEL_DATA.push({
          debater: d.debater1,
          initials: (d.debater1 || '?').charAt(0).toUpperCase(),
          color: d.color1,
          viewersDisplay: d.viewers,
          viewersNum: d.viewersNum || 0,
          motion: d.motion,
          stance: d.debater1Stance || 'PRO',
          factCheck: { type: 'verified', label: 'verified' },
          gradient: d.gradient,
          topicKey: d.topicKey,
          debateIndex: d._i,
        });
      });

      renderCarousel();
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

  /* Cards navigate to the real LiveKit room when one exists. */
  var _origOpen = window.openDebateModal;
  window.openDebateModal = function (i) {
    var d = DEBATES[i];
    if (d && d.roomId) { go('/rooms/' + d.roomId); }
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
  } else {
    if (loginBtn) loginBtn.addEventListener('click', function () { go('/login'); });
    if (signupBtn) signupBtn.addEventListener('click', function () { go('/login'); });
    var avWrap = document.getElementById('profileAvatarWrap');
    if (avWrap) avWrap.style.display = 'none';
    var msgBtn = document.getElementById('nav-messages-btn');
    if (msgBtn) msgBtn.style.display = 'none';
  }

  document.querySelectorAll('.avatar-menu-item').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (a.getAttribute('href') === '#logout') {
        window.dispatchEvent(new CustomEvent('agora:logout'));
      }
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
      } else if (e.target.closest('.dashboard-btn')) {
        // Open the app's real DashboardModal instead of the MVP's demo one.
        e.stopPropagation();
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('agora:dashboard'));
      }
    }, true);
  }
})();
