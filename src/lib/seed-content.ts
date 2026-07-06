/* Seed content for the Agora Stoa tabs. Shown while the corresponding
   Supabase tables are empty (or the migration hasn't run yet); real rows
   from the database take priority everywhere this is used. */

export type SeedClip = {
  id: string;
  title: string;
  duration: string;
  hearts: number;
  gradient: string;
  uploader: { name: string; initial: string; color: string };
  motion: string;
  opponent: string;
  comments: { user: string; color: string; when: string; body: string; likes: number }[];
};

export const SEED_SHORTS: SeedClip[] = [
  {
    id: "seed-1",
    title: "The fact-check that flipped the room 🔥",
    duration: "0:47",
    hearts: 12400,
    gradient: "linear-gradient(160deg,#0d1b3e 0%,#1e0533 60%,#0a0a10 100%)",
    uploader: { name: "Destiny", initial: "D", color: "#00b894" },
    motion: "Social media causes teen depression",
    opponent: "KairosMind",
    comments: [
      { user: "rhetoricfan", color: "#7f77dd", when: "2h", body: "the pause after he cited the actual study 💀", likes: 1200 },
      { user: "mun_delegate", color: "#1d9e75", when: "1h", body: "this is why you bring receipts to an oxford round", likes: 640 },
      { user: "justdebate", color: "#d4537e", when: "44m", body: "KairosMind actually recovered well after this, watch the full one", likes: 287 },
      { user: "stoic_sam", color: "#e2b96b", when: "12m", body: "came from the clip, stayed for the whole debate", likes: 96 },
    ],
  },
  {
    id: "seed-2",
    title: '"Name one pilot that failed" — silence',
    duration: "0:58",
    hearts: 9100,
    gradient: "linear-gradient(160deg,#0d2b1a 0%,#2d1a00 100%)",
    uploader: { name: "HasanAbi", initial: "H", color: "#e17055" },
    motion: "UBI would destroy work ethic",
    opponent: "EconDebater",
    comments: [
      { user: "policy_wonk", color: "#4a9eff", when: "3h", body: "Stockton SEED mention incoming and it landed", likes: 410 },
      { user: "debate_mom", color: "#fd79a8", when: "1h", body: "my kid's LD coach shows this clip in practice now", likes: 220 },
    ],
  },
  {
    id: "seed-3",
    title: "Cornered on nuclear waste storage",
    duration: "1:00",
    hearts: 7800,
    gradient: "linear-gradient(160deg,#001a2e 0%,#002214 100%)",
    uploader: { name: "GreenFuture", initial: "G", color: "#55efc4" },
    motion: "Nuclear is greener than solar",
    opponent: "ScienceMatters",
    comments: [
      { user: "atomic_annie", color: "#00cec9", when: "5h", body: "10,000 year storage question gets em every time", likes: 530 },
    ],
  },
  {
    id: "seed-4",
    title: "Steelman so good the crowd switched",
    duration: "0:39",
    hearts: 6200,
    gradient: "linear-gradient(160deg,#0d0a2e 0%,#2e0d0d 100%)",
    uploader: { name: "PhilosophyTube", initial: "P", color: "#fd79a8" },
    motion: "Democracy is failing in the West",
    opponent: "PoliticsNow",
    comments: [
      { user: "socratic_q", color: "#64B5F6", when: "1d", body: "arguing the other side better than they did is an art", likes: 890 },
    ],
  },
  {
    id: "seed-5",
    title: '"That study says the opposite"',
    duration: "0:52",
    hearts: 5900,
    gradient: "linear-gradient(160deg,#2d0a1a 0%,#1a1500 100%)",
    uploader: { name: "LegalEagle", initial: "L", color: "#e2b96b" },
    motion: "Affirmative action is constitutional",
    opponent: "SocraticDebates",
    comments: [
      { user: "prelaw_pam", color: "#e056b8", when: "2d", body: "citing the dissent back at him... cold blooded", likes: 340 },
    ],
  },
];

export type SeedVideo = {
  id: string;
  title: string;
  duration: string;
  gradient: string;
  uploader: { name: string; initial: string; color: string };
  meta: string;
};

export const SEED_VIDEOS: SeedVideo[] = [
  {
    id: "vod-1",
    title: "Universal Basic Income Now — HasanAbi vs EconDebater",
    duration: "42:18",
    gradient: "linear-gradient(135deg,#0a2e1a,#1a4d3a)",
    uploader: { name: "HasanAbi", initial: "H", color: "#e17055" },
    meta: "96K views · 2 days ago",
  },
  {
    id: "vod-2",
    title: "Nuclear Energy is the Future — Oxford style, full vote swing",
    duration: "1:04:52",
    gradient: "linear-gradient(135deg,#1a0a00,#3d2200)",
    uploader: { name: "CosmosDebate", initial: "C", color: "#4a9eff" },
    meta: "71K views · 4 days ago",
  },
  {
    id: "vod-3",
    title: "Free Speech Has No Absolute Limits — PhilosophyTube vs Destiny",
    duration: "38:07",
    gradient: "linear-gradient(135deg,#0d0a2e,#2a1a5a)",
    uploader: { name: "PhilosophyTube", initial: "P", color: "#fd79a8" },
    meta: "54K views · 5 days ago",
  },
  {
    id: "vod-4",
    title: "Affirmative Action is Constitutional — LegalEagle deep dive",
    duration: "51:33",
    gradient: "linear-gradient(135deg,#2d0a1a,#1a1500)",
    uploader: { name: "LegalEagle", initial: "L", color: "#e2b96b" },
    meta: "47K views · 1 week ago",
  },
  {
    id: "vod-5",
    title: "AI Will Eliminate More Jobs Than It Creates — blitz round",
    duration: "29:45",
    gradient: "linear-gradient(135deg,#001e2e,#0d001a)",
    uploader: { name: "TechRealist", initial: "T", color: "#00cec9" },
    meta: "33K views · 1 week ago",
  },
  {
    id: "vod-6",
    title: "The US Should Adopt Ranked Choice Voting — town hall",
    duration: "47:29",
    gradient: "linear-gradient(135deg,#001a3d,#1a001a)",
    uploader: { name: "ElectionWatch", initial: "E", color: "#4a9eff" },
    meta: "28K views · 2 weeks ago",
  },
];

export type SeedCommunity = {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  color: string;
  initial: string;
  members: number;
  activity: { text: string; color: string };
};

export const SEED_COMMUNITIES: SeedCommunity[] = [
  {
    id: "c-1", name: "Stanford Debate Society", kind: "university",
    kindLabel: "University · British Parliamentary",
    color: "linear-gradient(135deg,#8c1515,#5a0d0d)", initial: "S",
    members: 1284, activity: { text: "● 2 live now", color: "#f09595" },
  },
  {
    id: "c-2", name: "MUN Global", kind: "mun",
    kindLabel: "Model UN · Position papers & blocs",
    color: "linear-gradient(135deg,#1976D2,#0d3a66)", initial: "M",
    members: 3067, activity: { text: "crisis committee Sat", color: "#f4d47c" },
  },
  {
    id: "c-3", name: "Philosophy Circle", kind: "topic-circle",
    kindLabel: "Topic circle · Socratic & steelman",
    color: "linear-gradient(135deg,#7f77dd,#3c3489)", initial: "P",
    members: 892, activity: { text: "● 1 live now", color: "#f09595" },
  },
  {
    id: "c-4", name: "Berkeley Forensics", kind: "university",
    kindLabel: "University · APDA & policy",
    color: "linear-gradient(135deg,#003262,#1a1a2e)", initial: "B",
    members: 1051, activity: { text: "tryouts open", color: "#97c459" },
  },
  {
    id: "c-5", name: "Lincoln HS Debate", kind: "hs-team",
    kindLabel: "HS team · NSDA Lincoln-Douglas",
    color: "linear-gradient(135deg,#1d9e75,#0f4e3a)", initial: "L",
    members: 214, activity: { text: "practice Tue 4 PM", color: "#f4d47c" },
  },
  {
    id: "c-6", name: "Moot Court Collective", kind: "pre-law",
    kindLabel: "Pre-law · Legal advocacy",
    color: "linear-gradient(135deg,#e2b96b,#6b4a1a)", initial: "M",
    members: 673, activity: { text: "● 1 live now", color: "#f09595" },
  },
];

export type SeedNewsItem = {
  id: string;
  headline: string;
  topicKey: string;
  topicLabel: string;
  dotColor: string;
  when: string;
  suggestedMotion: string;
  liveCount: number;
};

export const SEED_NEWS: SeedNewsItem[] = [
  {
    id: "n-1",
    headline: "Supreme Court to hear landmark social-media age-verification case",
    topicKey: "politics-law", topicLabel: "Politics (Law)", dotColor: "#4a9eff", when: "2h ago",
    suggestedMotion: "Age verification laws violate the First Amendment",
    liveCount: 2,
  },
  {
    id: "n-2",
    headline: "Fed signals rate cut as inflation cools to 2.3%",
    topicKey: "economics", topicLabel: "Economics", dotColor: "#00b894", when: "4h ago",
    suggestedMotion: "Central banks cut rates too late, again",
    liveCount: 0,
  },
  {
    id: "n-3",
    headline: "Fusion startup claims net-positive milestone, physicists skeptical",
    topicKey: "science-tech", topicLabel: "Science & Tech", dotColor: "#00cec9", when: "6h ago",
    suggestedMotion: "Fusion hype is crowding out proven renewables",
    liveCount: 1,
  },
  {
    id: "n-4",
    headline: "Streaming residuals strike enters third week",
    topicKey: "culture", topicLabel: "Culture", dotColor: "#fd79a8", when: "9h ago",
    suggestedMotion: "AI training on creative work requires consent, not compensation",
    liveCount: 0,
  },
  {
    id: "n-5",
    headline: "EU parliament votes on continent-wide deepfake labeling law",
    topicKey: "foreign-policy", topicLabel: "Foreign Policy", dotColor: "#1976D2", when: "11h ago",
    suggestedMotion: "Mandatory AI labeling will be impossible to enforce",
    liveCount: 1,
  },
];

export const SEED_DAILY_MOTION = {
  motion: "Governments should regulate AI companions for minors",
  proVotes: 1344,
  conVotes: 974,
  liveCount: 4,
};
