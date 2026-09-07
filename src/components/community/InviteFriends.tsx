"use client";

/* Invite friends to a board. Friends only (mutual follows — the same
   rule DMs run on): each row is a friend who isn't a member yet, and
   Invite sends them a DM that renders as a join card. Used right after
   creating a board and from the board's header. */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";

interface Candidate {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  invited: boolean;
}

const ERRORS: Record<string, string> = {
  not_friends: "You can only invite friends — people who follow you back.",
  mods_only: "Only moderators can invite people to a private community.",
  invite_rate_limit: "That's a lot of invites — try again in an hour.",
  already_member: "They're already in the community.",
  not_a_member: "Join the community before inviting people to it.",
};

export default function InviteFriends({ communityId, communityName, isPrivate }: { communityId: string; communityName: string; isPrivate: boolean }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.rpc("get_community_invite_candidates", { p_community: communityId }).then(({ data }) => {
      if (alive) setRows((data as Candidate[] | null) ?? []);
    });
    return () => { alive = false; };
  }, [supabase, communityId]);

  const invite = useCallback(async (c: Candidate) => {
    if (busy) return;
    setBusy(c.id);
    setError(null);
    const { error: err } = await supabase.rpc("send_community_invite", { p_community: communityId, p_to: c.id });
    setBusy(null);
    if (err) {
      const key = Object.keys(ERRORS).find((k) => err.message.includes(k));
      setError(key ? ERRORS[key] : "Couldn't send the invite.");
      return;
    }
    setRows((r) => (r ?? []).map((x) => (x.id === c.id ? { ...x, invited: true } : x)));
  }, [busy, supabase, communityId]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/communities`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — nothing to do */ }
  }, []);

  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.1)" };
  const pill = (on: boolean): React.CSSProperties => ({
    fontFamily: "inherit", cursor: on ? "default" : "pointer", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700,
    background: on ? "#0b0b0d" : "#ffb700", border: on ? "1px solid rgba(255,255,255,0.14)" : "1px solid #ffb700",
    color: on ? "#c9c9d2" : "#1a0e00", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "rgba(238,238,245,0.55)" }}>
        {isPrivate
          ? `Invites let friends into ${communityName} without applying. `
          : `Friends you invite get a message with a one-tap join for ${communityName}. `}
        Friends are people who follow you back.
      </p>
      {error && (
        <p style={{ margin: 0, fontSize: 12, padding: "8px 10px", borderRadius: 10, background: "#1a0b0b", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5" }}>{error}</p>
      )}
      {rows === null ? (
        <p style={{ margin: 0, fontSize: 12, color: "rgba(238,238,245,0.4)" }}>Finding friends…</p>
      ) : rows.length === 0 ? (
        <div style={{ ...row, justifyContent: "center", padding: "18px 12px", flexDirection: "column", gap: 6, textAlign: "center" }}>
          <Icon name="users" size={18} style={{ color: "rgba(238,238,245,0.4)" }} />
          <span style={{ fontSize: 12.5, color: "rgba(238,238,245,0.6)" }}>No one to invite yet.</span>
          <span style={{ fontSize: 11.5, color: "rgba(238,238,245,0.4)" }}>Your friends who aren&rsquo;t members will show up here.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
          {rows.map((c) => (
            <div key={c.id} style={row}>
              <UserAvatar size={30} username={c.username} avatarUrl={c.avatar_url} seed={c.id} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#eeeef5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.display_name?.trim() || c.username}
                </span>
                <span style={{ display: "block", fontSize: 11, color: "rgba(238,238,245,0.45)" }}>@{c.username}</span>
              </span>
              <button type="button" onClick={() => !c.invited && invite(c)} disabled={busy === c.id} style={pill(c.invited)} aria-pressed={c.invited}>
                {c.invited ? <><Icon name="check" size={12} /> Invited</> : busy === c.id ? "Sending…" : "Invite"}
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={copyLink} className="cursor-pointer" style={{ alignSelf: "flex-start", background: "transparent", border: "none", padding: "2px 0", fontSize: 12, color: "rgba(238,238,245,0.55)", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
        <Icon name={copied ? "check" : "link"} size={12} /> {copied ? "Link copied" : "Copy a link to Communities"}
      </button>
    </div>
  );
}
