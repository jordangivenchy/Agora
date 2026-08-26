export type DebateStatus = "created" | "live" | "ended" | "cancelled";
export type ParticipantRole = "debater" | "spectator";
export type Stance = "PRO" | "CON";
export type DebateFormat = "open" | "oxford" | "1v1" | "panel";
export type QueueStatus = "waiting" | "matched" | "expired" | "cancelled";

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface DebateRoom {
  id: string;
  motion: string;
  host_id: string;
  topic_key: string;
  secondary_topics: string[] | null;
  format: DebateFormat;
  language: string;
  status: DebateStatus;
  is_private: boolean;
  invite_code: string | null;
  fact_check_intensity: string;
  // Live Moderator (20260817): Agora proactively adds facts and moderates.
  // Optional so the type tolerates a DB where the migration hasn't run yet.
  agora_moderator?: boolean | null;
  time_limit_seconds: number | null;
  allow_audience_questions: boolean;
  recording_consent: boolean;
  max_audience_size: number | null;
  scheduled_start: string | null;
  started_at: string | null;
  ended_at: string | null;
  // Why the room ended: 'inactive' | 'participant_left' | null (host ended).
  close_reason: string | null;
  // Host disconnect grace (20260855_room_lifecycle): stamped when a live
  // host drops; the room-lifecycle cron ends the room ~90s later unless
  // the host returns. Optional so the type tolerates a pre-migration DB.
  host_left_at?: string | null;
  viewer_count: number;
  created_at: string;
  // Team sizes (new)
  pro_size: number;
  con_size: number;
  // Private-room spectator rule (new): when is_private is true, this decides
  // whether the room appears in public listings (as spectator-only) or is
  // completely hidden and requires an invite code.
  allow_spectators: boolean;
  // Private-room access mode (20260865): who can enter without the invite
  // code. Optional so the type tolerates a pre-migration DB.
  access_mode?: "code" | "followers" | "friends" | null;
  // Host-picked card art (falls back to the host's profile picture).
  thumbnail_url?: string | null;
  // Set while an HLS broadcast is running (audience overflow stream).
  hls_url?: string | null;
  // Persisted VOD playlist + egress window (20260851_debate_recordings):
  // survives the stream so the ended room can be replayed.
  recording_url?: string | null;
  recording_started_at?: string | null;
  recording_ended_at?: string | null;
  discussion_post_id?: string | null;
  // Joined fields
  host?: User;
  participants?: DebateParticipant[];
}

export interface DebateParticipant {
  id: string;
  room_id: string;
  user_id: string;
  role: ParticipantRole;
  stance: Stance | null;
  joined_at: string;
  left_at: string | null;
  // When the user raised their hand (null = lowered). Ordering the audience
  // queue oldest-first makes it fair; re-raising gets a fresh timestamp.
  hand_raised_at: string | null;
  // Activity heartbeat (debaters): written every ~15s while connected,
  // last_spoke_at while LiveKit VAD reports speech. Drives the
  // server-authoritative inactivity closure.
  last_seen_at: string | null;
  last_spoke_at: string | null;
  mic_muted: boolean;
  // Joined
  user?: User;
}

export interface DebateVote {
  id: string;
  room_id: string;
  voter_id: string;
  stance: Stance;
  created_at: string;
}

export interface QueueEntry {
  id: string;
  user_id: string;
  room_id: string;
  stance: Stance;
  status: QueueStatus;
  entered_at: string;
  user?: User;
}

export const TOPICS = [
  { key: "politics-law", label: "Politics & Law", emoji: "⚖️", color: "#4a9eff" },
  { key: "sports", label: "Sports", emoji: "🏆", color: "#fd9644" },
  { key: "culture", label: "Culture", emoji: "🎭", color: "#e056b8" },
  { key: "economics", label: "Economics", emoji: "💰", color: "#00b894" },
  { key: "science-tech", label: "Science & Tech", emoji: "🔬", color: "#00cec9" },
  { key: "foreign-policy", label: "Foreign Policy", emoji: "🌍", color: "#1976D2" },
  { key: "philosophy", label: "Philosophy", emoji: "📚", color: "#fdcb6e" },
] as const;

export const FORMATS: { value: DebateFormat; label: string }[] = [
  { value: "open", label: "Open Discussion" },
  { value: "oxford", label: "Oxford Style" },
  { value: "1v1", label: "1v1" },
  { value: "panel", label: "Panel 2v2" },
];

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "zh", label: "Mandarin" },
  { value: "ar", label: "Arabic" },
  { value: "pt", label: "Portuguese" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
];
