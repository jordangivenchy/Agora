/**
 * The shared contract for Agora's user data platform. Every workstream —
 * behavioral capture, in-debate analysis, profile synthesis, learning-style
 * inference, personalization, coaching — imports its types and the consent
 * gate from here, so the lanes interlock instead of drifting.
 *
 * Mirrors the tables in supabase/migrations/20260818_user_data_platform.sql.
 * See docs/data-platform.md for the developer reference.
 *
 * Invariant every writer must honor: check hasConsent(userId, category)
 * BEFORE collecting or deriving anything. Consent defaults to all-false.
 */

export type ConsentCategory = "analytics" | "debate_analysis" | "personalization" | "coaching";

export interface UserDataConsent {
  analytics: boolean;
  debate_analysis: boolean;
  personalization: boolean;
  coaching: boolean;
}

/* ── Workstream 1: behavioral signals ── */
export interface UserSignal {
  kind: string;               // view | click | like | watch | dwell | follow | search | ...
  subjectType?: string;       // room | clip | user | topic | news | ...
  subjectId?: string;
  topicKey?: string | null;
  value?: number;             // watch seconds, dwell ms, scroll %, ...
  meta?: Record<string, unknown>;
}

/* ── Workstream 2: expressed positions ── */
export interface DebatePosition {
  topicKey: string;
  motion: string | null;
  stance: string | null;      // PRO | CON | mixed | nuanced — as argued
  summary: string;            // neutral paraphrase of the user's expressed view
  evidenceUtteranceIds: string[];
  confidence: number;
  roomId?: string | null;
}

/* ── Workstream 3+4: synthesized profile ── */
export interface UserDataProfile {
  behavior: Record<string, unknown>;
  argument_style: Record<string, unknown>;
  learning_style: Record<string, unknown>;
  positions_summary: Record<string, unknown>;
  highlights: string[];
  signals_count: number;
}

/* ── Workstream 5: recommendations ── */
export interface UserRecommendations {
  ranked: Record<string, unknown>;
  rationale: Record<string, unknown>;
}

/* ── Workstream 6: coaching ── */
export type CoachScope = "general" | "debate" | "topic" | "skill";
export interface CoachNote {
  scope: CoachScope;
  scopeRef?: string | null;
  note: string;
  suggestion?: string | null;
}

/**
 * Consent gate. Server-side callers pass a service-role or user Supabase
 * client; both can invoke the has_data_consent RPC. Returns false on any
 * error or missing row — fail closed, never collect without a clear yes.
 */
// Accepts any Supabase-like client: .rpc() returns an awaitable builder, not
// a bare Promise, so we type it as PromiseLike and await it.
interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

export async function hasConsent(
  client: RpcClient,
  userId: string,
  category: ConsentCategory
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("has_data_consent", {
      p_user_id: userId,
      p_category: category,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
