"use client";

/* The homepage's discussion block (square thumbnail card with the
   status badge, topic, motion, host/community, and format line) — shared
   so Explore and the home feed render the same thing. */

import { TOPICS } from "@/types/database";
import { roomPath } from "@/lib/urls";
import { displayName } from "@/lib/names";
import UserAvatar from "./UserAvatar";
import { useUserMenu } from "./userMenuContext";

export interface RoomCardRoom {
  id: string;
  motion: string;
  topic_key: string;
  status: string;
  format: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  thumbnail_url?: string | null;
  recording_url?: string | null;
  host: { id: string; username: string; display_name?: string | null; avatar_url: string | null } | null;
  community: { id: string; name: string; color: string | null } | null;
}

const FORMAT_LABEL: Record<string, string> = { open: "Open", oxford: "Oxford", "1v1": "1v1", panel: "Panel" };

const card: React.CSSProperties = {
  background: "rgba(11,11,13,0.95)",
  border: "0.5px solid #2e2e38",
};

const badge = (bg: string): React.CSSProperties => ({
  position: "absolute", top: 8, left: 8,
  background: bg, color: "white",
  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
  padding: "2px 7px", borderRadius: 6,
});

function scheduledLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function RoomCard({ room: r, size = 168 }: { room: RoomCardRoom; size?: number }) {
  const { openUserMenu } = useUserMenu();
  const topicLabel = TOPICS.find((t) => t.key === r.topic_key)?.label ?? r.topic_key;
  const scheduled = r.status !== "live" && !!r.scheduled_start;

  const openCommunity = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    (document.querySelector('[data-nav-id="communities"]') as HTMLElement | null)?.click();
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("agora:open-community", { detail: { communityId: id } }));
    }, 60);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => { window.location.href = roomPath(r); }}
      onKeyDown={(e) => { if (e.key === "Enter") window.location.href = roomPath(r); }}
      className="cursor-pointer shrink-0"
      style={{ ...card, width: size, height: size, borderRadius: 16, overflow: "hidden", position: "relative" }}
    >
      {/* Host-picked thumbnail; their profile picture is the default */}
      <div style={{ position: "absolute", inset: 0 }}>
        {r.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <UserAvatar size={size} radius={0} username={r.host?.username} avatarUrl={r.host?.avatar_url} seed={r.host?.id} />
        )}
        {r.status === "live" ? (
          <span style={badge("#ef4444")}>LIVE</span>
        ) : r.status === "ended" ? (
          r.recording_url ? null : <span style={badge("rgba(60,60,70,0.92)")}>ENDED</span>
        ) : scheduled ? (
          <span style={badge("rgba(139,92,246,0.85)")}>SCHEDULED</span>
        ) : (
          <span style={badge("rgba(59,130,246,0.85)")}>OPEN</span>
        )}
        <span
          style={{
            position: "absolute", top: 9, right: 10,
            color: "rgba(255,255,255,0.65)", fontSize: 10, fontWeight: 500,
            textShadow: "0 1px 4px rgba(0,0,0,0.9)",
          }}
        >
          {topicLabel}
        </span>
      </div>

      {/* Info overlaid on the photo — keeps the block a true square */}
      <div
        className="px-2.5 pb-2 pt-6"
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.88))",
        }}
      >
        <p
          className="m-0 text-[12px]"
          style={{
            color: "white", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, lineHeight: 1.25,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          {r.motion}
        </p>
        {(r.community || r.host?.username) && (
          <p className="m-0 mt-0.5 text-[10.5px] flex items-center gap-1" style={{ color: "rgba(255,255,255,0.8)" }}>
            <span>by</span>
            {r.community ? (
              <span
                onClick={(e) => openCommunity(e, r.community!.id)}
                className="inline-flex items-center gap-1"
                style={{ cursor: "pointer", verticalAlign: "middle", lineHeight: 1 }}
                title={`Go to ${r.community.name}`}
              >
                <span
                  className="inline-flex items-center justify-center shrink-0"
                  style={{ width: 13, height: 13, borderRadius: 4, background: r.community.color ?? "#4a9eff", color: "#fff", fontSize: 8, fontWeight: 700 }}
                >
                  {r.community.name.charAt(0).toUpperCase()}
                </span>
                {r.community.name}
              </span>
            ) : r.host ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  openUserMenu({ x: e.clientX, y: e.clientY }, { userId: r.host!.id, username: r.host!.username });
                }}
                className="inline-flex items-center gap-1"
                style={{ cursor: "pointer", verticalAlign: "middle", lineHeight: 1, textDecoration: "underline dotted rgba(255,255,255,0.25)", textUnderlineOffset: 2 }}
              >
                <UserAvatar size={13} username={r.host.username} avatarUrl={r.host.avatar_url} seed={r.host.id} />
                {displayName(r.host)}
              </span>
            ) : null}
          </p>
        )}
        <p className="m-0 mt-0.5 text-[9.5px]" style={{ color: "rgba(255,255,255,0.55)" }}>
          {FORMAT_LABEL[r.format] ?? r.format}
          {r.status === "live"
            ? ` · ${r.viewer_count ?? 0} watching`
            : scheduled
              ? ` · ${scheduledLabel(r.scheduled_start)}`
              : " · waiting for speakers"}
        </p>
      </div>
    </div>
  );
}
