/* The reader's round: a few public rooms whose speakers may be counted
   and whose transcript hasn't been read yet (or has changed since), each
   read once and written down as categories (room_readings).

   Called by the nightly maintenance job and by the desk's "Read now".
   Until someone who may be counted has spoken in a public room there is
   nothing to do and the model is never called.

   Who may be counted is the database's decision (totals_room_speakers):
   this only ever sees the ids it hands over, and only their lines go to
   the model. A room's readings are replaced whole each time it is read,
   so a speaker who has since switched the totals off drops out. */

import type { createAdminClient } from "@/lib/supabase-admin";
import { TAXONOMY } from "./kinds";
import { gatherSpeakers, readLines, readRoom, type Generate, type Reading } from "./read";

type Admin = ReturnType<typeof createAdminClient>;

export interface ReadRunSummary {
  /** Readings removed because they may no longer be counted. */
  tidied: number;
  /** Rooms read this round. */
  rooms: number;
  /** Speakers a reading was kept for. */
  readings: number;
  /** Rooms that couldn't be read this time; they are tried again next round. */
  failed: number;
}

interface RoomToRead {
  room_id: string;
  motion: string;
  transcript_at: string;
}

export async function runReadings(admin: Admin, opts: { generate: Generate; limit?: number; budgetMs?: number }): Promise<ReadRunSummary> {
  const began = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const summary: ReadRunSummary = { tidied: 0, rooms: 0, readings: 0, failed: 0 };

  const tidy = await admin.rpc("totals_tidy");
  if (tidy.error) throw new Error(`totals_tidy: ${tidy.error.message}`);
  summary.tidied = Number(tidy.data) || 0;

  const todo = await admin.rpc("totals_rooms_to_read", { p_taxonomy: TAXONOMY, p_limit: opts.limit ?? 5 });
  if (todo.error) throw new Error(`totals_rooms_to_read: ${todo.error.message}`);

  for (const room of (todo.data ?? []) as RoomToRead[]) {
    if (Date.now() - began > budget) break;
    try {
      const [who, transcript] = await Promise.all([
        admin.rpc("totals_room_speakers", { p_room: room.room_id }),
        admin.from("replay_transcripts").select("lines").eq("room_id", room.room_id).maybeSingle(),
      ]);
      if (who.error) throw new Error(who.error.message);
      if (transcript.error) throw new Error(transcript.error.message);
      const countable = new Set(((who.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
      const speakers = gatherSpeakers(readLines(transcript.data?.lines), countable);

      let readings: Reading[] = [];
      let model: string | null = null;
      if (speakers.length > 0) {
        const res = await readRoom({ motion: room.motion, speakers, generate: opts.generate });
        // a reply that made no sense: leave the room as it was and come back to it
        if (res.readings.length === 0) throw new Error("the model's reply could not be read");
        readings = res.readings;
        model = res.model;
      }

      const now = new Date().toISOString();
      const kept = readings.map((r) => r.userId);
      let stale = admin.from("room_readings").delete().eq("room_id", room.room_id);
      if (kept.length) stale = stale.not("user_id", "in", `(${kept.join(",")})`);
      const gone = await stale;
      if (gone.error) throw new Error(gone.error.message);

      if (readings.length) {
        const put = await admin.from("room_readings").upsert(
          readings.map((r) => ({
            room_id: room.room_id,
            user_id: r.userId,
            stance: r.stance,
            kinds: r.kinds,
            confidence: r.confidence,
            lines: r.lines,
            seconds_spoken: r.seconds,
            taxonomy: TAXONOMY,
            model,
            read_at: now,
          })),
          { onConflict: "room_id,user_id" }
        );
        if (put.error) throw new Error(put.error.message);
      }

      const done = await admin.from("room_reading_runs").upsert(
        { room_id: room.room_id, transcript_at: room.transcript_at, taxonomy: TAXONOMY, speakers: countable.size, read: readings.length, ran_at: now },
        { onConflict: "room_id" }
      );
      if (done.error) throw new Error(done.error.message);

      summary.rooms += 1;
      summary.readings += readings.length;
    } catch (e) {
      summary.failed += 1;
      console.error(`[totals] room ${room.room_id} was not read:`, e instanceof Error ? e.message : e);
    }
  }
  return summary;
}
