"use client";

/* Communities tab — clubs, teams, and institutions. Real communities come
   from the `communities` table (created by the Agora Stoa migration);
   seeded examples fill the grid until real ones exist. Join/create are
   fully functional once the migration has run. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { SEED_COMMUNITIES } from "@/lib/seed-content";

interface Props {
  open: boolean;
  onClose: () => void;
}

type DbCommunity = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  color: string;
  members: number;
  joined: boolean;
};

const KIND_FILTERS = [
  { key: "all", label: "All" },
  { key: "university", label: "🏫 Universities" },
  { key: "hs-team", label: "🎓 HS debate teams" },
  { key: "mun", label: "🌐 MUN" },
  { key: "topic-circle", label: "📚 Topic circles" },
  { key: "pre-law", label: "⚖️ Pre-law / moot court" },
];

const KIND_LABELS: Record<string, string> = {
  university: "University",
  "hs-team": "HS team",
  mun: "Model UN",
  "topic-circle": "Topic circle",
  "pre-law": "Pre-law",
};

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

export default function CommunitiesPage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dbCommunities, setDbCommunities] = useState<DbCommunity[]>([]);
  const [migrated, setMigrated] = useState(true);
  const [joinedSeeds, setJoinedSeeds] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("topic-circle");
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    setUserId(auth?.user?.id ?? null);
    const { data, error } = await supabase
      .from("communities")
      .select("id, name, kind, description, color, community_members(user_id)");
    if (error) {
      // Table doesn't exist yet — migration hasn't run.
      setMigrated(false);
      return;
    }
    setMigrated(true);
    setDbCommunities(
      (data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        description: c.description,
        color: c.color ?? "#4a9eff",
        members: (c.community_members ?? []).length,
        joined: (c.community_members ?? []).some(
          (m: { user_id: string }) => m.user_id === auth?.user?.id
        ),
      }))
    );
  }, [supabase]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const joinDb = useCallback(
    async (c: DbCommunity) => {
      if (!userId) { window.location.href = "/login"; return; }
      if (c.joined) {
        await supabase.from("community_members").delete()
          .eq("community_id", c.id).eq("user_id", userId);
      } else {
        await supabase.from("community_members").insert({ community_id: c.id, user_id: userId });
      }
      load();
    },
    [supabase, userId, load]
  );

  /* Joining a suggested community makes it real: it's created in the
     database on first join (when the migration has run), so suggestions
     graduate into actual communities instead of staying cosmetic. */
  const joinSeed = useCallback(
    async (seed: { id: string; name: string; kind: string }) => {
      if (joinedSeeds[seed.id]) {
        setJoinedSeeds((m) => ({ ...m, [seed.id]: false }));
        return;
      }
      setJoinedSeeds((m) => ({ ...m, [seed.id]: true }));
      if (!migrated || !userId) return;
      const { data: existing } = await supabase
        .from("communities").select("id").eq("name", seed.name).maybeSingle();
      let communityId = existing?.id;
      if (!communityId) {
        const { data: created } = await supabase
          .from("communities")
          .insert({ name: seed.name, kind: seed.kind, created_by: userId })
          .select("id")
          .single();
        communityId = created?.id;
      }
      if (communityId) {
        await supabase.from("community_members").insert({ community_id: communityId, user_id: userId });
        load();
      }
    },
    [supabase, userId, migrated, joinedSeeds, load]
  );

  const createCommunity = useCallback(async () => {
    const name = newName.trim();
    if (!name || !userId) return;
    const { data, error } = await supabase
      .from("communities")
      .insert({ name, kind: newKind, created_by: userId })
      .select("id")
      .single();
    if (!error && data) {
      await supabase.from("community_members").insert({ community_id: data.id, user_id: userId, role: "owner" });
      setCreating(false);
      setNewName("");
      load();
    }
  }, [supabase, userId, newName, newKind, load]);

  const seeds = useMemo(
    () =>
      SEED_COMMUNITIES.filter(
        (c) =>
          (filter === "all" || c.kind === filter) &&
          (!search || c.name.toLowerCase().includes(search.toLowerCase()))
      ),
    [filter, search]
  );

  const realOnes = useMemo(
    () =>
      dbCommunities.filter(
        (c) =>
          (filter === "all" || c.kind === filter) &&
          (!search || c.name.toLowerCase().includes(search.toLowerCase()))
      ),
    [dbCommunities, filter, search]
  );

  if (!open) return null;

  return (
    <div
      className="fixed overflow-y-auto"
      style={{
        top: "var(--nav-height)",
        left: "calc(var(--sidebar-width) + 12px)",
        right: 0,
        bottom: 0,
        zIndex: 50,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-5">
        <div className="flex items-center gap-3.5 mb-4 flex-wrap">
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>Communities</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="⌕ Find a club, school, or team…"
            className="text-[12px] px-4 py-1.5 rounded-full outline-none flex-1"
            style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec", minWidth: 200, maxWidth: 420 }}
          />
          <button
            onClick={() => setCreating((v) => !v)}
            className="cursor-pointer text-[12px] font-medium px-4 py-1.5 rounded-full border-none"
            style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402" }}
          >
            + Create community
          </button>
        </div>

        {creating && (
          <div className="p-4 mb-4 flex gap-3 items-center flex-wrap" style={card}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Community name"
              className="text-[13px] px-4 py-2 rounded-lg outline-none flex-1 min-w-[200px]"
              style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
            />
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
              className="text-[13px] px-3 py-2 rounded-lg"
              style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
            >
              {KIND_FILTERS.filter((k) => k.key !== "all").map((k) => (
                <option key={k.key} value={k.key}>{k.label.replace(/^\S+\s/, "")}</option>
              ))}
            </select>
            <button
              onClick={createCommunity}
              disabled={!migrated}
              className="cursor-pointer text-[12px] px-4 py-2 rounded-lg"
              style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0" }}
            >
              Create
            </button>
            {!migrated && (
              <span className="text-[11px]" style={{ color: "#f4d47c" }}>
                Run the Agora Stoa migration in Supabase to enable creating communities.
              </span>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap mb-5">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.key}
              onClick={() => setFilter(k.key)}
              className="cursor-pointer text-[11px] px-3.5 py-1 rounded-full"
              style={
                filter === k.key
                  ? { background: "rgba(255,255,255,0.1)", border: "0.5px solid #4a4a54", color: "#f5f5f0" }
                  : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }
              }
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {realOnes.map((c) => (
            <div key={c.id} className="p-3.5" style={card}>
              <div className="flex gap-2.5 items-center mb-2.5">
                <span
                  className="flex items-center justify-center"
                  style={{ width: 42, height: 42, borderRadius: 11, background: c.color, color: "#fff", fontSize: 15, fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
                >
                  {c.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="m-0 text-[13px] font-medium" style={{ color: "#f5f5f0" }}>{c.name}</p>
                  <p className="m-0 text-[10px]" style={{ color: "#8b8b94" }}>{KIND_LABELS[c.kind] ?? c.kind}</p>
                </div>
              </div>
              <p className="m-0 mb-2.5 text-[11px]" style={{ color: "#9a9aa2" }}>
                {c.members} member{c.members === 1 ? "" : "s"}
              </p>
              <button
                onClick={() => joinDb(c)}
                className="w-full cursor-pointer text-[11px] py-1.5 rounded-lg text-center"
                style={
                  c.joined
                    ? { background: "rgba(30,30,38,0.8)", border: "0.5px solid #3a5a3a", color: "#97c459" }
                    : { background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0" }
                }
              >
                {c.joined ? "✓ Joined" : "Join"}
              </button>
            </div>
          ))}

          {seeds.map((c) => (
            <div key={c.id} className="p-3.5" style={card}>
              <div className="flex gap-2.5 items-center mb-2.5">
                <span
                  className="flex items-center justify-center"
                  style={{ width: 42, height: 42, borderRadius: 11, background: c.color, color: "#fff", fontSize: 15, fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
                >
                  {c.initial}
                </span>
                <div>
                  <p className="m-0 text-[13px] font-medium" style={{ color: "#f5f5f0" }}>{c.name}</p>
                  <p className="m-0 text-[10px]" style={{ color: "#8b8b94" }}>{c.kindLabel}</p>
                </div>
              </div>
              <p className="m-0 mb-2.5 text-[11px]" style={{ color: "#9a9aa2" }}>
                {c.members.toLocaleString()} members · <span style={{ color: c.activity.color }}>{c.activity.text}</span>
              </p>
              <button
                onClick={() => joinSeed(c)}
                className="w-full cursor-pointer text-[11px] py-1.5 rounded-lg text-center"
                style={
                  joinedSeeds[c.id]
                    ? { background: "rgba(30,30,38,0.8)", border: "0.5px solid #3a5a3a", color: "#97c459" }
                    : { background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0" }
                }
              >
                {joinedSeeds[c.id] ? "✓ Joined" : "Join"}
              </button>
            </div>
          ))}
        </div>

        <div className="p-4" style={card}>
          <p className="m-0 mb-2.5 text-[13px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
            Community events this week
          </p>
          <div className="flex gap-2.5 flex-wrap">
            {[
              ["Thu 7 PM", "Berkeley vs Stanford — Oxford exhibition"],
              ["Sat 1 PM", "MUN Global crisis committee"],
              ["Sun 5 PM", "Philosophy Circle steelman night"],
            ].map(([when, what]) => (
              <span
                key={what}
                className="text-[11px] px-3.5 py-1.5 rounded-lg"
                style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }}
              >
                <span style={{ color: "#f4d47c" }}>{when}</span> · {what}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
