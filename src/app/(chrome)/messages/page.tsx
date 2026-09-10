/* Full-page direct messages. The floating dock suppresses itself on
   this route; MessagesPage owns the surface. The inbox is fetched here
   on the server (lib/messagesData.ts), as the viewer, so it arrives
   complete behind the route's loading screen. */

import { createClient } from "@/lib/supabase-server";
import { fetchMessagesInitial } from "@/lib/messagesData";
import MessagesPage from "@/components/messages/MessagesPage";

export default async function Messages() {
  const supabase = await createClient();
  const initial = await fetchMessagesInitial(supabase);
  return (
    <>
      <MessagesPage initial={initial} />
    </>
  );
}
