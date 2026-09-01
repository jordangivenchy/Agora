"use client";

/* Full-page direct messages. The floating dock suppresses itself on
   this route; MessagesPage owns the surface. */

import SiteChrome from "@/components/SiteChrome";
import MessagesPage from "@/components/messages/MessagesPage";

export default function Messages() {
  return (
    <SiteChrome>
      <MessagesPage />
    </SiteChrome>
  );
}
