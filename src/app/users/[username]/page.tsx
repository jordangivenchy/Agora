/* Shareable profile route: /users/[username], also spelled /@username.
   All the substance lives in ProfileView (also used as the in-room
   profile drawer). The first view — header, viewer, the default tab's
   rooms — is fetched here on the server (lib/profileData.ts), as the
   viewer, so the page arrives complete behind the route's single
   loading screen instead of mounting and then fetching. */

import { createClient } from "@/lib/supabase-server";
import { fetchProfileInitial } from "@/lib/profileData";
import ProfileView from "@/components/ProfileView";
import SiteChrome from "@/components/SiteChrome";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();
  const initial = await fetchProfileInitial(supabase, username);
  return (
    <SiteChrome>
      {/* Keyed so a move to another profile mounts afresh with its own data. */}
      <ProfileView key={username} username={username} initial={initial} />
    </SiteChrome>
  );
}
