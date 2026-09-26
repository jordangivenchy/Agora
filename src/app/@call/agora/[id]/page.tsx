"use client";

/* The room, in the root layout's call slot. Navigating in the app keeps
   a slot's page mounted even when the address no longer matches it
   (Next's parallel routes), so leaving the room for another page keeps
   the call — CallSlot shows it minimized until you come back. */
import CallSlot from "@/components/agora/CallSlot";

export default function CallRoute({ params }: { params: Promise<{ id: string }> }) {
  return <CallSlot params={params} />;
}
