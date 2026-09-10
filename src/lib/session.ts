/* Who is signed in, from the session supabase-js already holds in the
   browser — no request. supabase.auth.getUser() asks the auth server
   every time it is called, and a page full of components each asking
   (the navbar, the bell, presence, the rail, the page itself) put eight
   round trips on every load. Components only need to know who is
   signed in to decide what to show; every query they then make carries
   the token, and Supabase verifies it there. Same shape as getUser()
   so call sites read the same. */

import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";

export async function sessionUser(
  supabase: SupabaseClient,
): Promise<{ data: { user: User | null }; error: AuthError | null }> {
  const { data, error } = await supabase.auth.getSession();
  return { data: { user: data.session?.user ?? null }, error };
}
