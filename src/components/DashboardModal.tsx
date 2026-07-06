"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenDebates: () => void;
}

type NodeKey = "debates" | "agorarating" | "train";

const NODES: {
  key: NodeKey;
  title: string;
  subtitle: string;
  content: string;
  icon: string;
  status: "available" | "coming-soon";
  energy: number;
}[] = [
  { key: "debates",     title: "Debates",     subtitle: "Upcoming & past", content: "Your scheduled debates and full match history.",  icon: "⚔️", status: "available",   energy: 80 },
  { key: "agorarating", title: "AgoraRating", subtitle: "Elo Score",        content: "Your competitive rating and ranking history.",    icon: "📊", status: "coming-soon", energy: 65 },
  { key: "train",       title: "Train",       subtitle: "Practice",         content: "Sharpen your arguments with AI-powered training.", icon: "🏋️", status: "coming-soon", energy: 50 },
];

const RADIUS = 190;

export default function DashboardModal({ open, onClose, onOpenDebates }: Props) {
  const [angle, setAngle] = useState(0);
  const [activeKey, setActiveKey] = useState<NodeKey | null>(null);
  const rafRef = useRef<number | null>(null);
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<{ username: string; avatarUrl: string | null } | null>(null);

  // Load the signed-in user's profile for the sphere center
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      const { data: row } = await supabase
        .from("users")
        .select("username, avatar_url")
        .eq("id", user.id)
        .single();
      setProfile({
        username:
          row?.username ??
          user.user_metadata?.name ??
          user.email?.split("@")[0] ??
          "You",
        avatarUrl: row?.avatar_url ?? user.user_metadata?.avatar_url ?? null,
      });
    })();
  }, [open, supabase]);

  // Orbit animation
  useEffect(() => {
    if (!open) return;
    let last = performance.now();
    function tick(now: number) {
      const dt = now - last;
      last = now;
      // ~18 deg / second (matches 0.3 per frame at ~60fps in the HTML mock)
      setAngle((a) => (a + dt * 0.018) % 360);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function handleNodeClick(key: NodeKey) {
    if (key === "debates") {
      onOpenDebates();
    } else {
      // Pulse the active card briefly to signal "coming soon"
      setActiveKey(key);
      setTimeout(() => setActiveKey((k) => (k === key ? null : k)), 1800);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(6px)",
        animation: "modalIn 0.25s ease",
      }}
      onClick={onClose}
    >
      <div
        className="relative"
        style={{
          width: "min(720px, 96vw)",
          height: "min(620px, 88vh)",
          background:
            "radial-gradient(ellipse at center, rgba(25,118,210,0.08) 0%, rgba(10,10,18,0.95) 70%)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "28px",
          boxShadow:
            "0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
          overflow: "hidden",
          animation: "modalPanelIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glass layers */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(108,92,231,0.12) 0%, transparent 55%), radial-gradient(circle at 70% 80%, rgba(25,118,210,0.12) 0%, transparent 55%)",
          }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 cursor-pointer flex items-center justify-center"
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.75)",
            fontSize: 14,
            zIndex: 20,
          }}
          aria-label="Close"
        >
          ✕
        </button>

        {/* Title */}
        <div
          className="absolute top-6 left-0 right-0 text-center pointer-events-none"
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.82)",
            zIndex: 10,
          }}
        >
          Dashboard
        </div>

        {/* Orbital container */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ zIndex: 5 }}
        >
          {/* Center sphere */}
          <div
            className="absolute rounded-full"
            style={{
              width: 200,
              height: 200,
              background:
                "radial-gradient(circle at 35% 35%, rgba(200,200,220,0.35) 0%, rgba(80,80,120,0.15) 45%, rgba(10,10,18,0.1) 75%)",
              border: "1px solid rgba(255,255,255,0.14)",
              boxShadow:
                "0 0 80px rgba(108,92,231,0.25), inset 0 0 60px rgba(25,118,210,0.15)",
              animation: "spherePulse 4s ease-in-out infinite",
            }}
          />

          {/* Profile at the sphere's center */}
          {profile && (
            <div
              className="absolute flex flex-col items-center"
              style={{ zIndex: 6, pointerEvents: "none" }}
            >
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={profile.username}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid rgba(255,255,255,0.25)",
                    boxShadow: "0 0 24px rgba(108,92,231,0.35)",
                  }}
                />
              ) : (
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #60a5fa, #2563eb)",
                    color: "#eff6ff",
                    fontSize: 24,
                    fontWeight: 600,
                    border: "2px solid rgba(255,255,255,0.25)",
                    boxShadow: "0 0 24px rgba(108,92,231,0.35)",
                  }}
                >
                  {profile.username.charAt(0).toUpperCase()}
                </div>
              )}
              <p
                className="mt-2 m-0"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.85)",
                  textShadow: "0 1px 8px rgba(0,0,0,0.6)",
                }}
              >
                @{profile.username}
              </p>
            </div>
          )}

          {/* Orbital ring */}
          <div
            className="absolute rounded-full"
            style={{
              width: RADIUS * 2 + 24,
              height: RADIUS * 2 + 24,
              border: "1px dashed rgba(255,255,255,0.08)",
            }}
          />

          {/* Nodes */}
          {NODES.map((node, i) => {
            const nodeAngleDeg = (i / NODES.length) * 360 + angle;
            const nodeAngleRad = (nodeAngleDeg * Math.PI) / 180;
            const x = RADIUS * Math.cos(nodeAngleRad);
            const y = RADIUS * Math.sin(nodeAngleRad);
            const depthOpacity = 0.45 + 0.55 * ((1 + Math.sin(nodeAngleRad)) / 2);
            const isActive = activeKey === node.key;
            const effectiveOpacity = activeKey ? (isActive ? 1 : 0.35) : depthOpacity;

            return (
              <div
                key={node.key}
                className="absolute flex flex-col items-center cursor-pointer"
                style={{
                  transform: `translate(${x}px, ${y}px)`,
                  opacity: effectiveOpacity,
                  transition: "opacity 0.25s ease",
                  zIndex: isActive ? 30 : 6,
                }}
                onClick={() => handleNodeClick(node.key)}
                onMouseEnter={() => setActiveKey(node.key)}
                onMouseLeave={() => setActiveKey((k) => (k === node.key ? null : k))}
              >
                {/* Dot with icon */}
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: isActive
                      ? "linear-gradient(135deg, rgba(108,92,231,0.3) 0%, rgba(25,118,210,0.3) 100%)"
                      : "rgba(255,255,255,0.05)",
                    border: isActive
                      ? "1px solid rgba(162,155,254,0.6)"
                      : "1px solid rgba(255,255,255,0.12)",
                    boxShadow: isActive
                      ? "0 0 24px rgba(108,92,231,0.5)"
                      : "0 4px 14px rgba(0,0,0,0.3)",
                    fontSize: 22,
                    transition: "all 0.2s ease",
                  }}
                >
                  {node.icon}
                </div>

                {/* Label */}
                <div
                  className="mt-2 text-center whitespace-nowrap"
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.78)",
                  }}
                >
                  {node.title}
                </div>

                {/* Expand card on hover */}
                {isActive && (
                  <div
                    className="absolute"
                    style={{
                      top: "calc(100% + 12px)",
                      left: "50%",
                      transform: "translateX(-50%)",
                      minWidth: 220,
                      padding: "12px 14px",
                      borderRadius: 14,
                      background: "rgba(15,12,25,0.96)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 14px 36px rgba(0,0,0,0.55)",
                      animation: "cardIn 0.22s ease",
                      backdropFilter: "blur(14px)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Syne', sans-serif",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                      }}
                    >
                      {node.title}
                    </div>
                    <div
                      style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 10,
                        color: "var(--text-dim)",
                        marginBottom: 8,
                        marginTop: 2,
                      }}
                    >
                      {node.subtitle}
                    </div>
                    <div
                      style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 12,
                        color: "var(--text-muted)",
                        lineHeight: 1.5,
                        marginBottom: 10,
                      }}
                    >
                      {node.content}
                    </div>
                    <span
                      style={{
                        display: "inline-block",
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: 999,
                        background:
                          node.status === "available"
                            ? "rgba(34,197,94,0.12)"
                            : "rgba(226,185,107,0.1)",
                        color:
                          node.status === "available" ? "#22c55e" : "#e2b96b",
                        border:
                          node.status === "available"
                            ? "1px solid rgba(34,197,94,0.3)"
                            : "1px solid rgba(226,185,107,0.3)",
                      }}
                    >
                      {node.status === "available" ? "Available" : "Coming soon"}
                    </span>
                    <div
                      className="mt-3"
                      style={{
                        height: 3,
                        background: "rgba(255,255,255,0.06)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${node.energy}%`,
                          height: "100%",
                          background:
                            "linear-gradient(to right, #4a9eff, #a29bfe)",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div
          className="absolute bottom-5 left-0 right-0 text-center pointer-events-none"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            color: "rgba(255,255,255,0.35)",
          }}
        >
          Click a node to open it · ESC to close
        </div>
      </div>

      <style jsx>{`
        @keyframes spherePulse {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.03); filter: brightness(1.15); }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
