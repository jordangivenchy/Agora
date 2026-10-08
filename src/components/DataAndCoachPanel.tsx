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
import { sessionUser } from "@/lib/session";
import { AGORA_AI } from "@/lib/features";
import { SectionCard, SwitchRow } from "@/components/SettingsParts";

type Consent = Record<ConsentCategory, boolean>;

/* The three built on Agora's analysis are shown as coming soon while the
   assistant is off (AGORA_AI): the switch is replaced by a chip, and
   nothing is written for them. */
const CATEGORIES: { key: ConsentCategory; title: string; blurb: string; ai?: boolean }[] = [
  { key: "analytics", title: "Activity analytics", blurb: "What you view, watch, like, and follow in the app — to personalize your feed." },
  /* The switch the terms promise (section 6): leave my words out. */
  { key: "research", title: "Anonymous totals", blurb: "Count what I say in public rooms in totals about what people discuss. No names, no quotes, and never anything about you personally." },
  { key: "debate_analysis", title: "In-discussion analysis", blurb: "Agora analyzes how you argue and the positions you express on stage, to build your profile and coaching. The listening indicator always shows when this is active.", ai: true },
  { key: "personalization", title: "Personalized recommendations", blurb: "Use your profile to rank rooms, topics, and people for you — with a visible reason for each.", ai: true },
  { key: "coaching", title: "Persona notes & coach", blurb: "Turn your profile into specific, constructive coaching on how you argue and learn.", ai: true },
];

// On by default — consent is granted when the user accepts the app's terms
// (seeded at signup). This panel is where they can turn any of it OFF.
const DEFAULT_CONSENT: Consent = { analytics: true, debate_analysis: true, personalization: true, coaching: true, research: true };
/* What "Delete my derived data" leaves switched off (erase_user_data). The
   anonymous totals are not derived data about a person, so that switch
   stays where it was. */
const ERASED = { analytics: false, debate_analysis: false, personalization: false, coaching: false };

export default function DataAndCoachPanel() {
  const [consent, setConsent] = useState<Consent>(DEFAULT_CONSENT);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await sessionUser(supabase);
      if (!user) { setLoaded(true); return; }
      const { data } = await supabase
        .from("user_data_consent")
        .select("analytics, debate_analysis, personalization, coaching, research")
        .eq("user_id", user.id)
        .maybeSingle();
      const c = { ...DEFAULT_CONSENT, ...((data as Partial<Consent> | null) ?? {}) };
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
    const { data: { user } } = await sessionUser(supabase);
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
      setConsent((c) => ({ ...c, ...ERASED }));
      setCaptureEnabled(false);
    } finally {
      setBusy(false);
    }
  }, []);

  /* One card in the settings page's own shapes: the explanation under
     the title, a row for each kind of data, then the two things you can
     do with it. The card is there from the start, its switch waiting on
     what the account has chosen, so nothing drops in late. */
  return (
    <SectionCard
      title="Data & Coach"
      text={AGORA_AI ? (
        <>
          Agora builds your profile and coaching from how you use the app and
          speak on stage. You can turn any of it off here, and download or delete
          everything it derives &mdash; it&rsquo;s built to coach you, not to profile
          you for anyone else.
        </>
      ) : (
        <>
          Agora&rsquo;s coach, the analysis of how you argue and the recommendations
          built on it, is coming soon. Until then nothing of the kind is collected.
          Activity analytics is the one thing that runs today; you can turn it off
          here, and download or delete everything the app holds about you.
        </>
      )}
    >
      {CATEGORIES.map((cat) => (
        cat.ai && !AGORA_AI ? (
          <div key={cat.key} className="stg-row is-soon">
            <span className="stg-row-text">
              <span className="stg-row-label">{cat.title}</span>
              <span className="stg-row-sub">{cat.blurb}</span>
            </span>
            <span className="stg-chip">Coming soon</span>
          </div>
        ) : (
          <SwitchRow
            key={cat.key}
            on={consent[cat.key]}
            disabled={!loaded}
            onChange={() => toggle(cat.key)}
            label={cat.title}
            sub={cat.blurb}
          />
        )
      ))}
      <div className="stg-foot">
        <button type="button" onClick={download} disabled={busy || !loaded} className="stg-btn">Download my data</button>
        <button type="button" onClick={erase} disabled={busy || !loaded} className="stg-btn stg-btn--danger">Delete my derived data</button>
      </div>
    </SectionCard>
  );
}
