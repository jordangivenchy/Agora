"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";

interface Props {
  roomId: string;
  currentUser: User | null;
}

export default function SentimentBar({ roomId, currentUser }: Props) {
  const supabase = createClient();
  const [proCount, setProCount] = useState(0);
  const [conCount, setConCount] = useState(0);
  const [mySide, setMySide] = useState<"PRO" | "CON" | "NEUTRAL" | null>(null);

  const fetchSides = useCallback(async () => {
    const { data } = await supabase
      .from("debate_votes")
      .select("stance, voter_id")
      .eq("room_id", roomId);

    if (data) {
      setProCount(data.filter((v) => v.stance === "PRO").length);
      setConCount(data.filter((v) => v.stance === "CON").length);

      if (currentUser) {
        const mine = data.find((v) => v.voter_id === currentUser.id);
        if (mine) setMySide(mine.stance as "PRO" | "CON" | "NEUTRAL");
      }
    }
  }, [roomId, currentUser]);

  useEffect(() => {
    fetchSides();

    const channel = supabase
      .channel(`sides-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "debate_votes",
          filter: `room_id=eq.${roomId}`,
        },
        () => { fetchSides(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchSides, roomId]);

  async function vote(side: "PRO" | "CON") {
    if (!currentUser) return;

    if (mySide) {
      if (mySide === side) return; // already voted this side
      await supabase
        .from("debate_votes")
        .update({ stance: side })
        .eq("room_id", roomId)
        .eq("voter_id", currentUser.id);
    } else {
      await supabase.from("debate_votes").insert({
        room_id: roomId,
        voter_id: currentUser.id,
        stance: side,
      });
    }

    setMySide(side);
  }

  const total = proCount + conCount;
  const proPct = total > 0 ? Math.round((proCount / total) * 100) : 50;
  const conPct = total > 0 ? 100 - proPct : 50;

  return (
    <div className="sentiment-bar-wrap">
      {currentUser && (
        <button
          className={`sent-vote-btn sent-pro${mySide === "PRO" ? " active" : ""}`}
          onClick={() => vote("PRO")}
          title="Vote PRO"
          style={mySide === "PRO" ? { boxShadow: "0 0 0 2px #23a559" } : undefined}
        >
          +
        </button>
      )}
      <span className="sent-label sent-pro-label">PRO {proPct}%</span>
      <div className="sent-track">
        <div className="sent-fill-pro" style={{ width: `${proPct}%` }} />
        <div className="sent-fill-con" style={{ width: `${conPct}%` }} />
      </div>
      <span className="sent-label sent-con-label">{conPct}% CON</span>
      {currentUser && (
        <button
          className={`sent-vote-btn sent-con${mySide === "CON" ? " active" : ""}`}
          onClick={() => vote("CON")}
          title="Vote CON"
          style={mySide === "CON" ? { boxShadow: "0 0 0 2px #ed4245" } : undefined}
        >
          +
        </button>
      )}
    </div>
  );
}
