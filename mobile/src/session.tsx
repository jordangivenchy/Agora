/* Who you are and whether you may come in. Holds the Supabase session and
   the beta pass, refreshes the token while the app is in the foreground,
   and answers the two questions every screen asks: signed in? past the
   gate? */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { apiFetch } from "./api";

const PASS_KEY = "agora_beta_pass";

async function readPass(): Promise<string | null> {
  try {
    return Platform.OS === "web" ? await AsyncStorage.getItem(PASS_KEY) : await SecureStore.getItemAsync(PASS_KEY);
  } catch {
    return null;
  }
}
async function writePass(pass: string | null) {
  try {
    if (Platform.OS === "web") {
      if (pass) await AsyncStorage.setItem(PASS_KEY, pass);
      else await AsyncStorage.removeItem(PASS_KEY);
    } else if (pass) await SecureStore.setItemAsync(PASS_KEY, pass);
    else await SecureStore.deleteItemAsync(PASS_KEY);
  } catch {
    /* storage unavailable: the pass lasts this launch */
  }
}

interface SessionState {
  ready: boolean;
  session: Session | null;
  /** The beta pass, or null. */
  pass: string | null;
  /** Whether the site's gate is armed: null until probed. */
  gated: boolean | null;
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** Trade a beta key for a pass. Resolves to an error message, or null. */
  redeemKey(code: string): Promise<string | null>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [gated, setGated] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data }, storedPass] = await Promise.all([supabase.auth.getSession(), readPass()]);
      if (!alive) return;
      setSession(data.session);
      setPass(storedPass);
      /* An empty key answers 200 when the gate is off, 401 when it is on. */
      try {
        const res = await apiFetch("/api/beta", {}, { method: "POST", body: JSON.stringify({ code: "" }) });
        if (alive) setGated(res.status !== 200);
      } catch {
        if (alive) setGated(true);
      }
      if (alive) setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    /* Refresh the token only while the app is up front. */
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      app.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const redeemKey = useCallback(async (code: string) => {
    const res = await apiFetch("/api/beta", {}, { method: "POST", body: JSON.stringify({ code: code.trim() }) }).catch(() => null);
    if (!res) return "Couldn't reach AgoraSphere. Check your connection.";
    if (res.status === 401) return "That key isn't right, or it has been used.";
    if (!res.ok) return "Something went wrong. Try again.";
    const body = (await res.json().catch(() => ({}))) as { pass?: string };
    const next = body.pass ?? null;
    setPass(next);
    await writePass(next);
    if (!next) setGated(false);
    return null;
  }, []);

  const value = useMemo<SessionState>(
    () => ({ ready, session, pass, gated, signIn, signOut, redeemKey }),
    [ready, session, pass, gated, signIn, signOut, redeemKey]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
