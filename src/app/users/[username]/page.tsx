"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import UserProfileModal from "@/components/UserProfileModal";

/**
 * Shareable public profile page: /users/[username]
 *
 * Basic setup: resolves the username to a user id, then renders the existing
 * (fully-featured) UserProfileModal over a dimmed backdrop. Closing it goes
 * home. Follow-list rows can swap the viewed profile in place without a
 * navigation (the modal drives that via onOpenProfile).
 */
export default function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);
  const router = useRouter();
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id")
        .ilike("username", decodeURIComponent(username))
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) setNotFound(true);
      else setUserId(data.id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  if (notFound) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          background: "var(--bg-primary)",
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          @{decodeURIComponent(username)} not found
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          This profile doesn&apos;t exist or the username changed.
        </p>
        <button
          onClick={() => router.push("/")}
          className="cursor-pointer"
          style={{
            marginTop: 6,
            padding: "9px 18px",
            borderRadius: 10,
            background: "var(--accent-blue)",
            color: "#fff",
            border: "none",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Back to debates
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
      {/* Spinner while the username resolves; the modal takes over after. */}
      {!userId && (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="animate-spin"
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "2px solid var(--accent-blue)",
              borderTopColor: "transparent",
            }}
          />
        </div>
      )}

      <UserProfileModal
        userId={userId}
        onClose={() => router.push("/")}
        onOpenProfile={(nextId) => setUserId(nextId)}
      />
    </div>
  );
}
