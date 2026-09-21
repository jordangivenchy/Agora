"use client";

/* A note from the team, under the hero.

   A post a moderator features on the home page used to take a hero
   slide: a wall of text in a card, with a bullet column of the site's
   features beside it — the layout of a template's "what you get", made
   of the same yellow the product uses everywhere. A note from people,
   built from the chrome's own parts, stops reading as a note.

   This is the quiet version: who it's from, two sentences, and a way to
   read the rest — one strip between the hero and Browse. The × puts it
   away for good, until the team writes a new one. */

import { useCallback, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import RichText from "@/components/community/RichText";
import { pathFor } from "@/lib/routes";
import type { FeaturedNote } from "@/lib/homeData";

const KEY = "agora-team-note-read";
const listeners = new Set<() => void>();

const readDismissed = (): string => {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};

/* The first two sentences of the opening paragraph — enough to know
   what the note is about, short enough to stay one line on a wide
   screen. A link in the text stays whole: sentences are cut on the
   full stop, and a link has none inside it. */
export function noteLead(excerpt: string, max = 2): string {
  const parts = excerpt.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lead = parts.slice(0, max).join(" ").trim();
  return lead.replace(/…$/, "") || excerpt;
}

export default function TeamNote({ posts }: { posts: FeaturedNote[] }) {
  const note = posts[0] ?? null;
  /* Read from storage on the client only: the server can't know, and
     showing the note while hydrating and correcting it after is the
     honest order — most people haven't put it away. */
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => "");
  const dismiss = useCallback(() => {
    if (!note) return;
    try { window.localStorage.setItem(KEY, note.id); } catch { /* the note stays; nothing else changes */ }
    for (const l of listeners) l();
  }, [note]);

  if (!note || dismissed === note.id) return null;

  return (
    <aside className="team-note" aria-label="A note from the team">
      {/* The team's own mark, not the poster's face: it is the team's note. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="team-note-face" src="/mark-512.png" alt="" width={36} height={36} />
      <div className="team-note-body">
        <div className="team-note-from">
          <b>{note.authorName}</b> · a note from the team
        </div>
        <p className="team-note-text">
          <RichText text={noteLead(note.excerpt)} inline />
        </p>
        {/* Its own line, so a phone's clamp on the text can never hide it. */}
        <a href={pathFor.post(note.id)} className="team-note-read">
          Read the whole note <Icon name="arrow-up-right" size={12} />
        </a>
      </div>
      <button type="button" className="team-note-close" onClick={dismiss} aria-label="Put this note away">
        <Icon name="x" size={14} />
      </button>
    </aside>
  );
}
