"use client";

/* Deep link straight into a conversation: /messages/<username>. */

import { use } from "react";
import SiteChrome from "@/components/SiteChrome";
import MessagesPage from "@/components/messages/MessagesPage";

export default function MessagesWithUser({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);
  return (
    <SiteChrome>
      <MessagesPage initialUsername={username} />
    </SiteChrome>
  );
}
