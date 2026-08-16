export const MVP_HOME_HTML = `<!-- SVG turbulence filter for liquid glass refraction -->
<svg style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <filter id="avatar-glass-distort" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.65 0.45" numOctaves="3" seed="4" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>

<!-- ─── STARFIELD BACKGROUND ─── -->
<canvas id="star-canvas" aria-hidden="true"></canvas>
<svg id="shooting-svg" aria-hidden="true"></svg>

<!-- ─── TOP NAV ─── -->
<nav class="nav">
  <button class="hamburger" id="hamburger" aria-label="Menu">☰</button>
  <a class="nav-logo" href="#" aria-label="AgoraSphere">
    <span class="nav-logo-text">Agora<span class="nav-logo-sphere">Sphere</span></span>
  </a>
  <div class="nav-search agora-search-shell" id="navSearchWrap">
    <div class="search-active-indicator"></div>
    <input type="text" id="searchInput" placeholder="Search topics, people, or keywords…" aria-label="Search" autocomplete="off">
    <button class="create-btn nav-search-btn" id="searchBtn" type="button" aria-label="Create a discussion">
      <span class="create-icon">✦</span>
      <span class="create-label"><span>C</span><span>r</span><span>e</span><span>a</span><span>t</span><span>e</span></span>
    </button>
  </div>
  <div class="nav-auth">
    <button class="btn-ghost">Log in</button>
    <button class="btn-signup">Sign up</button>
    <div class="nav-messages-btn" id="nav-messages-btn" role="button" aria-label="Messages" tabindex="0">
      <div class="nav-messages-glass-wrap">
        <button class="nav-messages-glass-btn">
          <span class="nav-messages-glass-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
        </button>
        <div class="nav-messages-glass-shadow"></div>
      </div>
    </div>
    <!-- Notification bell — React portal target (NotificationsBell.tsx) -->
    <div id="notifBellHost" style="display:flex;align-items:center;"></div>
    <div class="nav-avatar" id="profileAvatarWrap">
      <button class="avatar-btn" id="profileAvatarBtn" aria-label="Profile menu" aria-expanded="false" aria-haspopup="true">
        <div class="avatar-neon-ring"></div>
        <span class="avatar-initial">J</span>
      </button>
      <div class="avatar-dropdown" id="profileDropdown" role="menu">
        <a class="avatar-menu-item" href="#profile" role="menuitem">
          <span class="avatar-menu-icon">👤</span>Profile
        </a>
        <a class="avatar-menu-item" href="#settings" role="menuitem">
          <span class="avatar-menu-icon">⚙️</span>Settings
        </a>
        <div class="avatar-dropdown-divider"></div>
        <a class="avatar-menu-item avatar-menu-item--danger" href="#logout" role="menuitem">
          <span class="avatar-menu-icon">🚪</span>Log out
        </a>
      </div>
    </div>
  </div>
</nav>

<!-- ─── CREATE/QUEUE MODAL ─── -->
<div id="createModal" class="create-modal-overlay" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
  <div class="create-modal-box">
    <div class="create-modal-header">
      <span class="create-modal-title" id="modalTitle">What would you like to do?</span>
      <button class="create-modal-close" id="closeModal" aria-label="Close">✕</button>
    </div>
    <div id="modalBody"></div>
  </div>
</div>

<!-- ─── DISCOVERY OVERLAY ─── -->
<div id="discoveryOverlay" style="display:none" role="dialog" aria-modal="true" aria-label="Search and discover discussions">
  <div class="discovery-search-bar">
    <input id="discoveryInput" type="text" placeholder="Search topics, people, or categories…" autocomplete="off" />
    <button class="discovery-close" id="closeDiscovery" aria-label="Close search">✕</button>
  </div>
  <div class="discovery-body">

    <!-- Filter sidebar -->
    <div class="discovery-filters" id="discoveryFilters">

      <div class="filter-group">
        <span class="filter-group-title">Category</span>
        <button class="filter-pill active" data-filter-group="category" onclick="_dsFilter(this)">All</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Politics</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Economics</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Science &amp; Tech</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Philosophy</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Foreign Policy</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Culture</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Sports</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Law</button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">History</button>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-group">
        <span class="filter-group-title">Status</span>
        <button class="filter-pill active" data-filter-group="status" onclick="_dsFilter(this)">All</button>
        <button class="filter-pill" data-filter-group="status" onclick="_dsFilter(this)">Live now</button>
        <button class="filter-pill" data-filter-group="status" onclick="_dsFilter(this)">In queue</button>
        <button class="filter-pill" data-filter-group="status" onclick="_dsFilter(this)">Scheduled</button>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-group">
        <span class="filter-group-title">Format</span>
        <button class="filter-pill active" data-filter-group="format" onclick="_dsFilter(this)">All formats</button>
        <button class="filter-pill" data-filter-group="format" onclick="_dsFilter(this)">Open Debate</button>
        <button class="filter-pill" data-filter-group="format" onclick="_dsFilter(this)">Oxford Style</button>
        <button class="filter-pill" data-filter-group="format" onclick="_dsFilter(this)">1v1</button>
        <button class="filter-pill" data-filter-group="format" onclick="_dsFilter(this)">Panel (2v2)</button>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-group">
        <span class="filter-group-title">Language</span>
        <button class="filter-pill active" data-filter-group="language" onclick="_dsFilter(this)">Any language</button>
        <button class="filter-pill" data-filter-group="language" onclick="_dsFilter(this)">English</button>
        <button class="filter-pill" data-filter-group="language" onclick="_dsFilter(this)">Spanish</button>
        <button class="filter-pill" data-filter-group="language" onclick="_dsFilter(this)">French</button>
        <button class="filter-pill" data-filter-group="language" onclick="_dsFilter(this)">Mandarin</button>
        <button class="filter-pill" data-filter-group="language" onclick="_dsFilter(this)">Arabic</button>
      </div>

    </div><!-- /discovery-filters -->

    <!-- Results -->
    <div class="discovery-results" id="discoveryResults">
      <div class="results-meta" id="resultsMeta"></div>
      <div class="results-grid" id="resultsGrid"><!-- cards generated from real rooms by renderDiscoveryCards() --></div><!-- /results-grid -->
    </div><!-- /discovery-results -->
  </div><!-- /discovery-body -->
</div><!-- /discoveryOverlay -->

<!-- ─── SIDEBAR ─── -->
<aside class="sidebar" id="sidebar">

  <!-- glass edge-blur layer (masked to perimeter) -->
  <div class="sidebar-edge-blur" aria-hidden="true">
    <div class="sidebar-edge-blur-inner"></div>
  </div>
  <!-- glass edge-tint layer -->
  <div class="sidebar-edge-tint" aria-hidden="true"></div>

  <div class="sidebar-scroll-area">

    <!-- ── Top zone: nav items (scrollable, grows) ── -->
    <div class="sidebar-top-zone">

    <!-- ── Main Nav ── -->
    <nav class="sidebar-nav" id="mvNav">

      <!-- Home -->
      <a class="sidebar-link active" href="#" data-page="home" data-nav-id="home">
        <span class="nav-hover-shimmer"></span>
        <span class="nav-light-slit"></span>
        <div class="nav-light-beam"><div class="nav-light-beam-cone"></div><div class="nav-light-beam-center"></div><div class="nav-light-beam-glow"></div></div>
        <div class="nav-light-shadow"><div class="nav-light-shadow-right"></div></div>
        <span class="nav-sparkle" style="--delay:0s;--dur:4s;left:22%;top:28%;--sx:5px;"></span>
        <span class="nav-sparkle" style="--delay:0.8s;--dur:3.7s;left:55%;top:70%;--sx:-4px;"></span>
        <span class="nav-sparkle" style="--delay:1.5s;--dur:4.4s;left:78%;top:30%;--sx:5px;"></span>
        <span class="nav-sparkle" style="--delay:2.3s;--dur:3.9s;left:40%;top:78%;--sx:-3px;"></span>
        <span class="nav-sparkle" style="--delay:3.1s;--dur:4.6s;left:88%;top:52%;--sx:4px;"></span>
        <div class="nav-inner">
          <span class="nav-icon-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.31 1.776a1 1 0 0 1 1.38 0l8 7.619 2.5 2.381a1 1 0 0 1-1.38 1.448L21 12.452V20a2 2 0 0 1-2 2h-5v-5a2 2 0 0 0-4 0v5H5a2 2 0 0 1-2-2v-7.548l-.81.772a1 1 0 0 1-1.38-1.448l2.5-2.381 8-7.619Z"/></svg>
          </span>
          <span class="nav-label">Home</span>
        </div>
      </a>

      <!-- Trending -->
      <a class="sidebar-link" href="#" data-nav-id="trending">
        <span class="nav-hover-shimmer"></span>
        <span class="nav-light-slit"></span>
        <div class="nav-light-beam"><div class="nav-light-beam-cone"></div><div class="nav-light-beam-center"></div><div class="nav-light-beam-glow"></div></div>
        <div class="nav-light-shadow"><div class="nav-light-shadow-right"></div></div>
        <span class="nav-sparkle" style="--delay:0.3s;--dur:4.2s;left:28%;top:42%;--sx:5px;"></span>
        <span class="nav-sparkle" style="--delay:1.1s;--dur:3.6s;left:68%;top:60%;--sx:-5px;"></span>
        <span class="nav-sparkle" style="--delay:1.9s;--dur:4.5s;left:84%;top:25%;--sx:4px;"></span>
        <span class="nav-sparkle" style="--delay:2.7s;--dur:3.8s;left:45%;top:82%;--sx:-4px;"></span>
        <div class="nav-inner">
          <span class="nav-icon-wrap">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M9.32 15.653a.812.812 0 0 1-.086-.855c.176-.342.245-.733.2-1.118a2.106 2.106 0 0 0-.267-.779 2.027 2.027 0 0 0-.541-.606 3.96 3.96 0 0 1-1.481-2.282c-1.708 2.239-1.053 3.51-.235 4.63a.748.748 0 0 1-.014.901.87.87 0 0 1-.394.283.838.838 0 0 1-.478.023c-1.105-.27-2.145-.784-2.85-1.603a4.686 4.686 0 0 1-.906-1.555 4.811 4.811 0 0 1-.263-1.797s-.133-2.463 2.837-4.876c0 0 3.51-2.978 2.292-5.18a.621.621 0 0 1 .112-.653.558.558 0 0 1 .623-.147l.146.058a7.63 7.63 0 0 1 2.96 3.5c.58 1.413.576 3.06.184 4.527.325-.292.596-.641.801-1.033l.029-.064c.198-.477.821-.325 1.055-.013.086.137 2.292 3.343 1.107 6.048a5.516 5.516 0 0 1-1.84 2.027 6.127 6.127 0 0 1-2.138.893.834.834 0 0 1-.472-.038.867.867 0 0 1-.381-.29z"/></svg>
          </span>
          <span class="nav-label">Trending</span>
        </div>
      </a>

      <!-- Explore -->
      <a class="sidebar-link" href="#" data-page="explore" data-nav-id="explore" id="exploreNavLink">
        <span class="nav-hover-shimmer"></span>
        <span class="nav-light-slit"></span>
        <div class="nav-light-beam"><div class="nav-light-beam-cone"></div><div class="nav-light-beam-center"></div><div class="nav-light-beam-glow"></div></div>
        <div class="nav-light-shadow"><div class="nav-light-shadow-right"></div></div>
        <span class="nav-sparkle" style="--delay:0.5s;--dur:4.3s;left:18%;top:55%;--sx:-5px;"></span>
        <span class="nav-sparkle" style="--delay:1.3s;--dur:3.8s;left:62%;top:35%;--sx:6px;"></span>
        <span class="nav-sparkle" style="--delay:2.1s;--dur:4.6s;left:85%;top:68%;--sx:-4px;"></span>
        <span class="nav-sparkle" style="--delay:2.9s;--dur:3.5s;left:38%;top:22%;--sx:5px;"></span>
        <div class="nav-inner">
          <span class="nav-icon-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9.879 9.879L15.536 8.464 14.121 14.121 8.464 15.536z" fill="currentColor"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/></svg>
          </span>
          <span class="nav-label">Explore</span>
        </div>
      </a>

      <!-- Subscriptions -->
      <a class="sidebar-link" href="#" data-nav-id="subscriptions">
        <span class="nav-hover-shimmer"></span>
        <span class="nav-light-slit"></span>
        <div class="nav-light-beam"><div class="nav-light-beam-cone"></div><div class="nav-light-beam-center"></div><div class="nav-light-beam-glow"></div></div>
        <div class="nav-light-shadow"><div class="nav-light-shadow-right"></div></div>
        <span class="nav-sparkle" style="--delay:0.2s;--dur:4.7s;left:32%;top:48%;--sx:5px;"></span>
        <span class="nav-sparkle" style="--delay:1.0s;--dur:3.9s;left:72%;top:26%;--sx:-5px;"></span>
        <span class="nav-sparkle" style="--delay:1.8s;--dur:4.3s;left:90%;top:72%;--sx:4px;"></span>
        <span class="nav-sparkle" style="--delay:2.6s;--dur:3.7s;left:48%;top:86%;--sx:-4px;"></span>
        <div class="nav-inner">
          <span class="nav-icon-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 6C10.2 3.9 7.19 3.26 4.94 5.18 2.68 7.1 2.37 10.31 4.14 12.58c1.47 1.89 5.93 5.87 7.39 7.16.16.14.25.22.35.25a.5.5 0 0 0 .24 0c.1-.03.19-.11.35-.25 1.46-1.29 5.92-5.27 7.39-7.16 1.77-2.27 1.49-5.5-.81-7.41C16.8 3.27 13.8 3.9 12 6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <span class="nav-label">Subscriptions</span>
        </div>
      </a>

      <!-- Subscriptions sub-list: live channels expand here when active -->
      <div class="subs-channel-sublist" id="subsChannelSublist">
        <div class="glass-channel-list" id="subsChannelList"></div>
      </div>


      <!-- Communities -->
      <a class="sidebar-link" href="#" data-nav-id="communities">
        <span class="nav-hover-shimmer"></span>
        <span class="nav-light-slit"></span>
        <div class="nav-light-beam"><div class="nav-light-beam-cone"></div><div class="nav-light-beam-center"></div><div class="nav-light-beam-glow"></div></div>
        <div class="nav-light-shadow"><div class="nav-light-shadow-right"></div></div>
        <span class="nav-sparkle" style="--delay:0.4s;--dur:4.4s;left:24%;top:58%;--sx:-5px;"></span>
        <span class="nav-sparkle" style="--delay:1.2s;--dur:3.9s;left:65%;top:32%;--sx:6px;"></span>
        <span class="nav-sparkle" style="--delay:2.0s;--dur:4.7s;left:82%;top:76%;--sx:-4px;"></span>
        <div class="nav-inner">
          <span class="nav-icon-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </span>
          <span class="nav-label">Communities</span>
        </div>
      </a>

      <!-- News -->
      <a class="sidebar-link" href="#" data-nav-id="news">
        <span class="nav-hover-shimmer"></span>
        <span class="nav-light-slit"></span>
        <div class="nav-light-beam"><div class="nav-light-beam-cone"></div><div class="nav-light-beam-center"></div><div class="nav-light-beam-glow"></div></div>
        <div class="nav-light-shadow"><div class="nav-light-shadow-right"></div></div>
        <span class="nav-sparkle" style="--delay:0.7s;--dur:4.2s;left:30%;top:46%;--sx:5px;"></span>
        <span class="nav-sparkle" style="--delay:1.5s;--dur:3.8s;left:70%;top:66%;--sx:-5px;"></span>
        <span class="nav-sparkle" style="--delay:2.3s;--dur:4.6s;left:86%;top:32%;--sx:4px;"></span>
        <div class="nav-inner">
          <span class="nav-icon-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a4 4 0 0 1-4-4V6"/><path d="M2 13h6"/><path d="M2 9h6"/><path d="M2 17h6"/></svg>
          </span>
          <span class="nav-label">News</span>
        </div>
      </a>

    </nav>

    </div><!-- /sidebar-top-zone -->

    <!-- ── Bottom zone: friends pinned to bottom ── -->
    <div class="sidebar-bottom-zone">

    <!-- Friends section -->
    <div class="friends-section" id="friendsSection"></div>

    <div class="sidebar-footer" style="padding-bottom:12px;font-size:11px;color:rgba(255,255,255,0.2);text-align:center;margin:0;padding-top:8px;">© 2025 AgoraSphere</div>

    </div><!-- /sidebar-bottom-zone -->

  </div><!-- /sidebar-scroll-area -->

</aside>

<!-- ─── MAIN CONTENT ─── -->
<main class="main">

<!-- ─── HOME FEED ─── -->
<div id="homeFeed">

  <!-- CAROUSEL -->
  <section class="carousel-section">
    <div class="carousel-stage" id="carouselStage">
      <div class="carousel-track" id="carouselTrack"></div>
      <button class="carousel-arrow left" id="arrowLeft" aria-label="Previous">◀</button>
      <button class="carousel-arrow right" id="arrowRight" aria-label="Next">▶</button>
    </div>
    <div class="carousel-dots" id="carouselDots"></div>
    <!-- News headlines — React portal target (NewsTicker.tsx) -->
    <div id="newsTickerHost"></div>
  </section>

  <!-- TOPICS — React portal target (TopicsHome.tsx renders the
       field-of-study dropdowns: queue questions + user lobbies) -->
  <section id="fieldsSection"></section>

</div><!-- /homeFeed -->

<!-- ─── EXPLORE PAGE ─── -->
<div id="explorePage" style="display:none;">

  <!-- Banner -->
  <div class="explore-banner">
    <div class="explore-banner-text">
      <h1 class="explore-title">Explore discussions</h1>
      <p class="explore-subtitle">Find a live room, join a queue, or sign up for one coming up</p>
    </div>
    <div class="explore-banner-stats">
      <div class="explore-stat">
        <span class="explore-stat-val">—</span>
        <span class="explore-stat-label">Active rooms</span>
      </div>
      <div class="explore-stat">
        <span class="explore-stat-val">—</span>
        <span class="explore-stat-label">Speakers online</span>
      </div>
      <div class="explore-stat">
        <span class="explore-stat-val">—</span>
        <span class="explore-stat-label">Watching now</span>
      </div>
    </div>
  </div>

  <!-- Search bar -->
  <div class="explore-search-wrap">
    <span class="explore-search-icon">⌕</span>
    <input id="exploreSearchInput" class="explore-search-input" type="text"
      placeholder="Search topics, people, or keywords…" autocomplete="off" />
  </div>

  <!-- Filter bar -->
  <div class="explore-filter-bar">

    <div class="explore-filter-group">
      <span class="explore-filter-group-label">Category</span>
      <div class="explore-filter-pills" id="epCategoryFilter">
        <button class="explore-pill active" onclick="_epFilter(this,'category')">All</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Politics</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Economics</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Science &amp; Tech</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Philosophy</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Foreign Policy</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Culture</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Sports</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Law</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">History</button>
      </div>
    </div>

    <div class="explore-filter-divider"></div>

    <div class="explore-filter-row">

      <div class="explore-filter-group-inline">
        <span class="explore-filter-group-label">Status</span>
        <div class="explore-filter-pills" id="epStatusFilter">
          <button class="explore-pill active"    onclick="_epFilter(this,'status')">All</button>
          <button class="explore-pill live-pill" onclick="_epFilter(this,'status')">● Live</button>
          <button class="explore-pill"           onclick="_epFilter(this,'status')">Queue</button>
          <button class="explore-pill"           onclick="_epFilter(this,'status')">Scheduled</button>
        </div>
      </div>

      <div class="explore-filter-group-inline">
        <span class="explore-filter-group-label">Format</span>
        <div class="explore-filter-pills" id="epFormatFilter">
          <button class="explore-pill active" onclick="_epFilter(this,'format')">All</button>
          <button class="explore-pill"        onclick="_epFilter(this,'format')">Open</button>
          <button class="explore-pill"        onclick="_epFilter(this,'format')">Oxford</button>
          <button class="explore-pill"        onclick="_epFilter(this,'format')">1v1</button>
          <button class="explore-pill"        onclick="_epFilter(this,'format')">Panel</button>
        </div>
      </div>

      <div class="explore-filter-group-inline">
        <span class="explore-filter-group-label">Language</span>
        <div class="explore-filter-pills" id="epLangFilter">
          <button class="explore-pill active" onclick="_epFilter(this,'lang')">Any</button>
          <button class="explore-pill"        onclick="_epFilter(this,'lang')">EN</button>
          <button class="explore-pill"        onclick="_epFilter(this,'lang')">ES</button>
          <button class="explore-pill"        onclick="_epFilter(this,'lang')">FR</button>
          <button class="explore-pill"        onclick="_epFilter(this,'lang')">ZH</button>
          <button class="explore-pill"        onclick="_epFilter(this,'lang')">AR</button>
        </div>
      </div>

    </div><!-- /explore-filter-row -->
  </div><!-- /explore-filter-bar -->

  <!-- Results -->
  <div class="explore-results-wrap">
    <div class="explore-results-meta" id="epResultsMeta">Showing 0 results</div>
    <div class="explore-results-grid" id="epResultsGrid"></div>
  </div>

</div><!-- /explorePage -->

</main>

<!-- ═══════════════════════════════════════════════
     PHASE 2: DEBATE ROOM MODAL
     ═══════════════════════════════════════════════ -->
<div class="modal-overlay" id="debateModal" style="display:none;" role="dialog" aria-modal="true" aria-label="Discussion room">
  <div class="debate-room" id="debateRoomPanel">
    <!-- injected by renderDebateRoom() -->
  </div>
</div>

<!-- ═══════════════════════════════════════════════
     PHASE 2: TOAST CONTAINER
     ═══════════════════════════════════════════════ -->
<div class="toast-container" id="toastContainer" aria-live="polite"></div>

<!-- Sidebar glass SVG filter -->
<svg style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <filter id="sidebar-glass" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.04 0.04" numOctaves="1" seed="2" result="turbulence"/>
      <feGaussianBlur in="turbulence" stdDeviation="1.5" result="blurredNoise"/>
      <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="30" xChannelSelector="R" yChannelSelector="B" result="displaced"/>
      <feGaussianBlur in="displaced" stdDeviation="2" result="finalBlur"/>
      <feComposite in="finalBlur" in2="finalBlur" operator="over"/>
    </filter>
  </defs>
</svg>

<!-- Liquid glass SVG filter — referenced by backdrop-filter on category buttons -->
<svg class="hidden" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <filter id="liquid-glass-filter" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence"/>
      <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise"/>
      <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="70" xChannelSelector="R" yChannelSelector="B" result="displaced"/>
      <feGaussianBlur in="displaced" stdDeviation="4" result="finalBlur"/>
      <feComposite in="finalBlur" in2="finalBlur" operator="over"/>
    </filter>
  </defs>
</svg>

<!-- SVG filter for sidebar glass edge distortion -->
<svg style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <filter id="sidebar-glass-filter" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.04 0.04" numOctaves="1" seed="2" result="turbulence"/>
      <feGaussianBlur in="turbulence" stdDeviation="1.5" result="blurredNoise"/>
      <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="40" xChannelSelector="R" yChannelSelector="B" result="displaced"/>
      <feGaussianBlur in="displaced" stdDeviation="2" result="finalBlur"/>
      <feComposite in="finalBlur" in2="finalBlur" operator="over"/>
    </filter>
  </defs>
</svg>
<svg class="svg-turbulence" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none" aria-hidden="true">
  <defs>
    <filter id="turbulent-displace-0"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="0" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="turbulent-displace-1"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="1" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="turbulent-displace-2"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="2" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="turbulent-displace-3"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="3" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="turbulent-displace-4"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="4" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="turbulent-displace-5"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="5" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="turbulent-displace-6"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="6" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="turbulent-displace-7"><feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>
  </defs>
</svg>

<!-- ════════════════════════════════════════
     DASHBOARD MODAL
════════════════════════════════════════ -->
<div id="dashboard-modal" class="dash-modal-overlay" aria-modal="true" role="dialog" aria-label="Dashboard" style="display:none">
  <div class="dash-modal-panel">
    <div class="dash-glass-layer-1"></div>
    <div class="dash-glass-layer-2"></div>
    <div class="dash-glass-layer-3"></div>
    <div class="dash-glass-shimmer"></div>
    <button class="dash-modal-close" id="dash-modal-close" aria-label="Close">✕</button>
    <div class="dash-modal-title">Dashboard</div>
    <div class="dash-orbital-container" id="dash-orbital">
      <div id="dash-sphere-mount" style="position:absolute;width:200px;height:200px;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10;pointer-events:none;"></div>
      <div class="dash-orbital-ring"></div>
      <div class="dash-orbital-nodes" id="dash-orbital-nodes"></div>
    </div>
  </div>
</div>

<svg style="display:none;position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <filter id="liquid-glass-modal" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.001 0.005" numOctaves="1" seed="17" result="turbulence"/>
      <feComponentTransfer in="turbulence" result="mapped">
        <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5"/>
        <feFuncG type="gamma" amplitude="0" exponent="1" offset="0"/>
        <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5"/>
      </feComponentTransfer>
      <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap"/>
      <feSpecularLighting in="softMap" surfaceScale="5" specularConstant="1" specularExponent="100" lightingColor="white" result="specLight">
        <fePointLight x="-200" y="-200" z="300"/>
      </feSpecularLighting>
      <feComposite in="specLight" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="litImage"/>
      <feDisplacementMap in="SourceGraphic" in2="softMap" scale="120" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>
`;
