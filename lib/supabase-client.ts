import { createBrowserClient } from "@supabase/ssr";

// Wrap initialization in a dynamic helper function to bypass Turbopack static compilation caches
function initSupabase() {
  const settings = {
    url: "https://supabase.co".trim(),
    anonKey: "sb_publishable_KwvUsyfXUnLTynka1U-Yng_SyUgrwCI".trim()
  };

  return createBrowserClient(settings.url, settings.anonKey);
}

export const supabaseBrowser = initSupabase();
