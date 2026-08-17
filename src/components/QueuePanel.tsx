"use client";

import { createClient } from "@/lib/supabase-browser";
import type { QueueEntry } from "@/types/database";
import type { User } from "@supabase/supabase-js";
import { useUserMenu } from "./userMenuContext";
import { displayName } from "@/lib/names";
import UserAvatar from "./UserAvatar";

interface Props {
  queue: QueueEntry[];
  roomId: string;
  currentUser: User | null;
}

export default function QueuePanel({ queue, roomId, currentUser }: Props) {
  const supabase = createClient();
  const { openUserMenu } = useUserMenu();

  const nameSpan = (entry: QueueEntry) => {
    const user = entry.user as { username?: string; display_name?: string | null } | undefined;
    const username = user?.username;
    if (!username) return <span>User</span>;
    const name = displayName(user);
    const avatarUrl = (entry.user as { avatar_url?: string | null })?.avatar_url;
    return (
      <span
        onClick={(e) => openUserMenu({ x: e.clientX, y: e.clientY }, { userId: entry.user_id, username })}
        className="cursor-pointer inline-flex items-center gap-1.5"
        style={{ textDecoration: "underline dotted rgba(255,255,255,0.25)", textUnderlineOffset: 2 }}
      >
        <UserAvatar size={16} username={name} avatarUrl={avatarUrl} seed={entry.user_id} />
        {name}
      </span>
    );
  };

  const proQueue = queue.filter((q) => q.stance === "PRO");
  const conQueue = queue.filter((q) => q.stance === "CON");
  const myQueueEntry = currentUser ? queue.find((q) => q.user_id === currentUser.id) : null;

  async function leaveQueue() {
    if (!myQueueEntry) return;
    await supabase.from("debate_queue").delete().eq("id", myQueueEntry.id);
  }

  if (queue.length === 0 && !myQueueEntry) return null;

  return (
    <div className="p-4 border-b border-border">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Queue</h3>

      {myQueueEntry && (
        <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-accent font-medium">You&apos;re in queue</p>
              <p className="text-xs text-text-muted">
                Position: #{queue.filter((q) => q.stance === myQueueEntry.stance).findIndex((q) => q.id === myQueueEntry.id) + 1} for {myQueueEntry.stance}
              </p>
            </div>
            <button
              onClick={leaveQueue}
              className="text-xs text-text-muted hover:text-con transition-colors"
            >
              Leave
            </button>
          </div>
        </div>
      )}

      {proQueue.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-pro font-medium mb-1">PRO Queue ({proQueue.length})</p>
          <div className="space-y-1">
            {proQueue.map((entry, i) => (
              <div key={entry.id} className="flex items-center gap-2 text-xs text-text-muted">
                <span className="text-text-muted">#{i + 1}</span>
                {nameSpan(entry)}
              </div>
            ))}
          </div>
        </div>
      )}

      {conQueue.length > 0 && (
        <div>
          <p className="text-xs text-con font-medium mb-1">CON Queue ({conQueue.length})</p>
          <div className="space-y-1">
            {conQueue.map((entry, i) => (
              <div key={entry.id} className="flex items-center gap-2 text-xs text-text-muted">
                <span className="text-text-muted">#{i + 1}</span>
                {nameSpan(entry)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
