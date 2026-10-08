"use client";

/* What a person sees when asked to agree to the terms. The first time
   there are two short steps: a few things about them (a date of birth,
   their country and, in the United States, their state), then the
   points that matter, the two documents to read, a box to tick and one
   button. Someone we already know sees only the second. Nothing is sent
   until that button: the answers travel with the agreement.

   No account or network in here — app/agree/page.tsx supplies those — so
   every state of it can be looked at on its own. The frame and its
   pieces are the sign-in flows' (AuthShell, app/auth.css); the words of
   the first step are shared with the app (components/agora/aboutYou). */

import { useRef, useState, type ChangeEvent } from "react";
import AuthShell from "@/components/auth/AuthShell";
import { LoadingLine } from "@/components/LoadingScreen";
import { Icon, type IconName } from "@/components/icons";
import { LEGAL, termsSummary } from "@/components/agora/legal";
import { ABOUT_COPY, aboutYou, birthHint, checkBirth, type AboutYou, type BirthParts } from "@/components/agora/aboutYou";
import { COUNTRIES, COUNTRIES_FIRST, US_STATES, countryName, needsState } from "@/components/agora/places";

export type AgreeState = "loading" | "ask" | "busy" | "done";

/* One picture for each of the points, in their order (termsSummary):
   your age, the recording, the rules, what stays yours, the totals. */
const POINT_ICONS: IconName[] = ["user-check", "video", "shield", "file-text", "trending-up"];

const digits = (text: string, most: number) => text.replace(/\D/g, "").slice(0, most);

export default function AgreeCard({ state, error, ready, next, askAbout = false, held = false, onAgree, onSignOut }: {
  state: AgreeState;
  error: string | null;
  /** False while the terms are still a draft: nothing to agree to. */
  ready: boolean;
  /** Where the person was headed. */
  next: string;
  /** We don't yet know their age and where they live: ask first. */
  askAbout?: boolean;
  /** The date of birth this account gave was under age. */
  held?: boolean;
  /** The answers come with it when they were asked for. */
  onAgree: (about: AboutYou | null) => void;
  onSignOut: () => void;
}) {
  /* The box is theirs to tick: the button does nothing until it is. */
  const [ticked, setTicked] = useState(false);
  /* The first step's answers, kept here until the agreement is sent. */
  const [step, setStep] = useState<"about" | "terms">("about");
  const [birth, setBirth] = useState<BirthParts>({ month: "", day: "", year: "" });
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  const read = (
    <div className="agree-read">
      <a href="/terms" target="_blank" rel="noopener">
        <Icon name="file-text" size={14} />
        <span><span className="agree-read-lead">Read the terms</span><span className="agree-read-short">Terms</span></span>
      </a>
      <a href="/privacy" target="_blank" rel="noopener">
        <Icon name="lock" size={14} />
        <span><span className="agree-read-lead">Read the privacy policy</span><span className="agree-read-short">Privacy policy</span></span>
      </a>
    </div>
  );

  if (!ready) {
    return (
      <AuthShell width={460}>
        <h1 className="auth-title">Nothing to agree to yet</h1>
        <p className="auth-sub">AgoraSphere&apos;s terms are still a draft. You can read them as they stand.</p>
        {read}
        <a href={next} className="auth-primary">Carry on</a>
      </AuthShell>
    );
  }

  if (held) {
    return (
      <AuthShell width={460} brandHref={null}>
        <div className="auth-glyph is-bad"><Icon name="lock" size={24} /></div>
        <h1 className="auth-title">{ABOUT_COPY.heldTitle}</h1>
        <p className="auth-sub agree-held">{ABOUT_COPY.held(LEGAL.contact)}</p>
        <button type="button" className="auth-secondary" onClick={onSignOut}>Sign out</button>
      </AuthShell>
    );
  }

  const signOut = (
    <button type="button" className="auth-quiet" onClick={onSignOut} disabled={state === "busy" || state === "done"}>
      Sign out instead
    </button>
  );

  /* Finding out who this is, and whether they have been asked before:
     which step comes first isn't known yet. */
  if (state === "loading") {
    return (
      <AuthShell width={460} brandHref={null} footer={signOut}>
        <div className="auth-wait"><LoadingLine label="One moment" /></div>
      </AuthShell>
    );
  }

  const about = askAbout ? aboutYou(birth, country, region) : null;

  if (askAbout && step === "about") {
    const hint = birthHint(checkBirth(birth));
    const part = (key: keyof BirthParts, most: number) => (e: ChangeEvent<HTMLInputElement>) => {
      const value = digits(e.target.value, most);
      setBirth((b) => ({ ...b, [key]: value }));
      /* A full box hands on to the next one. */
      if (value.length < most) return;
      if (key === "month") dayRef.current?.focus();
      else if (key === "day") yearRef.current?.focus();
    };
    return (
      <AuthShell width={460} brandHref={null} footer={signOut}>
        <h1 className="auth-title">{ABOUT_COPY.title}</h1>
        <p className="auth-sub">{ABOUT_COPY.sub}</p>

        <form
          className="auth-form agree-about"
          onSubmit={(e) => {
            e.preventDefault();
            if (about) setStep("terms");
          }}
        >
          <div className="auth-field-group" role="group" aria-labelledby="agree-birth-label">
            <div className="auth-label" id="agree-birth-label">{ABOUT_COPY.birth}<small>Month, day, year</small></div>
            <div className="agree-birth-row">
              <input className="auth-field is-centered" type="text" inputMode="numeric" autoComplete="bday-month" placeholder="MM" aria-label="Month of birth" value={birth.month} onChange={part("month", 2)} />
              <input ref={dayRef} className="auth-field is-centered" type="text" inputMode="numeric" autoComplete="bday-day" placeholder="DD" aria-label="Day of birth" value={birth.day} onChange={part("day", 2)} />
              <input ref={yearRef} className="auth-field is-centered" type="text" inputMode="numeric" autoComplete="bday-year" placeholder="YYYY" aria-label="Year of birth" value={birth.year} onChange={part("year", 4)} />
            </div>
            <p className={`auth-hint${hint.bad ? " is-bad" : ""}`} aria-live="polite">{hint.text}</p>
          </div>

          <div className={`agree-place${needsState(country) ? " has-state" : ""}`}>
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="agree-country">{ABOUT_COPY.country}</label>
              <select
                id="agree-country"
                className={`auth-field agree-select${country ? "" : " is-empty"}`}
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  if (!needsState(e.target.value)) setRegion("");
                }}
                autoComplete="country"
              >
                <option value="" disabled>{ABOUT_COPY.pickCountry}</option>
                {COUNTRIES_FIRST.map((code) => <option key={`first-${code}`} value={code}>{countryName(code)}</option>)}
                <option disabled>──────────</option>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
            {needsState(country) && (
              <div className="auth-field-group">
                <label className="auth-label" htmlFor="agree-state">{ABOUT_COPY.state}</label>
                <select
                  id="agree-state"
                  className={`auth-field agree-select${region ? "" : " is-empty"}`}
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  autoComplete="address-level1"
                >
                  <option value="" disabled>{ABOUT_COPY.pickState}</option>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
            )}
          </div>

          <button type="submit" className="auth-primary agree-go" disabled={!about}>{ABOUT_COPY.go}</button>
        </form>
        <p className="agree-fine">{ABOUT_COPY.fine}</p>
      </AuthShell>
    );
  }

  const waiting = state !== "ask";
  return (
    <AuthShell
      width={460}
      brandHref={null}
      footer={
        askAbout ? (
          <div className="agree-foot">
            <button type="button" className="auth-quiet" onClick={() => setStep("about")} disabled={waiting}>Back</button>
            {signOut}
          </div>
        ) : signOut
      }
    >
      <h1 className="auth-title">Before you carry on</h1>
      <p className="auth-sub">AgoraSphere has terms and a privacy policy. What matters most:</p>

      <ul className="agree-points">
        {termsSummary().map((point, i) => (
          <li key={point}>
            <span className="agree-point-icon" aria-hidden="true"><Icon name={POINT_ICONS[i] ?? "check"} size={15} /></span>
            <span>{point}</span>
          </li>
        ))}
      </ul>

      {read}

      <label className={`agree-check${ticked ? " is-on" : ""}`}>
        <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} disabled={waiting} />
        <span className="agree-box" aria-hidden="true">{ticked && <Icon name="check" size={13} strokeWidth={3} />}</span>
        <span className="agree-check-words">
          I&apos;m {LEGAL.minAge} or older, and I agree to the Terms and the Privacy Policy.
        </span>
      </label>

      {error && <p className="auth-error agree-error" role="alert">{error}</p>}

      <button type="button" className="auth-primary agree-go" onClick={() => onAgree(about)} disabled={waiting || !ticked || (askAbout && !about)}>
        {state === "ask" ? "Agree and continue" : "Saving…"}
      </button>
      <p className="agree-fine">Version of {LEGAL.effective}. Both stay in Settings, under Terms &amp; privacy.</p>
    </AuthShell>
  );
}
