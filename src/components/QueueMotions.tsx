"use client";

/* Picking the question, when the queue was opened from a headline.

   A headline reports something that happened. The queue matches two
   people on opposite sides, so it needs a claim one of them can refuse —
   and "Energy secretary says US might not reach nuclear agreement with
   Iran" has no other side to take. This is the step in between: four
   questions drafted from the story (api/news/motions), one of each
   shape, or your own words.

   Some stories genuinely carry no argument — a verdict, a death. Then
   the drafting comes back empty and says so, rather than inventing a
   side for a story that hasn't got one. */

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { MOTION_SHAPES, motionProblem, MOTION_MAX, type DraftedMotion } from "@/lib/motions";
import { pickMotion, type QueueStory } from "@/lib/queue";

const label = (shape: string) => MOTION_SHAPES.find((s) => s.key === shape)?.label ?? "";

export default function QueueMotions({ story }: { story: QueueStory }) {
  const [motions, setMotions] = useState<DraftedMotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState<string | null>(null);

  useEffect(() => {
    const stop = new AbortController();
    void (async () => {
      try {
        const r = await fetch("/api/news/motions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headline: story.headline, summary: story.summary ?? null, category: story.category ?? null }),
          signal: stop.signal,
        });
        const body = (await r.json()) as { motions?: DraftedMotion[]; error?: string };
        if (stop.signal.aborted) return;
        if (!r.ok) { setError(body.error ?? "Couldn't read that story."); setMotions([]); return; }
        setMotions(body.motions ?? []);
      } catch {
        if (!stop.signal.aborted) { setError("Couldn't read that story."); setMotions([]); }
      }
    })();
    return () => stop.abort();
  }, [story.headline, story.summary, story.category]);

  const problem = own === null ? null : motionProblem(own);

  return (
    <div className="qd-motions">
      <p className="qd-story">
        <Icon name="newspaper" size={12} /> {story.headline}
      </p>
      <p className="qd-motions-head">What do you want to take a side on?</p>

      {motions === null && <p className="qd-stats">Reading the story…</p>}

      {motions?.length === 0 && (
        <p className="qd-stats">
          {error ?? "There isn’t a side to take on this one — everyone would say the same. Put it in your own words if you disagree."}
        </p>
      )}

      {!!motions?.length && (
        <ul className="qd-chips">
          {motions.map((m) => (
            <li key={m.text}>
              <button type="button" onClick={() => pickMotion(m.text)}>
                <span className="qd-chip-shape">{label(m.shape)}</span>
                <span className="qd-chip-text">{m.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {own === null ? (
        <button type="button" className="qd-own" onClick={() => setOwn("")}>
          <Icon name="pencil" size={12} /> Write your own
        </button>
      ) : (
        <div className="qd-own-box">
          <textarea
            value={own}
            onChange={(e) => setOwn(e.target.value.slice(0, MOTION_MAX))}
            placeholder="Should the EU fine carriers that overbook?"
            aria-label="Your question"
            rows={2}
            autoFocus
          />
          {/* The rule the queue lives by, said once the writing has started. */}
          {own.trim() !== "" && problem && <p className="qd-hint">{problem}</p>}
          <button type="button" className="qd-join" disabled={!!problem} onClick={() => pickMotion(own.trim().replace(/\s+/g, " "))}>
            Use this question
          </button>
        </div>
      )}
    </div>
  );
}
