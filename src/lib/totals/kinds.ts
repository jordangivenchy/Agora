/* The fixed lists the anonymous totals are made of (Terms, section 6):
   the sides a speaker can argue, the kinds of argument, what is
   counted, and who is left out. Shared by the reader (read.ts), the
   table (table.ts) and the desk; the database holds the same lists
   (supabase/migrations/20261008_totals.sql) and kinds.test.ts keeps
   them equal.

   A total only ever carries a word from these lists. Nothing a person
   said travels with it. */

/** Raise when KINDS changes, so rooms are read again with the new list. */
export const TAXONOMY = 1;

/** The kinds of argument a speaker leans on. `hint` is what the reader is told to look for. */
export const KINDS = [
  { key: "money", label: "Money and the economy", hint: "costs, prices, jobs, taxes, growth" },
  { key: "fairness", label: "Fairness and rights", hint: "equal treatment, rights, discrimination, who is left out" },
  { key: "freedom", label: "Freedom and choice", hint: "personal liberty, choice, limits on government or on other people" },
  { key: "safety", label: "Safety and harm", hint: "danger, crime, health, security, protecting people" },
  { key: "evidence", label: "Facts and studies", hint: "numbers, research, history, examples offered as proof" },
  { key: "experience", label: "Personal experience", hint: "their own story or that of someone they know" },
  { key: "values", label: "Morals and tradition", hint: "right and wrong, religion, tradition, duty" },
  { key: "practical", label: "Whether it would work", hint: "feasibility, enforcement, unintended effects" },
  { key: "trust", label: "Trust in institutions", hint: "trust or distrust of government, experts, media, companies" },
  { key: "law", label: "What the law says", hint: "legality, the constitution, courts, precedent" },
  { key: "future", label: "The long term", hint: "later generations, where it leads, lasting effects" },
] as const;

export type Kind = (typeof KINDS)[number]["key"];
export const KIND_KEYS: readonly Kind[] = KINDS.map((k) => k.key);
const KIND_SET = new Set<string>(KIND_KEYS);
export const isKind = (v: unknown): v is Kind => typeof v === "string" && KIND_SET.has(v);

/** The side of a room's motion a speaker argued. "unclear" is kept for a
    speaker who was read but took no side; it is never counted as a side. */
export const STANCES = ["for", "against", "mixed", "unclear"] as const;
export type Stance = (typeof STANCES)[number];
export const isStance = (v: unknown): v is Stance => typeof v === "string" && (STANCES as readonly string[]).includes(v);

/** Countries whose residents are not counted: the European Economic Area,
    the United Kingdom and Switzerland, where a political opinion is
    specially protected and counting it needs a yes we do not ask for. */
export const LEFT_OUT: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB", "CH",
];

export const AGE_GROUPS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;

export type Measure = "took_part" | "argued" | "kinds" | "voted";
export type Dimension = "all" | "age" | "country" | "state";
export const DIMENSIONS: readonly Dimension[] = ["all", "age", "country", "state"];

/* What is counted. `exclusive`: a person lands in one part only (or near
   enough: someone can speak in one room and listen in another), so a
   hidden part could be worked out from the whole by subtraction and has
   to be guarded against (table.ts). A speaker uses several kinds of
   argument at once, so those parts overlap and can't be. */
export const MEASURES: Record<Measure, { label: string; about: "topic" | "motion"; any: string; parts: Record<string, string>; exclusive: boolean }> = {
  took_part: {
    label: "Took part",
    about: "topic",
    any: "Took part",
    parts: { spoke: "Spoke on the stage", listened: "Listened" },
    exclusive: true,
  },
  argued: {
    label: "Side argued",
    about: "motion",
    any: "Argued a side",
    parts: { for: "For", against: "Against", mixed: "Both ways" },
    exclusive: true,
  },
  kinds: {
    label: "Kinds of argument",
    about: "topic",
    any: "Speakers read",
    parts: Object.fromEntries(KINDS.map((k) => [k.key, k.label])),
    exclusive: false,
  },
  voted: {
    label: "Votes in the room",
    about: "motion",
    any: "Voted",
    parts: { for: "For", against: "Against" },
    exclusive: true,
  },
};
export const MEASURE_ORDER: readonly Measure[] = ["took_part", "argued", "kinds", "voted"];
