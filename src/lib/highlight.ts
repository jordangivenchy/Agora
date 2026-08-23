/* Query-term highlighting for search results.

   highlightSegments(text, query) splits `text` into runs, flagging the
   ones that match a query term. Terms are the query's words (quotes and
   websearch operators stripped, accents folded, case-insensitive) and a
   run matches when a term appears as a prefix of a word — mirroring the
   prefix tsquery search_all uses — or anywhere inside it for terms of
   three or more characters. The caller renders `hit` runs as <mark>. */

export type Segment = { text: string; hit: boolean };

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of fold(query).split(/\s+/)) {
    const t = raw.replace(/[^\p{L}\p{N}]/gu, "");
    if (!t || t === "or" || t === "and" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  // Longest first so "agora" wins over "ago" when both are terms.
  return out.sort((a, b) => b.length - a.length);
}

export function highlightSegments(text: string, query: string): Segment[] {
  const terms = queryTerms(query);
  if (!text) return [];
  if (terms.length === 0) return [{ text, hit: false }];

  /* Work on the folded string; it is the same length as the original
     only when folding removed nothing, so map indices through an array
     of per-character folded forms instead. */
  const chars = Array.from(text);
  const folded = chars.map((c) => fold(c));
  const flat = folded.join("");
  // flat index → original char index
  const origIndex: number[] = [];
  folded.forEach((f, i) => { for (let k = 0; k < f.length; k++) origIndex.push(i); });

  const hits = new Array<boolean>(chars.length).fill(false);
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = flat.indexOf(term, from);
      if (at < 0) break;
      const atWordStart = !isWordChar(flat[at - 1]);
      if (atWordStart || term.length >= 3) {
        for (let k = at; k < at + term.length; k++) hits[origIndex[k]] = true;
      }
      from = at + 1;
    }
  }

  const segs: Segment[] = [];
  let cur = "";
  let curHit = hits[0];
  chars.forEach((c, i) => {
    if (hits[i] !== curHit) {
      if (cur) segs.push({ text: cur, hit: curHit });
      cur = "";
      curHit = hits[i];
    }
    cur += c;
  });
  if (cur) segs.push({ text: cur, hit: curHit });
  return segs;
}

/** Trim `text` to a window around the first hit (for long bodies). */
export function excerptAround(text: string, query: string, radius = 90): string {
  const terms = queryTerms(query);
  const f = fold(text);
  let at = -1;
  for (const t of terms) {
    const i = f.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.length > radius * 2 ? text.slice(0, radius * 2).trimEnd() + "…" : text;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}
