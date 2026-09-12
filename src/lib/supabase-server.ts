import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/* The browser keeps its session in cookies; the phone app keeps it as a
   token and sends `Authorization: Bearer …`. Given the request, a bearer
   makes a client scoped to that user: row security sees the token on
   every query, and getUser() checks it with the auth server (the cookie
   client does the same from its cookie). Routes that pass the request
   serve both; routes that don't keep the cookie session only. */
export async function createClient(request?: Request) {
  const bearer = request?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      }
    );
    const getUser = client.auth.getUser.bind(client.auth);
    client.auth.getUser = (jwt?: string) => getUser(jwt ?? bearer);
    return client;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method is called from a Server Component
            // where cookies can't be set. This can be ignored if
            // middleware/proxy refreshes the session.
          }
        },
      },
    }
  );
}
