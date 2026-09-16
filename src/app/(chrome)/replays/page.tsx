/* /replays — every past discussion worth watching, newest first.

   Rendered on the server: this is the page a stranger lands on from a
   shared link and the one a search engine reads, so it arrives as words
   and links rather than a spinner waiting for JavaScript. The fields and
   the pages are plain links (?field=, ?page=), so every slice of the
   archive has an address someone can send. */

import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase-server";
import { countReplays, fetchReplays, fieldLabel, REPLAY_FIELDS } from "@/lib/replaysData";
import { replayPath } from "@/lib/urls";
import { fmtDay, roomDuration } from "@/lib/duration";
import { displayName } from "@/lib/names";

const PER_PAGE = 24;

type Props = { searchParams: Promise<{ field?: string; page?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { field } = await searchParams;
  const label = field ? fieldLabel(field) : "";
  const title = label ? `${label} discussions` : "Past discussions";
  return {
    title: `${title} · AgoraSphere`,
    description: label
      ? `Recorded ${label.toLowerCase()} discussions on AgoraSphere: people taking sides out loud, with the transcript and the argument that followed.`
      : "Recorded discussions on AgoraSphere: people taking sides out loud, with the transcript and the argument that followed.",
    alternates: { canonical: field ? `/replays?field=${field}` : "/replays" },
  };
}

export default async function ReplaysIndex({ searchParams }: Props) {
  const { field: rawField, page: rawPage } = await searchParams;
  const field = REPLAY_FIELDS.some((f) => f.key === rawField) ? rawField! : null;
  const page = Math.max(1, Number(rawPage) || 1);
  const supabase = await createClient();
  const [rows, total] = await Promise.all([
    fetchReplays(supabase, { field, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    countReplays(supabase, field),
  ]);
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (f: string | null, p = 1) => {
    const q = new URLSearchParams();
    if (f) q.set("field", f);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/replays?${s}` : "/replays";
  };

  return (
    <main className="rp-index">
      <header className="rp-index-head">
        <h1>Past discussions</h1>
        <p>
          {total === 0
            ? "Nothing recorded here yet."
            : `${total} recorded ${total === 1 ? "discussion" : "discussions"}${field ? ` in ${fieldLabel(field)}` : ""} — the room, the transcript, and what people said afterwards.`}
        </p>
      </header>

      <nav className="rp-fields" aria-label="Fields">
        <Link href={href(null)} className={`rp-field ${field ? "" : "on"}`} aria-current={field ? undefined : "page"}>
          Everything
        </Link>
        {REPLAY_FIELDS.map((f) => (
          <Link key={f.key} href={href(f.key)} className={`rp-field ${field === f.key ? "on" : ""}`} aria-current={field === f.key ? "page" : undefined} style={field === f.key ? { borderColor: f.color } : undefined}>
            <span className="rp-field-dot" style={{ background: f.color }} aria-hidden="true" />
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rp-empty">
          {field ? "No discussions in this field yet." : "No discussions have been recorded yet."} <Link href={href(null)}>See everything</Link>
        </p>
      ) : (
        <ul className="rp-grid">
          {rows.map((r) => {
            const length = roomDuration(r.started_at, r.ended_at);
            const who = r.host ? displayName(r.host) || r.host.username : null;
            return (
              <li key={r.id} className="rp-card">
                <Link href={replayPath(r)} className="rp-card-link">
                  <span className="rp-thumb">
                    {/* The room's own still, or the host's face — a wall of
                        empty rectangles tells a newcomer nothing. */}
                    {r.thumbnail_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={r.thumbnail_url} alt="" loading="lazy" decoding="async" />
                    ) : r.host?.avatar_url ? (
                      <span className="rp-thumb-face">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.host.avatar_url} alt="" loading="lazy" decoding="async" />
                      </span>
                    ) : (
                      <span className="rp-thumb-empty" aria-hidden="true" />
                    )}
                    {length && <span className="rp-length">{length}</span>}
                  </span>
                  <span className="rp-motion">{r.motion || "Discussion"}</span>
                  <span className="rp-meta">
                    {who && <span className="rp-host">{who}</span>}
                    {r.ended_at && <span>{fmtDay(r.ended_at)}</span>}
                    {!!r.replay_views && <span>{r.replay_views} {r.replay_views === 1 ? "view" : "views"}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="rp-pages" aria-label="Pages">
          {page > 1 && <Link href={href(field, page - 1)} rel="prev">← Newer</Link>}
          <span>Page {page} of {lastPage}</span>
          {page < lastPage && <Link href={href(field, page + 1)} rel="next">Older →</Link>}
        </nav>
      )}
    </main>
  );
}
