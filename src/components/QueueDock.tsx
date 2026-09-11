"use client";

/* The queue panel: a pop-out at the bottom right (above the tab bar on
   phones) that any "Queue" button opens with its question — the field,
   the question, who is waiting, a side to argue, and Join. Once in the
   queue it folds to a pill that travels with the person wherever they
   browse, polling for a match the whole time, and expands to show what
   they are waiting on with Leave beside each. A match opens the room.
   State and the calls live in lib/queue.ts; this is the frame. */

import { useEffect, useReducer, useState } from "react";
import { Icon } from "@/components/icons";
import { TOPICS } from "@/types/database";
import { collapseQueue, expandQueue, isQueued, joinQueue, leaveQueue, pollQueue, restoreQueue, useQueue, type Stance } from "@/lib/queue";

const field = (key: string) => TOPICS.find((t) => t.key === key) ?? null;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function QueueDock() {
  const q = useQueue();
  const [stance, setStance] = useState<Stance>("PRO");
  /* The waiting clocks read this; it moves once a second while they show. */
  const [now, tick] = useReducer(() => Date.now(), 0);

  useEffect(() => { void restoreQueue(); }, []);
  /* While anything is waiting: poll for the match every few seconds. */
  useEffect(() => {
    if (!q.entries.length || q.matched) return;
    const t = window.setInterval(() => { void pollQueue(); }, 2500);
    return () => clearInterval(t);
  }, [q.entries.length, q.matched]);
  /* The waiting clocks, while they can be seen. */
  useEffect(() => {
    if (!q.entries.length) return;
    queueMicrotask(tick);
    const t = window.setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [q.entries.length]);

  if (!q.preview && !q.entries.length && !q.matched) return null;

  const n = q.entries.length;
  const oldest = n ? Math.min(...q.entries.map((e) => e.since)) : 0;

  if (!q.open) {
    return (
      <button type="button" className="qd-pill" onClick={expandQueue} aria-label="Open the queue">
        <span className="qd-dot" aria-hidden="true" />
        In queue · {n} question{n === 1 ? "" : "s"} · {mmss(now - oldest)}
        <Icon name="chevron-up" size={14} />
      </button>
    );
  }

  const p = q.preview && !isQueued(q.preview.id) ? q.preview : null;
  const pf = p ? field(p.topicKey) : null;
  return (
    <div className="qd" role="dialog" aria-label="Queue">
      <div className="qd-head">
        <span className="qd-title">Queue</span>
        {n > 0 && <span className="qd-count">{n}</span>}
        <button type="button" className="qd-icon" onClick={collapseQueue} aria-label={n ? "Minimize" : "Close"}>
          <Icon name={n ? "minus" : "x"} size={14} />
        </button>
      </div>

      {q.matched && (
        <p className="qd-match"><span className="qd-dot" aria-hidden="true" /> Matched — opening your room…</p>
      )}

      {p && !q.matched && (
        <div className="qd-offer">
          {pf && <span className="qd-field" style={{ color: pf.color }}>{pf.label}</span>}
          <p className="qd-question">{p.question}</p>
          <p className="qd-stats">
            {p.queueCount > 0
              ? <>{p.queueCount} waiting to talk{typeof p.proCount === "number" && typeof p.conCount === "number" ? ` · ${p.proCount} for · ${p.conCount} against` : ""} — you&rsquo;d be matched right away</>
              : "No one waiting yet — you’d be first in line"}
          </p>
          <div className="qd-stance" role="radiogroup" aria-label="Your side">
            <span>I&rsquo;d argue</span>
            <button type="button" role="radio" aria-checked={stance === "PRO"} className={stance === "PRO" ? "is-on" : undefined} onClick={() => setStance("PRO")}>For</button>
            <button type="button" role="radio" aria-checked={stance === "CON"} className={stance === "CON" ? "is-on" : undefined} onClick={() => setStance("CON")}>Against</button>
          </div>
          <button type="button" className="qd-join" disabled={q.busy} onClick={() => { void joinQueue(stance); }}>
            {q.busy ? "Joining…" : p.queueCount > 0 ? "Match now" : "Join the queue"}
          </button>
          {q.error && <p className="qd-error">{q.error}</p>}
        </div>
      )}

      {n > 0 && (
        <ul className="qd-list">
          {q.entries.map((e) => {
            const f = field(e.topicKey);
            return (
              <li key={e.topicId}>
                <div className="qd-entry">
                  <p className="qd-entry-q">{e.question}</p>
                  <p className="qd-entry-meta">
                    {f && <span style={{ color: f.color }}>{f.label}</span>}
                    {f && " · "}{e.stance === "PRO" ? "For" : "Against"} · <span className="qd-dot" aria-hidden="true" /> waiting {mmss(now - e.since)}
                  </p>
                </div>
                <button type="button" className="qd-leave" disabled={q.busy || !!q.matched} onClick={() => { void leaveQueue(e.topicId); }}>Leave</button>
              </li>
            );
          })}
        </ul>
      )}

      {n > 0 && !q.matched && (
        <p className="qd-note">You&rsquo;ll be brought into the room the moment someone takes the other side. Keep browsing — this stays with you.</p>
      )}
    </div>
  );
}
