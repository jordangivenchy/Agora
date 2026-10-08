"use client";

/* /totals — the desk the anonymous totals leave from (Terms, section 6).

   Four cards: who can be counted and why the rest are not, how far the
   reading of public rooms has got, the table for a stretch of months,
   and every download so far. The table arrives with small groups
   already out (lib/totals/table.ts runs on the server); this page never
   holds a count of fewer than 25 people. A download is built again on
   the server and written in the log before the file is handed over.

   The route gates it (totals_staff); every request it makes is gated
   again on the server. Built from the settings cards (.stg-*). */

import { useCallback, useState } from "react";
import { SectionCard } from "@/components/SettingsParts";
import type { DeskData, DeskLoad } from "@/lib/totals/desk";
import type { ReadRunSummary } from "@/lib/totals/readRun";
import { ROUND_TO, lineWords, methodNote, monthsBefore, periodWords, type Period, type TotalLine } from "@/lib/totals/table";

const MONTHS_OFFERED = 24;
const ROWS_SHOWN = 300;

type Msg = { kind: "ok" | "err"; text: string } | null;

const EXPORT_ERRORS: Record<string, string> = {
  nothing_to_export: "There is nothing to download for these months yet.",
  say_who_for: "Say who the file is for first.",
  bad_months: "Those months can't be used. Choose them again.",
  not_logged: "The download couldn't be written in the log, so it was stopped. Try again.",
  not_configured: "This only works on the live site.",
};

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
// in one fixed zone, so the server and the browser write the same day
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthName = (ym: string) => periodWords({ from: ym, to: ym });
const hours = (minutes: number) => (minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`);

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Row({ label, sub, value }: { label: string; sub?: string; value: string | number }) {
  return (
    <div className="stg-row">
      <span className="stg-row-text">
        <span className="stg-row-label">{label}</span>
        {sub && <span className="stg-row-sub">{sub}</span>}
      </span>
      <span className="stg-value">{typeof value === "number" ? value.toLocaleString("en-US") : value}</span>
    </div>
  );
}

/** A line of the table. The whole of a subject is set a little brighter than its parts. */
function Line({ line }: { line: TotalLine }) {
  const w = lineWords(line);
  const whole = line.part === "any" && line.split === "all";
  return (
    <tr className={whole ? "is-whole" : undefined}>
      <td>{w.measure}</td>
      <td className="is-subject">
        {w.subject}
        {line.rooms !== null && (
          <span className="tot-aside">
            {count(line.rooms, "room", "rooms")}
            {line.minutes ? `, ${hours(line.minutes)}` : ""}
          </span>
        )}
      </td>
      <td>{w.part}</td>
      <td>{line.split === "all" ? w.group : `${w.split}: ${w.group}`}</td>
      <td className="is-num">{line.people.toLocaleString("en-US")}</td>
      <td className="is-num">{line.share === null ? "" : `${line.share}%`}</td>
    </tr>
  );
}

export default function TotalsDesk({ initial, blanks }: {
  initial: DeskLoad;
  /** What the terms still lack before they are in force (legalBlanks): while there is any, nobody is counted. */
  blanks: string[];
}) {
  const [data, setData] = useState<DeskData | null>(initial.ready ? initial.data : null);
  const [period, setPeriod] = useState<Period | null>(initial.ready ? initial.data.period : null);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState<Msg>(null);
  const [madeFor, setMadeFor] = useState("");
  const [note, setNote] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<Msg>(null);

  // The newest month on offer is the one the server said it is, so the list is the same wherever it is drawn.
  const months = initial.ready ? monthsBefore(initial.data.period.to, MONTHS_OFFERED) : [];

  const show = useCallback(async (p: Period) => {
    setPeriod(p);
    setLoading(true);
    setLoadMsg(null);
    setExportMsg(null);
    try {
      const res = await fetch(`/api/totals?from=${p.from}&to=${p.to}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as DeskData);
    } catch {
      setLoadMsg("That didn't load. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function readNow() {
    if (reading || !period) return;
    setReading(true);
    setReadMsg(null);
    try {
      const res = await fetch("/api/totals/read", { method: "POST" });
      const body = (await res.json().catch(() => null)) as (ReadRunSummary & { error?: string }) | null;
      if (!res.ok || !body) {
        setReadMsg({ kind: "err", text: body?.error === "no_model" ? "No AI model is set up to do the reading." : "The reading didn't run. Try again in a minute." });
      } else {
        const parts = [
          body.rooms ? `Read ${count(body.rooms, "room", "rooms")}: ${count(body.readings, "speaker", "speakers")}.` : "Nothing new was read.",
          body.failed ? `${count(body.failed, "room", "rooms")} couldn't be read and will be tried again.` : "",
          body.tidied ? `${count(body.tidied, "old reading", "old readings")} removed.` : "",
        ];
        setReadMsg({ kind: body.failed && !body.rooms ? "err" : "ok", text: parts.filter(Boolean).join(" ") });
        await show(period);
      }
    } catch {
      setReadMsg({ kind: "err", text: "The reading didn't run. Try again in a minute." });
    } finally {
      setReading(false);
    }
  }

  async function download() {
    if (exporting || !period) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await fetch("/api/totals/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: period.from, to: period.to, madeFor, note }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setExportMsg({ kind: "err", text: EXPORT_ERRORS[body?.error ?? ""] ?? "That didn't download. Try again." });
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `agorasphere-totals-${period.from}.csv`;
      save(await res.blob(), name);
      setExportMsg({ kind: "ok", text: "Downloaded, and written in the log below." });
      setNote("");
      await show(period);
    } catch {
      setExportMsg({ kind: "err", text: "That didn't download. Try again." });
    } finally {
      setExporting(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="replay-beside-sidebar settings-shell" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="settings-inner tot-inner">
        <div className="tot-head">
          <h1>Totals</h1>
          <p>Counts of people from public rooms, to share or to sell. Never anything about one person.</p>
        </div>
        {children}
      </div>
    </div>
  );

  if (!data || !period) {
    return shell(
      <div className="stg-main">
        <SectionCard
          title="Not available here"
          text={
            !initial.ready && initial.why === "not_configured"
              ? "The desk reads its counts with a key that only the live site holds, so it opens on agorasphere.net and not on a copy of the site."
              : "The desk couldn't load its counts. Reload the page; if it keeps happening, the database change that adds the totals may not have been applied."
          }
        />
      </div>
    );
  }

  const { overview: o, table, log } = data;
  const draft = blanks.length > 0;
  const canDownload = table.lines.length > 0 && madeFor.trim().length >= 2 && !exporting && !loading;

  return shell(
    <div className="stg-main">
      <SectionCard
        title="Who is counted"
        text={
          draft
            ? `The terms are still a draft, so nobody has been asked to agree and nobody is counted. They come into force once these are filled in: ${blanks.join("; ")}.`
            : `Someone is counted once they have agreed to the terms, with their age and where they live, and for as long as they leave the switch on in Data & Coach. Only rooms that began after they agreed count for them.`
        }
      >
        <Row label="Can be counted" sub={`of ${count(o.accounts, "account", "accounts")}`} value={o.countable} />
        <Row label="Haven't agreed to the terms" value={o.not_agreed} />
        <Row label="Have left their words out" sub="The switch in Data & Coach" value={o.switched_off} />
        <Row label="No age or place on record" value={o.not_told} />
        <Row label="Live in Europe" sub="The EEA, the United Kingdom and Switzerland are left out" value={o.left_out} />
        {o.countable < table.floor && (
          <p className="stg-row is-note">
            A line needs {table.floor} people before it can be shown, so the table below stays empty until at least that many can be counted.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="What has been read"
        text="When a public room's transcript is done, an AI model sorts what each countable speaker argued into a side and up to three kinds of argument. None of their words are kept. It runs by itself every night."
      >
        <Row label="Public rooms held" value={o.rooms} />
        <Row label="With a transcript" value={o.transcribed} />
        <Row label="Read" sub={o.readings ? `${count(o.readings, "speaker", "speakers")} sorted` : undefined} value={o.read} />
        <div className="stg-row">
          <span className="stg-row-text">
            <span className="stg-row-label">Waiting to be read</span>
            {readMsg && <span className={`stg-row-sub tot-msg is-${readMsg.kind}`} role="status">{readMsg.text}</span>}
          </span>
          <span className="stg-value">{o.waiting.toLocaleString("en-US")}</span>
          <button type="button" className="stg-btn" onClick={() => void readNow()} disabled={reading || o.waiting === 0}>
            {reading ? "Reading…" : "Read now"}
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="The table"
        text={`Every line is a count of different people, rounded to the nearest ${ROUND_TO}. A group of fewer than ${table.floor} is left out, along with enough of its neighbours that it can't be worked out by subtraction.`}
      >
        <div className="stg-body">
          <div className="tot-fields">
            <label className="tot-field">
              <span>From</span>
              <select
                className="stg-input stg-select"
                value={period.from}
                disabled={loading}
                onChange={(e) => void show({ from: e.target.value, to: e.target.value > period.to ? e.target.value : period.to })}
              >
                {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </label>
            <label className="tot-field">
              <span>To</span>
              <select
                className="stg-input stg-select"
                value={period.to}
                disabled={loading}
                onChange={(e) => void show({ from: e.target.value < period.from ? e.target.value : period.from, to: e.target.value })}
              >
                {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </label>
          </div>
          <p className="stg-usage" aria-live="polite">
            <span>
              {loading ? "Counting…" : <><strong>{count(table.lines.length, "line", "lines")}</strong> for {periodWords(period)}</>}
            </span>
            {!loading && table.blanked > 0 && <span>{count(table.blanked, "group", "groups")} left out for being too small</span>}
          </p>
          {loadMsg && <p className="stg-msg is-err" role="alert">{loadMsg}</p>}
        </div>

        {table.lines.length === 0 ? (
          <p className="stg-row is-empty">
            {table.blanked > 0
              ? `Nothing can be shown for ${periodWords(period)}: no group reaches ${table.floor} people yet.`
              : `Nothing was counted for ${periodWords(period)}.`}
          </p>
        ) : (
          <div className="tot-scroll">
            <table className="tot-table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>About</th>
                  <th>Part</th>
                  <th>Group</th>
                  <th className="is-num">People</th>
                  <th className="is-num">Share</th>
                </tr>
              </thead>
              <tbody>
                {table.lines.slice(0, ROWS_SHOWN).map((l) => (
                  <Line key={`${l.measure}|${l.subject}|${l.part}|${l.split}|${l.group}`} line={l} />
                ))}
              </tbody>
            </table>
            {table.lines.length > ROWS_SHOWN && (
              <p className="stg-row is-note">And {count(table.lines.length - ROWS_SHOWN, "more line", "more lines")} in the file.</p>
            )}
          </div>
        )}

        <div className="stg-body tot-download">
          <div className="tot-fields">
            <label className="tot-field">
              <span>Who is the file for?</span>
              <input
                className="stg-input"
                value={madeFor}
                maxLength={120}
                placeholder="A company's name, or “ourselves”"
                onChange={(e) => setMadeFor(e.target.value)}
              />
            </label>
            <label className="tot-field">
              <span>A note for the log (optional)</span>
              <input className="stg-input" value={note} maxLength={500} placeholder="What it is for" onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="stg-actions">
            <button type="button" className="stg-btn stg-btn--primary" onClick={() => void download()} disabled={!canDownload}>
              {exporting ? "Preparing…" : "Download the table"}
            </button>
            <button
              type="button"
              className="stg-btn stg-btn--quiet"
              onClick={() => save(new Blob([methodNote(period, table.floor)], { type: "text/plain;charset=utf-8" }), "agorasphere-totals-how-they-are-made.txt")}
            >
              Download the note that goes with it
            </button>
            {exportMsg && <p className={`stg-msg is-${exportMsg.kind}`} role="status">{exportMsg.text}</p>}
          </div>
          <p className="stg-note">
            The file is a spreadsheet of the lines above. The note says how the numbers were made and that they must not be used to identify anyone: send it with the file.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Downloads so far" sub="Every file that has left, newest first.">
        {log.length === 0 ? (
          <p className="stg-row is-empty">No file has been downloaded yet.</p>
        ) : (
          log.map((x) => {
            const months = periodWords({ from: x.period_from.slice(0, 7), to: x.period_to.slice(0, 7) });
            return (
              <div className="stg-row" key={x.id}>
                <span className="stg-row-text">
                  <span className="stg-row-label">{x.made_for}</span>
                  <span className="stg-row-sub">
                    {months} · {count(x.lines, "line", "lines")}
                    {x.by ? ` · by @${x.by}` : ""}
                    {x.note ? ` · ${x.note}` : ""}
                  </span>
                </span>
                <span className="stg-value tot-when">{day(x.made_at)}</span>
              </div>
            );
          })
        )}
      </SectionCard>
    </div>
  );
}
