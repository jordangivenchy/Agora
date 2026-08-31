"use client";

/* Shareable profile route: /users/[username], also spelled /@username.
   All the substance lives in ProfileView (also used as the in-room
   profile drawer). */

import { use } from "react";
import ProfileView from "@/components/ProfileView";
import SiteChrome from "@/components/SiteChrome";

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);
  return (
    <SiteChrome>
      <ProfileView username={username} />
    </SiteChrome>
  );
}
