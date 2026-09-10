/* The messages page's first view — the viewer, their conversations and
   their groups — fetched by the routes on the server so the inbox
   arrives complete behind its loading screen. MessagesPage starts from
   it and keeps refreshing in the browser as before. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Thread } from "@/components/messages/DmThread";
import type { GroupRow } from "@/components/messages/groups";

export type MessagesInitial = {
  me: string | null;
  threads: Thread[];
  groups: GroupRow[];
};

export async function fetchMessagesInitial(supabase: SupabaseClient): Promise<MessagesInitial> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user?.id ?? null;
  if (!me) return { me: null, threads: [], groups: [] };
  const [t, g] = await Promise.all([supabase.rpc("get_dm_threads"), supabase.rpc("get_group_threads")]);
  return { me, threads: (t.data ?? []) as Thread[], groups: (g.data ?? []) as GroupRow[] };
}
