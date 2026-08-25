"use client";

/* "People to follow" — a row (or grid) of suggested accounts from
   get_people_suggestions, each with a reason line and a Follow button
   (follow_user / unfollow_user, the same RPCs ProfileView uses).
   Shared by the home feed, search results and the welcome flow. */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import VerifiedBadge from "@/components/VerifiedBadge";

export type Suggestion = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  verified: boolean;
  reason: string;
  mutual_count: number;
  debates_30d: number;
};

interface Props {
  limit?: number;
  /** "row" scrolls horizontally; "grid" wraps. */
  layout?: "row" | "grid";
  /** Called once the RPC has resolved, with how many rows came back. */
  onLoaded?: (count: number) => void;
  /** Fires after a successful follow/unfollow. */
  onFollowChange?: (userId: string, following: boolean) => void;
  title?: string | null;
}

export function useFollowToggle() {
  const [supabase] = useState(() => createClient());
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = useCallback(async (userId: string, current?: boolean) => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.href = "/login"; return null; }
    const isFollowing = following[userId] ?? current ?? false;
    setBusy(userId);
    const { error } = await supabase.rpc(isFollowing ? "unfollow_user" : "follow_user", { p_target: userId });
    setBusy(null);
    if (error) return null;
    setFollowing((m) => ({ ...m, [userId]: !isFollowing }));
    window.dispatchEvent(new CustomEvent("follows-updated", { detail: { userId, following: !isFollowing } }));
    return !isFollowing;
  }, [supabase, following]);
  return { following, busy, toggle, setFollowing };
}

export function FollowButton({
  userId, following, busy, onToggle, small,
}: { userId: string; following: boolean; busy: boolean; onToggle: (id: string, current: boolean) => void; small?: boolean }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(userId, following); }}
      disabled={busy}
      className="cursor-pointer shrink-0"
      style={{
        fontFamily: "inherit",
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        padding: small ? "4px 10px" : "6px 14px",
        borderRadius: 99,
        background: following ? "rgba(255,255,255,0.06)" : "#4a9eff",
        border: following ? "0.5px solid rgba(255,255,255,0.18)" : "0.5px solid transparent",
        color: following ? "rgba(238,238,245,0.8)" : "#fff",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

export function PersonCard({
  person, following, busy, onToggle, compact,
}: { person: Suggestion; following: boolean; busy: boolean; onToggle: (id: string, current: boolean) => void; compact?: boolean }) {
  /* Every card renders the same three lines — name, @handle, reason —
     whether or not a display name exists, so a row of cards stays the
     same height and the Follow buttons sit on one line (mt-auto pins
     them to the bottom as the final guarantee). */
  const name = person.display_name?.trim() || person.username;
  return (
    <a
      href={`/@${encodeURIComponent(person.username)}`}
      className="no-underline flex flex-col items-center text-center shrink-0"
      style={{
        width: compact ? 140 : 168,
        padding: compact ? "12px 10px" : "16px 12px",
        borderRadius: 14,
        background: "rgba(14,14,17,0.72)",
        border: "1px solid rgba(255,255,255,0.07)",
        color: "inherit",
      }}
    >
      <UserAvatar size={compact ? 48 : 56} username={person.username} avatarUrl={person.avatar_url} seed={person.id} />
      <p className="m-0 mt-2 text-[13px] font-semibold inline-flex items-center gap-1 max-w-full" style={{ color: "#eeeef5" }}>
        <span className="truncate">{name}</span>
        {person.verified && <VerifiedBadge size={12} />}
      </p>
      <p className="m-0 mt-0.5 text-[11px] truncate max-w-full" style={{ color: "rgba(238,238,245,0.45)" }}>@{person.username}</p>
      <p className="m-0 text-[10.5px] leading-snug" style={{
        color: "rgba(238,238,245,0.5)", minHeight: 26,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {person.reason}
      </p>
      {/* Gap above the button mirrors the card's bottom padding, so the
          button floats an equal distance from the text and the edge. */}
      <div className="mt-auto" style={{ paddingTop: compact ? 12 : 16 }}>
        <FollowButton userId={person.id} following={following} busy={busy} onToggle={onToggle} small={compact} />
      </div>
    </a>
  );
}

export default function PeopleSuggestions({ limit = 8, layout = "row", onLoaded, onFollowChange, title = "People to follow" }: Props) {
  const [supabase] = useState(() => createClient());
  const [people, setPeople] = useState<Suggestion[] | null>(null);
  const { following, busy, toggle } = useFollowToggle();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_people_suggestions", { p_limit: limit });
      if (cancelled) return;
      const rows = error ? [] : ((data ?? []) as Suggestion[]);
      setPeople(rows);
      onLoaded?.(rows.length);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, limit]);

  if (!people || people.length === 0) return null;

  return (
    <section>
      {title && (
        <p className="m-0 mb-2 text-[12px] font-semibold inline-flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.7)" }}>
          <Icon name="user-plus" size={13} /> {title}
        </p>
      )}
      <div
        className={layout === "row" ? "flex gap-3 overflow-x-auto pb-1" : "flex gap-3 flex-wrap"}
        style={layout === "row" ? { scrollbarWidth: "thin" } : undefined}
      >
        {people.map((p) => (
          <PersonCard
            key={p.id}
            person={p}
            following={!!following[p.id]}
            busy={busy === p.id}
            compact={layout === "row"}
            onToggle={async (id, cur) => {
              const r = await toggle(id, cur);
              if (r !== null) onFollowChange?.(id, r);
            }}
          />
        ))}
      </div>
    </section>
  );
}
