"use client";

/* "Your Data & Coach" — the consent + rights surface for Agora's user data
   platform. Consent is granted with the app's terms and is ON by default
   (seeded at signup); this panel lets a user turn any category OFF, and
   download or erase everything Agora has derived about them.

   This is the permissions/UI layer (item 8). Consent writes go straight to
   user_data_consent under the user's own RLS. */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { setCaptureEnabled } from "@/lib/capture/track";
import type { ConsentCategory } from "@/lib/dataPlatform/contract";

type Consent = Record<ConsentCategory, boolean>;

const CATEGORIES: { key: ConsentCategory; title: string; blurb: string }[] = [
  { key: "analytics", title: "Activity analytics", blurb: "What you view, watch, like, and follow in the app — to personalize your feed." },
  { key: "debate_analysis", title: "In-discussion analysis", blurb: "Agora analyzes how you argue and the positions you express on stage, to build your profile and coaching. The listening indicator always shows when this is active." },
  { key: "personalization", title: "Personalized recommendations", blurb: "Use your profile to rank rooms, topics, and people for you — with a visible reason for each." },
  { key: "coaching", title: "Persona notes & coach", blurb: "Turn your profile into specific, constructive coaching on how you argue and learn." },
];

// On by default — consent is granted when the user accepts the app's terms
// (seeded at signup). This panel is where they can turn any of it OFF.
const DEFAULT_CONSENT: Consent = { analytics: true, debate_analysis: true, personalization: true, coaching: true };
const ALL_OFF: Consent = { analytics: false, debate_analysis: false, personalization: false, coaching: false };

export default function DataAndCoachPanel() {
  const [consent, setConsent] = useState<Consent>(DEFAULT_CONSENT);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoaded(true); return; }
      const { data } = await supabase
        .from("user_data_consent")
        .select("analytics, debate_analysis, personalization, coaching")
        .eq("user_id", user.id)
        .maybeSingle();
      const c = (data as Consent) ?? DEFAULT_CONSENT;
      setConsent(c);
      setCaptureEnabled(c.analytics);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(async (key: ConsentCategory) => {
    const next = { ...consent, [key]: !consent[key] };
    setConsent(next);
    if (key === "analytics") setCaptureEnabled(next.analytics);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("user_data_consent").upsert({
      user_id: user.id,
      ...next,
      updated_at: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent]);

  const download = useCallback(async () => {
    const res = await fetch("/api/me/data");
    const body = await res.json();
    const blob = new Blob([JSON.stringify(body.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-agora-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const erase = useCallback(async () => {
    if (!confirm("Delete everything Agora has derived about you? Your account and your own words in past discussions stay; all profiles, positions, recommendations, and coach notes are permanently removed.")) return;
    setBusy(true);
    try {
      await fetch("/api/me/data", { method: "DELETE" });
      setConsent(ALL_OFF);
      setCaptureEnabled(false);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!loaded) return null;

  return (
    <div style={{ maxWidth: 620, fontFamily: "'DM Sans', sans-serif", color: "#e5e5ec" }}>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        Your Data &amp; Coach
      </h2>
      <p style={{ fontSize: 13, color: "#8b8b94", marginBottom: 20 }}>
        Agora builds your profile and coaching from how you use the app and
        speak on stage. You can turn any of it off here, and download or delete
        everything it derives — it&rsquo;s built to coach you, not to profile
        you for anyone else.
      </p>

      {/* Consent toggles */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
        {CATEGORIES.map((cat) => (
          <div key={cat.key} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14, borderRadius: 12, background: "rgba(20,20,26,0.7)", border: "0.5px solid #34343c" }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{cat.title}</p>
              <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "#8b8b94", lineHeight: 1.5 }}>{cat.blurb}</p>
            </div>
            <button
              role="switch"
              aria-checked={consent[cat.key]}
              onClick={() => toggle(cat.key)}
              style={{
                width: 40, height: 23, borderRadius: 999, position: "relative", flexShrink: 0, border: "none", cursor: "pointer",
                background: consent[cat.key] ? "linear-gradient(135deg,#60a5fa,#2563eb)" : "rgba(90,90,102,0.5)",
                transition: "background 0.2s",
              }}
            >
              <span style={{ position: "absolute", top: 2, left: consent[cat.key] ? 19 : 2, width: 19, height: 19, borderRadius: "50%", background: "#eff6ff", transition: "left 0.2s" }} />
            </button>
          </div>
        ))}
      </div>

      {/* Data rights */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={download} disabled={busy} style={btn("#9cc4f0")}>Download my data</button>
        <button onClick={erase} disabled={busy} style={btn("#f0605e")}>Delete my derived data</button>
      </div>
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color,
    background: "rgba(20,20,26,0.85)", border: `0.5px solid ${color}55`, borderRadius: 999,
    padding: "8px 14px", cursor: "pointer",
  };
}
