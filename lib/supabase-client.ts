import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client — used for auth state management in React components.
// Credentials come from environment variables, never hardcoded.
// The NEXT_PUBLIC_ prefix means these values are intentionally exposed to the browser
// (they're public keys, not secrets).
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
