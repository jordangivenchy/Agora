"use client";

/* Deep link straight into a group chat: /messages/g/<chat id>. */

import { use } from "react";
import SiteChrome from "@/components/SiteChrome";
import MessagesPage from "@/components/messages/MessagesPage";

export default function MessagesGroup({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SiteChrome>
      <MessagesPage initialGroupId={id} />
    </SiteChrome>
  );
}
