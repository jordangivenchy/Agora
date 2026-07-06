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
  <a class="nav-logo" href="#">
    <img src="/logo.png" alt="AgoraSphere">
  </a>
  <div class="nav-search agora-search-shell" id="navSearchWrap">
    <div class="search-active-indicator"></div>
    <input type="text" id="searchInput" placeholder="Search a topic, debater, or motion…" aria-label="Search" autocomplete="off">
    <button class="create-btn nav-search-btn" id="searchBtn" type="button" aria-label="Create debate">
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
    <div class="nav-avatar" id="profileAvatarWrap">
      <button class="avatar-btn" id="profileAvatarBtn" aria-label="Profile menu" aria-expanded="false" aria-haspopup="true">
        <div class="avatar-neon-ring"></div>
        <span class="avatar-initial">J</span>
      </button>
      <div class="avatar-dropdown" id="profileDropdown" role="menu">
        <a class="avatar-menu-item" href="#profile" role="menuitem">
          <span class="avatar-menu-icon">👤</span>Profile
        </a>
        <a class="avatar-menu-item" href="#stats" role="menuitem">
          <span class="avatar-menu-icon">♟</span>My ELO &amp; Stats
        </a>
        <a class="avatar-menu-item" href="#debates" role="menuitem">
          <span class="avatar-menu-icon">📋</span>My Debates
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
<div id="discoveryOverlay" style="display:none" role="dialog" aria-modal="true" aria-label="Search and discover debates">
  <div class="discovery-search-bar">
    <input id="discoveryInput" type="text" placeholder="Search motions, debaters, topics, categories…" autocomplete="off" />
    <button class="discovery-close" id="closeDiscovery" aria-label="Close search">✕</button>
  </div>
  <div class="discovery-body">

    <!-- Filter sidebar -->
    <div class="discovery-filters" id="discoveryFilters">

      <div class="filter-group">
        <span class="filter-group-title">Category</span>
        <button class="filter-pill active" data-filter-group="category" onclick="_dsFilter(this)">All <span class="pill-count">240</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Politics <span class="pill-count">48</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Ethics <span class="pill-count">31</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Economics <span class="pill-count">27</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Science &amp; Tech <span class="pill-count">22</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Philosophy <span class="pill-count">19</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Foreign Policy <span class="pill-count">16</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Culture <span class="pill-count">14</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Sports <span class="pill-count">11</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">Law <span class="pill-count">9</span></button>
        <button class="filter-pill" data-filter-group="category" onclick="_dsFilter(this)">History <span class="pill-count">8</span></button>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-group">
        <span class="filter-group-title">Status</span>
        <button class="filter-pill active" data-filter-group="status" onclick="_dsFilter(this)">All</button>
        <button class="filter-pill" data-filter-group="status" onclick="_dsFilter(this)">🔴 Live now</button>
        <button class="filter-pill" data-filter-group="status" onclick="_dsFilter(this)">⏳ In queue</button>
        <button class="filter-pill" data-filter-group="status" onclick="_dsFilter(this)">🕐 Scheduled</button>
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

      <div class="filter-divider"></div>

      <div class="filter-group">
        <span class="filter-group-title">AR Range</span>
        <div class="ar-filter-row">
          <input class="ar-filter-input" type="number" value="0" placeholder="Min" />
          <span class="ar-filter-sep">—</span>
          <input class="ar-filter-input" type="number" value="3000" placeholder="Max" />
        </div>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-group">
        <span class="filter-group-title">Options</span>
        <div class="filter-toggle-row">
          <span class="filter-toggle-label">Live only</span>
          <div class="mini-toggle" onclick="this.classList.toggle('on');this.querySelector('.knob').style.left=this.classList.contains('on')?'14px':'2px'"><div class="knob"></div></div>
        </div>
        <div class="filter-toggle-row">
          <span class="filter-toggle-label">Open to join</span>
          <div class="mini-toggle on" onclick="this.classList.toggle('on');this.querySelector('.knob').style.left=this.classList.contains('on')?'14px':'2px'"><div class="knob"></div></div>
        </div>
        <div class="filter-toggle-row">
          <span class="filter-toggle-label">Has open queue</span>
          <div class="mini-toggle" onclick="this.classList.toggle('on');this.querySelector('.knob').style.left=this.classList.contains('on')?'14px':'2px'"><div class="knob"></div></div>
        </div>
        <div class="filter-toggle-row">
          <span class="filter-toggle-label">Show AR to opponents</span>
          <div class="mini-toggle on" onclick="this.classList.toggle('on');this.querySelector('.knob').style.left=this.classList.contains('on')?'14px':'2px'"><div class="knob"></div></div>
        </div>
      </div>

    </div><!-- /discovery-filters -->

    <!-- Results -->
    <div class="discovery-results" id="discoveryResults">
      <div class="results-meta" id="resultsMeta">Showing 9 debates</div>
      <div class="results-grid" id="resultsGrid">

        <div class="result-card" data-category="Politics" data-status="live" data-format="Oxford Style" data-language="English">
          <div class="result-card-top">
            <span class="result-status live">● LIVE</span>
            <span class="result-category">Politics</span>
          </div>
          <div class="result-motion">"Free speech has no absolute limits"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#1976D2">PT</div>
            <span class="debater-name">PhilosophyTube</span>
            <span class="vs-badge">VS</span>
            <div class="debater-avatar" style="background:#e65c00">D</div>
            <span class="debater-name">Destiny</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">👁 4.7K watching</span>
            <span class="result-meta-item">🎙 Oxford Style</span>
            <span class="result-meta-item">🌐 English</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Watch</button>
            <button class="result-btn join">Join as debater</button>
          </div>
        </div>

        <div class="result-card" data-category="Economics" data-status="queue" data-format="1v1" data-language="English">
          <div class="result-card-top">
            <span class="result-status queue">⏳ IN QUEUE</span>
            <span class="result-category">Economics</span>
          </div>
          <div class="result-motion">"Universal Basic Income would destroy work ethic"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#0f6e56">H</div>
            <span class="debater-name">HasanAbi</span>
            <span class="vs-badge">VS</span>
            <span class="debater-name" style="color:rgba(255,255,255,0.25)">Waiting for opponent…</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">👥 3 in queue</span>
            <span class="result-meta-item">🎙 1v1</span>
            <span class="result-meta-item">~2 min wait</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Spectate</button>
            <button class="result-btn queue-join">Join Queue</button>
          </div>
        </div>

        <div class="result-card" data-category="Ethics" data-status="scheduled" data-format="Oxford Style" data-language="English">
          <div class="result-card-top">
            <span class="result-status scheduled">🕐 SCHEDULED</span>
            <span class="result-category">Ethics</span>
          </div>
          <div class="result-motion">"AI cannot be held morally responsible for its actions"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#533ab7">CD</div>
            <span class="debater-name">CosmosDebate</span>
            <span class="vs-badge">VS</span>
            <div class="debater-avatar" style="background:#854f0b">LE</div>
            <span class="debater-name">LegalEagle</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">📅 Tomorrow 8PM</span>
            <span class="result-meta-item">🎙 Oxford Style</span>
            <span class="result-meta-item">🌐 English</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Set reminder</button>
            <button class="result-btn join">Register to debate</button>
          </div>
        </div>

        <div class="result-card" data-category="Science & Tech" data-status="live" data-format="Open Debate" data-language="English">
          <div class="result-card-top">
            <span class="result-status live">● LIVE</span>
            <span class="result-category">Science &amp; Tech</span>
          </div>
          <div class="result-motion">"AI will eliminate more jobs than it creates within a decade"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#00cec9">TR</div>
            <span class="debater-name">TechRealist</span>
            <span class="vs-badge">VS</span>
            <div class="debater-avatar" style="background:#64B5F6">AO</div>
            <span class="debater-name">AIOptimist</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">👁 2.1K watching</span>
            <span class="result-meta-item">🎙 Open Debate</span>
            <span class="result-meta-item">🌐 English</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Watch</button>
            <button class="result-btn join">Join as debater</button>
          </div>
        </div>

        <div class="result-card" data-category="Philosophy" data-status="queue" data-format="Oxford Style" data-language="Spanish">
          <div class="result-card-top">
            <span class="result-status queue">⏳ IN QUEUE</span>
            <span class="result-category">Philosophy</span>
          </div>
          <div class="result-motion">"Free will is an illusion incompatible with determinism"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#6c3483">KM</div>
            <span class="debater-name">KairosMind</span>
            <span class="vs-badge">VS</span>
            <span class="debater-name" style="color:rgba(255,255,255,0.25)">Waiting for opponent…</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">👥 1 in queue</span>
            <span class="result-meta-item">🎙 Oxford Style</span>
            <span class="result-meta-item">🌐 Spanish</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Spectate</button>
            <button class="result-btn queue-join">Join Queue</button>
          </div>
        </div>

        <div class="result-card" data-category="Foreign Policy" data-status="live" data-format="Panel (2v2)" data-language="English">
          <div class="result-card-top">
            <span class="result-status live">● LIVE</span>
            <span class="result-category">Foreign Policy</span>
          </div>
          <div class="result-motion">"NATO expansion destabilizes more than it secures"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#1976D2">GM</div>
            <span class="debater-name">GlobalMarket</span>
            <span class="vs-badge">VS</span>
            <div class="debater-avatar" style="background:#c0392b">CB</div>
            <span class="debater-name">CosmosDebate</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">👁 890 watching</span>
            <span class="result-meta-item">🎙 Panel (2v2)</span>
            <span class="result-meta-item">🌐 English</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Watch</button>
            <button class="result-btn join">Join as debater</button>
          </div>
        </div>

        <div class="result-card" data-category="Culture" data-status="scheduled" data-format="1v1" data-language="English">
          <div class="result-card-top">
            <span class="result-status scheduled">🕐 SCHEDULED</span>
            <span class="result-category">Culture</span>
          </div>
          <div class="result-motion">"Cancel culture strengthens accountability norms"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#636e72">SN</div>
            <span class="debater-name">Sneako</span>
            <span class="vs-badge">VS</span>
            <div class="debater-avatar" style="background:#fd79a8">PT</div>
            <span class="debater-name">PhilosophyTube</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">📅 Sat 1:00 PM ET</span>
            <span class="result-meta-item">🎙 1v1</span>
            <span class="result-meta-item">🌐 English</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Set reminder</button>
            <button class="result-btn join">Register to debate</button>
          </div>
        </div>

        <div class="result-card" data-category="Law" data-status="live" data-format="Open Debate" data-language="English">
          <div class="result-card-top">
            <span class="result-status live">● LIVE</span>
            <span class="result-category">Law</span>
          </div>
          <div class="result-motion">"Jury trials should be abolished for complex financial crimes"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#e2b96b">LE</div>
            <span class="debater-name">LegalEagle</span>
            <span class="vs-badge">VS</span>
            <div class="debater-avatar" style="background:#00b894">CV</div>
            <span class="debater-name">CivicVoice</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">👁 1.3K watching</span>
            <span class="result-meta-item">🎙 Open Debate</span>
            <span class="result-meta-item">🌐 English</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Watch</button>
            <button class="result-btn join">Join as debater</button>
          </div>
        </div>

        <div class="result-card" data-category="History" data-status="queue" data-format="Oxford Style" data-language="French">
          <div class="result-card-top">
            <span class="result-status queue">⏳ IN QUEUE</span>
            <span class="result-category">History</span>
          </div>
          <div class="result-motion">"The French Revolution did more harm than good in the long run"</div>
          <div class="result-debaters">
            <div class="debater-avatar" style="background:#2980b9">PN</div>
            <span class="debater-name">PoliticsNow</span>
            <span class="vs-badge">VS</span>
            <span class="debater-name" style="color:rgba(255,255,255,0.25)">Waiting for opponent…</span>
          </div>
          <div class="result-meta-row">
            <span class="result-meta-item">👥 2 in queue</span>
            <span class="result-meta-item">🎙 Oxford Style</span>
            <span class="result-meta-item">🌐 French</span>
          </div>
          <div class="result-actions">
            <button class="result-btn watch">Spectate</button>
            <button class="result-btn queue-join">Join Queue</button>
          </div>
        </div>

      </div><!-- /results-grid -->
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

      <!-- Dashboard (hero nav item) — bar-chart preview, multicolor -->
      <a class="sidebar-link dashboard-btn" href="#" data-nav-id="dashboard">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:12px;font-weight:500;color:rgba(255,255,255,0.55);">Dashboard</span>
          <span style="color:rgba(162,155,254,0.7);font-size:11px;">→</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;align-items:flex-end;">
          <div style="width:24px;height:22px;border-radius:6px;background:linear-gradient(180deg,rgba(142,249,252,0.6),rgba(142,249,252,0.22));border:0.5px solid rgba(142,249,252,0.35);"></div>
          <div style="width:24px;height:35px;border-radius:6px;background:linear-gradient(180deg,rgba(142,252,157,0.6),rgba(142,252,157,0.22));border:0.5px solid rgba(142,252,157,0.35);"></div>
          <div style="width:24px;height:28px;border-radius:6px;background:linear-gradient(180deg,rgba(252,252,142,0.6),rgba(252,252,142,0.22));border:0.5px solid rgba(252,252,142,0.35);"></div>
          <div style="width:24px;height:40px;border-radius:6px;background:linear-gradient(180deg,rgba(252,208,142,0.6),rgba(252,208,142,0.22));border:0.5px solid rgba(252,208,142,0.35);"></div>
          <div style="width:24px;height:32px;border-radius:6px;background:linear-gradient(180deg,rgba(204,142,252,0.6),rgba(204,142,252,0.22));border:0.5px solid rgba(204,142,252,0.35);"></div>
        </div>
      </a>

      <!-- Communities -->
      <a class="sidebar-link" href="#" data-nav-id="communities" style="margin-top:8px;">
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
  </section>

  <!-- BROWSE -->
  <section class="browse-section">
    <div class="browse-heading">Browse</div>
    <div class="category-row" id="categoryRow" role="group" aria-label="Browse by topic"></div>
    <div class="topic-strip" id="topicStrip" aria-live="polite"></div>
  </section>

  <!-- TWO-COLUMN LOWER -->
  <div class="content-lower">
    <div class="debates-col">
      <div class="section-header">
        <div class="section-title" id="gridTitle">Live Debates</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="search-result-count" id="searchResultCount"></span>
          <a class="view-all" href="#">View all →</a>
        </div>
      </div>
      <div class="debate-grid" id="debateGrid"></div>
    </div>
    <div class="elo-col">
      <div class="elo-module" id="eloModule"></div>
    </div>
  </div>

</div><!-- /homeFeed -->

<!-- ─── EXPLORE PAGE ─── -->
<div id="explorePage" style="display:none;">

  <!-- Banner -->
  <div class="explore-banner">
    <div class="explore-banner-text">
      <h1 class="explore-title">Explore Debates</h1>
      <p class="explore-subtitle">Find live rooms, join a queue, or register for upcoming debates</p>
    </div>
    <div class="explore-banner-stats">
      <div class="explore-stat">
        <span class="explore-stat-val">240</span>
        <span class="explore-stat-label">Active rooms</span>
      </div>
      <div class="explore-stat">
        <span class="explore-stat-val">1,847</span>
        <span class="explore-stat-label">Debaters online</span>
      </div>
      <div class="explore-stat">
        <span class="explore-stat-val">38K</span>
        <span class="explore-stat-label">Watching now</span>
      </div>
    </div>
  </div>

  <!-- Search bar -->
  <div class="explore-search-wrap">
    <span class="explore-search-icon">⌕</span>
    <input id="exploreSearchInput" class="explore-search-input" type="text"
      placeholder="Search motions, debaters, topics, keywords…" autocomplete="off" />
  </div>

  <!-- Filter bar -->
  <div class="explore-filter-bar">

    <div class="explore-filter-group">
      <span class="explore-filter-group-label">Category</span>
      <div class="explore-filter-pills" id="epCategoryFilter">
        <button class="explore-pill active" onclick="_epFilter(this,'category')">All</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Politics</button>
        <button class="explore-pill" onclick="_epFilter(this,'category')">Ethics</button>
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
          <button class="explore-pill"           onclick="_epFilter(this,'status')">⏳ Queue</button>
          <button class="explore-pill"           onclick="_epFilter(this,'status')">🕐 Scheduled</button>
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

      <div class="explore-filter-group-inline">
        <span class="explore-filter-group-label">AR Range</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <input class="explore-ar-input" id="epArMin" type="number" value="0" placeholder="Min" />
          <span style="color:rgba(255,255,255,0.2);font-size:12px;">—</span>
          <input class="explore-ar-input" id="epArMax" type="number" value="3000" placeholder="Max" />
        </div>
      </div>

      <div class="explore-filter-group-inline">
        <span class="explore-filter-group-label">Options</span>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label class="explore-toggle-label">
            <div class="mini-toggle-e" onclick="this.classList.toggle('on');this.querySelector('.knob').style.left=this.classList.contains('on')?'14px':'2px';_epApplyFilters()"><div class="knob"></div></div>
            <span>Live only</span>
          </label>
          <label class="explore-toggle-label">
            <div class="mini-toggle-e on" onclick="this.classList.toggle('on');this.querySelector('.knob').style.left=this.classList.contains('on')?'14px':'2px';_epApplyFilters()"><div class="knob"></div></div>
            <span>Open to join</span>
          </label>
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
<div class="modal-overlay" id="debateModal" style="display:none;" role="dialog" aria-modal="true" aria-label="Debate Room">
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
