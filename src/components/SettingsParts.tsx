/* The settings page's two building blocks, shared by its sections
   (SettingsPage) and the Data & Coach card. Every size and gap is in the
   `.stg-*` rules (globals.css), so a card can't drift from the next. */

import type { ReactNode } from "react";

/** A card: a title, a line or a paragraph under it, then rows or a body
    (`.stg-row`s, or one `.stg-body`). */
export function SectionCard({ title, sub, text, danger, children }: {
  title: string;
  /** One line under the title. */
  sub?: ReactNode;
  /** A longer explanation, set a size larger than the line. */
  text?: ReactNode;
  /** The title in the red kept for what destroys. */
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="stg-card">
      <div className="stg-head">
        <h2 className={`stg-title${danger ? " is-danger" : ""}`}>{title}</h2>
        {sub && <p className="stg-sub">{sub}</p>}
        {text && <p className="stg-text">{text}</p>}
      </div>
      {children}
    </div>
  );
}

/** A row that is one switch: pressing anywhere on the line flips it. */
export function SwitchRow({ on, disabled, onChange, label, sub }: {
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      className="stg-row"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="stg-row-text">
        <span className="stg-row-label">{label}</span>
        {sub && <span className="stg-row-sub">{sub}</span>}
      </span>
      <span className="stg-switch" aria-hidden="true" />
    </button>
  );
}
