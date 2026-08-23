"use client";

/* /people — discovery. Suggested accounts (get_people_suggestions),
   hosts who've been live in the last two weeks (get_active_hosts), and
   the caller's own follow list (get_following) with Unfollow. A search
   box filters by username through search_mention_users. Overlay panel
   like TrendingPage; signed-out visitors still see active hosts. */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import UserAvatar from "@/components/UserAvatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import PeopleSuggestions, { FollowButton, useFollowToggle } from "./PeopleSuggestions";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Person = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  verified?: boolean;
};

type Host = Person & { rooms_14d: number; live_now: boolean; is_following: boolean };

const card: React.CSSProperties = {
  background: "rgba(14,14,17,0.72)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
};

function SectionTitle({ icon, children }: { icon: React.ComponentProps<typeof Icon>["name"]; children: React.ReactNode }) {
  return (
    <p className="m-0 mb-2 text-[12px] font-semibold inline-flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.7)" }}>
      <Icon name={icon} size={13} /> {children}
    </p>
  );
}

function PersonRow({
  person, trailing, sub,
}: { person: Person; trailing?: React.ReactNode; sub?: React.ReactNode }) {
  const name = person.display_name?.trim() || `@${person.username}`;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}>
      <a href={`/@${encodeURIComponent(person.username)}`} className="no-underline flex items-center gap-3 flex-1 min-w-0" style={{ color: "inherit" }}>
        <UserAvatar size={36} username={person.username} avatarUrl={person.avatar_url} seed={person.id} />
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold inline-flex items-center gap-1 max-w-full" style={{ color: "#eeeef5" }}>
            <span className="truncate">{name}</span>
            {person.verified && <VerifiedBadge size={12} />}
          </p>
          <p className="m-0 text-[11px] truncate" style={{ color: "rgba(238,238,245,0.45)" }}>
            {person.display_name?.trim() ? `@${person.username}` : null}
            {person.display_name?.trim() && sub ? " · " : null}
            {sub}
          </p>
        </div>
      </a>
      {trailing}
    </div>
  );
}

export default function PeoplePage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [follows, setFollows] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  const { following, busy, toggle, setFollowing } = useFollowToggle();

  useEscapeClose(open, onClose);

  const loadFollows = useCallback(async (uid: string) => {
    const { data } = await supabase.rpc("get_following", { p_user: uid, p_limit: 200, p_offset: 0 });
    const rows = (data ?? []) as Person[];
    setFollows(rows);
    setFollowing((m) => {
      const next = { ...m };
      for (const r of rows) next[r.id] = true;
      return next;
    });
  }, [supabase, setFollowing]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [{ data: auth }, { data: hostRows }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("get_active_hosts", { p_limit: 12 }),
      ]);
      if (cancelled) return;
      const uid = auth?.user?.id ?? null;
      setUserId(uid);
      const hs = (hostRows ?? []) as Host[];
      setHosts(hs);
      setFollowing((m) => {
        const next = { ...m };
        for (const h of hs) if (h.is_following) next[h.id] = true;
        return next;
      });
      if (uid) loadFollows(uid);
    })();
    return () => { cancelled = true; };
  }, [open, supabase, loadFollows, setFollowing]);

  /* Username search (prefix match, debounced). */
  useEffect(() => {
    const q = query.trim().replace(/^@/, "").toLowerCase();
    if (!q) { setResults(null); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_mention_users", { p_query: q, p_limit: 10 });
      if (cancelled) return;
      setSearching(false);
      const rows = ((data ?? []) as Person[]).filter((p) => p.id !== userId);
      /* Also match display names from what's already loaded. */
      const local = [...(hosts ?? []), ...(follows ?? [])].filter((p) =>
        p.id !== userId && (p.display_name ?? "").toLowerCase().includes(q) && !rows.some((r) => r.id === p.id));
      setResults([...rows, ...local]);
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, supabase, userId, hosts, follows]);

  const onToggle = async (id: string, cur: boolean) => {
    const r = await toggle(id, cur);
    if (r === false) setFollows((f) => f?.filter((p) => p.id !== id) ?? f);
    else if (r === true && userId) loadFollows(userId);
  };

  if (!open) return null;

  return (
    <div
      className="fixed overflow-y-auto"
      style={{
        top: "var(--nav-height)",
        left: "calc(var(--sidebar-width) + 12px)",
        right: 0, bottom: 0, zIndex: 50,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div className="max-w-[960px] mx-auto px-6 py-5">
        <div className="flex items-center gap-4 mb-5 flex-wrap">
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
            People
          </span>
          <div className="flex items-center gap-2 ml-auto" style={{ ...card, borderRadius: 99, padding: "6px 12px", minWidth: 260 }}>
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or @username"
              className="bg-transparent border-none outline-none text-[12.5px] flex-1"
              style={{ color: "#eeeef5", fontFamily: "inherit" }}
            />
          </div>
        </div>

        {results !== null && (
          <section className="mb-6">
            <SectionTitle icon="search">Results</SectionTitle>
            <div style={card}>
              {searching && results.length === 0 && (
                <p className="m-0 px-4 py-3 text-[12px]" style={{ color: "rgba(238,238,245,0.4)" }}>Searching…</p>
              )}
              {!searching && results.length === 0 && (
                <p className="m-0 px-4 py-3 text-[12px]" style={{ color: "rgba(238,238,245,0.4)" }}>No one matches “{query.trim()}”.</p>
              )}
              {results.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  trailing={<FollowButton userId={p.id} following={!!following[p.id]} busy={busy === p.id} onToggle={onToggle} small />}
                />
              ))}
            </div>
          </section>
        )}

        {userId === null && (
          <div className="p-6 text-center mb-6" style={card}>
            <p className="m-0 mb-1 text-[14px] font-semibold" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif" }}>
              Sign in to get suggestions
            </p>
            <p className="m-0 mb-3 text-[12px]" style={{ color: "rgba(238,238,245,0.5)" }}>
              We&apos;ll suggest people based on who you follow and the communities you join.
            </p>
            <a href="/login" className="no-underline text-[12px] px-4 py-2 rounded-lg inline-block" style={{ background: "#4a9eff", color: "#fff", fontWeight: 600 }}>
              Sign in
            </a>
          </div>
        )}

        {userId && (
          <section className="mb-6">
            <PeopleSuggestions
              limit={24}
              layout="grid"
              title="Suggested for you"
              onFollowChange={(id, f) => { if (f) loadFollows(userId); else setFollows((x) => x?.filter((p) => p.id !== id) ?? x); }}
            />
          </section>
        )}

        <section className="mb-6">
          <SectionTitle icon="flame">Active hosts</SectionTitle>
          <div style={card}>
            {hosts === null && <p className="m-0 px-4 py-3 text-[12px]" style={{ color: "rgba(238,238,245,0.4)" }}>Loading…</p>}
            {hosts !== null && hosts.length === 0 && (
              <p className="m-0 px-4 py-3 text-[12px]" style={{ color: "rgba(238,238,245,0.4)" }}>No one has hosted a debate in the last two weeks.</p>
            )}
            {(hosts ?? []).filter((h) => h.id !== userId).map((h) => (
              <PersonRow
                key={h.id}
                person={h}
                sub={<>
                  {h.live_now && <span style={{ color: "#ef4444", fontWeight: 600 }}>● Live now · </span>}
                  {h.rooms_14d} debate{h.rooms_14d === 1 ? "" : "s"} in 14 days
                </>}
                trailing={<FollowButton userId={h.id} following={!!following[h.id]} busy={busy === h.id} onToggle={onToggle} small />}
              />
            ))}
          </div>
        </section>

        {userId && (
          <section className="mb-6">
            <SectionTitle icon="users">Your follows</SectionTitle>
            <div style={card}>
              {follows === null && <p className="m-0 px-4 py-3 text-[12px]" style={{ color: "rgba(238,238,245,0.4)" }}>Loading…</p>}
              {follows !== null && follows.length === 0 && (
                <p className="m-0 px-4 py-3 text-[12px]" style={{ color: "rgba(238,238,245,0.4)" }}>You aren&apos;t following anyone yet.</p>
              )}
              {(follows ?? []).map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  trailing={<FollowButton userId={p.id} following={following[p.id] ?? true} busy={busy === p.id} onToggle={onToggle} small />}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
