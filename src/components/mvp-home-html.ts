import { iconSvg } from "./icons";

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
    <img src="/logo.png" alt="AgoraSphere">
  </a>
  <div class="nav-search agora-search-shell" id="navSearchWrap">
    <div class="search-active-indicator"></div>
    <input type="text" id="searchInput" placeholder="Search topics, people, or keywords…" aria-label="Search" autocomplete="off">
    <button class="create-btn nav-search-btn" id="searchBtn" type="button" aria-label="Create a discussion">
      <span class="create-icon">${iconSvg("sparkles", 16)}</span>
      <span class="create-label"><span>C</span><span>r</span><span>e</span><span>a</span><span>t</span><span>e</span></span>
    </button>
  </div>
  <div class="nav-auth">
    <a class="nav-search-icon" href="/search" aria-label="Search">${iconSvg("search", 17)}</a>
    <button class="btn-ghost">Log in</button>
    <button class="btn-signup">Sign up</button>
    <button class="nav-messages-btn" id="nav-messages-btn" type="button" aria-label="Messages">
      ${iconSvg("message-circle", 16)}
    </button>
    <!-- Notification bell — React portal target (NotificationsBell.tsx) -->
    <div id="notifBellHost" style="display:flex;align-items:center;"></div>
    <div class="nav-avatar" id="profileAvatarWrap">
      <button class="avatar-btn" id="profileAvatarBtn" aria-label="Profile menu" aria-expanded="false" aria-haspopup="true">
        <div class="avatar-neon-ring"></div>
        <span class="avatar-initial">J</span>
      </button>
      <div class="avatar-dropdown" id="profileDropdown" role="menu">
        <div class="avatar-menu-head" id="avatarMenuHead" style="display:none">
          <span class="avatar-menu-head-name" id="avatarMenuName"></span>
          <span class="avatar-menu-head-sub" id="avatarMenuSub"></span>
        </div>
        <a class="avatar-menu-item" href="#profile" role="menuitem">
          <span class="avatar-menu-icon">${iconSvg("user", 14)}</span>Profile
        </a>
        <a class="avatar-menu-item" href="#settings" role="menuitem">
          <span class="avatar-menu-icon">${iconSvg("settings", 14)}</span>Settings
        </a>
        <a class="avatar-menu-item" href="#friends" role="menuitem">
          <span class="avatar-menu-icon">${iconSvg("users", 14)}</span>Friends
        </a>
        <div class="avatar-dropdown-divider"></div>
        <a class="avatar-menu-item avatar-menu-item--danger" href="#logout" role="menuitem">
          <span class="avatar-menu-icon">${iconSvg("log-out", 14)}</span>Log out
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
        <button class="filter-pill" data-filter-group="format" onclick="_dsFilter(this)">Open Discussion</button>
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
      <div id="discoverySocial"><!-- legacy overlay slot (unused; search lives in the React panel) --></div>
      <div class="results-grid" id="resultsGrid"><!-- cards generated from real rooms by renderDiscoveryCards() --></div><!-- /results-grid -->
    </div><!-- /discovery-results -->
  </div><!-- /discovery-body -->
</div><!-- /discoveryOverlay -->

<!-- ─── SIDEBAR ─── -->
<!-- Sidebar is rendered by React (HomeSidebar.tsx) -->

<!-- ─── MAIN CONTENT ─── -->
<main class="main">

<!-- ─── HOME FEED ─── -->
<div id="homeFeed">

  <!-- CAROUSEL -->
  <section class="carousel-section">
    <div class="carousel-stage" id="carouselStage">
      <div class="carousel-track" id="carouselTrack"></div>
      <button class="carousel-arrow left" id="arrowLeft" aria-label="Previous">${iconSvg("chevron-left", 26, { strokeWidth: 1.5 })}</button>
      <button class="carousel-arrow right" id="arrowRight" aria-label="Next">${iconSvg("chevron-right", 26, { strokeWidth: 1.5 })}</button>
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
    <span class="explore-search-icon">${iconSvg("search", 15)}</span>
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
