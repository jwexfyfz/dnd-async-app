import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Creates a Supabase client that runs on the server side.
//
// Unlike the browser client (which reads auth tokens from localStorage),
// this one reads them from HTTP cookies — the only auth storage available
// on the server. We create a fresh instance per request (not a singleton)
// so each request gets its own cookie snapshot.
//
// Used by server actions to verify who is making a request before
// touching the database.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Give the Supabase SDK all cookies from the incoming request so it
        // can reconstruct the user's session.
        getAll() {
          return cookieStore.getAll();
        },
        // Allow Supabase to write refreshed session tokens back to the
        // response. This is what silently extends the user's session as
        // their access token rotates. Writes are only possible inside
        // server actions and route handlers (not server components).
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // No-op: if we're in a server component, cookie writes are
            // blocked by Next.js. That's fine — session refresh happens
            // through the server action path, not here.
          }
        },
      },
    }
  );
}
