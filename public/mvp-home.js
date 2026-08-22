// ═══════════════════════════════════════════════
//  DATA REGISTRY
// ═══════════════════════════════════════════════

const TOPICS = {
  'politics-law': {
    label: 'Politics (Law)',
    emoji: '⚖️',
    accent: '#4a9eff',
    accentRgb: '74,158,255',
    description: 'Constitutional law, civil rights, court rulings, criminal justice, regulation',
  },
  'politics-ethics': {
    label: 'Politics (Ethics)',
    emoji: '🙏',
    accent: '#fd79a8',
    accentRgb: '253,121,168',
    description: 'Censorship, moral legitimacy, fairness, surveillance, distributive justice',
  },
  'sports': {
    label: 'Sports',
    emoji: '🏆',
    accent: '#fd9644',
    accentRgb: '253,150,68',
    description: 'Athlete ethics, governance, performance enhancement, sports economics',
  },
  'culture': {
    label: 'Culture',
    emoji: '🎭',
    accent: '#e056b8',
    accentRgb: '224,86,184',
    description: 'Media, identity, representation, art, social norms, pop culture',
  },
  'economics': {
    label: 'Economics',
    emoji: '💰',
    accent: '#00b894',
    accentRgb: '0,184,148',
    description: 'Labor markets, trade policy, inequality, monetary policy, UBI, housing',
  },
  'science-tech': {
    label: 'Science & Tech',
    emoji: '🔬',
    accent: '#00cec9',
    accentRgb: '0,206,201',
    description: 'AI, biotech, privacy, automation, energy, scientific consensus',
  },
  'foreign-policy': {
    label: 'Foreign Policy',
    emoji: '🌍',
    accent: '#1976D2',
    accentRgb: '25,118,210',
    description: 'War, diplomacy, sanctions, alliances, borders, international law',
  },
  'philosophy': {
    label: 'Philosophy',
    emoji: '📚',
    accent: '#fdcb6e',
    accentRgb: '253,203,110',
    description: 'Ethics, epistemology, free will, consciousness, truth, personhood',
  },
};

// Demo leaderboard removed — no rating system yet, so the module shows
// its empty state until real ratings exist.
const DEBATERS = [];

// Populated with real rooms by mvp-adapter.js (applyData). Empty until
// data lands — the grid and carousel render their empty states.
const DEBATES = [];

const UPCOMING = [
  { motion: 'Should AI systems be granted legal personhood?',         topicKey: 'science-tech',    secondaryTopics: ['philosophy','politics-law'],   scheduledAt: 'Today · 4:00 PM ET',  debater1: 'TechRealist',  color1: '#00cec9', debater2: 'LegalEagle',     color2: '#e2b96b' },
  { motion: 'Universal healthcare is economically viable in the US',  topicKey: 'economics',       secondaryTopics: ['politics-ethics'],              scheduledAt: 'Today · 6:30 PM ET',  debater1: 'EconDebater',  color1: '#55efc4', debater2: 'FuturePolicy',   color2: '#4a9eff' },
  { motion: 'NATO expansion destabilizes more than it secures',       topicKey: 'foreign-policy',  secondaryTopics: ['politics-law'],                 scheduledAt: 'Tomorrow · 2:00 PM',  debater1: 'CosmosDebate', color1: '#4a9eff', debater2: 'GlobalMarket',   color2: '#1976D2' },
  { motion: 'Affirmative action violates equal protection',           topicKey: 'politics-law',    secondaryTopics: ['politics-ethics'],              scheduledAt: 'Tomorrow · 5:00 PM',  debater1: 'LegalEagle',   color1: '#e2b96b', debater2: 'CivicDebater',   color2: '#fd79a8' },
  { motion: 'Social media platforms should be public utilities',      topicKey: 'politics-ethics', secondaryTopics: ['politics-law','culture'],       scheduledAt: 'Thu · 7:00 PM ET',    debater1: 'Sneako',       color1: '#b2bec3', debater2: 'PhilosophyTube', color2: '#fd79a8' },
  { motion: 'Colonialism explains more than it obscures in history',  topicKey: 'philosophy',      secondaryTopics: ['foreign-policy','culture'],     scheduledAt: 'Fri · 3:00 PM ET',    debater1: 'KairosMind',   color1: '#64B5F6', debater2: 'PhilosophyTube', color2: '#fd79a8' },
  { motion: 'The Olympics should ban political protests',             topicKey: 'sports',          secondaryTopics: ['politics-ethics'],              scheduledAt: 'Fri · 5:00 PM ET',    debater1: 'SportsDebater',color1: '#fd9644', debater2: 'CivicVoice',     color2: '#4a9eff' },
  { motion: 'Cancel culture strengthens accountability norms',        topicKey: 'culture',         secondaryTopics: ['politics-ethics'],              scheduledAt: 'Sat · 1:00 PM ET',    debater1: 'Sneako',       color1: '#b2bec3', debater2: 'KairosMind',     color2: '#64B5F6' },
];

const SIDEBAR_CHANNELS = [];

// Rebuilt from real rooms by mvp-adapter.js.
const CAROUSEL_DATA = [];

// ═══════════════════════════════════════════════
//  PHASE 2: ARGUMENT DATA
// ═══════════════════════════════════════════════

const DEBATE_ARGS = [
  // 0: Social media causes teen depression
  [
    { side: 'pro', debater: 'Destiny',   color: '#00b894', time: '14:32', text: 'Instagram\'s internal research showed a 13% increase in self-harm ideation among heavy users. The causal link is clear.' },
    { side: 'con', debater: 'KairosMind',color: '#64B5F6', time: '14:35', text: 'Correlation ≠ causation. Depression rates were already climbing before social media. We need to control for confounds.' },
    { side: 'pro', debater: 'Destiny',   color: '#00b894', time: '14:41', text: 'Social comparison algorithms are deliberately engineered to maximize engagement regardless of psychological harm.' },
    { side: 'con', debater: 'KairosMind',color: '#64B5F6', time: '14:44', text: 'The same teens who suffer offline isolation show worse outcomes. This is a social problem, not a platform problem.' },
    { side: 'pro', debater: 'Destiny',   color: '#00b894', time: '14:50', text: 'Platforms profit from outrage cycles. The incentive structure is fundamentally misaligned with user wellbeing.' },
    { side: 'con', debater: 'KairosMind',color: '#64B5F6', time: '14:53', text: 'Blaming platforms obscures the real policy levers: school counseling, family support, economic security.' },
  ],
  // 1: Affirmative action is constitutional
  [
    { side: 'pro', debater: 'LegalEagle',      color: '#e2b96b', time: '11:15', text: 'Grutter v. Bollinger upheld race-conscious admissions for educational diversity under strict scrutiny. Compelling interest exists.' },
    { side: 'con', debater: 'SocraticDebates', color: '#4a9eff', time: '11:19', text: 'SFFA v. Harvard overturned Grutter. The Court found no workable end point — programs violate the Equal Protection Clause.' },
    { side: 'pro', debater: 'LegalEagle',      color: '#e2b96b', time: '11:25', text: 'The majority opinion left open race-neutral alternatives that achieve equivalent diversity outcomes.' },
    { side: 'con', debater: 'SocraticDebates', color: '#4a9eff', time: '11:29', text: 'The 14th Amendment is colorblind. State actors cannot use race as a sorting mechanism, full stop.' },
    { side: 'pro', debater: 'LegalEagle',      color: '#e2b96b', time: '11:34', text: 'Historical injustice requires targeted remediation. Abstract colorblindness perpetuates structural inequity.' },
    { side: 'con', debater: 'SocraticDebates', color: '#4a9eff', time: '11:38', text: 'Redistribution via race risks stigmatizing beneficiaries and entrenching identity politics in legal frameworks.' },
  ],
  // 2: UBI would destroy work ethic
  [
    { side: 'pro', debater: 'EconDebater', color: '#e17055', time: '09:10', text: 'Mankiw\'s labor supply analysis: guaranteed income reduces the marginal utility of labor. Hours worked decline meaningfully.' },
    { side: 'con', debater: 'FuturePolicy', color: '#00cec9', time: '09:13', text: 'Finland\'s 2017 pilot showed no significant drop in employment rates. People found purpose in work beyond money.' },
    { side: 'pro', debater: 'EconDebater', color: '#e17055', time: '09:19', text: 'A small pilot in a high-trust welfare state generalizes poorly to the US labor market.' },
    { side: 'con', debater: 'FuturePolicy', color: '#00cec9', time: '09:23', text: 'Stockton\'s SEED program: full-time employment rose among recipients. UBI enabled job-seeking, not idleness.' },
    { side: 'pro', debater: 'EconDebater', color: '#e17055', time: '09:28', text: 'Neither pilot was truly universal or unconditional at scale. Cherry-picked selection effects dominate.' },
    { side: 'con', debater: 'FuturePolicy', color: '#00cec9', time: '09:32', text: 'The "work ethic" framing is a moral panic. People derive identity from contribution regardless of cash transfers.' },
  ],
  // 3: Nuclear is greener than solar
  [
    { side: 'pro', debater: 'ScienceMatters', color: '#4a9eff', time: '16:05', text: 'Lifecycle CO₂: nuclear ~12g/kWh vs solar ~40g/kWh. Nuclear wins on carbon intensity per unit of energy.' },
    { side: 'con', debater: 'GreenFuture',    color: '#00b894', time: '16:09', text: 'Solar costs have dropped 90% in a decade. Nuclear construction timelines average 14 years with massive cost overruns.' },
    { side: 'pro', debater: 'ScienceMatters', color: '#4a9eff', time: '16:14', text: 'Solar\'s intermittency requires storage or gas backup, which inflates the true carbon cost per reliable kWh.' },
    { side: 'con', debater: 'GreenFuture',    color: '#00b894', time: '16:18', text: 'Battery storage costs have also plummeted. Grid-scale projects are now cost-competitive with baseload nuclear.' },
    { side: 'pro', debater: 'ScienceMatters', color: '#4a9eff', time: '16:24', text: 'Land use: nuclear occupies ~3 km² per GW. Utility solar requires ~75 km². Density matters for biodiversity.' },
    { side: 'con', debater: 'GreenFuture',    color: '#00b894', time: '16:27', text: 'Waste storage: spent nuclear fuel remains hazardous for 10,000 years. No permanent disposal solution exists.' },
  ],
  // 4: Free trade hurts American workers
  [
    { side: 'pro', debater: 'TradeRealist', color: '#fd79a8', time: '13:20', text: 'Autor, Dorn & Hanson quantified the China shock: 2.4M US manufacturing jobs lost, with no reemployment in affected regions.' },
    { side: 'con', debater: 'GlobalMarket', color: '#e2b96b', time: '13:24', text: 'Lower consumer prices from trade save the median household $1,500/year. The gains are real but diffuse.' },
    { side: 'pro', debater: 'TradeRealist', color: '#fd79a8', time: '13:30', text: 'Diffuse gains vs. concentrated geographic losses create political instability. The aggregate GDP figure hides devastation.' },
    { side: 'con', debater: 'GlobalMarket', color: '#e2b96b', time: '13:34', text: 'The solution is redistribution policy, not protectionism. Trade adjustment assistance has structural merit.' },
    { side: 'pro', debater: 'TradeRealist', color: '#fd79a8', time: '13:39', text: 'TAA programs historically reach less than 10% of displaced workers. The policy theory doesn\'t survive contact with reality.' },
    { side: 'con', debater: 'GlobalMarket', color: '#e2b96b', time: '13:42', text: 'Tariffs are a tax on domestic consumers and exporters. Protectionism invites retaliation that costs more jobs net.' },
  ],
  // 5: Democracy is failing in the West
  [
    { side: 'pro', debater: 'PoliticsNow',  color: '#1976D2', time: '20:05', text: 'Freedom House data: democratic backsliding in 73 countries including Hungary, Poland, and the US for 15 consecutive years.' },
    { side: 'con', debater: 'CivicDebater', color: '#e17055', time: '20:09', text: 'Western institutions survived Trump, Brexit, Orbán. Democratic resilience is precisely the story being missed.' },
    { side: 'pro', debater: 'PoliticsNow',  color: '#1976D2', time: '20:15', text: 'Courts are being captured, electoral systems gamed, and media ecosystems fragmented beyond repair.' },
    { side: 'con', debater: 'CivicDebater', color: '#e17055', time: '20:19', text: 'Independent judiciaries blocked most democratic erosion attempts. The checks and balances worked as designed.' },
    { side: 'pro', debater: 'PoliticsNow',  color: '#1976D2', time: '20:25', text: 'Trust in democratic institutions is at all-time lows across OECD nations. Legitimacy crisis is real.' },
    { side: 'con', debater: 'CivicDebater', color: '#e17055', time: '20:28', text: 'Low trust reflects healthy skepticism, not failure. High trust in government correlates with authoritarianism.' },
  ],
  // 6: AI will eliminate more jobs than it creates
  [
    { side: 'pro', debater: 'TechRealist', color: '#00cec9', time: '15:00', text: 'McKinsey: 375 million workers face displacement by 2030. Cognitive task automation is qualitatively different from prior waves.' },
    { side: 'con', debater: 'AIOptimist',  color: '#64B5F6', time: '15:04', text: 'Every technological revolution created net employment. The Luddite fallacy resurfaces with each new wave of automation.' },
    { side: 'pro', debater: 'TechRealist', color: '#00cec9', time: '15:10', text: 'Speed of displacement is unprecedented. Past transitions took decades; AI is restructuring cognitive labor in years.' },
    { side: 'con', debater: 'AIOptimist',  color: '#64B5F6', time: '15:14', text: 'AI augments human workers. Radiologists using AI diagnose faster and more accurately — they aren\'t replaced.' },
    { side: 'pro', debater: 'TechRealist', color: '#00cec9', time: '15:20', text: 'Augmentation works at the frontier. Routine clerical, legal research, and customer service roles are already hollowing out.' },
    { side: 'con', debater: 'AIOptimist',  color: '#64B5F6', time: '15:24', text: 'New industries emerge: AI trainers, auditors, ethicists, and the countless roles we haven\'t yet imagined.' },
  ],
  // 7: Ranked choice voting
  [
    { side: 'pro', debater: 'ElectionWatch', color: '#4a9eff', time: '18:10', text: 'RCV eliminates the spoiler effect and allows voters to express true preferences without strategic compromise.' },
    { side: 'con', debater: 'VotingRights',  color: '#fd79a8', time: '18:14', text: 'Maine 2018: 8,000 ballots exhausted. Voters who ranked only one candidate were disenfranchised in later rounds.' },
    { side: 'pro', debater: 'ElectionWatch', color: '#4a9eff', time: '18:20', text: 'Ballot exhaustion reflects voter choice. Mandating preference ranking also works, as in Australian federal elections.' },
    { side: 'con', debater: 'VotingRights',  color: '#fd79a8', time: '18:24', text: 'Complexity disproportionately affects low-literacy and elderly voters. Simple systems maximize participation equity.' },
    { side: 'pro', debater: 'ElectionWatch', color: '#4a9eff', time: '18:30', text: 'Alaska 2022 showed higher turnout and cross-partisan support under RCV. The participation data refutes the complexity claim.' },
    { side: 'con', debater: 'VotingRights',  color: '#fd79a8', time: '18:33', text: 'Delayed results undermine trust. When winner isn\'t known election night, conspiracy theories fill the vacuum.' },
  ],
];

// ═══════════════════════════════════════════════
//  PHASE 2: VOTE DATA STATE
//  voteCounts[i] = { pro: number, con: number }
//  userVotes[i]  = 'pro' | 'con' | null
// ═══════════════════════════════════════════════

// Rebuilt from real votes by mvp-adapter.js.
const INITIAL_VOTES = [];

let voteCounts = INITIAL_VOTES.map(v => ({ pro: v.pro, con: v.con }));
let userVotes  = new Array(DEBATES.length).fill(null);

// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════

let currentSlide    = 0;
let autoPlayTimer   = null;
let activeTopicKey  = 'all';
let eloScope        = 'global';  // 'global' | 'topic'
let searchQuery     = '';
let modalOpenIndex  = -1;

// ═══════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════

function getTopicDebateCount(key) {
  if (key === 'all') return DEBATES.length;
  return DEBATES.filter(d => d.topicKey === key || (d.secondaryTopics && d.secondaryTopics.includes(key))).length;
}

function getTopicViewerSum(key) {
  if (key === 'all') return DEBATES.reduce((s, d) => s + d.viewersNum, 0);
  return DEBATES.filter(d => d.topicKey === key || (d.secondaryTopics && d.secondaryTopics.includes(key)))
    .reduce((s, d) => s + d.viewersNum, 0);
}

function getTrendingTopicKey() {
  let best = null, bestSum = -1;
  Object.keys(TOPICS).forEach(k => {
    const s = getTopicViewerSum(k);
    if (s > bestSum) { bestSum = s; best = k; }
  });
  return best;
}

function getHotMotion(key) {
  const pool = key === 'all'
    ? DEBATES
    : DEBATES.filter(d => d.topicKey === key || (d.secondaryTopics && d.secondaryTopics.includes(key)));
  if (!pool.length) return null;
  return pool.reduce((a, b) => a.viewersNum > b.viewersNum ? a : b);
}

function getRisingDebater(key) {
  const pool = key === 'all'
    ? DEBATERS.filter(d => d.trendDir === 'up')
    : DEBATERS.filter(d => d.trendDir === 'up' && d.topicKeys.includes(key));
  if (!pool.length) return null;
  return pool.reduce((a, b) => b.trendDelta > a.trendDelta ? b : a);
}

function getFilteredDebates(key) {
  if (key === 'all') return DEBATES;
  return DEBATES.filter(d => d.topicKey === key || (d.secondaryTopics && d.secondaryTopics.includes(key)));
}

function getFilteredUpcoming(key) {
  if (key === 'all') return UPCOMING.slice(0, 3);
  return UPCOMING.filter(u => u.topicKey === key || (u.secondaryTopics && u.secondaryTopics.includes(key)));
}

function trendIcon(dir, delta) {
  if (dir === 'up')   return `<span class="elo-trend up">▲ ${delta}</span>`;
  if (dir === 'down') return `<span class="elo-trend down">▼ ${Math.abs(delta)}</span>`;
  return `<span class="elo-trend flat">—</span>`;
}

function rankClass(i) {
  if (i === 0) return 'gold';
  if (i === 1) return 'silver';
  if (i === 2) return 'bronze';
  return '';
}

function fmtNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function getVotePct(index) {
  const v = voteCounts[index];
  const total = v.pro + v.con;
  if (!total) return { pro: 50, con: 50 };
  return { pro: Math.round(v.pro / total * 100), con: Math.round(v.con / total * 100) };
}

// ═══════════════════════════════════════════════
//  PHASE 2: SEARCH
// ═══════════════════════════════════════════════

function getSearchResults(query) {
  if (!query.trim()) return null;
  const q = query.toLowerCase();
  return DEBATES.map((d, i) => ({ d, i })).filter(({ d }) =>
    d.motion.toLowerCase().includes(q) ||
    d.debater1.toLowerCase().includes(q) ||
    d.debater2.toLowerCase().includes(q) ||
    (TOPICS[d.topicKey]?.label || '').toLowerCase().includes(q) ||
    (d.subTags || []).some(t => t.toLowerCase().includes(q))
  );
}

// ═══════════════════════════════════════════════
//  CAROUSEL
// ═══════════════════════════════════════════════

// News headlines come from an external API — escape before innerHTML.
/* "Live for 14m" / "Live for 1h 20m" from a start timestamp. */
function liveForLabel(iso) {
  if (!iso) return ' now';
  const ms = Date.now() - Date.parse(iso);
  if (!(ms > 0)) return ' now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return ' now';
  if (m < 60) return ` for ${m}m`;
  const h = Math.floor(m / 60);
  return ` for ${h}h ${m % 60}m`;
}

function escHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// News slide (kind: 'news', pushed by mvp-adapter): headline + the outlets
// reporting the story; side panel lists coverage instead of a debater.
function newsSlideHTML(c, i, total) {
  const chips = (c.sources || []).slice(0, 4).map(s => `
    <span class="carousel-news-chip">
      ${s.domain ? `<img src="https://www.google.com/s2/favicons?domain=${escHTML(s.domain)}&sz=32" alt="" width="13" height="13" />` : ''}
      ${escHTML(s.name)}
    </span>`).join('');
  const rows = (c.sources || []).slice(0, 5).map(s => `
    <div class="panel-outlet-row">
      ${s.domain ? `<img src="https://www.google.com/s2/favicons?domain=${escHTML(s.domain)}&sz=32" alt="" width="14" height="14" />` : ''}
      <span>${escHTML(s.name)}</span>
    </div>`).join('');
  const hasUrl = !!(c.url && /^https:\/\//.test(c.url));
  const img = c.imageUrl
    ? `<img class="carousel-news-img" src="${escHTML(c.imageUrl)}" alt="" loading="eager" decoding="async"
         onerror="this.remove()" />`
    : '';
  return `
    <div class="carousel-item news" role="group" aria-label="Slide ${i+1} of ${total}">
      <div class="carousel-bg" style="background:${c.gradient};">${img}</div>
      <div class="carousel-news-shade"></div>
      <div class="carousel-lower-third">
        <div class="carousel-motion">${escHTML(c.headline)}</div>
        <div class="carousel-news-chips">${chips}</div>
      </div>
      <div class="carousel-panel carousel-news-card">
        <div class="carousel-news-byline">
          <span class="panel-name">Reported by</span>
          <div class="panel-outlets">${rows}</div>
        </div>
        ${c.summary ? `<p class="carousel-news-summary">${escHTML(c.summary)}</p>` : ''}
        ${hasUrl ? `<button class="carousel-watch-btn carousel-news-btn" data-url="${escHTML(c.url)}">Read article at ${escHTML((c.sources && c.sources[0] && c.sources[0].name) || 'source')} ↗</button>` : ''}
      </div>
    </div>`;
}

function renderCarousel() {
  const track = document.getElementById('carouselTrack');
  const dots  = document.getElementById('carouselDots');

  // Nothing at all (no rooms, no news): hide the hero strip.
  const cSection = document.querySelector('.carousel-section');
  if (cSection) cSection.style.display = CAROUSEL_DATA.length ? '' : 'none';

  const slideHTML = (c, i) => c.kind === 'news'
    ? newsSlideHTML(c, i, CAROUSEL_DATA.length)
    : `
    <div class="carousel-item${c.thumbnailUrl ? ' has-thumb' : ''}" role="group" aria-label="Slide ${i+1} of ${CAROUSEL_DATA.length}">
      <div class="carousel-bg" style="background:${c.gradient};">${c.thumbnailUrl
        ? `<img class="carousel-room-backdrop" src="${escHTML(c.thumbnailUrl)}" alt="" aria-hidden="true" onerror="this.closest('.carousel-item').classList.remove('has-thumb'); this.remove();" />`
        : ''}</div>
      <div class="carousel-bg-grid"></div>
      ${c.thumbnailUrl ? `<img class="carousel-room-thumb" src="${escHTML(c.thumbnailUrl)}" alt="" onerror="this.remove()" />` : ''}
      <div class="carousel-live-badge"><div class="carousel-live-dot"></div> Live</div>
      <div class="carousel-lower-third">
        <div class="carousel-motion">"${escHTML(c.motion)}"</div>
      </div>
      <div class="carousel-panel carousel-room-panel">
        <div class="room-panel-kicker"><span class="room-panel-livedot"></span>Live${liveForLabel(c.liveSince)}</div>
        <div class="room-panel-watching">${c.speakerCount || 0} speaker${c.speakerCount === 1 ? '' : 's'} · ${c.audienceCount || 0} in the audience</div>
        <div class="room-panel-facts">
          <span class="room-panel-chip" style="--chip:${escHTML((TOPICS[c.topicKey] || {}).accent || '#4a9eff')};">${escHTML((TOPICS[c.topicKey] || {}).label || 'Discussion')}</span>
          ${(c.secondaryTopics || []).slice(0, 2).map(k => TOPICS[k] ? `<span class="room-panel-chip" style="--chip:${escHTML(TOPICS[k].accent)};">${escHTML(TOPICS[k].label)}</span>` : '').join('')}
          <span class="room-panel-chip">${escHTML(c.format || 'Open')}</span>
          ${c.language ? `<span class="room-panel-chip">${escHTML(c.language)}</span>` : ''}
        </div>
        <div class="room-panel-label">Speakers</div>
        <div class="room-panel-speakers">
          <div class="room-panel-speaker">
            <div class="panel-avatar small" style="background:${escHTML(c.color)};">${escHTML(c.initials)}</div>
            <div class="room-panel-speaker-name">${escHTML(c.debater)}</div>
          </div>
          ${c.debater2 && c.debater2 !== 'Open seat' ? `<div class="room-panel-speaker">
            <div class="panel-avatar small" style="background:${escHTML(c.color2 || '#4a9eff')};">${escHTML(c.initials2)}</div>
            <div class="room-panel-speaker-name">${escHTML(c.debater2)}</div>
          </div>` : ''}
        </div>
        ${c.community ? `<div class="room-panel-host">hosted by <span class="room-panel-community" style="--chip:${escHTML(c.communityColor || '#4a9eff')};">${escHTML(c.community)}</span></div>` : ''}
        <button class="carousel-watch-btn room-panel-watch" data-debate-index="${c.debateIndex}">▶ Watch Live</button>
      </div>
    </div>
  `;

  // Infinite loop: a clone of the last slide leads and a clone of the
  // first trails, so both directions can animate one step past the ends;
  // goToSlide() snaps back (transition off) once that animation lands.
  const N = CAROUSEL_DATA.length;
  track.innerHTML = N > 1
    ? slideHTML(CAROUSEL_DATA[N - 1], N - 1)
      + CAROUSEL_DATA.map(slideHTML).join('')
      + slideHTML(CAROUSEL_DATA[0], 0)
    : CAROUSEL_DATA.map(slideHTML).join('');

  // Land on the current slide without animating (offset +1 for the clone).
  currentSlide = Math.min(currentSlide, Math.max(0, N - 1));
  track.style.transition = 'none';
  track.style.transform = `translateX(-${(N > 1 ? currentSlide + 1 : 0) * 100}%)`;
  void track.offsetWidth;
  track.style.transition = '';

  // Thumbnail indicators: the host's photo for room slides, the article
  // image for news; a plain dot only when a slide has no image.
  dots.innerHTML = CAROUSEL_DATA.map((c, i) => {
    const img = c.kind === 'news' ? c.imageUrl : c.thumbnailUrl;
    const label = c.kind === 'news' ? (c.headline || 'News') : (c.motion || 'Discussion');
    const inner = img
      ? `<img src="${escHTML(img)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('no-img'); this.remove();" />`
      : `<span class="carousel-dot-initial" style="background:${escHTML(c.color || '#4a9eff')}">${escHTML((c.initials || '•'))}</span>`;
    return `<div class="carousel-dot thumb${i === currentSlide ? ' active' : ''}${img ? '' : ' no-img'}" data-index="${i}" role="button" aria-label="Go to: ${escHTML(label)}" title="${escHTML(label)}" tabindex="0">${inner}</div>`;
  }).join('');

  dots.querySelectorAll('.carousel-dot').forEach(dot => {
    dot.addEventListener('click', () => { goToSlide(parseInt(dot.dataset.index)); resetAutoPlay(); });
    dot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { goToSlide(parseInt(dot.dataset.index)); resetAutoPlay(); }});
  });

  // Phase 2: wire carousel watch buttons
  track.querySelectorAll('.carousel-watch-btn:not(.carousel-news-btn)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.debateIndex);
      if (!isNaN(idx)) openDebateModal(idx);
    });
  });

  // "Read article" opens the outlet's story in a new tab; slides without
  // a link fall back to the in-app News panel (React listens on agora:tab).
  track.querySelectorAll('.carousel-news-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else window.dispatchEvent(new CustomEvent('agora:tab', { detail: 'news' }));
    });
  });
}

let carouselSnapTimer = null;
let carouselSnapPending = false;

function snapCarousel(track) {
  track.style.transition = 'none';
  track.style.transform = `translateX(-${(currentSlide + 1) * 100}%)`;
  void track.offsetWidth;
  track.style.transition = '';
  carouselSnapPending = false;
}

function goToSlide(index) {
  const track = document.getElementById('carouselTrack');
  // The autoplay interval outlives the homepage DOM on SPA navigation.
  if (!track) return;
  const N = CAROUSEL_DATA.length;
  if (!N) return;
  if (N === 1) { currentSlide = 0; return; }
  clearTimeout(carouselSnapTimer);
  // Still parked on a clone from the previous wrap? Snap home first so
  // this navigation animates one step, not back across the whole strip.
  if (carouselSnapPending) snapCarousel(track);

  // One step past either end is a clone; further than that is clamped.
  if (index > N) index = N;
  if (index < -1) index = -1;

  track.style.transform = `translateX(-${(index + 1) * 100}%)`;
  currentSlide = (index + N) % N;
  document.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === currentSlide));

  // Landed on a clone: snap invisibly to the real slide it duplicates.
  if (index === N || index === -1) {
    carouselSnapPending = true;
    carouselSnapTimer = setTimeout(() => snapCarousel(track), 520); // just past the 0.5s transition
  }
}

function startAutoPlay() {
  autoPlayTimer = setInterval(() => goToSlide(currentSlide + 1), 9000); // 9s: long enough to read a summary
}

function resetAutoPlay() {
  clearInterval(autoPlayTimer);
  startAutoPlay();
}

// ═══════════════════════════════════════════════
//  SIDEBAR CHANNELS
// ═══════════════════════════════════════════════

function renderSidebarChannels() {
  function glassItemHTML(ch) {
    return `
      <div class="glass-channel-item" data-topic="${ch.topicKey}" role="button" tabindex="0" aria-label="Watch ${ch.name} — ${ch.topic}">
        <div class="glass-channel-inner">
          <div class="glass-channel-avatar-wrap">
            <div class="glass-channel-avatar" style="background:${ch.color};">${ch.initial}</div>
            <div class="glass-channel-status-dot"></div>
          </div>
          <div class="glass-channel-info">
            <span class="glass-channel-name">${ch.name}</span>
            <span class="glass-channel-topic">${ch.topic}</span>
          </div>
          <span class="glass-channel-viewers">${ch.viewers}</span>
        </div>
      </div>`;
  }

  function wireClicks(container) {
    if (!container) return;
    container.querySelectorAll('.glass-channel-item').forEach(el => {
      el.addEventListener('click', () => setActiveTopic(el.dataset.topic));
      el.addEventListener('keydown', e => { if (e.key === 'Enter') setActiveTopic(el.dataset.topic); });
    });
  }

  const html = SIDEBAR_CHANNELS.map(ch => glassItemHTML(ch)).join('');

  const subsContainer = document.getElementById('subsChannelList');
  if (subsContainer) { subsContainer.innerHTML = html; wireClicks(subsContainer); }
}

// ═══════════════════════════════════════════════
//  FRIENDS SECTION
// ═══════════════════════════════════════════════

// Replaced with the signed-in user's real friends by mvp-adapter.js;
// the section is hidden when there are none.
const FRIENDS = [];

const AVATAR_COLORS = [
  '#1976D2','#00b894','#4a9eff','#fd9644','#64B5F6','#e17055','#00cec9','#fdcb6e',
];

function friendAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function friendInitials(name) {
  const parts = name.trim().split(' ');
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function renderFriends() {
  const section = document.getElementById('friendsSection');
  const online  = FRIENDS.filter(f => f.status === 'online');
  const offline = FRIENDS.filter(f => f.status === 'offline');

  function friendItemHTML(f) {
    const isOnline = f.status === 'online';
    const dot = isOnline
      ? '<span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0;"></span>'
      : '';
    const statusLabel = isOnline ? 'Online' : (f.tag === 'away' ? 'Away' : 'Offline');
    return `
      <div class="friend-item">
        <div class="friend-avatar-wrap">
          <div class="friend-avatar" style="background:${friendAvatarColor(f.name)};">${friendInitials(f.name)}</div>
          ${isOnline ? '<div class="friend-online-dot"></div>' : ''}
        </div>
        <div class="friend-info">
          <span class="friend-name">${f.name}</span>
          <span class="friend-status${isOnline ? ' online' : ''}">${dot}${statusLabel}</span>
        </div>
        <span class="friend-tag ${f.tag}">${f.tagLabel}</span>
      </div>`;
  }

  const miniAvatars = FRIENDS.slice(0, 3).map(f =>
    `<div class="mini-avatar" style="background:${friendAvatarColor(f.name)};">${friendInitials(f.name)}</div>`
  ).join('');

  section.innerHTML = `
    <div class="friends-header">
      <h4 class="friends-title">Friends <span class="friends-count">${online.length}</span></h4>
      <button class="friends-add-btn" title="Add friend">+</button>
    </div>
    <div class="friend-directory-bar" id="friendDirectoryBar">
      <div class="friend-directory-icon">👥</div>
      <div class="friend-directory-info">
        <span class="friend-directory-title">Friend List</span>
        <span class="friend-directory-sub">${FRIENDS.length} Friends</span>
      </div>
      <div class="friend-directory-avatars">${miniAvatars}</div>
    </div>
  `;

  // Build and attach overlay
  const sidebar = document.getElementById('sidebar');
  const existing = document.getElementById('friendOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'friendOverlay';
  overlay.innerHTML = `
    <div class="friend-overlay-header">
      <h2 class="friend-overlay-title">
        Friend List
        <span class="friend-overlay-count">${FRIENDS.length}</span>
      </h2>
      <button id="closeFriendOverlay">✕</button>
    </div>
    <div class="friend-search-wrap">
      <span class="friend-search-icon">🔍</span>
      <input type="text" id="friendSearchInput" placeholder="Search friends..." class="friend-search-input" />
    </div>
    <div class="friend-overlay-list">
      ${[...online, ...offline].map(friendItemHTML).join('')}
    </div>
  `;
  Object.assign(overlay.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    background: 'rgba(10, 10, 18, 0.97)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '14px 14px 0 0',
    zIndex: '200',
    padding: '0',
    transform: 'translateY(100%)',
    pointerEvents: 'none',
    transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
    overflow: 'hidden',
    boxSizing: 'border-box',
  });

  sidebar.appendChild(overlay);

  section.querySelector('#friendDirectoryBar').addEventListener('click', () => {
    overlay.style.transform = 'translateY(0%)';
    overlay.style.pointerEvents = 'all';
  });

  overlay.querySelector('#closeFriendOverlay').addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.style.transform = 'translateY(100%)';
    overlay.style.pointerEvents = 'none';
  });

  overlay.querySelector('#friendSearchInput').addEventListener('input', function() {
    const query = this.value.toLowerCase();
    overlay.querySelectorAll('.friend-item').forEach(item => {
      const name = item.querySelector('.friend-name').textContent.toLowerCase();
      item.style.display = name.includes(query) ? 'flex' : 'none';
    });
  });

  // Context menu
  const existingMenu = document.getElementById('friendContextMenu');
  if (existingMenu) existingMenu.remove();

  const contextMenu = document.createElement('div');
  contextMenu.id = 'friendContextMenu';
  contextMenu.className = 'friend-context-menu';
  contextMenu.innerHTML = `
    <div class="context-menu-item" data-action="invite">📨 Send Invite</div>
    <div class="context-menu-item" data-action="group-invite">👥 Request Invite to Group</div>
    <div class="context-menu-item" data-action="whisper">💬 Whisper</div>
    <div class="context-menu-item" data-action="favorite">⭐ Add to Favorites</div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="report">🚩 Report</div>
    <div class="context-menu-item danger" data-action="remove">🗑️ Remove Friend</div>
  `;
  document.body.appendChild(contextMenu);

  let currentOpenItem = null;

  overlay.querySelectorAll('.friend-item').forEach(item => {
    item.style.cursor = 'pointer';
    item.addEventListener('click', (e) => {
      e.stopPropagation();

      if (currentOpenItem === item && contextMenu.classList.contains('open')) {
        contextMenu.classList.remove('open');
        currentOpenItem = null;
        return;
      }

      const rect = item.getBoundingClientRect();
      contextMenu.style.top  = rect.top   + 'px';
      contextMenu.style.left = (rect.right + 8) + 'px';
      contextMenu.classList.add('open');
      currentOpenItem = item;
    });
  });

  document.addEventListener('click', () => {
    contextMenu.classList.remove('open');
    currentOpenItem = null;
  });

  contextMenu.addEventListener('click', function(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action || !currentOpenItem) return;
    const name = currentOpenItem.querySelector('.friend-name')?.textContent ?? 'this friend';
    const actions = {
      'invite':       () => console.log(`Sent invite to ${name}`),
      'group-invite': () => console.log(`Requested group invite for ${name}`),
      'whisper':      () => console.log(`Opening whisper with ${name}`),
      'favorite':     () => console.log(`Added ${name} to favorites`),
      'report':       () => console.log(`Reported ${name}`),
      'remove':       () => console.log(`Removed ${name} as friend`),
    };
    actions[action]?.();
    contextMenu.classList.remove('open');
    currentOpenItem = null;
  });
}

// ═══════════════════════════════════════════════
//  TOPIC BUTTONS
// ═══════════════════════════════════════════════

function renderTopicButtons() {
  const row = document.getElementById('categoryRow');
  if (!row) return; // Browse section removed — TopicsHome.tsx owns field pills now
  const trendingKey = getTrendingTopicKey();

  row.innerHTML = Object.entries(TOPICS).map(([key, t]) => {
    const count     = getTopicDebateCount(key);
    const isTrend   = key === trendingKey;
    const isActive  = key === activeTopicKey;
    const liveText  = count > 0 ? `${count} live` : 'no live';

    return `
      <button
        class="category-btn${isActive ? ' active' : ''}${isTrend ? ' trending' : ''}"
        data-topic="${key}"
        aria-pressed="${isActive}"
      >
        <span class="btn-inner">
          <span class="btn-label">${t.emoji} ${t.label}</span>
          <span class="btn-live-line">${liveText}</span>
        </span>
        <div class="btn-shadow"></div>
      </button>
    `;
  }).join('');

  row.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.topic;
      setActiveTopic(key === activeTopicKey ? 'all' : key);
    });
  });
}

// ═══════════════════════════════════════════════
//  TOPIC STRIP
// ═══════════════════════════════════════════════

function renderTopicStrip() {
  const strip = document.getElementById('topicStrip');
  if (!strip) return; // Browse section removed — TopicsHome.tsx owns field pills now

  if (activeTopicKey === 'all') {
    strip.classList.remove('visible');
    strip.innerHTML = '';
    return;
  }

  const t       = TOPICS[activeTopicKey];
  const count   = getTopicDebateCount(activeTopicKey);
  const hot     = getHotMotion(activeTopicKey);
  const rising  = getRisingDebater(activeTopicKey);

  const hotHTML = hot
    ? `<span class="tsb-hot-label">HOT</span>
       <span class="tsb-hot-quote">"${hot.motion}"</span>`
    : '';

  const risingHTML = rising
    ? `<span class="tsb-rising-label">rising</span>
       <span class="tsb-rising-name">◆ ${rising.name}</span>
       <span class="tsb-rising-arrow">▲</span>`
    : '';

  strip.innerHTML = `
    <div class="tsb-inner">
      <div class="tsb-left">
        <span class="tsb-icon">${t.emoji}</span>
        <div class="tsb-text">
          <span class="tsb-topic-name">${t.label}</span>
          <span class="tsb-desc">${t.description}</span>
        </div>
      </div>
      <div class="tsb-divider"></div>
      <div class="tsb-center">
        <span class="tsb-live-pill">
          <span class="tsb-live-dot"></span>
          ${count} live
        </span>
        ${hotHTML}
        ${risingHTML}
      </div>
      <div class="tsb-right">
        <a class="tsb-explore" href="#">Explore ${t.label} →</a>
      </div>
    </div>
  `;

  requestAnimationFrame(() => strip.classList.add('visible'));
}

// ═══════════════════════════════════════════════
//  DEBATE GRID  (Phase 2: vote bars + watch overlay)
// ═══════════════════════════════════════════════

function buildDebateCard(d, realIndex) {
  const pct      = getVotePct(realIndex);
  const t        = TOPICS[d.topicKey];
  const catLabel = t?.label || d.topicKey;
  const status   = d.status || 'live';

  // Status badge
  const badgeMap = {
    live:      { cls: 'hc-badge-live',      html: '<span class="hc-badge-dot"></span> Live' },
    queue:     { cls: 'hc-badge-queue',     html: 'In queue' },
    scheduled: { cls: 'hc-badge-scheduled', html: 'Scheduled' },
  };
  const badge = badgeMap[status] || badgeMap.live;

  // CTA buttons
  let watchBtn  = `<button class="hc-btn hc-btn-watch" onclick="openDebateModal(${realIndex});event.stopPropagation()">▶ Watch</button>`;
  let joinBtn;
  if (status === 'live') {
    joinBtn = `<button class="hc-btn hc-btn-join-blue" onclick="openDebateModal(${realIndex});event.stopPropagation()">Join as speaker</button>`;
  } else if (status === 'queue') {
    joinBtn = `<button class="hc-btn hc-btn-join-amber" onclick="openDebateModal(${realIndex});event.stopPropagation()">Join Queue</button>`;
  } else {
    joinBtn = `<button class="hc-btn hc-btn-join-purple" onclick="openDebateModal(${realIndex});event.stopPropagation()">Register</button>`;
    watchBtn = `<button class="hc-btn hc-btn-watch" onclick="openDebateModal(${realIndex});event.stopPropagation()">Watch</button>`;
  }

  // Meta items
  const viewerLabel = status === 'queue' ? `${d.viewers} in queue` : `${d.viewers} watching`;
  const format  = d.format   || '1v1';
  const language = d.language || 'EN';

  return `
    <div class="debate-card hc-card" tabindex="0" role="button" aria-label="${d.motion}" data-debate-index="${realIndex}">
      <div class="hc-top">
        <span class="hc-badge ${badge.cls}">${badge.html}</span>
        <span class="hc-category">${catLabel}</span>
      </div>

      <div class="hc-motion">"${d.motion}"</div>

      ${d.community ? `
      <div class="hc-community" style="display:flex;align-items:center;gap:6px;margin:2px 0 4px;font-size:11px;color:${d.communityColor || '#c9b06a'};">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:5px;background:${d.communityColor || '#c9b06a'};color:#fff;font-size:9px;font-weight:700;">${escHTML(d.community[0].toUpperCase())}</span>
        Hosted by ${escHTML(d.community)}
      </div>` : ''}

      <div class="hc-debaters">
        <div class="hc-avatar" style="background:${d.color1};">${d.debater1[0]}</div>
        <span class="hc-dname">${d.debater1}</span>
        <span class="hc-vs">vs</span>
        <div class="hc-avatar" style="background:${d.color2};">${d.debater2[0]}</div>
        <span class="hc-dname">${d.debater2}</span>
      </div>

      <div class="hc-meta">
        <span>${viewerLabel}</span>
        <span class="hc-dot">·</span>
        <span>${format}</span>
        <span class="hc-dot">·</span>
        <span>${language}</span>
      </div>

      <div class="hc-actions">
        ${watchBtn}
        ${joinBtn}
      </div>

      <div class="hc-procon-labels">
        <span class="hc-pct-pro">PRO ${pct.pro}%</span>
        <span class="hc-pct-con">CON ${pct.con}%</span>
      </div>
      <div class="hc-procon-bar">
        <div class="hc-procon-pro" style="width:${pct.pro}%;flex-shrink:0;"></div>
        <div class="hc-procon-con"></div>
      </div>
    </div>
  `;
}

function renderDebateGrid() {
  const grid  = document.getElementById('debateGrid');
  if (!grid) return; // Home grid removed — TopicsHome.tsx lists rooms per field now
  const title = document.getElementById('gridTitle');
  const countBadge = document.getElementById('searchResultCount');

  // Search mode overrides topic filter
  if (searchQuery.trim()) {
    const results = getSearchResults(searchQuery);
    title.textContent = 'Search results';
    countBadge.textContent = `${results.length} found`;
    countBadge.classList.add('visible');

    grid.classList.add('fading');
    setTimeout(() => {
      if (results.length === 0) {
        grid.innerHTML = `
          <div class="search-empty-state">
            <div class="search-empty-icon">🔍</div>
            <div class="search-empty-title">Nothing matches "${searchQuery}"</div>
            <div class="search-empty-sub">Try a different keyword, name, or topic.</div>
          </div>
        `;
      } else {
        grid.innerHTML = results.map(({ d, i }) => buildDebateCard(d, i)).join('');
        attachCardListeners(grid);
      }
      grid.classList.remove('fading');
    }, 100);
    return;
  }

  countBadge.classList.remove('visible');
  const t = activeTopicKey !== 'all' ? TOPICS[activeTopicKey] : null;
  title.textContent = t ? `${t.emoji} ${t.label} · Live now` : 'Popular rooms';

  const filtered = getFilteredDebates(activeTopicKey);

  grid.classList.add('fading');
  setTimeout(() => {
    if (filtered.length === 0) {
      const upcomingInTopic = getFilteredUpcoming(activeTopicKey);
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${t ? t.emoji : '🎙️'}</div>
          <div class="empty-title">Nothing live in ${t ? t.label : 'this topic'} right now</div>
          <div class="empty-sub">Check back soon, or browse another topic.</div>
          ${upcomingInTopic.length ? `
            <div class="upcoming-label">Scheduled · Up Next</div>
            <div class="upcoming-list">
              ${upcomingInTopic.map(u => `
                <div class="upcoming-card" tabindex="0" role="button">
                  <div class="upcoming-time-pill">${u.scheduledAt.replace(' · ', '<br>')}</div>
                  <div class="upcoming-info">
                    <div class="upcoming-motion">"${u.motion}"</div>
                    <div class="upcoming-debaters">
                      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${u.color1};margin-right:4px;vertical-align:middle;"></span>${u.debater1}
                      <span style="color:var(--text-dim);margin:0 4px;">vs</span>
                      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${u.color2};margin-right:4px;vertical-align:middle;"></span>${u.debater2}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
            <a href="#" style="margin-top:12px;font-family:'DM Sans',sans-serif;font-size:11px;color:var(--text-dim);text-decoration:none;">See all upcoming →</a>
          ` : ''}
        </div>
      `;
    } else {
      grid.innerHTML = filtered.map(d => {
        const realIndex = DEBATES.indexOf(d);
        return buildDebateCard(d, realIndex);
      }).join('');
      attachCardListeners(grid);
    }
    grid.classList.remove('fading');
  }, 150);
}

function attachCardListeners(grid) {
  grid.querySelectorAll('.debate-card').forEach(card => {
    const idx = parseInt(card.dataset.debateIndex);
    card.addEventListener('click',   () => openDebateModal(idx));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDebateModal(idx); });
  });
}

// ═══════════════════════════════════════════════
//  ELO MODULE
// ═══════════════════════════════════════════════

function renderELOModule() {
  // Rating system removed from the product — the module and its column
  // are gone from the template; this stub keeps legacy call sites safe.
}

// ═══════════════════════════════════════════════
//  TOPIC STATE CONTROLLER
// ═══════════════════════════════════════════════

function setActiveTopic(key) {
  activeTopicKey = key;
  eloScope = 'global';

  try {
    localStorage.setItem('agora_topic', key);
    const url = new URL(window.location);
    if (key === 'all') { url.searchParams.delete('topic'); }
    else               { url.searchParams.set('topic', key); }
    history.replaceState(null, '', url);
  } catch (_) {}

  renderTopicButtons();
  renderTopicStrip();
  renderDebateGrid();
  renderELOModule();
}

// ═══════════════════════════════════════════════
//  PHASE 2: DEBATE ROOM MODAL
// ═══════════════════════════════════════════════

function openDebateModal(index) {
  if (index < 0 || index >= DEBATES.length) return;
  modalOpenIndex = index;
  const modal = document.getElementById('debateModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderDebateRoom(index);
  modal.focus();
}

function closeDebateModal() {
  const modal = document.getElementById('debateModal');
  modal.classList.add('closing');
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('closing');
    document.body.style.overflow = '';
    modalOpenIndex = -1;
  }, 180);
}

function renderDebateRoom(index) {
  const d    = DEBATES[index];
  const pct  = getVotePct(index);
  const vc   = voteCounts[index];
  const args = DEBATE_ARGS[index] || [];
  const voted = userVotes[index];
  const total  = vc.pro + vc.con;
  const t      = TOPICS[d.topicKey];

  const panel = document.getElementById('debateRoomPanel');

  const argFeedHTML = args.map(a => `
    <div class="feed-arg ${a.side}">
      <div class="feed-arg-header">
        <div class="feed-arg-avatar" style="background:${a.color};">${a.debater[0]}</div>
        <div class="feed-arg-name">${a.debater}</div>
        <span class="feed-arg-stance ${a.side}">${a.side.toUpperCase()}</span>
        <span class="feed-arg-time">${a.time}</span>
      </div>
      <div class="feed-arg-text">${a.text}</div>
      <div class="feed-arg-reactions">
        <button class="feed-reaction-btn" data-arg-reaction="up" title="Strong argument">👍 <span class="react-count">${Math.floor(Math.random()*120)+8}</span></button>
        <button class="feed-reaction-btn" data-arg-reaction="down" title="Weak argument">👎 <span class="react-count">${Math.floor(Math.random()*30)+2}</span></button>
        <button class="feed-reaction-btn" data-arg-reaction="fire" title="Compelling">★ <span class="react-count">${Math.floor(Math.random()*60)+4}</span></button>
      </div>
    </div>
  `).join('');

  panel.innerHTML = `
    <!-- HEADER -->
    <div class="room-header">
      <div class="room-live-badge"><div class="carousel-live-dot"></div> Live</div>
      <div class="room-header-info">
        <div class="room-motion">"${d.motion}"</div>
        <div class="room-sub">${t?.emoji || ''} ${t?.label || d.topicKey} &nbsp;·&nbsp; ${d.debater1} vs ${d.debater2}</div>
      </div>
      <div class="room-viewers-pill">${d.viewers} watching</div>
      <button class="room-close-btn" id="roomCloseBtn" aria-label="Close">✕</button>
    </div>

    <!-- BODY: stream + vote | argument feed -->
    <div class="room-body">

      <!-- STREAM -->
      <div class="room-stream">
        <div class="room-stream-bg" style="background:${d.gradient};"></div>
        <div class="room-stream-grid"></div>
        <div class="room-debater-split">
          <div class="room-debater-side" style="background:${d.color1}18;">
            <div class="room-debater-avatar" style="background:${d.color1};">${d.debater1[0]}</div>
            <div class="room-debater-name-label">${d.debater1}</div>
            <span class="room-stance-badge pro">PRO</span>
          </div>
          <div class="room-debater-side" style="background:${d.color2}18;">
            <div class="room-debater-avatar" style="background:${d.color2};">${d.debater2[0]}</div>
            <div class="room-debater-name-label">${d.debater2}</div>
            <span class="room-stance-badge con">CON</span>
          </div>
          <div class="room-vs-divider">vs</div>
        </div>
      </div>

      <!-- VOTE SECTION -->
      <div class="room-vote-section">
        <div class="room-vote-header">
          <span class="room-vote-title">Audience Vote</span>
          <span class="room-vote-count" id="roomVoteCount">${fmtNumber(total)} votes</span>
        </div>

        <div class="room-vote-bar-wrap">
          <div class="room-vote-bar-pro" id="roomBarPro" style="width:${pct.pro}%;">
            <span class="room-vote-bar-label pro">${pct.pro}%</span>
          </div>
          <div class="room-vote-bar-con" id="roomBarCon">
            <span class="room-vote-bar-label con">${pct.con}%</span>
          </div>
        </div>

        <div class="room-vote-pct-row">
          <div class="room-vote-pct-item pro">
            <div class="room-vote-pct-dot pro"></div>
            <span>PRO</span>
            <span class="room-vote-pct-num" id="roomProPct">${pct.pro}%</span>
            <span style="font-size:10px;color:var(--text-dim);">(${fmtNumber(vc.pro)})</span>
          </div>
          <div class="room-vote-pct-item con">
            <span style="font-size:10px;color:var(--text-dim);">(${fmtNumber(vc.con)})</span>
            <span class="room-vote-pct-num" id="roomConPct">${pct.con}%</span>
            <span>CON</span>
            <div class="room-vote-pct-dot con"></div>
          </div>
        </div>

        <div class="room-vote-buttons">
          <button
            class="room-vote-btn pro${voted === 'pro' ? ' voted' : ''}"
            id="roomVotePro"
            ${voted ? 'disabled' : ''}
            aria-label="Vote PRO on this topic"
          >
            ${voted === 'pro' ? '✓ Voted PRO' : '👍 PRO'}
          </button>
          <button
            class="room-vote-btn con${voted === 'con' ? ' voted' : ''}"
            id="roomVoteCon"
            ${voted ? 'disabled' : ''}
            aria-label="Vote CON on this topic"
          >
            ${voted === 'con' ? '✓ Voted CON' : '👎 CON'}
          </button>
        </div>

        <div class="room-vote-note" id="roomVoteNote">
          ${voted ? `You voted ${voted.toUpperCase()}. Votes are locked for this session.` : 'Your vote counts toward the final result.'}
        </div>

      </div>

      <!-- ARGUMENT FEED -->
      <div class="room-feed-col">
        <div class="room-feed-header">
          <span class="room-feed-title">Live Arguments</span>
          <div class="room-feed-live-dot"></div>
        </div>
        <div class="room-feed-list" id="roomFeedList">
          ${argFeedHTML}
        </div>
      </div>

    </div>
  `;

  // Wire close button
  document.getElementById('roomCloseBtn').addEventListener('click', closeDebateModal);

  // Wire vote buttons
  const btnPro = document.getElementById('roomVotePro');
  const btnCon = document.getElementById('roomVoteCon');
  if (btnPro) btnPro.addEventListener('click', () => castVote(index, 'pro'));
  if (btnCon) btnCon.addEventListener('click', () => castVote(index, 'con'));

  // Wire reaction buttons (toggle active state + increment count)
  panel.querySelectorAll('.feed-reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const span = btn.querySelector('.react-count');
      if (span) {
        const n = parseInt(span.textContent);
        span.textContent = btn.classList.contains('active') ? n + 1 : n - 1;
      }
    });
  });
}

// ═══════════════════════════════════════════════
//  PHASE 2: VOTING
// ═══════════════════════════════════════════════

function castVote(index, side) {
  if (userVotes[index]) return;  // already voted

  userVotes[index] = side;
  voteCounts[index][side] += 1;

  // Update modal vote display
  const pct = getVotePct(index);
  const vc  = voteCounts[index];
  const total = vc.pro + vc.con;

  const barPro = document.getElementById('roomBarPro');
  const barCon = document.getElementById('roomBarCon');
  if (barPro) {
    barPro.style.width = pct.pro + '%';
    barPro.querySelector('.room-vote-bar-label').textContent = pct.pro + '%';
  }
  if (barCon) {
    barCon.querySelector('.room-vote-bar-label').textContent = pct.con + '%';
  }

  const proPctEl = document.getElementById('roomProPct');
  const conPctEl = document.getElementById('roomConPct');
  if (proPctEl) proPctEl.textContent = pct.pro + '%';
  if (conPctEl) conPctEl.textContent = pct.con + '%';

  const countEl = document.getElementById('roomVoteCount');
  if (countEl) countEl.textContent = fmtNumber(total) + ' votes';

  const noteEl = document.getElementById('roomVoteNote');
  if (noteEl) noteEl.textContent = `You voted ${side.toUpperCase()}. Votes are locked for this session.`;

  const btnPro = document.getElementById('roomVotePro');
  const btnCon = document.getElementById('roomVoteCon');
  if (btnPro) {
    btnPro.disabled  = true;
    btnPro.classList.toggle('voted', side === 'pro');
    btnPro.textContent = side === 'pro' ? '✓ Voted PRO' : '👍 PRO';
  }
  if (btnCon) {
    btnCon.disabled  = true;
    btnCon.classList.toggle('voted', side === 'con');
    btnCon.textContent = side === 'con' ? '✓ Voted CON' : '👎 CON';
  }

  // Show toast
  const d = DEBATES[index];
  showToast(
    side === 'pro' ? 'pro-vote' : 'con-vote',
    side === 'pro' ? '👍' : '👎',
    `You voted ${side.toUpperCase()}`,
    `"${d.motion.substring(0, 45)}${d.motion.length > 45 ? '…' : ''}"`
  );

  // Update card vote bar in the grid (if visible)
  const card = document.querySelector(`.debate-card[data-debate-index="${index}"]`);
  if (card) {
    const barProEl = card.querySelector('.card-vote-bar-pro');
    const pctEls   = card.querySelectorAll('.card-vote-pct');
    if (barProEl) barProEl.style.width = pct.pro + '%';
    if (pctEls[0]) pctEls[0].textContent = `PRO ${pct.pro}%`;
    if (pctEls[1]) pctEls[1].textContent = `CON ${pct.con}%`;

    // Add voted badge
    const footer = card.querySelector('.card-footer');
    if (footer) {
      const existing = footer.querySelector('.card-voted-badge');
      if (!existing) {
        const badge = document.createElement('span');
        badge.className = `card-voted-badge ${side}`;
        badge.textContent = `✓ voted ${side.toUpperCase()}`;
        footer.appendChild(badge);
      }
    }
  }
}

// ═══════════════════════════════════════════════
//  PHASE 2: TOAST SYSTEM
// ═══════════════════════════════════════════════

let toastIdCounter = 0;

function showToast(type, icon, title, sub, duration = 3500) {
  const container = document.getElementById('toastContainer');
  const id = ++toastIdCounter;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.dataset.id = id;
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${sub ? `<div class="toast-sub">${sub}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Dismiss">✕</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(id));
  container.appendChild(toast);

  setTimeout(() => dismissToast(id), duration);
}

function dismissToast(id) {
  const toast = document.querySelector(`.toast[data-id="${id}"]`);
  if (!toast) return;
  toast.classList.add('removing');
  setTimeout(() => toast.remove(), 200);
}

// ═══════════════════════════════════════════════
//  PHASE 2: SEARCH HANDLING
// ═══════════════════════════════════════════════

function handleSearchInput(query) {
  searchQuery = query;
  const wrap = document.getElementById('navSearchWrap');
  if (query.trim()) {
    wrap.classList.add('has-query');
  } else {
    wrap.classList.remove('has-query');
  }
  renderDebateGrid();
}

// ═══════════════════════════════════════════════
//  EVENT HANDLERS
// ═══════════════════════════════════════════════

document.getElementById('arrowLeft').addEventListener('click', () => { goToSlide(currentSlide - 1); resetAutoPlay(); });
document.getElementById('arrowRight').addEventListener('click', () => { goToSlide(currentSlide + 1); resetAutoPlay(); });

// Category row scroll on wheel (no-op since the Browse section was removed)
var _categoryRowEl = document.getElementById('categoryRow');
if (_categoryRowEl) _categoryRowEl.addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
    e.preventDefault();
    document.getElementById('categoryRow').scrollLeft += e.deltaY;
  }
}, { passive: false });

// Hamburger + sidebar nav are owned by React now (HomeSidebar.tsx).

// Messages button
document.getElementById('nav-messages-btn')?.addEventListener('click', function() {
  console.log('Messages panel — coming soon');
});

// Profile avatar dropdown
(function () {
  const btn      = document.getElementById('profileAvatarBtn');
  const dropdown = document.getElementById('profileDropdown');
  if (!btn || !dropdown) return;

  function openDropdown() {
    dropdown.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
  }
  function closeDropdown() {
    dropdown.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function isOpen() { return dropdown.classList.contains('open'); }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    isOpen() ? closeDropdown() : openDropdown();
  });

  document.addEventListener('click', e => {
    if (isOpen() && !document.getElementById('profileAvatarWrap').contains(e.target)) {
      closeDropdown();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) closeDropdown();
  });

  // Close on item click (let the href still navigate)
  dropdown.querySelectorAll('.avatar-menu-item').forEach(item => {
    item.addEventListener('click', () => closeDropdown());
  });
})();

// (sidebar nav routing moved to HomeSidebar.tsx)

document.getElementById('searchBtn').addEventListener('click', () => {
  openCreateModal();
});

/* ═══════════════════════════════════════════
   CREATE / QUEUE MODAL LOGIC
═══════════════════════════════════════════ */
(function() {
  const modal      = document.getElementById('createModal');
  const modalBody  = document.getElementById('modalBody');
  const modalTitle = document.getElementById('modalTitle');

  // ── Open / Close ──────────────────────────
  function openCreateModal() {
    modal.style.display = 'flex';
    showEntryScreen();
  }
  window.openCreateModal = openCreateModal;

  function closeModal() { modal.style.display = 'none'; }

  document.getElementById('closeModal').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.style.display === 'flex') closeModal(); });

  // ── Motion suggestions ─────────────────────
  const SUGGESTIONS = {
    'Politics':       ['Democracy is in terminal decline', 'Voting should be compulsory', 'Term limits should apply to all elected officials', 'Populism is a symptom, not a disease', 'Gerrymandering undermines democratic legitimacy'],
    'Ethics':         ['Moral relativism is internally incoherent', 'AI systems cannot bear moral responsibility', 'Whistleblowing is always morally justified', 'Effective altruism is the most rational moral framework', 'Animal suffering deserves equal moral weight'],
    'Economics':      ['Universal Basic Income would erode work ethic', 'Central banks cause more instability than they prevent', 'Capitalism has failed the working class', 'Degrowth is the only viable climate strategy', 'Free trade does more harm than good for developing nations'],
    'Science & Tech': ['Social media algorithms are a public health crisis', 'Gene editing should be available to all, not just the wealthy', 'Artificial General Intelligence will be net negative for humanity', 'Nuclear energy is essential to a green future', 'The tech industry is structurally incapable of self-regulation'],
    'Philosophy':     ['Free will is an illusion', 'Consciousness cannot be reduced to physical processes', 'Nihilism is the most intellectually honest worldview', 'The trolley problem has a clear right answer', 'Solipsism cannot be rationally disproven'],
    'Foreign Policy': ['NATO expansion destabilizes more than it secures', 'Economic interdependence prevents wars', 'Humanitarian intervention is imperialism rebranded', 'The UN Security Council is structurally obsolete', 'Sanctions cause more civilian harm than regime change'],
    'Culture':        ['Cancel culture strengthens accountability', 'Cultural appropriation is an incoherent concept', 'Mass immigration dilutes national identity', 'Meritocracy is a myth', 'Social media has made political discourse irreparably worse'],
    'Sports':         ['Performance-enhancing drugs should be legalised in competitive sport', 'Trans athletes in women\'s sports is a genuine fairness issue', 'Athlete activism improves sport', 'The Olympics are obsolete', 'E-sports deserve recognition as legitimate sport'],
    'Law':            ['Jury trials should be abolished in complex cases', 'The death penalty can never be morally justified', 'Drug decriminalisation reduces harm', 'Civil asset forfeiture is unconstitutional', 'International law lacks meaningful enforcement'],
    'History':        ['Colonialism explains more than it obscures', 'The Cold War was primarily America\'s fault', 'Historical reparations are morally obligatory', 'Churchill was more villain than hero', 'The French Revolution did more harm than good'],
    'default':        ['Free speech has no absolute limits', 'Social media has made society measurably worse', 'Climate action justifies civil disobedience', 'Technocracy is preferable to democracy', 'Privacy is a privilege, not a right']
  };
  const suggIdx = {};

  function getSuggestion(cats) {
    const key = (cats && cats.length > 0) ? cats[0] : 'default';
    const list = SUGGESTIONS[key] || SUGGESTIONS['default'];
    if (!suggIdx[key]) suggIdx[key] = 0;
    const s = list[suggIdx[key] % list.length];
    suggIdx[key]++;
    return s;
  }

  // ── Wait time map ──────────────────────────
  const WAIT_MAP = { Politics: '~2 min', Ethics: '~5 min', Economics: '~4 min', 'Science & Tech': '~6 min', Philosophy: '~7 min', 'Foreign Policy': '~3 min', Culture: '~4 min', Sports: '~8 min', Law: '~6 min', History: '~9 min' };

  // ── Shared state ───────────────────────────
  let selectedCats = [];

  function getSelectedCats() {
    return [...(modalBody.querySelectorAll('#categoryPills .pill.selected') || [])].map(p => p.dataset.cat);
  }

  // ── Helpers ────────────────────────────────
  function selectOne(el, groupId) {
    modalBody.querySelectorAll(`#${groupId} .pill`).forEach(p => p.classList.remove('selected'));
    el.classList.add('selected');
  }
  window._cmSelectOne = selectOne;

  function togglePill(el) {
    el.classList.toggle('selected');
    const cat = el.dataset.cat;
    if (cat === 'Other') {
      const box = modalBody.querySelector('#otherKeywordsBox');
      if (box) box.style.display = el.classList.contains('selected') ? 'block' : 'none';
    }
    updateWaitBadge();
  }
  window._cmTogglePill = togglePill;

  function limitKeywords(input) {
    const parts = input.value.split(',');
    if (parts.length > 3) input.value = parts.slice(0, 3).join(',');
  }
  window._cmLimitKw = limitKeywords;

  function applySuggestion() {
    const inp = modalBody.querySelector('#motionInput');
    if (inp) inp.value = getSuggestion(getSelectedCats());
  }
  window._cmSuggest = applySuggestion;

  function toggleSwitch(el) {
    el.classList.toggle('on');
    el.querySelector('.knob').style.left = el.classList.contains('on') ? '18px' : '2px';
  }
  window._cmToggle = toggleSwitch;

  function togglePrivateRoom(el) {
    toggleSwitch(el);
    const box = modalBody.querySelector('#inviteLinkBox');
    if (box) box.style.display = el.classList.contains('on') ? 'block' : 'none';
  }
  window._cmPrivate = togglePrivateRoom;

  function copyInvite(btn) {
    const txt = (modalBody.querySelector('.invite-link-text') || {}).textContent || '';
    navigator.clipboard.writeText(txt).then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); });
  }
  window._cmCopy = copyInvite;

  function handleStartPill(el) {
    selectOne(el, 'startPills');
    const sched = modalBody.querySelector('#scheduleInput');
    if (sched) sched.style.display = el.textContent.trim() === 'Schedule' ? 'block' : 'none';
  }
  window._cmStartPill = handleStartPill;

  function handleTimePill(el) {
    selectOne(el, 'timePills');
    const custom = modalBody.querySelector('#customTime');
    if (custom) custom.style.display = el.textContent.trim() === 'Custom' ? 'block' : 'none';
  }
  window._cmTimePill = handleTimePill;

  function updateWaitBadge() {
    const cats = getSelectedCats().filter(c => c !== 'Other');
    const badge = modalBody.querySelector('#waitBadge');
    if (!badge) return;
    const key = cats[0] || null;
    badge.textContent = key ? `${WAIT_MAP[key] || '~5 min'} estimated wait · ${key}` : 'Select a category for wait estimate';
  }

  // ── Shared fields HTML ─────────────────────
  function sharedFields() {
    const cats = ['Politics','Ethics','Economics','Science & Tech','Philosophy','Foreign Policy','Culture','Sports','Law','History','Other'];
    return `
      <div class="modal-section">
        <span class="modal-section-label">Motion / Topic</span>
        <div class="modal-input-row">
          <input class="modal-input" id="motionInput" type="text" placeholder="What's the topic?" autocomplete="off" />
          <button class="suggest-btn" onclick="_cmSuggest()">✦ Suggest</button>
        </div>
      </div>
      <div class="modal-section">
        <span class="modal-section-label">Categories <span style="color:rgba(255,255,255,0.18);font-weight:400;text-transform:none;letter-spacing:0">— multi-select</span></span>
        <div class="pill-group" id="categoryPills">
          ${cats.map(c => `<span class="pill" data-cat="${c}" onclick="_cmTogglePill(this)">${c}</span>`).join('')}
        </div>
        <div id="otherKeywordsBox" style="display:none;margin-top:8px;">
          <input class="modal-input" placeholder="Up to 3 keywords, comma-separated" oninput="_cmLimitKw(this)" />
        </div>
      </div>
      <div class="modal-two-col modal-section" style="padding-bottom:0">
        <div>
          <span class="modal-section-label">Language</span>
          <select class="modal-input">
            <option>English</option><option>Spanish</option><option>French</option>
            <option>Mandarin</option><option>Arabic</option><option>Portuguese</option>
            <option>German</option><option>Hindi</option>
          </select>
        </div>
        <div>
          <span class="modal-section-label">Format</span>
          <div class="pill-group" id="formatPills">
            ${['Open Debate','Oxford Style','1v1','Panel (2v2)'].map((f,i) =>
              `<span class="pill${i===0?' selected':''}" onclick="_cmSelectOne(this,'formatPills')">${f}</span>`
            ).join('')}
          </div>
        </div>
      </div>
      <div class="modal-section" style="padding-top:14px;">
        <span class="modal-section-label">Your position</span>
        <div class="pill-group" id="positionPills">
          <span class="pill" data-pos="PRO"  onclick="_cmSelectOne(this,'positionPills')">PRO</span>
          <span class="pill" data-pos="CON"  onclick="_cmSelectOne(this,'positionPills')">CON</span>
          <span class="pill selected"         onclick="_cmSelectOne(this,'positionPills')">Either (system assigns)</span>
        </div>
      </div>
      <div class="modal-section">
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Show your AR to the other speaker</div>
            <div class="toggle-sublabel">Before match is confirmed</div>
          </div>
          <div class="toggle-switch on" onclick="_cmToggle(this)"><div class="knob"></div></div>
        </div>
      </div>
      <div class="modal-divider"></div>
    `;
  }

  // ── Entry screen ───────────────────────────
  function showEntryScreen() {
    modalTitle.innerHTML = 'What would you like to do?';
    modalBody.innerHTML = `
      <div class="entry-cards">
        <div class="entry-card queue" onclick="_cmShowQueue()">
          <span class="entry-card-icon">⚡</span>
          <span class="entry-card-title">Join a queue</span>
          <span class="entry-card-desc">Get paired with someone on your topic and skill level</span>
        </div>
        <div class="entry-card create" onclick="_cmShowCreate()">
          <span class="entry-card-icon">🎙</span>
          <span class="entry-card-title">Create a room</span>
          <span class="entry-card-desc">Host your own room with full control over format, rules, and audience</span>
        </div>
      </div>
    `;
  }
  window._cmEntry = showEntryScreen;

  // ── Queue flow ─────────────────────────────
  function showQueueFlow() {
    modalTitle.innerHTML = `<button class="back-btn" onclick="_cmEntry()">←</button> Join Queue`;
    modalBody.innerHTML = sharedFields() + `
      <div class="modal-section">
        <span class="modal-section-label">Skill matching</span>
        <div class="pill-group" id="skillPills">
          <span class="pill selected" onclick="_cmSelectOne(this,'skillPills')">Match similar AR</span>
          <span class="pill"          onclick="_cmSelectOne(this,'skillPills')">Open to all</span>
        </div>
      </div>
      <div class="modal-section">
        <span class="modal-section-label">Preferred AR range</span>
        <div class="ar-slider-wrap">
          <div class="ar-range-row">
            <span class="ar-range-label">Min</span>
            <input type="range" class="modal-range" id="arMinSlider" min="0" max="3000" value="800" step="50"
              oninput="document.getElementById('arMinVal').textContent=this.value" />
            <span class="ar-range-val" id="arMinVal">800</span>
          </div>
          <div class="ar-range-row">
            <span class="ar-range-label">Max</span>
            <input type="range" class="modal-range" id="arMaxSlider" min="0" max="3000" value="2400" step="50"
              oninput="document.getElementById('arMaxVal').textContent=this.value" />
            <span class="ar-range-val" id="arMaxVal">2400</span>
          </div>
        </div>
      </div>
      <div class="modal-section">
        <span class="modal-section-label">Queue expiry</span>
        <div class="pill-group" id="expiryPills">
          ${['5 min','15 min','30 min','No limit'].map((e,i) =>
            `<span class="pill${i===1?' selected':''}" onclick="_cmSelectOne(this,'expiryPills')">${e}</span>`
          ).join('')}
        </div>
      </div>
      <div class="modal-section">
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Notify me when matched</div>
            <div class="toggle-sublabel">Leave the queue and get notified when someone is found</div>
          </div>
          <div class="toggle-switch" onclick="_cmToggle(this)"><div class="knob"></div></div>
        </div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Auto-accept match</div>
            <div class="toggle-sublabel">Skip manual confirmation when someone is found</div>
          </div>
          <div class="toggle-switch" onclick="_cmToggle(this)"><div class="knob"></div></div>
        </div>
      </div>
      <div class="modal-section" style="display:flex;flex-direction:column;align-items:flex-start;gap:0;padding-bottom:24px;">
        <span class="wait-badge" id="waitBadge">Select a category for wait estimate</span>
        <span class="queue-pos-badge">You are #3 in queue for this topic</span>
      </div>
      <div class="modal-footer">
        <button class="modal-btn-cancel" onclick="document.getElementById('createModal').style.display='none'">Cancel</button>
        <button class="modal-btn-primary blue">Join Queue →</button>
      </div>
    `;
  }
  window._cmShowQueue = showQueueFlow;

  // ── Create flow ────────────────────────────
  function showCreateFlow() {
    modalTitle.innerHTML = `<button class="back-btn" onclick="_cmEntry()">←</button> Create Discussion`;
    modalBody.innerHTML = sharedFields() + `
      <div class="modal-section">
        <span class="modal-section-label">Start time</span>
        <div class="pill-group" id="startPills">
          <span class="pill selected" onclick="_cmStartPill(this)">Now</span>
          <span class="pill"          onclick="_cmStartPill(this)">Schedule</span>
        </div>
        <div id="scheduleInput" style="display:none;margin-top:8px;">
          <input class="modal-input" type="datetime-local" />
        </div>
      </div>
      <div class="modal-section">
        <span class="modal-section-label">Time limit per speaker</span>
        <div class="pill-group" id="timePills">
          ${['None','2 min','5 min','Custom'].map((t,i) =>
            `<span class="pill${i===0?' selected':''}" onclick="_cmTimePill(this)">${t}</span>`
          ).join('')}
        </div>
        <div id="customTime" style="display:none;margin-top:8px;">
          <input class="modal-input" type="number" placeholder="Minutes per speaker" style="max-width:200px" />
        </div>
      </div>
      <div class="modal-section">
        <span class="modal-section-label">Fact-check intensity</span>
        <div class="pill-group" id="factPills">
          ${['Off','Standard','Aggressive'].map((f,i) =>
            `<span class="pill${i===1?' selected':''}" onclick="_cmSelectOne(this,'factPills')">${f}</span>`
          ).join('')}
        </div>
        <div class="modal-hint">Controls how actively the AI ensemble flags claims in real time</div>
      </div>
      <div class="modal-section">
        <span class="modal-section-label">Max audience size</span>
        <input class="modal-input" type="number" placeholder="Unlimited" style="max-width:160px" />
      </div>
      <div class="modal-section">
        <div class="toggle-row">
          <div><div class="toggle-label">Allow audience questions</div></div>
          <div class="toggle-switch on" onclick="_cmToggle(this)"><div class="knob"></div></div>
        </div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Recording consent</div>
            <div class="toggle-sublabel">Allow this discussion to be saved and shared</div>
          </div>
          <div class="toggle-switch on" onclick="_cmToggle(this)"><div class="knob"></div></div>
        </div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Private room</div>
            <div class="toggle-sublabel">Invite only — generates a shareable link</div>
          </div>
          <div class="toggle-switch" id="privateToggle" onclick="_cmPrivate(this)"><div class="knob"></div></div>
        </div>
        <div id="inviteLinkBox" style="display:none">
          <div class="invite-link-box">
            <span class="invite-link-text">agora.sphere/invite/X7K2P9</span>
            <button class="copy-btn" onclick="_cmCopy(this)">Copy</button>
          </div>
        </div>
      </div>
      <div class="modal-section" style="padding-bottom:24px;">
        <span class="modal-section-label">Co-host</span>
        <input class="modal-input" type="text" placeholder="Invite by username or email" />
      </div>
      <div class="modal-footer">
        <button class="modal-btn-cancel" onclick="document.getElementById('createModal').style.display='none'">Cancel</button>
        <button class="modal-btn-primary">Create Room →</button>
      </div>
    `;
  }
  window._cmShowCreate = showCreateFlow;

})();

// Phase 2: Modal close on overlay click / Escape key
document.getElementById('debateModal').addEventListener('click', e => {
  if (e.target === document.getElementById('debateModal')) closeDebateModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalOpenIndex >= 0) closeDebateModal();
});

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════

function init() {
  try {
    const urlParam = new URLSearchParams(window.location.search).get('topic');
    const stored   = localStorage.getItem('agora_topic');
    const restored = (urlParam && TOPICS[urlParam]) ? urlParam
                   : (stored  && TOPICS[stored])   ? stored
                   : 'all';
    activeTopicKey = restored;
  } catch (_) {
    activeTopicKey = 'all';
  }

  renderCarousel();
  renderSidebarChannels();
  // renderFriends() — React FriendsSection owns #friendsSection now.
  renderTopicButtons();
  renderTopicStrip();
  renderDebateGrid();
  renderELOModule();
  startAutoPlay();
}

init();

// ─── SEARCH TRAVEL LIGHT (canvas) ───
(function() {
  const searchWrap = document.getElementById('navSearchWrap');
  if (!searchWrap) return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 999px;
    pointer-events: none;
    z-index: 4;
  `;
  searchWrap.appendChild(canvas);

  const starPositions = [
    {x:0.03,y:0.3},{x:0.06,y:0.7},{x:0.09,y:0.2},{x:0.12,y:0.8},
    {x:0.15,y:0.4},{x:0.18,y:0.6},{x:0.21,y:0.25},{x:0.24,y:0.75},
    {x:0.27,y:0.2},{x:0.30,y:0.8},{x:0.33,y:0.35},{x:0.36,y:0.65},
    {x:0.39,y:0.15},{x:0.42,y:0.85},{x:0.45,y:0.3},{x:0.48,y:0.7},
    {x:0.51,y:0.2},{x:0.54,y:0.8},{x:0.57,y:0.35},{x:0.60,y:0.65},
    {x:0.63,y:0.15},{x:0.66,y:0.85},{x:0.69,y:0.3},{x:0.72,y:0.7},
    {x:0.75,y:0.2},{x:0.78,y:0.8},{x:0.81,y:0.35},{x:0.84,y:0.65},
    {x:0.87,y:0.15},{x:0.90,y:0.85},{x:0.93,y:0.3},{x:0.96,y:0.7},
    {x:0.98,y:0.5},{x:0.01,y:0.5},{x:0.10,y:0.5},{x:0.50,y:0.1},
  ];

  function getPointOnBorder(t, w, h) {
    const r = h / 2;
    const straight = w - h;
    const arcLen = Math.PI * r;
    const total = straight + arcLen + straight + arcLen;
    const d = t * total;

    if (d < straight) {
      return { x: r + d, y: 0 };
    } else if (d < straight + arcLen) {
      const a = (d - straight) / r;
      return { x: w - r + Math.sin(a) * r, y: r - Math.cos(a) * r };
    } else if (d < straight * 2 + arcLen) {
      return { x: w - r - (d - straight - arcLen), y: h };
    } else {
      const a = (d - straight * 2 - arcLen) / r;
      return { x: r - Math.sin(a) * r, y: r + Math.cos(a) * r };
    }
  }

  const duration = 11000;

  function draw(timestamp) {
    const progress = (timestamp % duration) / duration;
    const w = canvas.width  = searchWrap.offsetWidth;
    const h = canvas.height = searchWrap.offsetHeight;
    if (!w || !h) { requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const glow = getPointOnBorder(progress, w, h);
    const r = h / 2;

    // Border stroke
    ctx.beginPath();
    ctx.roundRect(0.75, 0.75, w - 1.5, h - 1.5, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // Traveling glow — clipped to border band only
    const grad = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, 55);
    grad.addColorStop(0,   'rgba(255,255,255,0.65)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1,   'rgba(255,255,255,0)');

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.roundRect(2, 2, w - 4, h - 4, r - 2);
    ctx.clip('evenodd');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Star dots — appear only when glow is near
    starPositions.forEach(star => {
      const sx = star.x * w;
      const sy = star.y * h;
      const dist = Math.hypot(glow.x - sx, glow.y - sy);
      const maxDist = 55;
      if (dist < maxDist) {
        const opacity = (1 - dist / maxDist) * 0.9;
        ctx.beginPath();
        ctx.arc(sx, sy, 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(144,202,249,${opacity})`;
        ctx.fill();
      }
    });

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();

/* ═══════════════════════════════════════════
   EXPLORE PAGE LOGIC
═══════════════════════════════════════════ */
(function() {

  // ── Data ───────────────────────────────────
  // Explore cards come from the same real rooms the home grid shows.
  // (The demo catalogue of fictional debaters lived here until 2026-08.)
  function epSource() {
    return DEBATES.map((d, i) => {
      const t = TOPICS[d.topicKey];
      const debaters = [{ init: (d.debater1 || '?').charAt(0).toUpperCase(), color: d.color1 }];
      const names = [d.debater1];
      if (d.debater2 && d.debater2 !== 'Open seat') {
        debaters.push({ init: d.debater2.charAt(0).toUpperCase(), color: d.color2 });
        names.push(d.debater2);
      } else {
        names.push('Open seat');
      }
      return {
        motion: '"' + d.motion + '"',
        category: t ? t.label : d.topicKey,
        status: d.status, format: d.format || 'Open', lang: d.language || 'EN',
        debaters: debaters, names: names,
        meta: [d.viewers + ' watching'], ar: 0,
        actions: ['watch', 'join'],
        idx: i,
      };
    });
  }

  // ── Render ─────────────────────────────────
  // Cards are React now (ExploreGrid renders RoomCard blocks into
  // #epResultsGrid). We keep the filter machinery and hand it the room ids
  // that survived; React draws them and the empty state.
  function renderCards(list) {
    const meta = document.getElementById('epResultsMeta');
    if (meta) meta.textContent = `Showing ${list.length} discussion${list.length !== 1 ? 's' : ''}`;
    const ids = list.map(d => (DEBATES[d.idx] || {}).roomId).filter(Boolean);
    window.dispatchEvent(new CustomEvent('agora:explore-results', { detail: { ids } }));
  }

  // ── Filter ─────────────────────────────────
  function applyFilters() {
    const query  = (document.getElementById('exploreSearchInput')?.value || '').toLowerCase().trim();
    const cat    = document.querySelector('#epCategoryFilter .explore-pill.active')?.textContent?.trim() || 'All';
    const status = document.querySelector('#epStatusFilter .explore-pill.active')?.textContent?.trim() || 'All';
    const format = document.querySelector('#epFormatFilter .explore-pill.active')?.textContent?.trim() || 'All';
    const lang   = document.querySelector('#epLangFilter .explore-pill.active')?.textContent?.trim() || 'Any';
    const arMin  = parseInt(document.getElementById('epArMin')?.value || '0');
    const arMax  = parseInt(document.getElementById('epArMax')?.value || '9999');

    const filtered = epSource().filter(d => {
      if (cat !== 'All' && !d.category.toLowerCase().includes(cat.toLowerCase())) return false;
      if (status.includes('Live') && d.status !== 'live') return false;
      if (status.includes('Queue') && d.status !== 'queue') return false;
      if (status.includes('Scheduled') && d.status !== 'scheduled') return false;
      if (format !== 'All' && !d.format.toLowerCase().includes(format.toLowerCase())) return false;
      if (lang !== 'Any' && d.lang !== lang) return false;
      if (d.ar < arMin || d.ar > arMax) return false;
      if (query) {
        const haystack = (d.motion + d.category + d.names.join(' ')).toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    renderCards(filtered);
  }
  window._epApplyFilters = applyFilters;

  // (card clicks are handled by the React RoomCard blocks)

  // ── Filter pill handler ─────────────────────
  window._epFilter = function(el, group) {
    const idMap = { category: 'epCategoryFilter', status: 'epStatusFilter', format: 'epFormatFilter', lang: 'epLangFilter' };
    const container = document.getElementById(idMap[group]);
    if (container) container.querySelectorAll('.explore-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    applyFilters();
  };

  // ── Page load / unload ─────────────────────
  function loadExplorePage() {
    document.getElementById('homeFeed').style.display = 'none';
    const ep = document.getElementById('explorePage');
    ep.style.display = 'block';
    // Re-trigger animation
    ep.style.animation = 'none';
    void ep.offsetWidth;
    ep.style.animation = '';
    applyFilters();
    setTimeout(() => document.getElementById('exploreSearchInput')?.focus(), 60);
  }
  window.loadExplorePage = loadExplorePage;

  function loadHomePage() {
    document.getElementById('explorePage').style.display = 'none';
    document.getElementById('homeFeed').style.display = 'block';
  }
  window.loadHomePage = loadHomePage;

  // Live search input
  document.addEventListener('input', e => {
    if (e.target.id === 'exploreSearchInput') applyFilters();
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'epArMin' || e.target.id === 'epArMax') applyFilters();
  });

})();

/* ═══════════════════════════════════════════
   DISCOVERY OVERLAY LOGIC
═══════════════════════════════════════════ */
(function() {
  const overlay    = document.getElementById('discoveryOverlay');
  const discInput  = document.getElementById('discoveryInput');
  const mainInput  = document.getElementById('searchInput');

  // Build result cards from the real rooms in DEBATES. Regenerated on every
  // open so the overlay always reflects current data; the data-* attributes
  // feed _dsFilterResults exactly like the old static markup did.
  function renderDiscoveryCards() {
    const grid = document.getElementById('resultsGrid');
    if (!grid) return;
    grid.innerHTML = DEBATES.map((d, i) => {
      const t = TOPICS[d.topicKey];
      const cat = t ? t.label : d.topicKey;
      const statusLabel = d.status === 'live' ? '● Live' : d.status === 'queue' ? 'In queue' : 'Scheduled';
      const second = d.debater2 && d.debater2 !== 'Open seat'
        ? `<div class="debater-avatar" style="background:${d.color2}">${d.debater2.charAt(0).toUpperCase()}</div><span class="debater-name">${d.debater2}</span>`
        : `<span class="debater-name" style="color:rgba(255,255,255,0.25)">Open seat</span>`;
      return `
      <div class="result-card" style="cursor:pointer" onclick="openDebateModal(${i})" data-category="${cat}" data-status="${d.status}" data-format="${d.format || 'Open'}" data-language="${d.language || 'EN'}">
        <div class="result-card-top">
          <span class="result-status ${d.status}">${statusLabel}</span>
          <span class="result-category">${cat}</span>
        </div>
        <div class="result-motion">"${d.motion}"</div>
        <div class="result-debaters">
          <div class="debater-avatar" style="background:${d.color1}">${(d.debater1 || '?').charAt(0).toUpperCase()}</div>
          <span class="debater-name">${d.debater1}</span>
          <span class="vs-badge">vs</span>
          ${second}
        </div>
        <div class="result-meta-row">
          <span class="result-meta-item">${d.viewers} watching</span>
          <span class="result-meta-item">${d.format || 'Open'}</span>
          <span class="result-meta-item">${d.language || 'EN'}</span>
        </div>
        <div class="result-actions">
          <button class="result-btn watch">Watch</button>
          <button class="result-btn join">Join as speaker</button>
        </div>
      </div>`;
    }).join('');
  }

  function openDiscovery() {
    if (overlay.style.display === 'flex') return;
    renderDiscoveryCards();
    overlay.style.display = 'flex';
    overlay.classList.remove('ds-visible');
    // Trigger reflow so animation re-runs each open
    void overlay.offsetWidth;
    overlay.classList.add('ds-visible');
    // Sync any text already in navbar bar
    discInput.value = mainInput.value || '';
    setTimeout(() => discInput.focus(), 40);
    _dsFilterResults(discInput.value);
  }
  window.openDiscovery = openDiscovery;

  // The navbar search bar is the doorway: focusing or typing in it opens
  // the overlay (which syncs the text and moves the caret there).
  mainInput.addEventListener('focus', openDiscovery);
  mainInput.addEventListener('input', openDiscovery);

  function closeDiscovery() {
    overlay.style.display = 'none';
    mainInput.value = '';
    mainInput.blur();
  }

  document.getElementById('closeDiscovery').addEventListener('click', closeDiscovery);

  // Escape closes discovery (but not if create modal is open)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') {
      e.stopPropagation();
      closeDiscovery();
    }
  }, true);

  // Click outside the panel closes it
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeDiscovery();
  });

  // Live filter as user types
  discInput.addEventListener('input', e => _dsFilterResults(e.target.value));

  // ── Filter pills (single-select per group) ──
  window._dsFilter = function(el) {
    const group = el.dataset.filterGroup;
    document.querySelectorAll(`.filter-pill[data-filter-group="${group}"]`)
      .forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    _dsFilterResults(discInput.value);
  };

  // ── Core filter + search function ──
  function _dsFilterResults(query) {
    const q = (query || '').toLowerCase().trim();

    // Let the React layer (people + community-post results) follow the query.
    document.dispatchEvent(new CustomEvent('agora:discovery-search', { detail: { query: q } }));

    // Active filter selections
    const catActive  = (document.querySelector('.filter-pill.active[data-filter-group="category"]')  || {}).textContent || '';
    const statActive = (document.querySelector('.filter-pill.active[data-filter-group="status"]')    || {}).textContent || '';
    const fmtActive  = (document.querySelector('.filter-pill.active[data-filter-group="format"]')    || {}).textContent || '';
    const langActive = (document.querySelector('.filter-pill.active[data-filter-group="language"]')  || {}).textContent || '';

    const catFilter  = catActive.replace(/\d+/g,'').trim();
    const statFilter = statActive.trim();
    const fmtFilter  = fmtActive.trim();
    const langFilter = langActive.trim();

    const cards = document.querySelectorAll('#resultsGrid .result-card');
    let visible = 0;

    cards.forEach(card => {
      const cardCat  = (card.dataset.category || '').toLowerCase();
      const cardStat = (card.dataset.status   || '').toLowerCase();
      const cardFmt  = (card.dataset.format   || '').toLowerCase();
      const cardLang = (card.dataset.language || '').toLowerCase();
      const cardText = card.textContent.toLowerCase();

      const catOk  = catFilter  === 'All' || catFilter  === '' || cardCat.includes(catFilter.toLowerCase());
      // Compare case-insensitively: the pill labels are sentence case ("Live now",
      // "Scheduled"), so matching against lowercase literals needs the fold.
      const statLc = statFilter.toLowerCase();
      const statOk = statFilter === 'All' || statFilter === '' ||
                     (statLc.includes('live')      && cardStat === 'live') ||
                     (statLc.includes('queue')     && cardStat === 'queue') ||
                     (statLc.includes('scheduled') && cardStat === 'scheduled');
      const fmtOk  = fmtFilter  === 'All formats' || fmtFilter === '' || cardFmt.includes(fmtFilter.toLowerCase());
      const langOk = langFilter === 'Any language' || langFilter === '' || cardLang.includes(langFilter.toLowerCase());
      const queryOk = q === '' || cardText.includes(q);

      const show = catOk && statOk && fmtOk && langOk && queryOk;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    // Empty state
    const grid = document.getElementById('resultsGrid');
    const existing = grid.querySelector('.ds-empty');
    if (visible === 0 && !existing) {
      grid.insertAdjacentHTML('beforeend', `
        <div class="ds-empty">
          <span class="ds-empty-icon">🔍</span>
          No discussions match your search${q ? ' for <em>"' + q + '"</em>' : ''}
        </div>`);
    } else if (visible > 0 && existing) {
      existing.remove();
    }

    const meta = document.getElementById('resultsMeta');
    if (meta) {
      meta.textContent = visible > 0
        ? `Showing ${visible} discussion${visible !== 1 ? 's' : ''}${q ? ' for "' + query + '"' : ''}`
        : `No results${q ? ' for "' + query + '"' : ''}`;
    }
  }
  window._dsFilterResults = _dsFilterResults;

})();

// (sidebar spotlight moved to HomeSidebar.tsx)

// ═══════════════════════════════════════════════
//  STARFIELD — canvas-based (enhanced)
// ═══════════════════════════════════════════════
(function initStarfield() {
  let canvas = document.getElementById('star-canvas');
  let ctx = canvas.getContext('2d');
  const DENSITY = 0.00018;

  // Mouse parallax state
  let mouseX = 0, mouseY = 0, targetMouseX = 0, targetMouseY = 0;
  window.addEventListener('mousemove', e => {
    targetMouseX = (e.clientX / window.innerWidth  - 0.5) * 2; // -1..1
    targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  let stars = [];

  // Weighted radius: ~65% far, ~28% mid, ~7% close
  function randomRadius() {
    const r = Math.random();
    if (r < 0.65) return 0.3  + Math.random() * 0.4;   // 0.30–0.70  far
    if (r < 0.93) return 0.9  + Math.random() * 0.3;   // 0.90–1.20  mid
    return             1.4  + Math.random() * 0.0;      // 1.40–1.40  close (capped)
  }

  function makeStar(w, h) {
    const radius = randomRadius();

    // Depth tier from radius
    const isClose = radius >= 1.2;
    const isMid   = radius >= 0.9 && radius < 1.2;
    const isFar   = radius < 0.9;

    // Depth layer for parallax (far=0.2, mid=0.5, close=1.0)
    const depth = isFar ? 0.2 : isMid ? 0.5 : 1.0;

    // Base opacity by tier
    const baseOpacity = isFar
      ? 0.3  + Math.random() * 0.2
      : isMid
        ? 0.5  + Math.random() * 0.25
        : 0.75 + Math.random() * 0.25;

    // Base color by tier — cool blues for far, warm ambers for close
    const hotBlue = Math.random() < 0.04;
    const baseColor = hotBlue
      ? [144, 202, 249]   // 90CAF9 bright blue accent
      : isFar
        ? [187, 222, 251]  // BBDEFB cool blue far
        : isMid
          ? [227, 242, 253] // E3F2FD near-white blue mid
          : [255, 221, 0];  // FFDD00 warm amber close

    // Twinkle speed: close = slow (1.8–3.5s), mid = medium (0.8–2.0s), far = fast (0.3–1.0s)
    const twinkles = Math.random() < 0.7;
    const twinkleSpeed = twinkles
      ? isClose
        ? 1.8 + Math.random() * 1.7
        : isMid
          ? 0.8 + Math.random() * 1.2
          : 0.3 + Math.random() * 0.7
      : null;

    // Sparse cluster bias: bias toward 2-3 loose regions
    // Clusters at roughly (20%,30%), (55%,45%), (80%,20%) of screen
    const clusters = [[0.2,0.3],[0.55,0.45],[0.80,0.20]];
    let x, y;
    if (Math.random() < 0.38) {
      // Place near a random cluster with gaussian-ish spread
      const c = clusters[Math.floor(Math.random() * clusters.length)];
      const spread = 0.22;
      x = Math.max(0, Math.min(w, (c[0] + (Math.random()+Math.random()-1)*spread) * w));
      y = Math.max(0, Math.min(h, (c[1] + (Math.random()+Math.random()-1)*spread) * h));
    } else {
      x = Math.random() * w;
      y = Math.random() * h;
    }

    // Pulsing breath: 20–30% of stars, independent of twinkle
    const pulseRoll = Math.random();
    const pulsing = pulseRoll < 0.25;
    const pulseSpeed = pulsing ? 2.0 + Math.random() * 3.0 : 0; // 2–5s cycle
    const pulsePhase = Math.random() * Math.PI * 2;

    return {
      ox: x, oy: y,   // original positions (parallax offsets from these)
      x, y,
      radius,
      baseOpacity,
      opacity: baseOpacity,
      baseColor,
      depth,
      isClose,
      isFar,
      twinkleSpeed,
      phase: Math.random() * Math.PI * 2,
      pulsing,
      pulseSpeed,
      pulsePhase,
    };
  }

  function generateStars(w, h) {
    const count = Math.floor(w * h * DENSITY);
    return Array.from({ length: count }, () => makeStar(w, h));
  }

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = generateStars(canvas.width, canvas.height);
  }

  /* Live window drags fire resize continuously; regenerating every star each
     event reallocates the whole array dozens of times per second and visibly
     re-rolls the sky. Instead: rescale the stars we have (cheap, keeps the
     sky covered while dragging), then regenerate once after the drag settles
     so density and distribution end up correct for the final size. */
  let regenTimer = null;
  function onWindowResize() {
    const ow = canvas.width  || 1;
    const oh = canvas.height || 1;
    const nw = window.innerWidth;
    const nh = window.innerHeight;
    if (nw === ow && nh === oh) return;
    canvas.width  = nw;
    canvas.height = nh;
    const sx = nw / ow;
    const sy = nh / oh;
    for (let i = 0; i < stars.length; i++) {
      stars[i].ox *= sx;
      stars[i].oy *= sy;
    }
    clearTimeout(regenTimer);
    regenTimer = setTimeout(function () {
      stars = generateStars(canvas.width, canvas.height);
    }, 200);
  }

  /* One cached radial-glow sprite per close star, built at its peak-twinkle
     warm color. Stamped with drawImage + globalAlpha each frame instead of
     allocating a fresh radial gradient per star per frame. */
  function glowSpriteFor(s) {
    if (s.glowSprite) return s.glowSprite;
    const R = Math.ceil(s.radius * 3.5) + 1;
    const c = document.createElement('canvas');
    c.width = c.height = R * 2;
    const g2 = c.getContext('2d');
    const gr = 255;
    const gg = Math.round(s.baseColor[1] + (208 - s.baseColor[1]) * 0.8);
    const gb = Math.round(s.baseColor[2] * 0.1);
    const grad = g2.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, 'rgba(' + gr + ',' + gg + ',' + gb + ',1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, R * 2, R * 2);
    s.glowSprite = c;
    return c;
  }

  function render() {
    // React re-injects the MVP markup on remount, which orphans the canvas
    // this closure captured at boot — leaving the visible one forever blank.
    // Re-acquire the live node whenever they diverge.
    const liveCanvas = document.getElementById('star-canvas');
    if (liveCanvas && liveCanvas !== canvas) {
      canvas = liveCanvas;
      ctx = canvas.getContext('2d');
      resize();
    }

    // Self-heal against missed resize events (embedded panes and some
    // restore paths never fire one) — two int compares per frame.
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      onWindowResize();
    }

    // Smooth mouse lerp
    mouseX += (targetMouseX - mouseX) * 0.06;
    mouseY += (targetMouseY - mouseY) * 0.06;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = Date.now() * 0.001;

    for (const s of stars) {
      // Parallax offset: max 3px for close, barely perceptible for far
      const maxDrift = 3.0;
      s.x = s.ox + mouseX * s.depth * maxDrift;
      s.y = s.oy + mouseY * s.depth * maxDrift;

      let opacity = s.baseOpacity;
      let [r, g, b] = s.baseColor;
      let twinklePeak = 0;

      if (s.twinkleSpeed !== null) {
        const t = (Math.sin((now / s.twinkleSpeed) + s.phase) + 1) * 0.5; // 0..1
        twinklePeak = t;

        if (s.isClose) {
          // Wide swing: baseOpacity ± ~0.22
          opacity = s.baseOpacity * 0.78 + t * s.baseOpacity * 0.44;
          // Warm color shift at peak — toward FFD000
          r = 255;
          g = Math.round(s.baseColor[1] + (208 - s.baseColor[1]) * t * 0.8);
          b = Math.round(s.baseColor[2] + (0   - s.baseColor[2]) * t * 0.9);
        } else if (!s.isFar) {
          // Mid: moderate swing
          opacity = s.baseOpacity * 0.8 + t * s.baseOpacity * 0.4;
        } else {
          // Far: subtle flutter
          opacity = s.baseOpacity * 0.85 + t * s.baseOpacity * 0.3;
        }
      }

      // Faint pulsation breath — applied after twinkle, before clamp
      // Uses shared `now` timestamp, no per-star timer overhead
      if (s.pulsing) {
        const pulse = (Math.sin((now / s.pulseSpeed) + s.pulsePhase) + 1) * 0.5; // 0..1
        opacity -= pulse * 0.15; // breathes down by up to 0.15 at trough
      }

      opacity = Math.min(1, Math.max(0, opacity));

      // Soft glow for close stars (top ~7%): a pre-rendered sprite stamped
      // with globalAlpha. The old per-frame createRadialGradient allocated a
      // gradient object for every glowing star on every frame — at this
      // opacity (≤0.09) the sprite's fixed peak color is indistinguishable.
      if (s.isClose && s.twinkleSpeed !== null) {
        const glowOpacity = twinklePeak * 0.09;
        if (glowOpacity > 0.005) {
          const sp = glowSpriteFor(s);
          ctx.globalAlpha = glowOpacity;
          ctx.drawImage(sp, s.x - sp.width / 2, s.y - sp.height / 2);
          ctx.globalAlpha = 1;
        }
      }

      // Star point — stable stars reuse a cached color string instead of
      // building a fresh rgba() string (and reparsing it) every frame.
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      if (s.isClose && s.twinkleSpeed !== null) {
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      } else {
        if (!s.rgbStr) s.rgbStr = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fillStyle = s.rgbStr;
      }
      ctx.globalAlpha = opacity;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    requestAnimationFrame(render);
  }

  window.addEventListener('resize', onWindowResize);
  resize();
  render();
})();

// ═══════════════════════════════════════════════
//  SHOOTING STARS — SVG-based
// ═══════════════════════════════════════════════
(function initShootingStars() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let svg = document.getElementById('shooting-svg');
  const NS = 'http://www.w3.org/2000/svg';

  // Define gradient once
  const defs = document.createElementNS(NS, 'defs');
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.setAttribute('id', 'ss-grad');
  grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
  const s1 = document.createElementNS(NS, 'stop');
  s1.setAttribute('offset', '0%');
  s1.setAttribute('style', 'stop-color:#2EB9DF;stop-opacity:0');
  const s2 = document.createElementNS(NS, 'stop');
  s2.setAttribute('offset', '100%');
  s2.setAttribute('style', 'stop-color:#9E00FF;stop-opacity:1');
  grad.appendChild(s1);
  grad.appendChild(s2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  const MIN_SPEED = 10, MAX_SPEED = 30;
  const MIN_DELAY = 1200, MAX_DELAY = 4200;
  const BASE_W = 10, H = 1;
  let activeRect = null, activeFrame = null;

  function randomStartPoint() {
    const side = Math.floor(Math.random() * 4);
    const W = window.innerWidth, H2 = window.innerHeight;
    switch (side) {
      case 0: return { x: Math.random() * W,  y: 0,  angle: 45  };
      case 1: return { x: W,                  y: Math.random() * H2, angle: 135 };
      case 2: return { x: Math.random() * W,  y: H2, angle: 225 };
      default:return { x: 0,                  y: Math.random() * H2, angle: 315 };
    }
  }

  function scheduleNext() {
    const delay = Math.random() * (MAX_DELAY - MIN_DELAY) + MIN_DELAY;
    setTimeout(spawnStar, delay);
  }

  function spawnStar() {
    // Re-acquire the SVG if React re-injected the MVP markup (see starfield).
    const liveSvg = document.getElementById('shooting-svg');
    if (liveSvg && liveSvg !== svg) {
      svg = liveSvg;
      svg.appendChild(defs);
    }
    if (activeRect) { activeRect.remove(); activeRect = null; }
    if (activeFrame) { cancelAnimationFrame(activeFrame); activeFrame = null; }

    const { x, y, angle } = randomStartPoint();
    const speed = Math.random() * (MAX_SPEED - MIN_SPEED) + MIN_SPEED;
    const rad = angle * Math.PI / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('fill', 'url(#ss-grad)');
    rect.setAttribute('height', H);
    svg.appendChild(rect);
    activeRect = rect;

    let px = x, py = y, dist = 0;

    function step() {
      px += speed * dx;
      py += speed * dy;
      dist += speed;
      const scale = 1 + dist / 100;
      const w = BASE_W * scale;
      rect.setAttribute('x', px);
      rect.setAttribute('y', py);
      rect.setAttribute('width', w);
      rect.setAttribute('transform',
        `rotate(${angle},${px + w / 2},${py + H / 2})`);

      const W = window.innerWidth, H2 = window.innerHeight;
      if (px < -40 || px > W + 40 || py < -40 || py > H2 + 40) {
        rect.remove();
        activeRect = null;
        scheduleNext();
        return;
      }
      activeFrame = requestAnimationFrame(step);
    }

    activeFrame = requestAnimationFrame(step);
  }

  scheduleNext();
})();

(function() {
  const dashStars = document.querySelector('.dash-stars');
  if (dashStars) {
    dashStars.innerHTML = '';
    for (let i = 0; i < 40; i++) {
      const star = document.createElement('div');
      star.className = 'dash-star';
      const size = Math.random() * 1.8 + 0.8;
      const peakOpacity = 0.25 + Math.random() * 0.45;
      const isBlue = i % 5 === 0;
      const drift = () => (Math.random() - 0.5) * 18;
      star.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        left: ${Math.random() * 96 + 2}%;
        top: ${Math.random() * 96 + 2}%;
        background: ${isBlue ? 'rgba(180,190,255,1)' : 'rgba(255,255,255,1)'};
        --peak-opacity: ${peakOpacity};
        --dx1: ${drift()}px; --dy1: ${drift()}px;
        --dx2: ${drift()}px; --dy2: ${drift()}px;
        --dx3: ${drift()}px; --dy3: ${drift()}px;
        --dx4: ${drift()}px; --dy4: ${drift()}px;
        --dur: ${3 + Math.random() * 5}s;
        --delay: ${Math.random() * 6}s;
        animation: dash-star-twinkle var(--dur) ease-in-out var(--delay) infinite;
        opacity: 0;
        position: absolute;
        border-radius: 50%;
        pointer-events: none;
      `;
      dashStars.appendChild(star);
    }
  }
})();

(function() {
  var NODES = [
    { id:1, title:'Planning',    date:'Jan 2024', content:'Project planning and requirements gathering phase.', icon:'📅', status:'completed',  energy:100 },
    { id:2, title:'Design',      date:'Feb 2024', content:'UI/UX design and system architecture.',              icon:'🎨', status:'completed',  energy:90  },
    { id:3, title:'Development', date:'Mar 2024', content:'Core features implementation and testing.',          icon:'💻', status:'in-progress', energy:60  },
    { id:4, title:'Testing',     date:'Apr 2024', content:'User testing and bug fixes.',                        icon:'🧪', status:'pending',     energy:30  },
    { id:5, title:'Release',     date:'May 2024', content:'Final deployment and release.',                      icon:'🚀', status:'pending',     energy:10  },
  ];

  var angle = 0;
  var animFrame;
  var activeNode = null;
  var radius = 190;

  var modal        = document.getElementById('dashboard-modal');
  var closeBtn     = document.getElementById('dash-modal-close');
  var nodesContainer = document.getElementById('dash-orbital-nodes');

  function buildNodes() {
    if (!nodesContainer) return;
    nodesContainer.innerHTML = '';
    NODES.forEach(function(node) {
      var el = document.createElement('div');
      el.className = 'dash-orbital-node';
      el.dataset.id = node.id;
      var statusLabel = node.status === 'in-progress' ? 'In Progress' : node.status.charAt(0).toUpperCase() + node.status.slice(1);
      el.innerHTML =
        '<div class="dash-node-dot">' + node.icon + '</div>' +
        '<div class="dash-node-label">' + node.title + '</div>' +
        '<div class="dash-node-card" id="dash-card-' + node.id + '">' +
          '<div class="dash-node-card-title">' + node.title + '</div>' +
          '<div class="dash-node-card-date">' + node.date + '</div>' +
          '<div class="dash-node-card-content">' + node.content + '</div>' +
          '<span class="dash-node-card-status ' + node.status + '">' + statusLabel + '</span>' +
          '<div class="dash-energy-bar"><div class="dash-energy-fill" style="width:' + node.energy + '%"></div></div>' +
        '</div>';
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var cardEl = document.getElementById('dash-card-' + node.id);
        if (activeNode === node.id) {
          activeNode = null;
          el.classList.remove('active');
          if (cardEl) cardEl.classList.remove('visible');
        } else {
          document.querySelectorAll('.dash-orbital-node').forEach(function(n) {
            n.classList.remove('active');
            var c = document.getElementById('dash-card-' + n.dataset.id);
            if (c) c.classList.remove('visible');
          });
          activeNode = node.id;
          el.classList.add('active');
          if (cardEl) cardEl.classList.add('visible');
        }
      });
      nodesContainer.appendChild(el);
    });
  }

  function animateOrbit() {
    angle = (angle + 0.3) % 360;
    var total = NODES.length;
    document.querySelectorAll('.dash-orbital-node').forEach(function(el, i) {
      var nodeAngle = ((i / total) * 360 + angle) * Math.PI / 180;
      var x = radius * Math.cos(nodeAngle);
      var y = radius * Math.sin(nodeAngle);
      var opacity = Math.max(0.35, Math.min(1, 0.35 + 0.65 * ((1 + Math.sin(nodeAngle)) / 2)));
      el.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
      el.style.opacity = activeNode ? (parseInt(el.dataset.id) === activeNode ? 1 : 0.4) : opacity;
    });
    animFrame = requestAnimationFrame(animateOrbit);
  }

  function initSphere() {
    if (typeof THREE === 'undefined') return;
    var mount = document.getElementById('dash-sphere-mount');
    if (!mount || mount.querySelector('canvas')) return;

    var w = 200, h = 200;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(75, w/h, 0.1, 1000);
    camera.position.z = 3;

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    var geometry = new THREE.IcosahedronGeometry(1.2, 20);

    var vertexShader = [
      'uniform float time;',
      'varying vec3 vNormal;',
      'varying vec3 vPosition;',
      'vec3 mod289v3(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
      'vec4 mod289v4(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
      'vec4 permute(vec4 x){return mod289v4(((x*34.0)+1.0)*x);}',
      'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
      'float snoise(vec3 v){',
      '  const vec2 C=vec2(1.0/6.0,1.0/3.0);',
      '  const vec4 D=vec4(0.0,0.5,1.0,2.0);',
      '  vec3 i=floor(v+dot(v,C.yyy));',
      '  vec3 x0=v-i+dot(i,C.xxx);',
      '  vec3 g=step(x0.yzx,x0.xyz);',
      '  vec3 l=1.0-g;',
      '  vec3 i1=min(g.xyz,l.zxy);',
      '  vec3 i2=max(g.xyz,l.zxy);',
      '  vec3 x1=x0-i1+C.xxx;',
      '  vec3 x2=x0-i2+C.yyy;',
      '  vec3 x3=x0-D.yyy;',
      '  i=mod289v3(i);',
      '  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
      '  float n_=0.142857142857;',
      '  vec3 ns=n_*D.wyz-D.xzx;',
      '  vec4 j=p-49.0*floor(p*ns.z*ns.z);',
      '  vec4 x_=floor(j*ns.z);',
      '  vec4 y_=floor(j-7.0*x_);',
      '  vec4 x=x_*ns.x+ns.yyyy;',
      '  vec4 y=y_*ns.x+ns.yyyy;',
      '  vec4 h=1.0-abs(x)-abs(y);',
      '  vec4 b0=vec4(x.xy,y.xy);',
      '  vec4 b1=vec4(x.zw,y.zw);',
      '  vec4 s0=floor(b0)*2.0+1.0;',
      '  vec4 s1=floor(b1)*2.0+1.0;',
      '  vec4 sh=-step(h,vec4(0.0));',
      '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;',
      '  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
      '  vec3 p0=vec3(a0.xy,h.x);',
      '  vec3 p1=vec3(a0.zw,h.y);',
      '  vec3 p2=vec3(a1.xy,h.z);',
      '  vec3 p3=vec3(a1.zw,h.w);',
      '  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
      '  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
      '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);',
      '  m=m*m;',
      '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
      '}',
      'void main(){',
      '  vNormal=normal;',
      '  vPosition=position;',
      '  float displacement=snoise(position*2.0+time*0.5)*0.2;',
      '  vec3 newPosition=position+normal*displacement;',
      '  gl_Position=projectionMatrix*modelViewMatrix*vec4(newPosition,1.0);',
      '}'
    ].join('\n');

    var fragmentShader = [
      'uniform vec3 color;',
      'uniform vec3 pointLightPos;',
      'varying vec3 vNormal;',
      'varying vec3 vPosition;',
      'void main(){',
      '  vec3 n=normalize(vNormal);',
      '  vec3 lightDir=normalize(pointLightPos-vPosition);',
      '  float diffuse=max(dot(n,lightDir),0.0);',
      '  float fresnel=1.0-dot(n,vec3(0.0,0.0,1.0));',
      '  fresnel=pow(fresnel,2.0);',
      '  float brightness=diffuse*0.85+fresnel*0.4;',
      '  float grey=mix(0.15,1.0,brightness);',
      '  gl_FragColor=vec4(vec3(grey),0.85);',
      '}'
    ].join('\n');

    var material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        pointLightPos: { value: new THREE.Vector3(2, 2, 5) }
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      wireframe: true,
      transparent: true
    });

    var mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    var sphereFrame;
    function animateSphere(t) {
      material.uniforms.time.value = t * 0.0003;
      mesh.rotation.y += 0.0005;
      mesh.rotation.x += 0.0002;
      renderer.render(scene, camera);
      sphereFrame = requestAnimationFrame(animateSphere);
    }
    animateSphere(0);

    mount._sphereFrame = sphereFrame;
    mount._sphereRenderer = renderer;
  }

  function destroySphere() {
    var mount = document.getElementById('dash-sphere-mount');
    if (!mount) return;
    if (mount._sphereFrame)    cancelAnimationFrame(mount._sphereFrame);
    if (mount._sphereRenderer) mount._sphereRenderer.dispose();
    mount.innerHTML = '';
  }

  function openModal() {
    modal.style.display = 'flex';
    requestAnimationFrame(function() { modal.classList.add('visible'); });
    buildNodes();
    animateOrbit();
    initSphere();
    document.addEventListener('keydown', handleKey);
  }

  function closeModal() {
    modal.classList.remove('visible');
    cancelAnimationFrame(animFrame);
    destroySphere();
    activeNode = null;
    document.removeEventListener('keydown', handleKey);
    setTimeout(function() { modal.style.display = 'none'; }, 300);
  }

  function handleKey(e) { if (e.key === 'Escape') closeModal(); }

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

  // Attach to dashboard button — capture phase runs before the sidebar's bubble listener
  var dashBtn = document.querySelector('.dashboard-btn');
  if (dashBtn) {
    dashBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    }, true); // capture phase = beats bubble-phase sidebar handler
  }
})();
