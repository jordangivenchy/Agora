"use client";

/* /mod — the moderation queue.
   Lists user reports via mod_list_reports and resolves them via
   mod_resolve_report. Both RPCs are gated server-side by
   assert_moderator(); the client-side gate here is UX only —
   non-moderators are bounced home before seeing an empty shell.

   Reports load in one call (all statuses, capped at 200) and are
   filtered client-side so the tab counts come for free. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type Report = {
  id: string;
  created_at: string;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  reason: string;
  description: string | null;
  context: string;
  room_id: string | null;
  message_content: string | null;
  reporter_id: string | null;
  reporter_username: string;
  reported_user_id: string | null;
  reported_username: string;
};

const STATUSES = ["open", "reviewed", "actioned", "dismissed"] as const;
type Status = (typeof STATUSES)[number];

const REASON_LABEL: Record<string, string> = {
  harassment: "Harassment",
  hate_speech: "Hate speech",
  threats_violence: "Threats / violence",
  spam: "Spam",
  sexual_content: "Sexual content",
  misinformation: "Misinformation",
  impersonation: "Impersonation",
  inappropriate_username: "Inappropriate username",
  other: "Other",
};

const STATUS_COLOR: Record<Status, string> = {
  open: "#f4d47c",
  reviewed: "#9cc4f0",
  actioned: "#97c459",
  dismissed: "#8b8b94",
};

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - +new Date(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ModPage() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  const [checked, setChecked] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [tab, setTab] = useState<Status>("open");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("mod_list_reports", {
      p_status: null,
      p_limit: 200,
    });
    if (error) {
      // not_moderator lands here too — the redirect below already handled
      // the common case; this covers a mid-session revocation.
      setLoadError(error.message.includes("not_moderator")
        ? "You don't have moderator access."
        : error.message);
      return;
    }
    setLoadError(null);
    setReports((data ?? []) as Report[]);
  }, [supabase]);

  /* Gate: signed-in moderators only. Server enforces regardless. */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data: row } = await supabase
        .from("users").select("is_moderator").eq("id", user.id).maybeSingle();
      if (!row?.is_moderator) { router.replace("/"); return; }
      setChecked(true);
      load();
    })();
  }, [supabase, router, load]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, reviewed: 0, actioned: 0, dismissed: 0 };
    for (const r of reports) c[r.status]++;
    return c;
  }, [reports]);

  const visible = useMemo(
    () => reports.filter((r) => r.status === tab),
    [reports, tab]
  );

  async function resolve(report: Report, status: Status) {
    setBusyId(report.id);
    setActionError(null);
    // Optimistic move; rolled back if the RPC fails.
    const prev = report.status;
    setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, status } : r)));
    const { error } = await supabase.rpc("mod_resolve_report", {
      p_report: report.id,
      p_status: status,
    });
    setBusyId(null);
    if (error) {
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, status: prev } : r)));
      setActionError(`Couldn't update report: ${error.message}`);
    }
  }

  if (!checked) {
    return (
      <div className="flex items-center justify-center" style={{ width: "100vw", height: "100vh", background: "var(--bg-primary, #0a0a0c)" }}>
        <div className="animate-spin" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--accent-blue, #3b82f6)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary, #0a0a0c)", fontFamily: "'DM Sans', sans-serif" }}>
      <div className="mx-auto px-4 py-6" style={{ maxWidth: 860 }}>

        {/* header */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <a href="/" style={{
            background: "transparent", border: "0.5px solid #3a3a42", color: "#c0c0c8",
            borderRadius: 9, padding: "6px 12px", fontSize: 12, textDecoration: "none",
          }}>
            ← Home
          </a>
          <h1 className="m-0 text-[22px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: "#f5f5f0" }}>
            Moderation
          </h1>
          <span className="text-[11px]" style={{ color: "#8b8b94" }}>
            Report queue · every action is audit-logged
          </span>
        </div>

        {(loadError || actionError) && (
          <p className="mb-4 px-4 py-2.5 rounded-lg text-[12px]"
            style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
            {loadError || actionError}
          </p>
        )}

        {/* status tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className="cursor-pointer text-[12px] px-3.5 py-1.5 rounded-full"
              style={{
                background: tab === s ? "rgba(255,255,255,0.1)" : "rgba(20,20,26,0.85)",
                border: "0.5px solid " + (tab === s ? "#4a4a54" : "#34343c"),
                color: tab === s ? "#f5f5f0" : "#c0c0c8",
                fontFamily: "inherit",
              }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              <span className="ml-1.5" style={{ color: STATUS_COLOR[s] }}>{counts[s]}</span>
            </button>
          ))}
          <button
            onClick={load}
            className="cursor-pointer text-[12px] px-3.5 py-1.5 rounded-full ml-auto"
            style={{ background: "transparent", border: "0.5px solid #34343c", color: "#8b8b94", fontFamily: "inherit" }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* queue */}
        {visible.length === 0 ? (
          <div className="p-8 text-center" style={card}>
            <p className="m-0 text-[13px]" style={{ color: "#f5f5f0" }}>
              {tab === "open" ? "No open reports" : `No ${tab} reports`}
            </p>
            <p className="m-0 mt-1 text-[11px]" style={{ color: "#8b8b94" }}>
              {tab === "open" ? "The queue is clear." : "Nothing here yet."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((r) => (
              <div key={r.id} className="p-4" style={card}>
                <div className="flex items-center gap-2.5 flex-wrap mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.06)", border: `0.5px solid ${STATUS_COLOR[r.status]}55`, color: STATUS_COLOR[r.status] }}>
                    {REASON_LABEL[r.reason] ?? r.reason}
                  </span>
                  <span className="text-[11px]" style={{ color: "#8b8b94" }}>
                    in {r.context} · {timeAgo(r.created_at)}
                  </span>
                </div>

                <p className="m-0 text-[13px]" style={{ color: "#f5f5f0" }}>
                  <a href={`/users/${r.reported_username}`} style={{ color: "#9cc4f0", textDecoration: "none" }}>
                    @{r.reported_username}
                  </a>
                  <span style={{ color: "#8b8b94" }}> reported by </span>
                  @{r.reporter_username}
                </p>

                {r.description && (
                  <p className="m-0 mt-1.5 text-[12px] leading-relaxed" style={{ color: "#c0c0c8" }}>
                    &ldquo;{r.description}&rdquo;
                  </p>
                )}

                {r.message_content && (
                  <p className="m-0 mt-1.5 text-[11px] px-3 py-2 rounded-lg"
                    style={{ background: "rgba(10,10,14,0.8)", border: "0.5px solid #2e2e38", color: "#9a9aa2" }}>
                    Reported message: &ldquo;{r.message_content}&rdquo;
                  </p>
                )}

                <div className="flex gap-2 mt-3 flex-wrap">
                  {r.status !== "actioned" && (
                    <button onClick={() => resolve(r, "actioned")} disabled={busyId === r.id}
                      className="cursor-pointer text-[11px] px-3 py-1.5 rounded-lg"
                      style={{ background: "rgba(30,60,30,0.5)", border: "0.5px solid #3a5a3a", color: "#97c459", fontFamily: "inherit" }}>
                      Mark actioned
                    </button>
                  )}
                  {r.status === "open" && (
                    <button onClick={() => resolve(r, "reviewed")} disabled={busyId === r.id}
                      className="cursor-pointer text-[11px] px-3 py-1.5 rounded-lg"
                      style={{ background: "rgba(24,48,82,0.5)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }}>
                      Mark reviewed
                    </button>
                  )}
                  {r.status !== "dismissed" && (
                    <button onClick={() => resolve(r, "dismissed")} disabled={busyId === r.id}
                      className="cursor-pointer text-[11px] px-3 py-1.5 rounded-lg"
                      style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#8b8b94", fontFamily: "inherit" }}>
                      Dismiss
                    </button>
                  )}
                  {r.status !== "open" && (
                    <button onClick={() => resolve(r, "open")} disabled={busyId === r.id}
                      className="cursor-pointer text-[11px] px-3 py-1.5 rounded-lg"
                      style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#8b8b94", fontFamily: "inherit" }}>
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
