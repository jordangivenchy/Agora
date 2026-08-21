/**
 * Live Moderator support: the pure pieces of Agora's proactive voice —
 * building the speaker-labeled transcript window the model reads, and
 * parsing/validating its decision. The transcript route owns the I/O.
 *
 * The model may decide to do NOTHING — that's the most common and most
 * correct outcome. A moderator who talks constantly isn't moderating.
 */

export interface ModeratorAction {
  kind: "context" | "insight";
  text: string;
  confidence: number;
}

export interface WindowUtterance {
  username: string;
  content: string;
}

/** Format the recent room transcript for the model, oldest first, one line
    per utterance, speaker-labeled. */
export function buildTranscriptWindow(utterances: WindowUtterance[]): string {
  return utterances
    .map((u) => `${u.username}: ${u.content}`)
    .join("\n");
}

const MAX_TEXT = 600;

/** Parse the moderator model's JSON reply. Returns null for "stay quiet" —
    whether the model chose none, returned junk, or wasn't confident enough
    (the caller applies the confidence threshold; this validates shape). */
export function parseModeratorAction(modelJson: string): ModeratorAction | null {
  let raw: { action?: unknown; text?: unknown; confidence?: unknown };
  try {
    raw = JSON.parse(modelJson.replace(/^```json?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const action = raw.action;
  if (action !== "context" && action !== "insight") return null; // includes "none"

  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return null;

  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : 0;

  return { kind: action, text, confidence };
}
