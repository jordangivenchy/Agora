/* Has this person agreed to the terms in force, and what have they told
   us about themselves? The app's side of the site's lib/terms.ts: the
   same words (components/agora/legal and aboutYou), the same records
   (user_agreements, user_details, accept_terms).

   What this run of the app knows is kept here and shared, so the tabs
   stop asking the moment someone agrees; it is also stored on the phone
   per account and version, so an ordinary launch asks the server
   nothing. A lookup that fails is "unknown", never "no": nobody is held
   at the door because a request failed. Dormant while the documents are
   still a draft (legalReady). */
import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { LEGAL, legalReady } from "../../src/components/agora/legal";
import type { AboutYou } from "../../src/components/agora/aboutYou";

const KEY = "agora:terms";
const memory = new Map<string, "agreed" | "not">();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

async function stored(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function rememberAgreed(userId: string): Promise<void> {
  memory.set(userId, "agreed");
  emit();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...(await stored()), [userId]: LEGAL.version }));
  } catch {
    /* asked of the server next launch instead */
  }
}

export type Agreement = { state: "agreed"; at: string } | { state: "not" } | { state: "unknown" };

/** What the server says about the version in force. */
export async function agreement(userId: string): Promise<Agreement> {
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

export async function details(userId: string): Promise<Details> {
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
export async function acceptTerms(about: AboutYou | null = null): Promise<Accepted> {
  try {
    const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
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
export async function saveMyPlace(country: string, region: string | null): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("set_my_place", { p_country: country, p_region: region });
    return !error;
  } catch {
    return false;
  }
}

/** For the tabs: "ask" when this signed-in person has not agreed to the
    terms in force; "ok" otherwise, and while that isn't known. */
export function useTermsGate(userId: string | null): "ok" | "ask" {
  const known = useSyncExternalStore(subscribe, () => (userId ? memory.get(userId) ?? null : null));
  useEffect(() => {
    if (!userId || !legalReady() || memory.has(userId)) return;
    let on = true;
    void (async () => {
      if ((await stored())[userId] === LEGAL.version) {
        if (on) {
          memory.set(userId, "agreed");
          emit();
        }
        return;
      }
      const found = await agreement(userId);
      if (!on) return;
      if (found.state === "agreed") void rememberAgreed(userId);
      else if (found.state === "not") {
        memory.set(userId, "not");
        emit();
      }
    })();
    return () => {
      on = false;
    };
  }, [userId]);
  return legalReady() && userId && known === "not" ? "ask" : "ok";
}
