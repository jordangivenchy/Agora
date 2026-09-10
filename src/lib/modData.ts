/* The mod page's first view — is the viewer a moderator, and the
   reports — fetched by the route on the server so the page arrives
   complete (or redirects) behind its loading screen. ModPage starts
   from it and re-checks in the browser as before; the server enforces
   moderator access on every RPC regardless. */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ModReport = {
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

export type ModInitial =
  | { status: "login" }
  | { status: "denied" }
  | { status: "ok"; reports: ModReport[]; loadError: string | null };

export async function fetchModInitial(supabase: SupabaseClient): Promise<ModInitial> {
  // The session's claims, verified here against the project's signing key — no auth round trip.
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub;
  if (!uid) return { status: "login" };
  const { data: row } = await supabase.from("users").select("is_moderator").eq("id", uid).maybeSingle();
  if (!row?.is_moderator) return { status: "denied" };
  const { data, error } = await supabase.rpc("mod_list_reports", { p_status: null, p_limit: 200 });
  if (error) {
    return {
      status: "ok",
      reports: [],
      loadError: error.message.includes("not_moderator") ? "You don't have moderator access." : error.message,
    };
  }
  return { status: "ok", reports: (data ?? []) as ModReport[], loadError: null };
}
