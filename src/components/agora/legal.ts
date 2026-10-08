/* AgoraSphere's terms (the EULA) and privacy policy, as data, so the
   website (/terms, /privacy, /agree, Settings) and the phone app show
   the same words. This folder is the one both builds read.

   A DRAFT FOR A LAWYER TO MARK UP, written to say plainly what the
   product actually does (checked against the code on 2026-10-07): it is
   not legal advice and nobody qualified has reviewed it.

   `version` is what a person agrees to (user_agreements.version). Bump
   it whenever a change matters and everyone is asked to agree again. */

export const LEGAL = {
  version: "2026-10-07",
  effective: "October 7, 2026",
  /** The youngest a person may be to use AgoraSphere. */
  minAge: 18,
  /** Nothing drawn from fewer people than this goes into the totals we may share. */
  totalsFloor: 25,

  /* Three facts only the people who run AgoraSphere can supply. Until
     all three are filled in, both documents show as a draft and nobody
     is asked to agree to them (legalReady). */
  /** The legal name of the person or company that runs AgoraSphere. */
  operator: "",
  /** Whose law governs, as a contract would say it: "the State of …, United States". */
  law: "",
  /** An address that a person reads. */
  contact: "",
};

/** Are the documents complete enough to ask people to agree to them? */
export function legalReady(): boolean {
  return Boolean(LEGAL.operator && LEGAL.law && LEGAL.contact);
}

/** What is still missing, in plain words. */
export function legalBlanks(): string[] {
  const missing: string[] = [];
  if (!LEGAL.operator) missing.push("who runs AgoraSphere (a legal name)");
  if (!LEGAL.law) missing.push("whose law governs");
  if (!LEGAL.contact) missing.push("a contact address");
  return missing;
}

/** A paragraph, or a list of points. */
export type LegalBlock = string | { list: string[] };
export interface LegalSection {
  id: string;
  title: string;
  body: LegalBlock[];
}

const TBC = "[to be confirmed]";
const operator = () => LEGAL.operator || TBC;
const law = () => LEGAL.law || TBC;
const contact = () => LEGAL.contact || TBC;

/** The points that matter most, shown where a person is asked to agree. */
export function termsSummary(): string[] {
  return [
    `You are ${LEGAL.minAge} or older.`,
    "Rooms are recorded and transcribed, and kept as replays that people can watch and clip.",
    "No harassment, threats, hate or illegal content. We remove it, and the people who post it.",
    "What you post and say stays yours. You let us show it on AgoraSphere.",
    "We may share or sell totals about what is said in public rooms that can't be traced to anyone. We never sell anything about you personally, and you can leave your words out.",
  ];
}

export function termsSections(): LegalSection[] {
  return [
    {
      id: "what-this-is",
      title: "1. What this is",
      body: [
        `AgoraSphere is a place for live discussions: rooms where people talk on a stage in front of an audience, and the communities, posts and messages around them. It is run by ${operator()} ("we", "us").`,
        'These terms are the agreement between you and us. You accept them when you create an account, and when you tick the box and choose "Agree and continue". If you use AgoraSphere without an account, they apply to that too. If you don\'t agree, please don\'t use AgoraSphere.',
        "AgoraSphere is in closed beta. Features change, and sometimes things break.",
      ],
    },
    {
      id: "who-can-use-it",
      title: "2. Who can use it",
      body: [
        {
          list: [
            `You must be ${LEGAL.minAge} or older. We ask your date of birth to check, and an account that gives a date younger than that is put on hold.`,
            "Tell us the country you live in and, in the United States, the state, and change it in Settings if you move.",
            "One account per person. Give accurate details and keep your sign-in details to yourself.",
            "You are responsible for what happens under your account. Tell us if you think someone else has got into it.",
          ],
        },
      ],
    },
    {
      id: "rooms",
      title: "3. Rooms, recordings and transcripts",
      body: [
        "A public room can be watched live by anyone on AgoraSphere, and afterwards as a replay. A room limited to an invite code, friends, followers or a community can be watched, live and afterwards, by the people who are able to enter it.",
        {
          list: [
            "Rooms are recorded unless the host has turned recording off or has run out of recording space. A recording takes in the stage: everyone who speaks, appears on camera or shares a screen there.",
            "Recordings are transcribed automatically. The transcript shows who said each line. It is made by software and contains mistakes.",
            "People who can watch a replay can share it and cut clips from it with the tools we provide.",
          ],
        },
        "By speaking, appearing on camera or sharing your screen in a room, you agree to being recorded, transcribed, replayed and clipped in these ways. If you don't want that, stay in the audience.",
      ],
    },
    {
      id: "rules",
      title: "4. Rules",
      body: [
        "Argue as hard as you like about ideas. We have no tolerance for objectionable content or abusive behaviour. Do not:",
        {
          list: [
            "harass, threaten or bully anyone, or encourage others to;",
            "attack people for who they are: their race, ethnicity, nationality, religion, sex, gender, sexual orientation, disability or age;",
            "post sexual content involving anyone under 18, or intimate images of anyone without their consent;",
            "share someone's private details (an address, a phone number, a workplace) without their consent;",
            "post or do anything illegal, or help others to;",
            "spam, run scams, use bots or fake accounts, or rig votes;",
            "pretend to be someone you are not;",
            "break into, overload or scrape AgoraSphere, or get around a block or a suspension.",
          ],
        },
        "Use Report on a person (from their profile, a room or your messages) when they break these rules, and Block to stop someone reaching you. We review reports and act on them: we remove content, and we suspend or remove the accounts behind it.",
      ],
    },
    {
      id: "your-content",
      title: "5. What you post and say",
      body: [
        "What you post, say and show on AgoraSphere stays yours.",
        "You give us permission to host it, store it, copy it, adapt it (for example to transcribe, caption, clip or resize it), publish it and distribute it, as part of AgoraSphere and to make AgoraSphere known. This permission is worldwide, non-exclusive and free of charge, and lasts for as long as the content is on AgoraSphere. Other people may view, share and clip what they are able to see, using the tools we provide.",
        "You promise that you have the right to share what you share, and that it doesn't break the rules above. We may remove content that does.",
      ],
    },
    {
      id: "totals",
      title: "6. Anonymous totals",
      body: [
        "We study what is said in public rooms to understand what people discuss and which arguments persuade them. We may publish, share or sell what we learn, but only as totals that cannot be traced to a person:",
        {
          list: [
            "no names, usernames, voices or pictures;",
            "no quotes;",
            `nothing drawn from fewer than ${LEGAL.totalsFloor} people.`,
          ],
        },
        "A total may be split by age group, or by country or state. The same limits apply to every part of it.",
        "Only what you say after agreeing to these terms is counted. People who live in the European Economic Area, the United Kingdom or Switzerland are not counted.",
        "We never sell information about you personally. Rooms that are not public, and your messages, are never used for this.",
        "You can leave your words out of these totals at any time: Settings, then Data & Coach.",
      ],
    },
    {
      id: "automated",
      title: "7. Automated features",
      body: [
        "Transcripts, captions, fact-checks, moderation prompts and coaching notes are produced by software, including AI models run by other companies. They can be wrong. Don't rely on them as fact or as professional advice.",
      ],
    },
    {
      id: "leaving",
      title: "8. Changes, suspension and leaving",
      body: [
        "We may change or withdraw features. We may suspend or close an account that breaks these terms or puts other people at risk.",
        "You can delete your account at any time: Settings, then Danger zone. That removes your profile, your sign-in details, your follows, blocks and settings. Discussions you took part in are kept for the other people in them, shown as from a deleted account.",
      ],
    },
    {
      id: "app",
      title: "9. The phone app",
      body: [
        "If you got the AgoraSphere app from Apple's App Store, these points apply as well:",
        {
          list: [
            "These terms are between you and us, not Apple. Apple is not responsible for the app or what is in it.",
            "You may use the app only on Apple devices you own or control, as Apple's usage rules allow.",
            "Apple has no duty to maintain or support the app. If the app fails to meet a warranty that applies, you may tell Apple and Apple will refund what you paid for it, if anything; beyond that, and as far as the law allows, Apple has no warranty obligation for the app.",
            "Claims about the app are ours to deal with, not Apple's: product liability, a failure to meet a legal requirement, consumer protection, and claims that the app infringes someone's rights.",
            "You confirm that you are not in a country under a United States government embargo or one it has named as supporting terrorism, and that you are not on a United States government list of prohibited or restricted parties.",
            "Apple and its subsidiaries are third-party beneficiaries of these terms, and may enforce them against you.",
          ],
        },
      ],
    },
    {
      id: "liability",
      title: "10. No promises, and the limits of our liability",
      body: [
        "AgoraSphere is provided as it is. We don't promise that it will always be available, accurate or free of errors. What people say on AgoraSphere is their own; we don't endorse it.",
        "As far as the law allows, we are not liable for indirect or consequential loss, lost profit or lost data, and our total liability to you for anything to do with AgoraSphere is limited to US$100. Where the law doesn't allow a limit like this, it applies only as far as the law permits.",
        "If something you post, or your breaking these terms, leads to a claim against us, you will cover our reasonable costs.",
      ],
    },
    {
      id: "law",
      title: "11. Law and disputes",
      body: [`These terms are governed by the laws of ${law()}, and disputes about them go to the courts there.`],
    },
    {
      id: "changes",
      title: "12. Changes to these terms",
      body: [
        "We may update these terms. When a change matters, we will ask you to agree again before you carry on. The version in force and its date are at the top of this page.",
      ],
    },
    {
      id: "contact",
      title: "13. Contact",
      body: [`Questions about these terms: ${contact()}.`],
    },
  ];
}

export function privacySections(): LegalSection[] {
  return [
    {
      id: "what-we-hold",
      title: "1. What we hold",
      body: [
        {
          list: [
            "Your account: your email address, username, display name, and the picture, banner, bio and links you add. If you sign in with Google or Discord, they tell us your email address, your name there and your picture.",
            "About you: the year you were born, the country you live in and, in the United States, the state. We ask for your full date of birth once, to check that you are old enough, and keep only the year.",
            "What you post: posts, comments, votes, messages, the people you follow and block, and the reports you send.",
            "What you say in rooms: your voice, camera and shared screen while you are on a stage, the room's chat, and the recording and transcript when the room is recorded (the Terms, section 3).",
            "How you use AgoraSphere: the pages and rooms you open, what you watch, like and follow, and the notifications you choose. You can switch this off in Settings, under Data & Coach.",
            "Technical details: your IP address, your browser or device, and a notification address if you turn notifications on.",
          ],
        },
        "We keep you signed in with cookies, remember your closed-beta pass with one, and store a few preferences in your browser. We don't use advertising cookies or trackers.",
      ],
    },
    {
      id: "what-we-do",
      title: "2. What we do with it",
      body: [
        {
          list: [
            "Run AgoraSphere: show your profile, posts and rooms to the people allowed to see them, and deliver calls, replays, messages and notifications.",
            "Keep it safe: act on reports, enforce the rules, and stop spam and abuse.",
            "Check that you are old enough, and follow the privacy rules of the place you live.",
            "Make recordings, transcripts and clips of rooms.",
            "Improve it: see what works and fix what doesn't.",
            `Work out anonymous totals about what is said in public rooms, which we may publish, share or sell (the Terms, section 6). A total may be split by age group, or by country or state. Totals carry no names, usernames, voices, pictures or quotes, and nothing drawn from fewer than ${LEGAL.totalsFloor} people. To make them, an AI model sorts what a speaker argued in a public room into a side and kinds of argument; none of their words are kept with it, and what it made of your rooms is in your download.`,
            "When Agora's assistant is switched on: analysis of how you argue, recommendations and coaching, each with its own switch in Settings.",
          ],
        },
        "We do not sell information about you personally, and we do not show advertising based on it.",
      ],
    },
    {
      id: "who-sees-it",
      title: "3. Who sees it",
      body: [
        "Other people on AgoraSphere see what you make public: your profile, your posts and comments, what you say in rooms, and the replays, transcripts and clips of those rooms. Messages are seen by the people you send them to.",
        "These companies handle information for us so that AgoraSphere can run, and may only use it for that:",
        {
          list: [
            "Supabase: the database, sign-in and stored pictures.",
            "Vercel: the website.",
            "LiveKit: live audio and video, and recording.",
            "Cloudflare: storage of recordings.",
            "Google: sign-in with Google, and the AI model that writes transcripts and sorts what was argued for the anonymous totals.",
            "Discord: sign-in with Discord, and your beta key if you get it there.",
            "Anthropic: a second AI model for Agora's assistant, when that is switched on.",
            "Resend: email.",
            "Your browser's or phone's notification service, if you turn notifications on.",
          ],
        },
        "We may also disclose information when the law requires it, to protect someone's safety, or to a company that takes over AgoraSphere, which would be bound by this policy.",
      ],
    },
    {
      id: "your-choices",
      title: "4. Your choices",
      body: [
        {
          list: [
            "Edit your profile, and choose whether your discussions show on it: Settings.",
            "Change your country or state: Settings, then Terms & privacy.",
            "Choose which notifications and emails you get: Settings, then Notifications.",
            "Switch off activity analytics, and leave your words out of anonymous totals: Settings, then Data & Coach.",
            "Download, or delete, what AgoraSphere has recorded and worked out from your activity: Settings, then Data & Coach.",
            "Stop recording the rooms you host: Settings, then Recordings & storage.",
            "Delete your account: Settings, then Danger zone.",
          ],
        },
        `For anything these don't cover (for example removing a recording you appear in, or correcting the year you were born), write to ${contact()}.`,
      ],
    },
    {
      id: "how-long",
      title: "5. How long we keep it",
      body: [
        "We keep your account until you delete it. When you do, your profile, sign-in details, follows, blocks and settings are removed; discussions you took part in are kept for the other people in them, shown as from a deleted account.",
        "Recordings, transcripts and clips are kept for as long as the room's replay is. The notes that tell a transcript who was speaking are deleted after 35 days. Backups and server logs are kept for a limited time.",
      ],
    },
    {
      id: "security",
      title: "6. How we protect it",
      body: [
        "Information travels encrypted between you and AgoraSphere, calls included. Calls are not end-to-end encrypted: our servers handle the audio and video in order to deliver and record it. No service can promise perfect security.",
      ],
    },
    {
      id: "where",
      title: "7. Where it is kept",
      body: ["AgoraSphere is run from the United States, and information is processed there and wherever the companies listed above operate."],
    },
    {
      id: "age",
      title: "8. Age",
      body: [`AgoraSphere is for people aged ${LEGAL.minAge} and over. We ask for a date of birth to check, and an account that gives a date younger than that is put on hold. We don't knowingly hold information about anyone younger; tell us if you think we do, and we will remove it.`],
    },
    {
      id: "rights",
      title: "9. Your rights",
      body: [
        "Depending on where you live (for example the European Economic Area, the United Kingdom or California), the law may give you the right to see the information we hold about you, to have it corrected or deleted, to object to or limit how we use it, and to take a copy elsewhere. Using these rights will never cost you your account or worsen your service.",
        `The controls in section 4 cover most of this. For the rest, write to ${contact()}.`,
      ],
    },
    {
      id: "changes",
      title: "10. Changes to this policy",
      body: ["When this policy changes in a way that matters, we will tell you and, where the Terms require it, ask you to agree again. The version in force and its date are at the top of this page."],
    },
    {
      id: "contact",
      title: "11. Contact",
      body: [`${operator()}: ${contact()}.`],
    },
  ];
}
