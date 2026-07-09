"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Stance } from "@/types/database";
import type { User } from "@supabase/supabase-js";

interface Props {
  roomId: string;
  currentUser: User | null;
}

export default function VotingPanel({ roomId, currentUser }: Props) {
  const supabase = createClient();
  const [proCount, setProCount] = useState(0);
  const [conCount, setConCount] = useState(0);
  const [myVote, setMyVote] = useState<Stance | null>(null);
  const [voting, setVoting] = useState(false);

  const fetchVotes = useCallback(async () => {
    const { data } = await supabase
      .from("debate_votes")
      .select("stance, voter_id")
      .eq("room_id", roomId);

    if (data) {
      setProCount(data.filter((v) => v.stance === "PRO").length);
      setConCount(data.filter((v) => v.stance === "CON").length);

      if (currentUser) {
        const mine = data.find((v) => v.voter_id === currentUser.id);
        if (mine) setMyVote(mine.stance as Stance);
      }
    }
  }, [roomId, currentUser]);

  useEffect(() => {
    fetchVotes();

    const channel = supabase
      .channel(`votes-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "debate_votes", filter: `room_id=eq.${roomId}` }, () => {
        fetchVotes();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchVotes, roomId]);

  async function vote(stance: Stance) {
    if (!currentUser || myVote || voting) return;
    setVoting(true);

    const { error } = await supabase.from("debate_votes").insert({
      room_id: roomId,
      voter_id: currentUser.id,
      stance,
    });

    if (!error) {
      setMyVote(stance);
    }
    setVoting(false);
  }

  const totalVotes = proCount + conCount;
  const proPct = totalVotes > 0 ? Math.round((proCount / totalVotes) * 100) : 50;
  const conPct = 100 - proPct;

  return (
    <div className="p-4 border-b border-border">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Audience Vote</h3>

      {/* Vote bar */}
      <div className="mb-3">
        <div className="flex justify-between text-[11px] mb-1">
          <span className="text-pro font-medium">PRO {proPct}%</span>
          <span className="text-text-muted">{totalVotes} votes</span>
          <span className="text-con font-medium">CON {conPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden flex">
          <div
            className="bg-pro transition-all duration-700 ease-out"
            style={{ width: `${proPct}%` }}
          />
          <div
            className="bg-con transition-all duration-700 ease-out"
            style={{ width: `${conPct}%` }}
          />
        </div>
      </div>

      {/* Vote buttons */}
      {currentUser && !myVote ? (
        <div className="flex gap-2">
          <button
            onClick={() => vote("PRO")}
            disabled={voting}
            className="flex-1 bg-pro/10 hover:bg-pro/20 border border-pro/30 text-pro text-sm font-medium py-2 rounded-lg transition-all disabled:opacity-50"
          >
            👍 PRO
          </button>
          <button
            onClick={() => vote("CON")}
            disabled={voting}
            className="flex-1 bg-con/10 hover:bg-con/20 border border-con/30 text-con text-sm font-medium py-2 rounded-lg transition-all disabled:opacity-50"
          >
            👎 CON
          </button>
        </div>
      ) : myVote ? (
        <div className={`text-center text-sm py-2 rounded-lg ${myVote === "PRO" ? "bg-pro/10 text-pro" : "bg-con/10 text-con"}`}>
          You voted {myVote}
        </div>
      ) : (
        <p className="text-xs text-text-muted text-center py-2">
          <a href="/login" className="font-bold hover:text-text-primary">Sign in</a> to vote
        </p>
      )}
    </div>
  );
}
