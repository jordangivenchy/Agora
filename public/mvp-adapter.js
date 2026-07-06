/* Adapter: bridges the MVP UI (mvp-home.js) to real AgoraSphere data and
   navigation. Loaded after mvp-home.js; classic script so it shares the
   global lexical scope (DEBATES, CAROUSEL_DATA, voteCounts, userVotes). */
(function () {
  var D = window.__AGORA_DATA__ || {};
  function go(url) { window.location.href = url; }

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

  /* Cards navigate to the real LiveKit room when one exists. */
  var _origOpen = window.openDebateModal;
  window.openDebateModal = function (i) {
    var d = DEBATES[i];
    if (d && d.roomId) { go('/rooms/' + d.roomId); }
    else if (typeof _origOpen === 'function') { _origOpen(i); }
  };

  /* Auth area */
  var loginBtn = document.querySelector('.btn-ghost');
  var signupBtn = document.querySelector('.btn-signup');
  if (D.user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (signupBtn) signupBtn.style.display = 'none';
    var initial = document.querySelector('.avatar-initial');
    if (initial) initial.textContent = (D.user.name || 'U').charAt(0).toUpperCase();
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
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#searchBtn')) {
      e.stopPropagation();
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('agora:create'));
    }
  }, true);
})();
