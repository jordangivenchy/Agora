"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

interface Props {
  open: boolean;
  userId: string;
  mode: "followers" | "following";
  onClose: () => void;
  /** Open another user's profile modal. */
  onOpenProfile: (userId: string) => void;
}

interface Row {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  is_following_me?: boolean;
  i_am_following?: boolean;
}

const AVATAR_COLORS = [
  "#1976D2", "#00b894", "#4a9eff", "#fd9644",
  "#64B5F6", "#e17055", "#00cec9", "#fdcb6e",
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export default function FollowListModal({
  open, userId, mode, onClose, onOpenProfile,
}: Props) {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const fn = mode === "followers" ? "get_followers" : "get_following";
    const { data, error: rpcErr } = await supabase.rpc(fn, { p_user: userId });
    if (rpcErr) {
      setError(rpcErr.message || "Could not load list");
      setRows([]);
    } else {
      setRows((data as Row[]) || []);
    }
    setLoading(false);
  }, [mode, userId, supabase]);

  useEffect(() => {
    if (open) load();
    else {
      setRows([]);
      setQuery("");
      setError(null);
    }
  }, [open, load]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => r.username.toLowerCase().includes(q))
    : rows;

  const title = mode === "followers" ? "Followers" : "Following";

  return (
    <div
      className="fixed inset-0 z-[970] flex items-center justify-center p-5"
      style={{
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(4px)",
        animation: "modalIn 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        className="w-full flex flex-col"
        style={{
          maxWidth: 440,
          maxHeight: "80vh",
          background: "rgba(10,10,18,0.97)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: "20px 20px 16px",
          animation: "modalPanelIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h2
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 16,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {title} <span style={{ color: "rgba(255,255,255,0.4)" }}>({rows.length})</span>
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none cursor-pointer"
            style={{ color: "var(--text-muted)", background: "none", border: "none" }}
          >
            &times;
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="outline-none mb-3"
          style={{
            padding: "8px 12px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            color: "var(--text-primary)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
          }}
        />

        {error && (
          <div
            className="text-sm rounded-lg px-3 py-2 mb-3"
            style={{
              background: "rgba(232,64,64,0.1)",
              border: "1px solid rgba(232,64,64,0.3)",
              color: "#ff6b6b",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div
          className="flex flex-col gap-1 overflow-y-auto"
          style={{ flex: 1, minHeight: 0 }}
        >
          {loading && (
            <div
              className="py-6 text-center"
              style={{ color: "var(--text-muted)", fontSize: 13 }}
            >
              Loading…
            </div>
          )}

          {!loading && filtered.length === 0 && !error && (
            <div
              className="py-8 text-center"
              style={{ color: "var(--text-dim)", fontSize: 13 }}
            >
              {rows.length === 0
                ? mode === "followers"
                  ? "No followers yet."
                  : "Not following anyone yet."
                : "No matches."}
            </div>
          )}

          {!loading && filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                onClose();
                onOpenProfile(r.id);
              }}
              className="flex items-center gap-3 w-full text-left cursor-pointer"
              style={{
                padding: "10px 10px",
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
              }}
            >
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.avatar_url}
                  alt={r.username}
                  className="rounded-full shrink-0"
                  style={{
                    width: 36,
                    height: 36,
                    border: "1px solid rgba(255,255,255,0.1)",
                    objectFit: "cover",
                  }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="rounded-full flex items-center justify-center shrink-0 text-white"
                  style={{
                    width: 36,
                    height: 36,
                    background: avatarColor(r.username),
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {initials(r.username)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div
                  className="truncate"
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  @{r.username}
                </div>
                {r.bio && (
                  <div
                    className="truncate"
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 11.5,
                      color: "rgba(255,255,255,0.45)",
                      marginTop: 2,
                    }}
                  >
                    {r.bio}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
