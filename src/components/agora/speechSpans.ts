/* Who is speaking, kept as spans of time. The call tells every page in a
   room who is speaking at each moment; the page LiveKit films for the
   recording (the broadcast view) turns that into "this person, from here
   to there" on its own clock — the clock that stamps the recording — and
   sends it on, so the replay's transcript can say who said each line
   (lib/replayAttribution). No React, no network: see useRecorderSpeech. */

export interface ReportedSpan {
  /** The speaker's identity in the call: their account id. */
  id: string;
  /** Epoch ms, start and end. */
  s: number;
  e: number;
}

/** Shorter than this is a click or a cough the call barely noticed. */
const MIN_MS = 120;
/** Spans held when a report can't get out; the oldest go first. */
const KEEP = 1500;
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SpeechSpans {
  private open = new Map<string, number>();
  private done: ReportedSpan[] = [];

  /** The call's list of who is speaking, as of `now`. Anyone who isn't an
      account (a recorder, a stream) is left out. */
  update(speaking: Iterable<string>, now: number): void {
    const live = new Set<string>();
    for (const id of speaking) if (ACCOUNT_ID.test(id)) live.add(id);
    for (const [id, since] of this.open) {
      if (!live.has(id)) {
        this.open.delete(id);
        this.close(id, since, now);
      }
    }
    for (const id of live) if (!this.open.has(id)) this.open.set(id, now);
  }

  /** Everything finished since the last take. Whoever is mid-sentence is
      cut at `now` and carries on from there, so nothing waits for a long
      turn to end. */
  take(now: number): ReportedSpan[] {
    for (const [id, since] of this.open) {
      this.close(id, since, now);
      this.open.set(id, now);
    }
    const out = this.done;
    this.done = [];
    return out;
  }

  /** Put back what a report failed to deliver, ahead of anything newer. */
  restore(spans: ReportedSpan[]): void {
    this.done = [...spans, ...this.done].slice(-KEEP);
  }

  private close(id: string, since: number, now: number): void {
    if (now - since < MIN_MS) return;
    this.done.push({ id, s: since, e: now });
    if (this.done.length > KEEP) this.done.shift();
  }
}
