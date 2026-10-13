/* Who you are and whether you may come in. Holds the Supabase session and
   the beta pass, refreshes the token while the app is in the foreground,
   and answers the two questions every screen asks: signed in? past the
   gate? Password sign-in goes through the site's route so accounts with
   two-factor get their emailed code; the route hands the app its tokens. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { apiFetch, onPassRefused } from "./api";

const PASS_KEY = "agora_beta_pass";
/* How often an open app asks the site to keep its pass alive. */
const KEEP_PASS_EVERY_MS = 12 * 60 * 60 * 1000;

WebBrowser.maybeCompleteAuthSession();

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

/** The outcome of a password sign-in: in, a code to enter, or a message. */
export type SignInResult = { ok: true } | { ok: false; twoFactor: string; email: string } | { ok: false; error: string; unconfirmed?: boolean };

interface SessionState {
  ready: boolean;
  session: Session | null;
  /** The beta pass, or null. */
  pass: string | null;
  /** Whether the site's gate is armed: null until probed. */
  gated: boolean | null;
  /** The pass this phone held has run out: the door says so instead of just asking for a key. */
  lapsed: boolean;
  /** Listening without an account, like a visitor on the website. */
  guest: boolean;
  listenAsGuest(): void;
  signIn(email: string, password: string): Promise<SignInResult>;
  /** The second step of a two-factor sign-in. Resolves to an error message, or null. */
  verifyTwoFactor(pending: string, code: string): Promise<string | null>;
  resendTwoFactor(pending: string): Promise<string | null>;
  /** A new account, the way the site makes one. Resolves to a notice or an error. */
  signUp(email: string, password: string, username: string): Promise<{ ok: true; session: boolean } | { ok: false; error: string }>;
  resendConfirmation(email: string): Promise<string | null>;
  /** Google through Supabase, in the system browser. Resolves to an error message, or null. */
  signInWithGoogle(): Promise<string | null>;
  /** Discord, the same way. */
  signInWithDiscord(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Trade a beta key for a pass. Resolves to an error message, or null. */
  redeemKey(code: string): Promise<string | null>;
}

const Ctx = createContext<SessionState | null>(null);

function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("already registered")) return "That email already has an account — try signing in.";
  if (m.includes("password should be")) return "Password must be at least 6 characters.";
  if (m.includes("database error saving new user")) return "Couldn't create the account — try a different username or email.";
  if (m.includes("rate limit")) return "Too many attempts — wait a minute and try again.";
  if (m.includes("not confirmed")) return "Verify your email first — open the link we sent you, then sign in.";
  return message;
}

/* The app names itself so the site's sign-in routes answer with tokens
   rather than cookies. */
const APP_HEADERS = { "x-agora-client": "app" };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [gated, setGated] = useState<boolean | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [guest, setGuest] = useState(false);
  const [ready, setReady] = useState(false);

  /* The pass is kept alive from here. A pass lasts 30 days from the last
     time the site saw it: asked (api/beta/pass), the site hands back a
     fresh one for any pass more than a day old, and says so when one no
     longer opens the door. Then the pass is dropped and the door asks
     for a key again; before, every call to the site was turned away
     without a word and rooms could not be joined. No answer (offline)
     changes nothing. */
  const passRef = useRef<string | null>(null);
  const keptAt = useRef(0);
  const holdPass = useCallback((next: string | null) => {
    passRef.current = next;
    setPass(next);
    void writePass(next);
  }, []);
  const dropPass = useCallback(() => {
    if (!passRef.current) return;
    holdPass(null);
    setLapsed(true);
  }, [holdPass]);
  const keepPass = useCallback(async () => {
    const current = passRef.current;
    if (!current) return;
    keptAt.current = Date.now();
    const res = await apiFetch("/api/beta/pass", {}, { method: "POST", body: JSON.stringify({ pass: current }) }).catch(() => null);
    if (!res || passRef.current !== current) return;
    if (res.status === 401) { dropPass(); return; }
    if (!res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { pass?: string };
    if (body.pass && body.pass !== current && passRef.current === current) holdPass(body.pass);
  }, [dropPass, holdPass]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data }, storedPass] = await Promise.all([supabase.auth.getSession(), readPass()]);
      if (!alive) return;
      setSession(data.session);
      passRef.current = storedPass;
      setPass(storedPass);
      void keepPass();
      /* A pass already opens the door whatever the gate says, so the app
         stands up now and the probe below only fills in the answer; the
         door waits on it only for those without one. */
      if (storedPass) setReady(true);
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
    /* Refresh the token only while the app is up front; and an app left
       open for days still keeps its pass. */
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        supabase.auth.startAutoRefresh();
        if (Date.now() - keptAt.current > KEEP_PASS_EVERY_MS) void keepPass();
      } else supabase.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();
    /* A call the door turned away anyway (the pass ended between two checks). */
    const offRefused = onPassRefused(dropPass);
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      app.remove();
      offRefused();
      supabase.auth.stopAutoRefresh();
    };
  }, [keepPass, dropPass]);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const clean = email.trim();
    let res: Response | null = null;
    try {
      res = await apiFetch("/api/auth/2fa/login", {}, { method: "POST", headers: APP_HEADERS, body: JSON.stringify({ email: clean, password }) });
    } catch {
      res = null;
    }
    /* The site out of reach, an older one without the app's answer, or
       one without its admin key (a dev server): the plain sign-in, which
       the auth hook refuses for two-factor accounts, as intended. */
    if (!res || res.status === 404 || res.status === 503) {
      const { error } = await supabase.auth.signInWithPassword({ email: clean, password });
      return error ? { ok: false, error: friendlyError(error.message) } : { ok: true };
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string; twoFactor?: boolean; pending?: string; unconfirmed?: boolean; session?: { access_token: string; refresh_token: string } };
    if (!res.ok) return { ok: false, error: json.error ?? "Sign-in failed. Try again.", unconfirmed: !!json.unconfirmed };
    if (json.twoFactor && json.pending) return { ok: false, twoFactor: json.pending, email: clean };
    if (!json.session) {
      const { error } = await supabase.auth.signInWithPassword({ email: clean, password });
      return error ? { ok: false, error: friendlyError(error.message) } : { ok: true };
    }
    const { error } = await supabase.auth.setSession(json.session);
    return error ? { ok: false, error: error.message } : { ok: true };
  }, []);

  const verifyTwoFactor = useCallback(async (pending: string, code: string) => {
    const res = await apiFetch("/api/auth/2fa/verify", {}, { method: "POST", headers: APP_HEADERS, body: JSON.stringify({ pending, code }) }).catch(() => null);
    if (!res) return "Verification failed. Check your connection and try again.";
    const json = (await res.json().catch(() => ({}))) as { error?: string; session?: { access_token: string; refresh_token: string } };
    if (!res.ok) return json.error ?? "Invalid or expired code.";
    if (!json.session) return "Couldn't finish signing in. Try again.";
    const { error } = await supabase.auth.setSession(json.session);
    return error ? error.message : null;
  }, []);

  const resendTwoFactor = useCallback(async (pending: string) => {
    const res = await apiFetch("/api/auth/2fa/resend", {}, { method: "POST", body: JSON.stringify({ pending }) }).catch(() => null);
    if (!res) return "Couldn't resend the code. Check your connection.";
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? null : json.error ?? "Couldn't resend the code.";
  }, []);

  const signUp = useCallback(async (email: string, password: string, username: string) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { preferred_username: username.trim().toLowerCase() } } });
    if (error) return { ok: false as const, error: friendlyError(error.message) };
    return { ok: true as const, session: !!data.session };
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
    return error ? friendlyError(error.message) : null;
  }, []);

  /* The same Google and Discord sign-ins the website uses. Supabase hands
     back a URL for their consent screen; the system browser opens it and returns
     to the app at the redirect (exp://… in Expo Go, agorasphere://auth in
     the build; both must be on Supabase's redirect allow-list) carrying
     the session in the fragment. */
  const listenAsGuest = useCallback(() => setGuest(true), []);

  const signInWithProvider = useCallback(async (provider: "google" | "discord") => {
    const who = provider === "google" ? "Google" : "Discord";
    const fromExpoGo = Linking.createURL("/auth");
    const redirectTo = /^exps?:\/\//.test(fromExpoGo) ? fromExpoGo : "agorasphere://auth";
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) return error?.message ?? `Couldn't start ${who} sign-in.`;
      if (Platform.OS === "web") {
        window.location.assign(data.url);
        return null;
      }
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success") return result.type === "cancel" || result.type === "dismiss" ? "Sign-in was cancelled." : `${who} sign-in didn't finish.`;
      const back = new URL(result.url);
      const params = new URLSearchParams(back.search);
      new URLSearchParams(back.hash.replace(/^#/, "")).forEach((v, k) => params.set(k, v));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (!access_token || !refresh_token) return params.get("error_description") ?? `${who} sent nothing back.`;
      const { error: sessionErr } = await supabase.auth.setSession({ access_token, refresh_token });
      return sessionErr ? sessionErr.message : null;
    } catch (e) {
      return e instanceof Error ? e.message : `${who} sign-in failed.`;
    }
  }, []);
  const signInWithGoogle = useCallback(() => signInWithProvider("google"), [signInWithProvider]);
  const signInWithDiscord = useCallback(() => signInWithProvider("discord"), [signInWithProvider]);

  const signOut = useCallback(async () => {
    setGuest(false);
    await supabase.auth.signOut();
  }, []);

  const redeemKey = useCallback(async (code: string) => {
    const res = await apiFetch("/api/beta", {}, { method: "POST", body: JSON.stringify({ code: code.trim() }) }).catch(() => null);
    if (!res) return "Couldn't reach AgoraSphere. Check your connection.";
    if (res.status === 401) return "That key didn't work. Check for typos — keys work once and expire after 48 hours.";
    if (!res.ok) return "Something went wrong on our end. Try again.";
    const body = (await res.json().catch(() => ({}))) as { pass?: string };
    const next = body.pass ?? null;
    passRef.current = next;
    keptAt.current = Date.now();
    setPass(next);
    setLapsed(false);
    await writePass(next);
    if (!next) setGated(false);
    return null;
  }, []);

  const value = useMemo<SessionState>(
    () => ({ ready, session, pass, gated, lapsed, guest, listenAsGuest, signIn, verifyTwoFactor, resendTwoFactor, signUp, resendConfirmation, signInWithGoogle, signInWithDiscord, signOut, redeemKey }),
    [ready, session, pass, gated, lapsed, guest, listenAsGuest, signIn, verifyTwoFactor, resendTwoFactor, signUp, resendConfirmation, signInWithGoogle, signInWithDiscord, signOut, redeemKey]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** A brand-new account (made in the last five minutes) gets the welcome flow, as on the site. */
export function isNewAccount(session: Session | null): boolean {
  const at = session?.user.created_at;
  return !!at && Date.now() - new Date(at).getTime() < 5 * 60 * 1000;
}
