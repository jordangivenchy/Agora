/**
 * Profile refresh orchestrator: read a user's source data (signals, argument
 * style, expressed positions), run the pure synthesis, and upsert
 * user_data_profiles. Gated on the "coaching" consent category — a profile is
 * derived only for users who opted into the coach.
 *
 * `admin` is a service-role Supabase client (passed in, not imported, so this
 * stays testable and the RLS boundary is explicit at the call site).
 */

import { hasConsent } from "@/lib/dataPlatform/contract";
import type { DebatePosition, UserSignal } from "@/lib/dataPlatform/contract";
import { synthesizeProfile } from "./synthesize";

interface Admin {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        order?: (col: string, opts: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: unknown }> };
        maybeSingle?: () => PromiseLike<{ data: unknown }>;
        limit?: (n: number) => PromiseLike<{ data: unknown }>;
      };
    };
    upsert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
}

const SIGNAL_WINDOW = 2000;

export async function refreshUserProfile(admin: Admin, userId: string): Promise<boolean> {
  // Consent gate: no coaching consent, no derived profile.
  if (!(await hasConsent(admin, userId, "coaching"))) return false;

  // Recent behavioral signals.
  const sig = await admin
    .from("user_signals")
    .select("kind, subject_type, subject_id, topic_key, value")
    .eq("user_id", userId)
    .order!("created_at", { ascending: false })
    .limit(SIGNAL_WINDOW);
  const rawSignals = (sig.data as Record<string, unknown>[] | null) ?? [];
  const signals: UserSignal[] = rawSignals.map((r) => ({
    kind: String(r.kind),
    subjectType: (r.subject_type as string) ?? undefined,
    subjectId: (r.subject_id as string) ?? undefined,
    topicKey: (r.topic_key as string) ?? null,
    value: (r.value as number) ?? undefined,
  }));

  // Argument style (from the existing persona layer).
  const persona = await admin
    .from("debate_personas")
    .select("profile")
    .eq("user_id", userId)
    .maybeSingle!();
  const argumentStyle = ((persona.data as { profile?: unknown } | null)?.profile ?? null) as
    | { styles?: Record<string, number>; counts?: Record<string, number> }
    | null;

  // Expressed positions.
  const pos = await admin
    .from("debate_positions")
    .select("topic_key, motion, stance, summary, confidence")
    .eq("user_id", userId)
    .limit!(200);
  const positions: DebatePosition[] = ((pos.data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    topicKey: String(r.topic_key),
    motion: (r.motion as string) ?? null,
    stance: (r.stance as string) ?? null,
    summary: String(r.summary ?? ""),
    evidenceUtteranceIds: [],
    confidence: (r.confidence as number) ?? 0,
  }));

  const profile = synthesizeProfile({ signals, argumentStyle, positions });

  const { error } = await admin.from("user_data_profiles").upsert({
    user_id: userId,
    behavior: profile.behavior,
    argument_style: profile.argument_style,
    learning_style: profile.learning_style,
    positions_summary: profile.positions_summary,
    highlights: profile.highlights,
    signals_count: profile.signals_count,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[profile] upsert failed:", error);
    return false;
  }
  return true;
}
