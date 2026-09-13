/* Clean text: the blocked-terms gate for everything a person types that
   others will see. The list lives in blockedTerms.json with a severity
   per term; the database holds the same list (public.blocked_terms) and
   the same folding (find_blocked_term, migration 20260914_clean_text),
   and its triggers are the real gate. This copy gives the composers an
   answer before the round trip. Keep the two foldings identical: the
   cases in cleanText.cases.json run against both.

   Surfaces:
     name  (min severity 1)  usernames, display names, bios, room titles,
                             community names, post titles
     body  (min severity 2)  post bodies, comments, room chat, community
                             descriptions and rules, the room frame
   The body level mirrors app_config.clean_body_min_severity; set that to
   3 (and BODY_MIN here) to let swearing through in bodies while slurs
   stay refused.

   Folding: NFKD and no accents, lowercase, lookalike letters (Cyrillic,
   Greek) to Latin, ß→ss, punctuation glued to a word dropped, leetspeak
   to letters, spaced-out single letters joined. Then variants: short
   chunks joined to their neighbours ("fu ck", "a ss"), repeated letters
   squeezed ("fuuuck"), and both. A term must match as a whole word; a
   phrase matches with or without separators between its words. */

import terms from "./blockedTerms.json";

export type Severity = 1 | 2 | 3;
export const NAME_MIN: Severity = 1;
export const BODY_MIN: Severity = 2;

const groups: Array<[Record<string, string[]>, Severity]> = [
  [terms.hate, 3],
  [terms.obscene, 2],
  [terms.crude, 1],
];

/** Every term with its severity, hate first. */
export const BLOCKED: ReadonlyArray<readonly [string, Severity]> = groups.flatMap(([g, sev]) =>
  Object.values(g).flat().map((t) => [t, sev] as const)
);
const SEVERITY = new Map<string, Severity>(BLOCKED);
const RAW_PATTERNS = terms.raw_patterns.map((p) => new RegExp(p));
const CONFUSABLE = new Map<string, string>(terms.confusables as Array<[string, string]>);

const SEP = "[\\s._*-]";
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t" };

const RUN = /(?<![a-z])([a-z](?:[\s._*-]+[a-z](?![a-z]))+)/g;
const collapse = (run: string) => run.replace(/[\s._*-]+/g, "");

/** The base folding: what the matcher sees; the pre-leetspeak text for numeric codes; and the
 *  spaced-out runs with their first letter kept apart ("a f u c k" is "a fuck" as well as "afuck"). */
export function foldText(s: string): { base: string; raw: string; split: string } {
  let t = s.normalize("NFKD").replace(/[\u0300-\u036F]/g, "").toLowerCase();
  t = t.replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe");
  t = t.replace(/[^\x00-\x7F]/g, (c) => CONFUSABLE.get(c) ?? c);
  const raw = t;
  t = t.replace(/(?<![a-z!|+])[!|+]+|[!|+]+(?![a-z!|+])/g, " ");
  t = t.replace(/[0134578@$!|+]/g, (c) => LEET[c] ?? c);
  const split = t.replace(RUN, (m) => {
    const c = collapse(m);
    return c.length >= 3 ? `${c[0]} ${c.slice(1)}` : c;
  });
  const base = t.replace(RUN, (m) => collapse(m));
  return { base, raw, split };
}

/** Same as before this file: the folded text alone. */
export function foldObfuscation(s: string): string {
  return foldText(s).base;
}

function joinShort(t: string): string {
  let cur = t;
  for (let i = 0; i < 4; i++) {
    const prev = cur;
    cur = cur
      .replace(/(?<![a-z])([a-z]{1,2})[\s._*-]+([a-z]{3,})(?![a-z])/g, "$1$2")
      .replace(/(?<![a-z])([a-z]{3,})[\s._*-]+([a-z]{1,2})(?![a-z])/g, "$1$2")
      .replace(/(?<![a-z])([a-z])[\s._*-]+([a-z]{1,2})(?![a-z])/g, "$1$2");
    if (cur === prev) break;
  }
  return cur;
}

/* Two tiny chunks joined ("sh it", "ni gg er"): checked for obscene and
   hate terms only, since "an al" is a person's name, not a body part. */
function joinTiny(t: string): string {
  let cur = t;
  for (let i = 0; i < 4; i++) {
    const prev = cur;
    cur = cur.replace(/(?<![a-z])([a-z]{1,2})[\s._*-]+([a-z]{1,2})(?![a-z])/g, "$1$2");
    if (cur === prev) break;
  }
  return cur;
}

const squeeze3 = (t: string) => t.replace(/([a-z])\1{2,}/g, "$1");
const squeeze1 = (t: string) => t.replace(/([a-z])\1+/g, "$1");

/** The folded variants to try, each with the lowest severity it may report. */
export function foldVariants(fold: { base: string; split: string }, min: Severity): Array<[string, Severity]> {
  const { base, split } = fold;
  const joined = joinShort(base);
  const tiny = joinShort(joinTiny(base));
  const strict = Math.max(min, 2) as Severity;
  const out: Array<[string, Severity]> = [
    [base, min],
    [joined, min],
    [squeeze3(base), min],
    [squeeze1(base), min],
    [squeeze1(joined), min],
    [split, min],
    [joinShort(split), min],
    [tiny, strict],
    [squeeze1(tiny), strict],
  ];
  const seen = new Set<string>();
  return out.filter(([v, m]) => {
    const key = `${m}:${v}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const patterns = new Map<Severity, RegExp>();
function pattern(min: Severity): RegExp {
  let re = patterns.get(min);
  if (!re) {
    const alts = BLOCKED.filter(([, s]) => s >= min)
      .map(([t]) => t.replace(/ /g, `${SEP}*`))
      .sort((a, b) => b.length - a.length);
    re = new RegExp(`(?<![a-z])(${alts.join("|")})(?![a-z])`);
    patterns.set(min, re);
  }
  return re;
}

function canonical(matched: string): string {
  const hit = BLOCKED.find(([t]) => new RegExp(`^${t.replace(/ /g, `${SEP}*`)}$`).test(matched));
  return hit ? hit[0] : matched;
}

export interface BlockedHit {
  term: string;
  severity: Severity;
}

/** The blocked term in `s` at or above `min`, or null. */
export function findBlocked(s: string, min: Severity = NAME_MIN): BlockedHit | null {
  if (!s) return null;
  const fold = foldText(s);
  for (const [v, m] of foldVariants(fold, min)) {
    const hit = pattern(m).exec(v);
    if (hit) {
      const term = canonical(hit[1]);
      return { term, severity: SEVERITY.get(term) ?? 3 };
    }
  }
  if (min <= 1) {
    for (const p of RAW_PATTERNS) {
      const hit = p.exec(fold.raw);
      if (hit) return { term: hit[0], severity: 1 };
    }
  }
  return null;
}

/** The blocked term in `s` at or above `min`, or null. */
export function findBlockedTerm(s: string, min: Severity = NAME_MIN): string | null {
  return findBlocked(s, min)?.term ?? null;
}

/** What to tell the person. A slur is not repeated back. */
export function blockedMessage(hit: BlockedHit): string {
  return hit.severity >= 3 ? "That includes a word we don't allow." : `That includes a word we don't allow ("${hit.term}").`;
}

/** The message for a surface, or null when the text is clean. */
export function cleanTextError(s: string, min: Severity): string | null {
  const hit = findBlocked(s, min);
  return hit ? blockedMessage(hit) : null;
}
