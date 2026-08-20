"use client";

/* Moderation sub-panels for the community mod view: the ban list (with
   one-click unban via the unban_community_member RPC) and the mod action
   log. Both follow the house v5 panel style from CommunitiesPage — charcoal
   glass boxes, dim uppercase labels, compact rows. RLS keeps these tables
   mods-only; non-mods simply get zero rows, which renders as the empty
   state rather than an error. */

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import UserAvatar from "../UserAvatar";

/* ---------- shared bits ---------- */

const panel: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 12,
  padding: "12px 14px",
};

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mb-2 text-[10.5px] font-bold" style={{ color: "rgba(238,238,245,0.5)", letterSpacing: "0.06em" }}>
      {children}
    </p>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - +new Date(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type MiniUser = {
  username: string | null;
  display_name: string | null;
  avatar_url?: string | null;
} | null;

function nameOf(u: MiniUser): string {
  if (!u) return "someone";
  return u.display_name?.trim() || `@${u.username ?? "unknown"}`;
}

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "0.5px solid rgba(255,255,255,0.14)",
  color: "rgba(238,238,245,0.65)",
  borderRadius: 6,
  fontSize: 10.5,
  fontFamily: "inherit",
};

const dimText: React.CSSProperties = { color: "rgba(238,238,245,0.32)" };

/* ---------- BansPanel ---------- */

type BanRow = {
  user_id: string;
  banned_by: string | null;
  reason: string | null;
  created_at: string;
  user: MiniUser;
};

export function BansPanel({
  supabase,
  communityId,
  refreshKey,
}: {
  supabase: SupabaseClient;
  communityId: string;
  refreshKey?: number;
}) {
  const [bans, setBans] = useState<BanRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from("community_bans")
        .select("user_id, banned_by, reason, created_at, user:users!user_id(username, display_name, avatar_url)")
        .eq("community_id", communityId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (err) {
        /* RLS denials come back as empty data, not errors — anything here
           is a real failure worth surfacing quietly. */
        setError("Couldn't load bans.");
        setBans([]);
        return;
      }
      setError(null);
      setBans((data ?? []) as unknown as BanRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, communityId, refreshKey]);

  const unban = async (userId: string) => {
    setError(null);
    const { error: err } = await supabase.rpc("unban_community_member", {
      p_community: communityId,
      p_user: userId,
    });
    if (err) {
      setError("Unban failed.");
      return;
    }
    setBans((prev) => prev.filter((b) => b.user_id !== userId));
  };

  return (
    <div style={panel}>
      <PanelLabel>{bans.length ? `BANNED · ${bans.length}` : "BANNED"}</PanelLabel>
      {error && (
        <p className="m-0 mb-1 text-[11px]" style={{ color: "#e88" }}>{error}</p>
      )}
      {bans.length === 0 ? (
        !error && <p className="m-0 text-[11px]" style={dimText}>No bans.</p>
      ) : (
        bans.map((b) => (
          <div key={b.user_id} className="flex items-center gap-2.5 py-1.5" title={b.reason?.trim() || undefined}>
            <UserAvatar size={24} username={b.user?.username ?? "?"} avatarUrl={b.user?.avatar_url ?? null} seed={b.user_id} />
            <span className="flex-1 min-w-0 truncate text-[12px]" style={{ color: "rgba(238,238,245,0.88)" }}>
              {nameOf(b.user)}
            </span>
            <span className="text-[10px] shrink-0" style={dimText}>{timeAgo(b.created_at)}</span>
            <button
              onClick={() => unban(b.user_id)}
              className="cursor-pointer px-2.5 py-1"
              style={ghostBtn}
            >
              Unban
            </button>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- ModLogPanel ---------- */

type ModLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_user: string | null;
  target_post: string | null;
  detail: string | null;
  created_at: string;
  actor: MiniUser;
  target: MiniUser;
};

const amber = "#e2b96b";

/* One human-readable phrase per action; role_change embeds its target. */
function actionPhrase(row: ModLogRow): React.ReactNode {
  const target = row.target_user ? (
    <span style={{ color: amber }}>{nameOf(row.target)}</span>
  ) : null;
  switch (row.action) {
    case "ban":
      return <>banned {target}</>;
    case "unban":
      return <>unbanned {target}</>;
    case "role_change":
      return row.detail ? (
        <>made {target} a {row.detail}</>
      ) : (
        <>changed the role of {target}</>
      );
    case "approve_join":
      return <>approved join request {target}</>;
    case "deny_join":
      return <>denied join request {target}</>;
    case "settings_update":
      return <>updated settings</>;
    case "pin_comment":
      return <>pinned a comment</>;
    case "unpin_comment":
      return <>unpinned a comment</>;
    case "pin_post":
      return <>pinned a post</>;
    case "unpin_post":
      return <>unpinned a post</>;
    default:
      return <>{row.action.replace(/_/g, " ")} {target}</>;
  }
}

export function ModLogPanel({
  supabase,
  communityId,
  refreshKey,
}: {
  supabase: SupabaseClient;
  communityId: string;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<ModLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from("community_mod_log")
        .select(
          "id, actor_id, action, target_user, target_post, detail, created_at, " +
            "actor:users!actor_id(username, display_name), target:users!target_user(username, display_name)"
        )
        .eq("community_id", communityId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      if (err) {
        setError("Couldn't load the log.");
        setRows([]);
        return;
      }
      setError(null);
      setRows((data ?? []) as unknown as ModLogRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, communityId, refreshKey]);

  return (
    <div style={panel}>
      <PanelLabel>MOD LOG</PanelLabel>
      {error && (
        <p className="m-0 mb-1 text-[11px]" style={{ color: "#e88" }}>{error}</p>
      )}
      {rows.length === 0 ? (
        !error && <p className="m-0 text-[11px]" style={dimText}>Nothing logged yet.</p>
      ) : (
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          {rows.map((r) => (
            <div key={r.id} className="flex items-baseline gap-2 py-0.5" style={{ fontSize: 11 }}>
              <span className="shrink-0" style={{ ...dimText, minWidth: 30 }}>{timeAgo(r.created_at)}</span>
              <span className="min-w-0" style={{ color: "rgba(238,238,245,0.65)" }}>
                <span style={{ color: "#eeeef5" }}>{nameOf(r.actor)}</span>{" "}
                {actionPhrase(r)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
