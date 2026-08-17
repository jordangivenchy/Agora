"use client";

/* People + community-post results inside the MVP discovery overlay
   (portal into #discoverySocial, above the engine-owned room-card grid —
   rooms stay covered by those cards). The engine broadcasts the query via
   the 'agora:discovery-search' event from _dsFilterResults in mvp-home.js,
   which fires on open, on typing, and on filter-pill clicks. */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { displayName } from "@/lib/names";
import { userPath } from "@/lib/urls";
import UserAvatar from "./UserAvatar";

type PersonRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

type PostRow = {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  community: { name: string } | null;
  author: { username: string; display_name: string | null } | null;
};

const sectionLabel: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.45)",
  margin: "0 0 8px",
};

const rowStyle: React.CSSProperties = {
  background: "rgba(11,11,13,0.95)",
  border: "0.5px solid #2e2e38",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
};

export default function DiscoverySearch({ container }: { container: HTMLElement | null }) {
  const [supabase] = useState(() => createClient());
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onSearch = (e: Event) =>
      setQuery(String((e as CustomEvent).detail?.query ?? "").trim());
    document.addEventListener("agora:discovery-search", onSearch);
    return () => document.removeEventListener("agora:discovery-search", onSearch);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.length < 2) {
      setPeople([]);
      setPosts([]);
      return;
    }
    const mySeq = ++seq.current;
    timer.current = setTimeout(async () => {
      /* PostgREST .or() parses commas/parens; ilike wildcards would let a
         user match everything — strip them all from the term. */
      const cleaned = query.replace(/[%_,()]/g, "");
      if (!cleaned) return;
      const term = `%${cleaned}%`;
      const [peopleRes, postsRes] = await Promise.all([
        supabase
          .from("users")
          .select("id, username, display_name, avatar_url")
          .or(`username.ilike.${term},display_name.ilike.${term}`)
          .limit(8),
        supabase
          .from("community_posts")
          .select("id, title, body, created_at, community:communities(name), author:users!author_id(username, display_name)")
          .or(`title.ilike.${term},body.ilike.${term}`)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      if (seq.current !== mySeq) return; // a newer query superseded this one
      setPeople((peopleRes.data ?? []) as PersonRow[]);
      setPosts((postsRes.data ?? []) as unknown as PostRow[]);
    }, 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, supabase]);

  if (!container) return null;
  if (query.length < 2 || (people.length === 0 && posts.length === 0)) {
    return createPortal(null, container);
  }

  const openPost = (p: PostRow) => {
    document.getElementById("closeDiscovery")?.click();
    (document.querySelector('[data-nav-id="communities"]') as HTMLElement | null)?.click();
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("agora:open-post", { detail: { postId: p.id } }));
    }, 150);
  };

  return createPortal(
    <div style={{ margin: "4px 0 18px", display: "flex", flexDirection: "column", gap: 16 }}>
      {people.length > 0 && (
        <div>
          <p style={sectionLabel}>PEOPLE</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {people.map((u) => (
              <div
                key={u.id}
                role="link"
                tabIndex={0}
                onClick={() => { window.location.href = userPath(u.username); }}
                onKeyDown={(e) => { if (e.key === "Enter") window.location.href = userPath(u.username); }}
                className="flex items-center gap-2.5"
                style={rowStyle}
              >
                <UserAvatar size={28} username={u.username} avatarUrl={u.avatar_url} seed={u.id} />
                <div>
                  <p className="m-0 text-[12.5px]" style={{ color: "#f5f5f0", fontWeight: 600 }}>
                    {displayName(u)}
                  </p>
                  <p className="m-0 text-[10.5px]" style={{ color: "#8b8b94" }}>@{u.username}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {posts.length > 0 && (
        <div>
          <p style={sectionLabel}>COMMUNITY POSTS</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {posts.map((p) => (
              <div
                key={p.id}
                role="link"
                tabIndex={0}
                onClick={() => openPost(p)}
                onKeyDown={(e) => { if (e.key === "Enter") openPost(p); }}
                style={rowStyle}
              >
                <p className="m-0 text-[13px]" style={{ color: "#f5f5f0", fontWeight: 600 }}>
                  {p.title}
                </p>
                {p.body && (
                  <p
                    className="m-0 mt-0.5 text-[11.5px]"
                    style={{
                      color: "#8b8b94",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {p.body}
                  </p>
                )}
                <p className="m-0 mt-1 text-[10.5px]" style={{ color: "#6b6b74" }}>
                  {p.community?.name ? `${p.community.name} · ` : ""}
                  {p.author ? `by ${displayName(p.author)}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    container
  );
}
