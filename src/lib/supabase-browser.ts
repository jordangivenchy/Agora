import { createBrowserClient } from "@supabase/ssr";

// `@supabase/ssr` stores the session in cookies (atomic at the HTTP layer),
// so the navigator.locks-based auth-token lock provides no real concurrency
// benefit for a single tab — it's pure overhead. Under dev's React Strict
// Mode + many concurrent components calling `auth.getUser()` and `rpc(...)`
// (Navbar, Sidebar, page loaders, modals), the lock frequently times out:
//
//   Error: Lock "lock:sb-...-auth-token" was released because another
//   request stole it
//   @supabase/gotrue-js: Lock "lock:sb-...-auth-token" was not released
//   within 5000ms
//
// Those rejections cascade into hung RPC calls, leaving the home page on its
// loading spinner forever and `create_room` stuck on "Creating...". Passing
// a no-op lock makes every caller just run; supabase has its own internal
// request deduplication for token refresh, so we don't lose correctness.
const passthroughLock = async <R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> => fn();

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        lock: passthroughLock,
      },
    }
  );
}
