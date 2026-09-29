"use client";

import VerifiedMark from "@/components/VerifiedMark";
import { actorLabel, type NotifRow } from "@/lib/notifications";

/* A notification's sentence, with the verified mark after the person it
   starts with ("Jordan ✓ went live: …"). Sentences that don't open with
   a person pass through as they are. */
export default function ActorText({ n, text }: { n: NotifRow; text: string }) {
  const who = n.actor_id ? actorLabel(n, "") : "";
  if (!who || !text.startsWith(who)) return <>{text}</>;
  return <>{who}<VerifiedMark id={n.actor_id} username={n.actor_username} />{text.slice(who.length)}</>;
}
