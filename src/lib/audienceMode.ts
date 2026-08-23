/* Cost scaling for big audiences: above a spectator threshold, NEW
   audience members watch the room over the HLS stream the default
   recording already produces (R2-delivered, free egress) instead of
   holding a LiveKit WebRTC seat. Stage roles always get WebRTC.

   Hysteresis note: the decision is evaluated fresh on every token
   request and is never cached, so only the ceiling matters — a viewer
   who already holds a WebRTC connection is never migrated (the client
   simply doesn't re-request), and a room dipping back under the
   threshold admits newcomers over WebRTC again automatically. There is
   deliberately no separate floor constant for that reason. */

export const DEFAULT_HLS_AUDIENCE_THRESHOLD = 15;

export interface AudienceModeInput {
  /** True when the requester is on stage (host / cohost / speaker /
      debater) — stage roles publish and must always have WebRTC. */
  isStage: boolean;
  /** Current count of off-stage participants connected to the LiveKit
      room (from listParticipants, stage identities excluded). */
  audienceCount: number;
  /** The room's live HLS playlist, or null while no egress is running. */
  hlsUrl: string | null | undefined;
  /** Spectator ceiling; at or above this, new audience rides HLS. */
  threshold: number;
}

export type AudienceModeDecision =
  | { mode: "webrtc" }
  | { mode: "hls"; url: string };

export function decideAudienceMode({
  isStage,
  audienceCount,
  hlsUrl,
  threshold,
}: AudienceModeInput): AudienceModeDecision {
  if (isStage) return { mode: "webrtc" };
  if (!hlsUrl) return { mode: "webrtc" }; // no stream to point at — let them in
  if (!Number.isFinite(threshold) || threshold < 0) threshold = DEFAULT_HLS_AUDIENCE_THRESHOLD;
  if (audienceCount >= threshold) return { mode: "hls", url: hlsUrl };
  return { mode: "webrtc" };
}

/** Parse the HLS_AUDIENCE_THRESHOLD env var (server-side only). */
export function audienceThresholdFromEnv(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_HLS_AUDIENCE_THRESHOLD; // Number("") is 0
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HLS_AUDIENCE_THRESHOLD;
}
