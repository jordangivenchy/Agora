/* Deep link straight into a conversation: /messages/<username>. The
   inbox comes with the page (lib/messagesData.ts); the conversation
   itself opens in the browser as before. */

import { createClient } from "@/lib/supabase-server";
import { fetchMessagesInitial } from "@/lib/messagesData";
import SiteChrome from "@/components/SiteChrome";
import MessagesPage from "@/components/messages/MessagesPage";

export default async function MessagesWithUser({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();
  const initial = await fetchMessagesInitial(supabase);
  return (
    <SiteChrome>
      <MessagesPage initialUsername={username} initial={initial} />
    </SiteChrome>
  );
}
