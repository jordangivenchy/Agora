/* Has this person agreed to the terms in force, and what have they told
   us about themselves? (components/agora/legal and aboutYou,
   user_agreements, user_details, accept_terms.) Shared by the boot
   check, the /agree page and Settings.

   The answer is remembered in the browser per account and version, so
   an ordinary page load asks nothing. A failed lookup is "unknown",
   never "no": nobody is sent to agree again because a request failed. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEGAL } from "@/components/agora/legal";
import type { AboutYou } from "@/components/agora/aboutYou";

const KEY = "agora:terms";

function read(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** This browser has seen this account agree to the version in force. */
export function knownAgreed(userId: string): boolean {
  return read()[userId] === LEGAL.version;
}

export function rememberAgreed(userId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [userId]: LEGAL.version }));
  } catch {
    /* private window: it is asked of the server each time instead */
  }
}

export type Agreement = { state: "agreed"; at: string } | { state: "not" } | { state: "unknown" };

/** What the server says: when they agreed to the version in force, that they haven't, or that we couldn't find out. */
export async function agreement(supabase: SupabaseClient, userId: string): Promise<Agreement> {
  try {
    const { data, error } = await supabase
      .from("user_agreements")
      .select("accepted_at")
      .eq("user_id", userId)
      .eq("version", LEGAL.version)
      .maybeSingle();
    if (error) return { state: "unknown" };
    const at = (data as { accepted_at?: string } | null)?.accepted_at;
    return at ? { state: "agreed", at } : { state: "not" };
  } catch {
    return { state: "unknown" };
  }
}

/** What a person has told us about themselves: nothing yet, the year
    they were born and where they live, or a date of birth that put the
    account on hold. "unknown" when we couldn't find out. */
export type Details =
  | { state: "known"; birthYear: number | null; country: string | null; region: string | null; checked: boolean; held: boolean }
  | { state: "unknown" };

export async function details(supabase: SupabaseClient, userId: string): Promise<Details> {
  try {
    const { data, error } = await supabase
      .from("user_details")
      .select("birth_year, country, region, age_checked_at, under_age_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { state: "unknown" };
    const row = data as { birth_year?: number | null; country?: string | null; region?: string | null; age_checked_at?: string | null; under_age_at?: string | null } | null;
    return {
      state: "known",
      birthYear: row?.birth_year ?? null,
      country: row?.country ?? null,
      region: row?.region ?? null,
      checked: Boolean(row?.age_checked_at),
      held: Boolean(row?.under_age_at),
    };
  } catch {
    return { state: "unknown" };
  }
}

/** What came of agreeing: recorded, and when; refused because the date
    of birth is under age (the account is now on hold); or not saved. */
export type Accepted = { state: "ok"; at: string } | { state: "under_age" } | { state: "failed" };

/** Agree to the version in force. `about` goes with it the first time:
    the date of birth to check and the place to keep. */
export async function acceptTerms(
  supabase: SupabaseClient,
  platform: "web" | "ios" | "android" = "web",
  about: AboutYou | null = null,
): Promise<Accepted> {
  try {
    const { data, error } = await supabase.rpc("accept_terms", {
      p_version: LEGAL.version,
      p_platform: platform,
      ...(about ? { p_birth: about.birth, p_country: about.country, p_region: about.region } : {}),
    });
    if (error) return { state: "failed" };
    const answer = data as { result?: string; accepted_at?: string } | null;
    if (answer?.result === "under_age") return { state: "under_age" };
    if (answer?.result === "ok" && typeof answer.accepted_at === "string") return { state: "ok", at: answer.accepted_at };
    return { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

/** A move: the country and, in the United States, the state. True when saved. */
export async function saveMyPlace(supabase: SupabaseClient, country: string, region: string | null): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("set_my_place", { p_country: country, p_region: region });
    return !error;
  } catch {
    return false;
  }
}

/** Pages a person can always reach without having agreed: the documents
    themselves, the way in, and the way out. */
const OPEN = ["/agree", "/terms", "/privacy", "/login", "/auth", "/beta", "/forgot-password", "/reset-password", "/discord", "/app"];
export function needsNoAgreement(pathname: string): boolean {
  return OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Where to go after agreeing: a path on this site, never another site. */
export function safeNext(raw: string | null | undefined): string {
  const next = raw ?? "/";
  return next.startsWith("/") && !next.startsWith("//") && !needsNoAgreement(next.split("?")[0]) ? next : "/";
}
